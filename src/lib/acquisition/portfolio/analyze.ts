/**
 * ANALYSE D'UN FICHIER DE PORTEFEUILLE
 *
 * Fonction pure. Elle ne lève jamais, n'écrit rien, et ne produit AUCUN fait canonique :
 * elle rend une lecture, avec ses ambiguïtés déclarées.
 *
 * Un seul chemin d'analyse pour les deux formats. CSV et XLSX diffèrent par la façon
 * d'obtenir un tableau de cellules ; tout ce qui suit — conventions, mapping, normalisation,
 * résolution d'instrument, déduplication — est identique. C'est ce qui garantit qu'un même
 * jeu de données donne le même résultat quel que soit le format d'export.
 *
 * Ce que l'analyse ne fait PAS :
 *
 *   * elle ne CLASSE aucun flux : un frais reste un frais parce que la source le dit ;
 *   * elle ne RECALCULE aucun solde d'enveloppe ;
 *   * elle ne RAPPROCHE aucun transfert interne ;
 *   * elle ne DÉCLARE aucune profondeur d'historique : un fichier qui commence en mars ne
 *     dit pas que janvier et février étaient vides ;
 *   * elle ne RECONSTRUIT aucune transaction depuis une position.
 */

import { detectDelimiter, formatSignature, parseDelimited } from "@/lib/acquisition/csv";
import {
  decodeSourceBytes,
  issue,
  parseAmountWithConvention,
  parseCurrencyCell,
  parseDateWithConvention,
  resolveAmountConvention,
  resolveDateConvention,
} from "@/lib/acquisition/normalization";
import type { ImportIssue, RawRow, SourceConventions } from "@/lib/acquisition/types";
import { readWorkbook, type WorkbookIssue } from "@/lib/acquisition/xlsx";

import { classifyEventCandidates, classifyPositionCandidates } from "./dedupe";
import type {
  EventDedupeCandidate,
  ExistingEventFact,
  ExistingEventIdentity,
  ExistingPositionObservation,
} from "./dedupe";
import { instrumentSourceKey, resolveInstruments, type KnownSecurity } from "./instruments";
import { inferPortfolioMapping, validatePortfolioMapping } from "./mapping";
import {
  EVENT_TYPES_FORBIDDING_SECURITY,
  EVENT_TYPES_REQUIRING_SECURITY,
  PORTFOLIO_EVENT_TYPES,
  type InstrumentKey,
  type NormalizedLedgerRow,
  type NormalizedPositionRow,
  type PortfolioAnalysis,
  type PortfolioColumnMapping,
  type PortfolioEventType,
  type PortfolioImportKind,
  type PortfolioRowCounts,
  type PortfolioTargetField,
} from "./types";

export const PORTFOLIO_PARSER = "portfolio-file";
export const PORTFOLIO_PARSER_VERSION = "1";
/** Au-delà, le fichier est REFUSÉ plutôt que tronqué : un portefeuille amputé est faux. */
export const MAX_PORTFOLIO_ROWS = 20_000;

/**
 * Vocabulaire des natures d'événement, en français et en anglais.
 *
 * Ce sont des SYNONYMES DE LIBELLÉ. Une valeur non reconnue laisse la nature à `null` et
 * bloque la ligne : deviner qu'un « OPS » est un achat écrirait un mouvement inventé.
 */
const EVENT_TYPE_SYNONYMS: Record<PortfolioEventType, readonly string[]> = {
  OPENING_POSITION: [
    "position initiale",
    "opening position",
    "solde initial titres",
    "stock initial",
  ],
  OPENING_CASH: ["solde initial", "opening cash", "solde initial especes", "cash initial"],
  CONTRIBUTION: ["versement", "apport", "depot", "contribution", "deposit", "virement entrant"],
  WITHDRAWAL: ["retrait", "rachat partiel", "withdrawal", "virement sortant"],
  BUY: ["achat", "souscription", "buy", "purchase", "acquisition"],
  SELL: ["vente", "cession", "sell", "sale", "rachat"],
  DIVIDEND: ["dividende", "coupon", "dividend", "distribution"],
  INTEREST: ["interet", "interets", "interest", "produit d interet"],
  FEE: ["frais", "commission", "droits de garde", "fee", "fees", "charge"],
  TAX: ["taxe", "impot", "prelevement", "tax", "withholding"],
  TRANSFER_IN: ["transfert entrant", "apport de titres", "transfer in", "entree de titres"],
  TRANSFER_OUT: ["transfert sortant", "sortie de titres", "transfer out"],
};

function foldToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Reconnaît une nature. Rend `null` plutôt qu'une nature approchante. */
export function readEventType(raw: string): PortfolioEventType | null {
  const folded = foldToken(raw);
  if (folded.length === 0) return null;
  // Une valeur qui est déjà le code canonique est acceptée telle quelle.
  const direct = PORTFOLIO_EVENT_TYPES.find((type) => foldToken(type) === folded);
  if (direct !== undefined) return direct;
  for (const type of PORTFOLIO_EVENT_TYPES) {
    for (const synonym of EVENT_TYPE_SYNONYMS[type]) {
      if (folded === synonym) return type;
    }
  }
  // Préfixe seulement, et sur le synonyme entier : « achat de titres » → BUY, mais
  // « rachat » ne doit pas devenir « achat ».
  for (const type of PORTFOLIO_EVENT_TYPES) {
    for (const synonym of EVENT_TYPE_SYNONYMS[type]) {
      if (folded.startsWith(`${synonym} `)) return type;
    }
  }
  return null;
}

export interface PortfolioAnalysisInput {
  bytes: Uint8Array;
  fileName: string;
  kind: PortfolioImportKind;
  /** Enveloppe cible. Un événement sans enveloppe ne serait réconciliable par rien. */
  accountId: string;
  /**
   * Devise DÉCLARÉE de l'enveloppe, utilisée en repli quand la source n'en porte pas. Le
   * repli est SIGNALÉ à chaque ligne : `FX ABSENT ≠ FX ÉGAL À 1`, et une devise supposée
   * reste une hypothèse.
   */
  declaredCurrency: string | null;
  /** Mapping confirmé par l'utilisateur. Absent = mapping inféré. */
  mapping?: PortfolioColumnMapping;
  /** Feuille choisie pour un XLSX. Absente = la première feuille non vide. */
  sheetName?: string | null;
  known: readonly KnownSecurity[];
  /** Décisions de résolution d'instrument déjà prises pour cette session. */
  instrumentDecisions?: ReadonlyMap<string, string | null>;
  existingEvents?: readonly ExistingEventFact[];
  existingIdentities?: readonly ExistingEventIdentity[];
  existingPositions?: readonly ExistingPositionObservation[];
  /** Clé de la source, pour préfixer une identité déclarée. */
  sourceKey: string;
  stableReferences?: boolean;
}

interface Tabular {
  format: "CSV" | "XLSX";
  headers: string[];
  rows: RawRow[];
  sheetName: string | null;
  otherSheets: string[];
  formulaCells: string[];
  issues: ImportIssue[];
  /** Signature de format, pour retrouver un mapping mémorisé. */
  signature: string;
  fatal: boolean;
}

/** Reconnaît le format par le CONTENU, jamais par l'extension seule. */
export function detectFormat(bytes: Uint8Array, fileName: string): "CSV" | "XLSX" {
  // Un XLSX est une archive ZIP : elle commence par « PK ». L'extension ne décide pas —
  // un fichier renommé en .csv resterait un classeur, et le lire comme du texte
  // produirait des lignes de binaire.
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "XLSX";
  void fileName;
  return "CSV";
}

function workbookIssueToImportIssue(entry: WorkbookIssue): ImportIssue {
  const severity = entry.severity;
  const where = entry.cell === null ? "" : ` (cellule ${entry.cell})`;
  switch (entry.code) {
    case "FORMULA_CACHED_VALUE":
    case "FORMULA_WITHOUT_VALUE":
    case "EXTERNAL_LINK":
    case "ERROR_CELL":
    case "SHARED_STRING_MISSING":
    case "DATE_SERIAL_DECODED":
      return issue("MAPPING_UNKNOWN_COLUMN", severity, `${entry.message}${where}`);
    default:
      return issue("COLUMN_COUNT_MISMATCH", severity, `${entry.message}${where}`);
  }
}

function readTabular(input: PortfolioAnalysisInput): Tabular {
  const format = detectFormat(input.bytes, input.fileName);

  if (format === "XLSX") {
    const workbook = readWorkbook(input.bytes);
    if (!workbook.ok) {
      return {
        format,
        headers: [],
        rows: [],
        sheetName: null,
        otherSheets: [],
        formulaCells: [],
        signature: "",
        fatal: true,
        issues: [
          issue(
            workbook.code === "FILE_TOO_LARGE" ? "FILE_TOO_MANY_ROWS" : "FILE_EMPTY",
            "ERROR",
            workbook.message,
          ),
        ],
      };
    }

    const issues = workbook.issues.map(workbookIssueToImportIssue);
    // Feuille choisie, sinon la première qui porte au moins deux lignes : une feuille de
    // garde d'une seule ligne n'est pas un tableau de données.
    const chosen =
      (input.sheetName
        ? workbook.sheets.find((sheet) => sheet.name === input.sheetName)
        : undefined) ??
      workbook.sheets.find((sheet) => sheet.rowCount >= 2) ??
      workbook.sheets[0];
    const otherSheets = workbook.sheets
      .filter((sheet) => sheet !== chosen)
      .map((sheet) => sheet.name);
    if (otherSheets.length > 0) {
      issues.push(
        issue(
          "MAPPING_UNKNOWN_COLUMN",
          "INFO",
          `Seule la feuille « ${chosen.name} » est lue. Les autres ne le sont PAS : ${otherSheets.join(", ")}`,
        ),
      );
    }

    const [headerRow, ...bodyRows] = chosen.rows;
    if (headerRow === undefined) {
      return {
        format,
        headers: [],
        rows: [],
        sheetName: chosen.name,
        otherSheets,
        formulaCells: chosen.formulaCells,
        signature: "",
        fatal: true,
        issues: [...issues, issue("FILE_EMPTY", "ERROR", "La feuille retenue est vide")],
      };
    }
    if (bodyRows.length > MAX_PORTFOLIO_ROWS) {
      return {
        format,
        headers: headerRow,
        rows: [],
        sheetName: chosen.name,
        otherSheets,
        formulaCells: chosen.formulaCells,
        signature: "",
        fatal: true,
        issues: [
          ...issues,
          issue(
            "FILE_TOO_MANY_ROWS",
            "ERROR",
            `${bodyRows.length} lignes de données pour un plafond de ${MAX_PORTFOLIO_ROWS} : le fichier est refusé, jamais tronqué`,
          ),
        ],
      };
    }

    return {
      format,
      headers: headerRow,
      // Le numéro de ligne est celui du TABLEUR : l'en-tête est la ligne 1.
      rows: bodyRows.map((cells, index) => ({
        rowNumber: index + 2,
        cells,
        rawLine: cells.join(" | "),
      })),
      sheetName: chosen.name,
      otherSheets,
      formulaCells: chosen.formulaCells,
      signature: formatSignature(headerRow, "XLSX"),
      fatal: false,
      issues,
    };
  }

  const decoded = decodeSourceBytes(input.bytes);
  const detection = detectDelimiter(decoded.text);
  const issues: ImportIssue[] = [...decoded.issues, ...detection.issues];
  if (detection.delimiter === null) {
    return {
      format,
      headers: [],
      rows: [],
      sheetName: null,
      otherSheets: [],
      formulaCells: [],
      signature: "",
      fatal: true,
      issues,
    };
  }
  const document = parseDelimited(decoded.text, detection.delimiter, {
    maxRows: MAX_PORTFOLIO_ROWS,
  });
  return {
    format,
    headers: document.headers,
    rows: document.rows,
    sheetName: null,
    otherSheets: [],
    formulaCells: [],
    signature: formatSignature(document.headers, detection.delimiter),
    fatal: document.headers.length === 0,
    issues: [...issues, ...document.issues],
  };
}

/** Colonne d'une ligne, ou chaîne vide. Une colonne absente n'est pas un zéro. */
function cellAt(row: RawRow, mapping: PortfolioColumnMapping, field: PortfolioTargetField): string {
  const index = mapping[field];
  if (index === undefined) return "";
  return row.cells[index] ?? "";
}

function columnValues(
  rows: readonly RawRow[],
  mapping: PortfolioColumnMapping,
  field: PortfolioTargetField,
): string[] {
  const index = mapping[field];
  if (index === undefined) return [];
  return rows.map((row) => row.cells[index] ?? "").filter((value) => value.trim().length > 0);
}

/**
 * Résout les conventions au niveau de la COLONNE, jamais de la cellule.
 *
 * C'est la même règle que l'import bancaire, et pour la même raison : choisir entre 1,234 et
 * 1 234 sur huit cents lignes n'est pas une décision de présentation. Une valeur qui tranche
 * la convention la fixe pour toute la colonne ; sans elle, les lignes concernées bloquent.
 */
function resolveConventions(
  rows: readonly RawRow[],
  mapping: PortfolioColumnMapping,
  kind: PortfolioImportKind,
): { conventions: SourceConventions; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const amountFields: PortfolioTargetField[] =
    kind === "PORTFOLIO_LEDGER"
      ? ["grossAmount", "unitPrice", "feeAmount", "taxAmount", "envelopeCashAmount", "quantity"]
      : ["marketValue", "costBasis", "quantity"];
  const amountCells = amountFields.flatMap((field) => columnValues(rows, mapping, field));
  const amount = resolveAmountConvention(amountCells);
  if (amount === "AMBIGUOUS") {
    issues.push(
      issue(
        "AMOUNT_CONVENTION_AMBIGUOUS",
        "ERROR",
        "Aucune valeur du fichier ne tranche entre virgule décimale et séparateur de milliers. Les lignes concernées sont bloquées : lire 1,234 comme 1 234 fausserait le patrimoine d'un facteur mille",
      ),
    );
  }

  const dateField: PortfolioTargetField = kind === "PORTFOLIO_LEDGER" ? "eventDate" : "asOfDate";
  const date = resolveDateConvention(columnValues(rows, mapping, dateField));
  if (date === "AMBIGUOUS") {
    issues.push(
      issue(
        "DATE_CONVENTION_AMBIGUOUS",
        "ERROR",
        "Aucune date du fichier ne tranche l'ordre jour/mois. Les lignes concernées sont bloquées plutôt que datées au hasard",
      ),
    );
  }

  const settlementCells = columnValues(rows, mapping, "settlementDate");
  const valueDate = settlementCells.length === 0 ? null : resolveDateConvention(settlementCells);

  return { conventions: { amount, date, valueDate }, issues };
}

function readAmount(
  row: RawRow,
  mapping: PortfolioColumnMapping,
  field: PortfolioTargetField,
  conventions: SourceConventions,
  issues: ImportIssue[],
  options: { required: boolean; label: string; allowNegative?: boolean },
): number | null {
  const raw = cellAt(row, mapping, field);
  if (mapping[field] === undefined) {
    if (options.required) {
      issues.push(
        issue(
          "MAPPING_REQUIRED_FIELD_MISSING",
          "ERROR",
          `${options.label} : aucune colonne mappée`,
          field,
        ),
      );
    }
    return null;
  }
  const parsed = parseAmountWithConvention(raw, conventions.amount);
  if (parsed.code === "EMPTY") {
    if (options.required) {
      issues.push(issue("AMOUNT_MISSING", "ERROR", `${options.label} : cellule vide`, field, raw));
    }
    // CELLULE VIDE ≠ ZÉRO. Un frais non renseigné n'est pas un frais nul.
    return null;
  }
  if (parsed.code !== "OK" || parsed.value === null) {
    issues.push(
      issue(
        parsed.code === "AMBIGUOUS" ? "AMOUNT_CONVENTION_AMBIGUOUS" : "AMOUNT_UNPARSEABLE",
        "ERROR",
        `${options.label} : « ${raw} » n'est pas un montant lisible sous la convention retenue`,
        field,
        raw,
      ),
    );
    return null;
  }
  if (parsed.value < 0 && options.allowNegative !== true) {
    issues.push(
      issue(
        "AMOUNT_UNPARSEABLE",
        "ERROR",
        `${options.label} : ${parsed.value} est négatif. La direction économique vient de la NATURE de l'événement, jamais du signe : un montant négatif ici serait compté deux fois`,
        field,
        raw,
      ),
    );
    return null;
  }
  return parsed.value;
}

function readDate(
  row: RawRow,
  mapping: PortfolioColumnMapping,
  field: PortfolioTargetField,
  convention: SourceConventions["date"],
  issues: ImportIssue[],
  options: { required: boolean; label: string },
): string | null {
  const raw = cellAt(row, mapping, field);
  if (mapping[field] === undefined) return null;
  const parsed = parseDateWithConvention(raw, convention);
  if (parsed.code === "EMPTY") {
    if (options.required) {
      issues.push(issue("DATE_MISSING", "ERROR", `${options.label} : cellule vide`, field, raw));
    }
    return null;
  }
  if (parsed.code !== "OK" || parsed.value === null) {
    issues.push(
      issue(
        parsed.code === "NOT_A_CALENDAR_DATE"
          ? "DATE_NOT_A_CALENDAR_DATE"
          : parsed.code === "AMBIGUOUS"
            ? "DATE_CONVENTION_AMBIGUOUS"
            : "DATE_UNPARSEABLE",
        "ERROR",
        `${options.label} : « ${raw} » n'est pas une date lisible`,
        field,
        raw,
      ),
    );
    return null;
  }
  if (parsed.twoDigitYear) {
    issues.push(
      issue(
        "DATE_TWO_DIGIT_YEAR",
        "WARNING",
        `${options.label} : année sur deux chiffres dans « ${raw} », le siècle est supposé`,
        field,
        raw,
      ),
    );
  }
  return parsed.value;
}

function readCurrency(
  row: RawRow,
  mapping: PortfolioColumnMapping,
  declared: string | null,
  issues: ImportIssue[],
): string | null {
  const raw = cellAt(row, mapping, "currency");
  if (mapping.currency !== undefined) {
    const parsed = parseCurrencyCell(raw);
    if (parsed.code === "OK" && parsed.value !== null) return parsed.value;
    if (parsed.code === "UNKNOWN") {
      issues.push(
        issue(
          "CURRENCY_UNKNOWN",
          "ERROR",
          `Devise « ${raw} » non reconnue : elle n'est pas remplacée par celle de l'enveloppe, car une devise supposée fausserait tout montant converti`,
          "currency",
          raw,
        ),
      );
      return null;
    }
  }
  if (declared !== null) {
    // Repli DÉCLARÉ, et signalé à chaque ligne : ce n'est pas une lecture de la source.
    issues.push(
      issue(
        "CURRENCY_FROM_SESSION_DECLARATION",
        "WARNING",
        `Devise absente de la source : celle déclarée pour l'enveloppe (${declared}) est retenue. C'est une hypothèse, pas une lecture`,
        "currency",
      ),
    );
    return declared;
  }
  issues.push(
    issue(
      "CURRENCY_MISSING",
      "ERROR",
      "Aucune devise dans la source et aucune devise déclarée pour l'enveloppe : le montant n'est pas interprétable, et FX ABSENT n'est pas FX ÉGAL À 1",
      "currency",
    ),
  );
  return null;
}

function countsOf(
  ledger: readonly NormalizedLedgerRow[],
  positions: readonly NormalizedPositionRow[],
): PortfolioRowCounts {
  const all = [...ledger.map((row) => row.status), ...positions.map((row) => row.status)];
  return {
    total: all.length,
    ready: all.filter((status) => status === "READY").length,
    warning: all.filter((status) => status === "WARNING").length,
    blocked: all.filter((status) => status === "BLOCKED").length,
    duplicate: all.filter((status) => status === "DUPLICATE").length,
    ignored: all.filter((status) => status === "IGNORED").length,
  };
}

/** Analyse complète. Ne lève jamais. */
export function analyzePortfolioFile(input: PortfolioAnalysisInput): PortfolioAnalysis {
  const tabular = readTabular(input);
  const base = {
    kind: input.kind,
    format: tabular.format,
    parser: PORTFOLIO_PARSER,
    parserVersion: PORTFOLIO_PARSER_VERSION,
    sheetName: tabular.sheetName,
    otherSheets: tabular.otherSheets,
    headers: tabular.headers,
    formulaCells: tabular.formulaCells,
    rawRows: tabular.rows.map((row) => ({
      rowNumber: row.rowNumber,
      cells: row.cells,
      rawLine: row.rawLine,
    })),
  };

  if (tabular.fatal) {
    return {
      ...base,
      mapping: {},
      mappingConfidence: "INCOMPLETE",
      conventions: { amount: "AMBIGUOUS", date: "AMBIGUOUS", valueDate: null },
      ledgerRows: [],
      positionRows: [],
      instruments: [],
      counts: countsOf([], []),
      issues: tabular.issues,
    };
  }

  const inferred = inferPortfolioMapping(tabular.headers, input.kind);
  const mapping = input.mapping ?? inferred.mapping;
  const mappingIssues =
    input.mapping === undefined
      ? inferred.issues
      : [
          ...validatePortfolioMapping(mapping, tabular.headers, input.kind),
          ...inferred.issues.filter((entry) => entry.code === "MAPPING_UNKNOWN_COLUMN"),
        ];

  const { conventions, issues: conventionIssues } = resolveConventions(
    tabular.rows,
    mapping,
    input.kind,
  );
  const issues: ImportIssue[] = [...tabular.issues, ...mappingIssues, ...conventionIssues];

  // Clés d'instrument rencontrées, regroupées : la décision porte sur le TITRE, pas la ligne.
  const keys = new Map<string, InstrumentKey>();
  for (const row of tabular.rows) {
    const key: InstrumentKey = {
      isin: nullableCell(row, mapping, "isin"),
      ticker: nullableCell(row, mapping, "ticker"),
      name: nullableCell(row, mapping, "instrumentName"),
    };
    const sourceKey = instrumentSourceKey(key);
    if (sourceKey !== null && !keys.has(sourceKey)) keys.set(sourceKey, key);
  }
  const instruments = resolveInstruments({
    keys,
    known: input.known,
    decisions: input.instrumentDecisions,
  });
  const instrumentBySourceKey = new Map(instruments.map((entry) => [entry.sourceKey, entry]));

  if (input.kind === "PORTFOLIO_LEDGER") {
    const rows = tabular.rows.map((row) =>
      normalizeLedgerRow({ row, mapping, conventions, input, instrumentBySourceKey }),
    );
    const candidates: EventDedupeCandidate[] = [];
    for (const row of rows) {
      const resolution =
        row.instrumentSourceKey === null
          ? null
          : instrumentBySourceKey.get(row.instrumentSourceKey);
      if (row.eventType === null || row.eventDate === null || row.currency === null) continue;
      candidates.push({
        rowNumber: row.rowNumber,
        accountId: input.accountId,
        securityId: resolution?.securityId ?? null,
        eventType: row.eventType,
        eventDate: row.eventDate,
        quantity: row.quantity,
        grossAmount: row.grossAmount,
        currency: row.currency,
        externalReference: row.externalReference,
      });
    }
    const outcomes = classifyEventCandidates({
      candidates,
      existingFacts: input.existingEvents ?? [],
      existingIdentities: input.existingIdentities ?? [],
      sourceKey: input.sourceKey,
      stableReferences: input.stableReferences ?? false,
    });
    const byRow = new Map(outcomes.map((outcome) => [outcome.rowNumber, outcome]));
    const ledgerRows = rows.map((row) => applyEventVerdict(row, byRow.get(row.rowNumber)));

    return {
      ...base,
      mapping,
      mappingConfidence: input.mapping === undefined ? inferred.confidence : "CERTAIN",
      conventions,
      ledgerRows,
      positionRows: [],
      instruments,
      counts: countsOf(ledgerRows, []),
      issues,
    };
  }

  const positionRows = tabular.rows.map((row) =>
    normalizePositionRow({ row, mapping, conventions, input, instrumentBySourceKey }),
  );
  const positionCandidates = positionRows
    .filter((row) => row.asOfDate !== null && row.instrumentSourceKey !== null)
    .flatMap((row) => {
      const resolution = instrumentBySourceKey.get(row.instrumentSourceKey!);
      if (resolution?.securityId == null) return [];
      return [
        {
          rowNumber: row.rowNumber,
          accountId: input.accountId,
          securityId: resolution.securityId,
          asOfDate: row.asOfDate!,
        },
      ];
    });
  const positionOutcomes = classifyPositionCandidates({
    candidates: positionCandidates,
    existing: input.existingPositions ?? [],
  });
  const positionByRow = new Map(positionOutcomes.map((outcome) => [outcome.rowNumber, outcome]));
  const decided = positionRows.map((row) =>
    applyPositionVerdict(row, positionByRow.get(row.rowNumber)),
  );

  return {
    ...base,
    mapping,
    mappingConfidence: input.mapping === undefined ? inferred.confidence : "CERTAIN",
    conventions,
    ledgerRows: [],
    positionRows: decided,
    instruments,
    counts: countsOf([], decided),
    issues,
  };
}

function nullableCell(
  row: RawRow,
  mapping: PortfolioColumnMapping,
  field: PortfolioTargetField,
): string | null {
  const value = cellAt(row, mapping, field).trim();
  return value.length === 0 ? null : value;
}

function isRowEmpty(row: RawRow): boolean {
  return row.cells.every((cell) => cell.trim().length === 0);
}

function normalizeLedgerRow(context: {
  row: RawRow;
  mapping: PortfolioColumnMapping;
  conventions: SourceConventions;
  input: PortfolioAnalysisInput;
  instrumentBySourceKey: Map<string, ReturnType<typeof resolveInstruments>[number]>;
}): NormalizedLedgerRow {
  const { row, mapping, conventions, input } = context;
  const issues: ImportIssue[] = [];

  const instrument: InstrumentKey = {
    isin: nullableCell(row, mapping, "isin"),
    ticker: nullableCell(row, mapping, "ticker"),
    name: nullableCell(row, mapping, "instrumentName"),
  };
  const instrumentKey = instrumentSourceKey(instrument);

  if (isRowEmpty(row)) {
    return {
      rowNumber: row.rowNumber,
      eventType: null,
      eventDate: null,
      settlementDate: null,
      instrument,
      instrumentSourceKey: null,
      quantity: null,
      unitPrice: null,
      grossAmount: null,
      feeAmount: null,
      taxAmount: null,
      envelopeCashAmount: null,
      currency: null,
      externalReference: null,
      label: null,
      status: "IGNORED",
      verdict: null,
      matchKey: null,
      externalKey: null,
      matchedEventId: null,
      issues: [issue("ROW_EMPTY", "INFO", "Ligne vide : ignorée, jamais comptée comme un zéro")],
    };
  }

  const rawType = cellAt(row, mapping, "eventType");
  const eventType = readEventType(rawType);
  if (eventType === null) {
    issues.push(
      issue(
        "MAPPING_UNKNOWN_COLUMN",
        "ERROR",
        `Nature d'opération « ${rawType} » non reconnue. Elle n'est pas devinée : un « achat » supposé écrirait un mouvement inventé`,
        "eventType",
        rawType,
      ),
    );
  }

  const eventDate = readDate(row, mapping, "eventDate", conventions.date, issues, {
    required: true,
    label: "Date d'opération",
  });
  const settlementDate =
    conventions.valueDate === null
      ? null
      : readDate(row, mapping, "settlementDate", conventions.valueDate, issues, {
          required: false,
          label: "Date de règlement",
        });

  const quantity = readAmount(row, mapping, "quantity", conventions, issues, {
    required: false,
    label: "Quantité",
  });
  const unitPrice = readAmount(row, mapping, "unitPrice", conventions, issues, {
    required: false,
    label: "Prix unitaire",
  });
  const grossAmount = readAmount(row, mapping, "grossAmount", conventions, issues, {
    required: false,
    label: "Montant brut",
  });
  const feeAmount = readAmount(row, mapping, "feeAmount", conventions, issues, {
    required: false,
    label: "Frais",
  });
  const taxAmount = readAmount(row, mapping, "taxAmount", conventions, issues, {
    required: false,
    label: "Taxes",
  });
  // Seul terme SIGNÉ du domaine : l'effet sur le cash de l'enveloppe est un delta, ou un
  // niveau d'ancrage sur les natures d'ouverture.
  const envelopeCashAmount = readAmount(row, mapping, "envelopeCashAmount", conventions, issues, {
    required: false,
    label: "Effet sur le cash de l'enveloppe",
    allowNegative: true,
  });
  const currency = readCurrency(row, mapping, input.declaredCurrency, issues);

  // Forme structurelle : les mêmes règles que `portfolio_events`, dites AVANT l'écriture
  // pour que l'utilisateur voie le problème plutôt qu'une erreur de base.
  if (eventType !== null) {
    if (EVENT_TYPES_REQUIRING_SECURITY.has(eventType) && instrumentKey === null) {
      issues.push(
        issue(
          "MAPPING_REQUIRED_FIELD_MISSING",
          "ERROR",
          `Un ${eventType} exige un instrument : aucun identifiant lisible sur cette ligne`,
          "isin",
        ),
      );
    }
    if (EVENT_TYPES_FORBIDDING_SECURITY.has(eventType) && instrumentKey !== null) {
      issues.push(
        issue(
          "MAPPING_CONFLICT",
          "ERROR",
          `Un ${eventType} est un mouvement d'espèces : il ne porte pas d'instrument, et le ledger le refuserait`,
          "isin",
        ),
      );
    }
    if ((eventType === "BUY" || eventType === "SELL") && quantity === null) {
      issues.push(
        issue(
          "MAPPING_REQUIRED_FIELD_MISSING",
          "ERROR",
          `Un ${eventType} sans quantité ne constitue aucun lot : la quantité n'est pas déduite du montant et du prix, car les frais s'y mêlent`,
          "quantity",
        ),
      );
    }
  }

  if (instrumentKey !== null) {
    const resolution = context.instrumentBySourceKey.get(instrumentKey);
    if (resolution !== undefined && resolution.state !== "RESOLVED") {
      issues.push(...resolution.issues.filter((entry) => entry.severity === "ERROR"));
    }
  }

  const hasError = issues.some((entry) => entry.severity === "ERROR");
  return {
    rowNumber: row.rowNumber,
    eventType,
    eventDate,
    settlementDate,
    instrument,
    instrumentSourceKey: instrumentKey,
    quantity,
    unitPrice,
    grossAmount,
    feeAmount,
    taxAmount,
    envelopeCashAmount,
    currency,
    externalReference: nullableCell(row, mapping, "externalReference"),
    label: nullableCell(row, mapping, "label"),
    status: hasError ? "BLOCKED" : issues.length > 0 ? "WARNING" : "READY",
    verdict: null,
    matchKey: null,
    externalKey: null,
    matchedEventId: null,
    issues,
  };
}

function normalizePositionRow(context: {
  row: RawRow;
  mapping: PortfolioColumnMapping;
  conventions: SourceConventions;
  input: PortfolioAnalysisInput;
  instrumentBySourceKey: Map<string, ReturnType<typeof resolveInstruments>[number]>;
}): NormalizedPositionRow {
  const { row, mapping, conventions, input } = context;
  const issues: ImportIssue[] = [];

  const instrument: InstrumentKey = {
    isin: nullableCell(row, mapping, "isin"),
    ticker: nullableCell(row, mapping, "ticker"),
    name: nullableCell(row, mapping, "instrumentName"),
  };
  const instrumentKey = instrumentSourceKey(instrument);

  if (isRowEmpty(row)) {
    return {
      rowNumber: row.rowNumber,
      asOfDate: null,
      instrument,
      instrumentSourceKey: null,
      quantity: null,
      marketValue: null,
      costBasis: null,
      currency: null,
      status: "IGNORED",
      verdict: null,
      matchKey: null,
      matchedSnapshotId: null,
      issues: [issue("ROW_EMPTY", "INFO", "Ligne vide : ignorée")],
    };
  }

  const asOfDate = readDate(row, mapping, "asOfDate", conventions.date, issues, {
    required: true,
    label: "Date d'arrêté",
  });
  const quantity = readAmount(row, mapping, "quantity", conventions, issues, {
    required: false,
    label: "Quantité",
  });
  // REQUISE : `position_snapshots.market_value` est NOT NULL. Une position sans valeur
  // observée n'est pas une observation de valeur, et l'inventer serait pire que l'absence.
  const marketValue = readAmount(row, mapping, "marketValue", conventions, issues, {
    required: true,
    label: "Valeur de marché",
  });
  const costBasis = readAmount(row, mapping, "costBasis", conventions, issues, {
    required: false,
    label: "Coût de revient",
  });
  const currency = readCurrency(row, mapping, input.declaredCurrency, issues);

  if (instrumentKey === null) {
    issues.push(
      issue(
        "MAPPING_REQUIRED_FIELD_MISSING",
        "ERROR",
        "Aucun identifiant d'instrument lisible : une position sans instrument ne désigne rien",
        "isin",
      ),
    );
  } else {
    const resolution = context.instrumentBySourceKey.get(instrumentKey);
    if (resolution !== undefined && resolution.state !== "RESOLVED") {
      issues.push(...resolution.issues.filter((entry) => entry.severity === "ERROR"));
    }
  }

  if (costBasis === null && mapping.costBasis !== undefined) {
    issues.push(
      issue(
        "MAPPING_UNKNOWN_COLUMN",
        "INFO",
        "Coût de revient non renseigné sur cette ligne : il reste INCONNU, et non nul. La plus-value latente qui en dépend restera non calculable",
        "costBasis",
      ),
    );
  }

  const hasError = issues.some((entry) => entry.severity === "ERROR");
  return {
    rowNumber: row.rowNumber,
    asOfDate,
    instrument,
    instrumentSourceKey: instrumentKey,
    quantity,
    marketValue,
    costBasis,
    currency,
    status: hasError ? "BLOCKED" : issues.length > 0 ? "WARNING" : "READY",
    verdict: null,
    matchKey: null,
    matchedSnapshotId: null,
    issues,
  };
}

function applyEventVerdict(
  row: NormalizedLedgerRow,
  outcome: ReturnType<typeof classifyEventCandidates>[number] | undefined,
): NormalizedLedgerRow {
  if (outcome === undefined) return row;
  const issues = [...row.issues, ...outcome.issues];
  const duplicate = outcome.verdict !== "NEW";
  return {
    ...row,
    verdict: outcome.verdict,
    matchKey: outcome.matchKey,
    externalKey: outcome.externalKey,
    matchedEventId: outcome.matchedEventId,
    // Un doublon ne devient jamais READY : il est exclu par défaut et se coche à la main.
    status: row.status === "BLOCKED" ? "BLOCKED" : duplicate ? "DUPLICATE" : row.status,
    issues,
  };
}

function applyPositionVerdict(
  row: NormalizedPositionRow,
  outcome: ReturnType<typeof classifyPositionCandidates>[number] | undefined,
): NormalizedPositionRow {
  if (outcome === undefined) return row;
  const issues = [...row.issues, ...outcome.issues];
  const duplicate = outcome.verdict !== "NEW";
  return {
    ...row,
    verdict: outcome.verdict,
    matchKey: outcome.matchKey,
    matchedSnapshotId: outcome.matchedEventId,
    status: row.status === "BLOCKED" ? "BLOCKED" : duplicate ? "DUPLICATE" : row.status,
    issues,
  };
}
