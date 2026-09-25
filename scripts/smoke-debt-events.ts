/**
 * Smoke transactionnel des événements et versions de dette (B18, `20260925130000`). Toutes
 * les écritures sont annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * chaque enregistrement du contrat laisse une version immuable (création, correction
 *     motivée) ;
 *   * un événement contractuel (révision de taux, palier, report, avenant) s'écrit avec sa
 *     date d'effet et sa source, sans toucher au contrat ni à l'encours ;
 *   * un remboursement EFFECTUÉ n'est jamais daté après aujourd'hui ; avec l'encours constaté
 *     par le prêteur, il écrit une observation ACTUAL dans la même transaction ; PRÉVU, il est
 *     daté dans le futur et n'écrit aucun encours ; le solde total constate un encours nul ;
 *   * le contenu est fermé par nature, les montants voyagent en texte décimal ;
 *   * annuler ajoute une trace motivée, une seule fois ; rien ne se modifie ni ne s'efface ;
 *   * une dette encours seul, archivée ou d'un autre propriétaire refuse l'événement ;
 *   * lecture seule et cloisonnement pour `authenticated`.
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
async function outcome(sql: string, params: unknown[]): Promise<string> {
  await client.query("savepoint smoke_guard");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint smoke_guard");
    return "OK";
  } catch (error) {
    await client.query("rollback to savepoint smoke_guard");
    return (error as { code?: string }).code ?? "?";
  }
}
async function refuses(sql: string, params: unknown[], label: string, code: string) {
  const got = await outcome(sql, params);
  assert(got === code, `${label} : obtenu ${got}, attendu ${code}`);
}

let succeeded = false;
await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");
  const dates = (
    await client.query<{ today: string; tomorrow: string }>(
      `select (now() at time zone 'Europe/Paris')::date::text as today,
              ((now() at time zone 'Europe/Paris')::date + 1)::text as tomorrow`,
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
    `smoke-events-${otherUser}@invalid`,
  ]);
  await client.query("set local role service_role");

  const contract = {
    liability_id: null,
    name: "Prêt événements",
    lender: "Banque",
    principal: 12000,
    initial_balance: 12000,
    balance_date: "2026-01-01",
    annual_rate: 0.03,
    payment_amount: 1000,
    payment_count: null,
    first_payment_date: "2026-02-05",
    maturity_date: null,
    amortisation_profile: "AMORTIZING",
    balloon_amount: null,
    payment_frequency: "MONTHLY",
    interest_convention: "PROPORTIONAL",
    rate_type: "FIXED",
    insurance_amount: null,
    recurring_fees: 0,
    payment_includes_insurance: false,
    insurance_mode: "NONE",
    insurance_policies: [],
    deferral: null,
    facility_id: null,
    notes: null,
    rate_schedule: [],
    payment_schedule: [],
    early_repayments: [],
    charges: [],
    provided_schedule: [],
  };
  const save = "select public.lfo_save_debt_contract($1::uuid, $2::jsonb)::text as id";
  const debtId = (await client.query<{ id: string }>(save, [userId, JSON.stringify(contract)]))
    .rows[0]!.id;
  await client.query(save, [
    userId,
    JSON.stringify({
      ...contract,
      liability_id: debtId,
      initial_balance: null,
      balance_date: null,
      lender: "Banque corrigée",
      change_reason: "Nom du prêteur mal saisi",
    }),
  ]);
  const versions = (
    await client.query<{
      version_no: number;
      change_kind: string;
      change_reason: string | null;
      lender: string;
    }>(
      `select version_no, change_kind, change_reason, terms ->> 'lender' as lender
         from public.liability_contract_versions where liability_id = $1 order by version_no`,
      [debtId],
    )
  ).rows;
  assert(
    versions.length === 2 &&
      versions[0]!.change_kind === "INITIAL" &&
      versions[0]!.lender === "Banque" &&
      versions[1]!.change_kind === "CORRECTION" &&
      versions[1]!.change_reason === "Nom du prêteur mal saisi",
    `Versions de contrat inattendues : ${JSON.stringify(versions)}`,
  );

  const record = "select public.lfo_record_debt_event($1::uuid, $2::jsonb)::text as id";
  const event = (
    kind: string,
    nature: string,
    date: string,
    content: Record<string, unknown>,
    liability = debtId,
  ) =>
    JSON.stringify({
      liability_id: liability,
      event_kind: kind,
      nature,
      effective_date: date,
      source: "Smoke",
      content,
    });
  const balanceOf = async () =>
    (
      await client.query<{ balance: string }>(
        "select current_balance::text as balance from public.liabilities where id = $1",
        [debtId],
      )
    ).rows[0]!.balance;
  const observations = async () =>
    Number(
      (
        await client.query<{ n: string }>(
          "select count(*)::text as n from public.liability_balance_observations where liability_id = $1",
          [debtId],
        )
      ).rows[0]!.n,
    );

  // Contractuels : aucune écriture d'encours.
  const obsBefore = await observations();
  const rateId = (
    await client.query<{ id: string }>(record, [
      userId,
      event("RATE_CHANGE", "CONTRACTUAL", "2027-01-05", { annual_rate: "0.025" }),
    ])
  ).rows[0]!.id;
  await client.query(record, [
    userId,
    event("PAYMENT_CHANGE", "CONTRACTUAL", "2027-03-05", { payment_amount: "900" }),
  ]);
  await client.query(record, [
    userId,
    event("DEFERRAL", "CONTRACTUAL", "2027-06-05", {
      months: 3,
      deferral_kind: "PRINCIPAL_ONLY",
      interest_treatment: "PAID",
      term_effect: "EXTEND_TERM",
    }),
  ]);
  await client.query(record, [
    userId,
    event("AMENDMENT", "CONTRACTUAL", "2027-09-05", { annual_rate: "0.02", note: "Renégociation" }),
  ]);
  await client.query(record, [
    userId,
    event("AMENDMENT", "CONTRACTUAL", "2027-10-05", { maturity_date: "2029-10-05" }),
  ]);
  await refuses(
    record,
    [userId, event("AMENDMENT", "CONTRACTUAL", "2027-10-05", { maturity_date: "2027-10-05" })],
    "Avenant dont la nouvelle fin précède l'effet",
    "LF422",
  );
  assert((await observations()) === obsBefore, "Un événement contractuel a écrit un encours");

  // Remboursements.
  await refuses(
    record,
    [
      userId,
      event("EARLY_REPAYMENT", "OBSERVED", dates.tomorrow, {
        amount: "1000",
        penalty: null,
        outcome: "SHORTEN_TERM",
      }),
    ],
    "Remboursement effectué daté de demain",
    "LF425",
  );
  await refuses(
    record,
    [
      userId,
      event("EARLY_REPAYMENT", "PLANNED", dates.today, {
        amount: "1000",
        penalty: null,
        outcome: "SHORTEN_TERM",
      }),
    ],
    "Remboursement prévu daté d'aujourd'hui",
    "LF422",
  );
  await refuses(
    record,
    [
      userId,
      event("EARLY_REPAYMENT", "PLANNED", dates.tomorrow, {
        amount: "1000",
        penalty: null,
        outcome: "SHORTEN_TERM",
        balance_after: "10",
      }),
    ],
    "Encours constaté sur un remboursement prévu",
    "LF422",
  );
  const planned = (
    await client.query<{ id: string }>(record, [
      userId,
      event("EARLY_REPAYMENT", "PLANNED", dates.tomorrow, {
        amount: "1000",
        penalty: null,
        outcome: "UNKNOWN",
      }),
    ])
  ).rows[0]!.id;
  assert((await observations()) === obsBefore, "Un remboursement prévu a écrit un encours");
  const observed = (
    await client.query<{ id: string }>(record, [
      userId,
      event("EARLY_REPAYMENT", "OBSERVED", dates.today, {
        amount: "2000",
        penalty: "30",
        outcome: "REDUCE_PAYMENT",
        balance_after: "8500.50",
      }),
    ])
  ).rows[0]!.id;
  const link = (
    await client.query<{
      observation_id: string | null;
      data_kind: string;
      balance: string;
      observed_at: string;
    }>(
      `select e.observation_id::text, o.data_kind, o.balance::text, o.observed_at::text
         from public.liability_events e join public.liability_balance_observations o on o.id = e.observation_id
        where e.id = $1`,
      [observed],
    )
  ).rows[0];
  assert(
    link &&
      link.data_kind === "ACTUAL" &&
      Number(link.balance) === 8500.5 &&
      link.observed_at === dates.today,
    `Encours constaté non écrit atomiquement : ${JSON.stringify(link)}`,
  );
  assert(
    Number(await balanceOf()) === 8500.5,
    "L'encours courant ne suit pas l'observation constatée",
  );

  // Contenu fermé, montants en texte.
  await refuses(
    record,
    [userId, event("RATE_CHANGE", "CONTRACTUAL", "2027-01-05", { annual_rate: 0.02 })],
    "Taux numérique JSON accepté",
    "LF422",
  );
  await refuses(
    record,
    [userId, event("RATE_CHANGE", "CONTRACTUAL", "2027-01-05", { annual_rate: "2e-2" })],
    "Notation exponentielle acceptée",
    "LF422",
  );
  await refuses(
    record,
    [
      userId,
      event("RATE_CHANGE", "CONTRACTUAL", "2027-01-05", {
        annual_rate: "0.02",
        user_id: otherUser,
      }),
    ],
    "Clé de contenu d'acteur acceptée",
    "LF422",
  );
  await refuses(
    record,
    [
      userId,
      JSON.stringify({
        ...JSON.parse(event("RATE_CHANGE", "CONTRACTUAL", "2027-01-05", { annual_rate: "0.02" })),
        actor_user_id: otherUser,
      }),
    ],
    "Clé d'acteur acceptée",
    "LF422",
  );
  await refuses(
    record,
    [userId, event("RATE_CHANGE", "OBSERVED", "2026-01-05", { annual_rate: "0.02" })],
    "Révision de taux « observée » acceptée",
    "23514",
  );
  await refuses(
    record,
    [userId, event("AMENDMENT", "CONTRACTUAL", "2027-01-05", { note: "rien" })],
    "Avenant sans changement accepté",
    "LF422",
  );
  await refuses(
    record,
    [
      userId,
      event("DEFERRAL", "CONTRACTUAL", "2027-01-05", {
        months: 0,
        deferral_kind: "TOTAL",
        interest_treatment: "UNKNOWN",
        term_effect: "UNKNOWN",
      }),
    ],
    "Report de zéro mois accepté",
    "LF422",
  );
  await refuses(
    record,
    [
      userId,
      event("DEFERRAL", "CONTRACTUAL", "2027-01-05", {
        months: 2,
        deferral_kind: "TOTAL",
        interest_treatment: "UNKNOWN",
      }),
    ],
    "Report sans effet sur la durée accepté",
    "LF422",
  );
  await refuses(
    record,
    [
      userId,
      event("EARLY_REPAYMENT", "OBSERVED", dates.today, {
        amount: "0",
        penalty: null,
        outcome: "UNKNOWN",
      }),
    ],
    "Remboursement nul accepté",
    "LF422",
  );

  // Annulation.
  const cancel = "select public.lfo_cancel_debt_event($1::uuid, $2::uuid, $3::text)";
  await refuses(cancel, [userId, rateId, "  "], "Annulation sans motif acceptée", "23514");
  await client.query(cancel, [userId, rateId, "Révision saisie sur le mauvais prêt"]);
  await refuses(cancel, [userId, rateId, "Deux fois"], "Double annulation acceptée", "LF409");
  await refuses(
    cancel,
    [otherUser, planned, "Pas à moi"],
    "Annulation par un autre acceptée",
    "LF404",
  );
  const stillThere = (
    await client.query<{ n: string }>(
      "select count(*)::text as n from public.liability_events where id = $1",
      [rateId],
    )
  ).rows[0]!.n;
  assert(stillThere === "1", "Un événement annulé a disparu");
  await refuses(
    "update public.liability_events set source = 'x' where id = $1",
    [observed],
    "Événement modifié",
    "P0001",
  );
  await refuses(
    "delete from public.liability_contract_versions where liability_id = $1",
    [debtId],
    "Version supprimée",
    "P0001",
  );

  // Périmètre : encours seul, dette d'un autre.
  const outstandingId = (
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
  await refuses(
    record,
    [
      userId,
      event("RATE_CHANGE", "CONTRACTUAL", "2027-01-05", { annual_rate: "0.02" }, outstandingId),
    ],
    "Événement sur un encours seul",
    "LF422",
  );
  await refuses(
    record,
    [otherUser, event("RATE_CHANGE", "CONTRACTUAL", "2027-01-05", { annual_rate: "0.02" })],
    "Événement sur la dette d'un autre",
    "LF404",
  );

  // Solde total : encours nul constaté.
  await client.query(record, [
    userId,
    event("FULL_REPAYMENT", "OBSERVED", dates.today, { amount: "8500.50", penalty: null }),
  ]);
  assert(Number(await balanceOf()) === 0, "Le solde total n'a pas constaté un encours nul");

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
    (
      await client.query<{ n: string }>(
        "select count(*)::text as n from public.liability_events where liability_id = $1",
        [debtId],
      )
    ).rows[0]!.n;
  await actAs(userId);
  assert(Number(await visible()) >= 6, "Le propriétaire ne lit pas son historique");
  await refuses(
    "delete from public.liability_events where liability_id = $1",
    [debtId],
    "Suppression directe",
    "42501",
  );
  await actAs(otherUser);
  assert((await visible()) === "0", "Historique d'un autre propriétaire visible");
  succeeded = true;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
if (succeeded)
  console.log(
    "Smoke événements de dette : versions de contrat immuables et motivées, événements contractuels sans écriture d'encours, remboursement effectué jamais futur et encours constaté atomique, prévu sans encours, solde total à zéro constaté, contenu fermé, annulation motivée et unique, historique immuable, périmètre et cloisonnement conformes (transaction annulée).",
  );
