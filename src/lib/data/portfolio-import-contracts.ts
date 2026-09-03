/**
 * CONTRATS DE L'IMPORT DE PORTEFEUILLE
 *
 * Ce que le client REÇOIT, et rien de plus. Aucun secret, aucun chemin de stockage, aucune
 * URL signée au-delà de celle qu'il doit utiliser pour déposer son fichier.
 */

import type {
  ImportIssue,
  ImportRowStatus,
  ImportDedupeVerdict,
  SourceConventions,
} from "@/lib/acquisition/types";
import type {
  PortfolioColumnMapping,
  PortfolioEventType,
  PortfolioFileFormat,
  PortfolioImportKind,
  PortfolioRowCounts,
} from "@/lib/acquisition/portfolio/types";

export type {
  ImportIssue,
  ImportRowStatus,
  ImportDedupeVerdict,
  PortfolioColumnMapping,
  PortfolioEventType,
  PortfolioFileFormat,
  PortfolioImportKind,
  PortfolioRowCounts,
  SourceConventions,
};

/** Billet de dépôt. Le chemin est CALCULÉ en base ; le client ne le choisit pas. */
export interface PortfolioUploadTicket {
  ticketId: string;
  /** URL signée, à usage unique et expirante, pour un dépôt à ce chemin et à lui seul. */
  uploadUrl: string;
  bucket: string;
  path: string;
  token: string;
  expiresAt: string;
}

/** Instrument du référentiel, tel qu'il est proposé au rattachement. */
export interface InstrumentCandidateView {
  securityId: string;
  name: string;
  isin: string | null;
  ticker: string | null;
  basis: string;
}

export interface InstrumentResolutionView {
  id: string;
  sourceKey: string;
  sourceIsin: string | null;
  sourceTicker: string | null;
  sourceName: string | null;
  state: "CANDIDATE" | "AMBIGUOUS" | "RESOLVED" | "REJECTED";
  securityId: string | null;
  candidates: InstrumentCandidateView[];
  decidedAt: string | null;
  decidedReason: string | null;
  /** Nombre de lignes de l'import qui citent ce titre. */
  rowCount: number;
}

/** Une ligne du preview. Elle porte sa provenance au niveau de la ligne ET du champ. */
export interface PortfolioPreviewRow {
  recordId: string;
  rowNumber: number;
  /** Ligne brute reconstituée : ce que l'utilisateur relira pour comprendre le découpage. */
  rawLine: string;
  status: ImportRowStatus;
  verdict: ImportDedupeVerdict | null;
  eventType: PortfolioEventType | null;
  factDate: string | null;
  settlementDate: string | null;
  instrumentSourceKey: string | null;
  sourceIsin: string | null;
  sourceTicker: string | null;
  sourceInstrumentName: string | null;
  securityId: string | null;
  securityName: string | null;
  quantity: number | null;
  unitPrice: number | null;
  grossAmount: number | null;
  feeAmount: number | null;
  taxAmount: number | null;
  envelopeCashAmount: number | null;
  marketValue: number | null;
  costBasis: number | null;
  currency: string | null;
  externalReference: string | null;
  label: string | null;
  /** Corrections déjà appliquées, champ par champ : valeur d'origine et valeur retenue. */
  fieldCorrections: Record<string, unknown> | null;
  correctedAt: string | null;
  correctionReason: string | null;
  /** Fait canonique produit, une fois la session validée. */
  portfolioEventId: string | null;
  positionSnapshotId: string | null;
  commitState: "PENDING" | "COMMITTED" | "EXCLUDED";
  issues: ImportIssue[];
}

export interface PortfolioSessionSummary {
  sessionId: string;
  sourceId: string;
  kind: PortfolioImportKind;
  accountId: string;
  accountName: string;
  fileName: string | null;
  fileHash: string | null;
  format: PortfolioFileFormat | null;
  parser: string;
  parserVersion: string;
  status: "RECEIVING" | "ANALYZED" | "COMMITTED" | "DISCARDED" | "FAILED";
  counts: PortfolioRowCounts;
  committedCount: number;
  declaredCurrency: string | null;
  stableReferenceDeclared: boolean;
  analyzedAt: string | null;
  committedAt: string | null;
  issues: ImportIssue[];
}

export interface PortfolioPreview {
  session: PortfolioSessionSummary;
  headers: string[];
  mapping: PortfolioColumnMapping;
  mappingConfidence: "CERTAIN" | "AMBIGUOUS" | "INCOMPLETE";
  conventions: SourceConventions;
  sheetName: string | null;
  otherSheets: string[];
  /** Cellules issues d'une FORMULE : une valeur en cache n'est pas une valeur saisie. */
  formulaCells: string[];
  instruments: InstrumentResolutionView[];
  rows: PortfolioPreviewRow[];
  /** Vrai si l'affichage des lignes est plafonné. Le staging en contient l'intégralité. */
  rowsTruncated: boolean;
  issues: ImportIssue[];
}

export interface PortfolioCommitResult {
  sessionId: string;
  written: number;
  session: PortfolioSessionSummary;
}

export type PortfolioImportCommand =
  | {
      action: "ticket";
      fileName: string;
      byteSize: number;
      contentType: string;
      retainFile: boolean;
    }
  | {
      action: "analyze";
      ticketId: string;
      kind: PortfolioImportKind;
      accountId: string;
      declaredCurrency: string | null;
      /** Mapping confirmé. Absent = mapping inféré des en-têtes. */
      mapping: PortfolioColumnMapping | null;
      sheetName: string | null;
      stableReferenceDeclared: boolean;
      rememberMapping: boolean;
    }
  | {
      action: "resolve-instrument";
      resolutionId: string;
      decision: "RESOLVE" | "REJECT";
      securityId: string | null;
      reason: string | null;
    }
  | {
      action: "correct";
      recordId: string;
      /** Valeurs retenues par l'utilisateur. Chacune est tracée dans la provenance. */
      values: Record<string, string | null>;
      reason: string;
    }
  | { action: "commit"; sessionId: string; recordIds: string[] }
  | { action: "discard"; sessionId: string };
