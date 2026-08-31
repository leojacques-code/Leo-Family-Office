/**
 * LIASSE FISCALE — ORCHESTRATION DE LA LECTURE
 *
 * Une seule fonction publique, `readLiasse`, qui enchaîne détection, extraction et résolution
 * des contrôles sur une couche texte. Pure : elle n'ouvre aucun fichier et n'écrit rien.
 *
 * Elle ne LÈVE jamais. Un document illisible, un scan, un formulaire inconnu sont des
 * RÉSULTATS, avec leur statut et leurs anomalies. Le seul cas où une lecture doit remonter une
 * exception serait un bug de ce module, et un bug n'est pas un état de document.
 */

import type { PdfTextLayer } from "../text-layer";
import { documentIssue, type DocumentExtraction, type DocumentIssue, type PdfKind } from "../types";
import { buildLiasseChecks, buildFinancialCandidate, type ResolvedAnchor } from "./checks";
import { detectLiasse } from "./detect";
import { extractLiasseFields } from "./extract";

export * from "./spec";
export * from "./detect";
export * from "./extract";
export * from "./checks";

export const LIASSE_EXTRACTOR = "liasse-fiscale";
export const LIASSE_EXTRACTOR_VERSION = "1";
/**
 * Version du CONTRAT DE LECTURE. Elle change dès qu'une ancre, une tolérance ou une règle
 * d'appariement change : les lectures déjà persistées restent alors interprétables avec la
 * version qui les a produites.
 */
export const LIASSE_SCHEMA_VERSION = "liasse/2026-08-31";

export interface LiasseReading extends DocumentExtraction {
  /** Ancres réellement retrouvées, avec le code de case qu'elles désignent. */
  resolvedAnchors: ResolvedAnchor[];
  /** Postes financiers candidats, sans jugement normatif. */
  financials: ReturnType<typeof buildFinancialCandidate>;
}

export interface ReadLiasseInput {
  layer: PdfTextLayer;
  pdfKind: PdfKind;
  pageCount: number;
  /** Anomalies déjà constatées par l'adaptateur PDF. */
  issues: readonly DocumentIssue[];
}

export function readLiasse(input: ReadLiasseInput): LiasseReading {
  const base = {
    family: "TAX_RETURN" as const,
    extractor: LIASSE_EXTRACTOR,
    extractorVersion: LIASSE_EXTRACTOR_VERSION,
    schemaVersion: LIASSE_SCHEMA_VERSION,
    pdfKind: input.pdfKind,
    pageCount: input.pageCount,
    textCharCount: input.layer.charCount,
  };

  // Un PDF sans couche texte n'est pas lu, et rien n'en est déduit. `OCR_REQUIRED` est un
  // fait technique nommé : il dit ce qu'il faudrait pour aller plus loin, sans prétendre
  // avoir lu quoi que ce soit.
  if (input.pdfKind === "IMAGE_ONLY") {
    return {
      ...base,
      detectedKind: null,
      detectedVariant: null,
      detectionBasis: [],
      siren: null,
      fiscalYearStart: null,
      fiscalYearEnd: null,
      status: "OCR_REQUIRED",
      fields: [],
      checks: [],
      resolvedAnchors: [],
      financials: { revenue: null, netIncome: null, issues: [] },
      issues: [...input.issues],
    };
  }

  if (input.pdfKind === "UNREADABLE") {
    return {
      ...base,
      detectedKind: null,
      detectedVariant: null,
      detectionBasis: [],
      siren: null,
      fiscalYearStart: null,
      fiscalYearEnd: null,
      status: "FAILED",
      fields: [],
      checks: [],
      resolvedAnchors: [],
      financials: { revenue: null, netIncome: null, issues: [] },
      issues: [...input.issues],
    };
  }

  const detection = detectLiasse(input.layer);
  const extraction = extractLiasseFields({
    layer: input.layer,
    formByPage: detection.formByPage,
    regime: detection.regime,
  });
  const checks = buildLiasseChecks(extraction.fields);
  const financials = buildFinancialCandidate(extraction.fields);

  const issues: DocumentIssue[] = [
    ...input.issues,
    ...detection.issues,
    ...extraction.issues,
    ...checks.issues,
    ...financials.issues,
  ];

  if (extraction.fields.length === 0) {
    issues.push(
      documentIssue(
        "FORM_NOT_RECOGNISED",
        "ERROR",
        null,
        null,
        null,
        "Aucune case n'a été lue : le document porte du texte, mais aucune colonne de codes de liasse n'y a été trouvée. Vérifiez qu'il s'agit bien d'une liasse fiscale et non d'une plaquette",
      ),
    );
  }

  return {
    ...base,
    detectedKind: detection.regime,
    detectedVariant: detection.variant,
    detectionBasis: detection.evidence,
    siren: detection.siren,
    fiscalYearStart: detection.fiscalYearStart,
    fiscalYearEnd: detection.fiscalYearEnd,
    status: "EXTRACTED",
    fields: extraction.fields,
    checks: checks.checks,
    resolvedAnchors: checks.resolved,
    financials,
    issues,
  };
}
