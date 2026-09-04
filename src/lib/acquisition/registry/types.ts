/**
 * ACQUISITION DU REGISTRE D'ENTREPRISES — TYPES CANONIQUES
 *
 * Cette couche ne calcule AUCUNE finance et n'écrit AUCUN fait. Elle interroge un registre
 * légal, transporte ce qu'il a répondu, et refuse de transporter ce qu'elle n'a pas
 * compris.
 *
 * Quatre niveaux, jamais confondus, exactement comme pour un relevé ou un FEC :
 *
 *   CONNEXION    quel fournisseur, avec quel adaptateur, servant quels champs
 *   SNAPSHOT     ce que le fournisseur a réellement répondu, immuable
 *   PROFIL       ce que la lecture en a compris, avec ses anomalies déclarées
 *   DÉCISION     ce que l'utilisateur accepte de faire entrer dans `businesses`
 *
 * Trois distinctions gouvernent tout le module :
 *
 *   CAPACITÉ NON SERVIE ≠ DONNÉE ABSENTE ≠ ZÉRO
 *     Un fournisseur qui ne publie pas le capital social ne dit rien sur le capital. Une
 *     fiche où il est absent alors que le fournisseur le publie dit, elle, qu'il est
 *     inconnu. Aucun des deux ne vaut 0.
 *
 *   ÉCHEC DE FOURNISSEUR ≠ ABSENCE DE DONNÉE
 *     « Le registre n'a pas répondu » est un fait daté. Le perdre ferait croire que
 *     l'entreprise n'existe pas.
 *
 *   RESSEMBLANCE ≠ IDENTITÉ
 *     Une dénomination proche ne rattache pas une société du patrimoine à un SIREN. Seul
 *     un rattachement explicite le fait.
 */

/** Fournisseurs déclarés. `FIXTURE` sert les tests et le mode hors ligne. */
export const REGISTRY_PROVIDERS = ["RECHERCHE_ENTREPRISES", "INPI_RNE", "FIXTURE"] as const;
export type RegistryProvider = (typeof REGISTRY_PROVIDERS)[number];

/** Point d'entrée réellement appelé. Une recherche ouverte n'est pas une fiche d'entité. */
export const REGISTRY_ENDPOINTS = [
  "SEARCH",
  "ENTITY",
  "OFFICERS",
  "ESTABLISHMENTS",
  "DOCUMENTS",
] as const;
export type RegistryEndpoint = (typeof REGISTRY_ENDPOINTS)[number];

export const REGISTRY_AUTH_MODES = ["NONE", "BEARER_TOKEN", "BASIC"] as const;
export type RegistryAuthMode = (typeof REGISTRY_AUTH_MODES)[number];

/**
 * Champs qu'un fournisseur peut SERVIR. La liste est déclarée par l'adaptateur, jamais
 * devinée : c'est elle qui permet d'écrire « ce fournisseur ne publie pas le capital
 * social » au lieu d'afficher un vide indistinguable d'une donnée manquante.
 */
export const REGISTRY_CAPABILITIES = [
  "legal_name",
  "trade_name",
  "acronym",
  // Le CODE et le LIBELLÉ d'une forme juridique sont deux capacités distinctes. Un
  // fournisseur qui publie « 5710 » sans son libellé ne permet pas d'écrire une forme
  // juridique lisible, et traduire le code demanderait une nomenclature que ce dépôt n'a
  // pas : ce serait une convention inventée.
  "legal_form_code",
  "legal_form_label",
  "naf_code",
  "naf_label",
  "share_capital",
  "employee_range",
  "enterprise_category",
  "created_on",
  "ceased_on",
  "registry_status",
  "head_office",
  "address",
  "country",
  "establishments",
  "officers",
  "documents",
  "greffe",
  "rcs_number",
] as const;
export type RegistryCapability = (typeof REGISTRY_CAPABILITIES)[number];

/**
 * Sort d'un appel. Chaque code correspond à une conduite différente : `RATE_LIMITED` se
 * réessaie, `CREDENTIALS_MISSING` ne s'essaie même pas, `EGRESS_BLOCKED` dit que
 * l'environnement d'exécution refuse la sortie réseau — un fait d'infrastructure, pas une
 * réponse du registre.
 *
 * `CANCELLED` et `RESPONSE_TOO_LARGE` viennent du transport commun et sont reprises
 * TELLES QUELLES, sans être repliées sur un code voisin. `CANCELLED` dit que le demandeur a
 * renoncé — l'onglet fermé, la requête entrante abandonnée — et non que le registre a été
 * lent : le classer en `TIMEOUT` lui attribuerait une lenteur qu'il n'a pas eue, et le
 * rendrait réessayable alors qu'il ne reste personne pour lire la réponse.
 * `RESPONSE_TOO_LARGE` dit que NOTRE plafond a tranché, et non que le registre a mal
 * répondu : c'est le seul cas où relever le plafond est la bonne réponse, et le confondre
 * avec `INVALID_RESPONSE` ferait chercher une malformation inexistante.
 */
export const REGISTRY_ERROR_CODES = [
  "NETWORK",
  "TIMEOUT",
  "CANCELLED",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "CREDENTIALS_MISSING",
  "NOT_FOUND",
  "INVALID_RESPONSE",
  "RESPONSE_TOO_LARGE",
  "PROVIDER_ERROR",
  "EGRESS_BLOCKED",
] as const;
export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];

/** Codes retryables. Un 4xx d'autorisation ne devient pas vrai en le redemandant. */
export const RETRYABLE_REGISTRY_ERROR_CODES: readonly RegistryErrorCode[] = [
  "NETWORK",
  "TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
];

export type RegistryIssueSeverity = "ERROR" | "WARNING" | "INFO";

export const REGISTRY_ISSUE_CODES = [
  // Identité
  "SIREN_MISSING",
  "SIREN_MALFORMED",
  "SIREN_CHECKSUM_FAILED",
  "SIRET_MALFORMED",
  "SIRET_SIREN_MISMATCH",
  // Lecture
  "FIELD_UNEXPECTED_TYPE",
  "FIELD_UNREADABLE_DATE",
  "FIELD_UNREADABLE_NUMBER",
  "FIELD_EMPTY_STRING",
  "PAYLOAD_SHAPE_UNEXPECTED",
  "RESULT_SET_EMPTY",
  "RESULT_SET_TRUNCATED",
  // Cohérence
  "CESSATION_BEFORE_CREATION",
  "CAPITAL_WITHOUT_CURRENCY",
  "CAPITAL_NEGATIVE",
  "HEAD_OFFICE_SIREN_MISMATCH",
  "ESTABLISHMENT_COUNT_MISMATCH",
  // Fraîcheur et capacité
  "SNAPSHOT_STALE",
  "PROVIDER_FRESHNESS_UNDECLARED",
  "CAPABILITY_NOT_SERVED",
] as const;
export type RegistryIssueCode = (typeof REGISTRY_ISSUE_CODES)[number];

/**
 * Anomalie structurée. « Réponse invalide » ne dit ni quel champ, ni quelle valeur, ni ce
 * que l'utilisateur peut faire. Chaque anomalie porte donc son code, son champ, la valeur
 * SOURCE telle quelle, et une explication en français.
 */
export interface RegistryIssue {
  code: RegistryIssueCode;
  severity: RegistryIssueSeverity;
  /** Champ concerné, ou `null` quand l'anomalie porte sur la réponse entière. */
  field: string | null;
  /** Valeur telle que le fournisseur l'a écrite. Tronquée, jamais reformatée. */
  sourceValue: string | null;
  message: string;
}

export function registryIssue(
  code: RegistryIssueCode,
  severity: RegistryIssueSeverity,
  field: string | null,
  sourceValue: unknown,
  message: string,
): RegistryIssue {
  return { code, severity, field, sourceValue: describeSourceValue(sourceValue), message };
}

/**
 * Représentation LISIBLE d'une valeur source, pour la relecture humaine. Tronquée à 120
 * caractères : une anomalie ne doit pas recopier une réponse entière dans un message.
 */
export function describeSourceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return null;
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** Identité légale normalisée d'une entité. Tout est nullable sauf le SIREN. */
export interface CompanyRegistryProfileCandidate {
  siren: string;
  legalName: string | null;
  tradeName: string | null;
  acronym: string | null;
  legalFormCode: string | null;
  legalFormLabel: string | null;
  nafCode: string | null;
  nafLabel: string | null;
  nafNomenclature: string | null;
  /** Capital social STATUTAIRE observé. Reste une observation du registre. */
  shareCapital: number | null;
  shareCapitalCurrency: string | null;
  employeeRangeCode: string | null;
  employeeRangeLabel: string | null;
  employeeRangeYear: number | null;
  enterpriseCategory: string | null;
  createdOn: string | null;
  ceasedOn: string | null;
  registryStatus: "ACTIVE" | "CEASED" | "UNKNOWN" | null;
  headOfficeSiret: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  cityCode: string | null;
  country: string | null;
  establishmentCount: number | null;
  greffe: string | null;
  rcsNumber: string | null;
  issues: RegistryIssue[];
}

export interface RegistryOfficerCandidate {
  officerKind: "PERSON" | "COMPANY" | "UNKNOWN";
  lastName: string | null;
  firstNames: string | null;
  /** ANNÉE seule. Le registre ne publie pas davantage, et le produit n'en a pas besoin. */
  birthYear: number | null;
  nationality: string | null;
  roleLabel: string | null;
  roleCode: string | null;
  companySiren: string | null;
  companyName: string | null;
  sinceOn: string | null;
}

export interface RegistryEstablishmentCandidate {
  siret: string;
  isHeadOffice: boolean | null;
  establishmentStatus: "ACTIVE" | "CLOSED" | "UNKNOWN" | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  cityCode: string | null;
  country: string | null;
  nafCode: string | null;
  nafLabel: string | null;
  employeeRangeCode: string | null;
  createdOn: string | null;
  closedOn: string | null;
}

export interface RegistryDocumentCandidate {
  documentKind: "ACTE" | "ANNUAL_ACCOUNTS" | "BYLAWS" | "OTHER";
  providerDocumentId: string | null;
  fiscalYearEnd: string | null;
  filingDate: string | null;
  confidentiality: "PUBLIC" | "CONFIDENTIAL" | "UNKNOWN" | null;
  downloadAvailable: boolean | null;
}

/** Un résultat de recherche : juste assez pour choisir, jamais présenté comme une fiche. */
export interface RegistrySearchHit {
  siren: string;
  legalName: string | null;
  tradeName: string | null;
  legalFormLabel: string | null;
  nafCode: string | null;
  city: string | null;
  postalCode: string | null;
  registryStatus: "ACTIVE" | "CEASED" | "UNKNOWN" | null;
  createdOn: string | null;
  /** Dirigeants tels que renvoyés PAR LA RECHERCHE, quand le fournisseur en publie. */
  officerNames: string[];
}

/**
 * Ce que le fournisseur a répondu, avant toute lecture. `payload` est conservé tel quel :
 * c'est le brut immuable de cette verticale.
 */
export interface RegistryRawResponse {
  endpoint: RegistryEndpoint;
  query: Record<string, unknown>;
  httpStatus: number | null;
  payload: unknown;
  payloadBytes: number | null;
  observedAt: string;
  providerUpdatedAt: string | null;
  errorCode: RegistryErrorCode | null;
  errorMessage: string | null;
}

/** Lecture complète d'une réponse d'entité. */
export interface RegistryEntityReading {
  profile: CompanyRegistryProfileCandidate | null;
  officers: RegistryOfficerCandidate[];
  establishments: RegistryEstablishmentCandidate[];
  documents: RegistryDocumentCandidate[];
  issues: RegistryIssue[];
}

/** Lecture d'une réponse de recherche. */
export interface RegistrySearchReading {
  hits: RegistrySearchHit[];
  totalResults: number | null;
  page: number | null;
  perPage: number | null;
  issues: RegistryIssue[];
}

export interface RegistrySearchQuery {
  /** Texte libre : raison sociale, ou nom de dirigeant quand le fournisseur le permet. */
  text?: string;
  siren?: string;
  siret?: string;
  officerName?: string;
  page?: number;
  perPage?: number;
}

/**
 * CONTRAT DE FOURNISSEUR. Un adaptateur déclare ce qu'il est, ce qu'il sert, et comment il
 * s'authentifie. Il ne décide jamais d'écrire quoi que ce soit.
 *
 * `schemaVersion` versionne le CONTRAT DE LECTURE : quand l'interprétation d'un champ
 * change, les instantanés déjà écrits restent lisibles avec l'ancienne version.
 */
/**
 * Options d'UN appel, par opposition à la configuration de la connexion.
 *
 * Le signal vient du DEMANDEUR : sur une route Next, c'est `request.signal`. Quand le
 * navigateur abandonne, la lecture distante s'arrête au lieu de continuer à consommer un
 * quota de registre pour une réponse que plus personne ne lira. Il est facultatif — un
 * appelant hors requête HTTP, comme un smoke, n'a rien à propager — et il ne remplace pas
 * le délai interne du transport, il s'y compose.
 */
export interface RegistryCallOptions {
  signal?: AbortSignal;
}

export interface RegistryProviderAdapter {
  readonly provider: RegistryProvider;
  readonly label: string;
  readonly schemaVersion: string;
  readonly adapterVersion: string;
  readonly authMode: RegistryAuthMode;
  /** NOM de la variable d'environnement portant le secret. Jamais sa valeur. */
  readonly credentialEnvVar: string | null;
  readonly capabilities: readonly RegistryCapability[];
  /** Base d'URL documentée du fournisseur, pour la traçabilité de la connexion. */
  readonly baseUrl: string | null;
  /**
   * Fraîcheur DÉCLARÉE d'un instantané de ce fournisseur, en minutes. `null` = aucune
   * fraîcheur déclarée, ce qui n'est pas « toujours frais ».
   */
  readonly snapshotTtlMinutes: number | null;
  readonly rateLimitPerMinute: number | null;

  search(query: RegistrySearchQuery, options?: RegistryCallOptions): Promise<RegistryRawResponse>;
  entity(siren: string, options?: RegistryCallOptions): Promise<RegistryRawResponse>;
  readSearch(response: RegistryRawResponse): RegistrySearchReading;
  readEntity(response: RegistryRawResponse): RegistryEntityReading;
}

/** Champs de `businesses` qu'un enrichissement peut écrire. Liste blanche, doublée en SQL. */
export const ENRICHABLE_FIELDS = [
  "name",
  "legal_form",
  "sector",
  "naf_code",
  "country",
  "founded_on",
] as const;
export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

/**
 * États d'un champ importable.
 *
 * Quatre sont PERSISTÉS. `STALE` est DÉRIVÉ de la péremption de l'instantané : un état qui
 * dépend de l'heure qu'il est pourrit en silence dès qu'il est figé en base. La péremption
 * se calcule à la lecture, elle ne se mémorise pas.
 */
export const REGISTRY_FIELD_STATES = [
  "CANDIDATE",
  "CONFLICT",
  "ACCEPTED",
  "REJECTED",
  "STALE",
] as const;
export type RegistryFieldState = (typeof REGISTRY_FIELD_STATES)[number];

export const PERSISTED_FIELD_STATES = ["CANDIDATE", "CONFLICT", "ACCEPTED", "REJECTED"] as const;
export type PersistedFieldState = (typeof PERSISTED_FIELD_STATES)[number];

/**
 * Raison pour laquelle un champ n'a produit AUCUNE proposition. Une absence de proposition
 * n'est pas un silence : elle s'explique.
 */
export const REGISTRY_SKIP_REASONS = [
  "CAPABILITY_NOT_SERVED",
  "CANDIDATE_MISSING",
  "ALREADY_ALIGNED",
] as const;
export type RegistrySkipReason = (typeof REGISTRY_SKIP_REASONS)[number];

/** Proposition champ par champ, prête à être présentée puis décidée. */
export interface RegistryFieldProposal {
  field: EnrichableField;
  /** Libellé humain du champ, pour l'écran de comparaison. */
  label: string;
  candidateValue: string;
  canonicalValueBefore: string | null;
  state: Extract<PersistedFieldState, "CANDIDATE" | "CONFLICT">;
  /** État AFFICHÉ, péremption comprise. */
  displayState: RegistryFieldState;
  stale: boolean;
}

/** Champ écarté, avec sa raison. */
export interface RegistryFieldSkip {
  field: EnrichableField;
  label: string;
  reason: RegistrySkipReason;
  canonicalValueBefore: string | null;
}

export interface RegistryEnrichmentDiff {
  proposals: RegistryFieldProposal[];
  skipped: RegistryFieldSkip[];
  /** Instantané périmé au moment de la comparaison. Signalé, jamais corrigé. */
  stale: boolean;
  issues: RegistryIssue[];
}

/** Valeurs canoniques actuelles d'une société, telles que le domaine Business les porte. */
export interface BusinessCanonicalIdentity {
  name: string | null;
  legalForm: string | null;
  sector: string | null;
  nafCode: string | null;
  country: string | null;
  foundedOn: string | null;
  siren: string | null;
}
