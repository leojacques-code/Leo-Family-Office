import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DebtContractForm } from "../debt-contract-form";

describe("nouveau contrat de dette — vide reste vide", () => {
  it("ne préremplit aucun montant, taux ou nombre d’échéances avec zéro", () => {
    render(
      <DebtContractForm
        asOfDate="2026-09-09"
        reportingCurrency="EUR"
        busy={false}
        loan={null}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    for (const input of [
      screen.getByLabelText(/Capital initial emprunté.*EUR/),
      screen.getByLabelText(/Encours observé initial.*EUR/),
      screen.getByLabelText(/Taux annuel.*pourcentage/),
      screen.getByLabelText(/Paiement par échéance.*EUR/),
      screen.getByLabelText(/Nombre d’échéances.*échéances/),
    ]) {
      expect(input).toHaveValue("");
    }
  });

  it("refuse l’enregistrement tant que les valeurs essentielles sont absentes", () => {
    const onSave = vi.fn();
    render(
      <DebtContractForm
        asOfDate="2026-09-09"
        reportingCurrency="EUR"
        busy={false}
        loan={null}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.submit(screen.getByRole("button", { name: "Enregistrer la dette" }).closest("form")!);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Complétez les montants/);
  });
});

it("conserve les notes du contrat distinctes de la dernière observation lors d’une réédition", async () => {
  const { buildDemoState } = await import("@/lib/data/read-models/today-demo");
  const base = buildDemoState("2026-09-14").liabilities[0]!;
  const loan = {
    ...base,
    contractNotes: "Échéancier fourni : extrait bancaire",
    provenance: { ...base.provenance, notes: "Observation du solde" },
  };
  const save = vi.fn().mockResolvedValue(true);
  render(
    <DebtContractForm
      loan={loan}
      asOfDate="2026-09-14"
      reportingCurrency="EUR"
      busy={false}
      onSave={save}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.submit(screen.getByRole("button", { name: "Enregistrer la dette" }).closest("form")!);
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      notes: "Échéancier fourni : extrait bancaire",
      initialBalance: null,
    }),
  );
});
