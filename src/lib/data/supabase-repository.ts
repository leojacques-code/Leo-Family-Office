import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, ownerId, supabaseAdmin } from "@/lib/data/supabase-client";
import {
  ACCOUNT_TYPE_ORDER,
  ALERT_SEVERITY_ORDER,
  AS_OF_DATE,
  REPORTING_CURRENCY,
  SCENARIO_NAME_ORDER,
  composeDashboardMetrics,
  deriveFlowMetrics,
  ledgerWindowStart,
  readLedgerCoverage,
  readLoanTerms,
} from "@/lib/data/shared";
import { computeObservedCashFlow } from "@/lib/engine/cash-flow";
import { debtCashOut, monthBounds } from "@/lib/engine/debt";
import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import {
  BUSINESS_AMOUNT_SCOPES,
  BUSINESS_BRIDGE_ITEM_CATEGORIES,
  BUSINESS_BRIDGE_STATUSES,
  BUSINESS_CAPITAL_EVENT_TYPES,
  BUSINESS_CAPITAL_HISTORY_SOURCES,
  BUSINESS_DCF_TERMINAL_METHODS,
  BUSINESS_DISCOUNT_CONVENTIONS,
  BUSINESS_EBITDA_ADJUSTMENT_CATEGORIES,
  BUSINESS_METRIC_BASES,
  BUSINESS_PERIOD_KINDS,
  BUSINESS_TYPES,
  BUSINESS_VALUATION_METHODS,
  buildBusinessEquityPortfolio,
  businessEquityBalanceSheetContributions,
  type BusinessBridgeItem,
  type BusinessBridgeDeclaration,
  type BusinessCapitalEvent,
  type BusinessDcfAssumptions,
  type BusinessDcfPeriod,
  type BusinessEbitdaAdjustment,
  type BusinessEntity,
  type BusinessFinancialSnapshot,
  type BusinessHoldingLink,
  type BusinessOwnership,
  type BusinessValuationBasis,
} from "@/lib/engine/business-equity";
import { fundingRoundOutcome } from "@/lib/engine/business-ownership";
import { buildPortfolioLedger } from "@/lib/engine/portfolio";
import { buildPortfolioAnalytics } from "@/lib/engine/portfolio-analytics";
import {
  buildRealEstatePortfolio,
  realEstateBalanceSheetContributions,
} from "@/lib/engine/real-estate";
import { deriveCanonicalBalanceSheetMetrics } from "@/lib/engine/balance-sheet-metrics";
import type { CurrencyRate } from "@/lib/engine/fx";
import {
  buildCareerAnalytics,
  buildCareerMonthlyConsequences,
  type CareerCompensationTerm,
  type CareerEquityGrant,
  type CareerEvent,
  type CareerRole,
  type CareerScenario,
} from "@/lib/engine/career";
import {
  calculateEmploymentTax,
  type TaxObservation,
  type TaxProfile,
  type TaxRule,
  type TaxRuleSet,
} from "@/lib/engine/tax";
import { toCareerTaxCashFlow } from "@/lib/engine/career-tax-cash-flow";
import { buildDashboardEventTimeline } from "@/lib/engine/event-adapters";
import { isScenarioVersionDefinition } from "@/lib/engine/scenario-engine";
import type { ScenarioVersionDefinition } from "@/lib/engine/scenario-contracts";
import {
  enumValue,
  finiteNumber,
  nullableBoolean,
  nullableFiniteNumber,
  requiredField,
} from "@/lib/data/row-validation";
import { readAllPages } from "@/lib/data/pagination";
import type { FamilyOfficeRepository } from "@/lib/data/repository";
import type { DocumentUpload, Mutation, SimulationRun } from "@/lib/data/contracts";
import type {
  Alert,
  AccountBalanceObservation,
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
  PortfolioEnvelopePolicy,
  PortfolioEvent,
  Position,
  Provenance,
  RealEstateAsset,
  RealEstateCapitalEvent,
  RealEstateFinancingLink,
  RealEstateOperatingTerms,
  RealEstateValuation,
  RecurringCashFlowRule,
  Scenario,
  Transaction,
} from "@/lib/types";
import {
  CASH_FLOW_KINDS,
  LEDGER_COVERAGE_SOURCES,
  LOT_MATCHING_METHODS,
  PORTFOLIO_EVENT_TYPES,
  REAL_ESTATE_CAPITAL_EVENT_TYPES,
  REAL_ESTATE_USAGES,
  REAL_ESTATE_VALUATION_METHODS,
} from "@/lib/types";

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

export function mapScenario(row: Row, definition?: ScenarioVersionDefinition): Scenario {
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
    lifecycleStatus: (str(row.scenario_status) || "ACTIVE") as Scenario["lifecycleStatus"],
    archivedAt: row.archived_at ? str(row.archived_at) : null,
    definition,
    provenance: provenance(row),
  };
}

export function validateSimulationRun(run: SimulationRun): void {
  finiteNumber(run.seed, "simulation_runs.seed");
  finiteNumber(run.simulations, "simulation_runs.simulations");
  finiteNumber(run.years, "simulation_runs.years");
  const v2Metadata = [
    run.scenarioVersion,
    run.asOfDate,
    run.baselineReference,
    run.eventSetVersion,
    run.assumptionsSnapshot,
    run.runMode,
    run.horizonMonths,
    run.methodologyVersion,
    run.definitionSnapshot,
  ];
  const v2Count = v2Metadata.filter((value) => value !== undefined).length;
  if (v2Count !== 0 && v2Count !== v2Metadata.length) {
    throw new Error("Supabase donnée invalide (simulation_runs) : métadonnées V2 incomplètes");
  }
  if (v2Count > 0) {
    finiteNumber(run.scenarioVersion, "simulation_runs.scenario_version");
    finiteNumber(run.horizonMonths, "simulation_runs.horizon_months");
    if (!run.definitionSnapshot || !isScenarioVersionDefinition(run.definitionSnapshot)) {
      throw new Error("Supabase donnée invalide (simulation_runs) : snapshot V2 invalide");
    }
  }
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
  /** Lecture intégrale d'une table du propriétaire. Une troncature échoue, elle ne se tait pas. */
  /**
   * Lecture paginée d'une table de l'utilisateur, dans un ordre TOTAL.
   *
   * Une pagination par `range` n'est déterministe que si le tri distingue toutes les
   * lignes : à égalité sur la clé de tri, PostgreSQL peut renvoyer deux pages qui se
   * chevauchent ou qui sautent une ligne, et le ledger serait alors faux sans que rien ne
   * le dise. Le départage se fait donc sur `id`, la clé primaire : elle existe sur toutes
   * les tables et elle est UNIQUE, ce qui garantit un ordre strict.
   *
   * `created_at` remplissait ce rôle auparavant. C'était deux fois insuffisant : la colonne
   * n'est pas unique, donc elle ne garantissait pas l'ordre total qu'on lui demandait, et
   * elle n'existe pas sur toutes les tables paginées — `currency_rates` n'en a pas, ce qui
   * faisait échouer la lecture de l'historique de change et, avec elle, tout le cockpit.
   */
  function fetchAllPages(
    table: string,
    orderColumn: string,
  ): Promise<{ data: Row[] | null; error: PostgrestError | null }> {
    return readAllPages<Row, PostgrestError>(table, async (from, to) => {
      const result = await db
        .from(table)
        .select("*")
        .eq("user_id", user)
        .order(orderColumn, { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (result.data ?? null) as Row[] | null, error: result.error };
    });
  }

  async function fetchLedgerWindow(): Promise<{
    data: Row[] | null;
    error: PostgrestError | null;
  }> {
    const since = ledgerWindowStart(AS_OF_DATE);
    // Même règle que pour le ledger portefeuille : une fenêtre tronquée produirait des
    // agrégats de flux calculés sur un historique amputé, sans que rien ne le signale.
    return readAllPages<Row, PostgrestError>(`transactions depuis ${since}`, async (from, to) => {
      const result = await db
        .from("transactions")
        .select("*")
        .eq("user_id", user)
        .gte("transaction_date", since)
        .order("transaction_date", { ascending: false })
        // Départage sur la clé primaire, pour la même raison que `fetchAllPages` : seule
        // une colonne UNIQUE rend la pagination déterministe. `created_at` ne l'est pas.
        .order("id", { ascending: false })
        .range(from, to);
      return { data: (result.data ?? null) as Row[] | null, error: result.error };
    });
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
      scenarioVersionRows,
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
      portfolioEventRows,
      portfolioPolicyRows,
      propertyRows,
      realEstateValuationRows,
      realEstateCapitalEventRows,
      realEstateOperatingTermRows,
      realEstateFinancingLinkRows,
      businessRows,
      businessOwnershipRows,
      businessFinancialRows,
      businessValuationRows,
      businessCapitalEventRows,
      businessHoldingRows,
      businessEbitdaAdjustmentRows,
      businessBridgeDeclarationRows,
      businessBridgeItemRows,
      businessDcfRows,
      businessDcfPeriodRows,
      careerRoleRows,
      careerCompensationRows,
      careerEventRows,
      careerEquityRows,
      careerScenarioRows,
      taxProfileRows,
      taxRuleSetRows,
      taxRuleRows,
      taxObservationRows,
    ] = await Promise.all([
      mine("institutions"),
      mine("financial_accounts"),
      fetchAllPages("account_balances", "balance_date"),
      mine("asset_classes"),
      mine("securities"),
      mine("positions"),
      fetchAllPages("position_snapshots", "snapshot_date"),
      mine("liabilities"),
      mine("income_sources"),
      mine("expense_categories"),
      mine("budgets"),
      fetchLedgerWindow(),
      mine("scenarios"),
      mine("scenario_versions"),
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
      fetchAllPages("currency_rates", "rate_date"),
      mine("net_worth_snapshots"),
      mine("liability_balance_observations"),
      fetchAllPages("portfolio_events", "event_date"),
      mine("portfolio_envelope_policies"),
      mine("properties"),
      fetchAllPages("real_estate_valuations", "valued_at"),
      fetchAllPages("real_estate_capital_events", "event_date"),
      fetchAllPages("real_estate_operating_terms", "effective_from"),
      mine("real_estate_financing_links"),
      mine("businesses"),
      fetchAllPages("business_ownership", "effective_date"),
      fetchAllPages("business_financials", "period_end"),
      fetchAllPages("business_valuations", "valuation_date"),
      fetchAllPages("business_capital_events", "event_date"),
      fetchAllPages("business_holdings", "effective_date"),
      fetchAllPages("business_ebitda_adjustments", "period_end"),
      fetchAllPages("business_bridge_declarations", "effective_date"),
      fetchAllPages("business_bridge_items", "effective_date"),
      fetchAllPages("business_dcf_assumptions", "valuation_date"),
      mine("business_dcf_periods"),
      fetchAllPages("career_roles", "start_date"),
      fetchAllPages("career_compensation_terms", "effective_from"),
      fetchAllPages("career_events", "event_date"),
      fetchAllPages("career_equity_grants", "grant_date"),
      fetchAllPages("career_scenarios", "effective_from"),
      fetchAllPages("tax_profiles", "effective_from"),
      fetchAllPages("tax_rule_sets", "effective_from"),
      mine("tax_rules"),
      fetchAllPages("tax_observations", "observed_date"),
    ]).then((results) =>
      results.map((result, index) => unwrap(result, `lecture #${index}`) as Row[]),
    );

    const institutionNames = new Map(institutionRows.map((row) => [str(row.id), str(row.name)]));
    const latestBalances = latestBy(balanceRows, "account_id", "balance_date");
    const accountBalanceHistory: AccountBalanceObservation[] = balanceRows
      .map((row) => {
        const context = `account_balances[id=${str(row.id)}]`;
        return {
          id: str(row.id),
          accountId: str(row.account_id),
          balance: finiteNumber(row.balance, `${context}.balance`),
          balanceDate: str(row.balance_date),
          createdAt: str(row.created_at),
          provenance: provenance(row),
        };
      })
      .sort(
        (left, right) =>
          left.balanceDate.localeCompare(right.balanceDate) ||
          left.createdAt.localeCompare(right.createdAt),
      );
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
          securityId: str(row.security_id),
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

    const assetClassOfSecurity = (securityId: string): string | null => {
      const security = securities.get(securityId);
      if (!security) return null;
      return assetClassNames.get(str(security.asset_class_id)) ?? null;
    };
    const portfolioEvents: PortfolioEvent[] = portfolioEventRows.map((row) => {
      const context = `portfolio_events[id=${str(row.id)}]`;
      const securityId = row.security_id ? str(row.security_id) : null;
      const security = securityId ? securities.get(securityId) : undefined;
      return {
        id: str(row.id),
        accountId: str(row.account_id),
        securityId,
        securityName: security ? str(security.name) : null,
        ticker: security ? (optional(security.ticker) ?? null) : null,
        assetClass: securityId ? assetClassOfSecurity(securityId) : null,
        type: enumValue(
          requiredField(row, "event_type", context),
          PORTFOLIO_EVENT_TYPES,
          `${context}.event_type`,
        ) as PortfolioEvent["type"],
        eventDate: str(row.event_date),
        settlementDate: row.settlement_date ? str(row.settlement_date) : null,
        quantity: nullableFiniteNumber(row.quantity, `${context}.quantity`),
        unitPrice: nullableFiniteNumber(row.unit_price, `${context}.unit_price`),
        grossAmount: nullableFiniteNumber(row.gross_amount, `${context}.gross_amount`),
        feeAmount: nullableFiniteNumber(row.fee_amount, `${context}.fee_amount`),
        taxAmount: nullableFiniteNumber(row.tax_amount, `${context}.tax_amount`),
        envelopeCashAmount: nullableFiniteNumber(
          row.envelope_cash_amount,
          `${context}.envelope_cash_amount`,
        ),
        currency: str(row.currency),
        counterpartyAccountId: row.counterparty_account_id
          ? str(row.counterparty_account_id)
          : null,
        transactionId: row.transaction_id ? str(row.transaction_id) : null,
        matchedAcquisitionEventId: row.matched_acquisition_event_id
          ? str(row.matched_acquisition_event_id)
          : null,
        externalReference: row.external_reference ? str(row.external_reference) : null,
        provenance: provenance(row),
      };
    });

    const portfolioPolicies: PortfolioEnvelopePolicy[] = portfolioPolicyRows.map((row) => {
      const context = `portfolio_envelope_policies[id=${str(row.id)}]`;
      return {
        id: str(row.id),
        accountId: str(row.account_id),
        // `null` reste `null` : une convention non déclarée n'est pas une convention par
        // défaut, et une profondeur non déclarée n'est pas « depuis toujours ».
        lotMatchingMethod: row.lot_matching_method
          ? (enumValue(
              str(row.lot_matching_method),
              LOT_MATCHING_METHODS,
              `${context}.lot_matching_method`,
            ) as PortfolioEnvelopePolicy["lotMatchingMethod"])
          : null,
        ledgerCoverageStart: row.ledger_coverage_start ? str(row.ledger_coverage_start) : null,
        ledgerCoverageSource: row.ledger_coverage_source
          ? (enumValue(
              str(row.ledger_coverage_source),
              LEDGER_COVERAGE_SOURCES,
              `${context}.ledger_coverage_source`,
            ) as PortfolioEnvelopePolicy["ledgerCoverageSource"])
          : null,
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      };
    });

    // ── Domaine immobilier ───────────────────────────────────────────────────────────
    // Quatre familles de faits, aucune valeur par défaut. Un `null` lu en base reste un
    // `null` en mémoire : c'est le moteur qui dira ce qu'il ne peut pas calculer, pas le
    // mapping qui comblera le trou.
    const realEstateAssets: RealEstateAsset[] = propertyRows
      .filter((row) => row.archived !== true)
      .map((row) => {
        const context = `properties[id=${str(row.id)}]`;
        return {
          id: str(row.id),
          name: str(row.name),
          location: row.location ? str(row.location) : null,
          surfaceSqm: nullableFiniteNumber(row.surface_sqm ?? null, `${context}.surface_sqm`),
          usage: row.property_usage
            ? (enumValue(
                str(row.property_usage),
                REAL_ESTATE_USAGES,
                `${context}.property_usage`,
              ) as RealEstateAsset["usage"])
            : null,
          ownershipShare: nullableFiniteNumber(
            row.ownership_share ?? null,
            `${context}.ownership_share`,
          ),
          // Tri-état lu tel quel : `null` reste « non déclaré ». Le convertir en `false`
          // ferait passer un crédit non encore saisi pour un achat comptant.
          isDebtFinanced: nullableBoolean(row.debt_financed ?? null, `${context}.debt_financed`),
          acquisitionDate: row.acquisition_date ? str(row.acquisition_date) : null,
          disposalDate: row.disposal_date ? str(row.disposal_date) : null,
          archived: bool(row.archived),
          notes: row.notes ? str(row.notes) : null,
          provenance: provenance(row),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    const realEstateAssetIds = new Set(realEstateAssets.map((asset) => asset.id));
    /** Un fait orphelin appartient à un bien archivé : il est ignoré, jamais rattaché ailleurs. */
    const ownedByLiveAsset = (row: Row) => realEstateAssetIds.has(str(row.property_id));

    const realEstateValuations: RealEstateValuation[] = realEstateValuationRows
      .filter(ownedByLiveAsset)
      .map((row) => {
        const context = `real_estate_valuations[id=${str(row.id)}]`;
        return {
          id: str(row.id),
          propertyId: str(row.property_id),
          valuedAt: str(row.valued_at),
          value: finiteNumber(row.value, `${context}.value`),
          currency: str(row.currency).toUpperCase(),
          method: enumValue(
            str(row.valuation_method),
            REAL_ESTATE_VALUATION_METHODS,
            `${context}.valuation_method`,
          ),
          notes: row.notes ? str(row.notes) : null,
          provenance: provenance(row),
        };
      })
      .sort(
        (left, right) =>
          left.valuedAt.localeCompare(right.valuedAt) || left.id.localeCompare(right.id),
      );

    const realEstateCapitalEvents: RealEstateCapitalEvent[] = realEstateCapitalEventRows
      .filter(ownedByLiveAsset)
      .map((row) => {
        const context = `real_estate_capital_events[id=${str(row.id)}]`;
        return {
          id: str(row.id),
          propertyId: str(row.property_id),
          type: enumValue(
            str(row.event_type),
            REAL_ESTATE_CAPITAL_EVENT_TYPES,
            `${context}.event_type`,
          ),
          eventDate: str(row.event_date),
          amount: finiteNumber(row.amount, `${context}.amount`),
          currency: str(row.currency).toUpperCase(),
          label: row.label ? str(row.label) : null,
          transactionId: row.transaction_id ? str(row.transaction_id) : null,
          notes: row.notes ? str(row.notes) : null,
          provenance: provenance(row),
        };
      })
      .sort(
        (left, right) =>
          left.eventDate.localeCompare(right.eventDate) || left.id.localeCompare(right.id),
      );

    const realEstateOperatingTerms: RealEstateOperatingTerms[] = realEstateOperatingTermRows
      .filter(ownedByLiveAsset)
      .map((row) => {
        const context = `real_estate_operating_terms[id=${str(row.id)}]`;
        const amount = (field: string) =>
          nullableFiniteNumber(row[field] ?? null, `${context}.${field}`);
        return {
          id: str(row.id),
          propertyId: str(row.property_id),
          effectiveFrom: str(row.effective_from),
          currency: str(row.currency).toUpperCase(),
          annualGrossRent: amount("annual_gross_rent"),
          vacancyRate: amount("vacancy_rate"),
          annualOperatingCharges: amount("annual_operating_charges"),
          annualPropertyTax: amount("annual_property_tax"),
          annualInsurance: amount("annual_insurance"),
          annualMaintenance: amount("annual_maintenance"),
          annualManagementFees: amount("annual_management_fees"),
          managementFeeRate: amount("management_fee_rate"),
          annualOtherCosts: amount("annual_other_costs"),
          effectiveIncomeTaxRate: amount("effective_income_tax_rate"),
          notes: row.notes ? str(row.notes) : null,
          provenance: provenance(row),
        };
      })
      .sort(
        (left, right) =>
          left.effectiveFrom.localeCompare(right.effectiveFrom) || left.id.localeCompare(right.id),
      );

    const realEstateFinancingLinks: RealEstateFinancingLink[] = realEstateFinancingLinkRows
      .filter(ownedByLiveAsset)
      .map((row) => {
        const context = `real_estate_financing_links[id=${str(row.id)}]`;
        return {
          id: str(row.id),
          propertyId: str(row.property_id),
          liabilityId: str(row.liability_id),
          allocationShare: finiteNumber(row.allocation_share, `${context}.allocation_share`),
          notes: row.notes ? str(row.notes) : null,
          provenance: provenance(row),
        };
      });

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
      // Rattachement immobilier : une ATTRIBUTION, pas une reclassification. La nature
      // canonique du flux reste celle de sa catégorie ou de son override.
      propertyId: requiredField(row, "property_id", `transactions[id=${str(row.id)}]`)
        ? str(row.property_id)
        : null,
      notes: row.notes ? str(row.notes) : null,
      provenance: provenance(row),
    }));

    const currentScenarioVersions = new Map<string, ScenarioVersionDefinition>();
    for (const row of scenarioVersionRows) {
      const scenario = scenarioRows.find((item) => str(item.id) === str(row.scenario_id));
      if (
        scenario &&
        finiteNumber(row.version, `scenario_versions[id=${str(row.id)}].version`) ===
          finiteNumber(
            scenario.current_version,
            `scenarios[id=${str(scenario.id)}].current_version`,
          ) &&
        isScenarioVersionDefinition(row.payload)
      ) {
        currentScenarioVersions.set(str(row.scenario_id), row.payload);
      }
    }
    const scenarios: Scenario[] = scenarioRows
      .map((row) => mapScenario(row, currentScenarioVersions.get(str(row.id))))
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

    const businesses: BusinessEntity[] = businessRows
      .filter((row) => row.archived !== true)
      .map((row) => ({
        id: str(row.id),
        name: str(row.name),
        legalForm: row.legal_form ? str(row.legal_form) : null,
        type: row.business_type
          ? enumValue(
              str(row.business_type),
              BUSINESS_TYPES,
              `businesses[id=${str(row.id)}].business_type`,
            )
          : null,
        functionalCurrency: row.functional_currency
          ? str(row.functional_currency).toUpperCase()
          : null,
        sector: row.sector ? str(row.sector) : null,
        country: row.country ? str(row.country).toUpperCase() : null,
        foundedOn: row.founded_on ? str(row.founded_on) : null,
        capitalHistoryStart: row.capital_history_start ? str(row.capital_history_start) : null,
        capitalHistorySource: enumValue(
          str(row.capital_history_source || "UNKNOWN"),
          BUSINESS_CAPITAL_HISTORY_SOURCES,
          `businesses[id=${str(row.id)}].capital_history_source`,
        ),
        archived: bool(row.archived),
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const businessIds = new Set(businesses.map((business) => business.id));
    const businessOwnership: BusinessOwnership[] = businessOwnershipRows
      .filter((row) => businessIds.has(str(row.business_id)))
      .map((row) => ({
        id: str(row.id),
        businessId: str(row.business_id),
        effectiveDate: str(row.effective_date),
        legalRate: finiteNumber(
          row.ownership_rate,
          `business_ownership[id=${str(row.id)}].ownership_rate`,
        ),
        economicRate: nullableFiniteNumber(
          row.economic_rate,
          `business_ownership[id=${str(row.id)}].economic_rate`,
        ),
        votingRate: nullableFiniteNumber(
          row.voting_rate,
          `business_ownership[id=${str(row.id)}].voting_rate`,
        ),
        fullyDilutedRate: nullableFiniteNumber(
          row.fully_diluted_rate,
          `business_ownership[id=${str(row.id)}].fully_diluted_rate`,
        ),
        sharesHeld: nullableFiniteNumber(
          row.shares_held,
          `business_ownership[id=${str(row.id)}].shares_held`,
        ),
        sharesOutstanding: nullableFiniteNumber(
          row.shares_outstanding,
          `business_ownership[id=${str(row.id)}].shares_outstanding`,
        ),
        fullyDilutedShares: nullableFiniteNumber(
          row.fully_diluted_shares,
          `business_ownership[id=${str(row.id)}].fully_diluted_shares`,
        ),
        shareClass: row.share_class ? str(row.share_class) : null,
        originEventId: row.origin_event_id ? str(row.origin_event_id) : null,
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }));
    const businessFinancials: BusinessFinancialSnapshot[] = businessFinancialRows
      .filter((row) => businessIds.has(str(row.business_id)))
      .map((row) => ({
        id: str(row.id),
        businessId: str(row.business_id),
        periodEnd: str(row.period_end),
        periodStart: row.period_start ? str(row.period_start) : null,
        periodKind: enumValue(
          str(row.period_kind || "ANNUAL"),
          BUSINESS_PERIOD_KINDS,
          `business_financials[id=${str(row.id)}].period_kind`,
        ),
        periodLabel: row.period_label ? str(row.period_label) : null,
        currency: row.currency ? str(row.currency).toUpperCase() : null,
        revenue: nullableFiniteNumber(
          row.revenue,
          `business_financials[id=${str(row.id)}].revenue`,
        ),
        grossProfit: nullableFiniteNumber(
          row.gross_profit,
          `business_financials[id=${str(row.id)}].gross_profit`,
        ),
        ebitda: nullableFiniteNumber(row.ebitda, `business_financials[id=${str(row.id)}].ebitda`),
        ebit: nullableFiniteNumber(row.ebit, `business_financials[id=${str(row.id)}].ebit`),
        netIncome: nullableFiniteNumber(
          row.net_income,
          `business_financials[id=${str(row.id)}].net_income`,
        ),
        cash: nullableFiniteNumber(row.cash, `business_financials[id=${str(row.id)}].cash`),
        grossDebt: nullableFiniteNumber(row.debt, `business_financials[id=${str(row.id)}].debt`),
        workingCapital: nullableFiniteNumber(
          row.working_capital,
          `business_financials[id=${str(row.id)}].working_capital`,
        ),
        capex: nullableFiniteNumber(row.capex, `business_financials[id=${str(row.id)}].capex`),
        depreciationAmortisation: nullableFiniteNumber(
          row.depreciation_amortisation,
          `business_financials[id=${str(row.id)}].depreciation_amortisation`,
        ),
        interestExpense: nullableFiniteNumber(
          row.interest_expense,
          `business_financials[id=${str(row.id)}].interest_expense`,
        ),
        taxExpense: nullableFiniteNumber(
          row.tax_expense,
          `business_financials[id=${str(row.id)}].tax_expense`,
        ),
        freeCashFlow: nullableFiniteNumber(
          row.free_cash_flow,
          `business_financials[id=${str(row.id)}].free_cash_flow`,
        ),
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }));
    const businessValuations: BusinessValuationBasis[] = businessValuationRows
      .filter((row) => businessIds.has(str(row.business_id)))
      .map((row) => ({
        id: str(row.id),
        businessId: str(row.business_id),
        valuationDate: str(row.valuation_date),
        currency: row.currency ? str(row.currency).toUpperCase() : null,
        method: enumValue(
          str(row.method),
          BUSINESS_VALUATION_METHODS,
          `business_valuations[id=${str(row.id)}].method`,
        ),
        enterpriseValue: nullableFiniteNumber(
          row.enterprise_value,
          `business_valuations[id=${str(row.id)}].enterprise_value`,
        ),
        equityValue: nullableFiniteNumber(
          row.equity_value,
          `business_valuations[id=${str(row.id)}].equity_value`,
        ),
        multiple: nullableFiniteNumber(
          row.valuation_multiple,
          `business_valuations[id=${str(row.id)}].valuation_multiple`,
        ),
        multipleLow: nullableFiniteNumber(
          row.multiple_low,
          `business_valuations[id=${str(row.id)}].multiple_low`,
        ),
        multipleHigh: nullableFiniteNumber(
          row.multiple_high,
          `business_valuations[id=${str(row.id)}].multiple_high`,
        ),
        metricBasis: row.metric_basis
          ? enumValue(
              str(row.metric_basis),
              BUSINESS_METRIC_BASES,
              `business_valuations[id=${str(row.id)}].metric_basis`,
            )
          : null,
        metricPeriodEnd: row.metric_period_end ? str(row.metric_period_end) : null,
        preMoneyEquityValue: nullableFiniteNumber(
          row.pre_money_equity_value,
          `business_valuations[id=${str(row.id)}].pre_money_equity_value`,
        ),
        primaryNewMoney: nullableFiniteNumber(
          row.primary_new_money,
          `business_valuations[id=${str(row.id)}].primary_new_money`,
        ),
        secondaryAmount: nullableFiniteNumber(
          row.secondary_amount,
          `business_valuations[id=${str(row.id)}].secondary_amount`,
        ),
        investorContribution: nullableFiniteNumber(
          row.investor_contribution,
          `business_valuations[id=${str(row.id)}].investor_contribution`,
        ),
        preferredRightsKnown: nullableBoolean(
          row.preferred_rights_known ?? null,
          `business_valuations[id=${str(row.id)}].preferred_rights_known`,
        ),
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }));
    const businessEbitdaAdjustments: BusinessEbitdaAdjustment[] = businessEbitdaAdjustmentRows
      .filter((row) => businessIds.has(str(row.business_id)))
      .map((row) => ({
        id: str(row.id),
        businessId: str(row.business_id),
        periodEnd: str(row.period_end),
        category: enumValue(
          str(row.category),
          BUSINESS_EBITDA_ADJUSTMENT_CATEGORIES,
          `business_ebitda_adjustments[id=${str(row.id)}].category`,
        ),
        label: str(row.label),
        amount: finiteNumber(row.amount, `business_ebitda_adjustments[id=${str(row.id)}].amount`),
        currency: str(row.currency).toUpperCase(),
        recurring: bool(row.recurring),
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }));
    const businessBridgeItems: BusinessBridgeItem[] = businessBridgeItemRows
      .filter((row) => businessIds.has(str(row.business_id)))
      .map((row) => ({
        id: str(row.id),
        businessId: str(row.business_id),
        effectiveDate: str(row.effective_date),
        category: enumValue(
          str(row.category),
          BUSINESS_BRIDGE_ITEM_CATEGORIES,
          `business_bridge_items[id=${str(row.id)}].category`,
        ),
        label: str(row.label),
        amount: finiteNumber(row.amount, `business_bridge_items[id=${str(row.id)}].amount`),
        currency: str(row.currency).toUpperCase(),
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }));
    const businessBridgeDeclarations: BusinessBridgeDeclaration[] = businessBridgeDeclarationRows
      .filter((row) => businessIds.has(str(row.business_id)))
      .map((row) => ({
        id: str(row.id),
        businessId: str(row.business_id),
        effectiveDate: str(row.effective_date),
        status: enumValue(
          str(row.status),
          BUSINESS_BRIDGE_STATUSES,
          `business_bridge_declarations[id=${str(row.id)}].status`,
        ),
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }));
    const businessDcfPeriods: BusinessDcfPeriod[] = businessDcfPeriodRows.map((row) => ({
      id: str(row.id),
      dcfId: str(row.dcf_id),
      yearIndex: finiteNumber(row.year_index, `business_dcf_periods[id=${str(row.id)}].year_index`),
      revenue: nullableFiniteNumber(row.revenue, `business_dcf_periods[id=${str(row.id)}].revenue`),
      ebitda: nullableFiniteNumber(row.ebitda, `business_dcf_periods[id=${str(row.id)}].ebitda`),
      ebit: nullableFiniteNumber(row.ebit, `business_dcf_periods[id=${str(row.id)}].ebit`),
      depreciationAmortisation: nullableFiniteNumber(
        row.depreciation_amortisation,
        `business_dcf_periods[id=${str(row.id)}].depreciation_amortisation`,
      ),
      capex: nullableFiniteNumber(row.capex, `business_dcf_periods[id=${str(row.id)}].capex`),
      workingCapitalChange: nullableFiniteNumber(
        row.working_capital_change,
        `business_dcf_periods[id=${str(row.id)}].working_capital_change`,
      ),
      notes: row.notes ? str(row.notes) : null,
    }));
    const businessDcfAssumptions: BusinessDcfAssumptions[] = businessDcfRows
      .filter((row) => businessIds.has(str(row.business_id)))
      .map((row) => ({
        id: str(row.id),
        businessId: str(row.business_id),
        valuationDate: str(row.valuation_date),
        currency: str(row.currency).toUpperCase(),
        wacc: finiteNumber(row.wacc, `business_dcf_assumptions[id=${str(row.id)}].wacc`),
        taxRate: finiteNumber(row.tax_rate, `business_dcf_assumptions[id=${str(row.id)}].tax_rate`),
        terminalMethod: enumValue(
          str(row.terminal_method),
          BUSINESS_DCF_TERMINAL_METHODS,
          `business_dcf_assumptions[id=${str(row.id)}].terminal_method`,
        ),
        terminalGrowth: nullableFiniteNumber(
          row.terminal_growth,
          `business_dcf_assumptions[id=${str(row.id)}].terminal_growth`,
        ),
        terminalExitMultiple: nullableFiniteNumber(
          row.terminal_exit_multiple,
          `business_dcf_assumptions[id=${str(row.id)}].terminal_exit_multiple`,
        ),
        terminalExitMetric: row.terminal_exit_metric
          ? (str(row.terminal_exit_metric) as "EBITDA" | "EBIT")
          : null,
        discountConvention: enumValue(
          str(row.discount_convention || "YEAR_END"),
          BUSINESS_DISCOUNT_CONVENTIONS,
          `business_dcf_assumptions[id=${str(row.id)}].discount_convention`,
        ),
        periods: businessDcfPeriods
          .filter((period) => period.dcfId === str(row.id))
          .sort((left, right) => left.yearIndex - right.yearIndex),
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }));
    const businessCapitalEvents: BusinessCapitalEvent[] = businessCapitalEventRows
      .filter((row) => businessIds.has(str(row.business_id)))
      .map((row) => ({
        id: str(row.id),
        businessId: str(row.business_id),
        type: enumValue(
          str(row.event_type),
          BUSINESS_CAPITAL_EVENT_TYPES,
          `business_capital_events[id=${str(row.id)}].event_type`,
        ),
        eventDate: str(row.event_date),
        amount: finiteNumber(row.amount, `business_capital_events[id=${str(row.id)}].amount`),
        amountScope: enumValue(
          str(row.amount_scope || "USER_CASH"),
          BUSINESS_AMOUNT_SCOPES,
          `business_capital_events[id=${str(row.id)}].amount_scope`,
        ),
        fees: nullableFiniteNumber(row.fees, `business_capital_events[id=${str(row.id)}].fees`),
        currency: str(row.currency).toUpperCase(),
        ownershipDelta: nullableFiniteNumber(
          row.ownership_delta,
          `business_capital_events[id=${str(row.id)}].ownership_delta`,
        ),
        ownershipRateAfter: nullableFiniteNumber(
          row.ownership_rate_after,
          `business_capital_events[id=${str(row.id)}].ownership_rate_after`,
        ),
        sharesDelta: nullableFiniteNumber(
          row.shares_delta,
          `business_capital_events[id=${str(row.id)}].shares_delta`,
        ),
        pricePerShare: nullableFiniteNumber(
          row.price_per_share,
          `business_capital_events[id=${str(row.id)}].price_per_share`,
        ),
        label: row.label ? str(row.label) : null,
        transactionId: row.transaction_id ? str(row.transaction_id) : null,
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }));
    const businessHoldings: BusinessHoldingLink[] = businessHoldingRows
      .filter(
        (row) =>
          businessIds.has(str(row.parent_business_id)) &&
          businessIds.has(str(row.child_business_id)),
      )
      .map((row) => ({
        id: str(row.id),
        parentBusinessId: str(row.parent_business_id),
        childBusinessId: str(row.child_business_id),
        effectiveDate: str(row.effective_date),
        ownershipRate: finiteNumber(
          row.ownership_rate,
          `business_holdings[id=${str(row.id)}].ownership_rate`,
        ),
        notes: row.notes ? str(row.notes) : null,
        provenance: provenance(row),
      }));

    const coverage = readLedgerCoverage(profileRows[0]);
    const reportingCurrency = str(profileRows[0]?.reporting_currency || REPORTING_CURRENCY);
    const careerRoles: CareerRole[] = careerRoleRows.map((row) => ({
      id: str(row.id),
      employer: row.employer ? str(row.employer) : null,
      jobTitle: row.job_title ? str(row.job_title) : null,
      employmentType: str(row.employment_type) as CareerRole["employmentType"],
      industry: row.industry ? str(row.industry) : null,
      country: row.country ? str(row.country) : null,
      currency: str(row.currency).toUpperCase(),
      startDate: str(row.start_date),
      endDate: row.end_date ? str(row.end_date) : null,
      status: str(row.status) as CareerRole["status"],
      dataKind: str(row.data_kind) as CareerRole["dataKind"],
      confidence: str(row.confidence) as CareerRole["confidence"],
      source: row.source ? str(row.source) : null,
      notes: row.notes ? str(row.notes) : null,
    }));
    const careerCompensationTerms: CareerCompensationTerm[] = careerCompensationRows.map((row) => {
      const amount = (name: string) =>
        nullableFiniteNumber(row[name], `career_compensation_terms[id=${str(row.id)}].${name}`);
      return {
        id: str(row.id),
        roleId: str(row.role_id),
        baseSalary: amount("base_salary"),
        frequency: str(row.frequency) as CareerCompensationTerm["frequency"],
        guaranteedBonus: amount("guaranteed_bonus"),
        targetBonus: amount("target_bonus"),
        targetBonusRate: amount("target_bonus_rate"),
        discretionaryBonus: amount("discretionary_bonus"),
        commissions: amount("commissions"),
        profitSharing: amount("profit_sharing"),
        participation: amount("participation"),
        employerBenefits: amount("employer_benefits"),
        allowances: amount("allowances"),
        otherTaxableCompensation: amount("other_taxable_compensation"),
        otherNonTaxableCompensation: amount("other_non_taxable_compensation"),
        workingTime: amount("working_time"),
        effectiveFrom: str(row.effective_from),
        effectiveTo: row.effective_to ? str(row.effective_to) : null,
        dataKind: str(row.data_kind) as CareerCompensationTerm["dataKind"],
        confidence: str(row.confidence) as CareerCompensationTerm["confidence"],
        source: row.source ? str(row.source) : null,
      };
    });
    const careerEvents: CareerEvent[] = careerEventRows.map((row) => ({
      id: str(row.id),
      roleId: row.role_id ? str(row.role_id) : null,
      type: str(row.event_type) as CareerEvent["type"],
      eventDate: str(row.event_date),
      amount: nullableFiniteNumber(row.amount, `career_events[id=${str(row.id)}].amount`),
      currency: row.currency ? str(row.currency).toUpperCase() : null,
      variableState: row.variable_state
        ? (str(row.variable_state) as CareerEvent["variableState"])
        : null,
      paidDate: row.paid_date ? str(row.paid_date) : null,
      label: row.label ? str(row.label) : null,
      notes: row.notes ? str(row.notes) : null,
      dataKind: str(row.data_kind) as CareerEvent["dataKind"],
      confidence: str(row.confidence) as CareerEvent["confidence"],
      source: row.source ? str(row.source) : null,
    }));
    const careerEquityGrants: CareerEquityGrant[] = careerEquityRows.map((row) => ({
      id: str(row.id),
      roleId: row.role_id ? str(row.role_id) : null,
      company: str(row.company),
      instrumentType: str(row.instrument_type) as CareerEquityGrant["instrumentType"],
      grantDate: str(row.grant_date),
      quantity: nullableFiniteNumber(
        row.quantity,
        `career_equity_grants[id=${str(row.id)}].quantity`,
      ),
      strikePrice: nullableFiniteNumber(
        row.strike_price,
        `career_equity_grants[id=${str(row.id)}].strike_price`,
      ),
      currency: row.currency ? str(row.currency).toUpperCase() : null,
      vestingSchedule: row.vesting_schedule,
      expiryDate: row.expiry_date ? str(row.expiry_date) : null,
      liquidityStatus: str(row.liquidity_status) as CareerEquityGrant["liquidityStatus"],
      dataKind: str(row.data_kind) as CareerEquityGrant["dataKind"],
      confidence: str(row.confidence) as CareerEquityGrant["confidence"],
      source: row.source ? str(row.source) : null,
    }));
    const careerScenarios: CareerScenario[] = careerScenarioRows.map((row) => ({
      id: str(row.id),
      name: str(row.name),
      type: str(row.scenario_type) as CareerScenario["type"],
      effectiveFrom: str(row.effective_from),
      roleId: row.role_id ? str(row.role_id) : null,
      assumptions: (row.assumptions ?? {}) as Record<string, unknown>,
      dataKind: str(row.data_kind) as CareerScenario["dataKind"],
      confidence: str(row.confidence) as CareerScenario["confidence"],
      source: row.source ? str(row.source) : null,
    }));
    const taxProfiles: TaxProfile[] = taxProfileRows.map((row) => ({
      id: str(row.id),
      jurisdiction: str(row.jurisdiction || row.residency_country),
      residencyCountry: str(row.residency_country),
      householdStatus: row.household_status ? str(row.household_status) : null,
      maritalStatus: row.marital_status ? str(row.marital_status) : null,
      dependants: nullableFiniteNumber(
        row.dependants,
        `tax_profiles[id=${str(row.id)}].dependants`,
      ),
      taxShares: nullableFiniteNumber(row.tax_shares, `tax_profiles[id=${str(row.id)}].tax_shares`),
      withholdingSettings: (row.withholding_settings ?? {}) as Record<string, unknown>,
      socialContributionRegime: row.social_contribution_regime
        ? str(row.social_contribution_regime)
        : null,
      professionalStatus: row.professional_status ? str(row.professional_status) : null,
      specialRegime: row.special_regime ? str(row.special_regime) : null,
      effectiveFrom: str(row.effective_from),
      effectiveTo: row.effective_to ? str(row.effective_to) : null,
      source: row.source ? str(row.source) : null,
      confidence: str(row.confidence) as TaxProfile["confidence"],
    }));
    const taxRuleSets: TaxRuleSet[] = taxRuleSetRows.map((row) => ({
      id: str(row.id),
      jurisdiction: str(row.jurisdiction),
      taxYear: finiteNumber(row.tax_year, `tax_rule_sets[id=${str(row.id)}].tax_year`),
      name: str(row.name),
      effectiveFrom: str(row.effective_from),
      effectiveTo: row.effective_to ? str(row.effective_to) : null,
      source: str(row.source),
      sourceDate: str(row.source_date),
      confidence: str(row.confidence) as TaxRuleSet["confidence"],
      status: str(row.status) as TaxRuleSet["status"],
      legalReference: row.legal_reference ? str(row.legal_reference) : null,
    }));
    const taxRules: TaxRule[] = taxRuleRows
      .filter((row) => row.rule_set_id && row.tax_type)
      .map((row) => ({
        id: str(row.id),
        ruleSetId: str(row.rule_set_id),
        taxType: str(row.tax_type) as TaxRule["taxType"],
        category: str(row.income_category) as TaxRule["category"],
        parameters: row.rule as TaxRule["parameters"],
        effectiveFrom: str(row.effective_from),
        effectiveTo: row.effective_to ? str(row.effective_to) : null,
        source: str(row.source),
        sourceDate: str(row.source_date),
        confidence: str(row.confidence) as TaxRule["confidence"],
      }));
    const taxObservations: TaxObservation[] = taxObservationRows.map((row) => ({
      id: str(row.id),
      type: str(row.observation_type) as TaxObservation["type"],
      observedDate: str(row.observed_date),
      taxYear: finiteNumber(row.tax_year, `tax_observations[id=${str(row.id)}].tax_year`),
      amount: finiteNumber(row.amount, `tax_observations[id=${str(row.id)}].amount`),
      currency: str(row.currency).toUpperCase(),
      transactionId: row.transaction_id ? str(row.transaction_id) : null,
      source: row.source ? str(row.source) : null,
      confidence: str(row.confidence) as TaxObservation["confidence"],
    }));
    const taxYear = Number(AS_OF_DATE.slice(0, 4));
    const careerMonthly = buildCareerMonthlyConsequences({
      roles: careerRoles,
      terms: careerCompensationTerms,
      events: careerEvents,
      startDate: `${taxYear}-01-01`,
      endDate: `${taxYear + 1}-12-31`,
      reportingCurrency,
      currencyRates,
    });
    const careerAnalytics = buildCareerAnalytics({
      consequences: careerMonthly,
      asOfDate: AS_OF_DATE,
    });
    const activeTaxProfile =
      taxProfiles
        .filter(
          (item) =>
            item.effectiveFrom <= AS_OF_DATE &&
            (item.effectiveTo === null || item.effectiveTo >= AS_OF_DATE),
        )
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
    const activeRuleSet =
      taxRuleSets
        .filter(
          (item) =>
            item.taxYear === taxYear &&
            item.effectiveFrom <= AS_OF_DATE &&
            (item.effectiveTo === null || item.effectiveTo >= AS_OF_DATE),
        )
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
    const taxCalculation = calculateEmploymentTax({
      income: careerMonthly,
      profile: activeTaxProfile,
      ruleSet: activeRuleSet,
      rules: taxRules,
      observations: taxObservations,
      taxYear,
      currency: reportingCurrency,
    });
    const careerTaxMonthly = toCareerTaxCashFlow({
      tax: taxCalculation.monthly,
      transactions,
      categories: expenseCategories,
    });
    // Le domaine immobilier est dérivé AVANT le bilan : il en produit les lignes d'actif.
    // Il ne produit AUCUNE ligne de passif : la dette immobilière est déjà portée par
    // `liabilities`, et le bilan la lit là. En émettre une ici la compterait deux fois.
    const realEstate = buildRealEstatePortfolio({
      asOfDate: AS_OF_DATE,
      reportingCurrency,
      assets: realEstateAssets,
      valuations: realEstateValuations,
      capitalEvents: realEstateCapitalEvents,
      operatingTerms: realEstateOperatingTerms,
      financingLinks: realEstateFinancingLinks,
      liabilities,
      transactions,
      expenseCategories,
      ledgerCoverageStart: coverage.start,
      currencyRates,
    });
    // Business Equity V2.1 : le moteur reçoit des FAITS et des HYPOTHÈSES, et dérive
    // lui-même valorisation, pont EV → Equity, fourchette et performance. Aucune valeur
    // dérivée n'a transité par la base.
    const businessEquity = buildBusinessEquityPortfolio({
      asOfDate: AS_OF_DATE,
      reportingCurrency,
      businesses,
      ownership: businessOwnership,
      financials: businessFinancials,
      valuations: businessValuations,
      capitalEvents: businessCapitalEvents,
      holdings: businessHoldings,
      ebitdaAdjustments: businessEbitdaAdjustments,
      bridgeItems: businessBridgeItems,
      bridgeDeclarations: businessBridgeDeclarations,
      dcfAssumptions: businessDcfAssumptions,
      currencyRates,
    });
    const balanceSheet = buildCanonicalBalanceSheet({
      asOfDate: AS_OF_DATE,
      reportingCurrency,
      accounts,
      positions,
      liabilities,
      contributions: [
        ...realEstateBalanceSheetContributions(realEstate),
        ...businessEquityBalanceSheetContributions(businessEquity),
      ],
      currencyRates,
    });
    // Le ledger portefeuille est une lecture DÉRIVÉE : il ne produit aucune ligne de bilan
    // et n'entre dans aucun total patrimonial. Il mesure des écarts, il ne recompose rien.
    const portfolioLedger = buildPortfolioLedger({
      asOfDate: AS_OF_DATE,
      accounts,
      positions,
      events: portfolioEvents,
      policies: portfolioPolicies,
      transactions,
      expenseCategories,
    });
    const portfolioAnalytics = buildPortfolioAnalytics({
      asOfDate: AS_OF_DATE,
      reportingCurrency,
      accounts,
      positions,
      events: portfolioEvents,
      balanceHistory: accountBalanceHistory,
      ledger: portfolioLedger,
      balanceSheet,
      currencyRates,
    });
    const balanceSheetMetrics = deriveCanonicalBalanceSheetMetrics({
      balanceSheet,
      liabilities,
      expenses: expenseCategories,
      positions,
      snapshots: netWorthSnapshots,
    });
    const flowMetrics = deriveFlowMetrics(
      liabilities,
      incomes,
      expenseCategories,
      transactions,
      AS_OF_DATE,
    );
    const dashboardState: DashboardState = {
      asOfDate: AS_OF_DATE,
      reportingCurrency,
      ledgerCoverageStart: coverage.start,
      ledgerCoverageSource: coverage.source,
      accounts,
      accountBalanceHistory,
      positions,
      portfolioEvents,
      portfolioPolicies,
      realEstateAssets,
      realEstateValuations,
      realEstateCapitalEvents,
      realEstateOperatingTerms,
      realEstateFinancingLinks,
      businesses,
      businessOwnership,
      businessFinancials,
      businessValuations,
      businessEbitdaAdjustments,
      businessBridgeItems,
      businessBridgeDeclarations,
      businessDcfAssumptions,
      businessCapitalEvents,
      businessHoldings,
      careerRoles,
      careerCompensationTerms,
      careerEvents,
      careerEquityGrants,
      careerScenarios,
      taxProfiles,
      taxRuleSets,
      taxRules,
      taxObservations,
      careerMonthly,
      careerAnalytics,
      taxCalculation,
      careerTaxMonthly,
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
      portfolioLedger,
      portfolioAnalytics,
      realEstate,
      businessEquity,
      metrics: composeDashboardMetrics({ balanceSheet, balanceSheetMetrics, flow: flowMetrics }),
      assumptions,
    };
    const horizonYear = Number(AS_OF_DATE.slice(0, 4)) + 40;
    dashboardState.eventTimeline = buildDashboardEventTimeline({
      state: dashboardState,
      startDate: AS_OF_DATE,
      endDate: `${horizonYear}${AS_OF_DATE.slice(4)}`,
    });
    return dashboardState;
  }

  async function mutateState(mutation: Mutation): Promise<DashboardState> {
    const now = new Date().toISOString();
    switch (mutation.action) {
      case "save_career_package": {
        const value = mutation.career;
        const compensation = value.compensation;
        unwrap(
          await db.rpc("lfo_save_career_package", {
            p_user_id: user,
            p_payload: {
              role_id: value.roleId,
              employer: value.employer,
              job_title: value.jobTitle,
              employment_type: value.employmentType,
              industry: value.industry,
              country: value.country,
              currency: value.currency,
              start_date: value.startDate,
              end_date: value.endDate,
              status: value.status,
              data_kind: value.dataKind,
              confidence: value.confidence,
              source: value.source,
              notes: value.notes,
              compensation: compensation
                ? {
                    base_salary: compensation.baseSalary,
                    frequency: compensation.frequency,
                    guaranteed_bonus: compensation.guaranteedBonus,
                    target_bonus: compensation.targetBonus,
                    target_bonus_rate: compensation.targetBonusRate,
                    discretionary_bonus: compensation.discretionaryBonus,
                    commissions: compensation.commissions,
                    profit_sharing: compensation.profitSharing,
                    participation: compensation.participation,
                    employer_benefits: compensation.employerBenefits,
                    allowances: compensation.allowances,
                    other_taxable_compensation: compensation.otherTaxableCompensation,
                    other_non_taxable_compensation: compensation.otherNonTaxableCompensation,
                    working_time: compensation.workingTime,
                    effective_from: compensation.effectiveFrom,
                    effective_to: compensation.effectiveTo,
                    data_kind: compensation.dataKind,
                    confidence: compensation.confidence,
                    source: compensation.source,
                    notes: compensation.notes,
                  }
                : null,
            },
          }),
          "enregistrement atomique du package de rémunération",
        );
        break;
      }
      case "record_career_event": {
        const value = mutation.event;
        unwrap(
          await db.rpc("lfo_record_career_event", {
            p_user_id: user,
            p_payload: {
              role_id: value.roleId,
              event_type: value.type,
              event_date: value.eventDate,
              amount: value.amount,
              currency: value.currency,
              variable_state: value.variableState,
              paid_date: value.paidDate,
              label: value.label,
              data_kind: value.dataKind,
              confidence: value.confidence,
              source: value.source,
              notes: value.notes,
            },
          }),
          "enregistrement événement de carrière",
        );
        break;
      }
      case "set_tax_profile": {
        const value = mutation.profile;
        unwrap(
          await db.rpc("lfo_set_tax_profile", {
            p_user_id: user,
            p_payload: {
              id: value.id,
              residency_country: value.residencyCountry,
              household_status: value.householdStatus,
              jurisdiction: value.jurisdiction,
              marital_status: value.maritalStatus,
              dependants: value.dependants,
              tax_shares: value.taxShares,
              withholding_settings: value.withholdingSettings,
              social_contribution_regime: value.socialContributionRegime,
              professional_status: value.professionalStatus,
              special_regime: value.specialRegime,
              effective_from: value.effectiveFrom,
              effective_to: value.effectiveTo,
              source: value.source,
              confidence: value.confidence,
              notes: value.notes,
            },
          }),
          "enregistrement profil fiscal",
        );
        break;
      }
      case "save_tax_rule_set": {
        const value = mutation.ruleSet;
        unwrap(
          await db.rpc("lfo_save_tax_rule_set", {
            p_user_id: user,
            p_payload: {
              id: value.id,
              jurisdiction: value.jurisdiction,
              tax_year: value.taxYear,
              name: value.name,
              effective_from: value.effectiveFrom,
              effective_to: value.effectiveTo,
              source: value.source,
              source_date: value.sourceDate,
              confidence: value.confidence,
              status: value.status,
              legal_reference: value.legalReference,
              notes: value.notes,
              rules: value.rules.map((rule) => ({
                name: rule.name,
                tax_type: rule.taxType,
                income_category: rule.incomeCategory,
                parameters: rule.parameters,
                effective_from: rule.effectiveFrom,
                effective_to: rule.effectiveTo,
                verified_at: rule.verifiedAt,
                confidence: rule.confidence,
                legal_note: rule.legalNote,
                notes: rule.notes,
              })),
            },
          }),
          "enregistrement atomique du jeu fiscal",
        );
        break;
      }
      case "record_tax_observation": {
        const value = mutation.observation;
        unwrap(
          await db.rpc("lfo_record_tax_observation", {
            p_user_id: user,
            p_payload: {
              observation_type: value.type,
              observed_date: value.observedDate,
              tax_year: value.taxYear,
              amount: value.amount,
              currency: value.currency,
              transaction_id: value.transactionId,
              document_id: value.documentId,
              confidence: value.confidence,
              source: value.source,
              notes: value.notes,
            },
          }),
          "enregistrement fait fiscal observé",
        );
        break;
      }
      case "create_business_quick_start": {
        const value = mutation.quickStart;
        unwrap(
          await db.rpc("lfo_create_business_quick_start", {
            p_user_id: user,
            p_payload: {
              name: value.name,
              legal_form: value.legalForm,
              business_type: value.type,
              currency: value.currency,
              sector: value.sector,
              country: value.country,
              period_end: value.periodEnd,
              period_kind: value.periodKind,
              period_label: value.periodLabel,
              revenue: value.revenue,
              ebitda: value.ebitda,
              cash: value.cash,
              gross_debt: value.grossDebt,
              legal_rate: value.legalRate,
              economic_rate: value.economicRate,
              valuation_date: value.valuationDate,
              method: value.method,
              multiple: value.multiple,
              multiple_low: value.multipleLow,
              multiple_high: value.multipleHigh,
              bridge_status: value.bridgeStatus,
              capital_history_start: value.capitalHistoryStart,
              capital_history_source: value.capitalHistorySource,
              notes: value.notes,
              source: "Démarrage rapide Business Equity",
            },
          }),
          "création rapide de société",
        );
        break;
      }
      case "save_business": {
        const value = mutation.business;
        unwrap(
          await db.rpc("lfo_save_business", {
            p_user_id: user,
            p_payload: {
              business_id: value.businessId,
              name: value.name,
              legal_form: value.legalForm,
              business_type: value.type,
              functional_currency: value.functionalCurrency,
              sector: value.sector,
              country: value.country,
              founded_on: value.foundedOn,
              capital_history_start: value.capitalHistoryStart,
              capital_history_source: value.capitalHistorySource,
              notes: value.notes,
              source: "Saisie Business Equity",
            },
          }),
          "enregistrement société",
        );
        break;
      }
      case "archive_business": {
        unwrap(
          await db.rpc("lfo_archive_business", {
            p_user_id: user,
            p_business_id: mutation.businessId,
          }),
          "archivage société",
        );
        break;
      }
      case "record_business_ownership": {
        const value = mutation.ownership;
        unwrap(
          await db.rpc("lfo_record_business_ownership", {
            p_user_id: user,
            p_payload: {
              business_id: value.businessId,
              effective_date: value.effectiveDate,
              legal_rate: value.legalRate,
              economic_rate: value.economicRate,
              voting_rate: value.votingRate,
              fully_diluted_rate: value.fullyDilutedRate,
              shares_held: value.sharesHeld,
              shares_outstanding: value.sharesOutstanding,
              fully_diluted_shares: value.fullyDilutedShares,
              share_class: value.shareClass,
              notes: value.notes,
              source: "Saisie Business Equity",
            },
          }),
          "enregistrement détention",
        );
        break;
      }
      case "delete_business_ownership": {
        unwrap(
          await db.rpc("lfo_delete_business_ownership", {
            p_user_id: user,
            p_ownership_id: mutation.ownershipId,
          }),
          "suppression détention",
        );
        break;
      }
      case "record_business_financials": {
        const value = mutation.financials;
        unwrap(
          await db.rpc("lfo_record_business_financials", {
            p_user_id: user,
            p_payload: {
              business_id: value.businessId,
              period_end: value.periodEnd,
              period_start: value.periodStart,
              period_kind: value.periodKind,
              period_label: value.periodLabel,
              currency: value.currency,
              revenue: value.revenue,
              gross_profit: value.grossProfit,
              ebitda: value.ebitda,
              ebit: value.ebit,
              net_income: value.netIncome,
              cash: value.cash,
              gross_debt: value.grossDebt,
              working_capital: value.workingCapital,
              capex: value.capex,
              depreciation_amortisation: value.depreciationAmortisation,
              interest_expense: value.interestExpense,
              tax_expense: value.taxExpense,
              free_cash_flow: value.freeCashFlow,
              notes: value.notes,
              data_kind: "ACTUAL",
              confidence: "HIGH",
              source: "Saisie Business Equity",
            },
          }),
          "enregistrement période financière",
        );
        break;
      }
      case "delete_business_financials": {
        unwrap(
          await db.rpc("lfo_delete_business_financials", {
            p_user_id: user,
            p_financials_id: mutation.financialsId,
          }),
          "suppression période financière",
        );
        break;
      }
      case "record_business_valuation": {
        const value = mutation.valuation;
        // Une saisie libre est une USER_ASSUMPTION de faible confiance ; une observation
        // externe est une EXTERNAL_DATA ; une base de méthode dérivée reste une hypothèse
        // déclarée, car c'est ce qu'elle est — le résultat, lui, n'est pas persisté.
        const observed = value.method === "EXTERNAL_APPRAISAL" || value.method === "TRANSACTION";
        unwrap(
          await db.rpc("lfo_record_business_valuation", {
            p_user_id: user,
            p_payload: {
              business_id: value.businessId,
              valuation_date: value.valuationDate,
              currency: value.currency,
              method: value.method,
              enterprise_value: value.enterpriseValue,
              equity_value: value.equityValue,
              valuation_multiple: value.multiple,
              multiple_low: value.multipleLow,
              multiple_high: value.multipleHigh,
              metric_basis: value.metricBasis,
              metric_period_end: value.metricPeriodEnd,
              pre_money_equity_value: value.preMoneyEquityValue,
              primary_new_money: value.primaryNewMoney,
              secondary_amount: value.secondaryAmount,
              investor_contribution: value.investorContribution,
              preferred_rights_known: value.preferredRightsKnown,
              bridge_status: value.bridgeStatus,
              notes: value.notes,
              assumptions: {},
              data_kind: observed ? "EXTERNAL_DATA" : "USER_ASSUMPTION",
              confidence: observed ? "HIGH" : value.method === "USER_ESTIMATE" ? "LOW" : "MEDIUM",
              source: value.source ?? "Saisie Business Equity",
            },
          }),
          "enregistrement base de valorisation",
        );
        break;
      }
      case "delete_business_valuation": {
        unwrap(
          await db.rpc("lfo_delete_business_valuation", {
            p_user_id: user,
            p_valuation_id: mutation.valuationId,
          }),
          "suppression valorisation",
        );
        break;
      }
      case "record_business_ebitda_adjustment": {
        const value = mutation.adjustment;
        unwrap(
          await db.rpc("lfo_record_business_ebitda_adjustment", {
            p_user_id: user,
            p_payload: {
              business_id: value.businessId,
              period_end: value.periodEnd,
              category: value.category,
              label: value.label,
              amount: value.amount,
              currency: value.currency,
              recurring: value.recurring,
              notes: value.notes,
              data_kind: "USER_ASSUMPTION",
              confidence: "MEDIUM",
              source: value.source ?? "Saisie Business Equity",
            },
          }),
          "enregistrement ajustement EBITDA",
        );
        break;
      }
      case "delete_business_ebitda_adjustment": {
        unwrap(
          await db.rpc("lfo_delete_business_ebitda_adjustment", {
            p_user_id: user,
            p_adjustment_id: mutation.adjustmentId,
          }),
          "suppression ajustement EBITDA",
        );
        break;
      }
      case "record_business_bridge_item": {
        const value = mutation.item;
        unwrap(
          await db.rpc("lfo_record_business_bridge_item", {
            p_user_id: user,
            p_payload: {
              business_id: value.businessId,
              effective_date: value.effectiveDate,
              category: value.category,
              label: value.label,
              amount: value.amount,
              currency: value.currency,
              notes: value.notes,
              data_kind: "USER_ASSUMPTION",
              confidence: "MEDIUM",
              source: value.source ?? "Saisie Business Equity",
            },
          }),
          "enregistrement élément de bridge",
        );
        break;
      }
      case "delete_business_bridge_item": {
        unwrap(
          await db.rpc("lfo_delete_business_bridge_item", {
            p_user_id: user,
            p_item_id: mutation.itemId,
          }),
          "suppression élément de bridge",
        );
        break;
      }
      case "set_business_dcf": {
        const value = mutation.dcf;
        unwrap(
          await db.rpc("lfo_set_business_dcf", {
            p_user_id: user,
            p_payload: {
              business_id: value.businessId,
              valuation_date: value.valuationDate,
              currency: value.currency,
              wacc: value.wacc,
              tax_rate: value.taxRate,
              terminal_method: value.terminalMethod,
              terminal_growth: value.terminalGrowth,
              terminal_exit_multiple: value.terminalExitMultiple,
              terminal_exit_metric: value.terminalExitMetric,
              discount_convention: value.discountConvention,
              notes: value.notes,
              confidence: "LOW",
              source: "Saisie Business Equity",
              periods: value.periods.map((period) => ({
                year_index: period.yearIndex,
                revenue: period.revenue,
                ebitda: period.ebitda,
                ebit: period.ebit,
                depreciation_amortisation: period.depreciationAmortisation,
                capex: period.capex,
                working_capital_change: period.workingCapitalChange,
              })),
            },
          }),
          "enregistrement hypothèses DCF",
        );
        break;
      }
      case "delete_business_dcf": {
        unwrap(
          await db.rpc("lfo_delete_business_dcf", { p_user_id: user, p_dcf_id: mutation.dcfId }),
          "suppression hypothèses DCF",
        );
        break;
      }
      case "record_business_capital_event": {
        const value = mutation.event;
        unwrap(
          await db.rpc("lfo_record_business_capital_event", {
            p_user_id: user,
            p_payload: {
              business_id: value.businessId,
              event_type: value.type,
              event_date: value.eventDate,
              amount: value.amount,
              amount_scope: value.amountScope,
              fees: value.fees,
              currency: value.currency,
              ownership_delta: value.ownershipDelta,
              ownership_rate_after: value.ownershipRateAfter,
              shares_delta: value.sharesDelta,
              price_per_share: value.pricePerShare,
              label: value.label,
              transaction_id: value.transactionId,
              notes: value.notes,
              data_kind: "ACTUAL",
              confidence: "HIGH",
              source: "Saisie Business Equity",
            },
          }),
          "enregistrement événement de capital",
        );
        break;
      }
      case "delete_business_capital_event": {
        unwrap(
          await db.rpc("lfo_delete_business_capital_event", {
            p_user_id: user,
            p_event_id: mutation.eventId,
          }),
          "suppression événement de capital",
        );
        break;
      }
      case "set_business_holding": {
        const value = mutation.holding;
        unwrap(
          await db.rpc("lfo_set_business_holding", {
            p_user_id: user,
            p_payload: {
              parent_business_id: value.parentBusinessId,
              child_business_id: value.childBusinessId,
              effective_date: value.effectiveDate,
              ownership_rate: value.ownershipRate,
              notes: value.notes,
              source: "Saisie Business Equity",
            },
          }),
          "rattachement holding",
        );
        break;
      }
      case "delete_business_holding": {
        unwrap(
          await db.rpc("lfo_delete_business_holding", {
            p_user_id: user,
            p_holding_id: mutation.holdingId,
          }),
          "suppression rattachement holding",
        );
        break;
      }
      case "apply_business_funding_round": {
        const value = mutation.round;
        // La détention post-money est DÉRIVÉE ici, jamais ressaisie : c'est la seule façon
        // d'empêcher deux vérités contradictoires de coexister dans la base.
        const outcome = fundingRoundOutcome({
          preMoneyEquityValue: value.preMoneyEquityValue,
          primaryNewMoney: value.primaryNewMoney,
          secondaryAmount: value.secondaryAmount,
          ownershipBefore: value.ownershipBefore,
          investorContribution: value.investorContribution,
          preferredRightsKnown: value.preferredRightsKnown,
        });
        if (outcome.ownershipAfter.value === null) {
          throw new Error(
            "Tour de table non applicable : le post-money dérivé des termes saisis n’est pas positif",
          );
        }
        unwrap(
          await db.rpc("lfo_apply_business_funding_round", {
            p_user_id: user,
            p_payload: {
              business_id: value.businessId,
              round_date: value.roundDate,
              currency: value.currency,
              pre_money_equity_value: value.preMoneyEquityValue,
              primary_new_money: value.primaryNewMoney,
              secondary_amount: value.secondaryAmount,
              investor_contribution: value.investorContribution,
              preferred_rights_known: value.preferredRightsKnown,
              post_ownership_rate: outcome.ownershipAfter.value,
              notes: value.notes,
              confidence: value.preferredRightsKnown ? "MEDIUM" : "LOW",
              source: value.source ?? "Saisie Business Equity",
            },
          }),
          "application du tour de table",
        );
        break;
      }
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
      case "create_scenario_v2": {
        unwrap(
          await db.rpc("lfo_create_scenario_v2", {
            p_user_id: user,
            p_name: mutation.name,
            p_description: mutation.description,
            p_color: mutation.color,
            p_definition: mutation.definition,
            p_now: now,
          }),
          "création atomique de scénario V2",
        );
        break;
      }
      case "save_scenario_version_v2": {
        unwrap(
          await db.rpc("lfo_save_scenario_version_v2", {
            p_user_id: user,
            p_scenario_id: mutation.scenarioId,
            p_expected_version: mutation.expectedVersion,
            p_definition: mutation.definition,
            p_updated_at: now,
          }),
          "versionnement atomique de scénario V2",
        );
        break;
      }
      case "archive_scenario_v2": {
        unwrap(
          await db.rpc("lfo_archive_scenario_v2", {
            p_user_id: user,
            p_scenario_id: mutation.scenarioId,
            p_archived_at: now,
          }),
          "archivage atomique de scénario V2",
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
      case "record_portfolio_event": {
        const event = mutation.event;
        unwrap(
          await db.rpc("lfo_record_portfolio_event", {
            p_user_id: user,
            p_payload: {
              account_id: event.accountId,
              event_type: event.type,
              event_date: event.eventDate,
              settlement_date: event.settlementDate,
              security: event.securityId
                ? { id: event.securityId }
                : event.security
                  ? {
                      name: event.security.name,
                      ticker: event.security.ticker,
                      isin: event.security.isin,
                      currency: event.security.currency,
                      asset_class: event.security.assetClass,
                    }
                  : null,
              quantity: event.quantity,
              unit_price: event.unitPrice,
              gross_amount: event.grossAmount,
              fee_amount: event.feeAmount,
              tax_amount: event.taxAmount,
              envelope_cash_amount: event.envelopeCashAmount,
              currency: event.currency,
              counterparty_account_id: event.counterpartyAccountId,
              transaction_id: event.transactionId,
              matched_acquisition_event_id: event.matchedAcquisitionEventId,
              external_reference: event.externalReference,
              data_kind: "ACTUAL",
              confidence: "HIGH",
              source: "Saisie ledger portefeuille",
              notes: event.notes,
            },
          }),
          "enregistrement atomique d’un événement de portefeuille",
        );
        break;
      }
      case "delete_portfolio_event": {
        unwrap(
          await db.rpc("lfo_delete_portfolio_event", {
            p_user_id: user,
            p_event_id: mutation.eventId,
          }),
          "suppression d’un événement de portefeuille",
        );
        break;
      }
      case "set_portfolio_envelope_policy": {
        // `null` efface la déclaration : c'est une valeur, jamais un oubli.
        unwrap(
          await db.rpc("lfo_set_portfolio_envelope_policy", {
            p_user_id: user,
            p_payload: {
              account_id: mutation.policy.accountId,
              lot_matching_method: mutation.policy.lotMatchingMethod,
              ledger_coverage_start: mutation.policy.ledgerCoverageStart,
              ledger_coverage_source: mutation.policy.ledgerCoverageSource,
              notes: mutation.policy.notes,
            },
          }),
          "déclaration des conventions d’enveloppe",
        );
        break;
      }
      case "save_real_estate_asset": {
        // Aucun montant n'est écrit ici : l'identité d'un bien et ses faits chiffrés sont
        // deux choses distinctes, saisies par deux mutations distinctes.
        unwrap(
          await db.rpc("lfo_save_real_estate_asset", {
            p_user_id: user,
            p_payload: {
              property_id: mutation.asset.propertyId,
              name: mutation.asset.name,
              location: mutation.asset.location,
              surface_sqm: mutation.asset.surfaceSqm,
              property_usage: mutation.asset.usage,
              ownership_share: mutation.asset.ownershipShare,
              debt_financed: mutation.asset.isDebtFinanced,
              acquisition_date: mutation.asset.acquisitionDate,
              disposal_date: mutation.asset.disposalDate,
              notes: mutation.asset.notes,
              source: "Saisie Real Estate",
            },
          }),
          "enregistrement du bien immobilier",
        );
        break;
      }
      case "archive_real_estate_asset": {
        unwrap(
          await db.rpc("lfo_archive_real_estate_asset", {
            p_user_id: user,
            p_property_id: mutation.propertyId,
          }),
          "archivage du bien immobilier",
        );
        break;
      }
      case "record_real_estate_valuation": {
        unwrap(
          await db.rpc("lfo_record_real_estate_valuation", {
            p_user_id: user,
            p_payload: {
              property_id: mutation.valuation.propertyId,
              valued_at: mutation.valuation.valuedAt,
              value: mutation.valuation.value,
              currency: mutation.valuation.currency,
              valuation_method: mutation.valuation.method,
              data_kind:
                mutation.valuation.method === "USER_ESTIMATE" ? "USER_ASSUMPTION" : "EXTERNAL_DATA",
              confidence: mutation.valuation.method === "USER_ESTIMATE" ? "LOW" : "MEDIUM",
              source: "Saisie Real Estate",
              notes: mutation.valuation.notes,
            },
          }),
          "enregistrement de la valorisation",
        );
        break;
      }
      case "record_real_estate_capital_event": {
        unwrap(
          await db.rpc("lfo_record_real_estate_capital_event", {
            p_user_id: user,
            p_payload: {
              property_id: mutation.event.propertyId,
              event_type: mutation.event.type,
              event_date: mutation.event.eventDate,
              amount: mutation.event.amount,
              currency: mutation.event.currency,
              label: mutation.event.label,
              transaction_id: mutation.event.transactionId,
              source: "Saisie Real Estate",
              notes: mutation.event.notes,
            },
          }),
          "enregistrement du fait de capital immobilier",
        );
        break;
      }
      case "delete_real_estate_capital_event": {
        unwrap(
          await db.rpc("lfo_delete_real_estate_capital_event", {
            p_user_id: user,
            p_event_id: mutation.eventId,
          }),
          "suppression du fait de capital immobilier",
        );
        break;
      }
      case "set_real_estate_operating_terms": {
        // Chaque `null` est transmis tel quel : « non déclaré » est une information, et la
        // remplacer par zéro produirait un rendement net flatteur et faux.
        unwrap(
          await db.rpc("lfo_set_real_estate_operating_terms", {
            p_user_id: user,
            p_payload: {
              property_id: mutation.terms.propertyId,
              effective_from: mutation.terms.effectiveFrom,
              currency: mutation.terms.currency,
              annual_gross_rent: mutation.terms.annualGrossRent,
              vacancy_rate: mutation.terms.vacancyRate,
              annual_operating_charges: mutation.terms.annualOperatingCharges,
              annual_property_tax: mutation.terms.annualPropertyTax,
              annual_insurance: mutation.terms.annualInsurance,
              annual_maintenance: mutation.terms.annualMaintenance,
              annual_management_fees: mutation.terms.annualManagementFees,
              management_fee_rate: mutation.terms.managementFeeRate,
              annual_other_costs: mutation.terms.annualOtherCosts,
              effective_income_tax_rate: mutation.terms.effectiveIncomeTaxRate,
              source: "Saisie Real Estate",
              notes: mutation.terms.notes,
            },
          }),
          "déclaration des termes d’exploitation",
        );
        break;
      }
      case "set_real_estate_financing_link": {
        // La RPC refuse une quote-part cumulée supérieure à 1 : la même dette ne peut pas
        // être attribuée deux fois. Aucun passif n'est créé par cette écriture.
        unwrap(
          await db.rpc("lfo_set_real_estate_financing_link", {
            p_user_id: user,
            p_payload: {
              property_id: mutation.link.propertyId,
              liability_id: mutation.link.liabilityId,
              allocation_share: mutation.link.allocationShare,
              source: "Saisie Real Estate",
              notes: mutation.link.notes,
            },
          }),
          "rattachement du financement au bien",
        );
        break;
      }
      case "delete_real_estate_financing_link": {
        unwrap(
          await db.rpc("lfo_delete_real_estate_financing_link", {
            p_user_id: user,
            p_link_id: mutation.linkId,
          }),
          "suppression du rattachement de financement",
        );
        break;
      }
      case "attribute_transaction_to_property": {
        // Attribution seule : ni le montant, ni la catégorie, ni la nature canonique du
        // flux ne sont touchés. Le Cash Flow Engine reste la seule vérité des flux.
        unwrap(
          await db.rpc("lfo_attribute_transaction_to_property", {
            p_user_id: user,
            p_transaction_id: mutation.transactionId,
            p_property_id: mutation.propertyId,
          }),
          "rattachement du flux au bien",
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
    if (run.definitionSnapshot) {
      return unwrap(
        await db.rpc("lfo_save_simulation_v2", {
          p_user_id: user,
          p_scenario_id: run.scenarioId,
          p_scenario_version: run.scenarioVersion,
          p_as_of_date: run.asOfDate,
          p_baseline_reference: run.baselineReference,
          p_event_set_version: run.eventSetVersion,
          p_assumptions_snapshot: run.assumptionsSnapshot,
          p_run_mode: run.runMode,
          p_horizon_months: run.horizonMonths,
          p_methodology: run.methodology,
          p_methodology_version: run.methodologyVersion,
          p_definition_snapshot: run.definitionSnapshot,
          p_seed: run.seed,
          p_simulations: run.simulations,
          p_points: run.points,
        }),
        "enregistrement atomique de simulation V2",
      ) as string;
    }
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
