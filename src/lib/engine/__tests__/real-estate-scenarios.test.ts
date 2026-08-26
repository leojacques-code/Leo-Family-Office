import { describe, expect, it } from "vitest";

import { UNDECLARED_LOAN_TERMS, buildContractualSchedule } from "@/lib/engine/debt";
import { buildRealEstatePortfolio } from "@/lib/engine/real-estate";
import {
  holdScenario,
  refinanceScenario,
  sellScenario,
  syntheticLoan,
  underwriteProspectiveRealEstate,
  worksScenario,
  type RealEstateScenarioAssumptions,
} from "@/lib/engine/real-estate-scenarios";
import type {
  Liability,
  Provenance,
  RealEstateAsset,
  RealEstateCapitalEvent,
  RealEstateFinancingLink,
  RealEstateOperatingTerms,
  RealEstateValuation,
} from "@/lib/types";

// Toutes les valeurs de ce fichier sont des fixtures synthétiques.

const actual: Provenance = { kind: "ACTUAL", confidence: "HIGH" };
const declared: Provenance = { kind: "USER_ASSUMPTION", confidence: "MEDIUM" };
const AS_OF = "2026-08-26";

const asset: RealEstateAsset = {
  id: "prop",
  name: "Locatif",
  location: null,
  surfaceSqm: null,
  usage: "RENTAL",
  ownershipShare: 1,
  isDebtFinanced: true,
  acquisitionDate: "2020-06-15",
  disposalDate: null,
  archived: false,
  notes: null,
  provenance: declared,
};

const valuation: RealEstateValuation = {
  id: "val",
  propertyId: "prop",
  valuedAt: "2026-06-30",
  value: 260_000,
  currency: "EUR",
  method: "AGENT_ESTIMATE",
  notes: null,
  provenance: actual,
};

const capitalEvents: RealEstateCapitalEvent[] = [
  {
    id: "price",
    propertyId: "prop",
    type: "ACQUISITION_PRICE",
    eventDate: "2020-06-15",
    amount: 200_000,
    currency: "EUR",
    label: null,
    transactionId: null,
    notes: null,
    provenance: actual,
  },
  {
    id: "costs",
    propertyId: "prop",
    type: "ACQUISITION_COST",
    eventDate: "2020-06-15",
    amount: 16_000,
    currency: "EUR",
    label: null,
    transactionId: null,
    notes: null,
    provenance: actual,
  },
];

const operatingTerms: RealEstateOperatingTerms = {
  id: "terms",
  propertyId: "prop",
  effectiveFrom: "2026-01-01",
  currency: "EUR",
  annualGrossRent: 12_000,
  vacancyRate: 0.05,
  annualOperatingCharges: 900,
  annualPropertyTax: 1_100,
  annualInsurance: 300,
  annualMaintenance: 500,
  annualManagementFees: 800,
  managementFeeRate: null,
  annualOtherCosts: 0,
  effectiveIncomeTaxRate: null,
  notes: null,
  provenance: declared,
};

const mortgage: Liability = {
  ...UNDECLARED_LOAN_TERMS,
  id: "loan",
  name: "Crédit",
  lender: "Banque",
  principal: 160_000,
  currentBalance: 120_000,
  currency: "EUR",
  balanceDate: AS_OF,
  annualRate: 0.021,
  monthlyPayment: 820,
  paymentCount: 240,
  firstPaymentDate: "2020-08-05",
  maturityDate: "2040-07-05",
  provenance: actual,
};

const financingLink: RealEstateFinancingLink = {
  id: "link",
  propertyId: "prop",
  liabilityId: "loan",
  allocationShare: 1,
  notes: null,
  provenance: declared,
};

const view = buildRealEstatePortfolio({
  asOfDate: AS_OF,
  reportingCurrency: "EUR",
  assets: [asset],
  valuations: [valuation],
  capitalEvents,
  operatingTerms: [operatingTerms],
  financingLinks: [financingLink],
  liabilities: [mortgage],
}).assets[0];

const declaredAssumptions: RealEstateScenarioAssumptions = {
  horizonYears: 10,
  annualValueGrowth: 0.015,
  annualRentGrowth: 0.01,
  sellingCostsRate: 0.06,
  discountRate: 0.06,
};

const undeclaredAssumptions: RealEstateScenarioAssumptions = {
  horizonYears: 10,
  annualValueGrowth: null,
  annualRentGrowth: null,
  sellingCostsRate: null,
  discountRate: 0.06,
};

describe("scénario de conservation", () => {
  it("déroule l'horizon avec le seul Debt Engine et sépare coût et principal", () => {
    const result = holdScenario(view, declaredAssumptions, AS_OF);
    expect(result.years).toHaveLength(10);
    expect(result.equityIrr).not.toBeNull();
    const cost = result.economicFinancingCost.value ?? 0;
    const principal = result.principalRepaid.value ?? 0;
    expect(cost).toBeGreaterThan(0);
    expect(principal).toBeGreaterThan(0);
    // L'encours décroît d'exactement le capital remboursé, jamais du coût.
    const last = result.years.at(-1);
    expect(last?.attributedOutstanding.value).toBeCloseTo(120_000 - principal, 2);
  });

  it("le loyer croît d'une année sur l'autre selon l'hypothèse déclarée", () => {
    const result = holdScenario(view, declaredAssumptions, AS_OF);
    const first = result.years[0].attributedNetOperatingIncome.value ?? 0;
    const second = result.years[1].attributedNetOperatingIncome.value ?? 0;
    expect(second).toBeCloseTo(first * 1.01, 6);
  });

  it("une croissance non déclarée n'est pas une croissance nulle", () => {
    const result = holdScenario(view, undeclaredAssumptions, AS_OF);
    expect(result.years[0].attributedNetOperatingIncome.value).toBeNull();
    expect(result.years[0].attributedValue.value).toBeNull();
    expect(result.equityIrr).toBeNull();
    expect(result.blockers).toContain("RENT_GROWTH_UNDECLARED:prop");
    expect(result.blockers).toContain("VALUE_GROWTH_UNDECLARED:prop");
    // Le service de dette reste connu : il ne dépend d'aucune de ces hypothèses.
    expect(result.years[0].attributedCashDebtService.value).toBeGreaterThan(0);
  });

  it("conserver n'engage aucune trésorerie nouvelle", () => {
    const result = holdScenario(view, declaredAssumptions, AS_OF);
    expect(result.initialCashFlow.value).toBe(0);
  });
});

describe("scénarios et financement non déclaré", () => {
  /** Le même bien, sans concours rattaché, dans les trois états de financement. */
  const withoutLinks = (isDebtFinanced: boolean | null) =>
    buildRealEstatePortfolio({
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      assets: [{ ...asset, isDebtFinanced }],
      valuations: [valuation],
      capitalEvents,
      operatingTerms: [operatingTerms],
      financingLinks: [],
      liabilities: [mortgage],
    }).assets[0];

  it("un bien déclaré sans dette se projette avec un service de dette nul", () => {
    const result = holdScenario(withoutLinks(false), declaredAssumptions, AS_OF);
    expect(result.years[0].attributedCashDebtService.value).toBe(0);
    expect(result.economicFinancingCost.value).toBe(0);
    expect(result.principalRepaid.value).toBe(0);
    expect(result.years.at(-1)?.attributedOutstanding.value).toBe(0);
    // L'equity terminale égale la valeur projetée : sans dette, rien ne s'en retranche.
    expect(result.years.at(-1)?.attributedEquity.value).toBeCloseTo(
      result.years.at(-1)?.attributedValue.value ?? 0,
      6,
    );
    // Le scénario est entièrement calculable : la VAN existe.
    expect(result.equityNpv.value).not.toBeNull();
    // Le TRI, non : conserver un bien non financé n'engage aucune trésorerie à l'origine,
    // la série n'a donc aucun flux négatif et aucun taux ne l'annule. Ce n'est pas une
    // donnée manquante, c'est une grandeur qui n'existe pas pour cette série.
    expect(result.equityIrr).toBeNull();
    expect(result.blockers).toHaveLength(0);
  });

  it("un financement non déclaré rend le scénario de conservation incalculable", () => {
    const result = holdScenario(withoutLinks(null), declaredAssumptions, AS_OF);
    expect(result.years[0].attributedCashDebtService.value).toBeNull();
    expect(result.years[0].equityCashFlow.value).toBeNull();
    expect(result.years.at(-1)?.attributedEquity.value).toBeNull();
    expect(result.equityIrr).toBeNull();
    expect(result.blockers).toContain("FINANCING_UNDECLARED:prop");
    // Le loyer projeté, lui, ne dépend pas du financement.
    expect(result.years[0].attributedNetOperatingIncome.value).not.toBeNull();
  });

  it("une dette déclarée mais non rattachée bloque aussi la cession", () => {
    const result = sellScenario(withoutLinks(true), {
      sellingCostsRate: 0.06,
      prepaymentPenalty: 0,
      salePrice: null,
    });
    expect(result.debtPayoff.value).toBeNull();
    expect(result.netProceedsBeforeTax.value).toBeNull();
    expect(result.blockers).toContain("DEBT_DECLARED_NOT_LINKED:prop");
    // La plus-value réalisée ne dépend pas de la dette : elle reste calculable.
    expect(result.realisedGainBeforeTax.value).not.toBeNull();
  });

  it("un refinancement compare à un coût actuel inconnu sans le supposer nul", () => {
    const result = refinanceScenario(
      withoutLinks(null),
      {
        newLoan: {
          principal: 120_000,
          annualRate: 0.012,
          termMonths: 180,
          firstPaymentDate: AS_OF,
          currency: "EUR",
          monthlyInsurance: null,
          paymentIncludesInsurance: null,
        },
        prepaymentPenalty: 0,
        arrangementFees: 0,
      },
      declaredAssumptions,
      AS_OF,
    );
    // Le coût du concours refinancé est connu : c'est un prêt entièrement décrit.
    expect(result.economicFinancingCost.value).not.toBeNull();
    // Le coût ACTUEL ne l'est pas : annoncer une économie serait inventer une comparaison.
    expect(result.currentEconomicFinancingCost.value).toBeNull();
    expect(result.economicSaving.value).toBeNull();
  });
});

describe("scénario de cession", () => {
  it("distingue produit encaissé et plus-value réalisée", () => {
    const result = sellScenario(view, {
      sellingCostsRate: 0.06,
      prepaymentPenalty: 2_400,
      salePrice: null,
    });
    const netPrice = 260_000 - 260_000 * 0.06;
    expect(result.netProceedsBeforeTax.value).toBeCloseTo(netPrice - 120_000 - 2_400, 6);
    // La plus-value réalisée ignore la dette soldée : éteindre un passif ne coûte rien.
    expect(result.realisedGainBeforeTax.value).toBeCloseTo(netPrice - 216_000, 6);
  });

  it("une indemnité de remboursement anticipé inconnue n'est pas nulle", () => {
    const result = sellScenario(view, {
      sellingCostsRate: 0.06,
      prepaymentPenalty: null,
      salePrice: null,
    });
    expect(result.prepaymentPenalty.value).toBeNull();
    expect(result.netProceedsBeforeTax.value).toBeNull();
    expect(result.blockers).toContain("PREPAYMENT_PENALTY_UNKNOWN:prop");
    // La plus-value, elle, ne dépend pas de l'indemnité : elle reste calculable.
    expect(result.realisedGainBeforeTax.value).not.toBeNull();
  });

  it("des frais de cession non déclarés rendent le produit non calculable", () => {
    const result = sellScenario(view, {
      sellingCostsRate: null,
      prepaymentPenalty: 0,
      salePrice: null,
    });
    expect(result.sellingCosts.value).toBeNull();
    expect(result.netProceedsBeforeTax.value).toBeNull();
  });

  it("accepte un prix de cession déclaré différent de la valorisation", () => {
    const result = sellScenario(view, {
      sellingCostsRate: 0,
      prepaymentPenalty: 0,
      salePrice: 275_000,
    });
    expect(result.attributedSalePrice.value).toBe(275_000);
    expect(result.realisedGainBeforeTax.value).toBeCloseTo(275_000 - 216_000, 6);
  });

  it("applique la quote-part détenue au prix de cession", () => {
    const halfOwned = buildRealEstatePortfolio({
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      assets: [{ ...asset, ownershipShare: 0.5 }],
      valuations: [valuation],
      capitalEvents,
      operatingTerms: [operatingTerms],
      financingLinks: [financingLink],
      liabilities: [mortgage],
    }).assets[0];
    const result = sellScenario(halfOwned, {
      sellingCostsRate: 0,
      prepaymentPenalty: 0,
      salePrice: null,
    });
    expect(result.attributedSalePrice.value).toBe(130_000);
  });
});

describe("prêt synthétique", () => {
  it("laisse le Debt Engine dériver la mensualité : aucune PMT n'est calculée localement", () => {
    const loan = syntheticLoan({
      principal: 180_000,
      annualRate: 0.03,
      termMonths: 240,
      firstPaymentDate: "2026-09-05",
      currency: "EUR",
      monthlyInsurance: null,
      paymentIncludesInsurance: null,
    });
    expect(loan.monthlyPayment).toBe(0);
    const schedule = buildContractualSchedule(loan);
    expect(schedule.entries).toHaveLength(240);
    // Le capital est intégralement amorti par l'échéancier du Debt Engine.
    expect(schedule.entries.at(-1)?.closingBalance).toBeCloseTo(0, 2);
    const totalPrincipal = schedule.entries.reduce((sum, entry) => sum + entry.principal, 0);
    expect(totalPrincipal).toBeCloseTo(180_000, 2);
  });

  it("porte la provenance d'une hypothèse, jamais celle d'un fait", () => {
    const loan = syntheticLoan({
      principal: 100_000,
      annualRate: 0.02,
      termMonths: 120,
      firstPaymentDate: "2026-09-05",
      currency: "EUR",
      monthlyInsurance: null,
      paymentIncludesInsurance: null,
    });
    expect(loan.provenance.kind).toBe("USER_ASSUMPTION");
  });
});

describe("scénario de refinancement", () => {
  const newLoan = {
    principal: 120_000,
    annualRate: 0.012,
    termMonths: 180,
    firstPaymentDate: AS_OF,
    currency: "EUR",
    monthlyInsurance: null,
    paymentIncludesInsurance: null,
  };

  it("compare des coûts économiques, jamais des mensualités", () => {
    const result = refinanceScenario(
      view,
      { newLoan, prepaymentPenalty: 3_000, arrangementFees: 1_500 },
      declaredAssumptions,
      AS_OF,
    );
    const current = result.currentEconomicFinancingCost.value ?? 0;
    const refinanced = result.economicFinancingCost.value ?? 0;
    expect(current).toBeGreaterThan(0);
    expect(refinanced).toBeGreaterThan(0);
    expect(result.economicSaving.value).toBeCloseTo(current - refinanced - 3_000 - 1_500, 6);
  });

  it("un taux plus bas réduit le coût économique du financement", () => {
    const cheaper = refinanceScenario(
      view,
      { newLoan: { ...newLoan, annualRate: 0.005 }, prepaymentPenalty: 0, arrangementFees: 0 },
      declaredAssumptions,
      AS_OF,
    );
    const dearer = refinanceScenario(
      view,
      { newLoan: { ...newLoan, annualRate: 0.04 }, prepaymentPenalty: 0, arrangementFees: 0 },
      declaredAssumptions,
      AS_OF,
    );
    expect(cheaper.economicFinancingCost.value ?? 0).toBeLessThan(
      dearer.economicFinancingCost.value ?? 0,
    );
  });

  it("des frais inconnus rendent l'économie non calculable, pas nulle", () => {
    const result = refinanceScenario(
      view,
      { newLoan, prepaymentPenalty: null, arrangementFees: null },
      declaredAssumptions,
      AS_OF,
    );
    expect(result.economicSaving.value).toBeNull();
    expect(result.blockers).toContain("PREPAYMENT_PENALTY_UNKNOWN:prop");
    expect(result.blockers).toContain("ARRANGEMENT_FEES_UNKNOWN:prop");
  });
});

describe("scénario de travaux", () => {
  const worksInput = {
    capexAmount: 30_000,
    annualRentUplift: 1_800,
    valueUplift: 35_000,
    financing: null,
  };

  it("mesure un rendement marginal distinct du rendement du bien", () => {
    const result = worksScenario(view, worksInput, declaredAssumptions, AS_OF);
    expect(result.marginalYieldOnCapex.value).toBeCloseTo(1_800 / 30_000, 9);
    expect(result.valueCreation.value).toBeCloseTo(5_000, 6);
    expect(result.initialCashFlow.value).toBe(-30_000);
  });

  it("une hausse de loyer non déclarée rend le scénario non calculable", () => {
    const result = worksScenario(
      view,
      { ...worksInput, annualRentUplift: null, valueUplift: null },
      declaredAssumptions,
      AS_OF,
    );
    expect(result.marginalYieldOnCapex.value).toBeNull();
    expect(result.valueCreation.value).toBeNull();
    expect(result.equityIrr).toBeNull();
  });

  it("des travaux financés par le crédit ne sont pas un apport", () => {
    const result = worksScenario(
      view,
      {
        ...worksInput,
        financing: {
          principal: 30_000,
          annualRate: 0.02,
          termMonths: 120,
          firstPaymentDate: AS_OF,
          currency: "EUR",
          monthlyInsurance: null,
          paymentIncludesInsurance: null,
        },
      },
      declaredAssumptions,
      AS_OF,
    );
    expect(result.initialCashFlow.value).toBe(0);
    // Le crédit des travaux alourdit le service de dette du scénario.
    const withoutFinancing = worksScenario(view, worksInput, declaredAssumptions, AS_OF);
    expect(result.years[0].attributedCashDebtService.value ?? 0).toBeGreaterThan(
      withoutFinancing.years[0].attributedCashDebtService.value ?? 0,
    );
  });
});

describe("underwriting prospectif", () => {
  const base = {
    startDate: "2026-09-01",
    currency: "EUR",
    purchasePrice: 200_000,
    acquisitionCosts: 16_000,
    works: 0,
    loan: {
      principal: 180_000,
      annualRate: 0.03,
      termMonths: 240,
      firstPaymentDate: "2026-09-01",
      currency: "EUR",
      monthlyInsurance: null,
      paymentIncludesInsurance: null,
    },
    annualGrossRent: 10_800,
    vacancyRate: 0.05,
    annualOperatingCosts: 2_400,
    assumptions: declaredAssumptions,
  };

  it("dérive l'apport réel du coût total et du capital emprunté", () => {
    const result = underwriteProspectiveRealEstate(base);
    expect(result.totalProjectCost).toBe(216_000);
    expect(result.equityEngaged).toBe(36_000);
    expect(result.loanToCost.value).toBeCloseTo(180_000 / 216_000, 9);
  });

  it("obtient la mensualité du Debt Engine et non d'une formule locale", () => {
    const result = underwriteProspectiveRealEstate(base);
    const loan = syntheticLoan(base.loan, "prospective-loan");
    const schedule = buildContractualSchedule(loan);
    expect(result.monthlyPayment.value).toBeCloseTo(schedule.entries[0].totalCashOut, 6);
  });

  it("distingue le coût du crédit sur l'horizon de son coût à terme", () => {
    const result = underwriteProspectiveRealEstate(base);
    const horizon = result.economicFinancingCost.value ?? 0;
    const fullTerm = result.fullTermEconomicFinancingCost.value ?? 0;
    // Un projet cédé à 10 ans sur un crédit de 20 ans ne paie pas les intérêts des
    // années 11 à 20 : les deux montants ne se confondent jamais.
    expect(horizon).toBeGreaterThan(0);
    expect(fullTerm).toBeGreaterThan(horizon);
  });

  it("un financement qui couvre les frais réduit l'apport sans réduire le coût", () => {
    const result = underwriteProspectiveRealEstate({
      ...base,
      loan: { ...base.loan, principal: 216_000 },
    });
    expect(result.totalProjectCost).toBe(216_000);
    expect(result.equityEngaged).toBe(0);
    expect(result.notes.some((note) => note.includes("dépasse le prix d'achat"))).toBe(true);
  });

  it("l'encours à l'horizon est cohérent avec le capital remboursé sur l'horizon", () => {
    const result = underwriteProspectiveRealEstate(base);
    const principal = result.principalRepaid.value ?? 0;
    // Aucune échéance n'est comptée deux fois : le capital remboursé sur l'horizon explique
    // exactement l'écart entre le capital emprunté et l'encours restant.
    expect(result.outstandingAtHorizon.value).toBeCloseTo(180_000 - principal, 2);
    // La première échéance est bien comptée : au départ, rien n'a encore été payé.
    const firstYearPrincipal = result.years[0].attributedPrincipalRepaid.value ?? 0;
    expect(firstYearPrincipal).toBeGreaterThan(0);
    expect(result.years[0].periodStart).toBe("2026-09-01");
  });

  it("un achat comptant n'a ni mensualité ni coût de financement", () => {
    const result = underwriteProspectiveRealEstate({ ...base, loan: null });
    expect(result.monthlyPayment.value).toBe(0);
    expect(result.economicFinancingCost.value).toBe(0);
    expect(result.outstandingAtHorizon.value).toBe(0);
    expect(result.equityEngaged).toBe(216_000);
    expect(result.debtServiceCoverage.value).toBeNull();
  });

  it("des hypothèses non déclarées bloquent le TRI plutôt que de valoir zéro", () => {
    const result = underwriteProspectiveRealEstate({
      ...base,
      assumptions: undeclaredAssumptions,
    });
    expect(result.equityIrr).toBeNull();
    expect(result.exitProceedsBeforeTax.value).toBeNull();
    expect(result.blockers).toContain("VALUE_GROWTH_UNDECLARED");
  });

  it("un loyer non déclaré rend le rendement non calculable", () => {
    const result = underwriteProspectiveRealEstate({ ...base, annualGrossRent: null });
    expect(result.effectiveRent.value).toBeNull();
    expect(result.grossYieldOnCost.value).toBeNull();
    expect(result.netYieldOnCost.value).toBeNull();
  });

  it("ne produit aucune fiscalité", () => {
    const result = underwriteProspectiveRealEstate(base);
    expect(result.notes.some((note) => note.includes("Aucune fiscalité"))).toBe(true);
  });
});
