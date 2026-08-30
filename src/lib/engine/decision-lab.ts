import type { CanonicalEvent } from "@/lib/engine/event-contracts";
import {
  evaluateGoalAgainstTrajectory,
  evaluateGoalAttainmentProbability,
} from "@/lib/engine/goal-engine";
import type { GoalTrajectoryEvaluation } from "@/lib/engine/goal-contracts";
import type { OpeningBalanceSheet } from "@/lib/engine/monthly-financial-model";
import {
  buildBaselineReference,
  runScenarioComparison,
  scenarioFingerprint,
} from "@/lib/engine/scenario-engine";
import {
  SCENARIO_METHODOLOGY_VERSION,
  type ScenarioPath,
  type ScenarioPathMetric,
} from "@/lib/engine/scenario-contracts";
import {
  DECISION_LAB_METHODOLOGY_VERSION,
  DECISION_LAB_V2_SCHEMA_VERSION,
  type DecisionBlocker,
  type DecisionCaseVersion,
  type DecisionCompleteness,
  type DecisionConclusion,
  type DecisionEvaluation,
  type DecisionFundingGapPeriod,
  type DecisionGoalImpact,
  type DecisionMetricDelta,
  type DecisionMetricSnapshot,
  type DecisionOption,
  type DecisionOptionEvaluation,
  type DecisionPairComparison,
  type DecisionRun,
  type DecisionStaleStatus,
} from "@/lib/engine/decision-contracts";

const ZERO_DELTA: DecisionMetricDelta = {
  netWorth: 0,
  liquidNetWorth: 0,
  cash: 0,
  fundingGap: 0,
  debt: 0,
  investmentAssets: 0,
  realEstateAndBusinessAssets: 0,
  income: 0,
  expenses: 0,
  taxes: 0,
};

function decisionBlocker(
  code: string,
  message: string,
  options: Partial<DecisionBlocker> = {},
): DecisionBlocker {
  return {
    code,
    message,
    source: options.source ?? "DECISION_LAB_V2",
    blocking: options.blocking ?? true,
    optionId: options.optionId ?? null,
    goalId: options.goalId ?? null,
  };
}

function metric(
  point: ScenarioPathMetric | undefined,
  fallbackDate: string,
): DecisionMetricSnapshot {
  if (!point) {
    return {
      date: fallbackDate,
      netWorth: null,
      liquidNetWorth: null,
      cash: null,
      fundingGap: null,
      debt: null,
      investmentAssets: null,
      realEstateAndBusinessAssets: null,
      income: null,
      expenses: null,
      taxes: null,
    };
  }
  return {
    date: point.date,
    netWorth: point.netWorth,
    liquidNetWorth: point.liquidNetWorth,
    cash: point.cash,
    fundingGap: point.fundingGap,
    debt: point.debt,
    investmentAssets: point.investmentAssets,
    realEstateAndBusinessAssets: point.realEstateAndBusinessAssets,
    income: point.income,
    expenses: point.expenses,
    taxes: point.taxes,
  };
}

function subtract(
  left: DecisionMetricSnapshot,
  right: DecisionMetricSnapshot,
): DecisionMetricDelta {
  const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  return {
    netWorth: delta(left.netWorth, right.netWorth),
    liquidNetWorth: delta(left.liquidNetWorth, right.liquidNetWorth),
    cash: delta(left.cash, right.cash),
    fundingGap: delta(left.fundingGap, right.fundingGap),
    debt: delta(left.debt, right.debt),
    investmentAssets: delta(left.investmentAssets, right.investmentAssets),
    realEstateAndBusinessAssets: delta(
      left.realEstateAndBusinessAssets,
      right.realEstateAndBusinessAssets,
    ),
    income: delta(left.income, right.income),
    expenses: delta(left.expenses, right.expenses),
    taxes: delta(left.taxes, right.taxes),
  };
}

function negate(delta: DecisionMetricDelta): DecisionMetricDelta {
  return Object.fromEntries(
    Object.entries(delta).map(([key, value]) => [key, value === null ? null : -value]),
  ) as unknown as DecisionMetricDelta;
}

function fundingGapPeriods(path: ScenarioPath): DecisionFundingGapPeriod[] {
  const periods: DecisionFundingGapPeriod[] = [];
  for (const point of path.monthly) {
    if (point.fundingGap <= 0) continue;
    const current = periods.at(-1);
    if (current && current.endDate.slice(0, 7) === previousMonth(point.date)) {
      current.endDate = point.date;
      current.peak = Math.max(current.peak, point.fundingGap);
    } else {
      periods.push({ startDate: point.date, endDate: point.date, peak: point.fundingGap });
    }
  }
  return periods;
}

function previousMonth(date: string): string {
  const parsed = new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() - 1);
  return parsed.toISOString().slice(0, 7);
}

function goalImpact(
  baseline: GoalTrajectoryEvaluation,
  option: GoalTrajectoryEvaluation,
): DecisionGoalImpact["impact"] {
  if (
    baseline.projectedGapAtTargetDate === null ||
    option.projectedGapAtTargetDate === null ||
    baseline.satisfiedAtTargetDate === null ||
    option.satisfiedAtTargetDate === null
  )
    return "NOT_COMPUTABLE";
  if (!baseline.satisfiedAtTargetDate && option.satisfiedAtTargetDate) return "IMPROVED";
  if (baseline.satisfiedAtTargetDate && !option.satisfiedAtTargetDate) return "DEGRADED";
  const change =
    option.projectedGapAtTargetDate.shortfall - baseline.projectedGapAtTargetDate.shortfall;
  if (change < -1e-6) return "IMPROVED";
  if (change > 1e-6) return "DEGRADED";
  return "UNCHANGED";
}

function completenessOf(
  scenario: ScenarioPath["completeness"],
  blockers: DecisionBlocker[],
): DecisionCompleteness {
  if (scenario === "NOT_COMPUTABLE" || blockers.some((item) => item.blocking))
    return "NOT_COMPUTABLE";
  if (scenario === "PARTIAL" || blockers.length) return "PARTIAL";
  return "READY";
}

function optionFromFailure(
  option: DecisionOption,
  date: string,
  baselineFingerprint: string,
  blocker: DecisionBlocker,
): DecisionOptionEvaluation {
  return {
    option,
    completeness: "NOT_COMPUTABLE",
    scenarioCompleteness: "NOT_COMPUTABLE",
    terminal: metric(undefined, date),
    deltaVsBaseline: Object.fromEntries(
      Object.keys(ZERO_DELTA).map((key) => [key, null]),
    ) as unknown as DecisionMetricDelta,
    fundingGapPeriods: [],
    goalImpacts: [],
    blockers: [blocker],
    assumptions: option.assumptions,
    provenance: {
      engines: ["SCENARIOS_V2", "GOALS_V2"],
      methodologyVersions: [SCENARIO_METHODOLOGY_VERSION, DECISION_LAB_METHODOLOGY_VERSION],
      baselineFingerprint,
      scenarioId: option.scenarioReference.scenarioId,
      scenarioVersion: option.scenarioReference.scenarioVersion,
      sourceEventIds: [],
    },
  };
}

function validateCase(version: DecisionCaseVersion): DecisionBlocker[] {
  const blockers: DecisionBlocker[] = [];
  if (version.schemaVersion !== DECISION_LAB_V2_SCHEMA_VERSION)
    blockers.push(
      decisionBlocker("INVALID_CASE_VERSION", "Version de contrat Decision Lab invalide"),
    );
  if (version.methodologyVersion !== DECISION_LAB_METHODOLOGY_VERSION)
    blockers.push(
      decisionBlocker("INCOMPATIBLE_METHODOLOGY", "Méthodologie Decision Lab incompatible"),
    );
  if (version.options.length < 2 || version.options.length > 3)
    blockers.push(decisionBlocker("INVALID_OPTION_COUNT", "Deux ou trois options sont requises"));
  if (new Set(version.options.map((option) => option.id)).size !== version.options.length)
    blockers.push(
      decisionBlocker("DUPLICATE_OPTION", "Les identifiants d'option doivent être uniques"),
    );
  for (const option of version.options) {
    const definition = option.scenarioDefinition;
    if (
      definition.asOfDate !== version.asOfDate ||
      definition.horizonMonths !== version.horizonMonths ||
      definition.methodologyVersion !== SCENARIO_METHODOLOGY_VERSION
    ) {
      blockers.push(
        decisionBlocker(
          "INCOMPATIBLE_METHODOLOGY",
          `L'option ${option.name} ne partage pas asOf, horizon et méthodologie`,
          { optionId: option.id },
        ),
      );
    }
    if (
      option.scenarioReference.scenarioId !== definition.scenarioId ||
      option.scenarioReference.scenarioVersion !== definition.version ||
      option.scenarioReference.definitionFingerprint !== scenarioFingerprint(definition)
    ) {
      blockers.push(
        decisionBlocker(
          "STALE_SCENARIO_VERSION",
          `Référence scénario périmée pour ${option.name}`,
          {
            optionId: option.id,
          },
        ),
      );
    }
  }
  for (const selected of version.selectedGoals) {
    if (
      selected.goalId !== selected.definition.goalId ||
      selected.goalVersion !== selected.definition.version ||
      selected.constraintStrength !== selected.definition.constraintStrength
    )
      blockers.push(
        decisionBlocker("STALE_GOAL_VERSION", "Référence Goal incohérente", {
          goalId: selected.goalId,
        }),
      );
  }
  return blockers;
}

function pairComparisons(options: DecisionOptionEvaluation[]): DecisionPairComparison[] {
  const result: DecisionPairComparison[] = [];
  for (let left = 0; left < options.length; left += 1) {
    for (let right = left + 1; right < options.length; right += 1) {
      const delta = subtract(options[left].terminal, options[right].terminal);
      result.push({
        leftOptionId: options[left].option.id,
        rightOptionId: options[right].option.id,
        delta,
        opportunityCost: negate(delta),
      });
    }
  }
  return result;
}

function dominates(left: DecisionOptionEvaluation, right: DecisionOptionEvaluation): boolean {
  if (left.completeness === "NOT_COMPUTABLE" || right.completeness === "NOT_COMPUTABLE")
    return false;
  if (left.blockers.some((item) => item.blocking)) return false;
  if (left.fundingGapPeriods.length > right.fundingGapPeriods.length) return false;
  let strictlyBetter = false;
  for (const goal of left.goalImpacts) {
    const other = right.goalImpacts.find((item) => item.goalId === goal.goalId);
    if (!other) return false;
    const leftGap = goal.option.projectedGapAtTargetDate?.shortfall;
    const rightGap = other.option.projectedGapAtTargetDate?.shortfall;
    if (leftGap === undefined || rightGap === undefined) return false;
    if (leftGap > rightGap + 1e-6) return false;
    if (leftGap < rightGap - 1e-6) strictlyBetter = true;
    if (goal.hardConstraintViolated && !other.hardConstraintViolated) return false;
  }
  return strictlyBetter;
}

function conclusionOf(options: DecisionOptionEvaluation[]): {
  conclusion: DecisionConclusion;
  dominantOptionId: string | null;
} {
  if (!options.length || options.every((item) => item.completeness === "NOT_COMPUTABLE"))
    return { conclusion: "NOT_COMPUTABLE", dominantOptionId: null };
  if (options.some((item) => item.completeness === "NOT_COMPUTABLE"))
    return { conclusion: "INCOMPARABLE", dominantOptionId: null };
  const dominant = options.filter((candidate) =>
    options.every((other) => candidate === other || dominates(candidate, other)),
  );
  if (dominant.length === 1)
    return { conclusion: "DOMINANT_OPTION", dominantOptionId: dominant[0].option.id };
  const tradeOff = options.some(
    (item) =>
      item.goalImpacts.some((goal) => goal.impact === "IMPROVED") &&
      item.goalImpacts.some((goal) => goal.impact === "DEGRADED"),
  );
  return { conclusion: tradeOff ? "TRADE_OFF" : "NO_UNIQUE_WINNER", dominantOptionId: null };
}

export function createDecisionOption(input: {
  id: string;
  name: string;
  description?: string;
  definition: DecisionOption["scenarioDefinition"];
  source?: string;
}): DecisionOption {
  return {
    id: input.id,
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    scenarioReference: {
      scenarioId: input.definition.scenarioId,
      scenarioVersion: input.definition.version,
      methodologyVersion: input.definition.methodologyVersion,
      definitionFingerprint: scenarioFingerprint(input.definition),
    },
    scenarioDefinition: structuredClone(input.definition),
    assumptions: structuredClone(input.definition.assumptions),
    provenance: {
      source: input.source ?? "Scenarios V2",
      createdBy: "USER",
      notes: [],
    },
  };
}

export function isDecisionCaseVersion(value: unknown): value is DecisionCaseVersion {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DecisionCaseVersion>;
  return (
    candidate.schemaVersion === DECISION_LAB_V2_SCHEMA_VERSION &&
    candidate.methodologyVersion === DECISION_LAB_METHODOLOGY_VERSION &&
    typeof candidate.caseId === "string" &&
    Number.isInteger(candidate.version) &&
    Number(candidate.version) > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    ["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"].includes(String(candidate.status)) &&
    typeof candidate.asOfDate === "string" &&
    Number.isInteger(candidate.horizonMonths) &&
    Number(candidate.horizonMonths) >= 1 &&
    Number(candidate.horizonMonths) <= 960 &&
    Boolean(candidate.baseline?.openingFingerprint) &&
    Array.isArray(candidate.options) &&
    candidate.options.length >= 2 &&
    candidate.options.length <= 3 &&
    Array.isArray(candidate.selectedGoals) &&
    typeof candidate.createdAt === "string"
  );
}

export function createDecisionCaseVersion(input: {
  caseId: string;
  version?: number;
  name: string;
  description?: string | null;
  decisionType?: string;
  status?: DecisionCaseVersion["status"];
  opening: OpeningBalanceSheet;
  baselineEvents: CanonicalEvent[];
  options: DecisionOption[];
  selectedGoals?: DecisionCaseVersion["selectedGoals"];
  createdAt?: string;
}): DecisionCaseVersion {
  const first = input.options[0]?.scenarioDefinition;
  if (!first) throw new Error("Au moins une option est nécessaire pour définir le cas");
  const baselineTimeline = runScenarioComparison({
    baselineEvents: input.baselineEvents,
    opening: input.opening,
    definition: first,
  }).baseline.timeline;
  return {
    schemaVersion: DECISION_LAB_V2_SCHEMA_VERSION,
    methodologyVersion: DECISION_LAB_METHODOLOGY_VERSION,
    caseId: input.caseId,
    version: input.version ?? 1,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    decisionType: input.decisionType ?? "SCENARIO_COMPARISON",
    status: input.status ?? "DRAFT",
    asOfDate: first.asOfDate,
    horizonMonths: first.horizonMonths,
    baseline: buildBaselineReference({ opening: input.opening, timeline: baselineTimeline }),
    selectedGoals: structuredClone(input.selectedGoals ?? []),
    options: structuredClone(input.options),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function evaluateDecisionCase(input: {
  caseVersion: DecisionCaseVersion;
  baselineEvents: CanonicalEvent[];
  opening: OpeningBalanceSheet;
  reportingCurrency: string;
  runId?: string;
  createdAt?: string;
  runMode?: DecisionRun["runMode"];
  seed?: number | null;
  currentScenarioVersions?: Record<string, number>;
  currentGoalVersions?: Record<string, number>;
  samplePathsByOptionId?: Record<string, ScenarioPath[] | undefined>;
}): DecisionEvaluation {
  const actualTimeline = runScenarioComparison({
    baselineEvents: input.baselineEvents,
    opening: input.opening,
    definition: input.caseVersion.options[0].scenarioDefinition,
    reportingCurrency: input.reportingCurrency,
  }).baseline.timeline;
  const actualBaseline = buildBaselineReference({
    opening: input.opening,
    timeline: actualTimeline,
  });
  const validationBlockers = validateCase(input.caseVersion);
  if (actualBaseline.openingFingerprint !== input.caseVersion.baseline.openingFingerprint) {
    validationBlockers.push(
      decisionBlocker("STALE_BASELINE", "Le bilan canonique a changé depuis la version du cas"),
    );
  }
  let staleStatus: DecisionStaleStatus = validationBlockers.some(
    (item) => item.code === "STALE_BASELINE",
  )
    ? "STALE_BASELINE"
    : "CURRENT";
  for (const option of input.caseVersion.options) {
    const current = input.currentScenarioVersions?.[option.scenarioReference.scenarioId];
    if (current !== undefined && current !== option.scenarioReference.scenarioVersion) {
      validationBlockers.push(
        decisionBlocker(
          "STALE_SCENARIO_VERSION",
          `Une version plus récente existe pour ${option.name}`,
          {
            optionId: option.id,
            blocking: false,
          },
        ),
      );
      if (staleStatus === "CURRENT") staleStatus = "STALE_REFERENCE";
    }
  }
  for (const goal of input.caseVersion.selectedGoals) {
    const current = input.currentGoalVersions?.[goal.goalId];
    if (current !== undefined && current !== goal.goalVersion) {
      validationBlockers.push(
        decisionBlocker("STALE_GOAL_VERSION", "Une version plus récente existe pour ce Goal", {
          goalId: goal.goalId,
          blocking: false,
        }),
      );
      if (staleStatus === "CURRENT") staleStatus = "STALE_REFERENCE";
    }
  }
  const incompatible = validationBlockers.some(
    (item) => item.blocking && item.code !== "STALE_BASELINE",
  );
  let baselineMetric = metric(undefined, input.caseVersion.asOfDate);
  const options: DecisionOptionEvaluation[] = input.caseVersion.options.map((option) => {
    if (incompatible) {
      const reason =
        validationBlockers.find((item) => item.optionId === option.id && item.blocking) ??
        validationBlockers.find((item) => item.blocking)!;
      return optionFromFailure(
        option,
        input.caseVersion.asOfDate,
        actualBaseline.openingFingerprint,
        reason,
      );
    }
    const comparison = runScenarioComparison({
      baselineEvents: input.baselineEvents,
      opening: input.opening,
      definition: option.scenarioDefinition,
      reportingCurrency: input.reportingCurrency,
    });
    const baselineTerminal = metric(comparison.baseline.monthly.at(-1), input.caseVersion.asOfDate);
    baselineMetric = baselineTerminal;
    const terminal = metric(comparison.scenario.monthly.at(-1), input.caseVersion.asOfDate);
    const blockers: DecisionBlocker[] = comparison.blockers.map((item) =>
      decisionBlocker(item.code, item.message, {
        source: "SCENARIOS_V2",
        blocking: item.blocking,
        optionId: option.id,
      }),
    );
    const goalImpacts: DecisionGoalImpact[] = input.caseVersion.selectedGoals.map((selected) => {
      const baseline = evaluateGoalAgainstTrajectory({
        goal: selected.definition,
        trajectory: comparison.baseline,
        reportingCurrency: input.reportingCurrency,
        baselineFingerprint: input.caseVersion.baseline.openingFingerprint,
        currentBaselineFingerprint: actualBaseline.openingFingerprint,
      });
      const projected = evaluateGoalAgainstTrajectory({
        goal: selected.definition,
        trajectory: comparison.scenario,
        reportingCurrency: input.reportingCurrency,
        baselineFingerprint: input.caseVersion.baseline.openingFingerprint,
        currentBaselineFingerprint: actualBaseline.openingFingerprint,
      });
      const probability = evaluateGoalAttainmentProbability({
        goal: selected.definition,
        samplePaths: input.samplePathsByOptionId?.[option.id],
        reportingCurrency: input.reportingCurrency,
      });
      for (const item of projected.blockers) {
        blockers.push(
          decisionBlocker(item.code, item.message, {
            source: "GOALS_V2",
            blocking: item.blocking,
            optionId: option.id,
            goalId: selected.goalId,
          }),
        );
      }
      return {
        goalId: selected.goalId,
        goalVersion: selected.goalVersion,
        constraintStrength: selected.constraintStrength,
        baseline,
        option: projected,
        probabilityOfAttainment: probability,
        impact: goalImpact(baseline, projected),
        hardConstraintViolated:
          selected.constraintStrength === "HARD" && projected.satisfiedAtTargetDate === false,
      };
    });
    return {
      option,
      completeness: completenessOf(comparison.completeness, blockers),
      scenarioCompleteness: comparison.completeness,
      terminal,
      deltaVsBaseline: subtract(terminal, baselineTerminal),
      fundingGapPeriods: fundingGapPeriods(comparison.scenario),
      goalImpacts,
      blockers,
      assumptions: option.assumptions,
      provenance: {
        engines: ["EVENT_ENGINE_V1", "MONTHLY_FINANCIAL_MODEL", "SCENARIOS_V2", "GOALS_V2"],
        methodologyVersions: [
          SCENARIO_METHODOLOGY_VERSION,
          ...new Set(goalImpacts.map((item) => item.option.methodologyVersion)),
          DECISION_LAB_METHODOLOGY_VERSION,
        ],
        baselineFingerprint: actualBaseline.openingFingerprint,
        scenarioId: option.scenarioReference.scenarioId,
        scenarioVersion: option.scenarioReference.scenarioVersion,
        sourceEventIds: comparison.scenario.timeline.events.map((event) => event.id),
      },
    };
  });
  const derived = conclusionOf(options);
  const tradeOffs = options.map((option) => ({
    optionId: option.option.id,
    improvedGoalIds: option.goalImpacts
      .filter((item) => item.impact === "IMPROVED")
      .map((item) => item.goalId),
    degradedGoalIds: option.goalImpacts
      .filter((item) => item.impact === "DEGRADED")
      .map((item) => item.goalId),
    unchangedGoalIds: option.goalImpacts
      .filter((item) => item.impact === "UNCHANGED")
      .map((item) => item.goalId),
    violatedHardGoalIds: option.goalImpacts
      .filter((item) => item.hardConstraintViolated)
      .map((item) => item.goalId),
    newBlockerCodes: [...new Set(option.blockers.map((item) => item.code))],
  }));
  const allBlockers = [...validationBlockers, ...options.flatMap((option) => option.blockers)];
  const completeness: DecisionCompleteness = options.every(
    (option) => option.completeness === "NOT_COMPUTABLE",
  )
    ? "NOT_COMPUTABLE"
    : options.some((option) => option.completeness !== "READY") || allBlockers.length
      ? "PARTIAL"
      : "READY";
  const run: DecisionRun = {
    id: input.runId ?? crypto.randomUUID(),
    caseId: input.caseVersion.caseId,
    caseVersion: input.caseVersion.version,
    optionReferences: input.caseVersion.options.map((option) => option.scenarioReference),
    goalReferences: input.caseVersion.selectedGoals.map((goal) => ({
      goalId: goal.goalId,
      goalVersion: goal.goalVersion,
    })),
    baselineFingerprint: actualBaseline.openingFingerprint,
    methodologyVersion: DECISION_LAB_METHODOLOGY_VERSION,
    asOfDate: input.caseVersion.asOfDate,
    horizonMonths: input.caseVersion.horizonMonths,
    runMode: input.runMode ?? "DETERMINISTIC",
    seed: input.runMode === "MONTE_CARLO" ? (input.seed ?? null) : null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    staleStatus,
  };
  return {
    caseVersion: structuredClone(input.caseVersion),
    run,
    completeness,
    conclusion: incompatible ? "INCOMPARABLE" : derived.conclusion,
    dominantOptionId: incompatible ? null : derived.dominantOptionId,
    baseline: baselineMetric,
    options,
    pairComparisons: pairComparisons(options),
    tradeOffs,
    blockers: allBlockers,
    provenance: {
      baseline: actualBaseline,
      baselineEventIds: actualBaseline.eventIds,
      methodologyVersions: [SCENARIO_METHODOLOGY_VERSION, DECISION_LAB_METHODOLOGY_VERSION],
    },
  };
}
