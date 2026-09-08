import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinancialDrawer } from "@/components/workstation/financial-drawer";
import { Inspector, INSPECTOR_VISIBLE_FACTS } from "@/components/workstation/inspector";

/**
 * Accessibilité clavier des surfaces superposées.
 *
 * Critère de la section 11 pour cette phase : « états focus et dialogs accessibles ». Le test
 * porte sur ce qu'un utilisateur au clavier CONSTATE : la tabulation ne sort pas du dialogue,
 * Échap le ferme, et le focus revient à l'élément qui l'avait ouvert. Vérifier la seule
 * présence de `aria-modal` ne prouverait rien : cet attribut informe le lecteur d'écran, il
 * n'empêche pas la tabulation d'atteindre la page masquée.
 */

function DrawerHost() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Ouvrir
      </button>
      <button type="button">Derrière</button>
      <FinancialDrawer onClose={() => setOpen(false)} open={open} title="Nouvelle dette">
        <button type="button">Premier</button>
        <button type="button">Dernier</button>
      </FinancialDrawer>
    </>
  );
}

describe("FinancialDrawer au clavier", () => {
  it("prend le focus à l'ouverture, l'y retient aux deux bords, et le rend à la fermeture", async () => {
    const user = userEvent.setup();
    render(<DrawerHost />);
    const opener = screen.getByRole("button", { name: "Ouvrir" });

    opener.focus();
    await user.click(opener);

    const first = screen.getByRole("button", { name: "Premier" });
    const last = screen.getByRole("button", { name: "Dernier" });
    const close = screen.getByRole("button", { name: "Fermer" });
    // Le focus entre dans le dialogue : sinon la première tabulation partirait de la page
    // masquée.
    expect(close).toHaveFocus();

    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(last).toHaveFocus();
    // Bord avant : la tabulation depuis le dernier contrôle revient au premier du dialogue,
    // elle ne continue pas dans la page derrière.
    await user.tab();
    expect(close).toHaveFocus();
    // Bord arrière : sans lui, Maj+Tab depuis le premier contrôle sortirait du dialogue.
    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Le focus revient à son point de départ : sans restitution, il repartirait du haut de la
    // page et l'utilisateur devrait retraverser toute la navigation.
    expect(opener).toHaveFocus();
  });

  it("ferme au clic sur le fond mais pas au clic dans le tiroir", async () => {
    const user = userEvent.setup();
    render(<DrawerHost />);
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));

    await user.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeVisible();

    const backdrop = document.querySelector(".drawer-backdrop")!;
    await user.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("n'affiche l'onglet de sections que si le formulaire en a plusieurs", () => {
    const { rerender } = render(
      <FinancialDrawer onClose={() => {}} open sections={["Contrat"]} title="Dette">
        <button type="button">Champ</button>
      </FinancialDrawer>,
    );
    expect(screen.queryByRole("navigation")).toBeNull();

    rerender(
      <FinancialDrawer
        activeSection="Contrat"
        onClose={() => {}}
        open
        sections={["Contrat", "Paiement"]}
        title="Dette"
      >
        <button type="button">Champ</button>
      </FinancialDrawer>,
    );
    expect(screen.getByRole("navigation", { name: "Sections du formulaire" })).toBeVisible();
  });
});

describe("Inspector", () => {
  const facts = Array.from({ length: INSPECTOR_VISIBLE_FACTS + 2 }, (_, index) => ({
    label: `Fait ${index + 1}`,
    value: `Valeur ${index + 1}`,
  }));

  it("n'est pas un dialogue quand il est une colonne persistante", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Canvas</button>
        <Inspector facts={facts.slice(0, 2)} onClose={() => {}} title="Patrimoine net" />
      </>,
    );
    const inspector = screen.getByRole("complementary", { name: /Inspecteur/ });
    expect(inspector).not.toHaveAttribute("aria-modal");
    // Le focus doit pouvoir REVENIR au canvas : piéger le focus dans une colonne persistante
    // enfermerait l'utilisateur dans un panneau qu'il n'a pas ouvert comme un dialogue.
    const canvasButton = screen.getByRole("button", { name: "Canvas" });
    canvasButton.focus();
    await user.tab();
    expect(document.activeElement).not.toBe(canvasButton);
    expect(inspector.contains(document.activeElement)).toBe(true);
  });

  it("devient un dialogue sur fenêtre étroite", () => {
    render(<Inspector asDialog facts={facts.slice(0, 2)} onClose={() => {}} title="Dette" />);
    const dialog = screen.getByRole("dialog", { name: /Inspecteur/ });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("signale le défilement au-delà de six faits, sans les tronquer", () => {
    // §4.4 de V10 : 4 à 6 faits visibles par défaut. Le septième n'est pas SUPPRIMÉ — masquer
    // un fait le rendrait introuvable — il passe derrière un défilement.
    render(<Inspector facts={facts} onClose={() => {}} title="Patrimoine net" />);
    expect(screen.getAllByRole("term")).toHaveLength(facts.length);
    expect(document.querySelector(".inspector-facts")).toHaveAttribute("data-overflowing", "true");
  });

  it("ne se rend pas quand rien n'est sélectionné", () => {
    render(<Inspector facts={facts} onClose={() => {}} title={null} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("ferme sur demande", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Inspector facts={facts.slice(0, 1)} onClose={onClose} title="Dette" />);
    await user.click(screen.getByRole("button", { name: /Fermer/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("piège de focus et contrôles masqués", () => {
  it("ignore un contrôle masqué au lieu de lui donner le focus", async () => {
    const user = userEvent.setup();
    render(
      <FinancialDrawer onClose={() => {}} open title="Dette">
        <button hidden type="button">
          Masqué
        </button>
        <div style={{ display: "none" }}>
          <button type="button">Replié</button>
        </div>
        <button type="button">Visible</button>
      </FinancialDrawer>,
    );

    const close = screen.getByRole("button", { name: "Fermer" });
    const visible = screen.getByText("Visible");
    expect(close).toHaveFocus();
    await user.tab();
    // Le cycle ne compte que deux contrôles : le masqué et le replié n'en font pas partie,
    // sinon la tabulation s'arrêterait sur quelque chose que l'utilisateur ne voit pas.
    expect(visible).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });
});
