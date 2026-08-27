/**
 * Contrats de la couche d'acquisition. Aucun import serveur : ce module est importable
 * depuis un composant client (`import type`) sans tirer "server-only" dans le bundle.
 */

import type {
  BankColumnMapping,
  ImportDedupeVerdict,
  ImportIssue,
  ImportRowCounts,
  ImportRowStatus,
  ImportSessionStatus,
  ImportVerdictCounts,
  MappingConfidence,
  SourceConventions,
  SourceEncoding,
} from "@/lib/acquisition/types";

export type {
  BankColumnMapping,
  BankTargetField,
  ImportDedupeVerdict,
  ImportIssue,
  ImportRowCounts,
  ImportRowStatus,
  ImportSessionStatus,
  ImportVerdictCounts,
  MappingConfidence,
  SourceConventions,
} from "@/lib/acquisition/types";

/** Paramètres d'un dépôt de fichier. Le contenu du fichier voyage à part, en FormData. */
export interface ImportAnalyzeRequest {
  /** Enveloppe cible. Une ligne importée appartient toujours à un compte connu. */
  accountId: string;
  /**
   * Devise DÉCLARÉE pour cet import quand la source n'en fournit aucune. `null` = aucune
   * déclaration : les lignes sans devise seront bloquées, jamais complétées d'office.
   */
  declaredCurrency: string | null;
  /**
   * Période que l'utilisateur déclare avoir exportée. Conservée pour l'audit ; elle
   * n'alimente AUCUN calcul et ne touche pas la profondeur d'historique déclarée du ledger.
   */
  declaredPeriodStart: string | null;
  declaredPeriodEnd: string | null;
  /** Mapping confirmé, imposé au parseur. `null` = laisser le parseur proposer. */
  mapping: BankColumnMapping | null;
  /**
   * L'utilisateur DÉCLARE que la colonne d'identifiant de ce format porte un identifiant
   * unique et stable. `false` par défaut, et c'est le bon défaut : aucun nom d'en-tête ne
   * prouve la stabilité, et une référence bancaire répétée chaque mois écarterait des
   * opérations réelles si elle était prise pour une identité.
   */
  stableTransactionIdDeclared: boolean;
  /** Mémoriser ce mapping pour cette signature de format. */
  rememberMapping: boolean;
  /** Conserver le fichier dans le coffre privé. */
  retainFile: boolean;
}

/** Une ligne du preview, telle que l'interface la rend. */
export interface ImportPreviewRow {
  /** Identifiant de la ligne NORMALISÉE : c'est lui que le commit inclut nommément. */
  id: string;
  rowNumber: number;
  transactionDate: string | null;
  label: string | null;
  amount: number | null;
  currency: string | null;
  status: ImportRowStatus;
  verdict: ImportDedupeVerdict | null;
  issues: ImportIssue[];
}

/**
 * Résultat d'un dry-run. Rien de canonique n'a été écrit : `sessionId` désigne une session
 * en attente, que l'utilisateur valide ou abandonne.
 */
export interface ImportPreview {
  sessionId: string;
  sourceId: string;
  accountId: string;
  accountName: string;
  fileName: string;
  fileHash: string;
  encoding: SourceEncoding;
  delimiter: string;
  headers: string[];
  mapping: BankColumnMapping;
  mappingConfidence: MappingConfidence;
  conventions: SourceConventions;
  signature: string;
  counts: ImportRowCounts;
  /** Décompte par verdict de déduplication, distinct du décompte par statut. */
  verdicts: ImportVerdictCounts;
  /** Anomalies de FICHIER, distinctes des anomalies de ligne. */
  issues: ImportIssue[];
  observedPeriod: { start: string; end: string } | null;
  rows: ImportPreviewRow[];
  /**
   * Les lignes prêtes sont plafonnées à l'affichage. `true` signale que toutes ne sont pas
   * dans `rows` : un plafond d'affichage se dit, il ne se devine pas au décompte.
   */
  readyRowsTruncated: boolean;
  /** Un mapping était déjà mémorisé pour cette signature et a été appliqué. */
  mappingRestored: boolean;
}

/** Une session dans l'historique. Décomptes seulement : les lignes se lisent à la demande. */
export interface ImportSessionSummary {
  id: string;
  sourceId: string;
  sourceLabel: string;
  accountId: string | null;
  accountName: string;
  fileName: string | null;
  status: ImportSessionStatus;
  parser: string;
  parserVersion: string;
  encoding: string | null;
  delimiter: string | null;
  declaredCurrency: string | null;
  observationDate: string | null;
  stableTransactionIdDeclared: boolean;
  observedPeriodStart: string | null;
  observedPeriodEnd: string | null;
  declaredPeriodStart: string | null;
  declaredPeriodEnd: string | null;
  counts: ImportRowCounts;
  committedCount: number;
  analyzedAt: string;
  committedAt: string | null;
  discardedAt: string | null;
  error: string | null;
}

export interface ImportCommitResult {
  sessionId: string;
  committedCount: number;
}
