import type { PresentationState } from "@/lib/presentation/language/states";
import { translateIssues } from "@/lib/presentation/language";
import type { AnswerView, GoalTrajectoryView, MonthFlowView } from "./contracts";

/**
 * Les six réponses du cockpit (§3 du plan, exigence de contenu du §11).
 *
 * « Le produit doit répondre rapidement à six questions », et le §11 fait du « cockpit
 * répondant aux six questions produit » le premier point de contenu de cette phase. Les
 * questions sont TRANSCRITES mot pour mot : les reformuler ferait dériver l'ancrage sémantique
 * de la page, et le §38 règle 1 dit que cette version du plan est la trame de référence.
 *
 * CHAQUE RÉPONSE EST RATTACHÉE À UN KPI DU REGISTRE. Le §39 fait refuser par le CI « une page
 * qui référence un KPI hors registre », et les six KPI essentiels du manifeste `today` de la
 * phase 0 couvrent exactement ces questions. La cinquième — « où vais-je si je ne change
 * rien ? » — n'a pas de KPI de montant : le §20 item 4 lui donne une « trajectoire courte vers
 * les objectifs actifs », et c'est un objectif qui la porte.
 */

/** Les six questions du §3, mot pour mot. */
export const PRODUCT_QUESTIONS = [
  "Combien est-ce que je possède réellement ?",
  "Combien est disponible maintenant ?",
  "Est-ce que ma situation s’améliore ou se dégrade ?",
  "Suis-je en sécurité par rapport à mes engagements et objectifs ?",
  "Où vais-je si je ne change rien ?",
  "Quelle décision mérite mon attention aujourd’hui ?",
] as const;

/**
 * Un agrégat déjà lu du bilan canonique, réduit à ce dont la présentation a besoin.
 *
 * Le type du moteur (`CanonicalAggregate`) ne traverse PAS la frontière : il porte
 * `knownValue`, `coverage` et `status`, dont la page n'a que faire et qui l'inviteraient à
 * recomposer un total. Seules la valeur et les réserves passent.
 */
export interface AggregateInput {
  readonly value: number | null;
  readonly blockers: readonly string[];
}

/**
 * État d'une réponse déduit de sa valeur et de ses réserves.
 *
 * L'ORDRE DE PRÉCÉDENCE COMPTE. Une valeur absente AVEC réserve prend l'état de la réserve,
 * parce que la réserve dit POURQUOI elle est absente et donc quoi faire. Une valeur absente
 * SANS réserve est `UNKNOWN_ACTIVATABLE` : elle est activable par une saisie, et l'annoncer
 * bloquante serait alarmiste. Une valeur présente avec réserve est `PARTIAL` et non l'état de
 * la réserve : le chiffre est là, il porte une limite, et le §17 borne la zone C à « au plus
 * une réserve de qualité locale ».
 */
function answerState(
  value: number | null,
  blockers: readonly string[],
): {
  state: PresentationState;
  reserve: string | null;
} {
  const translated = translateIssues(blockers);
  const first = translated.issues[0] ?? null;
  if (value === null) {
    return {
      state: first ? translated.state : "UNKNOWN_ACTIVATABLE",
      reserve: first?.label ?? null,
    };
  }
  return { state: first ? "PARTIAL" : "AVAILABLE", reserve: first?.label ?? null };
}

export interface BuildAnswersInput {
  readonly netWorth: AggregateInput;
  readonly immediateCash: AggregateInput;
  /** `null` quand les deux clôtures ne sont pas comparables : jamais zéro (§20 règles). */
  readonly closeChange: number | null;
  readonly closeChangeReserve: string | null;
  readonly monthFlow: MonthFlowView | null;
  readonly goalTrajectory: GoalTrajectoryView | null;
  readonly pendingCount: number;
  readonly obligationCount: number;
}

export function buildAnswers(input: BuildAnswersInput): AnswerView[] {
  const netWorth = answerState(input.netWorth.value, input.netWorth.blockers);
  const cash = answerState(input.immediateCash.value, input.immediateCash.blockers);

  return [
    {
      rank: 1,
      question: PRODUCT_QUESTIONS[0],
      kpiIds: ["net_worth"],
      label: "Patrimoine net",
      value: input.netWorth.value,
      unit: "REPORTING_CURRENCY",
      state: netWorth.state,
      reserve: netWorth.reserve,
      signed: false,
    },
    {
      rank: 2,
      question: PRODUCT_QUESTIONS[1],
      kpiIds: ["immediate_cash"],
      label: "Liquidité immédiate",
      value: input.immediateCash.value,
      unit: "REPORTING_CURRENCY",
      state: cash.state,
      reserve: cash.reserve,
      signed: false,
    },
    {
      rank: 3,
      question: PRODUCT_QUESTIONS[2],
      kpiIds: ["net_worth_change_since_close"],
      label: "Évolution depuis la clôture",
      value: input.closeChange,
      unit: "REPORTING_CURRENCY",
      // Une variation non calculable n'est PAS « à compléter » : le §20 interdit toute
      // variation dont les deux clôtures ne sont pas comparables, et il n'y a rien à saisir
      // pour rendre comparables deux périmètres qui ont changé. C'est une limite déclarée.
      state:
        input.closeChange === null
          ? input.closeChangeReserve
            ? "PARTIAL"
            : "UNKNOWN_ACTIVATABLE"
          : "AVAILABLE",
      reserve: input.closeChangeReserve,
      signed: true,
    },
    {
      rank: 4,
      question: PRODUCT_QUESTIONS[3],
      kpiIds: ["free_cash_flow_after_debt", "upcoming_obligations_30d"],
      label: "Solde libre du mois",
      value: input.monthFlow ? input.monthFlow.freeCashFlow : null,
      unit: "REPORTING_CURRENCY",
      state: input.monthFlow
        ? input.monthFlow.partial || input.monthFlow.unclassifiedFlows !== 0
          ? "PARTIAL"
          : "AVAILABLE"
        : "UNKNOWN_ACTIVATABLE",
      reserve: input.monthFlow?.reserve ?? null,
      signed: true,
    },
    {
      rank: 5,
      question: PRODUCT_QUESTIONS[4],
      // Aucun KPI de montant : le §20 item 4 donne à cette question une « trajectoire courte
      // vers les objectifs actifs », et le registre porte la progression sous l'objectif.
      kpiIds: ["goal_progress"],
      label: input.goalTrajectory?.name ?? "Aucun objectif actif",
      value: input.goalTrajectory?.progress ?? null,
      unit: "NONE",
      // Une progression non calculable AVEC réserve est `PARTIAL` : la réserve dit pourquoi.
      // SANS réserve, elle est `UNKNOWN_ACTIVATABLE` — c'est le cas d'un objectif enregistré
      // sans définition évaluable, où il n'y a rien à corriger mais quelque chose à préciser.
      // Le rendre `PARTIAL` afficherait un état de réserve sans réserve à afficher, c'est-à-
      // dire un avertissement muet.
      state: input.goalTrajectory
        ? input.goalTrajectory.progress !== null
          ? "AVAILABLE"
          : input.goalTrajectory.reserve
            ? "PARTIAL"
            : "UNKNOWN_ACTIVATABLE"
        : "UNKNOWN_ACTIVATABLE",
      reserve: input.goalTrajectory?.reserve ?? null,
      signed: false,
    },
    {
      rank: 6,
      question: PRODUCT_QUESTIONS[5],
      kpiIds: ["pending_review_count"],
      label: "Éléments à vérifier",
      value: input.pendingCount,
      unit: "COUNT",
      // Un compteur à zéro est une INFORMATION, pas une absence : rien n'attend l'utilisateur.
      // Le registre le dit sous `onDeclaredZero: COMPUTE`.
      state: "AVAILABLE",
      reserve: null,
      signed: false,
    },
  ];
}
