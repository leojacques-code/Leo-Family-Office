/**
 * Contrats de l'acquisition comptable. Aucun import serveur : ce module est importable
 * depuis un composant client (`import type`) sans tirer "server-only" dans le bundle.
 */

import type { ImportIssue, ImportRowStatus, SourceEncoding } from "@/lib/acquisition/types";
import type {
  BusinessFinancialImportCandidate,
  FecCounts,
  FecCoverage,
  FecStatementCandidate,
} from "@/lib/acquisition/fec";

export type {
  BusinessFinancialImportCandidate,
  FecAmount,
  FecBalanceSheet,
  FecCounts,
  FecCoverage,
  FecGroupBalance,
  FecIncomeStatement,
  FecStatementCandidate,
  FecStatementStatus,
} from "@/lib/acquisition/fec";

/** Paramètres d'un dépôt de FEC. Le contenu du fichier voyage à part, en FormData. */
export interface FecAnalyzeRequest {
  /** Société visée. Une écriture comptable appartient toujours à une société connue. */
  businessId: string;
  /**
   * Devise de TENUE de la comptabilité, DÉCLARÉE. Le FEC n'en porte pas : seuls des
   * montants en devise étrangère y figurent, ligne à ligne. Aucune conversion n'est faite
   * ici — le FX Engine reste l'unique convertisseur.
   */
  currency: string;
  /** Exercice DÉCLARÉ. Sert à signaler les écritures hors période, jamais à les corriger. */
  fiscalYearStart: string | null;
  fiscalYearEnd: string | null;
  /**
   * L'utilisateur DÉCLARE-T-IL que ce fichier couvre l'exercice entier ? `false` par
   * défaut, et c'est le bon défaut : des dates minimale et maximale ne prouvent pas
   * l'exhaustivité, et sans cette déclaration aucun état n'est intégrable au domaine
   * Business.
   */
  coverageDeclared: boolean;
  /** Conserver le fichier dans le coffre privé. */
  retainFile: boolean;
}

/** Une écriture du preview, telle que l'interface la rend. */
export interface FecPreviewLine {
  id: string;
  rowNumber: number;
  journalCode: string;
  entryNumber: string;
  entryDate: string | null;
  accountNumber: string;
  accountLabel: string | null;
  entryLabel: string | null;
  debit: number | null;
  credit: number | null;
  pcgGroup: string;
  status: ImportRowStatus;
  issues: ImportIssue[];
}

/**
 * Résultat d'un dry-run comptable. Les écritures sont PERSISTÉES en staging, mais aucun
 * fait Business n'est écrit : `sessionId` désigne une session en attente, que l'utilisateur
 * valide ou abandonne.
 */
export interface FecPreview {
  sessionId: string;
  sourceId: string;
  businessId: string;
  businessName: string;
  fileName: string;
  fileHash: string;
  encoding: SourceEncoding;
  delimiter: string;
  headers: string[];
  /** Colonnes hors format : conservées au brut, jamais lues. */
  unknownHeaders: string[];
  signature: string;
  currency: string;
  coverage: FecCoverage;
  counts: FecCounts;
  /** Anomalies de FICHIER, distinctes des anomalies de ligne. */
  issues: ImportIssue[];
  observedPeriod: { start: string; end: string } | null;
  /** Devises étrangères rencontrées dans les colonnes 17 et 18. */
  currencies: string[];
  /** États reconstruits, chaque montant portant le nom de sa convention. */
  statement: FecStatementCandidate;
  /** Ce qui serait proposé au domaine Business. `null` quand rien n'est intégrable. */
  candidate: BusinessFinancialImportCandidate | null;
  /** Écritures affichées. Plafonnées : un plafond d'affichage se dit, il ne se devine pas. */
  lines: FecPreviewLine[];
  linesTruncated: boolean;
}

export interface FecCommitResult {
  sessionId: string;
  /** Écritures gelées par cette validation. */
  committedCount: number;
  /** Instantané financier écrit au domaine Business. */
  businessFinancialsId: string;
  periodEnd: string;
}
