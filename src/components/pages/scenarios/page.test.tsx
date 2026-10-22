import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScenariosPage from "./page";
import { buildDemoState } from "@/lib/data/read-models/today-demo";
import type { SectionProps } from "../shared";
import type { Scenario } from "@/lib/types";

vi.mock("recharts", async (original) => ({
  ...(await original<typeof import("recharts")>()),
  ResponsiveContainer: () => null,
}));

function props(): SectionProps {
  return {
    section: "scenarios",
    state: { ...buildDemoState("2026-10-22"), scenarios: [] },
    busy: false,
    projection: null,
    mutate: vi.fn().mockResolvedValue(true),
    runProjection: vi.fn(),
    setExplanation: vi.fn(),
    refresh: vi.fn(),
  };
}

describe("Scénarios — compte sans scénario", () => {
  it("affiche un état vide sans inventer de trajectoire ni lancer de mutation", () => {
    const input = props();
    render(<ScenariosPage {...input} />);
    expect(screen.getByRole("heading", { name: "Aucun scénario enregistré" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Dupliquer" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Lancer 3 000 simulations" })).toBeNull();
    expect(input.mutate).not.toHaveBeenCalled();
    expect(input.runProjection).not.toHaveBeenCalled();
  });

  it("permet d'ouvrir et d'annuler la création au clavier en conservant la saisie", async () => {
    const user = userEvent.setup();
    const input = props();
    render(<ScenariosPage {...input} />);
    const trigger = screen.getByRole("button", { name: "Nouveau scénario" });
    await user.click(trigger);
    await user.type(screen.getByRole("textbox", { name: /^Nom$/ }), "Essai synthétique");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByRole("textbox", { name: /^Nom$/ })).toHaveValue("Essai synthétique");
    expect(input.mutate).not.toHaveBeenCalled();
  });

  it("reprend la première version disponible après création et revient au vide si elle disparaît", async () => {
    const user = userEvent.setup();
    const input = props();
    const view = render(<ScenariosPage {...input} />);
    const scenario: Scenario = {
      id: "scenario-synthetique",
      name: "Central synthétique",
      description: "Hypothèses explicitement nulles pour la recette du sélecteur",
      version: 1,
      color: "#39747a",
      annualReturn: 0,
      annualVolatility: 0,
      annualInflation: 0,
      monthlySavings: 0,
      investmentAllocationRate: 0,
      salaryGrowth: 0,
      stressProbability: 0,
      shockYear: null,
      shockMagnitude: null,
      provenance: { kind: "USER_ASSUMPTION", confidence: "HIGH" },
    };
    view.rerender(<ScenariosPage {...input} state={{ ...input.state, scenarios: [scenario] }} />);
    expect(screen.queryByRole("heading", { name: "Aucun scénario enregistré" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Dupliquer" }));
    expect(input.mutate).toHaveBeenCalledWith({
      action: "duplicate_scenario",
      scenarioId: scenario.id,
    });
    await user.click(screen.getByRole("button", { name: "Lancer 3 000 simulations" }));
    expect(input.runProjection).toHaveBeenCalledWith(scenario.id, 30, 3000, 19082026);
    view.rerender(<ScenariosPage {...input} />);
    expect(screen.getByRole("heading", { name: "Aucun scénario enregistré" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Dupliquer" })).toBeDisabled();
  });
});
