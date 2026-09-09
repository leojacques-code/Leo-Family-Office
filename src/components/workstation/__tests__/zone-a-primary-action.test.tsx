import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardState } from "@/lib/types";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";

/**
 * Zone A du shell : le libellé rendu vient du MANIFESTE.
 *
 * Le contenu de domaine est remplacé par un faux qui enregistre une action, comme une vraie
 * page le fait. Monter les quatorze compositions demanderait un `DashboardState` complet et
 * ferait dépendre ce test de pages que cette PR ne touche pas : un échec ne dirait plus si
 * l'en-tête est fautif.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const run = vi.fn();
let servesAction = true;

vi.mock("@/components/pages", async () => {
  const { useRegisterPrimaryAction } = await import("@/components/workstation/primary-action");
  return {
    SectionContent: ({ section }: { section: string }) => {
      useRegisterPrimaryAction(servesAction ? run : null);
      return <p>Canvas de {section}</p>;
    },
  };
});

const { AppShell } = await import("@/components/app-shell");

function renderShell(section: string) {
  return render(
    <AppShell
      source={{ kind: "SECTION", state: { asOfDate: "2026-09-08" } as DashboardState }}
      section={section}
    />,
  );
}

describe("zone A branchée sur le manifeste", () => {
  it("rend le libellé du manifeste, pas un libellé écrit dans le shell", () => {
    servesAction = true;
    renderShell("debt");
    // §24 : le manifeste de Dette déclare « Importer un échéancier ». Le shell n'invente rien.
    expect(PAGE_REGISTRY.debt.primaryAction).toBe("Importer un échéancier");
    expect(screen.getByRole("button", { name: "Importer un échéancier" })).toBeTruthy();
  });

  it("place l'action dans l'en-tête opérationnel, jamais dans le canvas", () => {
    servesAction = true;
    const { container } = renderShell("goals");
    const header = container.querySelector(".workstation-header");
    expect(header?.textContent).toContain("Créer un objectif");
    expect(container.querySelector(".financial-canvas")?.textContent).not.toContain(
      "Créer un objectif",
    );
  });

  it("déclenche l'action de la page au clic", async () => {
    servesAction = true;
    run.mockClear();
    const user = userEvent.setup();
    renderShell("goals");
    await user.click(screen.getByRole("button", { name: "Créer un objectif" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ne rend AUCUN bouton quand la page ne sert pas son action", () => {
    // LIBELLÉ DÉCLARÉ ≠ ACTION SERVIE. Un bouton inerte se présente comme un chemin
    // praticable et n'en est pas un : il coûte plus qu'un bouton absent.
    servesAction = false;
    const { container } = renderShell("debt");
    expect(screen.queryByRole("button", { name: "Importer un échéancier" })).toBeNull();
    expect(container.querySelector(".workstation-header .button.primary")).toBeNull();
  });

  it("ne rend aucun bouton sur une page dont le manifeste n'en déclare pas", () => {
    // §20 : « Today n'a pas de formulaire financier propre ».
    servesAction = true;
    const { container } = renderShell("today");
    expect(PAGE_REGISTRY.today.primaryAction).toBeNull();
    expect(container.querySelector(".workstation-header .button.primary")).toBeNull();
  });

  it("l'en-tête ne porte JAMAIS plus d'une action primaire", () => {
    // §17 : « une action primaire maximum ». C'est le type du manifeste qui l'impose, mais un
    // test le vérifie sur le rendu : c'est là que la règle se voit.
    servesAction = true;
    for (const id of Object.keys(PAGE_REGISTRY)) {
      const { container, unmount } = renderShell(id);
      const primaries = container.querySelectorAll(".workstation-header .button.primary");
      expect(primaries.length, `page ${id}`).toBeLessThanOrEqual(1);
      unmount();
    }
  });
});
