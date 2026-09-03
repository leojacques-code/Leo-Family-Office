/** Smoke PostgreSQL Decision Lab V2. Toutes les écritures sont rollbackées. */
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL requis");

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const caseId = "00000000-0000-4000-8000-000000000101";
const runId = "00000000-0000-4000-8000-000000000201";
const now = "2026-08-30T16:00:00.000Z";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const scenario = (id: string) => ({
  schemaVersion: 2,
  methodologyVersion: "SCENARIOS_V2_EVENT_MONTHLY_1",
  scenarioId: id,
  version: 1,
  asOfDate: "2026-08-30",
  horizonMonths: 120,
  lifecycleStatus: "ACTIVE",
  overrides: [],
  assumptions: [],
  market: {
    annualReturn: 0,
    annualVolatility: 0,
    annualInflation: 0,
    stressProbability: 0,
    shockYear: null,
    shockMagnitude: null,
    randomVariables: ["PORTFOLIO_RETURN"],
  },
  capitalAllocation: { investmentAllocationRate: 0, source: "EXPLICIT" },
  createdAt: now,
  legacyCompatibility: null,
});

const option = (id: string) => {
  const definition = scenario(`00000000-0000-4000-8000-0000000003${id}`);
  return {
    id: `OPTION_${id}`,
    name: `Option ${id}`,
    description: "",
    scenarioReference: {
      scenarioId: definition.scenarioId,
      scenarioVersion: 1,
      methodologyVersion: definition.methodologyVersion,
      definitionFingerprint: `fixture-${id}`,
    },
    scenarioDefinition: definition,
    assumptions: [],
    provenance: { source: "smoke", createdBy: "USER", notes: [] },
  };
};

const definition = {
  schemaVersion: 2,
  methodologyVersion: "DECISION_LAB_V2_SCENARIOS_GOALS_1",
  caseId,
  version: 1,
  name: "Smoke Decision Lab",
  description: null,
  decisionType: "SCENARIO_COMPARISON",
  status: "DRAFT",
  asOfDate: "2026-08-30",
  horizonMonths: 120,
  baseline: {
    kind: "CANONICAL_AS_OF",
    asOfDate: "2026-08-30",
    openingFingerprint: "fixture-opening",
    eventSetVersion: "fixture-events",
    eventIds: [],
  },
  selectedGoals: [],
  options: [option("01"), option("02")],
  createdAt: now,
};

const run = {
  id: runId,
  caseId,
  caseVersion: 1,
  optionReferences: definition.options.map((item) => item.scenarioReference),
  goalReferences: [],
  baselineFingerprint: "fixture-opening",
  methodologyVersion: "DECISION_LAB_V2_SCENARIOS_GOALS_1",
  asOfDate: "2026-08-30",
  horizonMonths: 120,
  runMode: "DETERMINISTIC",
  seed: null,
  createdAt: now,
  staleStatus: "CURRENT",
};

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query("begin");
  await client.query(
    "insert into auth.users(id,email) values ($1,'decision-other@invalid') on conflict (id) do nothing",
    [other],
  );
  const created = await client.query<{ id: string }>(
    "select public.lfo_create_decision_case_v2($1,$2::jsonb,$3::timestamptz)::text as id",
    [owner, JSON.stringify(definition), now],
  );
  assert(created.rows[0]?.id === caseId, "La RPC n'a pas créé le Decision Case demandé");

  const saved = await client.query<{ id: string }>(
    "select public.lfo_save_decision_run_v2($1,$2,$3,$4::jsonb,$5::jsonb,$6::timestamptz)::text as id",
    [owner, caseId, 1, JSON.stringify(run), JSON.stringify({ completeness: "READY" }), now],
  );
  assert(saved.rows[0]?.id === runId, "Le Decision Run n'a pas été persisté");

  // A caller cannot attach a run or version to another tenant's case, even through
  // the privileged write RPC. These checks exercise the actual PostgreSQL constraints.
  for (const [sql, values] of [
    [
      "select public.lfo_save_decision_run_v2($1,$2,$3,$4::jsonb,$5::jsonb,$6::timestamptz)",
      [
        other,
        caseId,
        1,
        JSON.stringify({ ...run, id: "00000000-0000-4000-8000-000000000202" }),
        JSON.stringify({ completeness: "READY" }),
        now,
      ],
    ],
    [
      "insert into public.decision_case_versions(user_id, case_id, version, payload) values ($1,$2,2,$3::jsonb)",
      [other, caseId, JSON.stringify({ ...definition, version: 2 })],
    ],
  ] as const) {
    await client.query("savepoint cross_user_association");
    let rejected = false;
    try {
      await client.query(sql, [...values]);
    } catch {
      rejected = true;
      await client.query("rollback to savepoint cross_user_association");
    }
    assert(rejected, "Association inter-utilisateur acceptée");
  }
  const reloaded = await client.query<{ run_snapshot: unknown; payload: unknown }>(
    "select r.run_snapshot, v.payload from public.decision_runs r join public.decision_case_versions v on v.case_id = r.case_id and v.version = r.case_version and v.user_id = r.user_id where r.id = $1 and r.user_id = $2",
    [runId, owner],
  );
  assert(reloaded.rows.length === 1, "Le run et sa version ne sont pas rechargeables");
  assert((reloaded.rows[0].run_snapshot as typeof run).id === runId, "Mauvais run rechargé");
  assert(
    (reloaded.rows[0].payload as typeof definition).version === 1,
    "Mauvaise version rechargée",
  );

  for (const statement of [
    "update public.decision_case_versions set payload = payload where case_id = $1",
    "delete from public.decision_runs where case_id = $1",
  ]) {
    await client.query("savepoint immutable_check");
    let rejected = false;
    try {
      await client.query(statement, [caseId]);
    } catch (error) {
      rejected = String(error).includes("immutable");
      await client.query("rollback to savepoint immutable_check");
    }
    assert(rejected, `Snapshot mutable : ${statement}`);
  }

  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [other]);
  const hidden = await client.query<{ count: string }>(
    "select count(*)::text as count from public.decision_runs where case_id = $1",
    [caseId],
  );
  assert(hidden.rows[0]?.count === "0", "Un autre utilisateur lit le Decision Run");

  await client.query("rollback");
  console.log(
    "Smoke Decision Lab V2 vert : création, version, run immuable, ownership cross-user et rollback intégral.",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
