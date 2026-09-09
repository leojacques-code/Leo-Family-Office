import { parseDelimited } from "./csv";
import { isRealCalendarDate, parseNumberInput } from "@/lib/presentation/input-parse";
import type { DebtContractInput } from "@/lib/data/contracts";

export const SCHEDULE_HEADER = "date;ouverture;principal;interet;assurance;frais;cloture;total";
type Row = DebtContractInput["providedSchedule"][number];
export type SchedulePreview = { rows: Row[]; errors: string[] };

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
    const cents = (value: number) => Math.round(value * 100);
    if (cents(openingBalance) - cents(principal) !== cents(closingBalance)) {
      errors.push(
        `Ligne ${row.rowNumber} : ouverture moins principal ne correspond pas à la clôture. Vérifiez la source ; aucune correction automatique.`,
      );
    }
    if (cents(principal) + cents(interest) + cents(insurance) + cents(fees) !== cents(total)) {
      errors.push(
        `Ligne ${row.rowNumber} : le total diffère du capital, des intérêts, de l’assurance et des frais.`,
      );
    }
    const previous = rows.at(-1);
    if (
      previous &&
      (previous.dueDate >= date || cents(previous.closingBalance) !== cents(openingBalance))
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
