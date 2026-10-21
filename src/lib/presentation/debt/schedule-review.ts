import type {
  ScheduleDecisionView,
  ScheduleFieldView,
  ScheduleReview,
} from "@/lib/data/schedule-document-contracts";
import type { DocumentIssue } from "@/lib/acquisition/documents/types";

/** Les anciennes alertes nommaient « lignes » les rangs d'échéances, en-tête exclu. */
export function scheduleIssueText(issue: Pick<DocumentIssue, "code" | "message">): string {
  if (
    ![
      "SCHEDULE_DUPLICATE_DUE_DATE",
      "SCHEDULE_DATES_NOT_INCREASING",
      "SCHEDULE_PERIOD_GAP",
    ].includes(issue.code)
  )
    return issue.message;
  return issue.message
    .replaceAll("aux lignes", "aux échéances")
    .replaceAll("les lignes", "les échéances")
    .replaceAll("La ligne", "L’échéance")
    .replaceAll("la ligne", "l’échéance");
}

/**
 * Modèle de présentation de la revue d'un échéancier déposé (B19).
 *
 * Il REPREND les cases persistées et les range pour l'écran : la pièce telle que lue (grille)
 * et les candidats par ligne d'échéance. Il ne lit rien dans le fichier et ne corrige rien.
 *
 * Une seule arithmétique y vit, demandée par le cahier des charges B19 §6 : la somme d'une
 * colonne de montants pour la synthèse avant validation. Elle obéit à VIDE ≠ ZÉRO : une case
 * vide, illisible ou écartée rend la somme de sa colonne non calculable, au lieu de la sous-
 * estimer en silence, et une colonne absente du fichier reste absente.
 */

export const SCHEDULE_COLUMN_LABELS: Readonly<Record<string, string>> = {
  date: "Échéance",
  opening: "Capital restant avant",
  principal: "Capital amorti",
  interest: "Intérêts",
  insurance: "Assurance",
  fees: "Frais",
  total: "Échéance totale",
  closing: "Capital restant après",
  currency: "Devise",
};

/** Ordre de lecture d'une ligne d'échéance, celui d'un tableau d'amortissement bancaire. */
const ROLE_ORDER = [
  "date",
  "opening",
  "principal",
  "interest",
  "insurance",
  "fees",
  "total",
  "closing",
  "currency",
] as const;

/** Composants qui s'additionnent : un capital restant ne se somme pas d'une ligne à l'autre. */
const SUMMABLE = ["principal", "interest", "insurance", "fees", "total"] as const;

export interface ScheduleGridColumn {
  key: string;
  /** Lettre de colonne du fichier (A, B, …), lue dans la référence de cellule. */
  letter: string;
  /** En-tête imprimé dans le fichier, tel quel. */
  label: string | null;
  recognized: boolean;
}

export interface ScheduleGridRow {
  rowNumber: number;
  lineNumber: number;
  cells: Readonly<Record<string, ScheduleFieldView>>;
}

export interface ScheduleGrid {
  sheetName: string | null;
  columns: ScheduleGridColumn[];
  rows: ScheduleGridRow[];
}

function columnLetterOf(cellRef: string | null): string | null {
  const match = cellRef === null ? null : /^([A-Z]+)\d+$/.exec(cellRef);
  return match ? match[1]! : null;
}

/** Ordre des lettres de tableur : B avant AA. */
function compareLetters(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

export function buildScheduleGrid(fields: readonly ScheduleFieldView[]): ScheduleGrid {
  const columns = new Map<string, ScheduleGridColumn>();
  const rows = new Map<number, { lineNumber: number; cells: Record<string, ScheduleFieldView> }>();
  for (const field of fields) {
    if (!columns.has(field.columnKey)) {
      columns.set(field.columnKey, {
        key: field.columnKey,
        letter: columnLetterOf(field.cellRef) ?? "?",
        label: field.columnLabel,
        recognized: field.validationStatus !== "UNKNOWN_BOX",
      });
    }
    const row = rows.get(field.rowNumber) ?? { lineNumber: field.lineNumber, cells: {} };
    row.cells[field.columnKey] = field;
    rows.set(field.rowNumber, row);
  }
  return {
    sheetName: fields[0]?.sheetName ?? null,
    columns: [...columns.values()].sort((a, b) => compareLetters(a.letter, b.letter)),
    rows: [...rows.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rowNumber, row]) => ({ rowNumber, ...row })),
  };
}

export interface ScheduleLine {
  lineNumber: number;
  rowNumber: number;
  /** Case de date de la ligne ; absente si le fichier n'en avait pas à cette ligne. */
  date: ScheduleFieldView | null;
  /** Cases reconnues de la ligne, dans l'ordre d'un tableau d'amortissement. */
  fields: ScheduleFieldView[];
  /** Nombre de cases de la ligne qui demandent une décision (illisibles). */
  blockedCount: number;
}

export function buildScheduleLines(fields: readonly ScheduleFieldView[]): ScheduleLine[] {
  const lines = new Map<number, ScheduleFieldView[]>();
  for (const field of fields) {
    if (field.validationStatus === "UNKNOWN_BOX") continue;
    lines.set(field.lineNumber, [...(lines.get(field.lineNumber) ?? []), field]);
  }
  return [...lines.entries()]
    .sort(([a], [b]) => a - b)
    .map(([lineNumber, lineFields]) => {
      const ordered = [...lineFields].sort(
        (a, b) =>
          ROLE_ORDER.indexOf(a.columnKey as (typeof ROLE_ORDER)[number]) -
          ROLE_ORDER.indexOf(b.columnKey as (typeof ROLE_ORDER)[number]),
      );
      return {
        lineNumber,
        rowNumber: ordered[0]!.rowNumber,
        date: ordered.find((field) => field.columnKey === "date") ?? null,
        fields: ordered,
        blockedCount: ordered.filter((field) => field.validationStatus === "BLOCKED").length,
      };
    });
}

export interface ScheduleComponentSum {
  key: (typeof SUMMABLE)[number];
  label: string;
  /** Somme des valeurs RETENUES ; `null` dès qu'une case manque. */
  sum: number | null;
  /** `ABSENT` : colonne absente du fichier ; `INCOMPLETE` : au moins une case sans valeur. */
  reason: "ABSENT" | "INCOMPLETE" | null;
  missingCount: number;
}

export interface ScheduleSynthesis {
  firstDueDate: string | null;
  lastDueDate: string | null;
  lineCount: number;
  /** Vrai sauf complétude PROUVÉE : un extrait n'est jamais présenté comme l'échéancier. */
  partial: boolean;
  sums: ScheduleComponentSum[];
  blockedFieldCount: number;
  rejectedFieldCount: number;
  failedBlockingChecks: number;
  failedChecks: number;
  notComputableChecks: number;
}

export function summarizeScheduleReview(review: ScheduleReview): ScheduleSynthesis {
  const lines = buildScheduleLines(review.fields);
  const sums = SUMMABLE.map((key): ScheduleComponentSum => {
    const label = SCHEDULE_COLUMN_LABELS[key]!;
    const column = review.fields.filter((field) => field.columnKey === key);
    if (column.length === 0) return { key, label, sum: null, reason: "ABSENT", missingCount: 0 };
    // Une ligne sans case dans cette colonne compte comme manquante, comme une case vide.
    let missingCount = lines.length - column.length;
    let sum = 0;
    for (const field of column) {
      if (field.validationStatus === "REJECTED" || field.effectiveValue === null) missingCount++;
      else sum += field.effectiveValue;
    }
    return missingCount > 0
      ? { key, label, sum: null, reason: "INCOMPLETE", missingCount }
      : { key, label, sum, reason: null, missingCount: 0 };
  });
  return {
    firstDueDate: review.run.firstDueDate,
    lastDueDate: review.run.lastDueDate,
    lineCount: review.run.lineCount ?? lines.length,
    partial: review.run.completeness !== "COMPLETE",
    sums,
    blockedFieldCount: review.fields.filter((field) => field.validationStatus === "BLOCKED").length,
    rejectedFieldCount: review.fields.filter((field) => field.validationStatus === "REJECTED")
      .length,
    failedBlockingChecks: review.checks.filter(
      (check) => check.status === "FAILED" && check.severity === "BLOCKING",
    ).length,
    failedChecks: review.checks.filter((check) => check.status === "FAILED").length,
    notComputableChecks: review.checks.filter((check) => check.status === "NOT_COMPUTABLE").length,
  };
}

/**
 * Dates de la lecture déjà portées par l'échéancier enregistré de la dette. Le remplacement
 * est une décision de rattachement : la revue le SIGNALE, elle ne tranche pas.
 */
export function overlappingDueDates(
  fields: readonly ScheduleFieldView[],
  existingDueDates: readonly string[],
): string[] {
  const existing = new Set(existingDueDates);
  const read = fields
    .filter((field) => field.columnKey === "date" && field.validationStatus !== "REJECTED")
    .map((field) => field.effectiveDate)
    .filter((date): date is string => date !== null && existing.has(date));
  return [...new Set(read)].sort();
}

/** Historique d'une case, de la plus ancienne décision à la plus récente. */
export function fieldHistory(
  decisions: readonly ScheduleDecisionView[],
  fieldId: string,
): ScheduleDecisionView[] {
  return decisions
    .filter((decision) => decision.fieldId === fieldId)
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Cases citées par un contrôle (`L3.opening`), dans l'ordre du contrôle : la première est la
 * valeur contrôlée (membre de gauche), c'est elle que « Voir la case » montre.
 */
export function checkFields(
  fields: readonly ScheduleFieldView[],
  boxCodes: readonly string[],
): ScheduleFieldView[] {
  const byCode = new Map(fields.map((field) => [field.boxCode, field]));
  return boxCodes
    .map((code) => byCode.get(code))
    .filter((field): field is ScheduleFieldView => field !== undefined);
}
