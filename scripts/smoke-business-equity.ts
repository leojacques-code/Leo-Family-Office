/**
 * Smoke transactionnel de Business Equity V2.1. Toutes les écritures sont annulées :
 * aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve, et qu'aucun test unitaire ne peut prouver :
 *
 *   * le démarrage rapide écrit ATOMIQUEMENT société, détention, période et base de
 *     valorisation — une société créée sans base serait un patrimoine non calculable
 *     fabriqué par le produit lui-même ;
 *   * une méthode DÉRIVÉE ne peut pas persister son résultat : la base de données refuse
 *     une Enterprise Value sur un multiple d'EBITDA ;
 *   * un `null` transmis reste `null` : trésorerie et dette non déclarées ne deviennent
 *     jamais des zéros ;
 *   * une détention à 0 % est acceptée : une sortie totale est un fait représentable ;
 *   * deux valorisations de MÉTHODES différentes coexistent à la même date, et le conflit
 *     reste visible au lieu d'être écrasé ;
 *   * un montant « au niveau société » n'est accepté que sur une distribution ;
 *   * une croissance perpétuelle supérieure au WACC est refusée ;
 *   * aucun fait ne peut référencer la société d'un autre propriétaire ;
 *   * le tour de table écrit ensemble ses termes, la souscription et la détention dérivée.
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

/** Refus attendu, et par le BON contrôle : accepter n'importe quelle erreur ne prouve rien. */
async function rejects(sql: string, params: unknown[], message: string, expected?: string) {
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
  businesses: string;
  ownership: string;
  financials: string;
  valuations: string;
  events: string;
  holdings: string;
  adjustments: string;
  bridge: string;
  dcf: string;
  dcfPeriods: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.businesses)::text as businesses,
      (select count(*) from public.business_ownership)::text as ownership,
      (select count(*) from public.business_financials)::text as financials,
      (select count(*) from public.business_valuations)::text as valuations,
      (select count(*) from public.business_capital_events)::text as events,
      (select count(*) from public.business_holdings)::text as holdings,
      (select count(*) from public.business_ebitda_adjustments)::text as adjustments,
      (select count(*) from public.business_bridge_items)::text as bridge,
      (select count(*) from public.business_dcf_assumptions)::text as dcf,
      (select count(*) from public.business_dcf_periods)::text as "dcfPeriods"
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
    `smoke-be-${foreignUser}@invalid`,
  ]);
  const foreignBusinessId = randomUUID();
  await client.query(
    `insert into public.businesses (id, user_id, name, status, capital_history_source)
     values ($1, $2, 'Société voisine', 'ACTIVE', 'UNKNOWN')`,
    [foreignBusinessId, foreignUser],
  );

  await client.query("set local role service_role");

  // ── 1. Démarrage rapide : quatre écritures, un seul acte ──────────────────────────
  const quick = await rpc(
    "lfo_create_business_quick_start",
    {
      name: "Atelier smoke",
      legal_form: "SAS",
      business_type: "OPERATING",
      currency: "eur",
      period_end: "2025-12-31",
      period_kind: "ANNUAL",
      period_label: "FY2025",
      revenue: 4_800_000,
      ebitda: 650_000,
      cash: 300_000,
      gross_debt: 1_100_000,
      legal_rate: 0.7,
      economic_rate: 0.7,
      valuation_date: "2026-06-30",
      method: "EBITDA_MULTIPLE",
      multiple: 6,
      multiple_low: 5,
      multiple_high: 7,
      capital_history_source: "DECLARED_COMPLETE",
      capital_history_start: "2016-01-01",
    },
    userId,
  );
  const businessId = quick.rows[0].id;
  const created = await client.query<{
    ownership: string;
    financials: string;
    valuations: string;
    currency: string;
    metric_basis: string;
    enterprise_value: string | null;
  }>(
    `select
       (select count(*) from public.business_ownership where business_id = $1)::text as ownership,
       (select count(*) from public.business_financials where business_id = $1)::text as financials,
       (select count(*) from public.business_valuations where business_id = $1)::text as valuations,
       (select functional_currency from public.businesses where id = $1) as currency,
       (select metric_basis from public.business_valuations where business_id = $1) as metric_basis,
       (select enterprise_value from public.business_valuations where business_id = $1) as enterprise_value`,
    [businessId],
  );
  assert(created.rows[0].ownership === "1", "Le démarrage rapide n'a pas écrit la détention");
  assert(created.rows[0].financials === "1", "Le démarrage rapide n'a pas écrit la période");
  assert(created.rows[0].valuations === "1", "Le démarrage rapide n'a pas écrit la base de valorisation");
  assert(created.rows[0].currency === "EUR", "La devise n'a pas été normalisée en majuscules");
  assert(created.rows[0].metric_basis === "EBITDA", "L'agrégat de référence n'a pas été déduit de la méthode");
  assert(
    created.rows[0].enterprise_value === null,
    "Une valorisation dérivée a persisté un résultat : la valeur doit rester dérivée en TypeScript",
  );

  // Le démarrage rapide ne couvre que les méthodes par multiple : une méthode observée
  // exige une source et un montant, pas un raccourci.
  await rejects(
    `select public.lfo_create_business_quick_start($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({ name: "X", currency: "EUR", period_end: "2025-12-31", legal_rate: 1, economic_rate: 1, valuation_date: "2026-01-01", method: "TRANSACTION", multiple: 1 }),
    ],
    "Le démarrage rapide a accepté une méthode qu'il ne sait pas dériver",
    "multiple",
  );

  // ── 2. Une méthode dérivée ne persiste jamais son résultat ────────────────────────
  await rejects(
    `insert into public.business_valuations
       (user_id, business_id, valuation_date, method, enterprise_value, valuation_multiple, assumptions, data_kind)
     values ($1, $2, date '2026-07-01', 'EBITDA_MULTIPLE', 4000000, 6, '{}'::jsonb, 'USER_ASSUMPTION')`,
    [userId, businessId],
    "Une Enterprise Value a été persistée sur une méthode dérivée",
    "business_valuations_basis_v2_ck",
  );
  await rejects(
    `insert into public.business_valuations
       (user_id, business_id, valuation_date, method, assumptions, data_kind)
     values ($1, $2, date '2026-07-02', 'EBITDA_MULTIPLE', '{}'::jsonb, 'USER_ASSUMPTION')`,
    [userId, businessId],
    "Un multiple d'EBITDA sans multiple a été accepté",
    "business_valuations_basis_v2_ck",
  );

  // ── 3. NULL ≠ ZERO sur les termes du pont ─────────────────────────────────────────
  await rpc(
    "lfo_record_business_financials",
    { business_id: businessId, period_end: "2024-12-31", period_kind: "ANNUAL", currency: "EUR", revenue: 4_350_000, ebitda: 540_000 },
    userId,
  );
  const nulls = await client.query<{ cash: string | null; debt: string | null }>(
    "select cash, debt from public.business_financials where business_id = $1 and period_end = date '2024-12-31'",
    [businessId],
  );
  assert(
    nulls.rows[0].cash === null && nulls.rows[0].debt === null,
    "Une trésorerie ou une dette non déclarée a été écrite comme zéro",
  );

  // ── 4. Une sortie totale est un fait : 0 % est acceptable ─────────────────────────
  await rpc(
    "lfo_record_business_ownership",
    { business_id: businessId, effective_date: "2026-08-01", legal_rate: 0, economic_rate: 0 },
    userId,
  );
  const exited = await client.query<{ rate: string }>(
    "select ownership_rate::text as rate from public.business_ownership where business_id = $1 and effective_date = date '2026-08-01'",
    [businessId],
  );
  assert(Number(exited.rows[0].rate) === 0, "Une détention nulle n'a pas été persistée");
  await client.query("delete from public.business_ownership where business_id = $1 and effective_date = date '2026-08-01'", [businessId]);

  // ── 5. Deux méthodes peuvent diverger à la même date ──────────────────────────────
  await rpc(
    "lfo_record_business_valuation",
    { business_id: businessId, valuation_date: "2026-06-30", method: "TRANSACTION", currency: "EUR", equity_value: 3_500_000, data_kind: "EXTERNAL_DATA" },
    userId,
  );
  await rpc(
    "lfo_record_business_valuation",
    { business_id: businessId, valuation_date: "2026-06-30", method: "EXTERNAL_APPRAISAL", currency: "EUR", equity_value: 3_100_000, data_kind: "EXTERNAL_DATA" },
    userId,
  );
  const sameDate = await client.query<{ count: string }>(
    "select count(*)::text from public.business_valuations where business_id = $1 and valuation_date = date '2026-06-30'",
    [businessId],
  );
  assert(
    sameDate.rows[0].count === "3",
    `Le conflit de valorisations a été écrasé au lieu d'être conservé (${sameDate.rows[0].count} lignes)`,
  );
  // La même méthode, elle, reste unique : c'est une correction, pas une divergence.
  await rpc(
    "lfo_record_business_valuation",
    { business_id: businessId, valuation_date: "2026-06-30", method: "TRANSACTION", currency: "EUR", equity_value: 3_600_000, data_kind: "EXTERNAL_DATA" },
    userId,
  );
  const corrected = await client.query<{ count: string; value: string }>(
    `select count(*)::text as count, max(equity_value)::text as value
       from public.business_valuations
      where business_id = $1 and valuation_date = date '2026-06-30' and method = 'TRANSACTION'`,
    [businessId],
  );
  assert(corrected.rows[0].count === "1", "Une correction a créé un doublon au lieu de remplacer");
  assert(Number(corrected.rows[0].value) === 3_600_000, "La correction n'a pas été appliquée");

  // ── 6. Distribution société ≠ cash personnel ──────────────────────────────────────
  await rpc(
    "lfo_record_business_capital_event",
    { business_id: businessId, event_type: "DISTRIBUTION", event_date: "2026-05-30", amount: 200_000, amount_scope: "COMPANY_TOTAL", currency: "EUR" },
    userId,
  );
  await rejects(
    `insert into public.business_capital_events
       (user_id, business_id, event_type, event_date, amount, amount_scope, currency)
     values ($1, $2, 'ACQUISITION', date '2026-05-30', 100000, 'COMPANY_TOTAL', 'EUR')`,
    [userId, businessId],
    "Un coût d'acquisition « au niveau société » a été accepté",
    "business_capital_events_scope_domain_ck",
  );

  // ── 7. Retraitements et éléments de pont ──────────────────────────────────────────
  await rpc(
    "lfo_record_business_ebitda_adjustment",
    { business_id: businessId, period_end: "2025-12-31", category: "OWNER_COMPENSATION", label: "Rémunération normalisée", amount: 60_000, currency: "EUR", recurring: true },
    userId,
  );
  await rpc(
    "lfo_record_business_ebitda_adjustment",
    { business_id: businessId, period_end: "2025-12-31", category: "OWNER_COMPENSATION", label: "Rémunération normalisée", amount: 75_000, currency: "EUR", recurring: true },
    userId,
  );
  const adjustment = await client.query<{ count: string; amount: string }>(
    `select count(*)::text as count, max(amount)::text as amount
       from public.business_ebitda_adjustments where business_id = $1`,
    [businessId],
  );
  assert(adjustment.rows[0].count === "1", "Le même retraitement a été dupliqué au lieu d'être corrigé");
  assert(Number(adjustment.rows[0].amount) === 75_000, "La correction du retraitement n'a pas été appliquée");
  await rpc(
    "lfo_record_business_bridge_item",
    { business_id: businessId, effective_date: "2025-12-31", category: "MINORITY_INTERESTS", label: "Minoritaires", amount: -120_000, currency: "EUR" },
    userId,
  );

  // ── 8. DCF : en-tête et déroulé écrits ensemble ───────────────────────────────────
  const dcf = await rpc(
    "lfo_set_business_dcf",
    {
      business_id: businessId,
      valuation_date: "2026-06-30",
      currency: "EUR",
      wacc: 0.1,
      tax_rate: 0.25,
      terminal_method: "PERPETUAL_GROWTH",
      terminal_growth: 0.02,
      discount_convention: "YEAR_END",
      periods: [
        { year_index: 1, ebit: 1_000_000, depreciation_amortisation: 200_000, capex: 250_000, working_capital_change: 50_000 },
        { year_index: 2, ebit: 1_050_000, depreciation_amortisation: 210_000, capex: 260_000, working_capital_change: 50_000 },
      ],
    },
    userId,
  );
  const dcfPeriods = await client.query<{ count: string }>(
    "select count(*)::text from public.business_dcf_periods where dcf_id = $1",
    [dcf.rows[0].id],
  );
  assert(dcfPeriods.rows[0].count === "2", "Le déroulé annuel du DCF n'a pas été écrit");
  // Réécriture : le déroulé est remplacé, jamais accumulé.
  await rpc(
    "lfo_set_business_dcf",
    {
      business_id: businessId,
      valuation_date: "2026-06-30",
      currency: "EUR",
      wacc: 0.11,
      tax_rate: 0.25,
      terminal_method: "PERPETUAL_GROWTH",
      terminal_growth: 0.02,
      periods: [{ year_index: 1, ebit: 900_000, depreciation_amortisation: 180_000, capex: 200_000, working_capital_change: 40_000 }],
    },
    userId,
  );
  const rewritten = await client.query<{ count: string }>(
    "select count(*)::text from public.business_dcf_periods where dcf_id = $1",
    [dcf.rows[0].id],
  );
  assert(rewritten.rows[0].count === "1", "La réécriture du DCF a accumulé les années au lieu de les remplacer");
  await rejects(
    `insert into public.business_dcf_assumptions
       (user_id, business_id, valuation_date, currency, wacc, tax_rate, terminal_method, terminal_growth)
     values ($1, $2, date '2026-07-31', 'EUR', 0.08, 0.25, 'PERPETUAL_GROWTH', 0.12)`,
    [userId, businessId],
    "Une croissance perpétuelle supérieure au WACC a été acceptée",
    "business_dcf_assumptions_terminal_ck",
  );

  // ── 9. Tour de table : trois conséquences, une écriture ───────────────────────────
  const startupId = (
    await rpc(
      "lfo_save_business",
      { name: "Startup smoke", business_type: "STARTUP", functional_currency: "EUR", capital_history_source: "UNKNOWN" },
      userId,
    )
  ).rows[0].id;
  await rpc(
    "lfo_record_business_ownership",
    { business_id: startupId, effective_date: "2025-01-01", legal_rate: 0.25, economic_rate: 0.25 },
    userId,
  );
  await rpc(
    "lfo_apply_business_funding_round",
    {
      business_id: startupId,
      round_date: "2026-03-01",
      currency: "EUR",
      pre_money_equity_value: 8_000_000,
      primary_new_money: 2_000_000,
      investor_contribution: 500_000,
      preferred_rights_known: false,
      post_ownership_rate: 0.25,
    },
    userId,
  );
  const round = await client.query<{ valuations: string; events: string; kind: string; rate: string }>(
    `select
       (select count(*) from public.business_valuations where business_id = $1 and method = 'FUNDING_ROUND')::text as valuations,
       (select count(*) from public.business_capital_events where business_id = $1 and event_type = 'CAPITAL_INJECTION')::text as events,
       (select data_kind from public.business_ownership where business_id = $1 and effective_date = date '2026-03-01') as kind,
       (select ownership_rate::text from public.business_ownership where business_id = $1 and effective_date = date '2026-03-01') as rate`,
    [startupId],
  );
  assert(round.rows[0].valuations === "1", "Les termes du tour n'ont pas été persistés");
  assert(round.rows[0].events === "1", "La souscription n'a pas produit d'apport en capital");
  assert(round.rows[0].kind === "DERIVED", "La détention post-money n'est pas marquée comme dérivée");
  assert(Number(round.rows[0].rate) === 0.25, "La détention post-money dérivée n'a pas été écrite");

  // ── 10. Holdings et cloisonnement par propriétaire ────────────────────────────────
  await rpc(
    "lfo_set_business_holding",
    { parent_business_id: startupId, child_business_id: businessId, effective_date: "2026-03-01", ownership_rate: 0.6 },
    userId,
  );
  await rejects(
    `insert into public.business_holdings (user_id, parent_business_id, child_business_id, effective_date, ownership_rate)
     values ($1, $2, $3, date '2026-01-01', 0.5)`,
    [userId, businessId, foreignBusinessId],
    "Une holding a pu se rattacher à la société d'un autre propriétaire",
    "business_holdings_child_fk",
  );
  await rejects(
    `insert into public.business_ebitda_adjustments (user_id, business_id, period_end, category, label, amount, currency)
     values ($1, $2, date '2025-12-31', 'OTHER', 'Fuite', 1000, 'EUR')`,
    [userId, foreignBusinessId],
    "Un retraitement a pu viser la société d'un autre propriétaire",
    "business_ebitda_adjustments_business_fk",
  );

  // ── 11. Suppressions ciblées ──────────────────────────────────────────────────────
  const eventId = (
    await client.query<{ id: string }>(
      "select id from public.business_capital_events where business_id = $1 limit 1",
      [businessId],
    )
  ).rows[0].id;
  await client.query("select public.lfo_delete_business_capital_event($1::uuid, $2::uuid)", [userId, eventId]);
  const deleted = await client.query<{ count: string }>(
    "select count(*)::text from public.business_capital_events where id = $1",
    [eventId],
  );
  assert(deleted.rows[0].count === "0", "La suppression d'un événement de capital n'a pas eu lieu");
  await rejects(
    "select public.lfo_delete_business_capital_event($1::uuid, $2::uuid)",
    [userId, eventId],
    "La suppression d'un événement inexistant a été acceptée en silence",
    "introuvable",
  );

  // ── 12. Archivage ─────────────────────────────────────────────────────────────────
  await client.query("select public.lfo_archive_business($1::uuid, $2::uuid)", [userId, startupId]);
  const archived = await client.query<{ archived: boolean }>(
    "select archived from public.businesses where id = $1",
    [startupId],
  );
  assert(archived.rows[0].archived === true, "Archivage de la société non appliqué");

  await client.query("rollback");
  const after = await counts();
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    `Le smoke a persisté des lignes : before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
  console.log(
    "Smoke Business Equity V2.1 vert : démarrage rapide atomique, résultat dérivé jamais persisté, null écrit null, sortie totale représentable, valorisations concurrentes conservées et corrections uniques, distribution sociale distinguée du cash personnel, retraitements et éléments de pont upsertés, DCF écrit et réécrit en bloc, croissance terminale bornée par le WACC, tour de table en une écriture avec détention dérivée, cloisonnement par propriétaire, suppressions ciblées, archivage, rollback intégral.",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
