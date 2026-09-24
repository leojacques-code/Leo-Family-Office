/**
 * Smoke transactionnel du passage d'une dette encours seul à un contrat (B16). Toutes les
 * écritures sont annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * la MÊME ligne passe à CONTRACT : aucune seconde dette, devise et encours courant
 *     conservés, historique des observations intact ;
 *   * la promotion est une DÉCISION : une édition sans `promote_outstanding: true` est refusée,
 *     comme toute autre forme de la clé, et la clé est refusée sur un contrat et à la création ;
 *   * la décision laisse une trace immuable (acteur = propriétaire, rôle constaté), la dette
 *     tracée n'est plus supprimable, et une seconde promotion est refusée ;
 *   * l'édition d'un contrat ordinaire est inchangée ;
 *   * cloisonnement : dette d'autrui introuvable, trace d'autrui invisible, RPC fermée à
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

const contract = (liabilityId: string | null) => ({
  liability_id: liabilityId,
  name: "Prêt familial",
  lender: "Famille",
  principal: 2000,
  initial_balance: liabilityId ? null : 2000,
  balance_date: liabilityId ? null : "2026-01-05",
  annual_rate: 0.01,
  payment_amount: 100,
  payment_count: 20,
  first_payment_date: "2026-02-05",
  maturity_date: "2027-09-05",
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
});

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
    `smoke-debt-promotion-${otherUser}@invalid`,
  ]);
  await client.query("set local role service_role");

  const record = "select public.lfo_record_outstanding_debt($1::uuid, $2::jsonb)::text as id";
  const outstanding = await client.query<{ id: string }>(record, [
    userId,
    JSON.stringify({
      name: "Prêt familial",
      lender: null,
      balance: "1500.5",
      currency: "CHF",
      observed_at: "2026-09-20",
      notes: null,
    }),
  ]);
  const debtId = outstanding.rows[0]!.id;
  const foreign = await client.query<{ id: string }>(record, [
    otherUser,
    JSON.stringify({
      name: "Dette voisine",
      lender: null,
      balance: "10",
      currency: "EUR",
      observed_at: "2026-09-20",
      notes: null,
    }),
  ]);
  const snapshot = async () =>
    (
      await client.query<{ debts: string; observations: string }>(
        `select (select count(*) from public.liabilities where user_id = $1)::text as debts,
                (select count(*) from public.liability_balance_observations
                  where liability_id = $2)::text as observations`,
        [userId, debtId],
      )
    ).rows[0]!;
  const before = await snapshot();

  const save = "select public.lfo_save_debt_contract($1::uuid, $2::jsonb)::text as id";
  const refuse = (payload: unknown, label: string, expected: string) =>
    rejects(save, [userId, JSON.stringify(payload)], label, expected);
  await refuse(contract(debtId), "Promotion implicite par simple édition", "décision explicite");
  await refuse(
    { ...contract(debtId), promote_outstanding: "true" },
    "Promotion par chaîne acceptée",
    "accepte seulement true",
  );
  await refuse(
    { ...contract(debtId), promote_outstanding: false },
    "Promotion à false acceptée",
    "accepte seulement true",
  );
  await refuse(
    { ...contract(debtId), promote_outstanding: null },
    "Promotion JSON null acceptée",
    "accepte seulement true",
  );
  await refuse(
    { ...contract(null), promote_outstanding: true },
    "Promotion à la création acceptée",
    "Seule une dette existante",
  );
  await refuse(
    { ...contract(foreign.rows[0]!.id), promote_outstanding: true },
    "Dette d'un autre propriétaire promue",
    "Dette introuvable",
  );

  const promoted = await client.query<{ id: string }>(save, [
    userId,
    JSON.stringify({ ...contract(debtId), promote_outstanding: true }),
  ]);
  assert(promoted.rows[0]!.id === debtId, "La promotion a créé une autre dette");
  const after = await snapshot();
  assert(after.debts === before.debts, "Un second passif a été créé");
  assert(after.observations === before.observations, "L'historique des encours a été modifié");
  const row = (
    await client.query<Record<string, string | null>>(
      `select terms_status, currency, current_balance::text, principal::text, annual_rate::text
         from public.liabilities where id = $1`,
      [debtId],
    )
  ).rows[0]!;
  assert(row.terms_status === "CONTRACT", "Statut non promu");
  assert(row.currency === "CHF", "Devise altérée par la promotion");
  assert(Number(row.current_balance) === 1500.5, "Encours observé réécrit par le contrat");
  assert(Number(row.principal) === 2000, "Termes du contrat non enregistrés");
  const trail = (
    await client.query<{ actor_user_id: string; executed_by: string; from_status: string }>(
      `select actor_user_id::text, executed_by, from_status
         from public.liability_terms_transitions where liability_id = $1`,
      [debtId],
    )
  ).rows;
  assert(trail.length === 1, "Décision de promotion non tracée");
  assert(trail[0]!.actor_user_id === userId, "Acteur de la promotion différent du propriétaire");
  assert(trail[0]!.executed_by === "service_role", "Rôle d'exécution non constaté");
  assert(trail[0]!.from_status === "OUTSTANDING_ONLY", "Statut antérieur perdu");

  await refuse(
    { ...contract(debtId), promote_outstanding: true },
    "Seconde promotion acceptée",
    "déjà un contrat",
  );
  // Une édition ordinaire du contrat promu fonctionne, sans nouvelle trace.
  await client.query(save, [userId, JSON.stringify({ ...contract(debtId), annual_rate: 0.015 })]);
  const trailAfterEdit = await client.query<{ count: string }>(
    "select count(*)::text as count from public.liability_terms_transitions where liability_id = $1",
    [debtId],
  );
  assert(
    trailAfterEdit.rows[0]!.count === "1",
    "Une édition ordinaire a été tracée comme promotion",
  );
  // Création et édition d'un contrat ordinaire : inchangées.
  const regular = await client.query<{ id: string }>(save, [
    userId,
    JSON.stringify(contract(null)),
  ]);
  await client.query(save, [
    userId,
    JSON.stringify({ ...contract(regular.rows[0]!.id), annual_rate: 0.02 }),
  ]);

  await client.query("reset role");
  await rejects(
    "update public.liability_terms_transitions set from_status = 'OUTSTANDING_ONLY' where liability_id = $1",
    [debtId],
    "Trace de promotion modifiable",
    "immuable",
  );
  await rejects(
    "delete from public.liability_terms_transitions where liability_id = $1",
    [debtId],
    "Trace de promotion supprimable",
    "immuable",
  );
  await rejects(
    "delete from public.liabilities where id = $1",
    [debtId],
    "Dette promue supprimable, trace orpheline",
    "liability_terms_transitions_liability_fk",
  );

  // Les DEUX réglages : `auth.uid()` du shim local lit `request.jwt.claim.sub`, celui de la
  // plateforme `request.jwt.claims`. Sans le premier, `auth.uid()` vaut NULL et toute
  // assertion d'invisibilité serait vraie par construction.
  const actAs = async (subject: string) => {
    await client.query("reset role");
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [subject, JSON.stringify({ sub: subject, role: "authenticated" })],
    );
    await client.query("set local role authenticated");
  };
  const transitionCount = async () =>
    (
      await client.query<{ count: string }>(
        "select count(*)::text as count from public.liability_terms_transitions where liability_id = $1",
        [debtId],
      )
    ).rows[0]!.count;
  // Contrôle POSITIF d'abord : le propriétaire voit sa trace. Sans lui, un zéro ne prouve rien.
  await actAs(userId);
  assert((await transitionCount()) === "1", "Le propriétaire ne voit pas sa propre trace");
  await actAs(otherUser);
  assert((await transitionCount()) === "0", "Trace d'un autre propriétaire visible");
  await rejects(
    save,
    [otherUser, JSON.stringify({ ...contract(debtId), promote_outstanding: true })],
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
    "Smoke promotion dette encours seul → contrat : même ligne, aucun second passif, devise et historique conservés, décision explicite tracée et immuable, contrats ordinaires inchangés, cloisonnement conforme (transaction annulée).",
  );
