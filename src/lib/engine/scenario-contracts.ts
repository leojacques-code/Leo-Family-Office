import type {
  CanonicalEvent,
  CanonicalTimeline,
  ScenarioEventOverride,
} from "@/lib/engine/event-contracts";
import type {
  AnnualBalanceSheetPoint,
  MonthlyFinancialState,
} from "@/lib/engine/monthly-financial-model";

export const SCENARIO_V2_SCHEMA_VERSION = 2 as const;
export const SCENARIO_METHODOLOGY_VERSION = "SCENARIOS_V2_EVENT_MONTHLY_1" as const;

export type ScenarioLifecycleStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type ScenarioCompleteness = "READY" | "PARTIAL" | "NOT_COMPUTABLE";
export type ScenarioRunMode = "DETERMINISTIC" | "MONTE_CARLO";

export type ScenarioAssumptionKind =
  "OBSERVED_MARKET_DATA" | "USER_ASSUMPTION" | "MODEL_ASSUMPTION";

export const SCENARIO_BLOCKER_CODES = [
  "BASELINE_UNAVAILABLE",
  "HISTORY_PROTECTED",
  "OVERRIDE_TARGET_MISSING",
  "OVERRIDE_CONFLICT",
  "MISSING_COMPENSATION",
  "MISSING_LOAN_TERMS",
  "MISSING_PROPERTY_PRICE",
  "MISSING_TAX_RULES",
  "MISSING_FX",
  "MISSING_SALE_PRICE",
  "MISSING_MARKET_ASSUMPTION",
  "FUNDING_GAP",
  "PARTIAL_CONSEQUENCE",
] as const;
export type ScenarioBlockerCode = (typeof SCENARIO_BLOCKER_CODES)[number];

export interface ScenarioBlocker {
  code: ScenarioBlockerCode | string;
  message: string;
  eventId: string | null;
  assumptionKey: string | null;
  blocking: boolean;
}

export interface ScenarioAssumptionV2 {
  key: string;
  label: string;
  value: number | string | boolean | null;
  unit: string | null;
  currency: string | null;
  effectiveDate: string | null;
  kind: ScenarioAssumptionKind;
  source: string;
}

export interface ScenarioMarketModel {
  annualReturn: number | null;
  annualVolatility: number | null;
  annualInflation: number | null;
  stressProbability: number | null;
  shockYear: number | null;
  shockMagnitude: number | null;
  randomVariables: Array<"PORTFOLIO_RETURN">;
}

export interface ScenarioCapitalAllocation {
  investmentAllocationRate: number;
  source: "EXPLICIT" | "LEGACY_COMPATIBILITY";
}

export interface ScenarioBaselineReference {
  kind: "CANONICAL_AS_OF";
  asOfDate: string;
  openingFingerprint: string;
  eventSetVersion: string;
  eventIds: string[];
}

export interface PersistedScenarioEventOverride {
  id: string;
  operation: ScenarioEventOverride["operation"];
  baselineEventId: string | null;
  event: CanonicalEvent | null;
  reason: string;
  createdAt: string;
}

export interface ScenarioVersionDefinition {
  schemaVersion: typeof SCENARIO_V2_SCHEMA_VERSION;
  methodologyVersion: typeof SCENARIO_METHODOLOGY_VERSION;
  scenarioId: string;
  version: number;
  asOfDate: string;
  horizonMonths: number;
  lifecycleStatus: ScenarioLifecycleStatus;
  overrides: PersistedScenarioEventOverride[];
  assumptions: ScenarioAssumptionV2[];
  market: ScenarioMarketModel;
  capitalAllocation: ScenarioCapitalAllocation;
  createdAt: string;
  legacyCompatibility: {
    monthlySavings: number | null;
    salaryGrowth: number | null;
  } | null;
}

export interface ScenarioPathMetric {
  monthIndex: number;
  date: string;
  netWorth: number;
  liquidNetWorth: number;
  cash: number;
  investmentAssets: number;
  realEstateAndBusinessAssets: number;
  debt: number;
  fundingGap: number;
  income: number;
  expenses: number;
  taxes: number;
  sourceConsequenceIds: string[];
}

export interface ScenarioPath {
  scenarioId: string | null;
  scenarioVersion: number | null;
  asOfDate: string;
  horizonMonths: number;
  timeline: CanonicalTimeline;
  monthly: ScenarioPathMetric[];
  annual: AnnualBalanceSheetPoint[];
  financialStates: MonthlyFinancialState[];
  blockers: ScenarioBlocker[];
  completeness: ScenarioCompleteness;
}

export interface ScenarioComparisonPoint {
  monthIndex: number;
  date: string;
  baseline: ScenarioPathMetric;
  scenario: ScenarioPathMetric;
  delta: Omit<ScenarioPathMetric, "monthIndex" | "date" | "sourceConsequenceIds">;
}

export interface ScenarioComparison {
  baseline: ScenarioPath;
  scenario: ScenarioPath;
  points: ScenarioComparisonPoint[];
  assumptions: ScenarioAssumptionV2[];
  blockers: ScenarioBlocker[];
  completeness: ScenarioCompleteness;
  humanDiff: string[];
}

export interface ScenarioRunSnapshot {
  scenarioId: string;
  scenarioVersion: number;
  mode: ScenarioRunMode;
  asOfDate: string;
  baseline: ScenarioBaselineReference;
  definition: ScenarioVersionDefinition;
  eventSetVersion: string;
  methodologyVersion: typeof SCENARIO_METHODOLOGY_VERSION;
  horizonMonths: number;
  seed: number | null;
  createdAt: string;
}
