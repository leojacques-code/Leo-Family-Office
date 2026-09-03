/**
 * DOCUMENT INTELLIGENCE — TYPES CANONIQUES
 *
 * Cette couche ne calcule AUCUNE finance. Elle lit un document et rend ce qu'elle y a
 * trouvé, case par case, avec l'endroit exact où elle l'a trouvé.
 *
 * Quatre niveaux, jamais confondus :
 *
 *   FICHIER        les octets déposés, tels quels
 *   COUCHE TEXTE   ce que le PDF contient RÉELLEMENT comme texte positionné
 *   CASES LUES     ce que l'extracteur a compris, avec ses anomalies et sa géométrie
 *   FAIT CANONIQUE ce que l'utilisateur accepte d'écrire, après contrôles et décision
 *
 * Trois distinctions gouvernent tout le module :
 *
 *   CASE VIDE ≠ CASE À ZÉRO
 *     Une case de liasse laissée blanche ne déclare RIEN. Son code est imprimé, sa valeur
 *     non. La compter zéro fausserait tout total construit dessus.
 *
 *   PDF SANS COUCHE TEXTE ≠ PDF ILLISIBLE ≠ VALEUR SUPPOSÉE
 *     Un PDF scanné est un fait technique nommé : `OCR_REQUIRED`. Aucune valeur n'en est
 *     déduite, et surtout pas devinée.
 *
 *   CONTRÔLE NON CALCULABLE ≠ CONTRÔLE PASSÉ
 *     Un contrôle dont les opérandes n'ont pas été trouvés dans le document ne prouve rien.
 *     Le compter réussi laisserait valider une liasse dont l'équilibre n'a jamais été
 *     vérifié.
 */

/** Familles de documents. La famille est DÉCLARÉE au dépôt, pas devinée. */
export const DOCUMENT_FAMILIES = [
  "TAX_RETURN",
  "ANNUAL_ACCOUNTS",
  "BANK_STATEMENT",
  "CONTRACT",
  "AMORTIZATION_SCHEDULE",
  "WEALTH_DOCUMENT",
  "OTHER",
] as const;
export type DocumentFamily = (typeof DOCUMENT_FAMILIES)[number];

/**
 * Nature du PDF telle qu'OBSERVÉE.
 *
 *   NATIVE_TEXT  toutes les pages portent une couche texte exploitable
 *   MIXED        certaines pages seulement — la lecture est partielle et le dit
 *   IMAGE_ONLY   aucune page ne porte de texte : c'est un scan
 *   UNREADABLE   le fichier n'a pas pu être ouvert comme PDF
 */
export const PDF_KINDS = ["NATIVE_TEXT", "MIXED", "IMAGE_ONLY", "UNREADABLE"] as const;
export type PdfKind = (typeof PDF_KINDS)[number];

/** Cycle de vie d'une lecture. `VALIDATED` et `LINKED` sont deux décisions distinctes. */
export const EXTRACTION_RUN_STATUSES = [
  "EXTRACTED",
  "OCR_REQUIRED",
  "FAILED",
  "REVIEWED",
  "VALIDATED",
  "LINKED",
  "REJECTED",
] as const;
export type ExtractionRunStatus = (typeof EXTRACTION_RUN_STATUSES)[number];

/**
 * État d'une case.
 *
 *   EXTRACTED    lue, non revue
 *   REVIEWED     l'utilisateur l'a regardée et la laisse telle quelle
 *   CORRECTED    l'utilisateur a saisi une autre valeur, à CÔTÉ de la lecture
 *   REJECTED     l'utilisateur écarte cette lecture
 *   BLOCKED      illisible ou ambiguë : jamais utilisable dans un contrôle ni un fait
 *   UNKNOWN_BOX  le code est lu, le registre ne le connaît pas. Conservée, jamais écartée
 */
export const EXTRACTION_FIELD_STATUSES = [
  "EXTRACTED",
  "REVIEWED",
  "CORRECTED",
  "REJECTED",
  "BLOCKED",
  "UNKNOWN_BOX",
] as const;
export type ExtractionFieldStatus = (typeof EXTRACTION_FIELD_STATUSES)[number];

export const EXTRACTION_METHODS = [
  "NATIVE_TEXT_LAYOUT",
  "NATIVE_TEXT_LABEL",
  "OCR",
  "USER_INPUT",
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const EXTRACTION_UNITS = ["EUR", "PCT", "COUNT", "DAYS", "TEXT"] as const;
export type ExtractionUnit = (typeof EXTRACTION_UNITS)[number];

export type DocumentIssueSeverity = "ERROR" | "WARNING" | "INFO";

export const DOCUMENT_ISSUE_CODES = [
  // Fichier
  "PDF_UNREADABLE",
  "PDF_ENCRYPTED",
  "PDF_NO_TEXT_LAYER",
  "PDF_PARTIAL_TEXT_LAYER",
  "PDF_EMPTY",
  // Détection
  "FORM_NOT_RECOGNISED",
  "FORM_VARIANT_NOT_RECOGNISED",
  "FISCAL_YEAR_NOT_FOUND",
  "FISCAL_YEAR_AMBIGUOUS_DATE",
  "SIREN_NOT_FOUND",
  "SIREN_CHECKSUM_FAILED",
  "MULTIPLE_SIREN_FOUND",
  // Lecture
  "BOX_WITHOUT_VALUE",
  "BOX_VALUE_UNREADABLE",
  "BOX_VALUE_AMBIGUOUS_CONVENTION",
  "BOX_DUPLICATE_CODE",
  "BOX_UNKNOWN_CODE",
  "COLUMN_HEADERS_NOT_FOUND",
  "LABEL_NOT_FOUND",
  "NUMBER_CONVENTION_UNDECLARED",
  "NUMBER_CONVENTION_CONFLICT",
  // Contrôles
  "CHECK_OPERAND_NOT_FOUND",
  "CHECK_FAILED",
] as const;
export type DocumentIssueCode = (typeof DOCUMENT_ISSUE_CODES)[number];

/**
 * Anomalie structurée. « Extraction échouée page 4 » ne dit ni quelle case, ni quelle valeur,
 * ni ce que l'utilisateur peut faire. Chaque anomalie porte donc son code, sa localisation,
 * la valeur SOURCE telle qu'imprimée, et une explication en français.
 */
export interface DocumentIssue {
  code: DocumentIssueCode;
  severity: DocumentIssueSeverity;
  page: number | null;
  /** Code de case concerné, ou `null` quand l'anomalie porte sur le document. */
  boxCode: string | null;
  /** Texte SOURCE, jamais normalisé : c'est lui que l'utilisateur relira dans son PDF. */
  sourceValue: string | null;
  message: string;
}

export function documentIssue(
  code: DocumentIssueCode,
  severity: DocumentIssueSeverity,
  page: number | null,
  boxCode: string | null,
  sourceValue: unknown,
  message: string,
): DocumentIssue {
  const text =
    sourceValue === null || sourceValue === undefined
      ? null
      : typeof sourceValue === "string"
        ? sourceValue
        : String(sourceValue);
  return {
    code,
    severity,
    page,
    boxCode,
    sourceValue: text === null ? null : text.length > 120 ? `${text.slice(0, 117)}…` : text,
    message,
  };
}

/** Cadre géométrique dans le repère du PDF. C'est lui qui permet de MONTRER la lecture. */
export interface DocumentBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Une case lue, prête à être persistée. */
export interface ExtractedField {
  pageNumber: number;
  /** Formulaire porteur, quand il est reconnu. */
  formCode: string | null;
  /** Colonne porteuse, quand les en-têtes ont été trouvés (« Brut », « Net »…). */
  formPart: string | null;
  /** Code de case tel qu'IMPRIMÉ. Lu, jamais pris dans une table de référence. */
  boxCode: string;
  occurrence: number;
  label: string | null;
  bbox: DocumentBoundingBox | null;
  /** Texte tel qu'imprimé. `null` = case vide sur le formulaire. */
  rawValue: string | null;
  /** Valeur comprise. `null` = non comprise OU case vide. Jamais zéro par défaut. */
  normalizedValue: number | null;
  unit: ExtractionUnit;
  extractionMethod: ExtractionMethod;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceScore: number | null;
  validationStatus: ExtractionFieldStatus;
  issues: DocumentIssue[];
}

export const CHECK_SEVERITIES = ["BLOCKING", "WARNING", "INFO"] as const;
export type CheckSeverity = (typeof CHECK_SEVERITIES)[number];

export const CHECK_STATUSES = ["PASSED", "FAILED", "NOT_COMPUTABLE"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/**
 * DÉFINITION d'un contrôle, telle que l'extracteur l'a RÉSOLUE sur ce document.
 *
 * Les codes de `left` et `right` sont ceux réellement lus dans le document, trouvés par leurs
 * libellés. Aucun code n'est écrit en dur dans le produit : c'est la seule façon honnête de
 * contrôler un formulaire dont la nomenclature officielle n'est pas dans ce dépôt.
 *
 * L'arithmétique n'est PAS faite ici : elle est faite en base, sur les cases persistées, pour
 * qu'une charge forgée ne puisse pas déclarer un équilibre que les cases ne montrent pas.
 */
export interface ExtractionCheckDefinition {
  checkCode: string;
  label: string;
  severity: CheckSeverity;
  tolerance: number;
  left: string[];
  right: string[];
  message: string;
  /** Renseigné quand un opérande n'a pas pu être résolu : le contrôle sera NOT_COMPUTABLE. */
  unresolved: string[];
}

/** Preuve d'une détection : ce qui a été trouvé, et où. */
export interface DetectionEvidence {
  page: number;
  matched: string;
  kind: string;
}

/** Résultat complet d'une lecture, avant toute persistance. */
export interface DocumentExtraction {
  family: DocumentFamily;
  extractor: string;
  extractorVersion: string;
  schemaVersion: string;
  pdfKind: PdfKind;
  pageCount: number;
  textCharCount: number;
  detectedKind: string | null;
  detectedVariant: string | null;
  detectionBasis: DetectionEvidence[];
  siren: string | null;
  fiscalYearStart: string | null;
  fiscalYearEnd: string | null;
  status: Extract<ExtractionRunStatus, "EXTRACTED" | "OCR_REQUIRED" | "FAILED">;
  fields: ExtractedField[];
  checks: ExtractionCheckDefinition[];
  issues: DocumentIssue[];
}
