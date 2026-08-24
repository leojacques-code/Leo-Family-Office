import { amortizeLoan } from "@/lib/engine/financial";
import type { DataKind, Liability, LoanScheduleEntry } from "@/lib/types";

/**
 * Moteur de dette. Une seule vérité pour Debt, Cash Flow, Today et Decision Lab.
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
const DATE_FR = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
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
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
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
  code: "RECONCILIATION_REQUIRED" | "MATURITY_MISMATCH" | "EARLY_PAYOFF";
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
  /** (mensualité × nombre d'échéances) − capital emprunté. */
  contractualGap: number;
  flags: LoanScheduleFlag[];
}

/**
 * Échéancier daté généré à partir des seules données contractuelles disponibles.
 * Niveau 2 de la priorité des sources : provenance DERIVED, jamais présenté comme
 * l'échéancier bancaire. Un échéancier importé (niveau 1) devra alimenter
 * `loan_schedules` et court-circuiter cette fonction.
 */
export function buildLoanSchedule(liability: Liability): LoanSchedule {
  const flags: LoanScheduleFlag[] = [];
  const paymentCount = Math.max(0, Math.trunc(liability.paymentCount));
  const startingBalance = liability.currentBalance > 0 ? liability.currentBalance : liability.principal;
  const validStart = parseIsoDate(liability.firstPaymentDate) !== null;
  if (!validStart) flags.push({ code: "RECONCILIATION_REQUIRED", detail: "Première échéance non datée : aucune échéance ne peut être positionnée dans le temps." });
  if (paymentCount <= 0 || startingBalance <= 0 || !validStart) {
    return {
      liabilityId: liability.id, entries: [], kind: "MISSING", firstDueDate: null, lastDueDate: null,
      totalInterest: 0, totalCashOut: 0, contractualGap: 0, flags,
    };
  }

  const rows = amortizeLoan(startingBalance, liability.annualRate, paymentCount, liability.monthlyPayment > 0 ? liability.monthlyPayment : undefined);
  const entries: LoanScheduleEntry[] = [];
  for (const row of rows) {
    // Une ligne à cash-out nul n'est pas une échéance exigible : le prêt est déjà éteint.
    if (row.payment <= 0.004) break;
    entries.push({
      liabilityId: liability.id,
      paymentNumber: row.paymentNumber,
      dueDate: addMonths(liability.firstPaymentDate, row.paymentNumber - 1),
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

  const lastDueDate = entries.at(-1)?.dueDate ?? null;
  if (entries.length < paymentCount) {
    flags.push({
      code: "EARLY_PAYOFF",
      detail: `Le capital est éteint à la ${entries.length}e échéance alors que ${paymentCount} sont annoncées.`,
    });
  }
  if (lastDueDate && liability.maturityDate && lastDueDate !== liability.maturityDate) {
    flags.push({
      code: "MATURITY_MISMATCH",
      detail: `Dernière échéance dérivée le ${frDate(lastDueDate)}, maturité annoncée le ${frDate(liability.maturityDate)}.`,
    });
  }
  const contractualGap = liability.monthlyPayment * paymentCount - liability.principal;
  if (liability.annualRate === 0 && Math.abs(contractualGap) > 0.01) {
    flags.push({
      code: "RECONCILIATION_REQUIRED",
      detail: `À 0 %, ${paymentCount} × ${EUR.format(liability.monthlyPayment)} dépasse le capital annoncé de ${EUR.format(contractualGap)} : assurance, frais ou donnée déclarée à confirmer.`,
    });
  }

  return {
    liabilityId: liability.id,
    entries,
    kind: "DERIVED",
    firstDueDate: entries[0]?.dueDate ?? null,
    lastDueDate,
    totalInterest: entries.reduce((sum, entry) => sum + entry.interest, 0),
    totalCashOut: entries.reduce((sum, entry) => sum + entry.totalCashOut, 0),
    contractualGap,
    flags,
  };
}

export function buildLoanSchedules(liabilities: Liability[]): LoanSchedule[] {
  return liabilities.map(buildLoanSchedule);
}

/** Σ des cash-outs exigibles dans [startDate, endDate], bornes incluses. */
export function debtServiceForPeriod(liabilities: Liability[], startDate: string, endDate: string): number {
  return buildLoanSchedules(liabilities).reduce(
    (sum, schedule) =>
      sum +
      schedule.entries
        .filter((entry) => entry.dueDate >= startDate && entry.dueDate <= endDate)
        .reduce((total, entry) => total + entry.totalCashOut, 0),
    0,
  );
}

/** Service de dette du mois civil contenant `asOfDate`. Vaut 0 avant la première échéance et après la dernière. */
export function monthlyDebtServiceAt(liabilities: Liability[], asOfDate: string): number {
  const { start, end } = monthBounds(asOfDate);
  return debtServiceForPeriod(liabilities, start, end);
}

export interface DebtEvent {
  liability: Liability;
  entry: LoanScheduleEntry;
  daysAway: number | null;
  isFirstPayment: boolean;
}

/** Échéances exigibles strictement après `asOfDate`, triées par date. */
export function upcomingDebtEvents(liabilities: Liability[], asOfDate: string, horizonDays?: number): DebtEvent[] {
  const horizonDate = horizonDays === undefined ? null : toIso(new Date((parseIsoDate(asOfDate)?.getTime() ?? 0) + horizonDays * DAY));
  return liabilities
    .flatMap((liability) => {
      const schedule = buildLoanSchedule(liability);
      return schedule.entries
        .filter((entry) => entry.dueDate > asOfDate && (horizonDate === null || entry.dueDate <= horizonDate))
        .map((entry) => ({
          liability,
          entry,
          daysAway: daysBetween(asOfDate, entry.dueDate),
          isFirstPayment: entry.paymentNumber === schedule.entries[0]?.paymentNumber,
        }));
    })
    .sort((a, b) => a.entry.dueDate.localeCompare(b.entry.dueDate));
}

export function nextDebtEvent(liabilities: Liability[], asOfDate: string): DebtEvent | null {
  return upcomingDebtEvents(liabilities, asOfDate)[0] ?? null;
}

/** Capital restant dû à la date donnée, dérivé de l'échéancier. */
export function outstandingBalanceAt(liability: Liability, asOfDate: string): number {
  const schedule = buildLoanSchedule(liability);
  const paid = schedule.entries.filter((entry) => entry.dueDate <= asOfDate);
  if (!paid.length) return liability.currentBalance;
  return paid.at(-1)?.closingBalance ?? 0;
}
