/**
 * Smoke transactionnel de la dette connue par son SEUL encours. Toutes les écritures sont
 * annulées : aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve :
 *
 *   * la RPC écrit la dette et sa première observation datée ATOMIQUEMENT, avec
 *     `terms_status = 'OUTSTANDING_ONLY'` et TOUS les termes à NULL : ni taux, ni mensualité,
 *     ni durée, ni profil, ni fréquence, ni différé par défaut ;
 *   * la charge est stricte : clé d'acteur, clé inconnue, montant numérique JSON, `NaN`,
 *     exponentielle, signe, devise en minuscules et date absente sont refusés par la BASE ;
 *   * la contrainte de complétude refuse une ligne à moitié contractuelle dans les deux sens ;
 *   * une nouvelle observation d'encours (`lfo_record_debt_balance`) s'applique à une dette
 *     encours seul sans toucher ses termes, et l'archivage exige toujours un encours éteint ;
 *   * l'observation d'un autre propriétaire est refusée, et la RPC n'est pas appelable par
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

const TERM_COLUMNS = [
  "principal",
  "annual_rate",
  "monthly_payment",
  "payment_count",
  "first_payment_date",
  "maturity_date",
  "rate_type",
  "deferral_kind",
  "deferral_months",
  "deferral_interest_treatment",
  "amortisation_profile",
  "payment_frequency",
  "interest_convention",
  "monthly_insurance",
  "recurring_fees",
  "payment_includes_insurance",
  "balloon_amount",
  "facility_id",
];

let userId = "";
const record = (payload: unknown) =>
  client.query<{ id: string }>(
    "select public.lfo_record_outstanding_debt($1::uuid, $2::jsonb)::text as id",
    [userId, JSON.stringify(payload)],
  );
const valid = {
  name: "Prêt familial",
  lender: null,
  balance: "1000",
  currency: "EUR",
  observed_at: "2026-09-20",
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
  userId = owner.rows[0].id;
  const otherUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    otherUser,
    `smoke-outstanding-${otherUser}@invalid`,
  ]);
  await client.query("set local role service_role");

  // ── 1. Écriture atomique, termes NULL ────────────────────────────────────────────────
  const created = await record(valid);
  const liabilityId = created.rows[0]?.id;
  assert(liabilityId, "La RPC n'a retourné aucun identifiant");
  const row = await client.query<Record<string, string | null>>(
    `select terms_status, current_balance::text, currency, lender, data_kind, source,
            ${TERM_COLUMNS.map((column) => `${column}::text`).join(", ")}
       from public.liabilities where id = $1`,
    [liabilityId],
  );
  const debt = row.rows[0]!;
  assert(debt.terms_status === "OUTSTANDING_ONLY", "Statut de termes incorrect");
  assert(Number(debt.current_balance) === 1000, "Encours incorrect");
  assert(debt.currency === "EUR" && debt.lender === null, "Devise ou créancier altéré");
  for (const column of TERM_COLUMNS)
    assert(debt[column] === null, `Terme inventé pour une dette encours seul : ${column}`);
  const observations = await client.query<{ balance: string; observed_at: string }>(
    "select balance::text, observed_at::text from public.liability_balance_observations where liability_id = $1",
    [liabilityId],
  );
  assert(
    observations.rows.length === 1 &&
      Number(observations.rows[0]!.balance) === 1000 &&
      observations.rows[0]!.observed_at === "2026-09-20",
    "Première observation absente ou fausse",
  );

  // ── 2. Charge stricte ────────────────────────────────────────────────────────────────
  const sql = "select public.lfo_record_outstanding_debt($1::uuid, $2::jsonb)";
  const refuse = (payload: unknown, label: string, expected: string) =>
    rejects(sql, [userId, JSON.stringify(payload)], label, expected);
  await refuse({ ...valid, user_id: otherUser }, "Clé d'acteur acceptée", "Clé refusée");
  await refuse({ ...valid, annual_rate: "0.03" }, "Terme accepté en encours seul", "Clé refusée");
  await refuse({ ...valid, balance: 1000 }, "Montant numérique JSON accepté", "texte");
  for (const balance of ["NaN", "1e3", "-5", "", "1 000", "1,5"])
    await refuse({ ...valid, balance }, `Encours « ${balance} » accepté`, "Encours invalide");
  await refuse({ ...valid, currency: "eur" }, "Devise en minuscules acceptée", "Devise");
  await refuse({ ...valid, currency: undefined }, "Devise absente acceptée", "Devise");
  await refuse({ ...valid, observed_at: undefined }, "Date absente acceptée", "Date d'observation");
  await refuse({ ...valid, observed_at: null }, "Date JSON null acceptée", "Date d'observation");
  await refuse(
    { ...valid, balance: undefined },
    "Encours absent accepté",
    "Encours attendu en texte",
  );
  await refuse(
    { ...valid, balance: null },
    "Encours JSON null accepté",
    "Encours attendu en texte",
  );
  await refuse({ ...valid, name: "   " }, "Nom vide accepté", "Nom de dette requis");

  // ── 3. Contrainte de complétude, dans les deux sens ──────────────────────────────────
  await rejects(
    "update public.liabilities set annual_rate = 0.03 where id = $1",
    [liabilityId],
    "Terme isolé accepté sur une dette encours seul",
    "liabilities_terms_completeness_ck",
  );
  await rejects(
    `insert into public.liabilities (user_id, name, lender, current_balance, currency,
       data_kind, confidence, terms_status)
     values ($1, 'Contrat sans termes', 'Banque', 10, 'EUR', 'ACTUAL', 'HIGH', 'CONTRACT')`,
    [userId],
    "Contrat sans termes accepté",
    "liabilities_terms_completeness_ck",
  );
  await rejects(
    "update public.liabilities set terms_status = 'OTHER' where id = $1",
    [liabilityId],
    "Statut de termes hors liste accepté",
    // Les deux contraintes le refusent ; PostgreSQL nomme la première évaluée.
    "liabilities_terms_",
  );

  // ── 4. Nouvelle observation et archivage ─────────────────────────────────────────────
  await client.query("select public.lfo_record_debt_balance($1, $2, $3, $4, $5)", [
    userId,
    liabilityId,
    "2026-09-24",
    900,
    null,
  ]);
  const after = await client.query<{
    current_balance: string;
    terms_status: string;
    count: string;
  }>(
    `select l.current_balance::text, l.terms_status,
            (select count(*)::text from public.liability_balance_observations o
              where o.liability_id = l.id) as count
       from public.liabilities l where l.id = $1`,
    [liabilityId],
  );
  assert(
    Number(after.rows[0]!.current_balance) === 900 &&
      after.rows[0]!.terms_status === "OUTSTANDING_ONLY" &&
      after.rows[0]!.count === "2",
    "Nouvelle observation mal appliquée à une dette encours seul",
  );
  await rejects(
    "select public.lfo_archive_debt($1, $2)",
    [userId, liabilityId],
    "Archivage d'une dette non éteinte accepté",
    "Seule une dette éteinte",
  );

  // ── 5. Cloisonnement et droits ───────────────────────────────────────────────────────
  await rejects(
    "select public.lfo_record_debt_balance($1, $2, $3, $4, $5)",
    [otherUser, liabilityId, "2026-09-24", 1, null],
    "Observation acceptée sur la dette d'un autre propriétaire",
    "Dette introuvable",
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
    "Smoke dette encours seul : écriture atomique, termes NULL, charge stricte, complétude, observation, archivage et cloisonnement conformes (transaction annulée).",
  );
