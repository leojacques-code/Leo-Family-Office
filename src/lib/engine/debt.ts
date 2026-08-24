import { amortizeLoan } from "@/lib/engine/financial";
import type { DataKind, Liability, LoanScheduleEntry } from "@/lib/types";

/**
 * Moteur de dette. Une seule vérité pour Debt, Cash Flow, Today et Decision Lab.
 *
 * Deux échéanciers coexistent et ne doivent JAMAIS être confondus :
 *
 *   A. échéancier CONTRACTUEL   — dérivé du capital emprunté (`principal`), daté depuis
 *      `firstPaymentDate`, sur `paymentCount` échéances. C'est la vie complète du contrat.
 *   B. échéancier FORWARD       — dérivé de l'encours observé (`currentBalance`) à la date
 *      d'observation, daté à partir de la première échéance postérieure à cette date, sur
 *      les seules échéances contractuelles restantes.
 *
 * `currentBalance` intègre déjà les échéances passées. Réamortir cet encours depuis la
 * première échéance historique amortirait la dette deux fois. Toute projection consomme
 * donc B, jamais A.
 *
 * Définition canonique retenue (docs/FINANCIAL_DEFINITIONS.md §4.3, INV-D-02) :
 *
 *   DebtService(période) = Σ LoanScheduleEntry.totalCashOut
 *                         pour toute échéance exigible dans la période
 *   totalCashOut = interest + principal + insurance + fees
 *
 * Aucune borne de date littérale n'intervient : avant la première échéance et après la
 * dernière, aucune ligne n'est exigible, donc le service de dette vaut zéro sans cas
 * particulier. Assurance et frais ne sont pas portés par le modèle `Liability` : ils
 * valent 0 et sont exposés explicitement plutôt qu'omis.
 */

const DAY = 86_400_000;
const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const DATE_FR = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
function frDate(iso: string) {
  const parsed = parseIsoDate(iso);
  return parsed ? DATE_FR.format(parsed) : iso;
}

function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Ajout de mois calendaires avec repli sur le dernier jour du mois (31 janvier + 1 mois = 28 février). */
export function addMonths(iso: string, months: number): string {
  const base = parseIsoDate(iso);
  if (!base) return iso;
  const day = base.getUTCDate();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toIso(target);
}

/** Premier et dernier jour du mois civil contenant `iso`. */
export function monthBounds(iso: string): { start: string; end: string } {
  const base = parseIsoDate(iso) ?? new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
  return { start: toIso(start), end: toIso(end) };
}

export function daysBetween(fromIso: string, toIsoDate: string): number | null {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIsoDate);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / DAY);
}

export interface LoanScheduleFlag {
  code: "RECONCILIATION_REQUIRED" | "MATURITY_MISMATCH" | "EARLY_PAYOFF" | "BALANCE_MISMATCH";
  detail: string;
}

export interface LoanSchedule {
  liabilityId: string;
  entries: LoanScheduleEntry[];
  /** DERIVED tant qu'aucun échéancier bancaire n'est importé : ce n'est pas un contrat. */
  kind: DataKind;
  firstDueDate: string | null;
  lastDueDate: string | null;
  totalInterest: number;
  totalCashOut: number;
}

const EMPTY_SCHEDULE = (liabilityId: string, kind: DataKind = "DERIVED"): LoanSchedule => ({
  liabilityId,
  entries: [],
  kind,
  firstDueDate: null,
  lastDueDate: null,
  totalInterest: 0,
  totalCashOut: 0,
});

function summarise(liabilityId: string, entries: LoanScheduleEntry[]): LoanSchedule {
  return {
    liabilityId,
    entries,
    kind: "DERIVED",
    firstDueDate: entries[0]?.dueDate ?? null,
    lastDueDate: entries.at(-1)?.dueDate ?? null,
    totalInterest: entries.reduce((sum, entry) => sum + entry.interest, 0),
    totalCashOut: entries.reduce((sum, entry) => sum + entry.totalCashOut, 0),
  };
}

/**
 * Mensualité qui fait foi pour les deux échéanciers.
 *
 * Une mensualité contractuelle fournie est prioritaire (source de niveau 1). À défaut,
 * la PMT théorique est dérivée UNE FOIS du contrat — capital emprunté, taux, nombre
 * d'échéances — et non de l'encours observé : la mensualité d'un prêt à taux fixe est un
 * terme du contrat, elle ne doit pas dériver parce que l'encours a bougé.
 */
export function contractualPayment(liability: Liability): number {
  if (liability.monthlyPayment > 0) return liability.monthlyPayment;
  const payments = Math.trunc(liability.paymentCount);
  if (payments <= 0 || liability.principal <= 0) return 0;
  const monthlyRate = liability.annualRate / 12;
  return monthlyRate === 0
    ? liability.principal / payments
    : (liability.principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -payments));
}

function isUsable(liability: Liability): boolean {
  return (
    Math.trunc(liability.paymentCount) > 0 && parseIsoDate(liability.firstPaymentDate) !== null
  );
}

/**
 * Amortit `balance` sur `payments` échéances, en datant la ligne `n` (numérotation
 * contractuelle absolue) au mois correspondant depuis `firstPaymentDate`.
 */
function amortiseFrom(
  liability: Liability,
  balance: number,
  payments: number,
  firstPaymentNumber: number,
): LoanScheduleEntry[] {
  if (balance <= 0 || payments <= 0) return [];
  const payment = contractualPayment(liability);
  const rows = amortizeLoan(
    balance,
    liability.annualRate,
    payments,
    payment > 0 ? payment : undefined,
  );
  const entries: LoanScheduleEntry[] = [];
  for (const row of rows) {
    // Une ligne à cash-out nul n'est pas une échéance exigible : le prêt est déjà éteint.
    if (row.payment <= 0.004) break;
    const paymentNumber = firstPaymentNumber + row.paymentNumber - 1;
    entries.push({
      liabilityId: liability.id,
      paymentNumber,
      dueDate: addMonths(liability.firstPaymentDate, paymentNumber - 1),
      openingBalance: row.openingBalance,
      interest: row.interest,
      principal: row.principal,
      insurance: 0,
      fees: 0,
      totalCashOut: row.interest + row.principal,
      closingBalance: row.closingBalance,
      kind: "DERIVED",
    });
  }
  return entries;
}

/**
 * A. Échéancier contractuel complet, dérivé du capital emprunté.
 *
 * Décrit la vie entière du prêt telle que le contrat l'annonce. Sert à l'affichage du
 * contrat et au contrôle de réconciliation. Ne jamais l'utiliser pour projeter un
 * encours déjà entamé : ses lignes passées ont déjà été payées.
 */
export function buildContractualSchedule(liability: Liability): LoanSchedule {
  if (!isUsable(liability) || liability.principal <= 0) {
    return EMPTY_SCHEDULE(liability.id, "MISSING");
  }
  return summarise(
    liability.id,
    amortiseFrom(liability, liability.principal, Math.trunc(liability.paymentCount), 1),
  );
}

/** Nombre d'échéances contractuelles dont la date d'exigibilité est passée à `asOfDate`. */
export function elapsedPaymentsAt(liability: Liability, asOfDate: string): number {
  if (!isUsable(liability)) return 0;
  const total = Math.trunc(liability.paymentCount);
  let elapsed = 0;
  for (let index = 1; index <= total; index += 1) {
    if (addMonths(liability.firstPaymentDate, index - 1) <= asOfDate) elapsed += 1;
    else break;
  }
  return elapsed;
}

/**
 * B. Échéancier forward, dérivé de l'encours observé à `asOfDate`.
 *
 * Démarre à la première échéance contractuelle postérieure à `asOfDate` et n'amortit que
 * `currentBalance`. Les mensualités déjà passées ne sont jamais rejouées contre cet
 * encours : c'est la seule projection utilisable pour le futur.
 */
export function buildForwardSchedule(liability: Liability, asOfDate: string): LoanSchedule {
  if (!isUsable(liability)) return EMPTY_SCHEDULE(liability.id, "MISSING");
  const elapsed = elapsedPaymentsAt(liability, asOfDate);
  const remaining = Math.trunc(liability.paymentCount) - elapsed;
  if (remaining <= 0 || liability.currentBalance <= 0) return EMPTY_SCHEDULE(liability.id);
  return summarise(
    liability.id,
    amortiseFrom(liability, liability.currentBalance, remaining, elapsed + 1),
  );
}

export interface LoanTimeline {
  liability: Liability;
  /** A : vie complète du contrat, depuis le capital emprunté. */
  contractual: LoanSchedule;
  /** B : projection depuis l'encours observé, à partir de la prochaine échéance. */
  forward: LoanSchedule;
  elapsedPayments: number;
  remainingPayments: number;
  observedBalance: number;
  /** Encours qu'aurait le contrat après `elapsedPayments` échéances. */
  contractualBalanceAtAsOf: number;
  /** (mensualité × nombre d'échéances) − capital emprunté. */
  contractualGap: number;
  flags: LoanScheduleFlag[];
}

/**
 * Vue complète d'un prêt à une date d'observation : contrat, projection et écarts de
 * réconciliation. Les cash-outs passés proviennent du contrat, les futurs de l'encours
 * observé, ce qui rend le service de dette exact des deux côtés de la date zéro.
 */
export function buildLoanTimeline(liability: Liability, asOfDate: string): LoanTimeline {
  const flags: LoanScheduleFlag[] = [];
  if (parseIsoDate(liability.firstPaymentDate) === null) {
    flags.push({
      code: "RECONCILIATION_REQUIRED",
      detail:
        "Première échéance non datée : aucune échéance ne peut être positionnée dans le temps.",
    });
  }
  const contractual = buildContractualSchedule(liability);
  const forward = buildForwardSchedule(liability, asOfDate);
  const elapsed = elapsedPaymentsAt(liability, asOfDate);
  const remaining = Math.max(0, Math.trunc(liability.paymentCount) - elapsed);
  const contractualBalanceAtAsOf =
    elapsed === 0
      ? liability.principal
      : (contractual.entries.filter((entry) => entry.paymentNumber <= elapsed).at(-1)
          ?.closingBalance ?? 0);

  if (
    contractual.entries.length &&
    contractual.entries.length < Math.trunc(liability.paymentCount)
  ) {
    flags.push({
      code: "EARLY_PAYOFF",
      detail: `Le capital est éteint à la ${contractual.entries.length}e échéance alors que ${Math.trunc(liability.paymentCount)} sont annoncées.`,
    });
  }
  if (
    contractual.lastDueDate &&
    liability.maturityDate &&
    contractual.lastDueDate !== liability.maturityDate
  ) {
    flags.push({
      code: "MATURITY_MISMATCH",
      detail: `Dernière échéance dérivée le ${frDate(contractual.lastDueDate)}, maturité annoncée le ${frDate(liability.maturityDate)}.`,
    });
  }
  // L'encours observé fait foi. Un écart avec ce que le contrat prévoyait est une
  // anomalie à exposer, jamais un motif de recalculer l'encours à la place de la donnée.
  if (Math.abs(liability.currentBalance - contractualBalanceAtAsOf) > 0.01) {
    flags.push({
      code: "BALANCE_MISMATCH",
      detail: `Encours observé ${EUR.format(liability.currentBalance)} contre ${EUR.format(contractualBalanceAtAsOf)} attendus après ${elapsed} échéance${elapsed > 1 ? "s" : ""}. L'encours observé fait foi pour la projection.`,
    });
  }
  const forwardResidual = forward.entries.at(-1)?.closingBalance ?? 0;
  if (forwardResidual > 0.01) {
    flags.push({
      code: "RECONCILIATION_REQUIRED",
      detail: `Les ${remaining} échéances restantes ne soldent pas l'encours observé : ${EUR.format(forwardResidual)} subsisteraient à la dernière échéance annoncée.`,
    });
  }
  const contractualGap =
    contractualPayment(liability) * Math.trunc(liability.paymentCount) - liability.principal;
  if (liability.annualRate === 0 && Math.abs(contractualGap) > 0.01) {
    flags.push({
      code: "RECONCILIATION_REQUIRED",
      detail: `À 0 %, ${Math.trunc(liability.paymentCount)} × ${EUR.format(liability.monthlyPayment)} dépasse le capital annoncé de ${EUR.format(contractualGap)} : assurance, frais ou donnée déclarée à confirmer.`,
    });
  }

  return {
    liability,
    contractual,
    forward,
    elapsedPayments: elapsed,
    remainingPayments: remaining,
    observedBalance: liability.currentBalance,
    contractualBalanceAtAsOf,
    contractualGap,
    flags,
  };
}

/**
 * Lignes exigibles sur l'axe du temps : le contrat pour le passé, la projection depuis
 * l'encours observé pour le futur. Les montants passés sont des faits, les montants
 * futurs une dérivation ; aucun capital n'est amorti deux fois.
 */
function timelineEntries(liability: Liability, asOfDate: string): LoanScheduleEntry[] {
  const timeline = buildLoanTimeline(liability, asOfDate);
  return [
    ...timeline.contractual.entries.filter((entry) => entry.dueDate <= asOfDate),
    ...timeline.forward.entries,
  ];
}

/** Σ des cash-outs exigibles dans [startDate, endDate], bornes incluses. */
export function debtServiceForPeriod(
  liabilities: Liability[],
  asOfDate: string,
  startDate: string,
  endDate: string,
): number {
  return liabilities.reduce(
    (sum, liability) =>
      sum +
      timelineEntries(liability, asOfDate)
        .filter((entry) => entry.dueDate >= startDate && entry.dueDate <= endDate)
        .reduce((total, entry) => total + entry.totalCashOut, 0),
    0,
  );
}

/** Service de dette du mois civil contenant `asOfDate`. Vaut 0 avant la première échéance et après la dernière. */
export function monthlyDebtServiceAt(liabilities: Liability[], asOfDate: string): number {
  const { start, end } = monthBounds(asOfDate);
  return debtServiceForPeriod(liabilities, asOfDate, start, end);
}

export interface DebtEvent {
  liability: Liability;
  entry: LoanScheduleEntry;
  daysAway: number | null;
  isFirstPayment: boolean;
}

/** Échéances exigibles strictement après `asOfDate`, projetées depuis l'encours observé. */
export function upcomingDebtEvents(
  liabilities: Liability[],
  asOfDate: string,
  horizonDays?: number,
): DebtEvent[] {
  const horizonDate =
    horizonDays === undefined
      ? null
      : toIso(new Date((parseIsoDate(asOfDate)?.getTime() ?? 0) + horizonDays * DAY));
  return liabilities
    .flatMap((liability) => {
      const forward = buildForwardSchedule(liability, asOfDate);
      return forward.entries
        .filter((entry) => horizonDate === null || entry.dueDate <= horizonDate)
        .map((entry) => ({
          liability,
          entry,
          daysAway: daysBetween(asOfDate, entry.dueDate),
          isFirstPayment: entry.paymentNumber === 1,
        }));
    })
    .sort((a, b) => a.entry.dueDate.localeCompare(b.entry.dueDate));
}

export function nextDebtEvent(liabilities: Liability[], asOfDate: string): DebtEvent | null {
  return upcomingDebtEvents(liabilities, asOfDate)[0] ?? null;
}

/**
 * Capital restant dû à `targetDate`, projeté depuis l'encours observé à `asOfDate`.
 *
 * Une date cible antérieure ou égale à la date d'observation rend l'encours observé tel
 * quel : les échéances déjà payées y sont incorporées et ne sont jamais redéduites.
 */
export function outstandingBalanceAt(
  liability: Liability,
  asOfDate: string,
  targetDate: string = asOfDate,
): number {
  if (targetDate <= asOfDate) return liability.currentBalance;
  const forward = buildForwardSchedule(liability, asOfDate);
  const due = forward.entries.filter((entry) => entry.dueDate <= targetDate);
  if (!due.length) return liability.currentBalance;
  return due.at(-1)?.closingBalance ?? 0;
}
