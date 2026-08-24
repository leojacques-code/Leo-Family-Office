import { calculateNetWorth } from "@/lib/engine/financial";
import { addMonths, monthBounds, monthlyDebtServiceAt } from "@/lib/engine/debt";
import { computeObservedCashFlow } from "@/lib/engine/cash-flow";
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

/**
 * Fenêtre de ledger réellement consommée par le produit : les six mois de l'historique
 * Cash Flow, dont le mois courant qui porte les taux de flux constatés. Les repositories
 * chargent cette fenêtre en entier plutôt qu'un nombre fixe de lignes : une limite
 * arbitraire fausserait silencieusement le graphique et les taux dès que le ledger la
 * dépasse.
 */
export const LEDGER_WINDOW_MONTHS = 6;

export function ledgerWindowStart(asOfDate: string = AS_OF_DATE): string {
  return monthBounds(addMonths(asOfDate, -(LEDGER_WINDOW_MONTHS - 1))).start;
}

/**
 * Un snapshot de solde daté est la vérité du compte à cette date : il incorpore déjà les
 * mouvements antérieurs. Une transaction plus ancienne enrichit donc le ledger sans
 * toucher au solde observé, faute de quoi elle serait comptée deux fois. Prédicat partagé
 * par les deux adapters et par le formulaire, pour que la règle soit unique.
 */
export function shouldDeriveBalance(transactionDate: string, latestBalanceDate: string): boolean {
  return transactionDate > latestBalanceDate;
}

/**
 * Taux d'épargne et taux d'investissement constatés, lus dans le ledger sur la période.
 *
 * Ce ne sont pas des proxys du free cash flow : le FCF est une capacité, l'épargne est un
 * fait. La classification passe par le Cash Flow Engine, donc par la nature canonique de
 * chaque flux et jamais par le signe du montant ni le libellé de la catégorie. Sans revenu
 * encaissé observé, les deux grandeurs sont NOT_COMPUTABLE.
 */
export function computeFlowRates(
  transactions: Transaction[],
  expenses: ExpenseCategory[],
  periodStart: string,
  periodEnd: string,
): { savingsRate: number | null; investmentRate: number | null } {
  const observed = computeObservedCashFlow(transactions, expenses, periodStart, periodEnd);
  return {
    savingsRate: observed.observedSavingsRate,
    investmentRate: observed.observedInvestmentRate,
  };
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
  const bankCash = accounts
    .filter((account) => account.type === "BANK" || account.type === "SAVINGS")
    .reduce((sum, account) => sum + account.balance, 0);
  // La liquidité est portée par le champ `liquidity`, jamais déduite du type de compte.
  const liquidAssets = accounts
    .filter((account) => account.liquidity !== "ILLIQUID")
    .reduce((sum, account) => sum + account.balance, 0);
  const investedAssets = positions
    .filter((position) => !position.isCash)
    .reduce((sum, position) => sum + position.value, 0);
  const monthlyIncome = incomes
    .filter((income) => income.active)
    .reduce((sum, income) => sum + (income.monthlyNet ?? 0), 0);
  const knownExpenses = expenses.filter((expense) => expense.monthlyAmount !== null);
  const monthlyExpenses = knownExpenses.reduce(
    (sum, expense) => sum + (expense.monthlyAmount ?? 0),
    0,
  );
  const monthlyDebtService = monthlyDebtServiceAt(liabilities, asOfDate);
  const freeCashFlow = monthlyIncome - monthlyExpenses - monthlyDebtService;
  const essentialExpenses = expenses
    .filter((expense) => expense.essential && expense.monthlyAmount !== null)
    .reduce((sum, expense) => sum + (expense.monthlyAmount ?? 0), 0);
  // Le service de dette est incompressible : la réserve doit le couvrir au même titre
  // que le loyer. À une date sans échéance exigible, le dénominateur est inchangé.
  const incompressibleExpenses = essentialExpenses + monthlyDebtService;
  const completeFields = expenses.filter((expense) => expense.monthlyAmount !== null).length;
  const period = monthBounds(asOfDate);
  const { savingsRate, investmentRate } = computeFlowRates(
    transactions,
    expenses,
    period.start,
    period.end,
  );
  return {
    grossAssets,
    debt,
    netWorth,
    bankCash,
    liquidAssets,
    liquidNetWorth: liquidAssets - debt,
    investedAssets,
    productiveNetWorth: investedAssets - debt,
    monthlyIncome,
    monthlyExpenses,
    monthlyDebtService,
    freeCashFlow,
    savingsRate,
    investmentRate,
    emergencyCoverageMonths: incompressibleExpenses === 0 ? 0 : bankCash / incompressibleExpenses,
    dataCompleteness: expenses.length === 0 ? 0 : completeFields / expenses.length,
  };
}

/** Ordres d'affichage, identiques aux ORDER BY du repository SQLite. */
export const ACCOUNT_TYPE_ORDER: Record<string, number> = { BANK: 1, SAVINGS: 2, PEA: 3 };
export const SCENARIO_NAME_ORDER: Record<string, number> = {
  Prudent: 1,
  Central: 2,
  Ambitieux: 3,
  Stress: 4,
};
export const ALERT_SEVERITY_ORDER: Record<string, number> = { HIGH: 1, MEDIUM: 2 };
