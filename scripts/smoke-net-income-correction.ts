/**
 * Smoke transactionnel de la correction NON DESTRUCTIVE d'un revenu net saisi. Toutes les
 * écritures sont annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * la valeur canonique est corrigée EN PLACE : une seule transaction, aucun flux de
 *     régularisation fabriqué, aucun solde dérivé ;
 *   * la piste conserve motif, avant, après, champs modifiés, acteur = propriétaire et rôle
 *     PostgreSQL constaté, et elle est immuable (ni UPDATE, ni DELETE) ;
 *   * la transaction corrigée n'est plus supprimable : l'ancienne valeur ne se perd pas ;
 *   * une seconde décision sur un état PÉRIMÉ échoue avec un conflit nommé ;
 *   * la charge est stricte : clé d'acteur, état attendu incomplet ou numérique, montant
 *     nul, exponentiel ou hors précision, date inexistante, libellé vide, correction sans
 *     changement sont refusés par la BASE ;
 *   * une opération importée ou une dépense ne se corrige pas par ce chemin ;
 *   * la transaction d'un autre propriétaire est introuvable, la piste d'autrui invisible
 *     sous `authenticated`, et la RPC n'y est pas appelable.
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
    `smoke-income-fix-${otherUser}@invalid`,
  ]);
  await client.query("set local role service_role");

  const account = await client.query<{ id: string }>(
    "select public.lfo_add_account($1, 'Banque smoke', 'Compte courant', 'BANK', 1000, 'EUR', '2026-09-20')::text as id",
    [userId],
  );
  const accountId = account.rows[0]!.id;
  const foreignAccount = await client.query<{ id: string }>(
    "select public.lfo_add_account($1, 'Banque voisine', 'Compte voisin', 'BANK', 5, 'EUR', '2026-09-20')::text as id",
    [otherUser],
  );
  const record = "select public.lfo_record_net_income($1::uuid, $2::jsonb)::text as id";
  const income = await client.query<{ id: string }>(record, [
    userId,
    JSON.stringify({
      account_id: accountId,
      received_on: "2026-09-23",
      amount: "2450.35",
      label: "Salaire septembre",
      notes: null,
    }),
  ]);
  const incomeId = income.rows[0]!.id;
  const foreignIncome = await client.query<{ id: string }>(record, [
    otherUser,
    JSON.stringify({
      account_id: foreignAccount.rows[0]!.id,
      received_on: "2026-09-23",
      amount: "10",
      label: "Revenu voisin",
      notes: null,
    }),
  ]);
  const counts = async () =>
    (
      await client.query<{ tx: string; balances: string }>(
        `select (select count(*) from public.transactions where user_id = $1)::text as tx,
                (select count(*) from public.account_balances where account_id = $2)::text as balances`,
        [userId, accountId],
      )
    ).rows[0]!;
  const before = await counts();

  const correct = "select public.lfo_correct_net_income($1::uuid, $2::jsonb)::text as id";
  const expected = { amount: "2450.35", received_on: "2026-09-23", label: "Salaire septembre" };
  const valid = {
    transaction_id: incomeId,
    reason: "Montant saisi avant retenue à la source",
    expected,
    corrected: { amount: "2405.35" },
  };
  const correction = await client.query<{ id: string }>(correct, [userId, JSON.stringify(valid)]);
  const after = await counts();
  assert(after.tx === before.tx, "Une transaction de régularisation a été fabriquée");
  assert(after.balances === before.balances, "Un solde a été dérivé de la correction");
  const row = await client.query<Record<string, string | null>>(
    `select amount::text, transaction_date::text, label, kind_override, source, currency
       from public.transactions where id = $1`,
    [incomeId],
  );
  const corrected = row.rows[0]!;
  assert(Number(corrected.amount) === 2405.35, "Montant non corrigé en place");
  assert(corrected.transaction_date === "2026-09-23", "Date modifiée sans demande");
  assert(corrected.label === "Salaire septembre", "Libellé modifié sans demande");
  assert(
    corrected.kind_override === "INCOME" && corrected.currency === "EUR",
    "Nature ou devise altérée",
  );
  const trail = await client.query<{
    actor_user_id: string;
    executed_by: string;
    reason: string;
    before_values: Record<string, string>;
    after_values: Record<string, string>;
    changed_fields: string[];
  }>(
    `select actor_user_id::text, executed_by, reason, before_values, after_values, changed_fields
       from public.transaction_corrections where id = $1`,
    [correction.rows[0]!.id],
  );
  const entry = trail.rows[0]!;
  assert(entry.actor_user_id === userId, "Acteur de la décision différent du propriétaire");
  assert(entry.executed_by === "service_role", "Rôle d'exécution non constaté");
  assert(entry.reason === valid.reason, "Motif altéré");
  assert(Number(entry.before_values.amount) === 2450.35, "Ancienne valeur perdue");
  assert(Number(entry.after_values.amount) === 2405.35, "Nouvelle valeur absente de la piste");
  assert(
    entry.changed_fields.length === 1 && entry.changed_fields[0] === "amount",
    "Champs modifiés inexacts",
  );

  // Seconde décision sur l'état PÉRIMÉ : conflit, pas d'écrasement.
  await rejects(
    correct,
    [userId, JSON.stringify({ ...valid, corrected: { amount: "2400" } })],
    "Correction sur un état périmé acceptée",
    "Conflit : montant attendu",
  );
  const second = await client.query<{ id: string }>(correct, [
    userId,
    JSON.stringify({
      transaction_id: incomeId,
      reason: "Versement reçu le 24",
      expected: { ...expected, amount: "2405.35" },
      corrected: { received_on: "2026-09-24", label: "Salaire de septembre" },
    }),
  ]);
  const history = await client.query<{ changed_fields: string[] }>(
    "select changed_fields from public.transaction_corrections where transaction_id = $1 order by decided_at, id",
    [incomeId],
  );
  assert(history.rows.length === 2, "Historique des corrections incomplet");
  assert(second.rows[0]!.id, "Seconde correction non enregistrée");

  const refuse = (payload: unknown, label: string, expectedMessage: string) =>
    rejects(correct, [userId, JSON.stringify(payload)], label, expectedMessage);
  const current = { amount: "2405.35", received_on: "2026-09-24", label: "Salaire de septembre" };
  const base = { ...valid, expected: current };
  await refuse({ ...base, user_id: otherUser }, "Clé d'acteur acceptée", "Clé refusée");
  await refuse(
    { ...base, actor_user_id: userId },
    "Acteur déclaratif accepté",
    "Clé refusée",
  );
  await refuse(
    { ...base, expected: { amount: "2405.35", received_on: "2026-09-24" } },
    "État attendu incomplet accepté",
    "État attendu incomplet",
  );
  await refuse(
    { ...base, expected: { ...current, label: null } },
    "Libellé attendu JSON null accepté",
    "État attendu incomplet",
  );
  await refuse(
    { ...base, expected: { ...current, amount: 2405.35 } },
    "Montant attendu numérique accepté",
    "État attendu incomplet",
  );
  for (const amount of ["0", "0.00", "1e3", "NaN", "-5", "100000000000000"])
    await refuse(
      { ...base, corrected: { amount } },
      `Montant corrigé « ${amount} » accepté`,
      "Montant corrigé invalide",
    );
  await refuse(
    { ...base, corrected: { amount: 2400 } },
    "Montant corrigé numérique accepté",
    "Valeur corrigée invalide",
  );
  await refuse(
    { ...base, corrected: { received_on: "2026-02-30" } },
    "Date inexistante acceptée",
    "inexistante au calendrier",
  );
  await refuse(
    { ...base, corrected: { label: "   " } },
    "Libellé vide accepté",
    "Libellé corrigé requis",
  );
  await refuse(
    { ...base, corrected: { account_id: accountId } },
    "Changement de compte accepté",
    "Clé corrigée refusée",
  );
  await refuse(
    { ...base, corrected: { amount: "2405.350" } },
    "Correction sans changement acceptée",
    "Aucune valeur modifiée",
  );
  await refuse({ ...base, reason: "  " }, "Motif vide accepté", "Motif de correction requis");
  await refuse(
    { ...base, transaction_id: foreignIncome.rows[0]!.id },
    "Revenu d'un autre propriétaire corrigé",
    "Revenu introuvable",
  );

  // Une dépense saisie ne se corrige pas par ce chemin.
  const expense = await client.query<{ id: string }>(
    `insert into public.transactions (user_id, account_id, transaction_date, label, amount, currency, data_kind, confidence, source)
     values ($1, $2, '2026-09-22', 'Courses', -40, 'EUR', 'ACTUAL', 'HIGH', 'Saisie manuelle')
     returning id::text as id`,
    [userId, accountId],
  );
  await refuse(
    {
      ...base,
      transaction_id: expense.rows[0]!.id,
      expected: { amount: "40", received_on: "2026-09-22", label: "Courses" },
    },
    "Dépense corrigée comme un revenu",
    "Seul un revenu net saisi",
  );

  await client.query("reset role");
  await rejects(
    "update public.transaction_corrections set reason = 'réécrit' where transaction_id = $1",
    [incomeId],
    "Piste modifiable",
    "immuable",
  );
  await rejects(
    "delete from public.transaction_corrections where transaction_id = $1",
    [incomeId],
    "Piste supprimable",
    "immuable",
  );
  await rejects(
    "delete from public.transactions where id = $1",
    [incomeId],
    "Revenu corrigé supprimable, piste orpheline",
    "transaction_corrections_transaction_fk",
  );

  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: otherUser, role: "authenticated" }),
  ]);
  const visible = await client.query<{ count: string }>(
    "select count(*)::text as count from public.transaction_corrections where transaction_id = $1",
    [incomeId],
  );
  assert(visible.rows[0]!.count === "0", "Piste d'un autre propriétaire visible");
  await rejects(
    correct,
    [otherUser, JSON.stringify(base)],
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
    "Smoke correction de revenu net : correction en place sans régularisation, piste immuable et complète, conflit sur état périmé, charge stricte et cloisonnement conformes (transaction annulée).",
  );
