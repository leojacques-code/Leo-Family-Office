/**
 * CONTRATS DE LA VERTICALE DONNÉES PUBLIQUES IMMOBILIÈRES
 *
 * Ce que le client REÇOIT, et rien de plus. Aucun secret, aucune URL portant un jeton,
 * aucun nom de variable d'environnement porteur d'identifiant.
 *
 * Chaque terme absent est un `null` explicite : l'écran affiche « inconnu », jamais un zéro
 * qui se lirait comme une mesure.
 */

import type { MarketEstimate } from "@/lib/engine/real-estate-market";
import type { PublicDataIssue, PublicDataset } from "@/lib/acquisition/realestate/types";

export type { PublicDataIssue, PublicDataset };

export interface PublicDataSourceSummary {
  id: string;
  provider: string;
  dataset: PublicDataset | null;
  label: string;
  adapterVersion: string | null;
  datasetVersion: string | null;
  licence: string | null;
  /** Fraîcheur déclarée, en minutes. `null` = non déclarée, donc aucun cache réutilisable. */
  snapshotTtlMinutes: number | null;
  coverageNote: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** Vrai si l'adaptateur est réellement configuré côté serveur. Aucune URL n'est exposée. */
  configured: boolean;
}

export interface ComparableSaleView {
  id: string;
  rowIndex: number;
  mutationRef: string | null;
  mutatedOn: string;
  price: number;
  currency: string;
  propertyKind: string | null;
  builtAreaSqm: number | null;
  landAreaSqm: number | null;
  roomCount: number | null;
  lotCount: number | null;
  communeCode: string | null;
  postalCode: string | null;
  streetLabel: string | null;
  /**
   * Prix au mètre carré, DÉRIVÉ à la lecture. `null` quand il n'existe pas : surface absente
   * ou mutation multi-lots. Il n'est jamais persisté.
   */
  unitPrice: number | null;
  /** Motif d'exclusion du calcul, quand il y en a un. */
  exclusionReason: string | null;
}

export interface EnergyCertificateView {
  id: string;
  rowIndex: number;
  certificateRef: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  methodVersion: string | null;
  energyLabel: string | null;
  energyValue: number | null;
  energyUnit: string | null;
  ghgLabel: string | null;
  ghgValue: number | null;
  ghgUnit: string | null;
  livingAreaSqm: number | null;
  buildingKind: string | null;
  constructionYear: number | null;
  addressLabel: string | null;
  postalCode: string | null;
  communeCode: string | null;
}

export interface SnapshotSummary {
  id: string;
  dataset: PublicDataset;
  datasetVersion: string | null;
  provider: string;
  retrievedAt: string;
  staleAfter: string;
  /** DÉRIVÉ à la lecture : `staleAfter` comparé à maintenant. Jamais persisté. */
  stale: boolean;
  recordCount: number;
  status: "RETRIEVED" | "EMPTY" | "FAILED" | "NOT_SERVED";
  coverageState: "DECLARED_COVERED" | "DECLARED_NOT_COVERED" | "COVERAGE_UNKNOWN";
  coverageNote: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  query: Record<string, unknown>;
}

export interface MatchSummary {
  id: string;
  propertyId: string;
  target: "COMPARABLE_SET" | "ENERGY_CERTIFICATE";
  snapshotId: string;
  certificateId: string | null;
  matchScore: number | null;
  matchConfidence: "HIGH" | "MEDIUM" | "LOW";
  state: "CANDIDATE" | "CONFLICT" | "ACCEPTED" | "REJECTED";
  decidedAt: string | null;
  decidedReason: string | null;
  supersededBy: string | null;
  basis: Record<string, unknown>;
  createdAt: string;
}

/** Résultat d'une lecture : l'instantané persisté, ce qu'il contient, et ce qu'on en propose. */
export interface PublicDataReadResult {
  snapshot: SnapshotSummary;
  sales: ComparableSaleView[];
  certificates: EnergyCertificateView[];
  /** Propositions de rapprochement créées, à l'état CANDIDAT. */
  matches: MatchSummary[];
  issues: PublicDataIssue[];
}

/** État complet d'un bien vis-à-vis des données publiques. */
export interface PropertyPublicDataView {
  propertyId: string;
  propertyName: string;
  location: string | null;
  surfaceSqm: number | null;
  /** Rapprochements, du plus récent au plus ancien. */
  matches: MatchSummary[];
  /** Instantanés rattachés à ce bien par un rapprochement. */
  snapshots: SnapshotSummary[];
  /** Diagnostic ACCEPTÉ courant, s'il existe. `null` = aucun, jamais « étiquette G ». */
  currentCertificate: EnergyCertificateView | null;
  /**
   * Estimation de marché du jeu de comparables ACCEPTÉ courant. `null` = aucun jeu accepté.
   * Un `status: NOT_COMPUTABLE` est un résultat, pas une absence de résultat.
   */
  estimate: MarketEstimate | null;
  /** Comparables du jeu accepté courant, avec leur prix unitaire dérivé. */
  comparables: ComparableSaleView[];
}

export type PublicDataCommand =
  | {
      action: "fetch";
      propertyId: string;
      dataset: PublicDataset;
      /** Vrai pour n'utiliser que la fixture locale, quand aucun adaptateur n'est configuré. */
      useFixture: boolean;
      communeCode: string | null;
      postalCode: string | null;
      address: string | null;
      mutatedFrom: string | null;
      mutatedTo: string | null;
    }
  | { action: "decide"; matchId: string; decision: "ACCEPT" | "REJECT"; reason: string | null }
  | { action: "promote"; matchId: string; valuedAt: string; notes: string | null };
