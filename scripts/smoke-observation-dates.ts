/**
 * Smoke transactionnel des dates d'observation et des droits sur les soldes de compte
 * (`20260925110000`). Toutes les écritures sont annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * un fait observé (opération, revenu net, solde de compte, encours de dette) daté
 *     d'aujourd'hui ou du passé s'écrit par ses RPC ; daté de demain, il est refusé par la
 *     BASE, quel que soit le chemin ;
 *   * une hypothèse datée dans le futur reste permise : la prévision n'est pas bloquée ;
 *   * une ligne existante n'est contrôlée que si sa date change : l'historique n'est ni
 *     refusé ni réécrit ;
 *   * `account_balances` n'est plus inscriptible par `authenticated`, reste lisible par son
 *     propriétaire et invisible pour un autre.
 */
import { randomUUID } from "node:crypto";
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
    if (!reason.includes(expected))
      throw new Error(`${message} : refus obtenu pour une autre raison (${reason})`);
  }
}

let succeeded = false;
await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");
  const dates = (
    await client.query<{ today: string; tomorrow: string; yesterday: string }>(
      `select (now() at time zone 'Europe/Paris')::date::text as today,
              ((now() at time zone 'Europe/Paris')::date + 1)::text as tomorrow,
              ((now() at time zone 'Europe/Paris')::date - 1)::text as yesterday`,
    )
  ).rows[0]!;
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
  const userId = owner.rows[0].id;
  const otherUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    otherUser,
    `smoke-dates-${otherUser}@invalid`,
  ]);
  await client.query("set local role service_role");
  const future = "Date d'observation future";

  // ── Solde de compte ─────────────────────────────────────────────────────────────────
  const accountSql =
    "select public.lfo_add_account($1, 'Banque smoke', 'Compte dates', 'BANK', 1000, 'EUR', $2::date)::text as id";
  const accountId = (await client.query<{ id: string }>(accountSql, [userId, dates.today])).rows[0]!
    .id;
  await rejects(
    accountSql,
    [userId, dates.tomorrow],
    "Compte ouvert avec un solde de demain",
    future,
  );
  const balanceInsert = `insert into public.account_balances
      (user_id, account_id, balance, balance_date, data_kind, confidence, source)
    values ($1, $2, 900, $3::date, $4, 'HIGH', 'Smoke')`;
  await client.query(balanceInsert, [userId, accountId, dates.yesterday, "ACTUAL"]);
  await rejects(
    balanceInsert,
    [userId, accountId, dates.tomorrow, "ACTUAL"],
    "Solde observé de demain accepté",
    future,
  );
  // Le refus porte un SQLSTATE dédié : l'application le route sans lire le texte.
  await client.query("savepoint smoke_code");
  const code = await client
    .query(balanceInsert, [userId, accountId, dates.tomorrow, "EXTERNAL_DATA"])
    .then(
      () => null,
      (error: { code?: string }) => error.code ?? "?",
    );
  await client.query("rollback to savepoint smoke_code");
  assert(code === "LF425", `SQLSTATE du refus de date future inattendu : ${code}`);
  await client.query(balanceInsert, [userId, accountId, dates.tomorrow, "USER_ASSUMPTION"]);

  // ── Opération et revenu net ─────────────────────────────────────────────────────────
  const transactionSql =
    "select public.lfo_add_transaction($1, $2, null, $3::date, 'Courses', -20, null, false)::text as id";
  const transactionId = (
    await client.query<{ id: string }>(transactionSql, [userId, accountId, dates.today])
  ).rows[0]!.id;
  await rejects(
    transactionSql,
    [userId, accountId, dates.tomorrow],
    "Opération observée de demain acceptée",
    future,
  );
  const incomeSql = "select public.lfo_record_net_income($1::uuid, $2::jsonb)";
  const income = (receivedOn: string) =>
    JSON.stringify({
      account_id: accountId,
      received_on: receivedOn,
      amount: "2000",
      label: "Salaire",
      notes: null,
    });
  await client.query(incomeSql, [userId, income(dates.today)]);
  await rejects(incomeSql, [userId, income(dates.tomorrow)], "Revenu de demain accepté", future);

  // Historique : une ligne dont la date ne change pas reste modifiable ; déplacer sa date
  // dans le futur est refusé.
  await client.query("update public.transactions set notes = 'annotée' where id = $1", [
    transactionId,
  ]);
  await rejects(
    "update public.transactions set transaction_date = $2::date where id = $1",
    [transactionId, dates.tomorrow],
    "Opération déplacée dans le futur",
    future,
  );

  // ── Encours de dette ────────────────────────────────────────────────────────────────
  const debtSql = "select public.lfo_record_outstanding_debt($1::uuid, $2::jsonb)";
  const debt = (observedAt: string) =>
    JSON.stringify({
      name: "Prêt familial",
      lender: null,
      balance: "1000",
      currency: "EUR",
      observed_at: observedAt,
    });
  await client.query(debtSql, [userId, debt(dates.today)]);
  await rejects(debtSql, [userId, debt(dates.tomorrow)], "Encours de demain accepté", future);

  // ── Droits et isolation sur account_balances ────────────────────────────────────────
  const actAs = async (subject: string) => {
    await client.query("reset role");
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [subject, JSON.stringify({ sub: subject, role: "authenticated" })],
    );
    await client.query("set local role authenticated");
  };
  const visible = async () =>
    (
      await client.query<{ count: string }>(
        "select count(*)::text as count from public.account_balances where account_id = $1",
        [accountId],
      )
    ).rows[0]!.count;
  await actAs(userId);
  assert(Number(await visible()) >= 2, "Le propriétaire ne lit plus ses soldes");
  for (const statement of [
    `insert into public.account_balances (user_id, account_id, balance, balance_date, data_kind, confidence, source)
     values ('${userId}', $1, 1, current_date, 'ACTUAL', 'HIGH', 'x')`,
    "update public.account_balances set balance = 0 where account_id = $1",
    "delete from public.account_balances where account_id = $1",
  ])
    await rejects(
      statement,
      [accountId],
      "Écriture directe d'un solde acceptée",
      "permission denied",
    );
  await actAs(otherUser);
  assert((await visible()) === "0", "Soldes d'un autre propriétaire visibles");
  succeeded = true;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
if (succeeded)
  console.log(
    "Smoke dates d'observation : faits du jour et du passé écrits, faits de demain refusés sur les quatre chemins, hypothèses futures permises, historique non réécrit, soldes en lecture seule et cloisonnés (transaction annulée).",
  );
