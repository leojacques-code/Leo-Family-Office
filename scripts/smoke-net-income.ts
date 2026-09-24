/**
 * Smoke transactionnel du premier revenu net observé. Toutes les écritures sont annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * la RPC écrit UNE transaction ACTUAL, nature INCOME portée par `kind_override`, sans
 *     catégorie, dans la DEVISE DU COMPTE (lue en base, pas reçue) ;
 *   * AUCUN solde n'est dérivé : le solde observé du compte reste le seul solde ;
 *   * la charge est stricte : clé d'acteur, devise envoyée par le client, montant numérique
 *     JSON, nul, négatif, exponentiel, date ou libellé absent sont refusés par la BASE ;
 *   * le compte d'un autre propriétaire est introuvable, et la RPC n'est pas appelable par
 *     `authenticated`.
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
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
  const userId = owner.rows[0].id;
  const otherUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    otherUser,
    `smoke-income-${otherUser}@invalid`,
  ]);
  await client.query("set local role service_role");

  const account = await client.query<{ id: string }>(
    "select public.lfo_add_account($1, 'Banque smoke', 'Compte CHF', 'BANK', 1000, 'CHF', '2026-09-20')::text as id",
    [userId],
  );
  const accountId = account.rows[0]!.id;
  const foreign = await client.query<{ id: string }>(
    "select public.lfo_add_account($1, 'Banque voisine', 'Compte voisin', 'BANK', 5, 'EUR', '2026-09-20')::text as id",
    [otherUser],
  );
  const foreignAccountId = foreign.rows[0]!.id;
  const balancesBefore = await client.query<{ count: string }>(
    "select count(*)::text as count from public.account_balances where account_id = $1",
    [accountId],
  );

  const valid = {
    account_id: accountId,
    received_on: "2026-09-23",
    amount: "2450.35",
    label: "Salaire septembre",
    notes: null,
  };
  const sql = "select public.lfo_record_net_income($1::uuid, $2::jsonb)::text as id";
  const created = await client.query<{ id: string }>(sql, [userId, JSON.stringify(valid)]);
  const row = await client.query<Record<string, string | null>>(
    `select amount::text, currency, category_id::text, kind_override, data_kind,
            transaction_date::text, label
       from public.transactions where id = $1`,
    [created.rows[0]!.id],
  );
  const income = row.rows[0]!;
  assert(Number(income.amount) === 2450.35, "Montant altéré");
  assert(income.currency === "CHF", "La devise n'est pas celle du compte crédité");
  assert(income.category_id === null, "Une catégorie a été inventée");
  assert(income.kind_override === "INCOME" && income.data_kind === "ACTUAL", "Nature incorrecte");
  assert(income.transaction_date === "2026-09-23", "Date altérée");
  const balancesAfter = await client.query<{ count: string }>(
    "select count(*)::text as count from public.account_balances where account_id = $1",
    [accountId],
  );
  assert(
    balancesAfter.rows[0]!.count === balancesBefore.rows[0]!.count,
    "Un solde a été dérivé du revenu : double comptage du versement",
  );

  const refuse = (payload: unknown, label: string, expected: string) =>
    rejects(sql, [userId, JSON.stringify(payload)], label, expected);
  await refuse({ ...valid, user_id: otherUser }, "Clé d'acteur acceptée", "Clé refusée");
  await refuse({ ...valid, currency: "EUR" }, "Devise client acceptée", "Clé refusée");
  await refuse({ ...valid, amount: 2450 }, "Montant numérique JSON accepté", "texte");
  await refuse({ ...valid, amount: undefined }, "Montant absent accepté", "texte");
  for (const amount of ["0", "0.000000", "-5", "1e3", "NaN", "abc"])
    await refuse({ ...valid, amount }, `Montant « ${amount} » accepté`, "Montant net invalide");
  await refuse({ ...valid, received_on: undefined }, "Date absente acceptée", "Date de versement");
  await refuse({ ...valid, label: "  " }, "Libellé vide accepté", "Libellé du revenu requis");
  await refuse({ ...valid, account_id: undefined }, "Compte absent accepté", "Compte crédité");
  await refuse(
    { ...valid, account_id: foreignAccountId },
    "Compte d'un autre propriétaire accepté",
    "Compte introuvable",
  );

  await client.query("reset role");
  await client.query("set local role authenticated");
  await rejects(
    sql,
    [userId, JSON.stringify(valid)],
    "RPC appelable par authenticated",
    "permission denied",
  );
  succeeded = true;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
if (succeeded)
  console.log(
    "Smoke revenu net observé : transaction ACTUAL INCOME dans la devise du compte, sans catégorie ni solde dérivé, charge stricte et cloisonnement conformes (transaction annulée).",
  );
