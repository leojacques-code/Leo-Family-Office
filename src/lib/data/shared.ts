import { calculateNetWorth } from "@/lib/engine/financial";
import { monthBounds, monthlyDebtServiceAt } from "@/lib/engine/debt";
import type {
  DashboardMetrics,
  ExpenseCategory,
  FinancialAccount,
  IncomeSource,
  Liability,
  Position,
  Transaction,
} from "@/lib/types";

export const AS_OF_DATE = "2026-08-19";
export const REPORTING_CURRENCY = "EUR";

/** Groupes de catégories utilisés pour lire l'épargne et l'investissement dans le ledger. */
const SAVINGS_GROUP = "Épargne";
const INCOME_GROUP = "Revenus";
const INVESTMENT_CATEGORY = "Investissement";

/**
 * Taux d'épargne et taux d'investissement constatés, lus dans le ledger de flux sur la
 * période. Ce ne sont pas des proxys du free cash flow : le FCF est une capacité,
 * l'épargne est un fait. Sans revenu encaissé observé sur la période, les deux
 * grandeurs sont NOT_COMPUTABLE et valent `null`.
 */
export function computeFlowRates(
  transactions: Transaction[],
  expenses: ExpenseCategory[],
  periodStart: string,
  periodEnd: string,
): { savingsRate: number | null; investmentRate: number | null } {
  const groupOf = new Map(expenses.map((expense) => [expense.id, expense.groupName]));
  const nameOf = new Map(expenses.map((expense) => [expense.id, expense.name]));
  const inPeriod = transactions.filter((transaction) => transaction.date >= periodStart && transaction.date <= periodEnd);
  const incomeObserved = inPeriod
    .filter((transaction) => groupOf.get(transaction.categoryId) === INCOME_GROUP && transaction.amount > 0)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  if (incomeObserved <= 0) return { savingsRate: null, investmentRate: null };
  const saved = inPeriod
    .filter((transaction) => groupOf.get(transaction.categoryId) === SAVINGS_GROUP)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const invested = inPeriod
    .filter((transaction) => nameOf.get(transaction.categoryId) === INVESTMENT_CATEGORY)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  return { savingsRate: saved / incomeObserved, investmentRate: invested / incomeObserved };
}

/**
 * Dérivation des métriques du cockpit.
 *
 * Les grandeurs datées (service de dette, flux constatés) sont calculées sur le mois
 * civil contenant `asOfDate` : aucune borne de date littérale n'intervient plus.
 */
export function deriveMetrics(
  accounts: FinancialAccount[],
  liabilities: Liability[],
  incomes: IncomeSource[],
  expenses: ExpenseCategory[],
  positions: Position[],
  transactions: Transaction[] = [],
  asOfDate: string = AS_OF_DATE,
): DashboardMetrics {
  const { grossAssets, debt, netWorth } = calculateNetWorth(accounts, liabilities);
  const bankCash = accounts.filter((account) => account.type === "BANK" || account.type === "SAVINGS").reduce((sum, account) => sum + account.balance, 0);
  // La liquidité est portée par le champ `liquidity`, jamais déduite du type de compte.
  const liquidAssets = accounts.filter((account) => account.liquidity !== "ILLIQUID").reduce((sum, account) => sum + account.balance, 0);
  const investedAssets = positions.filter((position) => !position.isCash).reduce((sum, position) => sum + position.value, 0);
  const monthlyIncome = incomes.filter((income) => income.active).reduce((sum, income) => sum + (income.monthlyNet ?? 0), 0);
  const knownExpenses = expenses.filter((expense) => expense.monthlyAmount !== null);
  const monthlyExpenses = knownExpenses.reduce((sum, expense) => sum + (expense.monthlyAmount ?? 0), 0);
  const monthlyDebtService = monthlyDebtServiceAt(liabilities, asOfDate);
  const freeCashFlow = monthlyIncome - monthlyExpenses - monthlyDebtService;
  const essentialExpenses = expenses.filter((expense) => expense.essential && expense.monthlyAmount !== null).reduce((sum, expense) => sum + (expense.monthlyAmount ?? 0), 0);
  const completeFields = expenses.filter((expense) => expense.monthlyAmount !== null).length;
  const period = monthBounds(asOfDate);
  const { savingsRate, investmentRate } = computeFlowRates(transactions, expenses, period.start, period.end);
  return {
    grossAssets, debt, netWorth, bankCash, liquidAssets, liquidNetWorth: liquidAssets - debt, investedAssets, productiveNetWorth: investedAssets - debt,
    monthlyIncome, monthlyExpenses, monthlyDebtService, freeCashFlow,
    savingsRate,
    investmentRate,
    emergencyCoverageMonths: essentialExpenses === 0 ? 0 : bankCash / essentialExpenses,
    dataCompleteness: expenses.length === 0 ? 0 : completeFields / expenses.length,
  };
}

/** Ordres d'affichage, identiques aux ORDER BY du repository SQLite. */
export const ACCOUNT_TYPE_ORDER: Record<string, number> = { BANK: 1, SAVINGS: 2, PEA: 3 };
export const SCENARIO_NAME_ORDER: Record<string, number> = { Prudent: 1, Central: 2, Ambitieux: 3, Stress: 4 };
export const ALERT_SEVERITY_ORDER: Record<string, number> = { HIGH: 1, MEDIUM: 2 };
