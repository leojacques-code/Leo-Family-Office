/**
 * FEC — LECTURE DES LIGNES ET DES ÉCRITURES.
 *
 * Couche pure : aucun accès base, aucun React. Elle lit ce que la source a écrit, elle
 * groupe les lignes en écritures, elle contrôle la partie double, et elle refuse de
 * comprendre ce qu'elle n'a pas compris.
 */

import { detectDelimiter, parseDelimited } from "@/lib/acquisition/csv";
import {
  decodeSourceBytes,
  isCalendarDate,
  issue,
  normalizeLabel,
  parseAmountWithConvention,
  parseDateWithConvention,
  resolveAmountConvention,
  resolveDateConvention,
} from "@/lib/acquisition/normalization";
import type {
  AmountConvention,
  DateConvention,
  ImportIssue,
  ImportRowStatus,
} from "@/lib/acquisition/types";
import { normalizeAccountNumber, pcgClassOf, pcgGroupOf } from "@/lib/acquisition/fec/pcg";
import {
  FEC_DELIMITERS,
  FEC_FIELDS,
  type FecField,
} from "@/lib/acquisition/fec/spec";
import type { FecEntry, FecLine } from "@/lib/acquisition/fec/types";

/**
 * Plafond de lignes d'un FEC.
 *
 * Volontairement DISTINCT du plafond d'un relevé bancaire : une PME produit couramment
 * plusieurs dizaines de milliers d'écritures par exercice, et appliquer mécaniquement la
 * limite du CSV bancaire rendrait la fonctionnalité inutilisable sur des fichiers normaux.
 * Un dépassement ÉCHOUE : il ne tronque pas.
 */
export const MAX_FEC_LINES = 200_000;

/** Tolérance d'équilibre d'une écriture, en unité monétaire. Absorbe l'arrondi, rien de plus. */
export const BALANCE_TOLERANCE = 0.005;

const FEC_DATE = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * Lit une date au format réglementaire `AAAAMMJJ`.
 *
 * Un export non conforme (`JJ/MM/AAAA`) reste lisible mais l'écart est SIGNALÉ : le format
 * est réglementaire, et un fichier qui s'en écarte peut s'en écarter ailleurs aussi.
 */
export function parseFecDate(
  raw: string,
  fallback: DateConvention,
): { value: string | null; code: "EMPTY" | "OK" | "INVALID" | "NON_STANDARD" } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null, code: "EMPTY" };
  const match = FEC_DATE.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isCalendarDate(year, month, day)) return { value: null, code: "INVALID" };
    return { value: `${match[1]}-${match[2]}-${match[3]}`, code: "OK" };
  }
  const parsed = parseDateWithConvention(trimmed, fallback);
  if (parsed.value === null) return { value: null, code: "INVALID" };
  return { value: parsed.value, code: "NON_STANDARD" };
}

/** Séparateur d'un FEC : les candidats du format d'abord, la détection générique ensuite. */
export function detectFecDelimiter(text: string): { delimiter: string; issues: ImportIssue[] } {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  for (const candidate of FEC_DELIMITERS) {
    // Un en-tête conforme porte les dix-huit champs : le séparateur qui les révèle est le bon.
    if (firstLine.split(candidate).length >= FEC_FIELDS.length) {
      return { delimiter: candidate, issues: [] };
    }
  }
  const detected = detectDelimiter(text);
  return {
    delimiter: detected.delimiter,
    issues: [
      ...detected.issues,
      issue(
        "FEC_HEADER_INVALID",
        "WARNING",
        `Aucun séparateur du format (tabulation, barre verticale, point-virgule) ne révèle les ${FEC_FIELDS.length} champs attendus dans l'en-tête.`,
      ),
    ],
  };
}

interface Conventions {
  amount: AmountConvention;
  date: DateConvention;
}

function cell(cells: readonly string[], index: number | undefined): string {
  if (index === undefined) return "";
  return cells[index] ?? "";
}

/** Statut déduit des seules anomalies : une erreur bloque, un avertissement alerte. */
function statusFromIssues(issues: readonly ImportIssue[]): ImportRowStatus {
  if (issues.some((entry) => entry.severity === "ERROR")) return "BLOCKED";
  if (issues.some((entry) => entry.severity === "WARNING")) return "WARNING";
  return "READY";
}

/**
 * Conventions de montant et de date du fichier, résolues sur TOUTES les cellules de chaque
 * colonne — même règle que le relevé bancaire : une colonne indécidable bloque ses lignes
 * plutôt que de fabriquer des montants.
 */
export function resolveFecConventions(
  rows: ReadonlyArray<{ cells: string[] }>,
  positions: Partial<Record<FecField, number>>,
): { conventions: Conventions; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const amountCells: string[] = [];
  for (const field of ["Debit", "Credit", "Montantdevise"] as const) {
    const index = positions[field];
    if (index === undefined) continue;
    for (const row of rows) amountCells.push(cell(row.cells, index));
  }
  const amount = resolveAmountConvention(amountCells);
  if (amount === "AMBIGUOUS") {
    issues.push(
      issue(
        "AMOUNT_CONVENTION_AMBIGUOUS",
        "ERROR",
        "La convention décimale des colonnes de montants est indécidable. Aucun montant n'est lu tant qu'elle n'est pas tranchée.",
        "Debit",
      ),
    );
  }

  // La convention de date ne sert qu'aux fichiers NON conformes : `AAAAMMJJ` se lit sans elle.
  const dateCells: string[] = [];
  for (const field of ["EcritureDate", "PieceDate", "ValidDate", "DateLet"] as const) {
    const index = positions[field];
    if (index === undefined) continue;
    for (const row of rows) dateCells.push(cell(row.cells, index));
  }
  const date = resolveDateConvention(dateCells.filter((value) => !FEC_DATE.test(value.trim())));

  return { conventions: { amount, date }, issues };
}

interface LineContext {
  positions: Partial<Record<FecField, number>>;
  conventions: Conventions;
  fiscalYear: { start: string; end: string } | null;
}

/** Lit une ligne brute en ligne d'écriture normalisée. */
export function normalizeFecLine(
  row: { rowNumber: number; cells: string[] },
  context: LineContext,
): FecLine {
  const issues: ImportIssue[] = [];
  const { positions, conventions } = context;
  const text = (field: FecField) => normalizeLabel(cell(row.cells, positions[field]));

  const journalCode = text("JournalCode");
  const entryNumber = text("EcritureNum");
  const rawAccount = cell(row.cells, positions.CompteNum);
  const accountNumber = rawAccount.trim().length > 0 ? normalizeAccountNumber(rawAccount) : null;

  if (journalCode === null) {
    issues.push(issue("FEC_JOURNAL_MISSING", "ERROR", "Code journal absent.", "JournalCode"));
  }
  if (entryNumber === null) {
    issues.push(
      issue("FEC_ENTRY_NUMBER_MISSING", "ERROR", "Numéro d'écriture absent.", "EcritureNum"),
    );
  }
  if (accountNumber === null) {
    issues.push(issue("FEC_ACCOUNT_MISSING", "ERROR", "Numéro de compte absent.", "CompteNum"));
  }

  // ── Dates ────────────────────────────────────────────────────────────────────────────
  const rawEntryDate = cell(row.cells, positions.EcritureDate);
  const parsedEntryDate = parseFecDate(rawEntryDate, conventions.date);
  if (parsedEntryDate.code === "EMPTY") {
    issues.push(
      issue("FEC_ENTRY_DATE_MISSING", "ERROR", "Date d'écriture absente.", "EcritureDate"),
    );
  } else if (parsedEntryDate.code === "INVALID") {
    issues.push(
      issue(
        "FEC_ENTRY_DATE_INVALID",
        "ERROR",
        "Date d'écriture illisible ou inexistante au calendrier.",
        "EcritureDate",
        rawEntryDate,
      ),
    );
  } else if (parsedEntryDate.code === "NON_STANDARD") {
    issues.push(
      issue(
        "FEC_NON_STANDARD_DATE_FORMAT",
        "WARNING",
        `Date hors format réglementaire AAAAMMJJ : lue comme ${parsedEntryDate.value}.`,
        "EcritureDate",
        rawEntryDate,
      ),
    );
  }

  const readOptionalDate = (field: FecField, code: "FEC_ENTRY_DATE_INVALID") => {
    const raw = cell(row.cells, positions[field]);
    const parsed = parseFecDate(raw, conventions.date);
    if (parsed.code === "INVALID") {
      issues.push(
        issue(code, "WARNING", `Date « ${field} » renseignée mais illisible.`, field, raw),
      );
    }
    return parsed.value;
  };
  const pieceDate = readOptionalDate("PieceDate", "FEC_ENTRY_DATE_INVALID");
  const letterDate = readOptionalDate("DateLet", "FEC_ENTRY_DATE_INVALID");
  const validationDate = readOptionalDate("ValidDate", "FEC_ENTRY_DATE_INVALID");

  // ── Montants ─────────────────────────────────────────────────────────────────────────
  //
  // ABSENT ≠ ZÉRO, et le format lui-même fait la distinction : un côté non employé peut
  // être laissé vide. Un côté absent alors que l'AUTRE est renseigné vaut zéro par la
  // CONVENTION du format, pas par défaut applicatif. Une ligne dont les deux côtés sont
  // absents n'a aucun montant : elle est bloquée.
  const readAmount = (field: "Debit" | "Credit" | "Montantdevise") => {
    const raw = cell(row.cells, positions[field]);
    const parsed = parseAmountWithConvention(raw, conventions.amount);
    if (parsed.code === "UNPARSEABLE" || parsed.code === "AMBIGUOUS") {
      issues.push(
        issue(
          "FEC_AMOUNT_UNPARSEABLE",
          field === "Montantdevise" ? "WARNING" : "ERROR",
          `Colonne « ${field} » illisible.`,
          field,
          raw,
        ),
      );
    }
    return parsed.value;
  };
  const debit = readAmount("Debit");
  const credit = readAmount("Credit");
  if (debit === null && credit === null) {
    issues.push(
      issue("FEC_AMOUNT_MISSING", "ERROR", "Ni débit ni crédit renseigné.", "Debit", null),
    );
  }
  if (debit !== null && credit !== null && debit !== 0 && credit !== 0) {
    issues.push(
      issue(
        "FEC_AMOUNT_BOTH_SIDES",
        "WARNING",
        "Débit et crédit tous deux non nuls sur la même ligne : le sens de la ligne est ambigu, seul son solde net est exploitable.",
        "Debit",
        `${debit} / ${credit}`,
      ),
    );
  }

  // ── Devise ───────────────────────────────────────────────────────────────────────────
  const currencyAmount = readAmount("Montantdevise");
  const rawCurrency = normalizeLabel(cell(row.cells, positions.Idevise));
  const currencyCode = rawCurrency ? rawCurrency.toUpperCase() : null;
  if (currencyAmount !== null && currencyCode === null) {
    issues.push(
      issue(
        "FEC_CURRENCY_AMOUNT_WITHOUT_CODE",
        "WARNING",
        "Montant en devise renseigné sans code devise : la conversion resterait non fondée.",
        "Idevise",
      ),
    );
  }

  // ── Lettrage et pièce ────────────────────────────────────────────────────────────────
  const letterCode = text("EcritureLet");
  if (letterDate !== null && letterCode === null) {
    issues.push(
      issue(
        "FEC_LETTER_DATE_WITHOUT_CODE",
        "WARNING",
        "Date de lettrage sans code de lettrage.",
        "DateLet",
      ),
    );
  }
  const pieceReference = text("PieceRef");
  if (pieceReference === null && positions.PieceRef !== undefined) {
    issues.push(
      issue(
        "FEC_PIECE_MISSING",
        "INFO",
        "Référence de pièce absente : la traçabilité de cette ligne s'arrête à son écriture.",
        "PieceRef",
      ),
    );
  }

  // ── Cohérences temporelles ───────────────────────────────────────────────────────────
  if (
    validationDate !== null &&
    parsedEntryDate.value !== null &&
    validationDate < parsedEntryDate.value
  ) {
    issues.push(
      issue(
        "FEC_VALID_DATE_BEFORE_ENTRY",
        "WARNING",
        "Date de validation antérieure à la date d'écriture.",
        "ValidDate",
        validationDate,
      ),
    );
  }
  if (
    context.fiscalYear &&
    parsedEntryDate.value !== null &&
    (parsedEntryDate.value < context.fiscalYear.start ||
      parsedEntryDate.value > context.fiscalYear.end)
  ) {
    issues.push(
      issue(
        "FEC_DATE_OUT_OF_FISCAL_YEAR",
        "WARNING",
        `Écriture hors de l'exercice déclaré (${context.fiscalYear.start} → ${context.fiscalYear.end}).`,
        "EcritureDate",
        parsedEntryDate.value,
      ),
    );
  }

  const pcgGroup = accountNumber ? pcgGroupOf(accountNumber) : "UNCLASSIFIED";
  if (accountNumber !== null && pcgGroup === "UNCLASSIFIED") {
    issues.push(
      issue(
        "FEC_ACCOUNT_UNKNOWN_CLASS",
        "WARNING",
        "Compte hors nomenclature reconnue : il ne participera à aucune reconstruction.",
        "CompteNum",
        accountNumber,
      ),
    );
  }

  return {
    rowNumber: row.rowNumber,
    journalCode,
    journalLabel: text("JournalLib"),
    entryNumber,
    entryDate: parsedEntryDate.value,
    accountNumber,
    accountLabel: text("CompteLib"),
    auxAccountNumber: text("CompAuxNum"),
    auxAccountLabel: text("CompAuxLib"),
    pieceReference,
    pieceDate,
    entryLabel: text("EcritureLib"),
    debit,
    credit,
    letterCode,
    letterDate,
    validationDate,
    currencyAmount,
    currencyCode,
    pcgClass: accountNumber ? pcgClassOf(accountNumber) : null,
    pcgGroup,
    status: statusFromIssues(issues),
    issues,
  };
}

/**
 * Groupe les lignes en écritures et contrôle la partie double.
 *
 * La clé est (journal, numéro d'écriture) : c'est l'identité que le format donne à une
 * écriture. Les lignes bloquées ne participent pas — contrôler l'équilibre d'une écriture
 * dont un montant est illisible produirait un faux déséquilibre.
 */
export function groupFecEntries(lines: readonly FecLine[]): {
  entries: FecEntry[];
  issues: Map<number, ImportIssue[]>;
} {
  const byKey = new Map<string, FecEntry>();
  for (const line of lines) {
    if (line.status === "BLOCKED" || line.journalCode === null || line.entryNumber === null)
      continue;
    const key = `${line.journalCode}|${line.entryNumber}`;
    const existing = byKey.get(key);
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    if (existing) {
      existing.lineNumbers.push(line.rowNumber);
      existing.totalDebit = round(existing.totalDebit + debit);
      existing.totalCredit = round(existing.totalCredit + credit);
      if (existing.entryDate === null) existing.entryDate = line.entryDate;
    } else {
      byKey.set(key, {
        journalCode: line.journalCode,
        entryNumber: line.entryNumber,
        entryDate: line.entryDate,
        lineNumbers: [line.rowNumber],
        totalDebit: round(debit),
        totalCredit: round(credit),
        imbalance: 0,
        balanced: true,
      });
    }
  }

  const issues = new Map<number, ImportIssue[]>();
  const entries = [...byKey.values()].map((entry) => {
    const imbalance = round(entry.totalDebit - entry.totalCredit);
    const balanced = Math.abs(imbalance) <= BALANCE_TOLERANCE;
    if (!balanced) {
      // L'anomalie porte sur CHAQUE ligne de l'écriture : l'utilisateur ne peut pas
      // corriger un déséquilibre en regardant une ligne isolée.
      for (const rowNumber of entry.lineNumbers) {
        issues.set(rowNumber, [
          ...(issues.get(rowNumber) ?? []),
          issue(
            "FEC_ENTRY_UNBALANCED",
            "WARNING",
            `Écriture ${entry.journalCode} n° ${entry.entryNumber} déséquilibrée de ${imbalance.toFixed(2)} : débits ${entry.totalDebit.toFixed(2)}, crédits ${entry.totalCredit.toFixed(2)}.`,
          ),
        ]);
      }
    }
    return { ...entry, imbalance, balanced };
  });

  return { entries, issues };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export { decodeSourceBytes, parseDelimited };
