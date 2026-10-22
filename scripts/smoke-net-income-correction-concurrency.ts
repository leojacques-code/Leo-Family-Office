/**
 * Preuve de SÉRIALISATION d'une correction de revenu net saisi (`lfo_correct_net_income`).
 *
 * `smoke-net-income-correction.ts` tourne dans une transaction unique annulée : il ne peut
 * pas prouver qu'une seconde décision BLOQUE sur le verrou de la ligne, puis échoue sur l'état
 * attendu une fois la première validée. Ce script ouvre donc deux transactions simultanées.
 *
 * Ce qu'il prouve :
 *   1. la seconde correction attend réellement le verrou de la première ;
 *   2. la première validée, la seconde est REFUSÉE par un conflit d'état attendu ;
 *   3. la valeur est celle de la première, et la piste porte exactement UNE correction.
 *
 * Il COMMITE puis démonte son décor : il refuse donc tout hôte non local, comme les autres
 * smokes de concurrence. La piste étant immuable et en RESTRICT, le démontage se fait sous
 * `session_replication_role = replica`, dans ce script seulement.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL manquante");
if (!LOCAL_HOSTS.has(new URL(connectionString).hostname))
  throw new Error("Cible non locale refusée : ce script valide des écritures.");

const LOCK_OBSERVATION_MS = 700;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const client = () => new Client({ connectionString, ssl: false });
const setup = client();
const first = client();
const second = client();
let accountId: string | null = null;

await setup.connect();
const owner = await setup.query<{ id: string }>(
  "select id from auth.users order by created_at asc limit 1",
);
assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
const userId = owner.rows[0].id;

async function cleanup(): Promise<void> {
  if (accountId === null) return;
  const run = (sql: string) => setup.query(sql, [accountId]).catch(() => undefined);
  await setup.query("reset role").catch(() => undefined);
  await setup.query("set session session_replication_role = replica");
  await run(
    `delete from public.transaction_corrections
      where transaction_id in (select id from public.transactions where account_id = $1)`,
  );
  await run("delete from public.transactions where account_id = $1");
  await run("delete from public.account_balances where account_id = $1");
  await setup
    .query(
      `with removed as (delete from public.financial_accounts where id = $1 returning institution_id)
       delete from public.institutions where id in (select institution_id from removed)`,
      [accountId],
    )
    .catch(() => undefined);
  await setup.query("set session session_replication_role = origin").catch(() => undefined);
}

const correct = "select public.lfo_correct_net_income($1::uuid, $2::jsonb)::text as id";
try {
  await first.connect();
  await second.connect();
  await setup.query("set role service_role");
  accountId = (
    await setup.query<{ id: string }>(
      `select public.lfo_add_account($1, 'Banque concurrence', $2, 'BANK', 100, 'EUR',
                                     '2026-09-20')::text as id`,
      [userId, `Compte concurrence ${randomUUID().slice(0, 8)}`],
    )
  ).rows[0]!.id;
  const incomeId = (
    await setup.query<{ id: string }>(
      "select public.lfo_record_net_income($1::uuid, $2::jsonb)::text as id",
      [
        userId,
        JSON.stringify({
          account_id: accountId,
          received_on: "2026-09-23",
          amount: "2450.35",
          label: "Salaire concurrence",
          notes: null,
        }),
      ],
    )
  ).rows[0]!.id;
  await setup.query("reset role");
  const expected = { amount: "2450.35", received_on: "2026-09-23", label: "Salaire concurrence" };
  const payload = (amount: string) =>
    JSON.stringify({
      transaction_id: incomeId,
      reason: `Correction à ${amount}`,
      expected,
      corrected: { amount },
    });

  for (const connection of [first, second]) {
    await connection.query("begin");
    await connection.query("set local role service_role");
    await connection.query("set local lock_timeout = '10s'");
  }
  await first.query(correct, [userId, payload("2405.35")]);
  let secondSettled = false;
  const secondResult = second
    .query(correct, [userId, payload("2400")])
    .then(
      () => ({ ok: true as const, message: "" }),
      (error: unknown) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    .finally(() => {
      secondSettled = true;
    });
  await new Promise((resolve) => setTimeout(resolve, LOCK_OBSERVATION_MS));
  assert(!secondSettled, "La seconde correction n'a pas attendu le verrou de la première");
  await first.query("commit");
  const outcome = await secondResult;
  await second.query("rollback");
  assert(!outcome.ok, "La seconde correction, prise sur un état périmé, a été appliquée");
  assert(outcome.message.includes("Conflit"), `Refus pour une autre raison : ${outcome.message}`);

  const state = (
    await setup.query<{ amount: string; corrections: string }>(
      `select t.amount::text as amount,
              (select count(*)::text from public.transaction_corrections c
                where c.transaction_id = t.id) as corrections
         from public.transactions t where t.id = $1`,
      [incomeId],
    )
  ).rows[0]!;
  assert(Number(state.amount) === 2405.35, `Valeur finale inattendue : ${state.amount}`);
  assert(state.corrections === "1", `Piste inattendue : ${state.corrections} correction(s)`);
  console.log(
    "Smoke correction de revenu concurrente vert : seconde décision sérialisée par le verrou de la transaction, refusée sur conflit d'état attendu, décision de la première conservée, piste portant exactement une correction. Décor démonté.",
  );
} finally {
  await first.query("rollback").catch(() => undefined);
  await second.query("rollback").catch(() => undefined);
  await cleanup();
  await first.end().catch(() => undefined);
  await second.end().catch(() => undefined);
  await setup.end().catch(() => undefined);
}
