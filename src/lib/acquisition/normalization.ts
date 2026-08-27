/**
 * NORMALISATION — primitives de lecture d'une valeur source.
 *
 * Règle unique : une ambiguïté se DÉCLARE, elle ne se tranche pas en silence. `1,234`
 * peut valoir 1,234 ou 1 234 ; `03/04/2026` peut être le 3 avril ou le 4 mars. Choisir
 * pour l'utilisateur, c'est fabriquer un montant ou une date qu'il n'a jamais fournis.
 *
 * La résolution se fait donc au niveau de la COLONNE, pas de la cellule : une colonne qui
 * contient au moins une valeur non ambiguë renseigne toutes les autres. Une colonne
 * entièrement ambiguë reste ambiguë, et les lignes qui en dépendent sont bloquées.
 */

import type {
  AmountConvention,
  DateConvention,
  ImportIssue,
  ImportIssueCode,
  SourceEncoding,
} from "@/lib/acquisition/types";

/** Espaces utilisés comme séparateurs de milliers, insécables compris. */
const GROUPING_SPACES = /[\s\u00a0\u202f\u2009\u2007']/g;
/** Symboles monétaires et mentions de devise accolées au montant. */
const CURRENCY_NOISE = /[€$£¥]|\bEUR\b|\bUSD\b|\bGBP\b|\bCHF\b/gi;

export function issue(
  code: ImportIssueCode,
  severity: ImportIssue["severity"],
  message: string,
  field: string | null = null,
  sourceValue: string | null = null,
): ImportIssue {
  return { code, severity, field, sourceValue, message };
}

// ---------------------------------------------------------------------------
// Décodage
// ---------------------------------------------------------------------------

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/**
 * Décode des octets en texte.
 *
 * L'UTF-8 est tenté en mode strict : s'il échoue, les octets ne sont PAS de l'UTF-8, et
 * Windows-1252 est le repli qui couvre les exports bancaires français hérités. Ce repli
 * est signalé, parce qu'il peut transformer un caractère exotique en un autre.
 */
export function decodeSourceBytes(bytes: Uint8Array): {
  text: string;
  encoding: SourceEncoding;
  issues: ImportIssue[];
} {
  const hasBom = bytes.length >= 3 && UTF8_BOM.every((byte, index) => bytes[index] === byte);
  const body = hasBom ? bytes.subarray(3) : bytes;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { text, encoding: hasBom ? "UTF_8_BOM" : "UTF_8", issues: [] };
  } catch {
    const text = new TextDecoder("windows-1252").decode(body);
    return {
      text,
      encoding: "WINDOWS_1252",
      issues: [
        issue(
          "ENCODING_FALLBACK",
          "WARNING",
          "Le fichier n'est pas de l'UTF-8 valide : il a été lu en Windows-1252. Vérifier les accents des libellés.",
        ),
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------

type AmountEvidence = "DECIMAL_COMMA" | "DECIMAL_POINT" | "NONE" | "AMBIGUOUS";

function stripAmountNoise(raw: string): string {
  return raw.replace(CURRENCY_NOISE, "").replace(GROUPING_SPACES, "").trim();
}

/** Les groupes séparés par `separator` sont-ils des milliers valides (3 chiffres) ? */
function validGrouping(digitsPart: string, separator: string): boolean {
  const groups = digitsPart.split(separator);
  if (groups.length < 2) return true;
  const [head, ...rest] = groups;
  if (head.length === 0 || head.length > 3) return false;
  return rest.every((group) => group.length === 3);
}

/**
 * Ce qu'une cellule apprend sur la convention décimale de sa colonne.
 *
 * `AMBIGUOUS` ne signifie pas « illisible » : `1,234` est parfaitement lisible, mais deux
 * lectures en donnent deux montants différents. C'est la colonne qui tranchera, ou personne.
 */
export function amountEvidenceOf(raw: string): AmountEvidence {
  const cleaned = stripAmountNoise(raw)
    .replace(/^[+-]|[+-]$/g, "")
    .replace(/[()]/g, "");
  if (cleaned.length === 0) return "NONE";
  const commas = (cleaned.match(/,/g) ?? []).length;
  const dots = (cleaned.match(/\./g) ?? []).length;
  if (commas === 0 && dots === 0) return "NONE";

  if (commas > 0 && dots > 0) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decimalIsComma = lastComma > lastDot;
    const decimalChar = decimalIsComma ? "," : ".";
    const groupChar = decimalIsComma ? "." : ",";
    const integerPart = cleaned.slice(0, cleaned.lastIndexOf(decimalChar));
    if (integerPart.includes(decimalChar)) return "AMBIGUOUS";
    if (!validGrouping(integerPart, groupChar)) return "AMBIGUOUS";
    return decimalIsComma ? "DECIMAL_COMMA" : "DECIMAL_POINT";
  }

  const separator = commas > 0 ? "," : ".";
  const count = commas > 0 ? commas : dots;
  if (count > 1) {
    // Plusieurs occurrences du même séparateur : il ne peut pas être décimal.
    return validGrouping(cleaned, separator)
      ? separator === ","
        ? "DECIMAL_POINT"
        : "DECIMAL_COMMA"
      : "AMBIGUOUS";
  }
  const decimals = cleaned.length - cleaned.lastIndexOf(separator) - 1;
  // Exactement trois décimales : un séparateur de milliers a la même forme. Indécidable.
  if (decimals === 3) return "AMBIGUOUS";
  return separator === "," ? "DECIMAL_COMMA" : "DECIMAL_POINT";
}

/**
 * Convention décimale d'une colonne entière.
 *
 * Deux preuves contradictoires dans la même colonne (`1 234,56` et `1,234.56`) rendent la
 * colonne AMBIGUË : mélanger deux conventions dans un même export est possible, et il
 * n'existe alors aucune lecture sûre.
 */
export function resolveAmountConvention(cells: readonly string[]): AmountConvention {
  let comma = false;
  let point = false;
  let ambiguous = false;
  let anySeparator = false;
  for (const cell of cells) {
    const evidence = amountEvidenceOf(cell);
    if (evidence === "NONE") continue;
    anySeparator = true;
    if (evidence === "DECIMAL_COMMA") comma = true;
    else if (evidence === "DECIMAL_POINT") point = true;
    else ambiguous = true;
  }
  if (comma && point) return "AMBIGUOUS";
  if (comma) return "DECIMAL_COMMA";
  if (point) return "DECIMAL_POINT";
  if (ambiguous) return "AMBIGUOUS";
  return anySeparator ? "AMBIGUOUS" : "INTEGER";
}

/** Arrondi à la précision de stockage (numeric(20,6)). Aucune perte silencieuse au-delà. */
function toStoredPrecision(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Lit un montant selon la convention retenue pour sa colonne.
 *
 * Retourne `null` quand la cellule est vide (information absente) comme quand elle est
 * illisible (information incomprise) : le code d'anomalie distingue les deux.
 */
export function parseAmountWithConvention(
  raw: string,
  convention: AmountConvention,
): { value: number | null; code: "EMPTY" | "OK" | "UNPARSEABLE" | "AMBIGUOUS" } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null, code: "EMPTY" };
  if (convention === "AMBIGUOUS") return { value: null, code: "AMBIGUOUS" };

  let cleaned = stripAmountNoise(trimmed);
  let negative = false;
  if (/^\(.*\)$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("-")) {
    negative = !negative;
    cleaned = cleaned.slice(1);
  } else if (cleaned.endsWith("-")) {
    negative = !negative;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }

  if (convention === "DECIMAL_COMMA") cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  else cleaned = cleaned.replace(/,/g, "");

  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { value: null, code: "UNPARSEABLE" };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { value: null, code: "UNPARSEABLE" };
  return { value: toStoredPrecision(negative ? -parsed : parsed), code: "OK" };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const ISO_SHAPE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const NUMERIC_SHAPE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;

/** Isole la partie date d'une cellule qui porterait aussi une heure. */
function dateHead(raw: string): string {
  return raw.trim().split(/[T\s]/)[0] ?? "";
}

/** La date existe-t-elle au calendrier ? `2026-02-31` a la bonne forme et n'existe pas. */
export function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Convention d'une colonne de dates.
 *
 * Seules les formes numériques courtes (`03/04/2026`) posent la question ; une date ISO se
 * lit sans convention. Une colonne où un jour dépasse 12 est tranchée par ce seul fait.
 */
export function resolveDateConvention(cells: readonly string[]): DateConvention {
  let dayFirst = false;
  let monthFirst = false;
  let sawNumeric = false;
  let sawIso = false;
  for (const cell of cells) {
    const head = dateHead(cell);
    if (head.length === 0) continue;
    if (ISO_SHAPE.test(head)) {
      sawIso = true;
      continue;
    }
    const numeric = NUMERIC_SHAPE.exec(head);
    if (!numeric) continue;
    sawNumeric = true;
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    if (first > 12 && second <= 12) dayFirst = true;
    else if (second > 12 && first <= 12) monthFirst = true;
  }
  if (dayFirst && monthFirst) return "AMBIGUOUS";
  if (dayFirst) return "DAY_FIRST";
  if (monthFirst) return "MONTH_FIRST";
  if (sawNumeric) return "AMBIGUOUS";
  return sawIso ? "ISO" : "AMBIGUOUS";
}

/**
 * Bascule des années sur deux chiffres. Le pivot est explicite et documenté ; il n'est
 * jamais silencieux : la ligne porte l'anomalie `DATE_TWO_DIGIT_YEAR` et l'utilisateur
 * relit la date obtenue dans le preview.
 */
const TWO_DIGIT_PIVOT = 69;

export function parseDateWithConvention(
  raw: string,
  convention: DateConvention,
): {
  value: string | null;
  code: "EMPTY" | "OK" | "UNPARSEABLE" | "NOT_A_CALENDAR_DATE" | "AMBIGUOUS";
  twoDigitYear: boolean;
} {
  const head = dateHead(raw);
  if (head.length === 0) return { value: null, code: "EMPTY", twoDigitYear: false };

  const isoMatch = ISO_SHAPE.exec(head);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isCalendarDate(year, month, day)) {
      return { value: null, code: "NOT_A_CALENDAR_DATE", twoDigitYear: false };
    }
    return { value: iso(year, month, day), code: "OK", twoDigitYear: false };
  }

  const numeric = NUMERIC_SHAPE.exec(head);
  if (!numeric) return { value: null, code: "UNPARSEABLE", twoDigitYear: false };

  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  const rawYear = numeric[3];
  const twoDigitYear = rawYear.length === 2;
  const year = twoDigitYear
    ? Number(rawYear) <= TWO_DIGIT_PIVOT
      ? 2000 + Number(rawYear)
      : 1900 + Number(rawYear)
    : Number(rawYear);

  let day: number;
  let month: number;
  if (first > 12 && second <= 12) {
    day = first;
    month = second;
  } else if (second > 12 && first <= 12) {
    day = second;
    month = first;
  } else if (convention === "DAY_FIRST") {
    day = first;
    month = second;
  } else if (convention === "MONTH_FIRST") {
    day = second;
    month = first;
  } else {
    return { value: null, code: "AMBIGUOUS", twoDigitYear };
  }

  if (!isCalendarDate(year, month, day)) {
    return { value: null, code: "NOT_A_CALENDAR_DATE", twoDigitYear };
  }
  return { value: iso(year, month, day), code: "OK", twoDigitYear };
}

// ---------------------------------------------------------------------------
// Libellés et devises
// ---------------------------------------------------------------------------

/** Libellé lisible : espaces normalisés, contenu inchangé. La source reste dans le raw. */
export function normalizeLabel(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length === 0 ? null : collapsed;
}

/** Forme canonique servant UNIQUEMENT à l'empreinte de déduplication. */
export function labelFingerprintForm(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "¥": "JPY",
  CHF: "CHF",
};

/**
 * Lit une devise déclarée par la source.
 *
 * Tout code de trois lettres est accepté tel quel : c'est la DÉCLARATION de la source, et
 * LFO n'a pas de table ISO 4217 embarquée qu'il pourrait opposer sans l'inventer. Un code
 * inconnu du FX Engine rendra plus tard le total non calculable — c'est la bonne couche
 * pour ce refus, pas celle-ci.
 */
export function parseCurrencyCell(raw: string): {
  value: string | null;
  code: "EMPTY" | "OK" | "UNKNOWN";
} {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null, code: "EMPTY" };
  const symbol = CURRENCY_SYMBOLS[trimmed] ?? CURRENCY_SYMBOLS[trimmed.toUpperCase()];
  if (symbol) return { value: symbol, code: "OK" };
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return { value: upper, code: "OK" };
  return { value: null, code: "UNKNOWN" };
}
