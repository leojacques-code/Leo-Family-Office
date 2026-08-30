import type { CanonicalEvent } from "@/lib/engine/event-contracts";
import type {
  GoalAttainmentProbability,
  GoalConstraintStrength,
  GoalTrajectoryEvaluation,
  GoalVersionDefinition,
} from "@/lib/engine/goal-contracts";
import type {
  ScenarioAssumptionV2,
  ScenarioBaselineReference,
  ScenarioCompleteness,
  ScenarioRunMode,
  ScenarioVersionDefinition,
} from "@/lib/engine/scenario-contracts";

export const DECISION_LAB_V2_SCHEMA_VERSION = 2 as const;
export const DECISION_LAB_METHODOLOGY_VERSION = "DECISION_LAB_V2_SCENARIOS_GOALS_1" as const;

export type DecisionCaseStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
export type DecisionCompleteness = "READY" | "PARTIAL" | "NOT_COMPUTABLE";
export type DecisionConclusion =
  "DOMINANT_OPTION" | "NO_UNIQUE_WINNER" | "TRADE_OFF" | "INCOMPARABLE" | "NOT_COMPUTABLE";
export type DecisionStaleStatus = "CURRENT" | "STALE_BASELINE" | "STALE_REFERENCE";

export interface DecisionCase {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  decisionType: string;
  status: DecisionCaseStatus;
  asOfDate: string;
  horizonMonths: number;
  selectedGoalIds: string[];
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface DecisionOptionProvenance {
  source: string;
  createdBy: "USER" | "TEMPLATE" | "SYSTEM";
  notes: string[];
}

/** Une option est une définition Scenarios V2 exacte, jamais un fait financier. */
export interface DecisionOption {
  id: string;
  name: string;
  description: string;
  scenarioReference: {
    scenarioId: string;
    scenarioVersion: number;
    methodologyVersion: string;
    definitionFingerprint: string;
  };
  scenarioDefinition: ScenarioVersionDefinition;
  assumptions: ScenarioAssumptionV2[];
  provenance: DecisionOptionProvenance;
}

export interface DecisionSelectedGoal {
  goalId: string;
  goalVersion: number;
  constraintStrength: GoalConstraintStrength;
  definition: GoalVersionDefinition;
}

export interface DecisionCaseVersion {
  schemaVersion: typeof DECISION_LAB_V2_SCHEMA_VERSION;
  methodologyVersion: typeof DECISION_LAB_METHODOLOGY_VERSION;
  caseId: string;
  version: number;
  name: string;
  description: string | null;
  decisionType: string;
  status: DecisionCaseStatus;
  asOfDate: string;
  horizonMonths: number;
  baseline: ScenarioBaselineReference;
  selectedGoals: DecisionSelectedGoal[];
  options: DecisionOption[];
  createdAt: string;
}

export interface DecisionRun {
  id: string;
  caseId: string;
  caseVersion: number;
  optionReferences: DecisionOption["scenarioReference"][];
  goalReferences: Array<{ goalId: string; goalVersion: number }>;
  baselineFingerprint: string;
  methodologyVersion: typeof DECISION_LAB_METHODOLOGY_VERSION;
  asOfDate: string;
  horizonMonths: number;
  runMode: ScenarioRunMode;
  seed: number | null;
  createdAt: string;
  staleStatus: DecisionStaleStatus;
}

export interface DecisionBlocker {
  code: string;
  message: string;
  source: "DECISION_LAB_V2" | "SCENARIOS_V2" | "GOALS_V2";
  blocking: boolean;
  optionId: string | null;
  goalId: string | null;
}

export interface DecisionMetricSnapshot {
  date: string;
  netWorth: number | null;
  liquidNetWorth: number | null;
  cash: number | null;
  fundingGap: number | null;
  debt: number | null;
  investmentAssets: number | null;
  realEstateAndBusinessAssets: number | null;
  income: number | null;
  expenses: number | null;
  taxes: number | null;
}

export type DecisionMetricDelta = Omit<DecisionMetricSnapshot, "date">;
export type GoalImpactDirection = "IMPROVED" | "DEGRADED" | "UNCHANGED" | "NOT_COMPUTABLE";

export interface DecisionGoalImpact {
  goalId: string;
  goalVersion: number;
  constraintStrength: GoalConstraintStrength;
  baseline: GoalTrajectoryEvaluation;
  option: GoalTrajectoryEvaluation;
  probabilityOfAttainment: GoalAttainmentProbability;
  impact: GoalImpactDirection;
  hardConstraintViolated: boolean;
}

export interface DecisionFundingGapPeriod {
  startDate: string;
  endDate: string;
  peak: number;
}

export interface DecisionOptionEvaluation {
  option: DecisionOption;
  completeness: DecisionCompleteness;
  scenarioCompleteness: ScenarioCompleteness;
  terminal: DecisionMetricSnapshot;
  deltaVsBaseline: DecisionMetricDelta;
  fundingGapPeriods: DecisionFundingGapPeriod[];
  goalImpacts: DecisionGoalImpact[];
  blockers: DecisionBlocker[];
  assumptions: ScenarioAssumptionV2[];
  provenance: {
    engines: string[];
    methodologyVersions: string[];
    baselineFingerprint: string;
    scenarioId: string;
    scenarioVersion: number;
    sourceEventIds: string[];
  };
}

export interface DecisionPairComparison {
  leftOptionId: string;
  rightOptionId: string;
  delta: DecisionMetricDelta;
  opportunityCost: DecisionMetricDelta;
}

export interface DecisionTradeOff {
  optionId: string;
  improvedGoalIds: string[];
  degradedGoalIds: string[];
  unchangedGoalIds: string[];
  violatedHardGoalIds: string[];
  newBlockerCodes: string[];
}

export interface DecisionEvaluation {
  caseVersion: DecisionCaseVersion;
  run: DecisionRun;
  completeness: DecisionCompleteness;
  conclusion: DecisionConclusion;
  dominantOptionId: string | null;
  baseline: DecisionMetricSnapshot;
  options: DecisionOptionEvaluation[];
  pairComparisons: DecisionPairComparison[];
  tradeOffs: DecisionTradeOff[];
  blockers: DecisionBlocker[];
  provenance: {
    baseline: ScenarioBaselineReference;
    baselineEventIds: CanonicalEvent["id"][];
    methodologyVersions: string[];
  };
}
