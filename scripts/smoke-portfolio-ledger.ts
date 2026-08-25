/**
 * Smoke transactionnel des RPC Portfolio Data Foundation. Toutes les écritures sont
 * annulées : aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve : atomicité de l'écriture d'un événement et du titre qu'il
 * désigne, résolution d'un instrument existant plutôt que duplication, refus d'un compte
 * non-enveloppe, unicité des ancrages, respect des contraintes de forme, upsert des
 * conventions d'enveloppe et refus de supprimer un lot encore désigné par une cession.
 *
 * Il prouve aussi les intégrités qui ne passent PAS par les RPC, en écrivant directement
 * dans la table : un lot désigné hors de son propriétaire, de son enveloppe, de son
 * instrument ou d'une nature qui ouvre un lot est refusé par la base, la RPC refuse une
 * acquisition future, une désignation légitime reste acceptée, et la suppression d'une
 * transaction bancaire détache le lien sans emporter `user_id`.
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

/**
 * Vérifie qu'une écriture est refusée, et par le BON contrôle.
 *
 * Accepter n'importe quelle erreur laisserait un smoke vert sur une faute de frappe : le
 * test prouverait alors que la requête est cassée, pas que la contrainte protège.
 */
async function rejects(
  sql: string,
  params: unknown[],
  message: string,
  expected?: string,
): Promise<void> {
  await client.query("savepoint smoke_guard");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint smoke_guard");
    throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    await client.query("rollback to savepoint smoke_guard");
    const reason = error instanceof Error ? error.message : String(error);
    if (expected && !reason.includes(expected)) {
      throw new Error(`${message} : refus obtenu pour une autre raison (${reason})`);
    }
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

  // Second propriétaire et seconde enveloppe : ils servent à prouver le cloisonnement des
  // lots. Créés avant le passage en `service_role`, qui n'écrit pas dans le schéma `auth`.
  const ctoId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, institution_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, $3, 'Smoke CTO', 'CTO', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [ctoId, userId, institutionId],
  );
  const foreignUser = randomUUID();
  const foreignAccountId = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    foreignUser,
    `smoke-${foreignUser}@invalid`,
  ]);
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, 'Smoke PEA voisin', 'PEA', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [foreignAccountId, foreignUser],
  );
  const foreignSecurityId = randomUUID();
  await client.query(
    "insert into public.securities (id, user_id, name, currency) values ($1, $2, 'ETF voisin', 'EUR')",
    [foreignSecurityId, foreignUser],
  );

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

  // Une acquisition déjà enregistrée mais économiquement future ne peut jamais porter le
  // coût d'une cession antérieure. La FK garantit la structure ; cette règle temporelle
  // appartient au point d'entrée RPC.
  const futureBuyId = await record({
    account_id: peaId,
    event_type: "BUY",
    event_date: "2027-01-05",
    security: { name: "Smoke ETF", ticker: null, isin: "FR0000000001", currency: "EUR" },
    quantity: 3,
    unit_price: 130,
    gross_amount: 390,
    fee_amount: 0,
    tax_amount: 0,
    envelope_cash_amount: -390,
    currency: "EUR",
  });
  await rejects(
    "select public.lfo_record_portfolio_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        account_id: peaId,
        event_type: "SELL",
        event_date: "2026-06-05",
        security: { name: "Smoke ETF", ticker: null, isin: "FR0000000001", currency: "EUR" },
        quantity: 1,
        gross_amount: 140,
        fee_amount: 0,
        tax_amount: 0,
        envelope_cash_amount: 140,
        currency: "EUR",
        matched_acquisition_event_id: futureBuyId,
      }),
    ],
    "Une cession a pu désigner une acquisition future",
    "Lot désigné invalide",
  );

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
    "portfolio_events_opening_cash_uk",
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
    "portfolio_events_quantity_shape_ck",
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
    "portfolio_events_security_shape_ck",
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
    "portfolio_events_counterparty_ck",
  );

  // 4 bis. Intégrités portées par la base, hors RPC.
  //
  // Une écriture directe qui contournerait la RPC ne doit pas pouvoir rattacher la
  // cession d'une enveloppe au lot d'une autre, ni au lot d'un autre utilisateur.
  await rejects(
    `insert into public.portfolio_events
       (user_id, account_id, security_id, event_type, event_date, quantity, currency,
        matched_acquisition_event_id, data_kind, confidence)
     select $1, $2, security_id, 'SELL', date '2026-05-05', 1, 'EUR', $3, 'ACTUAL', 'HIGH'
       from public.portfolio_events where id = $3`,
    [userId, ctoId, buyId],
    "Une cession a pu désigner le lot d'une autre enveloppe",
    "portfolio_events_matched_lot_fk",
  );

  // Un autre utilisateur ne peut pas loger un événement dans une enveloppe qui n'est pas
  // la sienne : la FK composite (account_id, user_id) l'arrête avant tout le reste.
  await rejects(
    `insert into public.portfolio_events
       (user_id, account_id, event_type, event_date, currency, envelope_cash_amount,
        data_kind, confidence)
     values ($1, $2, 'CONTRIBUTION', date '2026-05-05', 'EUR', 10, 'ACTUAL', 'HIGH')`,
    [foreignUser, peaId],
    "Un autre utilisateur a pu écrire dans cette enveloppe",
    "portfolio_events_account_fk",
  );
  // Ni référencer un instrument qui ne lui appartient pas, même depuis son enveloppe.
  await rejects(
    `insert into public.portfolio_events
       (user_id, account_id, security_id, event_type, event_date, quantity, currency,
        data_kind, confidence)
     select $1, $2, security_id, 'SELL', date '2026-05-05', 1, 'EUR', 'ACTUAL', 'HIGH'
       from public.portfolio_events where id = $3`,
    [foreignUser, foreignAccountId, buyId],
    "Un autre utilisateur a pu référencer cet instrument",
    "portfolio_events_security_fk",
  );
  // Et avec SES PROPRES enveloppe et instrument, il ne peut toujours pas désigner notre lot.
  await rejects(
    `insert into public.portfolio_events
       (user_id, account_id, security_id, event_type, event_date, quantity, currency,
        matched_acquisition_event_id, data_kind, confidence)
     values ($1, $2, $3, 'SELL', date '2026-05-05', 1, 'EUR', $4, 'ACTUAL', 'HIGH')`,
    [foreignUser, foreignAccountId, foreignSecurityId, buyId],
    "Un événement d'un autre utilisateur a pu désigner ce lot",
    "portfolio_events_matched_lot_fk",
  );

  // Un « lot spécifique » structurellement impossible doit être refusé par la BASE, sans
  // compter sur le moteur pour le signaler après coup. Quatre frontières, une seule FK :
  // propriétaire, enveloppe, instrument, et le fait d'ouvrir réellement un lot.
  const otherSecurityBuyId = await record({
    account_id: peaId,
    event_type: "BUY",
    event_date: "2026-02-10",
    security: { name: "Smoke Obligation", ticker: null, isin: "FR0000000002", currency: "EUR" },
    quantity: 5,
    unit_price: 100,
    gross_amount: 500,
    fee_amount: 0,
    tax_amount: 0,
    envelope_cash_amount: -500,
    currency: "EUR",
  });
  const dividendId = await record({
    account_id: peaId,
    event_type: "DIVIDEND",
    event_date: "2026-03-10",
    security: { name: "Smoke ETF", ticker: null, isin: "FR0000000001", currency: "EUR" },
    envelope_cash_amount: 47,
    currency: "EUR",
  });

  // a) un lot d'un AUTRE instrument.
  await rejects(
    `insert into public.portfolio_events
       (user_id, account_id, security_id, event_type, event_date, quantity, currency,
        matched_acquisition_event_id, data_kind, confidence)
     select $1, $2, security_id, 'SELL', date '2026-05-05', 1, 'EUR', $4, 'ACTUAL', 'HIGH'
       from public.portfolio_events where id = $3`,
    [userId, peaId, otherSecurityBuyId, buyId],
    "Une cession a pu désigner le lot d'un autre instrument",
    "portfolio_events_matched_lot_fk",
  );

  // b) un événement qui n'ouvre aucun lot : le dividende encaissé sur ce même titre.
  await rejects(
    `insert into public.portfolio_events
       (user_id, account_id, security_id, event_type, event_date, quantity, currency,
        matched_acquisition_event_id, data_kind, confidence)
     select $1, $2, security_id, 'SELL', date '2026-05-05', 1, 'EUR', $3, 'ACTUAL', 'HIGH'
       from public.portfolio_events where id = $3`,
    [userId, peaId, dividendId],
    "Une cession a pu désigner un dividende comme lot",
    "portfolio_events_matched_lot_fk",
  );

  // c) une cession sans instrument : sous MATCH SIMPLE, un `security_id` nul désactiverait
  //    la FK. C'est le CHECK qui referme cette porte.
  await rejects(
    `insert into public.portfolio_events
       (user_id, account_id, event_type, event_date, currency, envelope_cash_amount,
        matched_acquisition_event_id, data_kind, confidence)
     values ($1, $2, 'TRANSFER_OUT', date '2026-05-05', 'EUR', -10, $3, 'ACTUAL', 'HIGH')`,
    [userId, peaId, buyId],
    "Une cession sans instrument a pu désigner un lot",
    "portfolio_events_matched_lot_ck",
  );

  // d) contrôle négatif : la désignation légitime, elle, reste acceptée.
  await client.query(
    `insert into public.portfolio_events
       (user_id, account_id, security_id, event_type, event_date, quantity, currency,
        gross_amount, fee_amount, tax_amount, envelope_cash_amount,
        matched_acquisition_event_id, data_kind, confidence)
     select $1, $2, security_id, 'SELL', date '2026-05-06', 1, 'EUR', 120, 0, 0, 120, $3,
            'ACTUAL', 'HIGH'
       from public.portfolio_events where id = $3`,
    [userId, peaId, buyId],
  );

  // Une FK composite dont le SET NULL ne nomme pas sa colonne annulerait aussi `user_id`,
  // qui est NOT NULL : la suppression de la transaction échouerait au lieu de détacher.
  const txId = randomUUID();
  const categoryRow = await client.query<{ id: string }>(
    "select id from public.expense_categories where user_id = $1 limit 1",
    [userId],
  );
  await client.query(
    `insert into public.transactions
       (id, user_id, account_id, category_id, transaction_date, label, amount, currency,
        data_kind, confidence)
     values ($1, $2, $3, $4, date '2026-02-01', 'Smoke virement', -5000, 'EUR', 'ACTUAL', 'HIGH')`,
    [txId, userId, bankId, categoryRow.rows[0]?.id ?? null],
  );
  const linkedEventId = await record({
    account_id: peaId,
    event_type: "CONTRIBUTION",
    event_date: "2026-02-01",
    currency: "EUR",
    envelope_cash_amount: 5000,
    counterparty_account_id: bankId,
    transaction_id: txId,
  });
  await client.query("delete from public.transactions where id = $1", [txId]);
  const detached = await client.query<{ user_id: string; transaction_id: string | null }>(
    "select user_id, transaction_id from public.portfolio_events where id = $1",
    [linkedEventId],
  );
  assert(
    detached.rows[0]?.transaction_id === null,
    "Le lien vers la transaction supprimée n'a pas été détaché",
  );
  assert(
    detached.rows[0]?.user_id === userId,
    "La suppression de la transaction a emporté le propriétaire de l'événement",
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
    "Smoke Portfolio Ledger vert : conventions upsert et effaçables, instrument résolu sans doublon, ancrages uniques, formes refusées, lot désigné cloisonné par propriétaire, enveloppe, instrument, nature ouvrante et date, désignation légitime acceptée, transaction détachée sans perte de propriétaire, lot protégé, rollback intégral.",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
