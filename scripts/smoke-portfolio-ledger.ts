/**
 * Smoke transactionnel des RPC Portfolio Data Foundation. Toutes les écritures sont
 * annulées : aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve : atomicité de l'écriture d'un événement et du titre qu'il
 * désigne, résolution d'un instrument existant plutôt que duplication, refus d'un compte
 * non-enveloppe, unicité des ancrages, respect des contraintes de forme, upsert des
 * conventions d'enveloppe et refus de supprimer un lot encore désigné par une cession.
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

async function rejects(sql: string, params: unknown[], message: string): Promise<void> {
  await client.query("savepoint smoke_guard");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint smoke_guard");
    throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    await client.query("rollback to savepoint smoke_guard");
  }
}

type Counts = { events: string; policies: string; securities: string };

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.portfolio_events)::text as events,
      (select count(*) from public.portfolio_envelope_policies)::text as policies,
      (select count(*) from public.securities)::text as securities
  `);
  return result.rows[0];
}

await client.connect();
const before = await counts();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '15s'");
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
  const userId = owner.rows[0].id;

  const institutionId = randomUUID();
  const peaId = randomUUID();
  const bankId = randomUUID();
  await client.query("insert into public.institutions (id, user_id, name) values ($1, $2, $3)", [
    institutionId,
    userId,
    `Smoke Institution ${institutionId}`,
  ]);
  for (const [id, name, type] of [
    [peaId, "Smoke PEA", "PEA"],
    [bankId, "Smoke Banque", "BANK"],
  ] as const) {
    await client.query(
      `insert into public.financial_accounts
         (id, user_id, institution_id, name, account_type, currency, liquidity, status, data_kind, confidence)
       values ($1, $2, $3, $4, $5, 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
      [id, userId, institutionId, name, type],
    );
  }

  await client.query("set local role service_role");

  // 1. Conventions d'enveloppe : déclaration puis correction par upsert.
  const policyId = await client.query<{ id: string }>(
    "select public.lfo_set_portfolio_envelope_policy($1::uuid, $2::jsonb) as id",
    [
      userId,
      JSON.stringify({
        account_id: peaId,
        lot_matching_method: "FIFO",
        ledger_coverage_start: "2026-01-01",
        ledger_coverage_source: "MANUAL",
        notes: "smoke",
      }),
    ],
  );
  assert(policyId.rows[0]?.id, "Déclaration d'enveloppe non persistée");
  await client.query("select public.lfo_set_portfolio_envelope_policy($1::uuid, $2::jsonb)", [
    userId,
    JSON.stringify({
      account_id: peaId,
      lot_matching_method: null,
      ledger_coverage_start: null,
      ledger_coverage_source: null,
      notes: null,
    }),
  ]);
  const cleared = await client.query<{ count: string; method: string | null }>(
    `select count(*)::text as count, max(lot_matching_method) as method
       from public.portfolio_envelope_policies where account_id = $1`,
    [peaId],
  );
  assert(cleared.rows[0]?.count === "1", "L'upsert a dupliqué la déclaration d'enveloppe");
  assert(cleared.rows[0]?.method === null, "Un null n'a pas effacé la convention déclarée");

  // Une enveloppe ne se déclare pas sur un compte bancaire.
  await rejects(
    "select public.lfo_set_portfolio_envelope_policy($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ account_id: bankId })],
    "Une déclaration d'enveloppe a été acceptée sur un compte bancaire",
  );

  // 2. Ancrage de cash, puis achat créant l'instrument, puis achat le réutilisant.
  const record = async (payload: Record<string, unknown>): Promise<string> => {
    const result = await client.query<{ id: string }>(
      "select public.lfo_record_portfolio_event($1::uuid, $2::jsonb) as id",
      [userId, JSON.stringify(payload)],
    );
    assert(result.rows[0]?.id, "Événement de portefeuille non persisté");
    return result.rows[0].id;
  };

  await record({
    account_id: peaId,
    event_type: "OPENING_CASH",
    event_date: "2026-01-01",
    envelope_cash_amount: 1300,
    currency: "EUR",
    data_kind: "ACTUAL",
    confidence: "HIGH",
  });

  const buyId = await record({
    account_id: peaId,
    event_type: "BUY",
    event_date: "2026-02-05",
    security: { name: "Smoke ETF", ticker: "SMK", isin: "FR0000000001", currency: "EUR" },
    quantity: 20,
    unit_price: 100,
    gross_amount: 2000,
    fee_amount: 5,
    tax_amount: 0,
    envelope_cash_amount: -2005,
    currency: "EUR",
  });

  await record({
    account_id: peaId,
    event_type: "BUY",
    event_date: "2026-03-05",
    // Même ISIN : la RPC doit retrouver l'instrument, pas en créer un second.
    security: { name: "Libellé différent", ticker: null, isin: "fr0000000001", currency: "EUR" },
    quantity: 10,
    unit_price: 110,
    gross_amount: 1100,
    fee_amount: 5,
    tax_amount: 0,
    envelope_cash_amount: -1105,
    currency: "EUR",
  });

  const securityCount = await client.query<{ count: string }>(
    "select count(*)::text as count from public.securities where isin ilike 'FR0000000001'",
  );
  assert(securityCount.rows[0]?.count === "1", "L'instrument a été dupliqué au lieu d'être résolu");

  // 3. Cession désignant un lot existant.
  await record({
    account_id: peaId,
    event_type: "SELL",
    event_date: "2026-04-05",
    security: { name: "Smoke ETF", ticker: null, isin: "FR0000000001", currency: "EUR" },
    quantity: 12,
    unit_price: 120,
    gross_amount: 1440,
    fee_amount: 4,
    tax_amount: 0,
    envelope_cash_amount: 1436,
    currency: "EUR",
    matched_acquisition_event_id: buyId,
  });

  const linked = await client.query<{ count: string }>(
    "select count(*)::text as count from public.portfolio_events where matched_acquisition_event_id = $1",
    [buyId],
  );
  assert(linked.rows[0]?.count === "1", "Lot désigné non persisté");

  // 4. Garde-fous de forme et de propriété.
  await rejects(
    "select public.lfo_record_portfolio_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        account_id: bankId,
        event_type: "CONTRIBUTION",
        event_date: "2026-02-01",
        currency: "EUR",
        envelope_cash_amount: 100,
      }),
    ],
    "Un événement a été accepté sur un compte bancaire",
  );
  await rejects(
    "select public.lfo_record_portfolio_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        account_id: peaId,
        event_type: "OPENING_CASH",
        event_date: "2026-01-02",
        currency: "EUR",
        envelope_cash_amount: 50,
      }),
    ],
    "Un second ancrage de cash a été accepté",
  );
  await rejects(
    "select public.lfo_record_portfolio_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        account_id: peaId,
        event_type: "BUY",
        event_date: "2026-05-05",
        security: { name: "Smoke ETF", ticker: null, isin: "FR0000000001", currency: "EUR" },
        quantity: 0,
        currency: "EUR",
      }),
    ],
    "Un achat de quantité nulle a été accepté",
  );
  await rejects(
    "select public.lfo_record_portfolio_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        account_id: peaId,
        event_type: "CONTRIBUTION",
        event_date: "2026-02-01",
        security: { name: "Smoke ETF", ticker: null, isin: "FR0000000001", currency: "EUR" },
        currency: "EUR",
        envelope_cash_amount: 100,
      }),
    ],
    "Un apport de cash portant un instrument a été accepté",
  );
  await rejects(
    "select public.lfo_record_portfolio_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        account_id: peaId,
        event_type: "TAX",
        event_date: "2026-02-01",
        currency: "EUR",
        envelope_cash_amount: -10,
        counterparty_account_id: bankId,
      }),
    ],
    "Une contrepartie bancaire a été acceptée sur une opération interne",
  );

  // 5. Suppression : refusée tant qu'une cession désigne le lot, acceptée ensuite.
  await rejects(
    "select public.lfo_delete_portfolio_event($1::uuid, $2::uuid)",
    [userId, buyId],
    "Un lot encore désigné par une cession a été supprimé",
  );
  const orphan = await record({
    account_id: peaId,
    event_type: "FEE",
    event_date: "2026-06-01",
    currency: "EUR",
    envelope_cash_amount: -12,
  });
  await client.query("select public.lfo_delete_portfolio_event($1::uuid, $2::uuid)", [
    userId,
    orphan,
  ]);
  const remaining = await client.query<{ count: string }>(
    "select count(*)::text as count from public.portfolio_events where id = $1",
    [orphan],
  );
  assert(remaining.rows[0]?.count === "0", "Suppression d'événement non appliquée");

  await client.query("rollback");
  const after = await counts();
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    `Le smoke a persisté des lignes : before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
  console.log(
    "Smoke Portfolio Ledger vert : conventions upsert et effaçables, instrument résolu sans doublon, ancrages uniques, formes refusées, lot protégé, rollback intégral.",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
