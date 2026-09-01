import type { Scenario } from "@/lib/types";

export interface ScenarioCutOffStatus {
  computable: boolean;
  scenarioDate: string | null;
  canonicalDate: string;
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
