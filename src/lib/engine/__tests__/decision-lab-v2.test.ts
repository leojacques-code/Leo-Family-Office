import { describe, expect, it } from "vitest";
import { compareDebtVsInvest } from "@/lib/engine/decision";
import {
  createDecisionCaseVersion,
  createDecisionOption,
  evaluateDecisionCase,
} from "@/lib/engine/decision-lab";
import type {
  DecisionCaseVersion,
  DecisionOption,
  DecisionSelectedGoal,
} from "@/lib/engine/decision-contracts";
import { createGoalVersion } from "@/lib/engine/goal-engine";
import type { GoalTargetMetric } from "@/lib/engine/goal-contracts";
import { createScenarioVersion, scenarioFingerprint } from "@/lib/engine/scenario-engine";
import type { PersistedScenarioEventOverride } from "@/lib/engine/scenario-contracts";
import {
  SCENARIO_AS_OF,
  scenarioEvent,
  scenarioOpening,
} from "@/lib/engine/__tests__/fixtures/scenarios-v2";

const CREATED_AT = "2026-08-28T08:00:00.000Z";
const RUN_AT = "2026-08-28T09:00:00.000Z";

const add = (
  id: string,
  event: ReturnType<typeof scenarioEvent> | null,
): PersistedScenarioEventOverride => ({
  id,
  operation: "ADD",
  baselineEventId: null,
  event,
  reason: "Decision Lab V2 test",
  createdAt: CREATED_AT,
});

const replace = (
  id: string,
  baselineEventId: string,
  event: ReturnType<typeof scenarioEvent> | null,
): PersistedScenarioEventOverride => ({
  id,
  operation: "REPLACE",
  baselineEventId,
  event,
  reason: "Decision Lab V2 test",
  createdAt: CREATED_AT,
});

const cancel = (id: string, baselineEventId: string): PersistedScenarioEventOverride => ({
  id,
  operation: "CANCEL",
  baselineEventId,
  event: null,
  reason: "Decision Lab V2 test",
  createdAt: CREATED_AT,
});

function option(
  id: string,
  overrides: PersistedScenarioEventOverride[] = [],
  horizonMonths = 24,
  annualReturn = 0,
): DecisionOption {
  const definition = createScenarioVersion({
    scenarioId: `scenario-${id}`,
    version: 1,
    asOfDate: SCENARIO_AS_OF,
    horizonMonths,
    overrides,
    market: { annualReturn, annualVolatility: 0, annualInflation: 0 },
    investmentAllocationRate: 0,
    createdAt: CREATED_AT,
  });
  return createDecisionOption({ id, name: `Option ${id}`, definition });
}

function selectedGoal(
  id: string,
  metric: GoalTargetMetric,
  value: number,
  strength: "HARD" | "SOFT" = "SOFT",
  targetDate = "2028-08-31",
): DecisionSelectedGoal {
  const operator = ["TOTAL_LIABILITIES", "FUNDING_GAP"].includes(metric)
    ? ("AT_MOST" as const)
    : ("AT_LEAST" as const);
  const definition = createGoalVersion({
    goalId: id,
    name: `Goal ${id}`,
    constraintStrength: strength,
    target: { metric, operator, value, currency: "EUR", entityId: null },
    targetDate,
    createdAt: CREATED_AT,
  });
  return { goalId: id, goalVersion: 1, constraintStrength: strength, definition };
}

const gift = () =>
  scenarioEvent({ id: "gift", date: "2027-01-10", cashIn: 10_000, income: 10_000 });
const purchase = () =>
  scenarioEvent({ id: "purchase", date: "2027-01-10", cashOut: 10_000, expense: 10_000 });
const repayment = () =>
  scenarioEvent({
    id: "repayment",
    date: "2027-01-10",
    domain: "DEBT",
    type: "EARLY_REPAYMENT",
    effectKind: "DEBT_SERVICE",
    cashOut: 10_000,
    debtPrincipal: 10_000,
    liabilityDelta: -10_000,
  });

function version(
  input: {
    options?: DecisionOption[];
    goals?: DecisionSelectedGoal[];
    baselineEvents?: ReturnType<typeof scenarioEvent>[];
  } = {},
): DecisionCaseVersion {
  return createDecisionCaseVersion({
    caseId: "case-v2",
    name: "Arbitrage test",
    opening: scenarioOpening,
    baselineEvents: input.baselineEvents ?? [],
    options: input.options ?? [option("A"), option("B", [add("gift", gift())])],
    selectedGoals: input.goals ?? [],
    createdAt: CREATED_AT,
  });
}

function evaluate(
  caseVersion = version(),
  baselineEvents: ReturnType<typeof scenarioEvent>[] = [],
  extra: Partial<Parameters<typeof evaluateDecisionCase>[0]> = {},
) {
  return evaluateDecisionCase({
    caseVersion,
    baselineEvents,
    opening: scenarioOpening,
    reportingCurrency: "EUR",
    runId: "run-v2",
    createdAt: RUN_AT,
    ...extra,
  });
}

describe("Decision Lab V2 — golden contract", () => {
  it("1. compare deux options sur la même baseline", () => {
    const result = evaluate();
    expect(result.options).toHaveLength(2);
    expect(new Set(result.options.map((item) => item.provenance.baselineFingerprint)).size).toBe(1);
  });

  it("2. compare trois options", () => {
    expect(
      evaluate(version({ options: [option("A"), option("B"), option("C")] })).options,
    ).toHaveLength(3);
  });

  it("3. conserve la baseline exacte dans la provenance", () => {
    const result = evaluate();
    expect(result.provenance.baseline.openingFingerprint).toBe(
      result.caseVersion.baseline.openingFingerprint,
    );
  });

  it("4. mêmes inputs produisent le même résultat hors identité de run fixée", () => {
    expect(evaluate()).toEqual(evaluate());
  });

  it("5. une option sans override égale la baseline", () => {
    expect(evaluate().options[0].deltaVsBaseline).toEqual(
      expect.objectContaining({ netWorth: 0, cash: 0, debt: 0 }),
    );
  });

  it("6. une option ADD est appliquée par Scenarios V2", () => {
    expect(evaluate().options[1].deltaVsBaseline.netWorth).toBe(10_000);
  });

  it("7. une option REPLACE remplace la conséquence baseline", () => {
    const old = scenarioEvent({ id: "old", date: "2027-01-10", cashIn: 2_000 });
    const newer = scenarioEvent({ id: "new", date: "2027-01-10", cashIn: 5_000 });
    const result = evaluate(
      version({
        options: [option("A"), option("B", [replace("replace", old.id, newer)])],
        baselineEvents: [old],
      }),
      [old],
    );
    expect(result.options[1].deltaVsBaseline.cash).toBe(3_000);
  });

  it("8. une option CANCEL annule une conséquence baseline", () => {
    const old = scenarioEvent({ id: "old", date: "2027-01-10", cashOut: 2_000 });
    const result = evaluate(
      version({
        options: [option("A"), option("B", [cancel("cancel", old.id)])],
        baselineEvents: [old],
      }),
      [old],
    );
    expect(result.options[1].deltaVsBaseline.cash).toBe(2_000);
  });

  it("9. impose les mêmes asOf, horizon et méthodologie", () => {
    expect(evaluate().blockers.some((item) => item.code === "INCOMPATIBLE_METHODOLOGY")).toBe(
      false,
    );
  });

  it("10. refuse des horizons incompatibles", () => {
    const result = evaluate(version({ options: [option("A"), option("B", [], 12)] }));
    expect(result.conclusion).toBe("INCOMPARABLE");
    expect(result.blockers.map((item) => item.code)).toContain("INCOMPATIBLE_METHODOLOGY");
  });

  it("11. calcule le delta vs baseline", () => {
    expect(evaluate().options[1].deltaVsBaseline.cash).toBe(10_000);
  });

  it("12. calcule le delta A vs B", () => {
    const pair = evaluate().pairComparisons[0];
    expect(pair.leftOptionId).toBe("A");
    expect(pair.delta.cash).toBe(-10_000);
  });

  it("13. compare le patrimoine net", () => {
    expect(evaluate().pairComparisons[0].delta.netWorth).toBe(-10_000);
  });

  it("14. compare le patrimoine liquide", () => {
    expect(evaluate().options[1].deltaVsBaseline.liquidNetWorth).toBe(10_000);
  });

  it("15. compare la dette via le Debt Engine", () => {
    const result = evaluate(
      version({ options: [option("A"), option("B", [add("repay", repayment())])] }),
    );
    expect(result.options[1].deltaVsBaseline.debt).toBe(-10_000);
  });

  it("16. conserve le chemin des funding gaps", () => {
    const huge = scenarioEvent({
      id: "huge",
      date: "2027-01-10",
      cashOut: 200_000,
      expense: 200_000,
    });
    const result = evaluate(version({ options: [option("A"), option("B", [add("huge", huge)])] }));
    expect(result.options[1].fundingGapPeriods[0].peak).toBeGreaterThan(0);
  });

  it("17. compare les revenus", () => {
    expect(evaluate().options[1].deltaVsBaseline.income).toBe(0);
    expect(evaluate().options[1].terminal.income).toBe(0);
  });

  it("18. compare les dépenses", () => {
    const result = evaluate(
      version({ options: [option("A"), option("B", [add("purchase", purchase())])] }),
    );
    expect(result.options[1].provenance.sourceEventIds).toContain("purchase");
  });

  it("19. compare les taxes sans formule locale", () => {
    const tax = scenarioEvent({
      id: "tax",
      date: "2028-08-10",
      domain: "TAX",
      type: "TAX_PAYMENT",
      effectKind: "TAX",
      cashOut: 1_000,
      taxCash: 1_000,
    });
    const result = evaluate(version({ options: [option("A"), option("B", [add("tax", tax)])] }));
    expect(result.options[1].terminal.taxes).toBe(1_000);
  });

  it("20. identifie un Goal HARD atteint", () => {
    const result = evaluate(
      version({ goals: [selectedGoal("cash", "IMMEDIATE_CASH", 105_000, "HARD")] }),
    );
    expect(result.options[1].goalImpacts[0].hardConstraintViolated).toBe(false);
  });

  it("21. identifie un Goal HARD violé", () => {
    const result = evaluate(
      version({
        options: [option("A"), option("B", [add("purchase", purchase())])],
        goals: [selectedGoal("cash", "IMMEDIATE_CASH", 95_000, "HARD")],
      }),
    );
    expect(result.options[1].goalImpacts[0].hardConstraintViolated).toBe(true);
  });

  it("22. identifie un Goal SOFT amélioré", () => {
    const result = evaluate(version({ goals: [selectedGoal("net", "NET_WORTH", 335_000)] }));
    expect(result.options[1].goalImpacts[0].impact).toBe("IMPROVED");
  });

  it("23. identifie un Goal SOFT dégradé", () => {
    const result = evaluate(
      version({
        options: [option("A"), option("B", [add("purchase", purchase())])],
        goals: [selectedGoal("cash", "IMMEDIATE_CASH", 95_000)],
      }),
    );
    expect(result.options[1].goalImpacts[0].impact).toBe("DEGRADED");
  });

  it("24. expose plusieurs Goals contradictoires", () => {
    const result = evaluate(
      version({
        options: [option("A", [add("gift", gift())]), option("B", [add("repay", repayment())])],
        goals: [
          selectedGoal("cash", "IMMEDIATE_CASH", 105_000),
          selectedGoal("debt", "TOTAL_LIABILITIES", 25_000),
        ],
      }),
    );
    expect(result.tradeOffs.flatMap((item) => item.improvedGoalIds)).toEqual(
      expect.arrayContaining(["cash", "debt"]),
    );
  });

  it("25. ne produit aucun score opaque", () => {
    expect(JSON.stringify(evaluate())).not.toMatch(/score/i);
  });

  it("26. démontre une option dominante objectivement", () => {
    const result = evaluate(version({ goals: [selectedGoal("net", "NET_WORTH", 335_000)] }));
    expect(result.conclusion).toBe("DOMINANT_OPTION");
    expect(result.dominantOptionId).toBe("B");
  });

  it("27. retourne no unique winner sans préférence objective", () => {
    expect(evaluate(version({ options: [option("A"), option("B")] })).conclusion).toBe(
      "NO_UNIQUE_WINNER",
    );
  });

  it("28. retourne incomparable pour des trajectoires incompatibles", () => {
    expect(evaluate(version({ options: [option("A"), option("B", [], 36)] })).conclusion).toBe(
      "INCOMPARABLE",
    );
  });

  it("29. propage les blockers Scenarios", () => {
    const blocked = scenarioEvent({
      id: "blocked",
      date: "2027-01-10",
      cashIn: null,
      blockers: ["MISSING_FX"],
    });
    expect(
      evaluate(version({ options: [option("A"), option("B", [add("blocked", blocked)])] }))
        .options[1].blockers.length,
    ).toBeGreaterThan(0);
  });

  it("30. propage les blockers Goals", () => {
    const result = evaluate(
      version({ goals: [selectedGoal("unsupported", "LIQUID_ASSETS", 100_000)] }),
    );
    expect(result.options[0].blockers.some((item) => item.source === "GOALS_V2")).toBe(true);
  });

  it("31. missing reste null et ne devient pas zéro", () => {
    const result = evaluate(version({ options: [option("A"), option("B", [], 12)] }));
    expect(result.options[1].terminal.netWorth).toBeNull();
  });

  it("32. détecte une baseline périmée", () => {
    const stale = version();
    stale.baseline.openingFingerprint = "fnv1a32:stale";
    expect(evaluate(stale).run.staleStatus).toBe("STALE_BASELINE");
  });

  it("33. détecte une version scénario périmée", () => {
    const current = Object.fromEntries(
      version().options.map((item) => [item.scenarioReference.scenarioId, 2]),
    );
    expect(
      evaluate(version(), [], { currentScenarioVersions: current }).blockers.map(
        (item) => item.code,
      ),
    ).toContain("STALE_SCENARIO_VERSION");
  });

  it("34. détecte une version Goal périmée", () => {
    const result = evaluate(version({ goals: [selectedGoal("net", "NET_WORTH", 335_000)] }), [], {
      currentGoalVersions: { net: 2 },
    });
    expect(result.blockers.map((item) => item.code)).toContain("STALE_GOAL_VERSION");
  });

  it("35. propage un horizon trop court pour la deadline", () => {
    const goal = selectedGoal("late", "NET_WORTH", 400_000, "SOFT", "2035-01-01");
    const result = evaluate(version({ goals: [goal] }));
    expect(result.options[0].blockers.map((item) => item.code)).toContain(
      "HORIZON_BEFORE_DEADLINE",
    );
  });

  it("36. Monte Carlo sans samples rend la probabilité non calculable", () => {
    const result = evaluate(version({ goals: [selectedGoal("net", "NET_WORTH", 335_000)] }), [], {
      runMode: "MONTE_CARLO",
      seed: 42,
    });
    expect(result.options[0].goalImpacts[0].probabilityOfAttainment.status).toBe("NOT_COMPUTABLE");
  });

  it("37. ne déduit aucune probabilité de percentiles", () => {
    const probability = evaluate(version({ goals: [selectedGoal("net", "NET_WORTH", 335_000)] }))
      .options[0].goalImpacts[0].probabilityOfAttainment;
    expect(probability.probability).toBeNull();
    expect(probability.blockers[0].message).toContain("percentiles");
  });

  it("38. conserve le cas exact d'une dette à 0 % dans le legacy", () => {
    expect(
      compareDebtVsInvest({
        availableCash: 5_000,
        debtBalance: 5_000,
        debtRate: 0,
        investmentReturn: 0.05,
        volatility: 0.1,
        inflation: 0.02,
        years: 5,
      }).repay.interestAvoided,
    ).toBe(0);
  });

  it("39. remboursement anticipé sans convention reste non calculable", () => {
    expect(
      compareDebtVsInvest({
        availableCash: 5_000,
        debtBalance: 5_000,
        debtRate: 0.03,
        investmentReturn: 0.05,
        volatility: 0.1,
        inflation: 0.02,
        years: 5,
      }).repay.interestAvoided,
    ).toBeNull();
  });

  it("40. les options de template peuvent porter exactement le même capital", () => {
    const repay = repayment();
    const invest = scenarioEvent({
      id: "invest",
      date: "2027-01-10",
      domain: "PORTFOLIO",
      type: "CONTRIBUTION",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 10_000,
      assetDelta: 10_000,
    });
    expect(repay.consequences[0].cashOut).toBe(invest.consequences[0].cashOut);
  });

  it("41. une contribution portefeuille ne double-compte pas le capital", () => {
    const invest = scenarioEvent({
      id: "invest",
      date: "2027-01-10",
      domain: "PORTFOLIO",
      type: "CONTRIBUTION",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 10_000,
      assetDelta: 10_000,
    });
    const result = evaluate(
      version({ options: [option("A"), option("B", [add("invest", invest)])] }),
    );
    expect(result.options[1].deltaVsBaseline.netWorth).toBe(0);
  });

  it("42. ne mute pas l'état courant", () => {
    const opening = structuredClone(scenarioOpening);
    evaluateDecisionCase({
      caseVersion: version(),
      baselineEvents: [],
      opening,
      reportingCurrency: "EUR",
      runId: "run",
      createdAt: RUN_AT,
    });
    expect(opening).toEqual(scenarioOpening);
  });

  it("43. ne mute pas les définitions scénario", () => {
    const current = version();
    const before = JSON.stringify(current.options);
    evaluate(current);
    expect(JSON.stringify(current.options)).toBe(before);
  });

  it("44. ne mute pas les définitions Goal", () => {
    const current = version({ goals: [selectedGoal("net", "NET_WORTH", 335_000)] });
    const before = JSON.stringify(current.selectedGoals);
    evaluate(current);
    expect(JSON.stringify(current.selectedGoals)).toBe(before);
  });

  it("45. produit un run reproductible avec références exactes", () => {
    const result = evaluate();
    expect(result.run.optionReferences).toEqual(
      result.caseVersion.options.map((item) => item.scenarioReference),
    );
    expect(result.run.baselineFingerprint).toBe(result.provenance.baseline.openingFingerprint);
  });

  it("46. archive-not-delete fait partie du cycle de vie", () => {
    const archived = version();
    archived.status = "ARCHIVED";
    expect(evaluate(archived).caseVersion.status).toBe("ARCHIVED");
  });

  it("47. fingerprint de définition rend la référence vérifiable", () => {
    const current = option("A");
    expect(current.scenarioReference.definitionFingerprint).toBe(
      scenarioFingerprint(current.scenarioDefinition),
    );
  });

  it("48. le run porte les versions Goal exactes", () => {
    const result = evaluate(version({ goals: [selectedGoal("net", "NET_WORTH", 335_000)] }));
    expect(result.run.goalReferences).toEqual([{ goalId: "net", goalVersion: 1 }]);
  });

  it("49. l'opportunity cost est l'inverse du delta entre trajectoires", () => {
    const pair = evaluate().pairComparisons[0];
    expect(pair.opportunityCost.netWorth).toBe(-(pair.delta.netWorth ?? 0));
  });

  it("50. compare une conséquence cross-domain réaliste", () => {
    const career = scenarioEvent({
      id: "promotion",
      date: "2027-01-10",
      domain: "CAREER",
      type: "PROMOTION",
      cashIn: 5_000,
      income: 5_000,
    });
    const tax = scenarioEvent({
      id: "tax",
      date: "2027-01-10",
      domain: "TAX",
      type: "TAX_PAYMENT",
      effectKind: "TAX",
      cashOut: 1_500,
      taxCash: 1_500,
    });
    const result = evaluate(
      version({ options: [option("A"), option("B", [add("career", career), add("tax", tax)])] }),
    );
    expect(result.options[1].deltaVsBaseline.netWorth).toBe(3_500);
    expect(result.options[1].provenance.sourceEventIds).toEqual(
      expect.arrayContaining(["promotion", "tax"]),
    );
  });
});
