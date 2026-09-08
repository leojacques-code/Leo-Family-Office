import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";
import { WorkspaceShell } from "@/components/workstation/workspace-shell";
import { SourceRail } from "@/components/workstation/source-rail";
import { Inspector } from "@/components/workstation/inspector";

/**
 * Le cadre du poste de travail, vérifié sur les manifestes RÉELS du registre.
 *
 * Un manifeste inventé pour le test prouverait que le composant sait lire un objet, pas que le
 * cadre respecte les contrats déjà écrits en phase 0. « Aujourd'hui » ne déclare pas de rail
 * de sources et ne simule pas ; « Scénarios » simule. La différence est le sujet du test.
 */
const today = PAGE_REGISTRY.today;
const scenarios = PAGE_REGISTRY.scenarios;

function noop() {}

describe("WorkspaceShell", () => {
  it("installe les trois zones spatiales et marque leur présence sur la racine", () => {
    const { container } = render(
      <WorkspaceShell
        dateLabel="8 septembre 2026"
        fallbackTitle="Section"
        manifest={scenarios}
        mode="REAL"
        onModeChange={noop}
        sourceRail={
          <SourceRail
            sources={[{ id: "s1", category: "BANQUE", name: "Compte", status: "ACTIVE" }]}
          />
        }
        inspector={<Inspector facts={[]} onClose={noop} title="Actif" />}
      >
        <p>Canvas</p>
      </WorkspaceShell>,
    );

    const root = container.querySelector(".workstation");
    expect(root).toHaveAttribute("data-with-rail", "true");
    expect(root).toHaveAttribute("data-with-inspector", "true");
    expect(screen.getByRole("complementary", { name: "Sources du domaine" })).toBeVisible();
    expect(screen.getByRole("main")).toBeVisible();
    expect(screen.getByRole("complementary", { name: /Inspecteur/ })).toBeVisible();
  });

  it("n'annonce ni rail ni inspecteur quand il n'y a rien à y mettre", () => {
    // Une carte vide « aucune source » est exactement ce que le §6 de V10 refuse : le rail
    // disparaît, il ne se remplit pas d'un avertissement.
    const { container } = render(
      <WorkspaceShell
        dateLabel="8 septembre 2026"
        fallbackTitle="Section"
        manifest={today}
        mode="REAL"
        onModeChange={noop}
        sourceRail={<SourceRail sources={[]} />}
      >
        <p>Canvas</p>
      </WorkspaceShell>,
    );

    const root = container.querySelector(".workstation");
    expect(root).not.toHaveAttribute("data-with-rail");
    expect(root).not.toHaveAttribute("data-with-inspector");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("affiche la question du manifeste sans paragraphe explicatif", () => {
    render(
      <WorkspaceShell
        dateLabel="8 septembre 2026"
        fallbackTitle="Section"
        manifest={today}
        mode="REAL"
        onModeChange={noop}
      >
        <p>Canvas</p>
      </WorkspaceShell>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(today.question);
    // §3 de V10 : 14 à 16 mots au plus pour la question dominante.
    expect(heading.textContent!.trim().split(/\s+/).length).toBeLessThanOrEqual(16);
  });

  it("retombe sur le libellé de section quand la page n'a pas de manifeste", () => {
    // Les trois sections que la section 7 sort de la navigation principale n'ont pas de
    // manifeste : le cadre doit les rendre sans inventer de question.
    render(
      <WorkspaceShell
        dateLabel="8 septembre 2026"
        fallbackTitle="Paramètres"
        manifest={null}
        mode="REAL"
        onModeChange={noop}
      >
        <p>Canvas</p>
      </WorkspaceShell>,
    );
    expect(screen.getByText("Paramètres")).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("sélecteur Réel / Simulation", () => {
  it("n'apparaît pas sur une page qui ne déclare qu'un mode", () => {
    // Un contrôle à une seule option ment : il fait croire qu'une simulation existe.
    expect(today.realityModes).toEqual(["REAL"]);
    render(
      <WorkspaceShell
        dateLabel="8 septembre 2026"
        fallbackTitle="Section"
        manifest={today}
        mode="REAL"
        onModeChange={noop}
      >
        <p>Canvas</p>
      </WorkspaceShell>,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("transforme la racine et affiche le filigrane en simulation", async () => {
    const onModeChange = vi.fn();
    expect(scenarios.realityModes).toContain("SIMULATION");
    const { container, rerender } = render(
      <WorkspaceShell
        dateLabel="8 septembre 2026"
        fallbackTitle="Section"
        manifest={scenarios}
        mode="REAL"
        onModeChange={onModeChange}
      >
        <p>Canvas</p>
      </WorkspaceShell>,
    );

    expect(container.querySelector(".workstation")).toHaveAttribute("data-reality-mode", "REAL");
    expect(screen.queryByText("Simulation isolée")).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: /Simulation/ }));
    expect(onModeChange).toHaveBeenCalledWith("SIMULATION");

    rerender(
      <WorkspaceShell
        dateLabel="8 septembre 2026"
        fallbackTitle="Section"
        manifest={scenarios}
        mode="SIMULATION"
        onModeChange={onModeChange}
      >
        <p>Canvas</p>
      </WorkspaceShell>,
    );
    // Le mode descend sur la RACINE : c'est la surface entière qui change, pas un badge.
    expect(container.querySelector(".workstation")).toHaveAttribute(
      "data-reality-mode",
      "SIMULATION",
    );
    expect(screen.getByText("Simulation isolée")).toBeVisible();
  });
});
