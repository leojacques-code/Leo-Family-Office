import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import DebtPage from "../page";
import { PrimaryActionProvider } from "@/components/workstation/primary-action";
import { buildDemoState } from "@/lib/data/read-models/today-demo";
vi.mock("recharts", () => ({
  ResponsiveContainer: () => null,
  Area: () => null,
  AreaChart: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
describe("comparaison dette/placement : faits et unités indispensables", () => {
  it.each(["no-cash", "missing-fx", "foreign-loan"])(
    "ne chiffre pas une comparaison %s",
    (situation) => {
      const state = buildDemoState("2026-09-13");
      expect(state.liabilities.length).toBeGreaterThan(0);
      // Le scénario suffit pour entrer dans la comparaison avant B09, même sans cash connu.
      state.scenarios = [
        { id: "scenario", name: "Central", annualVolatility: 0.1, annualInflation: 0.02 },
      ] as typeof state.scenarios;
      const cashObservationPresent = situation !== "no-cash";
      state.metrics.bankCash = situation === "missing-fx" ? null : 0;
      state.liabilities[0]!.currency =
        situation === "foreign-loan" ? "USD" : state.reportingCurrency;
      render(
        <DebtPage
          state={{ ...state, cashObservationPresent }}
          mutate={vi.fn()}
          busy={false}
          setExplanation={vi.fn()}
        />,
      );
      expect(screen.getByText("Comparaison à compléter")).toBeInTheDocument();
      expect(screen.queryByText(/Les deux colonnes sont des grandeurs objectives/)).toBeNull();
    },
  );
});

it("interdit les ouvertures pendant la reprise et utilise ensuite le nouvel encours", async () => {
  const state = buildDemoState("2026-09-13");
  const props = { mutate: vi.fn(), setExplanation: vi.fn() };
  const { rerender } = render(<DebtPage {...props} state={state} busy />);
  for (const name of ["Modifier le contrat", "Nouvel encours", "Nouvelle dette"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toBeDisabled();
    await userEvent.click(button);
  }
  expect(screen.queryByRole("dialog")).toBeNull();
  const updated = { ...state, liabilities: [{ ...state.liabilities[0]!, currentBalance: 11000 }] };
  rerender(<DebtPage {...props} state={updated} busy={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Nouvel encours" }));
  expect(screen.getByRole("spinbutton", { name: "Encours" })).toHaveValue(11000);
});

it("retire aussi l’import primaire pendant une reprise de lecture", () => {
  const onChange = vi.fn();
  const state = buildDemoState("2026-09-13");
  const page = (busy: boolean) => (
    <PrimaryActionProvider onChange={onChange}>
      <DebtPage state={state} busy={busy} mutate={vi.fn()} setExplanation={vi.fn()} />
    </PrimaryActionProvider>
  );
  const { rerender } = render(page(false));
  expect(onChange).toHaveBeenLastCalledWith({ run: expect.any(Function) });
  rerender(page(true));
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(page(false));
  expect(onChange).toHaveBeenLastCalledWith({ run: expect.any(Function) });
});
