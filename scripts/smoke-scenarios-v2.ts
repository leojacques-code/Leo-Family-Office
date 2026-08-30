/** Smoke PostgreSQL Scenarios V2. Toutes les écritures sont rollbackées. */
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL manquante");
const url = new URL(connectionString);
const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
const client = new Client({ connectionString, ssl: local ? false : true });
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout='15s'");
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at nulls last limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke");
  const userId = owner.rows[0].id;
  const foreignUser = randomUUID();
  await client.query("insert into auth.users(id,email) values($1,$2)", [
    foreignUser,
    `scenarios-${foreignUser}@invalid`,
  ]);
  await client.query("set local role service_role");
  const asOf = "2026-08-28";
  const definition = {
    schemaVersion: 2,
    methodologyVersion: "SCENARIOS_V2_EVENT_MONTHLY_1",
    scenarioId: "00000000-0000-4000-8000-000000000099",
    version: 99,
    asOfDate: asOf,
    horizonMonths: 360,
    lifecycleStatus: "ACTIVE",
    overrides: [],
    assumptions: [],
    market: {
      annualReturn: 0.05,
      annualVolatility: 0.12,
      annualInflation: 0.02,
      stressProbability: 0,
      shockYear: null,
      shockMagnitude: null,
      randomVariables: ["PORTFOLIO_RETURN"],
    },
    capitalAllocation: { investmentAllocationRate: 0.5, source: "EXPLICIT" },
    createdAt: `${asOf}T00:00:00.000Z`,
    legacyCompatibility: null,
  };
  const created = await client.query<{ id: string }>(
    "select public.lfo_create_scenario_v2($1,$2,$3,$4,$5,$6) as id",
    [userId, "Scenario smoke", "Rollback intégral", "#39747a", definition, `${asOf}T12:00:00Z`],
  );
  const scenarioId = created.rows[0].id;
  const first = await client.query<{
    current_version: number;
    scenario_status: string;
    payload: typeof definition;
  }>(
    `select s.current_version,s.scenario_status,v.payload
       from public.scenarios s join public.scenario_versions v
         on v.scenario_id=s.id and v.version=s.current_version
      where s.id=$1 and s.user_id=$2`,
    [scenarioId, userId],
  );
  assert(first.rows[0].current_version === 1, "La création n'a pas produit la version 1");
  assert(first.rows[0].scenario_status === "DRAFT", "La création doit rester DRAFT");
  assert(
    first.rows[0].payload.scenarioId === scenarioId,
    "Le snapshot ne référence pas son scénario",
  );
  assert(first.rows[0].payload.lifecycleStatus === "DRAFT", "Le snapshot initial n'est pas DRAFT");

  const saved = await client.query<{ version: number }>(
    "select public.lfo_save_scenario_version_v2($1,$2,1,$3,$4) as version",
    [userId, scenarioId, { ...definition, lifecycleStatus: "ACTIVE" }, `${asOf}T13:00:00Z`],
  );
  assert(saved.rows[0].version === 2, "La sauvegarde n'a pas créé la version 2");
  const versions = await client.query<{ count: string }>(
    "select count(*)::text from public.scenario_versions where scenario_id=$1",
    [scenarioId],
  );
  assert(versions.rows[0].count === "2", "Une version immuable a été perdue");

  await client.query("savepoint owner_guard");
  try {
    await client.query("select public.lfo_save_scenario_version_v2($1,$2,2,$3,$4)", [
      foreignUser,
      scenarioId,
      definition,
      `${asOf}T13:30:00Z`,
    ]);
    throw new Error("Une mutation cross-user a été acceptée");
  } catch (error) {
    await client.query("rollback to savepoint owner_guard");
    assert(
      String(error).includes("Scenario not found"),
      `Mauvais refus ownership : ${String(error)}`,
    );
  }

  await client.query("savepoint version_conflict");
  try {
    await client.query("select public.lfo_save_scenario_version_v2($1,$2,1,$3,$4)", [
      userId,
      scenarioId,
      definition,
      `${asOf}T14:00:00Z`,
    ]);
    throw new Error("Un conflit de version a été accepté");
  } catch (error) {
    await client.query("rollback to savepoint version_conflict");
    assert(
      String(error).includes("version conflict"),
      `Mauvais refus de conflit : ${String(error)}`,
    );
  }

  const currentDefinition = (
    await client.query<{ payload: typeof definition }>(
      "select payload from public.scenario_versions where scenario_id=$1 and version=2",
      [scenarioId],
    )
  ).rows[0].payload;
  const run = await client.query<{ id: string }>(
    "select public.lfo_save_simulation_v2($1,$2,2,$3,$4,$5,$6,'MONTE_CARLO',360,$7,$8,$9,42,100,$10) as id",
    [
      userId,
      scenarioId,
      asOf,
      {
        kind: "CANONICAL_AS_OF",
        asOfDate: asOf,
        openingFingerprint: "smoke",
        eventSetVersion: "smoke",
        eventIds: [],
      },
      "smoke",
      [],
      "Smoke transactionnel",
      "SCENARIOS_V2_EVENT_MONTHLY_1",
      currentDefinition,
      JSON.stringify([{ year: 2026, p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 }]),
    ],
  );
  const storedRun = await client.query<{ scenario_version: number; points: string }>(
    `select r.scenario_version,
      (select count(*)::text from public.simulation_results where run_id=r.id) points
      from public.simulation_runs r where r.id=$1`,
    [run.rows[0].id],
  );
  assert(storedRun.rows[0].scenario_version === 2, "Le run ne référence pas la version exacte");
  assert(storedRun.rows[0].points === "1", "Les percentiles n'ont pas été écrits atomiquement");

  await client.query("select public.lfo_archive_scenario_v2($1,$2,$3)", [
    userId,
    scenarioId,
    `${asOf}T15:00:00Z`,
  ]);
  const archived = await client.query<{ scenario_status: string; archived_at: string | null }>(
    "select scenario_status,archived_at::text from public.scenarios where id=$1",
    [scenarioId],
  );
  assert(
    archived.rows[0].scenario_status === "ARCHIVED" && archived.rows[0].archived_at,
    "L'archive est incohérente",
  );
  await client.query("rollback");
  console.log(
    "Smoke Scenarios V2 vert : création DRAFT, versions immuables, verrou optimiste, run reproductible atomique, archive cohérente et rollback intégral.",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
