import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Liability, Scenario } from "@/lib/types";
import { compareDebtVsInvest } from "@/lib/engine/decision";
import DebtPage from "../page";
import { DebtContractForm } from "../debt-contract-form";

// Résultats figés : ces tests vérifient les unités de l’interface, aucun calcul financier.
vi.mock("@/lib/engine/debt", () => ({
  buildLoanTimeline: () => {
    const schedule = {
      kind: "DERIVED",
      totalInterest: 12,
      firstDueDate: "2026-10-01",
      lastDueDate: "2027-09-01",
      entries: [
        {
          paymentNumber: 1,
          entryKind: "SCHEDULED",
          dueDate: "2026-10-01",
          totalCashOut: 101,
          principal: 99,
          interest: 2,
          closingBalance: 1101,
        },
      ],
    };
    return {
      contractual: schedule,
      forward: schedule,
      flags: [],
      contractualGap: 12,
      elapsedPayments: 0,
    };
  },
  monthlyDebtServiceAt: () => 101,
  monthBounds: () => ({ start: "2026-09-01", end: "2026-09-30" }),
  debtServiceBreakdownForPeriod: () => ({
    principal: 99,
    interest: 2,
    insurance: 0,
    fees: 0,
    economicCost: 2,
  }),
  nextDebtEvent: () => null,
}));
vi.mock("@/lib/engine/decision", () => ({
  compareDebtVsInvest: vi.fn(() => ({
    capital: 50,
    horizonYears: 5,
    repay: { interestAvoided: null },
    invest: { expectedGain: 4 },
  })),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  YAxis: ({ tickFormatter }: { tickFormatter: (n: number) => string }) => (
    <span data-testid="axis">{tickFormatter(12000)}</span>
  ),
  Tooltip: ({ formatter }: { formatter: (n: number) => string }) => (
    <span data-testid="tooltip">{formatter(1101)}</span>
  ),
  Area: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
}));
const loan: Liability = {
  id: "usd-loan",
  name: "Prêt USD",
  lender: "Banque de recette",
  currency: "USD",
  principal: 1200,
  currentBalance: 1200,
  annualRate: 0.02,
  monthlyPayment: 101,
  paymentCount: 12,
  firstPaymentDate: "2026-10-01",
  maturityDate: "2027-09-01",
  monthlyInsurance: null,
  recurringFees: null,
  paymentIncludesInsurance: null,
  deferral: null,
  amortisationProfile: "AMORTIZING",
  balloonAmount: null,
  paymentFrequency: "MONTHLY",
  interestConvention: "PROPORTIONAL",
  rateType: "FIXED",
  rateSchedule: [],
  paymentSchedule: [],
  earlyRepayments: [],
  oneOffCharges: [],
  providedSchedule: [],
  facilityId: null,
  provenance: { kind: "ACTUAL", confidence: "HIGH", source: "Fixture unités" },
};
const state = {
  asOfDate: "2026-09-22",
  liabilities: [loan],
  scenarios: [] as Scenario[],
  metrics: { bankCash: 50 },
  reportingCurrency: "EUR",
};
const props = { busy: false, mutate: vi.fn(), setExplanation: vi.fn() };

describe("Dettes : devise native explicite", () => {
  it("rend cartes, échéances, graphe, explication et encours en USD malgré une lecture EUR", () => {
    const { container } = render(<DebtPage state={state} {...props} />);
    expect(container.textContent).not.toContain("€");
    expect(screen.getByTestId("axis")).toHaveTextContent(/\$US/);
    expect(screen.getByTestId("tooltip")).toHaveTextContent(/1.101.*\$US/);
    fireEvent.click(screen.getByRole("button", { name: "Comprendre l’échéancier" }));
    const explanation = props.setExplanation.mock.lastCall![0];
    expect(
      explanation.inputs.find((item: { label: string }) => item.label.startsWith("Encours")).value,
    ).toMatch(/1.200.*\$US/);
    fireEvent.click(screen.getByRole("button", { name: "Nouvel encours" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/Montant en USD/);
  });
  it("ne suppose pas EUR quand la devise native manque", () => {
    const { container } = render(
      <DebtPage state={{ ...state, liabilities: [{ ...loan, currency: undefined }] }} {...props} />,
    );
    expect(container.textContent).toContain("devise non renseignée");
    expect(container.textContent).not.toContain("€");
  });
  it("garde la comparaison fermée entre devises et libelle le cash dans sa devise de lecture", () => {
    const scenarios = [
      { id: "central", name: "Central", annualVolatility: 0.1, annualInflation: 0.02 },
    ] as Scenario[];
    vi.mocked(compareDebtVsInvest).mockClear();
    const { container, rerender } = render(<DebtPage state={{ ...state, scenarios }} {...props} />);
    expect(compareDebtVsInvest).not.toHaveBeenCalled();
    rerender(<DebtPage state={{ ...state, scenarios, reportingCurrency: "USD" }} {...props} />);
    expect(container.textContent).toMatch(/cash bancaire réellement disponible \(50\s*\$US/);
    expect(container.textContent).not.toContain("€");
  });
  it("annonce les unités du contrat et garde EUR pour la création réellement persistée en EUR", () => {
    const form = {
      busy: false,
      asOfDate: state.asOfDate,
      reportingCurrency: "CHF",
      onSave: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = render(<DebtContractForm key="edit" {...form} loan={loan} />);
    expect(screen.getByLabelText(/Capital initial emprunté.*USD/)).toHaveValue("1200");
    expect(screen.getByText(/Tous les montants/)).toHaveTextContent(/en USD/);
    rerender(<DebtContractForm key="new" {...form} loan={null} />);
    expect(screen.getByLabelText(/Capital initial emprunté.*EUR/)).toHaveValue("");
    expect(screen.getByText(/La création est actuellement limitée à EUR/)).toBeVisible();
  });
});
