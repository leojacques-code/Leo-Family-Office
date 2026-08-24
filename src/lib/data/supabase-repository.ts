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
  shouldDeriveBalance,
} from "@/lib/data/shared";
import { computeObservedCashFlow } from "@/lib/engine/cash-flow";
import { monthBounds } from "@/lib/engine/debt";
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
  Position,
  Provenance,
  RecurringCashFlowRule,
  Scenario,
  Transaction,
} from "@/lib/types";

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
const num = (value: unknown): number => Number(value ?? 0);
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
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

function mapScenario(row: Row): Scenario {
  return {
    id: str(row.id),
    name: str(row.name),
    description: str(row.description),
    version: num(row.current_version),
    color: str(row.color),
    annualReturn: num(row.annual_return),
    annualVolatility: num(row.annual_volatility),
    annualInflation: num(row.annual_inflation),
    monthlySavings: num(row.monthly_savings),
    investmentAllocationRate:
      row.investment_allocation_rate === null || row.investment_allocation_rate === undefined
        ? 1
        : num(row.investment_allocation_rate),
    salaryGrowth: num(row.salary_growth),
    stressProbability: num(row.stress_probability),
    shockYear: numOrNull(row.shock_year),
    shockMagnitude: numOrNull(row.shock_magnitude),
    provenance: provenance(row),
  };
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
          balance: num(balance?.balance),
          balanceDate: balance ? str(balance.balance_date) : AS_OF_DATE,
          liquidity: str(row.liquidity) as FinancialAccount["liquidity"],
          provenance: provenance(row),
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
          quantity: snapshot ? (numOrNull(snapshot.quantity) ?? undefined) : undefined,
          costBasis: snapshot ? (numOrNull(snapshot.cost_basis) ?? undefined) : undefined,
          value: num(snapshot?.market_value),
          currency: snapshot ? str(snapshot.currency) : REPORTING_CURRENCY,
          isCash: bool(row.is_cash),
          provenance: provenance(row),
        };
      })
      .sort((a, b) => b.value - a.value);

    const liabilities: Liability[] = liabilityRows.map((row) => ({
      id: str(row.id),
      name: str(row.name),
      lender: str(row.lender),
      principal: num(row.principal),
      currentBalance: num(row.current_balance),
      annualRate: num(row.annual_rate),
      monthlyPayment: num(row.monthly_payment),
      paymentCount: num(row.payment_count),
      firstPaymentDate: str(row.first_payment_date),
      maturityDate: str(row.maturity_date),
      provenance: provenance(row),
    }));

    const incomes: IncomeSource[] = incomeRows
      .map((row) => ({
        id: str(row.id),
        name: str(row.name),
        monthlyNet: numOrNull(row.monthly_net),
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
          // Repli sur la sémantique historique tant que la migration n'est pas appliquée.
          cashFlowKind: (row.cash_flow_kind
            ? str(row.cash_flow_kind)
            : "EXPENSE") as ExpenseCategory["cashFlowKind"],
          essentiality: (row.essentiality
            ? str(row.essentiality)
            : bool(row.essential)
              ? "ESSENTIAL"
              : "NON_ESSENTIAL") as ExpenseCategory["essentiality"],
          behavior: (row.expense_behavior
            ? str(row.expense_behavior)
            : "UNKNOWN") as ExpenseCategory["behavior"],
          monthlyAmount: numOrNull(budget.monthly_amount),
          essential: row.essentiality ? str(row.essentiality) === "ESSENTIAL" : bool(row.essential),
          archived:
            row.archived === undefined || row.archived === null ? false : bool(row.archived),
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
        amount: num(row.amount),
        frequency: str(row.frequency) as RecurringCashFlowRule["frequency"],
        startDate: str(row.start_date),
        endDate: row.end_date ? str(row.end_date) : null,
        dayOfMonth: numOrNull(row.day_of_month),
        active: bool(row.active),
        provenance: provenance(row),
      }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

    const cashFlowCloses: CashFlowMonthlyClose[] = cashFlowCloseRows
      .map((row) => ({
        id: str(row.id),
        month: str(row.month),
        version: num(row.version),
        income: num(row.income),
        consumerExpenses: num(row.consumer_expenses),
        essentialExpenses: num(row.essential_expenses),
        taxesPaid: num(row.taxes_paid),
        debtServicePaid: num(row.debt_service_paid),
        investmentFlows: num(row.investment_flows),
        internalTransfers: num(row.internal_transfers),
        operatingSurplusBeforeDebt: num(row.operating_surplus_before_debt),
        postDebtSurplus: num(row.post_debt_surplus),
        unclassifiedTransactionCount: num(row.unclassified_transaction_count),
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
      amount: num(row.amount),
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
        targetAmount: num(row.target_amount),
        targetDate:
          row.target_date === null || row.target_date === undefined ? null : str(row.target_date),
        priority: num(row.priority),
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
        grossAssets: num(row.gross_assets),
        debt: num(row.debt),
        netWorth: num(row.net_worth),
        forecastNetWorth: numOrNull(row.forecast_net_worth),
        variance: numOrNull(row.variance),
        createdAt: str(row.created_at),
      }))
      .sort((a, b) => b.closeDate.localeCompare(a.closeDate));

    const documents: DocumentRecord[] = documentRows
      .map((row) => ({
        id: str(row.id),
        name: str(row.name),
        category: str(row.category),
        size: num(row.size_bytes),
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

    const coverage = readLedgerCoverage(profileRows[0]);
    return {
      asOfDate: AS_OF_DATE,
      reportingCurrency: REPORTING_CURRENCY,
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
      documents,
      metrics: deriveMetrics(
        accounts,
        liabilities,
        incomes,
        expenseCategories,
        positions,
        transactions,
        AS_OF_DATE,
      ),
      assumptions,
    };
  }

  async function mutateState(mutation: Mutation): Promise<DashboardState> {
    const now = new Date().toISOString();
    switch (mutation.action) {
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
        const institution = unwrap(
          await db
            .from("institutions")
            .upsert(
              { user_id: user, name: mutation.institution, country_code: "FR" },
              { onConflict: "user_id,name" },
            )
            .select("id")
            .single(),
          "création d'établissement",
        ) as Row;
        const account = unwrap(
          await db
            .from("financial_accounts")
            .insert({
              user_id: user,
              institution_id: institution.id,
              name: mutation.name,
              account_type: mutation.accountType,
              currency: mutation.currency,
              liquidity:
                mutation.accountType === "BANK" || mutation.accountType === "SAVINGS"
                  ? "IMMEDIATE"
                  : "LIQUID",
              status: "ACTIVE",
              data_kind: "ACTUAL",
              confidence: "HIGH",
              source: "Saisie manuelle",
              effective_date: AS_OF_DATE,
            })
            .select("id")
            .single(),
          "création de compte",
        ) as Row;
        unwrap(
          await db
            .from("account_balances")
            .insert({
              user_id: user,
              account_id: account.id,
              balance: mutation.balance,
              balance_date: AS_OF_DATE,
              data_kind: "ACTUAL",
              confidence: "HIGH",
              source: "Saisie manuelle",
            })
            .select("id"),
          "solde initial",
        );
        break;
      }
      case "add_transaction": {
        unwrap(
          await db
            .from("transactions")
            .insert({
              user_id: user,
              account_id: mutation.accountId,
              category_id: mutation.categoryId,
              transaction_date: mutation.date,
              label: mutation.label,
              amount: mutation.amount,
              currency: REPORTING_CURRENCY,
              data_kind: "ACTUAL",
              confidence: "HIGH",
              source: "Saisie manuelle",
            })
            .select("id"),
          "insertion de transaction",
        );
        if (mutation.updateBalance) {
          const latest = unwrap(
            await db
              .from("account_balances")
              .select("balance, balance_date")
              .eq("user_id", user)
              .eq("account_id", mutation.accountId)
              .order("balance_date", { ascending: false })
              .order("created_at", { ascending: false })
              .limit(1),
            "lecture du dernier solde",
          ) as Row[];
          if (latest.length === 0) throw new Error("Aucun solde connu pour ce compte");
          // Un snapshot de solde daté est la vérité du compte à cette date : il contient
          // déjà les mouvements antérieurs. Une transaction plus ancienne enrichit donc le
          // ledger sans toucher au solde observé, sinon elle serait comptée deux fois.
          const latestDate = str(latest[0].balance_date);
          if (shouldDeriveBalance(mutation.date, latestDate)) {
            unwrap(
              await db
                .from("account_balances")
                .insert({
                  user_id: user,
                  account_id: mutation.accountId,
                  balance: num(latest[0].balance) + mutation.amount,
                  balance_date: mutation.date,
                  data_kind: "DERIVED",
                  confidence: "HIGH",
                  source: "Transaction saisie",
                })
                .select("id"),
              "solde dérivé",
            );
          }
        }
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
        const existing = unwrap(
          await db
            .from("scenarios")
            .select("*")
            .eq("user_id", user)
            .eq("id", mutation.scenarioId)
            .maybeSingle(),
          "lecture de scénario",
        ) as Row | null;
        if (!existing) throw new Error("Scenario not found");
        const patch: Row = {};
        for (const [key, column] of Object.entries(SCENARIO_COLUMNS)) {
          const value = (mutation.patch as Record<string, unknown>)[key];
          if (value !== undefined) patch[column] = value;
        }
        if (Object.keys(patch).length === 0) break;
        const version = num(existing.current_version) + 1;
        const updated = unwrap(
          await db
            .from("scenarios")
            .update({
              ...patch,
              current_version: version,
              data_kind: "USER_ASSUMPTION",
              confidence: "HIGH",
              updated_at: now,
            })
            .eq("id", mutation.scenarioId)
            .eq("user_id", user)
            .select("*")
            .single(),
          "mise à jour de scénario",
        ) as Row;
        unwrap(
          await db
            .from("scenario_versions")
            .insert({
              user_id: user,
              scenario_id: mutation.scenarioId,
              version,
              payload: updated,
            })
            .select("id"),
          "versionnage de scénario",
        );
        break;
      }
      case "duplicate_scenario": {
        const source = unwrap(
          await db
            .from("scenarios")
            .select("*")
            .eq("user_id", user)
            .eq("id", mutation.scenarioId)
            .maybeSingle(),
          "lecture de scénario",
        ) as Row | null;
        if (!source) throw new Error("Scenario not found");
        const copy = unwrap(
          await db
            .from("scenarios")
            .insert({
              user_id: user,
              name: `${str(source.name)} — copie`,
              description: source.description,
              color: source.color,
              current_version: 1,
              annual_return: source.annual_return,
              annual_volatility: source.annual_volatility,
              annual_inflation: source.annual_inflation,
              monthly_savings: source.monthly_savings,
              investment_allocation_rate: source.investment_allocation_rate,
              salary_growth: source.salary_growth,
              stress_probability: source.stress_probability,
              shock_year: source.shock_year,
              shock_magnitude: source.shock_magnitude,
              data_kind: "USER_ASSUMPTION",
              confidence: "HIGH",
              created_at: now,
              updated_at: now,
            })
            .select("*")
            .single(),
          "duplication de scénario",
        ) as Row;
        unwrap(
          await db
            .from("scenario_versions")
            .insert({
              user_id: user,
              scenario_id: copy.id,
              version: 1,
              payload: copy,
            })
            .select("id"),
          "versionnage de la copie",
        );
        break;
      }
      case "create_monthly_close": {
        const state = await getDashboardState();
        const prior = state.monthlyCloses[0];
        const forecast = prior?.netWorth ?? null;
        const variance = forecast === null ? null : state.metrics.netWorth - forecast;
        unwrap(
          await db
            .from("monthly_closes")
            .upsert(
              {
                user_id: user,
                close_date: mutation.closeDate,
                gross_assets: state.metrics.grossAssets,
                debt: state.metrics.debt,
                net_worth: state.metrics.netWorth,
                forecast_net_worth: forecast,
                variance,
              },
              { onConflict: "user_id,close_date" },
            )
            .select("id"),
          "clôture mensuelle",
        );
        unwrap(
          await db
            .from("net_worth_snapshots")
            .upsert(
              {
                user_id: user,
                snapshot_date: mutation.closeDate,
                gross_assets: state.metrics.grossAssets,
                debt: state.metrics.debt,
                net_worth: state.metrics.netWorth,
                data_kind: "ACTUAL",
              },
              { onConflict: "user_id,snapshot_date" },
            )
            .select("id"),
          "photo de patrimoine",
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
        const category = unwrap(
          await db
            .from("expense_categories")
            .insert({
              user_id: user,
              name: mutation.name,
              group_name: mutation.groupName,
              essential: mutation.essentiality === "ESSENTIAL",
              cash_flow_kind: mutation.cashFlowKind,
              essentiality: mutation.essentiality,
              expense_behavior: mutation.behavior,
              archived: false,
            })
            .select("id")
            .single(),
          "création de catégorie",
        ) as Row;
        unwrap(
          await db
            .from("budgets")
            .insert({
              user_id: user,
              category_id: category.id,
              lifestyle: "COMFORTABLE",
              monthly_amount: null,
              data_kind: "MISSING",
              confidence: "UNKNOWN",
              source: "À renseigner",
              effective_date: AS_OF_DATE,
            })
            .select("id"),
          "budget de catégorie",
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
        // Jamais d'écrasement : une clôture existante donne lieu à une version supplémentaire.
        const existing = unwrap(
          await db
            .from("cash_flow_monthly_closes")
            .select("version")
            .eq("user_id", user)
            .eq("month", mutation.month)
            .order("version", { ascending: false })
            .limit(1),
          "lecture de clôture",
        ) as Row[];
        const version = existing.length ? num(existing[0].version) + 1 : 1;
        unwrap(
          await db
            .from("cash_flow_monthly_closes")
            .insert({
              user_id: user,
              month: mutation.month,
              version,
              income: observed.income,
              consumer_expenses: observed.consumerExpenses,
              essential_expenses: observed.essentialExpenses,
              taxes_paid: observed.taxesPaid,
              debt_service_paid: observed.debtServicePaid,
              investment_flows: observed.investmentFlows,
              internal_transfers: observed.internalTransfers,
              operating_surplus_before_debt: observed.operatingCashFlowBeforeDebt,
              post_debt_surplus: observed.cashFlowAfterDebt,
              unclassified_transaction_count: observed.dataQuality.unclassifiedTransactionCount,
            })
            .select("id"),
          "clôture Cash Flow",
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
    const row = unwrap(
      await db
        .from("documents")
        .insert({
          user_id: user,
          name: upload.name,
          category: upload.category,
          storage_path: storagePath,
          size_bytes: upload.size,
          status: "INBOX",
        })
        .select("*")
        .single(),
      "enregistrement de document",
    ) as Row;
    return {
      id: str(row.id),
      name: str(row.name),
      category: str(row.category),
      size: num(row.size_bytes),
      uploadedAt: str(row.uploaded_at),
      status: str(row.status) as DocumentRecord["status"],
    };
  }

  async function saveSimulation(run: SimulationRun): Promise<string> {
    const created = unwrap(
      await db
        .from("simulation_runs")
        .insert({
          user_id: user,
          scenario_id: run.scenarioId,
          seed: run.seed,
          simulations: run.simulations,
          years: run.years,
          methodology: run.methodology,
        })
        .select("id")
        .single(),
      "enregistrement de simulation",
    ) as Row;
    const runId = str(created.id);
    unwrap(
      await db
        .from("simulation_results")
        .insert(
          run.points.map((point) => ({
            user_id: user,
            run_id: runId,
            year: point.year,
            p10: point.p10,
            p25: point.p25,
            p50: point.p50,
            p75: point.p75,
            p90: point.p90,
          })),
        )
        .select("id"),
      "résultats de simulation",
    );
    return runId;
  }

  return { adapter: "supabase", getDashboardState, mutateState, storeDocument, saveSimulation };
}
