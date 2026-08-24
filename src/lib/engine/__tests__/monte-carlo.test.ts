import { describe, expect, it } from "vitest";
import { runMonteCarlo } from "@/lib/engine/monte-carlo";
import type { OpeningBalanceSheet } from "@/lib/engine/monthly-financial-model";
import type { Scenario } from "@/lib/types";

const scenario: Scenario = {
  id: "central",
  name: "Central",
  description: "Test",
  version: 1,
  color: "#000",
  annualReturn: 0.055,
  annualVolatility: 0.15,
  annualInflation: 0.02,
  monthlySavings: 250,
  investmentAllocationRate: 1,
  salaryGrowth: 0.03,
  stressProbability: 0.02,
  shockYear: null,
  shockMagnitude: null,
  provenance: { kind: "MODEL_ASSUMPTION", confidence: "MEDIUM" },
};

const opening: OpeningBalanceSheet = {
  date: "2026-08-19",
  bankCash: 354.08,
  marketInvestedAssets: 8912.28,
  investmentCash: 6304.57,
  otherFinancialAssets: 0.56,
  grossFinancialAssets: 15571.49,
  loanBalance: 0,
  fundingGap: 0,
  netWorth: 15571.49,
  flags: [],
};

describe("Monte Carlo engine", () => {
  it("is exactly reproducible with a seed", () => {
    const input = {
      scenario,
      opening,
      liabilities: [],
      years: 5,
      simulations: 500,
      seed: 19082026,
    };
    expect(runMonteCarlo(input)).toEqual(runMonteCarlo(input));
  });

  it("derives calendar years from the observation date rather than a literal", () => {
    const result = runMonteCarlo({
      scenario,
      opening: { ...opening, date: "2031-03-15" },
      liabilities: [],
      years: 2,
      simulations: 100,
      seed: 7,
    });
    expect(result.points.map((point) => point.year)).toEqual([2031, 2032, 2033]);
  });

  it("returns ordered percentiles for every year", () => {
    const result = runMonteCarlo({
      scenario,
      opening,
      liabilities: [],
      years: 3,
      simulations: 1000,
      seed: 42,
    });
    expect(result.points).toHaveLength(4);
    result.points.forEach((point) => {
      expect(point.p10).toBeLessThanOrEqual(point.p25);
      expect(point.p25).toBeLessThanOrEqual(point.p50);
      expect(point.p50).toBeLessThanOrEqual(point.p75);
      expect(point.p75).toBeLessThanOrEqual(point.p90);
    });
  });

  it("starts every simulation at the observed net worth", () => {
    const result = runMonteCarlo({
      scenario,
      opening,
      liabilities: [],
      years: 3,
      simulations: 200,
      seed: 3,
    });
    expect(result.points[0].p10).toBeCloseTo(opening.netWorth, 6);
    expect(result.points[0].p90).toBeCloseTo(opening.netWorth, 6);
  });

  it("applies a dated shock only to market-exposed assets", () => {
    const flat = {
      ...scenario,
      annualVolatility: 0,
      stressProbability: 0,
      annualReturn: 0,
      monthlySavings: 0,
    };
    const stressed = runMonteCarlo({
      scenario: { ...flat, shockYear: 1, shockMagnitude: -0.35 },
      opening,
      liabilities: [],
      years: 1,
      simulations: 100,
      seed: 1,
    });
    const base = runMonteCarlo({
      scenario: flat,
      opening,
      liabilities: [],
      years: 1,
      simulations: 100,
      seed: 1,
    });
    // Seuls les 8 912,28 € exposés au marché encaissent le choc.
    expect(base.points[1].p50 - stressed.points[1].p50).toBeCloseTo(8912.28 * 0.35, 4);
  });

  it("rejects an under-specified projection", () => {
    expect(() =>
      runMonteCarlo({ scenario, opening, liabilities: [], years: 0, simulations: 500, seed: 1 }),
    ).toThrow();
    expect(() =>
      runMonteCarlo({ scenario, opening, liabilities: [], years: 5, simulations: 10, seed: 1 }),
    ).toThrow();
  });
});
