/**
 * EXTRACTION DES CASES D'UNE LIASSE
 *
 * Fonctions pures, sur une couche texte. Aucun PDF, aucune base, aucune finance.
 *
 * ── LE PRINCIPE ──────────────────────────────────────────────────────────────────────────
 *
 * Une ligne de liasse s'imprime ainsi :
 *
 *     Immobilisations incorporelles        AB      12 345      2 345      10 000
 *     └──────────── libellé ─────────┘     └code┘  └─ brut ─┘  └ amort ─┘  └ net ─┘
 *
 * Le code de la case est IMPRIMÉ à côté de sa valeur. C'est de là qu'il est lu, et non d'une
 * table de référence : la nomenclature officielle n'est pas dans ce dépôt, et la reconstituer
 * de mémoire serait une convention inventée.
 *
 * ── CE QUI EMPÊCHE DE LIRE UN MOT COMME UN CODE ──────────────────────────────────────────
 *
 * Le motif d'un code du régime normal — deux ou trois capitales — apparie aussi « ET », « DE »
 * ou « TVA » dans un libellé. Le motif seul est donc insuffisant, et c'est la COLONNE qui
 * tranche : les codes d'un formulaire sont alignés verticalement, par dizaines. Un jeton n'est
 * retenu comme code que si son abscisse appartient à une colonne portant AU MOINS trois
 * candidats sur la page.
 *
 * Ce critère est celui de la mise en page, pas du vocabulaire. Il tient donc sur un formulaire
 * dont les libellés changent, et il ne dépend d'aucune liste de mots.
 *
 * ── CE QUI N'EST JAMAIS SUPPOSÉ ──────────────────────────────────────────────────────────
 *
 *   * une case sans valeur imprimée reste SANS valeur. Une case blanche de liasse ne déclare
 *     rien, et la compter zéro fausserait tout total construit dessus ;
 *   * la colonne d'une case n'est déterminée que si les EN-TÊTES sont trouvés. Supposer que la
 *     troisième case est le net serait probablement vrai, et invisible le jour où ce serait
 *     faux ;
 *   * un montant dont la convention décimale est indécidable est BLOQUÉ, pas arbitré.
 */

import {
  detectNumberConvention,
  looksNumeric,
  readAmount,
  type NumberConvention,
} from "../numbers";
import {
  boundingBoxOf,
  foldLabel,
  lineTokens,
  pageLines,
  type PdfPage,
  type PdfTextLayer,
  type PdfToken,
} from "../text-layer";
import {
  documentIssue,
  type DocumentIssue,
  type ExtractedField,
  type ExtractionFieldStatus,
} from "../types";
import {
  COLUMN_ANCHORS,
  LETTER_CODE_PATTERN,
  NUMERIC_CODE_PATTERN,
  type LiasseRegime,
} from "./spec";

/**
 * Nombre minimal de candidats alignés pour qu'une abscisse soit reconnue comme colonne de
 * codes. Trois : un formulaire en aligne des dizaines, et deux suffiraient à retenir une
 * coïncidence entre deux mots de libellé.
 */
export const MIN_CODE_COLUMN_MEMBERS = 3;

/** Tolérance d'alignement horizontal, en points PDF. */
export const COLUMN_TOLERANCE = 8;

/** Colonne de valeurs reconnue par son en-tête imprimé. */
interface ValueColumn {
  part: string;
  x: number;
}

/**
 * Numérotations à ESSAYER pour une page, dans l'ordre.
 *
 * Le régime connu ne laisse aucun choix. Le régime inconnu en laisse un, et l'ordre compte :
 * les codes à lettres sont essayés D'ABORD.
 *
 * La raison est un piège mesuré. Un code du régime simplifié est fait de trois chiffres, et
 * une colonne de petits montants — « 100 », « 200 », « 300 » — a exactement la même forme.
 * Essayer les deux numérotations en même temps sur une page à codes-lettres ferait donc lire
 * la colonne des valeurs comme une seconde colonne de codes, et chacun de ces faux codes
 * serait rendu comme une case sans valeur. Les essayer l'une après l'autre supprime le
 * problème dans le cas courant, et le contrôle de `numericColumnsWithValues` traite le reste.
 */
function codePatternSequence(regime: LiasseRegime | null): RegExp[][] {
  if (regime === "LIASSE_2033") return [[NUMERIC_CODE_PATTERN]];
  if (regime === "LIASSE_2050") return [[LETTER_CODE_PATTERN]];
  return [[LETTER_CODE_PATTERN], [NUMERIC_CODE_PATTERN]];
}

/**
 * Ne garde une colonne de codes NUMÉRIQUES que si ses jetons ont, la plupart du temps, un
 * montant à leur DROITE sur la même ligne.
 *
 * Un code de case précède sa valeur ; une colonne de valeurs, elle, n'a généralement rien à
 * sa droite. Ce critère est celui de la mise en page, et il ne suppose aucune plage de
 * montants — un code « 100 » et un montant « 100 » sont indistinguables par leur seule valeur.
 */
function numericColumnsWithValues(page: PdfPage, columns: readonly number[]): number[] {
  return columns.filter((column) => {
    let occurrences = 0;
    let followed = 0;
    for (const line of pageLines(page)) {
      const tokens = lineTokens(line);
      const code = tokens.find(
        (token) =>
          NUMERIC_CODE_PATTERN.test(token.text) && Math.abs(token.x - column) <= COLUMN_TOLERANCE,
      );
      if (code === undefined) continue;
      occurrences += 1;
      if (tokens.some((token) => token.x > code.x && looksNumeric(token.text))) followed += 1;
    }
    return occurrences > 0 && followed * 2 >= occurrences;
  });
}

/** Colonnes de codes retenues pour une page, avec la numérotation qui les a produites. */
function resolveCodeColumns(
  page: PdfPage,
  regime: LiasseRegime | null,
): { patterns: RegExp[]; columns: number[] } {
  for (const patterns of codePatternSequence(regime)) {
    const found = codeColumns(page, patterns);
    const kept =
      patterns[0] === NUMERIC_CODE_PATTERN ? numericColumnsWithValues(page, found) : found;
    if (kept.length > 0) return { patterns, columns: kept };
  }
  return { patterns: [], columns: [] };
}

function matchesCode(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Abscisses des colonnes de codes d'une page.
 *
 * Les candidats sont regroupés par proximité, et seuls les groupes assez peuplés sont retenus.
 */
export function codeColumns(
  page: PdfPage,
  patterns: readonly RegExp[],
  minMembers = MIN_CODE_COLUMN_MEMBERS,
  tolerance = COLUMN_TOLERANCE,
): number[] {
  const candidates: number[] = [];
  for (const line of pageLines(page)) {
    for (const token of lineTokens(line)) {
      if (matchesCode(token.text, patterns)) candidates.push(token.x);
    }
  }
  if (candidates.length === 0) return [];

  candidates.sort((left, right) => left - right);
  const clusters: number[][] = [];
  let current: number[] = [candidates[0]];
  for (const x of candidates.slice(1)) {
    if (x - current[current.length - 1] <= tolerance) {
      current.push(x);
    } else {
      clusters.push(current);
      current = [x];
    }
  }
  clusters.push(current);

  return clusters
    .filter((cluster) => cluster.length >= minMembers)
    .map((cluster) => cluster.reduce((total, x) => total + x, 0) / cluster.length);
}

function inColumn(x: number, columns: readonly number[], tolerance = COLUMN_TOLERANCE): boolean {
  return columns.some((column) => Math.abs(column - x) <= tolerance);
}

/**
 * En-têtes de colonnes de valeurs, cherchés dans le TIERS SUPÉRIEUR de la page.
 *
 * La restriction est délibérée : le mot « NET » réapparaît dans les libellés du corps du
 * tableau, et le prendre pour un en-tête déplacerait la colonne.
 */
export function valueColumns(page: PdfPage): ValueColumn[] {
  const threshold = page.height * (2 / 3);
  const found: ValueColumn[] = [];
  for (const line of pageLines(page)) {
    if (line.y < threshold) continue;
    for (const token of lineTokens(line)) {
      const folded = foldLabel(token.text);
      for (const anchor of COLUMN_ANCHORS) {
        if (anchor.patterns.some((pattern) => pattern.test(folded))) {
          // Le centre de l'en-tête approche mieux le centre de sa colonne que son bord gauche.
          found.push({ part: anchor.part, x: token.x + token.width / 2 });
        }
      }
    }
  }
  return found;
}

function nearestColumn(x: number, columns: readonly ValueColumn[]): string | null {
  if (columns.length === 0) return null;
  let best: ValueColumn = columns[0];
  let distance = Math.abs(columns[0].x - x);
  for (const column of columns.slice(1)) {
    const candidate = Math.abs(column.x - x);
    if (candidate < distance) {
      best = column;
      distance = candidate;
    }
  }
  // Au-delà de la moitié de la page, l'« en-tête le plus proche » ne veut plus rien dire.
  return distance <= 200 ? best.part : null;
}

export interface LiasseExtractionInput {
  layer: PdfTextLayer;
  /** Formulaire reconnu par page. Une page absente est lue sans formulaire. */
  formByPage: Map<number, string>;
  regime: LiasseRegime | null;
}

export interface LiasseExtractionResult {
  fields: ExtractedField[];
  numberConvention: NumberConvention;
  issues: DocumentIssue[];
}

/** Tous les jetons textuels du document, pour la détection de convention. */
function allTokenTexts(layer: PdfTextLayer): string[] {
  const texts: string[] = [];
  for (const page of layer.pages) {
    for (const line of pageLines(page)) {
      for (const token of lineTokens(line)) texts.push(token.text);
    }
  }
  return texts;
}

export function extractLiasseFields(input: LiasseExtractionInput): LiasseExtractionResult {
  const issues: DocumentIssue[] = [];
  const fields: ExtractedField[] = [];

  const convention = detectNumberConvention(allTokenTexts(input.layer));
  if (convention === "UNDECIDED") {
    issues.push(
      documentIssue(
        "NUMBER_CONVENTION_UNDECLARED",
        "INFO",
        null,
        null,
        null,
        "Aucun montant du document ne tranche la convention décimale. La convention française est retenue, comme le prévoit le formulaire — c'est une déclaration, pas une déduction",
      ),
    );
  }
  if (convention === "AMBIGUOUS") {
    issues.push(
      documentIssue(
        "NUMBER_CONVENTION_CONFLICT",
        "ERROR",
        null,
        null,
        null,
        "Le document mélange les conventions décimales. Seuls les montants réellement ambigus sont bloqués : les autres donnent le même nombre dans les deux lectures",
      ),
    );
  }

  /** Compteur d'occurrences par (formulaire, code) : rien ne doit être écrasé. */
  const seen = new Map<string, number>();

  for (const page of input.layer.pages) {
    const formCode = input.formByPage.get(page.pageNumber) ?? null;
    const { patterns, columns } = resolveCodeColumns(page, input.regime);
    if (columns.length === 0) continue;

    const headers = valueColumns(page);
    if (headers.length === 0) {
      issues.push(
        documentIssue(
          "COLUMN_HEADERS_NOT_FOUND",
          "INFO",
          page.pageNumber,
          null,
          null,
          `Page ${page.pageNumber} : en-têtes de colonnes non trouvés. Les cases sont lues, mais aucune colonne ne leur est attribuée — et les contrôles qui en dépendent resteront non calculables`,
        ),
      );
    }

    for (const line of pageLines(page)) {
      const tokens = lineTokens(line);
      const codeTokens = tokens.filter(
        (token) => matchesCode(token.text, patterns) && inColumn(token.x, columns),
      );
      if (codeTokens.length === 0) continue;

      const firstCodeX = codeTokens[0].x;
      const label =
        tokens
          .filter((token) => token.x < firstCodeX && !looksNumeric(token.text))
          .map((token) => token.text)
          .join(" ")
          .trim() || null;

      const numericTokens = tokens.filter(
        (token) => looksNumeric(token.text) && token.x > firstCodeX,
      );

      // Attribution positionnelle de repli : certains formulaires groupent les codes puis
      // alignent les valeurs. Elle ne s'applique QUE si les deux décomptes coïncident
      // exactement — sinon l'appariement serait un pari.
      const afterLastCode = numericTokens.filter(
        (token) => token.x > codeTokens[codeTokens.length - 1].x,
      );
      const positional =
        codeTokens.length > 1 && afterLastCode.length === codeTokens.length ? afterLastCode : null;

      codeTokens.forEach((codeToken, index) => {
        const nextCodeX = codeTokens[index + 1]?.x ?? Number.POSITIVE_INFINITY;
        const valueToken: PdfToken | undefined =
          positional !== null
            ? positional[index]
            : numericTokens.find((token) => token.x > codeToken.x && token.x < nextCodeX);

        const key = `${formCode ?? "?"}|${codeToken.text}`;
        const occurrence = seen.get(key) ?? 0;
        seen.set(key, occurrence + 1);

        const fieldIssues: DocumentIssue[] = [];
        let status: ExtractionFieldStatus = formCode === null ? "UNKNOWN_BOX" : "EXTRACTED";
        let normalized: number | null = null;
        let raw: string | null = null;

        if (occurrence > 0) {
          fieldIssues.push(
            documentIssue(
              "BOX_DUPLICATE_CODE",
              "WARNING",
              page.pageNumber,
              codeToken.text,
              null,
              `Le code ${codeToken.text} apparaît plusieurs fois sur ce formulaire. Chaque occurrence est conservée : en écraser une perdrait une valeur imprimée`,
            ),
          );
        }

        if (valueToken === undefined) {
          // CASE VIDE ≠ CASE À ZÉRO. Le code est imprimé, la valeur non.
          fieldIssues.push(
            documentIssue(
              "BOX_WITHOUT_VALUE",
              "INFO",
              page.pageNumber,
              codeToken.text,
              null,
              `Case ${codeToken.text} sans valeur imprimée : rien n'est déclaré. Ce n'est pas un zéro`,
            ),
          );
        } else {
          raw = valueToken.text;
          const amount = readAmount(valueToken.text, convention);
          if (amount.value === null) {
            status = "BLOCKED";
            fieldIssues.push(
              documentIssue(
                amount.conventionSensitive
                  ? "BOX_VALUE_AMBIGUOUS_CONVENTION"
                  : "BOX_VALUE_UNREADABLE",
                "ERROR",
                page.pageNumber,
                codeToken.text,
                valueToken.text,
                amount.conventionSensitive
                  ? `Case ${codeToken.text} : « ${valueToken.text} » vaut mille fois plus ou mille fois moins selon la convention décimale du document, qui est contradictoire. La valeur est bloquée plutôt qu'arbitrée`
                  : `Case ${codeToken.text} : « ${valueToken.text} » n'est pas un montant lisible`,
              ),
            );
          } else {
            normalized = amount.value;
          }
        }

        const part =
          headers.length === 0
            ? null
            : nearestColumn(
                valueToken === undefined ? codeToken.x : valueToken.x + valueToken.width / 2,
                headers,
              );

        const bboxSource = valueToken === undefined ? [codeToken] : [codeToken, valueToken];
        fields.push({
          pageNumber: page.pageNumber,
          formCode,
          formPart: part,
          boxCode: codeToken.text,
          occurrence,
          label,
          bbox: boundingBoxOf(bboxSource),
          rawValue: raw,
          normalizedValue: normalized,
          unit: "EUR",
          extractionMethod: "NATIVE_TEXT_LAYOUT",
          // La confiance suit ce qui a RÉELLEMENT été établi : un formulaire reconnu, une
          // colonne attribuée et une valeur lue valent une confiance haute ; l'absence de
          // l'un des trois la fait baisser, et le dire vaut mieux qu'un chiffre uniforme.
          confidence:
            status === "BLOCKED" ? "LOW" : formCode !== null && part !== null ? "HIGH" : "MEDIUM",
          confidenceScore: null,
          validationStatus: status,
          issues: fieldIssues,
        });
      });
    }
  }

  return { fields, numberConvention: convention, issues };
}
