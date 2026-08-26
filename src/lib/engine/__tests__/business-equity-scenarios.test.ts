import { describe, expect, it } from "vitest";

import {
  BUSINESS_SALE_TAX_BASE_CONVENTION,
  projectBusinessHold,
  projectBusinessRaise,
  projectBusinessSale,
} from "@/lib/engine/business-equity-scenarios";
import { known, unknown, blocker } from "@/lib/engine/business-equity-facts";
import { blockerCodes, flagCodes } from "@/lib/engine/__tests__/fixtures/business";

describe("Scénario HOLD", () => {
  const input = {
    currentEquityValue: known(3_000_000),
    economicRate: known(0.7),
    years: 5,
    annualValueGrowth: 0.05,
    annualDistributionToOwner: 50_000,
    discountRate: 0.08,
  };

  it("compose la croissance déclarée sur l'horizon", () => {
    const result = projectBusinessHold(input);
    expect(result.terminalEquityValue.value).toBeCloseTo(3_000_000 * 1.05 ** 5, 6);
    expect(result.terminalAttributableValue.value).toBeCloseTo(3_000_000 * 1.05 ** 5 * 0.7, 6);
  });

  it("cumule les distributions sans supposer leur réinvestissement", () => {
    const result = projectBusinessHold(input);
    expect(result.cumulativeDistributions.value).toBe(250_000);
    expect(result.totalOwnerValue.value).toBeCloseTo(3_000_000 * 1.05 ** 5 * 0.7 + 250_000, 6);
  });

  it("actualise au taux déclaré", () => {
    const result = projectBusinessHold(input);
    expect(result.presentValue.value).toBeCloseTo(
      (3_000_000 * 1.05 ** 5 * 0.7 + 250_000) / 1.08 ** 5,
      6,
    );
  });

  it("ne postule aucune croissance par défaut", () => {
    const result = projectBusinessHold({ ...input, annualValueGrowth: null });
    expect(result.terminalEquityValue.value).toBeNull();
    expect(blockerCodes(result.terminalEquityValue)).toContain("SCENARIO_INPUT_MISSING");
  });

  it("ne postule aucune distribution par défaut", () => {
    const result = projectBusinessHold({ ...input, annualDistributionToOwner: null });
    expect(result.cumulativeDistributions.value).toBeNull();
    expect(result.totalOwnerValue.value).toBeNull();
  });
});

describe("Scénario SALE", () => {
  const base = {
    exitBasis: "EXIT_MULTIPLE" as const,
    adjustedMetric: known(500_000),
    exitMultiple: 8,
    exitEquityValue: null,
    grossDebt: known(1_000_000),
    cash: known(200_000),
    otherBridgeItems: known(0),
    economicRate: known(0.6),
    saleFraction: 0.5,
    transactionFeeRate: 0.03,
    remainingCostBasis: known(600_000),
    effectiveTaxRate: null as number | null,
  };

  it("ponte le multiple de sortie vers l'Equity Value, jamais vers la détention", () => {
    const result = projectBusinessSale(base);
    expect(result.exitEnterpriseValue.value).toBe(4_000_000);
    expect(result.exitEquityValue.value).toBe(3_200_000);
  });

  it("dérive le produit brut de la seule quote-part cédée", () => {
    const result = projectBusinessSale(base);
    expect(result.ownershipSold.value).toBeCloseTo(0.3, 12);
    expect(result.grossProceeds.value).toBeCloseTo(960_000, 6);
    expect(result.transactionFees.value).toBeCloseTo(28_800, 6);
    expect(result.preTaxNetProceeds.value).toBeCloseTo(931_200, 6);
  });

  it("libère le coût de revient au prorata et nomme l'assiette d'imposition", () => {
    const result = projectBusinessSale(base);
    expect(result.releasedCostBasis.value).toBe(300_000);
    expect(result.taxableGain.value).toBeCloseTo(631_200, 6);
    expect(result.taxBaseConvention).toBe(BUSINESS_SALE_TAX_BASE_CONVENTION);
  });

  it("n'invente aucune fiscalité tant qu'aucun taux n'est déclaré", () => {
    const result = projectBusinessSale(base);
    expect(result.estimatedTax.value).toBeNull();
    expect(result.afterTaxNetProceeds.value).toBeNull();
    expect(flagCodes(result)).toContain("TAX_RATE_NOT_DECLARED");
  });

  it("applique le taux dès qu'il est déclaré", () => {
    const result = projectBusinessSale({ ...base, effectiveTaxRate: 0.3 });
    expect(result.estimatedTax.value).toBeCloseTo(631_200 * 0.3, 6);
    expect(result.afterTaxNetProceeds.value).toBeCloseTo(931_200 - 631_200 * 0.3, 6);
  });

  it("conserve la valeur non cédée", () => {
    const result = projectBusinessSale(base);
    expect(result.retainedValue.value).toBeCloseTo(3_200_000 * 0.3, 6);
  });

  it("refuse de conclure quand le multiple de sortie n'est pas déclaré", () => {
    const result = projectBusinessSale({ ...base, exitMultiple: null });
    expect(result.exitEquityValue.value).toBeNull();
    expect(blockerCodes(result.grossProceeds)).toContain("SCENARIO_INPUT_MISSING");
  });

  it("propage un agrégat non calculable jusqu'au produit de cession", () => {
    const result = projectBusinessSale({
      ...base,
      adjustedMetric: unknown([blocker("EBITDA_MISSING", "x")]),
    });
    expect(result.exitEnterpriseValue.value).toBeNull();
    expect(blockerCodes(result.preTaxNetProceeds)).toContain("EBITDA_MISSING");
  });
});

describe("Scénario RAISE", () => {
  it("mesure la dilution et le coût de revient après souscription", () => {
    const result = projectBusinessRaise({
      preMoneyEquityValue: 8_000_000,
      primaryNewMoney: 2_000_000,
      secondaryAmount: null,
      ownershipBefore: 0.25,
      investorContribution: 0,
      preferredRightsKnown: false,
      costBasisBefore: known(400_000),
    });
    expect(result.postMoneyEquityValue.value).toBe(10_000_000);
    expect(result.ownershipAfter.value).toBeCloseTo(0.2, 12);
    expect(result.dilution.value).toBeCloseTo(0.05, 12);
    expect(result.costBasisAfter.value).toBe(400_000);
    expect(result.impliedMoic.value).toBeCloseTo(2_000_000 / 400_000, 12);
    expect(flagCodes(result)).toContain("PREFERRED_RIGHTS_UNKNOWN");
  });

  it("intègre la souscription au coût de revient", () => {
    const result = projectBusinessRaise({
      preMoneyEquityValue: 8_000_000,
      primaryNewMoney: 2_000_000,
      secondaryAmount: null,
      ownershipBefore: 0.25,
      investorContribution: 500_000,
      preferredRightsKnown: true,
      costBasisBefore: known(400_000),
    });
    expect(result.ownershipAfter.value).toBeCloseTo(0.25, 12);
    expect(result.costBasisAfter.value).toBe(900_000);
    expect(result.impliedMoic.value).toBeCloseTo(2_500_000 / 900_000, 12);
  });

  it("ne prétend rien mesurer sans coût de revient connu", () => {
    const result = projectBusinessRaise({
      preMoneyEquityValue: 8_000_000,
      primaryNewMoney: 2_000_000,
      secondaryAmount: null,
      ownershipBefore: 0.25,
      investorContribution: 0,
      preferredRightsKnown: true,
      costBasisBefore: unknown([blocker("COST_BASIS_HISTORY_MISSING", "s")]),
    });
    expect(result.impliedMoic.value).toBeNull();
    expect(blockerCodes(result.impliedMoic)).toContain("COST_BASIS_HISTORY_MISSING");
  });
});
