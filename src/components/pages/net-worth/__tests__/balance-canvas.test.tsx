import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BalanceCanvas } from "../balance-canvas";
import { buildNetWorthView } from "@/lib/presentation/net-worth-view";
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

const account = (
  id: string,
  balance: number,
  type: FinancialAccount["type"] = "BANK",
  currency = "EUR",
): FinancialAccount => ({
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
});

const liability = (id: string, currentBalance: number) =>
  ({
    id,
    name: `Prêt ${id}`,
    lender: "Prêteur test",
    currency: "EUR",
    currentBalance,
    balanceDate: AS_OF,
    principal: currentBalance,
    annualRate: 0,
    monthlyPayment: 100,
    paymentCount: 60,
    amortisationProfile: "ANNUITY",
    provenance,
  }) as unknown as Liability;

const property = (ownershipShare: number | null = 1) =>
  ({
    id: "property",
    label: "Bien synthétique",
    location: "Zone test",
    surfaceSqm: 45,
    usage: "PRIMARY_RESIDENCE",
    ownershipShare,
    isDebtFinanced: false,
    acquisitionDate: "2020-01-01",
    disposalDate: null,
    archived: false,
    notes: null,
    provenance,
  }) as unknown as RealEstateAsset;

const propertyValuation = (value: number) =>
  ({
    id: "property-valuation",
    propertyId: "property",
    valuedAt: AS_OF,
    value,
    currency: "EUR",
    method: "AGENT_ESTIMATE",
    notes: null,
    provenance,
  }) as unknown as RealEstateValuation;

const close = (closeDate: string, netWorth: number) =>
  ({
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
  }) as unknown as MonthlyClose;

function stateOf(input: {
  accounts?: FinancialAccount[];
  liabilities?: Liability[];
  realEstateAssets?: RealEstateAsset[];
  realEstateValuations?: RealEstateValuation[];
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
    currencyRates: [],
    ledgerCoverageStart: null,
    realEstateAssets: input.realEstateAssets ?? [],
    realEstateValuations: input.realEstateValuations ?? [],
    realEstateCapitalEvents: [],
    realEstateOperatingTerms: [],
    realEstateFinancingLinks: [],
    businesses: [],
    businessOwnership: [],
    businessFinancials: [],
    businessValuations: [],
    businessCapitalEvents: [],
    businessHoldings: [],
    businessEbitdaAdjustments: [],
    businessBridgeItems: [],
    businessBridgeDeclarations: [],
    businessDcfAssumptions: [],
  } as unknown as DashboardState;
}

function renderCanvas(state: DashboardState, onSelectBlock = vi.fn()) {
  const handlers = {
    onSelectAssets: vi.fn(),
    onSelectLiabilities: vi.fn(),
    onSelectNetWorth: vi.fn(),
    onSelectBlock,
  };
  const result = render(
    <BalanceCanvas selectedId={null} view={buildNetWorthView(state)} {...handlers} />,
  );
  return { ...result, handlers };
}

describe("canvas du bilan — la surface encode le montant", () => {
  it("proportionne les hauteurs sur une base commune aux deux colonnes", () => {
    const { container } = renderCanvas(
      stateOf({
        accounts: [account("bank", 100_000, "BANK")],
        liabilities: [liability("loan", 25_000)],
      }),
    );
    const [liquid] = [...container.querySelectorAll('.nw-block[data-side="ASSET"]')];
    const [debt] = [...container.querySelectorAll('.nw-block[data-side="LIABILITY"]')];
    const heightOf = (node: Element) =>
      Number((node as HTMLElement).style.height.replace("px", ""));
    // 25 000 € pèse le quart de 100 000 € : la dette doit être visiblement plus basse. Sans
    // base commune, les deux colonnes se dessineraient à hauteur égale.
    expect(heightOf(liquid!)).toBeGreaterThan(heightOf(debt!));
    expect(heightOf(liquid!) / heightOf(debt!)).toBeCloseTo(4, 1);
  });

  it("rend une zone détourée, et non une barre à zéro, pour un montant inconnu", () => {
    const { container } = renderCanvas(
      stateOf({
        accounts: [account("bank", 4_200, "BANK")],
        realEstateAssets: [property()],
        realEstateValuations: [],
      }),
    );
    const outlined = container.querySelector('.nw-block[data-unknown="true"]');
    expect(outlined).not.toBeNull();
    expect(outlined!.textContent).toContain("Immobilier");
    expect(outlined!.textContent).toContain("Non calculable");
    // Aucune hauteur inline : la géométrie n'est pas mesurée, elle est détourée par le CSS.
    expect((outlined as HTMLElement).style.height).toBe("");
    expect(screen.getByText(/Leur hauteur n’est pas mesurée/)).toBeVisible();
  });

  it("garde un zéro déclaré mesuré, distinct d’un montant inconnu", () => {
    const { container } = renderCanvas(
      stateOf({ accounts: [account("bank", 0, "BANK"), account("pea", 20_000, "PEA")] }),
    );
    const liquid = container.querySelector('.nw-block[data-side="ASSET"]');
    expect(liquid!.getAttribute("data-unknown")).toBeNull();
    expect(container.querySelector('.nw-block[data-unknown="true"]')).toBeNull();
  });

  it("n’affiche aucune part quand le total du côté n’est pas calculable", () => {
    const { container } = renderCanvas(
      stateOf({
        accounts: [account("bank", 4_200, "BANK")],
        realEstateAssets: [property()],
        realEstateValuations: [],
      }),
    );
    // Actifs bruts non calculables : un pourcentage y serait un chiffre sans dénominateur.
    expect(container.querySelector(".nw-block-share")).toBeNull();
  });

  it("refuse toute évolution sans deux clôtures comparables, et dit pourquoi", () => {
    renderCanvas(stateOf({ accounts: [account("bank", 4_200, "BANK")] }));
    expect(document.querySelector(".nw-result-delta")).toBeNull();
    expect(document.querySelector(".nw-result-reserve")!.textContent).toBeTruthy();
  });

  it("rend l’évolution signée quand deux clôtures sont comparables", () => {
    renderCanvas(
      stateOf({
        accounts: [account("bank", 4_200, "BANK")],
        monthlyCloses: [close("2026-07-31", 4_000), close("2026-08-31", 4_200)],
      }),
    );
    const delta = document.querySelector(".nw-result-delta");
    expect(delta!.getAttribute("data-direction")).toBe("up");
    expect(delta!.textContent).toContain("2026-07-31");
  });
});

describe("canvas du bilan — sélection vers l’inspecteur", () => {
  it("remonte la famille cliquée, avec ses lignes et son domaine propriétaire", async () => {
    const onSelectBlock = vi.fn();
    renderCanvas(
      stateOf({
        accounts: [account("bank", 4_200, "BANK")],
        realEstateAssets: [property()],
        realEstateValuations: [propertyValuation(260_000)],
      }),
      onSelectBlock,
    );
    await userEvent.click(screen.getByRole("button", { name: /Immobilier/ }));
    expect(onSelectBlock).toHaveBeenCalledOnce();
    const block = onSelectBlock.mock.calls[0]![0];
    expect(block.id).toBe("REAL_ESTATE");
    expect(block.ownerDomain).toBe("Immobilier");
    expect(block.lines).toHaveLength(1);
  });

  it("expose les trois totaux de l’équation comme sélections distinctes", async () => {
    const { handlers } = renderCanvas(
      stateOf({
        accounts: [account("bank", 4_200, "BANK")],
        liabilities: [liability("loan", 1_000)],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Total des actifs" }));
    await userEvent.click(screen.getByRole("button", { name: "Total des dettes" }));
    await userEvent.click(screen.getByRole("button", { name: /^Patrimoine net/ }));
    expect(handlers.onSelectAssets).toHaveBeenCalledOnce();
    expect(handlers.onSelectLiabilities).toHaveBeenCalledOnce();
    expect(handlers.onSelectNetWorth).toHaveBeenCalledOnce();
  });
});
