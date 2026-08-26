import { describe, expect, it } from "vitest";

import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import { UNDECLARED_LOAN_TERMS, debtServiceBreakdownForPeriod } from "@/lib/engine/debt";
import {
  ALLOCATION_TOLERANCE,
  REAL_ESTATE_VALUATION_STALE_AFTER_DAYS,
  buildRealEstatePortfolio,
  realEstateBalanceSheetContributions,
  type BuildRealEstateInput,
} from "@/lib/engine/real-estate";
import type { CurrencyRate } from "@/lib/engine/fx";
import type {
  ExpenseCategory,
  Liability,
  Provenance,
  RealEstateAsset,
  RealEstateCapitalEvent,
  RealEstateFinancingLink,
  RealEstateOperatingTerms,
  RealEstateValuation,
  Transaction,
} from "@/lib/types";

// Toutes les valeurs de ce fichier sont des fixtures synthétiques, sans lien avec un dossier réel.

const actual: Provenance = { kind: "ACTUAL", confidence: "HIGH" };
const external: Provenance = { kind: "EXTERNAL_DATA", confidence: "MEDIUM" };
const declared: Provenance = { kind: "USER_ASSUMPTION", confidence: "MEDIUM" };

const AS_OF = "2026-08-26";

function asset(overrides: Partial<RealEstateAsset> = {}): RealEstateAsset {
  return {
    id: "prop",
    name: "Appartement locatif",
    location: "Lyon",
    surfaceSqm: 62,
    usage: "RENTAL",
    ownershipShare: 1,
    isDebtFinanced: true,
    acquisitionDate: "2020-06-15",
    disposalDate: null,
    archived: false,
    notes: null,
    provenance: declared,
    ...overrides,
  };
}

function valuation(overrides: Partial<RealEstateValuation> = {}): RealEstateValuation {
  return {
    id: "val",
    propertyId: "prop",
    valuedAt: "2026-06-30",
    value: 260_000,
    currency: "EUR",
    method: "AGENT_ESTIMATE",
    notes: null,
    provenance: external,
    ...overrides,
  };
}

function capital(overrides: Partial<RealEstateCapitalEvent>): RealEstateCapitalEvent {
  return {
    id: "cap",
    propertyId: "prop",
    type: "ACQUISITION_PRICE",
    eventDate: "2020-06-15",
    amount: 200_000,
    currency: "EUR",
    label: null,
    transactionId: null,
    notes: null,
    provenance: actual,
    ...overrides,
  };
}

/** Termes intégralement déclarés : c'est le seul cas où le rendement net est calculable. */
function terms(overrides: Partial<RealEstateOperatingTerms> = {}): RealEstateOperatingTerms {
  return {
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
    ...overrides,
  };
}

function mortgage(overrides: Partial<Liability> = {}): Liability {
  return {
    ...UNDECLARED_LOAN_TERMS,
    id: "loan",
    name: "Crédit immobilier",
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
    ...overrides,
  };
}

function link(overrides: Partial<RealEstateFinancingLink> = {}): RealEstateFinancingLink {
  return {
    id: "link",
    propertyId: "prop",
    liabilityId: "loan",
    allocationShare: 1,
    notes: null,
    provenance: declared,
    ...overrides,
  };
}

function build(overrides: Partial<BuildRealEstateInput> = {}) {
  return buildRealEstatePortfolio({
    asOfDate: AS_OF,
    reportingCurrency: "EUR",
    assets: [asset()],
    valuations: [valuation()],
    capitalEvents: [
      capital({}),
      capital({ id: "cost", type: "ACQUISITION_COST", amount: 16_000 }),
      capital({ id: "no-capex", type: "CAPEX", amount: 0, label: "Aucun travaux déclaré" }),
    ],
    operatingTerms: [terms()],
    financingLinks: [link()],
    liabilities: [mortgage()],
    ...overrides,
  });
}

describe("real estate — valeur, coût de revient, equity", () => {
  it("distingue valeur de marché, coût de revient et plus-value latente", () => {
    const view = build().assets[0];
    expect(view.valuation.grossValue.value).toBe(260_000);
    expect(view.costBasis.acquisitionPrice.value).toBe(200_000);
    expect(view.costBasis.acquisitionCosts.value).toBe(16_000);
    expect(view.costBasis.totalCostBasis.value).toBe(216_000);
    // La plus-value latente est un écart de VALEUR, pas une trésorerie.
    expect(view.equity.unrealisedGain.value).toBe(44_000);
    expect(view.equity.currentEquity.value).toBe(140_000);
  });

  it("applique la quote-part détenue à la valeur comme au coût de revient", () => {
    const view = build({ assets: [asset({ ownershipShare: 0.5 })] }).assets[0];
    expect(view.valuation.ownerValue.value).toBe(130_000);
    expect(view.costBasis.ownerCostBasis.value).toBe(108_000);
    expect(view.equity.unrealisedGain.value).toBe(22_000);
  });

  it("ne suppose jamais une quote-part entière quand elle n'est pas déclarée", () => {
    const view = build({ assets: [asset({ ownershipShare: null })] }).assets[0];
    expect(view.valuation.ownerValue.value).toBeNull();
    expect(view.equity.currentEquity.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("OWNERSHIP_SHARE_MISSING");
    // La valeur du bien ENTIER reste connue : l'ignorance porte sur la part détenue.
    expect(view.valuation.grossValue.value).toBe(260_000);
  });

  it("un bien sans valorisation n'a pas une valeur nulle, il a une valeur inconnue", () => {
    const view = build({ valuations: [] }).assets[0];
    expect(view.valuation.observation).toBeNull();
    expect(view.valuation.status).toBe("MISSING");
    expect(view.valuation.grossValue.value).toBeNull();
    expect(view.valuation.grossValue.blockers).toContain("VALUATION_MISSING:prop");
    expect(view.equity.unrealisedGain.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("VALUATION_MISSING");
  });

  it("retient la valorisation la plus récente qui n'est pas postérieure à la date de lecture", () => {
    const view = build({
      valuations: [
        valuation({ id: "old", valuedAt: "2025-01-01", value: 240_000 }),
        valuation({ id: "future", valuedAt: "2026-12-31", value: 300_000 }),
      ],
    }).assets[0];
    expect(view.valuation.observation?.id).toBe("old");
    expect(view.valuation.grossValue.value).toBe(240_000);
  });

  it("signale une valorisation périmée sans jamais l'indexer", () => {
    const view = build({ valuations: [valuation({ valuedAt: "2024-01-01" })] }).assets[0];
    expect(view.valuation.status).toBe("STALE");
    expect(view.valuation.ageDays).toBeGreaterThan(REAL_ESTATE_VALUATION_STALE_AFTER_DAYS);
    // Valeur inchangée : le moteur signale l'âge, il ne corrige pas le montant.
    expect(view.valuation.grossValue.value).toBe(260_000);
  });

  it("signale un coût de revient sans frais d'acquisition déclarés", () => {
    const view = build({
      capitalEvents: [capital({}), capital({ id: "no-capex", type: "CAPEX", amount: 0 })],
    }).assets[0];
    expect(view.costBasis.acquisitionCostEventCount).toBe(0);
    expect(view.costBasis.acquisitionCosts.value).toBeNull();
    expect(view.costBasis.totalCostBasis.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("ACQUISITION_COSTS_NOT_DECLARED");
  });

  it("ne transforme pas l'absence de travaux déclarés en capex nul", () => {
    const view = build({
      capitalEvents: [
        capital({}),
        capital({ id: "cost", type: "ACQUISITION_COST", amount: 16_000 }),
      ],
    }).assets[0];
    expect(view.costBasis.capex.value).toBeNull();
    expect(view.costBasis.totalCostBasis.value).toBeNull();
    expect(view.equity.unrealisedGain.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("CAPEX_NOT_DECLARED");
  });

  it("ignore défensivement un événement de capital postérieur à la date de lecture", () => {
    const view = build({
      capitalEvents: [
        capital({}),
        capital({ id: "cost", type: "ACQUISITION_COST", amount: 16_000 }),
        capital({ id: "no-capex", type: "CAPEX", amount: 0 }),
        capital({ id: "future-works", type: "CAPEX", amount: 50_000, eventDate: "2027-01-01" }),
      ],
    }).assets[0];
    expect(view.costBasis.totalCostBasis.value).toBe(216_000);
    expect(view.flags.map((flag) => flag.code)).toContain("CAPITAL_EVENT_FUTURE_IGNORED");
  });

  it("les travaux capitalisés augmentent le coût de revient, jamais les charges", () => {
    const view = build({
      capitalEvents: [
        capital({}),
        capital({ id: "cost", type: "ACQUISITION_COST", amount: 16_000 }),
        capital({ id: "works", type: "CAPEX", amount: 25_000, eventDate: "2023-04-01" }),
      ],
    }).assets[0];
    expect(view.costBasis.capex.value).toBe(25_000);
    expect(view.costBasis.totalCostBasis.value).toBe(241_000);
    // Le résultat d'exploitation ignore les travaux : ce ne sont pas des charges.
    expect(view.operating.netOperatingIncome.value).toBe(11_400 - 3_600);
  });
});

describe("real estate — exploitation et rendements", () => {
  it("dérive loyer effectif, charges et résultat d'exploitation", () => {
    const view = build().assets[0];
    expect(view.operating.grossRent.value).toBe(12_000);
    expect(view.operating.effectiveRent.value).toBeCloseTo(11_400, 6);
    expect(view.operating.operatingCosts.value).toBe(3_600);
    expect(view.operating.netOperatingIncome.value).toBeCloseTo(7_800, 6);
  });

  it("un poste de charge non déclaré rend le rendement net non calculable, jamais flatteur", () => {
    const view = build({ operatingTerms: [terms({ annualPropertyTax: null })] }).assets[0];
    expect(view.operating.operatingCosts.value).toBeNull();
    expect(view.operating.netOperatingIncome.value).toBeNull();
    expect(view.returns.netYieldOnValue.value).toBeNull();
    expect(view.operating.undeclaredTerms).toContain("Taxe foncière");
    expect(view.flags.map((flag) => flag.code)).toContain("OPERATING_TERM_UNDECLARED");
    // Le loyer brut reste connu : l'ignorance ne se propage pas au-delà de sa dépendance.
    expect(view.returns.grossYieldOnValue.value).toBeCloseTo(12_000 / 260_000, 9);
  });

  it("distingue une charge déclarée à zéro d'une charge non déclarée", () => {
    const zero = build({ operatingTerms: [terms({ annualOtherCosts: 0 })] }).assets[0];
    const missing = build({ operatingTerms: [terms({ annualOtherCosts: null })] }).assets[0];
    expect(zero.operating.operatingCosts.value).toBe(3_600);
    expect(missing.operating.operatingCosts.value).toBeNull();
  });

  it("une vacance non déclarée n'est pas une vacance nulle", () => {
    const view = build({ operatingTerms: [terms({ vacancyRate: null })] }).assets[0];
    expect(view.operating.effectiveRent.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("VACANCY_RATE_MISSING");
    expect(view.operating.grossRent.value).toBe(12_000);
  });

  it("des frais de gestion en part du loyer dépendent du loyer effectif", () => {
    const view = build({
      operatingTerms: [terms({ annualManagementFees: null, managementFeeRate: 0.07 })],
    }).assets[0];
    const management = view.operating.costBreakdown.find(
      (item) => item.label === "Frais de gestion",
    );
    expect(management?.amount.value).toBeCloseTo(11_400 * 0.07, 6);
  });

  it("nomme le dénominateur de chaque rendement", () => {
    const view = build().assets[0];
    expect(view.returns.grossYieldOnValue.value).toBeCloseTo(12_000 / 260_000, 9);
    expect(view.returns.grossYieldOnCost.value).toBeCloseTo(12_000 / 216_000, 9);
    expect(view.returns.netYieldOnValue.value).toBeCloseTo(7_800 / 260_000, 9);
    expect(view.returns.netYieldOnCost.value).toBeCloseTo(7_800 / 216_000, 9);
    // Deux dénominateurs différents donnent deux rendements différents : les confondre
    // ferait passer un rendement sur prix nu pour un rendement sur coût complet.
    expect(view.returns.grossYieldOnValue.value).not.toBe(view.returns.grossYieldOnCost.value);
  });

  it("signale un loyer déclaré sur un bien qui n'est pas locatif", () => {
    const view = build({ assets: [asset({ usage: "PRIMARY_RESIDENCE" })] }).assets[0];
    expect(view.flags.map((flag) => flag.code)).toContain("RENT_DECLARED_ON_NON_RENTAL");
    // Le loyer n'est ni ignoré ni corrigé : l'incohérence est rendue visible.
    expect(view.operating.grossRent.value).toBe(12_000);
  });

  it("refuse un rendement sur une base nulle plutôt que de renvoyer l'infini", () => {
    const view = build({
      capitalEvents: [capital({ amount: 0 })],
      valuations: [valuation({ value: 0 })],
    }).assets[0];
    expect(view.returns.grossYieldOnValue.value).toBeNull();
    expect(view.returns.netYieldOnCost.value).toBeNull();
  });
});

describe("real estate — financement consommé du Debt Engine", () => {
  it("n'a pas de moteur d'amortissement propre : ses chiffres sont ceux du Debt Engine", () => {
    const loan = mortgage();
    const view = build().assets[0];
    const reference = debtServiceBreakdownForPeriod([loan], AS_OF, AS_OF, "2027-08-26");
    expect(view.debt.cashDebtService.value).toBeCloseTo(reference.totalCashOut, 6);
    expect(view.debt.economicCost.value).toBeCloseTo(reference.economicCost, 6);
    expect(view.debt.principalPaid.value).toBeCloseTo(reference.principal, 6);
    expect(reference.totalCashOut).toBeGreaterThan(0);
  });

  it("sépare le coût économique du financement du remboursement de capital", () => {
    const view = build().assets[0];
    const economic = view.debt.economicCost.value ?? 0;
    const principal = view.debt.principalPaid.value ?? 0;
    const cash = view.debt.cashDebtService.value ?? 0;
    expect(economic).toBeGreaterThan(0);
    expect(principal).toBeGreaterThan(0);
    // Le décaissement est la somme des deux ; le coût, non. PRINCIPAL ≠ CHARGE.
    expect(economic + principal).toBeCloseTo(cash, 6);
    expect(economic).toBeLessThan(cash);
  });

  it("met la dette à la quote-part du rattachement sans en créer une seconde", () => {
    const whole = build().assets[0];
    const half = build({ financingLinks: [link({ allocationShare: 0.5 })] }).assets[0];
    expect(half.equity.attributedOutstandingDebt.value).toBeCloseTo(
      (whole.equity.attributedOutstandingDebt.value ?? 0) / 2,
      6,
    );
    expect(half.debt.economicCost.value).toBeCloseTo((whole.debt.economicCost.value ?? 0) / 2, 6);
  });

  it("refuse d'attribuer une dette dont les quote-parts cumulées dépassent 1", () => {
    const portfolio = build({
      assets: [asset(), asset({ id: "prop2", name: "Second bien" })],
      valuations: [valuation(), valuation({ id: "val2", propertyId: "prop2" })],
      capitalEvents: [capital({}), capital({ id: "cap2", propertyId: "prop2" })],
      operatingTerms: [terms(), terms({ id: "terms2", propertyId: "prop2" })],
      financingLinks: [
        link({ allocationShare: 0.8 }),
        link({ id: "link2", propertyId: "prop2", allocationShare: 0.5 }),
      ],
    });
    for (const view of portfolio.assets) {
      expect(view.flags.map((flag) => flag.code)).toContain("DEBT_OVER_ALLOCATED");
      // Aucune attribution n'est dérivée : surévaluer l'equity serait pire que ne rien dire.
      expect(view.equity.attributedOutstandingDebt.value).toBeNull();
      expect(view.debt.economicCost.value).toBeNull();
    }
  });

  it("accepte des quote-parts qui saturent exactement le concours", () => {
    const portfolio = build({
      assets: [asset(), asset({ id: "prop2", name: "Second bien" })],
      valuations: [valuation(), valuation({ id: "val2", propertyId: "prop2" })],
      capitalEvents: [capital({}), capital({ id: "cap2", propertyId: "prop2" })],
      operatingTerms: [terms(), terms({ id: "terms2", propertyId: "prop2" })],
      financingLinks: [
        link({ allocationShare: 0.6 }),
        link({ id: "link2", propertyId: "prop2", allocationShare: 0.4 }),
      ],
    });
    const attributed = portfolio.assets.map(
      (view) => view.equity.attributedOutstandingDebt.value ?? 0,
    );
    // La somme des parts attribuées égale l'encours du concours, jamais plus.
    expect(attributed[0] + attributed[1]).toBeCloseTo(120_000, 6);
    expect(ALLOCATION_TOLERANCE).toBeLessThan(1e-6);
  });

  it("un bien DÉCLARÉ sans dette a bien un financement nul", () => {
    const view = build({
      assets: [asset({ isDebtFinanced: false })],
      financingLinks: [],
    }).assets[0];
    expect(view.financingState).toBe("DECLARED_NONE");
    expect(view.debt.cashDebtService.value).toBe(0);
    expect(view.equity.attributedOutstandingDebt.value).toBe(0);
    expect(view.equity.currentEquity.value).toBe(260_000);
    expect(view.flags.map((flag) => flag.code)).toContain("DEBT_FREE_DECLARED");
    // Sans dette, l'apport réel est le coût de revient entier : il reste calculable.
    expect(view.returns.equityEngaged.value).toBeCloseTo(216_000, 6);
    // Aucun service de dette à couvrir : le ratio n'existe pas, il ne vaut pas l'infini.
    expect(view.returns.debtServiceCoverage.value).toBeNull();
  });

  it("une dette déclarée mais non rattachée n'est PAS une dette nulle", () => {
    const view = build({
      assets: [asset({ isDebtFinanced: true })],
      financingLinks: [],
    }).assets[0];
    expect(view.financingState).toBe("UNKNOWN");
    // C'est le cœur du point : zéro serait un mensonge de 120 000 € sur le patrimoine.
    expect(view.equity.attributedOutstandingDebt.value).toBeNull();
    expect(view.equity.currentEquity.value).toBeNull();
    expect(view.debt.cashDebtService.value).toBeNull();
    expect(view.debt.economicCost.value).toBeNull();
    expect(view.returns.equityEngaged.value).toBeNull();
    expect(view.returns.cashOnCashOnEquityEngaged.value).toBeNull();
    expect(view.returns.preTaxCashFlow.value).toBeNull();
    expect(view.returns.loanToValue.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("DEBT_DECLARED_NOT_LINKED");
    expect(view.equity.attributedOutstandingDebt.blockers).toContain(
      "DEBT_DECLARED_NOT_LINKED:prop",
    );
    // L'ignorance ne se propage pas au-delà de sa dépendance : valeur, coût de revient et
    // rendements d'exploitation restent parfaitement connus.
    expect(view.valuation.ownerValue.value).toBe(260_000);
    expect(view.equity.unrealisedGain.value).toBe(44_000);
    expect(view.operating.netOperatingIncome.value).toBeCloseTo(7_800, 6);
    expect(view.returns.netYieldOnValue.value).toBeCloseTo(7_800 / 260_000, 9);
  });

  it("un financement NON DÉCLARÉ ne vaut pas non plus zéro", () => {
    const view = build({
      assets: [asset({ isDebtFinanced: null })],
      financingLinks: [],
    }).assets[0];
    expect(view.financingState).toBe("UNKNOWN");
    expect(view.equity.currentEquity.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("FINANCING_UNDECLARED");
    expect(view.equity.attributedOutstandingDebt.blockers).toContain("FINANCING_UNDECLARED:prop");
  });

  it("un rattachement l'emporte sur une déclaration d'achat comptant, et la contredit", () => {
    const view = build({ assets: [asset({ isDebtFinanced: false })] }).assets[0];
    expect(view.financingState).toBe("LINKED");
    // Le fait prime sur l'affirmation : ignorer un concours réellement rattaché
    // sous-estimerait la dette du bien.
    expect(view.equity.attributedOutstandingDebt.value).toBe(120_000);
    expect(view.flags.map((flag) => flag.code)).toContain("FINANCING_DECLARATION_CONTRADICTED");
  });

  it("un financement non déclaré n'empêche pas le bien d'entrer au bilan", () => {
    // La valeur du bien ne dépend pas de son financement : elle reste au bilan, et c'est
    // le passif de `liabilities` qui porte la dette, connue ou non rattachée.
    const portfolio = build({
      assets: [asset({ isDebtFinanced: null })],
      financingLinks: [],
    });
    const contributions = realEstateBalanceSheetContributions(portfolio);
    expect(contributions).toHaveLength(1);
    expect(contributions[0].nativeValue).toBe(260_000);
    expect(portfolio.grossValue.value).toBe(260_000);
    // En revanche l'equity du domaine, elle, n'est pas calculable.
    expect(portfolio.equity.value).toBeNull();
    expect(portfolio.attributedDebt.value).toBeNull();
    expect(portfolio.quality.status).toBe("NOT_COMPUTABLE");
    expect(portfolio.quality.blockers).toContain("FINANCING_UNDECLARED:prop");
  });

  it("signale un rattachement vers une dette absente de l'état", () => {
    const view = build({ liabilities: [] }).assets[0];
    expect(view.financing).toHaveLength(0);
    expect(view.financingState).toBe("UNKNOWN");
    expect(view.equity.currentEquity.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("FINANCING_LINK_ORPHAN");
  });

  it("un lien orphelin contredit défensivement une déclaration sans dette", () => {
    const view = build({
      assets: [asset({ isDebtFinanced: false })],
      liabilities: [],
    }).assets[0];
    expect(view.financingState).toBe("UNKNOWN");
    expect(view.equity.attributedOutstandingDebt.blockers).toContain("FINANCING_LINK_ORPHAN:prop");
  });

  it("mesure l'apport réel : un coût financé par le crédit n'est pas un apport", () => {
    const view = build().assets[0];
    // Coût de revient 216 000, capital emprunté 160 000 : 56 000 sortis de la poche.
    expect(view.returns.equityEngaged.value).toBeCloseTo(56_000, 6);
    const financedInFull = build({
      liabilities: [mortgage({ principal: 216_000 })],
    }).assets[0];
    expect(financedInFull.returns.equityEngaged.value).toBeCloseTo(0, 6);
    expect(financedInFull.returns.cashOnCashOnEquityEngaged.value).toBeNull();
    expect(financedInFull.flags.map((flag) => flag.code)).toContain("EQUITY_ENGAGED_NOT_POSITIVE");
  });
});

describe("real estate — fiscalité déclarée seulement", () => {
  it("ne produit aucun résultat après impôt sans taux effectif déclaré", () => {
    const view = build().assets[0];
    expect(view.returns.declaredTax.value).toBeNull();
    expect(view.returns.declaredTax.blockers).toContain("TAX_RATE_UNDECLARED:prop");
    expect(view.returns.afterTaxCashFlow.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("TAX_RATE_UNDECLARED");
  });

  it("applique le taux déclaré à une assiette nommée", () => {
    const view = build({
      operatingTerms: [terms({ effectiveIncomeTaxRate: 0.3 })],
    }).assets[0];
    const interest = view.debt.interestPaid.value ?? 0;
    const base = 7_800 - interest;
    expect(view.returns.taxBase.value).toBeCloseTo(base, 6);
    expect(view.returns.declaredTax.value).toBeCloseTo(base * 0.3, 6);
    expect(view.returns.taxBaseConvention).toBe("NOI_ATTRIBUE_MOINS_INTERETS_ATTRIBUES");
  });

  it("ne crée aucun crédit d'impôt sur un résultat foncier négatif", () => {
    const view = build({
      operatingTerms: [terms({ annualGrossRent: 0, effectiveIncomeTaxRate: 0.3 })],
    }).assets[0];
    expect((view.returns.taxBase.value ?? 0) < 0).toBe(true);
    expect(view.returns.declaredTax.value).toBe(0);
  });
});

describe("real estate — devises", () => {
  const rates: CurrencyRate[] = [
    {
      baseCurrency: "CHF",
      quoteCurrency: "EUR",
      rate: 1.05,
      rateDate: "2026-06-30",
      provenance: external,
    },
  ];

  it("convertit chaque fait au taux de SA date et signale la plus-value non isolée", () => {
    const view = build({
      valuations: [valuation({ currency: "CHF", value: 300_000 })],
      capitalEvents: [capital({ currency: "CHF", amount: 250_000, eventDate: "2026-06-30" })],
      currencyRates: rates,
    }).assets[0];
    expect(view.valuation.grossValue.value).toBeCloseTo(315_000, 6);
    expect(view.costBasis.acquisitionPrice.value).toBeCloseTo(262_500, 6);
    expect(view.flags.map((flag) => flag.code)).toContain("FX_PNL_NOT_ISOLATED");
  });

  it("un taux absent rend la valeur non calculable, il ne vaut jamais 1", () => {
    const view = build({
      valuations: [valuation({ currency: "CHF", value: 300_000 })],
      currencyRates: [],
    }).assets[0];
    expect(view.valuation.grossValue.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("FX_MISSING");
  });

  it("refuse de convertir le capital emprunté sans date de décaissement connue", () => {
    const view = build({
      liabilities: [mortgage({ currency: "CHF" })],
      currencyRates: [
        ...rates,
        {
          baseCurrency: "CHF",
          quoteCurrency: "EUR",
          rate: 1.05,
          rateDate: "2020-08-05",
          provenance: external,
        },
      ],
    }).assets[0];
    // L'encours OBSERVÉ est daté par le contrat : il se convertit.
    expect(view.equity.attributedOutstandingDebt.value).toBeCloseTo(120_000 * 1.05, 6);
    // Le capital EMPRUNTÉ est historique et sa date de décaissement n'existe pas dans le
    // modèle de dette. Même avec un taux disponible à la première échéance, le moteur ne
    // substitue aucune date approchée : l'apport réel reste non calculable.
    expect(view.equity.attributedOriginalPrincipal.value).toBeNull();
    expect(view.returns.equityEngaged.value).toBeNull();
    expect(view.returns.cashOnCashOnEquityEngaged.value).toBeNull();
    expect(view.equity.attributedOriginalPrincipal.blockers).toContain(
      "FINANCING_ORIGINATION_DATE_UNKNOWN:loan",
    );
    expect(view.flags.map((flag) => flag.code)).toContain("FINANCING_ORIGINATION_DATE_UNKNOWN");
    // L'encours OBSERVÉ reste calculable, mais le service FUTUR requerrait une courbe FX.
    expect(view.equity.currentEquity.value).not.toBeNull();
    expect(view.debt.economicCost.value).toBeNull();
    expect(view.debt.economicCost.blockers).toContain("FUTURE_FX_UNAVAILABLE:CHF/EUR:loan");
    expect(view.flags.map((flag) => flag.code)).toContain("FUTURE_FX_UNAVAILABLE");
  });

  it("en devise de reporting, le capital emprunté est exact sans conversion", () => {
    const view = build().assets[0];
    expect(view.equity.attributedOriginalPrincipal.value).toBe(160_000);
    expect(view.returns.equityEngaged.value).toBeCloseTo(56_000, 6);
    expect(view.flags.map((flag) => flag.code)).not.toContain("FINANCING_ORIGINATION_DATE_UNKNOWN");
  });

  it("signale des faits libellés en devises différentes sans les additionner en natif", () => {
    const view = build({
      valuations: [valuation({ currency: "CHF", value: 300_000 })],
      capitalEvents: [capital({ currency: "EUR", amount: 200_000 })],
      currencyRates: rates,
    }).assets[0];
    expect(view.factCurrency).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("CURRENCY_MIXED");
  });
});

describe("real estate — contributions au bilan canonique", () => {
  it("émet une ligne d'ACTIF et AUCUNE ligne de passif", () => {
    const contributions = realEstateBalanceSheetContributions(build());
    expect(contributions).toHaveLength(1);
    expect(contributions[0].side).toBe("ASSET");
    expect(contributions[0].domain).toBe("REAL_ESTATE");
    expect(contributions.some((line) => line.side === "LIABILITY")).toBe(false);
  });

  it("ne compte jamais la dette immobilière deux fois", () => {
    const liabilities = [mortgage()];
    const withProperty = buildCanonicalBalanceSheet({
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      liabilities,
      contributions: realEstateBalanceSheetContributions(build()),
    });
    const withoutProperty = buildCanonicalBalanceSheet({
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      liabilities,
    });
    // Le passif est identique avec ou sans le bien : il vient de `liabilities` et de lui seul.
    expect(withProperty.contractualDebt.value).toBe(withoutProperty.contractualDebt.value);
    expect(withProperty.totalLiabilities.value).toBe(withoutProperty.totalLiabilities.value);
    expect(withProperty.grossAssets.value).toBe(260_000);
    expect(withProperty.netWorth.value).toBe(260_000 - 120_000);
  });

  it("émet la valeur en devise NATIVE : la conversion appartient au bilan", () => {
    const rates: CurrencyRate[] = [
      {
        baseCurrency: "CHF",
        quoteCurrency: "EUR",
        rate: 1.05,
        rateDate: "2026-06-30",
        provenance: external,
      },
    ];
    const portfolio = build({
      valuations: [valuation({ currency: "CHF", value: 300_000 })],
      currencyRates: rates,
    });
    const [line] = realEstateBalanceSheetContributions(portfolio);
    expect(line.currency).toBe("CHF");
    expect(line.nativeValue).toBe(300_000);
    const sheet = buildCanonicalBalanceSheet({
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      contributions: [line],
      currencyRates: rates,
    });
    // Une seule conversion, faite par le bilan, jamais deux.
    expect(sheet.grossAssets.value).toBeCloseTo(315_000, 6);
  });

  it("un bien non valorisable rend l'actif brut PARTIAL au lieu de le sous-évaluer", () => {
    const portfolio = build({
      assets: [asset(), asset({ id: "prop2", name: "Bien non valorisé" })],
      valuations: [valuation()],
      capitalEvents: [capital({})],
      operatingTerms: [terms()],
      financingLinks: [],
    });
    const contributions = realEstateBalanceSheetContributions(portfolio);
    const unvalued = contributions.find((line) => line.entityId === "prop2");
    expect(unvalued?.nativeValue).toBeNull();
    expect(unvalued?.valuationBlockers).toContain("REAL_ESTATE_VALUATION_MISSING:prop2");
    expect(unvalued?.valuationStatus).toBe("MISSING");

    const sheet = buildCanonicalBalanceSheet({
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      contributions,
    });
    expect(sheet.grossAssets.status).toBe("PARTIAL");
    expect(sheet.grossAssets.value).toBeNull();
    // Le montant connu reste connu : l'ignorance sur un bien n'efface pas l'autre.
    expect(sheet.grossAssets.knownValue).toBe(260_000);
    expect(sheet.grossAssets.blockers).toContain("REAL_ESTATE_VALUATION_MISSING:prop2");
    expect(sheet.netWorth.value).toBeNull();
  });

  it("exclut du bilan un bien cédé ou archivé sans perdre ses faits", () => {
    const disposed = build({
      assets: [asset({ disposalDate: "2026-03-31" })],
      capitalEvents: [
        capital({}),
        capital({ id: "cost", type: "ACQUISITION_COST", amount: 0 }),
        capital({ id: "no-capex", type: "CAPEX", amount: 0 }),
        capital({ id: "sale", type: "DISPOSAL_PRICE", amount: 270_000, eventDate: "2026-03-31" }),
        capital({ id: "salecost", type: "DISPOSAL_COST", amount: 12_000, eventDate: "2026-03-31" }),
      ],
    });
    expect(realEstateBalanceSheetContributions(disposed)).toHaveLength(0);
    const view = disposed.assets[0];
    expect(view.isOnBalanceSheet).toBe(false);
    expect(view.disposedAt).toBe("2026-03-31");
    // Plus-value RÉALISÉE : prix net de frais moins coût de revient.
    expect(view.equity.realisedGain.value).toBeCloseTo(270_000 - 12_000 - 200_000, 6);
    expect(disposed.grossValue.value).toBe(0);
  });

  it("ne suppose pas des frais de cession nuls lorsqu'un prix de vente existe", () => {
    const disposed = build({
      assets: [asset({ disposalDate: "2026-03-31" })],
      capitalEvents: [
        capital({}),
        capital({ id: "cost", type: "ACQUISITION_COST", amount: 0 }),
        capital({ id: "no-capex", type: "CAPEX", amount: 0 }),
        capital({ id: "sale", type: "DISPOSAL_PRICE", amount: 270_000, eventDate: "2026-03-31" }),
      ],
    });
    const view = disposed.assets[0];
    expect(view.costBasis.disposalCosts.value).toBeNull();
    expect(view.equity.realisedGain.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("DISPOSAL_COSTS_NOT_DECLARED");
  });

  it("un bien à céder plus tard reste au bilan aujourd'hui", () => {
    const portfolio = build({ assets: [asset({ disposalDate: "2027-01-01" })] });
    expect(portfolio.assets[0].isOnBalanceSheet).toBe(true);
    expect(realEstateBalanceSheetContributions(portfolio)).toHaveLength(1);
  });
});

describe("real estate — flux réels, une seule vérité de trésorerie", () => {
  const categories: ExpenseCategory[] = [
    {
      id: "cat_rent",
      name: "Loyers encaissés",
      groupName: "Revenus",
      cashFlowKind: "INCOME",
      essentiality: "UNKNOWN",
      behavior: "UNKNOWN",
      monthlyAmount: null,
      essential: false,
      archived: false,
      provenance: declared,
    },
  ];
  const rentTransaction = (month: string): Transaction => ({
    id: `tx-${month}`,
    accountId: "acc",
    accountName: "Compte courant",
    date: `${month}-05`,
    label: "Loyer",
    categoryId: "cat_rent",
    categoryName: "Loyers encaissés",
    amount: 950,
    currency: "EUR",
    kindOverride: null,
    transferGroupId: null,
    propertyId: "prop",
    notes: null,
    provenance: actual,
  });

  const months = [
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
  ];

  it("classe les flux rattachés avec le Cash Flow Engine, sans en créer aucun", () => {
    const view = build({
      transactions: months.map(rentTransaction),
      expenseCategories: categories,
      ledgerCoverageStart: "2020-01-01",
    }).assets[0];
    expect(view.observed.transactionCount).toBe(12);
    expect(view.observed.cashFlow?.income).toBeCloseTo(950 * 12, 6);
    expect(view.observed.cashFlow?.coverage.status).toBe("COMPLETE");
    expect(view.observed.observedIncome.value).toBeCloseTo(950 * 12, 6);
    // Écart entre loyer effectif DÉCLARÉ et revenus OBSERVÉS : deux grandeurs de nature
    // différente, et le moteur le signale plutôt que de présenter l'un pour l'autre.
    expect(view.observed.declaredRentVsObservedIncome.value).toBeCloseTo(11_400 - 11_400, 6);
    expect(view.flags.map((flag) => flag.code)).toContain("OBSERVED_INCOME_NOT_RENT_QUALIFIED");
  });

  it("ne présente jamais un revenu non locatif comme un loyer observé", () => {
    const insurancePayout: Transaction = {
      ...rentTransaction("2026-04"),
      id: "tx-indemnite",
      label: "Indemnité sinistre",
      amount: 4_000,
    };
    const view = build({
      transactions: [...months.map(rentTransaction), insurancePayout],
      expenseCategories: categories,
      ledgerCoverageStart: "2020-01-01",
    }).assets[0];
    // Le moteur additionne ce qu'il sait classer : 12 loyers PLUS l'indemnité. Il ne peut
    // pas les distinguer sans nature de revenu locatif, et il ne prétend pas le faire.
    expect(view.observed.observedIncome.value).toBeCloseTo(950 * 12 + 4_000, 6);
    expect(view.observed.declaredRentVsObservedIncome.value).toBeCloseTo(11_400 - 15_400, 6);
    expect(view.flags.map((flag) => flag.code)).toContain("OBSERVED_INCOME_NOT_RENT_QUALIFIED");
  });

  it("ne compare pas au déclaré une fenêtre observée non couverte", () => {
    const view = build({
      transactions: months.map(rentTransaction),
      expenseCategories: categories,
      ledgerCoverageStart: null,
    }).assets[0];
    expect(view.observed.cashFlow?.coverage.status).toBe("INSUFFICIENT");
    expect(view.observed.observedIncome.value).toBeNull();
    expect(view.observed.declaredRentVsObservedIncome.value).toBeNull();
    expect(view.flags.map((flag) => flag.code)).toContain("OBSERVED_LEDGER_NOT_COVERED");
  });

  it("ignore les flux rattachés à un autre bien", () => {
    const view = build({
      transactions: [{ ...rentTransaction("2026-05"), propertyId: "autre" }],
      expenseCategories: categories,
      ledgerCoverageStart: "2020-01-01",
    }).assets[0];
    expect(view.observed.transactionCount).toBe(0);
    expect(view.observed.cashFlow).toBeNull();
  });

  it("convertit chaque transaction immobilière au FX historique de sa date", () => {
    const usdTransactions = months.map((month) => ({
      ...rentTransaction(month),
      amount: 1_000,
      currency: "USD",
    }));
    const currencyRates: CurrencyRate[] = usdTransactions.map((transaction) => ({
      baseCurrency: "USD",
      quoteCurrency: "EUR",
      rate: 0.9,
      rateDate: transaction.date,
      provenance: external,
    }));
    const view = build({
      transactions: usdTransactions,
      expenseCategories: categories,
      ledgerCoverageStart: "2020-01-01",
      currencyRates,
    }).assets[0];
    expect(view.observed.cashFlow?.income).toBeCloseTo(10_800, 6);
    expect(view.observed.observedIncome.value).toBeCloseTo(10_800, 6);
  });

  it("rend les flux observés non calculables dès qu'un FX historique manque", () => {
    const view = build({
      transactions: [
        ...months.slice(0, -1).map(rentTransaction),
        { ...rentTransaction(months.at(-1) as string), amount: 1_000, currency: "USD" },
      ],
      expenseCategories: categories,
      ledgerCoverageStart: "2020-01-01",
      currencyRates: [],
    }).assets[0];
    expect(view.observed.cashFlow).toBeNull();
    expect(view.observed.observedIncome.value).toBeNull();
    expect(view.observed.observedIncome.blockers[0]).toContain("FX_MISSING:USD/EUR@");
    expect(view.flags.map((flag) => flag.code)).toContain("FX_MISSING");
  });
});

describe("real estate — agrégats du domaine", () => {
  it("agrège les biens connus et signale ce qui manque", () => {
    const portfolio = build({
      assets: [asset(), asset({ id: "prop2", name: "Second bien", ownershipShare: null })],
      valuations: [valuation(), valuation({ id: "val2", propertyId: "prop2" })],
      capitalEvents: [capital({})],
      operatingTerms: [terms()],
    });
    expect(portfolio.grossValue.status).toBe("PARTIAL");
    expect(portfolio.grossValue.knownValue).toBe(260_000);
    expect(portfolio.grossValue.value).toBeNull();
    expect(portfolio.flags.map((flag) => flag.code)).toContain("OWNERSHIP_SHARE_MISSING");
  });

  it("un domaine sans aucun bien vaut zéro et non « non calculable »", () => {
    const portfolio = buildRealEstatePortfolio({
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      assets: [],
      valuations: [],
      capitalEvents: [],
      operatingTerms: [],
      financingLinks: [],
      liabilities: [],
    });
    expect(portfolio.grossValue.value).toBe(0);
    expect(portfolio.grossValue.status).toBe("COMPLETE");
    expect(portfolio.assets).toHaveLength(0);
    expect(realEstateBalanceSheetContributions(portfolio)).toHaveLength(0);
  });
});
