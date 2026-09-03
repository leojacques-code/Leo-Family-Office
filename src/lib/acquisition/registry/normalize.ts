/**
 * LECTURE DÉFENSIVE D'UNE RÉPONSE DE REGISTRE
 *
 * Fonctions pures, sans réseau et sans accès base.
 *
 * Toute la logique de ce fichier tient dans une règle : une valeur qui n'a pas la forme
 * attendue produit `null` PLUS une anomalie nommée, jamais une coercition. `"0"` reste zéro,
 * `""` n'est pas zéro, `"n/a"` n'est pas une date, et un objet reçu là où une chaîne est
 * attendue est une anomalie de forme, pas une chaîne `"[object Object]"`.
 *
 * Conséquence directe, et voulue : si le contrat d'un fournisseur change et qu'un champ
 * disparaît ou change de nom, la lecture rend `null` avec son anomalie. Elle ne rend JAMAIS
 * une valeur fausse. C'est le seul mode de défaillance acceptable pour une couche qui
 * alimente un patrimoine.
 *
 * Aucune date n'est devinée. Un registre publie de l'ISO ; une chaîne qui n'en est pas une
 * est illisible, et l'ordre jour/mois ne s'arbitre pas au doigt mouillé sur une réponse
 * d'API — c'est un problème de fichier tabulaire, traité ailleurs.
 */

import { registryIssue, type CompanyRegistryProfileCandidate, type RegistryIssue } from "./types";
import { readSiren, readSiret } from "@/lib/acquisition/siren";

/** Navigation sûre dans un objet inconnu. */
export function pick(source: unknown, key: string): unknown {
  if (source === null || typeof source !== "object" || Array.isArray(source)) return undefined;
  return (source as Record<string, unknown>)[key];
}

/** Navigation en profondeur : `pickPath(payload, "siege", "code_postal")`. */
export function pickPath(source: unknown, ...keys: string[]): unknown {
  let current: unknown = source;
  for (const key of keys) {
    current = pick(current, key);
    if (current === undefined) return undefined;
  }
  return current;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/**
 * Chaîne non vide. Une chaîne vide ou blanche n'est PAS une valeur : le registre a laissé
 * la case vide, et le dire est une information — signalée en INFO, pas en erreur.
 */
export function readText(value: unknown, field: string, issues: RegistryIssue[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") {
    issues.push(
      registryIssue(
        "FIELD_UNEXPECTED_TYPE",
        "WARNING",
        field,
        value,
        `Champ ${field} : type inattendu (${typeof value}), valeur non reprise`,
      ),
    );
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    issues.push(
      registryIssue(
        "FIELD_EMPTY_STRING",
        "INFO",
        field,
        value,
        `Champ ${field} : renseigné à vide par le fournisseur, donc inconnu et non zéro`,
      ),
    );
    return null;
  }
  return trimmed;
}

/** Entier. Une chaîne numérique est acceptée ; « environ 12 » ne l'est pas. */
export function readInteger(value: unknown, field: string, issues: RegistryIssue[]): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      issues.push(
        registryIssue(
          "FIELD_UNREADABLE_NUMBER",
          "WARNING",
          field,
          value,
          `Champ ${field} : entier attendu, valeur non reprise`,
        ),
      );
      return null;
    }
    return value;
  }
  if (typeof value !== "string") {
    issues.push(
      registryIssue(
        "FIELD_UNEXPECTED_TYPE",
        "WARNING",
        field,
        value,
        `Champ ${field} : type inattendu (${typeof value}), valeur non reprise`,
      ),
    );
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^-?\d+$/.test(trimmed)) {
    issues.push(
      registryIssue(
        "FIELD_UNREADABLE_NUMBER",
        "WARNING",
        field,
        value,
        `Champ ${field} : « ${trimmed} » n'est pas un entier lisible`,
      ),
    );
    return null;
  }
  return Number.parseInt(trimmed, 10);
}

/**
 * Décimal. Sur une réponse JSON, le séparateur décimal est le point : aucune convention
 * n'est devinée. Une virgule est signalée et la valeur écartée — sur un fichier tabulaire
 * l'ambiguïté se tranche colonne par colonne, ici elle n'a pas lieu d'être.
 */
export function readDecimal(value: unknown, field: string, issues: RegistryIssue[]): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issues.push(
        registryIssue(
          "FIELD_UNREADABLE_NUMBER",
          "WARNING",
          field,
          value,
          `Champ ${field} : nombre non fini, valeur non reprise`,
        ),
      );
      return null;
    }
    return value;
  }
  if (typeof value !== "string") {
    issues.push(
      registryIssue(
        "FIELD_UNEXPECTED_TYPE",
        "WARNING",
        field,
        value,
        `Champ ${field} : type inattendu (${typeof value}), valeur non reprise`,
      ),
    );
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    issues.push(
      registryIssue(
        "FIELD_UNREADABLE_NUMBER",
        "WARNING",
        field,
        value,
        `Champ ${field} : « ${trimmed} » n'est pas un nombre lisible sans convention devinée`,
      ),
    );
    return null;
  }
  return Number.parseFloat(trimmed);
}

/**
 * Date ISO `YYYY-MM-DD`. Un horodatage ISO est accepté par sa partie date. Une année seule
 * ou un `YYYY-MM` ne sont PAS complétés au premier jour : compléter serait inventer un jour
 * que la source n'a pas écrit.
 */
export function readIsoDate(value: unknown, field: string, issues: RegistryIssue[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    issues.push(
      registryIssue(
        "FIELD_UNEXPECTED_TYPE",
        "WARNING",
        field,
        value,
        `Champ ${field} : date attendue sous forme de chaîne, valeur non reprise`,
      ),
    );
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(trimmed);
  if (!match) {
    issues.push(
      registryIssue(
        "FIELD_UNREADABLE_DATE",
        "WARNING",
        field,
        value,
        `Champ ${field} : « ${trimmed} » n'est pas une date ISO complète, aucune date n'est déduite`,
      ),
    );
    return null;
  }
  const [, year, month, day] = match;
  const isoDate = `${year}-${month}-${day}`;
  // Une date syntaxiquement bien formée peut ne pas exister (31 février). Le contrôle passe
  // par une reconstruction : si l'aller-retour ne redonne pas la même date, elle n'existe pas.
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== isoDate) {
    issues.push(
      registryIssue(
        "FIELD_UNREADABLE_DATE",
        "WARNING",
        field,
        value,
        `Champ ${field} : la date « ${trimmed} » n'existe pas au calendrier`,
      ),
    );
    return null;
  }
  return isoDate;
}

/** Booléen. Une chaîne `"true"`/`"false"` est acceptée ; `"1"` ne l'est pas. */
export function readBoolean(
  value: unknown,
  field: string,
  issues: RegistryIssue[],
): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
    if (lowered.length === 0) return null;
  }
  issues.push(
    registryIssue(
      "FIELD_UNEXPECTED_TYPE",
      "WARNING",
      field,
      value,
      `Champ ${field} : booléen attendu, valeur non reprise`,
    ),
  );
  return null;
}

/** Code pays sur deux lettres majuscules. Un libellé de pays n'en est pas un. */
export function readCountryCode(
  value: unknown,
  field: string,
  issues: RegistryIssue[],
): string | null {
  const text = readText(value, field, issues);
  if (text === null) return null;
  const upper = text.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) {
    issues.push(
      registryIssue(
        "FIELD_UNEXPECTED_TYPE",
        "WARNING",
        field,
        value,
        `Champ ${field} : « ${text} » n'est pas un code pays ISO à deux lettres`,
      ),
    );
    return null;
  }
  return upper;
}

/** Devise ISO 4217. FX ABSENT ≠ FX ÉGAL À 1 : un code illisible n'est pas l'euro. */
export function readCurrency(
  value: unknown,
  field: string,
  issues: RegistryIssue[],
): string | null {
  const text = readText(value, field, issues);
  if (text === null) return null;
  const upper = text.toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) {
    issues.push(
      registryIssue(
        "FIELD_UNEXPECTED_TYPE",
        "WARNING",
        field,
        value,
        `Champ ${field} : « ${text} » n'est pas un code devise ISO 4217`,
      ),
    );
    return null;
  }
  return upper;
}

/** SIREN lu avec sa clé de contrôle en avertissement, jamais en refus. */
export function readSirenField(
  value: unknown,
  field: string,
  issues: RegistryIssue[],
): string | null {
  if (value === undefined || value === null) return null;
  const reading = readSiren(value);
  if (!reading.wellFormed) {
    issues.push(
      registryIssue(
        "SIREN_MALFORMED",
        "ERROR",
        field,
        value,
        `Champ ${field} : la valeur n'a pas la forme d'un SIREN (neuf chiffres)`,
      ),
    );
    return null;
  }
  if (reading.checksumValid === false) {
    issues.push(
      registryIssue(
        "SIREN_CHECKSUM_FAILED",
        "WARNING",
        field,
        value,
        `Champ ${field} : clé de contrôle du SIREN non vérifiée. Des identifiants réellement attribués y échouent : la valeur est conservée et signalée`,
      ),
    );
  }
  return reading.value;
}

/** SIRET lu avec la même doctrine, et son rattachement au SIREN vérifié. */
export function readSiretField(
  value: unknown,
  field: string,
  issues: RegistryIssue[],
  expectedSiren?: string | null,
): string | null {
  if (value === undefined || value === null) return null;
  const reading = readSiret(value);
  if (!reading.wellFormed) {
    issues.push(
      registryIssue(
        "SIRET_MALFORMED",
        "WARNING",
        field,
        value,
        `Champ ${field} : la valeur n'a pas la forme d'un SIRET (quatorze chiffres)`,
      ),
    );
    return null;
  }
  if (reading.checksumValid === false) {
    issues.push(
      registryIssue(
        "SIREN_CHECKSUM_FAILED",
        "WARNING",
        field,
        value,
        `Champ ${field} : clé de contrôle du SIRET non vérifiée. La valeur est conservée et signalée`,
      ),
    );
  }
  if (expectedSiren && reading.siren && reading.siren !== expectedSiren) {
    issues.push(
      registryIssue(
        "SIRET_SIREN_MISMATCH",
        "ERROR",
        field,
        value,
        `Champ ${field} : le SIRET porte le SIREN ${reading.siren}, l'entité déclare ${expectedSiren}. Deux identités contradictoires ne se rattachent pas`,
      ),
    );
    return null;
  }
  return reading.value;
}

/**
 * Contrôles de COHÉRENCE d'un profil lu. Ils ne corrigent rien : ils nomment ce qui ne
 * tient pas debout, et laissent la valeur telle que le registre l'a publiée.
 *
 * Deux exceptions où la valeur est ÉCARTÉE plutôt que signalée, parce que la conserver
 * introduirait un chiffre faux dans un affichage patrimonial :
 *
 *   * un capital social sans devise n'est pas un montant ;
 *   * un capital social négatif n'existe pas — un capital peut être perdu, la ligne
 *     `capital social` du registre ne devient pas négative pour autant.
 */
export function checkProfileCoherence(
  profile: CompanyRegistryProfileCandidate,
  establishmentsRead: number,
): CompanyRegistryProfileCandidate {
  const issues = [...profile.issues];
  let shareCapital = profile.shareCapital;
  let shareCapitalCurrency = profile.shareCapitalCurrency;

  if (profile.createdOn && profile.ceasedOn && profile.ceasedOn < profile.createdOn) {
    issues.push(
      registryIssue(
        "CESSATION_BEFORE_CREATION",
        "ERROR",
        "ceased_on",
        profile.ceasedOn,
        `Cessation au ${profile.ceasedOn} antérieure à la création au ${profile.createdOn} : lecture incohérente, les deux dates sont conservées telles quelles`,
      ),
    );
  }

  if (shareCapital !== null && shareCapitalCurrency === null) {
    issues.push(
      registryIssue(
        "CAPITAL_WITHOUT_CURRENCY",
        "ERROR",
        "share_capital",
        shareCapital,
        "Capital social sans devise : un montant sans devise n'est pas un montant, la valeur est écartée",
      ),
    );
    shareCapital = null;
  }

  if (shareCapital !== null && shareCapital < 0) {
    issues.push(
      registryIssue(
        "CAPITAL_NEGATIVE",
        "ERROR",
        "share_capital",
        shareCapital,
        "Capital social négatif : valeur écartée plutôt qu'affichée",
      ),
    );
    shareCapital = null;
    shareCapitalCurrency = null;
  }

  if (profile.headOfficeSiret && profile.headOfficeSiret.slice(0, 9) !== profile.siren) {
    issues.push(
      registryIssue(
        "HEAD_OFFICE_SIREN_MISMATCH",
        "ERROR",
        "head_office_siret",
        profile.headOfficeSiret,
        `Le siège déclaré porte le SIREN ${profile.headOfficeSiret.slice(0, 9)}, l'entité déclare ${profile.siren}`,
      ),
    );
  }

  // Le décompte publié et le nombre d'établissements RÉELLEMENT lus peuvent diverger
  // légitimement : une fiche d'entité ne détaille pas toujours tous ses établissements.
  // L'écart n'est donc signalé que lorsque des établissements ont bien été lus.
  if (
    profile.establishmentCount !== null &&
    establishmentsRead > 0 &&
    establishmentsRead > profile.establishmentCount
  ) {
    issues.push(
      registryIssue(
        "ESTABLISHMENT_COUNT_MISMATCH",
        "WARNING",
        "establishment_count",
        profile.establishmentCount,
        `${establishmentsRead} établissement(s) lus pour un décompte publié de ${profile.establishmentCount} : le décompte n'est pas recalculé`,
      ),
    );
  }

  return { ...profile, shareCapital, shareCapitalCurrency, issues };
}

/** Profil vierge : tout est inconnu jusqu'à preuve du contraire. */
export function emptyProfile(siren: string): CompanyRegistryProfileCandidate {
  return {
    siren,
    legalName: null,
    tradeName: null,
    acronym: null,
    legalFormCode: null,
    legalFormLabel: null,
    nafCode: null,
    nafLabel: null,
    nafNomenclature: null,
    shareCapital: null,
    shareCapitalCurrency: null,
    employeeRangeCode: null,
    employeeRangeLabel: null,
    employeeRangeYear: null,
    enterpriseCategory: null,
    createdOn: null,
    ceasedOn: null,
    registryStatus: null,
    headOfficeSiret: null,
    addressLine: null,
    postalCode: null,
    city: null,
    cityCode: null,
    country: null,
    establishmentCount: null,
    greffe: null,
    rcsNumber: null,
    issues: [],
  };
}
