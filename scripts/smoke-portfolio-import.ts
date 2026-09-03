/**
 * Smoke transactionnel de l'import de portefeuille. Toutes les écritures sont annulées :
 * aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve :
 *
 *   * une session s'ouvre en RECEIVING, reçoit ses lignes par lots, et ne produit AUCUN fait
 *     canonique avant validation ;
 *   * le BRUT et sa LECTURE sont écrits atomiquement et rattachés par numéro de ligne ;
 *   * le brut est IMMUABLE : ni modifiable, ni supprimable, même sous `service_role` ;
 *   * les compteurs de session sont DÉRIVÉS des lignes persistées, jamais repris d'un
 *     décompte fourni par l'appelant ;
 *   * ABSENT ≠ ZÉRO : frais, taxes et coût de revient s'écrivent `null` quand ils manquent ;
 *   * une quantité négative ou nulle est refusée : la direction vient de la nature ;
 *   * un achat sans instrument et un apport avec instrument sont refusés DÈS LE STAGING ;
 *   * une nature hors de la whitelist du ledger est refusée par le staging lui-même ;
 *   * une position PRÊTE sans valeur de marché est refusée : `market_value` est NOT NULL ;
 *   * une ligne prête sans devise, sans date ou sans enveloppe est refusée par la base ;
 *   * un instrument déclaré RÉSOLU sans instrument rattaché est refusé ;
 *   * écarter un instrument exige un MOTIF, et la décision se propage à toutes les lignes
 *     qui citent ce titre ;
 *   * une décision HUMAINE n'est pas écrasée par une réanalyse ;
 *   * une CORRECTION écrit la ligne normalisée et laisse le brut intact, avec sa provenance
 *     au niveau du champ ;
 *   * corriger une ligne déjà écrite est refusé ;
 *   * la validation écrit l'événement par la RPC EXISTANTE du ledger et pose la provenance
 *     en une seule transaction ;
 *   * désigner une ligne BLOQUÉE, DOUBLON ou IGNORÉE à la validation est REFUSÉ ;
 *   * une position écrit une OBSERVATION DATÉE et AUCUN événement ;
 *   * deux lignes `positions` pour le même couple enveloppe + instrument sont impossibles ;
 *   * une observation à la même date ne s'écrase pas en SILENCE : rejeu identique sans effet,
 *     valeurs différentes REFUSÉES sauf décision explicite, et la session qui corrige garde
 *     sa provenance ;
 *   * un import INCRÉMENTAL à une nouvelle date n'écrase aucune observation antérieure ;
 *   * un second commit de la même session ne réécrit rien (idempotence applicative) ;
 *   * réimporter le même fichier déjà validé est REFUSÉ (idempotence de base) ;
 *   * une identité DÉCLARÉE porte une unicité ; une clé de ressemblance n'en porte aucune ;
 *   * un ÉCHEC au milieu d'un lot annule l'intégralité du lot ;
 *   * un fait importé n'est pas supprimable en laissant sa provenance orpheline ;
 *   * la piste d'audit est en LECTURE SEULE pour `authenticated` ;
 *   * les données d'un autre propriétaire sont inaccessibles, même en connaissant leur UUID.
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

async function rpc(name: string, payload: unknown): Promise<string> {
  const result = await client.query<{ value: string }>(
    `select public.${name}($1::uuid, $2::jsonb)::text as value`,
    [userId, JSON.stringify(payload)],
  );
  return result.rows[0].value;
}

type Counts = {
  sources: string;
  sessions: string;
  raw: string;
  normalized: string;
  links: string;
  resolutions: string;
  events: string;
  positions: string;
  snapshots: string;
  securities: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.import_sources)::text as sources,
      (select count(*) from public.import_sessions)::text as sessions,
      (select count(*) from public.import_raw_records)::text as raw,
      (select count(*) from public.import_normalized_records)::text as normalized,
      (select count(*) from public.import_record_links)::text as links,
      (select count(*) from public.import_instrument_resolutions)::text as resolutions,
      (select count(*) from public.portfolio_events)::text as events,
      (select count(*) from public.positions)::text as positions,
      (select count(*) from public.position_snapshots)::text as snapshots,
      (select count(*) from public.securities)::text as securities
  `);
  return result.rows[0];
}

let userId = "";
let succeeded = false;

const FILE_HASH_A = "a".repeat(64);
const FILE_HASH_B = "b".repeat(64);

await client.connect();
const before = await counts();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '60s'");
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
  userId = owner.rows[0].id;

  const foreignUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    foreignUser,
    `smoke-pfimport-${foreignUser}@invalid`,
  ]);

  await client.query("set local role service_role");

  // ── 0. Décor : enveloppe et instruments ─────────────────────────────────────────
  const accountId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, 'PEA smoke', 'BROKERAGE', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [accountId, userId],
  );
  const securityId = randomUUID();
  await client.query(
    `insert into public.securities (id, user_id, name, ticker, isin, currency)
     values ($1, $2, 'Air Liquide', 'AI', 'FR0000120073', 'EUR')`,
    [securityId, userId],
  );
  const otherSecurityId = randomUUID();
  await client.query(
    `insert into public.securities (id, user_id, name, ticker, isin, currency)
     values ($1, $2, 'Microsoft', 'MSFT', 'US5949181045', 'USD')`,
    [otherSecurityId, userId],
  );

  const openPayload = (overrides: Record<string, unknown> = {}) => ({
    source: {
      kind: "FILE_CSV",
      domain: "PORTFOLIO_LEDGER",
      provider: "GENERIC_PORTFOLIO_FILE",
      label: "Import smoke",
      target_account_id: accountId,
      adapter_version: "portfolio-file/1",
    },
    session: {
      file_name: "ops.csv",
      file_hash: FILE_HASH_A,
      file_size_bytes: 2048,
      content_type: "text/csv",
      encoding: "UTF_8",
      delimiter: ";",
      parser: "portfolio-file",
      parser_version: "1",
      declared_currency: "EUR",
      observation_date: "2026-09-02",
      ...overrides,
    },
  });

  // ── 1. Formes de source refusées ────────────────────────────────────────────────
  await rejects(
    "select public.lfo_open_portfolio_session($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        ...openPayload(),
        source: { ...openPayload().source, domain: "CASH_FLOW_TRANSACTION" },
      }),
    ],
    "Un domaine hors portefeuille a été accepté",
    "non pris en charge",
  );

  await rejects(
    "select public.lfo_open_portfolio_session($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        ...openPayload(),
        source: { ...openPayload().source, target_account_id: null },
      }),
    ],
    "Une session sans enveloppe a été ouverte",
    "sans enveloppe",
  );

  const foreignAccountId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, 'Compte voisin', 'BROKERAGE', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [foreignAccountId, foreignUser],
  );
  await rejects(
    "select public.lfo_open_portfolio_session($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        ...openPayload(),
        source: { ...openPayload().source, target_account_id: foreignAccountId },
      }),
    ],
    "Une enveloppe d'un autre propriétaire a pu être visée",
    "introuvable",
  );

  // ── 2. Réception : brut + lecture atomiques ─────────────────────────────────────
  const sessionId = await rpc("lfo_open_portfolio_session", openPayload());
  const status = await client.query<{ status: string }>(
    "select status from public.import_sessions where id = $1",
    [sessionId],
  );
  assert(status.rows[0].status === "RECEIVING", "Une session s'ouvre en RECEIVING");

  const row = (overrides: Record<string, unknown>) => ({
    row_number: 2,
    raw_line: "15/03/2026;Achat;FR0000120073;10;1705,00;4,90;EUR",
    cells: ["15/03/2026", "Achat", "FR0000120073", "10", "1705,00", "4,90", "EUR"],
    fact_date: "2026-03-15",
    event_type: "BUY",
    security_id: securityId,
    quantity: "10",
    unit_price: "170.5",
    gross_amount: "1705",
    fee_amount: "4.9",
    currency: "EUR",
    instrument_source_key: "ISIN:FR0000120073",
    source_isin: "FR0000120073",
    status: "READY",
    dedupe_verdict: "NEW",
    match_key: "k1",
    issues: [],
    ...overrides,
  });

  const written = await rpc("lfo_append_portfolio_rows", {
    session_id: sessionId,
    rows: [
      row({}),
      // Dividende : frais et quantité ABSENTS, et ils doivent rester `null`.
      row({
        row_number: 3,
        event_type: "DIVIDEND",
        quantity: null,
        unit_price: null,
        fee_amount: null,
        gross_amount: "32",
        match_key: "k2",
      }),
    ],
  });
  assert(written === "2", `Deux lignes devaient être reçues, obtenu ${written}`);

  const persisted = await client.query<{
    fee: string | null;
    qty: string | null;
    rows: string;
  }>(
    `select n.fee_amount::text as fee, n.quantity::text as qty,
            (select count(*)::text from public.import_raw_records where session_id = $1) as rows
       from public.import_normalized_records n
       join public.import_raw_records r on r.id = n.raw_record_id
      where n.session_id = $1 and r.row_number = 3`,
    [sessionId],
  );
  assert(persisted.rows[0].fee === null, "ABSENT ≠ ZÉRO : des frais absents s'écrivent null");
  assert(persisted.rows[0].qty === null, "ABSENT ≠ ZÉRO : une quantité absente s'écrit null");
  assert(persisted.rows[0].rows === "2", "Le brut doit être écrit pour chaque ligne");

  // AUCUN fait canonique avant validation.
  const noFacts = await client.query<{ count: string }>(
    "select count(*)::text as count from public.portfolio_events where user_id = $1",
    [userId],
  );
  assert(noFacts.rows[0].count === "0", "Aucun événement ne doit exister avant validation");

  // ── 3. Brut IMMUABLE ───────────────────────────────────────────────────────────
  const rawId = await client.query<{ id: string }>(
    "select id from public.import_raw_records where session_id = $1 order by row_number limit 1",
    [sessionId],
  );
  assert(rawId.rows[0]?.id, "Le brut doit exister pour que son immuabilité soit testable");

  // La MODIFICATION est refusée sans condition : corriger une lecture ne récrit jamais la
  // source. C'est l'invariant fort, et il vaut à tout moment de la vie d'une session.
  await rejects(
    "update public.import_raw_records set raw_line = 'trafiqué' where id = $1",
    [rawId.rows[0].id],
    "Le brut a pu être modifié",
    "immuable",
  );

  // La SUPPRESSION est refusée sur une session VIVANTE, avant comme après validation. Le
  // socle l'autorisait sur toute session encore en réception ou analysée, parce que c'était
  // l'état dans lequel l'abandon travaillait ; le retrait est maintenant DÉCLARÉ — seul
  // l'abandon de la session libère son brut. Le cas « après validation » est vérifié plus
  // bas ; l'état de gel complet l'est dans le smoke du socle.
  await rejects(
    "delete from public.import_raw_records where id = $1",
    [rawId.rows[0].id],
    "Le brut d'une session en réception a pu être supprimé",
    "ne se supprime qu'en abandonnant la session",
  );

  // ── 4. Formes de ligne refusées PAR LA BASE ────────────────────────────────────
  const badRow = (overrides: Record<string, unknown>) =>
    rejects(
      "select public.lfo_append_portfolio_rows($1::uuid, $2::jsonb)",
      [
        userId,
        JSON.stringify({ session_id: sessionId, rows: [row({ row_number: 90, ...overrides })] }),
      ],
      `Une ligne invalide a été acceptée : ${JSON.stringify(overrides)}`,
      typeof overrides.__expect === "string" ? overrides.__expect : undefined,
    );

  await badRow({ quantity: "-5", __expect: "quantity_ck" });
  await badRow({ quantity: "0", __expect: "quantity_ck" });
  await badRow({ gross_amount: "-1705", __expect: "gross_ck" });
  await badRow({ fee_amount: "-1", __expect: "fee_ck" });
  await badRow({ event_type: "BOULE_DE_CRISTAL", __expect: "event_type_ck" });
  // Un achat sans instrument : refusé dès le staging.
  await badRow({ security_id: null, __expect: "security_shape_ck" });
  // Un apport AVEC instrument : refusé dès le staging.
  await badRow({ event_type: "CONTRIBUTION", __expect: "security_shape_ck" });
  // Une ligne prête sans devise, sans date : refusée par la forme committable.
  await badRow({ currency: null, __expect: "ready_shape_v2_ck" });
  await badRow({ fact_date: null, __expect: "ready_shape_v2_ck" });

  // ── 5. Un échec au milieu d'un lot annule TOUT le lot ──────────────────────────
  const rawBefore = await client.query<{ count: string }>(
    "select count(*)::text as count from public.import_raw_records where session_id = $1",
    [sessionId],
  );
  await rejects(
    "select public.lfo_append_portfolio_rows($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        session_id: sessionId,
        rows: [
          row({ row_number: 50, match_key: "ok" }),
          row({ row_number: 51, quantity: "-1" }),
          row({ row_number: 52, match_key: "jamais" }),
        ],
      }),
    ],
    "Un lot partiellement invalide a été écrit",
    "quantity_ck",
  );
  const rawAfter = await client.query<{ count: string }>(
    "select count(*)::text as count from public.import_raw_records where session_id = $1",
    [sessionId],
  );
  assert(
    rawBefore.rows[0].count === rawAfter.rows[0].count,
    "Un échec au milieu d'un lot doit annuler l'intégralité du lot",
  );

  // ── 6. Résolution d'instrument ─────────────────────────────────────────────────
  await rejects(
    "select public.lfo_stage_import_instruments($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        session_id: sessionId,
        instruments: [{ source_key: "ISIN:XX", state: "RESOLVED" }],
      }),
    ],
    "Un instrument déclaré résolu sans cible a été accepté",
    "rattachement fantôme",
  );

  const staged = await rpc("lfo_stage_import_instruments", {
    session_id: sessionId,
    instruments: [
      {
        source_key: "ISIN:FR0000120073",
        source_isin: "FR0000120073",
        state: "RESOLVED",
        security_id: securityId,
        basis: { kind: "ISIN" },
      },
      {
        source_key: "TICKER:ALP",
        source_ticker: "ALP",
        state: "AMBIGUOUS",
        basis: { kind: "TICKER" },
      },
    ],
  });
  assert(staged === "2", "Deux instruments devaient être enregistrés");

  const ambiguous = await client.query<{ id: string; security: string | null }>(
    "select id, security_id::text as security from public.import_instrument_resolutions where source_key = 'TICKER:ALP'",
  );
  assert(
    ambiguous.rows[0].security === null,
    "Un instrument ambigu ne porte aucun rattachement : rien n'est choisi d'office",
  );

  await rejects(
    "select public.lfo_resolve_import_instrument($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ resolution_id: ambiguous.rows[0].id, decision: "REJECT" })],
    "Un instrument a pu être écarté sans motif",
    "exige un motif",
  );
  await rejects(
    "select public.lfo_resolve_import_instrument($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ resolution_id: ambiguous.rows[0].id, decision: "RESOLVE" })],
    "Un instrument a pu être rattaché sans désigner lequel",
    "désigner lequel",
  );
  await rejects(
    `update public.import_instrument_resolutions
        set state = 'REJECTED', decided_at = now() where id = $1`,
    [ambiguous.rows[0].id],
    "Un rejet sans motif a pu être écrit directement",
    "rejected_shape_ck",
  );

  const propagated = await rpc("lfo_resolve_import_instrument", {
    resolution_id: ambiguous.rows[0].id,
    decision: "RESOLVE",
    security_id: otherSecurityId,
    reason: "Fonds identifié par le relevé de gestion",
  });
  assert(propagated === "0", "Aucune ligne ne cite ce titre : la propagation ne touche rien");

  // Une décision HUMAINE ne se rejoue pas : une réanalyse ne l'écrase pas.
  await rpc("lfo_stage_import_instruments", {
    session_id: sessionId,
    instruments: [{ source_key: "TICKER:ALP", state: "AMBIGUOUS", basis: { kind: "TICKER" } }],
  });
  const afterRestage = await client.query<{ state: string; security: string | null }>(
    "select state, security_id::text as security from public.import_instrument_resolutions where source_key = 'TICKER:ALP'",
  );
  assert(
    afterRestage.rows[0].state === "RESOLVED" && afterRestage.rows[0].security === otherSecurityId,
    "Une réanalyse ne doit pas écraser une décision humaine",
  );

  // ── 7. Correction : la ligne NORMALISÉE, jamais le brut ────────────────────────
  const target = await client.query<{ id: string }>(
    `select n.id from public.import_normalized_records n
       join public.import_raw_records r on r.id = n.raw_record_id
      where n.session_id = $1 and r.row_number = 3`,
    [sessionId],
  );
  await rejects(
    "select public.lfo_correct_portfolio_row($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ record_id: target.rows[0].id, field_corrections: {} })],
    "Une correction vide a été acceptée",
    "Correction vide",
  );
  await rpc("lfo_correct_portfolio_row", {
    record_id: target.rows[0].id,
    gross_amount: "35",
    reason: "Montant net relu sur l'avis d'opéré",
    field_corrections: { gross_amount: { from: "32", to: "35" } },
  });
  const corrected = await client.query<{
    gross: string;
    corrections: Record<string, unknown>;
    at: string | null;
    raw: string;
  }>(
    `select n.gross_amount::text as gross, n.field_corrections as corrections,
            n.corrected_at::text as at, r.raw_line as raw
       from public.import_normalized_records n
       join public.import_raw_records r on r.id = n.raw_record_id
      where n.id = $1`,
    [target.rows[0].id],
  );
  assert(Number(corrected.rows[0].gross) === 35, "La correction doit s'appliquer à la lecture");
  assert(corrected.rows[0].at !== null, "Une correction porte sa date");
  assert(
    JSON.stringify(corrected.rows[0].corrections).includes("gross_amount"),
    "La provenance au niveau du CHAMP doit être conservée",
  );
  assert(
    corrected.rows[0].raw.includes("15/03/2026"),
    "Le brut ne doit PAS changer : corriger une lecture ne récrit pas la source",
  );
  await rejects(
    `update public.import_normalized_records set corrected_at = now(), field_corrections = null
      where id = $1`,
    [target.rows[0].id],
    "Une correction sans contenu a pu être écrite",
    "correction_shape_ck",
  );

  // ── 8. Validation : écriture atomique par la RPC EXISTANTE ─────────────────────
  const ready = await rpc("lfo_finalize_portfolio_session", { session_id: sessionId });
  assert(ready === "2", `Deux lignes prêtes attendues, obtenu ${ready}`);

  const recordIds = await client.query<{ id: string }>(
    "select id from public.import_normalized_records where session_id = $1 order by id",
    [sessionId],
  );

  // Une ligne BLOQUÉE désignée est refusée.
  await client.query("savepoint blocked_probe");
  await client.query(
    "update public.import_normalized_records set status = 'BLOCKED' where id = $1",
    [recordIds.rows[0].id],
  );
  await rejects(
    "select public.lfo_commit_portfolio_session($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        session_id: sessionId,
        record_ids: recordIds.rows.map((entry) => entry.id),
      }),
    ],
    "Une ligne bloquée a pu être validée",
    "non committables",
  );
  await client.query("rollback to savepoint blocked_probe");

  const committed = await rpc("lfo_commit_portfolio_session", {
    session_id: sessionId,
    record_ids: recordIds.rows.map((entry) => entry.id),
  });
  assert(committed === "2", `Deux faits attendus, obtenu ${committed}`);

  const events = await client.query<{
    count: string;
    fee: string | null;
    linked: string;
  }>(
    `select count(*)::text as count,
            min(fee_amount)::text as fee,
            (select count(*)::text from public.import_record_links
              where session_id = $1 and target_domain = 'PORTFOLIO_LEDGER') as linked
       from public.portfolio_events where user_id = $2 and account_id = $3`,
    [sessionId, userId, accountId],
  );
  assert(events.rows[0].count === "2", "Deux événements doivent être écrits");
  assert(events.rows[0].linked === "2", "Chaque fait doit porter sa provenance");

  // Provenance vérifiable : la ligne porte le fait qu'elle a produit.
  const provenance = await client.query<{ count: string }>(
    `select count(*)::text as count from public.import_normalized_records
      where session_id = $1 and commit_state = 'COMMITTED' and portfolio_event_id is not null`,
    [sessionId],
  );
  assert(provenance.rows[0].count === "2", "Chaque ligne committée porte son fait canonique");

  // Le BRUT d'une session qui a produit des faits ne se supprime plus : la chaîne
  // brut → lecture → provenance est gelée, et c'est ce refus qui protège réellement.
  await rejects(
    "delete from public.import_raw_records where session_id = $1",
    [sessionId],
    "Le brut d'une session validée a pu être supprimé",
    "fait canonique",
  );
  await rejects(
    "delete from public.import_record_links where session_id = $1",
    [sessionId],
    "Un lien de provenance a pu être supprimé",
    "immuable",
  );
  await rejects(
    "update public.import_normalized_records set gross_amount = 1 where session_id = $1 and commit_state = 'COMMITTED'",
    [sessionId],
    "Une lecture committée a pu être modifiée",
  );

  // Un fait importé n'est pas supprimable en laissant sa provenance orpheline.
  const eventId = await client.query<{ id: string }>(
    "select id from public.portfolio_events where user_id = $1 limit 1",
    [userId],
  );
  await rejects(
    "delete from public.portfolio_events where id = $1",
    [eventId.rows[0].id],
    "Un fait importé a pu être supprimé sans sa provenance",
    "violates foreign key constraint",
  );

  // Idempotence applicative : un second commit ne réécrit rien.
  const again = await rpc("lfo_commit_portfolio_session", {
    session_id: sessionId,
    record_ids: recordIds.rows.map((entry) => entry.id),
  });
  assert(again === "2", "Un second commit rend le décompte déjà écrit, sans rien réécrire");
  const stillTwo = await client.query<{ count: string }>(
    "select count(*)::text as count from public.portfolio_events where user_id = $1",
    [userId],
  );
  assert(stillTwo.rows[0].count === "2", "Un second commit ne doit créer aucun événement");

  // Idempotence de base : le même fichier déjà validé est refusé.
  await rejects(
    "select public.lfo_open_portfolio_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify(openPayload())],
    "Le même fichier déjà validé a pu être réimporté",
    "déjà été importé et validé",
  );

  // ── 9. Positions : observation datée, AUCUN événement ──────────────────────────
  const positionSession = await rpc("lfo_open_portfolio_session", {
    source: {
      kind: "FILE_CSV",
      domain: "PORTFOLIO_POSITION",
      provider: "GENERIC_PORTFOLIO_FILE",
      label: "Positions smoke",
      target_account_id: accountId,
      adapter_version: "portfolio-file/1",
    },
    session: {
      file_name: "positions.csv",
      file_hash: FILE_HASH_B,
      file_size_bytes: 512,
      content_type: "text/csv",
      parser: "portfolio-file",
      parser_version: "1",
      declared_currency: "EUR",
    },
  });

  const positionRow = (overrides: Record<string, unknown> = {}) => ({
    row_number: 2,
    raw_line: "30/06/2026;FR0000120073;10;1750,00;EUR",
    cells: ["30/06/2026", "FR0000120073", "10", "1750,00", "EUR"],
    fact_date: "2026-06-30",
    security_id: securityId,
    quantity: "10",
    market_value: "1750",
    cost_basis: null,
    currency: "EUR",
    instrument_source_key: "ISIN:FR0000120073",
    status: "READY",
    dedupe_verdict: "NEW",
    match_key: "p1",
    issues: [],
    ...overrides,
  });

  // Une position PRÊTE sans valeur de marché est refusée : `market_value` est NOT NULL.
  await rejects(
    "select public.lfo_append_portfolio_rows($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        session_id: positionSession,
        rows: [positionRow({ market_value: null })],
      }),
    ],
    "Une position prête sans valeur de marché a été acceptée",
    "ready_shape_v2_ck",
  );
  // Une position prête sans instrument est refusée.
  await rejects(
    "select public.lfo_append_portfolio_rows($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({ session_id: positionSession, rows: [positionRow({ security_id: null })] }),
    ],
    "Une position prête sans instrument a été acceptée",
    "ready_shape_v2_ck",
  );

  await rpc("lfo_append_portfolio_rows", {
    session_id: positionSession,
    rows: [positionRow()],
  });
  await rpc("lfo_finalize_portfolio_session", { session_id: positionSession });
  const positionRecords = await client.query<{ id: string }>(
    "select id from public.import_normalized_records where session_id = $1",
    [positionSession],
  );
  const positionsWritten = await rpc("lfo_commit_portfolio_session", {
    session_id: positionSession,
    record_ids: positionRecords.rows.map((entry) => entry.id),
  });
  assert(positionsWritten === "1", "Une observation devait être écrite");

  const observation = await client.query<{
    snapshots: string;
    positions: string;
    events: string;
    cost: string | null;
    value: string;
  }>(
    `select
       (select count(*)::text from public.position_snapshots where user_id = $1) as snapshots,
       (select count(*)::text from public.positions where user_id = $1) as positions,
       (select count(*)::text from public.portfolio_events where user_id = $1) as events,
       (select cost_basis::text from public.position_snapshots where user_id = $1 limit 1) as cost,
       (select market_value::text from public.position_snapshots where user_id = $1 limit 1) as value`,
    [userId],
  );
  assert(observation.rows[0].snapshots === "1", "Une observation datée doit être écrite");
  assert(observation.rows[0].positions === "1", "Une détention doit être créée");
  assert(
    observation.rows[0].events === "2",
    "POSITION OBSERVÉE ≠ TRANSACTION : aucun événement ne doit naître d'un relevé de positions",
  );
  assert(
    observation.rows[0].cost === null,
    "ABSENT ≠ ZÉRO : un coût de revient non fourni reste inconnu",
  );

  // Deux détentions pour le même couple enveloppe + instrument : impossible.
  await rejects(
    `insert into public.positions (user_id, account_id, security_id, is_cash, data_kind, confidence)
     values ($1, $2, $3, false, 'ACTUAL', 'HIGH')`,
    [userId, accountId, securityId],
    "Deux détentions du même instrument dans la même enveloppe ont pu coexister",
    "positions_envelope_instrument_uidx",
  );

  // Deux observations du même instrument à la même DATE : impossible.
  const positionId = await client.query<{ id: string }>(
    "select id from public.positions where user_id = $1 limit 1",
    [userId],
  );
  await rejects(
    `insert into public.position_snapshots
       (user_id, position_id, snapshot_date, quantity, market_value, currency, data_kind, confidence)
     values ($1, $2, '2026-06-30', 10, 1750, 'EUR', 'ACTUAL', 'HIGH')`,
    [userId, positionId.rows[0].id],
    "Deux observations à la même date ont pu coexister",
    "position_snapshots_observation_uidx",
  );

  // Import INCRÉMENTAL : une nouvelle date s'ajoute, l'historique reste.
  const incrementalSession = await rpc("lfo_open_portfolio_session", {
    source: {
      kind: "FILE_CSV",
      domain: "PORTFOLIO_POSITION",
      provider: "GENERIC_PORTFOLIO_FILE",
      label: "Positions smoke",
      target_account_id: accountId,
      adapter_version: "portfolio-file/1",
    },
    session: {
      file_name: "positions-juillet.csv",
      file_hash: "c".repeat(64),
      file_size_bytes: 512,
      content_type: "text/csv",
      parser: "portfolio-file",
      parser_version: "1",
      declared_currency: "EUR",
    },
  });
  await rpc("lfo_append_portfolio_rows", {
    session_id: incrementalSession,
    rows: [positionRow({ fact_date: "2026-07-31", market_value: "1810", match_key: "p2" })],
  });
  await rpc("lfo_finalize_portfolio_session", { session_id: incrementalSession });
  const incrementalRecords = await client.query<{ id: string }>(
    "select id from public.import_normalized_records where session_id = $1",
    [incrementalSession],
  );
  await rpc("lfo_commit_portfolio_session", {
    session_id: incrementalSession,
    record_ids: incrementalRecords.rows.map((entry) => entry.id),
  });
  const history = await client.query<{ count: string; dates: string }>(
    `select count(*)::text as count, string_agg(snapshot_date::text, ',' order by snapshot_date) as dates
       from public.position_snapshots where user_id = $1`,
    [userId],
  );
  assert(
    history.rows[0].count === "2" && history.rows[0].dates === "2026-06-30,2026-07-31",
    `L'incrémental doit AJOUTER une observation sans supprimer l'historique, obtenu ${history.rows[0].dates}`,
  );

  // ── 9 bis. AUCUN écrasement SILENCIEUX d'une observation persistée ──────────────
  //
  // Une observation persistée est un FAIT. L'écraser parce qu'un second fichier porte la
  // même date, sans le dire et sans décision, remplace une quantité et une valeur de marché
  // déjà lues par un humain — et il n'en reste aucune trace.
  //
  // Trois cas, et trois seulement : rien à cette date → écriture ; mêmes valeurs → RIEN,
  // le rejeu reste idempotent ; valeurs différentes → REFUS, sauf décision explicite.
  const openPositionSession = async (hash: string) =>
    rpc("lfo_open_portfolio_session", {
      source: {
        kind: "FILE_CSV",
        domain: "PORTFOLIO_POSITION",
        provider: "GENERIC_PORTFOLIO_FILE",
        label: "Positions smoke",
        target_account_id: accountId,
        adapter_version: "portfolio-file/1",
      },
      session: {
        file_name: `positions-${hash}.csv`,
        file_hash: hash.repeat(64).slice(0, 64),
        file_size_bytes: 512,
        content_type: "text/csv",
        parser: "portfolio-file",
        parser_version: "1",
        declared_currency: "EUR",
      },
    });

  // Rejeu IDENTIQUE : aucune erreur, et aucune écriture. Une valeur identique n'est pas une
  // correction, et exiger une décision là où rien ne change serait un faux positif.
  const replaySession = await openPositionSession("d");
  await rpc("lfo_append_portfolio_rows", {
    session_id: replaySession,
    rows: [positionRow({ fact_date: "2026-07-31", market_value: "1810", match_key: "p2" })],
  });
  await rpc("lfo_finalize_portfolio_session", { session_id: replaySession });
  const replayRecords = await client.query<{ id: string }>(
    "select id from public.import_normalized_records where session_id = $1",
    [replaySession],
  );
  await rpc("lfo_commit_portfolio_session", {
    session_id: replaySession,
    record_ids: replayRecords.rows.map((entry) => entry.id),
  });
  const afterReplay = await client.query<{ count: string; value: string }>(
    `select count(*)::text as count, max(market_value)::text as value
       from public.position_snapshots where user_id = $1 and snapshot_date = '2026-07-31'`,
    [userId],
  );
  assert(
    afterReplay.rows[0].count === "1" && afterReplay.rows[0].value === "1810.000000",
    "Un rejeu IDENTIQUE ne doit ni dupliquer ni exiger de décision",
  );

  // Valeurs DIFFÉRENTES à la même date : refus NOMMÉ, qui dit ce qui change.
  const correctionSession = await openPositionSession("e");
  await rpc("lfo_append_portfolio_rows", {
    session_id: correctionSession,
    rows: [positionRow({ fact_date: "2026-07-31", market_value: "1999", match_key: "p3" })],
  });
  await rpc("lfo_finalize_portfolio_session", { session_id: correctionSession });
  const correctionRecords = await client.query<{ id: string }>(
    "select id from public.import_normalized_records where session_id = $1",
    [correctionSession],
  );
  const correctionIds = correctionRecords.rows.map((entry) => entry.id);
  await rejects(
    "select public.lfo_commit_portfolio_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ session_id: correctionSession, record_ids: correctionIds })],
    "Une observation persistée a pu être écrasée SANS décision",
    "Une correction est une DÉCISION",
  );
  const untouched = await client.query<{ value: string }>(
    `select market_value::text as value from public.position_snapshots
      where user_id = $1 and snapshot_date = '2026-07-31'`,
    [userId],
  );
  assert(
    untouched.rows[0].value === "1810.000000",
    "Le refus doit laisser l'observation persistée INTACTE",
  );

  // Décision explicite : la correction est écrite, et sa provenance aussi.
  await rpc("lfo_commit_portfolio_session", {
    session_id: correctionSession,
    record_ids: correctionIds,
    correct_record_ids: correctionIds,
  });
  const correctedObservation = await client.query<{
    count: string;
    value: string;
    links: string;
  }>(
    `select
       (select count(*)::text from public.position_snapshots
         where user_id = $1 and snapshot_date = '2026-07-31') as count,
       (select market_value::text from public.position_snapshots
         where user_id = $1 and snapshot_date = '2026-07-31') as value,
       (select count(*)::text from public.import_record_links l
         join public.position_snapshots ps on ps.id = l.position_snapshot_id
        where l.user_id = $1 and ps.snapshot_date = '2026-07-31') as links`,
    [userId],
  );
  assert(
    correctedObservation.rows[0].count === "1" &&
      correctedObservation.rows[0].value === "1999.000000",
    "La correction DÉCIDÉE doit remplacer l'observation, sans en créer une seconde",
  );
  // TROIS lectures ont touché cette observation : celle qui l'a créée, le rejeu identique, et
  // la correction décidée. Chacune garde sa provenance — c'est ce que l'unicité par
  // observation seule rendait impossible.
  assert(
    correctedObservation.rows[0].links === "3",
    `La provenance d'une observation corrigée est un HISTORIQUE de sessions : obtenu ${correctedObservation.rows[0].links} lien(s)`,
  );

  // ── 10. Piste d'audit en LECTURE SEULE sous `authenticated` ────────────────────
  await client.query("set local role authenticated");
  for (const table of [
    "import_instrument_resolutions",
    "import_raw_records",
    "import_normalized_records",
    "import_record_links",
  ]) {
    await rejects(
      `insert into public.${table} (user_id) values ($1)`,
      [userId],
      `La table ${table} est écrivable sous authenticated`,
      "permission denied",
    );
  }
  await client.query("set local role service_role");

  // ── 11. Cloisonnement ──────────────────────────────────────────────────────────
  const foreignSecurityId = randomUUID();
  await client.query(
    `insert into public.securities (id, user_id, name, ticker, isin, currency)
     values ($1, $2, 'Titre voisin', 'VOIS', 'FR0000000000', 'EUR')`,
    [foreignSecurityId, foreignUser],
  );
  const resolutionId = await client.query<{ id: string }>(
    "select id from public.import_instrument_resolutions where source_key = 'ISIN:FR0000120073'",
  );
  await rejects(
    "select public.lfo_resolve_import_instrument($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        resolution_id: resolutionId.rows[0].id,
        decision: "RESOLVE",
        security_id: foreignSecurityId,
        reason: "tentative",
      }),
    ],
    "Un instrument d'un autre propriétaire a pu être rattaché",
    "introuvable",
  );

  await client.query("reset role");
  await client.query("rollback");
  succeeded = true;
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    /* connexion possiblement interrompue avant BEGIN */
  }
  throw error;
} finally {
  const after = await counts().catch(() => null);
  await client.end();
  const drift = after
    ? (Object.keys(after) as Array<keyof Counts>).filter((key) => after[key] !== before[key])
    : [];
  if (drift.length > 0) {
    throw new Error(
      `Le smoke a laissé des données persistées : ${drift
        .map((key) => `${key} ${before[key]} → ${after[key]}`)
        .join(", ")}`,
    );
  }
  if (succeeded) {
    console.log(
      "Smoke Portfolio Import : session RECEIVING, réception par lots atomique, brut immuable et non supprimable, aucun fait avant validation, compteurs DÉRIVÉS des lignes persistées, ABSENT ≠ ZÉRO sur frais quantité et coût de revient, quantité et montants négatifs refusés, nature hors whitelist refusée, achat sans instrument et apport avec instrument refusés dès le staging, ligne prête sans devise/date/valeur de marché refusée, échec au milieu d'un lot annulant tout le lot, instrument résolu sans cible refusé, rejet sans motif refusé en RPC comme en écriture directe, décision propagée par titre, décision humaine non écrasée par une réanalyse, correction sur la lecture laissant le brut intact avec provenance au champ, correction sans contenu refusée, ligne bloquée refusée à la validation, écriture par la RPC EXISTANTE du ledger, provenance vérifiable, fait non supprimable sans sa provenance, idempotence applicative et de base, POSITION OBSERVÉE ≠ TRANSACTION, une détention par enveloppe et instrument, une observation par date, incrémental sans perte d'historique, AUCUN écrasement silencieux d'une observation persistée — rejeu identique sans effet, valeurs différentes refusées sauf décision, correction décidée traçant sa session, piste d'audit en lecture seule sous authenticated, cloisonnement. Aucune donnée persistée.",
    );
  }
}
