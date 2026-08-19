import { describe, expect, it } from "vitest";
import { employmentCompensation, progressiveTax, type DatedTaxRule } from "@/lib/engine/tax";

const illustrativeRule: DatedTaxRule = {
  jurisdiction: "TEST", taxYear: 2026,
  brackets: [{ threshold: 0, rate: 0 }, { threshold: 10000, rate: 0.1 }, { threshold: 30000, rate: 0.3 }],
  socialContributionsRate: 0, source: "Fixture de test, pas une règle française", verifiedAt: "2026-08-19",
};

describe("dated tax rules", () => {
  it("applies configured progressive brackets", () => {
    expect(progressiveTax(40000, illustrativeRule)).toBe(5000);
  });

  it("builds the gross-to-net bridge from explicit inputs", () => {
    const result = employmentCompensation({ grossFixed: 42000, grossVariable: 9000, employeeContributionRate: 0.22, deductibleAllowanceRate: 0.1, taxRule: illustrativeRule });
    expect(result.gross).toBe(51000);
    expect(result.contributions).toBeCloseTo(11220, 6);
    expect(result.netAfterTax).toBeLessThan(result.netBeforeTax);
  });
});
