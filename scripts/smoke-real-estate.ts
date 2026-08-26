/**
 * Smoke transactionnel de Real Estate V2. Toutes les écritures sont annulées : aucune
 * donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve :
 *
 *   * les neuf RPC écrivent et suppriment de façon atomique ;
 *   * un `null` transmis est écrit `null` : « non déclaré » n'est jamais converti en zéro ;
 *   * un bien n'a qu'un prix d'achat et qu'un prix de cession ;
 *   * les deux formes de frais de gestion s'excluent ;
 *   * une quote-part cumulée supérieure à 1 est refusée : la même dette ne peut pas être
 *     attribuée deux fois ;
 *   * un fait immobilier ne peut pas référencer le bien, la dette ou la transaction d'un
 *     autre propriétaire, même par écriture directe hors RPC ;
 *   * le rattachement d'un flux ne touche ni son montant ni sa catégorie ;
 *   * supprimer un bien détache les flux rattachés sans emporter `user_id`.
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
 * Vérifie qu'une écriture est refusée, et par le BON contrôle : accepter n'importe quelle
 * erreur laisserait un smoke vert sur une faute de frappe.
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

type Counts = {
  properties: string;
  valuations: string;
  capital: string;
  terms: string;
  links: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.properties)::text as properties,
      (select count(*) from public.real_estate_valuations)::text as valuations,
      (select count(*) from public.real_estate_capital_events)::text as capital,
      (select count(*) from public.real_estate_operating_terms)::text as terms,
      (select count(*) from public.real_estate_financing_links)::text as links
  `);
  return result.rows[0];
}

const rpc = (name: string, payload: unknown, userId: string) =>
  client.query<{ id: string }>(`select public.${name}($1::uuid, $2::jsonb) as id`, [
    userId,
    JSON.stringify(payload),
  ]);

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

  // Propriétaire voisin : il sert à prouver le cloisonnement. Créé avant le passage en
  // `service_role`, qui n'écrit pas dans le schéma `auth`.
  const foreignUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    foreignUser,
    `smoke-re-${foreignUser}@invalid`,
  ]);
  const foreignPropertyId = randomUUID();
  await client.query(
    `insert into public.properties (id, user_id, name, status, property_usage, ownership_share)
     values ($1, $2, 'Bien voisin', 'ACTIVE', 'RENTAL', 1)`,
    [foreignPropertyId, foreignUser],
  );

  // Dette réelle du propriétaire : Real Estate ne la crée pas, il s'y rattache.
  const liabilityId = randomUUID();
  await client.query(
    `insert into public.liabilities
       (id, user_id, lender, name, principal, current_balance, annual_rate, monthly_payment,
        payment_count, first_payment_date, maturity_date, data_kind, confidence)
     values ($1, $2, 'Banque smoke', 'Crédit smoke', 160000, 120000, 0.021, 820,
             240, date '2020-08-05', date '2040-07-05', 'ACTUAL', 'HIGH')`,
    [liabilityId, userId],
  );
  const institutionId = randomUUID();
  const accountId = randomUUID();
  await client.query("insert into public.institutions (id, user_id, name) values ($1, $2, $3)", [
    institutionId,
    userId,
    `Smoke RE Institution ${institutionId}`,
  ]);
  await client.query(
    `insert into public.financial_accounts
       (id, user_id, institution_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, $3, 'Smoke RE Banque', 'BANK', 'EUR', 'IMMEDIATE', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [accountId, userId, institutionId],
  );
  const categoryId = randomUUID();
  await client.query(
    `insert into public.expense_categories
       (id, user_id, name, group_name, cash_flow_kind, essentiality, expense_behavior)
     values ($1, $2, 'Loyers smoke', 'Revenus', 'INCOME', 'UNKNOWN', 'UNKNOWN')`,
    [categoryId, userId],
  );
  const transactionId = randomUUID();
  await client.query(
    `insert into public.transactions
       (id, user_id, account_id, category_id, transaction_date, label, amount, currency, data_kind, confidence)
     values ($1, $2, $3, $4, date '2026-07-05', 'Loyer smoke', 950, 'EUR', 'ACTUAL', 'HIGH')`,
    [transactionId, userId, accountId, categoryId],
  );

  await client.query("set local role service_role");

  // ── 1. Identité du bien : création puis correction ────────────────────────────────
  const created = await rpc(
    "lfo_save_real_estate_asset",
    {
      name: "Appartement smoke",
      location: "Lyon",
      surface_sqm: 62,
      property_usage: "RENTAL",
      ownership_share: 1,
      acquisition_date: "2020-06-15",
    },
    userId,
  );
  const propertyId = created.rows[0].id;
  assert(propertyId, "Création du bien sans identifiant");

  const identity = await client.query<{
    property_type: string | null;
    status: string | null;
    property_usage: string;
    ownership_share: string;
    archived: boolean;
  }>(
    `select property_type, status, property_usage, ownership_share, archived
       from public.properties where id = $1`,
    [propertyId],
  );
  // Les colonnes héritées restent nulles : aucune valeur n'est fabriquée pour les remplir.
  assert(identity.rows[0].property_type === null, "property_type hérité rempli par une invention");
  assert(identity.rows[0].status === null, "status hérité rempli par une invention");
  assert(identity.rows[0].property_usage === "RENTAL", "Usage non enregistré");
  assert(Number(identity.rows[0].ownership_share) === 1, "Quote-part non enregistrée");

  // Une quote-part transmise `null` efface la déclaration : c'est une valeur, pas un oubli.
  await rpc(
    "lfo_save_real_estate_asset",
    { property_id: propertyId, name: "Appartement smoke", ownership_share: null },
    userId,
  );
  const cleared = await client.query<{
    ownership_share: string | null;
    property_usage: string | null;
  }>("select ownership_share, property_usage from public.properties where id = $1", [propertyId]);
  assert(cleared.rows[0].ownership_share === null, "Quote-part null non effacée");
  assert(cleared.rows[0].property_usage === null, "Usage null non effacé");
  await rpc(
    "lfo_save_real_estate_asset",
    {
      property_id: propertyId,
      name: "Appartement smoke",
      property_usage: "RENTAL",
      ownership_share: 1,
    },
    userId,
  );

  await rejects(
    "select public.lfo_save_real_estate_asset($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ property_id: foreignPropertyId, name: "Vol de bien" })],
    "Un bien d'un autre propriétaire a pu être modifié",
    "introuvable",
  );
  await rejects(
    "select public.lfo_save_real_estate_asset($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ name: "" })],
    "Un bien sans nom a été accepté",
    "nom du bien est requis",
  );
  await rejects(
    "select public.lfo_save_real_estate_asset($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ name: "Quote-part absurde", ownership_share: 1.5 })],
    "Une quote-part supérieure à 1 a été acceptée",
    "properties_ownership_share_ck",
  );
  await rejects(
    "select public.lfo_save_real_estate_asset($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ name: "Usage inventé", property_usage: "CHÂTEAU" })],
    "Un usage hors nomenclature a été accepté",
    "properties_usage_ck",
  );

  // ── 2. Valorisations : historique conservé ────────────────────────────────────────
  for (const [valuedAt, value] of [
    ["2025-06-30", 250000],
    ["2026-06-30", 260000],
  ] as const) {
    await rpc(
      "lfo_record_real_estate_valuation",
      {
        property_id: propertyId,
        valued_at: valuedAt,
        value,
        currency: "eur",
        valuation_method: "AGENT_ESTIMATE",
      },
      userId,
    );
  }
  const valuations = await client.query<{ count: string; currency: string }>(
    `select count(*)::text as count, min(currency) as currency
       from public.real_estate_valuations where property_id = $1`,
    [propertyId],
  );
  assert(valuations.rows[0].count === "2", "Une valorisation a écrasé la précédente");
  assert(valuations.rows[0].currency === "EUR", "Devise non normalisée en majuscules");
  await rejects(
    "select public.lfo_record_real_estate_valuation($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        valued_at: "2026-06-30",
        value: 260000,
        currency: "EUR",
        valuation_method: "BOULE_DE_CRISTAL",
      }),
    ],
    "Une méthode de valorisation hors nomenclature a été acceptée",
    "real_estate_valuations_method_ck",
  );

  // ── 3. Faits de capital : un seul prix d'achat, un seul prix de cession ───────────
  await rpc(
    "lfo_record_real_estate_capital_event",
    {
      property_id: propertyId,
      event_type: "ACQUISITION_PRICE",
      event_date: "2020-06-15",
      amount: 200000,
      currency: "EUR",
    },
    userId,
  );
  const costEvent = await rpc(
    "lfo_record_real_estate_capital_event",
    {
      property_id: propertyId,
      event_type: "ACQUISITION_COST",
      event_date: "2020-06-15",
      amount: 16000,
      currency: "EUR",
      label: "Frais de notaire",
      transaction_id: transactionId,
    },
    userId,
  );
  await rejects(
    "select public.lfo_record_real_estate_capital_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        event_type: "ACQUISITION_PRICE",
        event_date: "2021-01-01",
        amount: 210000,
        currency: "EUR",
      }),
    ],
    "Un second prix d'achat a été accepté",
    "real_estate_capital_events_acquisition_uk",
  );
  await rejects(
    "select public.lfo_record_real_estate_capital_event($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        event_type: "CAPEX",
        event_date: "2023-01-01",
        amount: -5000,
        currency: "EUR",
      }),
    ],
    "Un montant négatif a été accepté : la direction doit venir du type",
    "real_estate_capital_events_amount_ck",
  );
  // Cloisonnement hors RPC : la FK composite refuse un fait sur le bien du voisin.
  await rejects(
    `insert into public.real_estate_capital_events
       (user_id, property_id, event_type, event_date, amount, currency, data_kind, confidence)
     values ($1, $2, 'CAPEX', date '2024-01-01', 1000, 'EUR', 'ACTUAL', 'HIGH')`,
    [userId, foreignPropertyId],
    "Un fait de capital a pu viser le bien d'un autre propriétaire",
    "real_estate_capital_events_property_fk",
  );
  await client.query("select public.lfo_delete_real_estate_capital_event($1::uuid, $2::uuid)", [
    userId,
    costEvent.rows[0].id,
  ]);
  const afterDelete = await client.query<{ count: string }>(
    "select count(*)::text as count from public.real_estate_capital_events where id = $1",
    [costEvent.rows[0].id],
  );
  assert(afterDelete.rows[0].count === "0", "Suppression de fait de capital non appliquée");

  // ── 4. Termes d'exploitation : le null est écrit null ─────────────────────────────
  await rpc(
    "lfo_set_real_estate_operating_terms",
    {
      property_id: propertyId,
      effective_from: "2026-01-01",
      currency: "EUR",
      annual_gross_rent: 12000,
      vacancy_rate: 0.05,
      annual_operating_charges: 0,
      annual_property_tax: 1100,
      annual_management_fees: 800,
    },
    userId,
  );
  const terms = await client.query<{
    annual_operating_charges: string | null;
    annual_insurance: string | null;
    effective_income_tax_rate: string | null;
    management_fee_rate: string | null;
  }>(
    `select annual_operating_charges, annual_insurance, effective_income_tax_rate, management_fee_rate
       from public.real_estate_operating_terms where property_id = $1`,
    [propertyId],
  );
  // Zéro déclaré et non déclaré ne se confondent pas : c'est tout l'enjeu du domaine.
  assert(
    Number(terms.rows[0].annual_operating_charges) === 0,
    "Une charge déclarée à zéro n'a pas été enregistrée",
  );
  assert(terms.rows[0].annual_insurance === null, "Une charge non déclarée a été écrite à zéro");
  assert(
    terms.rows[0].effective_income_tax_rate === null,
    "Un taux d'imposition a été inventé alors qu'aucun n'était déclaré",
  );
  assert(terms.rows[0].management_fee_rate === null, "Un taux de gestion a été inventé");

  // Correction à la même date d'effet : upsert, pas doublon.
  await rpc(
    "lfo_set_real_estate_operating_terms",
    {
      property_id: propertyId,
      effective_from: "2026-01-01",
      currency: "EUR",
      annual_gross_rent: 12600,
      vacancy_rate: 0.05,
    },
    userId,
  );
  const upserted = await client.query<{ count: string; rent: string }>(
    `select count(*)::text as count, max(annual_gross_rent)::text as rent
       from public.real_estate_operating_terms where property_id = $1`,
    [propertyId],
  );
  assert(upserted.rows[0].count === "1", "Une correction a créé une seconde déclaration");
  assert(Number(upserted.rows[0].rent) === 12600, "Correction de loyer non appliquée");
  const cleanedTerms = await client.query<{ annual_property_tax: string | null }>(
    `select annual_property_tax from public.real_estate_operating_terms where property_id = $1`,
    [propertyId],
  );
  // La correction remet à `null` ce qui n'a pas été redéclaré : « non déclaré » redevient
  // « non déclaré », il ne survit pas silencieusement en valeur périmée.
  assert(
    cleanedTerms.rows[0].annual_property_tax === null,
    "Un terme non redéclaré a survécu à la correction",
  );

  await rejects(
    "select public.lfo_set_real_estate_operating_terms($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        effective_from: "2027-01-01",
        currency: "EUR",
        annual_management_fees: 800,
        management_fee_rate: 0.07,
      }),
    ],
    "Les deux formes de frais de gestion ont été acceptées ensemble",
    "real_estate_operating_terms_management_exclusive_ck",
  );
  await rejects(
    "select public.lfo_set_real_estate_operating_terms($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        effective_from: "2027-01-01",
        currency: "EUR",
        vacancy_rate: 1.4,
      }),
    ],
    "Un taux de vacance supérieur à 1 a été accepté",
    "real_estate_operating_terms_rates_ck",
  );

  // ── 5. Rattachement du financement : aucune dette comptée deux fois ───────────────
  const secondPropertyId = (
    await rpc(
      "lfo_save_real_estate_asset",
      { name: "Second bien smoke", ownership_share: 1 },
      userId,
    )
  ).rows[0].id;
  const linkId = (
    await rpc(
      "lfo_set_real_estate_financing_link",
      { property_id: propertyId, liability_id: liabilityId, allocation_share: 0.6 },
      userId,
    )
  ).rows[0].id;
  await rpc(
    "lfo_set_real_estate_financing_link",
    { property_id: secondPropertyId, liability_id: liabilityId, allocation_share: 0.4 },
    userId,
  );
  const allocated = await client.query<{ total: string }>(
    `select sum(allocation_share)::text as total
       from public.real_estate_financing_links where liability_id = $1`,
    [liabilityId],
  );
  assert(Number(allocated.rows[0].total) === 1, "Quote-parts cumulées incorrectes");

  await rejects(
    "select public.lfo_set_real_estate_financing_link($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({
        property_id: propertyId,
        liability_id: liabilityId,
        allocation_share: 0.8,
      }),
    ],
    "Une quote-part cumulée supérieure à 1 a été acceptée : la dette serait comptée deux fois",
    "supérieure à 1",
  );
  // Réduire la part d'un bien libère la marge : la contrainte porte sur le CUMUL réel.
  await rpc(
    "lfo_set_real_estate_financing_link",
    { property_id: secondPropertyId, liability_id: liabilityId, allocation_share: 0.1 },
    userId,
  );
  await rpc(
    "lfo_set_real_estate_financing_link",
    { property_id: propertyId, liability_id: liabilityId, allocation_share: 0.9 },
    userId,
  );
  await rejects(
    `insert into public.real_estate_financing_links
       (user_id, property_id, liability_id, allocation_share, data_kind, confidence)
     values ($1, $2, $3, 0.5, 'USER_ASSUMPTION', 'HIGH')`,
    [foreignUser, propertyId, liabilityId],
    "Un rattachement a pu viser le bien d'un autre propriétaire",
    "real_estate_financing_links_property_fk",
  );
  await client.query("select public.lfo_delete_real_estate_financing_link($1::uuid, $2::uuid)", [
    userId,
    linkId,
  ]);
  const remainingLinks = await client.query<{ count: string }>(
    "select count(*)::text as count from public.real_estate_financing_links where id = $1",
    [linkId],
  );
  assert(remainingLinks.rows[0].count === "0", "Suppression du rattachement non appliquée");

  // ── 6. Attribution d'un flux : rien d'autre n'est touché ──────────────────────────
  await client.query(
    "select public.lfo_attribute_transaction_to_property($1::uuid, $2::uuid, $3::uuid)",
    [userId, transactionId, propertyId],
  );
  const tagged = await client.query<{
    property_id: string | null;
    amount: string;
    category_id: string;
  }>("select property_id, amount::text, category_id from public.transactions where id = $1", [
    transactionId,
  ]);
  assert(tagged.rows[0].property_id === propertyId, "Rattachement du flux non appliqué");
  assert(Number(tagged.rows[0].amount) === 950, "Le rattachement a modifié le montant du flux");
  assert(
    tagged.rows[0].category_id === categoryId,
    "Le rattachement a modifié la catégorie du flux",
  );
  await rejects(
    "select public.lfo_attribute_transaction_to_property($1::uuid, $2::uuid, $3::uuid)",
    [userId, transactionId, foreignPropertyId],
    "Un flux a pu être rattaché au bien d'un autre propriétaire",
    "introuvable",
  );
  // Détachement : `null` est une valeur, pas un oubli.
  await client.query(
    "select public.lfo_attribute_transaction_to_property($1::uuid, $2::uuid, $3::uuid)",
    [userId, transactionId, null],
  );
  const untagged = await client.query<{ property_id: string | null }>(
    "select property_id from public.transactions where id = $1",
    [transactionId],
  );
  assert(untagged.rows[0].property_id === null, "Détachement du flux non appliqué");

  // ── 7. Suppression d'un bien : le flux survit, détaché ────────────────────────────
  await client.query(
    "select public.lfo_attribute_transaction_to_property($1::uuid, $2::uuid, $3::uuid)",
    [userId, transactionId, propertyId],
  );
  await client.query("set local role postgres");
  await client.query("delete from public.properties where id = $1", [propertyId]);
  const survivor = await client.query<{ property_id: string | null; user_id: string }>(
    "select property_id, user_id from public.transactions where id = $1",
    [transactionId],
  );
  assert(survivor.rows[0], "La suppression du bien a emporté le flux bancaire");
  assert(survivor.rows[0].property_id === null, "Le flux est resté rattaché à un bien supprimé");
  assert(
    survivor.rows[0].user_id === userId,
    "La suppression du bien a effacé le propriétaire du flux",
  );

  // ── 8. Archivage : les faits restent lisibles ─────────────────────────────────────
  await client.query("set local role service_role");
  await client.query("select public.lfo_archive_real_estate_asset($1::uuid, $2::uuid)", [
    userId,
    secondPropertyId,
  ]);
  const archived = await client.query<{ archived: boolean }>(
    "select archived from public.properties where id = $1",
    [secondPropertyId],
  );
  assert(archived.rows[0].archived === true, "Archivage du bien non appliqué");

  await client.query("rollback");
  const after = await counts();
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    `Le smoke a persisté des lignes : before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
  console.log(
    "Smoke Real Estate V2 vert : identité upsert et effaçable, colonnes héritées laissées nulles, valorisations historisées, prix d’achat et de cession uniques, montants positifs, null écrit null, frais de gestion exclusifs, quote-part de dette plafonnée à 1, cloisonnement par propriétaire, attribution de flux sans effet de bord, bien supprimé sans perte de flux, archivage, rollback intégral.",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
