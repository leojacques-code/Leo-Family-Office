import { describe, expect, it } from "vitest";
import { underwriteRealEstate, type RealEstateInputs } from "@/lib/engine/real-estate";

/** GOLDEN_DATASET CASE 12 : locatif simple, le crédit ne finance ni frais ni travaux. */
const case12: RealEstateInputs = {
  purchasePrice: 200000,
  acquisitionCosts: 16000,
  renovation: 0,
  furniture: 0,
  downPayment: 36000,
  loanAmount: 180000,
  annualRate: 0.03,
  loanYears: 20,
  monthlyRent: 900,
  vacancyRate: 0.05,
  annualOperatingCosts: 2400,
  annualPropertyGrowth: 0.01,
  rentGrowth: 0.01,
  holdingYears: 10,
  sellingCostsRate: 0.06,
  taxRate: 0.25,
};

/** GOLDEN_DATASET CASE 13 : le crédit finance aussi les frais, les travaux et le mobilier. */
const case13: RealEstateInputs = {
  ...case12,
  renovation: 30000,
  furniture: 4000,
  downPayment: 30000,
  loanAmount: 220000,
  monthlyRent: 1050,
};

describe("real estate underwriting", () => {
  it("calculates financing, operations and equity returns", () => {
    const result = underwriteRealEstate({
      purchasePrice: 200000,
      acquisitionCosts: 16000,
      renovation: 10000,
      furniture: 4000,
      downPayment: 30000,
      loanAmount: 200000,
      annualRate: 0.03,
      loanYears: 20,
      monthlyRent: 1200,
      vacancyRate: 0.05,
      annualOperatingCosts: 3000,
      annualPropertyGrowth: 0.015,
      rentGrowth: 0.01,
      holdingYears: 10,
      sellingCostsRate: 0.06,
      taxRate: 0.25,
    });
    expect(result.totalProjectCost).toBe(230000);
    expect(result.monthlyPayment).toBeGreaterThan(1000);
    expect(result.grossYield).toBeCloseTo(0.072, 5);
    expect(result.cashFlows).toHaveLength(11);
    expect(result.irr).not.toBeNull();
    expect(result.moic).toBeGreaterThan(0);
  });

  it("CASE 12 : equity investie = coût total − emprunt, et coïncide avec l’apport", () => {
    const result = underwriteRealEstate(case12);
    expect(result.totalProjectCost).toBe(216000);
    expect(result.investedEquity).toBeCloseTo(36000, 2);
    expect(result.cashFlows[0]).toBeCloseTo(-36000, 2);
    expect(result.ltv).toBeCloseTo(0.9, 6);
    expect(result.netYield).toBeCloseTo(7860 / 200000, 8);
    expect(result.flags).toHaveLength(0);
  });

  it("CASE 13 : les frais et travaux financés ne gonflent pas l’equity", () => {
    const result = underwriteRealEstate(case13);
    expect(result.totalProjectCost).toBe(250000);
    // La formule fautive donnait 30 000 + 16 000 + 30 000 + 4 000 = 80 000.
    expect(result.investedEquity).toBeCloseTo(30000, 2);
    expect(result.cashFlows[0]).toBeCloseTo(-30000, 2);
    expect(result.ltv).toBeCloseTo(1.1, 6);
    expect(result.flags.some((flag) => flag.includes("LTV"))).toBe(true);
  });

  it("MOIC : un flux négatif est une contribution, pas une distribution négative", () => {
    // Equity 30 000, deux années à -3 000, sortie nette +80 000 → 80 000 / 36 000 = 2,2222.
    const cashFlows = [-30000, -3000, -3000, 80000];
    const distributions = cashFlows.slice(1).reduce((sum, value) => sum + Math.max(0, value), 0);
    const contributions = cashFlows.reduce((sum, value) => sum + Math.max(0, -value), 0);
    expect(distributions / contributions).toBeCloseTo(2.2222, 4);

    const result = underwriteRealEstate({ ...case13, holdingYears: 3 });
    const periodic = result.cashFlows.slice(1);
    const negatives = periodic.reduce((sum, value) => sum + Math.max(0, -value), 0);
    expect(result.contributions).toBeCloseTo(result.investedEquity + negatives, 6);
    expect(result.moic).toBeCloseTo(
      periodic.reduce((sum, value) => sum + Math.max(0, value), 0) / result.contributions,
      6,
    );
  });

  it("ne retranche plus de service de dette après l’extinction du crédit", () => {
    const shortLoan = underwriteRealEstate({ ...case12, loanYears: 5, holdingYears: 7 });
    const noLoan = underwriteRealEstate({
      ...case12,
      loanAmount: 0,
      downPayment: 216000,
      holdingYears: 7,
    });
    const effectiveRent = 900 * 12 * 0.95;
    // Année 6, hors service de dette : (loyer indexé − charges) × (1 − taux fiscal).
    const expectedYear6 = (effectiveRent * Math.pow(1.01, 5) - 2400) * 0.75;
    expect(shortLoan.cashFlows[6]).toBeCloseTo(expectedYear6, 2);
    expect(shortLoan.outstandingAtExit).toBe(0);
    expect(noLoan.cashFlows[1]).toBeCloseTo((effectiveRent - 2400) * 0.75, 2);
    expect(shortLoan.flags.some((flag) => flag.includes("s’éteint"))).toBe(true);
  });

  it("ne facture pas les intérêts postérieurs à la cession", () => {
    // Crédit 25 ans, sortie à 10 ans : l'encours est soldé à la vente.
    const result = underwriteRealEstate({ ...case12, loanYears: 25, holdingYears: 10 });
    expect(result.interestPaidThroughExit).toBeLessThan(result.fullTermInterestIfHeld);
    expect(result.interestPaidThroughExit).toBeGreaterThan(0);
    expect(result.outstandingAtExit).toBeGreaterThan(0);
  });

  it("fait coïncider les deux grandeurs quand le prêt va jusqu’à maturité", () => {
    const result = underwriteRealEstate({ ...case12, loanYears: 10, holdingYears: 10 });
    expect(result.interestPaidThroughExit).toBeCloseTo(result.fullTermInterestIfHeld, 6);
    expect(result.outstandingAtExit).toBeCloseTo(0, 6);
  });

  it("rend le taux d’actualisation explicite", () => {
    const at6 = underwriteRealEstate(case12, 0.06);
    const at3 = underwriteRealEstate(case12, 0.03);
    expect(at6.discountRate).toBe(0.06);
    expect(at3.npv).toBeGreaterThan(at6.npv);
  });
});
