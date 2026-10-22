import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DebtEventForm } from "../debt-event-form";
import { resolveContractTerms, UNDECLARED_LOAN_TERMS } from "@/lib/engine/debt";
import { operationalToday } from "@/lib/financial-date";
import type { Liability } from "@/lib/types";

const loan: Liability = resolveContractTerms(
  {
    ...UNDECLARED_LOAN_TERMS,
    id: "loan",
    name: "Prêt",
    lender: "Banque",
    principal: 1200,
    currentBalance: 1200,
    balanceDate: "2026-09-01",
    currency: "EUR",
    annualRate: 0,
    monthlyPayment: 0,
    paymentCount: 0,
    firstPaymentDate: "2026-10-05",
    maturityDate: "",
    recurringFees: 0,
    insuranceMode: "NONE",
    paymentIncludesInsurance: false,
    provenance: { kind: "USER_ASSUMPTION", confidence: "HIGH" },
  },
  { monthlyPayment: 100, paymentCount: 12, maturityDate: null },
);
function shift(days: number): string {
  const date = new Date(`${operationalToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const fillMoney = (label: RegExp, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.blur(screen.getByLabelText(label));
};

describe("B18 : formulaire d'événement de dette", () => {
  it("commence par la question d'usage et ne préremplit aucun fait", () => {
    render(
      <DebtEventForm
        loan={loan}
        asOfDate="2026-09-01"
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Enregistrer l’événement/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/J’ai remboursé une partie du capital/));
    expect(screen.getByLabelText("Date du remboursement")).toHaveValue("");
    expect(screen.getByLabelText("Source")).toHaveValue("");
    expect(screen.getByLabelText("Indemnité de remboursement anticipé")).toHaveValue("");
    expect(screen.getByLabelText("Effet sur le prêt")).toHaveValue("");
  });

  it("montre les conséquences d'un avenant avant l'enregistrement, puis l'envoie tel que déclaré", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <DebtEventForm
        loan={loan}
        asOfDate="2026-09-01"
        busy={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/J’ai signé un avenant/));
    fireEvent.change(screen.getByLabelText("Date d’effet"), { target: { value: "2027-01-05" } });
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "Avenant n° 1" } });
    fillMoney(/Nouvelle mensualité/, "50");
    fireEvent.change(screen.getByLabelText("Nouvelle dernière échéance (facultative)"), {
      target: { value: "2028-06-05" },
    });
    const consequences = screen.getByRole("region", { name: "Conséquences" });
    // 3 × 100 € payés, 900 € au 5 janvier 2027, puis 18 × 50 € : fin le 5 juin 2028.
    expect(consequences).toHaveTextContent("5 septembre 2027");
    expect(consequences).toHaveTextContent("5 juin 2028");
    expect(consequences).not.toHaveTextContent("subsisteraient");
    fireEvent.submit(
      screen.getByRole("button", { name: /Enregistrer l’événement/ }).closest("form")!,
    );
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual({
      nature: "CONTRACTUAL",
      effectiveDate: "2027-01-05",
      source: "Avenant n° 1",
      content: {
        kind: "AMENDMENT",
        annualRate: null,
        paymentAmount: 50,
        maturityDate: "2028-06-05",
        note: null,
      },
    });
  });

  it("refuse un remboursement effectué daté de demain et un prévu daté d'aujourd'hui", () => {
    const onSubmit = vi.fn();
    render(
      <DebtEventForm
        loan={loan}
        asOfDate="2026-09-01"
        busy={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/J’ai remboursé une partie du capital/));
    fireEvent.change(screen.getByLabelText("Date du remboursement"), {
      target: { value: shift(1) },
    });
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "Relevé" } });
    fillMoney(/Capital remboursé/, "300");
    fireEvent.change(screen.getByLabelText("Indemnité de remboursement anticipé"), {
      target: { value: "UNKNOWN" },
    });
    fireEvent.change(screen.getByLabelText("Effet sur le prêt"), {
      target: { value: "SHORTEN_TERM" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: /Enregistrer l’événement/ }).closest("form")!,
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("n’est pas daté après aujourd’hui");
    fireEvent.click(screen.getByLabelText(/Je vais rembourser/));
    fireEvent.change(screen.getByLabelText("Date du remboursement"), {
      target: { value: operationalToday() },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: /Enregistrer l’événement/ }).closest("form")!,
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("daté après aujourd’hui");
  });

  it("garde la saisie quand l'enregistrement est refusé", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    const onCancel = vi.fn();
    render(
      <DebtEventForm
        loan={loan}
        asOfDate="2026-09-01"
        busy={false}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Le taux a été révisé/));
    fireEvent.change(screen.getByLabelText("Date d’effet"), { target: { value: "2027-01-05" } });
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "Courrier" } });
    fillMoney(/Nouveau taux annuel/, "2");
    fireEvent.submit(
      screen.getByRole("button", { name: /Enregistrer l’événement/ }).closest("form")!,
    );
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Source")).toHaveValue("Courrier");
  });
});
