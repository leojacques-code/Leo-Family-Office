import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DebtContractForm } from "../debt-contract-form";
import type { FormDraft } from "@/lib/presentation/drafts/contracts";

const savedDraft = (overrides: Partial<FormDraft> = {}): FormDraft => ({
  id: "0b8d2f5e-2c9f-4f7a-9d1e-2a3b4c5d6e7f",
  kind: "DEBT_CONTRACT_NEW",
  subjectId: null,
  title: "Prêt immobilier",
  content: {
    contract: { name: "Prêt immobilier", lender: "Banque", paymentAmount: 850 },
    structure: { mode: "AMORTIZING", paymentFrequency: "", interestConvention: "", rateType: "" },
    requiredValues: { principal: 200000, initialBalance: null, annualRate: null },
    insurance: { choice: "", policies: [] },
  },
  schemaVersion: 1,
  version: 3,
  updatedAt: "2026-09-25T08:30:00Z",
  ...overrides,
});

function renderForm(props: Partial<Parameters<typeof DebtContractForm>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(true);
  const onSaveDraft = vi.fn();
  const onDiscardDraft = vi.fn().mockResolvedValue(true);
  const onCancel = vi.fn();
  render(
    <DebtContractForm
      asOfDate="2026-01-01"
      reportingCurrency="EUR"
      busy={false}
      loan={null}
      onCancel={onCancel}
      onSave={onSave}
      onSaveDraft={onSaveDraft}
      onDiscardDraft={onDiscardDraft}
      {...props}
    />,
  );
  return { onSave, onSaveDraft, onDiscardDraft, onCancel };
}

describe("Brouillons du contrat de dette (document 03 §8)", () => {
  it("reprend un brouillon incomplet, sans rien supposer de ce qui manque", () => {
    renderForm({ draft: savedDraft() });
    expect(screen.getByLabelText("Nom de la dette")).toHaveValue("Prêt immobilier");
    expect(screen.getByLabelText("Mode de remboursement")).toHaveValue("AMORTIZING");
    expect(screen.getByLabelText("Périodicité des échéances")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Brouillon du 25 septembre 2026");
  });

  it("enregistre un brouillon incomplet sans valider le contrat", async () => {
    const { onSave, onSaveDraft } = renderForm();
    onSaveDraft.mockResolvedValue({ ok: true, draft: savedDraft({ version: 1 }) });
    fireEvent.change(screen.getByLabelText("Nom de la dette"), { target: { value: "Prêt auto" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le brouillon" }));
    await vi.waitFor(() => expect(onSaveDraft).toHaveBeenCalled());
    expect(onSave).not.toHaveBeenCalled();
    expect(onSaveDraft.mock.calls[0]![0]).toMatchObject({
      draftId: null,
      expectedVersion: null,
      kind: "DEBT_CONTRACT_NEW",
      subjectId: null,
      title: "Prêt auto",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "n’alimente ni le patrimoine ni les calculs",
    );
  });

  it("renvoie la version lue, et garde la saisie en cas de conflit", async () => {
    const { onSaveDraft } = renderForm({ draft: savedDraft() });
    onSaveDraft.mockResolvedValueOnce({ ok: false, conflict: true, message: "Conflit" });
    fireEvent.change(screen.getByLabelText("Nom de la dette"), {
      target: { value: "Prêt modifié" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le brouillon" }));
    await vi.waitFor(() => expect(onSaveDraft).toHaveBeenCalled());
    expect(onSaveDraft.mock.calls[0]![0]).toMatchObject({
      draftId: savedDraft().id,
      expectedVersion: 3,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("enregistré ailleurs");
    expect(screen.getByLabelText("Nom de la dette")).toHaveValue("Prêt modifié");
    // Deux issues explicites, aucune écriture silencieuse.
    onSaveDraft.mockResolvedValueOnce({ ok: true, draft: savedDraft({ version: 4 }) });
    fireEvent.click(screen.getByRole("button", { name: "Remplacer par ma saisie" }));
    await vi.waitFor(() => expect(onSaveDraft).toHaveBeenCalledTimes(2));
    expect(onSaveDraft.mock.calls[1]![0]).toMatchObject({
      draftId: savedDraft().id,
      replaceLatest: true,
      title: "Prêt modifié",
    });
    expect(
      screen.getByRole("button", { name: "Enregistrer comme nouveau brouillon" }),
    ).toBeTruthy();
  });

  it("vise la dette ouverte, jamais une dette nommée par le brouillon", async () => {
    const promoteFrom = {
      id: "7c1e0d2a-1b3c-4d5e-8f90-a1b2c3d4e5f6",
      name: "Prêt familial",
      lender: null,
      currentBalance: 1000,
      currency: "EUR",
      balanceDate: "2026-09-20",
      notes: null,
      provenance: { kind: "ACTUAL" as const, confidence: "HIGH" as const },
    };
    const { onSaveDraft } = renderForm({ promoteFrom });
    onSaveDraft.mockResolvedValue({ ok: true, draft: savedDraft() });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le brouillon" }));
    await vi.waitFor(() => expect(onSaveDraft).toHaveBeenCalled());
    expect(onSaveDraft.mock.calls[0]![0]).toMatchObject({
      kind: "DEBT_CONTRACT_PROMOTION",
      subjectId: promoteFrom.id,
      title: "Prêt familial",
    });
  });
});
