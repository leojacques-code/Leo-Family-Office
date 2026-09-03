/**
 * CONTRATS DE LA COUCHE OPEN BANKING (AIS), LECTURE SEULE
 *
 * Ce que l'écran reçoit, et rien de plus. Aucun jeton, aucun secret client, aucune clé de
 * signature n'apparaît dans ces types : le navigateur ne voit qu'une RÉFÉRENCE de secret,
 * quand il en voit une.
 */
import type {
  BankConsentScope,
  BankConsentStatus,
  BankObservationState,
  BankReconciliationDecision,
} from "@/lib/acquisition/banking";
import type { ImportDedupeVerdict, ImportIssue, ImportRowStatus } from "@/lib/acquisition/types";

export interface BankProviderSummary {
  id: string;
  adapterId: string;
  adapterVersion: string;
  label: string;
  authMode: string;
  status: string;
  /** Capacités DÉCLARÉES par l'adaptateur, telles quelles. */
  capabilities: Record<string, unknown>;
  /** Coffre déclaré, sans la clé ni la valeur : l'écran n'a besoin de rien de plus. */
  secretVault: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface BankConsentSummary {
  id: string;
  providerId: string;
  consentReference: string;
  scopes: BankConsentScope[];
  status: BankConsentStatus;
  grantedAt: string | null;
  /** `false` = le fournisseur n'a PAS déclaré d'expiration. Ce n'est pas « sans expiration ». */
  expiryDeclared: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  lastError: string | null;
}

export interface BankProviderAccountSummary {
  id: string;
  consentId: string;
  providerAccountId: string;
  name: string | null;
  maskedIdentifier: string | null;
  accountType: string | null;
  currency: string | null;
  /** `null` = NON RATTACHÉ : les opérations restent observées et non committables. */
  accountId: string | null;
  mappedAt: string | null;
  mappingReason: string | null;
  lastSeenAt: string;
  cursor: string | null;
  /** La dernière pagination est-elle allée jusqu'à la fin DÉCLARÉE par le fournisseur ? */
  complete: boolean;
}

export interface BankBalanceObservationSummary {
  id: string;
  providerAccountId: string;
  balanceType: string;
  /** `null` = solde NON SERVI par le fournisseur. Jamais zéro. */
  amount: number | null;
  currency: string | null;
  observedAt: string;
  retrievedAt: string;
  issues: ImportIssue[];
}

export interface BankSyncRunSummary {
  id: string;
  consentId: string;
  providerAccountId: string;
  sessionId: string | null;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  pagesRead: number;
  itemsRead: number;
  resumeCursor: string | null;
  complete: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  issues: ImportIssue[];
  /** Statut de la session d'acquisition, quand elle existe. */
  sessionStatus: string | null;
  committedCount: number;
}

export interface BankObservationSummary {
  id: string;
  providerAccountId: string;
  state: BankObservationState;
  providerTransactionId: string | null;
  operationDate: string | null;
  valueDate: string | null;
  bookingDate: string | null;
  amount: number | null;
  currency: string | null;
  label: string | null;
  counterparty: string | null;
  reference: string | null;
  originalAmount: number | null;
  originalCurrency: string | null;
  /** Identité DÉMONTRÉE, quand l'adaptateur déclare ses identifiants stables. */
  externalKey: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** L'observation a-t-elle produit un fait canonique ? */
  written: boolean;
  decision: BankReconciliationDecision | null;
  decisionReason: string | null;
  linkedTransactionId: string | null;
  issues: ImportIssue[];
}

/** Ligne de staging d'une session de synchronisation, telle que l'écran la présente. */
export interface BankSyncPreviewRow {
  id: string;
  rowNumber: number;
  transactionDate: string | null;
  label: string | null;
  amount: number | null;
  currency: string | null;
  counterparty: string | null;
  reference: string | null;
  status: ImportRowStatus;
  dedupeVerdict: ImportDedupeVerdict | null;
  matchedTransactionId: string | null;
  commitState: string;
  issues: ImportIssue[];
  /** Observation durable correspondante, quand elle est identifiable. */
  observationId: string | null;
}

export interface BankSyncPreview {
  runId: string;
  sessionId: string;
  providerAccountId: string;
  status: string;
  complete: boolean;
  pagesRead: number;
  rowCount: number;
  readyCount: number;
  warningCount: number;
  blockedCount: number;
  duplicateCount: number;
  ignoredCount: number;
  observedPeriodStart: string | null;
  observedPeriodEnd: string | null;
  resumeCursor: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  issues: ImportIssue[];
  rows: BankSyncPreviewRow[];
  /** Nombre de lignes réellement persistées, quand l'affichage est plafonné. */
  totalRows: number;
}

export interface BankSyncCommitResult {
  sessionId: string;
  committed: number;
}

export interface OpenBankingOverview {
  providers: BankProviderSummary[];
  consents: BankConsentSummary[];
  accounts: BankProviderAccountSummary[];
  runs: BankSyncRunSummary[];
  balances: BankBalanceObservationSummary[];
  observations: BankObservationSummary[];
  /** Comptes canoniques rattachables, pour la décision de rattachement. */
  candidateAccounts: { id: string; name: string; currency: string; accountType: string }[];
}
