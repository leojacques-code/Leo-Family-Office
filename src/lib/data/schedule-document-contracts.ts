/**
 * Contrats de la revue d'un échéancier de dette (B19).
 *
 * Ces objets décrivent ce que l'écran de revue affiche : une LECTURE et ses cases, jamais un
 * échéancier canonique. Aucune ligne de `loan_schedules` n'en provient tant que la lecture n'a
 * pas été rattachée au prêt (B20).
 */
import type {
  DocumentIssue,
  ExtractionFieldStatus,
  ExtractionRunStatus,
} from "@/lib/acquisition/documents/types";

export type ScheduleFieldUnit = "MONEY" | "DATE" | "TEXT";

export interface ScheduleRunSummary {
  runId: string;
  liabilityId: string;
  status: ExtractionRunStatus;
  fileName: string | null;
  sourceFormat: "CSV" | "XLSX";
  sheetName: string | null;
  extractedAt: string;
  extractorVersion: string;
  schemaVersion: string;
  lineCount: number | null;
  firstDueDate: string | null;
  lastDueDate: string | null;
  completeness: "COMPLETE" | "PARTIAL" | null;
  completenessReasons: string[];
  currency: string | null;
  currencySource: "COLUMN" | "HEADER" | "CELL" | "DECLARED" | null;
  failedCheckCount: number;
  notComputableCheckCount: number;
  blockedFieldCount: number;
  correctedFieldCount: number;
  supersedesRunId: string | null;
  documentId: string | null;
  issues: DocumentIssue[];
}

/** Une case lue, telle que la revue la présente : imprimée, retenue, et d'où elle vient. */
export interface ScheduleFieldView {
  fieldId: string;
  boxCode: string;
  /** Ligne d'échéancier (1 = première ligne de données). */
  lineNumber: number;
  /** Ligne telle que l'utilisateur la voit dans son fichier. */
  rowNumber: number;
  sheetName: string | null;
  columnKey: string;
  columnLabel: string | null;
  cellRef: string | null;
  rawValue: string | null;
  normalizedValue: number | null;
  normalizedDate: string | null;
  userValue: number | null;
  userDate: string | null;
  /** Valeur RETENUE : la correction si elle existe, la lecture sinon. Jamais zéro par défaut. */
  effectiveValue: number | null;
  effectiveDate: string | null;
  unit: ScheduleFieldUnit;
  validationStatus: ExtractionFieldStatus;
  decisionRevision: number;
  userReason: string | null;
  issues: DocumentIssue[];
}

export interface ScheduleCheckView {
  checkCode: string;
  label: string | null;
  severity: "BLOCKING" | "WARNING" | "INFO";
  status: "PASSED" | "FAILED" | "NOT_COMPUTABLE";
  expectedValue: number | null;
  actualValue: number | null;
  difference: number | null;
  left: string[];
  right: string[];
  message: string | null;
}

export type ScheduleDecisionView = import("./document-contracts").DocumentFieldDecisionView;

export interface ScheduleReview {
  run: ScheduleRunSummary;
  fields: ScheduleFieldView[];
  checks: ScheduleCheckView[];
  decisions: ScheduleDecisionView[];
}

export interface ScheduleUploadInput {
  liabilityId: string;
  /** Devise DÉCLARÉE au dépôt ; `null` = aucune, la lecture en cherche une dans le fichier. */
  declaredCurrency: string | null;
  file: { name: string; contentType: string; size: number; bytes: Uint8Array };
}

export interface ScheduleDecisionInput {
  fieldId: string;
  action: "correct" | "reject" | "review";
  expectedRevision: number;
  /** Montant corrigé, en TEXTE décimal : la précision `numeric` n'est pas confiée à un flottant. */
  userValue?: string | null;
  userDate?: string | null;
  reason?: string | null;
}

/** Refus avant toute lecture persistée : format non annoncé, fichier trop lourd. */
export interface ScheduleUploadRefusal {
  refused: true;
  issues: DocumentIssue[];
}
