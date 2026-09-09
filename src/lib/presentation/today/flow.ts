import {
  COMPOSITION_LABELS,
  historicalBlockers,
  historicalMethodology,
  orderedCloses,
} from "@/lib/presentation/historical-closes";
import { translateIssues } from "@/lib/presentation/language";
import type { MonthlyClose } from "@/lib/types";
import type { CloseChangeView, GoalTrajectoryView, MonthFlowView } from "./contracts";

/**
 * Trois faits du canvas d'Aujourd'hui : le flux du mois (§20 item 3), l'évolution depuis la
 * clôture (§20 item 2) et la trajectoire courte (§20 item 4).
 *
 * AUCUN DE CES TROIS N'EST CALCULÉ ICI. Le §2 de la constitution du dépôt : « une couche aval
 * ne recalcule jamais la logique d'une couche amont ». Le flux vient de
 * `computeObservedCashFlow`, la comparabilité des clôtures de `historicalBlockers`, la
 * progression de l'évaluation d'objectif. Ce module les MET EN FORME et décide ce qui est
 * affichable ; il n'additionne aucun montant que le moteur n'a pas déjà additionné.
 */

/**
 * Le flux observé, réduit à ce que le §20 item 3 nomme.
 *
 * Le type du moteur ne traverse pas la frontière : `ObservedCashFlow` porte vingt-cinq champs,
 * dont les transferts internes, les taux d'épargne et la ventilation complète. Les passer à la
 * page l'inviterait à composer sa propre lecture du mois, et Aujourd'hui n'est pas Cash Flow.
 */
export interface ObservedFlowInput {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly transactionCount: number;
  readonly income: number;
  readonly essentialExpenses: number;
  readonly debtServicePaid: number;
  readonly cashFlowAfterDebt: number;
  readonly unclassifiedFlows: number;
  /** La fenêtre est-elle intégralement couverte par le ledger déclaré ? */
  readonly fullyCovered: boolean;
}

/**
 * `null` quand AUCUNE opération n'a été lue sur le mois.
 *
 * Un mois sans opération n'est pas un mois à zéro : c'est un mois dont on ne sait rien, et
 * l'invariant « une absence d'historique n'est pas un mois à zéro » de la constitution le dit
 * explicitement. Rendre un flux à quatre zéros ferait afficher « solde libre : 0 € » à
 * quelqu'un qui n'a simplement pas encore importé son relevé.
 */
export function buildMonthFlow(observed: ObservedFlowInput): MonthFlowView | null {
  if (observed.transactionCount === 0) return null;
  const partial = !observed.fullyCovered;
  return {
    periodStart: observed.periodStart,
    periodEnd: observed.periodEnd,
    partial,
    income: observed.income,
    essentialExpenses: observed.essentialExpenses,
    debtService: observed.debtServicePaid,
    freeCashFlow: observed.cashFlowAfterDebt,
    unclassifiedFlows: observed.unclassifiedFlows,
    reserve: partial
      ? "Le mois n’est pas intégralement couvert par l’historique déclaré : le solde porte sur ce qui est connu."
      : observed.unclassifiedFlows !== 0
        ? "Des opérations du mois ne sont pas classées : elles ne sont comptées dans aucun poste."
        : null,
  };
}

/**
 * Ce que porte une clôture, réduit à ce dont l'évolution a besoin.
 *
 * `composition` est conservée telle quelle : c'est la source des CAUSES du §20 item 2, et ses
 * quatre champs sont ceux que `COMPOSITION_LABELS` sait nommer.
 */
export interface CloseChangeResult {
  readonly view: CloseChangeView | null;
  /** Réserve traduite quand la comparaison n'est pas possible. Jamais un code. */
  readonly reserve: string | null;
}

/**
 * L'évolution entre les deux dernières clôtures comparables, et ses causes.
 *
 * LA RÈGLE DU §20 EST UN REFUS : « aucune variation si les deux clôtures ne sont pas
 * comparables ». Elle n'est pas contournée par une variation « approximative » : deux clôtures
 * de périmètres différents produisent un écart qui n'a aucun sens économique, et l'afficher
 * avec un avertissement finirait par être lu sans l'avertissement.
 *
 * Les CAUSES sont des différences poste à poste de la composition persistée, pas une
 * attribution. Un poste absent d'une des deux clôtures n'est PAS compté comme une variation de
 * son montant : il est simplement absent de la liste, faute de quoi l'apparition d'un poste
 * ressemblerait à un enrichissement.
 */
export function buildCloseChange(
  closes: readonly MonthlyClose[],
  reportingCurrency: string,
): CloseChangeResult {
  const ordered = orderedCloses([...closes]).slice(-2);
  const blockers = historicalBlockers(ordered);
  if (ordered.some((close) => close.reportingCurrency !== reportingCurrency)) {
    blockers.push("HISTORICAL_CURRENCY_MISMATCH");
  }
  if (blockers.length > 0) {
    const translated = translateIssues(blockers);
    return {
      view: null,
      reserve:
        translated.issues[0]?.label ??
        "Deux clôtures comparables sont nécessaires pour mesurer une évolution.",
    };
  }
  const [from, to] = ordered;
  // `historicalBlockers` a déjà refusé un patrimoine net absent ; le test reste pour que le
  // type ne soit pas contourné par un `!`, qui affirmerait ce que le moteur seul garantit.
  if (!from || !to || from.netWorth === null || to.netWorth === null) {
    return {
      view: null,
      reserve: "Deux clôtures comparables sont nécessaires pour mesurer une évolution.",
    };
  }

  const causes: { label: string; amount: number }[] = [];
  const fromComposition = from.composition ?? {};
  const toComposition = to.composition ?? {};
  for (const [key, label] of Object.entries(COMPOSITION_LABELS)) {
    const before = fromComposition[key];
    const after = toComposition[key];
    if (typeof before !== "number" || typeof after !== "number") continue;
    const delta = after - before;
    if (delta === 0) continue;
    causes.push({ label, amount: delta });
  }
  // Les causes les plus MATÉRIELLES d'abord, en valeur absolue : une baisse de 12 000 € pèse
  // autant qu'une hausse de 12 000 € dans l'explication d'un écart.
  causes.sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount));

  return {
    view: {
      fromDate: from.closeDate,
      toDate: to.closeDate,
      amount: to.netWorth - from.netWorth,
      causes,
    },
    // La méthodologie est identique — `historicalBlockers` l'a vérifié — donc aucune réserve
    // ne subsiste. La lire quand même documente d'où vient cette certitude.
    reserve: historicalMethodology(to) === null ? "Méthodologie de clôture inconnue." : null,
  };
}

export interface GoalTrajectoryInput {
  readonly goalId: string;
  readonly name: string;
  readonly targetDate: string | null;
  /** Écart relatif rendu par l'évaluation d'objectif. `null` = non calculable. */
  readonly relativeGap: number | null;
  /** Satisfaction évaluée par le moteur, y compris au-delà de la cible. */
  readonly satisfiedNow: boolean | null;
  /** Codes de réserve de l'évaluation, non traduits. */
  readonly blockers: readonly string[];
}

/** `null` reste non calculable ; une progression réellement égale à zéro reste `0`. */
export function goalProgressOf(relativeGap: number | null): number | null {
  return relativeGap === null ? null : Math.max(0, 1 - Math.abs(relativeGap));
}

export function buildGoalTrajectory(input: GoalTrajectoryInput | null): GoalTrajectoryView | null {
  if (!input) return null;
  const translated = translateIssues(input.blockers);
  return {
    goalId: input.goalId,
    name: input.name,
    targetDate: input.targetDate,
    progress:
      input.blockers.length > 0 || input.satisfiedNow === null
        ? null
        : input.satisfiedNow
          ? 1
          : goalProgressOf(input.relativeGap),
    reserve: translated.issues[0]?.label ?? null,
  };
}
