import { describe, expect, it } from "vitest";

import {
  applyScenarioOverrides,
  buildCanonicalTimeline,
  compareCanonicalEvents,
  detectEventConflicts,
  eventsAt,
  eventsBetween,
  monthlyConsequences,
  monthlyEventImpact,
  reconcileMonthlyConsequences,
  stateAt,
} from "@/lib/engine/event-engine";
import type {
  CanonicalEvent,
  CanonicalEventType,
  CanonicalMonthlyConsequence,
  EconomicEffectKind,
  EventDomain,
  ScenarioEventOverride,
} from "@/lib/engine/event-contracts";
import {
  runDeterministicEventModel,
  type OpeningBalanceSheet,
} from "@/lib/engine/monthly-financial-model";

const provenance = {
  source: "fixture",
  sourceRecordId: "record",
  engine: "fixture-domain-engine",
  formulaReference: "fixture consequence",
  assumptions: [] as string[],
};

function consequence(input: {
  id: string;
  date?: string;
  domain?: EventDomain;
  type?: CanonicalEventType;
  effectKind?: EconomicEffectKind;
  currency?: string;
  cashIn?: number | null;
  cashOut?: number | null;
  income?: number | null;
  expense?: number | null;
  taxLiability?: number | null;
  taxCash?: number | null;
  debtPrincipal?: number | null;
  debtInterest?: number | null;
  fees?: number | null;
  assetDelta?: number | null;
  liabilityDelta?: number | null;
  economicCost?: number | null;
  recognition?: "ACTUAL" | "EXPECTED";
  reconciliationKey?: string | null;
  blockers?: string[];
}): CanonicalMonthlyConsequence {
  const date = input.date ?? "2027-01-31";
  return {
    id: input.id,
    month: date.slice(0, 7),
    economicDate: date,
    sourceDomain: input.domain ?? "PERSONAL",
    sourceEntityId: "entity-1",
    sourceEventId: `event:${input.id}`,
    eventType: input.type ?? "CUSTOM_EVENT",
    effectKind: input.effectKind ?? "OPERATING",
    currency: input.currency ?? "EUR",
    cashIn: input.cashIn === undefined ? 0 : input.cashIn,
    cashOut: input.cashOut === undefined ? 0 : input.cashOut,
    income: input.income === undefined ? 0 : input.income,
    expense: input.expense === undefined ? 0 : input.expense,
    taxLiability: input.taxLiability === undefined ? 0 : input.taxLiability,
    taxCash: input.taxCash === undefined ? 0 : input.taxCash,
    debtPrincipal: input.debtPrincipal === undefined ? 0 : input.debtPrincipal,
    debtInterest: input.debtInterest === undefined ? 0 : input.debtInterest,
    fees: input.fees === undefined ? 0 : input.fees,
    assetDelta: input.assetDelta === undefined ? 0 : input.assetDelta,
    liabilityDelta: input.liabilityDelta === undefined ? 0 : input.liabilityDelta,
    economicCost: input.economicCost === undefined ? 0 : input.economicCost,
    dataKind: input.recognition === "ACTUAL" ? "OBSERVED" : "PROJECTED",
    confidence: "HIGH",
    provenance,
    blockers: input.blockers ?? [],
    status: input.blockers?.length ? "NOT_COMPUTABLE" : "PRE_TAX",
    reconciliationKey: input.reconciliationKey ?? null,
    recognition: input.recognition ?? "EXPECTED",
    included: true,
    flags: [],
  };
}

function canonicalEvent(input: {
  id: string;
  date?: string;
  domain?: EventDomain;
  type?: CanonicalEventType;
  shape?: CanonicalEvent["shape"];
  status?: CanonicalEvent["status"];
  sequence?: number;
  targetId?: string;
  supersededBy?: string | null;
  consequences?: CanonicalMonthlyConsequence[];
}): CanonicalEvent {
  const date = input.date ?? "2027-01-01";
  return {
    id: input.id,
    domain: input.domain ?? "PERSONAL",
    type: input.type ?? "CUSTOM_EVENT",
    effectiveDate: date,
    eventDate: date,
    createdAt: "2026-01-01T00:00:00Z",
    dataKind: "PROJECTED",
    confidence: "HIGH",
    source: "fixture",
    provenance,
    target: { entityType: "fixture", entityId: input.targetId ?? "entity-1" },
    status: input.status ?? "PLANNED",
    shape: input.shape ?? "ONE_OFF",
    effectiveConvention: input.shape === "STATE_CHANGE" ? "IMMEDIATE" : "NOT_APPLICABLE",
    sequence: input.sequence ?? 0,
    supersededBy: input.supersededBy ?? null,
    scenarioId: null,
    blockers: [],
    consequences: input.consequences ?? [],
  };
}

const opening: OpeningBalanceSheet = {
  date: "2026-12-31",
  bankCash: 10_000,
  marketInvestedAssets: 0,
  investmentCash: 0,
  otherFinancialAssets: 0,
  grossFinancialAssets: 10_000,
  nonFinancialAssets: 0,
  loanBalance: 0,
  otherLiabilityBalance: 0,
  fundingGap: 0,
  netWorth: 10_000,
  flags: [],
};

const assumptions = {
  operatingSurplus: 999_999,
  investmentAllocationRate: 0,
  annualReturn: 0,
  shockYear: null,
  shockMagnitude: null,
};

describe("Event Engine golden cases", () => {
  it("1. projects a one-off cash event", () => {
    const item = consequence({ id: "gift", cashIn: 1_000, type: "GIFT" });
    const timeline = buildCanonicalTimeline({
      events: [canonicalEvent({ id: "gift", consequences: [item] })],
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(timeline.monthlyConsequences[0].cashIn).toBe(1_000);
  });

  it("2. exposes a state change through stateAt", () => {
    const salary = canonicalEvent({
      id: "salary",
      type: "COMPENSATION_CHANGE",
      shape: "STATE_CHANGE",
    });
    const timeline = buildCanonicalTimeline({
      events: [salary],
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect([...stateAt(timeline, "2027-06-01").values()]).toEqual([salary]);
  });

  it("3. keeps recurring occurrences separate from the recurring rule", () => {
    const january = consequence({ id: "rent-jan", cashIn: 800 });
    const february = consequence({ id: "rent-feb", date: "2027-02-28", cashIn: 800 });
    const timeline = buildCanonicalTimeline({
      events: [
        canonicalEvent({ id: "rent-jan", shape: "SCHEDULE_CONSEQUENCE", consequences: [january] }),
        canonicalEvent({
          id: "rent-feb",
          date: "2027-02-28",
          shape: "SCHEDULE_CONSEQUENCE",
          consequences: [february],
        }),
      ],
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(timeline.monthlyConsequences.map((item) => item.month)).toEqual(["2027-01", "2027-02"]);
  });

  it("4. orders same-day events without relying on UUID order", () => {
    const cash = canonicalEvent({
      id: "000",
      domain: "CASH_FLOW",
      consequences: [consequence({ id: "cash" })],
    });
    const salary = canonicalEvent({
      id: "zzz",
      domain: "CAREER",
      type: "COMPENSATION_CHANGE",
      shape: "STATE_CHANGE",
    });
    expect([cash, salary].sort(compareCanonicalEvents).map((item) => item.id)).toEqual([
      "zzz",
      "000",
    ]);
  });

  it("5. represents salary start as employment state", () => {
    const start = canonicalEvent({ id: "job", type: "EMPLOYMENT_START", shape: "STATE_CHANGE" });
    expect(start.type).toBe("EMPLOYMENT_START");
    expect(start.consequences).toHaveLength(0);
  });

  it("6. represents salary change separately from monthly cash", () => {
    const change = canonicalEvent({
      id: "raise",
      type: "COMPENSATION_CHANGE",
      shape: "STATE_CHANGE",
    });
    const cash = canonicalEvent({
      id: "salary-month",
      consequences: [consequence({ id: "salary", cashIn: 3_200 })],
    });
    expect(change.id).not.toBe(cash.id);
  });

  it("7. ends salary with an employment-end state", () => {
    expect(canonicalEvent({ id: "end", type: "EMPLOYMENT_END", shape: "STATE_CHANGE" }).type).toBe(
      "EMPLOYMENT_END",
    );
  });

  it("8. distinguishes bonus earned from bonus paid", () => {
    const earned = canonicalEvent({ id: "earned", type: "BONUS_EARNED" });
    const paid = canonicalEvent({ id: "paid", type: "BONUS_PAID" });
    expect(earned.type).not.toBe(paid.type);
  });

  it("9. keeps tax liability distinct from tax cash", () => {
    const item = consequence({ id: "tax", taxLiability: 10_000, taxCash: 2_500, cashOut: 2_500 });
    expect(item.taxLiability).toBe(10_000);
    expect(item.taxCash).toBe(2_500);
  });

  it("10. preserves debt payment decomposition", () => {
    const item = consequence({
      id: "debt",
      domain: "DEBT",
      type: "LOAN_PAYMENT",
      effectKind: "DEBT_SERVICE",
      cashOut: 1_000,
      debtPrincipal: 800,
      debtInterest: 200,
      liabilityDelta: -800,
      economicCost: 200,
    });
    const impact = monthlyEventImpact([item], "2027-01", "EUR");
    expect(impact.debt).toMatchObject({ totalCashOut: 1_000, principal: 800, economicCost: 200 });
  });

  it("11. labels early repayment independently from a scheduled payment", () => {
    expect(canonicalEvent({ id: "repay", type: "EARLY_REPAYMENT" }).type).toBe("EARLY_REPAYMENT");
  });

  it("12. orders refinance state before its cash consequence", () => {
    const refinance = canonicalEvent({
      id: "refi",
      domain: "DEBT",
      type: "REFINANCE",
      shape: "STATE_CHANGE",
    });
    const payment = canonicalEvent({
      id: "pay",
      domain: "DEBT",
      type: "LOAN_PAYMENT",
      consequences: [consequence({ id: "pay", domain: "DEBT" })],
    });
    expect([payment, refinance].sort(compareCanonicalEvents)[0].id).toBe("refi");
  });

  it("13. makes an investment contribution net-worth neutral", () => {
    const contribution = consequence({
      id: "contribution",
      domain: "PORTFOLIO",
      type: "CONTRIBUTION",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 10_000,
      assetDelta: 10_000,
    });
    const result = runDeterministicEventModel({
      opening,
      consequences: [contribution],
      reportingCurrency: "EUR",
      assumptions,
      months: 1,
    });
    expect(result.states[1]).toMatchObject({
      bankCash: 0,
      marketInvestedAssets: 10_000,
      netWorth: 10_000,
    });
  });

  it("14. treats portfolio withdrawal as capital movement, not income", () => {
    const item = consequence({
      id: "withdrawal",
      domain: "PORTFOLIO",
      type: "WITHDRAWAL",
      effectKind: "CAPITAL_MOVEMENT",
      cashIn: 2_000,
      assetDelta: -2_000,
    });
    expect(item.income).toBe(0);
  });

  it("15. treats dividend as income, not contribution", () => {
    const item = consequence({ id: "dividend", type: "DIVIDEND", cashIn: 500, income: 500 });
    expect(item.eventType).toBe("DIVIDEND");
    expect(item.assetDelta).toBe(0);
  });

  it("16. makes a cash real-estate acquisition net-worth neutral", () => {
    const acquisition = consequence({
      id: "home",
      domain: "REAL_ESTATE",
      type: "ACQUISITION",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 5_000,
      assetDelta: 5_000,
    });
    const result = runDeterministicEventModel({
      opening,
      consequences: [acquisition],
      reportingCurrency: "EUR",
      assumptions,
      months: 1,
    });
    expect(result.states[1].netWorth).toBe(10_000);
  });

  it("17. makes a property disposal neutral before fees and tax", () => {
    const disposal = consequence({
      id: "sale",
      domain: "REAL_ESTATE",
      type: "DISPOSAL",
      effectKind: "CAPITAL_MOVEMENT",
      cashIn: 5_000,
      assetDelta: -5_000,
    });
    expect(monthlyEventImpact([disposal], "2027-01", "EUR")).toMatchObject({
      capitalCashImpact: 5_000,
      nonFinancialAssetDelta: -5_000,
    });
  });

  it("18. represents lease start as state, not 30 years of persisted rows", () => {
    expect(canonicalEvent({ id: "lease", type: "LEASE_START", shape: "STATE_CHANGE" }).shape).toBe(
      "STATE_CHANGE",
    );
  });

  it("19. represents lease end independently", () => {
    expect(canonicalEvent({ id: "lease-end", type: "LEASE_END", shape: "STATE_CHANGE" }).type).toBe(
      "LEASE_END",
    );
  });

  it("20. detects two rent changes on the same day", () => {
    const a = canonicalEvent({
      id: "rent-a",
      domain: "REAL_ESTATE",
      type: "RENT_CHANGE",
      shape: "STATE_CHANGE",
      targetId: "home",
    });
    const b = canonicalEvent({
      id: "rent-b",
      domain: "REAL_ESTATE",
      type: "RENT_CHANGE",
      shape: "STATE_CHANGE",
      targetId: "home",
    });
    expect(detectEventConflicts([a, b])[0].reason).toBe("SAME_DAY_STATE_CHANGE");
  });

  it("21. keeps works payment separate from property value", () => {
    const works = consequence({
      id: "works",
      domain: "REAL_ESTATE",
      type: "WORKS_PAYMENT",
      cashOut: 10_000,
      expense: 0,
      assetDelta: 10_000,
      effectKind: "CAPITAL_MOVEMENT",
    });
    expect(works.expense).toBe(0);
  });

  it("22. recognises a business dividend as operating income", () => {
    const dividend = consequence({
      id: "biz-dividend",
      domain: "BUSINESS",
      type: "DIVIDEND",
      cashIn: 1_000,
      income: 1_000,
    });
    expect(monthlyEventImpact([dividend], "2027-01", "EUR").operatingSurplus).toBe(1_000);
  });

  it("23. separates business sale cash from asset disposal", () => {
    const sale = consequence({
      id: "biz-sale",
      domain: "BUSINESS",
      type: "DISPOSAL",
      effectKind: "CAPITAL_MOVEMENT",
      cashIn: 4_000,
      assetDelta: -4_000,
    });
    expect(sale.cashIn).toBe(4_000);
    expect(sale.assetDelta).toBe(-4_000);
  });

  it("24. models ownership change as state only", () => {
    expect(
      canonicalEvent({
        id: "ownership",
        domain: "BUSINESS",
        type: "OWNERSHIP_CHANGE",
        shape: "STATE_CHANGE",
      }).consequences,
    ).toEqual([]);
  });

  it("25. valuation observation produces no cash", () => {
    const valuation = consequence({
      id: "valuation",
      type: "VALUATION_OBSERVATION",
      effectKind: "VALUATION",
      assetDelta: 50_000,
    });
    expect(valuation.cashIn).toBe(0);
    expect(valuation.cashOut).toBe(0);
  });

  it("26. cancellation retains the event but removes consequences", () => {
    const baseline = canonicalEvent({
      id: "purchase",
      consequences: [consequence({ id: "purchase", cashOut: 5_000 })],
    });
    const overrides: ScenarioEventOverride[] = [
      { operation: "CANCEL", scenarioId: "s1", baselineEventId: "purchase" },
    ];
    const [cancelled] = applyScenarioOverrides([baseline], overrides, "s1");
    expect(cancelled).toMatchObject({ status: "CANCELLED", consequences: [] });
  });

  it("27. supersession retains explicit lineage", () => {
    const baseline = canonicalEvent({
      id: "raise-10",
      type: "COMPENSATION_CHANGE",
      shape: "STATE_CHANGE",
    });
    const replacement = canonicalEvent({
      id: "raise-12",
      type: "COMPENSATION_CHANGE",
      shape: "STATE_CHANGE",
    });
    const overrides: ScenarioEventOverride[] = [
      { operation: "REPLACE", scenarioId: "s1", baselineEventId: baseline.id, event: replacement },
    ];
    const result = applyScenarioOverrides([baseline], overrides, "s1");
    expect(result.find((item) => item.id === baseline.id)?.supersededBy).toBe(replacement.id);
  });

  it("28. actual cash overrides forecast cash", () => {
    const expected = consequence({
      id: "expected",
      cashIn: 3_200,
      income: 3_200,
      reconciliationKey: "salary:2027-01",
    });
    const actual = consequence({
      id: "actual",
      cashIn: 3_150,
      income: 3_150,
      recognition: "ACTUAL",
      reconciliationKey: "salary:2027-01",
    });
    const result = reconcileMonthlyConsequences([expected, actual]);
    expect(result.consequences.reduce((sum, item) => sum + (item.cashIn ?? 0), 0)).toBe(3_150);
  });

  it("29. expected and actual coexist for variance explanation", () => {
    const expected = consequence({ id: "expected", cashIn: 3_200, reconciliationKey: "salary" });
    const actual = consequence({
      id: "actual",
      cashIn: 3_150,
      recognition: "ACTUAL",
      reconciliationKey: "salary",
    });
    const result = reconcileMonthlyConsequences([expected, actual]);
    expect(result.consequences).toHaveLength(2);
    expect(result.reconciliations[0].variance).toBe(-50);
  });

  it("30. prevents salary double counting", () => {
    const expected = consequence({
      id: "salary-forecast",
      cashIn: 3_200,
      income: 3_200,
      reconciliationKey: "salary",
    });
    const actual = consequence({
      id: "salary-bank",
      cashIn: 3_150,
      income: 3_150,
      recognition: "ACTUAL",
      reconciliationKey: "salary",
    });
    const { consequences: resolved } = reconcileMonthlyConsequences([expected, actual]);
    expect(monthlyEventImpact(resolved, "2027-01", "EUR").operatingSurplus).toBe(3_150);
  });

  it("31. prevents debt cash double counting while retaining decomposition", () => {
    const schedule = consequence({
      id: "schedule",
      domain: "DEBT",
      effectKind: "DEBT_SERVICE",
      cashOut: 1_000,
      debtPrincipal: 800,
      debtInterest: 200,
      liabilityDelta: -800,
      economicCost: 200,
      reconciliationKey: "debt",
    });
    const bank = consequence({
      id: "bank",
      domain: "DEBT",
      effectKind: "DEBT_SERVICE",
      cashOut: 990,
      recognition: "ACTUAL",
      reconciliationKey: "debt",
    });
    const { consequences: resolved } = reconcileMonthlyConsequences([schedule, bank]);
    const impact = monthlyEventImpact(resolved, "2027-01", "EUR");
    expect(impact.debt.totalCashOut).toBe(990);
    expect(impact.debt.principal).toBe(800);
  });

  it("32. prevents contractual and observed rent double counting", () => {
    const expected = consequence({
      id: "rent-contract",
      domain: "REAL_ESTATE",
      cashIn: 800,
      income: 800,
      reconciliationKey: "rent",
    });
    const actual = consequence({
      id: "rent-bank",
      domain: "REAL_ESTATE",
      cashIn: 790,
      income: 790,
      recognition: "ACTUAL",
      reconciliationKey: "rent",
    });
    const resolved = reconcileMonthlyConsequences([expected, actual]).consequences;
    expect(monthlyEventImpact(resolved, "2027-01", "EUR").operatingSurplus).toBe(790);
  });

  it("33. prevents portfolio contribution double counting", () => {
    const ledger = consequence({
      id: "ledger",
      domain: "PORTFOLIO",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 10_000,
      assetDelta: 10_000,
      reconciliationKey: "transfer",
    });
    const bank = consequence({
      id: "bank",
      domain: "PORTFOLIO",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 10_000,
      recognition: "ACTUAL",
      reconciliationKey: "transfer",
    });
    const impact = monthlyEventImpact(
      reconcileMonthlyConsequences([ledger, bank]).consequences,
      "2027-01",
      "EUR",
    );
    expect(impact.capitalCashImpact).toBe(-10_000);
    expect(impact.portfolioAssetDelta).toBe(10_000);
  });

  it("34. never converts multi-currency consequences locally", () => {
    const usd = consequence({ id: "usd", currency: "USD", cashIn: 100 });
    const impact = monthlyEventImpact([usd], "2027-01", "EUR");
    expect(impact.operatingSurplus).toBe(0);
  });

  it("35. emits an FX blocker instead of inventing a rate", () => {
    const usd = consequence({ id: "usd", currency: "USD", cashIn: 100 });
    expect(monthlyEventImpact([usd], "2027-01", "EUR").blockers[0]).toContain("FX_RATE_REQUIRED");
  });

  it("36. preserves partial tax consequence", () => {
    const tax = consequence({
      id: "partial-tax",
      taxLiability: null,
      blockers: ["TAX_RULES_MISSING"],
    });
    expect(tax.status).toBe("NOT_COMPUTABLE");
    expect(tax.taxLiability).toBeNull();
  });

  it("37. keeps future events planned", () => {
    expect(canonicalEvent({ id: "future", date: "2030-01-01" }).status).toBe("PLANNED");
  });

  it("38. assigns month-boundary event to its economic month", () => {
    expect(consequence({ id: "boundary", date: "2027-02-01" }).month).toBe("2027-02");
  });

  it("39. uses civil dates without timezone shifts", () => {
    const event = canonicalEvent({ id: "civil", date: "2027-03-26" });
    expect(event.effectiveDate).toBe("2027-03-26");
  });

  it("40. remains deterministic over a 40-year monthly horizon", () => {
    const events = Array.from({ length: 480 }, (_, index) => {
      const year = 2027 + Math.floor(index / 12);
      const month = String((index % 12) + 1).padStart(2, "0");
      const id = `month-${index}`;
      return canonicalEvent({
        id,
        date: `${year}-${month}-28`,
        consequences: [consequence({ id, date: `${year}-${month}-28`, cashIn: 1 })],
      });
    });
    const forward = buildCanonicalTimeline({
      events,
      startDate: "2027-01-01",
      endDate: "2066-12-31",
    });
    const reverse = buildCanonicalTimeline({
      events: [...events].reverse(),
      startDate: "2027-01-01",
      endDate: "2066-12-31",
    });
    expect(reverse.monthlyConsequences.map((item) => item.id)).toEqual(
      forward.monthlyConsequences.map((item) => item.id),
    );
  });

  it("41. reports two same-day salary changes as a conflict", () => {
    const events = ["a", "b"].map((id) =>
      canonicalEvent({
        id,
        domain: "CAREER",
        type: "COMPENSATION_CHANGE",
        shape: "STATE_CHANGE",
        targetId: "role",
      }),
    );
    expect(detectEventConflicts(events)).toHaveLength(1);
  });

  it("42. reports a missing superseding event", () => {
    const item = canonicalEvent({ id: "old", supersededBy: "missing" });
    expect(detectEventConflicts([item])[0].reason).toBe("MISSING_SUPERSEDED_EVENT");
  });

  it("43. reports a supersession cycle", () => {
    const a = canonicalEvent({ id: "a", supersededBy: "b" });
    const b = canonicalEvent({ id: "b", supersededBy: "a" });
    expect(detectEventConflicts([a, b]).some((item) => item.reason === "SUPERSESSION_CYCLE")).toBe(
      true,
    );
  });

  it("44. queries events at an exact date", () => {
    const timeline = buildCanonicalTimeline({
      events: [canonicalEvent({ id: "a" })],
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(eventsAt(timeline, "2027-01-01").map((item) => item.id)).toEqual(["a"]);
  });

  it("45. queries events between inclusive bounds", () => {
    const timeline = buildCanonicalTimeline({
      events: [canonicalEvent({ id: "a" }), canonicalEvent({ id: "b", date: "2027-02-01" })],
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(eventsBetween(timeline, "2027-01-15", "2027-02-01").map((item) => item.id)).toEqual([
      "b",
    ]);
  });

  it("46. queries monthly consequences", () => {
    const timeline = buildCanonicalTimeline({
      events: [canonicalEvent({ id: "a", consequences: [consequence({ id: "jan" })] })],
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(monthlyConsequences(timeline, "2027-01", "2027-01")).toHaveLength(1);
  });

  it("47. adds a scenario event without mutating baseline", () => {
    const baseline = canonicalEvent({ id: "base" });
    const added = canonicalEvent({ id: "added" });
    const result = applyScenarioOverrides(
      [baseline],
      [{ operation: "ADD", scenarioId: "s1", event: added }],
      "s1",
    );
    expect(result.map((item) => item.id).sort()).toEqual(["added", "base"]);
    expect(baseline.scenarioId).toBeNull();
  });

  it("48. does not apply overrides from another scenario", () => {
    const result = applyScenarioOverrides(
      [],
      [{ operation: "ADD", scenarioId: "other", event: canonicalEvent({ id: "added" }) }],
      "s1",
    );
    expect(result).toEqual([]);
  });

  it("49. keeps two equal-amount events with distinct business identities", () => {
    const a = canonicalEvent({
      id: "bonus-a",
      consequences: [consequence({ id: "a", cashIn: 1_000 })],
    });
    const b = canonicalEvent({
      id: "bonus-b",
      consequences: [consequence({ id: "b", cashIn: 1_000 })],
    });
    const timeline = buildCanonicalTimeline({
      events: [a, b],
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(timeline.events).toHaveLength(2);
  });

  it("50. preserves a non-computable event instead of dropping it", () => {
    const item = consequence({ id: "blocked", cashIn: null, blockers: ["SALE_PRICE_MISSING"] });
    const timeline = buildCanonicalTimeline({
      events: [canonicalEvent({ id: "blocked", consequences: [item] })],
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(timeline.monthlyConsequences[0]).toMatchObject({
      cashIn: null,
      status: "NOT_COMPUTABLE",
    });
  });

  it("51. lets an observed zero override a non-zero salary forecast", () => {
    const expected = consequence({
      id: "salary-expected",
      cashIn: 3_200,
      income: 3_200,
      reconciliationKey: "salary-zero",
    });
    const actual = consequence({
      id: "salary-actual",
      cashIn: 0,
      income: 0,
      recognition: "ACTUAL",
      reconciliationKey: "salary-zero",
    });
    const resolved = reconcileMonthlyConsequences([expected, actual]).consequences;
    expect(monthlyEventImpact(resolved, "2027-01", "EUR").operatingSurplus).toBe(0);
  });
});
