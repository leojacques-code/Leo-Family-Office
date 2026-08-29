import type {
  CanonicalAggregate,
  CanonicalBalanceSheet,
  ConvertedBalanceSheetLine,
} from "@/lib/engine/balance-sheet";
import type { ScenarioPathMetric } from "@/lib/engine/scenario-contracts";
import type {
  GoalBlocker,
  GoalMetricObservation,
  GoalTarget,
  GoalTargetMetric,
  GoalTargetOperator,
} from "@/lib/engine/goal-contracts";

export interface GoalMetricDefinition {
  metric: GoalTargetMetric;
  label: string;
  source: string;
  unit: "MONEY";
  economicDirection: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
  entityRequirement: "NONE" | "OPTIONAL" | "REQUIRED";
  supportsCurrent: boolean;
  supportsProjected: boolean;
  allowedOperators: readonly GoalTargetOperator[];
}

export interface GoalCurrentMetricContext {
  balanceSheet: CanonicalBalanceSheet;
  reportingCurrency: string;
  asOfDate: string;
}

const ASSET_OPERATORS = ["AT_LEAST", "EQUAL"] as const;
const LIABILITY_OPERATORS = ["AT_MOST", "EQUAL"] as const;

export const GOAL_METRIC_REGISTRY: Record<GoalTargetMetric, GoalMetricDefinition> = {
  NET_WORTH: {
    metric: "NET_WORTH",
    label: "Patrimoine net",
    source: "CanonicalBalanceSheet.netWorth / ScenarioPathMetric.netWorth",
    unit: "MONEY",
    economicDirection: "HIGHER_IS_BETTER",
    entityRequirement: "NONE",
    supportsCurrent: true,
    supportsProjected: true,
    allowedOperators: ASSET_OPERATORS,
  },
  LIQUID_NET_WORTH: {
    metric: "LIQUID_NET_WORTH",
    label: "Patrimoine net liquide",
    source: "CanonicalBalanceSheet.liquidNetWorth / ScenarioPathMetric.liquidNetWorth",
    unit: "MONEY",
    economicDirection: "HIGHER_IS_BETTER",
    entityRequirement: "NONE",
    supportsCurrent: true,
    supportsProjected: true,
    allowedOperators: ASSET_OPERATORS,
  },
  IMMEDIATE_CASH: {
    metric: "IMMEDIATE_CASH",
    label: "Trésorerie immédiate",
    source: "CanonicalBalanceSheet.immediateCash / ScenarioPathMetric.cash",
    unit: "MONEY",
    economicDirection: "HIGHER_IS_BETTER",
    entityRequirement: "NONE",
    supportsCurrent: true,
    supportsProjected: true,
    allowedOperators: ASSET_OPERATORS,
  },
  LIQUID_ASSETS: {
    metric: "LIQUID_ASSETS",
    label: "Actifs liquides",
    source: "CanonicalBalanceSheet.liquidAssets",
    unit: "MONEY",
    economicDirection: "HIGHER_IS_BETTER",
    entityRequirement: "NONE",
    supportsCurrent: true,
    supportsProjected: false,
    allowedOperators: ASSET_OPERATORS,
  },
  INVESTMENT_ASSETS: {
    metric: "INVESTMENT_ASSETS",
    label: "Actifs d’investissement",
    source:
      "CanonicalBalanceSheet.marketInvestedAssets + investmentEnvelopeCash / ScenarioPathMetric.investmentAssets",
    unit: "MONEY",
    economicDirection: "HIGHER_IS_BETTER",
    entityRequirement: "NONE",
    supportsCurrent: true,
    supportsProjected: true,
    allowedOperators: ASSET_OPERATORS,
  },
  TOTAL_LIABILITIES: {
    metric: "TOTAL_LIABILITIES",
    label: "Total des passifs",
    source: "CanonicalBalanceSheet.totalLiabilities / ScenarioPathMetric.debt",
    unit: "MONEY",
    economicDirection: "LOWER_IS_BETTER",
    entityRequirement: "NONE",
    supportsCurrent: true,
    supportsProjected: true,
    allowedOperators: LIABILITY_OPERATORS,
  },
  CONTRACTUAL_DEBT: {
    metric: "CONTRACTUAL_DEBT",
    label: "Dette contractuelle",
    source: "CanonicalBalanceSheet.contractualDebt",
    unit: "MONEY",
    economicDirection: "LOWER_IS_BETTER",
    entityRequirement: "NONE",
    supportsCurrent: true,
    supportsProjected: false,
    allowedOperators: LIABILITY_OPERATORS,
  },
  FUNDING_GAP: {
    metric: "FUNDING_GAP",
    label: "Besoin de financement non couvert",
    source: "ScenarioPathMetric.fundingGap",
    unit: "MONEY",
    economicDirection: "LOWER_IS_BETTER",
    entityRequirement: "NONE",
    supportsCurrent: false,
    supportsProjected: true,
    allowedOperators: LIABILITY_OPERATORS,
  },
  SPECIFIC_DEBT_BALANCE: {
    metric: "SPECIFIC_DEBT_BALANCE",
    label: "Solde d’une dette",
    source: "CanonicalBalanceSheet.contributions[DEBT, entityId]",
    unit: "MONEY",
    economicDirection: "LOWER_IS_BETTER",
    entityRequirement: "REQUIRED",
    supportsCurrent: true,
    supportsProjected: false,
    allowedOperators: LIABILITY_OPERATORS,
  },
  REAL_ESTATE_VALUE: {
    metric: "REAL_ESTATE_VALUE",
    label: "Valeur immobilière",
    source: "CanonicalBalanceSheet.contributions[REAL_ESTATE]",
    unit: "MONEY",
    economicDirection: "HIGHER_IS_BETTER",
    entityRequirement: "OPTIONAL",
    supportsCurrent: true,
    supportsProjected: false,
    allowedOperators: ASSET_OPERATORS,
  },
  BUSINESS_EQUITY: {
    metric: "BUSINESS_EQUITY",
    label: "Business Equity",
    source: "CanonicalBalanceSheet.contributions[BUSINESS_EQUITY]",
    unit: "MONEY",
    economicDirection: "HIGHER_IS_BETTER",
    entityRequirement: "OPTIONAL",
    supportsCurrent: true,
    supportsProjected: false,
    allowedOperators: ASSET_OPERATORS,
  },
};

function blocker(code: string, message: string, source = "GOAL_METRIC_REGISTRY"): GoalBlocker {
  return { code, message, blocking: true, source };
}

function aggregateObservation(
  metric: GoalTargetMetric,
  aggregate: CanonicalAggregate,
  context: GoalCurrentMetricContext,
  source: string,
): GoalMetricObservation {
  return {
    metric,
    value: aggregate.value,
    currency: context.reportingCurrency,
    observedAt: context.asOfDate,
    status: aggregate.status,
    blockers: aggregate.blockers.map((code) => blocker(code, code, source)),
    provenance: { source, methodologyVersion: "CANONICAL_BALANCE_SHEET_V2", entityId: null },
  };
}

function sumAggregates(left: CanonicalAggregate, right: CanonicalAggregate): CanonicalAggregate {
  const blockers = [...new Set([...left.blockers, ...right.blockers])];
  if (left.value !== null && right.value !== null) {
    return { value: left.value + right.value, knownValue: left.knownValue + right.knownValue, status: "COMPLETE", coverage: 1, blockers: [] };
  }
  return {
    value: null,
    knownValue: left.knownValue + right.knownValue,
    status:
      left.status === "NOT_COMPUTABLE" && right.status === "NOT_COMPUTABLE"
        ? "NOT_COMPUTABLE"
        : "PARTIAL",
    coverage: Math.min(left.coverage, right.coverage),
    blockers,
  };
}

function contributionObservation(
  metric: GoalTargetMetric,
  lines: ConvertedBalanceSheetLine[],
  context: GoalCurrentMetricContext,
  target: GoalTarget,
): GoalMetricObservation {
  const definition = GOAL_METRIC_REGISTRY[metric];
  const filtered = lines.filter(
    (line) => target.entityId === null || line.entityId === target.entityId,
  );
  if (!filtered.length && target.entityId !== null) {
    return {
      metric,
      value: null,
      currency: context.reportingCurrency,
      observedAt: context.asOfDate,
      status: "NOT_COMPUTABLE",
      blockers: [blocker("ENTITY_NOT_FOUND", `Entité ${target.entityId} absente du bilan canonique`)],
      provenance: {
        source: definition.source,
        methodologyVersion: "CANONICAL_BALANCE_SHEET_V2",
        entityId: target.entityId,
      },
    };
  }
  const missing = filtered.filter((line) => line.reportingValue === null);
  const value = missing.length
    ? null
    : filtered.reduce((sum, line) => sum + (line.reportingValue ?? 0), 0);
  return {
    metric,
    value,
    currency: context.reportingCurrency,
    observedAt: context.asOfDate,
    status: missing.length ? (filtered.length === missing.length ? "NOT_COMPUTABLE" : "PARTIAL") : "COMPLETE",
    blockers: [
      ...new Set(missing.flatMap((line) => [...line.fx.flags, ...(line.valuationBlockers ?? [])])),
    ].map((code) => blocker(code, code, definition.source)),
    provenance: {
      source: definition.source,
      methodologyVersion: "CANONICAL_BALANCE_SHEET_V2",
      entityId: target.entityId,
    },
  };
}

function unavailable(
  target: GoalTarget,
  observedAt: string,
  code: string,
  message: string,
): GoalMetricObservation {
  const definition = GOAL_METRIC_REGISTRY[target.metric];
  return {
    metric: target.metric,
    value: null,
    currency: target.currency,
    observedAt,
    status: "NOT_COMPUTABLE",
    blockers: [blocker(code, message)],
    provenance: {
      source: definition?.source ?? "GOAL_METRIC_REGISTRY",
      methodologyVersion: "GOALS_V2_CANONICAL_TRAJECTORY_1",
      entityId: target.entityId,
    },
  };
}

function targetPreconditions(
  target: GoalTarget,
  currency: string,
  observedAt: string,
): GoalMetricObservation | null {
  const definition = GOAL_METRIC_REGISTRY[target.metric];
  if (!definition)
    return unavailable(target, observedAt, "METRIC_NOT_SUPPORTED", `Métrique ${target.metric} inconnue`);
  if (!definition.allowedOperators.includes(target.operator)) {
    return unavailable(
      target,
      observedAt,
      "METRIC_NOT_SUPPORTED",
      `Opérateur ${target.operator} non supporté pour ${target.metric}`,
    );
  }
  if (definition.entityRequirement === "REQUIRED" && target.entityId === null) {
    return unavailable(target, observedAt, "MISSING_ENTITY_TARGET", "Cette métrique exige une entité cible");
  }
  if (target.currency === null)
    return unavailable(target, observedAt, "MISSING_CURRENCY", "Devise cible absente");
  if (target.currency !== currency) {
    return unavailable(
      target,
      observedAt,
      "CURRENCY_MISMATCH",
      `Cible ${target.currency} incompatible avec la trajectoire ${currency} sans conversion FX explicite`,
    );
  }
  return null;
}

export function resolveCurrentGoalMetric(
  target: GoalTarget,
  context: GoalCurrentMetricContext,
): GoalMetricObservation {
  const precondition = targetPreconditions(target, context.reportingCurrency, context.asOfDate);
  if (precondition) return precondition;
  const definition = GOAL_METRIC_REGISTRY[target.metric];
  if (!definition.supportsCurrent) {
    return unavailable(
      target,
      context.asOfDate,
      "METRIC_NOT_AVAILABLE_CURRENT",
      `${definition.label} n’existe pas dans l’état courant canonique`,
    );
  }
  const sheet = context.balanceSheet;
  switch (target.metric) {
    case "NET_WORTH":
      return aggregateObservation(target.metric, sheet.netWorth, context, definition.source);
    case "LIQUID_NET_WORTH":
      return aggregateObservation(target.metric, sheet.liquidNetWorth, context, definition.source);
    case "IMMEDIATE_CASH":
      return aggregateObservation(target.metric, sheet.immediateCash, context, definition.source);
    case "LIQUID_ASSETS":
      return aggregateObservation(target.metric, sheet.liquidAssets, context, definition.source);
    case "INVESTMENT_ASSETS":
      return aggregateObservation(
        target.metric,
        sumAggregates(sheet.marketInvestedAssets, sheet.investmentEnvelopeCash),
        context,
        definition.source,
      );
    case "TOTAL_LIABILITIES":
      return aggregateObservation(target.metric, sheet.totalLiabilities, context, definition.source);
    case "CONTRACTUAL_DEBT":
      return aggregateObservation(target.metric, sheet.contractualDebt, context, definition.source);
    case "SPECIFIC_DEBT_BALANCE":
      return contributionObservation(
        target.metric,
        sheet.contributions.filter(
          (line) => line.domain === "DEBT" && line.side === "LIABILITY" && line.isAccountingPrimary,
        ),
        context,
        target,
      );
    case "REAL_ESTATE_VALUE":
      return contributionObservation(
        target.metric,
        sheet.contributions.filter(
          (line) => line.domain === "REAL_ESTATE" && line.side === "ASSET" && line.isAccountingPrimary,
        ),
        context,
        target,
      );
    case "BUSINESS_EQUITY":
      return contributionObservation(
        target.metric,
        sheet.contributions.filter(
          (line) => line.domain === "BUSINESS_EQUITY" && line.side === "ASSET" && line.isAccountingPrimary,
        ),
        context,
        target,
      );
    case "FUNDING_GAP":
      return unavailable(
        target,
        context.asOfDate,
        "METRIC_NOT_AVAILABLE_CURRENT",
        "Le funding gap est une métrique de trajectoire, pas un solde patrimonial courant",
      );
  }
}

export function resolveProjectedGoalMetric(
  target: GoalTarget,
  point: ScenarioPathMetric,
  reportingCurrency: string,
): GoalMetricObservation {
  const precondition = targetPreconditions(target, reportingCurrency, point.date);
  if (precondition) return precondition;
  const definition = GOAL_METRIC_REGISTRY[target.metric];
  if (!definition.supportsProjected) {
    return unavailable(
      target,
      point.date,
      "METRIC_NOT_AVAILABLE_PROJECTED",
      `${definition.label} n’est pas exposé distinctement par ScenarioPath`,
    );
  }
  const valueByMetric: Partial<Record<GoalTargetMetric, number>> = {
    NET_WORTH: point.netWorth,
    LIQUID_NET_WORTH: point.liquidNetWorth,
    IMMEDIATE_CASH: point.cash,
    INVESTMENT_ASSETS: point.investmentAssets,
    TOTAL_LIABILITIES: point.debt,
    FUNDING_GAP: point.fundingGap,
  };
  const value = valueByMetric[target.metric];
  if (value === undefined) {
    return unavailable(
      target,
      point.date,
      "METRIC_NOT_AVAILABLE_PROJECTED",
      `${definition.label} n’est pas disponible sur ce point de trajectoire`,
    );
  }
  return {
    metric: target.metric,
    value,
    currency: reportingCurrency,
    observedAt: point.date,
    status: "COMPLETE",
    blockers: [],
    provenance: {
      source: definition.source,
      methodologyVersion: "SCENARIOS_V2_EVENT_MONTHLY_1",
      entityId: target.entityId,
    },
  };
}

