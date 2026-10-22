/**
 * Smoke transactionnel des DÉCLARATIONS du contrat de dette (lot A du 12 octobre 2026).
 * Toutes les écritures sont annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * CLÉ ABSENTE ≠ JSON NULL : un contrat sans clé `deferral` est refusé (LF422), au lieu
 *     d'être enregistré « sans différé ». Le JSON `null` reste la déclaration explicite
 *     « aucun différé » ;
 *   * un différé incomplet (nature, durée ou traitement des intérêts absent) est refusé au
 *     lieu d'être complété par 0 ou par une valeur supposée ;
 *   * un différé déclaré est persisté tel quel ;
 *   * l'acteur ne se déclare pas : `actor_user_id`, `decided_by`, `executed_by` présents dans
 *     la charge sont REFUSÉS, et aucune clé de ce type n'atteint la version immuable.
 */
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL manquante");
const connectionUrl = new URL(connectionString);
const localHost = ["localhost", "127.0.0.1", "::1"].includes(connectionUrl.hostname);
const client = new Client({ connectionString, ssl: localHost ? false : true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function rejects(sql: string, params: unknown[], message: string, expected: string) {
  await client.query("savepoint smoke_guard");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint smoke_guard");
    throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    await client.query("rollback to savepoint smoke_guard");
    const reason = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code ?? "";
    if (!reason.includes(expected) && code !== expected)
      throw new Error(`${message} : refus obtenu pour une autre raison (${code} ${reason})`);
  }
}

const contract = (overrides: Record<string, unknown>) => ({
  liability_id: null,
  name: "Prêt déclaré",
  lender: "Banque",
  principal: 1200,
  initial_balance: 1200,
  balance_date: "2026-01-05",
  annual_rate: 0,
  payment_amount: null,
  payment_count: 12,
  first_payment_date: "2026-01-05",
  maturity_date: null,
  amortisation_profile: "AMORTIZING",
  balloon_amount: null,
  payment_frequency: "MONTHLY",
  interest_convention: "PROPORTIONAL",
  rate_type: "FIXED",
  insurance_amount: null,
  recurring_fees: null,
  payment_includes_insurance: null,
  deferral: null,
  facility_id: null,
  notes: null,
  rate_schedule: [],
  payment_schedule: [],
  early_repayments: [],
  charges: [],
  provided_schedule: [],
  ...overrides,
});

const withoutKey = (payload: Record<string, unknown>, key: string) => {
  const copy = { ...payload };
  delete copy[key];
  return copy;
};

let succeeded = false;
await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
  const userId = owner.rows[0].id;
  await client.query("set local role service_role");
  const save = "select public.lfo_save_debt_contract($1::uuid, $2::jsonb)::text as id";
  const refuse = (payload: unknown, label: string, expected: string) =>
    rejects(save, [userId, JSON.stringify(payload)], label, expected);
  const deferralOf = async (id: string) =>
    (
      await client.query<{ kind: string | null; months: number | null; treatment: string | null }>(
        `select deferral_kind as kind, deferral_months as months,
                deferral_interest_treatment as treatment
           from public.liabilities where id = $1`,
        [id],
      )
    ).rows[0]!;

  // 1. Différé : clé absente ≠ JSON null.
  await refuse(
    withoutKey(contract({}), "deferral"),
    "Contrat sans clé de différé enregistré comme « sans différé »",
    "LF422",
  );
  const none = await client.query<{ id: string }>(save, [userId, JSON.stringify(contract({}))]);
  const declaredNone = await deferralOf(none.rows[0]!.id);
  assert(
    declaredNone.kind === "NONE" && declaredNone.months === 0,
    "Le JSON null n'est plus lu comme la déclaration « aucun différé »",
  );

  // 2. Différé incomplet : jamais complété par 0 ni par une valeur supposée.
  for (const [label, deferral] of [
    ["sans durée", { kind: "TOTAL", interest_treatment: "CAPITALISED" }],
    ["sans nature", { months: 3, interest_treatment: "PAID" }],
    ["sans traitement des intérêts", { kind: "TOTAL", months: 3 }],
    ["durée nulle", { kind: "TOTAL", months: 0, interest_treatment: "PAID" }],
    ["durée en texte", { kind: "TOTAL", months: "3", interest_treatment: "PAID" }],
    ["durée non entière", { kind: "TOTAL", months: 2.5, interest_treatment: "PAID" }],
    ["nature NONE dans un objet", { kind: "NONE", months: 3, interest_treatment: "PAID" }],
    ["clé inconnue", { kind: "TOTAL", months: 3, interest_treatment: "PAID", rate: 0 }],
  ] as const) {
    await refuse(contract({ deferral }), `Différé ${label} accepté`, "LF422");
  }
  await refuse(contract({ deferral: "TOTAL" }), "Différé en texte accepté", "LF422");

  const declared = await client.query<{ id: string }>(save, [
    userId,
    JSON.stringify(
      contract({ deferral: { kind: "PRINCIPAL_ONLY", months: 6, interest_treatment: "PAID" } }),
    ),
  ]);
  const persisted = await deferralOf(declared.rows[0]!.id);
  assert(
    persisted.kind === "PRINCIPAL_ONLY" && persisted.months === 6 && persisted.treatment === "PAID",
    "Différé déclaré non persisté tel quel",
  );

  // 3. Acteur : refusé, jamais copié dans la version immuable.
  for (const key of ["actor_user_id", "decided_by", "executed_by"]) {
    await refuse(contract({ [key]: userId }), `Clé d'acteur ${key} acceptée`, "LF422");
  }
  const leaked = await client.query<{ count: string }>(
    `select count(*)::text as count from public.liability_contract_versions
      where user_id = $1
        and (terms ? 'actor_user_id' or terms ? 'decided_by' or terms ? 'executed_by')`,
    [userId],
  );
  assert(leaked.rows[0]!.count === "0", "Une clé d'acteur a atteint une version de contrat");

  succeeded = true;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
if (succeeded)
  console.log(
    "Smoke déclarations du contrat de dette : clé de différé absente refusée (≠ JSON null « aucun différé »), différé incomplet ou mal typé refusé sans valeur supposée, différé déclaré persisté tel quel, clés d'acteur refusées et absentes des versions (transaction annulée).",
  );
