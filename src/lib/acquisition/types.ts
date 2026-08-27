/**
 * DATA ACQUISITION FOUNDATION — TYPES CANONIQUES
 *
 * Cette couche ne calcule AUCUNE finance. Elle transporte des faits d'une source vers les
 * moteurs canoniques, et refuse de transporter ce qu'elle n'a pas compris.
 *
 * Quatre niveaux, jamais confondus :
 *
 *   SOURCE            d'où vient l'information (fichier, connecteur, saisie)
 *   RAW               ce que la source a réellement fourni, tel quel, immuable
 *   NORMALIZED        ce que le parseur en a compris, avec ses ambiguïtés déclarées
 *   CANONICAL         ce que le moteur de domaine accepte d'écrire, après décision
 *
 * SOURCE DATA ≠ CANONICAL DATA. RAW DATA ≠ NORMALIZED DATA. Un import ne franchit la
 * dernière frontière que par un acte explicite, jamais par le simple dépôt d'un fichier.
 */

/** Nature technique d'une source. Seule `FILE_CSV` est implémentée en V1. */
export const IMPORT_SOURCE_KINDS = ["FILE_CSV", "API", "MANUAL"] as const;
export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];

/**
 * Domaine canonique visé par une source.
 *
 * Un seul domaine existe en V1. En ajouter un est une migration ADDITIVE : la table de
 * liens porte une colonne cible par domaine, avec sa propre clé étrangère réelle. Un
 * domaine déclaré sans colonne de liaison serait une intégrité de façade.
 */
export const IMPORT_DOMAINS = ["CASH_FLOW_TRANSACTION"] as const;
export type ImportDomain = (typeof IMPORT_DOMAINS)[number];

/** Statut d'une source. Repris de la doctrine connecteurs, utile dès le mode fichier. */
export const IMPORT_SOURCE_STATUSES = [
  "ACTIVE",
  "STALE",
  "REAUTH_REQUIRED",
  "RATE_LIMITED",
  "ERROR",
  "DISCONNECTED",
  "FILE_ONLY",
  "MANUAL",
] as const;
export type ImportSourceStatus = (typeof IMPORT_SOURCE_STATUSES)[number];

/** Cycle de vie d'une session d'import. `COMMITTED` est terminal et irréversible. */
export const IMPORT_SESSION_STATUSES = ["ANALYZED", "COMMITTED", "DISCARDED", "FAILED"] as const;
export type ImportSessionStatus = (typeof IMPORT_SESSION_STATUSES)[number];

/**
 * État d'une ligne normalisée. Distinct du verdict de déduplication : une ligne peut être
 * parfaitement lisible (aucune erreur) et rester un doublon.
 *
 *   READY      lisible, complète, nouvelle : committable
 *   WARNING    lisible mais discutable : committable sur décision explicite
 *   BLOCKED    non lisible ou incohérente : jamais committable
 *   DUPLICATE  déjà présente à l'identique : jamais committable
 *   IGNORED    ligne vide ou ligne de total : hors périmètre, ce n'est pas une erreur
 */
export const IMPORT_ROW_STATUSES = ["READY", "WARNING", "BLOCKED", "DUPLICATE", "IGNORED"] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

/**
 * Verdict de déduplication.
 *
 * DUPLICATE ≠ NEW EVENT, mais RESSEMBLANCE ≠ DOUBLON : deux cafés du même jour au même
 * prix sont deux dépenses réelles. Seul `EXACT_DUPLICATE` est écarté sans demander.
 */
export const IMPORT_DEDUPE_VERDICTS = [
  "NEW",
  "EXACT_DUPLICATE",
  "PROBABLE_DUPLICATE",
  "POSSIBLE_MATCH",
] as const;
export type ImportDedupeVerdict = (typeof IMPORT_DEDUPE_VERDICTS)[number];

/** État d'écriture canonique d'une ligne normalisée. */
export const IMPORT_COMMIT_STATES = ["PENDING", "COMMITTED", "EXCLUDED"] as const;
export type ImportCommitState = (typeof IMPORT_COMMIT_STATES)[number];

export type ImportIssueSeverity = "ERROR" | "WARNING" | "INFO";

/**
 * Anomalie structurée. « Error parsing line 74 » ne dit ni ce qui a échoué, ni sur quelle
 * valeur, ni ce que l'utilisateur peut faire. Chaque anomalie porte donc son code, son
 * champ, la valeur source telle quelle, et une explication en français.
 */
export interface ImportIssue {
  code: ImportIssueCode;
  severity: ImportIssueSeverity;
  /** Champ cible concerné, ou `null` quand l'anomalie porte sur la ligne entière. */
  field: string | null;
  /** Valeur SOURCE, jamais normalisée : c'est elle que l'utilisateur relira. */
  sourceValue: string | null;
  message: string;
}

export const IMPORT_ISSUE_CODES = [
  // Fichier
  "FILE_EMPTY",
  "FILE_TOO_MANY_ROWS",
  "DELIMITER_AMBIGUOUS",
  "DELIMITER_UNDETECTED",
  "ENCODING_FALLBACK",
  "HEADER_MISSING",
  "HEADER_DUPLICATE",
  "COLUMN_COUNT_MISMATCH",
  // Mapping
  "MAPPING_REQUIRED_FIELD_MISSING",
  "MAPPING_AMBIGUOUS",
  "MAPPING_CONFLICT",
  "MAPPING_AMOUNT_SHAPE",
  "MAPPING_UNKNOWN_COLUMN",
  // Conventions
  "AMOUNT_CONVENTION_AMBIGUOUS",
  "DATE_CONVENTION_AMBIGUOUS",
  // Ligne
  "ROW_EMPTY",
  "ROW_TOTAL_SUSPECTED",
  "DATE_MISSING",
  "DATE_UNPARSEABLE",
  "DATE_NOT_A_CALENDAR_DATE",
  "DATE_TWO_DIGIT_YEAR",
  "DATE_IN_FUTURE",
  "LABEL_MISSING",
  "AMOUNT_MISSING",
  "AMOUNT_UNPARSEABLE",
  "AMOUNT_ZERO",
  "DEBIT_AND_CREDIT_BOTH_SET",
  "CURRENCY_MISSING",
  "CURRENCY_UNKNOWN",
  "CURRENCY_FROM_SESSION_DECLARATION",
  // Déduplication
  "DUPLICATE_EXACT",
  "DUPLICATE_PROBABLE",
  "POSSIBLE_MATCH",
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];

/** Convention décimale retenue pour une COLONNE, jamais devinée ligne par ligne. */
export type AmountConvention = "DECIMAL_COMMA" | "DECIMAL_POINT" | "INTEGER" | "AMBIGUOUS";
/** Convention de date retenue pour une COLONNE. */
export type DateConvention = "ISO" | "DAY_FIRST" | "MONTH_FIRST" | "AMBIGUOUS";

/** Encodage effectivement utilisé pour décoder les octets reçus. */
export type SourceEncoding = "UTF_8" | "UTF_8_BOM" | "WINDOWS_1252";

/** Champs cibles du schéma normalisé bancaire. */
export const BANK_TARGET_FIELDS = [
  "transactionDate",
  "valueDate",
  "label",
  "amount",
  "debit",
  "credit",
  "currency",
  "externalReference",
  "counterparty",
  "balanceAfter",
] as const;
export type BankTargetField = (typeof BANK_TARGET_FIELDS)[number];

/**
 * Association colonne source → champ cible. La clé est le champ cible, la valeur l'index
 * de colonne : un champ cible ne peut donc pas être alimenté par deux colonnes.
 */
export type BankColumnMapping = Partial<Record<BankTargetField, number>>;

export type MappingConfidence = "CERTAIN" | "AMBIGUOUS" | "INCOMPLETE";

export interface BankMappingResult {
  mapping: BankColumnMapping;
  confidence: MappingConfidence;
  issues: ImportIssue[];
  /** Colonnes source qu'aucun champ cible ne consomme. Information, pas anomalie. */
  unmappedHeaders: string[];
}

/**
 * Conventions retenues au niveau du fichier, exposées pour être relisibles plus tard.
 *
 * Elles sont persistées avec la session : un montant relu dans six mois doit pouvoir être
 * confronté à la règle qui l'a produit, sinon l'audit s'arrête à « le parseur a dit 54,28 ».
 */
export interface SourceConventions {
  amount: AmountConvention;
  /** Convention de la colonne de date d'opération. */
  date: DateConvention;
  /** Convention de la colonne de date de valeur. `null` = colonne absente. */
  valueDate: DateConvention | null;
}

/** Ligne brute telle que le parseur l'a découpée. Immuable. */
export interface RawRow {
  rowNumber: number;
  cells: string[];
  /** Ligne reconstituée : ce que l'utilisateur relira pour comprendre le découpage. */
  rawLine: string;
}

/**
 * Ligne normalisée, candidate à l'écriture canonique.
 *
 * Chaque champ monétaire ou daté est `null` quand la source ne l'a pas fourni ou que le
 * parseur ne l'a pas compris. Aucun `null` n'est remplacé par une valeur plausible.
 */
export interface NormalizedBankRow {
  rowNumber: number;
  transactionDate: string | null;
  valueDate: string | null;
  label: string | null;
  /** Montant SIGNÉ en devise native : négatif pour une sortie. */
  amount: number | null;
  currency: string | null;
  externalReference: string | null;
  counterparty: string | null;
  /** Solde après opération, conservé pour la traçabilité. Aucun calcul ne le consomme. */
  balanceAfter: number | null;
  status: ImportRowStatus;
  /**
   * Verdict de déduplication. `null` = NON ÉVALUÉ, parce que la ligne est vide, hors
   * périmètre ou trop incomplète pour être identifiée. Ce n'est pas « nouvelle ».
   */
  verdict: ImportDedupeVerdict | null;
  /**
   * Empreinte déterministe servant à la déduplication de second rang. `null` quand la
   * ligne n'est pas assez complète pour être identifiée.
   */
  fingerprint: string | null;
  /** Identifiant stable fourni par la source, préfixé par la source. Rang supérieur. */
  externalKey: string | null;
  /** Transaction déjà présente que ce candidat reproduit, quand elle est identifiée. */
  matchedTransactionId: string | null;
  issues: ImportIssue[];
}

/** Décompte d'une session. Aucun total n'est arrondi ni estimé. */
export interface ImportRowCounts {
  total: number;
  ready: number;
  warning: number;
  blocked: number;
  duplicate: number;
  ignored: number;
}

/** Résultat complet d'une analyse de fichier : le dry-run, avant toute écriture canonique. */
export interface BankCsvAnalysis {
  encoding: SourceEncoding;
  delimiter: string;
  headers: string[];
  mapping: BankColumnMapping;
  mappingConfidence: MappingConfidence;
  conventions: SourceConventions;
  /** Signature du format, seule clé de réutilisation d'un mapping validé. */
  signature: string;
  /**
   * Lignes BRUTES telles que le découpage les a produites. Elles sont persistées à
   * l'identique : c'est la seule chose qui permette plus tard de relire ce que la source a
   * réellement fourni, indépendamment de ce que le parseur en a compris.
   */
  rawRows: RawRow[];
  rows: NormalizedBankRow[];
  counts: ImportRowCounts;
  /** Anomalies de fichier, distinctes des anomalies de ligne. */
  issues: ImportIssue[];
  /** Bornes des dates réellement OBSERVÉES. Ne certifient aucune exhaustivité. */
  observedPeriod: { start: string; end: string } | null;
}

/** Transaction déjà canonique, telle que la déduplication a besoin de la lire. */
export interface ExistingTransactionFact {
  id: string;
  accountId: string;
  date: string;
  label: string;
  amount: number;
  currency: string;
  /** Clé externe si la transaction vient elle-même d'un import qui en portait une. */
  externalKey: string | null;
}
