/** Smoke PostgreSQL Goals V2. Toutes les écritures sont rollbackées. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  if (process.env.LFO_SMOKE_APPLY_MIGRATION === "1") {
    const migration = await readFile(
      new URL("../supabase/migrations/20260828181356_goals_v2.sql", import.meta.url),
      "utf8",
    );
    await client.query(migration);
  }
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at nulls last limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke");
  const userId = owner.rows[0].id;
  const foreignUser = randomUUID();
  await client.query("insert into auth.users(id,email) values($1,$2)", [
    foreignUser,
    `goals-${foreignUser}@invalid`,
  ]);
  await client.query("set local role service_role");

  const backfill = await client.query<{ goals: string; versions: string }>(
    `select count(*)::text goals,
      count(v.goal_id)::text versions
       from public.goals g
       left join public.goal_versions v
         on v.goal_id=g.id and v.user_id=g.user_id and v.version=g.current_version`,
  );
  assert(
    backfill.rows[0].goals === backfill.rows[0].versions,
    "Un objectif legacy n'a pas de snapshot Goals V2 courant",
  );

  const now = "2026-08-28T20:00:00.000Z";
  const definition = {
    schemaVersion: 2,
    methodologyVersion: "GOALS_V2_CANONICAL_TRAJECTORY_1",
    goalId: "00000000-0000-4000-8000-000000000099",
    version: 99,
    name: "Objectif smoke",
    description: "Rollback intégral",
    status: "ACTIVE",
    priority: 1,
    constraintStrength: "HARD",
    target: {
      metric: "NET_WORTH",
      operator: "AT_LEAST",
      value: 1_000_000,
      currency: "EUR",
      entityId: null,
    },
    targetDate: "2036-08-28",
    targetWindow: null,
    createdAt: now,
    legacyCompatibility: false,
  };

  await client.query("savepoint invalid_contract");
  try {
    const { status: _status, ...missingStatus } = definition;
    await client.query("select public.lfo_create_goal_v2($1,$2,$3)", [
      userId,
      missingStatus,
      now,
    ]);
    throw new Error("Une définition sans status a été acceptée");
  } catch (error) {
    await client.query("rollback to savepoint invalid_contract");
    assert(String(error).includes("status invalide"), `Mauvais refus contrat : ${String(error)}`);
  }

  await client.query("savepoint null_target_value");
  try {
    await client.query("select public.lfo_create_goal_v2($1,$2,$3)", [
      userId,
      { ...definition, target: { ...definition.target, value: null } },
      now,
    ]);
    throw new Error("Une définition sans valeur cible a été acceptée");
  } catch (error) {
    await client.query("rollback to savepoint null_target_value");
    assert(
      String(error).includes("target value invalide"),
      `Mauvais refus valeur cible : ${String(error)}`,
    );
  }

  const created = await client.query<{ id: string }>(
    "select public.lfo_create_goal_v2($1,$2,$3) as id",
    [userId, definition, now],
  );
  const goalId = created.rows[0].id;
  const first = await client.query<{
    current_version: number;
    status: string;
    payload: typeof definition;
  }>(
    `select g.current_version,g.status,v.payload
       from public.goals g
       join public.goal_versions v
         on v.goal_id=g.id and v.version=g.current_version
      where g.id=$1 and g.user_id=$2`,
    [goalId, userId],
  );
  assert(first.rows[0].current_version === 1, "La création n'a pas produit la version 1");
  assert(first.rows[0].status === "ACTIVE", "Un nouvel objectif doit être ACTIVE");
  assert(first.rows[0].payload.goalId === goalId, "Le snapshot ne référence pas son objectif");

  await client.query("savepoint immutable_version");
  try {
    await client.query(
      'update public.goal_versions set payload=payload || \'{"name":"muté"}\'::jsonb where goal_id=$1',
      [goalId],
    );
    throw new Error("Une version immuable a été modifiée");
  } catch (error) {
    await client.query("rollback to savepoint immutable_version");
    assert(String(error).includes("immutable"), `Mauvais refus immutabilité : ${String(error)}`);
  }

  await client.query("savepoint immutable_version_delete");
  try {
    await client.query("delete from public.goal_versions where goal_id=$1", [goalId]);
    throw new Error("Une version immuable a été supprimée sous service_role");
  } catch (error) {
    await client.query("rollback to savepoint immutable_version_delete");
    assert(
      String(error).includes("permission denied") || String(error).includes("immutable"),
      `Mauvais refus de suppression immuable : ${String(error)}`,
    );
  }
  const versionsAfterDeleteRefusal = await client.query<{ count: string }>(
    "select count(*)::text from public.goal_versions where goal_id=$1",
    [goalId],
  );
  assert(
    versionsAfterDeleteRefusal.rows[0].count === "1",
    "Le refus DELETE a supprimé silencieusement une version Goals V2",
  );

  const saved = await client.query<{ version: number }>(
    "select public.lfo_save_goal_version_v2($1,$2,1,$3,$4) as version",
    [userId, goalId, { ...definition, name: "Objectif smoke v2" }, "2026-08-28T20:01:00Z"],
  );
  assert(saved.rows[0].version === 2, "La sauvegarde n'a pas créé la version 2");
  const versions = await client.query<{ count: string }>(
    "select count(*)::text from public.goal_versions where goal_id=$1",
    [goalId],
  );
  assert(versions.rows[0].count === "2", "Une version Goals V2 a été perdue");

  await client.query("savepoint owner_guard");
  try {
    await client.query("select public.lfo_save_goal_version_v2($1,$2,2,$3,$4)", [
      foreignUser,
      goalId,
      definition,
      "2026-08-28T20:02:00Z",
    ]);
    throw new Error("Une mutation cross-user a été acceptée");
  } catch (error) {
    await client.query("rollback to savepoint owner_guard");
    assert(String(error).includes("Goal not found"), `Mauvais refus ownership : ${String(error)}`);
  }

  await client.query("savepoint version_conflict");
  try {
    await client.query("select public.lfo_save_goal_version_v2($1,$2,1,$3,$4)", [
      userId,
      goalId,
      definition,
      "2026-08-28T20:03:00Z",
    ]);
    throw new Error("Un conflit de version a été accepté");
  } catch (error) {
    await client.query("rollback to savepoint version_conflict");
    assert(
      String(error).includes("version conflict"),
      `Mauvais refus de conflit : ${String(error)}`,
    );
  }

  await client.query("savepoint direct_lifecycle");
  try {
    await client.query("update public.goals set status='PAUSED' where id=$1", [goalId]);
    throw new Error("Un cycle de vie direct a été accepté");
  } catch (error) {
    await client.query("rollback to savepoint direct_lifecycle");
    assert(
      String(error).includes("Goals V2 RPC"),
      `Mauvais refus du cycle de vie direct : ${String(error)}`,
    );
  }

  const paused = await client.query<{ version: number }>(
    "select public.lfo_set_goal_status_v2($1,$2,2,'PAUSED',$3) as version",
    [userId, goalId, "2026-08-28T20:04:00Z"],
  );
  assert(paused.rows[0].version === 3, "La pause n'a pas produit une nouvelle version");
  const resumed = await client.query<{ version: number }>(
    "select public.lfo_set_goal_status_v2($1,$2,3,'ACTIVE',$3) as version",
    [userId, goalId, "2026-08-28T20:05:00Z"],
  );
  assert(resumed.rows[0].version === 4, "La reprise n'a pas produit une nouvelle version");
  const archived = await client.query<{ version: number }>(
    "select public.lfo_set_goal_status_v2($1,$2,4,'ARCHIVED',$3) as version",
    [userId, goalId, "2026-08-28T20:06:00Z"],
  );
  assert(archived.rows[0].version === 5, "L'archive n'a pas produit une nouvelle version");
  const archivedShape = await client.query<{
    status: string;
    archived_at: string | null;
    current_version: number;
  }>("select status,archived_at::text,current_version from public.goals where id=$1", [goalId]);
  assert(
    archivedShape.rows[0].status === "ARCHIVED" &&
      archivedShape.rows[0].archived_at &&
      archivedShape.rows[0].current_version === 5,
    "Le cycle de vie archivé est incohérent",
  );

  const evaluationTables = await client.query<{ count: string }>(
    `select count(*)::text from information_schema.tables
      where table_schema='public' and table_name like 'goal%evaluation%'`,
  );
  assert(
    evaluationTables.rows[0].count === "0",
    "Une table de résultats d'évaluation a été ajoutée comme seconde vérité",
  );

  await client.query("rollback");
  console.log(
    "Smoke Goals V2 vert : contrat strict, backfill, création ACTIVE, UPDATE/DELETE service_role refusés sur les versions immuables, verrou optimiste, ownership, cycle de vie versionné, aucune évaluation persistée et rollback intégral.",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
