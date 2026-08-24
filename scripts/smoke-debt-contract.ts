/** Smoke test transactionnel des RPC Debt Contract Input. Rollback systématique. */
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

await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '15s'");
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur Supabase disponible pour le smoke test");
  const userId = owner.rows[0].id;
  await client.query("set local role service_role");

  const chargeCashId = randomUUID();
  const chargeFinancedId = randomUUID();
  const repaymentId = randomUUID();
  const payload = {
    liability_id: null,
    name: "Smoke Debt Contract",
    lender: "Smoke Bank",
    principal: 100000,
    initial_balance: 100000,
    balance_date: "2026-08-19",
    annual_rate: 0.036,
    payment_amount: 702.13,
    payment_count: 24,
    first_payment_date: "2026-09-05",
    maturity_date: "2028-08-05",
    amortisation_profile: "AMORTIZING",
    balloon_amount: null,
    payment_frequency: "MONTHLY",
    interest_convention: "ACTUAL_365",
    rate_type: "VARIABLE",
    insurance_amount: null,
    recurring_fees: 0,
    payment_includes_insurance: null,
    deferral: { kind: "TOTAL", months: 1, interest_treatment: "CAPITALISED" },
    facility_id: "smoke-facility",
    notes: "transaction rollback",
    rate_schedule: [{ effective_from: "2027-01-01", annual_rate: 0.04, kind: "ASSUMPTION" }],
    payment_schedule: [{ effective_from: "2027-06-01", amount: 750, kind: "CONTRACTUAL" }],
    early_repayments: [
      {
        id: repaymentId,
        date: "2027-03-15",
        amount: 1000,
        penalty: null,
        outcome: "UNKNOWN",
      },
    ],
    charges: [
      {
        id: chargeCashId,
        date: "2026-10-10",
        amount: 100,
        label: "Frais cash",
        financed: false,
      },
      {
        id: chargeFinancedId,
        date: "2026-11-10",
        amount: 900,
        label: "Frais financés",
        financed: true,
      },
    ],
    provided_schedule: [
      {
        payment_number: 1,
        due_date: "2026-09-05",
        opening_balance: 100000,
        payment: 712,
        interest: 300,
        principal: 400,
        insurance: 10,
        fees: 2,
        closing_balance: 99600,
      },
    ],
  };

  const created = await client.query<{ id: string }>(
    "select public.lfo_save_debt_contract($1::uuid, $2::jsonb) as id",
    [userId, JSON.stringify(payload)],
  );
  const liabilityId = created.rows[0]?.id;
  assert(liabilityId, "La création RPC n’a retourné aucun identifiant");

  const initial = await client.query<{
    current_balance: string;
    monthly_insurance: string | null;
    recurring_fees: string | null;
    actual_rows: string;
    charges: string;
  }>(
    `select l.current_balance::text, l.monthly_insurance::text, l.recurring_fees::text,
            (select count(*)::text from public.loan_schedules s
              where s.liability_id = l.id and s.data_kind = 'ACTUAL') as actual_rows,
            (select count(*)::text from public.loan_charges c
              where c.liability_id = l.id) as charges
       from public.liabilities l where l.id = $1`,
    [liabilityId],
  );
  assert(Number(initial.rows[0]?.current_balance) === 100000, "Encours initial incorrect");
  assert(initial.rows[0]?.monthly_insurance === null, "null assurance non conservé");
  assert(Number(initial.rows[0]?.recurring_fees) === 0, "zéro frais récurrents non conservé");
  assert(Number(initial.rows[0]?.actual_rows) === 1, "Échéancier ACTUAL non persisté");
  assert(Number(initial.rows[0]?.charges) === 2, "Frais ponctuels incomplets");

  await client.query(
    `insert into public.loan_schedules (
       user_id, liability_id, payment_number, due_date, opening_balance, payment,
       interest, principal, insurance, fees, closing_balance, data_kind
     ) values ($1, $2, 2, '2026-10-05', 99600, 712, 299, 401, 10, 2, 99199, 'DERIVED')`,
    [userId, liabilityId],
  );

  await client.query("select public.lfo_save_debt_contract($1::uuid, $2::jsonb)", [
    userId,
    JSON.stringify({
      ...payload,
      liability_id: liabilityId,
      annual_rate: 0.041,
      provided_schedule: [
        ...payload.provided_schedule,
        {
          payment_number: 2,
          due_date: "2026-10-05",
          opening_balance: 99600,
          payment: 712,
          interest: 299,
          principal: 401,
          insurance: 10,
          fees: 2,
          closing_balance: 99199,
        },
      ],
    }),
  ]);
  const afterContractEdit = await client.query<{
    current_balance: string;
    annual_rate: string;
    actual_rows: string;
    derived_rows: string;
  }>(
    `select l.current_balance::text, l.annual_rate::text,
            (select count(*)::text from public.loan_schedules s
              where s.liability_id = l.id and s.data_kind = 'ACTUAL') as actual_rows,
            (select count(*)::text from public.loan_schedules s
              where s.liability_id = l.id and s.data_kind = 'DERIVED') as derived_rows
       from public.liabilities l where id = $1`,
    [liabilityId],
  );
  assert(
    Number(afterContractEdit.rows[0]?.current_balance) === 100000,
    "Une édition contractuelle a réécrit l’encours",
  );
  assert(Number(afterContractEdit.rows[0]?.annual_rate) === 0.041, "Taux édité non persisté");
  assert(Number(afterContractEdit.rows[0]?.actual_rows) === 2, "Priorité ACTUAL incomplète");
  assert(
    Number(afterContractEdit.rows[0]?.derived_rows) === 0,
    "Ligne DERIVED concurrente conservée",
  );

  await client.query(
    "select public.lfo_record_debt_balance($1::uuid, $2::uuid, $3::date, $4::numeric, $5::text)",
    [userId, liabilityId, "2026-08-25", 100900, "frais financé observé"],
  );
  const observed = await client.query<{ current_balance: string; observations: string }>(
    `select l.current_balance::text,
            (select count(*)::text from public.liability_balance_observations o
              where o.liability_id = l.id) as observations
       from public.liabilities l where l.id = $1`,
    [liabilityId],
  );
  assert(Number(observed.rows[0]?.current_balance) === 100900, "Nouvel encours non appliqué");
  assert(Number(observed.rows[0]?.observations) === 2, "Historique d’encours incomplet");

  await client.query(
    "select public.lfo_record_debt_balance($1::uuid, $2::uuid, $3::date, $4::numeric, $5::text)",
    [userId, liabilityId, "2026-08-26", 0, "dette éteinte"],
  );
  await client.query("select public.lfo_archive_debt($1::uuid, $2::uuid)", [userId, liabilityId]);
  const archived = await client.query<{ archived: boolean }>(
    "select archived from public.liabilities where id = $1",
    [liabilityId],
  );
  assert(archived.rows[0]?.archived === true, "Archivage de dette éteinte non appliqué");

  console.log(
    "Smoke Debt Contract vert : création/édition atomiques, null/0, ACTUAL, frais cash/financés, historique d’encours et archivage.",
  );
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
