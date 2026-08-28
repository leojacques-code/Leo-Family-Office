import { describe, expect, it } from "vitest";
import type {
  CanonicalAggregate,
  CanonicalBalanceSheet,
  ConvertedBalanceSheetLine,
} from "@/lib/engine/balance-sheet";
import type { ScenarioPath, ScenarioPathMetric } from "@/lib/engine/scenario-contracts";
import type { GoalTarget, GoalVersionDefinition } from "@/lib/engine/goal-contracts";
import {
  createGoalVersion,
  evaluateGoalAgainstTrajectory,
  evaluateGoalAttainmentProbability,
  evaluateGoalCurrent,
  goalGap,
  isGoalVersionDefinition,
  targetSatisfied,
} from "@/lib/engine/goal-engine";

const AS_OF = "2026-08-28";
const aggregate = (
  value: number | null,
  status: CanonicalAggregate["status"] = value === null ? "NOT_COMPUTABLE" : "COMPLETE",
  blockers: string[] = value === null ? ["MISSING_FX"] : [],
): CanonicalAggregate => ({
  value,
  knownValue: value ?? 0,
  status,
  coverage: value === null ? 0 : 1,
  blockers,
});

const line = (
  domain: ConvertedBalanceSheetLine["domain"],
  entityId: string,
  value: number | null,
): ConvertedBalanceSheetLine =>
  ({
    id: `${domain}-${entityId}`,
    entityId,
    domain,
    side: domain === "DEBT" ? "LIABILITY" : "ASSET",
    category: domain,
    nativeValue: value,
    currency: "EUR",
    valuationDate: AS_OF,
    valuationMethod: "OBSERVED_BALANCE",
    valuationStatus: value === null ? "MISSING" : "CURRENT",
    valuationBlockers: value === null ? ["MISSING_VALUE"] : [],
    liquidity: "ILLIQUID",
    provenance: { kind: "ACTUAL", confidence: "HIGH" },
    confidence: "HIGH",
    reconciliationState: "RECONCILED",
    isAccountingPrimary: true,
    flags: [],
    reportingValue: value,
    reportingCurrency: "EUR",
    fx: { status: "DIRECT", rate: 1, rateDate: AS_OF, flags: [] },
  }) as unknown as ConvertedBalanceSheetLine;

const currentSheet: CanonicalBalanceSheet = {
  asOfDate: AS_OF,
  reportingCurrency: "EUR",
  contributions: [
    line("DEBT", "11111111-1111-4111-8111-111111111111", 5_000),
    line("REAL_ESTATE", "22222222-2222-4222-8222-222222222222", 180_000),
    line("BUSINESS_EQUITY", "33333333-3333-4333-8333-333333333333", 70_000),
  ],
  positionReconciliations: [],
  envelopeExposures: [],
  financialAssets: aggregate(100_000),
  grossAssets: aggregate(350_000),
  immediateCash: aggregate(20_000),
  cashLikeAssets: aggregate(20_000),
  liquidAssets: aggregate(90_000),
  illiquidAssets: aggregate(260_000),
  marketInvestedAssets: aggregate(65_000),
  investmentEnvelopeCash: aggregate(5_000),
  accountOverdraftLiabilities: aggregate(0),
  contractualDebt: aggregate(50_000),
  otherLiabilities: aggregate(0),
  totalLiabilities: aggregate(50_000),
  netWorth: aggregate(300_000),
  liquidNetWorth: aggregate(40_000),
  netFinancialDebt: aggregate(-40_000),
  productiveAssets: aggregate(315_000),
  productiveNetWorth: aggregate(265_000),
  quality: { status: "COMPLETE", blockers: [], flags: [] },
};

function target(
  metric: GoalTarget["metric"] = "NET_WORTH",
  value = 500_000,
  operator: GoalTarget["operator"] = "AT_LEAST",
  entityId: string | null = null,
): GoalTarget {
  return { metric, value, operator, currency: "EUR", entityId };
}

function goal(overrides: Partial<GoalVersionDefinition> = {}): GoalVersionDefinition {
  const base = createGoalVersion({
    goalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Patrimoine cible",
    target: target(),
    targetDate: "2028-12-31",
    createdAt: "2026-08-28T00:00:00.000Z",
  });
  return { ...base, ...overrides };
}

function point(date: string, netWorth: number): ScenarioPathMetric {
  return {
    monthIndex: 0,
    date,
    netWorth,
    liquidNetWorth: netWorth * 0.5,
    cash: netWorth * 0.2,
    investmentAssets: netWorth * 0.3,
    realEstateAndBusinessAssets: netWorth * 0.5,
    debt: Math.max(0, 100_000 - netWorth * 0.1),
    fundingGap: 0,
    income: 0,
    expenses: 0,
    taxes: 0,
    sourceConsequenceIds: [],
  };
}

function path(
  rows: Array<[string, number]>,
  overrides: Partial<ScenarioPath> = {},
): ScenarioPath {
  return {
    scenarioId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    scenarioVersion: 7,
    asOfDate: AS_OF,
    horizonMonths: Math.max(1, rows.length - 1),
    timeline: { events: [], monthlyConsequences: [], blockers: [] } as never,
    monthly: rows.map(([date, value], index) => ({ ...point(date, value), monthIndex: index })),
    annual: [],
    financialStates: [],
    blockers: [],
    completeness: "READY",
    ...overrides,
  };
}

const trajectory = () =>
  path([
    [AS_OF, 300_000],
    ["2027-12-31", 420_000],
    ["2028-12-31", 500_000],
    ["2029-12-31", 620_000],
  ]);

describe("Goals V2", () => {
  it("1. détecte un objectif NET_WORTH déjà atteint", () => {
    const result = evaluateGoalCurrent({
      goal: goal({ target: target("NET_WORTH", 250_000) }),
      balanceSheet: currentSheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect(result.status).toBe("ACHIEVED");
    expect(result.satisfiedNow).toBe(true);
  });

  it("2. expose le gap d'un objectif NET_WORTH non atteint", () => {
    const result = evaluateGoalCurrent({
      goal: goal(),
      balanceSheet: currentSheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect(result.status).toBe("OFF_TRACK");
    expect(result.gap?.shortfall).toBe(200_000);
  });

  it("3. accepte une cible atteinte exactement à la deadline", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal(),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("ON_TRACK");
    expect(result.projectedValueAtTargetDate).toBe(500_000);
  });

  it("4. détecte la première atteinte avant deadline", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ target: target("NET_WORTH", 400_000) }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.firstProjectedAttainmentDate).toBe("2027-12-31");
    expect(result.status).toBe("ON_TRACK");
  });

  it("5. ne déclare pas on-track si l'atteinte arrive après deadline", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ targetDate: "2027-12-31" }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("OFF_TRACK");
    expect(result.firstProjectedAttainmentDate).toBe("2028-12-31");
  });

  it("6. détecte une cible jamais atteinte sur l'horizon", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ target: target("NET_WORTH", 900_000) }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("OFF_TRACK");
    expect(result.firstProjectedAttainmentDate).toBeNull();
  });

  it("7. applique AT_MOST aux passifs", () => {
    const debtGoal = goal({
      target: target("TOTAL_LIABILITIES", 60_000, "AT_MOST"),
    });
    const result = evaluateGoalCurrent({
      goal: debtGoal,
      balanceSheet: currentSheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect(result.satisfiedNow).toBe(true);
  });

  it("8. lit une dette spécifique par identifiant canonique", () => {
    const result = evaluateGoalCurrent({
      goal: goal({
        target: target(
          "SPECIFIC_DEBT_BALANCE",
          0,
          "AT_MOST",
          "11111111-1111-4111-8111-111111111111",
        ),
      }),
      balanceSheet: currentSheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect(result.observation.value).toBe(5_000);
    expect(result.satisfiedNow).toBe(false);
  });

  it("9. bloque une entité spécifique absente", () => {
    const result = evaluateGoalCurrent({
      goal: goal({
        target: target("SPECIFIC_DEBT_BALANCE", 0, "AT_MOST", "missing"),
      }),
      balanceSheet: currentSheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect(result.status).toBe("NOT_COMPUTABLE");
    expect(result.blockers.some((item) => item.code === "ENTITY_NOT_FOUND")).toBe(true);
  });

  it("10. conserve une métrique current null", () => {
    const sheet = { ...currentSheet, netWorth: aggregate(null) };
    const result = evaluateGoalCurrent({
      goal: goal(),
      balanceSheet: sheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect(result.observation.value).toBeNull();
    expect(result.status).toBe("NOT_COMPUTABLE");
  });

  it("11. classe AT_RISK une trajectoire partielle qui atteint la cible", () => {
    const partial = path(trajectory().monthly.map((item) => [item.date, item.netWorth]), {
      completeness: "PARTIAL",
      blockers: [{ code: "MISSING_TAX_RULES", message: "Taxe manquante", eventId: null, assumptionKey: null, blocking: false }],
    });
    const result = evaluateGoalAgainstTrajectory({ goal: goal(), trajectory: partial, reportingCurrency: "EUR" });
    expect(result.status).toBe("AT_RISK");
    expect(result.blockers.some((item) => item.code === "TRAJECTORY_PARTIAL")).toBe(true);
  });

  it("12. ne convertit pas implicitement une devise", () => {
    const result = evaluateGoalCurrent({
      goal: goal({ target: { ...target(), currency: "USD" } }),
      balanceSheet: currentSheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect(result.status).toBe("NOT_COMPUTABLE");
    expect(result.blockers[0].code).toBe("CURRENCY_MISMATCH");
  });

  it("13. évalue un funding gap projeté", () => {
    const fundingPath = trajectory();
    fundingPath.monthly[2].fundingGap = 10_000;
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ target: target("FUNDING_GAP", 0, "AT_MOST") }),
      trajectory: fundingPath,
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("OFF_TRACK");
    expect(result.projectedValueAtTargetDate).toBe(10_000);
  });

  it("14. évalue une deadline passée si l'historique est présent", () => {
    const historical = path([
      ["2026-06-30", 510_000],
      [AS_OF, 520_000],
    ]);
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ targetDate: "2026-06-30" }),
      trajectory: historical,
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("ACHIEVED");
  });

  it("15. refuse d'inventer l'historique d'une deadline passée", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ targetDate: "2026-06-30" }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("NOT_COMPUTABLE");
    expect(result.blockers[0].code).toBe("HISTORICAL_TARGET_VALUE_UNAVAILABLE");
  });

  it("16. accepte target value = 0", () => {
    const zero = target("TOTAL_LIABILITIES", 0, "AT_MOST");
    expect(targetSatisfied(0, zero)).toBe(true);
    expect(goalGap(5_000, zero).relativeGap).toBeNull();
  });

  it("17. signale le mismatch currency sur une trajectoire", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ target: { ...target(), currency: "GBP" } }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("NOT_COMPUTABLE");
    expect(result.blockers[0].code).toBe("CURRENCY_MISMATCH");
  });

  it("18. évalue plusieurs goals indépendamment", () => {
    const goals = [goal(), goal({ goalId: "second", target: target("NET_WORTH", 200_000) })];
    const results = goals.map((definition) =>
      evaluateGoalCurrent({ goal: definition, balanceSheet: currentSheet, reportingCurrency: "EUR", asOfDate: AS_OF }),
    );
    expect(results.map((item) => item.status)).toEqual(["OFF_TRACK", "ACHIEVED"]);
  });

  it("19. n'évalue pas un goal archivé comme actif", () => {
    const result = evaluateGoalCurrent({
      goal: goal({ status: "ARCHIVED" }),
      balanceSheet: currentSheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect(result.status).toBe("NOT_COMPUTABLE");
    expect(result.blockers[0].code).toBe("GOAL_INACTIVE");
  });

  it("20. n'évalue pas un goal paused", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ status: "PAUSED" }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("NOT_COMPUTABLE");
  });

  it("21. conserve la version exacte du scénario", () => {
    const result = evaluateGoalAgainstTrajectory({ goal: goal(), trajectory: trajectory(), reportingCurrency: "EUR" });
    expect(result.trajectory.scenarioVersion).toBe(7);
    expect(result.goalVersion).toBe(1);
  });

  it("22. marque stale une baseline modifiée", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal(),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
      baselineFingerprint: "old",
      currentBaselineFingerprint: "new",
    });
    expect(result.status).toBe("AT_RISK");
    expect(result.blockers.some((item) => item.code === "STALE_BASELINE")).toBe(true);
  });

  it("23. est déterministe", () => {
    const input = { goal: goal(), trajectory: trajectory(), reportingCurrency: "EUR" };
    expect(evaluateGoalAgainstTrajectory(input)).toEqual(evaluateGoalAgainstTrajectory(input));
  });

  it("24. ne mute pas le canonical state", () => {
    const before = structuredClone(currentSheet);
    evaluateGoalCurrent({ goal: goal(), balanceSheet: currentSheet, reportingCurrency: "EUR", asOfDate: AS_OF });
    expect(currentSheet).toEqual(before);
  });

  it("25. ne mute pas la définition du scénario", () => {
    const scenario = trajectory();
    const before = structuredClone(scenario);
    evaluateGoalAgainstTrajectory({ goal: goal(), trajectory: scenario, reportingCurrency: "EUR" });
    expect(scenario).toEqual(before);
  });

  it("26. conserve month-0 exact", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ targetDate: AS_OF, target: target("NET_WORTH", 300_000) }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.projectedValueAtTargetDate).toBe(300_000);
  });

  it("27. prend le dernier point mensuel antérieur à une deadline quotidienne", () => {
    const monthly = path([
      [AS_OF, 300_000],
      ["2026-09-30", 600_000],
    ]);
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ targetDate: "2026-09-15" }),
      trajectory: monthly,
      reportingCurrency: "EUR",
    });
    expect(result.observation?.observedAt).toBe(AS_OF);
    expect(result.status).toBe("OFF_TRACK");
  });

  it("28. signale un horizon plus court que la deadline", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ targetDate: "2035-12-31" }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("NOT_COMPUTABLE");
    expect(result.blockers[0].code).toBe("HORIZON_BEFORE_DEADLINE");
  });

  it("29. accepte une deadline exacte à l'horizon", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ targetDate: "2029-12-31", target: target("NET_WORTH", 620_000) }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("ON_TRACK");
  });

  it("30. lit Business et Real Estate uniquement depuis le bilan courant", () => {
    const business = evaluateGoalCurrent({
      goal: goal({ target: target("BUSINESS_EQUITY", 50_000) }),
      balanceSheet: currentSheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    const property = evaluateGoalCurrent({
      goal: goal({ target: target("REAL_ESTATE_VALUE", 150_000) }),
      balanceSheet: currentSheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect([business.observation.value, property.observation.value]).toEqual([70_000, 180_000]);
  });

  it("31. retourne NC pour Monte Carlo sans samples", () => {
    const result = evaluateGoalAttainmentProbability({ goal: goal(), reportingCurrency: "EUR" });
    expect(result.status).toBe("NOT_COMPUTABLE");
    expect(result.probability).toBeNull();
  });

  it("32. ne déduit aucune probabilité de percentiles", () => {
    const result = evaluateGoalAttainmentProbability({
      goal: goal(),
      samplePaths: null,
      reportingCurrency: "EUR",
    });
    expect(result.blockers[0].code).toBe("MONTE_CARLO_SAMPLES_UNAVAILABLE");
  });

  it("33. missing n'est jamais converti en zéro", () => {
    const sheet = { ...currentSheet, immediateCash: aggregate(null, "PARTIAL", ["MISSING_FX"]) };
    const result = evaluateGoalCurrent({
      goal: goal({ target: target("IMMEDIATE_CASH", 0) }),
      balanceSheet: sheet,
      reportingCurrency: "EUR",
      asOfDate: AS_OF,
    });
    expect(result.satisfiedNow).toBeNull();
    expect(result.status).toBe("NOT_COMPUTABLE");
  });

  it("34. un goal ne crée aucun Event", () => {
    const scenario = trajectory();
    evaluateGoalAgainstTrajectory({ goal: goal(), trajectory: scenario, reportingCurrency: "EUR" });
    expect(scenario.timeline.events).toEqual([]);
  });

  it("35. un goal ne modifie aucun cash-flow", () => {
    const scenario = trajectory();
    const cash = scenario.monthly.map((item) => item.cash);
    evaluateGoalAgainstTrajectory({ goal: goal(), trajectory: scenario, reportingCurrency: "EUR" });
    expect(scenario.monthly.map((item) => item.cash)).toEqual(cash);
  });

  it("36. satisfait une target window dès qu'un point de la fenêtre atteint la cible", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({ targetDate: null, targetWindow: { startDate: "2027-01-01", endDate: "2028-12-31" } }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.satisfiedAtTargetDate).toBe(true);
  });

  it("37. refuse de projeter une dette spécifique non exposée par ScenarioPath", () => {
    const result = evaluateGoalAgainstTrajectory({
      goal: goal({
        target: target("SPECIFIC_DEBT_BALANCE", 0, "AT_MOST", "11111111-1111-4111-8111-111111111111"),
      }),
      trajectory: trajectory(),
      reportingCurrency: "EUR",
    });
    expect(result.status).toBe("NOT_COMPUTABLE");
    expect(result.blockers[0].code).toBe("METRIC_NOT_AVAILABLE_PROJECTED");
  });

  it("38. valide une définition complète", () => {
    expect(isGoalVersionDefinition(goal())).toBe(true);
  });

  it("39. supporte EQUAL avec une tolérance uniquement numérique", () => {
    expect(targetSatisfied(100.0000001, target("NET_WORTH", 100, "EQUAL"))).toBe(true);
    expect(targetSatisfied(101, target("NET_WORTH", 100, "EQUAL"))).toBe(false);
  });

  it("40. rejette un opérateur économiquement incompatible", () => {
    expect(
      isGoalVersionDefinition({ ...goal(), target: target("FUNDING_GAP", 100, "AT_LEAST") }),
    ).toBe(false);
  });

  it("41. calcule une probabilité exacte depuis des samples individuels", () => {
    const result = evaluateGoalAttainmentProbability({
      goal: goal(),
      reportingCurrency: "EUR",
      samplePaths: [trajectory(), path([[AS_OF, 300_000], ["2028-12-31", 400_000]])],
    });
    expect(result).toMatchObject({ status: "COMPUTABLE", probability: 0.5, successfulSamples: 1, totalSamples: 2 });
  });
});
