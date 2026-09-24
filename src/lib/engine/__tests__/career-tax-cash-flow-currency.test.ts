import { describe, expect, it } from "vitest";
import { toCareerTaxCashFlow } from "@/lib/engine/career-tax-cash-flow";
import type { TaxMonthlyConsequence } from "@/lib/engine/tax";
import type { Transaction } from "@/lib/types";

const income = (id: string, amount: number, currency: string): Transaction => ({
  id,
  accountId: "a",
  accountName: "Compte",
  date: "2026-09-25",
  label: id,
  categoryId: "",
  categoryName: "",
  amount,
  currency,
  kindOverride: "INCOME",
  transferGroupId: null,
  propertyId: null,
  notes: null,
  provenance: { kind: "ACTUAL", confidence: "HIGH" },
});
const month = {
  month: "2026-09",
  netCashIncome: 3000,
  flags: [],
} as unknown as TaxMonthlyConsequence;

describe("Career → Tax → Cash Flow : aucune addition de devises", () => {
  it("rend le mois NOT_COMPUTABLE quand un revenu constaté est dans une autre devise", () => {
    const [result] = toCareerTaxCashFlow({
      tax: [month],
      transactions: [income("salaire", 3000, "EUR"), income("prime", 500, "CHF")],
      categories: [],
      reportingCurrency: "EUR",
    });
    expect(result!.cashFlowAmount).toBeNull();
    expect(result!.cashFlowStatus).toBe("NOT_COMPUTABLE");
    expect(result!.flags).toContain("OBSERVED_INCOME_FOREIGN_CURRENCY");
    // Les deux revenus restent retirés de la timeline : ni additionnés, ni recomptés.
    expect(result!.observedTransactionIds.sort()).toEqual(["prime", "salaire"]);
  });

  it("garde l'observé dans la devise de lecture", () => {
    const [result] = toCareerTaxCashFlow({
      tax: [month],
      transactions: [income("salaire", 3000, "EUR")],
      categories: [],
      reportingCurrency: "EUR",
    });
    expect(result!.cashFlowAmount).toBe(3000);
    expect(result!.cashFlowStatus).toBe("ACTUAL");
  });
});
