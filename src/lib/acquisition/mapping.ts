/**
 * MAPPING — association des colonnes source aux champs du schéma normalisé.
 *
 * Chaque banque nomme ses colonnes autrement. Le produit propose donc une association
 * quand elle est CERTAINE, et la demande quand elle ne l'est pas. Il ne l'invente jamais :
 * une colonne « Date de valeur » lue comme date d'opération décale tout un relevé.
 *
 * Un mapping validé n'est réutilisé que pour une signature de format IDENTIQUE
 * (cf. `formatSignature`). « Presque le même fichier » n'est pas le même fichier.
 */

import { issue } from "@/lib/acquisition/normalization";
import {
  BANK_TARGET_FIELDS,
  type BankColumnMapping,
  type BankMappingResult,
  type BankTargetField,
  type ImportIssue,
  type MappingConfidence,
} from "@/lib/acquisition/types";

/**
 * Synonymes observés dans les exports bancaires français et anglophones courants.
 *
 * Cette liste ne prétend pas être exhaustive : elle n'a pas à l'être. Un en-tête inconnu
 * ne casse rien, il demande simplement une confirmation à l'utilisateur.
 */
const SYNONYMS: Record<BankTargetField, readonly string[]> = {
  transactionDate: [
    "date",
    "date operation",
    "date de l operation",
    "date d operation",
    "date comptable",
    "date de comptabilisation",
    "date compta",
    "operation date",
    "booking date",
    "transaction date",
  ],
  valueDate: ["date de valeur", "date valeur", "value date"],
  label: [
    "libelle",
    "libelle operation",
    "libelle de l operation",
    "nature de l operation",
    "intitule",
    "description",
    "detail",
    "designation",
    "communication",
    "narrative",
    "wording",
    "label",
  ],
  amount: ["montant", "montant operation", "montant de l operation", "amount", "montant eur"],
  debit: ["debit", "montant debit", "debits", "sortie", "sorties", "withdrawal", "paid out"],
  credit: ["credit", "montant credit", "credits", "entree", "entrees", "deposit", "paid in"],
  currency: ["devise", "monnaie", "currency", "ccy"],
  externalReference: [
    "reference",
    "reference operation",
    "reference bancaire",
    "numero d operation",
    "transaction id",
    "id operation",
    "end to end",
    "identifiant",
  ],
  counterparty: [
    "beneficiaire",
    "contrepartie",
    "tiers",
    "emetteur",
    "payee",
    "counterparty",
    "creditor name",
    "debtor name",
  ],
  balanceAfter: ["solde", "solde apres operation", "solde courant", "balance", "running balance"],
};

/** Forme comparable d'un en-tête : sans accent, sans ponctuation, espaces normalisés. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Force de l'association entre un en-tête et un champ cible.
 *
 *   3 égalité stricte           « Montant » → amount
 *   2 préfixe                   « Montant (EUR) » → amount
 *   1 simple présence           « Date de valeur » → transactionDate, à confirmer
 */
function score(header: string, field: BankTargetField): number {
  const normalized = normalizeHeader(header);
  if (normalized.length === 0) return 0;
  let best = 0;
  for (const synonym of SYNONYMS[field]) {
    if (normalized === synonym) return 3;
    if (normalized.startsWith(`${synonym} `)) best = Math.max(best, 2);
    else if (normalized.includes(synonym)) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Propose un mapping à partir des seuls en-têtes.
 *
 * L'affectation est gloutonne par force décroissante : un en-tête et un champ ne servent
 * qu'une fois. Deux en-têtes qui revendiquent le même champ avec la même force rendent le
 * mapping AMBIGU, et une confirmation devient obligatoire.
 */
export function inferBankMapping(headers: readonly string[]): BankMappingResult {
  const candidates: Array<{ headerIndex: number; field: BankTargetField; strength: number }> = [];
  headers.forEach((header, headerIndex) => {
    BANK_TARGET_FIELDS.forEach((field) => {
      const strength = score(header, field);
      if (strength > 0) candidates.push({ headerIndex, field, strength });
    });
  });
  candidates.sort(
    (left, right) =>
      right.strength - left.strength ||
      BANK_TARGET_FIELDS.indexOf(left.field) - BANK_TARGET_FIELDS.indexOf(right.field) ||
      left.headerIndex - right.headerIndex,
  );

  const mapping: BankColumnMapping = {};
  const usedHeaders = new Set<number>();
  const issues: ImportIssue[] = [];
  const strengthByField = new Map<BankTargetField, number>();

  for (const candidate of candidates) {
    if (mapping[candidate.field] !== undefined || usedHeaders.has(candidate.headerIndex)) continue;
    const rival = candidates.find(
      (other) =>
        other.field === candidate.field &&
        other.headerIndex !== candidate.headerIndex &&
        other.strength === candidate.strength &&
        !usedHeaders.has(other.headerIndex),
    );
    if (rival) {
      issues.push(
        issue(
          "MAPPING_AMBIGUOUS",
          "WARNING",
          `Deux colonnes revendiquent « ${candidate.field} » : « ${headers[candidate.headerIndex]} » et « ${headers[rival.headerIndex]} ». Confirmer laquelle utiliser.`,
          candidate.field,
        ),
      );
    }
    mapping[candidate.field] = candidate.headerIndex;
    usedHeaders.add(candidate.headerIndex);
    strengthByField.set(candidate.field, candidate.strength);
  }

  for (const field of ["transactionDate", "label"] as const) {
    if (mapping[field] !== undefined && (strengthByField.get(field) ?? 0) < 2) {
      issues.push(
        issue(
          "MAPPING_AMBIGUOUS",
          "WARNING",
          `La colonne « ${headers[mapping[field]!]} » a été rapprochée de « ${field} » sans certitude. Confirmer l'association.`,
          field,
        ),
      );
    }
  }

  issues.push(...shapeIssues(mapping, headers));

  const unmappedHeaders = headers.filter((_, index) => !usedHeaders.has(index));
  return { mapping, confidence: confidenceOf(mapping, issues), issues, unmappedHeaders };
}

/** Anomalies de FORME d'un mapping, indépendantes de la façon dont il a été obtenu. */
function shapeIssues(mapping: BankColumnMapping, headers: readonly string[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const field of ["transactionDate", "label"] as const) {
    if (mapping[field] === undefined) {
      issues.push(
        issue(
          "MAPPING_REQUIRED_FIELD_MISSING",
          "ERROR",
          `Aucune colonne n'alimente « ${field} ». L'associer avant de continuer.`,
          field,
        ),
      );
    }
  }
  const hasAmount = mapping.amount !== undefined;
  const hasDebit = mapping.debit !== undefined;
  const hasCredit = mapping.credit !== undefined;
  if (!hasAmount && !hasDebit && !hasCredit) {
    issues.push(
      issue(
        "MAPPING_REQUIRED_FIELD_MISSING",
        "ERROR",
        "Aucune colonne de montant : associer soit un montant signé, soit des colonnes débit et crédit.",
        "amount",
      ),
    );
  }
  if (hasAmount && (hasDebit || hasCredit)) {
    issues.push(
      issue(
        "MAPPING_CONFLICT",
        "ERROR",
        "Un montant signé et des colonnes débit/crédit sont associés en même temps : le même flux serait lu deux fois. N'en garder qu'une forme.",
        "amount",
      ),
    );
  }
  for (const [field, index] of Object.entries(mapping)) {
    if (index === undefined || index < 0 || index >= headers.length) {
      issues.push(
        issue(
          "MAPPING_UNKNOWN_COLUMN",
          "ERROR",
          `Le champ « ${field} » désigne la colonne ${index}, absente du fichier.`,
          field,
        ),
      );
    }
  }
  return issues;
}

function confidenceOf(
  mapping: BankColumnMapping,
  issues: readonly ImportIssue[],
): MappingConfidence {
  if (issues.some((entry) => entry.severity === "ERROR")) return "INCOMPLETE";
  if (issues.some((entry) => entry.code === "MAPPING_AMBIGUOUS")) return "AMBIGUOUS";
  return mapping.transactionDate !== undefined && mapping.label !== undefined
    ? "CERTAIN"
    : "INCOMPLETE";
}

/**
 * Contrôle un mapping fourni par l'utilisateur ou relu depuis un mapping mémorisé.
 *
 * Une association mémorisée n'est jamais tenue pour acquise : le fichier a pu changer, et
 * un mapping qui ne colle plus doit échouer visiblement plutôt que déplacer des colonnes.
 */
export function validateBankMapping(
  headers: readonly string[],
  mapping: BankColumnMapping,
): BankMappingResult {
  const issues = shapeIssues(mapping, headers);
  const used = new Set(
    Object.values(mapping).filter((index): index is number => index !== undefined),
  );
  return {
    mapping,
    confidence: issues.some((entry) => entry.severity === "ERROR") ? "INCOMPLETE" : "CERTAIN",
    issues,
    unmappedHeaders: headers.filter((_, index) => !used.has(index)),
  };
}
