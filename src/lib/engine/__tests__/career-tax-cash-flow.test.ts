import { describe, expect, it } from "vitest";
import {
  toCareerTaxCashFlow,
  careerTaxOperatingSurplus,
  compareCareerTrajectories,
} from "@/lib/engine/career-tax-cash-flow";
import type { TaxMonthlyConsequence } from "@/lib/engine/tax";
import type { ExpenseCategory, Transaction } from "@/lib/types";

const provenance = {
  kind: "ACTUAL" as const,
  confidence: "HIGH" as const,
  source: "Synthetic bank",
};
const category: ExpenseCategory = {
  id: "income",
  name: "Salary",
  groupName: "Income",
  cashFlowKind: "INCOME",
  essentiality: "UNKNOWN",
  behavior: "UNKNOWN",
  monthlyAmount: null,
  essential: false,
  archived: false,
  provenance,
};
const taxMonth = (patch: Partial<TaxMonthlyConsequence> = {}): TaxMonthlyConsequence => ({
  month: "2026-03",
  grossIncome: 5_000,
  payrollContributions: 1_000,
  taxableIncome: 4_000,
  taxLiability: 600,
  taxCashPaid: 400,
  taxRefund: 0,
  netCashIncome: 3_600,
  status: "AFTER_TAX_ESTIMATED",
  blockers: [],
  flags: [],
  provenance: { dataKind: "DECLARED_TAX_RULE", source: ["Synthetic"], confidence: "HIGH" },
  methodology: [],
  assumptions: [],
  ...patch,
});
const transaction = (patch: Partial<Transaction> = {}): Transaction => ({
  id: "tx",
  accountId: "a",
  accountName: "Bank",
  date: "2026-03-31",
  label: "Salary",
  categoryId: "income",
  categoryName: "Salary",
  amount: 3_550,
  currency: "EUR",
  kindOverride: null,
  transferGroupId: null,
  propertyId: null,
  notes: null,
  provenance,
  ...patch,
});

describe("Career → Tax → Cash Flow — 10 cross-domain golden cases", () => {
  it("1. forecast reçoit uniquement le net cash", () =>
    expect(
      toCareerTaxCashFlow({ tax: [taxMonth()], transactions: [], categories: [category] })[0]
        .cashFlowAmount,
    ).toBe(3_600));
  it("2. gross ne rentre jamais directement dans Cash Flow", () =>
    expect(
      toCareerTaxCashFlow({ tax: [taxMonth()], transactions: [], categories: [category] })[0]
        .cashFlowAmount,
    ).not.toBe(5_000));
  it("3. bonus payé en mars reste dans mars", () =>
    expect(
      toCareerTaxCashFlow({
        tax: [taxMonth({ grossIncome: 10_000, netCashIncome: 7_200 })],
        transactions: [],
        categories: [category],
      })[0].month,
    ).toBe("2026-03"));
  it("4. ACTUAL transaction remplace le forecast", () =>
    expect(
      toCareerTaxCashFlow({
        tax: [taxMonth()],
        transactions: [transaction()],
        categories: [category],
      })[0].cashFlowAmount,
    ).toBe(3_550));
  it("5. override évite le double comptage", () =>
    expect(
      toCareerTaxCashFlow({
        tax: [taxMonth()],
        transactions: [transaction()],
        categories: [category],
      })[0].observedTransactionIds,
    ).toEqual(["tx"]));
  it("6. transaction non ACTUAL ne remplace pas le forecast", () =>
    expect(
      toCareerTaxCashFlow({
        tax: [taxMonth()],
        transactions: [transaction({ provenance: { kind: "USER_ASSUMPTION", confidence: "LOW" } })],
        categories: [category],
      })[0].cashFlowAmount,
    ).toBe(3_600));
  it("7. transaction TAX ne remplace pas le salaire", () =>
    expect(
      toCareerTaxCashFlow({
        tax: [taxMonth()],
        transactions: [transaction({ kindOverride: "TAX", amount: -400 })],
        categories: [category],
      })[0].cashFlowAmount,
    ).toBe(3_600));
  it("8. liability reste distincte du cash tax", () => {
    const result = toCareerTaxCashFlow({
      tax: [taxMonth()],
      transactions: [],
      categories: [category],
    })[0];
    expect(result.taxLiability).toBe(600);
    expect(result.taxCashPaid).toBe(400);
  });
  it("9. conséquence inconnue reste NOT_COMPUTABLE", () =>
    expect(
      toCareerTaxCashFlow({
        tax: [
          taxMonth({
            netCashIncome: null,
            blockers: ["TAX_RULES_MISSING"],
            status: "NOT_COMPUTABLE",
          }),
        ],
        transactions: [],
        categories: [category],
      })[0].cashFlowStatus,
    ).toBe("NOT_COMPUTABLE"));
  it("10. Monthly Model ne reçoit un surplus que si dépenses connues", () => {
    const consequence = toCareerTaxCashFlow({
      tax: [taxMonth()],
      transactions: [],
      categories: [category],
    })[0];
    expect(careerTaxOperatingSurplus(consequence, null)).toBeNull();
    expect(careerTaxOperatingSurplus(consequence, 2_000)).toBe(1_600);
  });
  it("11. stay vs new job compare cash et capacité d'épargne sans projeter le patrimoine", () => {
    const stay = toCareerTaxCashFlow({
      tax: [taxMonth()],
      transactions: [],
      categories: [category],
    });
    const offer = toCareerTaxCashFlow({
      tax: [
        taxMonth({
          grossIncome: 6_000,
          payrollContributions: 1_200,
          taxCashPaid: 500,
          netCashIncome: 4_300,
        }),
      ],
      transactions: [],
      categories: [category],
    });
    const result = compareCareerTrajectories({
      baseline: stay,
      alternative: offer,
      monthlyConsumerExpenses: 2_000,
    });
    expect(result.cumulativeCashImpact).toBe(700);
    expect(result.alternative.annualSavingsCapacity).toBe(2_300);
    expect("netWorth" in result).toBe(false);
  });
});
