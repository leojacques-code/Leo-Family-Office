import { describe, expect, it } from "vitest";
import {
  createDecisionCaseVersion,
  createDecisionOption,
  evaluateDecisionCase,
} from "@/lib/engine/decision-lab";
import { createScenarioVersion } from "@/lib/engine/scenario-engine";
import { SCENARIO_AS_OF, scenarioOpening } from "@/lib/engine/__tests__/fixtures/scenarios-v2";
import { mutationSchema } from "@/lib/validation/mutations";

const caseId = "11111111-1111-4111-8111-111111111111";
const definitionFor = (scenarioId: string) =>
  createScenarioVersion({
    scenarioId,
    asOfDate: SCENARIO_AS_OF,
    horizonMonths: 120,
    createdAt: "2026-08-30T00:00:00.000Z",
  });
const caseVersion = createDecisionCaseVersion({
  caseId,
  name: "Persistence",
  opening: scenarioOpening,
  baselineEvents: [],
  options: [
    createDecisionOption({
      id: "A",
      name: "A",
      definition: definitionFor("22222222-2222-4222-8222-222222222222"),
    }),
    createDecisionOption({
      id: "B",
      name: "B",
      definition: definitionFor("33333333-3333-4333-8333-333333333333"),
    }),
  ],
  createdAt: "2026-08-30T00:00:00.000Z",
});
const result = evaluateDecisionCase({
  caseVersion,
  baselineEvents: [],
  opening: scenarioOpening,
  reportingCurrency: "EUR",
  runId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-08-30T01:00:00.000Z",
});

describe("Decision Lab V2 persistence contracts", () => {
  it("valide une création de case versionnée", () => {
    expect(
      mutationSchema.safeParse({ action: "create_decision_case_v2", definition: caseVersion })
        .success,
    ).toBe(true);
  });

  it("exige l'optimistic lock pour une nouvelle version", () => {
    expect(
      mutationSchema.safeParse({
        action: "save_decision_case_version_v2",
        caseId,
        definition: { ...caseVersion, version: 2 },
      }).success,
    ).toBe(false);
  });

  it("valide un run reproductible complet", () => {
    expect(
      mutationSchema.safeParse({
        action: "save_decision_run_v2",
        caseId,
        caseVersion: 1,
        run: result.run,
        result,
      }).success,
    ).toBe(true);
  });

  it("refuse un résultat sans options", () => {
    expect(
      mutationSchema.safeParse({
        action: "save_decision_run_v2",
        caseId,
        caseVersion: 1,
        run: result.run,
        result: { ...result, options: null },
      }).success,
    ).toBe(false);
  });
});
