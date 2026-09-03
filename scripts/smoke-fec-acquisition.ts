/**
 * Smoke transactionnel de l'acquisition comptable (FEC). Toutes les écritures sont
 * annulées : aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve :
 *
 *   * le STAGING est un bucket distinct du coffre documentaire, privé, dimensionné pour ce
 *     que l'application accepte d'analyser, et sans aucune policy Storage ;
 *   * un billet d'upload est émis par le SERVEUR : chemin calculé, usage unique, expirant,
 *     et invisible pour un autre propriétaire ;
 *   * un échec de nettoyage du staging reste TRAÇABLE et n'annule aucun fait écrit ;
 *   * une session comptable s'ouvre en RECEIVING, reçoit ses écritures par lots et ne
 *     produit AUCUN fait Business avant validation ;
 *   * le brut et l'écriture lue sont écrits ATOMIQUEMENT et rattachés par numéro de ligne ;
 *   * ABSENT ≠ ZÉRO : une écriture aux deux côtés absents ne peut exister qu'en BLOCKED ;
 *   * les montants SIGNÉS sont acceptés : le texte réglementaire les autorise, et une
 *     contrepassation s'écrit ainsi ;
 *   * un montant en devise sans code devise est refusé : pas de taux implicite égal à 1 ;
 *   * la validation exige une couverture DÉCLARÉE, zéro écriture déséquilibrée, zéro ligne
 *     illisible et zéro écriture hors de l'exercice déclaré — chacun de ces refus est porté
 *     par la base, pas par l'application ;
 *   * le déséquilibre est RECALCULÉ depuis les lignes persistées : un décompte de session
 *     remis à zéro ne fait pas passer une comptabilité déséquilibrée ;
 *   * déclarer une couverture d'exercice sans bornes d'exercice est refusé par la base ;
 *   * la validation écrit l'instantané financier, gèle les écritures et pose le lien de
 *     provenance en une seule transaction ;
 *   * une écriture committée est gelée : ni modifiable, ni supprimable, même sous
 *     `service_role` ;
 *   * `fec_entry_lines` est en LECTURE SEULE pour `authenticated` ;
 *   * un instantané financier importé n'est pas supprimable en laissant sa provenance
 *     orpheline ;
 *   * une période financière issue d'une AUTRE source n'est jamais écrasée : le conflit est
 *     refusé, et rien de l'existant n'est modifié ;
 *   * une période financière issue d'un import FEC antérieur reste corrigeable ;
 *   * un second commit de la même session ne réécrit rien (idempotence applicative) ;
 *   * réimporter le même fichier déjà validé est refusé (idempotence de base) ;
 *   * une session encore en réception portant la même empreinte est REMPLACÉE ;
 *   * une session en réception est abandonnable, une session committée ne l'est pas ;
 *   * une source comptable ne peut pas viser à la fois une société et un compte bancaire ;
 *   * une session d'un autre propriétaire est inaccessible, même en connaissant son UUID.
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
  tickets: string;
  sources: string;
  sessions: string;
  raw: string;
  fecLines: string;
  links: string;
  financials: string;
  businesses: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.import_upload_tickets)::text as tickets,
      (select count(*) from public.import_sources)::text as sources,
      (select count(*) from public.import_sessions)::text as sessions,
      (select count(*) from public.import_raw_records)::text as raw,
      (select count(*) from public.fec_entry_lines)::text as "fecLines",
      (select count(*) from public.import_record_links)::text as links,
      (select count(*) from public.business_financials)::text as financials,
      (select count(*) from public.businesses)::text as businesses
  `);
  return result.rows[0];
}

const FILE_HASH_A = "c".repeat(64);
const FILE_HASH_B = "d".repeat(64);

let userId = "";
let businessId = "";
/** Le message de succès ne doit jamais s'afficher sur un échec : le `finally` le lit. */
let succeeded = false;

type LineSpec = {
  row: number;
  journal?: string;
  entry: string;
  date?: string | null;
  account: string;
  debit?: string | null;
  credit?: string | null;
  group: string;
  status?: string;
  currencyAmount?: string | null;
  currencyCode?: string | null;
};

/** Une ligne reçue : le brut TEL QUEL, et sa lecture. */
function received(spec: LineSpec): Record<string, unknown> {
  const date = spec.date === undefined ? "2025-06-30" : spec.date;
  return {
    row_number: spec.row,
    raw_line: [
      spec.journal ?? "OD",
      spec.entry,
      spec.account,
      spec.debit ?? "",
      spec.credit ?? "",
    ].join("|"),
    cells: [spec.journal ?? "OD", spec.entry, spec.account, spec.debit ?? "", spec.credit ?? ""],
    line: {
      journal_code: spec.journal ?? "OD",
      entry_num: spec.entry,
      entry_date: date,
      account_num: spec.account,
      account_lib: `Compte ${spec.account}`,
      entry_label: `Ecriture ${spec.entry}`,
      debit: spec.debit ?? null,
      credit: spec.credit ?? null,
      currency_amount: spec.currencyAmount ?? null,
      currency_code: spec.currencyCode ?? null,
      pcg_class: Number(spec.account.charAt(0)),
      pcg_group: spec.group,
      status: spec.status ?? "READY",
      issues: [],
    },
  };
}

function openPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: {
      kind: "FILE_CSV",
      provider: "FEC_FR",
      label: "Smoke FEC",
      target_business_id: businessId,
      adapter_version: "fec/1",
    },
    session: {
      file_name: "smoke.txt",
      file_hash: FILE_HASH_A,
      file_size_bytes: 1024,
      content_type: "text/plain",
      encoding: "utf-8",
      delimiter: "|",
      parser: "fec",
      parser_version: "1",
      declared_currency: "EUR",
      observation_date: "2026-08-28",
      fiscal_year_start: "2025-01-01",
      fiscal_year_end: "2025-12-31",
      coverage_declared: true,
      issues: [],
      ...overrides,
    },
  };
}

/** Un exercice minimal mais ÉQUILIBRÉ : vente encaissée, achat, dette, amortissement. */
const BALANCED_LINES = [
  received({
    row: 1,
    journal: "VTE",
    entry: "1",
    account: "411000",
    debit: "1200",
    group: "TRADE_RECEIVABLES",
  }),
  received({
    row: 2,
    journal: "VTE",
    entry: "1",
    account: "701000",
    credit: "1200",
    group: "REVENUE",
  }),
  received({
    row: 3,
    journal: "ACH",
    entry: "2",
    account: "601000",
    debit: "400",
    group: "PURCHASES",
  }),
  received({
    row: 4,
    journal: "ACH",
    entry: "2",
    account: "401000",
    credit: "400",
    group: "SUPPLIERS",
  }),
  received({ row: 5, journal: "BQ", entry: "3", account: "512000", debit: "1200", group: "CASH" }),
  received({
    row: 6,
    journal: "BQ",
    entry: "3",
    account: "411000",
    credit: "1200",
    group: "TRADE_RECEIVABLES",
  }),
  received({
    row: 7,
    journal: "OD",
    entry: "4",
    account: "164000",
    credit: "5000",
    group: "FINANCIAL_DEBT",
  }),
  received({
    row: 8,
    journal: "OD",
    entry: "4",
    account: "215000",
    debit: "5000",
    group: "FIXED_ASSETS_GROSS",
  }),
  received({
    row: 9,
    journal: "OD",
    entry: "5",
    account: "681100",
    debit: "500",
    group: "DEPRECIATION_EXPENSE",
  }),
  received({
    row: 10,
    journal: "OD",
    entry: "5",
    account: "281500",
    credit: "500",
    group: "FIXED_ASSETS_DEPRECIATION",
  }),
];

/** Instantané financier tel que la couche pure le proposerait sur ces écritures. */
const FINANCIALS = {
  period_end: "2025-12-31",
  period_start: "2025-01-01",
  period_kind: "ANNUAL",
  period_label: "Exercice 2025 (FEC)",
  revenue: 1200,
  gross_profit: null,
  ebitda: 800,
  ebit: 300,
  net_income: 300,
  cash: 1200,
  gross_debt: 5000,
  working_capital: -400,
  capex: null,
  free_cash_flow: null,
  depreciation_amortisation: 500,
  interest_expense: null,
  tax_expense: 0,
  currency: "EUR",
  data_kind: "ACTUAL",
  confidence: "HIGH",
  source: "Import FEC smoke",
};

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

  // Propriétaire voisin : il sert à prouver le cloisonnement. Créé avant le passage en
  // `service_role`, qui n'écrit pas dans le schéma `auth`.
  const foreignUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    foreignUser,
    `smoke-fec-${foreignUser}@invalid`,
  ]);

  // ── 0 bis. STAGING ≠ COFFRE DOCUMENTAIRE ─────────────────────────────────────────
  //
  // Le contournement de la limite de corps de requête ne sert à rien si le stockage refuse
  // ensuite le fichier : il faut que les DEUX buckets soient réellement dimensionnés pour
  // leur rôle. C'est vérifiable en base, donc c'est vérifié ici.
  const bucketRows = await client.query<{
    id: string;
    is_public: boolean;
    limit_bytes: string;
    mimes: string[];
  }>(
    `select id, public as is_public, file_size_limit::text as limit_bytes,
            allowed_mime_types as mimes
       from storage.buckets
      where id in ('family-office-documents', 'family-office-import-staging')
      order by id`,
  );
  const documentsBucket = bucketRows.rows.find((row) => row.id === "family-office-documents");
  const stagingBucket = bucketRows.rows.find((row) => row.id === "family-office-import-staging");
  assert(documentsBucket && stagingBucket, "Les deux buckets doivent exister");
  assert(
    stagingBucket!.id !== documentsBucket!.id,
    "Le staging doit être un bucket DISTINCT du coffre documentaire",
  );
  assert(stagingBucket!.is_public === false, "Le bucket de staging ne doit jamais être public");
  assert(documentsBucket!.is_public === false, "Le coffre documentaire ne doit jamais être public");
  assert(
    Number(stagingBucket!.limit_bytes) >= 24 * 1024 * 1024,
    "Le bucket de staging doit accepter au moins ce que l'application analyse (24 Mio)",
  );
  assert(
    Number(documentsBucket!.limit_bytes) === 8 * 1024 * 1024,
    "Le coffre documentaire garde sa vocation : 8 Mio, non relevés pour accueillir un FEC",
  );
  for (const mime of ["text/plain", "text/csv", "text/tab-separated-values"]) {
    assert(
      stagingBucket!.mimes.includes(mime),
      `Le bucket de staging doit accepter ${mime} : un FEC est du texte à plat`,
    );
  }
  assert(
    documentsBucket!.mimes.includes("text/plain"),
    "Le coffre doit accepter text/plain, sans quoi la CONSERVATION d'un FEC échouerait après l'écriture des faits",
  );
  for (const mime of ["application/pdf", "image/png", "text/csv"]) {
    assert(
      documentsBucket!.mimes.includes(mime),
      `L'ajout au coffre doit être ADDITIF : ${mime} a disparu`,
    );
  }
  const leakingPolicies = await client.query<{ count: string }>(
    `select count(*)::text as count
       from pg_catalog.pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and coalesce(qual, '') || coalesce(with_check, '') like '%family-office-import-staging%'`,
  );
  assert(
    leakingPolicies.rows[0].count === "0",
    "Aucune policy Storage ne doit ouvrir la zone de staging : URL signée et service_role seulement",
  );

  await client.query("set local role service_role");

  const foreignBusinessId = randomUUID();
  await client.query(
    `insert into public.businesses
       (id, user_id, name, status, business_type, functional_currency, data_kind, confidence)
     values ($1, $2, 'Societe voisine', 'ACTIVE', 'SME', 'EUR', 'ACTUAL', 'HIGH')`,
    [foreignBusinessId, foreignUser],
  );

  businessId = randomUUID();
  const originalBusinessId = businessId;
  await client.query(
    `insert into public.businesses
       (id, user_id, name, status, business_type, functional_currency, data_kind, confidence)
     values ($1, $2, 'Smoke societe', 'ACTIVE', 'SME', 'EUR', 'ACTUAL', 'HIGH')`,
    [businessId, userId],
  );

  // ── 0. Billets d'upload : le fichier ne traverse pas la fonction serveur ─────────
  //
  // Le chemin est CALCULÉ par la base à partir du propriétaire et de l'identifiant du
  // billet. Un chemin fourni par un client laisserait lire — ou écraser — le fichier d'un
  // autre propriétaire.
  const ticketId = await rpc("lfo_issue_import_upload_ticket", {
    domain: "BUSINESS_ACCOUNTING",
    file_name: "fec-2025.txt",
    content_type: "text/plain",
    byte_size: 12_000_000,
    ttl_minutes: 30,
  });
  const ticket = await client.query<{ path: string; consumed: string | null; expires: string }>(
    "select storage_path as path, consumed_at::text as consumed, expires_at::text as expires from public.import_upload_tickets where id = $1",
    [ticketId],
  );
  assert(
    ticket.rows[0].path === `${userId}/import-staging/${ticketId}`,
    "Le chemin de staging doit être dérivé du propriétaire et du billet, jamais fourni",
  );
  assert(ticket.rows[0].consumed === null, "Un billet neuf ne doit pas être consommé");

  await client.query("select public.lfo_consume_import_upload_ticket($1::uuid, $2::uuid)", [
    userId,
    ticketId,
  ]);
  // À USAGE UNIQUE : un même objet de staging n'alimente pas deux sessions, donc pas deux
  // vérités sur le même fichier.
  await rejects(
    "select public.lfo_consume_import_upload_ticket($1::uuid, $2::uuid)",
    [userId, ticketId],
    "Un billet d'upload a pu être consommé deux fois",
    "déjà consommé",
  );

  // Un billet d'un AUTRE propriétaire est introuvable, même en connaissant son UUID.
  await rejects(
    "select public.lfo_consume_import_upload_ticket($1::uuid, $2::uuid)",
    [foreignUser, ticketId],
    "Un billet d'upload d'un autre propriétaire a pu être consommé",
    "introuvable",
  );

  // Un billet EXPIRÉ n'est pas une porte ouverte indéfiniment.
  const staleTicket = await rpc("lfo_issue_import_upload_ticket", {
    file_name: "vieux.txt",
    byte_size: 1024,
    ttl_minutes: 1,
  });
  // Le billet est vieilli des deux côtés : `import_upload_tickets_expiry_ck` impose une
  // expiration postérieure à la création, et cette contrainte est juste — c'est le TEMPS
  // qu'on simule ici, pas un billet incohérent.
  await client.query(
    `update public.import_upload_tickets
        set created_at = now() - interval '2 hours',
            expires_at = now() - interval '1 hour'
      where id = $1`,
    [staleTicket],
  );
  await rejects(
    "select public.lfo_consume_import_upload_ticket($1::uuid, $2::uuid)",
    [userId, staleTicket],
    "Un billet d'upload expiré a pu être consommé",
    "expiré",
  );

  // Une taille nulle ne produit aucun billet : il n'y a rien à déposer.
  await rejects(
    "select public.lfo_issue_import_upload_ticket($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ file_name: "vide.txt", byte_size: 0 })],
    "Un billet a pu être émis pour un fichier de taille nulle",
    "absente ou nulle",
  );

  await client.query("delete from public.import_upload_tickets where user_id = $1", [userId]);

  // ── 1. Ouverture et réception par lots ────────────────────────────────────────────
  const sessionId = await rpc("lfo_open_fec_session", openPayload());
  const opened = await client.query<{ status: string; coverage: boolean; source_id: string }>(
    "select status, coverage_declared as coverage, source_id from public.import_sessions where id = $1",
    [sessionId],
  );
  assert(opened.rows[0].status === "RECEIVING", "Une session ouverte doit être en RECEIVING");
  assert(opened.rows[0].coverage === true, "La couverture déclarée n'a pas été persistée");
  const sourceId = opened.rows[0].source_id;

  const sourceShape = await client.query<{
    domain: string;
    business: string | null;
    account: string | null;
  }>(
    "select domain, target_business_id as business, target_account_id as account from public.import_sources where id = $1",
    [sourceId],
  );
  assert(
    sourceShape.rows[0].domain === "BUSINESS_ACCOUNTING" &&
      sourceShape.rows[0].business === businessId &&
      sourceShape.rows[0].account === null,
    "Une source comptable doit viser une société, et elle seule",
  );

  // Deux lots : le fractionnement ne change rien à la sémantique.
  await rpc("lfo_append_fec_lines", { session_id: sessionId, rows: BALANCED_LINES.slice(0, 6) });
  await rpc("lfo_append_fec_lines", { session_id: sessionId, rows: BALANCED_LINES.slice(6) });

  const staged = await client.query<{ lines: string; raw: string; joined: string }>(
    `select
       (select count(*) from public.fec_entry_lines where session_id = $1)::text as lines,
       (select count(*) from public.import_raw_records where session_id = $1)::text as raw,
       (select count(*) from public.fec_entry_lines l
          join public.import_raw_records r on r.id = l.raw_record_id and r.user_id = l.user_id
         where l.session_id = $1)::text as joined`,
    [sessionId],
  );
  assert(staged.rows[0].lines === "10", "Les dix écritures n'ont pas été reçues");
  assert(staged.rows[0].raw === "10", "Les dix lignes brutes n'ont pas été conservées");
  assert(
    staged.rows[0].joined === "10",
    "Chaque écriture doit être rattachée à SA ligne brute par numéro de ligne",
  );

  const noFactYet = await client.query<{ count: string }>(
    "select count(*)::text as count from public.business_financials where business_id = $1",
    [businessId],
  );
  assert(noFactYet.rows[0].count === "0", "L'analyse ne doit écrire AUCUN fait Business");

  // ── 2. ABSENT ≠ ZÉRO, et les invariants de montant ────────────────────────────────
  const rawProbe = await client.query<{ id: string }>(
    "select id from public.import_raw_records where session_id = $1 and row_number = 1",
    [sessionId],
  );
  const probeRawId = rawProbe.rows[0].id;

  await rejects(
    `insert into public.fec_entry_lines
       (user_id, session_id, raw_record_id, business_id, journal_code, entry_num, entry_date,
        account_num, pcg_group, status, debit, credit)
     values ($1, $2, $3, $4, 'OD', '99', '2025-06-30', '411000', 'TRADE_RECEIVABLES', 'READY', null, null)`,
    [userId, sessionId, probeRawId, businessId],
    "Une écriture READY sans aucun montant a été acceptée",
    "fec_entry_lines_amount_shape_ck",
  );

  await rejects(
    `insert into public.fec_entry_lines
       (user_id, session_id, raw_record_id, business_id, journal_code, entry_num, entry_date,
        account_num, pcg_group, status, debit, currency_amount)
     values ($1, $2, $3, $4, 'OD', '99', '2025-06-30', '411000', 'TRADE_RECEIVABLES', 'READY', 10, 12)`,
    [userId, sessionId, probeRawId, businessId],
    "Un montant en devise sans code devise a été accepté",
    "fec_entry_lines_currency_ck",
  );

  // Une écriture aux deux côtés absents EXISTE si et seulement si elle est bloquée : le
  // format autorise le champ vide, et la lecture doit pouvoir le dire sans inventer un zéro.
  const blockedRaw = await client.query<{ id: string }>(
    `insert into public.import_raw_records (user_id, session_id, row_number, raw_line, cells)
     values ($1, $2, 900, 'OD|900|411000||', '["OD","900","411000","",""]'::jsonb)
     returning id`,
    [userId, sessionId],
  );
  await client.query(
    `insert into public.fec_entry_lines
       (user_id, session_id, raw_record_id, business_id, journal_code, entry_num, entry_date,
        account_num, pcg_group, status)
     values ($1, $2, $3, $4, 'OD', '900', '2025-06-30', '411000', 'TRADE_RECEIVABLES', 'BLOCKED')`,
    [userId, sessionId, blockedRaw.rows[0].id, businessId],
  );

  // ── 3. La validation refuse une comptabilité non fiable ───────────────────────────
  await rpc("lfo_finalize_fec_session", {
    session_id: sessionId,
    entry_count: 5,
    unbalanced_entry_count: 0,
    issues: [],
  });
  const finalized = await client.query<{
    status: string;
    rows: string;
    ready: string;
    blocked: string;
    start: string | null;
    end: string | null;
  }>(
    `select status, row_count::text as rows, ready_count::text as ready,
            blocked_count::text as blocked,
            observed_period_start::text as start, observed_period_end::text as end
       from public.import_sessions where id = $1`,
    [sessionId],
  );
  assert(finalized.rows[0].status === "ANALYZED", "La clôture de réception n'a pas eu lieu");
  assert(finalized.rows[0].rows === "11", "Les décomptes doivent être RELUS en base");
  assert(finalized.rows[0].ready === "10" && finalized.rows[0].blocked === "1", "Décomptes faux");
  assert(
    finalized.rows[0].start === "2025-06-30" && finalized.rows[0].end === "2025-06-30",
    "La période observée doit exclure les lignes bloquées",
  );

  await rejects(
    "select public.lfo_commit_fec_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ session_id: sessionId, financials: FINANCIALS })],
    "Une session portant une ligne illisible a été validée",
    "illisible",
  );

  // La ligne bloquée retirée, la validation devient possible : c'est bien elle qui bloquait.
  await client.query(
    "delete from public.fec_entry_lines where session_id = $1 and status = 'BLOCKED'",
    [sessionId],
  );
  // Le BRUT de la ligne illisible, lui, RESTE. C'est ce que le fichier contenait, et le
  // garde-fou du brut refuse maintenant de le retirer d'une session vivante : seul l'abandon
  // DÉCLARÉ de la session libère un brut. Retirer la LECTURE suffit à débloquer la
  // validation, et c'est le bon niveau — corriger une lecture ne réécrit pas la source.
  await rejects(
    "delete from public.import_raw_records where session_id = $1 and row_number = 900",
    [sessionId],
    "Le brut d'une session vivante a pu être supprimé",
    "ne se supprime qu'en abandonnant la session",
  );

  // Le décompte de la SESSION n'est plus ce qui décide : seules les lignes persistées le
  // font. Une colonne gonflée à 2 sur une comptabilité réellement équilibrée ne doit donc
  // PAS bloquer — le cas inverse, une colonne à 0 sur une comptabilité déséquilibrée, est
  // couvert plus bas et lui doit bloquer.
  await client.query("update public.import_sessions set unbalanced_entry_count = 2 where id = $1", [
    sessionId,
  ]);
  const derivedBalance = await client.query<{ unbalanced: string }>(
    "select unbalanced::text as unbalanced from public.lfo_fec_entry_balance($1, $2)",
    [userId, sessionId],
  );
  assert(
    derivedBalance.rows[0].unbalanced === "0",
    "Les lignes persistées de cette session sont équilibrées : le contrôle dérivé doit le dire",
  );
  await client.query(
    "update public.import_sessions set unbalanced_entry_count = 0, coverage_declared = false where id = $1",
    [sessionId],
  );
  await rejects(
    "select public.lfo_commit_fec_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ session_id: sessionId, financials: FINANCIALS })],
    "Une session sans couverture déclarée a été validée",
    "Couverture",
  );
  await client.query("update public.import_sessions set coverage_declared = true where id = $1", [
    sessionId,
  ]);

  // ── 4. Validation : fait, gel et provenance en une transaction ────────────────────
  await rpc("lfo_commit_fec_session", { session_id: sessionId, financials: FINANCIALS });

  const committed = await client.query<{
    status: string;
    committed: string;
    frozen: string;
    links: string;
    financials: string;
  }>(
    `select
       (select status from public.import_sessions where id = $1) as status,
       (select committed_count::text from public.import_sessions where id = $1) as committed,
       (select count(*)::text from public.fec_entry_lines
         where session_id = $1 and commit_state = 'COMMITTED') as frozen,
       (select count(*)::text from public.import_record_links
         where session_id = $1 and target_domain = 'BUSINESS_ACCOUNTING') as links,
       (select count(*)::text from public.business_financials where business_id = $2) as financials`,
    [sessionId, businessId],
  );
  assert(committed.rows[0].status === "COMMITTED", "La session n'est pas passée à COMMITTED");
  assert(committed.rows[0].committed === "10", "Les dix écritures n'ont pas été gelées");
  assert(committed.rows[0].frozen === "10", "Le gel n'a pas été appliqué à toutes les écritures");
  assert(committed.rows[0].links === "1", "Le lien de provenance comptable est absent");
  assert(committed.rows[0].financials === "1", "L'instantané financier n'a pas été écrit");

  const link = await client.query<{
    financials: string;
    normalized: string | null;
    transaction: string | null;
  }>(
    `select business_financials_id as financials, normalized_record_id as normalized,
            transaction_id as transaction
       from public.import_record_links where session_id = $1`,
    [sessionId],
  );
  assert(
    link.rows[0].normalized === null && link.rows[0].transaction === null,
    "Un lien comptable ne désigne ni ligne bancaire ni transaction",
  );
  const financialsId = link.rows[0].financials;

  const written = await client.query<{
    revenue: string;
    ebitda: string;
    capex: string | null;
    kind: string;
  }>(
    `select revenue::text as revenue, ebitda::text as ebitda, capex::text as capex, data_kind as kind
       from public.business_financials where id = $1`,
    [financialsId],
  );
  assert(Number(written.rows[0].revenue) === 1200, "Le chiffre d'affaires écrit est faux");
  assert(Number(written.rows[0].ebitda) === 800, "L'EBE écrit est faux");
  assert(written.rows[0].capex === null, "D&A ≠ CAPEX CASH : le capex doit rester NULL");
  assert(written.rows[0].kind === "ACTUAL", "Un fait importé est ACTUAL, pas une hypothèse");

  // Aucune valorisation n'a été inventée au passage.
  const valuations = await client.query<{ count: string }>(
    "select count(*)::text as count from public.business_valuations where business_id = $1",
    [businessId],
  );
  assert(valuations.rows[0].count === "0", "L'acquisition ne doit produire AUCUNE valorisation");

  // ── 5. Gel de la provenance ──────────────────────────────────────────────────────
  await rejects(
    "update public.fec_entry_lines set debit = 1 where session_id = $1 and commit_state = 'COMMITTED'",
    [sessionId],
    "Une écriture committée a pu être modifiée",
    "gelée",
  );
  await rejects(
    "delete from public.fec_entry_lines where session_id = $1 and commit_state = 'COMMITTED'",
    [sessionId],
    "Une écriture committée a pu être supprimée",
    "gelée",
  );
  await rejects(
    "delete from public.import_record_links where session_id = $1",
    [sessionId],
    "Un lien de provenance comptable a pu être supprimé sous service_role",
    "immuable",
  );
  await rejects(
    "delete from public.business_financials where id = $1",
    [financialsId],
    "Un instantané financier importé a pu être supprimé en laissant sa provenance orpheline",
    "import_record_links_business_fk",
  );
  await rejects(
    "delete from public.import_raw_records where session_id = $1",
    [sessionId],
    "Le brut d'une session validée a pu être supprimé",
    "ne se supprime pas",
  );
  await rejects(
    "select public.lfo_discard_import_session($1::uuid, $2::uuid)",
    [userId, sessionId],
    "Une session validée a pu être abandonnée",
    "réception ou analysée",
  );

  // ── 5 bis. Montants SIGNÉS : le texte réglementaire les autorise ─────────────────
  //
  // Aucune contrainte de signe ne doit exister : un débit de −100 est une écriture valide,
  // typiquement une contrepassation. Le refuser rejetterait des FEC parfaitement conformes.
  const signedSession = await rpc(
    "lfo_open_fec_session",
    openPayload({ file_hash: "1".repeat(64) }),
  );
  await rpc("lfo_append_fec_lines", {
    session_id: signedSession,
    rows: [
      received({
        row: 1,
        journal: "OD",
        entry: "1",
        account: "411000",
        debit: "-100",
        group: "TRADE_RECEIVABLES",
      }),
      received({
        row: 2,
        journal: "OD",
        entry: "1",
        account: "701000",
        credit: "-100",
        group: "REVENUE",
      }),
    ],
  });
  const signed = await client.query<{ debit: string; credit: string; unbalanced: string }>(
    `select
       (select debit::text from public.fec_entry_lines where session_id = $1 and status <> 'BLOCKED' order by created_at limit 1) as debit,
       (select credit::text from public.fec_entry_lines where session_id = $1 and credit is not null limit 1) as credit,
       (select unbalanced::text from public.lfo_fec_entry_balance($2, $1)) as unbalanced`,
    [signedSession, userId],
  );
  assert(
    Number(signed.rows[0].debit) === -100 && Number(signed.rows[0].credit) === -100,
    "Un montant signé doit être persisté TEL QUEL, sans valeur absolue",
  );
  assert(
    signed.rows[0].unbalanced === "0",
    "Le contrôle de partie double doit fonctionner avec des montants signés",
  );
  await client.query("select public.lfo_discard_import_session($1::uuid, $2::uuid)", [
    userId,
    signedSession,
  ]);

  // ── 5 ter. Le déséquilibre est RECALCULÉ, jamais cru sur parole ──────────────────
  const forgedSession = await rpc(
    "lfo_open_fec_session",
    openPayload({ file_hash: "2".repeat(64) }),
  );
  await rpc("lfo_append_fec_lines", {
    session_id: forgedSession,
    rows: [
      received({
        row: 1,
        journal: "OD",
        entry: "1",
        account: "411000",
        debit: "1200",
        group: "TRADE_RECEIVABLES",
      }),
      received({
        row: 2,
        journal: "OD",
        entry: "1",
        account: "701000",
        credit: "1000",
        group: "REVENUE",
      }),
    ],
  });
  // L'appelant ANNONCE un exercice équilibré. La base doit constater le contraire.
  await rpc("lfo_finalize_fec_session", {
    session_id: forgedSession,
    entry_count: 1,
    unbalanced_entry_count: 0,
    issues: [],
  });
  const derived = await client.query<{ entries: string; unbalanced: string }>(
    "select entry_count::text as entries, unbalanced_entry_count::text as unbalanced from public.import_sessions where id = $1",
    [forgedSession],
  );
  assert(
    derived.rows[0].entries === "1" && derived.rows[0].unbalanced === "1",
    "Les décomptes d'écritures doivent être DÉRIVÉS des lignes, pas repris de la charge d'appel",
  );
  await rejects(
    "select public.lfo_commit_fec_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ session_id: forgedSession, financials: FINANCIALS })],
    "Un décompte de session forgé a fait passer une comptabilité déséquilibrée",
    "déséquilibrée",
  );
  // Même en remettant la colonne à zéro à la main : l'invariant ne repose pas sur elle.
  await client.query("update public.import_sessions set unbalanced_entry_count = 0 where id = $1", [
    forgedSession,
  ]);
  await rejects(
    "select public.lfo_commit_fec_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ session_id: forgedSession, financials: FINANCIALS })],
    "Une colonne de décompte remise à zéro a fait passer une comptabilité déséquilibrée",
    "déséquilibrée",
  );
  await client.query("select public.lfo_discard_import_session($1::uuid, $2::uuid)", [
    userId,
    forgedSession,
  ]);

  // ── 5 quater. Aucune écriture d'une autre période dans un exercice déclaré ────────
  const outOfPeriod = await rpc("lfo_open_fec_session", openPayload({ file_hash: "3".repeat(64) }));
  await rpc("lfo_append_fec_lines", {
    session_id: outOfPeriod,
    rows: [
      received({
        row: 1,
        journal: "OD",
        entry: "1",
        account: "411000",
        debit: "100",
        group: "TRADE_RECEIVABLES",
      }),
      received({
        row: 2,
        journal: "OD",
        entry: "1",
        account: "701000",
        credit: "100",
        group: "REVENUE",
      }),
      received({
        row: 3,
        journal: "OD",
        entry: "2",
        date: "2026-01-02",
        account: "411000",
        debit: "50",
        group: "TRADE_RECEIVABLES",
      }),
      received({
        row: 4,
        journal: "OD",
        entry: "2",
        date: "2026-01-02",
        account: "701000",
        credit: "50",
        group: "REVENUE",
      }),
    ],
  });
  await rpc("lfo_finalize_fec_session", { session_id: outOfPeriod, issues: [] });
  await rejects(
    "select public.lfo_commit_fec_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ session_id: outOfPeriod, financials: FINANCIALS })],
    "Un exercice déclaré complet a accepté une écriture d'une autre période",
    "hors de l'exercice déclaré",
  );
  await client.query("select public.lfo_discard_import_session($1::uuid, $2::uuid)", [
    userId,
    outOfPeriod,
  ]);

  // ── 5 quinquies. Couverture déclarée sans exercice : refusée par la BASE ──────────
  await rejects(
    `insert into public.import_sessions
       (user_id, source_id, parser, parser_version, status, coverage_declared)
     values ($1, $2, 'fec', '1', 'RECEIVING', true)`,
    [userId, sourceId],
    "Une couverture d'exercice a pu être déclarée sans bornes d'exercice",
    "import_sessions_coverage_shape_ck",
  );

  // ── 5 sexies. CONFLIT DE SOURCES : aucune autre vérité n'est écrasée ─────────────
  //
  //     CONFLIT DE SOURCES  ≠  CHOIX SILENCIEUX D'UNE SOURCE
  //
  // Une période financière saisie à la main, ou venue de comptes annuels vérifiés, n'a
  // AUCUNE provenance d'import comptable. Un FEC portant la même clôture doit donc être
  // refusé — et laisser l'existant intact.
  const manualBusinessId = randomUUID();
  await client.query(
    `insert into public.businesses
       (id, user_id, name, status, business_type, functional_currency, data_kind, confidence)
     values ($1, $2, 'Smoke societe saisie', 'ACTIVE', 'SME', 'EUR', 'ACTUAL', 'HIGH')`,
    [manualBusinessId, userId],
  );
  const manualFinancialsId = await client.query<{ value: string }>(
    "select public.lfo_record_business_financials($1::uuid, $2::jsonb) as value",
    [
      userId,
      JSON.stringify({
        business_id: manualBusinessId,
        period_end: "2025-12-31",
        period_start: "2025-01-01",
        revenue: 999_999,
        ebitda: 111_111,
        currency: "EUR",
        data_kind: "ACTUAL",
        confidence: "HIGH",
        source: "Comptes annuels verifies",
      }),
    ],
  );
  const manualId = manualFinancialsId.rows[0].value;

  businessId = manualBusinessId;
  const conflictSession = await rpc(
    "lfo_open_fec_session",
    openPayload({ file_hash: "4".repeat(64) }),
  );
  await rpc("lfo_append_fec_lines", {
    session_id: conflictSession,
    rows: [
      received({
        row: 1,
        journal: "OD",
        entry: "1",
        account: "411000",
        debit: "100",
        group: "TRADE_RECEIVABLES",
      }),
      received({
        row: 2,
        journal: "OD",
        entry: "1",
        account: "701000",
        credit: "100",
        group: "REVENUE",
      }),
    ],
  });
  await rpc("lfo_finalize_fec_session", { session_id: conflictSession, issues: [] });
  await rejects(
    "select public.lfo_commit_fec_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ session_id: conflictSession, financials: FINANCIALS })],
    "Un import FEC a écrasé une période financière venue d'une autre source",
    "BUSINESS_FINANCIALS_SOURCE_CONFLICT",
  );

  // Le refus ne doit RIEN altérer : ni la valeur existante, ni sa source, ni la provenance.
  const untouched = await client.query<{
    revenue: string;
    source: string;
    links: string;
    count: string;
  }>(
    `select
       (select revenue::text from public.business_financials where id = $1) as revenue,
       (select source from public.business_financials where id = $1) as source,
       (select count(*)::text from public.import_record_links where business_financials_id = $1) as links,
       (select count(*)::text from public.business_financials where business_id = $2) as count`,
    [manualId, manualBusinessId],
  );
  assert(
    Number(untouched.rows[0].revenue) === 999_999,
    "Le refus de conflit a modifié la valeur existante",
  );
  assert(
    untouched.rows[0].source === "Comptes annuels verifies",
    "Le refus de conflit a modifié la source existante",
  );
  assert(
    untouched.rows[0].links === "0",
    "Le refus de conflit a laissé une provenance derrière lui",
  );
  assert(
    untouched.rows[0].count === "1",
    "Le refus de conflit a créé une seconde période financière",
  );

  // Une période DÉJÀ issue d'un import comptable reste corrigeable : même source, la
  // nouvelle lecture remplace l'ancienne.
  await client.query(
    `insert into public.import_record_links
       (user_id, session_id, normalized_record_id, target_domain, transaction_id, business_financials_id)
     values ($1, $2, null, 'BUSINESS_ACCOUNTING', null, $3)`,
    [userId, conflictSession, manualId],
  );
  await rpc("lfo_commit_fec_session", { session_id: conflictSession, financials: FINANCIALS });
  const corrected = await client.query<{ revenue: string; count: string }>(
    `select
       (select revenue::text from public.business_financials where id = $1) as revenue,
       (select count(*)::text from public.business_financials where business_id = $2) as count`,
    [manualId, manualBusinessId],
  );
  assert(
    Number(corrected.rows[0].revenue) === 1200,
    "Une correction FEC → FEC doit mettre à jour le même instantané",
  );
  assert(
    corrected.rows[0].count === "1",
    "Une correction FEC → FEC ne doit pas créer un second instantané",
  );

  businessId = originalBusinessId;

  // ── 5 septies. NETTOYAGE : ni mensonge, ni annulation ────────────────────────────
  //
  //     ÉCHEC DE NETTOYAGE  ≠  ÉCHEC DE VALIDATION
  //     ÉCHEC DE NETTOYAGE  ≠  SUCCÈS SILENCIEUX
  //
  // Une suppression réussie efface la référence. Une suppression ÉCHOUÉE la conserve : c'est
  // la seule trace permettant un balayage ultérieur, et un FEC est une donnée sensible.
  const cleanupSession = await rpc(
    "lfo_open_fec_session",
    openPayload({ file_hash: "5".repeat(64), staging_storage_path: `${userId}/import-staging/x` }),
  );
  const stagedPath = await client.query<{ path: string | null }>(
    "select staging_storage_path as path from public.import_sessions where id = $1",
    [cleanupSession],
  );
  assert(
    stagedPath.rows[0].path === `${userId}/import-staging/x`,
    "Le chemin de staging doit être mémorisé sur la session",
  );

  // Échec de suppression : le chemin RESTE, et l'échec est daté.
  await client.query("select public.lfo_record_import_staging_cleanup($1::uuid, $2::uuid, false)", [
    userId,
    cleanupSession,
  ]);
  const failed = await client.query<{ path: string | null; failed: string | null }>(
    "select staging_storage_path as path, staging_cleanup_failed_at::text as failed from public.import_sessions where id = $1",
    [cleanupSession],
  );
  assert(
    failed.rows[0].path === `${userId}/import-staging/x`,
    "Un échec de nettoyage ne doit PAS effacer la référence : elle est le seul moyen de retrouver l'objet",
  );
  assert(
    failed.rows[0].failed !== null,
    "Un échec de nettoyage doit être daté, donc observable et requêtable",
  );

  // Succès : la référence disparaît, l'échec est oublié.
  await client.query("select public.lfo_record_import_staging_cleanup($1::uuid, $2::uuid, true)", [
    userId,
    cleanupSession,
  ]);
  const cleared = await client.query<{ path: string | null; failed: string | null }>(
    "select staging_storage_path as path, staging_cleanup_failed_at::text as failed from public.import_sessions where id = $1",
    [cleanupSession],
  );
  assert(
    cleared.rows[0].path === null && cleared.rows[0].failed === null,
    "Une suppression réussie doit effacer la référence et l'échec",
  );
  await client.query("select public.lfo_discard_import_session($1::uuid, $2::uuid)", [
    userId,
    cleanupSession,
  ]);

  // Un échec de nettoyage sur la session VALIDÉE n'annule rien du fait écrit.
  await client.query("select public.lfo_record_import_staging_cleanup($1::uuid, $2::uuid, false)", [
    userId,
    sessionId,
  ]);
  const stillCommitted = await client.query<{ status: string; financials: string }>(
    `select
       (select status from public.import_sessions where id = $1) as status,
       (select count(*)::text from public.import_record_links where session_id = $1) as financials`,
    [sessionId],
  );
  assert(
    stillCommitted.rows[0].status === "COMMITTED" && stillCommitted.rows[0].financials === "1",
    "Un échec de nettoyage de staging ne doit jamais annuler un fait financier écrit",
  );

  // ── 6. Piste d'audit : lecture seule pour authenticated ──────────────────────────
  await client.query("reset role");
  await client.query("set local role authenticated");
  await rejects(
    "delete from public.fec_entry_lines where session_id = $1",
    [sessionId],
    "La piste d'audit public.fec_entry_lines est inscriptible par authenticated",
    "permission denied",
  );
  await rejects(
    `insert into public.fec_entry_lines
       (user_id, session_id, raw_record_id, business_id, journal_code, entry_num,
        account_num, pcg_group, status, debit)
     values ($1, $2, $3, $4, 'OD', '1', '411000', 'TRADE_RECEIVABLES', 'READY', 1)`,
    [userId, sessionId, probeRawId, businessId],
    "authenticated a pu insérer dans la piste d'audit comptable",
    "permission denied",
  );
  await client.query("reset role");
  await client.query("set local role service_role");

  // ── 7. Idempotence ──────────────────────────────────────────────────────────────
  const again = await rpc("lfo_commit_fec_session", {
    session_id: sessionId,
    financials: FINANCIALS,
  });
  assert(again === sessionId, "Un second commit doit retourner la même session");
  const afterSecond = await client.query<{ links: string; financials: string }>(
    `select
       (select count(*)::text from public.import_record_links where session_id = $1) as links,
       (select count(*)::text from public.business_financials where business_id = $2) as financials`,
    [sessionId, businessId],
  );
  assert(
    afterSecond.rows[0].links === "1" && afterSecond.rows[0].financials === "1",
    "Un second commit a réécrit des faits",
  );

  await rejects(
    "select public.lfo_open_fec_session($1::uuid, $2::jsonb)",
    [userId, JSON.stringify(openPayload())],
    "Un fichier déjà validé a pu être réimporté",
    "déjà été importé",
  );

  // Un TROISIÈME appel, après une panne simulée côté appelant, ne doit pas davantage
  // créer un second instantané : c'est exactement le cas d'un retry après un échec de
  // conservation documentaire, où le fait est déjà écrit.
  await rpc("lfo_commit_fec_session", { session_id: sessionId, financials: FINANCIALS });
  const afterRetry = await client.query<{ financials: string; links: string }>(
    `select
       (select count(*)::text from public.business_financials where business_id = $2) as financials,
       (select count(*)::text from public.import_record_links where session_id = $1) as links`,
    [sessionId, businessId],
  );
  assert(
    afterRetry.rows[0].financials === "1" && afterRetry.rows[0].links === "1",
    "Un retry après validation a créé un second instantané financier",
  );

  // ── 8. Une réception inachevée est remplaçable, puis abandonnable ────────────────
  const pending = await rpc("lfo_open_fec_session", openPayload({ file_hash: FILE_HASH_B }));
  await rpc("lfo_append_fec_lines", { session_id: pending, rows: BALANCED_LINES.slice(0, 2) });
  const replaced = await rpc("lfo_open_fec_session", openPayload({ file_hash: FILE_HASH_B }));
  assert(replaced !== pending, "Une réanalyse doit produire une nouvelle session");
  const gone = await client.query<{ count: string }>(
    "select count(*)::text as count from public.import_sessions where id = $1",
    [pending],
  );
  assert(gone.rows[0].count === "0", "L'analyse antérieure du même contenu n'a pas été remplacée");

  await rpc("lfo_append_fec_lines", { session_id: replaced, rows: BALANCED_LINES.slice(0, 2) });
  await client.query("select public.lfo_discard_import_session($1::uuid, $2::uuid)", [
    userId,
    replaced,
  ]);
  const discarded = await client.query<{ status: string; lines: string; raw: string }>(
    `select
       (select status from public.import_sessions where id = $1) as status,
       (select count(*)::text from public.fec_entry_lines where session_id = $1) as lines,
       (select count(*)::text from public.import_raw_records where session_id = $1) as raw`,
    [replaced],
  );
  assert(discarded.rows[0].status === "DISCARDED", "L'abandon n'a pas eu lieu");
  assert(
    discarded.rows[0].lines === "0" && discarded.rows[0].raw === "0",
    "L'abandon doit libérer le staging d'une session qui n'a produit aucun fait",
  );

  // ── 9. Formes de source refusées, et cloisonnement ───────────────────────────────
  await rejects(
    `insert into public.import_sources
       (user_id, kind, domain, provider, label, target_business_id, adapter_version)
     values ($1, 'FILE_CSV', 'CASH_FLOW_TRANSACTION', 'FEC_FR', 'Mauvais domaine', $2, 'fec/1')`,
    [userId, businessId],
    "Une source Cash Flow a pu viser une société",
    // Nom mis à jour par la migration `portfolio_import_acquisition`, qui a ÉTENDU la
    // forme par domaine aux deux domaines de portefeuille. Les règles comptables et
    // bancaires y sont reprises à l'identique : l'invariant testé ici est intact.
    "import_sources_domain_shape_v3_ck",
  );
  await rejects(
    `insert into public.import_sources
       (user_id, kind, domain, provider, label, adapter_version)
     values ($1, 'FILE_CSV', 'BUSINESS_ACCOUNTING', 'FEC_FR', 'Sans cible', 'fec/1')`,
    [userId],
    "Une source comptable a pu être créée sans société",
    // Nom mis à jour par la migration `portfolio_import_acquisition`, qui a ÉTENDU la
    // forme par domaine aux deux domaines de portefeuille. Les règles comptables et
    // bancaires y sont reprises à l'identique : l'invariant testé ici est intact.
    "import_sources_domain_shape_v3_ck",
  );

  await rejects(
    "select public.lfo_append_fec_lines($1::uuid, $2::jsonb)",
    [foreignUser, JSON.stringify({ session_id: sessionId, rows: BALANCED_LINES.slice(0, 1) })],
    "Une session d'un autre propriétaire a été alimentée",
    "introuvable",
  );
  await rejects(
    "select public.lfo_open_fec_session($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        ...openPayload({ file_hash: "e".repeat(64) }),
        source: {
          kind: "FILE_CSV",
          provider: "FEC_FR",
          label: "Voisine",
          target_business_id: foreignBusinessId,
          adapter_version: "fec/1",
        },
      }),
    ],
    "Une société d'un autre propriétaire a pu être visée",
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
      "Smoke FEC Corporate Acquisition : réception fragmentée atomique, brut rattaché ligne à ligne, ABSENT ≠ ZÉRO, devise sans code refusée, validation refusée sans couverture déclarée / sur écriture déséquilibrée / sur ligne illisible, fait Business et provenance écrits en une transaction, aucune valorisation produite, écritures gelées, piste d'audit en lecture seule sous authenticated, instantané non supprimable sans sa provenance, idempotence applicative et de base, staging distinct du coffre et sans policy, buckets dimensionnés, ajout MIME additif, billet d'upload à chemin serveur, usage unique, expirant et cloisonné, nettoyage traçable en succès comme en échec, réception remplaçable et abandonnable, conflit de sources refusé sans rien altérer, correction FEC → FEC autorisée, montants signés persistés tels quels, déséquilibre recalculé malgré un décompte forgé, écriture hors exercice refusée, couverture sans bornes refusée, retry sans second instantané, formes de source refusées, cloisonnement. Aucune donnée persistée.",
    );
  }
}
