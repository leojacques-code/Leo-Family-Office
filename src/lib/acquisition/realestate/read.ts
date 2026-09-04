/**
 * LECTEURS DÉFENSIFS
 *
 * Chaque lecteur rend une valeur SÛRE ou `null` accompagné d'une anomalie nommée. Aucun ne
 * coerce : `Number("douze")` vaut `NaN`, `Number("")` vaut 0, et les deux seraient des
 * mensonges. Une donnée mal typée par la source est une donnée INCONNUE, pas une donnée à
 * deviner.
 *
 * C'est ce fichier qui garantit le mode d'échec de toute la verticale : quand une source
 * publique change de forme sans avertir, la lecture devient « inconnu et signalé », jamais
 * « valeur plausible ».
 */

import { publicDataIssue, type PublicDataIssue } from "./types";

export type Row = Record<string, unknown>;

/** Vrai si la valeur est absente au sens de la source : `null`, `undefined` ou chaîne vide. */
function isBlank(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === "string" && value.trim() === "")
  );
}

export function readText(
  row: Row,
  field: string,
  index: number,
  issues: PublicDataIssue[],
): string | null {
  const value = row[field];
  if (isBlank(value)) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  issues.push(
    publicDataIssue(
      "FIELD_UNREADABLE",
      "WARNING",
      index,
      field,
      `Le champ « ${field} » n'est pas un texte lisible (${typeof value}) : il reste inconnu`,
    ),
  );
  return null;
}

/**
 * Lit un nombre fini et positif ou nul.
 *
 * Une chaîne est acceptée parce que les jeux publics en renvoient couramment, mais SEULEMENT
 * si elle décrit entièrement un nombre. « 12 m² » n'est pas 12 : c'est une valeur que la
 * source n'a pas donnée sous forme numérique, et l'amputer inventerait une unité.
 */
export function readNumber(
  row: Row,
  field: string,
  index: number,
  issues: PublicDataIssue[],
): number | null {
  const value = row[field];
  if (isBlank(value)) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issues.push(
        publicDataIssue(
          "FIELD_UNREADABLE",
          "WARNING",
          index,
          field,
          `Le champ « ${field} » n'est pas un nombre fini : il reste inconnu`,
        ),
      );
      return null;
    }
    return value;
  }
  if (typeof value === "string") {
    // Les jeux publics français écrivent parfois la virgule décimale. Aucune ambiguïté ici :
    // un séparateur de milliers n'apparaît pas dans un champ numérique JSON, et une valeur
    // portant les deux est refusée plutôt qu'arbitrée.
    const text = value.trim();
    if (text.includes(",") && text.includes(".")) {
      issues.push(
        publicDataIssue(
          "FIELD_UNREADABLE",
          "WARNING",
          index,
          field,
          `Le champ « ${field} » porte à la fois virgule et point (« ${text} ») : la convention décimale est indécidable, la valeur reste inconnue`,
        ),
      );
      return null;
    }
    const candidate = Number(text.replace(",", "."));
    if (!/^-?\d+(\.\d+)?$/.test(text.replace(",", ".")) || !Number.isFinite(candidate)) {
      issues.push(
        publicDataIssue(
          "FIELD_UNREADABLE",
          "WARNING",
          index,
          field,
          `Le champ « ${field} » ne décrit pas entièrement un nombre (« ${text} ») : il reste inconnu`,
        ),
      );
      return null;
    }
    return candidate;
  }
  issues.push(
    publicDataIssue(
      "FIELD_UNREADABLE",
      "WARNING",
      index,
      field,
      `Le champ « ${field} » n'est pas exploitable comme nombre (${typeof value})`,
    ),
  );
  return null;
}

/**
 * Lit une surface. Une surface de zéro n'existe pas : la source qui l'écrit dit « je ne sais
 * pas », et la retenir rendrait un prix au mètre carré infini.
 *
 * SURFACE ABSENTE ≠ SURFACE NULLE.
 */
export function readArea(
  row: Row,
  field: string,
  index: number,
  issues: PublicDataIssue[],
): number | null {
  const value = readNumber(row, field, index, issues);
  if (value === null) return null;
  if (value <= 0) {
    issues.push(
      publicDataIssue(
        "FIELD_UNREADABLE",
        "INFO",
        index,
        field,
        `Surface « ${field} » à ${value} : une surface nulle ou négative n'est pas une surface, elle reste inconnue`,
      ),
    );
    return null;
  }
  return value;
}

export function readInteger(
  row: Row,
  field: string,
  index: number,
  issues: PublicDataIssue[],
): number | null {
  const value = readNumber(row, field, index, issues);
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    issues.push(
      publicDataIssue(
        "FIELD_UNREADABLE",
        "INFO",
        index,
        field,
        `Le champ « ${field} » vaut ${value} : un décompte entier positif était attendu, la valeur reste inconnue`,
      ),
    );
    return null;
  }
  return value;
}

/**
 * Lit une date ISO. Aucun format ambigu n'est accepté : une date `03/04/2025` dans un jeu
 * public n'est pas arbitrée ici, parce que rien dans un enregistrement isolé ne tranche
 * entre le 3 avril et le 4 mars. Elle est refusée et signalée.
 */
export function readIsoDate(
  row: Row,
  field: string,
  index: number,
  issues: PublicDataIssue[],
): string | null {
  const text = readText(row, field, index, issues);
  if (text === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match === null) {
    issues.push(
      publicDataIssue(
        "FIELD_UNREADABLE",
        "WARNING",
        index,
        field,
        `La date « ${text} » du champ « ${field} » n'est pas au format ISO : rien ne tranche l'ordre jour/mois sur un enregistrement isolé, elle reste inconnue`,
      ),
    );
    return null;
  }
  const [, year, month, day] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    issues.push(
      publicDataIssue(
        "FIELD_UNREADABLE",
        "WARNING",
        index,
        field,
        `La date « ${text} » est hors bornes calendaires : elle reste inconnue`,
      ),
    );
    return null;
  }
  return `${year}-${month}-${day}`;
}

/** Lit un code à N chiffres exactement. Un code tronqué désignerait une autre commune. */
export function readCode(
  row: Row,
  field: string,
  length: number,
  index: number,
  issues: PublicDataIssue[],
): string | null {
  const text = readText(row, field, index, issues);
  if (text === null) return null;
  // Les codes INSEE de Corse portent une lettre (2A, 2B) : la contrainte est la LONGUEUR et
  // le jeu de caractères, pas « uniquement des chiffres ».
  const compact = text.replace(/\s+/g, "").toUpperCase();
  if (compact.length !== length || !/^[0-9A-Z]+$/.test(compact)) {
    issues.push(
      publicDataIssue(
        "FIELD_UNREADABLE",
        "INFO",
        index,
        field,
        `Le code « ${text} » n'a pas la forme attendue (${length} caractères) : il reste inconnu plutôt que tronqué`,
      ),
    );
    return null;
  }
  return compact;
}

/** Lit une étiquette énergétique. Hors A à G, l'étiquette est inconnue, jamais « G ». */
export function readEnergyLabel(
  row: Row,
  field: string,
  index: number,
  issues: PublicDataIssue[],
): string | null {
  const text = readText(row, field, index, issues);
  if (text === null) return null;
  const compact = text.trim().toUpperCase();
  if (!/^[A-G]$/.test(compact)) {
    issues.push(
      publicDataIssue(
        "FIELD_UNREADABLE",
        "WARNING",
        index,
        field,
        `Étiquette « ${text} » hors de l'échelle A à G : elle reste inconnue. Une étiquette absente n'est pas une étiquette G`,
      ),
    );
    return null;
  }
  return compact;
}

/** Extrait le tableau d'enregistrements d'un corps de réponse, sans rien supposer. */
export function readRecordArray(
  body: unknown,
  candidateKeys: readonly string[],
  issues: PublicDataIssue[],
): Row[] | null {
  if (Array.isArray(body)) {
    return body.filter((entry): entry is Row => typeof entry === "object" && entry !== null);
  }
  if (typeof body !== "object" || body === null) {
    issues.push(
      publicDataIssue(
        "SHAPE_UNEXPECTED",
        "ERROR",
        null,
        null,
        "La réponse n'est ni un tableau ni un objet : aucun enregistrement ne peut en être lu",
      ),
    );
    return null;
  }
  const record = body as Row;
  for (const key of candidateKeys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is Row => typeof entry === "object" && entry !== null);
    }
  }
  issues.push(
    publicDataIssue(
      "SHAPE_UNEXPECTED",
      "ERROR",
      null,
      null,
      `Aucun tableau d'enregistrements trouvé sous ${candidateKeys.join(", ")} : la forme de la réponse a changé, et rien n'en est déduit`,
    ),
  );
  return null;
}
