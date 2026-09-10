import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetWorthInsights } from "../insights";
import { buildNetWorthView } from "@/lib/presentation/net-worth-view";
import type {
  DashboardState,
  FinancialAccount,
  MonthlyClose,
  Position,
  Provenance,
  RealEstateAsset,
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

const position = (
  id: string,
  accountId: string,
  value: number,
  overrides: Partial<Position> = {},
) =>
  ({
    id,
    accountId,
    securityName: `Titre ${id}`,
    assetClass: "Actions",
    value,
    currency: "EUR",
    isCash: false,
    provenance,
    ...overrides,
  }) as unknown as Position;

const property = () =>
  ({
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
  }) as unknown as RealEstateAsset;

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
  positions?: Position[];
  realEstateAssets?: RealEstateAsset[];
  monthlyCloses?: MonthlyClose[];
}): DashboardState {
  return {
    asOfDate: AS_OF,
    reportingCurrency: "EUR",
    accounts: input.accounts ?? [],
    positions: input.positions ?? [],
    liabilities: [],
    transactions: [],
    expenseCategories: [],
    monthlyCloses: input.monthlyCloses ?? [],
    netWorthSnapshots: [],
    currencyRates: [],
    ledgerCoverageStart: null,
    realEstateAssets: input.realEstateAssets ?? [],
    realEstateValuations: [],
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

function renderInsights(state: DashboardState) {
  const onCreateClose = vi.fn();
  const onInspectAllocation = vi.fn();
  render(
    <NetWorthInsights
      busy={false}
      onCreateClose={onCreateClose}
      onInspectAllocation={onInspectAllocation}
      view={buildNetWorthView(state)}
    />,
  );
  return { onCreateClose, onInspectAllocation };
}

describe("répartition des placements", () => {
  it("ventile les seuls actifs financiers, et le dit", async () => {
    const { onInspectAllocation } = renderInsights(
      stateOf({
        accounts: [account("bank", 4_200, "BANK"), account("pea", 20_000, "PEA")],
        positions: [position("etf", "pea", 20_000)],
        realEstateAssets: [property()],
      }),
    );
    expect(screen.getByRole("region", { name: "Composition des actifs financiers" })).toBeVisible();
    expect(
      screen.getByText(/L’immobilier et les sociétés détenues n’y sont pas ventilés/),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Voir le bouclage" }));
    expect(onInspectAllocation).toHaveBeenCalledOnce();
  });

  it("signale une enveloppe dont l’exposition n’est pas fiable au lieu de l’inventer", () => {
    renderInsights(
      stateOf({
        // Enveloppe over-explained : 2 000 € de valeur comptable, 2 500 € de positions.
        accounts: [account("cto", 2_000, "CTO")],
        positions: [position("eq", "cto", 2_500)],
      }),
    );
    expect(screen.getByText(/exposition non fiable/)).toBeVisible();
  });

  it("ne rend aucun panneau de composition sans actif financier", () => {
    renderInsights(stateOf({ realEstateAssets: [property()] }));
    expect(screen.queryByRole("region", { name: "Composition des actifs financiers" })).toBeNull();
  });
});

describe("évolution depuis la clôture et clôture guidée", () => {
  it("propose la clôture quand le bilan est entièrement calculable", async () => {
    const { onCreateClose } = renderInsights(stateOf({ accounts: [account("bank", 4_200)] }));
    await userEvent.click(
      screen.getByRole("button", { name: `Arrêter le patrimoine au ${AS_OF}` }),
    );
    expect(onCreateClose).toHaveBeenCalledOnce();
  });

  it("refuse la clôture et nomme ce qui manque quand le bilan est incomplet", () => {
    // Bien sans valorisation : les actifs bruts sont non calculables, donc la clôture
    // échouerait côté serveur. Le bouton n'est pas rendu, et la raison l'est.
    renderInsights(stateOf({ accounts: [account("bank", 4_200)], realEstateAssets: [property()] }));
    expect(screen.queryByRole("button", { name: /Arrêter le patrimoine/ })).toBeNull();
    expect(screen.getByText(/Clôture impossible tant que le bilan/)).toBeVisible();
    expect(screen.getByText(/Valorisation du bien à renseigner/)).toBeVisible();
  });

  it("dit qu’une seule clôture ne fait pas une évolution", () => {
    renderInsights(
      stateOf({ accounts: [account("bank", 4_200)], monthlyCloses: [close("2026-08-31", 4_000)] }),
    );
    expect(screen.getByText(/Une évolution en demande deux/)).toBeVisible();
  });

  it("rend les causes de l’évolution quand deux clôtures sont comparables", () => {
    renderInsights(
      stateOf({
        accounts: [account("bank", 4_200)],
        monthlyCloses: [close("2026-07-31", 4_000), close("2026-08-31", 4_200)],
      }),
    );
    expect(screen.getByText(/Du 2026-07-31 au 2026-08-31/)).toBeVisible();
    expect(screen.getByText("Trésorerie immédiate")).toBeVisible();
  });
});

describe("périmètre de détention", () => {
  it("déclare que les comptes financiers entrent en totalité", () => {
    renderInsights(stateOf({ accounts: [account("bank", 4_200), account("pea", 20_000, "PEA")] }));
    expect(screen.getByText(/2 compte\(s\) financier\(s\) entrent en totalité/)).toBeVisible();
    expect(
      screen.getByText(/Une détention partagée n’est donc pas encore représentable/),
    ).toBeVisible();
  });

  it("dit sur quelles familles la quote-part est appliquée", () => {
    renderInsights(stateOf({ accounts: [account("bank", 4_200)], realEstateAssets: [property()] }));
    expect(screen.getByText(/Quote-part appliquée sur Immobilier/)).toBeVisible();
  });

  it("rappelle que la liquidité n’est pas le patrimoine net", () => {
    renderInsights(stateOf({ accounts: [account("bank", 4_200)] }));
    expect(screen.getByText(/La liquidité n’est pas le patrimoine net/)).toBeVisible();
  });
});
