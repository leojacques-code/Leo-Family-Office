import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { FinancialAccount } from "@/lib/types";
import { NetIncomeDrawer } from "../net-income-drawer";

const account = (id: string, currency: string): FinancialAccount => ({
  id,
  institutionId: "i",
  institution: "Banque",
  name: `Compte ${currency}`,
  type: "BANK",
  currency,
  balance: 1000,
  balanceDate: "2026-09-20",
  liquidity: "IMMEDIATE",
  provenance: { kind: "ACTUAL", confidence: "HIGH" },
});
const setup = (accounts: FinancialAccount[], onSubmit = vi.fn().mockResolvedValue(true)) => {
  render(
    <NetIncomeDrawer
      open
      accounts={accounts}
      reportingCurrency="EUR"
      maxDate="2026-09-24"
      busy={false}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, dialog: screen.getByRole("dialog") };
};
const fill = (dialog: HTMLElement, amount: string, date = "2026-09-23") => {
  fireEvent.change(within(dialog).getByLabelText("Libellé"), {
    target: { value: "Salaire septembre" },
  });
  fireEvent.change(within(dialog).getByLabelText(/Montant net versé/), {
    target: { value: amount },
  });
  fireEvent.blur(within(dialog).getByLabelText(/Montant net versé/));
  fireEvent.change(within(dialog).getByLabelText(/Date de versement/), {
    target: { value: date },
  });
};

describe("Premier revenu net observé", () => {
  it("sans compte, n'enregistre rien et indique où ajouter le compte crédité", () => {
    const { dialog, onSubmit } = setup([]);
    expect(dialog).toHaveTextContent("ajoutez d’abord le compte qui le reçoit");
    expect(within(dialog).getByRole("link", { name: "Ajouter un compte" })).toHaveAttribute(
      "href",
      "/net-worth",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("enregistre le net versé, sans brut ni impôt, sur le seul compte disponible", async () => {
    const { dialog, onSubmit } = setup([account("eur", "EUR")]);
    // Aucun CHAMP de brut, d'impôt ou de cotisation n'est demandé.
    expect(within(dialog).queryByLabelText(/brut|impôt|cotisation|employeur/i)).toBeNull();
    fill(dialog, "2 450,35");
    fireEvent.submit(dialog.querySelector("form")!);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      accountId: "eur",
      receivedOn: "2026-09-23",
      amount: 2450.35,
      label: "Salaire septembre",
      notes: null,
    });
  });

  it("refuse un montant vide, nul ou une date future sans rien enregistrer", async () => {
    const { dialog, onSubmit } = setup([account("eur", "EUR")]);
    fill(dialog, "");
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Un champ vide n’est pas un revenu nul",
    );
    fill(dialog, "0");
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("strictement positif");
    fill(dialog, "100", "2026-09-30");
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("ne peut pas être future");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuse un revenu dans une autre devise tant que Flux ne convertit pas", async () => {
    const { dialog, onSubmit } = setup([account("eur", "EUR"), account("chf", "CHF")]);
    fireEvent.change(within(dialog).getByLabelText("Compte crédité"), {
      target: { value: "chf" },
    });
    fill(dialog, "100");
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Ce compte est en CHF et votre lecture en EUR",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
