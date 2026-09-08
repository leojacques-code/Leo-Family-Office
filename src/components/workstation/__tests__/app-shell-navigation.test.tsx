import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardState } from "@/lib/types";
import { NAV_GROUPS, SECONDARY_SECTIONS } from "@/lib/navigation";

/**
 * Navigation du shell, telle qu'un utilisateur la voit.
 *
 * Le contenu de domaine est REMPLACÉ par un marqueur : la phase 1 installe le shell, et le
 * canvas de chaque domaine appartient à sa propre phase. Monter les vraies pages ferait
 * dépendre ce test de quatorze compositions que cette PR ne touche pas, et un échec ne dirait
 * plus si la navigation est fautive.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/pages", () => ({
  SectionContent: ({ section }: { section: string }) => <p>Canvas de {section}</p>,
}));

const { AppShell } = await import("@/components/app-shell");

/**
 * État minimal. Le shell ne lit que `asOfDate` : tout le reste traverse vers le contenu de
 * domaine, qui est ici remplacé. Le cast est donc exact sur ce que ce test exerce.
 */
const state = { asOfDate: "2026-09-08" } as DashboardState;

function renderShell(section: string) {
  return render(<AppShell initialState={state} section={section} />);
}

describe("navigation du shell", () => {
  it("n'affiche que six entrées de premier niveau", () => {
    renderShell("today");
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const groupLinks = [...nav.querySelectorAll(":scope > .nav-group > a")];
    expect(groupLinks).toHaveLength(6);
    expect(groupLinks.map((link) => link.textContent)).toEqual(
      NAV_GROUPS.map((group) => group.label),
    );
  });

  it("ne déplie les sous-vues que du groupe courant", () => {
    renderShell("real-estate");
    // Immobilier appartient à Patrimoine : ses quatre voisines apparaissent.
    expect(screen.getByRole("link", { name: "Immobilier" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Dettes" })).toBeVisible();
    // Les sous-vues des cinq autres groupes restent repliées, sinon le regroupement
    // réafficherait les dix-huit destinations qu'il vient de réduire.
    expect(screen.queryByRole("link", { name: "Fiscalité" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Scénarios" })).toBeNull();
  });

  it("marque la section courante et son groupe", () => {
    renderShell("tax");
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.map((link) => link.textContent)).toEqual(["Flux", "Fiscalité"]);
  });

  it("ne montre aucune sous-vue pour un groupe qui n'en a qu'une", () => {
    renderShell("decision-lab");
    // Décisions n'a qu'une sous-vue : un accordéon d'un seul élément répéterait l'entrée.
    expect(screen.queryByRole("link", { name: "Cas à comparer" })).toBeNull();
    expect(screen.getByRole("link", { name: "Décisions", current: "page" })).toBeVisible();
  });

  it("supprime le fil d'Ariane narratif de l'en-tête", () => {
    renderShell("net-worth");
    // §4.1 de V10 : pas de fil d'Ariane, l'identité du domaine est en zone A avec sa question.
    expect(screen.queryByText(/Léo Family Office\s*\/\s*/)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

describe("sections sorties de la navigation principale", () => {
  it("place Paramètres dans le menu du profil, replié par défaut", async () => {
    const user = userEvent.setup();
    renderShell("today");
    const trigger = screen.getByRole("button", { name: /Patrimoine personnel/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Paramètres" })).toBeNull();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const settings = SECONDARY_SECTIONS.find((item) => item.id === "settings")!;
    expect(screen.getByRole("link", { name: settings.label })).toHaveAttribute(
      "href",
      settings.href,
    );
  });

  it("place Rapports en action d'en-tête", () => {
    renderShell("today");
    const reports = SECONDARY_SECTIONS.find((item) => item.id === "reports")!;
    expect(screen.getByRole("link", { name: reports.label })).toHaveAttribute("href", reports.href);
  });

  it("rend une section secondaire sans lui inventer de question", () => {
    renderShell("settings");
    // Paramètres n'a pas de manifeste : le cadre affiche son libellé et rien de plus.
    expect(screen.getByText("Paramètres")).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByText("Canvas de settings")).toBeVisible();
  });

  it("reste atteignable pour la vue d'audit avancée", () => {
    renderShell("advisor");
    // Beyonder n'est plus une destination principale (§35) mais sa page répond toujours :
    // casser son URL en ferait une page perdue, ce que la section 7 ne demande pas.
    expect(screen.getByText("Canvas de advisor")).toBeVisible();
    expect(screen.getByText("Analyse Beyonder")).toBeVisible();
  });
});
