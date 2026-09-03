/**
 * CONTRATS DE TRANSPORT — DOCUMENT INTELLIGENCE
 *
 * Types partagés entre le serveur et le navigateur. Ils décrivent ce que l'ÉCRAN a besoin de
 * savoir, et non la structure interne de l'extracteur : confondre les deux exporterait au
 * client des détails de mise en page dont il n'a que faire, et rendrait tout changement
 * interne visible dans le contrat public.
 *
 * Aucun contenu de fichier ne circule par ces types. Le PDF va du navigateur au stockage
 * privé, et la route ne reçoit qu'une référence émise par le serveur.
 */

import type {
  CheckSeverity,
  CheckStatus,
  DetectionEvidence,
  DocumentIssue,
  ExtractionFieldStatus,
  ExtractionMethod,
  ExtractionRunStatus,
  ExtractionUnit,
  PdfKind,
} from "@/lib/acquisition/documents/types";

/** Billet de dépôt. Le chemin est CALCULÉ en base : le client ne le choisit pas. */
export interface DocumentUploadTicket {
  ticketId: string;
  bucket: string;
  storagePath: string;
  /** Jeton du client de stockage, jamais une URL assemblée à la main. */
  token: string;
  contentType: string;
  expiresAt: string;
  /** Le fichier peut-il être ARCHIVÉ au coffre privé, compte tenu de sa taille ? */
  retainable: boolean;
}

/** Une case, telle que l'écran de relecture la présente. */
export interface DocumentFieldView {
  fieldId: string;
  pageNumber: number;
  formCode: string | null;
  formPart: string | null;
  boxCode: string;
  occurrence: number;
  label: string | null;
  /** Cadre géométrique, pour montrer OÙ la valeur a été lue. */
  bbox: { x: number; y: number; width: number; height: number } | null;
  rawValue: string | null;
  normalizedValue: number | null;
  /** Correction utilisateur, à CÔTÉ de la lecture et jamais à sa place. */
  userValue: number | null;
  userReason: string | null;
  /** Valeur RETENUE : la correction si elle existe, la lecture sinon. */
  effectiveValue: number | null;
  unit: ExtractionUnit;
  extractionMethod: ExtractionMethod;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  validationStatus: ExtractionFieldStatus;
  issues: DocumentIssue[];
}

/** Résultat d'un contrôle, avec ses opérandes réels. */
export interface DocumentCheckView {
  checkCode: string;
  label: string | null;
  severity: CheckSeverity;
  status: CheckStatus;
  expectedValue: number | null;
  actualValue: number | null;
  difference: number | null;
  tolerance: number;
  /** Codes de case réellement comparés. Sans eux, un verdict n'est pas reproductible. */
  leftCodes: string[];
  rightCodes: string[];
  message: string | null;
}

/**
 * Postes financiers CANDIDATS, reconstruits depuis les cases PERSISTÉES.
 *
 * Deux postes, et deux seulement : ce sont les seuls que le formulaire imprime en clair.
 * `unavailableFields` nomme ceux qu'une liasse ne contient pas, pour que l'écran puisse le
 * dire au lieu de laisser un vide.
 */
export interface DocumentFinancialProposal {
  periodEnd: string | null;
  currency: string | null;
  revenue: { value: number; boxCode: string; page: number } | null;
  netIncome: { value: number; boxCode: string; page: number } | null;
  unavailableFields: Array<{ field: string; reason: string }>;
}

/** État complet d'une lecture, tel que l'écran l'affiche. */
export interface DocumentExtractionPreview {
  runId: string;
  businessId: string;
  businessName: string;
  status: ExtractionRunStatus;
  pdfKind: PdfKind;
  pageCount: number | null;
  detectedKind: string | null;
  detectedVariant: string | null;
  detectionBasis: DetectionEvidence[];
  siren: string | null;
  fiscalYearStart: string | null;
  fiscalYearEnd: string | null;
  fileName: string | null;
  fileHash: string | null;
  extractedAt: string;
  counts: {
    fields: number;
    unknownBoxes: number;
    blocked: number;
    corrected: number;
    failedChecks: number;
    notComputableChecks: number;
  };
  /** Cases AFFICHÉES. Le staging en contient toujours l'intégralité. */
  fields: DocumentFieldView[];
  fieldsTruncated: boolean;
  checks: DocumentCheckView[];
  financials: DocumentFinancialProposal;
  issues: DocumentIssue[];
  /** Le fichier a-t-il été conservé au coffre privé ? */
  documentId: string | null;
  /** L'objet de staging a-t-il résisté à sa suppression ? Un échec est dit, pas masqué. */
  stagingCleanupFailed: boolean;
  /** Lecture précédente du même fichier, remplacée par celle-ci. */
  supersedesRunId: string | null;
}

/** Résumé d'une lecture, pour la liste. */
export interface DocumentExtractionSummary {
  runId: string;
  businessId: string;
  businessName: string;
  status: ExtractionRunStatus;
  detectedKind: string | null;
  detectedVariant: string | null;
  fiscalYearEnd: string | null;
  fileName: string | null;
  extractedAt: string;
  fieldCount: number;
  failedCheckCount: number;
  notComputableCheckCount: number;
}

export interface DocumentTicketRequest {
  fileName: string;
  byteSize: number;
  retainFile: boolean;
}

export interface DocumentAnalyzeRequest {
  ticketId: string;
  businessId: string;
  /** L'utilisateur demande-t-il l'archivage du PDF au coffre privé ? */
  retainFile: boolean;
}

export interface DocumentCorrectionRequest {
  fieldId: string;
  action: "correct" | "reject" | "review";
  userValue?: number | null;
  reason?: string | null;
}

export interface DocumentLinkRequest {
  runId: string;
  /** Devise DÉCLARÉE de l'instantané. Une liasse française n'imprime pas son code devise. */
  currency: string;
}

export interface DocumentLinkResult {
  runId: string;
  status: ExtractionRunStatus;
}
