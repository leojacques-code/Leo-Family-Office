/**
 * Smoke transactionnel de l'Open Banking (AIS), lecture seule. Toutes les écritures sont
 * annulées : aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve :
 *
 *   * un fournisseur ne persiste AUCUNE valeur de secret, seulement une référence opaque,
 *     et un mode d'authentification non-fixture sans coffre est REFUSÉ ;
 *   * un consentement porte ses dates : EXPIRATION NON DÉCLARÉE ≠ SANS EXPIRATION, révoqué
 *     ≠ expiré, et la révocation est TERMINALE ;
 *   * un compte fournisseur naît NON RATTACHÉ, aucun compte canonique n'est créé d'office ;
 *   * un compte canonique est alimenté par AU PLUS UN compte fournisseur ;
 *   * une synchronisation refuse de démarrer sur un compte non rattaché, un consentement non
 *     actif, révoqué, expiré ou sans portée TRANSACTIONS ;
 *   * une seule exécution EN COURS par compte : la seconde est refusée par la BASE ;
 *   * une page écrit son brut, ses observations, son brut par opération et son staging en UNE
 *     transaction ; un échec au milieu annule la page ENTIÈRE ;
 *   * rejouer une page est refusé ; réobserver une identité démontrée ne duplique pas
 *     l'observation ;
 *   * le brut est numéroté de façon CONTINUE dans la session ;
 *   * le curseur ne progresse qu'après écriture réelle : une reprise ne saute rien ;
 *   * un échec conserve son curseur, nomme sa cause et n'efface pas ce qui a été lu ;
 *   * les décomptes de session sont DÉRIVÉS des lignes persistées, jamais repris de l'appelant ;
 *   * AUCUN fait canonique n'existe avant validation : OBSERVATION ≠ FAIT CANONIQUE ;
 *   * un refus se MOTIVE, un rattachement DÉSIGNE, une acceptation ne désigne rien ;
 *   * une opération ANNULÉE par la banque n'entre jamais au canonique ;
 *   * la validation écrit transaction, provenance et marque de commit atomiquement ;
 *   * une observation déjà écrite n'est jamais reproposée : c'est le refus du double comptage ;
 *   * une observation écrite est GELÉE sur ce qui décrit le fait, vivante sur sa dernière vue ;
 *   * une page brute d'une synchronisation à faits ne se supprime pas, et le garde-fou lit
 *     l'existence de l'exécution INDÉPENDAMMENT de la RLS de l'appelant ;
 *   * SOLDE ABSENT ≠ SOLDE À ZÉRO, un montant sans devise est refusé, une observation par
 *     nature et par date CORRIGE au lieu de s'ajouter ;
 *   * le rejeu d'un webhook est refusé par la BASE, et un événement non signé ne déclenche rien ;
 *   * AUCUNE INITIATION DE PAIEMENT n'existe dans la surface Open Banking ;
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

async function rpc(name: string, payload: Record<string, unknown>): Promise<string> {
  const result = await client.query<{ value: string }>(
    `select public.${name}($1::uuid, $2::jsonb)::text as value`,
    [userId, JSON.stringify(payload)],
  );
  return result.rows[0].value;
}

type Counts = {
  providers: string;
  institutions: string;
  consents: string;
  providerAccounts: string;
  cursors: string;
  runs: string;
  rawPages: string;
  observations: string;
  balances: string;
  decisions: string;
  events: string;
  sources: string;
  sessions: string;
  raw: string;
  normalized: string;
  links: string;
  transactions: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.bank_providers)::text as "providers",
      (select count(*) from public.bank_institutions)::text as "institutions",
      (select count(*) from public.bank_consents)::text as "consents",
      (select count(*) from public.bank_provider_accounts)::text as "providerAccounts",
      (select count(*) from public.bank_sync_cursors)::text as "cursors",
      (select count(*) from public.bank_sync_runs)::text as "runs",
      (select count(*) from public.bank_sync_raw_pages)::text as "rawPages",
      (select count(*) from public.bank_observed_transactions)::text as "observations",
      (select count(*) from public.bank_balance_observations)::text as "balances",
      (select count(*) from public.bank_reconciliation_decisions)::text as "decisions",
      (select count(*) from public.bank_sync_events)::text as "events",
      (select count(*) from public.import_sources)::text as "sources",
      (select count(*) from public.import_sessions)::text as "sessions",
      (select count(*) from public.import_raw_records)::text as "raw",
      (select count(*) from public.import_normalized_records)::text as "normalized",
      (select count(*) from public.import_record_links)::text as "links",
      (select count(*) from public.transactions)::text as "transactions"
  `);
  return result.rows[0];
}

let userId = "";
let succeeded = false;

const CAPABILITIES = {
  stableTransactionIds: true,
  pendingTransactions: true,
  bookingDate: true,
  valueDate: true,
  balanceTypes: ["BOOKED", "AVAILABLE"],
  transactionCorrections: true,
  webhooks: true,
  declaredHistoryDays: 90,
  pageSize: 2,
};

function observationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    raw_item: { id: "tx-1", amount: -51.84, currency: "EUR", label: "Café" },
    state: "BOOKED",
    provider_transaction_id: "tx-1",
    operation_date: "2026-08-19",
    value_date: "2026-08-20",
    booking_date: "2026-08-20",
    amount: -51.84,
    currency: "EUR",
    label: "Café",
    counterparty: "BAR DU COIN",
    reference: "REF-MENSUELLE",
    match_key: "acct|2026-08-19|-51.840000|EUR|cafe",
    external_key: "sandbox-ais:tx-1",
    status: "READY",
    dedupe_verdict: "NEW",
    issues: [],
    ...overrides,
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

  // Propriétaire voisin : il sert à prouver le cloisonnement. Créé AVANT le passage en
  // `service_role`, qui n'écrit pas dans le schéma `auth`.
  const foreignUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    foreignUser,
    `smoke-openbanking-${foreignUser}@invalid`,
  ]);

  await client.query("set local role service_role");

  const accountId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, 'Compte courant smoke', 'CHECKING', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [accountId, userId],
  );
  const secondAccountId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, 'Livret smoke', 'SAVINGS', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [secondAccountId, userId],
  );

  // ── 1. Fournisseur : une RÉFÉRENCE de secret, jamais un secret ────────────────────
  //
  // La garantie principale n'est pas une contrainte, c'est l'ABSENCE de colonne capable
  // d'accueillir une valeur. La contrainte de forme rend l'erreur bruyante par-dessus.
  const providerId = await rpc("lfo_register_bank_provider", {
    adapter_id: "sandbox-ais",
    adapter_version: "1",
    label: "Sandbox AIS",
    auth_mode: "FIXTURE",
    capabilities: CAPABILITIES,
  });
  await rejects(
    "select public.lfo_register_bank_provider($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ adapter_id: "sans-capacites", auth_mode: "FIXTURE" })],
    "Un adaptateur sans capacités déclarées a été enregistré",
    "Capacités",
  );
  await rejects(
    `insert into public.bank_providers
       (user_id, adapter_id, adapter_version, label, auth_mode, capabilities)
     values ($1, 'oauth-sans-coffre', '1', 'X', 'OAUTH2_AUTHORIZATION_CODE', '{}'::jsonb)`,
    [userId],
    "Un fournisseur OAuth sans coffre à secrets a été accepté",
    "bank_providers_auth_secret_ck",
  );
  await rejects(
    `insert into public.bank_providers
       (user_id, adapter_id, adapter_version, label, auth_mode, capabilities, secret_vault, secret_key)
     values ($1, 'jeton-en-clair', '1', 'X', 'API_KEY', '{}'::jsonb, 'ENV',
             'valeur de secret collee ici par erreur')`,
    [userId],
    "Une valeur de jeton a pu passer pour une référence de secret",
    "bank_providers_secret_reference_ck",
  );
  await rejects(
    `insert into public.bank_providers
       (user_id, adapter_id, adapter_version, label, auth_mode, capabilities, secret_vault)
     values ($1, 'coffre-sans-cle', '1', 'X', 'API_KEY', '{}'::jsonb, 'ENV')`,
    [userId],
    "Un coffre sans clé a été accepté : il ne désigne rien",
    "bank_providers_secret_shape_ck",
  );

  // ── 2. Consentement : dates, portées, révocation terminale ────────────────────────
  await rejects(
    "select public.lfo_open_bank_consent($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ provider_id: providerId, consent_reference: "c-vide", scopes: [] })],
    "Un consentement sans portée a été ouvert",
    "portée",
  );
  await rejects(
    `insert into public.bank_consents
       (user_id, provider_id, consent_reference, scopes, status, expiry_declared, expires_at)
     values ($1, $2, 'c-forme', array['TRANSACTIONS'], 'PENDING', false, now() + interval '30 days')`,
    [userId, providerId],
    "Une date d'expiration a pu exister sans être DÉCLARÉE",
    "bank_consents_expiry_shape_ck",
  );
  await rejects(
    `insert into public.bank_consents
       (user_id, provider_id, consent_reference, scopes, status, expiry_declared)
     values ($1, $2, 'c-forme2', array['TRANSACTIONS'], 'PENDING', true)`,
    [userId, providerId],
    "Une expiration DÉCLARÉE a pu exister sans date",
    "bank_consents_expiry_shape_ck",
  );
  await rejects(
    `insert into public.bank_consents
       (user_id, provider_id, consent_reference, scopes, status)
     values ($1, $2, 'c-actif-sans-octroi', array['TRANSACTIONS'], 'ACTIVE')`,
    [userId, providerId],
    "Un consentement actif a pu exister sans date d'octroi",
    "bank_consents_active_shape_ck",
  );
  await rejects(
    `insert into public.bank_consents
       (user_id, provider_id, consent_reference, scopes, status, granted_at)
     values ($1, $2, 'c-revoque-sans-date', array['TRANSACTIONS'], 'REVOKED', now())`,
    [userId, providerId],
    "Une révocation a pu exister sans date",
    "bank_consents_revoked_shape_ck",
  );
  await rejects(
    `insert into public.bank_consents
       (user_id, provider_id, consent_reference, scopes, status)
     values ($1, $2, 'c-portee-inconnue', array['PAYMENT_INITIATION'], 'PENDING')`,
    [userId, providerId],
    "Une portée hors ACCOUNTS/BALANCES/TRANSACTIONS a été acceptée",
    "bank_consents_scopes_ck",
  );

  const consentId = await rpc("lfo_open_bank_consent", {
    provider_id: providerId,
    consent_reference: "consent-smoke",
    scopes: ["ACCOUNTS", "BALANCES", "TRANSACTIONS"],
    status: "ACTIVE",
    expiry_declared: true,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
  const consentShape = await client.query<{ granted: string | null; expires: string | null }>(
    "select granted_at::text as granted, expires_at::text as expires from public.bank_consents where id = $1",
    [consentId],
  );
  assert(consentShape.rows[0].granted !== null, "Un consentement actif doit porter son octroi");
  assert(
    consentShape.rows[0].expires !== null,
    "Une expiration déclarée doit porter sa date en base",
  );

  // ── 3. Comptes fournisseur : NON RATTACHÉS à la naissance ─────────────────────────
  const accountsSeen = await rpc("lfo_sync_bank_accounts", {
    consent_id: consentId,
    accounts: [
      {
        provider_account_id: "pa-1",
        provider_institution_id: "inst-1",
        institution_name: "Banque Sandbox",
        country_code: "FR",
        name: "Compte courant",
        masked_identifier: "FR76****1234",
        account_type: "CHECKING",
        currency: "EUR",
      },
      { provider_account_id: "pa-2", name: "Livret", currency: "EUR" },
    ],
  });
  assert(accountsSeen === "2", "Les deux comptes fournisseur doivent être enregistrés");
  const unmapped = await client.query<{ count: string }>(
    `select count(*)::text from public.bank_provider_accounts
      where consent_id = $1 and account_id is null`,
    [consentId],
  );
  assert(
    unmapped.rows[0].count === "2",
    "Un compte fournisseur naît NON RATTACHÉ : rien n'est deviné",
  );
  const noAccountCreated = await client.query<{ count: string }>(
    "select count(*)::text from public.financial_accounts where user_id = $1",
    [userId],
  );
  assert(
    noAccountCreated.rows[0].count === "2",
    "Aucun compte canonique ne doit être créé d'office par une synchronisation",
  );

  const providerAccountId = (
    await client.query<{ id: string }>(
      "select id from public.bank_provider_accounts where consent_id = $1 and provider_account_id = 'pa-1'",
      [consentId],
    )
  ).rows[0].id;
  const secondProviderAccountId = (
    await client.query<{ id: string }>(
      "select id from public.bank_provider_accounts where consent_id = $1 and provider_account_id = 'pa-2'",
      [consentId],
    )
  ).rows[0].id;

  // Un rattachement est une DÉCISION datée : la base refuse un compte rattaché sans date.
  await rejects(
    "update public.bank_provider_accounts set account_id = $1 where id = $2",
    [accountId, providerAccountId],
    "Un rattachement a pu être écrit sans date de décision",
    "bank_provider_accounts_mapping_shape_ck",
  );

  await rpc("lfo_map_bank_account", {
    provider_account_id: providerAccountId,
    account_id: accountId,
    reason: "IBAN partiel concordant, confirmé par le relevé",
  });
  const source = await client.query<{ kind: string; domain: string; provider: string }>(
    `select kind, domain, provider from public.import_sources
      where user_id = $1 and target_account_id = $2`,
    [userId, accountId],
  );
  assert(
    source.rows[0].kind === "API" && source.rows[0].domain === "CASH_FLOW_TRANSACTION",
    "Une synchronisation alimente le MÊME domaine qu'un relevé : aucune whitelist élargie",
  );

  // INVARIANT : un compte canonique est alimenté par AU PLUS UN compte fournisseur.
  await rejects(
    "select public.lfo_map_bank_account($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({ provider_account_id: secondProviderAccountId, account_id: accountId }),
    ],
    "Deux comptes fournisseur ont pu alimenter le même compte canonique",
    "bank_provider_accounts_canonical_uidx",
  );

  // ── 4. Refus de démarrage ─────────────────────────────────────────────────────────
  await rejects(
    "select public.lfo_open_bank_sync_run($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ provider_account_id: secondProviderAccountId })],
    "Une synchronisation a démarré sur un compte NON RATTACHÉ",
    "non rattaché",
  );
  await client.query("savepoint scope_guard");
  await client.query("update public.bank_consents set scopes = array['ACCOUNTS'] where id = $1", [
    consentId,
  ]);
  await rejects(
    "select public.lfo_open_bank_sync_run($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ provider_account_id: providerAccountId })],
    "Une synchronisation a démarré sans portée TRANSACTIONS",
    "portée TRANSACTIONS",
  );
  await client.query("rollback to savepoint scope_guard");

  await client.query("savepoint expiry_guard");
  await client.query(
    `update public.bank_consents
        set expiry_declared = true,
            granted_at = now() - interval '60 days',
            expires_at = now() - interval '1 day'
      where id = $1`,
    [consentId],
  );
  await rejects(
    "select public.lfo_open_bank_sync_run($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ provider_account_id: providerAccountId })],
    "Une synchronisation a démarré sur un consentement EXPIRÉ",
    "expiré",
  );
  await client.query("rollback to savepoint expiry_guard");

  await client.query("savepoint revoke_guard");
  await rpc("lfo_set_bank_consent_status", {
    consent_id: consentId,
    status: "REVOKED",
    reason: "Retrait décidé par l'utilisateur",
  });
  await rejects(
    "select public.lfo_open_bank_sync_run($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ provider_account_id: providerAccountId })],
    "Une synchronisation a démarré sur un consentement RÉVOQUÉ",
    "révoqué",
  );
  // La révocation est TERMINALE : elle ne se défait pas par une mise à jour de statut.
  await rejects(
    "select public.lfo_set_bank_consent_status($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ consent_id: consentId, status: "ACTIVE" })],
    "Un consentement révoqué a pu être réactivé sans nouvel octroi",
    "terminale",
  );
  const revokedSource = await client.query<{ status: string }>(
    "select status from public.import_sources where user_id = $1 and target_account_id = $2",
    [userId, accountId],
  );
  assert(
    revokedSource.rows[0].status === "DISCONNECTED",
    "Une révocation doit couper la source d'acquisition du compte",
  );
  await client.query("rollback to savepoint revoke_guard");

  await rejects(
    "select public.lfo_set_bank_consent_status($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ consent_id: consentId, status: "REVOKED" })],
    "Une révocation sans motif a été acceptée",
    "motif",
  );

  // ── 5. Exécution : une seule EN COURS par compte ──────────────────────────────────
  const runId = await rpc("lfo_open_bank_sync_run", {
    provider_account_id: providerAccountId,
    trigger: "MANUAL",
    stable_transaction_id_declared: true,
  });
  const sessionId = (
    await client.query<{ id: string; status: string }>(
      "select session_id as id, (select status from public.import_sessions where id = session_id) as status from public.bank_sync_runs where id = $1",
      [runId],
    )
  ).rows[0];
  assert(sessionId.status === "RECEIVING", "Une synchronisation ouvre une session en RECEIVING");
  await rejects(
    "select public.lfo_open_bank_sync_run($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ provider_account_id: providerAccountId })],
    "Deux synchronisations concurrentes du même compte ont pu coexister",
    "bank_sync_runs_running_uidx",
  );

  // ── 6. Page 1 : brut, observations, staging, en UNE transaction ───────────────────
  const written = await rpc("lfo_append_bank_sync_page", {
    run_id: runId,
    page: {
      page_number: 1,
      request_cursor: null,
      next_cursor: "page-1",
      payload_hash: "a".repeat(64),
      raw_payload: '{"page":0}',
      item_count: 2,
    },
    rows: [
      observationRow(),
      observationRow({
        raw_item: { id: "tx-2", amount: 1200, currency: "EUR", label: "Salaire" },
        provider_transaction_id: "tx-2",
        external_key: "sandbox-ais:tx-2",
        amount: 1200,
        label: "Salaire",
        match_key: "acct|2026-08-19|1200.000000|EUR|salaire",
      }),
    ],
  });
  assert(written === "2", "Les deux lignes de la page doivent être écrites");

  const afterPage = await client.query<{
    pages: string;
    observations: string;
    raw: string;
    normalized: string;
    tx: string;
    links: string;
  }>(
    `select
       (select count(*) from public.bank_sync_raw_pages where run_id = $1)::text as pages,
       (select count(*) from public.bank_observed_transactions where provider_account_id = $2)::text as observations,
       (select count(*) from public.import_raw_records where session_id = $3)::text as raw,
       (select count(*) from public.import_normalized_records where session_id = $3)::text as normalized,
       (select count(*) from public.transactions where user_id = $4)::text as tx,
       (select count(*) from public.import_record_links where session_id = $3)::text as links`,
    [runId, providerAccountId, sessionId.id, userId],
  );
  assert(afterPage.rows[0].pages === "1", "La page brute doit être persistée");
  assert(afterPage.rows[0].observations === "2", "Deux observations doivent exister");
  assert(afterPage.rows[0].raw === "2", "Le brut par opération doit être persisté");
  assert(afterPage.rows[0].normalized === "2", "Le staging doit être persisté");
  // OBSERVATION ≠ FAIT CANONIQUE : rien n'est écrit avant validation.
  assert(afterPage.rows[0].tx === "0", "AUCUNE transaction canonique avant validation");
  assert(afterPage.rows[0].links === "0", "AUCUNE provenance avant validation");

  // Rejouer la MÊME page est refusé par la base.
  await rejects(
    "select public.lfo_append_bank_sync_page($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        run_id: runId,
        page: {
          page_number: 1,
          next_cursor: "page-1",
          payload_hash: "a".repeat(64),
          raw_payload: '{"page":0}',
          item_count: 0,
        },
        rows: [],
      }),
    ],
    "La même page a pu être écrite deux fois",
    "bank_sync_raw_pages_page_uk",
  );
  // Une empreinte de page hors forme SHA-256 est refusée : elle ne prouverait rien.
  await rejects(
    "select public.lfo_append_bank_sync_page($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        run_id: runId,
        page: {
          page_number: 9,
          next_cursor: null,
          payload_hash: "pas-une-empreinte",
          raw_payload: "{}",
          item_count: 0,
        },
        rows: [],
      }),
    ],
    "Une empreinte de page hors forme a été acceptée",
    "bank_sync_raw_pages_hash_ck",
  );

  // Un échec au milieu d'une page annule la page ENTIÈRE : ni brut, ni observation.
  await rejects(
    "select public.lfo_append_bank_sync_page($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        run_id: runId,
        page: {
          page_number: 8,
          next_cursor: null,
          payload_hash: "b".repeat(64),
          raw_payload: "{}",
          item_count: 2,
        },
        rows: [
          observationRow({
            provider_transaction_id: "tx-ok",
            external_key: "sandbox-ais:tx-ok",
          }),
          observationRow({ state: "ETAT-INCONNU", provider_transaction_id: "tx-ko" }),
        ],
      }),
    ],
    "Une page a pu être écrite à moitié",
    "bank_observed_transactions_state_ck",
  );
  const noPartial = await client.query<{ pages: string; obs: string }>(
    `select
       (select count(*) from public.bank_sync_raw_pages where run_id = $1 and page_number = 8)::text as pages,
       (select count(*) from public.bank_observed_transactions where provider_transaction_id = 'tx-ok')::text as obs`,
    [runId],
  );
  assert(
    noPartial.rows[0].pages === "0" && noPartial.rows[0].obs === "0",
    "L'échec au milieu d'une page doit annuler la page entière",
  );

  // ── 7. Page 2 : réobservation d'une identité, numérotation continue ───────────────
  await rpc("lfo_append_bank_sync_page", {
    run_id: runId,
    page: {
      page_number: 2,
      request_cursor: "page-1",
      next_cursor: null,
      payload_hash: "c".repeat(64),
      raw_payload: '{"page":1}',
      item_count: 2,
    },
    rows: [
      // Même identité DÉMONTRÉE que page 1 : l'observation est retrouvée, pas dupliquée.
      observationRow({ status: "DUPLICATE", dedupe_verdict: "EXACT_DUPLICATE" }),
      observationRow({
        raw_item: { id: "tx-3", amount: -9.9, currency: "USD", label: "Abonnement" },
        provider_transaction_id: "tx-3",
        external_key: "sandbox-ais:tx-3",
        amount: -9.9,
        currency: "USD",
        original_amount: -9.9,
        original_currency: "USD",
        label: "Abonnement",
        match_key: "acct|2026-08-19|-9.900000|USD|abonnement",
        status: "WARNING",
        issues: [
          {
            code: "BANK_CURRENCY_MISMATCH",
            severity: "WARNING",
            field: "currency",
            sourceValue: "USD",
            message: "Devise différente de celle du compte : aucun taux n'est appliqué.",
          },
        ],
      }),
    ],
  });
  const continuity = await client.query<{ numbers: string; observations: string }>(
    `select
       (select string_agg(row_number::text, ',' order by row_number)
          from public.import_raw_records where session_id = $1) as numbers,
       (select count(*) from public.bank_observed_transactions where provider_account_id = $2)::text as observations`,
    [sessionId.id, providerAccountId],
  );
  assert(
    continuity.rows[0].numbers === "1,2,3,4",
    "Le brut doit être numéroté de façon CONTINUE dans la session",
  );
  assert(
    continuity.rows[0].observations === "3",
    "Réobserver une identité démontrée ne crée PAS une seconde observation",
  );

  // Le curseur n'avance qu'après écriture réelle, et une fin déclarée le remet à null.
  const cursor = await client.query<{ cursor: string | null; page: string; complete: boolean }>(
    `select cursor, checkpoint_page_number::text as page, complete
       from public.bank_sync_cursors where provider_account_id = $1`,
    [providerAccountId],
  );
  assert(
    cursor.rows[0].cursor === null && cursor.rows[0].page === "2" && cursor.rows[0].complete,
    "Le curseur doit être checkpointé sur la dernière page réellement écrite",
  );

  // ── 8. Décomptes DÉRIVÉS, jamais repris de l'appelant ─────────────────────────────
  await client.query(
    "update public.import_sessions set row_count = 999, ready_count = 999 where id = $1",
    [sessionId.id],
  );
  const finalized = await rpc("lfo_finalize_bank_sync_run", { run_id: runId, complete: true });
  assert(finalized === "4", "Les décomptes doivent être RELUS en base, pas repris du payload");
  const sessionCounts = await client.query<{
    status: string;
    rows: string;
    ready: string;
    warning: string;
    duplicate: string;
    start: string | null;
  }>(
    `select status, row_count::text as rows, ready_count::text as ready,
            warning_count::text as warning, duplicate_count::text as duplicate,
            observed_period_start::text as start
       from public.import_sessions where id = $1`,
    [sessionId.id],
  );
  assert(sessionCounts.rows[0].status === "ANALYZED", "La clôture de réception n'a pas eu lieu");
  assert(
    sessionCounts.rows[0].rows === "4" &&
      sessionCounts.rows[0].ready === "2" &&
      sessionCounts.rows[0].warning === "1" &&
      sessionCounts.rows[0].duplicate === "1",
    "Décomptes de session faux",
  );
  assert(
    sessionCounts.rows[0].start === "2026-08-19",
    "La période observée doit venir des lignes persistées",
  );
  await rejects(
    "select public.lfo_finalize_bank_sync_run($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ run_id: runId, complete: true })],
    "Une exécution déjà terminée a pu être clôturée deux fois",
    "déjà terminée",
  );

  // ── 9. Décisions de réconciliation ────────────────────────────────────────────────
  const observationIds = await client.query<{ id: string; key: string | null; state: string }>(
    `select id, external_key as key, state from public.bank_observed_transactions
      where provider_account_id = $1 order by external_key`,
    [providerAccountId],
  );
  const firstObservation = observationIds.rows[0].id;
  await rejects(
    `insert into public.bank_reconciliation_decisions (user_id, observation_id, decision)
     values ($1, $2, 'REFUSE')`,
    [userId, firstObservation],
    "Un refus sans motif a été accepté",
    "bank_reconciliation_decisions_shape_ck",
  );
  await rejects(
    `insert into public.bank_reconciliation_decisions (user_id, observation_id, decision)
     values ($1, $2, 'LINK_EXISTING')`,
    [userId, firstObservation],
    "Un rattachement sans transaction désignée a été accepté",
    "bank_reconciliation_decisions_shape_ck",
  );

  // Une opération ANNULÉE par la banque n'entre jamais au canonique.
  await client.query("savepoint cancelled_guard");
  await client.query(
    "update public.bank_observed_transactions set state = 'CANCELLED' where id = $1",
    [firstObservation],
  );
  await rejects(
    "select public.lfo_decide_bank_reconciliation($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ observation_id: firstObservation, decision: "ACCEPT_NEW" })],
    "Une opération annulée par la banque a pu être acceptée au canonique",
    "annulée",
  );
  await client.query("rollback to savepoint cancelled_guard");

  // Un refus MOTIVÉ retire la ligne de staging du périmètre committable.
  const refusedObservation = observationIds.rows[2].id;
  const touched = await rpc("lfo_decide_bank_reconciliation", {
    observation_id: refusedObservation,
    decision: "REFUSE",
    reason: "Prélèvement déjà saisi manuellement le mois dernier",
    session_id: sessionId.id,
  });
  assert(touched === "1", "La décision doit se propager à la ligne de staging de la session");
  const refusedRow = await client.query<{ status: string }>(
    `select status from public.import_normalized_records
      where session_id = $1 and external_key = 'sandbox-ais:tx-3'`,
    [sessionId.id],
  );
  assert(
    refusedRow.rows[0].status === "IGNORED",
    "Une observation refusée ne doit plus être committable",
  );

  // ── 10. Validation : fait, provenance et marque de commit, atomiquement ───────────
  const committed = await rpc("lfo_commit_bank_sync_session", {
    session_id: sessionId.id,
    include_record_ids: [],
  });
  assert(committed === "2", "Seules les deux lignes prêtes doivent être écrites");
  const afterCommit = await client.query<{
    tx: string;
    links: string;
    marked: string;
    decisions: string;
    manual: string;
    category: string;
  }>(
    `select
       (select count(*) from public.transactions where user_id = $1)::text as tx,
       (select count(*) from public.import_record_links where session_id = $2)::text as links,
       (select count(*) from public.bank_observed_transactions
          where provider_account_id = $3 and committed_normalized_record_id is not null)::text as marked,
       (select count(*) from public.bank_reconciliation_decisions
          where user_id = $1 and decision = 'ACCEPT_NEW')::text as decisions,
       (select count(*) from public.transactions where user_id = $1 and manual_override = false)::text as manual,
       (select count(*) from public.transactions where user_id = $1 and category_id is null)::text as category`,
    [userId, sessionId.id, providerAccountId],
  );
  assert(afterCommit.rows[0].tx === "2", "Deux transactions canoniques doivent être écrites");
  assert(afterCommit.rows[0].links === "2", "Chaque fait doit porter sa provenance");
  assert(
    afterCommit.rows[0].marked === "2",
    "Chaque observation écrite doit porter la ligne qui l'a écrite",
  );
  assert(
    afterCommit.rows[0].decisions === "2",
    "Une acceptation doit laisser une décision ENREGISTRÉE, même implicite",
  );
  assert(
    afterCommit.rows[0].manual === "2" && afterCommit.rows[0].category === "2",
    "L'acquisition ne classe rien et ne se présente pas comme une saisie",
  );

  // IDEMPOTENCE APPLICATIVE : un second commit ne réécrit rien.
  const second = await rpc("lfo_commit_bank_sync_session", {
    session_id: sessionId.id,
    include_record_ids: [],
  });
  assert(second === "2", "Un second commit ne doit rien réécrire");
  const stillTwo = await client.query<{ tx: string }>(
    "select count(*)::text as tx from public.transactions where user_id = $1",
    [userId],
  );
  assert(stillTwo.rows[0].tx === "2", "Un second commit a dupliqué des transactions");

  // Une observation déjà écrite ne se rejuge pas : c'est le refus du double comptage.
  await rejects(
    "select public.lfo_decide_bank_reconciliation($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ observation_id: firstObservation, decision: "ACCEPT_NEW" })],
    "Une observation déjà écrite a pu être réacceptée",
    "déjà écrite",
  );

  // ── 11. Gel de l'observation écrite ───────────────────────────────────────────────
  await rejects(
    "update public.bank_observed_transactions set amount = 1 where id = $1",
    [firstObservation],
    "Le montant d'une observation écrite a pu être modifié",
    "gelé",
  );
  await rejects(
    "update public.bank_observed_transactions set operation_date = '2020-01-01' where id = $1",
    [firstObservation],
    "La date d'une observation écrite a pu être modifiée",
    "gelé",
  );
  await rejects(
    "delete from public.bank_observed_transactions where id = $1",
    [firstObservation],
    "Une observation écrite a pu être supprimée",
    "ne se supprime pas",
  );
  // L'exception est NOMMÉE : la VIE de l'observation chez le fournisseur reste inscriptible.
  await client.query(
    "update public.bank_observed_transactions set last_seen_at = now(), state = 'CORRECTED' where id = $1",
    [firstObservation],
  );

  // Un fait importé n'est pas supprimable en laissant sa provenance orpheline.
  const linkedTransaction = (
    await client.query<{ id: string }>(
      "select transaction_id as id from public.import_record_links where session_id = $1 limit 1",
      [sessionId.id],
    )
  ).rows[0].id;
  await rejects(
    "delete from public.transactions where id = $1 and user_id = $2",
    [linkedTransaction, userId],
    "Une transaction importée a pu être supprimée en laissant sa provenance orpheline",
    "import_record_links_transaction_fk",
  );

  // ── 12. Gel de la page brute, et « exécution ABSENTE ≠ exécution INVISIBLE » ──────
  await rejects(
    "update public.bank_sync_raw_pages set raw_payload = 'trafique' where run_id = $1",
    [runId],
    "Une page brute a pu être modifiée",
    "immuable",
  );
  await rejects(
    "delete from public.bank_sync_raw_pages where run_id = $1",
    [runId],
    "La page brute d'une synchronisation à faits a pu être supprimée",
    "fait canonique",
  );
  const freezeState = await client.query<{ state: string }>(
    "select public.bank_sync_freeze_state($1::uuid, $2::uuid) as state",
    [runId, userId],
  );
  assert(
    freezeState.rows[0].state === "FACTS_WRITTEN",
    "L'état de gel doit être lu sur la PREUVE qu'un fait existe",
  );
  const absentState = await client.query<{ state: string }>(
    "select public.bank_sync_freeze_state($1::uuid, $2::uuid) as state",
    [randomUUID(), userId],
  );
  assert(
    absentState.rows[0].state === "ABSENT",
    "Une exécution réellement absente doit être distinguée d'une exécution invisible",
  );

  // ── 13. Soldes : ABSENT ≠ ZÉRO, une observation par nature et par date ───────────
  const balancesWritten = await rpc("lfo_record_bank_balances", {
    run_id: runId,
    provider_account_id: providerAccountId,
    balances: [
      { balance_type: "BOOKED", amount: 4210.55, currency: "EUR", observed_at: "2026-08-19" },
      // Solde NON SERVI par le fournisseur : il reste absent.
      { balance_type: "AVAILABLE", amount: null, currency: null, observed_at: "2026-08-19" },
    ],
  });
  assert(balancesWritten === "2", "Les deux observations de solde doivent être écrites");
  const nullBalance = await client.query<{ amount: string | null }>(
    `select amount::text as amount from public.bank_balance_observations
      where provider_account_id = $1 and balance_type = 'AVAILABLE'`,
    [providerAccountId],
  );
  assert(
    nullBalance.rows[0].amount === null,
    "SOLDE ABSENT ≠ SOLDE À ZÉRO : un solde non servi reste null",
  );
  await rejects(
    `insert into public.bank_balance_observations
       (user_id, provider_account_id, balance_type, amount, observed_at)
     values ($1, $2, 'EXPECTED', 100, '2026-08-19')`,
    [userId, providerAccountId],
    "Un montant de solde sans devise a été accepté",
    "bank_balance_observations_shape_ck",
  );
  // Une seconde lecture du même jour CORRIGE la première au lieu de s'y ajouter.
  await rpc("lfo_record_bank_balances", {
    run_id: runId,
    provider_account_id: providerAccountId,
    balances: [
      { balance_type: "BOOKED", amount: 4300.0, currency: "EUR", observed_at: "2026-08-19" },
    ],
  });
  const corrected = await client.query<{ count: string; amount: string }>(
    `select count(*)::text as count, max(amount)::text as amount
       from public.bank_balance_observations
      where provider_account_id = $1 and balance_type = 'BOOKED'`,
    [providerAccountId],
  );
  assert(
    corrected.rows[0].count === "1" && corrected.rows[0].amount === "4300.000000",
    "Une observation de solde du même jour doit CORRIGER, pas s'ajouter",
  );
  // Une nouvelle date S'AJOUTE sans effacer l'historique.
  await rpc("lfo_record_bank_balances", {
    run_id: runId,
    provider_account_id: providerAccountId,
    balances: [
      { balance_type: "BOOKED", amount: 4100.0, currency: "EUR", observed_at: "2026-08-20" },
    ],
  });
  const history = await client.query<{ count: string }>(
    `select count(*)::text as count from public.bank_balance_observations
      where provider_account_id = $1 and balance_type = 'BOOKED'`,
    [providerAccountId],
  );
  assert(
    history.rows[0].count === "2",
    "Une observation à une nouvelle date ne doit effacer aucun historique",
  );

  // ── 14. Notifications : rejeu refusé par la BASE ──────────────────────────────────
  const eventId = await rpc("lfo_record_bank_sync_event", {
    provider_id: providerId,
    consent_id: consentId,
    provider_event_id: "evt-1",
    event_type: "TRANSACTIONS_UPDATED",
    payload: { accounts: ["pa-1"] },
    signature_verified: true,
  });
  assert(eventId.length > 0, "L'événement doit être enregistré");
  await rejects(
    "select public.lfo_record_bank_sync_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        provider_id: providerId,
        provider_event_id: "evt-1",
        event_type: "TRANSACTIONS_UPDATED",
        payload: {},
        signature_verified: true,
      }),
    ],
    "Un webhook rejoué a pu être enregistré deux fois",
    "bank_sync_events_event_uk",
  );
  await rejects(
    "select public.lfo_record_bank_sync_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        provider_id: providerId,
        event_type: "X",
        payload: {},
        signature_verified: true,
      }),
    ],
    "Un événement sans identifiant fournisseur a été accepté",
    "identifiant fournisseur",
  );
  // Un événement NON SIGNÉ est conservé et ne déclenche RIEN.
  const unverified = await rpc("lfo_record_bank_sync_event", {
    provider_id: providerId,
    provider_event_id: "evt-2",
    event_type: "TRANSACTIONS_UPDATED",
    payload: {},
    signature_verified: false,
  });
  const unverifiedState = await client.query<{ status: string; run: string | null }>(
    "select status, run_id::text as run from public.bank_sync_events where id = $1",
    [unverified],
  );
  assert(
    unverifiedState.rows[0].status === "IGNORED" && unverifiedState.rows[0].run === null,
    "Un événement non signé ne doit déclencher aucune exécution",
  );
  await rejects(
    "update public.bank_sync_events set run_id = $1 where id = $2",
    [runId, unverified],
    "Un événement non signé a pu déclencher une exécution",
    "bank_sync_events_unverified_ck",
  );

  // ── 15. Reprise après échec : le curseur survit, la lecture reste lisible ────────
  const resumeRunId = await rpc("lfo_open_bank_sync_run", {
    provider_account_id: providerAccountId,
    trigger: "WEBHOOK",
  });
  await rpc("lfo_append_bank_sync_page", {
    run_id: resumeRunId,
    page: {
      page_number: 1,
      request_cursor: null,
      next_cursor: "page-1",
      payload_hash: "d".repeat(64),
      raw_payload: '{"page":0}',
      item_count: 1,
    },
    rows: [
      observationRow({
        raw_item: { id: "tx-4", amount: -30, currency: "EUR", label: "Essence" },
        provider_transaction_id: "tx-4",
        external_key: "sandbox-ais:tx-4",
        amount: -30,
        label: "Essence",
        match_key: "acct|2026-08-21|-30.000000|EUR|essence",
        operation_date: "2026-08-21",
      }),
    ],
  });
  await rejects(
    "select public.lfo_fail_bank_sync_run($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ run_id: resumeRunId })],
    "Un échec sans code a été accepté",
    "sans code",
  );
  await rpc("lfo_fail_bank_sync_run", {
    run_id: resumeRunId,
    failure_code: "RATE_LIMITED",
    failure_message: "Quota d'appels dépassé (429)",
  });
  const failed = await client.query<{
    status: string;
    cursor: string | null;
    complete: boolean;
    session: string;
    sourceStatus: string;
    pages: string;
  }>(
    `select r.status, r.resume_cursor as cursor, r.complete,
            (select status from public.import_sessions where id = r.session_id) as session,
            (select status from public.import_sources where user_id = $2 and target_account_id = $3) as "sourceStatus",
            (select count(*)::text from public.bank_sync_raw_pages where run_id = r.id) as pages
       from public.bank_sync_runs r where r.id = $1`,
    [resumeRunId, userId, accountId],
  );
  assert(failed.rows[0].status === "FAILED", "L'exécution doit être marquée en échec");
  assert(
    failed.rows[0].cursor === "page-1",
    "Un échec doit CONSERVER son curseur : une interruption n'oblige pas à tout relire",
  );
  assert(failed.rows[0].complete === false, "Une exécution en échec n'est jamais complète");
  assert(
    failed.rows[0].session === "FAILED",
    "La session d'un échec est marquée, pas supprimée : ce qui a été lu reste lisible",
  );
  assert(
    failed.rows[0].pages === "1",
    "Un échec n'efface pas les pages déjà lues : le diagnostic reste possible",
  );
  assert(
    failed.rows[0].sourceStatus === "RATE_LIMITED",
    "Un échec de quota doit se lire sur la source d'acquisition",
  );
  const resumedCursor = await client.query<{ cursor: string | null; page: string }>(
    `select cursor, checkpoint_page_number::text as page
       from public.bank_sync_cursors where provider_account_id = $1`,
    [providerAccountId],
  );
  assert(
    resumedCursor.rows[0].cursor === "page-1" && resumedCursor.rows[0].page === "1",
    "Le curseur de reprise doit pointer la page suivante, jamais au-delà du persisté",
  );

  // ── 16. AUCUNE INITIATION DE PAIEMENT dans la surface Open Banking ───────────────
  //
  // Contrôle STRUCTUREL, pas déclaratif : aucune fonction et aucune colonne de cette
  // verticale ne décrit un ordre, un bénéficiaire, un mandat ou un IBAN complet.
  const paymentSurface = await client.query<{ functions: string; columns: string }>(`
    select
      (select count(*)::text from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proname like 'bank_%' or p.proname like 'lfo_%bank%')
          and p.proname ~* '(payment|payout|transfer|virement|mandate|mandat|beneficiar|prelevement|direct_debit|order)') as functions,
      (select count(*)::text from information_schema.columns
        where table_schema = 'public' and table_name like 'bank_%'
          and column_name ~* '(payment|payout|transfer|virement|mandate|mandat|beneficiar|prelevement|direct_debit|full_iban)') as columns
  `);
  assert(
    paymentSurface.rows[0].functions === "0" && paymentSurface.rows[0].columns === "0",
    "La surface Open Banking ne doit contenir AUCUNE primitive d'initiation de paiement",
  );

  // ── 17. Piste d'audit : lecture seule pour authenticated ─────────────────────────
  await client.query("reset role");
  await client.query("set local role authenticated");
  for (const [table, statement] of [
    ["bank_providers", "update public.bank_providers set label = 'x'"],
    ["bank_institutions", "delete from public.bank_institutions"],
    ["bank_consents", "update public.bank_consents set status = 'ACTIVE'"],
    ["bank_provider_accounts", "update public.bank_provider_accounts set account_id = null"],
    ["bank_sync_cursors", "update public.bank_sync_cursors set cursor = 'x'"],
    ["bank_sync_runs", "delete from public.bank_sync_runs"],
    ["bank_sync_raw_pages", "delete from public.bank_sync_raw_pages"],
    ["bank_observed_transactions", "update public.bank_observed_transactions set amount = 1"],
    ["bank_balance_observations", "delete from public.bank_balance_observations"],
    ["bank_reconciliation_decisions", "delete from public.bank_reconciliation_decisions"],
    ["bank_sync_events", "delete from public.bank_sync_events"],
  ] as const) {
    await rejects(
      statement,
      [],
      `La piste d'audit public.${table} est inscriptible par authenticated`,
      "permission denied",
    );
  }
  // La lecture d'invariant du garde-fou n'est pas exécutable par le client : sans cet
  // `execute`, un futur chemin de suppression échouerait AVANT de pouvoir supprimer.
  await rejects(
    "select public.bank_sync_freeze_state($1::uuid, $2::uuid)",
    [runId, userId],
    "authenticated a pu exécuter la lecture d'invariant du garde-fou",
    "permission denied",
  );
  for (const rpcName of [
    "lfo_open_bank_sync_run",
    "lfo_append_bank_sync_page",
    "lfo_commit_bank_sync_session",
    "lfo_decide_bank_reconciliation",
    "lfo_record_bank_sync_event",
  ]) {
    await rejects(
      `select public.${rpcName}($1::uuid, $2::jsonb)`,
      [userId, JSON.stringify({})],
      `La RPC ${rpcName} est exécutable par authenticated`,
      "permission denied",
    );
  }
  const readable = await client.query<{ count: string }>(
    "select count(*)::text from public.bank_observed_transactions",
  );
  assert(readable.rows[0], "La piste d'audit doit rester LISIBLE par authenticated");
  await client.query("reset role");
  await client.query("set local role service_role");

  // ── 18. Cloisonnement par propriétaire ───────────────────────────────────────────
  const foreignAccountId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, 'Compte voisin', 'CHECKING', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [foreignAccountId, foreignUser],
  );
  await rejects(
    "select public.lfo_map_bank_account($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        provider_account_id: secondProviderAccountId,
        account_id: foreignAccountId,
      }),
    ],
    "Un compte fournisseur a pu être rattaché au compte d'un autre propriétaire",
    "introuvable",
  );
  await rejects(
    "select public.lfo_open_bank_sync_run($1::uuid, $2::jsonb)",
    [foreignUser, JSON.stringify({ provider_account_id: providerAccountId })],
    "Le compte fournisseur d'un autre propriétaire a pu être synchronisé",
    "introuvable",
  );
  await rejects(
    "select public.lfo_commit_bank_sync_session($1::uuid, $2::jsonb)",
    [foreignUser, JSON.stringify({ session_id: sessionId.id, include_record_ids: [] })],
    "La session d'un autre propriétaire a pu être validée",
    "introuvable",
  );
  await rejects(
    `insert into public.bank_consents (user_id, provider_id, consent_reference, scopes, status)
     values ($1, $2, 'intrusion', array['TRANSACTIONS'], 'PENDING')`,
    [foreignUser, providerId],
    "Un consentement a pu viser le fournisseur d'un autre propriétaire",
    "bank_consents_provider_fk",
  );

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
      "Smoke Open Banking (AIS) : référence de secret sans valeur de secret, OAuth sans coffre refusé, consentement daté avec expiration DÉCLARÉE et révocation TERMINALE, compte fournisseur non rattaché à la naissance, un compte canonique alimenté par au plus un compte fournisseur, démarrage refusé sur compte non rattaché / consentement non actif, révoqué, expiré ou sans portée TRANSACTIONS, une seule exécution en cours par compte, page atomique annulée entièrement sur échec, page rejouée refusée, identité démontrée non dupliquée, brut numéroté en continu, curseur checkpointé après écriture réelle, échec conservant curseur et pages avec cause nommée, décomptes DÉRIVÉS des lignes persistées, aucun fait canonique avant validation, refus motivé et rattachement désigné, opération annulée jamais écrite, validation atomique fait + provenance + marque de commit, observation écrite non reproposable, gel de l'observation avec exception nommée sur sa dernière vue, page brute immuable et non supprimable après faits, exécution ABSENTE distinguée d'exécution INVISIBLE, solde absent ≠ zéro et observation par date corrigeant sans effacer l'historique, rejeu de webhook refusé par la base, événement non signé sans effet, AUCUNE initiation de paiement dans la surface, piste d'audit en lecture seule sous authenticated, cloisonnement par propriétaire. Aucune donnée persistée.",
    );
  }
}
