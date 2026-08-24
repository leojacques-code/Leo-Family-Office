import { calculateNetWorth } from "@/lib/engine/financial";
import { addMonths, monthBounds, monthlyDebtServiceAt } from "@/lib/engine/debt";
import { computeObservedCashFlow } from "@/lib/engine/cash-flow";
import { LEDGER_COVERAGE_SOURCES } from "@/lib/types";
import type {
  DashboardMetrics,
  DeferralKind,
  DeferredInterestTreatment,
  EarlyRepayment,
  EarlyRepaymentOutcome,
  LedgerCoverageSource,
  Liability,
  LoanCharge,
  LoanDeferral,
  ProvidedScheduleEntry,
  ExpenseCategory,
  FinancialAccount,
  IncomeSource,
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
/**
 * Normalisation unique de la profondeur d'historique, partagée par les deux adaptateurs.
 *
 * SQLite et Postgres rendent la colonne différemment (`undefined` pour une colonne absente
 * d'une base locale ancienne, `null` pour une valeur non déclarée). Les faire converger ici
 * plutôt que dans chaque repository est ce qui garantit que les deux exposent le même
 * contrat : une divergence de traitement du `null` suffirait à rendre une moyenne
 * calculable d'un côté et pas de l'autre.
 *
 * Une provenance inconnue retombe sur MANUAL plutôt que d'inventer un niveau de confiance.
 */
export function readLedgerCoverage(row: Record<string, unknown> | null | undefined): {
  start: string | null;
  source: LedgerCoverageSource;
} {
  const rawStart = row?.ledger_coverage_start;
  const rawSource = row?.ledger_coverage_source;
  const source = LEDGER_COVERAGE_SOURCES.find((candidate) => candidate === rawSource);
  return {
    start: rawStart === null || rawStart === undefined ? null : String(rawStart),
    source: source ?? "MANUAL",
  };
}

type Row = Record<string, unknown>;

const numberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

const boolOrNull = (value: unknown): boolean | null =>
  value === null || value === undefined ? null : Boolean(value);

/**
 * Normalisation unique des termes optionnels d'un prêt, partagée par les deux adaptateurs.
 *
 * Tout ce qui n'est pas renseigné vaut `null` ou tableau vide, jamais zéro : c'est cette
 * distinction qui permet au moteur de signaler « assurance inconnue » plutôt que de
 * calculer un coût du crédit faussement précis. Centraliser la conversion évite qu'un
 * adaptateur lise `0` là où l'autre lit `null`, ce qui rendrait un même prêt calculable
 * d'un côté et pas de l'autre.
 *
 * Seules les lignes d'échéancier marquées ACTUAL constituent un échéancier bancaire réel.
 * Une reconstruction DERIVED stockée en base reste une reconstruction : lui donner
 * priorité reviendrait à figer nos propres hypothèses en faits.
 */
export function readLoanTerms(
  row: Row,
  related: { schedules?: Row[]; earlyRepayments?: Row[]; charges?: Row[] } = {},
): Pick<
  Liability,
  | "monthlyInsurance"
  | "recurringFees"
  | "paymentIncludesInsurance"
  | "deferral"
  | "earlyRepayments"
  | "oneOffCharges"
  | "providedSchedule"
> {
  const liabilityId = String(row.id);
  const deferralKind = (row.deferral_kind ?? "NONE") as DeferralKind;
  const deferralMonths = Number(row.deferral_months ?? 0);
  const deferral: LoanDeferral | null =
    deferralKind === "NONE" || deferralMonths <= 0
      ? null
      : {
          kind: deferralKind,
          months: deferralMonths,
          interestTreatment: (row.deferral_interest_treatment ??
            "UNKNOWN") as DeferredInterestTreatment,
        };

  const providedSchedule: ProvidedScheduleEntry[] = (related.schedules ?? [])
    .filter((line) => String(line.liability_id) === liabilityId)
    .filter((line) => String(line.data_kind ?? line.kind) === "ACTUAL")
    .map((line) => ({
      paymentNumber: Number(line.payment_number),
      dueDate: String(line.due_date),
      openingBalance: Number(line.opening_balance),
      interest: Number(line.interest),
      principal: Number(line.principal),
      insurance: Number(line.insurance ?? 0),
      fees: Number(line.fees ?? 0),
      closingBalance: Number(line.closing_balance),
    }))
    .sort((a, b) => a.paymentNumber - b.paymentNumber);

  const earlyRepayments: EarlyRepayment[] = (related.earlyRepayments ?? [])
    .filter((line) => String(line.liability_id) === liabilityId)
    .map((line) => ({
      id: String(line.id),
      liabilityId,
      date: String(line.repayment_date),
      amount: Number(line.amount),
      penalty: numberOrNull(line.penalty),
      outcome: (line.outcome ?? "UNKNOWN") as EarlyRepaymentOutcome,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const oneOffCharges: LoanCharge[] = (related.charges ?? [])
    .filter((line) => String(line.liability_id) === liabilityId)
    .map((line) => ({
      id: String(line.id),
      liabilityId,
      date: String(line.charge_date),
      amount: Number(line.amount),
      label: String(line.label),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    monthlyInsurance: numberOrNull(row.monthly_insurance),
    recurringFees: numberOrNull(row.recurring_fees),
    paymentIncludesInsurance: boolOrNull(row.payment_includes_insurance),
    deferral,
    earlyRepayments,
    oneOffCharges,
    providedSchedule,
  };
}

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
