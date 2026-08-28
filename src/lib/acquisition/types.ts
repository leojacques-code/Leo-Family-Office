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

/**
 * Cycle de vie d'une session d'import. `COMMITTED` est terminal et irréversible.
 *
 * `RECEIVING` n'existe que pour les sources volumineuses reçues par lots : une session qui
 * reçoit encore ses lignes n'est pas une session analysée, et ses décomptes ne veulent
 * encore rien dire.
 */
export const IMPORT_SESSION_STATUSES = [
  "RECEIVING",
  "ANALYZED",
  "COMMITTED",
  "DISCARDED",
  "FAILED",
] as const;
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
 * prix sont deux dépenses réelles.
 *
 * `EXACT_DUPLICATE` signifie IDENTITÉ DÉMONTRÉE, et rien d'autre. Une égalité de tuple
 * (compte, date, montant, devise, libellé) ne la démontre PAS entre deux fichiers
 * distincts : un relevé partiel qui contient un troisième café identique ne prouve pas
 * qu'il s'agit d'un des deux déjà connus. Une telle égalité produit donc
 * `PROBABLE_DUPLICATE`, visible et non écrite par défaut, jamais un rejet silencieux.
 *
 * L'identité n'est démontrée que par un identifiant de transaction dont la STABILITÉ est
 * garantie par le contrat de la source — ou, au niveau session, par l'empreinte du fichier
 * déjà validé, qui bloque le réimport avant même la déduplication.
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
  "MAPPING_DUPLICATE_COLUMN",
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
  "VALUE_DATE_UNPARSEABLE",
  "BALANCE_AFTER_UNPARSEABLE",
  // FEC — format et structure
  "FEC_HEADER_INVALID",
  "FEC_HEADER_MISSING_FIELD",
  "FEC_HEADER_UNEXPECTED_FIELD",
  "FEC_FIELD_COUNT_MISMATCH",
  "FEC_NON_STANDARD_DATE_FORMAT",
  "FEC_LINE_COUNT_EXCEEDED",
  // FEC — ligne
  "FEC_JOURNAL_MISSING",
  "FEC_ENTRY_NUMBER_MISSING",
  "FEC_ENTRY_DATE_MISSING",
  "FEC_ENTRY_DATE_INVALID",
  "FEC_ACCOUNT_MISSING",
  "FEC_ACCOUNT_UNKNOWN_CLASS",
  "FEC_AMOUNT_MISSING",
  "FEC_AMOUNT_UNPARSEABLE",
  "FEC_AMOUNT_BOTH_SIDES",
  "FEC_AMOUNT_SENS_INVALID",
  "FEC_AMOUNT_SENS_NON_STANDARD",
  "FEC_AMOUNT_SCHEMA_AMBIGUOUS",
  "FEC_NON_STANDARD_DELIMITER",
  "FEC_REGULATORY_FIELD_BLANK",
  "FEC_PIECE_MISSING",
  "FEC_LETTER_DATE_WITHOUT_CODE",
  "FEC_VALID_DATE_BEFORE_ENTRY",
  "FEC_CURRENCY_AMOUNT_WITHOUT_CODE",
  "FEC_DATE_OUT_OF_FISCAL_YEAR",
  // FEC — écriture et reconstruction
  "FEC_ENTRY_UNBALANCED",
  "FEC_NO_EXPLOITABLE_LINE",
  "FEC_COVERAGE_NOT_DECLARED",
  "FEC_CASH_NEGATIVE",
  "FEC_UNEXPECTED_SIGN",
  "FEC_OUT_OF_FISCAL_YEAR_IN_DECLARED_PERIOD",
  "FEC_ACCOUNT_GROUP_ABSENT",
  "FEC_MULTI_CURRENCY",
  // Déduplication
  "DUPLICATE_EXACT",
  "DUPLICATE_PROBABLE",
  "MATCH_WITHOUT_STABLE_ID",
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
  /**
   * Colonne qui PRÉTEND porter un identifiant de transaction. « Prétend » : le nom d'un
   * en-tête ne garantit aucune stabilité. Elle ne devient une identité que si
   * l'utilisateur le DÉCLARE pour la session.
   */
  "externalTransactionId",
  /**
   * Référence descriptive : référence bancaire, numéro d'opération, motif, référence de
   * bout en bout. Une banque peut la répéter, la partager entre opérations d'un lot ou la
   * réutiliser d'un mois sur l'autre. Elle est conservée pour l'audit et ne décide JAMAIS
   * d'une identité.
   */
  "reference",
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
  /** Identifiant prétendu par la source. Ne devient une identité que sur déclaration. */
  externalTransactionId: string | null;
  /** Référence descriptive. Conservée pour l'audit, ne décide jamais d'une identité. */
  reference: string | null;
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
   * Clé de RAPPROCHEMENT, lisible et déterministe. Ce n'est PAS une identité et elle ne
   * porte aucune unicité en base : elle sert à expliquer pourquoi deux lignes se
   * ressemblent. Le rang d'occurrence qu'elle contient est local à l'analyse.
   */
  matchKey: string | null;
  /**
   * Identité DÉMONTRÉE : identifiant de transaction dont la stabilité est déclarée par la
   * source ou par l'utilisateur, préfixé par la source. `null` = aucune identité forte.
   */
  externalKey: string | null;
  /** Transaction déjà présente que ce candidat reproduit, quand elle est identifiée. */
  matchedTransactionId: string | null;
  issues: ImportIssue[];
}

/** Décompte d'une session par STATUT. Aucun total n'est arrondi ni estimé. */
export interface ImportRowCounts {
  total: number;
  ready: number;
  warning: number;
  blocked: number;
  duplicate: number;
  ignored: number;
}

/**
 * Décompte par VERDICT de déduplication. Distinct du statut : une ligne signalée peut
 * l'être parce qu'elle ressemble à une opération connue ou pour une raison de lecture, et
 * l'utilisateur n'arbitre pas les deux de la même façon.
 */
export interface ImportVerdictCounts {
  fresh: number;
  exactDuplicate: number;
  probableDuplicate: number;
  possibleMatch: number;
  notEvaluated: number;
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
  verdicts: ImportVerdictCounts;
  /** Anomalies de fichier, distinctes des anomalies de ligne. */
  issues: ImportIssue[];
  /** Bornes des dates réellement OBSERVÉES. Ne certifient aucune exhaustivité. */
  observedPeriod: { start: string; end: string } | null;
}

/**
 * Transaction déjà canonique, telle que la RECHERCHE DE RESSEMBLANCE a besoin de la lire.
 *
 * Ce type ne porte VOLONTAIREMENT aucune clé d'identité. La ressemblance se cherche dans une
 * fenêtre de dates ; l'identité se cherche dans tout l'historique. Mélanger les deux dans un
 * même objet avait une conséquence concrète : une identité stable dont la transaction était
 * hors fenêtre disparaissait de l'index, le moteur annonçait « nouvelle », et l'index unique
 * de la base faisait échouer le commit entier au lieu d'un verdict explicable.
 */
export interface ExistingTransactionFact {
  id: string;
  accountId: string;
  date: string;
  label: string;
  amount: number;
  currency: string;
}

/**
 * Identité déjà écrite : une clé d'identité et la transaction qu'elle désigne.
 *
 * Cet index est GLOBAL — aucun filtre de date, aucun filtre de compte. Une identité stable
 * vaut pour toute l'histoire, sans quoi ce n'est pas une identité.
 */
export interface ExistingIdentity {
  externalKey: string;
  transactionId: string;
}
