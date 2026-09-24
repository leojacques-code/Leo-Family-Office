import { describe, expect, it } from "vitest";
import {
  compareBudgets,
  compareSurplusToScenario,
  computeObservedCashFlow,
} from "@/lib/engine/cash-flow";
import type { ExpenseCategory, Transaction } from "@/lib/types";

const categories: ExpenseCategory[] = [];
const tx = (id: string, amount: number, currency: string, date = "2026-09-10"): Transaction => ({
  id,
  accountId: "a",
  accountName: "Compte",
  date,
  label: id,
  categoryId: "",
  categoryName: "",
  amount,
  currency,
  kindOverride: amount > 0 ? "INCOME" : "EXPENSE",
  transferGroupId: null,
  propertyId: null,
  notes: null,
  provenance: { kind: "ACTUAL", confidence: "HIGH" },
});

describe("Flux : aucune addition silencieuse de devises (FX ABSENT ≠ FX ÉGAL À 1)", () => {
  const ledger = [tx("salaire", 3000, "EUR"), tx("loyer", -1000, "EUR"), tx("bonus", 2000, "CHF")];

  it("exclut, compte et nomme une opération dans une autre devise que celle de lecture", () => {
    const observed = computeObservedCashFlow(ledger, categories, "2026-09-01", "2026-09-30", {
      reportingCurrency: "EUR",
    });
    expect(observed.income).toBe(3000);
    expect(observed.transactionCount).toBe(2);
    expect(observed.dataQuality.foreignCurrencyTransactionCount).toBe(1);
    expect(observed.dataQuality.currencies).toEqual(["CHF", "EUR"]);
    expect(observed.dataQuality.status).toBe("INCOMPLETE");
    expect(observed.dataQuality.reasons.join(" ")).toContain("autre devise que EUR");
    // Un taux calculé sur des totaux amputés n'est pas un taux.
    expect(observed.observedSavingsRate).toBeNull();
  });

  it("signale un mélange de devises quand la devise de lecture n'est pas fournie", () => {
    const observed = computeObservedCashFlow(ledger, categories, "2026-09-01", "2026-09-30");
    expect(observed.dataQuality.status).toBe("INCOMPLETE");
    expect(observed.dataQuality.reasons.join(" ")).toContain("ne s’additionnent pas");
    expect(observed.observedSavingsRate).toBeNull();
  });

  it("reste complet et calculable quand toutes les opérations sont dans la devise de lecture", () => {
    const observed = computeObservedCashFlow(
      ledger.filter((item) => item.currency === "EUR"),
      categories,
      "2026-09-01",
      "2026-09-30",
      { reportingCurrency: "EUR" },
    );
    expect(observed.dataQuality.foreignCurrencyTransactionCount).toBe(0);
    expect(observed.observedSavingsRate).toBe(0);
    expect(observed.consumerExpenseCount).toBe(1);
  });

  it("ne moyenne pas un surplus mensuel sur des mois amputés d'une devise", () => {
    const history = [
      tx("s7", 3000, "EUR", "2026-07-05"),
      tx("s8", 3000, "EUR", "2026-08-05"),
      tx("b8", 500, "CHF", "2026-08-06"),
      tx("s6", 3000, "EUR", "2026-06-05"),
    ];
    const comparison = compareSurplusToScenario(
      history,
      categories,
      "2026-09-24",
      1000,
      "2026-01-01",
      "EUR",
    );
    expect(comparison.observedT3M).toBeNull();
  });

  it("rend non calculable le réalisé de la seule catégorie touchée par une autre devise", () => {
    const budgetCategories: ExpenseCategory[] = ["food", "rent"].map((id) => ({
      id,
      name: id,
      groupName: "",
      cashFlowKind: "EXPENSE",
      essentiality: "UNKNOWN",
      behavior: "UNKNOWN",
      monthlyAmount: 500,
      essential: false,
      archived: false,
      provenance: { kind: "USER_ASSUMPTION", confidence: "HIGH" },
    }));
    const lines = compareBudgets(
      budgetCategories,
      [
        { ...tx("courses", -80, "EUR"), categoryId: "food", kindOverride: null },
        { ...tx("loyer", -900, "CHF"), categoryId: "rent", kindOverride: null },
      ],
      "2026-09-01",
      "2026-09-30",
      [],
      "EUR",
    );
    expect(lines.find((line) => line.categoryId === "food")?.actual).toBe(80);
    const rent = lines.find((line) => line.categoryId === "rent");
    expect(rent?.actual).toBeNull();
    expect(rent?.variance).toBeNull();
  });
});
