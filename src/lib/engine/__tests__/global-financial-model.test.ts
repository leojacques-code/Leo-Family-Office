import { describe, expect, it } from "vitest";

import { createDecisionCaseVersion, createDecisionOption } from "@/lib/engine/decision-lab";
import { buildDashboardEventTimeline } from "@/lib/engine/event-adapters";
import {
  GLOBAL_FINANCIAL_MODEL_VERSION,
  buildGlobalFinancialContext,
  evaluateGlobalDecisionCase,
  evaluateGlobalGoalCurrent,
  evaluateGlobalScenario,
  runGlobalScenarioComparison,
} from "@/lib/engine/global-financial-model";
import { createGoalVersion } from "@/lib/engine/goal-engine";
import { createScenarioVersion } from "@/lib/engine/scenario-engine";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";
import { scenarioEvent } from "@/lib/engine/__tests__/fixtures/scenarios-v2";
import type { DashboardState, FinancialAccount, Provenance } from "@/lib/types";

const provenance: Provenance = {
  kind: "ACTUAL",
  confidence: "HIGH",
  effectiveDate: "2026-01-01",
  source: "Global Financial Model fixture",
};

function stateWithCash(): DashboardState {
  const state = eventEngineCrossDomainFixture();
  const account: FinancialAccount = {
    id: "global-bank",
    institutionId: "fixture-bank",
    institution: "Fixture Bank",
    name: "Compte global",
    type: "BANK",
    currency: "EUR",
    balance: 200_000,
    balanceDate: state.asOfDate,
    liquidity: "IMMEDIATE",
    provenance,
  };
  return { ...state, accounts: [account] };
}

describe("Global Financial Model — intégration canonique", () => {
  it("construit un contexte unique avec cut-off, horizon et baseline alignés", () => {
    const context = buildGlobalFinancialContext(stateWithCash(), 72);
    expect(context.methodologyVersion).toBe(GLOBAL_FINANCIAL_MODEL_VERSION);
    expect(context.asOfDate).toBe("2026-01-01");
    expect(context.timeline.endDate).toBe(context.endDate);
    expect(context.baseline.asOfDate).toBe(context.asOfDate);
    expect(context.baseline.eventIds).toEqual(context.timeline.events.map((event) => event.id));
    expect(context.opening.netWorth).toBe(199_000);
  });

  it("reconstruit l'horizon demandé au lieu de réutiliser la timeline 40 ans du state", () => {
    const state = stateWithCash();
    state.portfolioEvents = [
      ...state.portfolioEvents,
      {
        ...state.portfolioEvents[0],
        id: "withdrawal-2074",
        eventDate: "2074-06-15",
        externalReference: "fixture-withdrawal-2074",
      },
    ];
    state.eventTimeline = buildDashboardEventTimeline({
      state,
      startDate: state.asOfDate,
      endDate: "2066-01-01",
    });
    expect(state.eventTimeline.events.some((event) => event.id.includes("withdrawal-2074"))).toBe(
      false,
    );

    const context = buildGlobalFinancialContext(state, 600);
    expect(context.endDate).toBe("2076-01-31");
    expect(context.timeline.events.some((event) => event.id.includes("withdrawal-2074"))).toBe(
      true,
    );
  });

  it("refuse un horizon différent plutôt que de tronquer silencieusement des événements", () => {
    const state = stateWithCash();
    const context = buildGlobalFinancialContext(state, 24);
    const definition = createScenarioVersion({
      scenarioId: "scenario-36-months",
      asOfDate: state.asOfDate,
      horizonMonths: 36,
    });
    expect(() => runGlobalScenarioComparison(context, definition)).toThrow(
      /n'utilise pas l'horizon du contexte/,
    );
    expect(() => evaluateGlobalScenario(state, definition)).not.toThrow();
  });

  it("fait circuler la même baseline de Scenarios vers Goals et Decision Lab", () => {
    const state = stateWithCash();
    const base = createScenarioVersion({
      scenarioId: "global-base",
      asOfDate: state.asOfDate,
      horizonMonths: 72,
      market: { annualReturn: 0, annualVolatility: 0 },
    });
    const dividend = createScenarioVersion({
      scenarioId: "global-dividend",
      asOfDate: state.asOfDate,
      horizonMonths: 72,
      market: { annualReturn: 0, annualVolatility: 0 },
      overrides: [
        {
          id: "add-dividend",
          operation: "ADD",
          baselineEventId: null,
          event: scenarioEvent({
            id: "global-business-dividend",
            date: "2029-06-30",
            domain: "BUSINESS",
            type: "DIVIDEND",
            cashIn: 10_000,
            income: 10_000,
          }),
          reason: "Fixture d'intégration globale",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const scenario = evaluateGlobalScenario(state, dividend);
    const goal = createGoalVersion({
      goalId: "global-goal",
      name: "Trésorerie globale",
      target: {
        metric: "IMMEDIATE_CASH",
        operator: "AT_LEAST",
        value: 205_000,
        currency: "EUR",
        entityId: null,
      },
      targetDate: "2031-01-31",
      constraintStrength: "HARD",
    });
    const current = evaluateGlobalGoalCurrent(scenario.context, goal);
    expect(current.observation.value).toBe(scenario.context.opening.bankCash);

    const options = [base, dividend].map((definition, index) =>
      createDecisionOption({
        id: `OPTION_${index + 1}`,
        name: definition.scenarioId,
        description: "Option synthétique",
        definition,
      }),
    );
    const caseVersion = createDecisionCaseVersion({
      caseId: "global-case",
      name: "Décision globale",
      opening: scenario.context.opening,
      baselineEvents: scenario.context.timeline.events,
      options,
      selectedGoals: [
        {
          goalId: goal.goalId,
          goalVersion: goal.version,
          constraintStrength: goal.constraintStrength,
          definition: goal,
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const decision = evaluateGlobalDecisionCase(state, caseVersion, {
      runId: "global-run",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(caseVersion.baseline).toEqual(scenario.baseline);
    expect(decision.evaluation.provenance.baseline).toEqual(scenario.baseline);
    expect(decision.evaluation.options).toHaveLength(2);
    expect(decision.evaluation.options[1].terminal.netWorth).toBeGreaterThan(
      decision.evaluation.options[0].terminal.netWorth ?? Number.NEGATIVE_INFINITY,
    );
    expect(decision.evaluation.options[1].goalImpacts[0].goalId).toBe(goal.goalId);
    expect(decision.evaluation.provenance.methodologyVersions).toContain(
      GLOBAL_FINANCIAL_MODEL_VERSION,
    );
    expect(decision.evaluation.options[1].provenance.engines).toContain(
      GLOBAL_FINANCIAL_MODEL_VERSION,
    );
  });

  it("reste déterministe et ne mute jamais les faits du DashboardState", () => {
    const state = stateWithCash();
    const before = structuredClone(state);
    const first = buildGlobalFinancialContext(state, 72);
    const second = buildGlobalFinancialContext(state, 72);
    expect(first.baseline).toEqual(second.baseline);
    expect(first.timeline.monthlyConsequences).toEqual(second.timeline.monthlyConsequences);
    expect(state).toEqual(before);
  });
});
