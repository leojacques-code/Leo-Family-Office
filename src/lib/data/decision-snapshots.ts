import { z } from "zod";
import { isDecisionCaseVersion } from "@/lib/engine/decision-lab";
import { isScenarioVersionDefinition, scenarioFingerprint } from "@/lib/engine/scenario-engine";
import { isGoalVersionDefinition } from "@/lib/engine/goal-engine";
import {
  DECISION_LAB_METHODOLOGY_VERSION,
  type DecisionCaseVersion,
  type DecisionEvaluation,
  type DecisionRun,
} from "@/lib/engine/decision-contracts";
import type { DashboardState } from "@/lib/types";

const text = z.string().min(1);
const integer = z.number().int().positive();
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const status = z.enum(["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"]);
const completeness = z.enum(["READY", "PARTIAL", "NOT_COMPUTABLE"]);
const strings = z.array(z.string());
const money = z.number().finite().nullable();
const baseline = z.object({
  kind: z.literal("CANONICAL_AS_OF"),
  asOfDate: date,
  openingFingerprint: text,
  eventSetVersion: text,
  eventIds: strings,
});
const scenarioReference = z.object({
  scenarioId: text,
  scenarioVersion: integer,
  methodologyVersion: text,
  definitionFingerprint: text,
});
const assumption = z.object({
  key: text,
  label: z.string(),
  value: z.union([z.number().finite(), z.string(), z.boolean(), z.null()]),
  unit: z.string().nullable(),
  currency: z.string().nullable(),
  effectiveDate: date.nullable(),
  kind: z.enum(["OBSERVED_MARKET_DATA", "USER_ASSUMPTION", "MODEL_ASSUMPTION"]),
  source: z.string(),
});
const option = z.object({
  id: text,
  name: text,
  description: z.string(),
  scenarioReference,
  scenarioDefinition: z.custom(isScenarioVersionDefinition),
  assumptions: z.array(assumption),
  provenance: z.object({
    source: z.string(),
    createdBy: z.enum(["USER", "TEMPLATE", "SYSTEM"]),
    notes: strings,
  }),
});
const definitionSchema = z.object({
  schemaVersion: z.literal(2),
  methodologyVersion: z.literal(DECISION_LAB_METHODOLOGY_VERSION),
  caseId: text,
  version: integer,
  name: text,
  description: z.string().nullable(),
  decisionType: text,
  status,
  asOfDate: date,
  horizonMonths: integer.max(960),
  baseline,
  selectedGoals: z.array(
    z.object({
      goalId: text,
      goalVersion: integer,
      constraintStrength: z.enum(["HARD", "SOFT"]),
      definition: z.custom(isGoalVersionDefinition),
    }),
  ),
  options: z.array(option).min(2).max(3),
  createdAt: timestamp,
});
const runSchema = z
  .object({
    id: text,
    caseId: text,
    caseVersion: integer,
    optionReferences: z.array(scenarioReference),
    goalReferences: z.array(z.object({ goalId: text, goalVersion: integer })),
    baselineFingerprint: text,
    methodologyVersion: z.literal(DECISION_LAB_METHODOLOGY_VERSION),
    asOfDate: date,
    horizonMonths: integer.max(960),
    runMode: z.enum(["DETERMINISTIC", "MONTE_CARLO"]),
    seed: z.number().int().nullable(),
    createdAt: timestamp,
    staleStatus: z.enum(["CURRENT", "STALE_BASELINE", "STALE_REFERENCE"]),
  })
  .refine((x) => x.runMode !== "DETERMINISTIC" || x.seed === null);
const delta = z.object({
  netWorth: money,
  liquidNetWorth: money,
  cash: money,
  fundingGap: money,
  debt: money,
  investmentAssets: money,
  realEstateAndBusinessAssets: money,
  income: money,
  expenses: money,
  taxes: money,
});
const metric = delta.extend({ date });
const blocker = z.object({
  code: text,
  message: z.string(),
  source: z.enum(["DECISION_LAB_V2", "SCENARIOS_V2", "GOALS_V2"]),
  blocking: z.boolean(),
  optionId: z.string().nullable(),
  goalId: z.string().nullable(),
});
const goalBlockers = z.array(
  z.object({ code: text, message: z.string(), blocking: z.boolean(), source: z.string() }),
);
const target = z.object({
  metric: text,
  operator: z.enum(["AT_LEAST", "AT_MOST", "EQUAL"]),
  value: z.number().finite(),
  currency: z.string().nullable(),
  entityId: z.string().nullable(),
});
const trajectory = z.object({
  goalId: text,
  goalVersion: integer,
  target,
  observation: z
    .object({
      metric: text,
      value: money,
      currency: z.string().nullable(),
      observedAt: date,
      status: z.enum(["COMPLETE", "PARTIAL", "NOT_COMPUTABLE"]),
      blockers: goalBlockers,
      provenance: z.object({
        source: z.string(),
        methodologyVersion: z.string(),
        entityId: z.string().nullable(),
      }),
    })
    .passthrough()
    .nullable(),
  projectedValueAtTargetDate: money,
  projectedGapAtTargetDate: z
    .object({
      absoluteGap: z.number().finite(),
      relativeGap: money,
      shortfall: z.number().finite(),
      surplus: z.number().finite(),
    })
    .nullable(),
  satisfiedAtTargetDate: z.boolean().nullable(),
  firstProjectedAttainmentDate: date.nullable(),
  status: z.enum(["ACHIEVED", "ON_TRACK", "AT_RISK", "OFF_TRACK", "OVERDUE", "NOT_COMPUTABLE"]),
  blockers: goalBlockers,
  trajectory: z.object({
    scenarioId: z.string().nullable(),
    scenarioVersion: integer.nullable(),
    asOfDate: date,
    baselineFingerprint: z.string().nullable(),
    methodologyVersion: text,
  }),
  methodologyVersion: text,
});
const resultSchema = z.object({
  caseVersion: definitionSchema,
  run: runSchema,
  completeness,
  conclusion: z.enum([
    "DOMINANT_OPTION",
    "NO_UNIQUE_WINNER",
    "TRADE_OFF",
    "INCOMPARABLE",
    "NOT_COMPUTABLE",
  ]),
  dominantOptionId: z.string().nullable(),
  baseline: metric,
  options: z.array(
    z.object({
      option,
      completeness,
      scenarioCompleteness: completeness,
      terminal: metric,
      deltaVsBaseline: delta,
      fundingGapPeriods: z.array(
        z.object({ startDate: date, endDate: date, peak: z.number().finite() }),
      ),
      goalImpacts: z.array(
        z.object({
          goalId: text,
          goalVersion: integer,
          constraintStrength: z.enum(["HARD", "SOFT"]),
          baseline: trajectory,
          option: trajectory,
          probabilityOfAttainment: z.object({
            probability: money,
            successfulSamples: money,
            totalSamples: money,
            status: z.enum(["COMPUTABLE", "NOT_COMPUTABLE"]),
            blockers: goalBlockers,
          }),
          impact: z.enum(["IMPROVED", "DEGRADED", "UNCHANGED", "NOT_COMPUTABLE"]),
          hardConstraintViolated: z.boolean(),
        }),
      ),
      blockers: z.array(blocker),
      assumptions: z.array(assumption),
      provenance: z.object({
        engines: strings,
        methodologyVersions: strings,
        baselineFingerprint: text,
        scenarioId: text,
        scenarioVersion: integer,
        sourceEventIds: strings,
      }),
    }),
  ),
  pairComparisons: z.array(
    z.object({ leftOptionId: text, rightOptionId: text, delta, opportunityCost: delta }),
  ),
  tradeOffs: z.array(
    z.object({
      optionId: text,
      improvedGoalIds: strings,
      degradedGoalIds: strings,
      unchangedGoalIds: strings,
      violatedHardGoalIds: strings,
      newBlockerCodes: strings,
    }),
  ),
  blockers: z.array(blocker),
  provenance: z.object({ baseline, baselineEventIds: strings, methodologyVersions: strings }),
});

/** Compare complete snapshots, including their provenance, without depending on key order. */
export function sameDecisionSnapshot(left: unknown, right: unknown): boolean {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, stable(item)]),
          )
        : value;
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

// Retain the original snapshot after validation: never silently strip unknown provenance.
export function readDecisionDefinition(value: unknown): DecisionCaseVersion | undefined {
  if (!definitionSchema.safeParse(value).success || !isDecisionCaseVersion(value)) return undefined;
  if (
    new Set(value.options.map((x) => x.id)).size !== value.options.length ||
    value.baseline.asOfDate !== value.asOfDate ||
    value.options.some(
      (x) =>
        x.scenarioReference.scenarioId !== x.scenarioDefinition.scenarioId ||
        x.scenarioReference.scenarioVersion !== x.scenarioDefinition.version ||
        x.scenarioReference.methodologyVersion !== x.scenarioDefinition.methodologyVersion ||
        x.scenarioReference.definitionFingerprint !== scenarioFingerprint(x.scenarioDefinition),
    ) ||
    value.selectedGoals.some(
      (x) => x.goalId !== x.definition.goalId || x.goalVersion !== x.definition.version,
    )
  )
    return undefined;
  return value;
}
export function readDecisionRun(value: unknown): DecisionRun | undefined {
  return runSchema.safeParse(value).success ? (value as DecisionRun) : undefined;
}
export function readDecisionResult(value: unknown): DecisionEvaluation | undefined {
  if (!resultSchema.safeParse(value).success) return undefined;
  const result = value as DecisionEvaluation;
  const definition = readDecisionDefinition(result.caseVersion);
  if (
    !definition ||
    result.run.caseId !== definition.caseId ||
    result.run.caseVersion !== definition.version ||
    !sameDecisionSnapshot(
      result.run.optionReferences,
      definition.options.map((x) => x.scenarioReference),
    ) ||
    !sameDecisionSnapshot(
      result.run.goalReferences,
      definition.selectedGoals.map((x) => ({ goalId: x.goalId, goalVersion: x.goalVersion })),
    ) ||
    result.options.length !== definition.options.length ||
    result.options.some(
      (x) =>
        !sameDecisionSnapshot(
          x.option,
          definition.options.find((y) => y.id === x.option.id),
        ),
    )
  )
    return undefined;
  return result;
}

type Row = Record<string, unknown>;
const rowText = (value: unknown) => (typeof value === "string" ? value : "");
const newest = (a: Row, b: Row) =>
  rowText(b.created_at).localeCompare(rowText(a.created_at)) ||
  rowText(b.id).localeCompare(rowText(a.id));

/** Owner checks are repeated on each side of every join, even with service-role reads. */
export function mapDecisionCases(
  user: string,
  cases: Row[],
  versions: Row[],
  runs: Row[],
): NonNullable<DashboardState["decisionCases"]> {
  return cases
    .filter((row) => row.user_id === user)
    .sort((a, b) => rowText(a.id).localeCompare(rowText(b.id)))
    .map((row) => {
      const id = rowText(row.id);
      const ownedVersions = versions.filter((v) => v.user_id === user && v.case_id === id);
      const currentVersion = integer.parse(row.current_version);
      const versionRow = ownedVersions.filter((v) => v.version === currentVersion).sort(newest)[0];
      const snapshotBlockers: string[] = [];
      let definition = readDecisionDefinition(versionRow?.payload);
      if (definition?.caseId !== id || definition?.version !== currentVersion)
        definition = undefined;
      if (!definition) snapshotBlockers.push("DECISION_VERSION_INVALID_OR_LEGACY");
      const runRow = runs.filter((r) => r.user_id === user && r.case_id === id).sort(newest)[0];
      let latestRun = readDecisionRun(runRow?.run_snapshot);
      const runVersionRow = ownedVersions
        .filter((v) => v.version === runRow?.case_version)
        .sort(newest)[0];
      const runDefinition = readDecisionDefinition(runVersionRow?.payload);
      if (
        latestRun &&
        (!runDefinition ||
          runDefinition.caseId !== id ||
          runDefinition.version !== runRow?.case_version ||
          latestRun.id !== runRow?.id ||
          latestRun.caseId !== id ||
          latestRun.caseVersion !== runRow?.case_version ||
          latestRun.baselineFingerprint !== runRow?.baseline_fingerprint ||
          latestRun.methodologyVersion !== runRow?.methodology_version ||
          latestRun.asOfDate !== runRow?.as_of_date ||
          latestRun.horizonMonths !== runRow?.horizon_months ||
          latestRun.runMode !== runRow?.run_mode ||
          latestRun.seed !== runRow?.seed ||
          latestRun.staleStatus !== runRow?.stale_status)
      )
        latestRun = undefined;
      if (runRow && !latestRun) snapshotBlockers.push("DECISION_RUN_INVALID");
      let latestResult = readDecisionResult(runRow?.result_snapshot);
      if (
        !latestRun ||
        !latestResult ||
        !sameDecisionSnapshot(latestResult.run, latestRun) ||
        !sameDecisionSnapshot(latestResult.caseVersion, runDefinition) ||
        latestResult.completeness !== runRow?.completeness
      )
        latestResult = undefined;
      if (runRow && !latestResult) snapshotBlockers.push("DECISION_RESULT_INVALID_OR_MISMATCH");
      return {
        id,
        userId: user,
        name: rowText(row.name),
        description: typeof row.description === "string" ? row.description : null,
        decisionType: rowText(row.decision_type),
        status: status.parse(row.status),
        asOfDate: date.parse(row.as_of_date),
        horizonMonths: integer.max(960).parse(row.horizon_months),
        selectedGoalIds: definition?.selectedGoals.map((g) => g.goalId) ?? [],
        currentVersion,
        createdAt: rowText(row.created_at),
        updatedAt: rowText(row.updated_at),
        archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
        definition,
        latestRun,
        latestResult,
        snapshotBlockers,
      };
    });
}
