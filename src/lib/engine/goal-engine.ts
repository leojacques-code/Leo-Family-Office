import type { CanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import {
  GOAL_METRIC_REGISTRY,
  resolveCurrentGoalMetric,
  resolveProjectedGoalMetric,
} from "@/lib/engine/goal-metrics";
import type { ScenarioPath, ScenarioPathMetric } from "@/lib/engine/scenario-contracts";
import {
  GOAL_METHODOLOGY_VERSION,
  GOAL_V2_SCHEMA_VERSION,
  type GoalAttainmentProbability,
  type GoalBlocker,
  type GoalCurrentEvaluation,
  type GoalGap,
  type GoalMetricObservation,
  type GoalTrajectoryEvaluation,
  type GoalVersionDefinition,
} from "@/lib/engine/goal-contracts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function realDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function blocker(
  code: string,
  message: string,
  options: { blocking?: boolean; source?: string } = {},
): GoalBlocker {
  return {
    code,
    message,
    blocking: options.blocking ?? true,
    source: options.source ?? "GOALS_V2",
  };
}

export function isGoalVersionDefinition(value: unknown): value is GoalVersionDefinition {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<GoalVersionDefinition>;
  const target = item.target;
  const definition = target?.metric ? GOAL_METRIC_REGISTRY[target.metric] : undefined;
  const dateShape =
    (item.targetDate === null || (typeof item.targetDate === "string" && realDate(item.targetDate))) &&
    (item.targetWindow === null ||
      (!!item.targetWindow &&
        realDate(item.targetWindow.startDate) &&
        realDate(item.targetWindow.endDate) &&
        item.targetWindow.startDate <= item.targetWindow.endDate));
  return (
    item.schemaVersion === GOAL_V2_SCHEMA_VERSION &&
    item.methodologyVersion === GOAL_METHODOLOGY_VERSION &&
    typeof item.goalId === "string" &&
    Number.isInteger(item.version) &&
    Number(item.version) > 0 &&
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    (item.description === null || typeof item.description === "string") &&
    ["ACTIVE", "PAUSED", "ACHIEVED", "ARCHIVED"].includes(String(item.status)) &&
    Number.isInteger(item.priority) &&
    Number(item.priority) >= 1 &&
    Number(item.priority) <= 99 &&
    ["HARD", "SOFT"].includes(String(item.constraintStrength)) &&
    !!target &&
    !!definition &&
    definition.allowedOperators.includes(target.operator) &&
    Number.isFinite(target.value) &&
    target.value >= 0 &&
    (target.currency === null || /^[A-Z]{3}$/.test(target.currency)) &&
    (target.entityId === null || typeof target.entityId === "string") &&
    !(item.targetDate && item.targetWindow) &&
    dateShape &&
    typeof item.createdAt === "string" &&
    typeof item.legacyCompatibility === "boolean"
  );
}

export function createGoalVersion(input: {
  goalId: string;
  name: string;
  description?: string | null;
  priority?: number;
  constraintStrength?: GoalVersionDefinition["constraintStrength"];
  target: GoalVersionDefinition["target"];
  targetDate?: string | null;
  targetWindow?: GoalVersionDefinition["targetWindow"];
  status?: GoalVersionDefinition["status"];
  createdAt?: string;
}): GoalVersionDefinition {
  const definition: GoalVersionDefinition = {
    schemaVersion: GOAL_V2_SCHEMA_VERSION,
    methodologyVersion: GOAL_METHODOLOGY_VERSION,
    goalId: input.goalId,
    version: 1,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    status: input.status ?? "ACTIVE",
    priority: input.priority ?? 99,
    constraintStrength: input.constraintStrength ?? "SOFT",
    target: input.target,
    targetDate: input.targetDate ?? null,
    targetWindow: input.targetWindow ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    legacyCompatibility: false,
  };
  if (!isGoalVersionDefinition(definition)) throw new Error("Définition Goals V2 invalide");
  return definition;
}

export function targetSatisfied(
  value: number,
  target: GoalVersionDefinition["target"],
): boolean {
  if (target.operator === "AT_LEAST") return value >= target.value;
  if (target.operator === "AT_MOST") return value <= target.value;
  return Math.abs(value - target.value) <= 1e-6;
}

export function goalGap(value: number, target: GoalVersionDefinition["target"]): GoalGap {
  const distance = Math.abs(value - target.value);
  const satisfied = targetSatisfied(value, target);
  return {
    absoluteGap: distance,
    relativeGap: target.value === 0 ? null : distance / Math.abs(target.value),
    shortfall: satisfied ? 0 : distance,
    surplus: satisfied && target.operator !== "EQUAL" ? distance : 0,
  };
}

function inactive(goal: GoalVersionDefinition): GoalBlocker | null {
  return goal.status === "PAUSED" || goal.status === "ARCHIVED"
    ? blocker("GOAL_INACTIVE", `Objectif ${goal.status.toLowerCase()} non évalué`)
    : null;
}

function nonComputableCurrent(
  goal: GoalVersionDefinition,
  asOfDate: string,
  observation: GoalMetricObservation,
  blockers: GoalBlocker[],
): GoalCurrentEvaluation {
  return {
    goalId: goal.goalId,
    goalVersion: goal.version,
    asOfDate,
    observation,
    target: goal.target,
    gap: null,
    satisfiedNow: null,
    status: "NOT_COMPUTABLE",
    blockers,
    methodologyVersion: GOAL_METHODOLOGY_VERSION,
  };
}

export function evaluateGoalCurrent(input: {
  goal: GoalVersionDefinition;
  balanceSheet: CanonicalBalanceSheet | null;
  reportingCurrency: string;
  asOfDate: string;
}): GoalCurrentEvaluation {
  const dormant = inactive(input.goal);
  if (!input.balanceSheet || dormant) {
    const reason = dormant ?? blocker("MISSING_CURRENT_STATE", "Bilan canonique courant absent");
    const observation: GoalMetricObservation = {
      metric: input.goal.target.metric,
      value: null,
      currency: input.goal.target.currency,
      observedAt: input.asOfDate,
      status: "NOT_COMPUTABLE",
      blockers: [reason],
      provenance: {
        source: "CanonicalBalanceSheet",
        methodologyVersion: "CANONICAL_BALANCE_SHEET_V2",
        entityId: input.goal.target.entityId,
      },
    };
    return nonComputableCurrent(input.goal, input.asOfDate, observation, [reason]);
  }
  const observation = resolveCurrentGoalMetric(input.goal.target, {
    balanceSheet: input.balanceSheet,
    reportingCurrency: input.reportingCurrency,
    asOfDate: input.asOfDate,
  });
  if (observation.value === null || observation.status !== "COMPLETE") {
    return nonComputableCurrent(
      input.goal,
      input.asOfDate,
      observation,
      observation.blockers.length
        ? observation.blockers
        : [blocker("MISSING_VALUE", "Valeur courante indisponible")],
    );
  }
  const satisfied = targetSatisfied(observation.value, input.goal.target);
  return {
    goalId: input.goal.goalId,
    goalVersion: input.goal.version,
    asOfDate: input.asOfDate,
    observation,
    target: input.goal.target,
    gap: goalGap(observation.value, input.goal.target),
    satisfiedNow: satisfied,
    status: satisfied
      ? "ACHIEVED"
      : input.goal.targetDate && input.goal.targetDate < input.asOfDate
        ? "OVERDUE"
        : "OFF_TRACK",
    blockers: [],
    methodologyVersion: GOAL_METHODOLOGY_VERSION,
  };
}

function pointsForTarget(
  goal: GoalVersionDefinition,
  trajectory: ScenarioPath,
): { candidates: ScenarioPathMetric[]; observation: ScenarioPathMetric | null; blockers: GoalBlocker[] } {
  const points = [...trajectory.monthly].sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) {
    return { candidates: [], observation: null, blockers: [blocker("TRAJECTORY_NOT_COMPUTABLE", "Trajectoire vide")] };
  }
  const last = points.at(-1)!;
  if (goal.targetWindow) {
    if (last.date < goal.targetWindow.endDate) {
      return {
        candidates: [],
        observation: null,
        blockers: [blocker("HORIZON_BEFORE_DEADLINE", "L’horizon se termine avant la fenêtre cible")],
      };
    }
    const candidates = points.filter(
      (point) => point.date >= goal.targetWindow!.startDate && point.date <= goal.targetWindow!.endDate,
    );
    return {
      candidates,
      observation: candidates.at(-1) ?? null,
      blockers: candidates.length
        ? []
        : [blocker("HISTORICAL_TARGET_VALUE_UNAVAILABLE", "Aucun point mensuel dans la fenêtre cible")],
    };
  }
  if (goal.targetDate) {
    if (goal.targetDate < trajectory.asOfDate && points[0].date > goal.targetDate) {
      return {
        candidates: [],
        observation: null,
        blockers: [
          blocker(
            "HISTORICAL_TARGET_VALUE_UNAVAILABLE",
            "La trajectoire prospective ne contient pas la vérité historique à la deadline",
          ),
        ],
      };
    }
    if (last.date < goal.targetDate) {
      return {
        candidates: [],
        observation: null,
        blockers: [blocker("HORIZON_BEFORE_DEADLINE", "L’horizon se termine avant la deadline")],
      };
    }
    const candidates = points.filter((point) => point.date <= goal.targetDate!);
    return {
      candidates,
      observation: candidates.at(-1) ?? null,
      blockers: candidates.length
        ? []
        : [blocker("HISTORICAL_TARGET_VALUE_UNAVAILABLE", "Aucun point mensuel avant la deadline")],
    };
  }
  return { candidates: points, observation: last, blockers: [] };
}

function nonComputableTrajectory(
  goal: GoalVersionDefinition,
  trajectory: ScenarioPath,
  blockers: GoalBlocker[],
  baselineFingerprint: string | null,
): GoalTrajectoryEvaluation {
  return {
    goalId: goal.goalId,
    goalVersion: goal.version,
    target: goal.target,
    observation: null,
    projectedValueAtTargetDate: null,
    projectedGapAtTargetDate: null,
    satisfiedAtTargetDate: null,
    firstProjectedAttainmentDate: null,
    status: "NOT_COMPUTABLE",
    blockers,
    trajectory: {
      scenarioId: trajectory.scenarioId,
      scenarioVersion: trajectory.scenarioVersion,
      asOfDate: trajectory.asOfDate,
      baselineFingerprint,
      methodologyVersion: "SCENARIOS_V2_EVENT_MONTHLY_1",
    },
    methodologyVersion: GOAL_METHODOLOGY_VERSION,
  };
}

export function evaluateGoalAgainstTrajectory(input: {
  goal: GoalVersionDefinition;
  trajectory: ScenarioPath;
  reportingCurrency: string;
  baselineFingerprint?: string | null;
  currentBaselineFingerprint?: string | null;
}): GoalTrajectoryEvaluation {
  const dormant = inactive(input.goal);
  const trajectoryBlockers = input.trajectory.blockers.map((item) =>
    blocker(item.code, item.message, { blocking: item.blocking, source: "SCENARIOS_V2" }),
  );
  if (dormant || input.trajectory.completeness === "NOT_COMPUTABLE") {
    return nonComputableTrajectory(
      input.goal,
      input.trajectory,
      [
        ...(dormant ? [dormant] : []),
        ...(input.trajectory.completeness === "NOT_COMPUTABLE"
          ? [blocker("TRAJECTORY_NOT_COMPUTABLE", "Trajectoire Scenarios V2 non calculable")]
          : []),
        ...trajectoryBlockers,
      ],
      input.baselineFingerprint ?? null,
    );
  }
  const selected = pointsForTarget(input.goal, input.trajectory);
  if (!selected.observation) {
    return nonComputableTrajectory(
      input.goal,
      input.trajectory,
      [...selected.blockers, ...trajectoryBlockers],
      input.baselineFingerprint ?? null,
    );
  }
  const observation = resolveProjectedGoalMetric(
    input.goal.target,
    selected.observation,
    input.reportingCurrency,
  );
  if (observation.value === null) {
    return nonComputableTrajectory(
      input.goal,
      input.trajectory,
      [...observation.blockers, ...trajectoryBlockers],
      input.baselineFingerprint ?? null,
    );
  }
  const firstAttainment = input.trajectory.monthly
    .filter((point) => point.date >= input.trajectory.asOfDate)
    .find((point) => {
      const metric = resolveProjectedGoalMetric(input.goal.target, point, input.reportingCurrency);
      return metric.value !== null && targetSatisfied(metric.value, input.goal.target);
    });
  const windowSatisfied = selected.candidates.some((point) => {
    const metric = resolveProjectedGoalMetric(input.goal.target, point, input.reportingCurrency);
    return metric.value !== null && targetSatisfied(metric.value, input.goal.target);
  });
  const satisfied = input.goal.targetWindow
    ? windowSatisfied
    : targetSatisfied(observation.value, input.goal.target);
  const stale =
    input.baselineFingerprint !== undefined &&
    input.currentBaselineFingerprint !== undefined &&
    input.baselineFingerprint !== null &&
    input.currentBaselineFingerprint !== null &&
    input.baselineFingerprint !== input.currentBaselineFingerprint;
  const partial = input.trajectory.completeness === "PARTIAL";
  const deadline = input.goal.targetDate ?? input.goal.targetWindow?.endDate ?? null;
  let status: GoalTrajectoryEvaluation["status"];
  if (satisfied) {
    status = deadline && deadline <= input.trajectory.asOfDate ? "ACHIEVED" : "ON_TRACK";
  } else if (deadline && deadline < input.trajectory.asOfDate) {
    status = "OVERDUE";
  } else if (deadline) {
    status = "OFF_TRACK";
  } else {
    status = "AT_RISK";
  }
  if ((partial || stale) && status === "ON_TRACK") status = "AT_RISK";
  const evaluationBlockers = [
    ...trajectoryBlockers,
    ...(partial
      ? [blocker("TRAJECTORY_PARTIAL", "Trajectoire partielle", { blocking: false })]
      : []),
    ...(stale
      ? [blocker("STALE_BASELINE", "La baseline du scénario a changé", { blocking: false })]
      : []),
  ];
  return {
    goalId: input.goal.goalId,
    goalVersion: input.goal.version,
    target: input.goal.target,
    observation,
    projectedValueAtTargetDate: observation.value,
    projectedGapAtTargetDate: goalGap(observation.value, input.goal.target),
    satisfiedAtTargetDate: satisfied,
    firstProjectedAttainmentDate: firstAttainment?.date ?? null,
    status,
    blockers: evaluationBlockers,
    trajectory: {
      scenarioId: input.trajectory.scenarioId,
      scenarioVersion: input.trajectory.scenarioVersion,
      asOfDate: input.trajectory.asOfDate,
      baselineFingerprint: input.baselineFingerprint ?? null,
      methodologyVersion: "SCENARIOS_V2_EVENT_MONTHLY_1",
    },
    methodologyVersion: GOAL_METHODOLOGY_VERSION,
  };
}

export function evaluateGoalAttainmentProbability(input: {
  goal: GoalVersionDefinition;
  samplePaths?: ScenarioPath[] | null;
  reportingCurrency: string;
}): GoalAttainmentProbability {
  if (!input.samplePaths?.length) {
    return {
      probability: null,
      successfulSamples: null,
      totalSamples: null,
      status: "NOT_COMPUTABLE",
      blockers: [
        blocker(
          "MONTE_CARLO_SAMPLES_UNAVAILABLE",
          "Les percentiles agrégés ne permettent pas de calculer une probabilité d’atteinte",
        ),
      ],
    };
  }
  const evaluations = input.samplePaths.map((trajectory) =>
    evaluateGoalAgainstTrajectory({
      goal: input.goal,
      trajectory,
      reportingCurrency: input.reportingCurrency,
    }),
  );
  if (evaluations.some((evaluation) => evaluation.satisfiedAtTargetDate === null)) {
    return {
      probability: null,
      successfulSamples: null,
      totalSamples: input.samplePaths.length,
      status: "NOT_COMPUTABLE",
      blockers: [blocker("TRAJECTORY_NOT_COMPUTABLE", "Au moins un sample est non calculable")],
    };
  }
  const successfulSamples = evaluations.filter(
    (evaluation) => evaluation.satisfiedAtTargetDate,
  ).length;
  return {
    probability: successfulSamples / evaluations.length,
    successfulSamples,
    totalSamples: evaluations.length,
    status: "COMPUTABLE",
    blockers: [],
  };
}
