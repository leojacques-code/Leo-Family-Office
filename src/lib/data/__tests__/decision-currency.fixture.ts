import { createDecisionOption } from "@/lib/engine/decision-lab";
import { createScenarioVersion } from "@/lib/engine/scenario-engine";
import { createGoalVersion } from "@/lib/engine/goal-engine";
import type { DecisionEvaluation, DecisionMetricDelta } from "@/lib/engine/decision-contracts";
import type { GoalTrajectoryEvaluation } from "@/lib/engine/goal-contracts";

/** Résultats saisis pour tester les unités et snapshots, sans appeler un moteur de calcul. */
export function decisionCurrencyFixture(currency: string | null = "USD"): DecisionEvaluation {
  const date = "2026-09-23";
  const createdAt = `${date}T00:00:00.000Z`;
  const methodologyVersion = "DECISION_LAB_V2_SCENARIOS_GOALS_1" as const;
  const goal = createGoalVersion({
    goalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Objectif CHF",
    purpose: "CAPITAL",
    priority: 2,
    target: {
      metric: "NET_WORTH",
      operator: "AT_LEAST",
      value: 1200,
      currency: "CHF",
      entityId: null,
    },
    targetDate: "2027-09-23",
    createdAt,
  });
  const caseVersion: DecisionEvaluation["caseVersion"] = {
    schemaVersion: 2,
    methodologyVersion,
    caseId: "11111111-1111-4111-8111-111111111111",
    version: 1,
    name: "Devises de recette",
    description: null,
    decisionType: "SCENARIO_COMPARISON",
    status: "DRAFT",
    asOfDate: date,
    horizonMonths: 12,
    baseline: {
      kind: "CANONICAL_AS_OF",
      asOfDate: date,
      openingFingerprint: "fixture-opening",
      eventSetVersion: "fixture-events",
      eventIds: [],
    },
    selectedGoals: [
      { goalId: goal.goalId, goalVersion: 1, constraintStrength: "SOFT", definition: goal },
    ],
    options: ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"].map(
      (scenarioId, i) =>
        createDecisionOption({
          id: `OPTION_${i}`,
          name: `Scénario ${i + 1}`,
          definition: createScenarioVersion({
            scenarioId,
            asOfDate: date,
            horizonMonths: 12,
            createdAt,
          }),
        }),
    ),
    createdAt,
  };
  const amounts: DecisionMetricDelta = {
    netWorth: 1200,
    liquidNetWorth: null,
    cash: 0,
    fundingGap: null,
    debt: null,
    investmentAssets: null,
    realEstateAndBusinessAssets: null,
    income: null,
    expenses: null,
    taxes: null,
  };
  const trajectory: GoalTrajectoryEvaluation = {
    goalId: goal.goalId,
    goalVersion: 1,
    target: goal.target,
    observation: {
      metric: "NET_WORTH",
      value: 800,
      currency: "CHF",
      observedAt: date,
      status: "COMPLETE",
      blockers: [],
      provenance: {
        source: "fixture",
        methodologyVersion: goal.methodologyVersion,
        entityId: null,
      },
    },
    projectedValueAtTargetDate: 800,
    projectedGapAtTargetDate: { absoluteGap: 400, relativeGap: null, shortfall: 400, surplus: 0 },
    satisfiedAtTargetDate: false,
    firstProjectedAttainmentDate: null,
    status: "OFF_TRACK",
    blockers: [],
    trajectory: {
      scenarioId: null,
      scenarioVersion: null,
      asOfDate: date,
      baselineFingerprint: "fixture-opening",
      methodologyVersion: "SCENARIOS_V2_EVENT_MONTHLY_1",
    },
    methodologyVersion: goal.methodologyVersion,
  };
  return {
    reportingCurrency: currency,
    caseVersion,
    run: {
      id: "44444444-4444-4444-8444-444444444444",
      caseId: caseVersion.caseId,
      caseVersion: 1,
      optionReferences: caseVersion.options.map((x) => x.scenarioReference),
      goalReferences: [{ goalId: goal.goalId, goalVersion: 1 }],
      baselineFingerprint: "fixture-opening",
      methodologyVersion,
      asOfDate: date,
      horizonMonths: 12,
      runMode: "DETERMINISTIC",
      seed: null,
      createdAt,
      staleStatus: "CURRENT",
    },
    completeness: "PARTIAL",
    conclusion: "NO_UNIQUE_WINNER",
    dominantOptionId: null,
    baseline: { date, ...amounts },
    options: caseVersion.options.map((option) => ({
      option,
      completeness: "PARTIAL",
      scenarioCompleteness: "PARTIAL",
      terminal: { date: "2027-09-23", ...amounts, netWorth: 1500 },
      deltaVsBaseline: { ...amounts, netWorth: 300 },
      fundingGapPeriods: [],
      goalImpacts: [
        {
          goalId: goal.goalId,
          goalVersion: 1,
          constraintStrength: "SOFT",
          baseline: structuredClone(trajectory),
          option: structuredClone(trajectory),
          probabilityOfAttainment: {
            probability: null,
            successfulSamples: null,
            totalSamples: null,
            status: "NOT_COMPUTABLE",
            blockers: [],
          },
          impact: "UNCHANGED",
          hardConstraintViolated: false,
        },
      ],
      blockers: [],
      assumptions: [],
      provenance: {
        engines: [],
        methodologyVersions: [],
        baselineFingerprint: "fixture-opening",
        scenarioId: option.scenarioReference.scenarioId,
        scenarioVersion: 1,
        sourceEventIds: [],
      },
    })),
    pairComparisons: [],
    tradeOffs: caseVersion.options.map((option) => ({
      optionId: option.id,
      improvedGoalIds: [],
      degradedGoalIds: [],
      unchangedGoalIds: [goal.goalId],
      violatedHardGoalIds: [],
      newBlockerCodes: [],
    })),
    blockers: [],
    provenance: {
      baseline: caseVersion.baseline,
      baselineEventIds: [],
      methodologyVersions: [methodologyVersion],
    },
  };
}
