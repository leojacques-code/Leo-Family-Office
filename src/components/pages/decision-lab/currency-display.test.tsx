import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DecisionLabPage from "./page";
import { decisionCurrencyFixture } from "@/lib/data/__tests__/decision-currency.fixture";
import {
  buildGlobalFinancialContext,
  evaluateGlobalDecisionCase,
} from "@/lib/engine/global-financial-model";
import type { SectionProps } from "../shared";
import type { DashboardState } from "@/lib/types";

vi.mock("@/lib/engine/global-financial-model", () => ({
  buildGlobalFinancialContext: vi.fn(),
  evaluateGlobalDecisionCase: vi.fn(),
}));
vi.mock("@/lib/engine/decision-lab", async (original) => ({
  ...(await original<typeof import("@/lib/engine/decision-lab")>()),
  createDecisionCaseVersion: vi.fn(),
}));
let result = decisionCurrencyFixture();
function props(reportingCurrency = "EUR"): SectionProps {
  return {
    state: {
      asOfDate: "2026-09-23",
      reportingCurrency,
      scenarios: result.caseVersion.options.map((x) => ({
        id: x.scenarioDefinition.scenarioId,
        name: x.name,
        definition: x.scenarioDefinition,
      })),
      goals: [],
    } as unknown as DashboardState,
    section: "decision-lab",
    busy: false,
    mutate: vi.fn().mockResolvedValue(true),
    setExplanation: vi.fn(),
    projection: null,
    runProjection: vi.fn(),
    refresh: vi.fn(),
  };
}
function metrics() {
  return screen.getByRole("heading", { name: "Métriques à l’horizon" }).closest("section")!;
}
function goals() {
  return screen.getByRole("heading", { name: "Conflits HARD / SOFT visibles" }).closest("section")!;
}
function launch() {
  fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  result = decisionCurrencyFixture();
  vi.mocked(buildGlobalFinancialContext).mockReturnValue({
    opening: {},
    timeline: { events: [] },
  } as unknown as ReturnType<typeof buildGlobalFinancialContext>);
  vi.mocked(evaluateGlobalDecisionCase).mockImplementation(
    () => ({ evaluation: result }) as ReturnType<typeof evaluateGlobalDecisionCase>,
  );
});
describe("Decision Lab : unités du résultat, sans calcul financier", () => {
  it("affiche baseline, terminal et delta dans la devise du snapshot", () => {
    render(<DecisionLabPage {...props()} />);
    launch();
    const row = within(metrics()).getByText("Patrimoine net").closest("tr")!;
    expect(row).toHaveTextContent(/1.200.*\$US.*1.500.*\$US.*300.*\$US/);
    expect(metrics()).not.toHaveTextContent("€");
    expect(metrics()).toHaveTextContent("devise USD");
    expect(within(metrics()).getByText("Cash").closest("tr")).toHaveTextContent(/0.*\$US/);
    expect(within(metrics()).getByText("Dette").closest("tr")).toHaveTextContent("Non calculable");
  });
  it("garde l’unité propre des observations des objectifs", () => {
    render(<DecisionLabPage {...props()} />);
    launch();
    expect(goals()).toHaveTextContent(/800.*CHF.*gap 400.*CHF/);
    expect(goals()).not.toHaveTextContent("$US");
  });
  it.each([null, undefined])(
    "ne déduit pas de devise pour un résultat historique (%s)",
    (currency) => {
      result.reportingCurrency = currency;
      result.options.forEach((x) => {
        x.goalImpacts[0].option.observation = null;
      });
      render(<DecisionLabPage {...props("CHF")} />);
      launch();
      expect(metrics()).toHaveTextContent("devise non renseignée");
      expect(metrics()).toHaveTextContent("0 (devise non renseignée)");
      expect(goals()).toHaveTextContent("800 (devise non renseignée)");
      expect(metrics()).not.toHaveTextContent(/CHF|€|\$US/);
    },
  );
  it("conserve la devise évaluée si le contexte change avant sauvegarde et dans le résultat sérialisé", async () => {
    const initial = props();
    const view = render(<DecisionLabPage {...initial} />);
    launch();
    view.rerender(
      <DecisionLabPage {...initial} state={{ ...initial.state, reportingCurrency: "CHF" }} />,
    );
    expect(metrics()).toHaveTextContent("devise USD");
    fireEvent.click(screen.getByRole("button", { name: "Lancer et enregistrer" }));
    await waitFor(() => expect(initial.mutate).toHaveBeenCalledTimes(2));
    const command = vi.mocked(initial.mutate).mock.calls[1][0];
    expect(command).toMatchObject({
      action: "save_decision_run_v2",
      result: { reportingCurrency: "USD" },
    });
    expect(evaluateGlobalDecisionCase).toHaveBeenCalledTimes(1);
    if (command.action !== "save_decision_run_v2") throw new Error("Commande inattendue");
    result = JSON.parse(JSON.stringify(command.result));
    view.unmount();
    render(<DecisionLabPage {...props("CHF")} />);
    launch();
    expect(metrics()).toHaveTextContent("devise USD");
  });
});
