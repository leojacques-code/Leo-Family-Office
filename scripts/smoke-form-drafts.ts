/**
 * Smoke transactionnel des brouillons persistants (`20260925120000`). Toutes les écritures
 * sont annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * un brouillon INCOMPLET s'enregistre, se relit, se modifie sous version attendue et se
 *     supprime ; une version périmée échoue en conflit (LF409) sans écraser la saisie ;
 *   * un brouillon n'écrit rien dans les tables canoniques de dette ;
 *   * un seul brouillon par dette existante ; aucun brouillon sur la dette d'un autre ;
 *   * la charge est stricte (clé inconnue, clé d'acteur, contenu non objet, changement de
 *     nature refusés) ;
 *   * la table est en lecture seule pour `authenticated`, cloisonnée par propriétaire.
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
async function failure(sql: string, params: unknown[]): Promise<{ code: string; message: string }> {
  await client.query("savepoint smoke_guard");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint smoke_guard");
    return { code: "OK", message: "" };
  } catch (error) {
    await client.query("rollback to savepoint smoke_guard");
    const pgError = error as { code?: string; message?: string };
    return { code: pgError.code ?? "?", message: pgError.message ?? "" };
  }
}
async function refuses(sql: string, params: unknown[], label: string, code: string) {
  const result = await failure(sql, params);
  assert(result.code === code, `${label} : ${result.code} ${result.message}`);
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
    `smoke-drafts-${otherUser}@invalid`,
  ]);
  await client.query("set local role service_role");
  const debtCount = async () =>
    (
      await client.query<{ n: string }>(
        `select (select count(*) from public.liabilities where user_id = $1)
              + (select count(*) from public.liability_balance_observations where user_id = $1) as n`,
        [userId],
      )
    ).rows[0]!.n;
  const before = await debtCount();

  const save = "select public.lfo_save_form_draft($1::uuid, $2::jsonb) as result";
  const incomplete = {
    domain: "DEBT",
    kind: "DEBT_CONTRACT_NEW",
    subject_id: null,
    title: "Prêt immobilier",
    schema_version: 1,
    content: { contract: { name: "Prêt immobilier", principal: null }, structure: { mode: "" } },
  };
  const created = (
    await client.query<{ result: { id: string; version: number } }>(save, [
      userId,
      JSON.stringify(incomplete),
    ])
  ).rows[0]!.result;
  assert(created.version === 1, "Version initiale inattendue");
  assert((await debtCount()) === before, "Un brouillon a écrit une dette ou une observation");

  const updated = (
    await client.query<{ result: { version: number } }>(save, [
      userId,
      JSON.stringify({
        ...incomplete,
        draft_id: created.id,
        expected_version: 1,
        content: { ...incomplete.content, structure: { mode: "AMORTIZING" } },
      }),
    ])
  ).rows[0]!.result;
  assert(updated.version === 2, "La modification n'a pas incrémenté la version");
  await refuses(
    save,
    [userId, JSON.stringify({ ...incomplete, draft_id: created.id, expected_version: 1 })],
    "Version périmée acceptée",
    "LF409",
  );
  const stored = (
    await client.query<{ mode: string; version: number }>(
      "select content #>> '{structure,mode}' as mode, version from public.form_drafts where id = $1",
      [created.id],
    )
  ).rows[0]!;
  assert(stored.mode === "AMORTIZING" && stored.version === 2, "Le conflit a écrasé la saisie");

  // Charge stricte.
  await refuses(
    save,
    [userId, JSON.stringify({ ...incomplete, user_id: otherUser })],
    "Clé d'acteur acceptée",
    "LF422",
  );
  await refuses(
    save,
    [userId, JSON.stringify({ ...incomplete, content: [] })],
    "Contenu non objet accepté",
    "LF422",
  );
  await refuses(
    save,
    [
      userId,
      JSON.stringify({
        ...incomplete,
        draft_id: created.id,
        expected_version: 2,
        kind: "DEBT_CONTRACT_EDIT",
        subject_id: randomUUID(),
      }),
    ],
    "Changement de nature accepté",
    "LF422",
  );
  await refuses(
    save,
    [userId, JSON.stringify({ ...incomplete, domain: "TAX" })],
    "Domaine hors liste accepté",
    "23514",
  );

  // Un brouillon par dette existante ; jamais sur la dette d'un autre.
  const debtId = (
    await client.query<{ id: string }>(
      "select public.lfo_record_outstanding_debt($1::uuid, $2::jsonb)::text as id",
      [
        userId,
        JSON.stringify({
          name: "Prêt familial",
          lender: null,
          balance: "1000",
          currency: "EUR",
          observed_at: "2026-09-20",
        }),
      ],
    )
  ).rows[0]!.id;
  const promotion = { ...incomplete, kind: "DEBT_CONTRACT_PROMOTION", subject_id: debtId };
  await client.query(save, [userId, JSON.stringify(promotion)]);
  await refuses(
    save,
    [userId, JSON.stringify(promotion)],
    "Second brouillon pour la même dette accepté",
    "LF409",
  );
  await refuses(
    save,
    [otherUser, JSON.stringify(promotion)],
    "Brouillon sur la dette d'un autre accepté",
    "23503",
  );

  // Suppression sous version attendue.
  const remove = "select public.lfo_delete_form_draft($1::uuid, $2::uuid, $3::integer)";
  await refuses(
    remove,
    [userId, created.id, 1],
    "Suppression sur version périmée acceptée",
    "LF409",
  );
  await refuses(
    remove,
    [otherUser, created.id, 2],
    "Suppression du brouillon d'un autre acceptée",
    "LF404",
  );
  await client.query(remove, [userId, created.id, 2]);
  await refuses(remove, [userId, created.id, 2], "Brouillon supprimé deux fois", "LF404");

  // Lecture seule et cloisonnement.
  const actAs = async (subject: string) => {
    await client.query("reset role");
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [subject, JSON.stringify({ sub: subject, role: "authenticated" })],
    );
    await client.query("set local role authenticated");
  };
  const visible = async () =>
    (await client.query<{ n: string }>("select count(*)::text as n from public.form_drafts"))
      .rows[0]!.n;
  await actAs(userId);
  assert((await visible()) === "1", "Le propriétaire ne voit pas son brouillon");
  await refuses("delete from public.form_drafts", [], "Suppression directe acceptée", "42501");
  await refuses(
    "insert into public.form_drafts (user_id, domain, kind, title, content, schema_version) values (auth.uid(), 'DEBT', 'DEBT_CONTRACT_NEW', 't', '{}', 1)",
    [],
    "Insertion directe acceptée",
    "42501",
  );
  await actAs(otherUser);
  assert((await visible()) === "0", "Brouillon d'un autre propriétaire visible");
  succeeded = true;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
if (succeeded)
  console.log(
    "Smoke brouillons : brouillon incomplet enregistré sans aucune écriture canonique, version attendue et conflit sans écrasement, charge stricte, un brouillon par dette, suppression versionnée, lecture seule et cloisonnement conformes (transaction annulée).",
  );
