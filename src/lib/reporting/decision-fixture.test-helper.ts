import { createDecisionCaseVersion, createDecisionOption } from "@/lib/engine/decision-lab";
import { createScenarioVersion } from "@/lib/engine/scenario-engine";
import {
  buildGlobalFinancialContext,
  evaluateGlobalDecisionCase,
} from "@/lib/engine/global-financial-model";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";
import type { DashboardState } from "@/lib/types";

export function decisionFixture(state: DashboardState = eventEngineCrossDomainFixture()) {
  const context = buildGlobalFinancialContext(state, 12);
  const definition = createDecisionCaseVersion({
    caseId: "11111111-1111-4111-8111-111111111111",
    name: "Choix enregistré",
    opening: context.opening,
    baselineEvents: context.timeline.events,
    options: ["A", "B"].map((id) =>
      createDecisionOption({
        id,
        name: id,
        definition: createScenarioVersion({
          scenarioId: id,
          asOfDate: state.asOfDate,
          horizonMonths: 12,
          createdAt: "2026-08-30T00:00:00Z",
        }),
      }),
    ),
    createdAt: "2026-08-30T00:00:00Z",
  });
  const { evaluation } = evaluateGlobalDecisionCase(state, definition, {
    runId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-08-30T01:00:00Z",
  });
  const decision: NonNullable<DashboardState["decisionCases"]>[number] = {
    id: definition.caseId,
    userId: "owner",
    name: definition.name,
    description: null,
    decisionType: definition.decisionType,
    status: definition.status,
    asOfDate: definition.asOfDate,
    horizonMonths: definition.horizonMonths,
    selectedGoalIds: [],
    currentVersion: 1,
    createdAt: definition.createdAt,
    updatedAt: definition.createdAt,
    archivedAt: null,
    definition,
    latestRun: evaluation.run,
    latestResult: evaluation,
  };
  state.decisionCases = [decision];
  return { state, decision, definition, evaluation };
}
