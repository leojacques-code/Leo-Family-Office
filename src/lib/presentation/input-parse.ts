/**
 * Lecture des saisies numériques et de date.
 *
 * Ces fonctions sont PURES et vivent hors des composants, pour deux raisons : elles sont
 * testables sans monter un DOM, et elles sont la seule définition de « ce que l'utilisateur
 * a déclaré » dans le produit.
 *
 * Elles remplacent :
 *
 *   export const inputNumber = (value: string) => Number(value.replace(",", "."));
 *
 * Ce helper fabriquait un zéro à partir du vide, parce que `Number("")` vaut `0`. Un champ
 * effacé produisait donc un montant DÉCLARÉ à zéro, sans qu'aucune ligne de code n'ait
 * décidé d'un zéro. C'est la violation de `NULL ≠ ZERO` la plus en amont possible : elle
 * entre dans la chaîne par le clavier.
 *
 * VIDE ≠ ILLISIBLE ≠ ZÉRO. Les trois sont distingués par un résultat discriminé, et non par
 * une valeur de repli : un appelant ne peut pas confondre « rien saisi » avec « saisie en
 * cours » ni avec « zéro déclaré », parce que le type le lui interdit.
 */

/** Motif d'un refus de lecture. Sert à expliquer, jamais à deviner une valeur. */
export type NumberParseReason =
  /** Aucun chiffre : « - », « , », « € » seuls. */
  | "NO_DIGIT"
  /** Deux séparateurs décimaux, ou un séparateur au milieu de la partie décimale. */
  | "MULTIPLE_DECIMAL_SEPARATORS"
  /** Un signe ailleurs qu'en tête, ou plusieurs signes. */
  | "MISPLACED_SIGN"
  /** Notation exponentielle : `1e5` n'est pas une écriture de montant. */
  | "EXPONENT_NOTATION"
  /** Un caractère qui n'appartient ni au nombre, ni aux séparateurs, ni à la devise. */
  | "UNEXPECTED_CHARACTER"
  /** La lecture aboutit à un nombre non fini. */
  | "NOT_FINITE";

/**
 * Résultat d'une lecture de saisie numérique.
 *
 * `EMPTY` et `INVALID` portent tous deux `value: null`, et c'est volontaire : aucun des deux
 * ne produit de nombre. Mais ils ne se traitent pas pareil dans l'interface, l'un étant
 * l'état normal d'un champ jamais rempli et l'autre une saisie à corriger.
 */
export type NumberDraft =
  | { readonly state: "EMPTY"; readonly value: null }
  | { readonly state: "INVALID"; readonly value: null; readonly reason: NumberParseReason }
  | { readonly state: "VALID"; readonly value: number };

/** Séparateurs de milliers tolérés à la saisie : espace, insécable, insécable étroite. */
const GROUP_SEPARATORS = /[    ']/g;
/** Signes moins acceptés : le trait d'union du clavier et le vrai signe moins typographique. */
const MINUS_SIGNS = /^[-−]/;
const DIGITS_ONLY = /^\d*$/;

/**
 * Lit un nombre saisi au clavier, à la française comme à l'anglaise.
 *
 * Ce qui est accepté : les séparateurs de milliers listés ci-dessus, la virgule et le point
 * comme séparateur décimal, un signe moins en tête, un séparateur décimal FINAL (l'utilisateur
 * a tapé « 1, » et n'a pas encore tapé la décimale : il a déjà déclaré 1, et rien n'est
 * inventé en le lisant ainsi).
 *
 * Ce qui est refusé : la notation exponentielle, deux séparateurs décimaux, un signe mal
 * placé, tout autre caractère. Le refus est explicite et ne se replie sur aucune valeur.
 */
export function parseNumberInput(raw: string): NumberDraft {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { state: "EMPTY", value: null };

  // `Number` accepte `1e5`, `0x1f`, `Infinity` et les espaces internes. Un montant ne
  // s'écrit d'aucune de ces façons, et les accepter ferait passer une frappe accidentelle
  // pour une déclaration.
  if (/[eE]/.test(trimmed)) return { state: "INVALID", value: null, reason: "EXPONENT_NOTATION" };

  const negative = MINUS_SIGNS.test(trimmed);
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  if (/[-−+]/.test(unsigned)) {
    return { state: "INVALID", value: null, reason: "MISPLACED_SIGN" };
  }

  const compact = unsigned.replace(GROUP_SEPARATORS, "");
  const parts = compact.split(/[.,]/);
  if (parts.length > 2) {
    return { state: "INVALID", value: null, reason: "MULTIPLE_DECIMAL_SEPARATORS" };
  }
  const [integerPart, decimalPart = ""] = parts;
  if (!DIGITS_ONLY.test(integerPart) || !DIGITS_ONLY.test(decimalPart)) {
    return { state: "INVALID", value: null, reason: "UNEXPECTED_CHARACTER" };
  }
  if (integerPart.length === 0 && decimalPart.length === 0) {
    return { state: "INVALID", value: null, reason: "NO_DIGIT" };
  }

  const normalised = `${integerPart.length === 0 ? "0" : integerPart}.${decimalPart.length === 0 ? "0" : decimalPart}`;
  const parsed = Number(normalised);
  if (!Number.isFinite(parsed)) return { state: "INVALID", value: null, reason: "NOT_FINITE" };
  // `-0` n'existe pas comme montant : il rendrait « −0 € » à l'affichage.
  const signed = negative && parsed !== 0 ? -parsed : parsed;
  return { state: "VALID", value: signed };
}

/**
 * Lit un TAUX saisi en pourcentage et rend sa valeur décimale.
 *
 * POURCENTAGE AFFICHÉ ≠ TAUX STOCKÉ. La base persiste des décimales (`annual_rate` en
 * `numeric(12,8)`, une quote-part entre 0 et 1), l'utilisateur écrit « 3,5 ». Les confondre
 * multiplierait ou diviserait un taux par cent en silence, ce qu'aucun contrôle de forme ne
 * rattraperait : 0,035 et 3,5 sont deux nombres parfaitement valides.
 */
export function parsePercentInput(raw: string): NumberDraft {
  const draft = parseNumberInput(raw);
  if (draft.state !== "VALID") return draft;
  // La division est faite sur la valeur lue, jamais sur la chaîne : `"3,5" / 100` n'a pas
  // de sens, et un `replace` de plus serait une seconde convention de lecture.
  return { state: "VALID", value: draft.value / 100 };
}

/** Rend un taux décimal sous sa forme de saisie en pourcentage. `null` reste vide. */
export function formatPercentForInput(rate: number | null): string {
  if (rate === null) return "";
  // Le produit du taux par cent réintroduit les artefacts du binaire (0,07 × 100 = 7,000000000000001).
  // L'arrondi à dix décimales les efface sans toucher à la précision réellement utile d'un
  // taux, qui est persisté en `numeric(12,8)`.
  const percent = Math.round(rate * 100 * 1e10) / 1e10;
  return String(percent).replace(".", ",");
}

/** Rend un montant sous sa forme de saisie, virgule décimale française. `null` reste vide. */
export function formatNumberForInput(value: number | null): string {
  if (value === null) return "";
  return String(value).replace(".", ",");
}

/**
 * Une date existe-t-elle réellement au calendrier ?
 *
 * `new Date("2026-02-31")` ne lève pas : il rend le 3 mars. Une date fantôme traverserait
 * donc toutes les comparaisons de chaînes du produit et produirait des dénominateurs faux
 * plutôt qu'une erreur visible.
 *
 * Cette fonction était dupliquée dans `src/lib/validation/mutations.ts`. Elle est ici parce
 * que la saisie et la validation doivent partager la MÊME définition : deux définitions,
 * c'est un champ qui accepte ce que l'écriture refuse.
 */
export function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export type DateParseReason =
  /** La forme n'est pas `AAAA-MM-JJ`. */
  | "NOT_ISO"
  /** La forme est bonne mais le jour n'existe pas : 31 février, 30 février bissextile. */
  | "NOT_A_CALENDAR_DATE";

export type DateDraft =
  | { readonly state: "EMPTY"; readonly value: null }
  | { readonly state: "INVALID"; readonly value: null; readonly reason: DateParseReason }
  | { readonly state: "VALID"; readonly value: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lit une date de saisie. Aucun repli sur la date du jour ni sur la date d'arrêté : un champ
 * de date vide reste vide, comme l'exige la section 18.3 du plan de refonte.
 */
export function parseDateInput(raw: string): DateDraft {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { state: "EMPTY", value: null };
  if (!ISO_DATE.test(trimmed)) return { state: "INVALID", value: null, reason: "NOT_ISO" };
  if (!isRealCalendarDate(trimmed)) {
    return { state: "INVALID", value: null, reason: "NOT_A_CALENDAR_DATE" };
  }
  return { state: "VALID", value: trimmed };
}
