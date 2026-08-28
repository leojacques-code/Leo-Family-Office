import { describe, expect, it } from "vitest";
import { runScenarioMonteCarlo } from "@/lib/engine/monte-carlo";
import { createScenarioVersion } from "@/lib/engine/scenario-engine";
import { SCENARIO_AS_OF, scenarioOpening } from "@/lib/engine/__tests__/fixtures/scenarios-v2";

function definition(volatility = 0.15) {
  return createScenarioVersion({
    scenarioId: "monte-carlo-v2",
    asOfDate: SCENARIO_AS_OF,
    horizonMonths: 12,
    market: {
      annualReturn: 0.06,
      annualVolatility: volatility,
      stressProbability: 0,
    },
  });
}

function run(seed: number, volatility = 0.15) {
  return runScenarioMonteCarlo({
    definition: definition(volatility),
    baselineEvents: [],
    opening: scenarioOpening,
    simulations: 100,
    seed,
  });
}

describe("Scenarios V2 — Monte Carlo goldens", () => {
  it("55. le même seed reproduit exactement les mêmes percentiles", () => {
    expect(run(42)).toEqual(run(42));
  });

  it("56. un seed différent peut produire une distribution différente", () => {
    expect(run(42).points).not.toEqual(run(43).points);
  });

  it("57. une volatilité nulle produit un résultat déterministe", () => {
    const result = run(42, 0);
    for (const point of result.points) {
      expect(point.p10).toBeCloseTo(point.p90, 8);
    }
  });

  it("58. un nombre de simulations invalide est rejeté", () => {
    expect(() =>
      runScenarioMonteCarlo({
        definition: definition(),
        baselineEvents: [],
        opening: scenarioOpening,
        simulations: 99,
        seed: 1,
      }),
    ).toThrow("at least 100 simulations");
  });

  it("59. les percentiles restent ordonnés", () => {
    for (const point of run(7).points) {
      expect(point.p10).toBeLessThanOrEqual(point.p25);
      expect(point.p25).toBeLessThanOrEqual(point.p50);
      expect(point.p50).toBeLessThanOrEqual(point.p75);
      expect(point.p75).toBeLessThanOrEqual(point.p90);
    }
  });
});
