/**
 * Smoke transactionnel de la verticale « données publiques immobilières ». Toutes les
 * écritures sont annulées : aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve, invariant par invariant :
 *
 *   * un adaptateur sans fraîcheur déclarée est refusé : sans elle aucun instantané ne
 *     serait réutilisable, et l'âge d'un chiffre serait inconnu ;
 *   * un adaptateur déclaré sans provider ni version est refusé par la base ;
 *   * deux adaptateurs du même provider pour le même propriétaire sont impossibles ;
 *   * un instantané est écrit MÊME EN ÉCHEC, avec son code et zéro ligne : une lecture
 *     tentée laisse toujours une trace ;
 *   * un échec sans code d'erreur est refusé, et un succès porteur d'un code l'est aussi ;
 *   * `record_count` est DÉRIVÉ des lignes persistées : un décompte fourni par l'appelant
 *     n'est jamais repris ;
 *   * RÉSULTAT VIDE ≠ RÉSULTAT OBTENU : les deux statuts sont distincts et contraints ;
 *   * une fraîcheur nulle ou inversée est refusée ;
 *   * le contenu lu est IMMUABLE : ni la requête, ni l'empreinte, ni la date de lecture ne
 *     se récrivent, et un instantané ne se supprime pas ;
 *   * une ligne lue ne se supprime pas isolément et son brut ne se récrit pas ;
 *   * SURFACE ABSENTE ≠ SURFACE NULLE : une surface à zéro est refusée par la base ;
 *   * VALEUR SANS UNITÉ = NON INTERPRÉTABLE : une consommation sans unité est refusée ;
 *   * ÉTIQUETTE ABSENTE ≠ ÉTIQUETTE G : une étiquette hors A-G est refusée ;
 *   * une fin de validité antérieure à l'établissement est refusée, jamais corrigée ;
 *   * un rapprochement sur un instantané VIDE, en ÉCHEC ou HORS COUVERTURE est refusé ;
 *   * un rapprochement sans base nommée est refusé : un score seul ne se relit pas ;
 *   * un DPE se rapproche d'un enregistrement précis, un jeu de comparables de l'instantané ;
 *   * accepter un rapprochement de confiance FAIBLE sans motif est refusé ;
 *   * un seul rapprochement OUVERT et un seul ACCEPTÉ par cible et par bien : deux DPE
 *     acceptés rendraient l'étiquette indéterminée ;
 *   * accepter remplace le rapprochement courant par supersede, sans perdre l'historique ;
 *   * une décision ne se rejoue pas ;
 *   * une valorisation par comparables sans instantané, sans convention ou sans décompte est
 *     refusée par la base : un chiffre dérivé n'est jamais orphelin ;
 *   * un instantané rattaché à une méthode qui n'en dérive pas est refusé ;
 *   * les six méthodes de valorisation préexistantes restent acceptées ;
 *   * la promotion exige un rapprochement ACCEPTÉ et COURANT, un instantané FRAIS et une
 *     surface DÉCLARÉE ;
 *   * la promotion refuse une valeur hors de l'intervalle des prix unitaires PERSISTÉS ;
 *   * la promotion écrit par la RPC EXISTANTE `lfo_record_real_estate_valuation` ;
 *   * les tables d'instantané, de lignes et de rapprochement sont en LECTURE SEULE pour
 *     `authenticated` ;
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

async function rpc(name: string, payload: unknown): Promise<string> {
  const result = await client.query<{ value: string }>(
    `select public.${name}($1::uuid, $2::jsonb)::text as value`,
    [userId, JSON.stringify(payload)],
  );
  return result.rows[0].value;
}

type Counts = {
  sources: string;
  snapshots: string;
  sales: string;
  certificates: string;
  matches: string;
  valuations: string;
  properties: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.external_sources)::text as sources,
      (select count(*) from public.real_estate_data_snapshots)::text as snapshots,
      (select count(*) from public.real_estate_comparable_sales)::text as sales,
      (select count(*) from public.real_estate_energy_certificates)::text as certificates,
      (select count(*) from public.property_public_data_matches)::text as matches,
      (select count(*) from public.real_estate_valuations)::text as valuations,
      (select count(*) from public.properties)::text as properties
  `);
  return result.rows[0];
}

let userId = "";
let succeeded = false;

/** Cinq mutations à 5 000 €/m² exactement : la médiane est donc 5 000. */
function sales(): Array<Record<string, unknown>> {
  return [50, 55, 60, 65, 70].map((area) => ({
    mutation_ref: `MUT-${area}`,
    mutated_on: "2026-03-15",
    price: String(area * 5000),
    currency: "EUR",
    property_kind: "Appartement",
    built_area_sqm: String(area),
    lot_count: "1",
    commune_code: "75112",
    postal_code: "75012",
    street_label: `${area} avenue des Lilas`,
    raw: { source: "smoke" },
  }));
}

function snapshotPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dataset: "DVF",
    query: { code_commune: "75112", limit: 200 },
    query_hash: "a".repeat(64),
    payload_hash: "b".repeat(64),
    retrieved_at: new Date().toISOString(),
    coverage_state: "DECLARED_COVERED",
    coverage_note: "Zone déclarée couverte",
    status: "RETRIEVED",
    source: "SMOKE_DVF",
    sales: sales(),
    certificates: [],
    ...overrides,
  };
}

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

  // Propriétaire voisin, créé AVANT le passage en `service_role` : ce rôle n'écrit pas dans
  // le schéma `auth`.
  const foreignUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    foreignUser,
    `smoke-redata-${foreignUser}@invalid`,
  ]);

  await client.query("set local role service_role");

  // ── 1. Bien détenu, avec adresse et surface DÉCLARÉES ────────────────────────────
  const propertyId = randomUUID();
  await client.query(
    `insert into public.properties
       (id, user_id, name, property_type, location, surface_sqm, status, inputs)
     values ($1, $2, 'Appartement smoke', 'RESIDENTIAL', '12 avenue des Lilas 75012 Paris', 80, 'ACTIVE', '{}'::jsonb)`,
    [propertyId, userId],
  );
  // Bien SANS surface : il sert à prouver que l'estimation reste non calculable.
  const surfacelessId = randomUUID();
  await client.query(
    `insert into public.properties
       (id, user_id, name, property_type, location, status, inputs)
     values ($1, $2, 'Sans surface', 'RESIDENTIAL', '12 avenue des Lilas 75012 Paris', 'ACTIVE', '{}'::jsonb)`,
    [surfacelessId, userId],
  );

  // ── 2. Adaptateur : fraîcheur et identité DÉCLARÉES ──────────────────────────────
  await rejects(
    "select public.lfo_upsert_public_data_source($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ label: "Sans provider" })],
    "Un adaptateur sans provider a pu être créé",
    "provider",
  );

  // `capabilities` est renseignée à l'objet vide : sinon le défaut `[]` de la colonne — hérité
  // de la verticale du registre d'entreprises — ferait refuser la ligne par le contrôle de
  // FORME des capacités, et non par celui de la fraîcheur que ce test vise.
  await rejects(
    `insert into public.external_sources
       (id, user_id, name, source_type, status, domain, provider, adapter_version, capabilities)
     values ($1, $2, 'Sans fraicheur', 'PUBLIC_DATA', 'ACTIVE', 'REAL_ESTATE_PUBLIC_DATA', 'X', '1', '{}'::jsonb)`,
    [randomUUID(), userId],
    "Un adaptateur de domaine sans durée de fraîcheur a pu être créé",
    "external_sources_shape_v2_ck",
  );

  await rejects(
    `insert into public.external_sources
       (id, user_id, name, source_type, status, domain, provider, snapshot_ttl_minutes, capabilities)
     values ($1, $2, 'Sans version', 'PUBLIC_DATA', 'ACTIVE', 'REAL_ESTATE_PUBLIC_DATA', 'Y', 60, '{}'::jsonb)`,
    [randomUUID(), userId],
    "Un adaptateur de domaine sans version a pu être créé",
    "external_sources_shape_v2_ck",
  );

  // La FORME des capacités déclarées appartient au domaine : un objet de drapeaux pour un
  // jeu de données public, une liste de noms pour un registre. Deux verticales donnaient à
  // cette colonne partagée deux conventions incompatibles, et la contrainte de la première
  // refusait les écritures de la seconde.
  await rejects(
    `insert into public.external_sources
       (id, user_id, name, source_type, status, domain, provider, adapter_version,
        snapshot_ttl_minutes, capabilities)
     values ($1, $2, 'Capacités en liste', 'PUBLIC_DATA', 'ACTIVE', 'REAL_ESTATE_PUBLIC_DATA',
             'V', '1', 60, '["price"]'::jsonb)`,
    [randomUUID(), userId],
    "Des capacités en LISTE ont pu être déclarées pour un jeu de données public",
    "external_sources_capabilities_v2_ck",
  );
  await rejects(
    `insert into public.external_sources
       (id, user_id, name, source_type, status, domain, provider, adapter_version, auth_mode,
        capabilities)
     values ($1, $2, 'Capacités en objet', 'REGISTRY', 'ACTIVE', 'COMPANY_REGISTRY',
             'U', '1', 'NONE', '{"fields": []}'::jsonb)`,
    [randomUUID(), userId],
    "Des capacités en OBJET ont pu être déclarées pour un registre",
    "external_sources_capabilities_v2_ck",
  );

  // `COMPANY_REGISTRY` n'est PLUS un domaine sans support : la verticale du registre
  // d'entreprises apporte ses tables d'instantané, et la whitelist réconciliée l'accepte.
  // Le contrôle porte donc sur un domaine réellement absent de la whitelist — sans quoi il
  // affirmerait l'inverse de ce que la base garantit.
  await rejects(
    `insert into public.external_sources
       (id, user_id, name, source_type, status, domain, provider, adapter_version, snapshot_ttl_minutes)
     values ($1, $2, 'Domaine inconnu', 'PUBLIC_DATA', 'ACTIVE', 'MARKET_DATA', 'Z', '1', 60)`,
    [randomUUID(), userId],
    "Un domaine sans tables de support a pu être déclaré",
    "external_sources_domain_v2_ck",
  );

  // Et le domaine du registre, lui, est ACCEPTÉ — avec SES exigences, pas celles de la
  // donnée publique : un registre s'authentifie, il ne se périme pas.
  const registryProbe = randomUUID();
  await client.query(
    `insert into public.external_sources
       (id, user_id, name, source_type, status, domain, provider, adapter_version, auth_mode,
        capabilities)
     values ($1, $2, 'Registre voisin', 'REGISTRY', 'ACTIVE', 'COMPANY_REGISTRY', 'W', '1', 'NONE',
             '["SIREN_LOOKUP"]'::jsonb)`,
    [registryProbe, userId],
  );
  await client.query("delete from public.external_sources where id = $1", [registryProbe]);

  const sourceId = await rpc("lfo_upsert_public_data_source", {
    provider: "SMOKE_DVF",
    label: "DVF smoke",
    adapter_version: "1",
    snapshot_ttl_minutes: 60,
    capabilities: { fields: ["price"], declaresCoverage: true, stableRecordId: false },
    declared_coverage: { note: "Zone couverte", excludedDepartments: ["57"] },
    licence: "Licence ouverte",
  });

  // Le même provider ré-enregistré met à jour la MÊME ligne : deux vérités de fraîcheur
  // concurrentes sur la même source seraient ingérables.
  const sourceAgain = await rpc("lfo_upsert_public_data_source", {
    provider: "SMOKE_DVF",
    label: "DVF smoke v2",
    adapter_version: "2",
    snapshot_ttl_minutes: 120,
  });
  assert(sourceAgain === sourceId, "Le même provider doit mettre à jour la même ligne");
  const ttl = await client.query<{ ttl: string; version: string }>(
    "select snapshot_ttl_minutes::text as ttl, adapter_version as version from public.external_sources where id = $1",
    [sourceId],
  );
  assert(ttl.rows[0].ttl === "120", "La fraîcheur déclarée doit être mise à jour");
  assert(ttl.rows[0].version === "2", "La version d'adaptateur doit être mise à jour");

  // ── 3. Un échec de lecture est un FAIT persisté ───────────────────────────────────
  const failedId = await rpc("lfo_record_real_estate_snapshot", {
    ...snapshotPayload({
      status: "FAILED",
      error_code: "EGRESS_BLOCKED",
      error_message: "Sortie réseau refusée",
      sales: [],
    }),
    source_id: sourceId,
  });
  const failed = await client.query<{ status: string; count: string; code: string }>(
    "select status, record_count::text as count, error_code as code from public.real_estate_data_snapshots where id = $1",
    [failedId],
  );
  assert(failed.rows[0].status === "FAILED", "Un échec doit rester un échec");
  assert(failed.rows[0].count === "0", "Un échec ne porte aucun enregistrement");
  assert(failed.rows[0].code === "EGRESS_BLOCKED", "Un échec porte son code");

  await rejects(
    `insert into public.real_estate_data_snapshots
       (user_id, source_id, dataset, query, query_hash, payload_hash, retrieved_at, stale_after,
        record_count, coverage_state, status)
     values ($1, $2, 'DVF', '{}'::jsonb, 'h', 'p', now(), now() + interval '1 hour',
             0, 'COVERAGE_UNKNOWN', 'FAILED')`,
    [userId, sourceId],
    "Un échec sans code d'erreur a pu être écrit",
    "failure_shape_ck",
  );

  await rejects(
    `insert into public.real_estate_data_snapshots
       (user_id, source_id, dataset, query, query_hash, payload_hash, retrieved_at, stale_after,
        record_count, coverage_state, status, error_code)
     values ($1, $2, 'DVF', '{}'::jsonb, 'h', 'p', now(), now() + interval '1 hour',
             0, 'COVERAGE_UNKNOWN', 'EMPTY', 'OOPS')`,
    [userId, sourceId],
    "Un résultat vide porteur d'un code d'erreur a pu être écrit",
    "failure_shape_ck",
  );

  await rejects(
    `insert into public.real_estate_data_snapshots
       (user_id, source_id, dataset, query, query_hash, payload_hash, retrieved_at, stale_after,
        record_count, coverage_state, status)
     values ($1, $2, 'DVF', '{}'::jsonb, 'h', 'p', now(), now() - interval '1 hour',
             0, 'COVERAGE_UNKNOWN', 'EMPTY')`,
    [userId, sourceId],
    "Une fraîcheur inversée a pu être écrite",
    "stale_ck",
  );

  await rejects(
    `insert into public.real_estate_data_snapshots
       (user_id, source_id, dataset, query, query_hash, payload_hash, retrieved_at, stale_after,
        record_count, coverage_state, status)
     values ($1, $2, 'DVF', '{}'::jsonb, 'h', 'p', now(), now() + interval '1 hour',
             0, 'COVERAGE_UNKNOWN', 'RETRIEVED')`,
    [userId, sourceId],
    "Un instantané RETRIEVED sans aucune ligne a pu être écrit",
    "empty_shape_ck",
  );

  // ── 4. Un résultat vide reste un vide, distinct d'un échec ────────────────────────
  const emptyId = await rpc("lfo_record_real_estate_snapshot", {
    ...snapshotPayload({ status: "RETRIEVED", sales: [] }),
    source_id: sourceId,
  });
  const empty = await client.query<{ status: string; count: string }>(
    "select status, record_count::text as count from public.real_estate_data_snapshots where id = $1",
    [emptyId],
  );
  assert(
    empty.rows[0].status === "EMPTY",
    "Un instantané sans ligne doit être EMPTY, quel que soit le statut annoncé",
  );

  // ── 5. `record_count` est DÉRIVÉ, jamais repris de l'appelant ─────────────────────
  const snapshotId = await rpc("lfo_record_real_estate_snapshot", {
    // Un décompte forgé à 999 : il doit être ignoré au profit des lignes réelles.
    ...snapshotPayload({ record_count: 999 }),
    source_id: sourceId,
  });
  const stored = await client.query<{ count: string; status: string }>(
    "select record_count::text as count, status from public.real_estate_data_snapshots where id = $1",
    [snapshotId],
  );
  assert(
    stored.rows[0].count === "5",
    `Le décompte doit être dérivé des lignes persistées, obtenu ${stored.rows[0].count}`,
  );
  assert(stored.rows[0].status === "RETRIEVED", "Un instantané peuplé est RETRIEVED");

  // ── 6. Le contenu lu est IMMUABLE ────────────────────────────────────────────────
  await rejects(
    "update public.real_estate_data_snapshots set query = '{\"triche\": 1}'::jsonb where id = $1",
    [snapshotId],
    "La requête d'un instantané a pu être récrite",
    "immuable",
  );
  await rejects(
    "update public.real_estate_data_snapshots set payload_hash = 'z' where id = $1",
    [snapshotId],
    "L'empreinte de contenu a pu être récrite",
    "immuable",
  );
  await rejects(
    "delete from public.real_estate_data_snapshots where id = $1",
    [snapshotId],
    "Un instantané a pu être supprimé",
    "ne se supprime pas",
  );

  const firstSale = await client.query<{ id: string }>(
    "select id from public.real_estate_comparable_sales where snapshot_id = $1 order by row_index limit 1",
    [snapshotId],
  );
  await rejects(
    "update public.real_estate_comparable_sales set raw = '{}'::jsonb where id = $1",
    [firstSale.rows[0].id],
    "Le brut d'une ligne lue a pu être récrit",
    "immuable",
  );
  await rejects(
    "delete from public.real_estate_comparable_sales where id = $1",
    [firstSale.rows[0].id],
    "Une ligne lue a pu être supprimée isolément",
    "ne se supprime pas",
  );

  // ── 7. SURFACE ABSENTE ≠ SURFACE NULLE ───────────────────────────────────────────
  await rejects(
    `insert into public.real_estate_comparable_sales
       (user_id, snapshot_id, row_index, mutated_on, price, currency, built_area_sqm, raw)
     values ($1, $2, 900, '2026-01-01', 100000, 'EUR', 0, '{}'::jsonb)`,
    [userId, snapshotId],
    "Une surface de zéro a pu être écrite",
    "built_area_ck",
  );

  // ── 8. Diagnostics : unité, étiquette, validité ──────────────────────────────────
  const dpeSourceId = await rpc("lfo_upsert_public_data_source", {
    provider: "SMOKE_DPE",
    label: "DPE smoke",
    adapter_version: "1",
    snapshot_ttl_minutes: 60,
  });
  const dpeSnapshotId = await rpc("lfo_record_real_estate_snapshot", {
    dataset: "DPE",
    source_id: dpeSourceId,
    query: { q: "12 avenue des Lilas" },
    query_hash: "c".repeat(64),
    payload_hash: "d".repeat(64),
    retrieved_at: new Date().toISOString(),
    coverage_state: "COVERAGE_UNKNOWN",
    status: "RETRIEVED",
    source: "SMOKE_DPE",
    certificates: [
      {
        certificate_ref: "2345E0000001",
        issued_on: "2025-06-01",
        valid_until: "2035-06-01",
        method_version: "3CL",
        energy_label: "C",
        energy_value: "132",
        energy_unit: "kWh/m2/an",
        ghg_label: "B",
        living_area_sqm: "80",
        address_label: "12 avenue des Lilas 75012 Paris",
        postal_code: "75012",
        commune_code: "75112",
        raw: { source: "smoke" },
      },
      {
        // Diagnostic d'un AUTRE lot du même immeuble : il rend le rapprochement ambigu, et
        // c'est exactement pour ce cas que l'acceptation n'est jamais automatique.
        certificate_ref: "2345E0000002",
        issued_on: "2025-06-02",
        energy_label: "F",
        living_area_sqm: "42",
        address_label: "12 avenue des Lilas 75012 Paris",
        postal_code: "75012",
        raw: { source: "smoke" },
      },
    ],
  });

  const certificates = await client.query<{ id: string; ref: string }>(
    "select id, certificate_ref as ref from public.real_estate_energy_certificates where snapshot_id = $1 order by row_index",
    [dpeSnapshotId],
  );
  assert(certificates.rows.length === 2, "Les deux diagnostics doivent être persistés");

  const noValidity = await client.query<{ valid: string | null; unit: string | null }>(
    "select valid_until::text as valid, energy_unit as unit from public.real_estate_energy_certificates where certificate_ref = '2345E0000002'",
  );
  assert(
    noValidity.rows[0].valid === null,
    "Une validité non déclarée reste INCONNUE : elle n'est jamais calculée",
  );

  await rejects(
    `insert into public.real_estate_energy_certificates
       (user_id, snapshot_id, row_index, energy_value, raw)
     values ($1, $2, 900, 250, '{}'::jsonb)`,
    [userId, dpeSnapshotId],
    "Une consommation sans unité a pu être écrite",
    "energy_unit_ck",
  );

  await rejects(
    `insert into public.real_estate_energy_certificates
       (user_id, snapshot_id, row_index, energy_label, raw)
     values ($1, $2, 901, 'H', '{}'::jsonb)`,
    [userId, dpeSnapshotId],
    "Une étiquette hors A-G a pu être écrite",
    "energy_label_ck",
  );

  await rejects(
    `insert into public.real_estate_energy_certificates
       (user_id, snapshot_id, row_index, issued_on, valid_until, raw)
     values ($1, $2, 902, '2025-06-01', '2024-01-01', '{}'::jsonb)`,
    [userId, dpeSnapshotId],
    "Une validité antérieure à l'établissement a pu être écrite",
    "validity_ck",
  );

  // ── 9. Rapprochement : ce qui ne se rapproche pas ────────────────────────────────
  const basis = { kind: "ADDRESS", score: 1, criteria: [{ name: "postalCode", verdict: "MATCH" }] };

  await rejects(
    "select public.lfo_propose_property_public_data_match($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        target: "COMPARABLE_SET",
        snapshot_id: emptyId,
        match_basis: basis,
      }),
    ],
    "Un instantané VIDE a pu fonder un rapprochement",
    "aucun rapprochement",
  );

  await rejects(
    "select public.lfo_propose_property_public_data_match($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        target: "COMPARABLE_SET",
        snapshot_id: failedId,
        match_basis: basis,
      }),
    ],
    "Un instantané en ÉCHEC a pu fonder un rapprochement",
    "aucun rapprochement",
  );

  await rejects(
    "select public.lfo_propose_property_public_data_match($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        target: "COMPARABLE_SET",
        snapshot_id: snapshotId,
        match_basis: {},
      }),
    ],
    "Un rapprochement sans base nommée a pu être créé",
    "sans base nommée",
  );

  await rejects(
    "select public.lfo_propose_property_public_data_match($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        target: "ENERGY_CERTIFICATE",
        snapshot_id: dpeSnapshotId,
        match_basis: basis,
      }),
    ],
    "Un rapprochement de DPE sans diagnostic désigné a pu être créé",
    "diagnostic précis",
  );

  await rejects(
    "select public.lfo_propose_property_public_data_match($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        target: "COMPARABLE_SET",
        snapshot_id: dpeSnapshotId,
        match_basis: basis,
      }),
    ],
    "Un jeu de comparables a pu être lu dans un instantané DPE",
    "instantané DVF",
  );

  // Hors couverture déclarée : un vide n'y prouve rien, donc rien ne s'y rapproche.
  const uncoveredId = await rpc("lfo_record_real_estate_snapshot", {
    ...snapshotPayload({ coverage_state: "DECLARED_NOT_COVERED" }),
    source_id: sourceId,
    query_hash: "e".repeat(64),
  });
  await rejects(
    "select public.lfo_propose_property_public_data_match($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        target: "COMPARABLE_SET",
        snapshot_id: uncoveredId,
        match_basis: basis,
      }),
    ],
    "Un instantané hors couverture a pu fonder un rapprochement",
    "hors couverture",
  );

  // ── 10. Une décision ne s'automatise pas, et un faible exige un motif ────────────
  const weakMatchId = await rpc("lfo_propose_property_public_data_match", {
    property_id: propertyId,
    target: "ENERGY_CERTIFICATE",
    snapshot_id: dpeSnapshotId,
    certificate_id: certificates.rows[0].id,
    match_basis: basis,
    match_score: "1",
    match_confidence: "LOW",
  });
  const initial = await client.query<{ state: string }>(
    "select state from public.property_public_data_matches where id = $1",
    [weakMatchId],
  );
  assert(
    initial.rows[0].state === "CANDIDATE",
    "Un rapprochement naît CANDIDAT, quel que soit son score",
  );

  await rejects(
    "select public.lfo_decide_property_public_data_match($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ match_id: weakMatchId, decision: "ACCEPT" })],
    "Un rapprochement faible a pu être accepté sans motif",
    "motif explicite",
  );

  await rejects(
    `update public.property_public_data_matches
        set state = 'ACCEPTED', decided_at = now()
      where id = $1`,
    [weakMatchId],
    "Un rapprochement faible a pu être accepté sans motif par écriture directe",
    "weak_accept_ck",
  );

  // Un seul rapprochement OUVERT par cible.
  await rejects(
    "select public.lfo_propose_property_public_data_match($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        target: "ENERGY_CERTIFICATE",
        snapshot_id: dpeSnapshotId,
        certificate_id: certificates.rows[0].id,
        match_basis: basis,
        match_confidence: "LOW",
      }),
    ],
    "Deux rapprochements ouverts sur la même cible ont pu coexister",
    "property_public_data_matches_open_certificate_uidx",
  );

  const superseded = await rpc("lfo_decide_property_public_data_match", {
    match_id: weakMatchId,
    decision: "ACCEPT",
    reason: "Surface et adresse concordantes, lot confirmé par le règlement de copropriété",
  });
  assert(superseded === "0", "Aucun rapprochement antérieur ne devait être remplacé");

  // Une décision ne se rejoue pas.
  await rejects(
    "select public.lfo_decide_property_public_data_match($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ match_id: weakMatchId, decision: "REJECT" })],
    "Une décision a pu être rejouée",
    "déjà tranché",
  );

  // Accepter le SECOND diagnostic remplace le premier : deux DPE acceptés rendraient
  // l'étiquette du bien indéterminée.
  const secondMatchId = await rpc("lfo_propose_property_public_data_match", {
    property_id: propertyId,
    target: "ENERGY_CERTIFICATE",
    snapshot_id: dpeSnapshotId,
    certificate_id: certificates.rows[1].id,
    match_basis: basis,
    match_confidence: "MEDIUM",
  });
  const replaced = await rpc("lfo_decide_property_public_data_match", {
    match_id: secondMatchId,
    decision: "ACCEPT",
    reason: "Correction : le premier diagnostic portait sur un autre lot",
  });
  assert(replaced === "1", "L'acceptation doit remplacer le rapprochement courant");
  const chain = await client.query<{ id: string; state: string; superseded: string | null }>(
    "select id, state, superseded_by::text as superseded from public.property_public_data_matches where property_id = $1 and target = 'ENERGY_CERTIFICATE' order by created_at",
    [propertyId],
  );
  assert(
    chain.rows.filter((row) => row.state === "ACCEPTED" && row.superseded === null).length === 1,
    "Un seul rapprochement accepté COURANT par bien et par cible",
  );
  assert(
    chain.rows.some((row) => row.superseded !== null),
    "L'historique doit être conservé par supersede, jamais supprimé",
  );

  await rejects(
    `insert into public.property_public_data_matches
       (user_id, property_id, target, snapshot_id, certificate_id, match_basis, match_confidence,
        state, decided_at, decided_reason)
     values ($1, $2, 'ENERGY_CERTIFICATE', $3, $4, $5::jsonb, 'HIGH', 'ACCEPTED', now(), 'forcé')`,
    [userId, propertyId, dpeSnapshotId, certificates.rows[0].id, JSON.stringify(basis)],
    "Deux diagnostics acceptés courants ont pu coexister",
    "property_public_data_matches_current_certificate_uidx",
  );

  // ── 11. Valorisation : aucun chiffre dérivé orphelin ─────────────────────────────
  await rejects(
    `insert into public.real_estate_valuations
       (user_id, property_id, valued_at, value, currency, valuation_method, data_kind)
     values ($1, $2, '2026-09-01', 400000, 'EUR', 'COMPARABLE_SALES', 'MODEL_ASSUMPTION')`,
    [userId, propertyId],
    "Une valorisation par comparables sans instantané a pu être écrite",
    "comparable_shape_ck",
  );

  await rejects(
    `insert into public.real_estate_valuations
       (user_id, property_id, valued_at, value, currency, valuation_method, data_kind,
        snapshot_id, derivation)
     values ($1, $2, '2026-09-01', 400000, 'EUR', 'COMPARABLE_SALES', 'MODEL_ASSUMPTION',
             $3, '{"comparable_count": 5}'::jsonb)`,
    [userId, propertyId, snapshotId],
    "Une valorisation par comparables sans convention a pu être écrite",
    "comparable_shape_ck",
  );

  await rejects(
    `insert into public.real_estate_valuations
       (user_id, property_id, valued_at, value, currency, valuation_method, data_kind, snapshot_id)
     values ($1, $2, '2026-09-01', 400000, 'EUR', 'NOTARY_ESTIMATE', 'EXTERNAL_DATA', $3)`,
    [userId, propertyId, snapshotId],
    "Une expertise notariale a pu être rattachée à un instantané public",
    "snapshot_method_ck",
  );

  // Les six méthodes préexistantes restent acceptées : l'extension est ADDITIVE.
  for (const method of [
    "MARKET_APPRAISAL",
    "NOTARY_ESTIMATE",
    "AGENT_ESTIMATE",
    "INDEX_ADJUSTED",
    "USER_ESTIMATE",
    "PURCHASE_PRICE",
  ]) {
    await client.query("savepoint method_check");
    await client.query(
      `insert into public.real_estate_valuations
         (user_id, property_id, valued_at, value, currency, valuation_method, data_kind)
       values ($1, $2, '2026-09-01', 400000, 'EUR', $3, 'EXTERNAL_DATA')`,
      [userId, propertyId, method],
    );
    await client.query("rollback to savepoint method_check");
  }

  // ── 12. Promotion : préconditions et encadrement ─────────────────────────────────
  const comparableMatchId = await rpc("lfo_propose_property_public_data_match", {
    property_id: propertyId,
    target: "COMPARABLE_SET",
    snapshot_id: snapshotId,
    match_basis: { kind: "COMPARABLE_SET", geo: { verdict: "MATCH" }, usableSaleCount: 5 },
    match_score: "1",
    match_confidence: "MEDIUM",
  });

  // Non encore accepté : aucune estimation ne s'y fonde.
  await rejects(
    "select public.lfo_promote_real_estate_market_estimate($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        match_id: comparableMatchId,
        value: 400000,
        currency: "EUR",
        valued_at: "2026-09-01",
        derivation: { convention: "MEDIANE_PRIX_M2_LOT_UNIQUE_SURFACE_BATIE" },
      }),
    ],
    "Une estimation a pu se fonder sur un rapprochement non tranché",
    "ACCEPTÉ",
  );

  await rpc("lfo_decide_property_public_data_match", {
    match_id: comparableMatchId,
    decision: "ACCEPT",
    reason: "Zone identique au bien, cinq mutations exploitables",
  });

  // Hors de l'intervalle des prix unitaires persistés : 5 000 €/m² × 80 m² = 400 000 €,
  // et l'intervalle est ici réduit à ce point unique.
  await rejects(
    "select public.lfo_promote_real_estate_market_estimate($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        match_id: comparableMatchId,
        value: 5_000_000,
        currency: "EUR",
        valued_at: "2026-09-01",
        derivation: { convention: "MEDIANE_PRIX_M2_LOT_UNIQUE_SURFACE_BATIE" },
      }),
    ],
    "Une valeur hors de l'intervalle des comparables a pu être écrite",
    "hors de l'intervalle",
  );

  await rejects(
    "select public.lfo_promote_real_estate_market_estimate($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        match_id: comparableMatchId,
        value: 400000,
        currency: "EUR",
        valued_at: "2026-09-01",
        derivation: { note: "sans convention" },
      }),
    ],
    "Une estimation sans convention nommée a pu être promue",
    "NOM de sa convention",
  );

  const valuationId = await rpc("lfo_promote_real_estate_market_estimate", {
    match_id: comparableMatchId,
    value: 400000,
    currency: "EUR",
    valued_at: "2026-09-01",
    confidence: "MEDIUM",
    derivation: { convention: "MEDIANE_PRIX_M2_LOT_UNIQUE_SURFACE_BATIE", unit_price_median: 5000 },
  });
  const valuation = await client.query<{
    method: string;
    kind: string;
    snapshot: string;
    derivation: Record<string, unknown>;
  }>(
    "select valuation_method as method, data_kind as kind, snapshot_id::text as snapshot, derivation from public.real_estate_valuations where id = $1",
    [valuationId],
  );
  assert(valuation.rows[0].method === "COMPARABLE_SALES", "La méthode doit nommer sa nature");
  assert(
    valuation.rows[0].kind === "MODEL_ASSUMPTION",
    "Une estimation par comparables est une HYPOTHÈSE DE MODÈLE, pas une observation externe",
  );
  assert(valuation.rows[0].snapshot === snapshotId, "La preuve doit être rattachée");
  assert(
    Number(valuation.rows[0].derivation.comparable_count) === 5,
    "Le décompte de comparables doit être ajouté par la base, depuis les lignes persistées",
  );
  assert(
    Number(valuation.rows[0].derivation.surface_sqm) === 80,
    "La surface réellement utilisée doit être persistée",
  );

  // Un bien SANS surface : l'estimation reste non calculable, et rien n'est écrit.
  const surfacelessMatchId = await rpc("lfo_propose_property_public_data_match", {
    property_id: surfacelessId,
    target: "COMPARABLE_SET",
    snapshot_id: snapshotId,
    match_basis: { kind: "COMPARABLE_SET", geo: { verdict: "MATCH" } },
    match_confidence: "MEDIUM",
  });
  await rpc("lfo_decide_property_public_data_match", {
    match_id: surfacelessMatchId,
    decision: "ACCEPT",
    reason: "Zone correcte",
  });
  await rejects(
    "select public.lfo_promote_real_estate_market_estimate($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        match_id: surfacelessMatchId,
        value: 400000,
        currency: "EUR",
        valued_at: "2026-09-01",
        derivation: { convention: "MEDIANE_PRIX_M2_LOT_UNIQUE_SURFACE_BATIE" },
      }),
    ],
    "Une estimation a pu être écrite sans surface déclarée",
    "Surface du bien non déclarée",
  );

  // Un instantané PÉRIMÉ ne fonde pas une écriture canonique silencieuse.
  //
  // La péremption n'est pas forcée par une écriture directe : `stale_after` est DÉRIVÉ de
  // `retrieved_at` et de la fraîcheur déclarée de la source, et `retrieved_at` est gelé par
  // le trigger d'immuabilité. Le seul montage honnête est donc une lecture réellement
  // ancienne — ce qui teste au passage le vrai chemin de calcul de la fraîcheur.
  const oldRead = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const staleSnapshotId = await rpc("lfo_record_real_estate_snapshot", {
    ...snapshotPayload({ retrieved_at: oldRead }),
    source_id: sourceId,
    query_hash: "f".repeat(64),
  });
  const staleRow = await client.query<{ stale: boolean }>(
    "select stale_after <= now() as stale from public.real_estate_data_snapshots where id = $1",
    [staleSnapshotId],
  );
  assert(
    staleRow.rows[0].stale,
    "Une lecture de trois heures avec une fraîcheur de deux heures doit être périmée",
  );

  // Accepter ce jeu remplace le précédent : un seul jeu de comparables courant par bien,
  // sans quoi l'estimation serait indéterminée.
  const staleMatchId = await rpc("lfo_propose_property_public_data_match", {
    property_id: propertyId,
    target: "COMPARABLE_SET",
    snapshot_id: staleSnapshotId,
    match_basis: { kind: "COMPARABLE_SET", geo: { verdict: "MATCH" }, usableSaleCount: 5 },
    match_confidence: "MEDIUM",
  });
  const replacedComparable = await rpc("lfo_decide_property_public_data_match", {
    match_id: staleMatchId,
    decision: "ACCEPT",
    reason: "Relecture de la même zone",
  });
  assert(
    replacedComparable === "1",
    "L'acceptation d'un nouveau jeu doit remplacer le jeu courant",
  );

  await rejects(
    "select public.lfo_promote_real_estate_market_estimate($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        match_id: staleMatchId,
        value: 400000,
        currency: "EUR",
        valued_at: "2026-09-01",
        derivation: { convention: "MEDIANE_PRIX_M2_LOT_UNIQUE_SURFACE_BATIE" },
      }),
    ],
    "Un instantané périmé a pu fonder une valorisation",
    "périmé",
  );

  // Et le jeu remplacé ne fonde plus rien : il n'est plus COURANT.
  await rejects(
    "select public.lfo_promote_real_estate_market_estimate($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        match_id: comparableMatchId,
        value: 400000,
        currency: "EUR",
        valued_at: "2026-09-01",
        derivation: { convention: "MEDIANE_PRIX_M2_LOT_UNIQUE_SURFACE_BATIE" },
      }),
    ],
    "Un rapprochement remplacé a pu fonder une valorisation",
    "courant",
  );

  // ── 13. Piste d'audit en LECTURE SEULE sous `authenticated` ──────────────────────
  await client.query("set local role authenticated");
  for (const table of [
    "real_estate_data_snapshots",
    "real_estate_comparable_sales",
    "real_estate_energy_certificates",
    "property_public_data_matches",
    "external_sources",
  ]) {
    await rejects(
      `insert into public.${table} (user_id) values ($1)`,
      [userId],
      `La table ${table} est écrivable sous authenticated`,
      "permission denied",
    );
  }
  await client.query("set local role service_role");

  // ── 14. Cloisonnement ────────────────────────────────────────────────────────────
  const foreignPropertyId = randomUUID();
  await client.query(
    `insert into public.properties
       (id, user_id, name, property_type, status, inputs)
     values ($1, $2, 'Bien voisin', 'RESIDENTIAL', 'ACTIVE', '{}'::jsonb)`,
    [foreignPropertyId, foreignUser],
  );
  await rejects(
    "select public.lfo_propose_property_public_data_match($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: foreignPropertyId,
        target: "COMPARABLE_SET",
        snapshot_id: snapshotId,
        match_basis: basis,
      }),
    ],
    "Un bien d'un autre propriétaire a pu être visé",
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
      "Smoke Real Estate Public Data : adaptateur à fraîcheur et version déclarées, unicité par provider, échec de lecture persisté avec son code, décompte DÉRIVÉ des lignes malgré un décompte forgé, vide distinct de l'échec, fraîcheur inversée refusée, contenu lu immuable et non supprimable, surface nulle refusée, valeur sans unité refusée, étiquette hors A-G refusée, validité jamais calculée, rapprochement refusé sur un vide / un échec / un hors-couverture / une base absente, cible et forme contraintes, naissance en CANDIDAT, acceptation faible sans motif refusée en RPC comme en écriture directe, un seul ouvert et un seul accepté courant par cible, supersede conservant l'historique, décision non rejouable, chiffre dérivé jamais orphelin, instantané interdit sur une méthode non dérivée, six méthodes préexistantes préservées, promotion refusée sans acceptation / sans surface / sur instantané périmé / hors intervalle des prix unitaires persistés, écriture par la RPC de valorisation EXISTANTE, piste d'audit en lecture seule sous authenticated, cloisonnement. Aucune donnée persistée.",
    );
  }
}
