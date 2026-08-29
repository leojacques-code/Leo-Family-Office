import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalsPage, buildGoalsTrajectoryContext } from "@/components/pages/goals/page";
import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import { buildCanonicalTimeline } from "@/lib/engine/event-engine";
import { createGoalVersion } from "@/lib/engine/goal-engine";
import { createScenarioVersion } from "@/lib/engine/scenario-engine";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";
import type { DashboardState, FinancialAccount, Goal, Scenario } from "@/lib/types";

const AS_OF = "2026-08-29";
const provenance = { kind: "ACTUAL" as const, confidence: "HIGH" as const };

function nonComputableGoalsState(): DashboardState {
  const account: FinancialAccount = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    institutionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    institution: "Banque fixture",
    name: "Compte USD sans taux de change",
    type: "BANK",
    currency: "USD",
    balance: 10_000,
    balanceDate: AS_OF,
    liquidity: "IMMEDIATE",
    provenance,
  };
  const balanceSheet = buildCanonicalBalanceSheet({
    asOfDate: AS_OF,
    reportingCurrency: "EUR",
    accounts: [account],
    positions: [],
    liabilities: [],
    currencyRates: [],
  });
  const scenarioId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const scenarioDefinition = {
    ...createScenarioVersion({ scenarioId, asOfDate: AS_OF, horizonMonths: 12 }),
    lifecycleStatus: "ACTIVE" as const,
  };
  const scenario: Scenario = {
    id: scenarioId,
    name: "Central",
    description: "Fixture",
    version: 1,
    color: "#39747a",
    annualReturn: 0,
    annualVolatility: 0,
    annualInflation: 0,
    monthlySavings: 0,
    investmentAllocationRate: 0,
    salaryGrowth: 0,
    stressProbability: 0,
    shockYear: null,
    shockMagnitude: null,
    lifecycleStatus: "ACTIVE",
    archivedAt: null,
    definition: scenarioDefinition,
    provenance,
  };
  const goalDefinition = createGoalVersion({
    goalId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    name: "Patrimoine cible",
    target: {
      metric: "NET_WORTH",
      operator: "AT_LEAST",
      value: 100_000,
      currency: "EUR",
      entityId: null,
    },
    targetDate: "2027-08-29",
    createdAt: `${AS_OF}T00:00:00.000Z`,
  });
  const goal: Goal = {
    id: goalDefinition.goalId,
    name: goalDefinition.name,
    description: null,
    targetAmount: goalDefinition.target.value,
    targetDate: goalDefinition.targetDate,
    priority: goalDefinition.priority,
    status: goalDefinition.status,
    version: goalDefinition.version,
    constraintStrength: goalDefinition.constraintStrength,
    archivedAt: null,
    definition: goalDefinition,
  };
  return {
    ...eventEngineCrossDomainFixture(),
    asOfDate: AS_OF,
    accounts: [account],
    liabilities: [],
    currencyRates: [],
    scenarios: [scenario],
    goals: [goal],
    balanceSheet,
    eventTimeline: buildCanonicalTimeline({ events: [], startDate: AS_OF, endDate: "2027-08-29" }),
  };
}

describe("Goals page projection boundary", () => {
  it("rend la page et signale la trajectoire indisponible quand le bilan canonique ne se projette pas", () => {
    const state = nonComputableGoalsState();
    expect(state.balanceSheet?.financialAssets.value).toBeNull();

    const context = buildGoalsTrajectoryContext(state, state.scenarios[0]);
    expect(context).toMatchObject({
      status: "NOT_COMPUTABLE",
      baseline: null,
      comparison: null,
      blockers: [{ code: "TRAJECTORY_NOT_COMPUTABLE", blocking: true }],
    });

    const html = renderToStaticMarkup(
      createElement(GoalsPage, {
        section: "goals",
        state,
        mutate: async () => true,
        busy: false,
        setExplanation: () => undefined,
        projection: null,
        runProjection: async () => null,
        refresh: async () => undefined,
      }),
    );
    expect(html).toContain("Trajectoire indisponible");
    expect(html).toContain("Les évaluations projetées restent non calculables.");
    expect(html).toContain("Non calculable");
  });
});
