import { describe, expect, it } from "vitest";
import { runMonteCarlo } from "@/lib/engine/monte-carlo";
import type { Scenario } from "@/lib/types";

const scenario: Scenario = {
  id: "central", name: "Central", description: "Test", version: 1, color: "#000", annualReturn: 0.055,
  annualVolatility: 0.15, annualInflation: 0.02, monthlySavings: 250, salaryGrowth: 0.03,
  stressProbability: 0.02, shockYear: null, shockMagnitude: null,
  provenance: { kind: "MODEL_ASSUMPTION", confidence: "MEDIUM" },
};

describe("Monte Carlo engine", () => {
  it("is exactly reproducible with a seed", () => {
    const input = { scenario, initialAssets: 15571.49, years: 5, simulations: 500, seed: 19082026, baseYear: 2026 };
    expect(runMonteCarlo(input)).toEqual(runMonteCarlo(input));
  });

  it("derives calendar years from the observation year rather than a literal", () => {
    const result = runMonteCarlo({ scenario, initialAssets: 1000, years: 2, simulations: 100, seed: 7, baseYear: 2031 });
    expect(result.points.map((point) => point.year)).toEqual([2031, 2032, 2033]);
  });

  it("returns ordered percentiles for every year", () => {
    const result = runMonteCarlo({ scenario, initialAssets: 15571.49, years: 3, simulations: 1000, seed: 42, baseYear: 2026 });
    expect(result.points).toHaveLength(4);
    result.points.forEach((point) => {
      expect(point.p10).toBeLessThanOrEqual(point.p25);
      expect(point.p25).toBeLessThanOrEqual(point.p50);
      expect(point.p50).toBeLessThanOrEqual(point.p75);
      expect(point.p75).toBeLessThanOrEqual(point.p90);
    });
  });

  it("applies a deterministic dated shock", () => {
    const stressed = runMonteCarlo({ scenario: { ...scenario, annualVolatility: 0, stressProbability: 0, shockYear: 1, shockMagnitude: -0.35 }, initialAssets: 10000, years: 1, simulations: 100, seed: 1, baseYear: 2026 });
    const base = runMonteCarlo({ scenario: { ...scenario, annualVolatility: 0, stressProbability: 0 }, initialAssets: 10000, years: 1, simulations: 100, seed: 1, baseYear: 2026 });
    expect(stressed.points[1].p50).toBeCloseTo(base.points[1].p50 * 0.65, 6);
  });
});
