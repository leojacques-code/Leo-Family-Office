/**
 * IDENTITÉ LÉGALE — SIREN et SIRET
 *
 * Fonctions pures. Aucune finance, aucun réseau.
 *
 * Point de doctrine important : la clé de contrôle d'un SIREN se vérifie par l'algorithme
 * de Luhn, mais des identifiants réellement attribués y échouent — l'administration a
 * historiquement attribué des numéros hors algorithme. Ce module ne porte donc AUCUNE liste
 * d'exceptions, parce qu'une liste tirée de la mémoire serait un chiffre sans source
 * rattachable, et parce qu'une exception oubliée bloquerait une société qui existe.
 *
 * Conséquence : un échec de clé de contrôle est un AVERTISSEMENT, jamais un refus. Le
 * format — neuf chiffres — est en revanche une exigence : une chaîne qui n'a pas la forme
 * d'un SIREN n'en est pas un.
 *
 * FORMAT INVALIDE ≠ CLÉ INVALIDE. Confondre les deux fermerait la porte à des sociétés
 * réelles ou l'ouvrirait à des saisies fautives.
 */

export interface SirenReading {
  /** Neuf chiffres, séparateurs retirés. `null` si la forme n'est pas celle d'un SIREN. */
  value: string | null;
  /** La forme est-elle celle d'un SIREN ? */
  wellFormed: boolean;
  /**
   * La clé de contrôle passe-t-elle ? `null` quand la forme est invalide : on ne vérifie
   * pas la clé de ce qui n'est pas un numéro.
   */
  checksumValid: boolean | null;
}

export interface SiretReading {
  value: string | null;
  wellFormed: boolean;
  checksumValid: boolean | null;
  /** SIREN porté par ce SIRET, quand la forme est valide. */
  siren: string | null;
}

/**
 * Retire tout ce qui n'est pas un chiffre. Les registres et les tableurs écrivent
 * indifféremment `123 456 789`, `123456789` ou `123-456-789`.
 */
function digitsOnly(input: string): string {
  return input.replace(/\D+/g, "");
}

/**
 * Luhn sur une chaîne de chiffres, en doublant un rang sur deux depuis la DROITE.
 *
 * Le SIRET se contrôle sur ses quatorze chiffres avec la même règle : c'est le rang depuis
 * la droite qui décide, et l'algorithme est donc identique pour les deux longueurs.
 */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const position = digits.length - 1 - index;
    const digit = digits.charCodeAt(position) - 48;
    if (index % 2 === 1) {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += digit;
    }
  }
  return sum % 10 === 0;
}

export function readSiren(input: unknown): SirenReading {
  if (typeof input !== "string" && typeof input !== "number") {
    return { value: null, wellFormed: false, checksumValid: null };
  }
  const digits = digitsOnly(String(input));
  if (!/^\d{9}$/.test(digits)) {
    return { value: null, wellFormed: false, checksumValid: null };
  }
  return { value: digits, wellFormed: true, checksumValid: luhnValid(digits) };
}

export function readSiret(input: unknown): SiretReading {
  if (typeof input !== "string" && typeof input !== "number") {
    return { value: null, wellFormed: false, checksumValid: null, siren: null };
  }
  const digits = digitsOnly(String(input));
  if (!/^\d{14}$/.test(digits)) {
    return { value: null, wellFormed: false, checksumValid: null, siren: null };
  }
  return {
    value: digits,
    wellFormed: true,
    checksumValid: luhnValid(digits),
    siren: digits.slice(0, 9),
  };
}

/** `123456789` → `123 456 789`. Présentation seulement : la base stocke les neuf chiffres. */
export function formatSiren(siren: string): string {
  return /^\d{9}$/.test(siren)
    ? `${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6)}`
    : siren;
}

/** `12345678901234` → `123 456 789 01234`. */
export function formatSiret(siret: string): string {
  return /^\d{14}$/.test(siret)
    ? `${siret.slice(0, 3)} ${siret.slice(3, 6)} ${siret.slice(6, 9)} ${siret.slice(9)}`
    : siret;
}
