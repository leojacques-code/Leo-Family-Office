import type { DataKind } from "@/lib/types";
import { CODE_TRANSLATIONS, splitCode, translateCode, type CodeTranslation } from "./codes";
import { dominantState, type PresentationState } from "./states";

export { CODE_TRANSLATIONS, splitCode, translateCode };
export type { CodeTranslation };
export * from "./states";

/**
 * Nature d'une donnée, en français.
 *
 * `DataBadge` rendait ces six valeurs en ANGLAIS : « Actual », « User assumption »,
 * « Model assumption », « External », « Derived », « Missing ». Ce sont les codes internes à
 * peine déguisés, dans une interface dont le plan exige qu'elle soit entièrement française.
 *
 * La `definition` n'est pas un ornement : ACTUAL ≠ USER_ASSUMPTION ≠ MODEL_ASSUMPTION est un
 * invariant de la constitution du produit, et un badge de trois mots ne le transmet pas seul.
 */
export interface DataKindLabel {
  readonly label: string;
  readonly definition: string;
}

export const DATA_KIND_LABELS: Readonly<Record<DataKind, DataKindLabel>> = {
  ACTUAL: {
    label: "Constaté",
    definition: "Fait observé : relevé, contrat, document ou saisie déclarée comme réelle.",
  },
  USER_ASSUMPTION: {
    label: "Votre hypothèse",
    definition: "Valeur que vous avez posée. Elle ne devient jamais un fait sans preuve.",
  },
  MODEL_ASSUMPTION: {
    label: "Hypothèse du modèle",
    definition: "Valeur posée par un modèle de projection, distincte de la vôtre et du réel.",
  },
  EXTERNAL_DATA: {
    label: "Source externe",
    definition: "Donnée publiée par un tiers : registre, marché, donnée publique.",
  },
  DERIVED: {
    label: "Calculé",
    definition: "Résultat dérivé d’autres faits. Il n’est jamais persisté comme un fait.",
  },
  MISSING: {
    label: "Non renseigné",
    definition: "Aucune valeur déclarée. Ce n’est pas un zéro.",
  },
};

/**
 * Niveau de preuve d'une grandeur, en français.
 *
 * OBSERVED ≠ CONTRACTUAL ≠ PROJECTED est un invariant de la constitution du produit, et c'est
 * une taxonomie DISTINCTE de `DataKind` : la première dit d'où vient la certitude, la seconde
 * dit qui a produit la valeur. Une même grandeur peut être `ACTUAL` et `OBSERVED`, ou
 * `ACTUAL` et `CONTRACTUAL` : un encours relevé sur un extrait et un encours calculé depuis
 * l'échéancier signé sont tous deux des faits, mais pas de la même façon.
 *
 * La bande de provenance d'Aujourd'hui rendait les deux taxonomies côte à côte, en majuscules
 * et sans soulignés, comme si elles n'en formaient qu'une.
 */
export type EvidenceLevel = "OBSERVED" | "CONTRACTUAL" | "PROJECTED";

export const EVIDENCE_LEVEL_LABELS: Readonly<Record<EvidenceLevel, DataKindLabel>> = {
  OBSERVED: {
    label: "Observé",
    definition: "Constaté sur une pièce : relevé, extrait, document daté.",
  },
  CONTRACTUAL: {
    label: "Contractuel",
    definition: "Découle d’un engagement signé : échéancier, bail, contrat de travail.",
  },
  PROJECTED: {
    label: "Projeté",
    definition: "Produit par une projection. Ce n’est ni un constat ni un engagement.",
  },
};

/**
 * Complétude d'un calcul, en français.
 *
 * `READY`, `PARTIAL` et `NOT_COMPUTABLE` étaient rendus TELS QUELS sur Aujourd'hui et sur
 * Beyonder, les deux pages les plus visibles du produit. Ce sont des unions de moteur
 * (`GlobalFinancialModelCompleteness`, `DecisionCompleteness`), pas des mots français.
 *
 * La traduction porte l'état de présentation avec elle : « partiel » ne dit rien à lui seul,
 * mais `PARTIAL` associé à `RENDER_WITH_RESERVE` dit à la surface de montrer la valeur ET sa
 * limite, au lieu de la masquer ou de l'afficher sans réserve.
 */
export type CompletenessCode = "READY" | "PARTIAL" | "NOT_COMPUTABLE";

export const COMPLETENESS_LABELS: Readonly<
  Record<CompletenessCode, { readonly label: string; readonly state: PresentationState }>
> = {
  READY: { label: "Calcul complet", state: "AVAILABLE" },
  PARTIAL: { label: "Calcul partiel", state: "PARTIAL" },
  NOT_COMPUTABLE: { label: "Calcul impossible en l’état", state: "UNKNOWN_ACTIVATABLE" },
};

/**
 * Traduit une complétude. Un code inattendu ne s'affiche PAS en repli : il devient un
 * incident, parce que le produit ne sait alors pas ce qu'il devrait dire.
 */
export function translateCompleteness(code: string): {
  readonly label: string;
  readonly state: PresentationState;
} {
  return (
    COMPLETENESS_LABELS[code as CompletenessCode] ?? {
      label: "État de calcul inconnu",
      state: "SYSTEM_ERROR" as PresentationState,
    }
  );
}

/** Réserve traduite, prête à être affichée, avec son identifiant technique mis à part. */
export interface TranslatedIssue {
  /** Ce que l'utilisateur lit. */
  readonly label: string;
  readonly state: PresentationState;
  /** Code d'origine, pour le volet technique. Jamais pour la surface principale. */
  readonly code: string;
  /** Identifiant porté par le code, s'il en portait un. Volet technique uniquement. */
  readonly identifier: string | null;
}

export interface TranslatedIssues {
  /** Réserves traduites, dédoublonnées par libellé et dans l'ordre d'entrée. */
  readonly issues: readonly TranslatedIssue[];
  /**
   * Codes que le registre ne connaît pas.
   *
   * L'appelant NE DOIT PAS les afficher : ils vont au volet technique. Le test du registre
   * échoue quand un moteur émet un code non traduit, pour que le cas n'arrive pas en
   * production ; cette liste est le filet, pas le chemin nominal.
   */
  readonly untranslated: readonly string[];
  /** État dominant, celui qui décide de ce que la surface fait de l'ensemble. */
  readonly state: PresentationState;
}

/**
 * Traduit un ensemble de réserves émises par un moteur.
 *
 * Les pages faisaient `blockers.join(" · ")`, ce qui rendait les codes bruts. Cette fonction
 * les remplace : elle rend des phrases françaises, sépare les identifiants techniques, et
 * dit à la surface ce qu'elle doit FAIRE de l'ensemble.
 */
export function translateIssues(codes: readonly string[]): TranslatedIssues {
  const issues: TranslatedIssue[] = [];
  const untranslated: string[] = [];
  const seenLabels = new Set<string>();
  for (const raw of codes) {
    const translation = translateCode(raw);
    if (!translation) {
      untranslated.push(raw);
      continue;
    }
    // Deux codes distincts peuvent porter le même libellé (une quote-part manquante se dit
    // de la même façon en immobilier et en participation). Les répéter à l'écran donnerait
    // l'impression de deux problèmes là où l'utilisateur n'en voit qu'un.
    if (seenLabels.has(translation.label)) continue;
    seenLabels.add(translation.label);
    issues.push({
      label: translation.label,
      state: translation.state,
      code: splitCode(raw).code,
      identifier: translation.identifier,
    });
  }
  return {
    issues,
    untranslated,
    // Un code inconnu est traité comme un INCIDENT et non ignoré : le produit ne sait pas ce
    // qu'il devrait dire, et le taire laisserait croire que tout va bien.
    state: dominantState([
      ...issues.map((issue) => issue.state),
      ...(untranslated.length > 0 ? (["SYSTEM_ERROR"] as const) : []),
    ]),
  };
}
