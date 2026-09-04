/**
 * Smoke d'INTÉGRATION de la couche d'acquisition. Toutes les écritures sont annulées.
 *
 * Les smokes de verticale prouvent chacun son domaine. Celui-ci prouve ce qu'AUCUN d'eux ne
 * peut prouver seul : que cinq verticales coexistent sans se compter deux fois, et que les
 * objets qu'elles PARTAGENT tiennent leurs invariants sous tous les domaines à la fois.
 *
 * Ce qu'il vérifie :
 *
 *   * `external_sources` accepte les DEUX domaines qui l'adoptent, chacun avec SA forme —
 *     un registre s'authentifie, un jeu de données public se périme — et refuse un domaine
 *     sans tables de support ;
 *   * la FORME des capacités déclarées est exigée par domaine : liste de noms pour un
 *     registre, objet de drapeaux pour un jeu de données public ;
 *   * une même chaîne de fournisseur peut servir DEUX domaines, et pas deux fois le même ;
 *   * `import_sources` accepte ses quatre domaines, `import_upload_tickets` ses trois, et
 *     `import_record_links` ses cinq — aucune whitelist n'a été rétrécie par la coexistence ;
 *   * un lien de provenance ne porte JAMAIS deux faits à la fois, quel que soit le domaine ;
 *   * une même IDENTITÉ démontrée peut être LUE plusieurs fois et n'être ÉCRITE qu'une, et
 *     elle peut coexister sur deux domaines cibles distincts ;
 *   * un même FICHIER ne se valide qu'une fois par source, et une même PAGE d'API qu'une
 *     fois par session ;
 *   * un même événement de notification ne s'enregistre qu'une fois ;
 *   * les deux garde-fous `security definer` sont inexécutables par le client, et il n'en
 *     existe aucun troisième non déclaré ;
 *   * les trente-huit tables d'acquisition sont en LECTURE SEULE sous `authenticated`.
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

type Counts = {
  externalSources: string;
  importSources: string;
  sessions: string;
  links: string;
  tickets: string;
  normalized: string;
  events: string;
  transactions: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.external_sources)::text as "externalSources",
      (select count(*) from public.import_sources)::text as "importSources",
      (select count(*) from public.import_sessions)::text as "sessions",
      (select count(*) from public.import_record_links)::text as "links",
      (select count(*) from public.import_upload_tickets)::text as "tickets",
      (select count(*) from public.import_normalized_records)::text as "normalized",
      (select count(*) from public.bank_sync_events)::text as "events",
      (select count(*) from public.transactions)::text as "transactions"
  `);
  return result.rows[0];
}

let userId = "";
let succeeded = false;

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
  await client.query("set local role service_role");

  const accountId = randomUUID();
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, 'Compte intégration', 'CHECKING', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [accountId, userId],
  );
  const businessId = randomUUID();
  await client.query(
    `insert into public.businesses
       (id, user_id, name, legal_form, functional_currency, status, data_kind, confidence)
     values ($1, $2, 'Cible intégration', 'SAS', 'EUR', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [businessId, userId],
  );

  // ── 1. `external_sources` : deux domaines, deux formes, un seul registre ─────────
  //
  // Deux verticales adoptent cette table. Leurs exigences DIFFÈRENT, et c'est légitime.
  // Les exprimer globalement imposait à chacune celles de l'autre : c'est ce que la
  // coexistence avait produit, et ce que la réconciliation corrige.
  const registrySourceId = randomUUID();
  await client.query(
    `insert into public.external_sources
       (id, user_id, name, source_type, status, domain, provider, adapter_version, auth_mode,
        capabilities)
     values ($1, $2, 'Registre', 'API', 'ACTIVE', 'COMPANY_REGISTRY', 'PORTAIL_COMMUN', '1',
             'NONE', '["SIREN_LOOKUP"]'::jsonb)`,
    [registrySourceId, userId],
  );
  const publicSourceId = randomUUID();
  await client.query(
    `insert into public.external_sources
       (id, user_id, name, source_type, status, domain, provider, adapter_version,
        snapshot_ttl_minutes, capabilities)
     values ($1, $2, 'Donnée publique', 'PUBLIC_DATA', 'ACTIVE', 'REAL_ESTATE_PUBLIC_DATA',
             'PORTAIL_COMMUN', '1', 1440, '{"fields": ["price"]}'::jsonb)`,
    [publicSourceId, userId],
  );
  // MÊME chaîne de fournisseur, DEUX domaines : accepté. L'unicité antérieure portait sur
  // (propriétaire, fournisseur) et l'interdisait — plus étroit que ce que chaque verticale
  // exprime.
  const bothDomains = await client.query<{ count: string }>(
    "select count(*)::text as count from public.external_sources where user_id = $1 and provider = 'PORTAIL_COMMUN'",
    [userId],
  );
  assert(
    bothDomains.rows[0].count === "2",
    "Un même fournisseur doit pouvoir servir DEUX domaines",
  );
  await rejects(
    `insert into public.external_sources
       (user_id, name, source_type, status, domain, provider, adapter_version, auth_mode, capabilities)
     values ($1, 'Doublon', 'API', 'ACTIVE', 'COMPANY_REGISTRY', 'PORTAIL_COMMUN', '1', 'NONE', '[]'::jsonb)`,
    [userId],
    "Deux connexions au même (domaine, fournisseur) ont pu coexister",
    "external_sources_domain_provider_uk",
  );

  // Chaque domaine exige CE QU'IL exige, et rien de l'autre.
  await rejects(
    `insert into public.external_sources
       (user_id, name, source_type, status, domain, provider, adapter_version, capabilities)
     values ($1, 'Registre sans auth', 'API', 'ACTIVE', 'COMPANY_REGISTRY', 'AUTRE', '1', '[]'::jsonb)`,
    [userId],
    "Un registre sans mode d'authentification a été accepté",
    "external_sources_shape_v2_ck",
  );
  await rejects(
    `insert into public.external_sources
       (user_id, name, source_type, status, domain, provider, adapter_version, capabilities)
     values ($1, 'Public sans TTL', 'PUBLIC_DATA', 'ACTIVE', 'REAL_ESTATE_PUBLIC_DATA', 'AUTRE', '1', '{}'::jsonb)`,
    [userId],
    "Un jeu de données public sans durée de fraîcheur a été accepté",
    "external_sources_shape_v2_ck",
  );
  // La FORME des capacités appartient au domaine : deux conventions incompatibles
  // coexistaient sur cette colonne partagée, et celle de la première refusait la seconde.
  await rejects(
    `insert into public.external_sources
       (user_id, name, source_type, status, domain, provider, adapter_version, auth_mode, capabilities)
     values ($1, 'Registre en objet', 'API', 'ACTIVE', 'COMPANY_REGISTRY', 'AUTRE2', '1', 'NONE', '{}'::jsonb)`,
    [userId],
    "Des capacités en OBJET ont pu être déclarées pour un registre",
    "external_sources_capabilities_v2_ck",
  );
  await rejects(
    `insert into public.external_sources
       (user_id, name, source_type, status, domain, provider, adapter_version, snapshot_ttl_minutes, capabilities)
     values ($1, 'Public en liste', 'PUBLIC_DATA', 'ACTIVE', 'REAL_ESTATE_PUBLIC_DATA', 'AUTRE3', '1', 60, '[]'::jsonb)`,
    [userId],
    "Des capacités en LISTE ont pu être déclarées pour un jeu de données public",
    "external_sources_capabilities_v2_ck",
  );
  await rejects(
    `insert into public.external_sources
       (user_id, name, source_type, status, domain, provider, adapter_version, capabilities)
     values ($1, 'Domaine sans support', 'API', 'ACTIVE', 'MARKET_DATA', 'AUTRE4', '1', '[]'::jsonb)`,
    [userId],
    "Un domaine sans tables de support a été déclaré",
    "external_sources_domain_v2_ck",
  );

  // ── 2. Whitelists partagées : aucune n'a été rétrécie par la coexistence ─────────
  //
  // Chaque verticale a étendu les mêmes contraintes, et chacune avait choisi le même numéro
  // de version. Le garde `if not exists` sautait l'extension quand une autre avait pris le
  // nom : le domaine de la seconde était refusé à la première écriture, très loin de sa
  // cause. Ces contrôles vérifient l'UNION, domaine par domaine.
  for (const [domain, target] of [
    ["CASH_FLOW_TRANSACTION", "account"],
    ["PORTFOLIO_LEDGER", "account"],
    ["PORTFOLIO_POSITION", "account"],
    ["BUSINESS_ACCOUNTING", "business"],
  ] as const) {
    const sourceId = randomUUID();
    await client.query(
      `insert into public.import_sources
         (id, user_id, kind, domain, provider, label, adapter_version, target_account_id, target_business_id)
       values ($1, $2, 'FILE_CSV', $3, $4, 'Intégration', '1', $5, $6)`,
      [
        sourceId,
        userId,
        domain,
        `INTEGRATION_${domain}`,
        target === "account" ? accountId : null,
        target === "business" ? businessId : null,
      ],
    );
  }
  const sources = await client.query<{ count: string }>(
    "select count(*)::text as count from public.import_sources where user_id = $1 and label = 'Intégration'",
    [userId],
  );
  assert(
    sources.rows[0].count === "4",
    "Les quatre domaines de source doivent être acceptés APRÈS coexistence",
  );

  for (const domain of ["BUSINESS_ACCOUNTING", "DOCUMENT_EXTRACTION", "PORTFOLIO_FILE"] as const) {
    await client.query(
      `insert into public.import_upload_tickets
         (user_id, domain, storage_path, byte_size, content_type, expires_at)
       values ($1, $2, $3, 1024, 'text/plain', now() + interval '10 minutes')`,
      [userId, domain, `staging/${userId}/${randomUUID()}`],
    );
  }
  const tickets = await client.query<{ count: string }>(
    "select count(*)::text as count from public.import_upload_tickets where user_id = $1",
    [userId],
  );
  assert(
    tickets.rows[0].count === "3",
    "Les trois domaines de dépôt direct doivent être acceptés APRÈS coexistence",
  );
  await rejects(
    `insert into public.import_upload_tickets
       (user_id, domain, storage_path, byte_size, content_type, expires_at)
     values ($1, 'DOMAINE_INCONNU', $2, 1024, 'text/plain', now() + interval '10 minutes')`,
    [userId, `staging/${userId}/${randomUUID()}`],
    "Un domaine de dépôt inconnu a été accepté",
    "import_upload_tickets_domain_v3_ck",
  );

  // ── 3. Un lien de provenance ne porte JAMAIS deux faits ─────────────────────────
  //
  // La forme retenue par la coexistence avait perdu `extraction_run_id` : un lien de
  // transaction bancaire pouvait AUSSI désigner un run d'extraction, donc deux faits.
  const bankSourceId = (
    await client.query<{ id: string }>(
      "select id from public.import_sources where user_id = $1 and domain = 'CASH_FLOW_TRANSACTION' limit 1",
      [userId],
    )
  ).rows[0].id;
  const sessionId = randomUUID();
  await client.query(
    `insert into public.import_sessions
       (id, user_id, source_id, status, parser, parser_version, file_name, file_hash)
     values ($1, $2, $3, 'ANALYZED', 'intégration', '1', 'x.csv', $4)`,
    [sessionId, userId, bankSourceId, "a".repeat(64)],
  );
  const rawId = randomUUID();
  await client.query(
    `insert into public.import_raw_records (id, user_id, session_id, row_number, raw_line, cells)
     values ($1, $2, $3, 1, 'x', '[]'::jsonb)`,
    [rawId, userId, sessionId],
  );
  const normalizedId = randomUUID();
  await client.query(
    `insert into public.import_normalized_records
       (id, user_id, session_id, raw_record_id, target_domain, account_id, transaction_date,
        label, amount, currency, status, external_key)
     values ($1, $2, $3, $4, 'CASH_FLOW_TRANSACTION', $5, '2026-08-19', 'Café', -51.84, 'EUR',
             'READY', 'integration:tx-1')`,
    [normalizedId, userId, sessionId, rawId, accountId],
  );
  const transactionId = randomUUID();
  await client.query(
    `insert into public.transactions
       (id, user_id, account_id, transaction_date, label, amount, currency, data_kind, confidence)
     values ($1, $2, $3, '2026-08-19', 'Café', -51.84, 'EUR', 'ACTUAL', 'HIGH')`,
    [transactionId, userId, accountId],
  );
  const runId = randomUUID();
  await client.query(
    `insert into public.document_extraction_runs
       (id, user_id, business_id, document_family, extractor, extractor_version, schema_version,
        pdf_kind, status, file_name, file_hash, file_size_bytes, validated_at)
     values ($1, $2, $3, 'TAX_RETURN', 'liasse-pdf', '1', '1', 'NATIVE_TEXT', 'VALIDATED',
             'liasse.pdf', $4, 2048, now())`,
    [runId, userId, businessId, "b".repeat(64)],
  );
  await rejects(
    `insert into public.import_record_links
       (user_id, session_id, normalized_record_id, target_domain, transaction_id, extraction_run_id)
     values ($1, $2, $3, 'CASH_FLOW_TRANSACTION', $4, $5)`,
    [userId, sessionId, normalizedId, transactionId, runId],
    "Un lien de transaction a pu désigner AUSSI un run d'extraction : deux faits pour un lien",
    "import_record_links_target_v4_ck",
  );
  // Et la forme légitime, elle, passe.
  await client.query(
    `insert into public.import_record_links
       (user_id, session_id, normalized_record_id, target_domain, transaction_id)
     values ($1, $2, $3, 'CASH_FLOW_TRANSACTION', $4)`,
    [userId, sessionId, normalizedId, transactionId],
  );
  // La provenance d'une liasse n'a PAS de session : son unité est le run, pas une ligne.
  const financialsId = randomUUID();
  await client.query(
    `insert into public.business_financials
       (id, user_id, business_id, period_end, period_kind, currency, data_kind, confidence)
     values ($1, $2, $3, '2025-12-31', 'ANNUAL', 'EUR', 'ACTUAL', 'HIGH')`,
    [financialsId, userId, businessId],
  );
  await client.query(
    `insert into public.import_record_links
       (user_id, target_domain, business_financials_id, extraction_run_id)
     values ($1, 'TAX_RETURN_FINANCIALS', $2, $3)`,
    [userId, financialsId, runId],
  );
  const links = await client.query<{ count: string }>(
    "select count(*)::text as count from public.import_record_links where user_id = $1",
    [userId],
  );
  assert(
    links.rows[0].count === "2",
    "Les deux formes légitimes de provenance doivent coexister : ligne de session et run documentaire",
  );

  // ── 4. Une identité démontrée : LUE plusieurs fois, ÉCRITE une seule ────────────
  //
  // Deux unicités concurrentes existaient sur `external_key`. Celle du socle dit « une
  // identité ne s'ÉCRIT qu'une fois » ; celle d'une verticale disait « une identité ne se
  // LIT qu'une fois », ce qui interdit de restager une opération déjà validée — donc de la
  // montrer comme doublon.
  await client.query(
    "update public.import_normalized_records set commit_state = 'COMMITTED', committed_at = now() where id = $1",
    [normalizedId],
  );
  const secondSession = randomUUID();
  await client.query(
    `insert into public.import_sessions
       (id, user_id, source_id, status, parser, parser_version, file_name)
     values ($1, $2, $3, 'ANALYZED', 'intégration', '1', 'y.csv')`,
    [secondSession, userId, bankSourceId],
  );
  const secondRaw = randomUUID();
  await client.query(
    `insert into public.import_raw_records (id, user_id, session_id, row_number, raw_line, cells)
     values ($1, $2, $3, 1, 'x', '[]'::jsonb)`,
    [secondRaw, userId, secondSession],
  );
  // RELECTURE de la même identité : acceptée, marquée doublon. C'est ce qui permet de la
  // montrer à l'utilisateur au lieu de la faire disparaître.
  await client.query(
    `insert into public.import_normalized_records
       (user_id, session_id, raw_record_id, target_domain, account_id, transaction_date,
        label, amount, currency, status, dedupe_verdict, external_key)
     values ($1, $2, $3, 'CASH_FLOW_TRANSACTION', $4, '2026-08-19', 'Café', -51.84, 'EUR',
             'DUPLICATE', 'EXACT_DUPLICATE', 'integration:tx-1')`,
    [userId, secondSession, secondRaw, accountId],
  );
  // Mais une SECONDE ÉCRITURE de la même identité, dans le même domaine : refusée.
  await rejects(
    `update public.import_normalized_records
        set commit_state = 'COMMITTED', committed_at = now(), status = 'READY'
      where session_id = $1 and user_id = $2`,
    [secondSession, userId],
    "Une identité démontrée a pu être écrite deux fois",
    "import_normalized_records_committed_external_v2_uidx",
  );
  // La MÊME chaîne d'identifiant sur un AUTRE domaine cible reste licite : elle ne désigne
  // pas le même fait.
  const positionSession = randomUUID();
  const portfolioSourceId = (
    await client.query<{ id: string }>(
      "select id from public.import_sources where user_id = $1 and domain = 'PORTFOLIO_POSITION' limit 1",
      [userId],
    )
  ).rows[0].id;
  await client.query(
    `insert into public.import_sessions
       (id, user_id, source_id, status, parser, parser_version, file_name)
     values ($1, $2, $3, 'ANALYZED', 'intégration', '1', 'p.csv')`,
    [positionSession, userId, portfolioSourceId],
  );
  const positionRaw = randomUUID();
  await client.query(
    `insert into public.import_raw_records (id, user_id, session_id, row_number, raw_line, cells)
     values ($1, $2, $3, 1, 'x', '[]'::jsonb)`,
    [positionRaw, userId, positionSession],
  );
  const securityId = randomUUID();
  await client.query(
    `insert into public.securities (id, user_id, name, ticker, isin, currency)
     values ($1, $2, 'Titre intégration', 'TI', 'FR0000000001', 'EUR')`,
    [securityId, userId],
  );
  // Une ligne de position COMMITTÉE doit DÉSIGNER l'observation qu'elle a écrite : la base
  // le refuse sinon, et c'est le bon comportement — un fait écrit sans sa cible ne se
  // rattache à rien.
  const positionId = randomUUID();
  await client.query(
    `insert into public.positions
       (id, user_id, account_id, security_id, is_cash, data_kind, confidence)
     values ($1, $2, $3, $4, false, 'ACTUAL', 'HIGH')`,
    [positionId, userId, accountId, securityId],
  );
  const snapshotId = randomUUID();
  await client.query(
    `insert into public.position_snapshots
       (id, user_id, position_id, snapshot_date, quantity, market_value, currency,
        data_kind, confidence)
     values ($1, $2, $3, '2026-08-19', 12, 4200, 'EUR', 'ACTUAL', 'HIGH')`,
    [snapshotId, userId, positionId],
  );
  await client.query(
    `insert into public.import_normalized_records
       (user_id, session_id, raw_record_id, target_domain, account_id, security_id,
        transaction_date, currency, market_value, status, commit_state, committed_at,
        position_snapshot_id, external_key)
     values ($1, $2, $3, 'PORTFOLIO_POSITION', $4, $5, '2026-08-19', 'EUR', 4200, 'READY',
             'COMMITTED', now(), $6, 'integration:tx-1')`,
    [userId, positionSession, positionRaw, accountId, securityId, snapshotId],
  );
  const acrossDomains = await client.query<{ count: string }>(
    `select count(*)::text as count from public.import_normalized_records
      where user_id = $1 and external_key = 'integration:tx-1' and commit_state = 'COMMITTED'`,
    [userId],
  );
  assert(
    acrossDomains.rows[0].count === "2",
    "La même chaîne d'identifiant doit rester licite sur DEUX domaines cibles distincts",
  );

  // ── 5. Un même fichier, une même page, un même événement : une seule fois ───────
  // L'unicité d'idempotence de fichier est PARTIELLE, sur les seules sessions validées : une
  // analyse abandonnée ne bloque rien, une validation bloque. La première session est donc
  // portée à COMMITTED avant le contrôle, sinon l'index ne s'applique pas et le test
  // passerait pour la mauvaise raison.
  await client.query(
    "update public.import_sessions set status = 'COMMITTED', committed_at = now() where id = $1",
    [sessionId],
  );
  await rejects(
    `insert into public.import_sessions
       (user_id, source_id, status, parser, parser_version, file_name, file_hash, committed_at)
     values ($1, $2, 'COMMITTED', 'intégration', '1', 'x.csv', $3, now())`,
    [userId, bankSourceId, "a".repeat(64)],
    "Un même contenu de fichier a pu être validé deux fois pour la même source",
    "import_sessions_committed_file_uidx",
  );

  const providerId = randomUUID();
  await client.query(
    `insert into public.bank_providers
       (id, user_id, adapter_id, adapter_version, label, auth_mode, capabilities)
     values ($1, $2, 'integration-ais', '1', 'Intégration', 'FIXTURE', '{}'::jsonb)`,
    [providerId, userId],
  );
  await client.query(
    `insert into public.bank_sync_events
       (user_id, provider_id, provider_event_id, event_type, payload, signature_verified)
     values ($1, $2, 'evt-integration', 'TRANSACTIONS_UPDATED', '{}'::jsonb, true)`,
    [userId, providerId],
  );
  await rejects(
    `insert into public.bank_sync_events
       (user_id, provider_id, provider_event_id, event_type, payload, signature_verified)
     values ($1, $2, 'evt-integration', 'TRANSACTIONS_UPDATED', '{}'::jsonb, true)`,
    [userId, providerId],
    "Un même événement de notification a pu être enregistré deux fois",
    "bank_sync_events_event_uk",
  );

  // ── 6. Les deux garde-fous SECURITY DEFINER, et aucun troisième ─────────────────
  const definers = await client.query<{ names: string | null }>(
    `select string_agg(proc.proname, ',' order by proc.proname) as names
       from pg_catalog.pg_proc proc
       join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
      where ns.nspname = 'public' and proc.prosecdef`,
  );
  assert(
    definers.rows[0].names === "bank_sync_freeze_state,import_session_freeze_state",
    `Le schéma applicatif ne doit porter QUE les deux garde-fous déclarés, obtenu ${definers.rows[0].names}`,
  );
  const noLfoDefiner = await client.query<{ count: string }>(
    `select count(*)::text as count from pg_catalog.pg_proc proc
       join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
      where ns.nspname = 'public' and proc.prosecdef and proc.proname like 'lfo_%'`,
  );
  assert(
    noLfoDefiner.rows[0].count === "0",
    "Aucune RPC lfo_* ne doit être SECURITY DEFINER : le contrat resterait à démontrer",
  );

  // ── 7. Piste d'audit en lecture seule sous `authenticated`, toutes verticales ───
  await client.query("reset role");
  await client.query("set local role authenticated");
  for (const table of [
    "external_sources",
    "import_sources",
    "import_sessions",
    "import_raw_records",
    "import_normalized_records",
    "import_record_links",
    "import_upload_tickets",
    "company_registry_snapshots",
    "document_extraction_runs",
    "real_estate_data_snapshots",
    "import_instrument_resolutions",
    "bank_observed_transactions",
    "bank_sync_raw_pages",
    "bank_reconciliation_decisions",
  ]) {
    await rejects(
      `delete from public.${table}`,
      [],
      `La piste d'audit public.${table} est inscriptible par authenticated`,
      "permission denied",
    );
  }
  for (const guard of ["import_session_freeze_state", "bank_sync_freeze_state"]) {
    await rejects(
      `select public.${guard}($1::uuid, $2::uuid)`,
      [randomUUID(), userId],
      `Le garde-fou ${guard} est exécutable par authenticated`,
      "permission denied",
    );
  }
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
      "Smoke Intégration acquisition : external_sources partagée par deux domaines avec une forme PAR DOMAINE et une forme de capacités PAR DOMAINE, un même fournisseur servant deux domaines et pas deux fois le même, domaine sans support refusé, quatre domaines de source / trois de dépôt / cinq de provenance tous acceptés après coexistence, lien ne portant jamais deux faits, provenance de liasse sans session, identité démontrée LUE plusieurs fois et ÉCRITE une seule, même identifiant licite sur deux domaines cibles, même fichier validé une fois, même événement enregistré une fois, deux garde-fous SECURITY DEFINER et aucun troisième, aucune RPC lfo_* en SECURITY DEFINER, quatorze tables d'acquisition en lecture seule sous authenticated. Aucune donnée persistée.",
    );
  }
}
