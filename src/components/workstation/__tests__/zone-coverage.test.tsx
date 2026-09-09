import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardState } from "@/lib/types";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";
import type { PageZone } from "@/lib/presentation/registry/contracts";

/**
 * Sixième refus de la section 39 : « une section générée dynamiquement hors manifeste ».
 *
 * La phase 0 l'avait déclaré non vérifiable, aucune page n'étant branchée sur son manifeste,
 * et avait nommé la phase 1 comme responsable. Il l'est maintenant, sur les quatre zones que
 * le cadre implémente : chaque page est montée, et les conteneurs RENDUS sont comparés aux
 * zones DÉCLARÉES. Une zone absente du manifeste et présente à l'écran est une composition
 * que personne n'a décidée ; une zone déclarée et absente est un contrat qui ment.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/pages", () => ({
  SectionContent: ({
    section,
    setExplanation,
  }: {
    section: string;
    setExplanation: (explanation: unknown) => void;
  }) => (
    <div>
      <p>Canvas de {section}</p>
      {/* Une page réelle appelle `setExplanation` en cliquant « expliquer ce calcul ». Le faux
          expose le même geste, pour que la zone E puisse être exercée. */}
      <button
        onClick={() =>
          setExplanation({
            title: "Encours observé",
            formula: "solde au dernier relevé",
            inputs: [],
          })
        }
        type="button"
      >
        Expliquer
      </button>
    </div>
  ),
}));

const { AppShell } = await import("@/components/app-shell");

/**
 * Zones que le CADRE sait rendre, et le sélecteur qui prouve leur présence.
 *
 * `AVAILABLE_ANALYSIS` et `CONTEXTUAL_ACTIONS` n'y sont pas : douze manifestes les déclarent
 * et le cadre ne les rend pas encore — le catalogue « Aller plus loin » du §17 et la boîte de
 * réception que le §37 place en phase 2. Les inclure ferait échouer ce test sur une dette
 * connue au lieu d'attraper une régression, et le message de `unverifiableRules()` les nomme.
 */
const IMPLEMENTED_ZONES: Partial<Record<PageZone, string>> = {
  OPERATIONAL_HEADER: ".workstation-header",
  SOURCE_RAIL: ".source-rail",
  FINANCIAL_CANVAS: ".financial-canvas",
};

/**
 * L'inspecteur est traité à part : le §17 le déclare à toutes les pages, mais le cadre ne le
 * remplit que lorsqu'un chiffre est SÉLECTIONNÉ. Une colonne d'inspecteur vide et permanente
 * volerait 2,75 colonnes sur 16 au canvas pour n'y rien mettre.
 */
const INSPECTOR_ZONE: PageZone = "INSPECTOR";

function renderShell(section: string) {
  return render(
    <AppShell
      source={{ kind: "SECTION", state: { asOfDate: "2026-09-08" } as DashboardState }}
      section={section}
    />,
  );
}

describe("règle 6 : le rendu ne dépasse pas le manifeste", () => {
  it("chaque page rend les zones qu'elle déclare, et aucune autre", () => {
    for (const [id, manifest] of Object.entries(PAGE_REGISTRY)) {
      const { container, unmount } = renderShell(id);
      for (const [zone, selector] of Object.entries(IMPLEMENTED_ZONES)) {
        const present = container.querySelector(selector) !== null;
        const declared = manifest.zones.includes(zone as PageZone);
        expect(present, `page ${id}, zone ${zone}`).toBe(declared);
      }
      unmount();
    }
  });

  it("toutes les pages déclarent l'en-tête et le canvas, que le §17 dit toujours présents", () => {
    for (const [id, manifest] of Object.entries(PAGE_REGISTRY)) {
      expect(manifest.zones, `page ${id}`).toContain("OPERATIONAL_HEADER");
      expect(manifest.zones, `page ${id}`).toContain("FINANCIAL_CANVAS");
    }
  });

  it("toutes les pages déclarent l'inspecteur, qui n'apparaît qu'à la sélection", () => {
    for (const [id, manifest] of Object.entries(PAGE_REGISTRY)) {
      expect(manifest.zones, `page ${id}`).toContain(INSPECTOR_ZONE);
    }
    // Rien n'est sélectionné au montage : la colonne ne doit pas occuper le poste de travail.
    const { container } = renderShell("debt");
    expect(container.querySelector(".workstation")?.getAttribute("data-with-inspector")).toBeNull();
  });

  it("la zone E apparaît à la sélection, et la grille lui réserve alors sa colonne", async () => {
    // L'autre moitié du défaut : la colonne ne doit pas être réservée à vide, mais elle DOIT
    // l'être dès qu'un chiffre est expliqué. Un test qui ne vérifie que l'absence laisserait
    // passer une correction qui casse l'inspecteur.
    const user = userEvent.setup();
    const { container } = renderShell("debt");
    await user.click(screen.getByRole("button", { name: "Expliquer" }));
    expect(container.querySelector(".inspector")).toBeTruthy();
    expect(container.querySelector(".workstation")?.getAttribute("data-with-inspector")).toBe(
      "true",
    );
    expect(container.querySelector(".inspector")?.textContent).toContain("Encours observé");
  });

  it("une section secondaire, sans manifeste, ne rend ni rail ni question", () => {
    // §7 : Beyonder, Rapports et Paramètres sortent de la navigation principale. Aucune n'a de
    // manifeste de page, et leur en faire un reconstituerait les dix-huit destinations
    // équivalentes du constat 5.5.
    for (const section of ["settings", "advisor"]) {
      const { container, unmount } = renderShell(section);
      expect(container.querySelector(".source-rail"), section).toBeNull();
      expect(container.querySelector(".workstation-question"), section).toBeNull();
      // L'en-tête et le canvas restent : une page sans manifeste doit rester atteignable.
      expect(container.querySelector(".workstation-header"), section).toBeTruthy();
      expect(container.querySelector(".financial-canvas"), section).toBeTruthy();
      unmount();
    }
  });
});
