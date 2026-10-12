/**
 * ÉCHÉANCIER TABULAIRE — lecture d'un CSV ou d'un XLSX en CANDIDATS (B19).
 *
 * Fonction pure, sans React, sans base, sans réseau. Elle ne calcule AUCUNE finance : elle
 * rend des cases localisées (ligne, colonne, cellule), leurs anomalies et la DÉFINITION des
 * contrôles, dont l'arithmétique est faite en base sur les cases persistées (doctrine de
 * Document Intelligence : une charge forgée ne peut pas déclarer un échéancier cohérent).
 *
 * Ce que la lecture refuse de faire :
 *
 *   * deviner une colonne : sans en-tête de date reconnu, la lecture échoue, nommée ;
 *   * compléter une cellule : une colonne absente reste absente, une cellule vide reste vide ;
 *   * trancher une convention : décimale et jour/mois se résolvent par COLONNE, sinon les
 *     cases concernées sont bloquées ;
 *   * évaluer une formule : la valeur en cache est lue, et la case le SIGNALE ;
 *   * annoncer un échéancier complet qu'elle ne peut pas prouver : un extrait est partiel
 *     tant que son premier solde n'égale pas le capital du contrat ET que son dernier solde
 *     n'est pas nul.
 */

import {
  decodeSourceBytes,
  parseAmountWithConvention,
  parseCurrencyCell,
  parseDateWithConvention,
  resolveAmountConvention,
  resolveDateConvention,
} from "@/lib/acquisition/normalization";
import { detectDelimiter, parseDelimited } from "@/lib/acquisition/csv";
import { readWorkbook } from "@/lib/acquisition/xlsx";
import { documentIssue, type DocumentIssue, type ExtractionCheckDefinition } from "../types";
import {
  MONEY_ROLES,
  ROLE_KEYS,
  columnLetter,
  readHeader,
  type ScheduleColumnRole,
} from "./columns";

export const SCHEDULE_EXTRACTOR = "lfo-schedule-tabular";
export const SCHEDULE_EXTRACTOR_VERSION = "1.0.0";
export const SCHEDULE_SCHEMA_VERSION = "schedule-columns-v1";
/** Plafonds du cahier des charges B19 : ils REFUSENT, ils ne tronquent pas. */
export const MAX_SCHEDULE_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_SCHEDULE_LINES = 1200;

export type ScheduleSourceFormat = "CSV" | "XLSX";
export type ScheduleFieldUnit = "MONEY" | "DATE" | "TEXT";

export interface ScheduleColumn {
  index: number;
  letter: string;
  /** En-tête tel qu'imprimé. */
  label: string;
  role: ScheduleColumnRole | null;
  /** Clé utilisée dans les codes de case : rôle reconnu, sinon `col{lettre}`. */
  key: string;
}

/** Une cellule lue, prête à devenir une case de `document_extraction_fields`. */
export interface ScheduleField {
  /** `L{ligne}.{clé}` : ligne d'ÉCHÉANCIER (1 = première ligne de données), clé de colonne. */
  boxCode: string;
  lineNumber: number;
  /** Ligne telle que l'utilisateur la voit dans son tableur ou son éditeur. */
  rowNumber: number;
  sheetName: string | null;
  columnKey: string;
  columnLabel: string;
  /** Référence façon tableur (`C12`). */
  cellRef: string;
  /** Texte tel qu'écrit dans le fichier. `null` = cellule vide. */
  rawValue: string | null;
  normalizedValue: number | null;
  normalizedDate: string | null;
  unit: ScheduleFieldUnit;
  fromFormula: boolean;
  /** `UNKNOWN_BOX` : colonne sans rôle, conservée et jamais utilisée dans un calcul. */
  validationStatus: "EXTRACTED" | "BLOCKED" | "UNKNOWN_BOX";
  issues: DocumentIssue[];
}

export type ScheduleCompleteness = "COMPLETE" | "PARTIAL";

export interface ScheduleExtraction {
  family: "AMORTIZATION_SCHEDULE";
  extractor: string;
  extractorVersion: string;
  schemaVersion: string;
  sourceFormat: ScheduleSourceFormat | null;
  sheetName: string | null;
  status: "EXTRACTED" | "FAILED";
  columns: ScheduleColumn[];
  /** Devise des montants ; `null` = ni lue ni déclarée (la validation la réclamera). */
  currency: string | null;
  currencySource: "COLUMN" | "HEADER" | "CELL" | "DECLARED" | null;
  lineCount: number;
  firstDueDate: string | null;
  lastDueDate: string | null;
  completeness: ScheduleCompleteness;
  /** Pourquoi l'extrait n'est pas prouvé complet. Vide si et seulement si COMPLETE. */
  completenessReasons: string[];
  fields: ScheduleField[];
  checks: ExtractionCheckDefinition[];
  issues: DocumentIssue[];
}

export interface ScheduleReadInput {
  bytes: Uint8Array;
  fileName: string;
  /** Devise proposée à l'import (celle de la dette), visible et modifiable ; `null` = aucune. */
  declaredCurrency: string | null;
  /** Capital initial DÉCLARÉ du contrat, pour prouver qu'un extrait commence au début. */
  contractPrincipal: number | null;
}

interface Tabular {
  format: ScheduleSourceFormat;
  sheetName: string | null;
  headerRowNumber: number;
  headers: string[];
  rows: Array<{ rowNumber: number; cells: string[] }>;
  formulaCells: Set<string>;
  /** Formules SANS valeur en cache : la cellule n'est pas vide, elle est inconnue. */
  formulaWithoutValueCells: Set<string>;
  decodedDateCells: Set<string>;
  issues: DocumentIssue[];
}

type TabularResult = { ok: true; value: Tabular } | { ok: false; issues: DocumentIssue[] };

const fileIssue = (
  code: DocumentIssue["code"],
  message: string,
  severity: DocumentIssue["severity"] = "ERROR",
) => documentIssue(code, severity, null, null, null, message);

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03;
}

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? match[1]!.toLowerCase() : "";
}

/** Le format est DÉCLARÉ par l'extension et VÉRIFIÉ par le contenu. */
function readTabular(input: ScheduleReadInput): TabularResult {
  const extension = extensionOf(input.fileName);
  const zip = isZip(input.bytes);
  if (extension === "xlsx" && !zip) {
    return {
      ok: false,
      issues: [
        fileIssue(
          "SCHEDULE_FORMAT_REFUSED",
          "Le fichier porte l’extension .xlsx mais n’est pas un classeur : il n’est pas lu.",
        ),
      ],
    };
  }
  if (extension === "csv" && zip) {
    return {
      ok: false,
      issues: [
        fileIssue(
          "SCHEDULE_FORMAT_REFUSED",
          "Le fichier porte l’extension .csv mais contient une archive : il n’est pas lu.",
        ),
      ],
    };
  }
  if (extension !== "csv" && extension !== "xlsx") {
    return {
      ok: false,
      issues: [
        fileIssue(
          "SCHEDULE_FORMAT_REFUSED",
          "Seuls les échéanciers CSV et XLSX sont lus. Le PDF n’est pas encore pris en charge.",
        ),
      ],
    };
  }
  return extension === "xlsx" ? readXlsx(input.bytes) : readCsv(input.bytes);
}

function readCsv(bytes: Uint8Array): TabularResult {
  if (bytes.byteLength > MAX_SCHEDULE_CSV_BYTES) {
    return {
      ok: false,
      issues: [
        fileIssue(
          "SCHEDULE_FILE_TOO_LARGE",
          `Fichier de ${bytes.byteLength} octets pour un plafond de ${MAX_SCHEDULE_CSV_BYTES} : il est refusé, jamais tronqué.`,
        ),
      ],
    };
  }
  const decoded = decodeSourceBytes(bytes);
  const delimiter = detectDelimiter(decoded.text);
  const document = parseDelimited(decoded.text, delimiter.delimiter, {
    maxRows: MAX_SCHEDULE_LINES + 1,
  });
  const issues: DocumentIssue[] = [...decoded.issues, ...delimiter.issues, ...document.issues].map(
    (entry) =>
      documentIssue(
        entry.severity === "ERROR" ? "SCHEDULE_FORMAT_REFUSED" : "SCHEDULE_SOURCE_NOTICE",
        entry.severity,
        null,
        null,
        entry.sourceValue,
        entry.message,
      ),
  );
  if (
    document.issues.some((entry) => entry.severity === "ERROR") ||
    delimiter.issues.some((entry) => entry.severity === "ERROR")
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      format: "CSV",
      sheetName: null,
      headerRowNumber: 1,
      headers: document.headers,
      rows: document.rows
        .filter((row) => row.cells.some((cell) => cell.trim().length > 0))
        .map((row) => ({ rowNumber: row.rowNumber, cells: row.cells })),
      formulaCells: new Set(),
      formulaWithoutValueCells: new Set(),
      decodedDateCells: new Set(),
      issues,
    },
  };
}

/** Un en-tête est « reconnu » s'il porte une date et au moins un montant. */
function recognisedHeader(cells: readonly string[]): boolean {
  const roles = cells.map((cell) => readHeader(cell).role);
  return roles.includes("DUE_DATE") && roles.some((role) => role !== null && MONEY_ROLES.has(role));
}

function readXlsx(bytes: Uint8Array): TabularResult {
  const workbook = readWorkbook(bytes);
  if (!workbook.ok) {
    return {
      ok: false,
      issues: [
        fileIssue(
          workbook.code === "FILE_TOO_LARGE"
            ? "SCHEDULE_FILE_TOO_LARGE"
            : "SCHEDULE_FORMAT_REFUSED",
          workbook.code === "MACRO_ENABLED"
            ? "Classeur porteur de macros : il est refusé, pas lu partiellement."
            : workbook.message,
        ),
      ],
    };
  }
  const candidates = workbook.sheets.filter((sheet) =>
    sheet.rows.some((row) => recognisedHeader(row)),
  );
  const chosen = candidates[0];
  if (!chosen) {
    return {
      ok: false,
      issues: [
        fileIssue(
          "SCHEDULE_HEADER_NOT_FOUND",
          "Aucune feuille ne porte un en-tête d’échéancier reconnu (une date et au moins un montant).",
        ),
      ],
    };
  }
  const issues: DocumentIssue[] = [];
  if (candidates.length > 1) {
    issues.push(
      fileIssue(
        "SCHEDULE_OTHER_SHEETS_IGNORED",
        `Plusieurs feuilles ressemblent à un échéancier ; seule « ${chosen.name} » est lue. Les autres ne le sont PAS : ${candidates
          .slice(1)
          .map((sheet) => sheet.name)
          .join(", ")}.`,
        "WARNING",
      ),
    );
  }
  const headerIndex = chosen.rows.findIndex((row) => recognisedHeader(row));
  const rowNumberAt = (index: number) => chosen.rowNumbers[index] ?? index + 1;
  const decoded = new Set(
    workbook.issues
      .filter((entry) => entry.code === "DATE_SERIAL_DECODED" && entry.sheet === chosen.name)
      .map((entry) => entry.cell)
      .filter((cell): cell is string => cell !== null),
  );
  const withoutValue = new Set<string>();
  for (const entry of workbook.issues) {
    if (entry.sheet !== null && entry.sheet !== chosen.name) continue;
    if (entry.code === "DATE_SERIAL_DECODED" || entry.code === "FORMULA_CACHED_VALUE") continue;
    if (entry.code === "FORMULA_WITHOUT_VALUE" && entry.cell) withoutValue.add(entry.cell);
    issues.push(
      documentIssue(
        entry.code.startsWith("FORMULA") ? "SCHEDULE_FORMULA_CELL" : "SCHEDULE_SOURCE_NOTICE",
        entry.severity,
        null,
        null,
        entry.cell,
        entry.message,
      ),
    );
  }
  return {
    ok: true,
    value: {
      format: "XLSX",
      sheetName: chosen.name,
      headerRowNumber: rowNumberAt(headerIndex),
      headers: chosen.rows[headerIndex]!.map((cell) => cell.replace(/\s+/g, " ").trim()),
      rows: chosen.rows
        .slice(headerIndex + 1)
        .map((cells, offset) => ({ rowNumber: rowNumberAt(headerIndex + 1 + offset), cells }))
        .filter((row) => row.cells.some((cell) => cell.trim().length > 0)),
      formulaCells: new Set(chosen.formulaCells),
      formulaWithoutValueCells: withoutValue,
      decodedDateCells: decoded,
      issues,
    },
  };
}

function failed(
  input: ScheduleReadInput,
  format: ScheduleSourceFormat | null,
  issues: DocumentIssue[],
): ScheduleExtraction {
  return {
    family: "AMORTIZATION_SCHEDULE",
    extractor: SCHEDULE_EXTRACTOR,
    extractorVersion: SCHEDULE_EXTRACTOR_VERSION,
    schemaVersion: SCHEDULE_SCHEMA_VERSION,
    sourceFormat: format,
    sheetName: null,
    status: "FAILED",
    columns: [],
    currency: input.declaredCurrency,
    currencySource: input.declaredCurrency ? "DECLARED" : null,
    lineCount: 0,
    firstDueDate: null,
    lastDueDate: null,
    completeness: "PARTIAL",
    completenessReasons: ["Lecture en échec : aucun échéancier n’a été lu."],
    fields: [],
    checks: [],
    issues,
  };
}

/** Attribue les rôles : un rôle revendiqué par deux colonnes n'est attribué à aucune. */
function buildColumns(headers: readonly string[], issues: DocumentIssue[]) {
  const readings = headers.map((label) => ({ label, ...readHeader(label) }));
  const claims = new Map<ScheduleColumnRole, number>();
  for (const reading of readings) {
    if (reading.role) claims.set(reading.role, (claims.get(reading.role) ?? 0) + 1);
  }
  const headerCurrencies = new Set<string>();
  const columns: ScheduleColumn[] = readings.map((reading, index) => {
    const letter = columnLetter(index);
    if (reading.currency && reading.role && MONEY_ROLES.has(reading.role)) {
      headerCurrencies.add(reading.currency);
    }
    let role = reading.role;
    if (role && (claims.get(role) ?? 0) > 1) {
      issues.push(
        documentIssue(
          "SCHEDULE_COLUMN_DUPLICATE_ROLE",
          "WARNING",
          null,
          null,
          reading.label,
          `Plusieurs colonnes se présentent comme « ${reading.label} » : aucune n’est retenue, la lecture serait arbitraire.`,
        ),
      );
      role = null;
    } else if (reading.ambiguous) {
      issues.push(
        documentIssue(
          "SCHEDULE_COLUMN_AMBIGUOUS",
          "WARNING",
          null,
          null,
          reading.label,
          `« ${reading.label} » ne dit pas s’il s’agit du solde avant ou après l’échéance : la colonne est conservée sans rôle.`,
        ),
      );
    } else if (!role && reading.label.length > 0) {
      issues.push(
        documentIssue(
          "SCHEDULE_COLUMN_UNRECOGNISED",
          "INFO",
          null,
          null,
          reading.label,
          `Colonne « ${reading.label} » non reconnue : conservée, jamais utilisée dans un calcul.`,
        ),
      );
    }
    return {
      index,
      letter,
      label: reading.label,
      role,
      key: role ? ROLE_KEYS[role] : `col${letter}`,
    };
  });
  return { columns, headerCurrencies };
}

/** Écart en mois calendaires entre deux dates ISO (le jour est ignoré). */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Lit un échéancier. Le résultat ne contient AUCUN total, aucun coût : il contient ce que le
 * fichier écrit, localisé, et ce qu'il faudra vérifier.
 */
export function readScheduleDocument(input: ScheduleReadInput): ScheduleExtraction {
  const tabular = readTabular(input);
  if (!tabular.ok) return failed(input, null, tabular.issues);
  const source = tabular.value;
  const issues = [...source.issues];

  if (source.rows.length > MAX_SCHEDULE_LINES) {
    return failed(input, source.format, [
      ...issues,
      fileIssue(
        "SCHEDULE_TOO_MANY_ROWS",
        `${source.rows.length} lignes de données pour un plafond de ${MAX_SCHEDULE_LINES} : le fichier est refusé, jamais tronqué.`,
      ),
    ]);
  }

  const { columns, headerCurrencies } = buildColumns(source.headers, issues);
  const byRole = new Map<ScheduleColumnRole, ScheduleColumn>();
  for (const column of columns) if (column.role) byRole.set(column.role, column);
  const dateColumn = byRole.get("DUE_DATE");
  if (!dateColumn) {
    return failed(input, source.format, [
      ...issues,
      fileIssue(
        "SCHEDULE_DATE_COLUMN_MISSING",
        "Aucune colonne de date d’échéance reconnue : sans date, aucune ligne n’est datable et rien n’est lu.",
      ),
    ]);
  }

  const cellOf = (row: { cells: string[] }, column: ScheduleColumn) =>
    (row.cells[column.index] ?? "").trim();

  // Conventions tranchées par COLONNE, jamais par cellule.
  const amountConventions = new Map(
    columns
      .filter((column) => column.role && MONEY_ROLES.has(column.role))
      .map((column) => [
        column.index,
        resolveAmountConvention(source.rows.map((row) => cellOf(row, column))),
      ]),
  );
  const dateConvention = resolveDateConvention(source.rows.map((row) => cellOf(row, dateColumn)));

  // Devise : lue (colonne, en-tête, symbole des cellules), sinon déclarée, jamais supposée.
  const currencyColumn = byRole.get("CURRENCY");
  const read = new Set<string>();
  let currencySource: ScheduleExtraction["currencySource"] = null;
  if (currencyColumn) {
    for (const row of source.rows) {
      const parsed = parseCurrencyCell(cellOf(row, currencyColumn));
      if (parsed.value) read.add(parsed.value);
    }
    if (read.size > 0) currencySource = "COLUMN";
  }
  if (read.size === 0 && headerCurrencies.size > 0) {
    headerCurrencies.forEach((code) => read.add(code));
    currencySource = "HEADER";
  }
  if (read.size === 0) {
    for (const column of columns) {
      if (!column.role || !MONEY_ROLES.has(column.role)) continue;
      for (const row of source.rows) {
        const cell = cellOf(row, column);
        if (/€|\bEUR\b/i.test(cell)) read.add("EUR");
        else if (/\$|\bUSD\b/i.test(cell)) read.add("USD");
        else if (/£|\bGBP\b/i.test(cell)) read.add("GBP");
        else if (/\bCHF\b/i.test(cell)) read.add("CHF");
      }
    }
    if (read.size > 0) currencySource = "CELL";
  }
  let currency: string | null = null;
  if (read.size > 1) {
    issues.push(
      fileIssue(
        "SCHEDULE_CURRENCY_CONFLICT",
        `Le fichier mentionne plusieurs devises (${[...read].join(", ")}) : aucune n’est retenue, la validation l’exigera.`,
      ),
    );
    currencySource = null;
  } else if (read.size === 1) {
    currency = [...read][0]!;
    if (input.declaredCurrency && input.declaredCurrency !== currency) {
      issues.push(
        fileIssue(
          "SCHEDULE_CURRENCY_CONFLICT",
          `Le fichier est en ${currency}, la devise déclarée à l’import est ${input.declaredCurrency} : aucune n’est retenue en silence.`,
        ),
      );
      currency = null;
      currencySource = null;
    }
  } else if (input.declaredCurrency) {
    currency = input.declaredCurrency;
    currencySource = "DECLARED";
  } else {
    issues.push(
      fileIssue(
        "SCHEDULE_CURRENCY_UNDECLARED",
        "Aucune devise n’est lue dans le fichier ni déclarée à l’import : la validation l’exigera.",
        "WARNING",
      ),
    );
  }

  // Cases.
  const fields: ScheduleField[] = [];
  const dueDates: Array<{ line: number; date: string | null }> = [];
  source.rows.forEach((row, rowIndex) => {
    const line = rowIndex + 1;
    for (const column of columns) {
      const raw = cellOf(row, column);
      const cellRef = `${column.letter}${row.rowNumber}`;
      const boxCode = `L${line}.${column.key}`;
      const fromFormula = source.formulaCells.has(cellRef);
      const fieldIssues: DocumentIssue[] = [];
      // Formule sans valeur en cache : la cellule n'est PAS vide, sa valeur est inconnue.
      const unknownFormula = source.formulaWithoutValueCells.has(cellRef);
      if (unknownFormula) {
        fieldIssues.push(
          documentIssue(
            "SCHEDULE_FORMULA_CELL",
            "ERROR",
            null,
            boxCode,
            null,
            "Formule sans valeur en cache : la valeur est inconnue, elle n’est ni lue ni calculée.",
          ),
        );
      }
      if (fromFormula) {
        fieldIssues.push(
          documentIssue(
            "SCHEDULE_FORMULA_CELL",
            "INFO",
            null,
            boxCode,
            raw,
            "Valeur calculée par une formule du tableur : c’est la valeur en cache qui est lue, la formule n’est pas évaluée.",
          ),
        );
      }
      const base = {
        boxCode,
        lineNumber: line,
        rowNumber: row.rowNumber,
        sheetName: source.sheetName,
        columnKey: column.key,
        columnLabel: column.label,
        cellRef,
        rawValue: raw.length > 0 ? raw : null,
        fromFormula,
      };
      if (!column.role || column.role === "CURRENCY") {
        fields.push({
          ...base,
          normalizedValue: null,
          normalizedDate: null,
          unit: "TEXT",
          validationStatus: column.role ? "EXTRACTED" : "UNKNOWN_BOX",
          issues: fieldIssues,
        });
        continue;
      }
      if (unknownFormula) {
        fields.push({
          ...base,
          normalizedValue: null,
          normalizedDate: null,
          unit: column.role === "DUE_DATE" ? "DATE" : "MONEY",
          validationStatus: "BLOCKED",
          issues: fieldIssues,
        });
        if (column.role === "DUE_DATE") dueDates.push({ line, date: null });
        continue;
      }
      if (column.role === "DUE_DATE") {
        const parsed = parseDateWithConvention(raw, dateConvention);
        if (source.decodedDateCells.has(cellRef)) {
          fieldIssues.push(
            documentIssue(
              "SCHEDULE_DATE_SERIAL_DECODED",
              "INFO",
              null,
              boxCode,
              raw,
              "Date stockée par le tableur en numéro de série, décodée selon l’époque du classeur.",
            ),
          );
        }
        const blocked = parsed.code !== "OK" && parsed.code !== "EMPTY";
        if (blocked) {
          fieldIssues.push(
            documentIssue(
              parsed.code === "AMBIGUOUS"
                ? "BOX_VALUE_AMBIGUOUS_CONVENTION"
                : "BOX_VALUE_UNREADABLE",
              "ERROR",
              null,
              boxCode,
              raw,
              parsed.code === "AMBIGUOUS"
                ? "Aucune date de la colonne ne tranche entre jour/mois et mois/jour : la date n’est pas lue."
                : parsed.code === "NOT_A_CALENDAR_DATE"
                  ? "Cette date n’existe pas au calendrier."
                  : "Date illisible.",
            ),
          );
        }
        dueDates.push({ line, date: parsed.value });
        fields.push({
          ...base,
          normalizedValue: null,
          normalizedDate: parsed.value,
          unit: "DATE",
          validationStatus: blocked ? "BLOCKED" : "EXTRACTED",
          issues: fieldIssues,
        });
        continue;
      }
      const parsed = parseAmountWithConvention(raw, amountConventions.get(column.index)!);
      let blocked = parsed.code === "AMBIGUOUS" || parsed.code === "UNPARSEABLE";
      if (blocked) {
        fieldIssues.push(
          documentIssue(
            parsed.code === "AMBIGUOUS" ? "BOX_VALUE_AMBIGUOUS_CONVENTION" : "BOX_VALUE_UNREADABLE",
            "ERROR",
            null,
            boxCode,
            raw,
            parsed.code === "AMBIGUOUS"
              ? "Aucune valeur de la colonne ne tranche entre virgule décimale et séparateur de milliers : le montant n’est pas lu."
              : "Montant illisible.",
          ),
        );
      } else if (parsed.value !== null && parsed.value < 0) {
        blocked = true;
        fieldIssues.push(
          documentIssue(
            "SCHEDULE_NEGATIVE_AMOUNT",
            "ERROR",
            null,
            boxCode,
            raw,
            "Montant négatif : un échéancier ne porte pas de montant signé, la case est bloquée.",
          ),
        );
      }
      fields.push({
        ...base,
        normalizedValue: blocked ? null : parsed.value,
        normalizedDate: null,
        unit: "MONEY",
        validationStatus: blocked ? "BLOCKED" : "EXTRACTED",
        issues: fieldIssues,
      });
    }
  });

  // Contrôles de FORME, portés par les cases : ordre, unicité, trous de périodicité.
  const dated = dueDates.filter(
    (entry): entry is { line: number; date: string } => entry.date !== null,
  );
  const seen = new Map<string, number>();
  for (const entry of dated) {
    const previousLine = seen.get(entry.date);
    if (previousLine !== undefined) {
      issues.push(
        documentIssue(
          "SCHEDULE_DUPLICATE_DUE_DATE",
          "ERROR",
          null,
          `L${entry.line}.date`,
          entry.date,
          `L’échéance du ${entry.date} apparaît aux lignes ${previousLine} et ${entry.line} : doublon à résoudre avant validation.`,
        ),
      );
    } else {
      seen.set(entry.date, entry.line);
    }
  }
  for (let index = 1; index < dated.length; index += 1) {
    if (dated[index]!.date < dated[index - 1]!.date) {
      issues.push(
        documentIssue(
          "SCHEDULE_DATES_NOT_INCREASING",
          "ERROR",
          null,
          `L${dated[index]!.line}.date`,
          dated[index]!.date,
          `La ligne ${dated[index]!.line} est datée avant la ligne ${dated[index - 1]!.line} : l’ordre des échéances est à vérifier.`,
        ),
      );
    }
  }
  const steps: number[] = [];
  for (let index = 1; index < dated.length; index += 1) {
    const step = monthsBetween(dated[index - 1]!.date, dated[index]!.date);
    if (step > 0) steps.push(step);
  }
  if (steps.length >= 2) {
    const counts = new Map<number, number>();
    steps.forEach((step) => counts.set(step, (counts.get(step) ?? 0) + 1));
    const [usual, frequency] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
    // Une périodicité n'est retenue que si elle est MAJORITAIRE : sinon, signaler des trous
    // reviendrait à imposer une périodicité que le fichier ne montre pas.
    if (frequency * 2 > steps.length) {
      for (let index = 1; index < dated.length; index += 1) {
        const step = monthsBetween(dated[index - 1]!.date, dated[index]!.date);
        if (step > usual && step % usual === 0) {
          issues.push(
            documentIssue(
              "SCHEDULE_PERIOD_GAP",
              "WARNING",
              null,
              `L${dated[index]!.line}.date`,
              dated[index]!.date,
              `Entre les lignes ${dated[index - 1]!.line} et ${dated[index]!.line}, ${step / usual - 1} échéance(s) manquent selon la périodicité du fichier. Rien n’est reconstitué.`,
            ),
          );
        }
      }
    }
  }

  // Définitions des contrôles, CALCULÉS en base sur les cases persistées.
  const checks: ExtractionCheckDefinition[] = [];
  const lineCount = source.rows.length;
  const has = (...roles: ScheduleColumnRole[]) => roles.every((role) => byRole.has(role));
  const missing = (...roles: ScheduleColumnRole[]) =>
    roles.filter((role) => !byRole.has(role)).map((role) => ROLE_KEYS[role]);
  const notComputable = (
    checkCode: string,
    label: string,
    absent: string[],
    message: string,
  ): ExtractionCheckDefinition => ({
    checkCode,
    label,
    severity: "BLOCKING",
    tolerance: 0,
    // Codes qui ne désignent aucune case : la base rendra le contrôle NON CALCULABLE.
    left: absent.map((key) => `ABSENT.${key}`),
    right: [`ABSENT.${absent[0] ?? "colonne"}`],
    message,
    unresolved: absent,
  });
  if (has("OPENING_BALANCE", "PRINCIPAL", "CLOSING_BALANCE")) {
    for (let line = 1; line <= lineCount; line += 1) {
      checks.push({
        checkCode: `ROW_BALANCE:${line}`,
        label: `Ligne ${line} : ouverture − capital = clôture`,
        severity: "BLOCKING",
        tolerance: 0,
        left: [`L${line}.opening`],
        right: [`L${line}.principal`, `L${line}.closing`],
        message: "Le solde d’ouverture moins le capital amorti doit égaler le solde de clôture.",
        unresolved: [],
      });
    }
  } else {
    const absent = missing("OPENING_BALANCE", "PRINCIPAL", "CLOSING_BALANCE");
    checks.push(
      notComputable(
        "ROW_BALANCE",
        "Ouverture − capital = clôture",
        absent,
        "Contrôle non calculable : colonnes absentes du fichier.",
      ),
    );
    issues.push(
      fileIssue(
        "SCHEDULE_CHECK_COLUMNS_MISSING",
        `Ouverture − capital = clôture n’est pas vérifiable : colonne(s) absente(s) (${absent.join(", ")}).`,
        "WARNING",
      ),
    );
  }
  if (has("TOTAL_PAYMENT", "PRINCIPAL", "INTEREST", "INSURANCE", "FEES")) {
    for (let line = 1; line <= lineCount; line += 1) {
      checks.push({
        checkCode: `ROW_TOTAL:${line}`,
        label: `Ligne ${line} : total = capital + intérêts + assurance + frais`,
        severity: "BLOCKING",
        tolerance: 0,
        left: [`L${line}.total`],
        right: [`L${line}.principal`, `L${line}.interest`, `L${line}.insurance`, `L${line}.fees`],
        message: "Le total débité doit égaler la somme de ses composants.",
        unresolved: [],
      });
    }
  } else {
    const absent = missing("TOTAL_PAYMENT", "PRINCIPAL", "INTEREST", "INSURANCE", "FEES");
    checks.push(
      notComputable(
        "ROW_TOTAL",
        "Total = capital + intérêts + assurance + frais",
        absent,
        "Contrôle non calculable : colonnes absentes du fichier. Le total peut être prouvable alors que sa ventilation ne l’est pas.",
      ),
    );
    issues.push(
      fileIssue(
        "SCHEDULE_CHECK_COLUMNS_MISSING",
        `La ventilation du total n’est pas vérifiable : colonne(s) absente(s) (${absent.join(", ")}).`,
        "WARNING",
      ),
    );
  }
  if (has("OPENING_BALANCE", "CLOSING_BALANCE")) {
    for (let line = 1; line < lineCount; line += 1) {
      checks.push({
        checkCode: `CHAIN:${line}`,
        label: `Lignes ${line} et ${line + 1} : clôture = ouverture suivante`,
        severity: "BLOCKING",
        tolerance: 0,
        left: [`L${line}.closing`],
        right: [`L${line + 1}.opening`],
        message: "Le solde de clôture d’une ligne doit égaler le solde d’ouverture de la suivante.",
        unresolved: [],
      });
    }
  }

  // Complétude : prouvée, jamais présumée.
  const valueOf = (line: number, key: string) =>
    fields.find((field) => field.lineNumber === line && field.columnKey === key)?.normalizedValue ??
    null;
  const reasons: string[] = [];
  if (lineCount === 0) reasons.push("Aucune ligne de données.");
  if (!byRole.has("OPENING_BALANCE"))
    reasons.push("Colonne de solde d’ouverture absente : le début du prêt n’est pas vérifiable.");
  else if (input.contractPrincipal === null)
    reasons.push("Capital initial du contrat non déclaré : le début du prêt n’est pas vérifiable.");
  else if (lineCount > 0 && valueOf(1, "opening") !== input.contractPrincipal)
    reasons.push(
      "Le premier solde d’ouverture diffère du capital initial du contrat : l’extrait commence en cours de prêt.",
    );
  if (!byRole.has("CLOSING_BALANCE"))
    reasons.push("Colonne de solde de clôture absente : la fin du prêt n’est pas vérifiable.");
  else if (lineCount > 0 && valueOf(lineCount, "closing") !== 0)
    reasons.push("Le dernier solde de clôture n’est pas nul : l’extrait s’arrête avant la fin.");
  if (reasons.length > 0) {
    issues.push(
      fileIssue(
        "SCHEDULE_PARTIAL_EXTRACT",
        "Extrait partiel : aucun coût total du prêt n’est annoncé à partir de ces lignes.",
        "WARNING",
      ),
    );
  }

  return {
    family: "AMORTIZATION_SCHEDULE",
    extractor: SCHEDULE_EXTRACTOR,
    extractorVersion: SCHEDULE_EXTRACTOR_VERSION,
    schemaVersion: SCHEDULE_SCHEMA_VERSION,
    sourceFormat: source.format,
    sheetName: source.sheetName,
    status: "EXTRACTED",
    columns,
    currency,
    currencySource: currency === null ? null : currencySource,
    lineCount,
    firstDueDate: dated.length > 0 ? dated.reduce((a, b) => (b.date < a.date ? b : a)).date : null,
    lastDueDate: dated.length > 0 ? dated.reduce((a, b) => (b.date > a.date ? b : a)).date : null,
    completeness: reasons.length === 0 ? "COMPLETE" : "PARTIAL",
    completenessReasons: reasons,
    fields,
    checks,
    issues,
  };
}
