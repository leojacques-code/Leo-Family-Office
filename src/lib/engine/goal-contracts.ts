export const GOAL_V2_SCHEMA_VERSION = 2 as const;
export const GOAL_METHODOLOGY_VERSION = "GOALS_V2_CANONICAL_TRAJECTORY_1" as const;

export const GOAL_STATUSES = ["ACTIVE", "PAUSED", "ACHIEVED", "ARCHIVED"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_CONSTRAINT_STRENGTHS = ["HARD", "SOFT"] as const;
export type GoalConstraintStrength = (typeof GOAL_CONSTRAINT_STRENGTHS)[number];

export const GOAL_TARGET_OPERATORS = ["AT_LEAST", "AT_MOST", "EQUAL"] as const;
export type GoalTargetOperator = (typeof GOAL_TARGET_OPERATORS)[number];

export const GOAL_TARGET_METRICS = [
  "NET_WORTH",
  "LIQUID_NET_WORTH",
  "IMMEDIATE_CASH",
  "LIQUID_ASSETS",
  "INVESTMENT_ASSETS",
  "TOTAL_LIABILITIES",
  "CONTRACTUAL_DEBT",
  "FUNDING_GAP",
  "SPECIFIC_DEBT_BALANCE",
  "REAL_ESTATE_VALUE",
  "BUSINESS_EQUITY",
] as const;
export type GoalTargetMetric = (typeof GOAL_TARGET_METRICS)[number];

export type GoalEvaluationStatus =
  | "ACHIEVED"
  | "ON_TRACK"
  | "AT_RISK"
  | "OFF_TRACK"
  | "OVERDUE"
  | "NOT_COMPUTABLE";

export const GOAL_BLOCKER_CODES = [
  "GOAL_INACTIVE",
  "METRIC_NOT_SUPPORTED",
  "METRIC_NOT_AVAILABLE_CURRENT",
  "METRIC_NOT_AVAILABLE_PROJECTED",
  "MISSING_CURRENT_STATE",
  "MISSING_VALUE",
  "MISSING_ENTITY_TARGET",
  "ENTITY_NOT_FOUND",
  "MISSING_CURRENCY",
  "CURRENCY_MISMATCH",
  "HISTORICAL_TARGET_VALUE_UNAVAILABLE",
  "HORIZON_BEFORE_DEADLINE",
  "TRAJECTORY_NOT_COMPUTABLE",
  "TRAJECTORY_PARTIAL",
  "STALE_BASELINE",
  "MONTE_CARLO_SAMPLES_UNAVAILABLE",
] as const;
export type GoalBlockerCode = (typeof GOAL_BLOCKER_CODES)[number] | string;

export interface GoalBlocker {
  code: GoalBlockerCode;
  message: string;
  blocking: boolean;
  source: string;
}

export interface GoalTarget {
  metric: GoalTargetMetric;
  operator: GoalTargetOperator;
  value: number;
  currency: string | null;
  entityId: string | null;
}

export interface GoalTargetWindow {
  startDate: string;
  endDate: string;
}

export interface GoalVersionDefinition {
  schemaVersion: typeof GOAL_V2_SCHEMA_VERSION;
  methodologyVersion: typeof GOAL_METHODOLOGY_VERSION;
  goalId: string;
  version: number;
  name: string;
  description: string | null;
  status: GoalStatus;
  priority: number;
  constraintStrength: GoalConstraintStrength;
  target: GoalTarget;
  targetDate: string | null;
  targetWindow: GoalTargetWindow | null;
  createdAt: string;
  legacyCompatibility: boolean;
}

export type GoalMetricStatus = "COMPLETE" | "PARTIAL" | "NOT_COMPUTABLE";

export interface GoalMetricObservation {
  metric: GoalTargetMetric;
  value: number | null;
  currency: string | null;
  observedAt: string;
  status: GoalMetricStatus;
  blockers: GoalBlocker[];
  provenance: {
    source: string;
    methodologyVersion: string;
    entityId: string | null;
  };
}

export interface GoalGap {
  absoluteGap: number;
  relativeGap: number | null;
  shortfall: number;
  surplus: number;
}

export interface GoalCurrentEvaluation {
  goalId: string;
  goalVersion: number;
  asOfDate: string;
  observation: GoalMetricObservation;
  target: GoalTarget;
  gap: GoalGap | null;
  satisfiedNow: boolean | null;
  status: GoalEvaluationStatus;
  blockers: GoalBlocker[];
  methodologyVersion: typeof GOAL_METHODOLOGY_VERSION;
}

export interface GoalTrajectoryReference {
  scenarioId: string | null;
  scenarioVersion: number | null;
  asOfDate: string;
  baselineFingerprint: string | null;
  methodologyVersion: string;
}

export interface GoalTrajectoryEvaluation {
  goalId: string;
  goalVersion: number;
  target: GoalTarget;
  observation: GoalMetricObservation | null;
  projectedValueAtTargetDate: number | null;
  projectedGapAtTargetDate: GoalGap | null;
  satisfiedAtTargetDate: boolean | null;
  firstProjectedAttainmentDate: string | null;
  status: GoalEvaluationStatus;
  blockers: GoalBlocker[];
  trajectory: GoalTrajectoryReference;
  methodologyVersion: typeof GOAL_METHODOLOGY_VERSION;
}

export interface GoalAttainmentProbability {
  probability: number | null;
  successfulSamples: number | null;
  totalSamples: number | null;
  status: "COMPUTABLE" | "NOT_COMPUTABLE";
  blockers: GoalBlocker[];
}
