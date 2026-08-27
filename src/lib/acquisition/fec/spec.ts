/**
 * FEC — SPÉCIFICATION DU FORMAT
 *
 * Le Fichier des Écritures Comptables est un format RÉGLEMENTAIRE français : article
 * A47 A-1 du Livre des procédures fiscales, arrêté du 29 juillet 2013. Il impose
 * DIX-HUIT champs, dans un ORDRE FIXE, pour une comptabilité en partie double.
 *
 * Un champ non employé par l'entreprise peut être laissé vide : l'ordre est obligatoire,
 * le remplissage ne l'est pas. C'est exactement la distinction ABSENT ≠ ZÉRO, portée cette
 * fois par la réglementation elle-même.
 *
 * Ce que cette couche NE fait pas : elle ne certifie pas la conformité fiscale d'un
 * fichier. Elle le lit, et dit ce qu'elle n'a pas compris.
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
export type FecField = (typeof FEC_FIELDS)[number];

/**
 * Champs dont l'absence de VALEUR est normale et sans conséquence : ils ne concernent
 * qu'une partie des écritures. Les autres, absents, produisent une anomalie.
 */
export const FEC_OPTIONAL_FIELDS: ReadonlySet<FecField> = new Set([
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
]);

/**
 * Séparateurs admis par le format. La tabulation et la barre verticale sont les deux
 * formes rencontrées ; le point-virgule est toléré ici parce que des exports d'éditeurs
 * l'utilisent, et le refuser rendrait illisible un fichier par ailleurs conforme.
 */
export const FEC_DELIMITERS = ["\t", "|", ";"] as const;

/** Forme comparable d'un nom de champ : la casse et les espaces varient d'un éditeur à l'autre. */
export function normalizeFieldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toLowerCase();
}

const FIELD_BY_NORMALIZED = new Map<string, FecField>(
  FEC_FIELDS.map((field) => [normalizeFieldName(field), field]),
);

export interface FecHeaderResolution {
  /** Position de chaque champ reconnu. Un champ absent n'y figure pas. */
  positions: Partial<Record<FecField, number>>;
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
  // Sans débit ni crédit, il n'y a pas de comptabilité à reconstruire.
  if (positions.Debit === undefined && positions.Credit === undefined) {
    issues.push(
      issue(
        "FEC_HEADER_MISSING_FIELD",
        "ERROR",
        "Ni « Debit » ni « Credit » dans l'en-tête : aucun montant ne peut être lu.",
        "Debit",
      ),
    );
  }

  const recognised = Object.keys(positions).length;
  if (recognised > 0 && recognised < FEC_FIELDS.length) {
    issues.push(
      issue(
        "FEC_HEADER_INVALID",
        "WARNING",
        `${recognised} champs réglementaires sur ${FEC_FIELDS.length} reconnus. Les champs absents resteront non renseignés, ils ne seront pas devinés.`,
      ),
    );
  }

  const expectedOrder = FEC_FIELDS.filter((field) => positions[field] !== undefined);
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

  return { positions, unknownHeaders, issues };
}
