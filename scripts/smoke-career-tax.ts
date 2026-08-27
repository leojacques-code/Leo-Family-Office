/** Smoke PostgreSQL Career + Tax V2. Toutes les écritures sont rollbackées. */
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
async function rejects(sql: string, params: unknown[], message: string, expected: string) {
  await client.query("savepoint career_tax_guard");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint career_tax_guard");
    throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    await client.query("rollback to savepoint career_tax_guard");
    const reason = error instanceof Error ? error.message : String(error);
    if (!reason.includes(expected)) throw new Error(`${message} : mauvais refus (${reason})`);
  }
}
async function counts() {
  return (
    await client.query(`select
    (select count(*) from public.career_roles)::text roles,
    (select count(*) from public.career_compensation_terms)::text terms,
    (select count(*) from public.career_events)::text events,
    (select count(*) from public.tax_profiles)::text profiles,
    (select count(*) from public.tax_rule_sets)::text rule_sets,
    (select count(*) from public.tax_rules)::text rules,
    (select count(*) from public.tax_observations)::text observations`)
  ).rows[0];
}
const rpc = (name: string, userId: string, payload: unknown) =>
  client.query<{ id: string }>(`select public.${name}($1::uuid,$2::jsonb) as id`, [
    userId,
    JSON.stringify(payload),
  ]);

await client.connect();
const before = await counts();
try {
  await client.query("begin");
  await client.query("set local statement_timeout='15s'");
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke");
  const userId = owner.rows[0].id;
  const foreignUser = randomUUID();
  await client.query("insert into auth.users(id,email) values($1,$2)", [
    foreignUser,
    `career-tax-${foreignUser}@invalid`,
  ]);
  const foreignRole = randomUUID();
  await client.query(
    `insert into public.career_roles(id,user_id,employment_type,currency,start_date,status,data_kind,confidence)
    values($1,$2,'EMPLOYEE','EUR','2026-01-01','ACTIVE','CONTRACTUAL','HIGH')`,
    [foreignRole, foreignUser],
  );
  await client.query("set local role service_role");

  const career = await rpc("lfo_save_career_package", userId, {
    employer: "Synthetic Smoke",
    job_title: "Analyst",
    employment_type: "EMPLOYEE",
    country: "FR",
    currency: "eur",
    start_date: "2026-01-01",
    status: "ACTIVE",
    data_kind: "CONTRACTUAL",
    confidence: "HIGH",
    source: "Transaction rolled back",
    compensation: {
      base_salary: 50_000,
      frequency: "ANNUAL",
      target_bonus_rate: 0.1,
      effective_from: "2026-01-01",
      data_kind: "CONTRACTUAL",
      confidence: "HIGH",
    },
  });
  const roleId = career.rows[0].id;
  await rpc("lfo_record_career_event", userId, {
    role_id: roleId,
    event_type: "BONUS_PAID",
    event_date: "2026-03-15",
    amount: 5_000,
    currency: "eur",
    variable_state: "PAID",
    paid_date: "2026-03-15",
    data_kind: "ACTUAL",
    confidence: "HIGH",
  });
  const careerRows = await client.query<{ currency: string; base: string; events: string }>(
    `select r.currency,
    t.base_salary::text base,(select count(*) from public.career_events where role_id=r.id)::text events
    from public.career_roles r join public.career_compensation_terms t on t.role_id=r.id where r.id=$1`,
    [roleId],
  );
  assert(careerRows.rows[0].currency === "EUR", "La devise Career n'est pas normalisée");
  assert(Number(careerRows.rows[0].base) === 50_000, "Le terme de rémunération est incohérent");
  assert(careerRows.rows[0].events === "1", "L'événement de bonus est absent");
  await rejects(
    `insert into public.career_compensation_terms(user_id,role_id,frequency,effective_from,data_kind,confidence)
    values($1,$2,'ANNUAL','2026-01-01','CONTRACTUAL','HIGH')`,
    [userId, foreignRole],
    "Une rémunération cross-user a été acceptée",
    "career_compensation_role_fk",
  );
  await rejects(
    "select public.lfo_save_career_package($1::uuid,$2::jsonb)",
    [
      userId,
      JSON.stringify({
        role_id: foreignRole,
        employment_type: "EMPLOYEE",
        currency: "EUR",
        start_date: "2026-01-01",
        status: "ACTIVE",
        data_kind: "CONTRACTUAL",
        confidence: "HIGH",
      }),
    ],
    "Un upsert Career cross-user a été accepté",
    "does not belong",
  );

  const profile = await rpc("lfo_set_tax_profile", userId, {
    residency_country: "FR",
    household_status: "SINGLE",
    jurisdiction: "FR",
    effective_from: "2026-01-01",
    dependants: 0,
    withholding_settings: { mode: "DECLARED" },
    confidence: "HIGH",
    source: "Transaction rolled back",
  });
  assert(Boolean(profile.rows[0].id), "Le profil fiscal n'a pas été créé");
  const taxPayload = {
    jurisdiction: "SYNTHETIC",
    tax_year: 2026,
    name: "Smoke rules",
    effective_from: "2026-01-01",
    source: "Synthetic smoke only",
    source_date: "2026-01-01",
    confidence: "HIGH",
    status: "DECLARED",
    rules: [
      {
        name: "Synthetic withholding",
        tax_type: "WITHHOLDING_RATE",
        income_category: "EMPLOYMENT",
        parameters: { rate: 0.1 },
        effective_from: "2026-01-01",
        confidence: "HIGH",
      },
    ],
  };
  const set = await rpc("lfo_save_tax_rule_set", userId, taxPayload);
  await rpc("lfo_save_tax_rule_set", userId, { ...taxPayload, id: set.rows[0].id });
  const rules = await client.query<{ count: string }>(
    "select count(*)::text from public.tax_rules where rule_set_id=$1",
    [set.rows[0].id],
  );
  assert(rules.rows[0].count === "1", "La réécriture du rule set a dupliqué ses règles");
  await rpc("lfo_record_tax_observation", userId, {
    observation_type: "WITHHELD",
    observed_date: "2026-03-31",
    tax_year: 2026,
    amount: 400,
    currency: "eur",
    confidence: "HIGH",
    source: "Transaction rolled back",
  });
  await rejects(
    "select public.lfo_save_tax_rule_set($1::uuid,$2::jsonb)",
    [foreignUser, JSON.stringify({ ...taxPayload, id: set.rows[0].id })],
    "Un upsert fiscal cross-user a été accepté",
    "does not belong",
  );

  await client.query("rollback");
  const after = await counts();
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    `Le smoke a persisté des lignes : before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
  console.log(
    "Smoke Career + Tax V2 vert : package atomique, bonus payé daté, profil et règles versionnés, remplacement idempotent, observations séparées, FK/upserts cross-user refusés et rollback intégral.",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
