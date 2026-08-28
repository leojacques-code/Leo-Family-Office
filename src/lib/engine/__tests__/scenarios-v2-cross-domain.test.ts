import { describe, expect, it } from "vitest";
import { projectedMonthWindow } from "@/lib/engine/monthly-financial-model";
import { createScenarioVersion, runScenarioComparison } from "@/lib/engine/scenario-engine";
import type { PersistedScenarioEventOverride } from "@/lib/engine/scenario-contracts";
import { SCENARIO_AS_OF, scenarioEvent } from "@/lib/engine/__tests__/fixtures/scenarios-v2";

const opening = {
  date: SCENARIO_AS_OF,
  bankCash: 30_000,
  marketInvestedAssets: 25_000,
  investmentCash: 0,
  otherFinancialAssets: 0,
  grossFinancialAssets: 55_000,
  nonFinancialAssets: 300_000,
  loanBalance: 15_000,
  otherLiabilityBalance: 0,
  fundingGap: 0,
  netWorth: 340_000,
  flags: [],
};

const monthlyDates = Array.from(
  { length: 60 },
  (_, index) => projectedMonthWindow(SCENARIO_AS_OF, index + 1).end,
);

const baselineEvents = monthlyDates.flatMap((date, index) => [
  scenarioEvent({
    id: `salary-${index}`,
    date,
    domain: "CAREER",
    type: "COMPENSATION_CHANGE",
    cashIn: 3_000,
    income: 3_000,
  }),
  scenarioEvent({
    id: `rent-${index}`,
    date,
    domain: "REAL_ESTATE",
    type: "RENT_RECEIPT",
    cashIn: 800,
    income: 800,
  }),
  scenarioEvent({
    id: `student-loan-${index}`,
    date,
    domain: "DEBT",
    type: "LOAN_PAYMENT",
    effectKind: "DEBT_SERVICE",
    cashOut: 300,
    debtPrincipal: index < 50 ? 300 : 0,
    liabilityDelta: index < 50 ? -300 : 0,
  }),
]);

function add(id: string, event: ReturnType<typeof scenarioEvent>): PersistedScenarioEventOverride {
  return {
    id,
    operation: "ADD",
    baselineEventId: null,
    event,
    reason: "Fixture persona",
    createdAt: "2026-08-28T08:00:00.000Z",
  };
}

const higherSalary = monthlyDates
  .filter((date) => date >= "2027-01-01")
  .map((date, index) =>
    add(
      `salary-increase-${index}`,
      scenarioEvent({
        id: `salary-increase-event-${index}`,
        date,
        domain: "CAREER",
        type: "COMPENSATION_CHANGE",
        cashIn: 1_000,
        income: 1_000,
      }),
    ),
  );

const scenarioA = createScenarioVersion({
  scenarioId: "persona-property",
  asOfDate: SCENARIO_AS_OF,
  horizonMonths: 60,
  overrides: [
    ...higherSalary,
    add(
      "property-acquisition",
      scenarioEvent({
        id: "property-acquisition-event",
        date: "2028-04-30",
        domain: "REAL_ESTATE",
        type: "ACQUISITION",
        effectKind: "CAPITAL_MOVEMENT",
        cashOut: 100_000,
        assetDelta: 400_000,
      }),
    ),
    add(
      "mortgage",
      scenarioEvent({
        id: "mortgage-event",
        date: "2028-04-30",
        domain: "DEBT",
        type: "LOAN_START",
        effectKind: "CAPITAL_MOVEMENT",
        cashIn: 300_000,
        liabilityDelta: 300_000,
        sequence: 5,
      }),
    ),
    add(
      "works",
      scenarioEvent({
        id: "works-event",
        date: "2029-01-31",
        domain: "REAL_ESTATE",
        type: "WORKS_PAYMENT",
        effectKind: "CAPITAL_MOVEMENT",
        cashOut: 25_000,
        assetDelta: 25_000,
      }),
    ),
    add(
      "business-dividend",
      scenarioEvent({
        id: "business-dividend-event",
        date: "2031-01-31",
        domain: "BUSINESS",
        type: "DIVIDEND",
        cashIn: 30_000,
        income: 30_000,
      }),
    ),
  ],
  market: { annualReturn: 0.05, annualVolatility: 0.12 },
  investmentAllocationRate: 0,
});

const scenarioB = createScenarioVersion({
  scenarioId: "persona-invest",
  asOfDate: SCENARIO_AS_OF,
  horizonMonths: 60,
  overrides: [
    add(
      "invest-down-payment",
      scenarioEvent({
        id: "invest-down-payment-event",
        date: "2029-04-30",
        domain: "PORTFOLIO",
        type: "CONTRIBUTION",
        effectKind: "CAPITAL_MOVEMENT",
        cashOut: 100_000,
        assetDelta: 100_000,
      }),
    ),
  ],
  market: { annualReturn: 0.05, annualVolatility: 0.12 },
  investmentAllocationRate: 0,
});

describe("Scenarios V2 — fixture cross-domain vraie vie", () => {
  it("préserve le même Month 0 pour baseline et les deux décisions", () => {
    for (const definition of [scenarioA, scenarioB]) {
      const result = runScenarioComparison({ baselineEvents, opening, definition });
      expect(result.baseline.monthly[0].netWorth).toBe(opening.netWorth);
      expect(result.scenario.monthly[0].netWorth).toBe(opening.netWorth);
    }
  });

  it("orchestre Career, Debt, Real Estate, Business et Portfolio sans moteur parallèle", () => {
    const property = runScenarioComparison({ baselineEvents, opening, definition: scenarioA });
    const invest = runScenarioComparison({ baselineEvents, opening, definition: scenarioB });
    expect(new Set(property.scenario.timeline.events.map((event) => event.domain))).toEqual(
      new Set(["CAREER", "DEBT", "REAL_ESTATE", "BUSINESS"]),
    );
    expect(new Set(invest.scenario.timeline.events.map((event) => event.domain))).toContain(
      "PORTFOLIO",
    );
  });

  it("compare les deux alternatives sur la même grille de 60 mois", () => {
    const property = runScenarioComparison({ baselineEvents, opening, definition: scenarioA });
    const invest = runScenarioComparison({ baselineEvents, opening, definition: scenarioB });
    expect(property.points).toHaveLength(61);
    expect(invest.points).toHaveLength(61);
    expect(property.points.at(-1)?.scenario.netWorth).not.toBe(
      invest.points.at(-1)?.scenario.netWorth,
    );
    expect(property.points.at(-1)?.date).toBe(invest.points.at(-1)?.date);
  });

  it("compare cinq scénarios sur 40 ans sans recomputation quadratique", () => {
    const startedAt = performance.now();
    const results = Array.from({ length: 5 }, (_, index) =>
      runScenarioComparison({
        baselineEvents,
        opening,
        definition: createScenarioVersion({
          scenarioId: `performance-${index}`,
          asOfDate: SCENARIO_AS_OF,
          horizonMonths: 40 * 12,
          market: { annualReturn: 0.03 + index * 0.005, annualVolatility: 0.1 },
        }),
      }),
    );
    expect(results.every((result) => result.points.length === 481)).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});
