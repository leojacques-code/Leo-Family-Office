import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DebtContractForm } from "../debt-contract-form";
import { mutationSchema } from "@/lib/validation/mutations";
import type { OutstandingDebt } from "@/lib/types";

const debt: OutstandingDebt = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Prêt familial",
  lender: null,
  currency: "CHF",
  currentBalance: 1500.5,
  balanceDate: "2026-09-20",
  notes: null,
  provenance: { kind: "ACTUAL", confidence: "HIGH" },
};

const renderForm = (onSave = vi.fn().mockResolvedValue(true)) => {
  render(
    <DebtContractForm
      loan={null}
      promoteFrom={debt}
      asOfDate="2026-09-24"
      reportingCurrency="EUR"
      busy={false}
      onCancel={vi.fn()}
      onSave={onSave}
    />,
  );
  return onSave;
};
const fill = (label: RegExp, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.blur(screen.getByLabelText(label));
};

describe("B16 : décrire le contrat d'une dette connue par son seul encours", () => {
  it("garde la devise de la dette, ne redemande pas l'encours et dit que l'historique reste", () => {
    renderForm();
    expect(screen.getByLabelText(/Capital initial emprunté.*CHF/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Encours observé initial/)).toBeNull();
    expect(document.body).toHaveTextContent("Aucune seconde dette n’est créée");
    expect(document.body).toHaveTextContent("1 500,50");
  });

  it("envoie la même ligne avec la décision explicite, sans encours initial", async () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText("Prêteur"), { target: { value: "Famille" } });
    fill(/Capital initial emprunté/, "2000");
    fill(/Taux annuel/, "1");
    fill(/Paiement par échéance/, "100");
    fill(/Nombre d’échéances/, "20");
    fireEvent.submit(screen.getByLabelText("Prêteur").closest("form")!);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const sent = onSave.mock.calls[0]![0];
    expect(sent.liabilityId).toBe(debt.id);
    expect(sent.promoteOutstanding).toBe(true);
    expect(sent.initialBalance).toBeNull();
    expect(sent.balanceDate).toBeNull();
    // La commande envoyée passe la validation serveur.
    expect(mutationSchema.safeParse({ action: "save_debt_contract", contract: sent }).success).toBe(
      true,
    );
  });

  it("refuse la décision de promotion sans dette existante, ou sous une autre forme que true", () => {
    const base = {
      liabilityId: null,
      name: "Prêt",
      lender: "Banque",
      principal: 1000,
      initialBalance: 1000,
      balanceDate: "2026-09-01",
      annualRate: 0.01,
      paymentAmount: 100,
      paymentCount: 10,
      firstPaymentDate: "2026-10-01",
      maturityDate: "2027-07-01",
      amortisationProfile: "AMORTIZING",
      balloonAmount: null,
      paymentFrequency: "MONTHLY",
      interestConvention: "PROPORTIONAL",
      rateType: "FIXED",
      insuranceAmount: null,
      recurringFees: null,
      paymentIncludesInsurance: null,
      deferral: null,
      facilityId: null,
      notes: null,
      rateSchedule: [],
      paymentSchedule: [],
      earlyRepayments: [],
      charges: [],
      providedSchedule: [],
    };
    const parse = (contract: object) =>
      mutationSchema.safeParse({ action: "save_debt_contract", contract }).success;
    expect(parse(base)).toBe(true);
    expect(parse({ ...base, promoteOutstanding: true })).toBe(false);
    expect(parse({ ...base, liabilityId: debt.id, promoteOutstanding: false })).toBe(false);
    expect(parse({ ...base, liabilityId: debt.id, promoteOutstanding: "true" })).toBe(false);
    expect(parse({ ...base, liabilityId: debt.id, promoteOutstanding: true })).toBe(true);
  });
});
