import { describe, expect, it } from "vitest";
import { underwriteRealEstate } from "@/lib/engine/real-estate";

describe("real estate underwriting", () => {
  it("calculates financing, operations and equity returns", () => {
    const result = underwriteRealEstate({
      purchasePrice: 200000, acquisitionCosts: 16000, renovation: 10000, furniture: 4000,
      downPayment: 30000, loanAmount: 200000, annualRate: 0.03, loanYears: 20,
      monthlyRent: 1200, vacancyRate: 0.05, annualOperatingCosts: 3000,
      annualPropertyGrowth: 0.015, rentGrowth: 0.01, holdingYears: 10,
      sellingCostsRate: 0.06, taxRate: 0.25,
    });
    expect(result.totalProjectCost).toBe(230000);
    expect(result.monthlyPayment).toBeGreaterThan(1000);
    expect(result.grossYield).toBeCloseTo(0.072, 5);
    expect(result.cashFlows).toHaveLength(11);
    expect(result.irr).not.toBeNull();
    expect(result.moic).toBeGreaterThan(0);
  });
});
