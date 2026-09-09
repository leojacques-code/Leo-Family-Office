import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardState } from "@/lib/types";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";

/**
 * Zone B, rendue.
 *
 * Le composant `SourceRail` existait déjà et était testé en isolation, mais AUCUNE page ne le
 * montait : la trame V10 comptait donc deux zones persistantes sur trois, et le critère 3 du
 * gate visuel du §12.3 — « les sources restent invisibles » — était rouge sur les quatorze
 * écrans. Un composant testé qu'aucun écran ne rend ne prouve rien de l'écran.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/pages", () => ({
  SectionContent: ({ section }: { section: string }) => <p>Canvas de {section}</p>,
}));

const { AppShell } = await import("@/components/app-shell");

function renderShell(section: string, state: Partial<DashboardState> = {}) {
  return render(
    <AppShell
      source={{ kind: "SECTION", state: { asOfDate: "2026-09-08", ...state } as DashboardState }}
      section={section}
    />,
  );
}

describe("zone B branchée sur le shell", () => {
  it("rend le rail sur une page qui déclare la zone", () => {
    renderShell("debt");
    const rail = screen.getByRole("complementary", { name: "Sources du domaine" });
    expect(rail).toBeTruthy();
    // Les trois sources du §6.2 : « Contrat, échéancier, compte débité ».
    expect(rail.textContent).toContain("Échéancier");
    expect(rail.textContent).toContain("Contrat");
    expect(rail.textContent).toContain("Compte débité");
  });

  it("ne rend AUCUN rail sur une page qui ne déclare pas la zone", () => {
    // Rapports RESTITUE au lieu de s'alimenter : son manifeste ne déclare pas la zone B.
    //
    // C'était Aujourd'hui, jusqu'à ce que la version 2 de son manifeste lui donne un rail :
    // les six réponses du §3 changent de sens selon la fraîcheur de ce qui les alimente, et le
    // gate visuel du §12.3 fait échouer une page dont « les sources restent invisibles ».
    renderShell("reports");
    expect(screen.queryByRole("complementary", { name: "Sources du domaine" })).toBeNull();
  });

  it("ne rend aucun rail sur une section secondaire, qui n'a pas de manifeste", () => {
    renderShell("settings");
    expect(screen.queryByRole("complementary", { name: "Sources du domaine" })).toBeNull();
  });

  it("marque le poste de travail comme portant un rail, pour que le CSS place la colonne", () => {
    const { container } = renderShell("debt");
    expect(container.querySelector(".workstation")?.getAttribute("data-with-rail")).toBe("true");
    renderShell("reports");
    const shells = [...document.querySelectorAll(".workstation")];
    expect(shells.some((el) => el.getAttribute("data-with-rail") === null)).toBe(true);
  });

  it("ne réserve PAS la colonne du rail à un rail sans ligne", () => {
    // Le défaut est structurel et il vaut la peine d'être gardé : `Boolean(sourceRail)` est
    // vrai pour un élément qui rendra `null`, et la racine porterait alors
    // `data-with-rail="true"` pour une colonne vide — les 2,75 colonnes sur 16 du rail
    // retirées au canvas, en permanence. C'est le point E4 de la phase 1, côté rail.
    //
    // Le gate de registre interdit aujourd'hui un manifeste qui déclare la zone sans source,
    // donc le cas n'est pas atteignable par un manifeste ; ce test garde la DÉCISION, pour que
    // le prochain qui passera la zone inconditionnellement le voie ici.
    const { container } = render(
      <AppShell
        section="reports"
        source={{ kind: "SECTION", state: { asOfDate: "2026-09-08" } as DashboardState }}
      />,
    );
    expect(container.querySelector(".workstation")).not.toHaveAttribute("data-with-rail");
  });

  it("annonce « À fournir » sur un état vide, jamais un état inventé", () => {
    renderShell("debt");
    const rail = screen.getByRole("complementary", { name: "Sources du domaine" });
    expect(rail.textContent).toContain("À fournir");
    expect(rail.textContent).not.toContain("À jour");
    // Et il propose de fournir la pièce, au lieu d'alerter : §6 de V10, « no warning
    // paragraph, no empty KPI card, small + / upload state in rail ».
    expect(rail.textContent).not.toContain("Non calculable");
  });

  it("annonce « À jour » et la date du fait le plus récent quand la source existe", () => {
    renderShell("debt", {
      liabilities: [
        {
          balanceDate: "2026-08-31",
          providedSchedule: [{ dueDate: "2026-09-05" }, { dueDate: "2031-11-05" }],
        },
      ] as unknown as DashboardState["liabilities"],
    });
    const rail = screen.getByRole("complementary", { name: "Sources du domaine" });
    expect(rail.textContent).toContain("À jour");
    // Mois abrégé : le §3 de V10 borne l'indication à quatre mots.
    //
    // La date attendue était « nov. 2031 », la dernière ÉCHÉANCE du prêt. C'est son horizon,
    // pas sa fraîcheur, et le rail l'affiche sous « Au … » : le prêt s'annonçait donc relu en
    // 2031. HORIZON ≠ FRAÎCHEUR, et la fraîcheur d'un échéancier est celle de l'encours qu'il
    // accompagne. Le défaut est resté invisible tant qu'aucune page ne montait de rail.
    expect(rail.textContent).toContain("31 août 2026");
    expect(rail.textContent).not.toContain("2031");
  });

  it("la sélection d'une source ne fuit pas d'une page à l'autre", async () => {
    // Les identifiants de source sont locaux à leur page : « bank » existe dans Patrimoine,
    // Flux, Dette, Carrière et Fiscalité. Sans la section dans l'état de sélection, une ligne
    // apparaîtrait surlignée sur une page où l'utilisateur n'a rien cliqué.
    const user = userEvent.setup();
    const { unmount } = renderShell("career");
    const railBefore = screen.getByRole("complementary", { name: "Sources du domaine" });
    const bank = [...railBefore.querySelectorAll("button.source-row")].find((el) =>
      el.textContent?.includes("Banque"),
    );
    expect(bank).toBeTruthy();
    await user.click(bank as HTMLElement);
    expect(bank?.getAttribute("aria-current")).toBe("true");
    unmount();

    renderShell("cash-flow");
    const railAfter = screen.getByRole("complementary", { name: "Sources du domaine" });
    expect([...railAfter.querySelectorAll("[aria-current='true']")]).toHaveLength(0);
  });

  it("chaque page à rail en rend autant de lignes qu'elle en déclare", () => {
    for (const [id, manifest] of Object.entries(PAGE_REGISTRY)) {
      if (!manifest.zones.includes("SOURCE_RAIL")) continue;
      const { container, unmount } = renderShell(id);
      const rows = container.querySelectorAll(".source-rail-list > li");
      expect(rows.length, `page ${id}`).toBe(manifest.sources.length);
      unmount();
    }
  });
});
