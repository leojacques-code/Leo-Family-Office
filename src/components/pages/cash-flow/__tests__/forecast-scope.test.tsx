import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CashFlowPage from "../page";
import { buildDemoState } from "@/lib/data/read-models/today-demo";
import type { SectionProps } from "../../shared";

vi.mock("recharts", async (original) => ({
  ...(await original<typeof import("recharts")>()),
  ResponsiveContainer: () => null,
}));

function renderForecast(kind: "unknown" | "observed-zero" | "declared-none" = "unknown") {
  const state = buildDemoState("2026-10-22");
  state.accounts = kind === "observed-zero"
    ? state.accounts.filter(account => account.type === "BANK").map(account => ({ ...account, balance: 0 }))
    : [];
  if (kind === "declared-none") {
    state.domainDeclarations = [{
      domain: "BANQUE",
      applicability: "DECLARED_NONE",
      declaredOn: state.asOfDate,
      note: null,
    }];
  }
  state.accountBalanceHistory = [];
  state.transactions = [];
  state.metrics = { ...state.metrics, bankCash: 0 };
  const props: SectionProps = {
    section: "cash-flow",
    state,
    busy: false,
    mutate: vi.fn(),
    setExplanation: vi.fn(),
    projection: null,
    runProjection: vi.fn(),
    refresh: vi.fn(),
  };
  render(<CashFlowPage {...props} />);
  return screen.getByRole("heading", { name: "Horizon 90 jours" }).closest("section")!;
}

describe("Prévision Flux — périmètre de liquidité", () => {
  it("garde les sorties contractuelles mais ne projette pas un solde de départ jamais observé", () => {
    const panel = renderForecast();
    expect(within(panel).getAllByText("Trésorerie de départ inconnue")).toHaveLength(2);
    expect(panel).not.toHaveTextContent(/Départ\s*0/);
    expect(panel).not.toHaveTextContent("trésorerie négative dans");
    expect(within(panel).getByText("Service de dette prévu").closest("div")).not.toHaveTextContent("Non calculable");
  });

  it.each(["observed-zero", "declared-none"] as const)(
    "conserve la projection depuis un zéro connu (%s)",
    (kind) => {
      const panel = renderForecast(kind);
      expect(within(panel).queryByText("Trésorerie de départ inconnue")).toBeNull();
      expect(panel).toHaveTextContent(/Départ\s*0\s*€/);
    },
  );
});
