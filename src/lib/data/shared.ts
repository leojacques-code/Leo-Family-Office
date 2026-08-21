import { calculateNetWorth, roundMoney } from "@/lib/engine/financial";
import type {
  DashboardMetrics,
  ExpenseCategory,
  FinancialAccount,
  IncomeSource,
  Liability,
  Position,
} from "@/lib/types";

export const AS_OF_DATE = "2026-08-19";
export const REPORTING_CURRENCY = "EUR";

/**
 * Dérivation des métriques du cockpit. Déplacée telle quelle depuis local-repository.ts
 * pour être partagée par les deux adapters. Aucune formule modifiée.
 */
export function deriveMetrics(
  accounts: FinancialAccount[],
  liabilities: Liability[],
  incomes: IncomeSource[],
  expenses: ExpenseCategory[],
  positions: Position[],
): DashboardMetrics {
  const { grossAssets, debt, netWorth } = calculateNetWorth(accounts, liabilities);
  const bankCash = roundMoney(accounts.filter((account) => account.type === "BANK" || account.type === "SAVINGS").reduce((sum, account) => sum + account.balance, 0));
  const investedAssets = roundMoney(positions.filter((position) => !position.isCash).reduce((sum, position) => sum + position.value, 0));
  const monthlyIncome = roundMoney(incomes.filter((income) => income.active).reduce((sum, income) => sum + (income.monthlyNet ?? 0), 0));
  const knownExpenses = expenses.filter((expense) => expense.monthlyAmount !== null);
  const monthlyExpenses = roundMoney(knownExpenses.reduce((sum, expense) => sum + (expense.monthlyAmount ?? 0), 0));
  const monthlyDebtService = roundMoney(liabilities.filter((liability) => liability.firstPaymentDate <= "2027-08-19").reduce((sum, liability) => sum + liability.monthlyPayment, 0));
  const freeCashFlow = roundMoney(monthlyIncome - monthlyExpenses - monthlyDebtService);
  const essentialExpenses = roundMoney(expenses.filter((expense) => expense.essential && expense.monthlyAmount !== null).reduce((sum, expense) => sum + (expense.monthlyAmount ?? 0), 0));
  const completeFields = expenses.filter((expense) => expense.monthlyAmount !== null).length;
  return {
    grossAssets, debt, netWorth, bankCash, liquidNetWorth: roundMoney(grossAssets - debt), investedAssets, productiveNetWorth: roundMoney(investedAssets - debt),
    monthlyIncome, monthlyExpenses, monthlyDebtService, freeCashFlow,
    savingsRate: monthlyIncome === 0 ? 0 : freeCashFlow / monthlyIncome,
    investmentRate: monthlyIncome === 0 ? 0 : Math.max(0, freeCashFlow) / monthlyIncome,
    emergencyCoverageMonths: essentialExpenses === 0 ? 0 : bankCash / essentialExpenses,
    dataCompleteness: expenses.length === 0 ? 0 : completeFields / expenses.length,
  };
}

/** Ordres d'affichage, identiques aux ORDER BY du repository SQLite. */
export const ACCOUNT_TYPE_ORDER: Record<string, number> = { BANK: 1, SAVINGS: 2, PEA: 3 };
export const SCENARIO_NAME_ORDER: Record<string, number> = { Prudent: 1, Central: 2, Ambitieux: 3, Stress: 4 };
export const ALERT_SEVERITY_ORDER: Record<string, number> = { HIGH: 1, MEDIUM: 2 };
