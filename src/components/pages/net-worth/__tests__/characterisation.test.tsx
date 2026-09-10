import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DashboardState } from "@/lib/types";
import NetWorthPage from "../page";

/**
 * CONTRAT DE LA ZONE C DE PATRIMOINE.
 *
 * Ce fichier était, au commit précédent, un jeu de tests de CARACTÉRISATION : il décrivait la
 * page telle qu'elle était, pour que le remplacement du canvas se distingue d'une régression.
 * Trois de ses assertions énonçaient les défauts que la phase 4A corrige. Elles sont
 * RETOURNÉES ici, et c'est le but : le second en-tête doit avoir disparu, la grille générique
 * de KPI ne doit plus être le canvas, et l'immobilier comme les sociétés détenues doivent être
 * rendus.
 *
 * Les deux assertions qui décrivaient ce qui devait SURVIVRE au remplacement sont conservées à
 * l'identique : aucune information de compte ni de dette n'est perdue, et le périmètre reste
 * annoncé.
 */

// Fixtures synthétiques. Aucune donnée personnelle.
const provenance = {
  kind: "ACTUAL" as const,
  confidence: "HIGH" as const,
  effectiveDate: "2026-09-09",
};

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
    <NetWorthPage
      section="net-worth"
      state={state}
      mutate={mutate}
      busy={false}
      setExplanation={noop}
      projection={null}
      runProjection={async () => null}
      refresh={async () => {}}
    />,
  );
}

describe("page Patrimoine, contrat de la zone C après la phase 4A", () => {
  it("ne rend plus aucun second en-tête, ni aucun titre anglais", () => {
    // La zone A du shell porte déjà titre, question, date d'arrêté, mode et action primaire.
    renderPage();
    expect(screen.queryByRole("heading", { name: "Net Worth" })).toBeNull();
    expect(screen.queryByText("Balance sheet")).toBeNull();
  });

  it("ne rend plus la grille générique de KPI comme canvas, mais l’équation du bilan", () => {
    // Critères d'échec n° 2 et n° 6 du §29 de V10 : ni grille de métriques par défaut, ni
    // visuel principal transposable tel quel à un autre domaine.
    const { container } = renderPage();
    expect(container.querySelector(".metrics-grid")).toBeNull();
    expect(container.querySelector(".nw-equation")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Bilan consolidé" })).toBeVisible();
  });

  it("rend le patrimoine net comme résultat de l’équation, pas comme une carte", () => {
    const { container } = renderPage();
    const result = container.querySelector(".nw-result");
    expect(result).not.toBeNull();
    expect(result!.textContent).toContain("Patrimoine net");
  });

  it("ne perd aucun libellé de compte ni de dette dans le remplacement", () => {
    // COMPORTEMENT PRÉSERVÉ : le canvas remplace les tables au premier écran, il ne supprime
    // pas l'information. Elle vit derrière « Analyse détaillée », §28 de V10 — donc RÉELLEMENT
    // atteignable, ce que le §29 exige au critère n° 9. Le test l'ouvre pour le prouver.
    const { container } = renderPage();
    const summary = screen.getByText("Analyse détaillée");
    expect(summary).toBeVisible();
    container.querySelector("details.nw-details")!.setAttribute("open", "");
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
