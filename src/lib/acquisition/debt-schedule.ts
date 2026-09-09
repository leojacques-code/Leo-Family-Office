import { parseDelimited } from "./csv";
import { isRealCalendarDate, parseNumberInput } from "@/lib/presentation/input-parse";
import type { DebtContractInput } from "@/lib/data/contracts";

export const SCHEDULE_HEADER = "date;ouverture;principal;interet;assurance;frais;cloture;total";
type Row = DebtContractInput["providedSchedule"][number];
export type SchedulePreview = { rows: Row[]; errors: string[] };
export type DebtScheduleSummary = {
  debitCount: number;
  principalPaymentCount: number;
  firstCashOutDate: string | null;
  firstPrincipalDate: string | null;
  lastProvidedDate: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  totalPrincipal: number;
  totalInterest: number;
  totalInsurance: number;
  totalFees: number;
  totalFutureCost: number;
  totalCashOut: number;
};

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

/** Synthèse strictement bornée aux lignes fournies par la banque. */
export function summarizeDebtSchedule(rows: Row[]): DebtScheduleSummary {
  const totals = rows.reduce(
    (sum, row) => ({
      principal: sum.principal + toCents(row.principal),
      interest: sum.interest + toCents(row.interest),
      insurance: sum.insurance + toCents(row.insurance),
      fees: sum.fees + toCents(row.fees),
    }),
    { principal: 0, interest: 0, insurance: 0, fees: 0 },
  );
  const totalFutureCost = totals.interest + totals.insurance + totals.fees;
  return {
    debitCount: rows.filter(
      (row) =>
        toCents(row.principal) +
          toCents(row.interest) +
          toCents(row.insurance) +
          toCents(row.fees) >
        0,
    ).length,
    principalPaymentCount: rows.filter((row) => toCents(row.principal) > 0).length,
    firstCashOutDate:
      rows.find(
        (row) =>
          toCents(row.principal) +
            toCents(row.interest) +
            toCents(row.insurance) +
            toCents(row.fees) >
          0,
      )?.dueDate ?? null,
    firstPrincipalDate: rows.find((row) => toCents(row.principal) > 0)?.dueDate ?? null,
    lastProvidedDate: rows.at(-1)?.dueDate ?? null,
    openingBalance: rows.length ? rows[0]!.openingBalance : null,
    closingBalance: rows.length ? rows.at(-1)!.closingBalance : null,
    totalPrincipal: fromCents(totals.principal),
    totalInterest: fromCents(totals.interest),
    totalInsurance: fromCents(totals.insurance),
    totalFees: fromCents(totals.fees),
    totalFutureCost: fromCents(totalFutureCost),
    totalCashOut: fromCents(totals.principal + totalFutureCost),
  };
}

/** Format explicite : aucun montant absent ni ventilation de coût ne sont devinés. */
export function parseDebtSchedule(text: string): SchedulePreview {
  if (text.length > 250_000)
    return { rows: [], errors: ["Le fichier dépasse 250 000 caractères."] };
  const document = parseDelimited(text.replace(/^\uFEFF/, ""), ";", { maxRows: 1200 });
  const errors = document.issues.map((issue) => issue.message);
  if (document.headers.join(";").toLowerCase() !== SCHEDULE_HEADER) {
    errors.push(`Colonnes attendues : ${SCHEDULE_HEADER}`);
  }
  const rows: Row[] = [];
  for (const row of document.rows) {
    const [date, ...cells] = row.cells;
    const values = cells.map(parseNumberInput);
    if (
      !date ||
      !isRealCalendarDate(date) ||
      cells.length !== 7 ||
      values.some(
        (value) =>
          value.state !== "VALID" ||
          value.value < 0 ||
          !Number.isSafeInteger(Math.round(value.value * 100)) ||
          Math.abs(value.value * 100 - Math.round(value.value * 100)) > 1e-6,
      )
    ) {
      errors.push(
        `Ligne ${row.rowNumber} : date ISO et sept montants positifs ou nuls, au centime, obligatoires. Un champ vide reste inconnu.`,
      );
      continue;
    }
    const [openingBalance, principal, interest, insurance, fees, closingBalance, total] =
      values.map((value) => value.value!) as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    if (toCents(openingBalance) - toCents(principal) !== toCents(closingBalance)) {
      errors.push(
        `Ligne ${row.rowNumber} : ouverture moins principal ne correspond pas à la clôture. Vérifiez la source ; aucune correction automatique.`,
      );
    }
    if (
      toCents(principal) + toCents(interest) + toCents(insurance) + toCents(fees) !==
      toCents(total)
    ) {
      errors.push(
        `Ligne ${row.rowNumber} : le total diffère du capital, des intérêts, de l’assurance et des frais.`,
      );
    }
    const previous = rows.at(-1);
    if (
      previous &&
      (previous.dueDate >= date || toCents(previous.closingBalance) !== toCents(openingBalance))
    ) {
      errors.push(
        `Ligne ${row.rowNumber} : date dupliquée, ordre des dates ou continuité des soldes à vérifier.`,
      );
    }
    rows.push({
      paymentNumber: rows.length + 1,
      dueDate: date,
      openingBalance,
      principal,
      interest,
      insurance,
      fees,
      closingBalance,
    });
  }
  if (!rows.length) errors.push("Aucune ligne d’échéancier complète.");
  return { rows: errors.length ? [] : rows, errors };
}
