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
  annualReturn: 0.06,
  annualVolatility: 0.2,
  annualInflation: 0.025,
  monthlySavings: 100,
  investmentAllocationRate: 1,
  salaryGrowth: 0.04,
  stressProbability: 0.03,
  shockYear: null,
  shockMagnitude: null,
  provenance: { kind: "MODEL_ASSUMPTION", confidence: "MEDIUM" },
};

const opening: OpeningBalanceSheet = {
  date: "2030-01-15",
  bankCash: 1000,
  marketInvestedAssets: 6000,
  investmentCash: 3000,
  otherFinancialAssets: 0,
  grossFinancialAssets: 10000,
  nonFinancialAssets: 0,
  loanBalance: 0,
  otherLiabilityBalance: 0,
  fundingGap: 0,
  netWorth: 10000,
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
      seed: 12345,
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
    const monthZero = result.points[0];
    expect([monthZero.p10, monthZero.p25, monthZero.p50, monthZero.p75, monthZero.p90]).toEqual([
      opening.netWorth,
      opening.netWorth,
      opening.netWorth,
      opening.netWorth,
      opening.netWorth,
    ]);
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
    // Seuls les actifs de marché synthétiques encaissent le choc.
    expect(base.points[1].p50 - stressed.points[1].p50).toBeCloseTo(6000 * 0.35, 4);
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
