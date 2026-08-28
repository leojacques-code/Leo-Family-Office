/**
 * FEC — SPÉCIFICATION DU FORMAT
 *
 * Le Fichier des Écritures Comptables est un format RÉGLEMENTAIRE français : article
 * A47 A-1 du Livre des procédures fiscales, arrêté du 29 juillet 2013. Il impose
 * DIX-HUIT champs, dans un ORDRE FIXE, pour une comptabilité en partie double.
 *
 * Ce que le texte primaire dit, et que cette couche respecte :
 *
 *   * dix-huit champs, dans l'ordre du texte ;
 *   * un champ non employé peut être laissé À BLANC : l'ordre est obligatoire, le
 *     remplissage ne l'est pas. C'est exactement la distinction ABSENT ≠ ZÉRO, portée
 *     cette fois par la réglementation elle-même ;
 *   * les valeurs numériques peuvent être SIGNÉES. Un montant négatif est donc une donnée
 *     valide, pas une erreur de lecture — une contrepassation s'écrit ainsi ;
 *   * lorsque le système comptable ne distingue pas débit et crédit, les colonnes 12 et 13
 *     sont remplacées par `Montant` et `Sens`, `Sens` valant `D`/`C` ou `+1`/`-1`. Cette
 *     variante est aussi réglementaire que la première : la refuser rejetterait des FEC
 *     parfaitement valides ;
 *   * pour un fichier à plat, les séparateurs prévus sont la TABULATION et la BARRE
 *     VERTICALE. Le point-virgule et la virgule sont lus ici parce que des exports
 *     d'éditeurs les emploient, mais ils sont SIGNALÉS comme hors norme : lisible ≠
 *     conforme ;
 *   * les dates sont au format `AAAAMMJJ`.
 *
 * Ce que cette couche NE fait PAS, et ne fera pas : elle ne certifie AUCUNEMENT la
 * conformité fiscale d'un fichier. LFO est un moteur d'acquisition et de contrôle ; une
 * attestation de conformité relève de l'administration et du conseil, pas d'un parseur.
 * Elle lit, et elle dit ce qu'elle n'a pas compris.
 */

import { issue } from "@/lib/acquisition/normalization";
import type { ImportIssue } from "@/lib/acquisition/types";

/**
 * Les dix-huit champs, dans l'ordre réglementaire. L'ordre de ce tableau EST la
 * spécification : il sert à la fois de contrat de position et de contrôle d'en-tête.
 */
export const FEC_FIELDS = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
] as const;
/**
 * Variante réglementaire des colonnes 12 et 13, quand le système comptable ne tient pas
 * débit et crédit séparément. Elle REMPLACE `Debit` et `Credit`, elle ne s'y ajoute pas.
 */
export const FEC_AMOUNT_ALTERNATIVE_FIELDS = ["Montant", "Sens"] as const;

export type FecField =
  | (typeof FEC_FIELDS)[number]
  | (typeof FEC_AMOUNT_ALTERNATIVE_FIELDS)[number];

/** Représentation des montants réellement portée par le fichier. */
export type FecAmountSchema = "DEBIT_CREDIT" | "MONTANT_SENS";

/**
 * Sens de la variante `Montant`/`Sens`, normalisé.
 *
 * Le texte primaire prévoit QUATRE valeurs, et quatre seulement : `D`, `C`, `+1`, `-1`. Il
 * précise que le signe de `+1` et `-1` est présent, sans espace entre le signe et le
 * chiffre. Un `1` nu n'est donc PAS une valeur réglementaire.
 *
 * Il reste LU, et signalé — même doctrine que le point-virgule et que les formats de date
 * hors norme : refuser un fichier entièrement écrit en `1`/`-1` le rendrait inutilisable
 * alors que son sens ne fait aucun doute, et l'accepter en silence le présenterait comme
 * conforme. Le contrat est donc explicite : `conforming` dit si la valeur est celle du
 * texte, `direction` dit ce qu'elle signifie.
 *
 * Tout autre contenu ne produit AUCUNE direction : un montant dont le sens est inconnu
 * n'est pas un montant, et deviner reviendrait à inverser un jour un produit et une charge.
 */
export interface FecSensReading {
  direction: "DEBIT" | "CREDIT" | null;
  /** La valeur lue est-elle l'une des quatre du texte réglementaire ? */
  conforming: boolean;
}

export function normalizeFecSens(raw: string): FecSensReading {
  const value = raw.trim().toUpperCase();
  if (value === "D" || value === "+1") return { direction: "DEBIT", conforming: true };
  if (value === "C" || value === "-1") return { direction: "CREDIT", conforming: true };
  // Toléré, jamais présenté comme conforme.
  if (value === "1") return { direction: "DEBIT", conforming: false };
  return { direction: null, conforming: false };
}

/**
 * Champs dont le texte primaire prévoit qu'ils soient laissés À BLANC quand ils ne sont pas
 * employés. Leur absence n'est ni une anomalie de conformité, ni une anomalie financière :
 * un compte auxiliaire vide sur une écriture non auxiliarisée est la forme normale.
 */
export const FEC_BLANK_ALLOWED_FIELDS: ReadonlySet<FecField> = new Set([
  "CompAuxNum",
  "CompAuxLib",
  "EcritureLet",
  "DateLet",
  "Montantdevise",
  "Idevise",
]);

/**
 * Champs de TRAÇABILITÉ dont le blanc est un écart de conformité, et RIEN DE PLUS.
 *
 *     ÉCART DE CONFORMITÉ RÉGLEMENTAIRE  ≠  MONTANT NON CALCULABLE
 *
 * Une référence de pièce absente empêche de remonter à un justificatif ; elle n'empêche en
 * aucune façon de reconstruire un chiffre d'affaires. Confondre les deux axes conduirait à
 * refuser un exercice entier pour un défaut d'archivage, ou à l'inverse à taire un défaut
 * de piste d'audit sous prétexte que les totaux tombent juste. Ces manques sont donc
 * signalés au niveau du FICHIER, en INFO, et ne rendent jamais une ligne inexploitable.
 */
export const FEC_TRACEABILITY_FIELDS = ["PieceRef", "PieceDate", "ValidDate"] as const;
export type FecTraceabilityField = (typeof FEC_TRACEABILITY_FIELDS)[number];

/**
 * Séparateurs prévus par le texte primaire pour un fichier à plat.
 */
export const FEC_REGULATORY_DELIMITERS = ["\t", "|"] as const;

/**
 * Séparateurs LUS sans être conformes. Des exports d'éditeurs les emploient, et refuser un
 * fichier par ailleurs exploitable serait un purisme coûteux. Mais ils sont signalés :
 * présenter un point-virgule comme une forme réglementaire du FEC serait faux.
 */
export const FEC_TOLERATED_DELIMITERS = [";", ","] as const;

/** Tous les séparateurs essayés, les conformes d'abord. */
export const FEC_DELIMITERS = [
  ...FEC_REGULATORY_DELIMITERS,
  ...FEC_TOLERATED_DELIMITERS,
] as const;

export function isRegulatoryDelimiter(delimiter: string): boolean {
  return (FEC_REGULATORY_DELIMITERS as readonly string[]).includes(delimiter);
}

/** Forme comparable d'un nom de champ : la casse et les espaces varient d'un éditeur à l'autre. */
export function normalizeFieldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toLowerCase();
}

const FIELD_BY_NORMALIZED = new Map<string, FecField>(
  [...FEC_FIELDS, ...FEC_AMOUNT_ALTERNATIVE_FIELDS].map((field) => [
    normalizeFieldName(field),
    field,
  ]),
);

export interface FecHeaderResolution {
  /** Position de chaque champ reconnu. Un champ absent n'y figure pas. */
  positions: Partial<Record<FecField, number>>;
  /** Représentation des montants retenue pour ce fichier. */
  amountSchema: FecAmountSchema;
  /** En-têtes non reconnus, conservés pour que l'utilisateur voie ce qui a été ignoré. */
  unknownHeaders: string[];
  issues: ImportIssue[];
}

/**
 * Résout l'en-tête d'un FEC.
 *
 * Le format impose l'ordre, mais on résout par NOM plutôt que par position : un export qui
 * respecte les noms et se trompe d'ordre reste lisible, alors qu'une lecture positionnelle
 * aveugle mettrait des montants dans une colonne de dates. L'écart à l'ordre réglementaire
 * est signalé, pas corrigé en silence.
 */
export function resolveFecHeader(headers: readonly string[]): FecHeaderResolution {
  const positions: Partial<Record<FecField, number>> = {};
  const unknownHeaders: string[] = [];
  const issues: ImportIssue[] = [];

  headers.forEach((header, index) => {
    const field = FIELD_BY_NORMALIZED.get(normalizeFieldName(header));
    if (!field) {
      if (header.trim().length > 0) unknownHeaders.push(header);
      return;
    }
    if (positions[field] !== undefined) {
      issues.push(
        issue(
          "FEC_HEADER_UNEXPECTED_FIELD",
          "WARNING",
          `Le champ « ${field} » apparaît plusieurs fois dans l'en-tête. Seule la première colonne est lue.`,
          field,
          header,
        ),
      );
      return;
    }
    positions[field] = index;
  });

  // Les quatre champs sans lesquels une écriture comptable n'est pas identifiable.
  for (const field of ["JournalCode", "EcritureNum", "EcritureDate", "CompteNum"] as const) {
    if (positions[field] === undefined) {
      issues.push(
        issue(
          "FEC_HEADER_MISSING_FIELD",
          "ERROR",
          `Champ réglementaire « ${field} » absent de l'en-tête : le fichier n'est pas exploitable comme FEC.`,
          field,
        ),
      );
    }
  }
  // ── Représentation des montants : les deux formes réglementaires ───────────────────
  const hasDebitCredit = positions.Debit !== undefined || positions.Credit !== undefined;
  const hasMontant = positions.Montant !== undefined;
  let amountSchema: FecAmountSchema = "DEBIT_CREDIT";

  if (hasDebitCredit && hasMontant) {
    // Deux représentations concurrentes du même montant. On retient la forme
    // débit/crédit, qui est la forme principale du texte, et on le DIT : lire les deux
    // additionnerait deux fois la même somme.
    issues.push(
      issue(
        "FEC_AMOUNT_SCHEMA_AMBIGUOUS",
        "WARNING",
        "L'en-tête porte à la fois « Debit »/« Credit » et « Montant » : seule la forme débit/crédit est lue, la colonne « Montant » est ignorée pour éviter de compter deux fois le même montant.",
        "Montant",
      ),
    );
  } else if (hasMontant) {
    amountSchema = "MONTANT_SENS";
    if (positions.Sens === undefined) {
      issues.push(
        issue(
          "FEC_HEADER_MISSING_FIELD",
          "ERROR",
          "Colonne « Montant » sans colonne « Sens » : un montant dont le sens est inconnu n'est pas exploitable, et le deviner inverserait un jour une charge et un produit.",
          "Sens",
        ),
      );
    }
  } else if (!hasDebitCredit) {
    issues.push(
      issue(
        "FEC_HEADER_MISSING_FIELD",
        "ERROR",
        "Ni « Debit »/« Credit » ni « Montant »/« Sens » dans l'en-tête : aucun montant ne peut être lu.",
        "Debit",
      ),
    );
  }

  // Champs attendus, à la lumière du schéma retenu, ET DANS L'ORDRE RÉGLEMENTAIRE.
  //
  // La substitution se fait EN PLACE : `Montant` occupe la position 12 et `Sens` la 13,
  // exactement là où le texte les attend. Les mettre en fin de liste aurait deux effets
  // faux à la fois — signaler un fichier conforme comme désordonné, et laisser passer sans
  // rien dire un fichier où ces deux colonnes sont réellement ailleurs.
  const expectedFields: readonly FecField[] =
    amountSchema === "MONTANT_SENS"
      ? FEC_FIELDS.map((field) =>
          field === "Debit" ? "Montant" : field === "Credit" ? "Sens" : field,
        )
      : FEC_FIELDS;
  const recognised = expectedFields.filter((field) => positions[field] !== undefined).length;
  if (recognised > 0 && recognised < expectedFields.length) {
    issues.push(
      issue(
        "FEC_HEADER_INVALID",
        "WARNING",
        `${recognised} champs réglementaires sur ${expectedFields.length} reconnus. Les champs absents resteront non renseignés, ils ne seront pas devinés.`,
      ),
    );
  }

  const expectedOrder = expectedFields.filter((field) => positions[field] !== undefined);
  const actualOrder = [...expectedOrder].sort(
    (left, right) => (positions[left] ?? 0) - (positions[right] ?? 0),
  );
  if (expectedOrder.join("|") !== actualOrder.join("|")) {
    issues.push(
      issue(
        "FEC_HEADER_INVALID",
        "WARNING",
        "L'ordre des colonnes s'écarte de l'ordre réglementaire. La lecture se fait par nom de champ, elle reste donc correcte.",
      ),
    );
  }

  return { positions, amountSchema, unknownHeaders, issues };
}
