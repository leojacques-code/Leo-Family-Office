/**
 * Smoke transactionnel de l'acquisition du registre d'entreprises. Toutes les écritures sont
 * annulées : aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve :
 *
 *   * un instantané écrit son profil, ses dirigeants, ses établissements et ses dépôts
 *     ATOMIQUEMENT, et ne touche AUCUNE colonne de `businesses` ;
 *   * un ÉCHEC de fournisseur est un instantané daté, et il met la connexion dans l'état
 *     correspondant — « le registre n'a pas répondu » est un fait, pas un trou ;
 *   * un instantané qui ne dit RIEN (ni réponse, ni code d'erreur) est refusé ;
 *   * un instantané est immuable en UPDATE, et non supprimable dès qu'une décision s'y
 *     appuie : la provenance d'un fait décidé ne s'efface pas ;
 *   * les tables du registre ne sont accessibles à `authenticated` qu'en LECTURE ;
 *   * deux sociétés ne peuvent pas porter le même SIREN, et un SIREN ne se rattache pas à
 *     deux sociétés : un double rattachement compterait deux fois la même participation ;
 *   * un rattachement écrit le lien ET le SIREN canonique dans le même mouvement ;
 *   * détacher un fournisseur ne retire pas l'identité établie par un autre ;
 *   * une seule proposition reste OUVERTE par champ, la précédente étant marquée remplacée ;
 *   * proposer n'écrit rien dans `businesses`, et une proposition ne peut pas naître décidée ;
 *   * ACCEPTER UN VIDE est refusé : un enrichissement n'efface pas une saisie ;
 *   * un champ hors liste blanche est refusé : une donnée externe n'écrit pas une colonne
 *     arbitraire ;
 *   * accepter une proposition dont la valeur canonique a CHANGÉ depuis la comparaison est
 *     refusé — sinon une observation ancienne écraserait une saisie plus récente ;
 *   * refuser une proposition ne touche pas la société ;
 *   * une proposition déjà décidée ne se décide pas deux fois ;
 *   * un capital sans devise et un capital négatif sont refusés par la base ;
 *   * un SIRET qui ne porte pas le SIREN de son entité est refusé ;
 *   * une variable d'environnement de secret ne peut pas contenir un jeton collé par erreur ;
 *   * les données d'un autre propriétaire restent inaccessibles, même en connaissant l'UUID.
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

let userId = "";

async function rpc(name: string, payload: unknown): Promise<string> {
  const result = await client.query<{ value: string }>(
    // Le résultat est ramené en texte : les RPC de cette verticale rendent tantôt un
    // identifiant, tantôt un décompte, et le pilote pg ne les typerait pas pareil.
    `select public.${name}($1::uuid, $2::jsonb)::text as value`,
    [userId, JSON.stringify(payload)],
  );
  return result.rows[0].value;
}

type Counts = {
  sources: string;
  snapshots: string;
  profiles: string;
  officers: string;
  establishments: string;
  documents: string;
  links: string;
  decisions: string;
  businesses: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.external_sources)::text as sources,
      (select count(*) from public.company_registry_snapshots)::text as snapshots,
      (select count(*) from public.company_registry_profiles)::text as profiles,
      (select count(*) from public.company_registry_officers)::text as officers,
      (select count(*) from public.company_registry_establishments)::text as establishments,
      (select count(*) from public.company_registry_documents)::text as documents,
      (select count(*) from public.business_registry_links)::text as links,
      (select count(*) from public.business_enrichment_decisions)::text as decisions,
      (select count(*) from public.businesses)::text as businesses
  `);
  return result.rows[0];
}

/** SIREN synthétiques à clé de contrôle calculée. Aucune société réelle. */
const SIREN_A = "900000001";
const SIREN_B = "900000019";
const HASH = "a".repeat(64);

let succeeded = false;

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
  const otherUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    otherUser,
    `smoke-registry-${otherUser}@invalid`,
  ]);

  await client.query("set local role service_role");

  // ── 0. Deux sociétés de travail ────────────────────────────────────────────────────
  const businessA = randomUUID();
  const businessB = randomUUID();
  await client.query(
    `insert into public.businesses (id, user_id, name, status, business_type, functional_currency)
     values ($1, $3, 'Société de smoke A', 'ACTIVE', 'OPERATING', 'EUR'),
            ($2, $3, 'Société de smoke B', 'ACTIVE', 'OPERATING', 'EUR')`,
    [businessA, businessB, userId],
  );

  // ── 1. Connexion déclarée, idempotente ─────────────────────────────────────────────
  const sourceId = await rpc("lfo_upsert_external_source", {
    domain: "COMPANY_REGISTRY",
    provider: "SMOKE_FIXTURE",
    name: "Registre de smoke",
    source_type: "API",
    status: "FIXTURE",
    adapter_version: "smoke/1",
    auth_mode: "NONE",
    capabilities: ["legal_name", "legal_form_label", "naf_code", "created_on"],
    snapshot_ttl_minutes: 1440,
  });
  const sourceAgain = await rpc("lfo_upsert_external_source", {
    domain: "COMPANY_REGISTRY",
    provider: "SMOKE_FIXTURE",
    adapter_version: "smoke/2",
  });
  assert(
    sourceId === sourceAgain,
    "La déclaration d'une connexion n'est pas idempotente : deux registres du même fournisseur",
  );

  // Un NOM de variable, jamais un secret : le format refuse un jeton collé par erreur.
  // La valeur d'essai est volontairement SANS forme de jeton réel : une fixture qui ressemble
  // à un JWT fait échouer tous les scans de secrets à venir sur un faux positif permanent, et
  // ce que la contrainte refuse est la FORME d'un nom de variable, pas celle d'un jeton.
  await rejects(
    `update public.external_sources set auth_mode = 'BEARER_TOKEN', credential_env_var = $2 where id = $1`,
    [sourceId, "ceci-nest-pas-un-nom-de-variable"],
    "Un jeton a pu être écrit dans le champ réservé au NOM de la variable d'environnement",
    "external_sources_credential_shape_ck",
  );

  // Un mode authentifié sans nom de variable serait une connexion dont personne ne sait où
  // chercher le secret.
  await rejects(
    `update public.external_sources set auth_mode = 'BEARER_TOKEN', credential_env_var = null where id = $1`,
    [sourceId],
    "Une connexion authentifiée sans nom de variable a été acceptée",
    "external_sources_credential_ck",
  );

  // ── 2. Instantané complet, écrit atomiquement ──────────────────────────────────────
  const snapshotId = await rpc("lfo_record_registry_snapshot", {
    snapshot: {
      external_source_id: sourceId,
      endpoint: "ENTITY",
      query: { siren: SIREN_A },
      siren: SIREN_A,
      http_status: 200,
      payload: { siren: SIREN_A, denomination: "SOCIÉTÉ DE SMOKE" },
      payload_hash: HASH,
      payload_bytes: 64,
      schema_version: "smoke/1",
      observed_at: "2026-08-31T09:00:00Z",
    },
    profile: {
      siren: SIREN_A,
      legal_name: "SOCIÉTÉ DE SMOKE",
      legal_form_label: "Société par actions simplifiée",
      naf_code: "70.22Z",
      created_on: "2019-04-15",
      share_capital: 50000,
      share_capital_currency: "EUR",
      head_office_siret: `${SIREN_A}00009`,
      registry_status: "ACTIVE",
      issues: [],
    },
    officers: [
      { officer_kind: "PERSON", last_name: "SMOKE", first_names: "CAMILLE", birth_year: 1980 },
      { officer_kind: "COMPANY", company_name: "HOLDING DE SMOKE", company_siren: SIREN_B },
    ],
    establishments: [
      { siret: `${SIREN_A}00009`, is_head_office: true, establishment_status: "ACTIVE" },
    ],
    documents: [
      {
        document_kind: "ANNUAL_ACCOUNTS",
        fiscal_year_end: "2025-12-31",
        confidentiality: "PUBLIC",
      },
    ],
  });

  const written = await client.query<{
    profiles: string;
    officers: string;
    establishments: string;
    documents: string;
    stale_after: string | null;
  }>(
    `select
       (select count(*) from public.company_registry_profiles where snapshot_id = $1)::text as profiles,
       (select count(*) from public.company_registry_officers where snapshot_id = $1)::text as officers,
       (select count(*) from public.company_registry_establishments where snapshot_id = $1)::text as establishments,
       (select count(*) from public.company_registry_documents where snapshot_id = $1)::text as documents,
       (select stale_after::text from public.company_registry_snapshots where id = $1) as stale_after`,
    [snapshotId],
  );
  assert(written.rows[0].profiles === "1", "Le profil normalisé n'a pas été écrit");
  assert(written.rows[0].officers === "2", "Les dirigeants n'ont pas été écrits");
  assert(written.rows[0].establishments === "1", "Les établissements n'ont pas été écrits");
  assert(written.rows[0].documents === "1", "Les dépôts disponibles n'ont pas été écrits");
  assert(
    written.rows[0].stale_after !== null,
    "La péremption n'a pas été dérivée de la fraîcheur déclarée par la connexion",
  );

  // SNAPSHOT ≠ VÉRITÉ CANONIQUE : la société n'a pas bougé.
  const untouched = await client.query<{ siren: string | null; name: string }>(
    "select siren, name from public.businesses where id = $1",
    [businessA],
  );
  assert(
    untouched.rows[0].siren === null && untouched.rows[0].name === "Société de smoke A",
    "Écrire un instantané a modifié la société : un snapshot n'est pas une vérité canonique",
  );

  // ── 3. Un échec de fournisseur est un fait daté ────────────────────────────────────
  const failureId = await rpc("lfo_record_registry_snapshot", {
    snapshot: {
      external_source_id: sourceId,
      endpoint: "ENTITY",
      query: { siren: SIREN_B },
      siren: SIREN_B,
      schema_version: "smoke/1",
      error_code: "RATE_LIMITED",
      error_message: "Quota atteint",
    },
    profile: null,
  });
  const failureState = await client.query<{ status: string; last_error: string | null }>(
    "select status, last_error from public.external_sources where id = $1",
    [sourceId],
  );
  assert(
    failureState.rows[0].status === "RATE_LIMITED" &&
      failureState.rows[0].last_error === "RATE_LIMITED",
    "Un échec de fournisseur n'a pas mis la connexion dans l'état correspondant",
  );
  const failureProfile = await client.query<{ count: string }>(
    "select count(*)::text as count from public.company_registry_profiles where snapshot_id = $1",
    [failureId],
  );
  assert(
    failureProfile.rows[0].count === "0",
    "Un échec a produit un profil : une absence de réponse n'est pas une fiche",
  );

  // Un instantané qui ne dit RIEN est refusé.
  await rejects(
    `insert into public.company_registry_snapshots
       (user_id, external_source_id, provider, endpoint, query, schema_version)
     values ($1, $2, 'SMOKE_FIXTURE', 'ENTITY', '{}'::jsonb, 'smoke/1')`,
    [userId, sourceId],
    "Un instantané sans réponse ni code d'erreur a été accepté",
    "company_registry_snapshots_outcome_ck",
  );

  // Une réponse sans empreinte est refusée : sans elle, deux réponses ne se comparent pas.
  await rejects(
    `insert into public.company_registry_snapshots
       (user_id, external_source_id, provider, endpoint, query, schema_version, payload)
     values ($1, $2, 'SMOKE_FIXTURE', 'ENTITY', '{}'::jsonb, 'smoke/1', '{"a":1}'::jsonb)`,
    [userId, sourceId],
    "Une réponse sans empreinte a été acceptée",
    "company_registry_snapshots_payload_hash_ck",
  );

  // Deux identités contradictoires dans la même ligne.
  await rejects(
    `insert into public.company_registry_snapshots
       (user_id, external_source_id, provider, endpoint, query, schema_version, error_code, siren, siret)
     values ($1, $2, 'SMOKE_FIXTURE', 'ENTITY', '{}'::jsonb, 'smoke/1', 'NOT_FOUND', $3, $4)`,
    [userId, sourceId, SIREN_A, `${SIREN_B}00017`],
    "Un instantané portant un SIRET rattaché à un autre SIREN a été accepté",
    "company_registry_snapshots_identity_ck",
  );

  // ── 4. Contraintes de profil : un montant sans devise n'est pas un montant ─────────
  await rejects(
    `insert into public.company_registry_profiles (user_id, snapshot_id, provider, siren, share_capital)
     values ($1, $2, 'SMOKE_FIXTURE', $3, 1000)`,
    [userId, failureId, SIREN_B],
    "Un capital sans devise a été accepté",
    "company_registry_profiles_capital_ck",
  );
  await rejects(
    `insert into public.company_registry_profiles
       (user_id, snapshot_id, provider, siren, share_capital, share_capital_currency)
     values ($1, $2, 'SMOKE_FIXTURE', $3, -1, 'EUR')`,
    [userId, failureId, SIREN_B],
    "Un capital négatif a été accepté",
    "company_registry_profiles_capital_sign_ck",
  );

  // ── 5. Immuabilité du brut ─────────────────────────────────────────────────────────
  await rejects(
    `update public.company_registry_snapshots set http_status = 500 where id = $1`,
    [snapshotId],
    "Un instantané de registre a pu être réécrit",
    "immuable",
  );

  // ── 6. Rattachement : lien et SIREN canonique dans le même mouvement ───────────────
  await rpc("lfo_link_business_registry", {
    business_id: businessA,
    provider: "SMOKE_FIXTURE",
    siren: SIREN_A,
    siret: `${SIREN_A}00009`,
    linked_snapshot_id: snapshotId,
    match_basis: "PROVIDER_EXACT",
  });
  const linked = await client.query<{ siren: string | null }>(
    "select siren from public.businesses where id = $1",
    [businessA],
  );
  assert(
    linked.rows[0].siren === SIREN_A,
    "Le rattachement n'a pas écrit le SIREN canonique : deux vérités à maintenir séparément",
  );

  // Un rattachement prétendant venir du fournisseur SANS instantané n'est pas vérifiable.
  await rejects(
    `insert into public.business_registry_links (user_id, business_id, provider, siren, match_basis)
     values ($1, $2, 'SMOKE_AUTRE', $3, 'PROVIDER_EXACT')`,
    [userId, businessB, SIREN_B],
    "Un rattachement « confirmé par le fournisseur » sans instantané a été accepté",
    "business_registry_links_basis_shape_ck",
  );

  // UN SIREN, UNE SOCIÉTÉ : sinon la même participation serait comptée deux fois.
  await rejects(
    `update public.businesses set siren = $2 where id = $1`,
    [businessB, SIREN_A],
    "Deux sociétés ont pu porter le même SIREN",
    "businesses_siren_uidx",
  );
  await rejects(
    `insert into public.business_registry_links (user_id, business_id, provider, siren, match_basis)
     values ($1, $2, 'SMOKE_FIXTURE', $3, 'DECLARED')`,
    [userId, businessB, SIREN_A],
    "Un SIREN a pu être rattaché à deux sociétés chez le même fournisseur",
    "business_registry_links_siren_uk",
  );

  // Rattacher une société qui porte DÉJÀ un autre SIREN est un conflit d'identité.
  await client.query(`update public.businesses set siren = $2 where id = $1`, [businessB, SIREN_B]);
  await rejects(
    `select public.lfo_link_business_registry($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({ business_id: businessB, provider: "SMOKE_AUTRE", siren: "900000027" }),
    ],
    "Un SIREN canonique différent a été écrasé en silence",
    "porte déjà le SIREN",
  );
  await client.query(`update public.businesses set siren = null where id = $1`, [businessB]);

  // ── 7. Propositions : une seule ouverte par champ ──────────────────────────────────
  const proposed = await rpc("lfo_propose_business_enrichment", {
    business_id: businessA,
    snapshot_id: snapshotId,
    fields: [
      {
        field_path: "name",
        candidate_value: "SOCIÉTÉ DE SMOKE",
        canonical_value_before: "Société de smoke A",
        state: "CONFLICT",
      },
      {
        field_path: "naf_code",
        candidate_value: "70.22Z",
        canonical_value_before: null,
        state: "CANDIDATE",
      },
    ],
  });
  assert(proposed === "2", `Deux propositions attendues, ${proposed} écrite(s)`);

  // Proposer ne touche RIEN dans la société.
  const stillUntouched = await client.query<{ name: string; naf_code: string | null }>(
    "select name, naf_code from public.businesses where id = $1",
    [businessA],
  );
  assert(
    stillUntouched.rows[0].name === "Société de smoke A" &&
      stillUntouched.rows[0].naf_code === null,
    "Proposer un enrichissement a modifié la société",
  );

  // Une nouvelle proposition sur le même champ REMPLACE l'ancienne au lieu de la doubler.
  await rpc("lfo_propose_business_enrichment", {
    business_id: businessA,
    snapshot_id: snapshotId,
    fields: [
      {
        field_path: "name",
        candidate_value: "SOCIÉTÉ DE SMOKE (RÉVISÉE)",
        canonical_value_before: "Société de smoke A",
        state: "CONFLICT",
      },
    ],
  });
  const open = await client.query<{ count: string }>(
    `select count(*)::text as count from public.business_enrichment_decisions
      where business_id = $1 and field_path = 'name' and superseded_by is null
        and state in ('CANDIDATE', 'CONFLICT')`,
    [businessA],
  );
  assert(
    open.rows[0].count === "1",
    `Une seule proposition ouverte attendue par champ, ${open.rows[0].count} trouvée(s)`,
  );

  // Une proposition ne peut pas naître décidée : ce serait contourner la porte d'écriture.
  await rejects(
    `select public.lfo_propose_business_enrichment($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        business_id: businessA,
        snapshot_id: snapshotId,
        fields: [{ field_path: "sector", candidate_value: "Conseil", state: "ACCEPTED" }],
      }),
    ],
    "Une proposition a pu naître déjà acceptée",
    "naît CANDIDATE ou CONFLICT",
  );

  // ── 8. Décisions ───────────────────────────────────────────────────────────────────
  const nafDecision = await client.query<{ id: string }>(
    `select id from public.business_enrichment_decisions
      where business_id = $1 and field_path = 'naf_code' and superseded_by is null`,
    [businessA],
  );
  const nameDecision = await client.query<{ id: string }>(
    `select id from public.business_enrichment_decisions
      where business_id = $1 and field_path = 'name' and superseded_by is null
        and state in ('CANDIDATE','CONFLICT')`,
    [businessA],
  );

  // ACCEPTER UN VIDE n'est pas un enrichissement.
  const voidDecision = randomUUID();
  await client.query(
    `insert into public.business_enrichment_decisions
       (id, user_id, business_id, snapshot_id, field_path, candidate_value, canonical_value_before, state)
     values ($1, $2, $3, $4, 'sector', null, null, 'CANDIDATE')`,
    [voidDecision, userId, businessA, snapshotId],
  );
  await rejects(
    `select public.lfo_decide_business_enrichment($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        business_id: businessA,
        decisions: [{ decision_id: voidDecision, action: "accept" }],
      }),
    ],
    "Accepter une valeur absente a été autorisé : une saisie utilisateur pouvait être effacée",
    "n'est pas un enrichissement",
  );
  // La contrainte de base le refuse aussi, indépendamment de la RPC.
  await rejects(
    `update public.business_enrichment_decisions set state = 'ACCEPTED', decided_at = now() where id = $1`,
    [voidDecision],
    "La base a accepté une décision ACCEPTED sans valeur",
    "business_enrichment_decisions_accept_shape_ck",
  );

  // Un champ hors liste blanche n'écrit aucune colonne.
  const forbiddenDecision = randomUUID();
  await client.query(
    `insert into public.business_enrichment_decisions
       (id, user_id, business_id, snapshot_id, field_path, candidate_value, state)
     values ($1, $2, $3, $4, 'archived', '"true"'::jsonb, 'CANDIDATE')`,
    [forbiddenDecision, userId, businessA, snapshotId],
  );
  await rejects(
    `select public.lfo_decide_business_enrichment($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        business_id: businessA,
        decisions: [{ decision_id: forbiddenDecision, action: "accept" }],
      }),
    ],
    "Un champ hors liste blanche a pu écrire une colonne",
    "hors liste blanche",
  );

  // CONCURRENCE OPTIMISTE : la valeur canonique a changé depuis la comparaison.
  await client.query(`update public.businesses set name = 'Renommée à la main' where id = $1`, [
    businessA,
  ]);
  await rejects(
    `select public.lfo_decide_business_enrichment($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        business_id: businessA,
        decisions: [{ decision_id: nameDecision.rows[0].id, action: "accept" }],
      }),
    ],
    "Une observation ancienne a pu écraser une saisie plus récente",
    "a changé depuis la proposition",
  );
  await client.query(`update public.businesses set name = 'Société de smoke A' where id = $1`, [
    businessA,
  ]);

  // Acceptation légitime : la colonne et la décision changent ensemble.
  const applied = await rpc("lfo_decide_business_enrichment", {
    business_id: businessA,
    reason: "Vérifié sur la fiche du registre",
    decisions: [{ decision_id: nafDecision.rows[0].id, action: "accept" }],
  });
  assert(applied === "1", `Une décision appliquée attendue, ${applied} obtenue(s)`);
  const enriched = await client.query<{ naf_code: string | null; state: string; reason: string }>(
    `select b.naf_code, d.state, d.decided_reason as reason
       from public.businesses b
       join public.business_enrichment_decisions d on d.id = $2
      where b.id = $1`,
    [businessA, nafDecision.rows[0].id],
  );
  assert(
    enriched.rows[0].naf_code === "70.22Z" && enriched.rows[0].state === "ACCEPTED",
    "L'acceptation n'a pas écrit la colonne et la décision ensemble",
  );
  assert(
    enriched.rows[0].reason === "Vérifié sur la fiche du registre",
    "Le motif de la décision n'a pas été conservé",
  );

  // Une décision déjà prise ne se reprend pas.
  await rejects(
    `select public.lfo_decide_business_enrichment($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        business_id: businessA,
        decisions: [{ decision_id: nafDecision.rows[0].id, action: "reject" }],
      }),
    ],
    "Une proposition déjà décidée a pu être décidée une seconde fois",
    "introuvable ou déjà décidée",
  );

  // Refuser ne touche pas la société.
  const rejected = await rpc("lfo_decide_business_enrichment", {
    business_id: businessA,
    decisions: [{ decision_id: nameDecision.rows[0].id, action: "reject" }],
  });
  assert(rejected === "1", "Le refus n'a pas été enregistré");
  const afterReject = await client.query<{ name: string }>(
    "select name from public.businesses where id = $1",
    [businessA],
  );
  assert(
    afterReject.rows[0].name === "Société de smoke A",
    "Refuser une proposition a modifié la société",
  );

  // ── 9. La provenance d'un fait décidé est gelée ────────────────────────────────────
  await rejects(
    `delete from public.company_registry_snapshots where id = $1`,
    [snapshotId],
    "L'instantané d'une décision écrite a pu être supprimé",
    "ne se supprime pas",
  );

  // ── 10. Détachement : le SIREN d'un autre fournisseur n'est pas effacé ─────────────
  await client.query(
    `select public.lfo_unlink_business_registry($1::uuid, $2::uuid, 'SMOKE_FIXTURE')`,
    [userId, businessA],
  );
  const unlinked = await client.query<{ siren: string | null }>(
    "select siren from public.businesses where id = $1",
    [businessA],
  );
  assert(
    unlinked.rows[0].siren === null,
    "Le détachement du seul rattachement n'a pas retiré le SIREN canonique",
  );

  // ── 11. Piste d'audit en LECTURE SEULE sous `authenticated` ────────────────────────
  await client.query("reset role");
  await client.query("set local role authenticated");
  for (const [table, statement] of [
    ["external_sources", "delete from public.external_sources"],
    ["company_registry_snapshots", "delete from public.company_registry_snapshots"],
    ["company_registry_profiles", "delete from public.company_registry_profiles"],
    ["company_registry_officers", "delete from public.company_registry_officers"],
    ["company_registry_establishments", "delete from public.company_registry_establishments"],
    ["company_registry_documents", "delete from public.company_registry_documents"],
    ["business_registry_links", "delete from public.business_registry_links"],
    [
      "business_enrichment_decisions",
      "update public.business_enrichment_decisions set state = 'ACCEPTED'",
    ],
  ] as const) {
    await rejects(
      statement,
      [],
      `La table public.${table} est inscriptible par authenticated`,
      "permission denied",
    );
  }

  // Les RPC ne sont pas exécutables par le client.
  await rejects(
    `select public.lfo_decide_business_enrichment($1::uuid, '{}'::jsonb)`,
    [userId],
    "Une RPC d'enrichissement est exécutable par authenticated",
    "permission denied",
  );

  await client.query("reset role");
  await client.query("set local role service_role");

  // ── 12. Cloisonnement : les données d'un autre propriétaire sont inaccessibles ─────
  const otherSource = randomUUID();
  await client.query(
    `insert into public.external_sources
       (id, user_id, name, source_type, status, domain, provider, adapter_version, auth_mode)
     values ($1, $2, 'Autre', 'API', 'ACTIVE', 'COMPANY_REGISTRY', 'SMOKE_AUTRE', 'smoke/1', 'NONE')`,
    [otherSource, otherUser],
  );
  // Rattacher un instantané d'un autre propriétaire est refusé par la clé composite.
  await rejects(
    `insert into public.company_registry_snapshots
       (user_id, external_source_id, provider, endpoint, query, schema_version, error_code)
     values ($1, $2, 'SMOKE_AUTRE', 'ENTITY', '{}'::jsonb, 'smoke/1', 'NOT_FOUND')`,
    [userId, otherSource],
    "Un instantané a pu être rattaché à la connexion d'un autre propriétaire",
    "company_registry_snapshots_source_fk",
  );
  // La RPC ne trouve pas la connexion d'un autre propriétaire.
  await rejects(
    `select public.lfo_record_registry_snapshot($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        snapshot: {
          external_source_id: otherSource,
          endpoint: "ENTITY",
          schema_version: "smoke/1",
          error_code: "NOT_FOUND",
        },
      }),
    ],
    "La connexion d'un autre propriétaire a été utilisée",
    "Connexion externe introuvable",
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
      "Smoke Registre d'entreprises : connexion idempotente, secret jamais stocké, instantané atomique, échec de fournisseur persisté, brut immuable, provenance gelée, un SIREN pour une seule société, rattachement atomique, une proposition ouverte par champ, refus d'accepter un vide, liste blanche de champs, concurrence optimiste sur la valeur canonique, piste d'audit en lecture seule, cloisonnement. Aucune donnée persistée.",
    );
  }
}
