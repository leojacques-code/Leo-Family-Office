import { describe, expect, it } from "vitest";
import { buildMonthFlow, type ObservedFlowInput } from "@/lib/presentation/today/flow";

const base: ObservedFlowInput = {
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  transactionCount: 2,
  income: 3000,
  essentialExpenses: 800,
  debtServicePaid: 0,
  cashFlowAfterDebt: 2200,
  unclassifiedFlows: 0,
  fullyCovered: true,
  foreignCurrencyTransactionCount: 0,
  blocked: {
    income: false,
    essentialExpenses: false,
    debtServicePaid: false,
    cashFlowAfterDebt: false,
  },
};

describe("Aujourd'hui : flux du mois et devises non converties", () => {
  it("rend non calculables les seuls postes touchés, avec une réserve nommée", () => {
    const view = buildMonthFlow({
      ...base,
      foreignCurrencyTransactionCount: 1,
      blocked: {
        income: true,
        essentialExpenses: false,
        debtServicePaid: false,
        cashFlowAfterDebt: true,
      },
    });
    expect(view?.income).toBeNull();
    expect(view?.freeCashFlow).toBeNull();
    expect(view?.essentialExpenses).toBe(800);
    expect(view?.partial).toBe(true);
    expect(view?.reserve).toContain("autre devise");
  });

  it("ne fait pas disparaître un mois dont toutes les opérations sont étrangères", () => {
    const view = buildMonthFlow({
      ...base,
      transactionCount: 0,
      foreignCurrencyTransactionCount: 2,
      blocked: {
        income: true,
        essentialExpenses: true,
        debtServicePaid: false,
        cashFlowAfterDebt: true,
      },
    });
    expect(view).not.toBeNull();
    expect(view?.income).toBeNull();
  });

  it("reste nul (rien d'observé) quand aucune opération n'a été lue", () => {
    expect(buildMonthFlow({ ...base, transactionCount: 0 })).toBeNull();
  });
});
