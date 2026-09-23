import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GoalsPage } from "./page";
import {
  createGoalVersion,
  evaluateGoalCurrent,
  evaluateGoalAgainstTrajectory,
} from "@/lib/engine/goal-engine";
import type { DashboardState, Goal } from "@/lib/types";
import type { SectionProps } from "../shared";

// Le constructeur de définition est réel ; les évaluations financières sont toutes simulées.
vi.mock("@/lib/engine/goal-engine", async (original) => ({
  ...(await original<typeof import("@/lib/engine/goal-engine")>()),
  evaluateGoalCurrent: vi.fn(),
  evaluateGoalAgainstTrajectory: vi.fn(),
}));
vi.mock("@/lib/engine/global-financial-model", () => ({
  evaluateGlobalScenario: () => ({
    baseline: { openingFingerprint: "fixture" },
    comparison: { completeness: "COMPLETE", blockers: [], scenario: {} },
  }),
}));
function goal(currency: string | null): Goal {
  const definition = createGoalVersion({
    goalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    purpose: "CAPITAL",
    name: "Projet devise",
    priority: 2,
    target: { metric: "NET_WORTH", operator: "AT_LEAST", value: 1200, currency, entityId: null },
    targetDate: "2030-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
  });
  return {
    id: definition.goalId,
    name: definition.name,
    description: null,
    targetAmount: 1200,
    targetDate: definition.targetDate,
    priority: 2,
    status: "ACTIVE",
    version: 1,
    constraintStrength: "SOFT",
    archivedAt: null,
    definition,
  };
}
function props(goals: Goal[] = [goal("USD")], reportingCurrency = "EUR"): SectionProps {
  return {
    state: {
      goals,
      reportingCurrency,
      asOfDate: "2026-09-23",
      scenarios: [{ id: "scenario", name: "Central", definition: {} }],
      liabilities: [],
      realEstateAssets: [],
      businesses: [],
    } as unknown as DashboardState,
    section: "goals",
    busy: false,
    mutate: vi.fn().mockResolvedValue(true),
    setExplanation: vi.fn(),
    projection: null,
    runProjection: vi.fn(),
    refresh: vi.fn(),
  };
}
function observation(currency: string | null, value: number | null) {
  return { currency, value, provenance: { source: "Résultat simulé" } };
}
beforeEach(() => {
  vi.mocked(evaluateGoalCurrent).mockReturnValue({
    status: "NOT_COMPUTABLE",
    observation: observation("CHF", 800),
    gap: null,
    blockers: [{ message: "Devises incompatibles" }],
  } as unknown as ReturnType<typeof evaluateGoalCurrent>);
  vi.mocked(evaluateGoalAgainstTrajectory).mockReturnValue({
    status: "NOT_COMPUTABLE",
    observation: null,
    projectedValueAtTargetDate: null,
    blockers: [],
  } as unknown as ReturnType<typeof evaluateGoalAgainstTrajectory>);
});
function stat(label: string) {
  return screen.getByText(label).parentElement!;
}

describe("Objectifs : unités et versionnement sans conversion implicite", () => {
  it("rend la cible et l’observation dans leurs propres devises", () => {
    const { container } = render(<GoalsPage {...props()} />);
    expect(container.querySelector(".goal-big")).toHaveTextContent(/1.200.*\$US/);
    expect(stat("Valeur courante")).toHaveTextContent(/800.*CHF/);
    expect(stat("Écart courant")).toHaveTextContent("Non calculable");
    expect(stat("Valeur à l’échéance")).toHaveTextContent("Non calculable");
    expect(container.textContent).not.toContain("€");
    expect(screen.getByText("Devises incompatibles")).toBeVisible();
  });
  it("utilise les devises des résultats courant et projeté sans les réétiqueter EUR", () => {
    vi.mocked(evaluateGoalCurrent).mockReturnValue({
      status: "ON_TRACK",
      observation: observation("USD", 800),
      gap: { shortfall: 400 },
      blockers: [],
    } as unknown as ReturnType<typeof evaluateGoalCurrent>);
    vi.mocked(evaluateGoalAgainstTrajectory).mockReturnValue({
      status: "ON_TRACK",
      observation: observation("USD", 1300),
      projectedValueAtTargetDate: 1300,
      blockers: [],
    } as unknown as ReturnType<typeof evaluateGoalAgainstTrajectory>);
    render(<GoalsPage {...props()} />);
    expect(stat("Écart courant")).toHaveTextContent(/400.*\$US/);
    expect(stat("Valeur à l’échéance")).toHaveTextContent(/1.300.*\$US/);
  });
  it("distingue devise inconnue, montant inconnu et zéro observé", () => {
    vi.mocked(evaluateGoalCurrent).mockReturnValue({
      status: "NOT_COMPUTABLE",
      observation: observation(null, 0),
      gap: null,
      blockers: [],
    } as unknown as ReturnType<typeof evaluateGoalCurrent>);
    render(<GoalsPage {...props([goal(null)])} />);
    expect(stat("Valeur courante")).toHaveTextContent("0 (devise non renseignée)");
    expect(stat("Écart courant")).toHaveTextContent("Non calculable");
    expect(screen.getByText(/1.200.*devise non renseignée/)).toBeVisible();
  });
  it.each(["USD"])(
    "conserve %s en versionnant seulement le nom, puis à la réouverture",
    async (currency) => {
      const p = props([goal(currency)]);
      const { rerender } = render(<GoalsPage {...p} />);
      fireEvent.click(screen.getByRole("button", { name: "Versionner" }));
      expect(screen.getByLabelText(`Cible (${currency ?? "devise non déclarée"})`)).toHaveValue(
        1200,
      );
      fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Projet renommé" } });
      fireEvent.click(screen.getByRole("button", { name: "Créer la version" }));
      await waitFor(() => expect(p.mutate).toHaveBeenCalledOnce());
      const mutation = vi.mocked(p.mutate).mock.calls[0]![0];
      expect(mutation).toMatchObject({
        action: "save_goal_version_v2",
        expectedVersion: 1,
        definition: { name: "Projet renommé", target: { value: 1200, currency } },
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      if (mutation.action !== "save_goal_version_v2") throw Error("Mauvaise commande");
      rerender(
        <GoalsPage
          {...p}
          state={{
            ...p.state,
            goals: [
              { ...goal(currency), definition: { ...mutation.definition, version: 2 }, version: 2 },
            ],
          }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Versionner" }));
      expect(screen.getByLabelText("Nom")).toHaveValue("Projet renommé");
      expect(screen.getByLabelText(`Cible (${currency ?? "devise non déclarée"})`)).toHaveValue(
        1200,
      );
    },
  );
  it("refuse clairement la version sans devise sans envoyer de commande", () => {
    const p = props([goal(null)]);
    render(<GoalsPage {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Versionner" }));
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Brouillon conservé" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer la version" }));
    expect(p.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La devise de cette cible n’est pas déclarée",
    );
    expect(screen.getByLabelText("Nom")).toHaveValue("Brouillon conservé");
    expect(screen.getByLabelText("Cible (devise non déclarée)")).toHaveValue(1200);
  });
  it("garde la devise avec le brouillon après un échec d’enregistrement", async () => {
    const p = props();
    vi.mocked(p.mutate).mockResolvedValue(false);
    render(<GoalsPage {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Versionner" }));
    fireEvent.change(screen.getByLabelText("Cible (USD)"), { target: { value: "1300" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer la version" }));
    await waitFor(() => expect(p.mutate).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("Cible (USD)")).toHaveValue(1300);
  });
  it("initialise la création dans la devise annoncée, figée pour le brouillon", async () => {
    const p = props([], "CHF");
    const { rerender } = render(<GoalsPage {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Nouvel objectif" }));
    fireEvent.change(screen.getByLabelText("Type d’objectif"), { target: { value: "CAPITAL" } });
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Projet CHF" } });
    fireEvent.change(screen.getByLabelText("Cible (CHF)"), { target: { value: "100" } });
    rerender(<GoalsPage {...p} state={{ ...p.state, reportingCurrency: "EUR" }} />);
    fireEvent.click(screen.getByRole("button", { name: /^Créer$/ }));
    await waitFor(() => expect(p.mutate).toHaveBeenCalledOnce());
    expect(p.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_goal_v2",
        definition: expect.objectContaining({
          target: expect.objectContaining({ value: 100, currency: "CHF" }),
        }),
      }),
    );
  });
});
