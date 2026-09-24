import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Transaction } from "@/lib/types";
import { NetIncomeCorrectionDrawer } from "../net-income-correction-drawer";

const income: Transaction = {
  id: "t1",
  accountId: "a1",
  accountName: "Compte courant",
  date: "2026-09-23",
  label: "Salaire septembre",
  categoryId: "",
  categoryName: "",
  amount: 2450.35,
  currency: "EUR",
  kindOverride: "INCOME",
  transferGroupId: null,
  propertyId: null,
  notes: null,
  provenance: { kind: "ACTUAL", confidence: "HIGH", source: "Saisie revenu net observé" },
};
const setup = (
  transaction: Transaction = income,
  closedMonthVersion: number | null = null,
  onSubmit = vi.fn().mockResolvedValue(true),
) => {
  const onClose = vi.fn();
  render(
    <NetIncomeCorrectionDrawer
      open
      transaction={transaction}
      closedMonthVersion={closedMonthVersion}
      maxDate="2026-09-24"
      busy={false}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onClose, dialog: screen.getByRole("dialog") };
};
const setAmount = (dialog: HTMLElement, value: string) => {
  fireEvent.change(within(dialog).getByLabelText(/Montant net versé/), { target: { value } });
  fireEvent.blur(within(dialog).getByLabelText(/Montant net versé/));
};
const setReason = (dialog: HTMLElement, value: string) =>
  fireEvent.change(within(dialog).getByLabelText(/Motif de la correction/), {
    target: { value },
  });
const save = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole("button", { name: /Enregistrer la correction/ }));

describe("Correction d'un revenu net saisi", () => {
  it("envoie l'état affiché et le seul champ modifié, avec son motif", async () => {
    const { dialog, onSubmit, onClose } = setup();
    setAmount(dialog, "2 405,35");
    setReason(dialog, "Montant saisi avant retenue à la source");
    save(dialog);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      transactionId: "t1",
      reason: "Montant saisi avant retenue à la source",
      expected: { amount: 2450.35, receivedOn: "2026-09-23", label: "Salaire septembre" },
      corrected: { amount: 2405.35 },
    });
  });

  it("refuse une correction sans changement, sans motif ou vidée, sans rien envoyer", () => {
    const { dialog, onSubmit } = setup();
    setReason(dialog, "Motif");
    save(dialog);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Aucune valeur n’a changé");
    setAmount(dialog, "2 405,35");
    setReason(dialog, "  ");
    save(dialog);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("motif");
    // Un champ VIDE est bloqué par le formulaire lui-même (`required`) ; une saisie
    // illisible ne l'est pas, et elle ne doit jamais être lue comme zéro.
    setAmount(dialog, "deux mille");
    setReason(dialog, "Motif");
    save(dialog);
    expect(dialog.querySelector(".form-error")).toHaveTextContent(
      "n’est pas interprété comme zéro",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ne propose ni compte ni devise à corriger, et dit qu'aucune régularisation n'est créée", () => {
    const { dialog } = setup();
    expect(within(dialog).getByLabelText("Compte crédité")).toBeDisabled();
    expect(dialog).toHaveTextContent("Aucune opération de régularisation n’est créée");
  });

  it("signale une clôture existante et montre l'historique des corrections", () => {
    const { dialog } = setup(
      {
        ...income,
        amount: 2405.35,
        corrections: [
          {
            id: "c1",
            decidedAt: "2026-09-24T08:00:00Z",
            reason: "Retenue à la source",
            changedFields: ["amount"],
            before: { amount: "2450.35", date: "2026-09-23", label: "Salaire septembre" },
            after: { amount: "2405.35", date: "2026-09-23", label: "Salaire septembre" },
          },
        ],
      },
      2,
    );
    expect(dialog).toHaveTextContent("Ce mois est clôturé (v2)");
    expect(dialog).toHaveTextContent("Corrections précédentes");
    expect(dialog).toHaveTextContent("Retenue à la source");
  });

  it("garde le tiroir ouvert et le dit quand l'écriture est refusée", async () => {
    const { dialog, onClose } = setup(income, null, vi.fn().mockResolvedValue(false));
    setAmount(dialog, "2 405,35");
    setReason(dialog, "Motif");
    save(dialog);
    await vi.waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("n’a pas été enregistrée"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
