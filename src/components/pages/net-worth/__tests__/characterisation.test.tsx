import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DashboardState } from "@/lib/types";
import NetWorthPage from "../page";

/**
 * TESTS DE CARACTÉRISATION, §36 étape 3 : « ajouter les tests de caractérisation avant de
 * modifier le comportement ».
 *
 * Ils ne décrivent pas la cible de la phase 4A. Ils décrivent ce que la page fait AUJOURD'HUI,
 * pour qu'une régression involontaire se distingue d'un changement voulu. Trois d'entre eux
 * sont l'énoncé même des défauts que la phase corrige : ils changeront, et le commit qui les
 * change dira pourquoi.
 */

// Fixtures synthétiques. Aucune donnée personnelle.
const provenance = { kind: "ACTUAL" as const, confidence: "HIGH" as const, effectiveDate: "2026-09-09" };

function stateWith(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    asOfDate: "2026-09-09",
    reportingCurrency: "EUR",
    accounts: [
      {
        id: "bank-1",
        institutionId: "inst-1",
        institution: "Banque test",
        name: "Compte courant",
        type: "BANK",
        currency: "EUR",
        balance: 4_200,
        balanceDate: "2026-09-09",
        liquidity: "IMMEDIATE",
        provenance,
      },
      {
        id: "pea-1",
        institutionId: "inst-1",
        institution: "Banque test",
        name: "PEA",
        type: "PEA",
        currency: "EUR",
        balance: 20_000,
        balanceDate: "2026-09-09",
        liquidity: "LIQUID",
        provenance,
      },
    ],
    positions: [],
    liabilities: [
      {
        id: "loan-1",
        name: "Prêt test",
        lender: "Prêteur test",
        currency: "EUR",
        currentBalance: 16_745,
        balanceDate: "2026-09-09",
        principal: 16_745,
        annualRate: 0,
        monthlyPayment: 284.72,
        paymentCount: 60,
        amortisationProfile: "ANNUITY",
        provenance,
      },
    ],
    transactions: [],
    expenseCategories: [],
    monthlyCloses: [],
    netWorthSnapshots: [],
    currencyRates: [],
    metrics: {
      grossAssets: 24_200,
      debt: 16_745,
      netWorth: 7_455,
      bankCash: 4_200,
      liquidAssets: 24_200,
      liquidNetWorth: 7_455,
      investedAssets: 0,
      productiveNetWorth: null,
      emergencyCoverageMonths: null,
    },
    ...overrides,
  } as unknown as DashboardState;
}

const noop = () => {};
const mutate = vi.fn(async () => true);

function renderPage(state: DashboardState = stateWith()) {
  return render(
    <NetWorthPage state={state} mutate={mutate} busy={false} setExplanation={noop} />,
  );
}

describe("page Patrimoine, comportement observé avant la phase 4A", () => {
  it("rend un second en-tête qui double la zone A du poste de travail", () => {
    // DÉFAUT 1 du PRD : la zone A du shell porte déjà titre, question, date et action.
    // La phase 4A retire ce `SectionHeader`.
    renderPage();
    expect(screen.getByRole("heading", { name: "Net Worth" })).toBeVisible();
  });

  it("rend une grille générique de quatre cartes de KPI comme canvas", () => {
    // DÉFAUT 2 du PRD : critère d'échec n° 2 et n° 6 du §29 de V10.
    const { container } = renderPage();
    expect(container.querySelector(".metrics-grid.four")).not.toBeNull();
  });

  it("n'affiche ni l'immobilier ni les sociétés détenues, alors que le bilan les porte", () => {
    // DÉFAUT 4 du PRD : le bilan canonique porte les contributions REAL_ESTATE et
    // BUSINESS_EQUITY ; la page qui répond à « que possédé-je réellement » les omet.
    const { container } = renderPage();
    const panels = [...container.querySelectorAll(".panel-header h2, .panel h2")].map(
      (node) => node.textContent,
    );
    expect(panels).not.toContain("Immobilier");
    expect(panels).not.toContain("Sociétés détenues");
  });

  it("affiche les dettes identifiées et le compte de chaque famille financière", () => {
    // COMPORTEMENT À PRÉSERVER : les deux tables et la liste de dettes existent et portent
    // leurs libellés. La phase 4A les remplace par un canvas, elle ne perd pas l'information.
    renderPage();
    expect(screen.getByRole("heading", { name: "Dettes identifiées" })).toBeVisible();
    expect(screen.getByText("Prêt test")).toBeVisible();
    expect(screen.getByText("Compte courant")).toBeVisible();
    expect(screen.getByText("PEA")).toBeVisible();
  });

  it("borne le périmètre annoncé aux actifs et dettes déclarés", () => {
    // COMPORTEMENT À PRÉSERVER : l'honnêteté du périmètre est déjà là, sous forme de callout.
    renderPage();
    expect(screen.getByText(/uniquement les actifs et dettes déclarés/)).toBeVisible();
  });
});
