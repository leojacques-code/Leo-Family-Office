import { addMonths, monthBounds, monthlyDebtServiceAt } from "@/lib/engine/debt";
import type { CanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import type { CanonicalBalanceSheetMetrics } from "@/lib/engine/balance-sheet-metrics";
import { computeObservedCashFlow } from "@/lib/engine/cash-flow";
import { LEDGER_COVERAGE_SOURCES } from "@/lib/types";
import {
  enumValue,
  finiteNumber,
  nullableBoolean,
  nullableFiniteNumber,
  nullableString,
  requiredField,
  requiredString,
} from "@/lib/data/row-validation";
import type {
  DashboardMetrics,
  DeclaredFlowMetrics,
  DeferralKind,
  DeferredInterestTreatment,
  EarlyRepayment,
  AmortisationProfile,
  DatedTermKind,
  EarlyRepaymentOutcome,
  InterestConvention,
  LedgerCoverageSource,
  Liability,
  LoanCharge,
  LoanDeferral,
  PaymentChange,
  PaymentFrequency,
  ProvidedScheduleEntry,
  RateChange,
  RateType,
  ExpenseCategory,
  IncomeSource,
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
 * Une colonne absente indique une chaîne de migrations incomplète et doit être signalée :
 * Supabase est l'unique schéma supporté. `null` reste en revanche la valeur métier normale
 * pour une profondeur non déclarée.
 */
export function readLedgerCoverage(row: Record<string, unknown> | null | undefined): {
  start: string | null;
  source: LedgerCoverageSource;
} {
  if (!row) throw new Error("Supabase donnée invalide (profiles) : profil propriétaire absent");
  const rawStart = requiredField(row, "ledger_coverage_start", "profiles.ledger_coverage_start");
  const rawSource = requiredField(row, "ledger_coverage_source", "profiles.ledger_coverage_source");
  return {
    start: rawStart === null ? null : requiredString(rawStart, "profiles.ledger_coverage_start"),
    source: enumValue(rawSource, LEDGER_COVERAGE_SOURCES, "profiles.ledger_coverage_source"),
  };
}

type Row = Record<string, unknown>;

const DEFERRAL_KINDS = ["NONE", "PRINCIPAL_ONLY", "TOTAL"] as const;
const DEFERRED_INTEREST_TREATMENTS = ["PAID", "CAPITALISED", "UNKNOWN"] as const;
const AMORTISATION_PROFILES = ["AMORTIZING", "INTEREST_ONLY", "BULLET", "BALLOON"] as const;
const PAYMENT_FREQUENCIES = ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"] as const;
const INTEREST_CONVENTIONS = ["PROPORTIONAL", "ACTUAL_365"] as const;
const RATE_TYPES = ["FIXED", "VARIABLE"] as const;
const EARLY_REPAYMENT_OUTCOMES = ["SHORTEN_TERM", "REDUCE_PAYMENT", "UNKNOWN"] as const;
const DATED_TERM_KINDS = ["CONTRACTUAL", "ASSUMPTION"] as const;

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
  related: {
    schedules?: Row[];
    earlyRepayments?: Row[];
    charges?: Row[];
    rateChanges?: Row[];
    paymentChanges?: Row[];
  } = {},
): Pick<
  Liability,
  | "monthlyInsurance"
  | "recurringFees"
  | "paymentIncludesInsurance"
  | "deferral"
  | "amortisationProfile"
  | "balloonAmount"
  | "paymentFrequency"
  | "interestConvention"
  | "rateType"
  | "rateSchedule"
  | "paymentSchedule"
  | "earlyRepayments"
  | "oneOffCharges"
  | "providedSchedule"
  | "facilityId"
> {
  const liabilityId = requiredString(row.id, "liabilities.id");
  const liabilityContext = `liabilities[id=${liabilityId}]`;
  const deferralKind = enumValue(
    requiredField(row, "deferral_kind", liabilityContext),
    DEFERRAL_KINDS,
    `${liabilityContext}.deferral_kind`,
  ) as DeferralKind;
  const deferralMonths = finiteNumber(
    requiredField(row, "deferral_months", liabilityContext),
    `${liabilityContext}.deferral_months`,
  );
  const deferralInterestTreatment = enumValue(
    requiredField(row, "deferral_interest_treatment", liabilityContext),
    DEFERRED_INTEREST_TREATMENTS,
    `${liabilityContext}.deferral_interest_treatment`,
  ) as DeferredInterestTreatment;
  const deferral: LoanDeferral | null =
    deferralKind === "NONE" || deferralMonths <= 0
      ? null
      : {
          kind: deferralKind,
          months: deferralMonths,
          interestTreatment: deferralInterestTreatment,
        };

  const providedSchedule: ProvidedScheduleEntry[] = (related.schedules ?? [])
    .filter((line) => String(line.liability_id) === liabilityId)
    .filter((line) => requiredString(line.data_kind, "loan_schedules.data_kind") === "ACTUAL")
    .map((line) => {
      const context = `loan_schedules[liability_id=${liabilityId},payment=${String(line.payment_number)}]`;
      return {
        paymentNumber: finiteNumber(line.payment_number, `${context}.payment_number`),
        dueDate: requiredString(line.due_date, `${context}.due_date`),
        openingBalance: finiteNumber(line.opening_balance, `${context}.opening_balance`),
        interest: finiteNumber(line.interest, `${context}.interest`),
        principal: finiteNumber(line.principal, `${context}.principal`),
        insurance: finiteNumber(requiredField(line, "insurance", context), `${context}.insurance`),
        fees: finiteNumber(requiredField(line, "fees", context), `${context}.fees`),
        closingBalance: finiteNumber(line.closing_balance, `${context}.closing_balance`),
      };
    })
    .sort((a, b) => a.paymentNumber - b.paymentNumber);

  const earlyRepayments: EarlyRepayment[] = (related.earlyRepayments ?? [])
    .filter((line) => String(line.liability_id) === liabilityId)
    .map((line) => ({
      id: requiredString(line.id, "loan_early_repayments.id"),
      liabilityId,
      date: requiredString(line.repayment_date, "loan_early_repayments.repayment_date"),
      amount: finiteNumber(line.amount, "loan_early_repayments.amount"),
      penalty: nullableFiniteNumber(line.penalty, "loan_early_repayments.penalty"),
      outcome: enumValue(
        line.outcome,
        EARLY_REPAYMENT_OUTCOMES,
        "loan_early_repayments.outcome",
      ) as EarlyRepaymentOutcome,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const oneOffCharges: LoanCharge[] = (related.charges ?? [])
    .filter((line) => String(line.liability_id) === liabilityId)
    .map((line) => ({
      id: requiredString(line.id, "loan_charges.id"),
      liabilityId,
      date: requiredString(line.charge_date, "loan_charges.charge_date"),
      amount: finiteNumber(line.amount, "loan_charges.amount"),
      label: requiredString(line.label, "loan_charges.label"),
      financed: (() => {
        const value = requiredField(line, "financed", "loan_charges.financed");
        if (typeof value !== "boolean") {
          throw new Error(
            `Supabase donnée invalide (loan_charges.financed) : booléen obligatoire, reçu ${String(value)}`,
          );
        }
        return value;
      })(),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const rateSchedule: RateChange[] = (related.rateChanges ?? [])
    .filter((line) => String(line.liability_id) === liabilityId)
    .map((line) => ({
      effectiveFrom: requiredString(line.effective_from, "loan_rate_changes.effective_from"),
      annualRate: finiteNumber(line.annual_rate, "loan_rate_changes.annual_rate"),
      kind: enumValue(
        line.term_kind,
        DATED_TERM_KINDS,
        "loan_rate_changes.term_kind",
      ) as DatedTermKind,
    }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  const paymentSchedule: PaymentChange[] = (related.paymentChanges ?? [])
    .filter((line) => String(line.liability_id) === liabilityId)
    .map((line) => ({
      effectiveFrom: requiredString(line.effective_from, "loan_payment_changes.effective_from"),
      amount: finiteNumber(line.amount, "loan_payment_changes.amount"),
      kind: enumValue(
        line.term_kind,
        DATED_TERM_KINDS,
        "loan_payment_changes.term_kind",
      ) as DatedTermKind,
    }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  return {
    monthlyInsurance: nullableFiniteNumber(
      requiredField(row, "monthly_insurance", liabilityContext),
      `${liabilityContext}.monthly_insurance`,
    ),
    recurringFees: nullableFiniteNumber(
      requiredField(row, "recurring_fees", liabilityContext),
      `${liabilityContext}.recurring_fees`,
    ),
    paymentIncludesInsurance: nullableBoolean(
      requiredField(row, "payment_includes_insurance", liabilityContext),
      `${liabilityContext}.payment_includes_insurance`,
    ),
    deferral,
    amortisationProfile: enumValue(
      requiredField(row, "amortisation_profile", liabilityContext),
      AMORTISATION_PROFILES,
      `${liabilityContext}.amortisation_profile`,
    ) as AmortisationProfile,
    balloonAmount: nullableFiniteNumber(
      requiredField(row, "balloon_amount", liabilityContext),
      `${liabilityContext}.balloon_amount`,
    ),
    paymentFrequency: enumValue(
      requiredField(row, "payment_frequency", liabilityContext),
      PAYMENT_FREQUENCIES,
      `${liabilityContext}.payment_frequency`,
    ) as PaymentFrequency,
    interestConvention: enumValue(
      requiredField(row, "interest_convention", liabilityContext),
      INTEREST_CONVENTIONS,
      `${liabilityContext}.interest_convention`,
    ) as InterestConvention,
    rateType: enumValue(
      requiredField(row, "rate_type", liabilityContext),
      RATE_TYPES,
      `${liabilityContext}.rate_type`,
    ) as RateType,
    rateSchedule,
    paymentSchedule,
    earlyRepayments,
    oneOffCharges,
    providedSchedule,
    facilityId: nullableString(
      requiredField(row, "facility_id", liabilityContext),
      `${liabilityContext}.facility_id`,
    ),
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
 * par le repository et par le formulaire, pour que la règle soit unique.
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
 * Dérivation des métriques de FLUX du cockpit.
 *
 * Aucune grandeur de bilan n'est calculée ici : patrimoine net, actifs, cash, liquidité et
 * couverture de liquidité viennent du Canonical Balance Sheet et de ses métriques. Cette
 * fonction ne lit donc plus ni compte ni position : une somme de soldes natifs additionne
 * des devises différentes sans le dire, et faisait coexister une seconde vérité
 * patrimoniale avec la vérité canonique.
 *
 * Les grandeurs datées (service de dette, flux constatés) sont calculées sur le mois civil
 * contenant `asOfDate` : aucune borne de date littérale n'intervient.
 */
export function deriveFlowMetrics(
  liabilities: Liability[],
  incomes: IncomeSource[],
  expenses: ExpenseCategory[],
  transactions: Transaction[] = [],
  asOfDate: string = AS_OF_DATE,
): DeclaredFlowMetrics {
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
  const completeFields = knownExpenses.length;
  const period = monthBounds(asOfDate);
  const { savingsRate, investmentRate } = computeFlowRates(
    transactions,
    expenses,
    period.start,
    period.end,
  );
  return {
    monthlyIncome,
    monthlyExpenses,
    monthlyDebtService,
    freeCashFlow,
    savingsRate,
    investmentRate,
    dataCompleteness: expenses.length === 0 ? 0 : completeFields / expenses.length,
  };
}

/**
 * Composition des métriques du cockpit : structure canonique + flux déclarés.
 *
 * Point de passage UNIQUE entre le bilan canonique et l'écran. Tout ce qui touche au
 * patrimoine y est recopié tel quel depuis le bilan, `null` compris : une valeur non
 * convertible reste non calculable et ne devient jamais zéro.
 */
export function composeDashboardMetrics(input: {
  balanceSheet: CanonicalBalanceSheet;
  balanceSheetMetrics: CanonicalBalanceSheetMetrics;
  flow: DeclaredFlowMetrics;
}): DashboardMetrics {
  const { balanceSheet: sheet } = input;
  return {
    ...input.flow,
    grossAssets: sheet.grossAssets.value,
    debt: sheet.totalLiabilities.value,
    netWorth: sheet.netWorth.value,
    bankCash: sheet.immediateCash.value,
    liquidAssets: sheet.liquidAssets.value,
    liquidNetWorth: sheet.liquidNetWorth.value,
    investedAssets: sheet.marketInvestedAssets.value,
    productiveNetWorth: sheet.productiveNetWorth.value,
    // Couverture canonique : cash immédiat converti ÷ (dépenses essentielles connues +
    // décaissements de dette exigibles à 30 jours). Le dénominateur est la fenêtre à 30
    // jours du Debt Engine, et non plus le mois civil de l'ancien calcul local.
    emergencyCoverageMonths: input.balanceSheetMetrics.liquidity.cashCoverageMonths.value,
  };
}

/** Ordres d'affichage du contrat applicatif. */
export const ACCOUNT_TYPE_ORDER: Record<string, number> = { BANK: 1, SAVINGS: 2, PEA: 3 };
export const SCENARIO_NAME_ORDER: Record<string, number> = {
  Prudent: 1,
  Central: 2,
  Ambitieux: 3,
  Stress: 4,
};
export const ALERT_SEVERITY_ORDER: Record<string, number> = { HIGH: 1, MEDIUM: 2 };
