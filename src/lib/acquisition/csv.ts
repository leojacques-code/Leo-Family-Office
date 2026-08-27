/**
 * LECTURE TABULAIRE — découpage d'un texte délimité en lignes brutes.
 *
 * Le découpage est la première chose qui peut fausser un import entier : un séparateur mal
 * deviné transforme 842 opérations en 842 lignes d'une seule colonne, et un guillemet mal
 * géré coupe un libellé au milieu. Cette étape ne normalise donc RIEN : elle produit des
 * cellules de texte, telles que la source les a écrites.
 */

import { issue } from "@/lib/acquisition/normalization";
import type { ImportIssue, RawRow } from "@/lib/acquisition/types";

/** Séparateurs candidats, du plus fréquent en export bancaire français au plus rare. */
export const CANDIDATE_DELIMITERS = [";", ",", "\t", "|"] as const;

/** Nombre de lignes examinées pour reconnaître un séparateur. */
const SNIFF_LINES = 25;

/**
 * Découpe une ligne selon RFC 4180 : guillemets, guillemets doublés, séparateur protégé.
 * Ne gère pas les retours à la ligne dans un champ — c'est `parseDelimited` qui les recolle.
 */
function splitLine(line: string, delimiter: string): { cells: string[]; openQuote: boolean } {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      current += char;
      index += 1;
      continue;
    }
    if (char === '"' && current.trim().length === 0) {
      quoted = true;
      current = "";
      index += 1;
      continue;
    }
    if (char === delimiter) {
      cells.push(current);
      current = "";
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  cells.push(current);
  return { cells, openQuote: quoted };
}

/**
 * Nombre de cellules obtenu par séparateur sur les premières lignes non vides.
 *
 * Un bon séparateur produit un nombre de colonnes STABLE et supérieur à un. Un séparateur
 * qui n'apparaît pas produit une colonne unique ; un séparateur présent par hasard dans les
 * libellés produit un nombre instable.
 */
function delimiterScore(
  lines: readonly string[],
  delimiter: string,
): { columns: number; stable: boolean } {
  const counts = lines.map((line) => splitLine(line, delimiter).cells.length);
  if (counts.length === 0) return { columns: 0, stable: false };
  const first = counts[0];
  return { columns: first, stable: counts.every((count) => count === first) };
}

export interface DelimiterDetection {
  delimiter: string;
  issues: ImportIssue[];
}

/**
 * Reconnaît le séparateur. Deux candidats également plausibles ne sont PAS arbitrés : le
 * fichier est signalé ambigu, et l'utilisateur tranche.
 */
export function detectDelimiter(text: string): DelimiterDetection {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, SNIFF_LINES);
  if (lines.length === 0) {
    return {
      delimiter: ";",
      issues: [issue("FILE_EMPTY", "ERROR", "Le fichier ne contient aucune ligne exploitable.")],
    };
  }
  const scored = CANDIDATE_DELIMITERS.map((delimiter) => ({
    delimiter,
    ...delimiterScore(lines, delimiter),
  })).filter((entry) => entry.columns > 1 && entry.stable);

  if (scored.length === 0) {
    return {
      delimiter: ";",
      issues: [
        issue(
          "DELIMITER_UNDETECTED",
          "ERROR",
          "Aucun séparateur ne produit un nombre de colonnes stable. Vérifier le fichier ou déclarer le séparateur.",
        ),
      ],
    };
  }
  const best = scored.reduce((left, right) => (right.columns > left.columns ? right : left));
  const rivals = scored.filter((entry) => entry.columns === best.columns);
  if (rivals.length > 1) {
    return {
      delimiter: best.delimiter,
      issues: [
        issue(
          "DELIMITER_AMBIGUOUS",
          "WARNING",
          `Plusieurs séparateurs donnent ${best.columns} colonnes (${rivals
            .map((entry) => (entry.delimiter === "\t" ? "tabulation" : entry.delimiter))
            .join(
              " ",
            )}). Séparateur retenu : ${best.delimiter === "\t" ? "tabulation" : best.delimiter}.`,
        ),
      ],
    };
  }
  return { delimiter: best.delimiter, issues: [] };
}

export interface DelimitedDocument {
  headers: string[];
  rows: RawRow[];
  issues: ImportIssue[];
}

/**
 * Découpe un texte délimité en en-tête + lignes brutes.
 *
 * Les lignes vides sont CONSERVÉES avec leur numéro d'origine : le numéro de ligne du
 * fichier est ce que l'utilisateur lit dans son tableur, et le décaler rendrait toute
 * anomalie introuvable.
 */
export function parseDelimited(
  text: string,
  delimiter: string,
  options: { maxRows: number },
): DelimitedDocument {
  const issues: ImportIssue[] = [];
  const physicalLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Recollage des champs multi-lignes : un guillemet resté ouvert prolonge la ligne.
  const logicalLines: Array<{ text: string; firstLineNumber: number }> = [];
  let buffer = "";
  let bufferStart = 1;
  let open = false;
  physicalLines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!open) {
      buffer = line;
      bufferStart = lineNumber;
    } else {
      buffer += `\n${line}`;
    }
    open = splitLine(buffer, delimiter).openQuote;
    if (!open) {
      logicalLines.push({ text: buffer, firstLineNumber: bufferStart });
      buffer = "";
    }
  });
  if (open) logicalLines.push({ text: buffer, firstLineNumber: bufferStart });

  // Une dernière ligne vide n'est qu'un saut de ligne final, pas une ligne de données.
  while (
    logicalLines.length > 0 &&
    logicalLines[logicalLines.length - 1].text.trim().length === 0
  ) {
    logicalLines.pop();
  }

  if (logicalLines.length === 0) {
    return {
      headers: [],
      rows: [],
      issues: [issue("FILE_EMPTY", "ERROR", "Le fichier ne contient aucune ligne.")],
    };
  }

  const headerLine = logicalLines[0];
  const headers = splitLine(headerLine.text, delimiter).cells.map((cell) =>
    cell.replace(/\s+/g, " ").trim(),
  );
  if (headers.every((header) => header.length === 0)) {
    issues.push(
      issue("HEADER_MISSING", "ERROR", "La première ligne ne contient aucun nom de colonne."),
    );
  }
  const seen = new Map<string, number>();
  for (const header of headers) {
    if (header.length === 0) continue;
    const key = header.toUpperCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      issues.push(
        issue(
          "HEADER_DUPLICATE",
          "WARNING",
          `La colonne « ${key} » apparaît ${count} fois. Seule la première peut être associée à un champ.`,
        ),
      );
    }
  }

  const dataLines = logicalLines.slice(1);
  if (dataLines.length > options.maxRows) {
    return {
      headers,
      rows: [],
      issues: [
        ...issues,
        issue(
          "FILE_TOO_MANY_ROWS",
          "ERROR",
          `Le fichier contient ${dataLines.length} lignes, au-delà de la limite de ${options.maxRows} par session. Le découper plutôt que d'en tronquer une partie en silence.`,
        ),
      ],
    };
  }

  const rows: RawRow[] = dataLines.map((line) => ({
    rowNumber: line.firstLineNumber,
    cells: splitLine(line.text, delimiter).cells,
    rawLine: line.text,
  }));

  const mismatched = rows.filter(
    (row) => row.rawLine.trim().length > 0 && row.cells.length !== headers.length,
  );
  if (mismatched.length > 0) {
    issues.push(
      issue(
        "COLUMN_COUNT_MISMATCH",
        "WARNING",
        `${mismatched.length} ligne(s) n'ont pas le même nombre de colonnes que l'en-tête (lignes ${mismatched
          .slice(0, 5)
          .map((row) => row.rowNumber)
          .join(", ")}${mismatched.length > 5 ? "…" : ""}).`,
      ),
    );
  }

  return { headers, rows, issues };
}

/**
 * Signature d'un format tabulaire : en-têtes normalisés et séparateur.
 *
 * C'est la SEULE clé de réutilisation d'un mapping validé. Une signature différente
 * signifie un format différent, même si les colonnes se ressemblent : réutiliser un mapping
 * « à peu près compatible » reviendrait à écrire des montants dans la mauvaise colonne.
 */
export function formatSignature(headers: readonly string[], delimiter: string): string {
  const normalized = headers
    .map((header) => header.toUpperCase().replace(/\s+/g, " ").trim())
    .join("|");
  return `csv:${delimiter === "\t" ? "TAB" : delimiter}:${normalized}`;
}
