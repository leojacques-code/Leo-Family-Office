/**
 * LECTURE DES MONTANTS D'UN DOCUMENT
 *
 * Fonctions pures. Le sujet n'est pas la conversion d'une chaîne en nombre : c'est la
 * CONVENTION sous laquelle cette chaîne a été écrite.
 *
 * `1,234` vaut 1,234 sous convention française et 1 234 sous convention anglo-saxonne. L'écart
 * est d'un facteur mille, et il ne laisse aucune trace : un bilan reste équilibré si les deux
 * côtés sont lus de la même façon fausse.
 *
 * La doctrine appliquée est celle de l'import tabulaire, transposée du niveau COLONNE au
 * niveau DOCUMENT — un formulaire administratif n'a pas deux conventions selon la page :
 *
 *   1. la convention se DÉDUIT du document quand une valeur la tranche ;
 *   2. quand rien ne la tranche, la convention réglementaire française est retenue et
 *      DÉCLARÉE — un formulaire fiscal français est imprimé en français, et le dire est
 *      différent de le supposer en silence ;
 *   3. quand deux valeurs se contredisent, la convention est AMBIGUË, et seules les valeurs
 *      RÉELLEMENT ambiguës sont bloquées. Les autres — celles qui donnent le même nombre sous
 *      les deux conventions — restent lues.
 *
 * Le point 3 est le plus important : bloquer tout le document parce qu'une case est ambiguë
 * ferait perdre trois cents cases lisibles.
 */

export const NUMBER_CONVENTIONS = ["FRENCH", "ENGLISH", "AMBIGUOUS", "UNDECIDED"] as const;
export type NumberConvention = (typeof NUMBER_CONVENTIONS)[number];

/** Espaces employés comme séparateurs de milliers, insécables comprises. */
const THOUSAND_SPACES = /[\s\u00a0\u202f\u2007]/g;

/** Une valeur qui ressemble à un montant, avant toute interprétation. */
const NUMERIC_SHAPE = /^[(-]?[\d\s\u00a0\u202f\u2007.,]*\d[).,\s\u00a0\u202f\u2007]*-?$/;

export interface AmountReading {
  /** Valeur retenue. `null` = non lisible sous la convention retenue. */
  value: number | null;
  /** Texte source, tel qu'imprimé. */
  raw: string;
  /** La valeur diffère-t-elle selon la convention ? Si oui et convention ambiguë : bloquée. */
  conventionSensitive: boolean;
  /** Le document imprimait-il un signe négatif, sous quelque forme ? */
  negative: boolean;
}

/** Une chaîne a-t-elle la forme d'un montant ? Un libellé n'en a pas. */
export function looksNumeric(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (!/\d/.test(trimmed)) return false;
  return NUMERIC_SHAPE.test(trimmed);
}

/**
 * Détecte la convention du document depuis TOUS ses jetons numériques.
 *
 * Ce qui tranche :
 *
 *   * un séparateur suivi de 1 ou 2 chiffres en fin de nombre est un séparateur DÉCIMAL ;
 *   * un séparateur suivi d'exactement 3 chiffres, répété ou suivi d'un autre séparateur, est
 *     un séparateur de MILLIERS.
 *
 * Un nombre comme `1,5` tranche donc pour la virgule décimale ; `1,234,567` tranche pour la
 * virgule de milliers ; `1,234` ne tranche rien du tout, et c'est précisément le cas dangereux.
 */
export function detectNumberConvention(texts: readonly string[]): NumberConvention {
  let french = false;
  let english = false;

  for (const text of texts) {
    if (!looksNumeric(text)) continue;
    const body = text.replace(/[()-]/g, "").trim();

    // Virgule décimale : une virgule suivie de 1 ou 2 chiffres, en fin de nombre.
    if (/,\d{1,2}$/.test(body)) french = true;
    // Point décimal : même forme avec un point.
    if (/\.\d{1,2}$/.test(body)) english = true;
    // Virgule de milliers : au moins deux groupes, ou une virgule suivie de 3 chiffres puis
    // un point décimal.
    if (/\d,\d{3},\d{3}/.test(body) || /,\d{3}\.\d/.test(body)) english = true;
    // Point de milliers : symétrique.
    if (/\d\.\d{3}\.\d{3}/.test(body) || /\.\d{3},\d/.test(body)) french = true;
  }

  if (french && english) return "AMBIGUOUS";
  if (french) return "FRENCH";
  if (english) return "ENGLISH";
  return "UNDECIDED";
}

/**
 * Une chaîne donne-t-elle DEUX nombres différents selon la convention ?
 *
 * `1 234` non : l'espace est un séparateur de milliers dans les deux cas. `1,234` oui.
 */
export function isConventionSensitive(text: string): boolean {
  const body = text.replace(/[()-]/g, "").replace(THOUSAND_SPACES, "");
  const separators = body.match(/[.,]/g);
  if (separators === null || separators.length === 0) return false;
  const french = parseUnderConvention(body, "FRENCH");
  const english = parseUnderConvention(body, "ENGLISH");
  if (french === null || english === null) return french !== english;
  return french !== english;
}

function parseUnderConvention(body: string, convention: "FRENCH" | "ENGLISH"): number | null {
  const cleaned = body.replace(THOUSAND_SPACES, "");
  const normalized =
    convention === "FRENCH"
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  // Après normalisation il ne doit rester QU'UN séparateur décimal au plus. Deux points
  // restants signifient une chaîne qui n'est pas un nombre sous cette convention.
  if ((normalized.match(/\./g) ?? []).length > 1) return null;
  if (!/^\d*\.?\d+$|^\d+\.?\d*$/.test(normalized)) return null;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Lit un montant sous une convention donnée.
 *
 * Le signe négatif d'un formulaire prend trois formes : parenthèses `(1 234)`, tiret devant
 * `-1 234`, tiret derrière `1 234-`. Les trois sont reconnues, parce que les trois existent
 * sur des états financiers réels et qu'ignorer la troisième transformerait une perte en gain.
 */
export function readAmount(text: string, convention: NumberConvention): AmountReading {
  const raw = text;
  const trimmed = text.trim();
  const negative = /^\(.*\)$/.test(trimmed) || /^-/.test(trimmed) || /-$/.test(trimmed);

  if (!looksNumeric(trimmed)) {
    return { value: null, raw, conventionSensitive: false, negative: false };
  }

  const sensitive = isConventionSensitive(trimmed);
  const effective: "FRENCH" | "ENGLISH" = convention === "ENGLISH" ? "ENGLISH" : "FRENCH";

  // Convention indécise ET valeur sensible : la lecture serait un pari à un facteur mille.
  if (convention === "AMBIGUOUS" && sensitive) {
    return { value: null, raw, conventionSensitive: true, negative };
  }

  const body = trimmed.replace(/[()]/g, "").replace(/^-|-$/g, "");
  const parsed = parseUnderConvention(body, effective);
  if (parsed === null) {
    return { value: null, raw, conventionSensitive: sensitive, negative };
  }
  return {
    value: negative ? -parsed : parsed,
    raw,
    conventionSensitive: sensitive,
    negative,
  };
}

/**
 * Lit une date française `JJ/MM/AAAA`.
 *
 * L'ordre jour/mois n'est PAS deviné case par case : il est tranché au niveau du DOCUMENT par
 * `detectDateConvention`, exactement comme la convention décimale. Une date isolée dont les
 * deux premiers nombres sont tous deux ≤ 12 reste ambiguë, et une date ambiguë vaut mieux
 * absente qu'inversée — un exercice clos le 3 avril n'est pas un exercice clos le 4 mars.
 */
export interface DateReading {
  iso: string | null;
  raw: string;
  ambiguous: boolean;
}

export const DATE_CONVENTIONS = ["DAY_FIRST", "MONTH_FIRST", "AMBIGUOUS", "UNDECIDED"] as const;
export type DateConvention = (typeof DATE_CONVENTIONS)[number];

const DATE_SHAPE = /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/g;

/** Toutes les dates numériques d'un texte, telles qu'imprimées. */
export function findDateTokens(text: string): Array<[string, number, number, number]> {
  const found: Array<[string, number, number, number]> = [];
  for (const match of text.matchAll(DATE_SHAPE)) {
    found.push([match[0], Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  return found;
}

/**
 * Tranche l'ordre jour/mois pour le document entier.
 *
 * Un seul nombre supérieur à 12 en première position suffit : ce n'est pas un mois. La
 * réciproque tranche dans l'autre sens. Les deux ensemble sont une contradiction.
 */
export function detectDateConvention(texts: readonly string[]): DateConvention {
  let dayFirst = false;
  let monthFirst = false;
  for (const text of texts) {
    for (const [, first, second] of findDateTokens(text)) {
      if (first > 12) dayFirst = true;
      if (second > 12) monthFirst = true;
    }
  }
  if (dayFirst && monthFirst) return "AMBIGUOUS";
  if (dayFirst) return "DAY_FIRST";
  if (monthFirst) return "MONTH_FIRST";
  return "UNDECIDED";
}

export function readFrenchDate(text: string, convention: DateConvention): DateReading {
  const tokens = findDateTokens(text);
  if (tokens.length === 0) return { iso: null, raw: text, ambiguous: false };
  const [raw, first, second, year] = tokens[0];

  // Une date dont les deux premiers nombres dépassent 12 n'est une date sous aucune
  // convention. La rendre nulle est la seule lecture juste.
  if (first > 31 || second > 31) return { iso: null, raw, ambiguous: false };

  const sensitive = first <= 12 && second <= 12 && first !== second;
  if (convention === "AMBIGUOUS" && sensitive) {
    return { iso: null, raw, ambiguous: true };
  }

  // Convention indécise : le formulaire est français, l'ordre jour/mois est réglementaire. Le
  // retenir est une DÉCLARATION, signalée par l'appelant, pas une supposition muette.
  const dayFirst = convention !== "MONTH_FIRST";
  const day = dayFirst ? first : second;
  const month = dayFirst ? second : first;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { iso: null, raw, ambiguous: sensitive };
  }

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    return { iso: null, raw, ambiguous: sensitive };
  }
  return { iso, raw, ambiguous: sensitive };
}
