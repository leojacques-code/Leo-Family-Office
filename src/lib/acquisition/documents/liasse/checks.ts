/**
 * CONTRÔLES D'UNE LIASSE
 *
 * Fonctions pures. Elles ne calculent PAS les contrôles : elles les RÉSOLVENT.
 *
 * La distinction est le cœur du fichier. Un contrôle est défini sur des ANCRES DE LIBELLÉ
 * (« TOTAL GÉNÉRAL ») ; il faut donc d'abord retrouver, dans le document, le CODE de la case
 * que cette ancre désigne. C'est ce que fait ce module : il rend une définition de contrôle
 * portant des codes RÉELLEMENT lus.
 *
 * L'arithmétique est faite ensuite, en base, sur les cases persistées. Ce partage n'est pas un
 * caprice d'architecture : il fait qu'une charge de requête forgée ne peut pas déclarer un
 * bilan équilibré que les cases ne montrent pas. Même doctrine que la partie double du FEC.
 *
 * Règle absolue : une ancre qui ne s'apparie pas rend le contrôle NON CALCULABLE. Jamais
 * réussi. Un contrôle réussi par défaut est pire que pas de contrôle : il donne une assurance
 * qui n'a jamais été vérifiée.
 */

import { foldLabel } from "../text-layer";
import {
  documentIssue,
  type DocumentIssue,
  type ExtractedField,
  type ExtractionCheckDefinition,
} from "../types";
import { CHECK_TEMPLATES, ROW_ANCHORS, type RowAnchor } from "./spec";

/** Une case retenue par une ancre, avec ce qui a permis de la retenir. */
export interface ResolvedAnchor {
  anchorId: string;
  boxCode: string;
  formCode: string | null;
  label: string | null;
  page: number;
}

function anchorById(id: string): RowAnchor | undefined {
  return ROW_ANCHORS.find((anchor) => anchor.id === id);
}

/**
 * Retrouve la case désignée par une ancre.
 *
 * Trois conditions, toutes nécessaires :
 *
 *   1. le libellé de la case apparie l'un des motifs de l'ancre ;
 *   2. la case est sur l'un des formulaires attendus — sans quoi le « TOTAL GÉNÉRAL » de
 *      l'actif et celui du passif seraient interchangeables, et le contrôle d'équilibre
 *      comparerait une valeur à elle-même ;
 *   3. la colonne de la case correspond à celle visée, quand l'ancre en vise une. Une ancre
 *      visant `NET` sur un document dont les en-têtes n'ont pas été trouvés ne s'apparie
 *      PAS : il n'y a pas de « colonne par défaut ».
 *
 * Quand plusieurs cases satisfont les trois conditions, AUCUNE n'est retenue. Deux totaux
 * candidats signifient une lecture ambiguë, et en choisir un rendrait le contrôle arbitraire.
 */
export function resolveAnchor(
  anchor: RowAnchor,
  fields: readonly ExtractedField[],
): { resolved: ResolvedAnchor | null; ambiguous: boolean } {
  const matches = fields.filter((field) => {
    if (field.label === null) return false;
    if (field.validationStatus === "REJECTED") return false;
    if (
      anchor.forms.length > 0 &&
      (field.formCode === null || !anchor.forms.includes(field.formCode))
    ) {
      return false;
    }
    if (anchor.column === "SINGLE") {
      // Une ligne à case unique : accepter une case explicitement rattachée à une autre
      // colonne mélangerait un brut et un net.
      if (field.formPart !== null && field.formPart !== "NET") return false;
    } else if (field.formPart !== anchor.column) {
      return false;
    }
    const folded = foldLabel(field.label);
    return anchor.patterns.some((pattern) => pattern.test(folded));
  });

  if (matches.length === 0) return { resolved: null, ambiguous: false };
  if (matches.length > 1) {
    // Plusieurs cases identiques par le libellé, la colonne ET le formulaire : la seule
    // lecture honnête est de ne rien retenir.
    const distinct = new Set(matches.map((field) => field.boxCode));
    if (distinct.size > 1) return { resolved: null, ambiguous: true };
  }

  const field = matches[0];
  return {
    resolved: {
      anchorId: anchor.id,
      boxCode: field.boxCode,
      formCode: field.formCode,
      label: field.label,
      page: field.pageNumber,
    },
    ambiguous: false,
  };
}

export interface LiasseChecksResult {
  checks: ExtractionCheckDefinition[];
  resolved: ResolvedAnchor[];
  issues: DocumentIssue[];
}

export function buildLiasseChecks(fields: readonly ExtractedField[]): LiasseChecksResult {
  const issues: DocumentIssue[] = [];
  const resolvedByAnchor = new Map<string, ResolvedAnchor>();
  const resolved: ResolvedAnchor[] = [];

  for (const anchor of ROW_ANCHORS) {
    const outcome = resolveAnchor(anchor, fields);
    if (outcome.resolved !== null) {
      resolvedByAnchor.set(anchor.id, outcome.resolved);
      resolved.push(outcome.resolved);
    } else if (outcome.ambiguous) {
      issues.push(
        documentIssue(
          "LABEL_NOT_FOUND",
          "WARNING",
          null,
          null,
          anchor.label,
          `Plusieurs cases répondent à « ${anchor.label} » avec des codes différents : aucune n'est retenue, et les contrôles qui en dépendent resteront non calculables`,
        ),
      );
    }
  }

  const checks: ExtractionCheckDefinition[] = CHECK_TEMPLATES.map((template) => {
    const unresolved: string[] = [];
    const left: string[] = [];
    const right: string[] = [];

    for (const id of template.left) {
      const hit = resolvedByAnchor.get(id);
      if (hit === undefined) unresolved.push(id);
      else left.push(hit.boxCode);
    }
    for (const id of template.right) {
      const hit = resolvedByAnchor.get(id);
      if (hit === undefined) unresolved.push(id);
      else right.push(hit.boxCode);
    }

    if (unresolved.length > 0) {
      issues.push(
        documentIssue(
          "CHECK_OPERAND_NOT_FOUND",
          "WARNING",
          null,
          null,
          unresolved.join(", "),
          `Contrôle « ${template.label} » non calculable : ${unresolved
            .map((id) => anchorById(id)?.label ?? id)
            .join(
              ", ",
            )} introuvable(s) dans le document. Un contrôle sans ses opérandes ne prouve rien, et il n'est donc pas compté comme réussi`,
        ),
      );
    }

    return {
      checkCode: template.checkCode,
      label: template.label,
      severity: template.severity,
      tolerance: template.tolerance,
      left,
      right,
      message: template.message,
      unresolved,
    };
  });

  return { checks, resolved, issues };
}

/**
 * Poste financier retenu pour un fait canonique, avec la case qui le porte.
 *
 * Deux postes seulement, et c'est un choix doctrinal, pas une limite technique :
 *
 *   * le CHIFFRE D'AFFAIRES et le RÉSULTAT DE L'EXERCICE sont imprimés en clair sur le
 *     formulaire. Les lire n'exige aucun jugement ;
 *
 *   * un EBITDA, un EBIT, un capex ou un besoin en fonds de roulement n'y sont PAS imprimés.
 *     Les reconstruire suppose de choisir une convention — quelles charges retraiter, quelles
 *     reprises neutraliser — et ce choix appartient au ledger de Quality of Earnings de
 *     Business Equity, sur décision humaine documentée. Même règle que pour le FEC.
 *
 * Ce ne sont donc pas des postes qu'on a échoué à lire : ce sont des postes qu'une liasse ne
 * contient pas.
 */
export interface LiasseFinancialCandidate {
  revenue: { value: number; boxCode: string; page: number } | null;
  netIncome: { value: number; boxCode: string; page: number } | null;
  issues: DocumentIssue[];
}

export function buildFinancialCandidate(
  fields: readonly ExtractedField[],
): LiasseFinancialCandidate {
  const issues: DocumentIssue[] = [];

  const pick = (anchorId: string) => {
    const anchor = anchorById(anchorId);
    if (anchor === undefined) return null;
    const outcome = resolveAnchor(anchor, fields);
    if (outcome.resolved === null) return null;
    const field = fields.find(
      (candidate) =>
        candidate.boxCode === outcome.resolved?.boxCode &&
        candidate.formCode === outcome.resolved?.formCode,
    );
    // Une valeur corrigée par l'utilisateur n'existe pas à ce stade : la correction se fait
    // après persistance, et le fait canonique est alors reconstruit depuis la base.
    if (field === undefined || field.normalizedValue === null) return null;
    return {
      value: field.normalizedValue,
      boxCode: field.boxCode,
      page: field.pageNumber,
    };
  };

  const revenue = pick("CHIFFRE_AFFAIRES_NET");
  const netIncome = pick("RESULTAT_COMPTE_DE_RESULTAT");

  if (revenue === null) {
    issues.push(
      documentIssue(
        "LABEL_NOT_FOUND",
        "WARNING",
        null,
        null,
        "Chiffre d'affaires net",
        "Chiffre d'affaires non retrouvé dans le document : il restera non renseigné, et non pas nul",
      ),
    );
  }
  if (netIncome === null) {
    issues.push(
      documentIssue(
        "LABEL_NOT_FOUND",
        "WARNING",
        null,
        null,
        "Résultat de l'exercice",
        "Résultat de l'exercice non retrouvé dans le document : il restera non renseigné, et non pas nul",
      ),
    );
  }

  return { revenue, netIncome, issues };
}
