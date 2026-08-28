import type {
  CanonicalEvent,
  CanonicalMonthlyConsequence,
  CanonicalTimeline,
  ConsequenceReconciliation,
  EventConflict,
  ScenarioEventOverride,
} from "@/lib/engine/event-contracts";

const STATE_CHANGE_TYPES = new Set([
  "EMPLOYMENT_START",
  "EMPLOYMENT_END",
  "COMPENSATION_CHANGE",
  "TAX_RULE_CHANGE",
  "TAX_PROFILE_CHANGE",
  "WITHHOLDING_CHANGE",
  "RATE_CHANGE",
  "PAYMENT_CHANGE",
  "DEFERRAL_START",
  "DEFERRAL_END",
  "LOAN_START",
  "LOAN_END",
  "LEASE_START",
  "LEASE_END",
  "RENT_CHANGE",
  "VACANCY_START",
  "VACANCY_END",
  "INSURANCE_CHANGE",
  "OWNERSHIP_CHANGE",
]);

const DOMAIN_ORDER: Record<CanonicalEvent["domain"], number> = {
  CAREER: 10,
  REAL_ESTATE: 20,
  BUSINESS: 30,
  PORTFOLIO: 40,
  DEBT: 50,
  TAX: 60,
  CASH_FLOW: 70,
  PERSONAL: 80,
};

function phaseOf(event: CanonicalEvent): number {
  if (event.shape === "STATE_CHANGE" || STATE_CHANGE_TYPES.has(event.type)) return 10;
  if (event.domain === "TAX") return 30;
  if (event.consequences.length > 0) return 40;
  return 20;
}

/** Ordre total stable : phase métier → domaine → séquence → identité métier. */
export function compareCanonicalEvents(left: CanonicalEvent, right: CanonicalEvent): number {
  return (
    left.effectiveDate.localeCompare(right.effectiveDate) ||
    phaseOf(left) - phaseOf(right) ||
    DOMAIN_ORDER[left.domain] - DOMAIN_ORDER[right.domain] ||
    left.sequence - right.sequence ||
    left.type.localeCompare(right.type) ||
    (left.target.entityId ?? "").localeCompare(right.target.entityId ?? "") ||
    left.id.localeCompare(right.id)
  );
}

function compareConsequences(
  left: CanonicalMonthlyConsequence,
  right: CanonicalMonthlyConsequence,
): number {
  return (
    left.economicDate.localeCompare(right.economicDate) ||
    DOMAIN_ORDER[left.sourceDomain] - DOMAIN_ORDER[right.sourceDomain] ||
    left.eventType.localeCompare(right.eventType) ||
    left.sourceEventId.localeCompare(right.sourceEventId) ||
    left.id.localeCompare(right.id)
  );
}

function signedCash(item: CanonicalMonthlyConsequence): number | null {
  if (item.cashIn === null || item.cashOut === null) return null;
  return item.cashIn - item.cashOut;
}

function sumKnown(values: Array<number | null>): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function reconciliationGroup(item: CanonicalMonthlyConsequence): string | null {
  return item.reconciliationKey
    ? `${item.reconciliationKey}|${item.month}|${item.currency.toUpperCase()}`
    : null;
}

/**
 * L'observé remplace les grandeurs de flux que l'observation porte réellement, sans
 * effacer les composantes explicatives absentes de la banque (principal/intérêt, brut,
 * liability delta). On garde donc deux lignes rapprochées, jamais deux cash-flows.
 */
export function reconcileMonthlyConsequences(input: CanonicalMonthlyConsequence[]): {
  consequences: CanonicalMonthlyConsequence[];
  reconciliations: ConsequenceReconciliation[];
} {
  const groups = new Map<string, CanonicalMonthlyConsequence[]>();
  for (const item of input) {
    const key = reconciliationGroup(item);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const replacements = new Map<string, CanonicalMonthlyConsequence>();
  const reconciliations: ConsequenceReconciliation[] = [];
  for (const [groupKey, items] of groups) {
    const actual = items.filter((item) => item.recognition === "ACTUAL" && item.included);
    const expected = items.filter((item) => item.recognition === "EXPECTED" && item.included);
    if (!actual.length || !expected.length) continue;
    const actualHas = (field: keyof CanonicalMonthlyConsequence) =>
      actual.some(
        (item) =>
          typeof item[field] === "number" &&
          (item[field] !== 0 || item.effectKind === "OPERATING" || item.effectKind === "TAX"),
      );
    for (const item of expected) {
      replacements.set(item.id, {
        ...item,
        cashIn: 0,
        cashOut: 0,
        income: actualHas("income") ? 0 : item.income,
        expense: actualHas("expense") ? 0 : item.expense,
        taxLiability: actualHas("taxLiability") ? 0 : item.taxLiability,
        taxCash: actualHas("taxCash") ? 0 : item.taxCash,
        flags: [...new Set([...item.flags, "ACTUAL_OVERRIDES_FORECAST"])],
      });
    }
    const expectedCash = sumKnown(expected.map(signedCash));
    const actualCash = sumKnown(actual.map(signedCash));
    const [key, month, currency] = groupKey.split("|").slice(-3);
    reconciliations.push({
      key,
      month,
      currency,
      expectedConsequenceIds: expected.map((item) => item.id),
      actualConsequenceIds: actual.map((item) => item.id),
      expectedCash,
      actualCash,
      variance: expectedCash === null || actualCash === null ? null : actualCash - expectedCash,
    });
  }
  return {
    consequences: input
      .map((item) => replacements.get(item.id) ?? item)
      .filter((item) => item.included)
      .sort(compareConsequences),
    reconciliations: reconciliations.sort(
      (left, right) => left.month.localeCompare(right.month) || left.key.localeCompare(right.key),
    ),
  };
}

function stateConflictKey(event: CanonicalEvent): string | null {
  if (event.shape !== "STATE_CHANGE" && !STATE_CHANGE_TYPES.has(event.type)) return null;
  return [
    event.effectiveDate,
    event.domain,
    event.target.entityType,
    event.target.entityId,
    event.type,
  ]
    .map((value) => value ?? "")
    .join("|");
}

export function detectEventConflicts(events: CanonicalEvent[]): EventConflict[] {
  const conflicts: EventConflict[] = [];
  const byId = new Map(events.map((event) => [event.id, event]));
  const stateGroups = new Map<string, CanonicalEvent[]>();
  for (const event of events) {
    if (event.status === "CANCELLED" || event.status === "SUPERSEDED") continue;
    const key = stateConflictKey(event);
    if (key) stateGroups.set(key, [...(stateGroups.get(key) ?? []), event]);
    if (event.supersededBy && !byId.has(event.supersededBy)) {
      conflicts.push({
        key: event.id,
        eventIds: [event.id, event.supersededBy],
        reason: "MISSING_SUPERSEDED_EVENT",
      });
    }
  }
  for (const [key, group] of stateGroups) {
    if (group.length > 1) {
      conflicts.push({
        key,
        eventIds: group.map((event) => event.id).sort(),
        reason: "SAME_DAY_STATE_CHANGE",
      });
    }
  }
  for (const event of events) {
    const seen = new Set<string>();
    let cursor: CanonicalEvent | undefined = event;
    while (cursor?.supersededBy) {
      if (seen.has(cursor.id)) {
        conflicts.push({
          key: event.id,
          eventIds: [...seen].sort(),
          reason: "SUPERSESSION_CYCLE",
        });
        break;
      }
      seen.add(cursor.id);
      cursor = byId.get(cursor.supersededBy);
    }
  }
  return conflicts.sort((left, right) => left.key.localeCompare(right.key));
}

/** Baseline + overrides, sans jamais muter ni confondre la timeline réelle et le scénario. */
export function applyScenarioOverrides(
  baseline: CanonicalEvent[],
  overrides: ScenarioEventOverride[],
  scenarioId: string,
): CanonicalEvent[] {
  const events = new Map(baseline.map((event) => [event.id, { ...event }]));
  for (const override of overrides.filter((item) => item.scenarioId === scenarioId)) {
    if (override.operation === "ADD") {
      events.set(override.event.id, { ...override.event, scenarioId });
      continue;
    }
    const baselineEvent = events.get(override.baselineEventId);
    if (!baselineEvent) continue;
    if (override.operation === "CANCEL") {
      events.set(baselineEvent.id, {
        ...baselineEvent,
        status: "CANCELLED",
        scenarioId,
        consequences: [],
      });
      continue;
    }
    events.set(baselineEvent.id, {
      ...baselineEvent,
      status: "SUPERSEDED",
      supersededBy: override.event.id,
      scenarioId,
      consequences: [],
    });
    events.set(override.event.id, { ...override.event, scenarioId });
  }
  return [...events.values()].sort(compareCanonicalEvents);
}

export function buildCanonicalTimeline(input: {
  events: CanonicalEvent[];
  startDate: string;
  endDate: string;
}): CanonicalTimeline {
  const events = input.events
    .filter(
      (event) =>
        event.effectiveDate <= input.endDate &&
        (event.effectiveDate >= input.startDate || event.shape === "STATE_CHANGE"),
    )
    .sort(compareCanonicalEvents);
  const rawConsequences = events
    .filter((event) => event.status !== "CANCELLED" && event.status !== "SUPERSEDED")
    .flatMap((event) => event.consequences)
    .filter((item) => item.economicDate >= input.startDate && item.economicDate <= input.endDate)
    .sort(compareConsequences);
  const reconciled = reconcileMonthlyConsequences(rawConsequences);
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    events,
    rawConsequences,
    monthlyConsequences: reconciled.consequences,
    reconciliations: reconciled.reconciliations,
    conflicts: detectEventConflicts(events),
  };
}

export interface MonthlyEventImpact {
  month: string;
  operatingSurplus: number;
  debt: {
    cashImpact: number;
    liabilityDelta: number;
    principalMovement: number;
    economicCost: number;
    principal: number;
    interest: number;
    capitalisedInterest: number;
    insurance: number;
    fees: number;
    capitalisedCharges: number;
    totalCashOut: number;
  };
  capitalCashImpact: number;
  portfolioAssetDelta: number;
  nonFinancialAssetDelta: number;
  otherLiabilityDelta: number;
  blockers: string[];
  sourceConsequenceIds: string[];
}

/**
 * Pont unique Event Engine → Monthly Model. Il ne convertit aucune devise et n'additionne
 * que des grandeurs compatibles, après rapprochement actual/forecast.
 */
export function monthlyEventImpact(
  consequences: CanonicalMonthlyConsequence[],
  month: string,
  reportingCurrency: string,
): MonthlyEventImpact {
  const selected = consequences.filter((item) => item.month === month && item.included);
  const blockers = selected.flatMap((item) => item.blockers);
  const applicable = selected.filter((item) => {
    if (item.currency.toUpperCase() === reportingCurrency.toUpperCase()) return true;
    blockers.push(`FX_RATE_REQUIRED:${item.currency}:${reportingCurrency}:${item.economicDate}`);
    return false;
  });
  const value = (
    item: CanonicalMonthlyConsequence,
    field:
      | "cashIn"
      | "cashOut"
      | "assetDelta"
      | "liabilityDelta"
      | "economicCost"
      | "debtPrincipal"
      | "debtInterest"
      | "fees",
  ) => {
    const amount = item[field];
    if (amount === null) {
      blockers.push(`CONSEQUENCE_FIELD_MISSING:${item.id}:${field}`);
      return 0;
    }
    return amount;
  };
  const operating = applicable.filter(
    (item) => item.effectKind === "OPERATING" || item.effectKind === "TAX",
  );
  const debt = applicable.filter((item) => item.effectKind === "DEBT_SERVICE");
  const capital = applicable.filter(
    (item) => item.effectKind === "CAPITAL_MOVEMENT" || item.effectKind === "VALUATION",
  );
  const debtCashOut = debt.reduce(
    (total, item) => total + value(item, "cashOut") - value(item, "cashIn"),
    0,
  );
  const debtPrincipal = debt.reduce((total, item) => total + value(item, "debtPrincipal"), 0);
  const debtInterest = debt.reduce((total, item) => total + value(item, "debtInterest"), 0);
  const debtFees = debt.reduce((total, item) => total + value(item, "fees"), 0);
  const debtEconomicCost = debt.reduce((total, item) => total + value(item, "economicCost"), 0);
  const debtLiabilityDelta = debt.reduce((total, item) => total + value(item, "liabilityDelta"), 0);
  return {
    month,
    operatingSurplus: operating.reduce(
      (total, item) => total + value(item, "cashIn") - value(item, "cashOut"),
      0,
    ),
    debt: {
      cashImpact: -debtCashOut,
      liabilityDelta: debtLiabilityDelta,
      principalMovement: -debtPrincipal,
      economicCost: debtEconomicCost,
      principal: debtPrincipal,
      interest: debtInterest,
      capitalisedInterest: 0,
      insurance: Math.max(0, debtEconomicCost - debtInterest - debtFees),
      fees: debtFees,
      capitalisedCharges: 0,
      totalCashOut: debtCashOut,
    },
    capitalCashImpact: capital.reduce(
      (total, item) => total + value(item, "cashIn") - value(item, "cashOut"),
      0,
    ),
    portfolioAssetDelta: capital
      .filter((item) => item.sourceDomain === "PORTFOLIO")
      .reduce((total, item) => total + value(item, "assetDelta"), 0),
    nonFinancialAssetDelta: capital
      .filter((item) => item.sourceDomain === "REAL_ESTATE" || item.sourceDomain === "BUSINESS")
      .reduce((total, item) => total + value(item, "assetDelta"), 0),
    otherLiabilityDelta: applicable
      .filter((item) => item.effectKind !== "DEBT_SERVICE")
      .reduce((total, item) => total + value(item, "liabilityDelta"), 0),
    blockers: [...new Set(blockers)],
    sourceConsequenceIds: applicable.map((item) => item.id),
  };
}

export const eventsAt = (timeline: CanonicalTimeline, date: string) =>
  timeline.events.filter((event) => event.effectiveDate === date);

export const eventsBetween = (timeline: CanonicalTimeline, start: string, end: string) =>
  timeline.events.filter((event) => event.effectiveDate >= start && event.effectiveDate <= end);

export const monthlyConsequences = (
  timeline: CanonicalTimeline,
  startMonth: string,
  endMonth: string,
) =>
  timeline.monthlyConsequences.filter((item) => item.month >= startMonth && item.month <= endMonth);

/** Dernier state change applicable par cible et type, en respectant l'ordre canonique. */
export function stateAt(timeline: CanonicalTimeline, date: string): Map<string, CanonicalEvent> {
  const result = new Map<string, CanonicalEvent>();
  for (const event of timeline.events) {
    if (event.effectiveDate > date) break;
    if (event.status === "CANCELLED" || event.status === "SUPERSEDED") continue;
    const key = stateConflictKey(event);
    if (key) result.set(key.split("|").slice(1).join("|"), event);
  }
  return result;
}
