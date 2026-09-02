/**
 * CONTRATS DE L'ACQUISITION DE PORTEFEUILLE
 *
 * Ils réutilisent le vocabulaire de la fondation d'acquisition (`ImportIssue`,
 * `ImportRowStatus`, `ImportDedupeVerdict`, `SourceConventions`) : un import de portefeuille
 * est un import de fichier ligne par ligne, pas une autre espèce d'objet.
 *
 * La distinction qui structure tout le module :
 *
 *   POSITION OBSERVÉE ≠ TRANSACTION DU LEDGER
 *
 * Un relevé de positions dit « au 30 juin, je détenais 12 parts valant 4 500 € ». Il ne dit
 * PAS quand ni à quel prix elles ont été achetées. Reconstruire un achat depuis une position
 * inventerait une date, un prix et des frais, et le coût de revient qui en découlerait serait
 * faux tout en paraissant calculé. Les deux natures sont donc deux domaines cibles distincts,
 * jamais convertis l'un dans l'autre.
 */

import type {
  ImportDedupeVerdict,
  ImportIssue,
  ImportRowStatus,
  SourceConventions,
} from "@/lib/acquisition/types";

/** Domaine canonique alimenté. Deux, et ils ne se remplacent pas. */
export const PORTFOLIO_IMPORT_KINDS = ["PORTFOLIO_LEDGER", "PORTFOLIO_POSITION"] as const;
export type PortfolioImportKind = (typeof PORTFOLIO_IMPORT_KINDS)[number];

/**
 * Natures d'événement. Liste reprise TELLE QUELLE de `portfolio_events_type_ck` : le ledger
 * existe déjà, cette couche l'alimente et n'en invente aucune nature.
 */
export const PORTFOLIO_EVENT_TYPES = [
  "OPENING_POSITION",
  "OPENING_CASH",
  "CONTRIBUTION",
  "WITHDRAWAL",
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "TAX",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;
export type PortfolioEventType = (typeof PORTFOLIO_EVENT_TYPES)[number];

/**
 * Natures qui EXIGENT un instrument, reprises de `portfolio_events_security_shape_ck`.
 * Un achat sans titre est un non-sens que la base refuse déjà.
 */
export const EVENT_TYPES_REQUIRING_SECURITY: ReadonlySet<PortfolioEventType> = new Set([
  "OPENING_POSITION",
  "BUY",
  "SELL",
]);

/**
 * Natures qui INTERDISENT un instrument : un apport de cash porteur d'un titre serait
 * inexploitable par le ledger.
 */
export const EVENT_TYPES_FORBIDDING_SECURITY: ReadonlySet<PortfolioEventType> = new Set([
  "OPENING_CASH",
  "CONTRIBUTION",
  "WITHDRAWAL",
]);

/** Colonnes cibles d'un fichier de LEDGER. */
export const LEDGER_TARGET_FIELDS = [
  "eventType",
  "eventDate",
  "settlementDate",
  "isin",
  "ticker",
  "instrumentName",
  "quantity",
  "unitPrice",
  "grossAmount",
  "feeAmount",
  "taxAmount",
  "envelopeCashAmount",
  "currency",
  "externalReference",
  "label",
] as const;
export type LedgerTargetField = (typeof LEDGER_TARGET_FIELDS)[number];

/** Colonnes cibles d'un fichier de POSITIONS. */
export const POSITION_TARGET_FIELDS = [
  "asOfDate",
  "isin",
  "ticker",
  "instrumentName",
  "quantity",
  "marketValue",
  "costBasis",
  "currency",
] as const;
export type PositionTargetField = (typeof POSITION_TARGET_FIELDS)[number];

export type PortfolioTargetField = LedgerTargetField | PositionTargetField;

/** Index de colonne par champ cible. Absent = champ non mappé. */
export type PortfolioColumnMapping = Partial<Record<PortfolioTargetField, number>>;

export interface PortfolioMappingResult {
  mapping: PortfolioColumnMapping;
  confidence: "CERTAIN" | "AMBIGUOUS" | "INCOMPLETE";
  /** En-têtes normalisés, dans l'ordre du fichier. */
  headers: string[];
  issues: ImportIssue[];
}

/**
 * Identifiants d'instrument tels que la SOURCE les écrit. Aucun n'est privilégié ici : la
 * résolution est une étape séparée, et son résultat est une DÉCISION persistée.
 */
export interface InstrumentKey {
  isin: string | null;
  ticker: string | null;
  name: string | null;
}

/** État de la résolution d'un instrument. `UNRESOLVED` n'est pas « nouveau ». */
export type InstrumentResolutionState = "RESOLVED" | "AMBIGUOUS" | "UNRESOLVED" | "NOT_REQUIRED";

export interface InstrumentResolution {
  /** Clé de source, stable dans le fichier : c'est elle qui porte la décision. */
  sourceKey: string;
  key: InstrumentKey;
  state: InstrumentResolutionState;
  /** Instrument retenu. `null` tant que la décision n'est pas prise. */
  securityId: string | null;
  /** Candidats trouvés, avec ce qui les a rapprochés. Jamais réduit à un seul d'office. */
  candidates: Array<{
    securityId: string;
    name: string;
    isin: string | null;
    ticker: string | null;
    basis: string;
  }>;
  issues: ImportIssue[];
}

/**
 * Ligne normalisée du LEDGER, candidate à l'écriture.
 *
 * Chaque terme monétaire est `null` quand la source ne l'a pas fourni. Aucun `null` n'est
 * remplacé par zéro : des frais inconnus ne sont pas des frais nuls, et le coût de revient
 * qui en dépend reste non calculable plutôt que flatteur.
 */
export interface NormalizedLedgerRow {
  rowNumber: number;
  eventType: PortfolioEventType | null;
  eventDate: string | null;
  settlementDate: string | null;
  instrument: InstrumentKey;
  /** Clé de source de l'instrument, `null` quand la nature n'en exige pas. */
  instrumentSourceKey: string | null;
  /** Quantité TOUJOURS positive : la direction vient du type, jamais du signe. */
  quantity: number | null;
  unitPrice: number | null;
  grossAmount: number | null;
  feeAmount: number | null;
  taxAmount: number | null;
  /** Effet SIGNÉ sur le cash de l'enveloppe. `null` = effet inconnu, jamais nul. */
  envelopeCashAmount: number | null;
  currency: string | null;
  externalReference: string | null;
  label: string | null;
  status: ImportRowStatus;
  /** `null` = déduplication NON ÉVALUÉE, pas « nouvelle ». */
  verdict: ImportDedupeVerdict | null;
  matchKey: string | null;
  externalKey: string | null;
  matchedEventId: string | null;
  issues: ImportIssue[];
}

/** Ligne normalisée d'une POSITION observée. */
export interface NormalizedPositionRow {
  rowNumber: number;
  asOfDate: string | null;
  instrument: InstrumentKey;
  instrumentSourceKey: string | null;
  quantity: number | null;
  /**
   * Valeur de marché. REQUISE : `position_snapshots.market_value` est NOT NULL, et une
   * position sans valeur observée n'est pas une observation de valeur.
   */
  marketValue: number | null;
  /** `null` = coût de revient non fourni. Ce n'est pas un coût de revient nul. */
  costBasis: number | null;
  currency: string | null;
  status: ImportRowStatus;
  verdict: ImportDedupeVerdict | null;
  matchKey: string | null;
  matchedSnapshotId: string | null;
  issues: ImportIssue[];
}

export interface PortfolioRowCounts {
  total: number;
  ready: number;
  warning: number;
  blocked: number;
  duplicate: number;
  ignored: number;
}

/** Format du fichier, tel qu'il a été RECONNU et non tel qu'il a été annoncé. */
export type PortfolioFileFormat = "CSV" | "XLSX";

export interface PortfolioAnalysis {
  kind: PortfolioImportKind;
  format: PortfolioFileFormat;
  parser: string;
  parserVersion: string;
  /** Feuille retenue pour un XLSX. `null` pour un CSV. */
  sheetName: string | null;
  /** Nom des autres feuilles, pour que l'utilisateur sache ce qui n'a PAS été lu. */
  otherSheets: string[];
  headers: string[];
  mapping: PortfolioColumnMapping;
  mappingConfidence: PortfolioMappingResult["confidence"];
  conventions: SourceConventions;
  /** Références des cellules issues d'une formule, quand la source est un XLSX. */
  formulaCells: string[];
  rawRows: Array<{ rowNumber: number; cells: string[]; rawLine: string }>;
  ledgerRows: NormalizedLedgerRow[];
  positionRows: NormalizedPositionRow[];
  instruments: InstrumentResolution[];
  counts: PortfolioRowCounts;
  issues: ImportIssue[];
}
