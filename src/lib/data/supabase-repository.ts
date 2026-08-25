import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, ownerId, supabaseAdmin } from "@/lib/data/supabase-client";
import {
  ACCOUNT_TYPE_ORDER,
  ALERT_SEVERITY_ORDER,
  AS_OF_DATE,
  REPORTING_CURRENCY,
  SCENARIO_NAME_ORDER,
  deriveMetrics,
  ledgerWindowStart,
  readLedgerCoverage,
  readLoanTerms,
} from "@/lib/data/shared";
import { computeObservedCashFlow } from "@/lib/engine/cash-flow";
import { debtCashOut, monthBounds } from "@/lib/engine/debt";
import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import { deriveCanonicalBalanceSheetMetrics } from "@/lib/engine/balance-sheet-metrics";
import type { CurrencyRate } from "@/lib/engine/fx";
import {
  enumValue,
  finiteNumber,
  nullableFiniteNumber,
  requiredField,
} from "@/lib/data/row-validation";
import type { FamilyOfficeRepository } from "@/lib/data/repository";
import type { DocumentUpload, Mutation, SimulationRun } from "@/lib/data/contracts";
import type {
  Alert,
  CashFlowMonthlyClose,
  DashboardState,
  DocumentRecord,
  ExpenseCategory,
  FinancialAccount,
  Goal,
  IncomeSource,
  Liability,
  MonthlyClose,
  NetWorthSnapshot,
  Position,
  Provenance,
  RecurringCashFlowRule,
  Scenario,
  Transaction,
} from "@/lib/types";
import { CASH_FLOW_KINDS } from "@/lib/types";

/** Garde-fou de pagination du ledger : 20 000 lignes sur la fenêtre lue. */
const LEDGER_MAX_PAGES = 20;

type Row = Record<string, unknown>;

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, context: string): T {
  if (result.error) throw new Error(`Supabase ${context} : ${result.error.message}`);
  if (result.data === null) throw new Error(`Supabase ${context} : réponse vide`);
  return result.data;
}

const str = (value: unknown): string => String(value ?? "");
const optional = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : String(value);
const bool = (value: unknown): boolean => value === true || value === 1 || value === "true";

function provenance(row: Row): Provenance {
  return {
    kind: str(row.data_kind) as Provenance["kind"],
    confidence: str(row.confidence) as Provenance["confidence"],
    source: optional(row.source),
    effectiveDate: optional(row.effective_date),
    updatedAt: optional(row.updated_at),
    notes: optional(row.notes),
  };
}

/** Dernière ligne d'un historique, par date puis created_at décroissants. */
function latestBy<T extends Row>(rows: T[], key: string, dateField: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = str(row[key]);
    const current = map.get(id);
    if (!current) {
      map.set(id, row);
      continue;
    }
    const newer =
      str(row[dateField]) > str(current[dateField]) ||
      (str(row[dateField]) === str(current[dateField]) &&
        str(row.created_at) > str(current.created_at));
    if (newer) map.set(id, row);
  }
  return map;
}

const SCENARIO_COLUMNS: Record<string, string> = {
  annualReturn: "annual_return",
  annualVolatility: "annual_volatility",
  annualInflation: "annual_inflation",
  monthlySavings: "monthly_savings",
  investmentAllocationRate: "investment_allocation_rate",
  salaryGrowth: "salary_growth",
  stressProbability: "stress_probability",
  shockYear: "shock_year",
  shockMagnitude: "shock_magnitude",
};

export function mapScenario(row: Row): Scenario {
  const context = `scenarios[id=${str(row.id) || "inconnu"}]`;
  return {
    id: str(row.id),
    name: str(row.name),
    description: str(row.description),
    version: finiteNumber(row.current_version, `${context}.current_version`),
    color: str(row.color),
    annualReturn: finiteNumber(row.annual_return, `${context}.annual_return`),
    annualVolatility: finiteNumber(row.annual_volatility, `${context}.annual_volatility`),
    annualInflation: finiteNumber(row.annual_inflation, `${context}.annual_inflation`),
    monthlySavings: finiteNumber(row.monthly_savings, `${context}.monthly_savings`),
    investmentAllocationRate: finiteNumber(
      requiredField(row, "investment_allocation_rate", context),
      `${context}.investment_allocation_rate`,
    ),
    salaryGrowth: finiteNumber(row.salary_growth, `${context}.salary_growth`),
    stressProbability: finiteNumber(row.stress_probability, `${context}.stress_probability`),
    shockYear: nullableFiniteNumber(row.shock_year, `${context}.shock_year`),
    shockMagnitude: nullableFiniteNumber(row.shock_magnitude, `${context}.shock_magnitude`),
    provenance: provenance(row),
  };
}

export function validateSimulationRun(run: SimulationRun): void {
  finiteNumber(run.seed, "simulation_runs.seed");
  finiteNumber(run.simulations, "simulation_runs.simulations");
  finiteNumber(run.years, "simulation_runs.years");
  if (run.points.length === 0) {
    throw new Error("Supabase donnée invalide (simulation_results) : aucun percentile à persister");
  }
  for (const [index, point] of run.points.entries()) {
    const context = `simulation_results[index=${index},year=${String(point.year)}]`;
    finiteNumber(point.year, `${context}.year`);
    finiteNumber(point.p10, `${context}.p10`);
    finiteNumber(point.p25, `${context}.p25`);
    finiteNumber(point.p50, `${context}.p50`);
    finiteNumber(point.p75, `${context}.p75`);
    finiteNumber(point.p90, `${context}.p90`);
  }
}

export function createSupabaseRepository(): FamilyOfficeRepository {
  const db = supabaseAdmin();
  const user = ownerId();
  const mine = (table: string) => db.from(table).select("*").eq("user_id", user);

  /**
   * Charge toute la fenêtre de ledger consommée par le produit, page par page.
   *
   * L'ancienne limite fixe de 100 lignes tronquait silencieusement le graphique six mois
   * et les taux de flux constatés dès que le ledger la dépassait. Le bornage est donc
   * temporel, et la pagination garantit que la fenêtre est lue en entier.
   */
  async function fetchLedgerWindow(): Promise<{
    data: Row[] | null;
    error: PostgrestError | null;
  }> {
    const since = ledgerWindowStart(AS_OF_DATE);
    const pageSize = 1000;
    const rows: Row[] = [];
    for (let page = 0; page < LEDGER_MAX_PAGES; page += 1) {
      const result = await db
        .from("transactions")
        .select("*")
        .eq("user_id", user)
        .gte("transaction_date", since)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (result.error) return { data: null, error: result.error };
      const batch = (result.data ?? []) as Row[];
      rows.push(...batch);
      if (batch.length < pageSize) return { data: rows, error: null };
    }
    // Garde-fou : au-delà, la fenêtre est signalée plutôt que tronquée en silence.
    console.warn(
      `Ledger tronqué : plus de ${LEDGER_MAX_PAGES * pageSize} transactions depuis ${since}.`,
    );
    return { data: rows, error: null };
  }

  async function getDashboardState(): Promise<DashboardState> {
    const [
      institutionRows,
      accountRows,
      balanceRows,
      assetClassRows,
      securityRows,
      positionRows,
      snapshotRows,
      liabilityRows,
      incomeRows,
      categoryRows,
      budgetRows,
      transactionRows,
      scenarioRows,
      goalRows,
      recurringRuleRows,
      cashFlowCloseRows,
      alertRows,
      closeRows,
      documentRows,
      assumptionRows,
      profileRows,
      loanScheduleRows,
      earlyRepaymentRows,
      loanChargeRows,
      rateChangeRows,
      paymentChangeRows,
      currencyRateRows,
      netWorthSnapshotRows,
      liabilityObservationRows,
    ] = await Promise.all([
      mine("institutions"),
      mine("financial_accounts"),
      mine("account_balances"),
      mine("asset_classes"),
      mine("securities"),
      mine("positions"),
      mine("position_snapshots"),
      mine("liabilities"),
      mine("income_sources"),
      mine("expense_categories"),
      mine("budgets"),
      fetchLedgerWindow(),
      mine("scenarios"),
      mine("goals"),
      mine("recurring_cash_flow_rules"),
      mine("cash_flow_monthly_closes"),
      db.from("alerts").select("*").eq("user_id", user).eq("status", "OPEN"),
      mine("monthly_closes"),
      mine("documents"),
      mine("economic_assumptions"),
      db.from("profiles").select("*").eq("user_id", user),
      mine("loan_schedules"),
      mine("loan_early_repayments"),
      mine("loan_charges"),
      mine("loan_rate_changes"),
      mine("loan_payment_changes"),
      mine("currency_rates"),
      mine("net_worth_snapshots"),
      mine("liability_balance_observations"),
    ]).then((results) =>
      results.map((result, index) => unwrap(result, `lecture #${index}`) as Row[]),
    );

    const institutionNames = new Map(institutionRows.map((row) => [str(row.id), str(row.name)]));
    const latestBalances = latestBy(balanceRows, "account_id", "balance_date");
    const accounts: FinancialAccount[] = accountRows
      .filter((row) => str(row.status) === "ACTIVE")
      .map((row) => {
        const balance = latestBalances.get(str(row.id));
        return {
          id: str(row.id),
          institutionId: str(row.institution_id),
          institution: institutionNames.get(str(row.institution_id)) ?? "",
          name: str(row.name),
          type: str(row.account_type) as FinancialAccount["type"],
          currency: str(row.currency),
          balance: finiteNumber(
            balance?.balance,
            `account_balances[account_id=${str(row.id)}].balance`,
          ),
          balanceDate: balance ? str(balance.balance_date) : AS_OF_DATE,
          liquidity: str(row.liquidity) as FinancialAccount["liquidity"],
          provenance: balance ? provenance(balance) : provenance(row),
        };
      })
      .sort(
        (a, b) =>
          (ACCOUNT_TYPE_ORDER[a.type] ?? 4) - (ACCOUNT_TYPE_ORDER[b.type] ?? 4) ||
          a.name.localeCompare(b.name),
      );

    const assetClassNames = new Map(assetClassRows.map((row) => [str(row.id), str(row.name)]));
    const securities = new Map(securityRows.map((row) => [str(row.id), row]));
    const latestSnapshots = latestBy(snapshotRows, "position_id", "snapshot_date");
    const positions: Position[] = positionRows
      .map((row) => {
        const security = securities.get(str(row.security_id));
        const snapshot = latestSnapshots.get(str(row.id));
        return {
          id: str(row.id),
          accountId: str(row.account_id),
          securityName: security ? str(security.name) : "",
          ticker: security ? optional(security.ticker) : undefined,
          assetClass: security ? (assetClassNames.get(str(security.asset_class_id)) ?? "") : "",
          quantity: snapshot
            ? (nullableFiniteNumber(
                snapshot.quantity,
                `position_snapshots[position_id=${str(row.id)}].quantity`,
              ) ?? undefined)
            : undefined,
          costBasis: snapshot
            ? (nullableFiniteNumber(
                snapshot.cost_basis,
                `position_snapshots[position_id=${str(row.id)}].cost_basis`,
              ) ?? undefined)
            : undefined,
          value: finiteNumber(
            snapshot?.market_value,
            `position_snapshots[position_id=${str(row.id)}].market_value`,
          ),
          currency: snapshot ? str(snapshot.currency) : REPORTING_CURRENCY,
          valuationDate: snapshot ? str(snapshot.snapshot_date) : AS_OF_DATE,
          isCash: bool(row.is_cash),
          provenance: snapshot ? provenance(snapshot) : provenance(row),
        };
      })
      .sort((a, b) => b.value - a.value);

    const latestLiabilityObservations = latestBy(
      liabilityObservationRows,
      "liability_id",
      "observed_at",
    );
    const liabilities: Liability[] = liabilityRows
      .filter((row) => row.archived !== true)
      .map((row) => {
        const observation = latestLiabilityObservations.get(str(row.id));
        return {
          ...readLoanTerms(row, {
            schedules: loanScheduleRows,
            earlyRepayments: earlyRepaymentRows,
            charges: loanChargeRows,
            rateChanges: rateChangeRows,
            paymentChanges: paymentChangeRows,
          }),
          id: str(row.id),
          name: str(row.name),
          lender: str(row.lender),
          principal: finiteNumber(row.principal, `liabilities[id=${str(row.id)}].principal`),
          currentBalance: finiteNumber(
            observation?.balance ?? row.current_balance,
            `liability_balance_observations[liability_id=${str(row.id)}].balance`,
          ),
          currency: str(row.currency || profileRows[0]?.reporting_currency || REPORTING_CURRENCY),
          balanceDate: observation ? str(observation.observed_at) : AS_OF_DATE,
          annualRate: finiteNumber(row.annual_rate, `liabilities[id=${str(row.id)}].annual_rate`),
          monthlyPayment: finiteNumber(
            row.monthly_payment,
            `liabilities[id=${str(row.id)}].monthly_payment`,
          ),
          paymentCount: finiteNumber(
            row.payment_count,
            `liabilities[id=${str(row.id)}].payment_count`,
          ),
          firstPaymentDate: str(row.first_payment_date),
          maturityDate: str(row.maturity_date),
          provenance: observation ? provenance(observation) : provenance(row),
        };
      });

    const incomes: IncomeSource[] = incomeRows
      .map((row) => ({
        id: str(row.id),
        name: str(row.name),
        monthlyNet: nullableFiniteNumber(
          row.monthly_net,
          `income_sources[id=${str(row.id)}].monthly_net`,
        ),
        active: bool(row.active),
        startDate:
          row.start_date === null || row.start_date === undefined ? null : str(row.start_date),
        provenance: provenance(row),
      }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

    const budgets = new Map(
      budgetRows
        .filter((row) => str(row.lifestyle) === "COMFORTABLE")
        .map((row) => [str(row.category_id), row]),
    );
    const expenseCategories: ExpenseCategory[] = categoryRows
      .filter((row) => budgets.has(str(row.id)) && !(row.archived === true))
      .map((row) => {
        const budget = budgets.get(str(row.id)) as Row;
        return {
          id: str(row.id),
          name: str(row.name),
          groupName: str(row.group_name),
          cashFlowKind: enumValue(
            requiredField(row, "cash_flow_kind", `expense_categories[id=${str(row.id)}]`),
            CASH_FLOW_KINDS,
            `expense_categories[id=${str(row.id)}].cash_flow_kind`,
          ) as ExpenseCategory["cashFlowKind"],
          essentiality: enumValue(
            requiredField(row, "essentiality", `expense_categories[id=${str(row.id)}]`),
            ["ESSENTIAL", "NON_ESSENTIAL", "UNKNOWN"] as const,
            `expense_categories[id=${str(row.id)}].essentiality`,
          ) as ExpenseCategory["essentiality"],
          behavior: enumValue(
            requiredField(row, "expense_behavior", `expense_categories[id=${str(row.id)}]`),
            ["FIXED", "VARIABLE", "DISCRETIONARY", "UNKNOWN"] as const,
            `expense_categories[id=${str(row.id)}].expense_behavior`,
          ) as ExpenseCategory["behavior"],
          monthlyAmount: nullableFiniteNumber(
            budget.monthly_amount,
            `budgets[category_id=${str(row.id)}].monthly_amount`,
          ),
          essential: str(row.essentiality) === "ESSENTIAL",
          archived: (() => {
            const archived = requiredField(
              row,
              "archived",
              `expense_categories[id=${str(row.id)}]`,
            );
            if (typeof archived !== "boolean") {
              throw new Error(
                `Supabase donnée invalide (expense_categories[id=${str(row.id)}].archived) : booléen obligatoire, reçu ${String(archived)}`,
              );
            }
            return archived;
          })(),
          provenance: provenance(budget),
        };
      })
      .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));

    const recurringRules: RecurringCashFlowRule[] = recurringRuleRows
      .map((row) => ({
        id: str(row.id),
        name: str(row.name),
        cashFlowKind: str(row.cash_flow_kind) as RecurringCashFlowRule["cashFlowKind"],
        categoryId: str(row.category_id),
        categoryName: categoryRows.find((category) => str(category.id) === str(row.category_id))
          ? str(categoryRows.find((category) => str(category.id) === str(row.category_id))!.name)
          : "",
        accountId: row.account_id ? str(row.account_id) : null,
        amount: finiteNumber(row.amount, `recurring_cash_flow_rules[id=${str(row.id)}].amount`),
        frequency: str(row.frequency) as RecurringCashFlowRule["frequency"],
        startDate: str(row.start_date),
        endDate: row.end_date ? str(row.end_date) : null,
        dayOfMonth: nullableFiniteNumber(
          row.day_of_month,
          `recurring_cash_flow_rules[id=${str(row.id)}].day_of_month`,
        ),
        active: bool(row.active),
        provenance: provenance(row),
      }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

    const cashFlowCloses: CashFlowMonthlyClose[] = cashFlowCloseRows
      .map((row) => ({
        id: str(row.id),
        month: str(row.month),
        version: finiteNumber(row.version, `cash_flow_monthly_closes[id=${str(row.id)}].version`),
        income: finiteNumber(row.income, `cash_flow_monthly_closes[id=${str(row.id)}].income`),
        consumerExpenses: finiteNumber(
          row.consumer_expenses,
          `cash_flow_monthly_closes[id=${str(row.id)}].consumer_expenses`,
        ),
        essentialExpenses: finiteNumber(
          row.essential_expenses,
          `cash_flow_monthly_closes[id=${str(row.id)}].essential_expenses`,
        ),
        taxesPaid: finiteNumber(
          row.taxes_paid,
          `cash_flow_monthly_closes[id=${str(row.id)}].taxes_paid`,
        ),
        debtServicePaid: finiteNumber(
          row.debt_service_paid,
          `cash_flow_monthly_closes[id=${str(row.id)}].debt_service_paid`,
        ),
        investmentFlows: finiteNumber(
          row.investment_flows,
          `cash_flow_monthly_closes[id=${str(row.id)}].investment_flows`,
        ),
        internalTransfers: finiteNumber(
          row.internal_transfers,
          `cash_flow_monthly_closes[id=${str(row.id)}].internal_transfers`,
        ),
        operatingSurplusBeforeDebt: finiteNumber(
          row.operating_surplus_before_debt,
          `cash_flow_monthly_closes[id=${str(row.id)}].operating_surplus_before_debt`,
        ),
        postDebtSurplus: finiteNumber(
          row.post_debt_surplus,
          `cash_flow_monthly_closes[id=${str(row.id)}].post_debt_surplus`,
        ),
        unclassifiedTransactionCount: finiteNumber(
          row.unclassified_transaction_count,
          `cash_flow_monthly_closes[id=${str(row.id)}].unclassified_transaction_count`,
        ),
        closedAt: str(row.closed_at),
      }))
      .sort((a, b) => b.month.localeCompare(a.month) || b.version - a.version);

    const accountNames = new Map(accountRows.map((row) => [str(row.id), str(row.name)]));
    const categoryNames = new Map(categoryRows.map((row) => [str(row.id), str(row.name)]));
    const transactions: Transaction[] = transactionRows.map((row) => ({
      id: str(row.id),
      accountId: str(row.account_id),
      accountName: accountNames.get(str(row.account_id)) ?? "",
      date: str(row.transaction_date),
      label: str(row.label),
      categoryId: str(row.category_id),
      categoryName: categoryNames.get(str(row.category_id)) ?? "",
      amount: finiteNumber(row.amount, `transactions[id=${str(row.id)}].amount`),
      currency: str(row.currency),
      kindOverride: row.kind_override
        ? (str(row.kind_override) as Transaction["kindOverride"])
        : null,
      transferGroupId: row.transfer_group_id ? str(row.transfer_group_id) : null,
      notes: row.notes ? str(row.notes) : null,
      provenance: provenance(row),
    }));

    const scenarios: Scenario[] = scenarioRows
      .map(mapScenario)
      .sort((a, b) => (SCENARIO_NAME_ORDER[a.name] ?? 5) - (SCENARIO_NAME_ORDER[b.name] ?? 5));

    const goals: Goal[] = goalRows
      .map((row) => ({
        id: str(row.id),
        name: str(row.name),
        targetAmount: finiteNumber(row.target_amount, `goals[id=${str(row.id)}].target_amount`),
        targetDate:
          row.target_date === null || row.target_date === undefined ? null : str(row.target_date),
        priority: finiteNumber(row.priority, `goals[id=${str(row.id)}].priority`),
        status: str(row.status) as Goal["status"],
      }))
      .sort((a, b) => a.priority - b.priority);

    const alerts: Alert[] = alertRows
      .map((row) => ({
        id: str(row.id),
        severity: str(row.severity) as Alert["severity"],
        title: str(row.title),
        detail: str(row.detail),
        status: str(row.status) as Alert["status"],
        createdAt: str(row.created_at),
      }))
      .sort(
        (a, b) => (ALERT_SEVERITY_ORDER[a.severity] ?? 3) - (ALERT_SEVERITY_ORDER[b.severity] ?? 3),
      );

    const monthlyCloses: MonthlyClose[] = closeRows
      .map((row) => ({
        id: str(row.id),
        closeDate: str(row.close_date),
        grossAssets: finiteNumber(
          row.gross_assets,
          `monthly_closes[id=${str(row.id)}].gross_assets`,
        ),
        debt: finiteNumber(row.debt, `monthly_closes[id=${str(row.id)}].debt`),
        netWorth: finiteNumber(row.net_worth, `monthly_closes[id=${str(row.id)}].net_worth`),
        forecastNetWorth: nullableFiniteNumber(
          row.forecast_net_worth,
          `monthly_closes[id=${str(row.id)}].forecast_net_worth`,
        ),
        variance: nullableFiniteNumber(row.variance, `monthly_closes[id=${str(row.id)}].variance`),
        createdAt: str(row.created_at),
      }))
      .sort((a, b) => b.closeDate.localeCompare(a.closeDate));

    const documents: DocumentRecord[] = documentRows
      .map((row) => ({
        id: str(row.id),
        name: str(row.name),
        category: str(row.category),
        size: finiteNumber(row.size_bytes, `documents[id=${str(row.id)}].size_bytes`),
        uploadedAt: str(row.uploaded_at),
        status: str(row.status) as DocumentRecord["status"],
      }))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

    const assumptions = assumptionRows
      .map((row) => {
        const raw = row.value;
        const value: number | string | null =
          raw === null || raw === undefined ? null : typeof raw === "number" ? raw : String(raw);
        return {
          id: str(row.id),
          name: str(row.name),
          value,
          unit: str(row.unit),
          provenance: provenance(row),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const currencyRates: CurrencyRate[] = currencyRateRows
      .map((row) => ({
        id: str(row.id),
        baseCurrency: str(row.base_currency),
        quoteCurrency: str(row.quote_currency),
        rate: finiteNumber(row.rate, `currency_rates[id=${str(row.id)}].rate`),
        rateDate: str(row.rate_date),
        provenance: {
          kind: str(row.data_kind) as Provenance["kind"],
          confidence: "HIGH" as const,
          source: optional(row.source),
          effectiveDate: str(row.rate_date),
        },
      }))
      .sort((a, b) => b.rateDate.localeCompare(a.rateDate));

    const netWorthSnapshots: NetWorthSnapshot[] = netWorthSnapshotRows
      .map((row) => ({
        id: str(row.id),
        snapshotDate: str(row.snapshot_date),
        version:
          row.version === undefined
            ? 1
            : finiteNumber(row.version, `net_worth_snapshots[id=${str(row.id)}].version`),
        grossAssets: finiteNumber(
          row.gross_assets,
          `net_worth_snapshots[id=${str(row.id)}].gross_assets`,
        ),
        totalLiabilities: finiteNumber(
          row.total_liabilities ?? row.debt,
          `net_worth_snapshots[id=${str(row.id)}].total_liabilities`,
        ),
        netWorth: finiteNumber(row.net_worth, `net_worth_snapshots[id=${str(row.id)}].net_worth`),
        liquidAssets: nullableFiniteNumber(
          row.liquid_assets,
          `net_worth_snapshots[id=${str(row.id)}].liquid_assets`,
        ),
        reportingCurrency: str(
          row.reporting_currency || profileRows[0]?.reporting_currency || REPORTING_CURRENCY,
        ),
        completenessStatus: str(
          row.completeness_status || "COMPLETE",
        ) as NetWorthSnapshot["completenessStatus"],
        dataKind: str(row.data_kind) as NetWorthSnapshot["dataKind"],
        createdAt: str(row.created_at),
      }))
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate) || b.version - a.version);

    const coverage = readLedgerCoverage(profileRows[0]);
    const reportingCurrency = str(profileRows[0]?.reporting_currency || REPORTING_CURRENCY);
    const balanceSheet = buildCanonicalBalanceSheet({
      asOfDate: AS_OF_DATE,
      reportingCurrency,
      accounts,
      positions,
      liabilities,
      currencyRates,
    });
    const balanceSheetMetrics = deriveCanonicalBalanceSheetMetrics({
      balanceSheet,
      liabilities,
      expenses: expenseCategories,
      positions,
      snapshots: netWorthSnapshots,
    });
    const legacyMetrics = deriveMetrics(
      accounts,
      liabilities,
      incomes,
      expenseCategories,
      positions,
      transactions,
      AS_OF_DATE,
    );
    return {
      asOfDate: AS_OF_DATE,
      reportingCurrency,
      ledgerCoverageStart: coverage.start,
      ledgerCoverageSource: coverage.source,
      accounts,
      positions,
      liabilities,
      incomes,
      expenseCategories,
      transactions,
      recurringRules,
      cashFlowCloses,
      scenarios,
      goals,
      alerts,
      monthlyCloses,
      netWorthSnapshots,
      currencyRates,
      documents,
      balanceSheet,
      balanceSheetMetrics,
      metrics: {
        ...legacyMetrics,
        grossAssets: balanceSheet.grossAssets.value,
        debt: balanceSheet.totalLiabilities.value,
        netWorth: balanceSheet.netWorth.value,
        bankCash: balanceSheet.immediateCash.value,
        liquidAssets: balanceSheet.liquidAssets.value,
        liquidNetWorth: balanceSheet.liquidNetWorth.value,
        investedAssets: balanceSheet.marketInvestedAssets.value,
        productiveNetWorth: balanceSheet.productiveNetWorth.value,
      },
      assumptions,
    };
  }

  async function mutateState(mutation: Mutation): Promise<DashboardState> {
    const now = new Date().toISOString();
    switch (mutation.action) {
      case "save_debt_contract": {
        const contract = mutation.contract;
        unwrap(
          await db.rpc("lfo_save_debt_contract", {
            p_user_id: user,
            p_payload: {
              liability_id: contract.liabilityId,
              name: contract.name,
              lender: contract.lender,
              principal: contract.principal,
              initial_balance: contract.initialBalance,
              balance_date: contract.balanceDate,
              annual_rate: contract.annualRate,
              payment_amount: contract.paymentAmount,
              payment_count: contract.paymentCount,
              first_payment_date: contract.firstPaymentDate,
              maturity_date: contract.maturityDate,
              amortisation_profile: contract.amortisationProfile,
              balloon_amount: contract.balloonAmount,
              payment_frequency: contract.paymentFrequency,
              interest_convention: contract.interestConvention,
              rate_type: contract.rateType,
              insurance_amount: contract.insuranceAmount,
              recurring_fees: contract.recurringFees,
              payment_includes_insurance: contract.paymentIncludesInsurance,
              deferral: contract.deferral
                ? {
                    kind: contract.deferral.kind,
                    months: contract.deferral.months,
                    interest_treatment: contract.deferral.interestTreatment,
                  }
                : null,
              facility_id: contract.facilityId,
              notes: contract.notes,
              rate_schedule: contract.rateSchedule.map((change) => ({
                effective_from: change.effectiveFrom,
                annual_rate: change.annualRate,
                kind: change.kind,
              })),
              payment_schedule: contract.paymentSchedule.map((change) => ({
                effective_from: change.effectiveFrom,
                amount: change.amount,
                kind: change.kind,
              })),
              early_repayments: contract.earlyRepayments,
              charges: contract.charges,
              provided_schedule: contract.providedSchedule.map((row) => ({
                payment_number: row.paymentNumber,
                due_date: row.dueDate,
                opening_balance: row.openingBalance,
                payment: debtCashOut(row),
                interest: row.interest,
                principal: row.principal,
                insurance: row.insurance,
                fees: row.fees,
                closing_balance: row.closingBalance,
              })),
            },
          }),
          "enregistrement atomique du contrat de dette",
        );
        break;
      }
      case "record_debt_balance": {
        unwrap(
          await db.rpc("lfo_record_debt_balance", {
            p_user_id: user,
            p_liability_id: mutation.liabilityId,
            p_observed_at: mutation.observedAt,
            p_balance: mutation.balance,
            p_notes: mutation.notes,
          }),
          "enregistrement atomique de l’encours observé",
        );
        break;
      }
      case "archive_debt": {
        unwrap(
          await db.rpc("lfo_archive_debt", {
            p_user_id: user,
            p_liability_id: mutation.liabilityId,
          }),
          "archivage de dette éteinte",
        );
        break;
      }
      case "update_account": {
        unwrap(
          await db
            .from("account_balances")
            .insert({
              user_id: user,
              account_id: mutation.accountId,
              balance: mutation.balance,
              balance_date: mutation.balanceDate,
              data_kind: "ACTUAL",
              confidence: "HIGH",
              source: "Saisie manuelle",
            })
            .select("id"),
          "insertion de solde",
        );
        break;
      }
      case "add_account": {
        unwrap(
          await db.rpc("lfo_add_account", {
            p_user_id: user,
            p_institution: mutation.institution,
            p_name: mutation.name,
            p_account_type: mutation.accountType,
            p_balance: finiteNumber(mutation.balance, "add_account.balance"),
            p_currency: mutation.currency,
            p_as_of_date: AS_OF_DATE,
          }),
          "création atomique de compte",
        );
        break;
      }
      case "add_transaction": {
        unwrap(
          await db.rpc("lfo_add_transaction", {
            p_user_id: user,
            p_account_id: mutation.accountId,
            p_category_id: mutation.categoryId,
            p_transaction_date: mutation.date,
            p_label: mutation.label,
            p_amount: finiteNumber(mutation.amount, "add_transaction.amount"),
            p_currency: REPORTING_CURRENCY,
            p_update_balance: mutation.updateBalance,
          }),
          "insertion atomique de transaction",
        );
        break;
      }
      case "update_expense": {
        unwrap(
          await db
            .from("budgets")
            .update({
              monthly_amount: mutation.monthlyAmount,
              data_kind: "USER_ASSUMPTION",
              confidence: "HIGH",
              source: "Saisie manuelle",
              effective_date: AS_OF_DATE,
            })
            .eq("user_id", user)
            .eq("category_id", mutation.categoryId)
            .eq("lifestyle", "COMFORTABLE")
            .select("id"),
          "mise à jour de budget",
        );
        break;
      }
      case "update_scenario": {
        const patch: Row = {};
        for (const [key, column] of Object.entries(SCENARIO_COLUMNS)) {
          const value = (mutation.patch as Record<string, unknown>)[key];
          if (value !== undefined) patch[column] = value;
        }
        if (Object.keys(patch).length === 0) break;
        unwrap(
          await db.rpc("lfo_update_scenario", {
            p_user_id: user,
            p_scenario_id: mutation.scenarioId,
            p_patch: patch,
            p_updated_at: now,
          }),
          "mise à jour atomique de scénario",
        );
        break;
      }
      case "duplicate_scenario": {
        unwrap(
          await db.rpc("lfo_duplicate_scenario", {
            p_user_id: user,
            p_scenario_id: mutation.scenarioId,
            p_now: now,
          }),
          "duplication atomique de scénario",
        );
        break;
      }
      case "create_monthly_close": {
        const state = await getDashboardState();
        if (
          state.metrics.grossAssets === null ||
          state.metrics.debt === null ||
          state.metrics.netWorth === null
        ) {
          throw new Error(
            "Clôture impossible : le bilan canonique est incomplet (FX ou valorisation manquante)",
          );
        }
        const sheet = state.balanceSheet;
        if (
          !sheet ||
          sheet.financialAssets.value === null ||
          sheet.liquidAssets.value === null ||
          sheet.accountOverdraftLiabilities.value === null ||
          sheet.contractualDebt.value === null ||
          sheet.otherLiabilities.value === null ||
          sheet.totalLiabilities.value === null
        ) {
          throw new Error("Clôture impossible : ventilation du bilan canonique incomplète");
        }
        const prior = state.monthlyCloses[0];
        const forecast = prior?.netWorth ?? null;
        const variance = forecast === null ? null : state.metrics.netWorth - forecast;
        unwrap(
          await db.rpc("lfo_create_monthly_close_v2", {
            p_user_id: user,
            p_close_date: mutation.closeDate,
            p_snapshot: {
              gross_assets: finiteNumber(state.metrics.grossAssets, "monthly_close.gross_assets"),
              financial_assets: sheet.financialAssets.value,
              liquid_assets: sheet.liquidAssets.value,
              account_overdrafts: sheet.accountOverdraftLiabilities.value,
              contractual_debt: sheet.contractualDebt.value,
              other_liabilities: sheet.otherLiabilities.value,
              total_liabilities: sheet.totalLiabilities.value,
              net_worth: finiteNumber(state.metrics.netWorth, "monthly_close.net_worth"),
              reporting_currency: state.reportingCurrency,
              completeness_status: sheet.quality.status,
              data_completeness: Math.min(
                sheet.grossAssets.coverage,
                sheet.totalLiabilities.coverage,
              ),
              data_kind: "ACTUAL",
              composition: {
                immediate_cash: sheet.immediateCash.value,
                market_invested_assets: sheet.marketInvestedAssets.value,
                investment_envelope_cash: sheet.investmentEnvelopeCash.value,
                illiquid_assets: sheet.illiquidAssets.value,
              },
              provenance: { engine: "CANONICAL_BALANCE_SHEET_V2", as_of_date: state.asOfDate },
            },
            p_items: sheet.contributions.map((line) => ({
              domain: line.domain,
              entity_id: line.entityId,
              side: line.side,
              category: line.category,
              subcategory: line.subcategory ?? null,
              native_amount: line.nativeValue,
              currency: line.currency,
              fx_rate: line.fx.rate,
              fx_rate_date: line.fx.rateDate,
              reporting_amount: line.reportingValue,
              valuation_date: line.valuationDate,
              valuation_method: line.valuationMethod,
              valuation_status: line.valuationStatus,
              data_kind: line.provenance.kind,
              confidence: line.confidence,
              quality_status: line.fx.status === "MISSING" ? "MISSING" : line.reconciliationState,
              source: line.source ?? null,
              flags: [...line.flags, ...line.fx.flags],
            })),
            p_forecast_net_worth: forecast,
            p_variance: variance,
          }),
          "clôture mensuelle atomique",
        );
        break;
      }
      case "add_goal": {
        unwrap(
          await db
            .from("goals")
            .insert({
              user_id: user,
              name: mutation.name,
              target_amount: mutation.targetAmount,
              target_date: mutation.targetDate,
              priority: 99,
              status: "ACTIVE",
            })
            .select("id"),
          "création d'objectif",
        );
        break;
      }
      case "update_category": {
        const patch: Record<string, unknown> = {};
        if (mutation.patch.name !== undefined) patch.name = mutation.patch.name;
        if (mutation.patch.groupName !== undefined) patch.group_name = mutation.patch.groupName;
        if (mutation.patch.cashFlowKind !== undefined)
          patch.cash_flow_kind = mutation.patch.cashFlowKind;
        if (mutation.patch.essentiality !== undefined) {
          patch.essentiality = mutation.patch.essentiality;
          patch.essential = mutation.patch.essentiality === "ESSENTIAL";
        }
        if (mutation.patch.behavior !== undefined) patch.expense_behavior = mutation.patch.behavior;
        if (mutation.patch.archived !== undefined) patch.archived = mutation.patch.archived;
        if (Object.keys(patch).length) {
          unwrap(
            await db
              .from("expense_categories")
              .update(patch)
              .eq("id", mutation.categoryId)
              .eq("user_id", user)
              .select("id"),
            "mise à jour de catégorie",
          );
        }
        break;
      }
      case "add_category": {
        unwrap(
          await db.rpc("lfo_add_category", {
            p_user_id: user,
            p_name: mutation.name,
            p_group_name: mutation.groupName,
            p_cash_flow_kind: mutation.cashFlowKind,
            p_essentiality: mutation.essentiality,
            p_expense_behavior: mutation.behavior,
            p_as_of_date: AS_OF_DATE,
          }),
          "création atomique de catégorie",
        );
        break;
      }
      case "classify_transaction": {
        const patch: Record<string, unknown> = {};
        if (mutation.categoryId !== undefined) patch.category_id = mutation.categoryId;
        if (mutation.kindOverride !== undefined) patch.kind_override = mutation.kindOverride;
        if (mutation.transferGroupId !== undefined)
          patch.transfer_group_id = mutation.transferGroupId;
        if (mutation.notes !== undefined) patch.notes = mutation.notes;
        // Reclasser ne touche jamais au solde : un snapshot postérieur reste la vérité.
        if (Object.keys(patch).length) {
          unwrap(
            await db
              .from("transactions")
              .update(patch)
              .eq("id", mutation.transactionId)
              .eq("user_id", user)
              .select("id"),
            "classification de transaction",
          );
        }
        break;
      }
      case "add_recurring_rule": {
        unwrap(
          await db
            .from("recurring_cash_flow_rules")
            .insert({
              user_id: user,
              name: mutation.name,
              cash_flow_kind: mutation.cashFlowKind,
              category_id: mutation.categoryId,
              account_id: mutation.accountId,
              amount: mutation.amount,
              frequency: mutation.frequency,
              start_date: mutation.startDate,
              end_date: mutation.endDate,
              day_of_month: mutation.dayOfMonth,
              active: true,
              data_kind: "USER_ASSUMPTION",
              confidence: "HIGH",
              source: "Règle saisie manuellement",
            })
            .select("id"),
          "création de règle récurrente",
        );
        break;
      }
      case "update_recurring_rule": {
        const patch: Record<string, unknown> = {};
        if (mutation.patch.amount !== undefined) patch.amount = mutation.patch.amount;
        if (mutation.patch.active !== undefined) patch.active = mutation.patch.active;
        if (mutation.patch.endDate !== undefined) patch.end_date = mutation.patch.endDate;
        if (Object.keys(patch).length) {
          unwrap(
            await db
              .from("recurring_cash_flow_rules")
              .update(patch)
              .eq("id", mutation.ruleId)
              .eq("user_id", user)
              .select("id"),
            "mise à jour de règle récurrente",
          );
        }
        break;
      }
      case "delete_recurring_rule": {
        unwrap(
          await db
            .from("recurring_cash_flow_rules")
            .delete()
            .eq("id", mutation.ruleId)
            .eq("user_id", user)
            .select("id"),
          "suppression de règle récurrente",
        );
        break;
      }
      case "set_ledger_coverage": {
        // `null` remet la profondeur à « non déclarée » : c'est une valeur, pas un oubli.
        unwrap(
          await db
            .from("profiles")
            .update({
              ledger_coverage_start: mutation.startDate,
              ledger_coverage_source: mutation.source,
            })
            .eq("user_id", user)
            .select("user_id"),
          "déclaration de profondeur d'historique",
        );
        break;
      }
      case "close_cash_flow_month": {
        const state = await getDashboardState();
        const bounds = monthBounds(`${mutation.month}-01`);
        const observed = computeObservedCashFlow(
          state.transactions,
          state.expenseCategories,
          bounds.start,
          bounds.end,
        );
        unwrap(
          await db.rpc("lfo_close_cash_flow_month", {
            p_user_id: user,
            p_month: mutation.month,
            p_income: observed.income,
            p_consumer_expenses: observed.consumerExpenses,
            p_essential_expenses: observed.essentialExpenses,
            p_taxes_paid: observed.taxesPaid,
            p_debt_service_paid: observed.debtServicePaid,
            p_investment_flows: observed.investmentFlows,
            p_internal_transfers: observed.internalTransfers,
            p_operating_surplus_before_debt: observed.operatingCashFlowBeforeDebt,
            p_post_debt_surplus: observed.cashFlowAfterDebt,
            p_unclassified_transaction_count: observed.dataQuality.unclassifiedTransactionCount,
          }),
          "clôture Cash Flow atomique",
        );
        break;
      }
    }
    return getDashboardState();
  }

  async function storeDocument(upload: DocumentUpload): Promise<DocumentRecord> {
    const extension = upload.name.includes(".")
      ? `.${upload.name
          .split(".")
          .pop()!
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 7)}`
      : "";
    const storagePath = `${user}/${crypto.randomUUID()}${extension}`;
    const uploaded = await db.storage.from(DOCUMENTS_BUCKET).upload(storagePath, upload.bytes, {
      contentType: upload.contentType,
      upsert: false,
    });
    if (uploaded.error) throw new Error(`Supabase stockage : ${uploaded.error.message}`);
    let row: Row;
    try {
      row = unwrap(
        await db
          .from("documents")
          .insert({
            user_id: user,
            name: upload.name,
            category: upload.category,
            storage_path: storagePath,
            size_bytes: finiteNumber(upload.size, "documents.size_bytes"),
            status: "INBOX",
          })
          .select("*")
          .single(),
        "enregistrement de document",
      ) as Row;
    } catch (error) {
      const rollback = await db.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
      const message = error instanceof Error ? error.message : String(error);
      if (rollback.error) {
        throw new Error(
          `${message}. Rollback Storage échoué pour ${storagePath} : ${rollback.error.message}`,
        );
      }
      throw error;
    }
    return {
      id: str(row.id),
      name: str(row.name),
      category: str(row.category),
      size: finiteNumber(row.size_bytes, `documents[id=${str(row.id)}].size_bytes`),
      uploadedAt: str(row.uploaded_at),
      status: str(row.status) as DocumentRecord["status"],
    };
  }

  async function saveSimulation(run: SimulationRun): Promise<string> {
    validateSimulationRun(run);
    return unwrap(
      await db.rpc("lfo_save_simulation", {
        p_user_id: user,
        p_scenario_id: run.scenarioId,
        p_seed: run.seed,
        p_simulations: run.simulations,
        p_years: run.years,
        p_methodology: run.methodology,
        p_points: run.points,
      }),
      "enregistrement atomique de simulation",
    ) as string;
  }

  return { adapter: "supabase", getDashboardState, mutateState, storeDocument, saveSimulation };
}
