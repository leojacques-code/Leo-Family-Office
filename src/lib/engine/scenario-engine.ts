import type { Scenario } from "@/lib/types";
import type {
  CanonicalEvent,
  CanonicalMonthlyConsequence,
  CanonicalTimeline,
  ScenarioEventOverride,
} from "@/lib/engine/event-contracts";
import { applyScenarioOverrides, buildCanonicalTimeline } from "@/lib/engine/event-engine";
import {
  projectedMonthWindow,
  runDeterministicEventModel,
  toAnnualPoints,
  type MonthlyFinancialState,
  type OpeningBalanceSheet,
} from "@/lib/engine/monthly-financial-model";
import {
  SCENARIO_METHODOLOGY_VERSION,
  SCENARIO_V2_SCHEMA_VERSION,
  type PersistedScenarioEventOverride,
  type ScenarioAssumptionV2,
  type ScenarioBaselineReference,
  type ScenarioBlocker,
  type ScenarioComparison,
  type ScenarioComparisonPoint,
  type ScenarioCompleteness,
  type ScenarioMarketModel,
  type ScenarioPath,
  type ScenarioPathMetric,
  type ScenarioVersionDefinition,
} from "@/lib/engine/scenario-contracts";

const ZERO_MARKET: ScenarioMarketModel = {
  annualReturn: 0,
  annualVolatility: 0,
  annualInflation: 0,
  stressProbability: 0,
  shockYear: null,
  shockMagnitude: null,
  randomVariables: ["PORTFOLIO_RETURN"],
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

/** Hash stable non cryptographique : identité de calcul, jamais contrôle de sécurité. */
export function scenarioFingerprint(value: unknown): string {
  const text = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function endDate(asOfDate: string, horizonMonths: number): string {
  return projectedMonthWindow(asOfDate, horizonMonths).end;
}

function blocker(
  code: string,
  message: string,
  input: Partial<Pick<ScenarioBlocker, "eventId" | "assumptionKey" | "blocking">> = {},
): ScenarioBlocker {
  return {
    code,
    message,
    eventId: input.eventId ?? null,
    assumptionKey: input.assumptionKey ?? null,
    blocking: input.blocking ?? false,
  };
}

function isProtectedHistory(event: CanonicalEvent, asOfDate: string): boolean {
  return event.effectiveDate <= asOfDate;
}

export interface PreparedScenarioTimeline {
  baseline: CanonicalTimeline;
  scenario: CanonicalTimeline;
  overrides: ScenarioEventOverride[];
  blockers: ScenarioBlocker[];
}

/**
 * Valide et compile les overlays persistés vers le contrat Event Engine. Les opérations
 * invalides sont conservées dans l'explicabilité sous forme de blockers, jamais appliquées
 * silencieusement.
 */
export function prepareScenarioTimeline(input: {
  baselineEvents: CanonicalEvent[];
  definition: ScenarioVersionDefinition;
}): PreparedScenarioTimeline {
  const { definition } = input;
  const finish = endDate(definition.asOfDate, definition.horizonMonths);
  const baselineById = new Map(input.baselineEvents.map((event) => [event.id, event]));
  const blockers: ScenarioBlocker[] = [];
  const seenOverlayIds = new Set<string>();
  const overrides: ScenarioEventOverride[] = [];

  for (const overlay of definition.overrides) {
    if (seenOverlayIds.has(overlay.id)) {
      blockers.push(
        blocker("OVERRIDE_CONFLICT", `Override dupliqué : ${overlay.id}`, {
          eventId: overlay.event?.id ?? overlay.baselineEventId,
          blocking: true,
        }),
      );
      continue;
    }
    seenOverlayIds.add(overlay.id);

    if (overlay.operation === "ADD") {
      if (!overlay.event) {
        blockers.push(
          blocker("PARTIAL_CONSEQUENCE", `L'override ${overlay.id} ne contient aucun événement`, {
            blocking: false,
          }),
        );
        continue;
      }
      if (isProtectedHistory(overlay.event, definition.asOfDate)) {
        blockers.push(
          blocker(
            "HISTORY_PROTECTED",
            `L'événement ${overlay.event.id} ne peut pas être ajouté avant ou au cut-off`,
            { eventId: overlay.event.id, blocking: true },
          ),
        );
        continue;
      }
      overrides.push({ operation: "ADD", scenarioId: definition.scenarioId, event: overlay.event });
      continue;
    }

    const targetId = overlay.baselineEventId;
    const target = targetId ? baselineById.get(targetId) : undefined;
    if (!targetId || !target) {
      blockers.push(
        blocker("OVERRIDE_TARGET_MISSING", `Cible baseline absente pour l'override ${overlay.id}`, {
          eventId: targetId,
          blocking: true,
        }),
      );
      continue;
    }
    if (isProtectedHistory(target, definition.asOfDate)) {
      blockers.push(
        blocker("HISTORY_PROTECTED", `L'événement historique ${target.id} est protégé`, {
          eventId: target.id,
          blocking: true,
        }),
      );
      continue;
    }
    if (overlay.operation === "CANCEL") {
      overrides.push({
        operation: "CANCEL",
        scenarioId: definition.scenarioId,
        baselineEventId: target.id,
      });
      continue;
    }
    if (!overlay.event) {
      blockers.push(
        blocker(
          "PARTIAL_CONSEQUENCE",
          `Le remplacement ${overlay.id} n'a pas de nouvel événement`,
          {
            eventId: target.id,
            blocking: false,
          },
        ),
      );
      continue;
    }
    if (isProtectedHistory(overlay.event, definition.asOfDate)) {
      blockers.push(
        blocker(
          "HISTORY_PROTECTED",
          `Le remplacement ${overlay.event.id} rétroagit sur l'histoire`,
          {
            eventId: overlay.event.id,
            blocking: true,
          },
        ),
      );
      continue;
    }
    overrides.push({
      operation: "REPLACE",
      scenarioId: definition.scenarioId,
      baselineEventId: target.id,
      event: overlay.event,
    });
  }

  const baseline = buildCanonicalTimeline({
    events: input.baselineEvents,
    startDate: definition.asOfDate,
    endDate: finish,
  });
  const scenarioEvents = applyScenarioOverrides(
    input.baselineEvents,
    overrides,
    definition.scenarioId,
  );
  const scenario = buildCanonicalTimeline({
    events: scenarioEvents,
    startDate: definition.asOfDate,
    endDate: finish,
  });
  for (const conflict of scenario.conflicts) {
    blockers.push(
      blocker("OVERRIDE_CONFLICT", `${conflict.reason} : ${conflict.eventIds.join(", ")}`, {
        eventId: conflict.eventIds[0] ?? null,
        blocking: true,
      }),
    );
  }
  return { baseline, scenario, overrides, blockers };
}

function assumptionsForMonthlyModel(market: ScenarioMarketModel, investmentAllocationRate: number) {
  return {
    operatingSurplus: 0,
    investmentAllocationRate,
    annualReturn: market.annualReturn ?? 0,
    shockYear: market.shockYear,
    shockMagnitude: market.shockMagnitude,
  };
}

function consequenceValue(
  consequence: CanonicalMonthlyConsequence,
  field: "income" | "expense" | "taxCash",
): number {
  return consequence[field] ?? 0;
}

function metricFor(
  state: MonthlyFinancialState,
  consequences: CanonicalMonthlyConsequence[],
): ScenarioPathMetric {
  const month = state.date.slice(0, 7);
  // La timeline est déjà rapprochée par l'Event Engine. Les lignes forecast ombrées
  // conservent parfois une composante explicative non bancaire (brut, principal), donc
  // on ne refiltre jamais ici par reconnaissance.
  const selected = consequences.filter((item) => item.month === month && item.included);
  return {
    monthIndex: state.monthIndex,
    date: state.date,
    netWorth: state.netWorth,
    liquidNetWorth:
      state.grossFinancialAssets -
      state.loanBalance -
      state.otherLiabilityBalance -
      state.fundingGap,
    cash: state.bankCash,
    investmentAssets: state.marketInvestedAssets + state.investmentCash,
    realEstateAndBusinessAssets: state.nonFinancialAssets,
    debt: state.loanBalance + state.otherLiabilityBalance,
    fundingGap: state.fundingGap,
    income: selected.reduce((sum, item) => sum + consequenceValue(item, "income"), 0),
    expenses: selected.reduce((sum, item) => sum + consequenceValue(item, "expense"), 0),
    taxes: selected.reduce((sum, item) => sum + consequenceValue(item, "taxCash"), 0),
    sourceConsequenceIds: state.eventSourceConsequenceIds,
  };
}

function consequenceBlockers(timeline: CanonicalTimeline): ScenarioBlocker[] {
  const result: ScenarioBlocker[] = [];
  for (const event of timeline.events) {
    for (const item of event.blockers) {
      result.push(blocker(item, item, { eventId: event.id, blocking: false }));
    }
  }
  for (const item of timeline.monthlyConsequences) {
    for (const code of item.blockers) {
      result.push(blocker(code, code, { eventId: item.sourceEventId, blocking: false }));
    }
    if (item.status === "NOT_COMPUTABLE") {
      result.push(
        blocker("PARTIAL_CONSEQUENCE", `Conséquence non calculable : ${item.id}`, {
          eventId: item.sourceEventId,
          blocking: false,
        }),
      );
    }
  }
  return result;
}

function completenessOf(blockers: ScenarioBlocker[]): ScenarioCompleteness {
  if (blockers.some((item) => item.blocking)) return "NOT_COMPUTABLE";
  return blockers.length ? "PARTIAL" : "READY";
}

function pathFrom(input: {
  scenarioId: string | null;
  scenarioVersion: number | null;
  asOfDate: string;
  horizonMonths: number;
  opening: OpeningBalanceSheet;
  timeline: CanonicalTimeline;
  market: ScenarioMarketModel;
  investmentAllocationRate: number;
  reportingCurrency: string;
  blockers?: ScenarioBlocker[];
}): ScenarioPath {
  const model = runDeterministicEventModel({
    opening: input.opening,
    consequences: input.timeline.monthlyConsequences,
    reportingCurrency: input.reportingCurrency,
    assumptions: assumptionsForMonthlyModel(input.market, input.investmentAllocationRate),
    months: input.horizonMonths,
  });
  const blockers = [...(input.blockers ?? []), ...consequenceBlockers(input.timeline)];
  if (model.states.some((state) => state.fundingGap > 0)) {
    blockers.push(
      blocker("FUNDING_GAP", "La trajectoire requiert un financement non défini", {
        blocking: false,
      }),
    );
  }
  for (const state of model.states) {
    for (const flag of state.flags.filter(
      (item) => item.startsWith("FX_RATE_REQUIRED") || item.startsWith("CONSEQUENCE_FIELD_MISSING"),
    )) {
      blockers.push(blocker(flag.split(":")[0], flag, { blocking: false }));
    }
  }
  const uniqueBlockers = [
    ...new Map(blockers.map((item) => [JSON.stringify(item), item])).values(),
  ];
  return {
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    asOfDate: input.asOfDate,
    horizonMonths: input.horizonMonths,
    timeline: input.timeline,
    monthly: model.states.map((state) => metricFor(state, input.timeline.monthlyConsequences)),
    annual: toAnnualPoints(model),
    financialStates: model.states,
    blockers: uniqueBlockers,
    completeness: completenessOf(uniqueBlockers),
  };
}

function deltaMetric(
  baseline: ScenarioPathMetric,
  scenario: ScenarioPathMetric,
): ScenarioComparisonPoint["delta"] {
  return {
    netWorth: scenario.netWorth - baseline.netWorth,
    liquidNetWorth: scenario.liquidNetWorth - baseline.liquidNetWorth,
    cash: scenario.cash - baseline.cash,
    investmentAssets: scenario.investmentAssets - baseline.investmentAssets,
    realEstateAndBusinessAssets:
      scenario.realEstateAndBusinessAssets - baseline.realEstateAndBusinessAssets,
    debt: scenario.debt - baseline.debt,
    fundingGap: scenario.fundingGap - baseline.fundingGap,
    income: scenario.income - baseline.income,
    expenses: scenario.expenses - baseline.expenses,
    taxes: scenario.taxes - baseline.taxes,
  };
}

function describeOverlay(overlay: PersistedScenarioEventOverride): string {
  if (overlay.operation === "CANCEL") return `− ${overlay.baselineEventId ?? "événement baseline"}`;
  const event = overlay.event;
  const prefix = overlay.operation === "ADD" ? "+" : "↻";
  return `${prefix} ${event?.effectiveDate ?? "date inconnue"} ${event?.type ?? "événement incomplet"}`;
}

export function buildBaselineReference(input: {
  opening: OpeningBalanceSheet;
  timeline: CanonicalTimeline;
}): ScenarioBaselineReference {
  return {
    kind: "CANONICAL_AS_OF",
    asOfDate: input.opening.date,
    openingFingerprint: scenarioFingerprint(input.opening),
    eventSetVersion: scenarioFingerprint(input.timeline.events),
    eventIds: input.timeline.events.map((event) => event.id),
  };
}

/** Baseline et scénario utilisent strictement la même grille et la même transition. */
export function runScenarioComparison(input: {
  baselineEvents: CanonicalEvent[];
  opening: OpeningBalanceSheet;
  definition: ScenarioVersionDefinition;
  reportingCurrency?: string;
  baselineMarket?: ScenarioMarketModel;
  baselineInvestmentAllocationRate?: number;
}): ScenarioComparison {
  if (input.definition.asOfDate !== input.opening.date) {
    const blocked = blocker(
      "BASELINE_UNAVAILABLE",
      `Le bilan ouvre au ${input.opening.date}, pas au cut-off ${input.definition.asOfDate}`,
      { blocking: true },
    );
    const emptyTimeline = buildCanonicalTimeline({
      events: [],
      startDate: input.definition.asOfDate,
      endDate: endDate(input.definition.asOfDate, input.definition.horizonMonths),
    });
    const empty = pathFrom({
      scenarioId: null,
      scenarioVersion: null,
      asOfDate: input.definition.asOfDate,
      horizonMonths: input.definition.horizonMonths,
      opening: { ...input.opening, date: input.definition.asOfDate },
      timeline: emptyTimeline,
      market: ZERO_MARKET,
      investmentAllocationRate: 0,
      reportingCurrency: input.reportingCurrency ?? "EUR",
      blockers: [blocked],
    });
    return {
      baseline: empty,
      scenario: {
        ...empty,
        scenarioId: input.definition.scenarioId,
        scenarioVersion: input.definition.version,
      },
      points: empty.monthly.map((metric) => ({
        monthIndex: metric.monthIndex,
        date: metric.date,
        baseline: metric,
        scenario: metric,
        delta: deltaMetric(metric, metric),
      })),
      assumptions: input.definition.assumptions,
      blockers: [blocked],
      completeness: "NOT_COMPUTABLE",
      humanDiff: input.definition.overrides.map(describeOverlay),
    };
  }

  const prepared = prepareScenarioTimeline({
    baselineEvents: input.baselineEvents,
    definition: input.definition,
  });
  const reportingCurrency = input.reportingCurrency ?? "EUR";
  const baseline = pathFrom({
    scenarioId: null,
    scenarioVersion: null,
    asOfDate: input.definition.asOfDate,
    horizonMonths: input.definition.horizonMonths,
    opening: input.opening,
    timeline: prepared.baseline,
    market: input.baselineMarket ?? ZERO_MARKET,
    investmentAllocationRate: input.baselineInvestmentAllocationRate ?? 0,
    reportingCurrency,
  });
  const scenario = pathFrom({
    scenarioId: input.definition.scenarioId,
    scenarioVersion: input.definition.version,
    asOfDate: input.definition.asOfDate,
    horizonMonths: input.definition.horizonMonths,
    opening: input.opening,
    timeline: prepared.scenario,
    market: input.definition.market,
    investmentAllocationRate: input.definition.capitalAllocation.investmentAllocationRate,
    reportingCurrency,
    blockers: prepared.blockers,
  });
  const points = baseline.monthly.map((baselinePoint, index) => {
    const scenarioPoint = scenario.monthly[index];
    if (!scenarioPoint) throw new Error(`Grille scenario absente au mois ${index}`);
    return {
      monthIndex: baselinePoint.monthIndex,
      date: baselinePoint.date,
      baseline: baselinePoint,
      scenario: scenarioPoint,
      delta: deltaMetric(baselinePoint, scenarioPoint),
    };
  });
  const blockers = [...prepared.blockers, ...scenario.blockers];
  return {
    baseline,
    scenario,
    points,
    assumptions: input.definition.assumptions,
    blockers,
    completeness: completenessOf(blockers),
    humanDiff: input.definition.overrides.map(describeOverlay),
  };
}

/** Compatibilité explicite : les paramètres plats deviennent une version V2 sourcée. */
export function legacyScenarioDefinition(
  scenario: Scenario,
  asOfDate: string,
  horizonMonths: number,
  createdAt = `${asOfDate}T00:00:00.000Z`,
): ScenarioVersionDefinition {
  const assumptions: ScenarioAssumptionV2[] = [
    ["portfolio.annual_return", "Rendement portefeuille", scenario.annualReturn, "ratio"],
    ["portfolio.annual_volatility", "Volatilité portefeuille", scenario.annualVolatility, "ratio"],
    ["economy.annual_inflation", "Inflation annuelle", scenario.annualInflation, "ratio"],
    ["cash_flow.legacy_monthly_surplus", "Surplus mensuel legacy", scenario.monthlySavings, "EUR"],
  ].map(([key, label, value, unit]) => ({
    key: String(key),
    label: String(label),
    value: Number(value),
    unit: String(unit),
    currency: unit === "EUR" ? "EUR" : null,
    effectiveDate: asOfDate,
    kind: "USER_ASSUMPTION" as const,
    source: "Scenarios V1 compatibility",
  }));
  return {
    schemaVersion: SCENARIO_V2_SCHEMA_VERSION,
    methodologyVersion: SCENARIO_METHODOLOGY_VERSION,
    scenarioId: scenario.id,
    version: scenario.version,
    asOfDate,
    horizonMonths,
    lifecycleStatus: "ACTIVE",
    overrides: [],
    assumptions,
    market: {
      annualReturn: scenario.annualReturn,
      annualVolatility: scenario.annualVolatility,
      annualInflation: scenario.annualInflation,
      stressProbability: scenario.stressProbability,
      shockYear: scenario.shockYear,
      shockMagnitude: scenario.shockMagnitude,
      randomVariables: ["PORTFOLIO_RETURN"],
    },
    capitalAllocation: {
      investmentAllocationRate: scenario.investmentAllocationRate,
      source: "LEGACY_COMPATIBILITY",
    },
    createdAt,
    legacyCompatibility: {
      monthlySavings: scenario.monthlySavings,
      salaryGrowth: scenario.salaryGrowth,
    },
  };
}

export function createScenarioVersion(input: {
  scenarioId: string;
  version?: number;
  asOfDate: string;
  horizonMonths?: number;
  overrides?: PersistedScenarioEventOverride[];
  assumptions?: ScenarioAssumptionV2[];
  market?: Partial<ScenarioMarketModel>;
  investmentAllocationRate?: number;
  createdAt?: string;
}): ScenarioVersionDefinition {
  return {
    schemaVersion: SCENARIO_V2_SCHEMA_VERSION,
    methodologyVersion: SCENARIO_METHODOLOGY_VERSION,
    scenarioId: input.scenarioId,
    version: input.version ?? 1,
    asOfDate: input.asOfDate,
    horizonMonths: input.horizonMonths ?? 40 * 12,
    lifecycleStatus: "DRAFT",
    overrides: input.overrides ?? [],
    assumptions: input.assumptions ?? [],
    market: { ...ZERO_MARKET, ...input.market },
    capitalAllocation: {
      investmentAllocationRate: input.investmentAllocationRate ?? 0,
      source: "EXPLICIT",
    },
    createdAt: input.createdAt ?? `${input.asOfDate}T00:00:00.000Z`,
    legacyCompatibility: null,
  };
}

export function isScenarioVersionDefinition(value: unknown): value is ScenarioVersionDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScenarioVersionDefinition>;
  const market = candidate.market as Partial<ScenarioMarketModel> | undefined;
  const allocation = candidate.capitalAllocation as
    Partial<ScenarioVersionDefinition["capitalAllocation"]> | undefined;
  const finiteOrNull = (item: unknown) =>
    item === null || (typeof item === "number" && Number.isFinite(item));
  return (
    candidate.schemaVersion === SCENARIO_V2_SCHEMA_VERSION &&
    candidate.methodologyVersion === SCENARIO_METHODOLOGY_VERSION &&
    typeof candidate.scenarioId === "string" &&
    Number.isInteger(candidate.version) &&
    typeof candidate.asOfDate === "string" &&
    Number.isInteger(candidate.horizonMonths) &&
    (candidate.horizonMonths ?? 0) >= 1 &&
    (candidate.horizonMonths ?? 0) <= 960 &&
    ["DRAFT", "ACTIVE", "ARCHIVED"].includes(candidate.lifecycleStatus ?? "") &&
    Array.isArray(candidate.overrides) &&
    candidate.overrides.every(
      (override) =>
        Boolean(override) &&
        typeof override.id === "string" &&
        ["ADD", "REPLACE", "CANCEL"].includes(override.operation) &&
        typeof override.reason === "string",
    ) &&
    Array.isArray(candidate.assumptions) &&
    candidate.assumptions.every(
      (assumption) =>
        Boolean(assumption) &&
        typeof assumption.key === "string" &&
        typeof assumption.source === "string" &&
        ["OBSERVED_MARKET_DATA", "USER_ASSUMPTION", "MODEL_ASSUMPTION"].includes(assumption.kind),
    ) &&
    Boolean(market) &&
    finiteOrNull(market?.annualReturn) &&
    finiteOrNull(market?.annualVolatility) &&
    finiteOrNull(market?.annualInflation) &&
    finiteOrNull(market?.stressProbability) &&
    Boolean(allocation) &&
    typeof allocation?.investmentAllocationRate === "number" &&
    Number.isFinite(allocation.investmentAllocationRate)
  );
}
