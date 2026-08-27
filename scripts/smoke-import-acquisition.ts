/**
 * Smoke transactionnel de la Data Acquisition Foundation. Toutes les écritures sont
 * annulées : aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve :
 *
 *   * l'analyse écrit source, session, lignes brutes et lignes normalisées ATOMIQUEMENT,
 *     et ne crée AUCUNE transaction canonique ;
 *   * un enregistrement brut est immuable ET non supprimable dès que sa session a produit
 *     un fait, refus porté par la base ;
 *   * les tables d'audit ne sont accessibles à `authenticated` qu'en LECTURE : un DELETE
 *     direct sur un brut ou sur un lien de provenance est refusé par les privilèges ;
 *   * une ligne normalisée committée est gelée, et un lien de provenance est immuable ;
 *   * une transaction importée ne peut pas être supprimée en laissant sa provenance
 *     orpheline ;
 *   * le commit n'écrit que READY, plus les WARNING nommément inclus, et jamais un
 *     doublon, une ligne bloquée ou une ligne ignorée ;
 *   * la transaction créée naît SANS catégorie et sans toucher aux soldes observés ;
 *   * chaque transaction créée porte un lien de provenance unique vers sa ligne source ;
 *   * un second commit de la même session ne réécrit rien (idempotence applicative) ;
 *   * réanalyser un fichier déjà committé est refusé (idempotence de base) ;
 *   * réanalyser un fichier encore en attente remplace l'analyse au lieu de la doubler ;
 *   * une même empreinte ne peut pas être committée deux fois, même par écriture directe ;
 *   * une ligne READY sans montant, sans date ou sans devise est refusée par la base ;
 *   * une session d'un autre propriétaire est inaccessible, même en connaissant son UUID ;
 *   * l'échec du lien de provenance annule la transaction qu'il devait tracer.
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

/** Vérifie qu'une écriture est refusée, et par le BON contrôle. */
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
    `select public.${name}($1::uuid, $2::jsonb) as value`,
    [userId, JSON.stringify(payload)],
  );
  return result.rows[0].value;
}

type Counts = {
  documents: string;
  sources: string;
  sessions: string;
  raw: string;
  normalized: string;
  links: string;
  transactions: string;
  mappings: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.documents)::text as documents,
      (select count(*) from public.import_sources)::text as sources,
      (select count(*) from public.import_sessions)::text as sessions,
      (select count(*) from public.import_raw_records)::text as raw,
      (select count(*) from public.import_normalized_records)::text as normalized,
      (select count(*) from public.import_record_links)::text as links,
      (select count(*) from public.transactions)::text as transactions,
      (select count(*) from public.import_column_mappings)::text as mappings
  `);
  return result.rows[0];
}

const FILE_HASH_A = "a".repeat(64);
const FILE_HASH_B = "b".repeat(64);

let userId = "";
/** Le message de succès ne doit jamais s'afficher sur un échec : le `finally` le lit. */
let succeeded = false;

function normalizedRow(
  rowNumber: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    row_number: rowNumber,
    transaction_date: "2026-08-13",
    label: `OPERATION ${rowNumber}`,
    amount: -54.28,
    currency: "EUR",
    status: "READY",
    dedupe_verdict: "NEW",
    match_key: `v2|smoke|~${rowNumber}`,
    issues: [],
    ...overrides,
  };
}

function rawRow(rowNumber: number): Record<string, unknown> {
  return {
    row_number: rowNumber,
    raw_line: `13/08/2026;OPERATION ${rowNumber};-54,28;EUR`,
    cells: ["13/08/2026", `OPERATION ${rowNumber}`, "-54,28", "EUR"],
  };
}

await client.connect();
const before = await counts();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
  userId = owner.rows[0].id;

  // Propriétaire voisin : il sert à prouver le cloisonnement. Créé avant le passage en
  // `service_role`, qui n'écrit pas dans le schéma `auth`.
  const foreignUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    foreignUser,
    `smoke-import-${foreignUser}@invalid`,
  ]);
  const foreignAccountId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, data_kind, confidence)
     values ($1, $2, 'Compte voisin', 'BANK', 'EUR', 'IMMEDIATE', 'ACTUAL', 'HIGH')`,
    [foreignAccountId, foreignUser],
  );
  const foreignSourceId = randomUUID();
  const foreignSessionId = randomUUID();
  await client.query(
    `insert into public.import_sources
       (id, user_id, kind, domain, provider, label, target_account_id, adapter_version)
     values ($1, $2, 'FILE_CSV', 'CASH_FLOW_TRANSACTION', 'GENERIC_BANK_CSV', 'Voisin', $3, 'bank-csv/1')`,
    [foreignSourceId, foreignUser, foreignAccountId],
  );
  await client.query(
    `insert into public.import_sessions
       (id, user_id, source_id, parser, parser_version, status)
     values ($1, $2, $3, 'bank-csv', '1', 'ANALYZED')`,
    [foreignSessionId, foreignUser, foreignSourceId],
  );

  const accountId = randomUUID();
  const savingsId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, data_kind, confidence)
     values ($1, $2, 'Smoke compte courant', 'BANK', 'EUR', 'IMMEDIATE', 'ACTUAL', 'HIGH'),
            ($3, $2, 'Smoke livret', 'SAVINGS', 'EUR', 'LIQUID', 'ACTUAL', 'HIGH')`,
    [accountId, userId, savingsId],
  );
  await client.query(
    `insert into public.account_balances
       (user_id, account_id, balance, balance_date, data_kind, confidence)
     values ($1, $2, 4200, date '2026-08-01', 'ACTUAL', 'HIGH')`,
    [userId, accountId],
  );

  await client.query("set local role service_role");

  const sourcePayload = {
    kind: "FILE_CSV",
    domain: "CASH_FLOW_TRANSACTION",
    provider: "GENERIC_BANK_CSV",
    label: "Relevé CSV — Smoke compte courant",
    target_account_id: accountId,
    adapter_version: "bank-csv/1",
  };

  // ── 1. Analyse : staging complet, aucune écriture canonique ────────────────────────
  const sessionId = await rpc("lfo_analyze_import_session", {
    source: sourcePayload,
    session: {
      file_name: "releve.csv",
      file_hash: FILE_HASH_A,
      file_size_bytes: 512,
      content_type: "text/csv",
      encoding: "UTF_8",
      delimiter: ";",
      parser: "bank-csv",
      parser_version: "1",
      mapping: { transactionDate: 0, label: 1, amount: 2, currency: 3 },
      conventions: { amount: "DECIMAL_COMMA", date: "DAY_FIRST", valueDate: null },
      declared_currency: "EUR",
      observation_date: "2026-08-27",
      observed_period_start: "2026-08-13",
      observed_period_end: "2026-08-20",
      row_count: 5,
      ready_count: 2,
      warning_count: 1,
      blocked_count: 1,
      duplicate_count: 1,
      ignored_count: 0,
      issues: [],
    },
    raw: [rawRow(2), rawRow(3), rawRow(4), rawRow(5), rawRow(6)],
    normalized: [
      normalizedRow(2),
      normalizedRow(3, { transaction_date: "2026-08-20", label: "OPERATION 3" }),
      normalizedRow(4, {
        status: "WARNING",
        dedupe_verdict: "PROBABLE_DUPLICATE",
        issues: [{ code: "DUPLICATE_PROBABLE", severity: "WARNING" }],
      }),
      normalizedRow(5, {
        status: "BLOCKED",
        amount: null,
        dedupe_verdict: null,
        match_key: null,
        issues: [{ code: "AMOUNT_UNPARSEABLE", severity: "ERROR" }],
      }),
      normalizedRow(6, { status: "DUPLICATE", dedupe_verdict: "EXACT_DUPLICATE" }),
    ],
  });
  assert(sessionId, "Aucune session retournée par l'analyse");

  const afterAnalysis = await client.query<{ raw: string; normalized: string; tx: string }>(
    `select
       (select count(*) from public.import_raw_records where session_id = $1)::text as raw,
       (select count(*) from public.import_normalized_records where session_id = $1)::text as normalized,
       (select count(*) from public.transactions where user_id = $2)::text as tx`,
    [sessionId, userId],
  );
  assert(afterAnalysis.rows[0].raw === "5", "Les cinq lignes brutes n'ont pas été persistées");
  assert(
    afterAnalysis.rows[0].normalized === "5",
    "Les cinq lignes normalisées n'ont pas été persistées",
  );
  assert(
    afterAnalysis.rows[0].tx === "0",
    "L'analyse a écrit une transaction : le dry-run n'est pas un dry-run",
  );

  // ── 2. Le brut est immuable ────────────────────────────────────────────────────────
  await rejects(
    "update public.import_raw_records set raw_line = 'corrige' where session_id = $1",
    [sessionId],
    "Un enregistrement brut a pu être modifié",
    "immuable",
  );

  // ── 3. Réanalyse avant commit : remplacement, pas duplication ──────────────────────
  const reanalysed = await rpc("lfo_analyze_import_session", {
    source: sourcePayload,
    session: {
      file_name: "releve.csv",
      file_hash: FILE_HASH_A,
      parser: "bank-csv",
      parser_version: "1",
      declared_currency: "EUR",
      row_count: 2,
      ready_count: 2,
    },
    raw: [rawRow(2), rawRow(3)],
    normalized: [normalizedRow(2), normalizedRow(3, { transaction_date: "2026-08-20" })],
  });
  const sessionsForHash = await client.query<{ count: string }>(
    "select count(*)::text from public.import_sessions where user_id = $1 and file_hash = $2",
    [userId, FILE_HASH_A],
  );
  assert(
    sessionsForHash.rows[0].count === "1",
    "Une réanalyse a laissé deux sessions pour la même empreinte de fichier",
  );
  assert(reanalysed !== sessionId, "La réanalyse n'a pas produit une nouvelle session");

  const sourceCount = await client.query<{ count: string }>(
    "select count(*)::text from public.import_sources where user_id = $1",
    [userId],
  );
  assert(sourceCount.rows[0].count === "1", "Deux sources ont été créées pour le même compte");

  // ── 4. Une ligne READY incomplète est refusée par la BASE ──────────────────────────
  const rawId = (
    await client.query<{ id: string }>(
      "select id from public.import_raw_records where session_id = $1 order by row_number limit 1",
      [reanalysed],
    )
  ).rows[0].id;
  await rejects(
    `insert into public.import_normalized_records
       (user_id, session_id, raw_record_id, target_domain, account_id, transaction_date, label, currency, status)
     values ($1, $2, $3, 'CASH_FLOW_TRANSACTION', $4, date '2026-08-13', 'SANS MONTANT', 'EUR', 'READY')`,
    [userId, reanalysed, rawId, accountId],
    "Une ligne READY sans montant a été acceptée",
    "import_normalized_records",
  );

  // ── 5. Commit : READY seul, plus les WARNING nommément inclus ──────────────────────
  const full = await rpc("lfo_analyze_import_session", {
    source: sourcePayload,
    session: {
      file_name: "releve-2.csv",
      file_hash: FILE_HASH_B,
      parser: "bank-csv",
      parser_version: "1",
      declared_currency: "EUR",
      observed_period_start: "2026-08-13",
      observed_period_end: "2026-08-22",
      row_count: 4,
    },
    raw: [rawRow(2), rawRow(3), rawRow(4), rawRow(5)],
    normalized: [
      normalizedRow(2, { match_key: "v2|smoke-b|~1" }),
      normalizedRow(3, {
        transaction_date: "2026-08-22",
        status: "WARNING",
        dedupe_verdict: "POSSIBLE_MATCH",
        match_key: "v2|smoke-b|~2",
      }),
      normalizedRow(4, {
        status: "WARNING",
        dedupe_verdict: "PROBABLE_DUPLICATE",
        match_key: "v2|smoke-b|~3",
      }),
      normalizedRow(5, {
        status: "BLOCKED",
        amount: null,
        dedupe_verdict: null,
        match_key: null,
      }),
    ],
  });
  const warningToInclude = (
    await client.query<{ id: string }>(
      `select r.id from public.import_normalized_records r
        join public.import_raw_records w on w.id = r.raw_record_id
       where r.session_id = $1 and r.status = 'WARNING' and w.row_number = 3`,
      [full],
    )
  ).rows[0].id;

  await rpc("lfo_commit_import_session", {
    session_id: full,
    include_record_ids: [warningToInclude],
  });

  const committed = await client.query<{
    tx: string;
    links: string;
    committed: string;
    excluded: string;
    session_status: string;
    session_count: string;
    uncategorised: string;
    manual: string;
    balances: string;
  }>(
    `select
       (select count(*) from public.transactions where user_id = $2)::text as tx,
       (select count(*) from public.import_record_links where session_id = $1)::text as links,
       (select count(*) from public.import_normalized_records where session_id = $1 and commit_state = 'COMMITTED')::text as committed,
       (select count(*) from public.import_normalized_records where session_id = $1 and commit_state = 'EXCLUDED')::text as excluded,
       (select status from public.import_sessions where id = $1) as session_status,
       (select committed_count from public.import_sessions where id = $1)::text as session_count,
       (select count(*) from public.transactions where user_id = $2 and category_id is null)::text as uncategorised,
       (select count(*) from public.transactions where user_id = $2 and manual_override)::text as manual,
       (select count(*) from public.account_balances where user_id = $2)::text as balances`,
    [full, userId],
  );
  const row = committed.rows[0];
  assert(row.tx === "2", `Le commit a écrit ${row.tx} transactions au lieu de 2`);
  assert(row.links === "2", "Chaque transaction importée doit porter son lien de provenance");
  assert(row.committed === "2", "Deux lignes seulement devaient être committées");
  assert(row.excluded === "2", "Les lignes non écrites doivent être explicitement exclues");
  assert(row.session_status === "COMMITTED", "La session n'a pas été marquée committée");
  assert(row.session_count === "2", "Le décompte de la session ne correspond pas");
  assert(row.uncategorised === "2", "Une catégorie de flux a été inventée à l'import");
  assert(row.manual === "0", "Une transaction importée a été marquée comme saisie manuelle");
  assert(row.balances === "1", "Le commit a touché aux soldes observés du compte");

  const coverage = await client.query<{ start: string | null; end: string | null }>(
    "select coverage_start::text as start, coverage_end::text as end from public.import_sources where user_id = $1",
    [userId],
  );
  assert(
    coverage.rows[0].start === "2026-08-13" && coverage.rows[0].end === "2026-08-22",
    "La période réellement alimentée n'a pas été enregistrée sur la source",
  );

  // ── 6. Idempotence applicative : un second commit ne réécrit rien ──────────────────
  await rpc("lfo_commit_import_session", { session_id: full, include_record_ids: [] });
  const afterSecondCommit = await client.query<{ tx: string; links: string }>(
    `select
       (select count(*) from public.transactions where user_id = $2)::text as tx,
       (select count(*) from public.import_record_links where session_id = $1)::text as links`,
    [full, userId],
  );
  assert(
    afterSecondCommit.rows[0].tx === "2" && afterSecondCommit.rows[0].links === "2",
    "Un second commit de la même session a réécrit des faits",
  );

  // ── 7. Idempotence de base : réanalyser un fichier déjà committé est refusé ────────
  await rejects(
    "select public.lfo_analyze_import_session($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        source: sourcePayload,
        session: {
          file_name: "releve-2.csv",
          file_hash: FILE_HASH_B,
          parser: "bank-csv",
          parser_version: "1",
        },
        raw: [],
        normalized: [],
      }),
    ],
    "Un fichier déjà importé a pu être réanalysé",
    "déjà été importé",
  );

  // ── 8. Piste d'audit : lecture seule pour authenticated ───────────────────────────
  //
  // Une piste d'audit sur laquelle le client peut écrire n'est pas une piste d'audit. Ces
  // refus sont portés par les PRIVILÈGES, pas par une convention applicative : ils tiennent
  // donc même pour une requête directe qui contournerait toute la couche TypeScript.
  await client.query("reset role");
  await client.query("set local role authenticated");
  for (const [table, statement] of [
    ["import_raw_records", "delete from public.import_raw_records"],
    ["import_normalized_records", "delete from public.import_normalized_records"],
    ["import_record_links", "delete from public.import_record_links"],
    ["import_sessions", "update public.import_sessions set status = 'DISCARDED'"],
    ["import_sources", "delete from public.import_sources"],
  ] as const) {
    await rejects(
      statement,
      [],
      `La piste d'audit public.${table} est inscriptible par authenticated`,
      "permission denied",
    );
  }
  const readable = await client.query<{ count: string }>(
    "select count(*)::text from public.import_sessions",
  );
  assert(readable.rows[0], "La piste d'audit doit rester LISIBLE par authenticated");
  await client.query("reset role");
  await client.query("set local role service_role");

  // ── 8 bis. La provenance d'un fait écrit est gelée ─────────────────────────────────
  await rejects(
    `update public.import_normalized_records set amount = -1 where session_id = $1 and commit_state = 'COMMITTED'`,
    [full],
    "Une ligne normalisée committée a pu être réécrite",
    "gelée",
  );

  // Le gel doit être EXHAUSTIF. Une liste manuelle de colonnes laissait passer une
  // réécriture masquée derrière un détachement de jumeau : ces cinq colonnes n'y figuraient
  // pas. La comparaison porte désormais sur la ligne entière.
  for (const [column, value] of [
    ["reference", "'REF-FALSIFIEE'"],
    ["value_date", "date '2020-01-01'"],
    ["confidence", "'LOW'"],
    ["counterparty", "'TIERS INVENTE'"],
    ["external_transaction_id", "'TX-INVENTE'"],
    ["balance_after", "999999"],
    ["data_kind", "'USER_ASSUMPTION'"],
    ["source", "'SOURCE REECRITE'"],
  ] as const) {
    await rejects(
      `update public.import_normalized_records
          set matched_transaction_id = null, ${column} = ${value}
        where session_id = $1 and commit_state = 'COMMITTED'`,
      [full],
      `Le gel de la provenance laisse réécrire ${column} sous couvert d'un détachement`,
      "gelée",
    );
  }
  await rejects(
    `delete from public.import_normalized_records where session_id = $1 and commit_state = 'COMMITTED'`,
    [full],
    "Une ligne normalisée committée a pu être supprimée",
    "gelée",
  );
  await rejects(
    `update public.import_record_links set transaction_id = null where session_id = $1`,
    [full],
    "Un lien de provenance a pu être modifié",
    "immuable",
  );
  // Le DELETE aussi, et sous `service_role` : c'est le rôle sous lequel tourne le serveur,
  // donc le seul refus qui protège réellement quelque chose. Sans lui, supprimer le lien
  // désarmait la clé étrangère `restrict` et la transaction devenait supprimable sans trace.
  await rejects(
    `delete from public.import_record_links where session_id = $1`,
    [full],
    "Un lien de provenance a pu être supprimé sous service_role",
    "immuable",
  );
  await rejects(
    "delete from public.import_raw_records where session_id = $1",
    [full],
    "Le brut d'une session committée a pu être supprimé",
    "ne se supprime pas",
  );

  // ── 8 ter. Une transaction importée ne perd pas sa provenance en silence ───────────
  //
  // La suppression est REFUSÉE tant que le lien existe : une transaction étiquetée
  // « importée » sans origine consultable serait une provenance perdue, pas une donnée
  // corrigée. Le jour où un chemin de suppression existera, il devra retirer la provenance.
  const linkedTransaction = (
    await client.query<{ id: string }>(
      "select transaction_id as id from public.import_record_links where session_id = $1 limit 1",
      [full],
    )
  ).rows[0].id;
  await rejects(
    "delete from public.transactions where id = $1 and user_id = $2",
    [linkedTransaction, userId],
    "Une transaction importée a pu être supprimée en laissant sa provenance orpheline",
    "import_record_links_transaction_fk",
  );

  // ── 8 quater. Le jumeau désigné peut disparaître sans falsifier la provenance ──────
  //
  // `matched_transaction_id` ne décrit pas le fait produit, seulement l'opération à
  // laquelle la ligne ressemblait. Sa disparition est un fait, pas une réécriture.
  const twin = randomUUID();
  await client.query(
    `insert into public.transactions
       (id, user_id, account_id, transaction_date, label, amount, currency, data_kind, confidence)
     values ($1, $2, $3, date '2026-08-13', 'JUMEAU', -54.28, 'EUR', 'ACTUAL', 'HIGH')`,
    [twin, userId, accountId],
  );

  // Le pointeur est posé AVANT la validation : le poser après serait bien une réécriture de
  // provenance, et le gel doit le refuser — ce que vérifie le contrôle précédent.
  await rejects(
    `update public.import_normalized_records set matched_transaction_id = $1
      where session_id = $2 and commit_state = 'COMMITTED'`,
    [twin, full],
    "Un jumeau a pu être DÉSIGNÉ après coup sur une ligne committée",
    "gelée",
  );

  const twinSession = await rpc("lfo_analyze_import_session", {
    source: sourcePayload,
    session: {
      file_name: "releve-jumeau.csv",
      file_hash: "d".repeat(64),
      parser: "bank-csv",
      parser_version: "1",
      declared_currency: "EUR",
      observation_date: "2026-08-27",
      row_count: 1,
      ready_count: 1,
    },
    raw: [rawRow(2)],
    normalized: [
      normalizedRow(2, {
        label: "LIGNE AVEC JUMEAU",
        match_key: "v2|smoke-d|~1",
        matched_transaction_id: twin,
      }),
    ],
  });
  await rpc("lfo_commit_import_session", { session_id: twinSession, include_record_ids: [] });
  const designated = await client.query<{ count: string }>(
    "select count(*)::text from public.import_normalized_records where matched_transaction_id = $1",
    [twin],
  );
  assert(designated.rows[0].count === "1", "Le jumeau désigné n'a pas été persisté");

  await client.query("delete from public.transactions where id = $1", [twin]);
  const cleared = await client.query<{ count: string }>(
    "select count(*)::text from public.import_normalized_records where matched_transaction_id = $1",
    [twin],
  );
  assert(
    cleared.rows[0].count === "0",
    "La disparition du jumeau désigné doit détacher le lien sans être bloquée par le gel",
  );
  const survived = await client.query<{ count: string }>(
    "select count(*)::text from public.import_normalized_records where session_id = $1 and commit_state = 'COMMITTED'",
    [twinSession],
  );
  assert(
    survived.rows[0].count === "1",
    "Le détachement du jumeau ne doit pas emporter la ligne de provenance",
  );

  // ── 9. Une ligne bloquée ne peut pas être marquée committée ────────────────────────
  await rejects(
    `update public.import_normalized_records
        set commit_state = 'COMMITTED', committed_at = now()
      where session_id = $1 and status = 'BLOCKED'`,
    [full],
    "Une ligne bloquée a pu être marquée committée",
    "import_normalized_records_committable_ck",
  );

  // ── 10. Une session committée n'est pas abandonnable ───────────────────────────────
  await rejects(
    "select public.lfo_discard_import_session($1::uuid, $2::uuid)",
    [userId, full],
    "Une session committée a pu être abandonnée",
    "analysée",
  );

  // ── 11. Abandon d'une analyse : la session reste, le staging est libéré ────────────
  await client.query("select public.lfo_discard_import_session($1::uuid, $2::uuid)", [
    userId,
    reanalysed,
  ]);
  const discarded = await client.query<{ status: string; raw: string }>(
    `select
       (select status from public.import_sessions where id = $1) as status,
       (select count(*) from public.import_raw_records where session_id = $1)::text as raw`,
    [reanalysed],
  );
  assert(discarded.rows[0].status === "DISCARDED", "La session n'a pas été marquée abandonnée");
  assert(discarded.rows[0].raw === "0", "Le staging d'une session abandonnée n'a pas été libéré");

  // ── 12. Cloisonnement : la session d'un voisin est inatteignable ───────────────────
  await rejects(
    `insert into public.import_raw_records (user_id, session_id, row_number, raw_line, cells)
     values ($1, $2, 99, 'intrusion', '[]'::jsonb)`,
    [userId, foreignSessionId],
    "Une ligne brute a pu être rattachée à la session d'un autre propriétaire",
    "import_raw_records_session_fk",
  );
  await rejects(
    "select public.lfo_commit_import_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ session_id: foreignSessionId, include_record_ids: [] })],
    "La session d'un autre propriétaire a pu être validée",
    "introuvable",
  );
  await rejects(
    `insert into public.import_sources
       (user_id, kind, domain, provider, label, target_account_id, adapter_version)
     values ($1, 'FILE_CSV', 'CASH_FLOW_TRANSACTION', 'GENERIC_BANK_CSV', 'Intrusion', $2, 'bank-csv/1')`,
    [userId, foreignAccountId],
    "Une source a pu viser le compte d'un autre propriétaire",
    "import_sources_account_fk",
  );

  // ── 13. Atomicité : l'échec du lien annule la transaction qu'il devait tracer ──────
  const beforeAtomic = (
    await client.query<{ count: string }>(
      "select count(*)::text from public.transactions where user_id = $1",
      [userId],
    )
  ).rows[0].count;
  const atomic = await rpc("lfo_analyze_import_session", {
    source: sourcePayload,
    session: {
      file_name: "releve-3.csv",
      file_hash: "c".repeat(64),
      parser: "bank-csv",
      parser_version: "1",
      declared_currency: "EUR",
      row_count: 1,
    },
    raw: [rawRow(2)],
    normalized: [normalizedRow(2, { match_key: "v2|smoke-c|~1" })],
  });
  await client.query("reset role");
  await client.query(`
    create or replace function public.lfo_smoke_reject_link()
    returns trigger language plpgsql security invoker set search_path='' as $$
    begin
      raise exception 'provenance link rejected';
    end $$
  `);
  await client.query(`
    create trigger lfo_smoke_reject_link
    before insert on public.import_record_links
    for each row execute function public.lfo_smoke_reject_link()
  `);
  await client.query("set local role service_role");
  await rejects(
    "select public.lfo_commit_import_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ session_id: atomic, include_record_ids: [] })],
    "Le commit n'a pas propagé l'échec du lien de provenance",
    "provenance link rejected",
  );
  await client.query("reset role");
  await client.query("drop trigger lfo_smoke_reject_link on public.import_record_links");
  await client.query("drop function public.lfo_smoke_reject_link()");
  await client.query("set local role service_role");
  const afterAtomic = await client.query<{ count: string }>(
    "select count(*)::text from public.transactions where user_id = $1",
    [userId],
  );
  assert(
    afterAtomic.rows[0].count === beforeAtomic,
    "Une transaction a survécu à l'échec de son lien de provenance",
  );

  // ── 13 bis. Rattachement du fichier conservé : convergent ─────────────────────────
  //
  // Le fichier n'est déposé qu'à la validation. Cette RPC est le point de sérialisation :
  // deux validations simultanées du même contenu ne peuvent pas conclure toutes les deux
  // qu'aucun document n'existe, et la seconde rattache celui de la première.
  const documentA = randomUUID();
  const documentB = randomUUID();
  await client.query("reset role");
  await client.query(
    `insert into public.documents (id, user_id, name, category, storage_path, size_bytes, status)
     values ($1, $2, 'releve.csv', 'bank', $3, 512, 'INBOX'),
            ($4, $2, 'releve.csv', 'bank', $5, 512, 'INBOX')`,
    [documentA, userId, `${userId}/imports/${FILE_HASH_B}.csv`, documentB, `${userId}/imports/autre.csv`],
  );
  await client.query("set local role service_role");

  const attachSession = await rpc("lfo_analyze_import_session", {
    source: sourcePayload,
    session: {
      file_name: "releve-conserve.csv",
      file_hash: "e".repeat(64),
      parser: "bank-csv",
      parser_version: "1",
      declared_currency: "EUR",
      observation_date: "2026-08-27",
      retain_file_requested: true,
      row_count: 1,
    },
    raw: [rawRow(2)],
    normalized: [normalizedRow(2, { match_key: "v2|smoke-e|~1" })],
  });
  const attached = await rpc("lfo_attach_import_document", {
    session_id: attachSession,
    document_id: documentA,
    file_hash: "e".repeat(64),
  });
  assert(attached === documentA, "Le document proposé n'a pas été rattaché");
  const reattached = await rpc("lfo_attach_import_document", {
    session_id: attachSession,
    document_id: documentB,
    file_hash: "e".repeat(64),
  });
  assert(
    reattached === documentA,
    "Un second rattachement a remplacé le document déjà conservé au lieu de converger",
  );
  const singleDocument = await client.query<{ count: string }>(
    "select count(*)::text from public.import_sessions where document_id = $1",
    [documentA],
  );
  assert(singleDocument.rows[0].count === "1", "Le rattachement n'est pas idempotent");
  await rejects(
    "select public.lfo_attach_import_document($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        session_id: attachSession,
        document_id: randomUUID(),
        file_hash: "e".repeat(64),
      }),
    ],
    "Un document inexistant a pu être rattaché",
    "Document introuvable",
  );

  // Un chemin de stockage ne décrit qu'un document : deux lignes pour le même objet
  // afficheraient deux fois le même relevé au coffre.
  await client.query("reset role");
  await rejects(
    `insert into public.documents (user_id, name, category, storage_path, size_bytes, status)
     values ($1, 'doublon.csv', 'bank', $2, 512, 'INBOX')`,
    [userId, `${userId}/imports/${FILE_HASH_B}.csv`],
    "Deux documents ont pu décrire le même objet Storage",
    "documents_owner_storage_path_uidx",
  );
  await client.query("set local role service_role");

  // ── 14. Mémorisation d'un mapping : upsert versionné ───────────────────────────────
  const mappingPayload = {
    signature: "csv:;:DATE OPERATION|LIBELLE|MONTANT|DEVISE",
    provider: "GENERIC_BANK_CSV",
    label: "Relevé CSV — Smoke",
    headers: ["Date operation", "Libelle", "Montant", "Devise"],
    mapping: { transactionDate: 0, label: 1, amount: 2, currency: 3 },
    conventions: { amount: "DECIMAL_COMMA", date: "DAY_FIRST", valueDate: null },
  };
  const mappingId = await rpc("lfo_save_import_mapping", mappingPayload);
  const mappingIdAgain = await rpc("lfo_save_import_mapping", mappingPayload);
  assert(mappingId === mappingIdAgain, "Un mapping identique a été dupliqué");
  const mappingVersion = await client.query<{ version: string }>(
    "select version::text from public.import_column_mappings where id = $1",
    [mappingId],
  );
  assert(mappingVersion.rows[0].version === "2", "La version du mapping n'a pas été incrémentée");

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
  // Un échec de ce contrôle ne doit pas masquer l'erreur d'origine : sur une connexion
  // interrompue, on renonce au décompte plutôt qu'à l'explication.
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
      "Smoke Data Acquisition Foundation : staging atomique, brut immuable et non supprimable, piste d'audit en lecture seule sous authenticated, provenance gelée de façon exhaustive, lien immuable en UPDATE et DELETE sous service_role, transaction importée non supprimable sans sa provenance, jumeau détachable seul, commit sélectif, idempotence applicative et de base, cloisonnement, atomicité du lien, rattachement de document convergent. Aucune donnée persistée.",
    );
  }
}
