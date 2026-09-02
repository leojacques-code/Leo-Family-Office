import type { ProjectionEnvelope, Scenario } from "@/lib/types";

export interface ScenarioCutOffStatus {
  computable: boolean;
  scenarioDate: string | null;
  canonicalDate: string;
}

export function displayedScenarioProjection(
  projection: ProjectionEnvelope | null,
  scenarioId: string,
  cutOff: ScenarioCutOffStatus,
): ProjectionEnvelope | null {
  return cutOff.computable && projection?.scenarioId === scenarioId ? projection : null;
}

export function scenarioPresentationAvailability(
  cutOff: ScenarioCutOffStatus,
  deterministicPointCount: number,
) {
  return {
    canRunProjection: cutOff.computable,
    canExplainDeterministic: cutOff.computable && deterministicPointCount > 0,
  };
}

/** Une version immuable périmée doit être rebasée explicitement, jamais réécrite à la lecture. */
export function scenarioCutOffStatus(
  scenario: Scenario,
  canonicalDate: string,
): ScenarioCutOffStatus {
  const scenarioDate = scenario.definition?.asOfDate ?? null;
  return {
    computable: scenarioDate === null || scenarioDate === canonicalDate,
    scenarioDate,
    canonicalDate,
  };
}
