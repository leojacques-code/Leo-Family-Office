import { describe, expect, it } from "vitest";
import { deriveMetrics } from "@/lib/data/shared";
import type { ExpenseCategory, FinancialAccount, IncomeSource, Liability, Position, Provenance } from "@/lib/types";

const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH" };

const accounts: FinancialAccount[] = [
  { id: "a", institutionId: "i", institution: "Boursobank", name: "Ultim", type: "BANK", currency: "EUR", balance: 355.48, balanceDate: "2026-08-19", liquidity: "IMMEDIATE", provenance },
  { id: "b", institutionId: "i", institution: "Boursobank", name: "PEA", type: "PEA", currency: "EUR", balance: 15003.13, balanceDate: "2026-08-19", liquidity: "LIQUID", provenance },
];
const liabilities: Liability[] = [
  { id: "l", name: "Prêt étudiant", lender: "Bpifrance", principal: 16745, currentBalance: 16745, annualRate: 0, monthlyPayment: 284.72, paymentCount: 60, firstPaymentDate: "2026-12-05", maturityDate: "2031-11-05", provenance },
];
const incomes: IncomeSource[] = [
  { id: "i1", name: "Revenu net", monthlyNet: 1282, active: true, startDate: "2026-08-19", provenance },
  { id: "i2", name: "Tennis", monthlyNet: 130, active: false, startDate: null, provenance },
];
const expenses: ExpenseCategory[] = [
  { id: "e1", name: "Loyer", groupName: "Logement", monthlyAmount: 1140, essential: true, provenance },
  { id: "e2", name: "Électricité", groupName: "Logement", monthlyAmount: null, essential: true, provenance },
];
const positions: Position[] = [
  { id: "p1", accountId: "b", securityName: "ETF World", assetClass: "Actions monde", value: 8698, currency: "EUR", isCash: false, provenance },
  { id: "p2", accountId: "b", securityName: "Cash PEA", assetClass: "Cash", value: 6304.57, currency: "EUR", isCash: true, provenance },
];

describe("deriveMetrics", () => {
  const metrics = deriveMetrics(accounts, liabilities, incomes, expenses, positions);

  it("additionne les soldes de comptes sans double compter les positions", () => {
    expect(metrics.grossAssets).toBeCloseTo(15358.61, 2);
    expect(metrics.investedAssets).toBeCloseTo(8698, 2);
  });

  it("calcule le patrimoine net et la dette", () => {
    expect(metrics.debt).toBeCloseTo(16745, 2);
    expect(metrics.netWorth).toBeCloseTo(-1386.39, 2);
  });

  it("exclut les revenus inactifs et les dépenses inconnues", () => {
    expect(metrics.monthlyIncome).toBeCloseTo(1282, 2);
    expect(metrics.monthlyExpenses).toBeCloseTo(1140, 2);
  });

  it("compte le service de la dette et le cash flow libre", () => {
    expect(metrics.monthlyDebtService).toBeCloseTo(284.72, 2);
    expect(metrics.freeCashFlow).toBeCloseTo(-142.72, 2);
  });

  it("mesure la complétude des données de budget", () => {
    expect(metrics.dataCompleteness).toBeCloseTo(0.5, 6);
  });

  it("ne divise pas par zéro sans revenu ni dépense essentielle", () => {
    const empty = deriveMetrics([], [], [], [], []);
    expect(empty.savingsRate).toBe(0);
    expect(empty.emergencyCoverageMonths).toBe(0);
    expect(empty.dataCompleteness).toBe(0);
  });
});
