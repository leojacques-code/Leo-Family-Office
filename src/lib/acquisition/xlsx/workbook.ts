/**
 * LECTURE D'UN CLASSEUR XLSX
 *
 * Fonctions pures. Elles ne lèvent jamais : un classeur illisible, protégé par mot de
 * passe ou porteur de macros est un RÉSULTAT nommé.
 *
 * Quatre refus structurels, chacun une décision :
 *
 *   1. AUCUNE FORMULE N'EST ÉVALUÉE. Une cellule de formule porte deux choses : la formule
 *      `<f>` et la valeur MISE EN CACHE par le tableur `<v>`. On lit la seconde, jamais la
 *      première. Et VALEUR EN CACHE ≠ VALEUR SAISIE : une valeur en cache peut être périmée
 *      si le classeur a été modifié sans recalcul, donc la cellule est SIGNALÉE comme
 *      dérivée d'une formule. Une formule SANS valeur en cache ne produit rien — l'évaluer
 *      reviendrait à écrire un moteur de tableur, et à inventer un chiffre.
 *
 *   2. AUCUNE MACRO N'EST EXÉCUTÉE, et un classeur qui en porte est REFUSÉ plutôt que lu
 *      partiellement : la présence de `vbaProject.bin` est détectée dans l'archive.
 *
 *   3. AUCUN LIEN EXTERNE N'EST SUIVI. Une référence à un autre classeur n'est pas résolue ;
 *      sa valeur en cache est lue comme n'importe quelle autre, et signalée.
 *
 *   4. AUCUNE ENTITÉ XML N'EST RÉSOLUE. Le parseur ne connaît que les cinq entités
 *      prédéfinies plus les références numériques : une déclaration d'entité externe est
 *      ignorée, ce qui ferme la porte à la lecture de fichiers du serveur.
 */

import { openZip, type ZipFailureCode } from "./zip";

/** Plafonds explicites. Dépassés, le classeur est refusé, jamais tronqué en silence. */
export const MAX_XLSX_BYTES = 16 * 1024 * 1024;
export const MAX_SHEETS = 64;
export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 256;
/** Budget de temps d'analyse. Un classeur pathologique ne doit pas bloquer une requête. */
export const MAX_PARSE_MS = 20_000;

export type WorkbookFailureCode =
  | "FILE_TOO_LARGE"
  | "NOT_A_WORKBOOK"
  | "MACRO_ENABLED"
  | "ENCRYPTED"
  | "NO_SHEET"
  | "TOO_MANY_SHEETS"
  | "TOO_MANY_ROWS"
  | "TOO_MANY_COLUMNS"
  | "PARSE_TIMEOUT"
  | ZipFailureCode;

export interface WorkbookIssue {
  code:
    | "FORMULA_CACHED_VALUE"
    | "FORMULA_WITHOUT_VALUE"
    | "EXTERNAL_LINK"
    | "SHARED_STRING_MISSING"
    | "DATE_SERIAL_DECODED"
    | "ENTRY_SKIPPED"
    | "ERROR_CELL"
    | "SHEET_TRUNCATED";
  severity: "INFO" | "WARNING" | "ERROR";
  /** Référence de cellule telle qu'Excel l'écrit (`B12`), quand l'anomalie est locale. */
  cell: string | null;
  sheet: string | null;
  message: string;
}

export interface WorkbookSheet {
  name: string;
  /** Lignes de cellules, en TEXTE. La normalisation métier vient après, ailleurs. */
  rows: string[][];
  /**
   * Références des cellules dont la valeur vient d'une FORMULE. L'utilisateur doit pouvoir
   * distinguer une donnée saisie d'un résultat recopié par le tableur.
   */
  formulaCells: string[];
  rowCount: number;
  columnCount: number;
}

export interface WorkbookSuccess {
  ok: true;
  sheets: WorkbookSheet[];
  /** Vrai si le classeur déclare l'époque 1904 (convention Macintosh historique). */
  date1904: boolean;
  issues: WorkbookIssue[];
}

export interface WorkbookFailure {
  ok: false;
  code: WorkbookFailureCode;
  message: string;
  issues: WorkbookIssue[];
}

export type WorkbookResult = WorkbookSuccess | WorkbookFailure;

/** Décode les seules entités XML prédéfinies, plus les références numériques. */
function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** Colonne d'une référence de cellule : `BC12` → 55 (index 0). */
export function columnIndexOf(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference.toUpperCase());
  if (letters === null) return -1;
  let index = 0;
  for (const character of letters[1]) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

/**
 * Table des chaînes partagées. Une cellule de type `s` ne porte qu'un INDEX dans cette
 * table : un index hors bornes est signalé, jamais remplacé par une chaîne vide plausible.
 */
function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  // Chaque `<si>` peut contenir plusieurs `<t>` (texte enrichi) : ils se concatènent.
  const items = xml.match(/<si\b[\s\S]*?<\/si>|<si\b[^>]*\/>/g) ?? [];
  for (const item of items) {
    const parts = item.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [];
    if (parts.length === 0) {
      strings.push("");
      continue;
    }
    strings.push(
      parts
        .map((part) => decodeXmlText(/<t\b[^>]*>([\s\S]*?)<\/t>/.exec(part)?.[1] ?? ""))
        .join(""),
    );
  }
  return strings;
}

/**
 * Formats de nombre repérés comme DATES. Le repérage se fait sur le code de format, tel
 * que le classeur l'écrit : les identifiants intégrés documentés, et tout format
 * personnalisé portant des marqueurs de date sans marqueur monétaire.
 */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormatCode(code: string): boolean {
  // Un format monétaire peut contenir `m` (pour « milliers ») : exiger un marqueur de date
  // franc évite de prendre un montant pour une date.
  const stripped = code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
  if (/[#0]/.test(stripped) && !/[dy]/i.test(stripped)) return false;
  return /(yy|dd|mmm|d{1,2}\/|\/m|hh:mm)/i.test(stripped);
}

interface StyleTable {
  /** Index de style → vrai si le format est une date. */
  dateStyles: Set<number>;
}

function parseStyles(xml: string): StyleTable {
  const dateStyles = new Set<number>();
  const customDateFormats = new Set<number>();

  for (const match of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    if (isDateFormatCode(decodeXmlText(match[2]))) customDateFormats.add(Number(match[1]));
  }

  const cellXfs = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? "";
  const entries = cellXfs.match(/<xf\b[^>]*\/?>/g) ?? [];
  entries.forEach((entry, index) => {
    const numFmtId = Number(/numFmtId="(\d+)"/.exec(entry)?.[1] ?? "0");
    if (BUILTIN_DATE_FORMATS.has(numFmtId) || customDateFormats.has(numFmtId)) {
      dateStyles.add(index);
    }
  });
  return { dateStyles };
}

/**
 * Convertit un numéro de série de tableur en date ISO.
 *
 * Ce n'est PAS une invention : c'est le décodage d'un encodage documenté. Deux subtilités
 * sont respectées plutôt que contournées :
 *
 *   * l'époque 1904, déclarée par le classeur, décale tout de 1 462 jours ;
 *   * en époque 1900, le tableur compte un 29 février 1900 qui n'a jamais existé. Les
 *     séries strictement supérieures à 59 sont donc décalées d'un jour. Ignorer ce détail
 *     décalerait toutes les dates d'un jour, silencieusement.
 *
 * Rend `null` hors des bornes plausibles plutôt qu'une date absurde.
 */
export function serialToIsoDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  let days: number;
  if (date1904) {
    days = whole;
    if (days < 0) return null;
  } else {
    if (whole < 1) return null;
    days = whole > 59 ? whole - 1 : whole;
  }
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1900, 0, 1);
  const time = epoch + (days - 1) * 86_400_000;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 2200) return null;
  return date.toISOString().slice(0, 10);
}

interface SheetRef {
  name: string;
  path: string;
}

/** Type de relation OOXML désignant une feuille de calcul interne. */
const WORKSHEET_RELATION_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

/**
 * Une relation n'est retenue que si elle désigne une FEUILLE INTERNE du classeur.
 *
 * Trois refus, et chacun ferme un chemin distinct :
 *
 *   * `TargetMode="External"` — une relation externe pointe hors de l'archive. La suivre
 *     ferait du lecteur un client HTTP ou un lecteur de fichiers, ce qu'il n'est pas ;
 *   * un `Type` autre que `worksheet` — un lien externe, un classeur imbriqué ou une
 *     macro ne se lisent pas comme une feuille, même si leur XML y ressemble ;
 *   * une cible qui SORT de `xl/worksheets/`, y compris par un segment `..` ou un chemin
 *     absolu. Aucune lecture de disque n'a lieu — le lecteur ne consulte que les entrées de
 *     l'archive — mais une cible hors périmètre ferait lire une AUTRE partie du classeur
 *     comme si c'était une feuille, et ses valeurs entreraient dans un portefeuille.
 */
function resolveWorksheetTarget(relation: string): string | null {
  if (/TargetMode="External"/i.test(relation)) return null;
  const type = /Type="([^"]+)"/.exec(relation)?.[1];
  if (type !== WORKSHEET_RELATION_TYPE) return null;
  const raw = /Target="([^"]+)"/.exec(relation)?.[1];
  if (raw === undefined) return null;
  // Une cible absolue ou distante n'est pas un chemin d'archive.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return null;
  const normalized = raw.replace(/^\/?xl\//, "").replace(/^\//, "");
  if (normalized.split("/").includes("..")) return null;
  if (!normalized.startsWith("worksheets/")) return null;
  return normalized;
}

function resolveSheets(workbookXml: string, relsXml: string): SheetRef[] {
  const relationships = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = /Id="([^"]+)"/.exec(match[0])?.[1];
    if (id === undefined) continue;
    const target = resolveWorksheetTarget(match[0]);
    if (target !== null) relationships.set(id, target);
  }
  const sheets: SheetRef[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = /name="([^"]*)"/.exec(match[0])?.[1];
    const relationId = /r:id="([^"]+)"/.exec(match[0])?.[1];
    if (name === undefined) continue;
    const target = relationId ? relationships.get(relationId) : undefined;
    // Une feuille dont la relation n'a pas été retenue reste DÉCLARÉE, avec un chemin vide :
    // le lecteur la signalera introuvable plutôt que de la faire disparaître du classeur.
    sheets.push({ name: decodeXmlText(name), path: target === undefined ? "" : `xl/${target}` });
  }
  return sheets;
}

/** Lit un classeur. Ne lève jamais. */
export function readWorkbook(bytes: Uint8Array): WorkbookResult {
  const started = Date.now();
  const issues: WorkbookIssue[] = [];

  if (bytes.byteLength > MAX_XLSX_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Classeur de ${bytes.byteLength} octets, plafond ${MAX_XLSX_BYTES} : il est refusé, jamais tronqué`,
      issues,
    };
  }

  const archive = openZip(bytes);
  if (!archive.ok) {
    return { ok: false, code: archive.code, message: archive.message, issues };
  }
  for (const skip of archive.skipped) {
    issues.push({
      code: "ENTRY_SKIPPED",
      severity: "WARNING",
      cell: null,
      sheet: null,
      message: `Entrée « ${skip.name} » non extraite (${skip.reason}) : elle est signalée, pas ignorée`,
    });
  }

  // MACRO : refus franc. Lire partiellement un classeur porteur de macros laisserait croire
  // que son contenu a été validé.
  for (const name of archive.entries.keys()) {
    if (name.toLowerCase().includes("vbaproject")) {
      return {
        ok: false,
        code: "MACRO_ENABLED",
        message:
          "Le classeur porte un projet VBA (macros). Il est refusé : aucune macro n'est exécutée, et un classeur à macros n'est pas une source de données validée",
        issues,
      };
    }
  }
  if (archive.entries.has("EncryptionInfo") || archive.entries.has("EncryptedPackage")) {
    return {
      ok: false,
      code: "ENCRYPTED",
      message: "Classeur chiffré : son contenu n'est pas lisible, et rien n'en est déduit",
      issues,
    };
  }

  const workbookEntry = archive.entries.get("xl/workbook.xml");
  if (workbookEntry === undefined) {
    return {
      ok: false,
      code: "NOT_A_WORKBOOK",
      message: "Aucun xl/workbook.xml dans l'archive : ce n'est pas un classeur XLSX",
      issues,
    };
  }
  const workbookXml = textOf(workbookEntry.bytes);
  const date1904 = /date1904="(1|true)"/.test(workbookXml);

  const relsEntry = archive.entries.get("xl/_rels/workbook.xml.rels");
  const sheetRefs = resolveSheets(workbookXml, relsEntry ? textOf(relsEntry.bytes) : "");
  if (sheetRefs.length === 0) {
    return {
      ok: false,
      code: "NO_SHEET",
      message: "Le classeur ne déclare aucune feuille",
      issues,
    };
  }
  if (sheetRefs.length > MAX_SHEETS) {
    return {
      ok: false,
      code: "TOO_MANY_SHEETS",
      message: `${sheetRefs.length} feuilles, plafond ${MAX_SHEETS}`,
      issues,
    };
  }

  if (archive.entries.has("xl/externalLinks/externalLink1.xml")) {
    issues.push({
      code: "EXTERNAL_LINK",
      severity: "WARNING",
      cell: null,
      sheet: null,
      message:
        "Le classeur référence un autre classeur. Aucun lien externe n'est suivi : seules les valeurs mises en cache sont lues, et elles peuvent être périmées",
    });
  }

  const sharedEntry = archive.entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedEntry ? parseSharedStrings(textOf(sharedEntry.bytes)) : [];
  const stylesEntry = archive.entries.get("xl/styles.xml");
  const styles = stylesEntry
    ? parseStyles(textOf(stylesEntry.bytes))
    : { dateStyles: new Set<number>() };

  const sheets: WorkbookSheet[] = [];
  for (const ref of sheetRefs) {
    if (Date.now() - started > MAX_PARSE_MS) {
      return {
        ok: false,
        code: "PARSE_TIMEOUT",
        message: `Analyse interrompue après ${MAX_PARSE_MS} ms : le classeur est refusé plutôt que lu à moitié`,
        issues,
      };
    }
    const entry = archive.entries.get(ref.path);
    if (entry === undefined) {
      issues.push({
        code: "ENTRY_SKIPPED",
        severity: "WARNING",
        cell: null,
        sheet: ref.name,
        message: `Feuille « ${ref.name} » déclarée mais absente de l'archive`,
      });
      continue;
    }
    const parsed = parseSheet({
      xml: textOf(entry.bytes),
      sheetName: ref.name,
      sharedStrings,
      styles,
      date1904,
      issues,
    });
    if (!parsed.ok) {
      // Le code de refus dit LEQUEL des plafonds a été dépassé : « hors limites » sans
      // préciser laquelle n'aide pas à resserrer un export.
      return { ok: false, code: parsed.code, message: parsed.message, issues };
    }
    sheets.push(parsed.sheet);
  }

  if (sheets.length === 0) {
    return { ok: false, code: "NO_SHEET", message: "Aucune feuille lisible", issues };
  }
  return { ok: true, sheets, date1904, issues };
}

type SheetParse =
  | { ok: true; sheet: WorkbookSheet }
  | { ok: false; code: "TOO_MANY_ROWS" | "TOO_MANY_COLUMNS"; message: string };

function parseSheet(input: {
  xml: string;
  sheetName: string;
  sharedStrings: readonly string[];
  styles: StyleTable;
  date1904: boolean;
  issues: WorkbookIssue[];
}): SheetParse {
  const rows: string[][] = [];
  const formulaCells: string[] = [];
  let columnCount = 0;

  const rowMatches = input.xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? [];
  if (rowMatches.length > MAX_ROWS) {
    input.issues.push({
      code: "SHEET_TRUNCATED",
      severity: "ERROR",
      cell: null,
      sheet: input.sheetName,
      message: `${rowMatches.length} lignes, plafond ${MAX_ROWS}`,
    });
    return {
      ok: false,
      code: "TOO_MANY_ROWS",
      message: `Feuille « ${input.sheetName} » : ${rowMatches.length} lignes pour un plafond de ${MAX_ROWS}. Le classeur est refusé, jamais tronqué`,
    };
  }

  for (const rowXml of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? [];
    for (const cellXml of cellMatches) {
      const reference = /r="([A-Z]+\d+)"/.exec(cellXml)?.[1] ?? null;
      const index = reference === null ? cells.length : columnIndexOf(reference);
      if (index < 0 || index >= MAX_COLUMNS) {
        input.issues.push({
          code: "SHEET_TRUNCATED",
          severity: "ERROR",
          cell: reference,
          sheet: input.sheetName,
          message: `Colonne au-delà du plafond de ${MAX_COLUMNS}`,
        });
        return {
          ok: false,
          code: "TOO_MANY_COLUMNS",
          message: `Feuille « ${input.sheetName} » : colonne ${reference ?? index + 1} au-delà du plafond de ${MAX_COLUMNS}`,
        };
      }
      // Les trous sont remplis par des chaînes VIDES, qui signifient « cellule vide » —
      // pas zéro. La distinction est portée plus loin par la normalisation.
      while (cells.length < index) cells.push("");

      const value = readCell({ cellXml, reference, ...input });
      if (value.fromFormula && reference !== null) formulaCells.push(reference);
      cells.push(value.text);
    }
    columnCount = Math.max(columnCount, cells.length);
    rows.push(cells);
  }

  return {
    ok: true,
    sheet: {
      name: input.sheetName,
      rows,
      formulaCells,
      rowCount: rows.length,
      columnCount,
    },
  };
}

function readCell(input: {
  cellXml: string;
  reference: string | null;
  sheetName: string;
  sharedStrings: readonly string[];
  styles: StyleTable;
  date1904: boolean;
  issues: WorkbookIssue[];
}): { text: string; fromFormula: boolean } {
  const type = /\bt="([^"]+)"/.exec(input.cellXml)?.[1] ?? "n";
  const styleIndex = Number(/\bs="(\d+)"/.exec(input.cellXml)?.[1] ?? "-1");
  const hasFormula = /<f\b/.test(input.cellXml);
  const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(input.cellXml);

  // Texte en ligne (`inlineStr`) : il n'y a pas de `<v>`, le texte est dans `<is><t>`.
  if (type === "inlineStr") {
    const inline = /<is\b[\s\S]*?<\/is>/.exec(input.cellXml)?.[0] ?? "";
    const parts = inline.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [];
    return {
      text: parts
        .map((part) => decodeXmlText(/<t\b[^>]*>([\s\S]*?)<\/t>/.exec(part)?.[1] ?? ""))
        .join(""),
      fromFormula: hasFormula,
    };
  }

  if (valueMatch === null) {
    if (hasFormula) {
      // UNE FORMULE SANS VALEUR EN CACHE NE PRODUIT RIEN. L'évaluer serait écrire un moteur
      // de tableur, et le résultat serait une invention.
      input.issues.push({
        code: "FORMULA_WITHOUT_VALUE",
        severity: "ERROR",
        cell: input.reference,
        sheet: input.sheetName,
        message:
          "Formule sans valeur mise en cache : elle n'est PAS évaluée, et la cellule reste vide. Ouvrez le classeur, laissez le tableur recalculer, puis réenregistrez",
      });
    }
    return { text: "", fromFormula: hasFormula };
  }

  const raw = decodeXmlText(valueMatch[1]);

  if (hasFormula) {
    input.issues.push({
      code: "FORMULA_CACHED_VALUE",
      severity: "INFO",
      cell: input.reference,
      sheet: input.sheetName,
      message:
        "Valeur issue d'une FORMULE, lue depuis le cache du tableur et non recalculée. Une valeur en cache n'est pas une valeur saisie : elle peut être périmée",
    });
  }

  switch (type) {
    case "s": {
      const index = Number(raw);
      const value = input.sharedStrings[index];
      if (value === undefined) {
        input.issues.push({
          code: "SHARED_STRING_MISSING",
          severity: "WARNING",
          cell: input.reference,
          sheet: input.sheetName,
          message: `Index de chaîne partagée ${raw} hors bornes : la cellule reste vide plutôt que d'être devinée`,
        });
        return { text: "", fromFormula: hasFormula };
      }
      return { text: value, fromFormula: hasFormula };
    }
    case "str":
      return { text: raw, fromFormula: hasFormula };
    case "b":
      // Un booléen de tableur s'écrit 0 ou 1 : le rendre tel quel évite de choisir une
      // langue pour « vrai ».
      return { text: raw === "1" ? "TRUE" : "FALSE", fromFormula: hasFormula };
    case "e":
      input.issues.push({
        code: "ERROR_CELL",
        severity: "ERROR",
        cell: input.reference,
        sheet: input.sheetName,
        message: `Cellule en erreur dans le tableur (${raw}) : aucune valeur n'en est tirée`,
      });
      return { text: "", fromFormula: hasFormula };
    default: {
      // Numérique. Si le style dit « date », le numéro de série est décodé — décodage d'un
      // encodage documenté, et non conversion arbitraire — et le fait est signalé.
      if (styleIndex >= 0 && input.styles.dateStyles.has(styleIndex)) {
        const iso = serialToIsoDate(Number(raw), input.date1904);
        if (iso !== null) {
          input.issues.push({
            code: "DATE_SERIAL_DECODED",
            severity: "INFO",
            cell: input.reference,
            sheet: input.sheetName,
            message: `Numéro de série ${raw} décodé en ${iso} selon l'époque déclarée par le classeur${
              input.date1904 ? " (1904)" : " (1900)"
            }`,
          });
          return { text: iso, fromFormula: hasFormula };
        }
      }
      return { text: raw, fromFormula: hasFormula };
    }
  }
}
