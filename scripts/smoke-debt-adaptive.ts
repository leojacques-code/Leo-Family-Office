/**
 * Smoke transactionnel du contrat de dette ADAPTATIF (B16). Toutes les écritures sont annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * un contrat amortissable connu par sa SEULE mensualité est accepté : durée et maturité
 *     restent NULL en base (elles sont déduites à la lecture, jamais persistées) ;
 *   * un contrat connu par sa seule durée, ou par sa seule maturité, est accepté ;
 *   * un contrat sans aucun terme de durée est refusé par la BASE ; un in fine connu par sa
 *     seule mensualité aussi (la mensualité ne fixe pas sa durée) ;
 *   * une maturité antérieure à la première échéance et une durée nulle sont refusées ;
 *   * la promotion B16 d'un encours seul accepte le même contrat minimal.
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
    if (!reason.includes(expected))
      throw new Error(`${message} : refus obtenu pour une autre raison (${reason})`);
  }
}

const contract = (overrides: Record<string, unknown>) => ({
  liability_id: null,
  name: "Prêt adaptatif",
  lender: "Banque",
  principal: 1200,
  initial_balance: 1200,
  balance_date: "2026-01-05",
  annual_rate: 0,
  payment_amount: null,
  payment_count: null,
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
  const terms = async (id: string) =>
    (
      await client.query<Record<string, string | null>>(
        `select monthly_payment::text, payment_count::text, maturity_date::text, terms_status
           from public.liabilities where id = $1`,
        [id],
      )
    ).rows[0]!;

  const byPayment = await client.query<{ id: string }>(save, [
    userId,
    JSON.stringify(contract({ payment_amount: 100 })),
  ]);
  const paymentOnly = await terms(byPayment.rows[0]!.id);
  assert(Number(paymentOnly.monthly_payment) === 100, "Mensualité non enregistrée");
  assert(
    paymentOnly.payment_count === null && paymentOnly.maturity_date === null,
    "Une durée ou une maturité a été persistée alors qu'elle n'était pas déclarée",
  );
  const byCount = await client.query<{ id: string }>(save, [
    userId,
    JSON.stringify(contract({ payment_count: 12 })),
  ]);
  assert((await terms(byCount.rows[0]!.id)).monthly_payment === null, "Mensualité inventée");
  await client.query(save, [userId, JSON.stringify(contract({ maturity_date: "2026-12-05" }))]);

  const refuse = (payload: unknown, label: string, expected: string) =>
    rejects(save, [userId, JSON.stringify(payload)], label, expected);
  await refuse(
    contract({}),
    "Contrat sans terme de durée accepté",
    "liabilities_terms_completeness_v2_ck",
  );
  await refuse(
    contract({ amortisation_profile: "BULLET", payment_amount: 10 }),
    "In fine connu par sa seule mensualité accepté",
    "liabilities_terms_completeness_v2_ck",
  );
  await refuse(
    contract({ maturity_date: "2025-12-05" }),
    "Maturité antérieure à la première échéance acceptée",
    "liabilities_contract_dates_ck",
  );
  await refuse(
    contract({ payment_count: 0 }),
    "Durée nulle acceptée",
    "liabilities_payment_count_ck",
  );

  // Promotion B16 d'un encours seul avec le même contrat minimal.
  const outstanding = await client.query<{ id: string }>(
    "select public.lfo_record_outstanding_debt($1::uuid, $2::jsonb)::text as id",
    [
      userId,
      JSON.stringify({
        name: "Prêt familial",
        lender: null,
        balance: "900",
        currency: "EUR",
        observed_at: "2026-09-20",
        notes: null,
      }),
    ],
  );
  const debtId = outstanding.rows[0]!.id;
  await client.query(save, [
    userId,
    JSON.stringify({
      ...contract({ payment_amount: 100 }),
      liability_id: debtId,
      initial_balance: null,
      balance_date: null,
      lender: "Famille",
      promote_outstanding: true,
    }),
  ]);
  const promoted = await terms(debtId);
  assert(promoted.terms_status === "CONTRACT", "Promotion au contrat minimal refusée");
  assert(promoted.payment_count === null, "La promotion a persisté une durée déduite");
  succeeded = true;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
if (succeeded)
  console.log(
    "Smoke contrat de dette adaptatif : mensualité seule, durée seule ou maturité seule acceptées sans terme déduit persisté, contrat sans durée et in fine sans durée refusés par la base, dates et durée contrôlées, promotion au contrat minimal (transaction annulée).",
  );
