/**
 * MAPPING DES COLONNES D'UN FICHIER DE PORTEFEUILLE
 *
 * Même doctrine que le mapping bancaire, et le même `normalizeHeader` : l'affectation est
 * gloutonne par force décroissante, un en-tête et un champ ne servent qu'une fois, et deux
 * en-têtes qui revendiquent le même champ avec la même force rendent le mapping AMBIGU.
 *
 * Deux règles propres à ce domaine :
 *
 *   * L'ORDRE DES COLONNES N'A AUCUNE IMPORTANCE. Rien n'est déduit d'une position : un
 *     export dont les colonnes sont permutées se lit à l'identique. Une reconnaissance
 *     positionnelle transformerait une quantité en prix au premier changement d'export.
 *
 *   * UNE COLONNE INCONNUE N'EST PAS UNE ERREUR, mais elle est SIGNALÉE. Un export de
 *     courtier porte des colonnes que ce dépôt n'exploite pas ; les taire laisserait croire
 *     que tout a été lu.
 */

import { normalizeHeader } from "@/lib/acquisition/mapping";
import { issue } from "@/lib/acquisition/normalization";
import type { ImportIssue } from "@/lib/acquisition/types";

import {
  LEDGER_TARGET_FIELDS,
  POSITION_TARGET_FIELDS,
  type PortfolioColumnMapping,
  type PortfolioImportKind,
  type PortfolioMappingResult,
  type PortfolioTargetField,
} from "./types";

/**
 * Synonymes d'en-tête, français et anglais.
 *
 * Ce sont des SYNONYMES DE LIBELLÉ, pas une nomenclature de courtier : aucun format
 * propriétaire n'est déduit d'ici, et un en-tête non reconnu reste non mappé plutôt que
 * rattaché au champ le plus proche.
 */
const SYNONYMS: Record<PortfolioTargetField, readonly string[]> = {
  eventType: [
    "type",
    "type operation",
    "type d operation",
    "nature",
    "nature operation",
    "operation",
    "sens",
    "transaction type",
    "activity type",
    "action",
  ],
  eventDate: [
    "date",
    "date operation",
    "date d operation",
    "date execution",
    "trade date",
    "transaction date",
    "date transaction",
  ],
  settlementDate: [
    "date reglement",
    "date de reglement",
    "settlement date",
    "value date",
    "date valeur",
  ],
  asOfDate: [
    "date",
    "date arrete",
    "date d arrete",
    "date position",
    "date valorisation",
    "as of",
    "as of date",
    "report date",
  ],
  isin: ["isin", "code isin", "isin code", "identifiant isin"],
  ticker: ["ticker", "symbole", "symbol", "mnemonique", "code valeur", "code"],
  instrumentName: [
    "libelle",
    "libelle valeur",
    "designation",
    "nom",
    "nom valeur",
    "instrument",
    "security",
    "security name",
    "description",
    "produit",
  ],
  quantity: [
    "quantite",
    "qte",
    "nombre de parts",
    "nombre de titres",
    "quantity",
    "shares",
    "units",
  ],
  unitPrice: [
    "cours",
    "prix",
    "prix unitaire",
    "cours unitaire",
    "price",
    "unit price",
    "share price",
  ],
  grossAmount: [
    "montant brut",
    "brut",
    "montant",
    "gross amount",
    "amount",
    "total",
    "montant total",
  ],
  feeAmount: ["frais", "commission", "courtage", "fee", "fees", "commission amount"],
  taxAmount: ["taxe", "taxes", "impot", "prelevements", "tax", "withholding tax"],
  envelopeCashAmount: [
    "montant net",
    "net",
    "effet cash",
    "mouvement especes",
    "net amount",
    "cash amount",
    "cash flow",
  ],
  currency: ["devise", "monnaie", "currency", "ccy"],
  externalReference: [
    "reference",
    "reference operation",
    "numero operation",
    "id operation",
    "order id",
    "transaction id",
    "reference externe",
  ],
  label: ["commentaire", "note", "notes", "memo", "observation", "details"],
  marketValue: [
    "valorisation",
    "valeur de marche",
    "valeur marche",
    "market value",
    "value",
    "valeur",
    "montant valorise",
  ],
  costBasis: [
    "prix de revient",
    "cout de revient",
    "prix moyen",
    "pru",
    "cost basis",
    "cost",
    "book cost",
  ],
};

function score(header: string, field: PortfolioTargetField): number {
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

/** Champs sans lesquels une ligne ne peut pas devenir un fait canonique. */
const REQUIRED: Record<PortfolioImportKind, readonly PortfolioTargetField[]> = {
  PORTFOLIO_LEDGER: ["eventType", "eventDate"],
  PORTFOLIO_POSITION: ["asOfDate", "marketValue"],
};

/**
 * Au moins un identifiant d'instrument est nécessaire pour un relevé de positions : une
 * position sans instrument ne désigne rien.
 */
const INSTRUMENT_FIELDS: readonly PortfolioTargetField[] = ["isin", "ticker", "instrumentName"];

export function inferPortfolioMapping(
  headers: readonly string[],
  kind: PortfolioImportKind,
): PortfolioMappingResult {
  const fields = kind === "PORTFOLIO_LEDGER" ? LEDGER_TARGET_FIELDS : POSITION_TARGET_FIELDS;
  const issues: ImportIssue[] = [];
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));

  const candidates: Array<{ headerIndex: number; field: PortfolioTargetField; strength: number }> =
    [];
  headers.forEach((header, headerIndex) => {
    for (const field of fields) {
      const strength = score(header, field);
      if (strength > 0) candidates.push({ headerIndex, field, strength });
    }
  });
  candidates.sort(
    (left, right) => right.strength - left.strength || left.headerIndex - right.headerIndex,
  );

  const mapping: PortfolioColumnMapping = {};
  const usedHeaders = new Set<number>();
  const usedFields = new Set<PortfolioTargetField>();
  let ambiguous = false;

  for (const candidate of candidates) {
    if (usedHeaders.has(candidate.headerIndex) || usedFields.has(candidate.field)) {
      // Concurrence à force ÉGALE sur un champ déjà pris : c'est une ambiguïté réelle, et
      // choisir silencieusement rattacherait la mauvaise colonne.
      const competing = candidates.find(
        (other) =>
          other.field === candidate.field &&
          other.strength === candidate.strength &&
          other.headerIndex !== candidate.headerIndex &&
          mapping[candidate.field] === other.headerIndex,
      );
      if (competing !== undefined) {
        ambiguous = true;
        issues.push(
          issue(
            "MAPPING_AMBIGUOUS",
            "WARNING",
            `Les colonnes « ${headers[competing.headerIndex]} » et « ${headers[candidate.headerIndex]} » revendiquent « ${candidate.field} » avec la même force : confirmez le mapping`,
            candidate.field,
          ),
        );
      }
      continue;
    }
    mapping[candidate.field] = candidate.headerIndex;
    usedHeaders.add(candidate.headerIndex);
    usedFields.add(candidate.field);
  }

  // En-têtes en doublon : deux colonnes de même nom rendent toute correction ambiguë.
  const seen = new Map<string, number>();
  normalizedHeaders.forEach((header, index) => {
    if (header.length === 0) return;
    const previous = seen.get(header);
    if (previous !== undefined) {
      issues.push(
        issue(
          "HEADER_DUPLICATE",
          "WARNING",
          `En-tête « ${headers[index]} » présent aux colonnes ${previous + 1} et ${index + 1} : une correction ne saurait pas laquelle viser`,
        ),
      );
    } else {
      seen.set(header, index);
    }
  });

  // Colonnes non exploitées : signalées, jamais tues.
  headers.forEach((header, index) => {
    if (usedHeaders.has(index)) return;
    if (normalizedHeaders[index].length === 0) return;
    issues.push(
      issue(
        "MAPPING_UNKNOWN_COLUMN",
        "INFO",
        `Colonne « ${header} » non exploitée par cet import : son contenu reste dans le brut conservé, il n'entre dans aucun fait`,
      ),
    );
  });

  const missing = REQUIRED[kind].filter((field) => mapping[field] === undefined);
  for (const field of missing) {
    issues.push(
      issue(
        "MAPPING_REQUIRED_FIELD_MISSING",
        "ERROR",
        `Aucune colonne reconnue pour « ${field} » : sans elle aucune ligne ne peut devenir un fait`,
        field,
      ),
    );
  }

  if (kind === "PORTFOLIO_POSITION") {
    const hasInstrument = INSTRUMENT_FIELDS.some((field) => mapping[field] !== undefined);
    if (!hasInstrument) {
      issues.push(
        issue(
          "MAPPING_REQUIRED_FIELD_MISSING",
          "ERROR",
          "Aucune colonne d'instrument (ISIN, ticker ou libellé) : une position sans instrument ne désigne rien",
          "isin",
        ),
      );
    }
  }

  const confidence =
    missing.length > 0
      ? ("INCOMPLETE" as const)
      : ambiguous
        ? ("AMBIGUOUS" as const)
        : ("CERTAIN" as const);

  return { mapping, confidence, headers: [...headers], issues };
}

/**
 * Contrôle un mapping FOURNI par l'utilisateur. Elle refuse les formes impossibles plutôt
 * que de les corriger : deux champs sur la même colonne, une colonne hors bornes, un champ
 * requis absent.
 */
export function validatePortfolioMapping(
  mapping: PortfolioColumnMapping,
  headers: readonly string[],
  kind: PortfolioImportKind,
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const byColumn = new Map<number, PortfolioTargetField[]>();

  for (const [field, index] of Object.entries(mapping) as Array<[PortfolioTargetField, number]>) {
    if (index === undefined) continue;
    if (!Number.isInteger(index) || index < 0 || index >= headers.length) {
      issues.push(
        issue(
          "MAPPING_CONFLICT",
          "ERROR",
          `Le champ « ${field} » vise la colonne ${index + 1}, hors des ${headers.length} colonnes du fichier`,
          field,
        ),
      );
      continue;
    }
    byColumn.set(index, [...(byColumn.get(index) ?? []), field]);
  }

  for (const [index, fields] of byColumn) {
    if (fields.length > 1) {
      issues.push(
        issue(
          "MAPPING_DUPLICATE_COLUMN",
          "ERROR",
          `La colonne « ${headers[index]} » est affectée à ${fields.join(", ")} : une colonne ne porte qu'un champ`,
        ),
      );
    }
  }

  for (const field of REQUIRED[kind]) {
    if (mapping[field] === undefined) {
      issues.push(
        issue(
          "MAPPING_REQUIRED_FIELD_MISSING",
          "ERROR",
          `Le champ requis « ${field} » n'est pas mappé`,
          field,
        ),
      );
    }
  }

  if (
    kind === "PORTFOLIO_POSITION" &&
    !INSTRUMENT_FIELDS.some((field) => mapping[field] !== undefined)
  ) {
    issues.push(
      issue(
        "MAPPING_REQUIRED_FIELD_MISSING",
        "ERROR",
        "Aucun identifiant d'instrument mappé : une position sans instrument ne désigne rien",
        "isin",
      ),
    );
  }

  return issues;
}
