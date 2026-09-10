import { describe, expect, it } from "vitest";
import { buildNetWorthView } from "@/lib/presentation/net-worth-view";
import {
  business,
  ownership,
  valuation as businessValuation,
} from "@/lib/engine/__tests__/fixtures/business";
import type { CurrencyRate } from "@/lib/engine/fx";
import type {
  DashboardState,
  FinancialAccount,
  Liability,
  MonthlyClose,
  Provenance,
  RealEstateAsset,
  RealEstateValuation,
} from "@/lib/types";

// Toutes les valeurs de ce fichier sont des fixtures synthétiques.
const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH", effectiveDate: "2026-09-09" };
const AS_OF = "2026-09-09";

function account(
  id: string,
  balance: number,
  type: FinancialAccount["type"] = "BANK",
  currency = "EUR",
): FinancialAccount {
  return {
    id,
    institutionId: "inst",
    institution: "Établissement test",
    name: `Compte ${id}`,
    type,
    currency,
    balance,
    balanceDate: AS_OF,
    liquidity: type === "BANK" || type === "SAVINGS" ? "IMMEDIATE" : "LIQUID",
    provenance,
  };
}

function liability(id: string, currentBalance: number, currency = "EUR"): Liability {
  return {
    id,
    name: `Prêt ${id}`,
    lender: "Prêteur test",
    currency,
    currentBalance,
    balanceDate: AS_OF,
    principal: currentBalance,
    annualRate: 0,
    monthlyPayment: 100,
    paymentCount: 60,
    amortisationProfile: "ANNUITY",
    provenance,
  } as unknown as Liability;
}

function property(overrides: Partial<RealEstateAsset> = {}): RealEstateAsset {
  return {
    id: "property",
    label: "Bien synthétique",
    location: "Zone test",
    surfaceSqm: 45,
    usage: "PRIMARY_RESIDENCE",
    ownershipShare: 1,
    isDebtFinanced: false,
    acquisitionDate: "2020-01-01",
    disposalDate: null,
    archived: false,
    notes: null,
    provenance,
    ...overrides,
  } as unknown as RealEstateAsset;
}

function propertyValuation(value: number): RealEstateValuation {
  return {
    id: "property-valuation",
    propertyId: "property",
    valuedAt: AS_OF,
    value,
    currency: "EUR",
    method: "AGENT_ESTIMATE",
    notes: null,
    provenance,
  } as unknown as RealEstateValuation;
}

function close(closeDate: string, netWorth: number, overrides: Partial<MonthlyClose> = {}) {
  return {
    id: `close-${closeDate}`,
    closeDate,
    version: 1,
    netWorth,
    grossAssets: netWorth,
    debt: 0,
    reportingCurrency: "EUR",
    completenessStatus: "COMPLETE",
    createdAt: `${closeDate}T00:00:00Z`,
    composition: {
      immediate_cash: netWorth,
      market_invested_assets: 0,
      investment_envelope_cash: 0,
      illiquid_assets: 0,
    },
    ...overrides,
  } as unknown as MonthlyClose;
}

function stateOf(input: {
  accounts?: FinancialAccount[];
  liabilities?: Liability[];
  realEstateAssets?: RealEstateAsset[];
  realEstateValuations?: RealEstateValuation[];
  businesses?: unknown[];
  businessOwnership?: unknown[];
  businessValuations?: unknown[];
  currencyRates?: CurrencyRate[];
  monthlyCloses?: MonthlyClose[];
}): DashboardState {
  return {
    asOfDate: AS_OF,
    reportingCurrency: "EUR",
    accounts: input.accounts ?? [],
    positions: [],
    liabilities: input.liabilities ?? [],
    transactions: [],
    expenseCategories: [],
    monthlyCloses: input.monthlyCloses ?? [],
    netWorthSnapshots: [],
    currencyRates: input.currencyRates ?? [],
    ledgerCoverageStart: null,
    realEstateAssets: input.realEstateAssets ?? [],
    realEstateValuations: input.realEstateValuations ?? [],
    realEstateCapitalEvents: [],
    realEstateOperatingTerms: [],
    realEstateFinancingLinks: [],
    businesses: input.businesses ?? [],
    businessOwnership: input.businessOwnership ?? [],
    businessFinancials: [],
    businessValuations: input.businessValuations ?? [],
    businessCapitalEvents: [],
    businessHoldings: [],
    businessEbitdaAdjustments: [],
    businessBridgeItems: [],
    businessBridgeDeclarations: [],
    businessDcfAssumptions: [],
  } as unknown as DashboardState;
}

describe("modèle de lecture Patrimoine — les cinq familles du §21", () => {
  const company = business({ id: "company", name: "Société synthétique" });
  const view = buildNetWorthView(
    stateOf({
      accounts: [account("bank", 4_200, "BANK"), account("pea", 20_000, "PEA")],
      liabilities: [liability("loan", 16_745)],
      realEstateAssets: [property()],
      realEstateValuations: [propertyValuation(260_000)],
      businesses: [company],
      businessOwnership: [
        ownership({
          id: "own",
          businessId: "company",
          effectiveDate: "2020-01-01",
          legalRate: 1,
        }),
      ],
      businessValuations: [
        businessValuation({
          id: "val",
          businessId: "company",
          valuationDate: AS_OF,
          method: "EXTERNAL_APPRAISAL",
          equityValue: 50_000,
        }),
      ],
    }),
  );

  it("rend l’immobilier et les sociétés détenues, que l’ancienne page omettait", () => {
    expect(view.assets.map((block) => block.id)).toEqual([
      "LIQUID",
      "FINANCIAL",
      "REAL_ESTATE",
      "BUSINESS",
    ]);
    expect(view.assets.find((block) => block.id === "REAL_ESTATE")?.aggregate.value).toBe(260_000);
    expect(view.assets.find((block) => block.id === "BUSINESS")?.aggregate.value).toBe(50_000);
  });

  it("boucle exactement sur les agrégats canoniques", () => {
    // Un écart de bouclage signifie qu'une contribution a été perdue par le partitionnement.
    expect(view.assetResidual).toBe(0);
    expect(view.liabilityResidual).toBe(0);
    expect(view.grossAssets.value).toBe(334_200);
    expect(view.totalLiabilities.value).toBe(16_745);
    expect(view.netWorth.value).toBe(317_455);
  });

  it("proportionne les deux colonnes sur la même base", () => {
    // La base est le plus grand des deux côtés : sans elle, 16 745 € de dette et 334 200 €
    // d'actifs se dessineraient à hauteur comparable.
    expect(view.scaleBasis).toBe(334_200);
    const debt = view.liabilities.find((block) => block.id === "CONTRACTUAL_DEBT");
    expect(debt?.weight).toBeCloseTo(16_745 / 334_200, 10);
    expect(debt?.share).toBe(1);
    expect(view.geometryIsPartial).toBe(false);
  });

  it("nomme le domaine propriétaire de chaque bloc", () => {
    expect(view.assets.find((block) => block.id === "REAL_ESTATE")?.ownerDomain).toBe("Immobilier");
    expect(view.liabilities.find((block) => block.id === "CONTRACTUAL_DEBT")?.ownerDomain).toBe(
      "Dette",
    );
  });

  it("dit ce que la quote-part couvre et ce qu’elle ne couvre pas", () => {
    // Décision de la phase 4A : les comptes financiers n'ont pas de quote-part dans le modèle
    // de données, donc ils entrent en totalité. La page le déclare au lieu de le taire.
    expect(view.ownership.attributedFamilies).toEqual(["REAL_ESTATE", "BUSINESS"]);
    expect(view.ownership.unattributedLineCount).toBe(2);
    expect(view.ownership.undeclaredShareLineCount).toBe(0);
  });
});

describe("modèle de lecture Patrimoine — états dégradés", () => {
  it("ne rend aucune famille vide et déclare le profil vide", () => {
    const view = buildNetWorthView(stateOf({}));
    expect(view.assets).toEqual([]);
    expect(view.liabilities).toEqual([]);
    expect(view.isEmpty).toBe(true);
    expect(view.scaleBasis).toBeNull();
  });

  it("laisse une famille sans montant connu SANS hauteur, jamais à zéro", () => {
    // Valorisation absente : le bien existe, son montant est inconnu. Une barre de hauteur
    // nulle affirmerait qu'il ne vaut rien.
    const view = buildNetWorthView(
      stateOf({
        accounts: [account("bank", 4_200, "BANK")],
        realEstateAssets: [property()],
        realEstateValuations: [],
      }),
    );
    const realEstate = view.assets.find((block) => block.id === "REAL_ESTATE");
    expect(realEstate?.aggregate.value).toBeNull();
    expect(realEstate?.aggregate.status).toBe("NOT_COMPUTABLE");
    expect(realEstate?.weight).toBeNull();
    expect(realEstate?.share).toBeNull();
    expect(realEstate?.unknownLineCount).toBe(1);
    expect(view.geometryIsPartial).toBe(true);
    // L'incertitude d'une famille n'efface pas la certitude d'une autre.
    expect(view.assets.find((block) => block.id === "LIQUID")?.aggregate.value).toBe(4_200);
  });

  it("porte le motif d’une quote-part non déclarée jusqu’au bloc", () => {
    const view = buildNetWorthView(
      stateOf({
        realEstateAssets: [property({ ownershipShare: null })],
        realEstateValuations: [propertyValuation(260_000)],
      }),
    );
    const realEstate = view.assets.find((block) => block.id === "REAL_ESTATE");
    expect(realEstate?.aggregate.value).toBeNull();
    expect(realEstate?.aggregate.blockers).toContain(
      "REAL_ESTATE_OWNERSHIP_SHARE_MISSING:property",
    );
    expect(view.ownership.undeclaredShareLineCount).toBe(1);
  });

  it("porte le motif d’un taux de change absent jusqu’au bloc", () => {
    const view = buildNetWorthView({
      ...stateOf({ accounts: [account("usd", 5_000, "BANK", "USD")] }),
    });
    const liquid = view.assets.find((block) => block.id === "LIQUID");
    expect(liquid?.aggregate.value).toBeNull();
    // Le code porte son identifiant technique : c'est lui que l'inspecteur traduira.
    expect(liquid?.aggregate.blockers).toContain("FX_MISSING:USD/EUR@2026-09-09");
    expect(liquid?.weight).toBeNull();
  });

  it("garde un zéro DÉCLARÉ distinct d’un montant inconnu", () => {
    // Un compte à zéro est une information : il a une hauteur de zéro, pas une hauteur inconnue.
    const view = buildNetWorthView(
      stateOf({ accounts: [account("bank", 0, "BANK"), account("pea", 20_000, "PEA")] }),
    );
    const liquid = view.assets.find((block) => block.id === "LIQUID");
    expect(liquid?.aggregate.value).toBe(0);
    expect(liquid?.aggregate.status).toBe("COMPLETE");
    expect(liquid?.weight).toBe(0);
    expect(view.geometryIsPartial).toBe(false);
  });

  it("porte un découvert au passif et non en actif négatif", () => {
    const view = buildNetWorthView(stateOf({ accounts: [account("bank", -300, "BANK")] }));
    expect(view.assets).toEqual([]);
    expect(view.liabilities.map((block) => block.id)).toEqual(["ACCOUNT_OVERDRAFT"]);
    expect(view.liabilities[0]!.aggregate.value).toBe(300);
    expect(view.grossAssets.value).toBe(0);
  });
});

describe("modèle de lecture Patrimoine — évolution depuis la clôture", () => {
  const accounts = [account("bank", 4_200, "BANK")];

  it("refuse toute évolution sans deux clôtures", () => {
    const view = buildNetWorthView(
      stateOf({ accounts, monthlyCloses: [close("2026-08-31", 300_000)] }),
    );
    expect(view.closeChange.view).toBeNull();
    expect(view.closeChange.reserve).not.toBeNull();
  });

  it("rend l’évolution quand deux clôtures sont comparables", () => {
    const view = buildNetWorthView(
      stateOf({
        accounts,
        monthlyCloses: [close("2026-07-31", 300_000), close("2026-08-31", 317_455)],
      }),
    );
    expect(view.closeChange.view?.amount).toBe(17_455);
    expect(view.closeChange.view?.fromDate).toBe("2026-07-31");
    expect(view.closeChange.reserve).toBeNull();
  });

  it("refuse l’évolution quand les devises de reporting diffèrent", () => {
    const view = buildNetWorthView(
      stateOf({
        accounts,
        monthlyCloses: [
          close("2026-07-31", 300_000, { reportingCurrency: "USD" }),
          close("2026-08-31", 317_455),
        ],
      }),
    );
    expect(view.closeChange.view).toBeNull();
    expect(view.closeChange.reserve).not.toBeNull();
  });

  it("refuse l’évolution quand une clôture est incomplète", () => {
    const view = buildNetWorthView(
      stateOf({
        accounts,
        monthlyCloses: [
          close("2026-07-31", 300_000, { completenessStatus: "PARTIAL" }),
          close("2026-08-31", 317_455),
        ],
      }),
    );
    expect(view.closeChange.view).toBeNull();
  });
});
