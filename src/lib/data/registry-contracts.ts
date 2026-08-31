/**
 * CONTRATS DE TRANSPORT — REGISTRE D'ENTREPRISES
 *
 * Types partagés entre le serveur et le navigateur. Aucun secret n'y figure : la présence
 * d'un identifiant de fournisseur est signalée par un BOOLÉEN et par le NOM de la variable
 * d'environnement attendue, jamais par sa valeur.
 *
 * Ces types sont volontairement séparés de ceux de `src/lib/acquisition/registry` : la
 * couche d'acquisition décrit ce qu'un registre RÉPOND, celle-ci décrit ce que l'écran a
 * besoin de SAVOIR. Les confondre exporterait vers le client des structures dont il n'a que
 * faire, et rendrait tout changement interne visible dans le contrat public.
 */

import type {
  EnrichableField,
  RegistryAuthMode,
  RegistryCapability,
  RegistryDocumentCandidate,
  RegistryErrorCode,
  RegistryEstablishmentCandidate,
  RegistryFieldSkip,
  RegistryFieldState,
  RegistryIssue,
  RegistryOfficerCandidate,
  RegistryProvider,
  RegistrySearchHit,
} from "@/lib/acquisition/registry/types";

/** État d'une connexion telle que l'écran de réglages doit la présenter. */
export interface RegistryConnectionSummary {
  provider: RegistryProvider;
  label: string;
  status: string;
  authMode: RegistryAuthMode;
  /** NOM de la variable attendue. `null` quand le fournisseur n'exige aucun secret. */
  credentialEnvVar: string | null;
  /** Le secret est-il RENSEIGNÉ côté serveur ? Sa valeur ne quitte jamais le serveur. */
  credentialPresent: boolean;
  capabilities: RegistryCapability[];
  /** Champs enrichissables que ce fournisseur NE PEUT PAS alimenter, dit avant tout appel. */
  unservedFields: Array<{ field: EnrichableField; label: string }>;
  baseUrl: string | null;
  snapshotTtlMinutes: number | null;
  rateLimitPerMinute: number | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

/** Réponse de recherche. L'instantané est persisté même quand l'appel échoue. */
export interface RegistrySearchResponse {
  provider: RegistryProvider;
  snapshotId: string;
  observedAt: string;
  hits: RegistrySearchHit[];
  totalResults: number | null;
  page: number | null;
  perPage: number | null;
  issues: RegistryIssue[];
  errorCode: RegistryErrorCode | null;
  errorMessage: string | null;
}

/** Fiche d'entité lue. `reusedSnapshot` dit si l'appel a été évité par un instantané frais. */
export interface RegistryEntityResponse {
  provider: RegistryProvider;
  snapshotId: string;
  observedAt: string;
  staleAfter: string | null;
  stale: boolean;
  reusedSnapshot: boolean;
  profile: RegistryEntityProfileView | null;
  officers: RegistryOfficerCandidate[];
  establishments: RegistryEstablishmentCandidate[];
  documents: RegistryDocumentCandidate[];
  issues: RegistryIssue[];
  errorCode: RegistryErrorCode | null;
  errorMessage: string | null;
}

/**
 * Profil tel qu'AFFICHÉ. Il conserve la distinction entre « non servi par ce fournisseur »
 * et « servi mais absent » : le premier est une propriété de la source, le second une
 * information sur l'entreprise.
 */
export interface RegistryEntityProfileView {
  siren: string;
  legalName: string | null;
  tradeName: string | null;
  acronym: string | null;
  legalFormCode: string | null;
  legalFormLabel: string | null;
  nafCode: string | null;
  nafLabel: string | null;
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
  country: string | null;
  establishmentCount: number | null;
  greffe: string | null;
  rcsNumber: string | null;
  /** Champs que le fournisseur ne publie pas, pour un affichage explicite. */
  unservedCapabilities: RegistryCapability[];
}

/** Proposition persistée, prête à décider. */
export interface RegistryProposalRow {
  decisionId: string;
  field: EnrichableField;
  label: string;
  candidateValue: string;
  canonicalValueBefore: string | null;
  /** État PERSISTÉ. */
  state: "CANDIDATE" | "CONFLICT";
  /** État AFFICHÉ, péremption comprise. */
  displayState: RegistryFieldState;
  stale: boolean;
  snapshotId: string;
  snapshotObservedAt: string;
}

export interface RegistryEnrichmentPreview {
  businessId: string;
  snapshotId: string;
  provider: RegistryProvider;
  observedAt: string;
  staleAfter: string | null;
  stale: boolean;
  proposals: RegistryProposalRow[];
  skipped: RegistryFieldSkip[];
  issues: RegistryIssue[];
}

/** Décision déjà prise, conservée pour la piste d'audit affichée. */
export interface RegistryDecisionHistoryRow {
  decisionId: string;
  field: EnrichableField;
  candidateValue: string | null;
  canonicalValueBefore: string | null;
  state: "ACCEPTED" | "REJECTED";
  decidedAt: string;
  decidedReason: string | null;
  snapshotId: string;
  provider: RegistryProvider;
}

export interface RegistryLinkSummary {
  businessId: string;
  provider: RegistryProvider;
  siren: string;
  siret: string | null;
  matchBasis: "DECLARED" | "PROVIDER_EXACT";
  linkedAt: string;
}

/** Tout ce que l'écran d'une société doit savoir de son identité légale. */
export interface BusinessRegistryState {
  businessId: string;
  businessName: string;
  canonicalSiren: string | null;
  links: RegistryLinkSummary[];
  openProposals: RegistryProposalRow[];
  history: RegistryDecisionHistoryRow[];
  /** Dernier instantané d'entité connu, tous fournisseurs confondus. */
  lastSnapshot: {
    snapshotId: string;
    provider: RegistryProvider;
    observedAt: string;
    staleAfter: string | null;
    stale: boolean;
    errorCode: RegistryErrorCode | null;
  } | null;
}

export interface RegistrySearchRequest {
  provider: RegistryProvider;
  text?: string;
  siren?: string;
  officerName?: string;
  page?: number;
  perPage?: number;
}

export interface RegistryLookupRequest {
  provider: RegistryProvider;
  siren: string;
  /** `true` force un appel neuf même si un instantané frais existe. */
  refresh?: boolean;
}

export interface RegistryLinkRequest {
  businessId: string;
  provider: RegistryProvider;
  siren: string;
  siret?: string | null;
  snapshotId?: string | null;
  notes?: string | null;
}

export interface RegistryProposeRequest {
  businessId: string;
  snapshotId: string;
}

export interface RegistryDecisionRequest {
  businessId: string;
  reason?: string | null;
  decisions: Array<{ decisionId: string; action: "accept" | "reject" }>;
}

export interface RegistryDecisionResult {
  applied: number;
}
