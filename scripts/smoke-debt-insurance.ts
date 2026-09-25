/**
 * Smoke transactionnel de l'assurance emprunteur SÉPARÉE (B17). Toutes les écritures sont
 * annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * un contrat en mode SEPARATE écrit sa police, ses assurés (quotités) et ses périodes de
 *     prime, sans prime par échéance sur le prêt : un coût, une fois ;
 *   * le choix d'assurance est une valeur fermée, et la base refuse les incohérences :
 *     SEPARATE sans police, polices hors SEPARATE, prime par échéance en mode SEPARATE,
 *     INCLUDED sans assurance dans le paiement, quotité hors ]0 ; 1], dates inversées ;
 *   * une réédition remplace les polices en bloc, sans en laisser d'orpheline ;
 *   * les détails de police (couverture, base assurée, compte débité) sont facultatifs,
 *     persistés tels que déclarés, et la base refuse une couverture inversée, une base hors
 *     liste, une chaîne vide et le compte d'un autre propriétaire ;
 *   * les tables sont en lecture seule pour `authenticated`, et cloisonnées.
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

const policy = {
  insurer: "Assureur",
  contract_reference: "C-1",
  insured: [
    { name: "Emprunteur A", coverage_share: 1 },
    { name: "Emprunteur B", coverage_share: 0.5 },
  ],
  periods: [
    {
      first_debit_date: "2026-01-15",
      last_debit_date: "2026-06-15",
      frequency: "MONTHLY",
      premium_amount: 5,
    },
    {
      first_debit_date: "2026-07-15",
      last_debit_date: null,
      frequency: "MONTHLY",
      premium_amount: 3,
    },
  ],
};
const contract = (overrides: Record<string, unknown>) => ({
  liability_id: null,
  name: "Prêt O03",
  lender: "Banque",
  principal: 1200,
  initial_balance: 1200,
  balance_date: "2026-01-01",
  annual_rate: 0,
  payment_amount: 100,
  payment_count: 12,
  first_payment_date: "2026-01-05",
  maturity_date: null,
  amortisation_profile: "AMORTIZING",
  balloon_amount: null,
  payment_frequency: "MONTHLY",
  interest_convention: "PROPORTIONAL",
  rate_type: "FIXED",
  insurance_amount: null,
  recurring_fees: 0,
  payment_includes_insurance: false,
  insurance_mode: "SEPARATE",
  insurance_policies: [policy],
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
  const otherUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    otherUser,
    `smoke-insurance-${otherUser}@invalid`,
  ]);
  const accountId = randomUUID();
  const foreignAccountId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, 'Compte smoke', 'CHECKING', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH'),
            ($3, $4, 'Compte d''un autre', 'CHECKING', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [accountId, userId, foreignAccountId, otherUser],
  );
  await client.query("set local role service_role");
  const save = "select public.lfo_save_debt_contract($1::uuid, $2::jsonb)::text as id";

  const created = await client.query<{ id: string }>(save, [userId, JSON.stringify(contract({}))]);
  const debtId = created.rows[0]!.id;
  const row = (
    await client.query<Record<string, string | null>>(
      `select insurance_mode, monthly_insurance::text, payment_includes_insurance::text,
              (select count(*) from public.loan_insurance_policies p where p.liability_id = l.id)::text as policies,
              (select count(*) from public.loan_insurance_insured i
                 join public.loan_insurance_policies p on p.id = i.policy_id
                where p.liability_id = l.id)::text as insured,
              (select count(*) from public.loan_insurance_periods r
                 join public.loan_insurance_policies p on p.id = r.policy_id
                where p.liability_id = l.id)::text as periods
         from public.liabilities l where l.id = $1`,
      [debtId],
    )
  ).rows[0]!;
  assert(row.insurance_mode === "SEPARATE", "Choix d'assurance non enregistré");
  assert(row.monthly_insurance === null, "Une prime par échéance a été enregistrée en mode séparé");
  assert(
    row.policies === "1" && row.insured === "2" && row.periods === "2",
    "Police, assurés ou périodes incomplets",
  );

  const refuse = (payload: unknown, label: string, expected: string) =>
    rejects(save, [userId, JSON.stringify(payload)], label, expected);
  await refuse(
    contract({ insurance_mode: "PARTIAL" }),
    "Choix hors liste accepté",
    "Choix d'assurance invalide",
  );
  await refuse(
    contract({ insurance_policies: [] }),
    "Assurance séparée sans police acceptée",
    "exige au moins une police",
  );
  await refuse(
    contract({ insurance_mode: "NONE" }),
    "Police déclarée sans assurance séparée acceptée",
    "ne se déclarent qu'avec une assurance séparée",
  );
  await refuse(
    contract({ insurance_amount: 5 }),
    "Prime par échéance en mode séparé acceptée",
    "liabilities_insurance_consistency_ck",
  );
  await refuse(
    contract({
      insurance_mode: "INCLUDED",
      insurance_policies: [],
      payment_includes_insurance: false,
    }),
    "Assurance incluse hors du paiement acceptée",
    "liabilities_insurance_consistency_ck",
  );
  await refuse(
    contract({
      insurance_policies: [{ ...policy, insured: [{ name: "A", coverage_share: 1.5 }] }],
    }),
    "Quotité supérieure à 100 % acceptée",
    "loan_insurance_insured_share_ck",
  );
  await refuse(
    contract({
      insurance_policies: [
        {
          ...policy,
          periods: [
            {
              first_debit_date: "2026-06-15",
              last_debit_date: "2026-01-15",
              frequency: "MONTHLY",
              premium_amount: 5,
            },
          ],
        },
      ],
    }),
    "Période aux dates inversées acceptée",
    "loan_insurance_periods_dates_ck",
  );
  await refuse(
    contract({ insurance_policies: [{ ...policy, periods: [] }] }),
    "Police sans période acceptée",
    "au moins une période",
  );

  // Détails de police : absents = inconnus ; déclarés = persistés tels quels.
  const detailed = await client.query<{ id: string }>(save, [
    userId,
    JSON.stringify(
      contract({
        name: "Prêt détaillé",
        insurance_policies: [
          {
            ...policy,
            effective_date: "2026-01-01",
            end_date: "2026-12-31",
            insured_base: "OUTSTANDING_CAPITAL",
            debit_account_id: accountId,
          },
        ],
      }),
    ),
  ]);
  const details = (
    await client.query<Record<string, string | null>>(
      `select effective_date::text, end_date::text, insured_base, debit_account_id::text
         from public.loan_insurance_policies where liability_id = $1`,
      [detailed.rows[0]!.id],
    )
  ).rows[0]!;
  assert(
    details.effective_date === "2026-01-01" &&
      details.end_date === "2026-12-31" &&
      details.insured_base === "OUTSTANDING_CAPITAL" &&
      details.debit_account_id === accountId,
    `Détails de police non persistés tels que déclarés : ${JSON.stringify(details)}`,
  );
  const unknownDetails = (
    await client.query<Record<string, string | null>>(
      `select effective_date::text, end_date::text, insured_base, debit_account_id::text
         from public.loan_insurance_policies where liability_id = $1`,
      [debtId],
    )
  ).rows[0]!;
  assert(
    Object.values(unknownDetails).every((value) => value === null),
    "Un détail de police absent a reçu une valeur",
  );
  await refuse(
    contract({
      insurance_policies: [{ ...policy, effective_date: "2026-12-31", end_date: "2026-01-01" }],
    }),
    "Couverture inversée acceptée",
    "loan_insurance_policies_coverage_dates_ck",
  );
  await refuse(
    contract({ insurance_policies: [{ ...policy, insured_base: "PRIME" }] }),
    "Base assurée hors liste acceptée",
    "loan_insurance_policies_insured_base_ck",
  );
  await refuse(
    contract({ insurance_policies: [{ ...policy, end_date: "" }] }),
    "Date de fin vide acceptée comme inconnue",
    "valeur vide",
  );
  await refuse(
    contract({ insurance_policies: [{ ...policy, debit_account_id: foreignAccountId }] }),
    "Compte d'un autre propriétaire accepté comme compte débité",
    "loan_insurance_policies_debit_account_fk",
  );

  // Réédition : remplacement en bloc, aucune police orpheline.
  await client.query(save, [
    userId,
    JSON.stringify({
      ...contract({ insurance_mode: "NONE", insurance_policies: [] }),
      liability_id: debtId,
      initial_balance: null,
      balance_date: null,
    }),
  ]);
  const after = await client.query<{ count: string }>(
    "select count(*)::text as count from public.loan_insurance_policies where liability_id = $1",
    [debtId],
  );
  assert(after.rows[0]!.count === "0", "Une police orpheline a survécu au changement de choix");

  // Lecture seule et cloisonnement.
  await client.query(save, [
    userId,
    JSON.stringify({
      ...contract({}),
      liability_id: debtId,
      initial_balance: null,
      balance_date: null,
    }),
  ]);
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
        "select count(*)::text as count from public.loan_insurance_policies where liability_id = $1",
        [debtId],
      )
    ).rows[0]!.count;
  await actAs(userId);
  assert((await visible()) === "1", "Le propriétaire ne voit pas sa police");
  await rejects(
    "delete from public.loan_insurance_policies where liability_id = $1",
    [debtId],
    "Police supprimable par authenticated",
    "permission denied",
  );
  await actAs(otherUser);
  assert((await visible()) === "0", "Police d'un autre propriétaire visible");
  succeeded = true;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
if (succeeded)
  console.log(
    "Smoke assurance séparée : police, assurés et périodes écrits sans prime par échéance, choix fermé, incohérences refusées par la base, remplacement sans orpheline, lecture seule et cloisonnement conformes (transaction annulée).",
  );
