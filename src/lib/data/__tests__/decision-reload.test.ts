import { beforeEach, describe, expect, it, vi } from "vitest";
import { decisionFixture } from "@/lib/reporting/decision-fixture.test-helper";
import { mapDecisionCases } from "@/lib/data/decision-snapshots";
import type { DecisionCaseVersion, DecisionEvaluation } from "@/lib/engine/decision-contracts";
const mocks = vi.hoisted(() => ({ user: "owner", from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/data/supabase-client", () => ({
  DOCUMENTS_BUCKET: "documents",
  ownerId: () => mocks.user,
  supabaseAdmin: () => mocks,
}));
import { createSupabaseRepository } from "@/lib/data/supabase-repository";
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
const queries: Array<{ table: string; field: string; value: unknown }> = [];
const caseRow = (d: DecisionCaseVersion, owner = "owner"): Row => ({
  id: d.caseId,
  user_id: owner,
  name: d.name,
  description: d.description,
  decision_type: d.decisionType,
  status: d.status,
  as_of_date: d.asOfDate,
  horizon_months: d.horizonMonths,
  current_version: d.version,
  created_at: d.createdAt,
  updated_at: d.createdAt,
  archived_at: null,
});
const versionRow = (d: DecisionCaseVersion, owner = "owner"): Row => ({
  id: `v${d.version}`,
  case_id: d.caseId,
  user_id: owner,
  version: d.version,
  payload: structuredClone(d),
  created_at: d.createdAt,
});
const runRow = (r: DecisionEvaluation, owner = "owner"): Row => ({
  id: r.run.id,
  user_id: owner,
  case_id: r.run.caseId,
  case_version: r.run.caseVersion,
  run_snapshot: structuredClone(r.run),
  result_snapshot: structuredClone(r),
  baseline_fingerprint: r.run.baselineFingerprint,
  methodology_version: r.run.methodologyVersion,
  as_of_date: r.run.asOfDate,
  horizon_months: r.run.horizonMonths,
  run_mode: r.run.runMode,
  seed: r.run.seed,
  stale_status: r.run.staleStatus,
  completeness: r.completeness,
  created_at: r.run.createdAt,
});

beforeEach(() => {
  mocks.user = "owner";
  queries.length = 0;
  tables = {
    profiles: ["owner", "other"].map((user_id) => ({
      user_id,
      reporting_currency: "EUR",
      ledger_coverage_start: null,
      ledger_coverage_source: "MANUAL",
    })),
    decision_cases: [],
    decision_case_versions: [],
    decision_runs: [],
  };
  mocks.from.mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = [];
    let range: [number, number] | undefined;
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      gte: () => builder,
      eq: (field: string, value: unknown) => {
        queries.push({ table, field, value });
        filters.push([field, value]);
        return builder;
      },
      range: (from: number, to: number) => {
        range = [from, to];
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        let data = (tables[table] ?? []).filter((row) =>
          filters.every(([key, value]) => row[key] === value),
        );
        if (range) data = data.slice(range[0], range[1] + 1);
        return Promise.resolve(resolve({ data: structuredClone(data), error: null }));
      },
    };
    return builder;
  });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "lfo_create_decision_case_v2") {
      const d = args.p_definition as DecisionCaseVersion;
      tables.decision_cases.push(caseRow(d, args.p_user_id as string));
      tables.decision_case_versions.push(versionRow(d, args.p_user_id as string));
    } else if (name === "lfo_save_decision_run_v2")
      tables.decision_runs.push(
        runRow(args.p_result as DecisionEvaluation, args.p_user_id as string),
      );
    else throw new Error(`Unexpected RPC ${name}`);
    return { data: "saved", error: null };
  });
});

describe("repository Decision Lab rechargeable", () => {
  it("sauvegarde puis recharge une nouvelle instance du repository, sans cache client", async () => {
    const { definition, evaluation } = decisionFixture();
    await createSupabaseRepository().mutateState({ action: "create_decision_case_v2", definition });
    await createSupabaseRepository().mutateState({
      action: "save_decision_run_v2",
      caseId: definition.caseId,
      caseVersion: 1,
      run: evaluation.run,
      result: evaluation,
    });
    const state = await createSupabaseRepository().getDashboardState();
    expect(state.decisionCases).toHaveLength(1);
    expect(state.decisionCases![0]).toMatchObject({
      definition,
      latestRun: evaluation.run,
      latestResult: evaluation,
      snapshotBlockers: [],
    });
    for (const table of ["decision_cases", "decision_case_versions", "decision_runs"])
      expect(queries).toContainEqual({ table, field: "user_id", value: "owner" });
    mocks.user = "other";
    expect((await createSupabaseRepository().getDashboardState()).decisionCases).toEqual([]);
  });
  it("rejette les associations inter-utilisateurs même si une lecture privilégiée renvoie des lignes étrangères", () => {
    const { definition, evaluation } = decisionFixture();
    expect(
      mapDecisionCases(
        "owner",
        [caseRow(definition, "other")],
        [versionRow(definition)],
        [runRow(evaluation)],
      ),
    ).toEqual([]);
    const foreignVersion = mapDecisionCases(
      "owner",
      [caseRow(definition)],
      [versionRow(definition, "other")],
      [runRow(evaluation)],
    )[0];
    expect(foreignVersion.definition).toBeUndefined();
    expect(foreignVersion.latestResult).toBeUndefined();
    const foreignRun = mapDecisionCases(
      "owner",
      [caseRow(definition)],
      [versionRow(definition)],
      [runRow(evaluation, "other")],
    )[0];
    expect(foreignRun.latestRun).toBeUndefined();
    expect(foreignRun.latestResult).toBeUndefined();
  });
  it("choisit la version courante et le dernier run de façon déterministe sans revenir à un résultat ancien", () => {
    const { definition, evaluation } = decisionFixture();
    const v2 = { ...structuredClone(definition), version: 2 };
    const older = runRow(evaluation);
    older.created_at = "2026-08-29T00:00:00Z";
    const latest = runRow(evaluation);
    latest.id = "z";
    latest.result_snapshot = { bad: true };
    const rows = [older, latest];
    const versions = [versionRow(definition), versionRow(v2)];
    const a = mapDecisionCases("owner", [caseRow(v2)], versions, rows);
    expect(a[0].definition?.version).toBe(2);
    expect(a[0].latestResult).toBeUndefined();
    expect(mapDecisionCases("owner", [caseRow(v2)], versions.reverse(), rows.reverse())).toEqual(a);
    expect(
      mapDecisionCases("owner", [caseRow(v2)], [versionRow(definition)], [older])[0].definition,
    ).toBeUndefined();
  });
  it("départage deux runs au même created_at par ID et conserve le résultat du même run", () => {
    const { definition, evaluation } = decisionFixture();
    const a = runRow(evaluation);
    const other = structuredClone(evaluation);
    other.run.id = "zz";
    const b = runRow(other);
    for (const rows of [
      [a, b],
      [b, a],
    ])
      expect(
        mapDecisionCases("owner", [caseRow(definition)], [versionRow(definition)], rows)[0]
          .latestResult?.run.id,
      ).toBe("zz");
  });
  it.each(["legacy", "malformed", "foreignSnapshot", "otherResultRun"])(
    "ne publie pas un snapshot %s",
    (kind) => {
      const { definition, evaluation } = decisionFixture();
      const version = versionRow(definition);
      const run = runRow(evaluation);
      if (kind === "legacy") version.payload = { schemaVersion: 1, legacyInputs: {}, options: [] };
      if (kind === "malformed")
        (version.payload as DecisionCaseVersion).options = [
          null,
          null,
        ] as unknown as DecisionCaseVersion["options"];
      if (kind === "foreignSnapshot")
        (version.payload as DecisionCaseVersion).caseId = "foreign-case";
      if (kind === "otherResultRun")
        (run.result_snapshot as DecisionEvaluation).run.id = "foreign-run";
      const result = mapDecisionCases("owner", [caseRow(definition)], [version], [run])[0];
      expect(result.name).toBe(definition.name);
      expect(result.latestResult).toBeUndefined();
      expect(result.snapshotBlockers?.length).toBeGreaterThan(0);
    },
  );
  it("transporte version, devise, complétude, composition et NULL des clôtures", async () => {
    tables.monthly_closes = [
      {
        user_id: "owner",
        id: "close",
        close_date: "2026-08-01",
        version: 3,
        reporting_currency: "USD",
        completeness_status: "PARTIAL",
        composition: { immediate_cash: null, market_invested_assets: 0 },
        gross_assets: null,
        debt: 0,
        net_worth: null,
        forecast_net_worth: null,
        variance: null,
        created_at: "2026-08-01T00:00:00Z",
      },
    ];
    expect((await createSupabaseRepository().getDashboardState()).monthlyCloses[0]).toMatchObject({
      version: 3,
      reportingCurrency: "USD",
      completenessStatus: "PARTIAL",
      composition: { immediate_cash: null, market_invested_assets: 0 },
      grossAssets: null,
      debt: 0,
      netWorth: null,
    });
  });
});
