import type { DecisionCaseStatus } from "@/lib/engine/decision-contracts";
import type { CanonicalEvent } from "@/lib/engine/event-contracts";
import {
  buildGlobalFinancialContext,
  evaluateGlobalGoalCurrent,
  type GlobalFinancialContext,
} from "@/lib/engine/global-financial-model";
import type { GoalCurrentEvaluation } from "@/lib/engine/goal-contracts";
import type { DashboardState, Goal, MonthlyClose } from "@/lib/types";

export interface RankedGoal {
  goal: Goal;
  evaluation: GoalCurrentEvaluation | null;
  score: readonly [number, number, number, number, number, string];
}

export interface TodayCockpit {
  context: GlobalFinancialContext;
  netWorth: number | null;
  liquidity: number | null;
  cashFlow: number | null;
  debt: number | null;
  closeChange: { from: MonthlyClose; to: MonthlyClose; amount: number } | null;
  primaryGoal: RankedGoal | null;
  nextEvent: CanonicalEvent | null;
  decisions: Array<{ id: string; name: string; status: DecisionCaseStatus; href: string }>;
  actions: Array<{ id: string; label: string; href: string }>;
}

/** `null` reste non calculable ; une progression réellement égale à zéro reste `0`. */
export function goalProgress(relativeGap: number | null | undefined): number | null {
  return relativeGap === null || relativeGap === undefined
    ? null
    : Math.max(0, 1 - Math.abs(relativeGap));
}

/**
 * Ordre pur : Goals actifs, priorité déclarée (la plus petite est la plus forte),
 * calculabilité, absence de blocker, échéance, puis écart relatif décroissant. L'identifiant
 * est l'ultime départage stable : l'ordre d'entrée n'a donc aucun effet.
 */
export function rankGoals(goals: Goal[], context: GlobalFinancialContext): RankedGoal[] {
  return goals
    .map((goal): RankedGoal => {
      const evaluation = goal.definition
        ? evaluateGlobalGoalCurrent(context, goal.definition)
        : null;
      const deadline = goal.definition?.targetDate ?? goal.targetDate ?? "9999-12-31";
      const gap = evaluation?.gap?.relativeGap;
      return {
        goal,
        evaluation,
        score: [
          goal.status === "ACTIVE" ? 0 : goal.status === "PAUSED" ? 1 : 2,
          goal.definition?.priority ?? goal.priority,
          evaluation?.status === "NOT_COMPUTABLE" || !evaluation ? 1 : 0,
          evaluation?.blockers.some((item) => item.blocking) ? 1 : 0,
          Number(deadline.replaceAll("-", "")) - Math.round(Math.abs(gap ?? 0) * 100),
          goal.id,
        ],
      };
    })
    .sort((left, right) => {
      for (let index = 0; index < left.score.length; index += 1) {
        const comparison =
          left.score[index]! < right.score[index]!
            ? -1
            : left.score[index]! > right.score[index]!
              ? 1
              : 0;
        if (comparison) return comparison;
      }
      return 0;
    });
}

function closeChange(closes: MonthlyClose[]) {
  const ordered = [...closes].sort(
    (a, b) => a.closeDate.localeCompare(b.closeDate) || a.id.localeCompare(b.id),
  );
  if (ordered.length < 2) return null;
  const [from, to] = ordered.slice(-2);
  return { from, to, amount: to.netWorth - from.netWorth };
}

export function buildTodayCockpit(state: DashboardState, horizonMonths = 960): TodayCockpit {
  const context = buildGlobalFinancialContext(state, horizonMonths);
  const primaryGoal = rankGoals(state.goals, context)[0] ?? null;
  const nextEvent =
    context.timeline.events
      .filter(
        (event) =>
          event.effectiveDate >= context.asOfDate &&
          event.status !== "CANCELLED" &&
          event.status !== "SUPERSEDED",
      )
      .sort(
        (a, b) =>
          a.effectiveDate.localeCompare(b.effectiveDate) ||
          a.sequence - b.sequence ||
          a.id.localeCompare(b.id),
      )[0] ?? null;
  const decisions = (state.decisionCases ?? [])
    .filter(
      (item) => item.status === "ACTIVE" || item.status === "DRAFT" || Boolean(item.latestResult),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .map((item) => ({ id: item.id, name: item.name, status: item.status, href: "/decision-lab" }));
  const actions = [
    ...(context.blockers.length
      ? [
          {
            id: "complete-data",
            label: "Résoudre les données manquantes",
            href: context.blockers[0]?.source === "EVENT_ENGINE" ? "/timeline" : "/net-worth",
          },
        ]
      : []),
    ...(primaryGoal
      ? [{ id: "review-goal", label: `Revoir ${primaryGoal.goal.name}`, href: "/goals" }]
      : [{ id: "create-goal", label: "Définir un Goal", href: "/goals" }]),
    ...(decisions.length
      ? [{ id: "review-decision", label: "Évaluer la décision active", href: "/decision-lab" }]
      : []),
  ];
  return {
    context,
    netWorth: context.balanceSheet.netWorth.value,
    liquidity: state.metrics.liquidAssets,
    cashFlow: state.metrics.freeCashFlow,
    debt: context.balanceSheet.totalLiabilities.value,
    closeChange: closeChange(state.monthlyCloses),
    primaryGoal,
    nextEvent,
    decisions,
    actions,
  };
}
