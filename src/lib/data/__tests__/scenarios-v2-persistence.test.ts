import { describe, expect, it } from "vitest";
import { mapScenario, validateSimulationRun } from "@/lib/data/supabase-repository";
import { createScenarioVersion } from "@/lib/engine/scenario-engine";
import { mutationSchema } from "@/lib/validation/mutations";

const scenarioId = "22222222-2222-4222-8222-222222222222";
const definition = createScenarioVersion({
  scenarioId,
  asOfDate: "2026-08-28",
  horizonMonths: 360,
  market: { annualReturn: 0.05, annualVolatility: 0.12, annualInflation: 0.02 },
  investmentAllocationRate: 0.5,
});
const row = {
  id: scenarioId,
  name: "Alternative",
  description: "Snapshot V2",
  current_version: 1,
  color: "#39747a",
  annual_return: 0.05,
  annual_volatility: 0.12,
  annual_inflation: 0.02,
  monthly_savings: 0,
  investment_allocation_rate: 0.5,
  salary_growth: 0,
  stress_probability: 0,
  shock_year: null,
  shock_magnitude: null,
  scenario_status: "DRAFT",
  archived_at: null,
  data_kind: "USER_ASSUMPTION",
  confidence: "HIGH",
};

describe("persistance Scenarios V2", () => {
  it("joint le snapshot courant à l'identité légère", () => {
    expect(mapScenario(row, definition)).toMatchObject({
      lifecycleStatus: "DRAFT",
      archivedAt: null,
      definition,
    });
  });

  it("valide création, nouvelle version et archive", () => {
    expect(
      mutationSchema.safeParse({
        action: "create_scenario_v2",
        name: "Alternative",
        description: "",
        color: "#39747a",
        definition,
      }).success,
    ).toBe(true);
    expect(
      mutationSchema.safeParse({
        action: "save_scenario_version_v2",
        scenarioId,
        expectedVersion: 1,
        definition,
      }).success,
    ).toBe(true);
    expect(mutationSchema.safeParse({ action: "archive_scenario_v2", scenarioId }).success).toBe(
      true,
    );
  });

  it("refuse un horizon et une allocation hors contrat", () => {
    expect(
      mutationSchema.safeParse({
        action: "create_scenario_v2",
        name: "Invalide",
        description: "",
        color: "#39747a",
        definition: { ...definition, horizonMonths: 0 },
      }).success,
    ).toBe(false);
    expect(
      mutationSchema.safeParse({
        action: "create_scenario_v2",
        name: "Invalide",
        description: "",
        color: "#39747a",
        definition: {
          ...definition,
          capitalAllocation: { ...definition.capitalAllocation, investmentAllocationRate: 2 },
        },
      }).success,
    ).toBe(false);
  });

  it("exige un snapshot V2 complet pour un run V2", () => {
    const points = [{ year: 2026, p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 }];
    expect(() =>
      validateSimulationRun({
        scenarioId,
        seed: 42,
        simulations: 100,
        years: 30,
        methodology: "V2",
        points,
        scenarioVersion: 1,
      }),
    ).toThrow(/métadonnées V2 incomplètes/);
    expect(() =>
      validateSimulationRun({
        scenarioId,
        seed: 42,
        simulations: 100,
        years: 30,
        methodology: "V2",
        points,
        scenarioVersion: 1,
        asOfDate: definition.asOfDate,
        baselineReference: {
          kind: "CANONICAL_AS_OF",
          asOfDate: definition.asOfDate,
          openingFingerprint: "opening",
          eventSetVersion: "events",
          eventIds: [],
        },
        eventSetVersion: "events",
        assumptionsSnapshot: [],
        runMode: "MONTE_CARLO",
        horizonMonths: 360,
        methodologyVersion: definition.methodologyVersion,
        definitionSnapshot: definition,
      }),
    ).not.toThrow();
  });
});
