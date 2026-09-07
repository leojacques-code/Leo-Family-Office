import type { CanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import { canonicalBalanceSheetOf } from "@/lib/engine/balance-sheet-view";
import type {
  DecisionCaseVersion,
  DecisionEvaluation,
  DecisionRun,
} from "@/lib/engine/decision-contracts";
import { evaluateDecisionCase } from "@/lib/engine/decision-lab";
import { buildDashboardEventTimeline } from "@/lib/engine/event-adapters";
import type { CanonicalTimeline } from "@/lib/engine/event-contracts";
import type { GoalCurrentEvaluation, GoalVersionDefinition } from "@/lib/engine/goal-contracts";
import { evaluateGoalCurrent } from "@/lib/engine/goal-engine";
import {
  buildOpeningBalanceSheet,
  projectedMonthWindow,
  type OpeningBalanceSheet,
} from "@/lib/engine/monthly-financial-model";
import type {
  ScenarioBaselineReference,
  ScenarioComparison,
  ScenarioVersionDefinition,
} from "@/lib/engine/scenario-contracts";
import { buildBaselineReference, runScenarioComparison } from "@/lib/engine/scenario-engine";
import type { DashboardState } from "@/lib/types";

export const GLOBAL_FINANCIAL_MODEL_VERSION = "GLOBAL_FINANCIAL_MODEL_1" as const;

export type GlobalFinancialModelCompleteness = "READY" | "PARTIAL" | "NOT_COMPUTABLE";

export interface GlobalFinancialModelBlocker {
  code: string;
  message: string;
  source: "BALANCE_SHEET" | "EVENT_ENGINE" | "GLOBAL_FINANCIAL_MODEL";
  blocking: boolean;
}

/**
 * Contexte commun de tous les consommateurs prospectifs.
 *
 * Il ne persiste rien : le bilan, la timeline et leurs fingerprints sont reconstruits à
 * la lecture depuis les faits canoniques. Scenarios, Goals et Decision Lab reçoivent donc
 * exactement le même cut-off, le même horizon et le même jeu d'événements.
 */
export interface GlobalFinancialContext {
  methodologyVersion: typeof GLOBAL_FINANCIAL_MODEL_VERSION;
  asOfDate: string;
  reportingCurrency: string;
  horizonMonths: number;
  endDate: string;
  balanceSheet: CanonicalBalanceSheet;
  opening: OpeningBalanceSheet;
  timeline: CanonicalTimeline;
  baseline: ScenarioBaselineReference;
  currentScenarioVersions: Record<string, number>;
  currentGoalVersions: Record<string, number>;
  blockers: GlobalFinancialModelBlocker[];
  completeness: GlobalFinancialModelCompleteness;
}

export interface GlobalScenarioEvaluation {
  context: GlobalFinancialContext;
  comparison: ScenarioComparison;
  baseline: ScenarioBaselineReference;
}

export interface GlobalDecisionEvaluation {
  context: GlobalFinancialContext;
  evaluation: DecisionEvaluation;
}

function contextBlockers(input: {
  opening: OpeningBalanceSheet;
  balanceSheet: CanonicalBalanceSheet;
  timeline: CanonicalTimeline;
}): GlobalFinancialModelBlocker[] {
  const blockers: GlobalFinancialModelBlocker[] = input.opening.flags.map((code) => ({
    code,
    message: code,
    source: "BALANCE_SHEET",
    blocking: false,
  }));
  for (const conflict of input.timeline.conflicts) {
    blockers.push({
      code: conflict.reason,
      message: `${conflict.reason} : ${conflict.eventIds.join(", ")}`,
      source: "EVENT_ENGINE",
      blocking: true,
    });
  }
  for (const consequence of input.timeline.monthlyConsequences) {
    for (const code of consequence.blockers) {
      blockers.push({
        code,
        message: `${code} : ${consequence.id}`,
        source: "EVENT_ENGINE",
        blocking: false,
      });
    }
  }
  if (input.balanceSheet.netWorth.status !== "COMPLETE") {
    blockers.push(
      ...input.balanceSheet.netWorth.blockers.map((code) => ({
        code,
        message: code,
        source: "BALANCE_SHEET" as const,
        blocking: false,
      })),
    );
  }
  return [...new Map(blockers.map((item) => [JSON.stringify(item), item])).values()];
}

function completenessOf(blockers: GlobalFinancialModelBlocker[]): GlobalFinancialModelCompleteness {
  if (blockers.some((item) => item.blocking)) return "NOT_COMPUTABLE";
  return blockers.length ? "PARTIAL" : "READY";
}

/** Construit un horizon exact ; aucune timeline fixe de 30 ou 40 ans n'est réutilisée. */
export function buildGlobalFinancialContext(
  state: DashboardState,
  horizonMonths: number,
): GlobalFinancialContext {
  if (!Number.isInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > 960) {
    throw new Error("Global Financial Model : horizon mensuel invalide");
  }
  const balanceSheet = canonicalBalanceSheetOf(state);
  if (balanceSheet.asOfDate !== state.asOfDate) {
    throw new Error("Global Financial Model : bilan canonique et état désynchronisés");
  }
  const opening = buildOpeningBalanceSheet({ ...state, balanceSheet });
  const endDate = projectedMonthWindow(state.asOfDate, horizonMonths).end;
  const timeline = buildDashboardEventTimeline({
    state,
    startDate: state.asOfDate,
    endDate,
  });
  const baseline = buildBaselineReference({ opening, timeline });
  const blockers = contextBlockers({ opening, balanceSheet, timeline });
  return {
    methodologyVersion: GLOBAL_FINANCIAL_MODEL_VERSION,
    asOfDate: state.asOfDate,
    reportingCurrency: state.reportingCurrency,
    horizonMonths,
    endDate,
    balanceSheet,
    opening,
    timeline,
    baseline,
    currentScenarioVersions: Object.fromEntries(
      state.scenarios.map((scenario) => [scenario.id, scenario.version]),
    ),
    currentGoalVersions: Object.fromEntries(
      state.goals.map((goal) => [goal.id, goal.definition?.version ?? goal.version ?? 1]),
    ),
    blockers,
    completeness: completenessOf(blockers),
  };
}

function assertComparable(
  context: GlobalFinancialContext,
  definition: ScenarioVersionDefinition,
): void {
  if (definition.asOfDate !== context.asOfDate) {
    throw new Error("Global Financial Model : le scénario n'utilise pas le cut-off canonique");
  }
  if (definition.horizonMonths !== context.horizonMonths) {
    throw new Error("Global Financial Model : le scénario n'utilise pas l'horizon du contexte");
  }
}

export function runGlobalScenarioComparison(
  context: GlobalFinancialContext,
  definition: ScenarioVersionDefinition,
): GlobalScenarioEvaluation {
  assertComparable(context, definition);
  const comparison = runScenarioComparison({
    baselineEvents: context.timeline.events,
    opening: context.opening,
    definition,
    reportingCurrency: context.reportingCurrency,
  });
  const baseline = buildBaselineReference({
    opening: context.opening,
    timeline: comparison.baseline.timeline,
  });
  if (
    baseline.openingFingerprint !== context.baseline.openingFingerprint ||
    baseline.eventSetVersion !== context.baseline.eventSetVersion
  ) {
    throw new Error("Global Financial Model : divergence de baseline entre consommateurs");
  }
  return { context, comparison, baseline };
}

export function evaluateGlobalScenario(
  state: DashboardState,
  definition: ScenarioVersionDefinition,
): GlobalScenarioEvaluation {
  return runGlobalScenarioComparison(
    buildGlobalFinancialContext(state, definition.horizonMonths),
    definition,
  );
}

export function evaluateGlobalGoalCurrent(
  context: GlobalFinancialContext,
  goal: GoalVersionDefinition,
): GoalCurrentEvaluation {
  return evaluateGoalCurrent({
    goal,
    balanceSheet: context.balanceSheet,
    reportingCurrency: context.reportingCurrency,
    asOfDate: context.asOfDate,
  });
}

export function evaluateGlobalDecisionCase(
  state: DashboardState,
  caseVersion: DecisionCaseVersion,
  options: {
    runId?: string;
    createdAt?: string;
    runMode?: DecisionRun["runMode"];
    seed?: number | null;
    samplePathsByOptionId?: Parameters<typeof evaluateDecisionCase>[0]["samplePathsByOptionId"];
  } = {},
): GlobalDecisionEvaluation {
  const context = buildGlobalFinancialContext(state, caseVersion.horizonMonths);
  if (caseVersion.asOfDate !== context.asOfDate) {
    throw new Error("Global Financial Model : le Decision Case n'utilise pas le cut-off canonique");
  }
  const rawEvaluation = evaluateDecisionCase({
    caseVersion,
    baselineEvents: context.timeline.events,
    opening: context.opening,
    reportingCurrency: context.reportingCurrency,
    currentScenarioVersions: context.currentScenarioVersions,
    currentGoalVersions: context.currentGoalVersions,
    ...options,
  });
  const evaluation: DecisionEvaluation = {
    ...rawEvaluation,
    options: rawEvaluation.options.map((option) => ({
      ...option,
      provenance: {
        ...option.provenance,
        engines: [...new Set([GLOBAL_FINANCIAL_MODEL_VERSION, ...option.provenance.engines])],
        methodologyVersions: [
          ...new Set([
            GLOBAL_FINANCIAL_MODEL_VERSION,
            ...option.provenance.methodologyVersions,
          ]),
        ],
      },
    })),
    provenance: {
      ...rawEvaluation.provenance,
      methodologyVersions: [
        ...new Set([
          GLOBAL_FINANCIAL_MODEL_VERSION,
          ...rawEvaluation.provenance.methodologyVersions,
        ]),
      ],
    },
  };
  return { context, evaluation };
}
