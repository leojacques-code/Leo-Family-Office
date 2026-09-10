import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetDrawer, type AssetDraft } from "../asset-drawer";
import type { FinancialAccount, Provenance } from "@/lib/types";

// Toutes les valeurs de ce fichier sont des fixtures synthétiques.
const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH", effectiveDate: "2026-09-09" };

const existing: FinancialAccount = {
  id: "bank-1",
  institutionId: "inst",
  institution: "Établissement test",
  name: "Compte courant",
  type: "BANK",
  currency: "EUR",
  balance: 4_200,
  balanceDate: "2026-09-09",
  liquidity: "IMMEDIATE",
  provenance,
};

const submitMock = () => vi.fn<(draft: AssetDraft) => Promise<boolean>>(async () => true);

function renderDrawer(account: FinancialAccount | null, onSubmit = submitMock()) {
  render(
    <AssetDrawer
      account={account}
      busy={false}
      maxDate="2026-09-09"
      onClose={vi.fn()}
      onSubmit={onSubmit}
      open
      reportingCurrency="EUR"
    />,
  );
  return { onSubmit };
}

describe("tiroir d’actif — un champ vide n’est jamais un zéro", () => {
  it("ouvre un solde VIDE, y compris en mise à jour d’un compte déjà valorisé", () => {
    renderDrawer(existing);
    // Préremplir l'ancien solde inviterait à le revalider sans l'avoir lu : la valeur saisie
    // est une NOUVELLE observation.
    expect(screen.getByLabelText(/Solde observé, en EUR/)).toHaveValue("");
  });

  it("refuse l’enregistrement tant que le solde est absent", async () => {
    const { onSubmit } = renderDrawer(null);
    await userEvent.type(screen.getByLabelText(/Établissement/), "Banque test");
    await userEvent.type(screen.getByLabelText(/Nom du compte/), "Compte test");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l’actif/ }));
    // Le champ est `required` : la validation du navigateur bloque avant le garde-fou. Les
    // deux refusent, et le contrat testé est le refus d'écrire, pas lequel des deux a parlé.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Solde observé/)).toBeInvalid();
  });

  it("refuse une saisie ILLISIBLE, que la validation du navigateur laisserait passer", async () => {
    // « abc » n'est pas vide : `required` est satisfait. Seule la lecture de la primitive
    // distingue une saisie illisible d'un montant, et c'est là que le garde-fou sert.
    const { onSubmit } = renderDrawer(null);
    await userEvent.type(screen.getByLabelText(/Établissement/), "Banque test");
    await userEvent.type(screen.getByLabelText(/Nom du compte/), "Compte test");
    await userEvent.type(screen.getByLabelText(/Solde observé/), "abc");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l’actif/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    // Le champ porte déjà sa raison ; le message de formulaire dit la CONSÉQUENCE, et ne
    // prétend pas que le champ est vide alors qu'il porte « abc ».
    expect(screen.getByText(/n’est pas interprété comme zéro/)).toBeVisible();
    expect(screen.getByText(/virgule décimale uniquement/)).toBeVisible();
  });

  it("accepte un zéro DÉCLARÉ, qui n’est pas une absence", async () => {
    const { onSubmit } = renderDrawer(null);
    await userEvent.type(screen.getByLabelText(/Établissement/), "Banque test");
    await userEvent.type(screen.getByLabelText(/Nom du compte/), "Livret vide");
    await userEvent.type(screen.getByLabelText(/Solde observé/), "0");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l’actif/ }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ balance: 0, name: "Livret vide" });
  });

  it("accepte un solde négatif, qui devient un découvert au passif", async () => {
    const { onSubmit } = renderDrawer(null);
    await userEvent.type(screen.getByLabelText(/Établissement/), "Banque test");
    await userEvent.type(screen.getByLabelText(/Nom du compte/), "Compte à découvert");
    await userEvent.type(screen.getByLabelText(/Solde observé/), "-300");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l’actif/ }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ balance: -300 });
    expect(screen.getByText(/Un solde négatif devient un découvert au passif/)).toBeVisible();
  });

  it("lit une virgule décimale, ce qu’un champ numéro refuse selon la locale", async () => {
    const { onSubmit } = renderDrawer(existing);
    await userEvent.type(screen.getByLabelText(/Solde observé/), "4200,55");
    await userEvent.type(screen.getByLabelText(/Date du solde/), "2026-09-08");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l’observation/ }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      balance: 4200.55,
      balanceDate: "2026-09-08",
    });
  });
});

describe("tiroir d’actif — la date n’est demandée que là où elle est transmise", () => {
  it("ne demande aucune date à la création, et dit pourquoi", () => {
    renderDrawer(null);
    expect(screen.queryByLabelText(/Date du solde/)).toBeNull();
    // `add_account` ne porte pas de date : la demander pour la jeter ferait croire à
    // l'utilisateur qu'il a déclaré une date d'observation.
    expect(screen.getByText(/daté du jour d’enregistrement/)).toBeVisible();
  });

  it("exige la date en mise à jour et refuse une observation sans date", async () => {
    const { onSubmit } = renderDrawer(existing);
    await userEvent.type(screen.getByLabelText(/Solde observé/), "4300");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l’observation/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Date du solde/)).toBeInvalid();
  });

  it("interdit de dater une observation dans le futur", () => {
    renderDrawer(existing);
    expect(screen.getByLabelText(/Date du solde/)).toHaveAttribute("max", "2026-09-09");
  });
});

describe("tiroir d’actif — forme et devise", () => {
  it("refuse une devise qui n’est pas un code de trois lettres", async () => {
    const { onSubmit } = renderDrawer(null);
    await userEvent.type(screen.getByLabelText(/Établissement/), "Banque test");
    await userEvent.type(screen.getByLabelText(/Nom du compte/), "Compte test");
    await userEvent.clear(screen.getByLabelText(/Devise/));
    await userEvent.type(screen.getByLabelText(/Devise/), "EU");
    await userEvent.type(screen.getByLabelText(/Solde observé/), "100");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l’actif/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/trois lettres/);
  });

  it("s’ouvre comme un dialogue, hors du canvas", () => {
    renderDrawer(null);
    // Le §29 fait échouer un domaine dont « forms occupy the main first view ».
    expect(screen.getByRole("dialog", { name: "Ajouter un actif" })).toBeVisible();
  });
});
