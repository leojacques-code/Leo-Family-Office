import { addMonths, buildForwardSchedule, daysBetween, monthBounds } from "@/lib/engine/debt";
import type {
  CashFlowKind,
  ExpenseCategory,
  Liability,
  RecurringCashFlowRule,
  Transaction,
} from "@/lib/types";

/**
 * CASH FLOW ENGINE V2
 *
 * Comprend ce qu'un euro entrant ou sortant signifie réellement, plutôt que de lire son
 * signe. Le moteur ne connaît que des natures canoniques (`CashFlowKind`) portées par un
 * champ structurel de la catégorie, jamais par son libellé français.
 *
 * Trois règles fondent tout le reste :
 *
 *   1. Le signe ne détermine jamais la nature. Un remboursement entrant sur une catégorie
 *      de dépense la réduit ; il ne devient pas un revenu.
 *   2. Un transfert entre deux poches du même patrimoine ne crée ni revenu, ni dépense,
 *      ni enrichissement. Il ne fait que déplacer un actif.
 *   3. Le remboursement du principal d'une dette n'est pas une consommation. Le service de
 *      dette est isolé, et le surplus d'exploitation se mesure avant lui.
 *
 * Le moteur ne recalcule jamais un échéancier : il consomme le Debt Engine.
 */

export const INTERNAL_TRANSFER_NOTICE = "Transferts internes exclus des revenus et dépenses.";

/** Nature effective d'une transaction : l'override de la ligne prime sur sa catégorie. */
export function effectiveCashFlowKind(
  transaction: Pick<Transaction, "categoryId" | "kindOverride">,
  categories: Map<string, ExpenseCategory>,
): CashFlowKind {
  if (transaction.kindOverride) return transaction.kindOverride;
  return categories.get(transaction.categoryId)?.cashFlowKind ?? "UNCLASSIFIED";
}

export function categoryIndex(categories: ExpenseCategory[]): Map<string, ExpenseCategory> {
  return new Map(categories.map((category) => [category.id, category]));
}

export interface ExpenseBreakdown {
  essential: number;
  nonEssential: number;
  unknownEssentiality: number;
  fixed: number;
  variable: number;
  discretionary: number;
  unknownBehavior: number;
}

export type DataQualityStatus = "COMPLETE" | "PARTIAL" | "INCOMPLETE";

export interface DataQuality {
  status: DataQualityStatus;
  reasons: string[];
  unclassifiedTransactionCount: number;
  unmatchedTransferCount: number;
}

export interface ObservedCashFlow {
  periodStart: string;
  periodEnd: string;
  transactionCount: number;

  income: number;
  consumerExpenses: number;
  essentialExpenses: number;
  fixedExpenses: number;
  variableExpenses: number;
  discretionaryExpenses: number;
  taxesPaid: number;
  debtServicePaid: number;
  investmentFlows: number;
  savingFlows: number;
  /** Net des transferts internes : nul dès que les deux jambes sont connues. */
  internalTransfers: number;
  /** Volume déplacé, jambes sortantes seulement. Sert au contrôle, pas aux agrégats. */
  internalTransferVolume: number;
  refunds: number;
  otherInflows: number;
  otherOutflows: number;
  unclassifiedFlows: number;

  /** Revenus − dépenses de consommation − impôts. AVANT tout service de dette. */
  operatingCashFlowBeforeDebt: number;
  cashFlowAfterDebt: number;
  observedSavings: number;
  observedSavingsRate: number | null;
  observedInvestmentRate: number | null;

  breakdown: ExpenseBreakdown;
  dataQuality: DataQuality;
}

function emptyBreakdown(): ExpenseBreakdown {
  return {
    essential: 0,
    nonEssential: 0,
    unknownEssentiality: 0,
    fixed: 0,
    variable: 0,
    discretionary: 0,
    unknownBehavior: 0,
  };
}

/**
 * Agrégats observés d'une période. Toutes les grandeurs de sortie sont exprimées en
 * valeur positive lorsqu'il s'agit de sorties, sauf `income` et les entrées, qui restent
 * signées pour qu'une régularisation négative les réduise réellement.
 */
export function computeObservedCashFlow(
  transactions: Transaction[],
  categories: ExpenseCategory[],
  periodStart: string,
  periodEnd: string,
): ObservedCashFlow {
  const index = categoryIndex(categories);
  const breakdown = emptyBreakdown();
  const inPeriod = transactions.filter(
    (transaction) => transaction.date >= periodStart && transaction.date <= periodEnd,
  );

  let income = 0;
  let consumerExpenses = 0;
  let taxesPaid = 0;
  let debtServicePaid = 0;
  let investmentFlows = 0;
  let savingFlows = 0;
  let internalTransfers = 0;
  let internalTransferVolume = 0;
  let refunds = 0;
  let otherInflows = 0;
  let otherOutflows = 0;
  let unclassifiedFlows = 0;
  let unclassifiedTransactionCount = 0;
  const transferGroups = new Map<string, number>();
  let unmatchedTransferCount = 0;

  for (const transaction of inPeriod) {
    const kind = effectiveCashFlowKind(transaction, index);
    const outflow = -transaction.amount;
    switch (kind) {
      case "INCOME":
        income += transaction.amount;
        break;
      case "EXPENSE": {
        consumerExpenses += outflow;
        const category = index.get(transaction.categoryId);
        const essentiality = category?.essentiality ?? "UNKNOWN";
        const behavior = category?.behavior ?? "UNKNOWN";
        if (essentiality === "ESSENTIAL") breakdown.essential += outflow;
        else if (essentiality === "NON_ESSENTIAL") breakdown.nonEssential += outflow;
        else breakdown.unknownEssentiality += outflow;
        if (behavior === "FIXED") breakdown.fixed += outflow;
        else if (behavior === "VARIABLE") breakdown.variable += outflow;
        else if (behavior === "DISCRETIONARY") breakdown.discretionary += outflow;
        else breakdown.unknownBehavior += outflow;
        break;
      }
      case "TAX":
        taxesPaid += outflow;
        break;
      case "DEBT_SERVICE":
        debtServicePaid += outflow;
        break;
      case "INVESTMENT":
        investmentFlows += outflow;
        break;
      case "SAVING":
        savingFlows += outflow;
        break;
      case "INTERNAL_TRANSFER":
        internalTransfers += outflow;
        internalTransferVolume += Math.max(0, outflow);
        if (transaction.transferGroupId) {
          transferGroups.set(
            transaction.transferGroupId,
            (transferGroups.get(transaction.transferGroupId) ?? 0) + transaction.amount,
          );
        } else {
          unmatchedTransferCount += 1;
        }
        break;
      case "REFUND":
        refunds += transaction.amount;
        break;
      case "OTHER_INFLOW":
        otherInflows += transaction.amount;
        break;
      case "OTHER_OUTFLOW":
        otherOutflows += outflow;
        break;
      default:
        unclassifiedFlows += Math.abs(transaction.amount);
        unclassifiedTransactionCount += 1;
    }
  }

  for (const [, net] of transferGroups) {
    // Un groupe dont les deux jambes ne s'annulent pas est un rapprochement incomplet.
    if (Math.abs(net) > 0.01) unmatchedTransferCount += 1;
  }

  // Le service de dette est délibérément hors du surplus d'exploitation : le modèle
  // mensuel le retranche ensuite explicitement.
  const operatingCashFlowBeforeDebt = income - consumerExpenses - taxesPaid;
  const cashFlowAfterDebt = operatingCashFlowBeforeDebt - debtServicePaid;
  const observedSavings = savingFlows + investmentFlows;

  const reasons: string[] = [];
  if (unclassifiedTransactionCount > 0) {
    reasons.push(`${unclassifiedTransactionCount} transaction(s) non classifiée(s)`);
  }
  if (unmatchedTransferCount > 0) {
    reasons.push(`${unmatchedTransferCount} transfert(s) interne(s) non rapproché(s)`);
  }
  if (income <= 0) reasons.push("aucun revenu encaissé observé sur la période");
  if (inPeriod.length === 0) reasons.push("aucune transaction sur la période");
  const status: DataQualityStatus =
    inPeriod.length === 0 || income <= 0
      ? "INCOMPLETE"
      : reasons.length > 0
        ? "PARTIAL"
        : "COMPLETE";

  return {
    periodStart,
    periodEnd,
    transactionCount: inPeriod.length,
    income,
    consumerExpenses,
    essentialExpenses: breakdown.essential,
    fixedExpenses: breakdown.fixed,
    variableExpenses: breakdown.variable,
    discretionaryExpenses: breakdown.discretionary,
    taxesPaid,
    debtServicePaid,
    investmentFlows,
    savingFlows,
    internalTransfers,
    internalTransferVolume,
    refunds,
    otherInflows,
    otherOutflows,
    unclassifiedFlows,
    operatingCashFlowBeforeDebt,
    cashFlowAfterDebt,
    observedSavings,
    // Sans revenu encaissé observé, aucun taux n'est calculable. Aucun proxy.
    observedSavingsRate: income > 0 ? observedSavings / income : null,
    observedInvestmentRate: income > 0 ? investmentFlows / income : null,
    breakdown,
    dataQuality: { status, reasons, unclassifiedTransactionCount, unmatchedTransferCount },
  };
}

/** Mois civil contenant `asOfDate`. */
export function monthPeriod(asOfDate: string) {
  return monthBounds(asOfDate);
}

/** Fenêtre glissante de `months` mois se terminant à la fin du mois de `asOfDate`. */
export function trailingPeriod(asOfDate: string, months: number) {
  return {
    start: monthBounds(addMonths(asOfDate, -(months - 1))).start,
    end: monthBounds(asOfDate).end,
  };
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/* ------------------------------------------------------------------ *
 * Récurrence et prévision
 * ------------------------------------------------------------------ */

const MONTHS_PER_OCCURRENCE: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

function clampDayOfMonth(iso: string, dayOfMonth: number | null): string {
  if (dayOfMonth === null) return iso;
  const [year, month] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Math.max(1, dayOfMonth), lastDay);
  return `${iso.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

export interface ForecastOccurrence {
  date: string;
  label: string;
  cashFlowKind: CashFlowKind;
  /** Montant signé : négatif pour une sortie. */
  amount: number;
  source: "RECURRING_RULE" | "DEBT_SCHEDULE";
  sourceId: string;
}

/** Occurrences d'une règle récurrente strictement après `from` et jusqu'à `to`. */
export function expandRecurringRule(
  rule: RecurringCashFlowRule,
  from: string,
  to: string,
): ForecastOccurrence[] {
  if (!rule.active) return [];
  const step = MONTHS_PER_OCCURRENCE[rule.frequency];
  if (!step) return [];
  const occurrences: ForecastOccurrence[] = [];
  // Borne dure : au-delà d'un horizon de dix ans mensuels, la règle est ignorée plutôt
  // que de faire boucler la prévision.
  for (let index = 0; index < 120; index += 1) {
    const anchor = addMonths(rule.startDate, index * step);
    const date = clampDayOfMonth(anchor, rule.dayOfMonth);
    if (date > to) break;
    if (rule.endDate && date > rule.endDate) break;
    if (date <= from) continue;
    occurrences.push({
      date,
      label: rule.name,
      cashFlowKind: rule.cashFlowKind,
      amount: rule.amount,
      source: "RECURRING_RULE",
      sourceId: rule.id,
    });
  }
  return occurrences;
}

export interface ForecastInput {
  asOfDate: string;
  horizonDays: number;
  openingCash: number;
  rules: RecurringCashFlowRule[];
  liabilities: Liability[];
}

export interface ForecastResult {
  asOfDate: string;
  horizonDays: number;
  horizonEnd: string;
  openingCash: number;
  forecastIncome: number;
  forecastConsumerExpenses: number;
  forecastTaxes: number;
  forecastDebtService: number;
  forecastInvestmentFlows: number;
  forecastOtherFlows: number;
  forecastNetCashFlow: number;
  forecastEndingCash: number;
  minimumProjectedCash: number;
  minimumProjectedCashDate: string;
  occurrences: ForecastOccurrence[];
}

function addDays(iso: string, days: number): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Prévision de trésorerie sur un horizon donné.
 *
 * Seuls entrent les flux explicitement connus : règles récurrentes déclarées et échéances
 * de dette issues du Debt Engine. Aucune dépense variable n'est extrapolée, aucun revenu
 * de carrière n'est supposé, aucune inflation n'est appliquée. Ce qui n'est pas déclaré
 * n'apparaît pas.
 */
export function forecastCashFlow(input: ForecastInput): ForecastResult {
  const horizonEnd = addDays(input.asOfDate, input.horizonDays);
  const fromRules = input.rules.flatMap((rule) =>
    expandRecurringRule(rule, input.asOfDate, horizonEnd),
  );
  // Le Debt Engine reste la source de vérité des échéances : aucun second amortissement.
  const fromDebt: ForecastOccurrence[] = input.liabilities.flatMap((liability) =>
    buildForwardSchedule(liability, input.asOfDate)
      .entries.filter((entry) => entry.dueDate <= horizonEnd)
      .map((entry) => ({
        date: entry.dueDate,
        label: `${liability.name} · échéance ${entry.paymentNumber}`,
        cashFlowKind: "DEBT_SERVICE" as CashFlowKind,
        amount: -entry.totalCashOut,
        source: "DEBT_SCHEDULE" as const,
        sourceId: liability.id,
      })),
  );
  const occurrences = [...fromRules, ...fromDebt].sort((a, b) => a.date.localeCompare(b.date));

  let forecastIncome = 0;
  let forecastConsumerExpenses = 0;
  let forecastTaxes = 0;
  let forecastDebtService = 0;
  let forecastInvestmentFlows = 0;
  let forecastOtherFlows = 0;
  let running = input.openingCash;
  let minimumProjectedCash = input.openingCash;
  let minimumProjectedCashDate = input.asOfDate;

  for (const occurrence of occurrences) {
    switch (occurrence.cashFlowKind) {
      case "INCOME":
        forecastIncome += occurrence.amount;
        break;
      case "EXPENSE":
        forecastConsumerExpenses += -occurrence.amount;
        break;
      case "TAX":
        forecastTaxes += -occurrence.amount;
        break;
      case "DEBT_SERVICE":
        forecastDebtService += -occurrence.amount;
        break;
      case "INVESTMENT":
      case "SAVING":
        forecastInvestmentFlows += -occurrence.amount;
        break;
      case "INTERNAL_TRANSFER":
        // Neutre économiquement, mais la jambe sortante déplace bien la trésorerie.
        break;
      default:
        forecastOtherFlows += occurrence.amount;
    }
    running += occurrence.amount;
    if (running < minimumProjectedCash) {
      minimumProjectedCash = running;
      minimumProjectedCashDate = occurrence.date;
    }
  }

  return {
    asOfDate: input.asOfDate,
    horizonDays: input.horizonDays,
    horizonEnd,
    openingCash: input.openingCash,
    forecastIncome,
    forecastConsumerExpenses,
    forecastTaxes,
    forecastDebtService,
    forecastInvestmentFlows,
    forecastOtherFlows,
    forecastNetCashFlow: running - input.openingCash,
    forecastEndingCash: running,
    minimumProjectedCash,
    minimumProjectedCashDate,
    occurrences,
  };
}

/** Nombre de jours avant que la trésorerie projetée ne devienne négative, si elle le devient. */
export function cashRunwayDays(forecast: ForecastResult): number | null {
  let running = forecast.openingCash;
  for (const occurrence of forecast.occurrences) {
    running += occurrence.amount;
    if (running < 0) return daysBetween(forecast.asOfDate, occurrence.date);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Budgets
 * ------------------------------------------------------------------ */

export interface BudgetLine {
  categoryId: string;
  categoryName: string;
  groupName: string;
  budget: number | null;
  actual: number;
  forecast: number;
  variance: number | null;
  variancePercentage: number | null;
  overBudget: boolean;
}

/**
 * Budget, réalisé et prévision restent trois grandeurs distinctes, jamais mélangées.
 * L'écart est positif quand le réalisé dépasse le budget.
 */
export function compareBudgets(
  categories: ExpenseCategory[],
  transactions: Transaction[],
  periodStart: string,
  periodEnd: string,
  forecastOccurrences: ForecastOccurrence[] = [],
): BudgetLine[] {
  const index = categoryIndex(categories);
  const actualByCategory = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.date < periodStart || transaction.date > periodEnd) continue;
    if (effectiveCashFlowKind(transaction, index) !== "EXPENSE") continue;
    actualByCategory.set(
      transaction.categoryId,
      (actualByCategory.get(transaction.categoryId) ?? 0) + -transaction.amount,
    );
  }
  const forecastByCategory = new Map<string, number>();
  for (const occurrence of forecastOccurrences) {
    if (occurrence.cashFlowKind !== "EXPENSE") continue;
    const rule = occurrence.sourceId;
    forecastByCategory.set(rule, (forecastByCategory.get(rule) ?? 0) + -occurrence.amount);
  }

  return categories
    .filter((category) => !category.archived && category.cashFlowKind === "EXPENSE")
    .map((category) => {
      const actual = actualByCategory.get(category.id) ?? 0;
      const budget = category.monthlyAmount;
      const variance = budget === null ? null : actual - budget;
      return {
        categoryId: category.id,
        categoryName: category.name,
        groupName: category.groupName,
        budget,
        actual,
        forecast: forecastByCategory.get(category.id) ?? 0,
        variance,
        variancePercentage: budget === null || budget === 0 ? null : (actual - budget) / budget,
        overBudget: variance !== null && variance > 0,
      };
    });
}

/* ------------------------------------------------------------------ *
 * Comparaison au scénario
 * ------------------------------------------------------------------ */

export interface SurplusComparison {
  scenarioAssumption: number;
  observedMonth: number;
  observedT3M: number;
  observedT12M: number;
  differenceT3M: number;
  differenceT12M: number;
  monthQuality: DataQualityStatus;
}

/**
 * Confronte l'hypothèse de surplus du scénario au surplus réellement observé.
 *
 * Aucune correction automatique : `scenario.monthlySavings` reste une MODEL_ASSUMPTION.
 * Le remplacement par la valeur observée relève d'une décision produit ultérieure, une
 * fois le Forecast Engine validé.
 */
export function compareSurplusToScenario(
  transactions: Transaction[],
  categories: ExpenseCategory[],
  asOfDate: string,
  scenarioAssumption: number,
): SurplusComparison {
  const month = monthPeriod(asOfDate);
  const monthly = computeObservedCashFlow(transactions, categories, month.start, month.end);
  const t3 = trailingPeriod(asOfDate, 3);
  const t12 = trailingPeriod(asOfDate, 12);
  const observedT3M =
    computeObservedCashFlow(transactions, categories, t3.start, t3.end)
      .operatingCashFlowBeforeDebt / 3;
  const observedT12M =
    computeObservedCashFlow(transactions, categories, t12.start, t12.end)
      .operatingCashFlowBeforeDebt / 12;
  return {
    scenarioAssumption,
    observedMonth: monthly.operatingCashFlowBeforeDebt,
    observedT3M,
    observedT12M,
    differenceT3M: observedT3M - scenarioAssumption,
    differenceT12M: observedT12M - scenarioAssumption,
    monthQuality: monthly.dataQuality.status,
  };
}
