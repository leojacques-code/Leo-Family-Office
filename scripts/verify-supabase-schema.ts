/** Vérification PostgreSQL centrale, exhaustive et strictement read-only du schéma Supabase. */
import pg from "pg";
import { diffExactInventory, missingFrom } from "./schema-diff.ts";

const { Client } = pg;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

const canonicalMigrations = [
  "202608190001",
  "202608190002",
  "202608240001",
  "202608240002",
  "202608240003",
  "202608240004",
  "202608240005",
  "20260824230233",
  "20260824231522",
  "20260825012954",
  "20260825020545",
  "20260825021127",
  "20260825021742",
  "20260825063626",
  "20260825063831",
  "20260825193427",
  "20260825193606",
  "20260826090117",
  "20260826090347",
  "20260826140000",
] as const;

const requiredColumns: Record<string, string[]> = {
  profiles: ["user_id", "ledger_coverage_start", "ledger_coverage_source"],
  scenarios: [
    "id",
    "investment_allocation_rate",
    "annual_return",
    "annual_volatility",
    "monthly_savings",
  ],
  expense_categories: ["id", "cash_flow_kind", "essentiality", "expense_behavior", "archived"],
  transactions: ["id", "kind_override", "transfer_group_id", "property_id"],
  // Colonnes réellement lues par la pagination de l'historique de change. Leur absence
  // faisait échouer `getDashboardState` en production sans qu'aucun gate ne le voie : le
  // verifier ne contrôlait pas cette table.
  currency_rates: [
    "id",
    "user_id",
    "base_currency",
    "quote_currency",
    "rate",
    "rate_date",
    "source",
    "data_kind",
  ],
  liabilities: [
    "id",
    "monthly_insurance",
    "recurring_fees",
    "payment_includes_insurance",
    "deferral_kind",
    "deferral_months",
    "deferral_interest_treatment",
    "amortisation_profile",
    "balloon_amount",
    "payment_frequency",
    "interest_convention",
    "rate_type",
    "facility_id",
    "archived",
    "currency",
  ],
  loan_schedules: ["id", "insurance", "fees"],
  loan_early_repayments: ["id", "liability_id", "amount", "penalty", "outcome"],
  loan_charges: ["id", "liability_id", "amount", "financed"],
  loan_rate_changes: ["id", "liability_id", "annual_rate", "term_kind"],
  loan_payment_changes: ["id", "liability_id", "amount", "term_kind"],
  liability_balance_observations: [
    "id",
    "liability_id",
    "observed_at",
    "balance",
    "data_kind",
    "confidence",
  ],
  net_worth_snapshots: [
    "id",
    "version",
    "financial_assets",
    "liquid_assets",
    "account_overdrafts",
    "contractual_debt",
    "other_liabilities",
    "total_liabilities",
    "reporting_currency",
    "completeness_status",
    "composition",
    "provenance",
  ],
  net_worth_snapshot_items: [
    "id",
    "snapshot_id",
    "domain",
    "entity_id",
    "side",
    "native_amount",
    "currency",
    "fx_rate",
    "reporting_amount",
    "valuation_date",
    "valuation_method",
    "quality_status",
  ],
  monthly_closes: [
    "id",
    "version",
    "account_overdrafts",
    "contractual_debt",
    "other_liabilities",
    "total_liabilities",
    "liquid_assets",
    "reporting_currency",
    "completeness_status",
  ],
  recurring_cash_flow_rules: ["id", "cash_flow_kind", "frequency"],
  cash_flow_monthly_closes: ["id", "month", "version", "post_debt_surplus"],
  simulation_runs: ["id", "scenario_id", "seed", "simulations", "years", "methodology"],
  simulation_results: ["id", "run_id", "year", "p10", "p25", "p50", "p75", "p90"],
  portfolio_events: [
    "id",
    "account_id",
    "security_id",
    "event_type",
    "event_date",
    "settlement_date",
    "quantity",
    "unit_price",
    "gross_amount",
    "fee_amount",
    "tax_amount",
    "envelope_cash_amount",
    "currency",
    "counterparty_account_id",
    "transaction_id",
    "matched_acquisition_event_id",
    "is_lot_opening",
    "matched_lot_is_opening",
    "data_kind",
    "confidence",
  ],
  portfolio_envelope_policies: [
    "id",
    "account_id",
    "lot_matching_method",
    "ledger_coverage_start",
    "ledger_coverage_source",
  ],
  properties: [
    "id",
    "property_usage",
    "debt_financed",
    "ownership_share",
    "acquisition_date",
    "disposal_date",
    "archived",
    "data_kind",
    "confidence",
  ],
  real_estate_valuations: [
    "id",
    "property_id",
    "valued_at",
    "value",
    "currency",
    "valuation_method",
    "data_kind",
    "confidence",
  ],
  real_estate_capital_events: [
    "id",
    "property_id",
    "event_type",
    "event_date",
    "amount",
    "currency",
    "transaction_id",
    "data_kind",
    "confidence",
  ],
  real_estate_operating_terms: [
    "id",
    "property_id",
    "effective_from",
    "currency",
    "annual_gross_rent",
    "vacancy_rate",
    "annual_operating_charges",
    "annual_property_tax",
    "annual_insurance",
    "annual_maintenance",
    "annual_management_fees",
    "management_fee_rate",
    "annual_other_costs",
    "effective_income_tax_rate",
  ],
  real_estate_financing_links: [
    "id",
    "property_id",
    "liability_id",
    "allocation_share",
    "data_kind",
    "confidence",
  ],
  businesses: ["id","business_type","functional_currency","archived","data_kind","confidence"],
  business_ownership: ["id","business_id","ownership_rate","economic_rate","voting_rate","fully_diluted_rate","effective_date","data_kind","confidence"],
  business_financials: ["id","business_id","period_end","currency","revenue","ebitda","cash","debt","ebit","net_income","capex","free_cash_flow","data_kind","confidence"],
  business_valuations: ["id","business_id","valuation_date","method","currency","enterprise_value","equity_value","valuation_multiple","data_kind","confidence"],
  business_capital_events: ["id","business_id","event_type","event_date","amount","currency","ownership_delta","transaction_id","data_kind","confidence"],
  business_holdings: ["id","parent_business_id","child_business_id","effective_date","ownership_rate","data_kind","confidence"],
};

const userOwnedTables = [
  "profiles",
  "institutions",
  "asset_classes",
  "financial_accounts",
  "account_balances",
  "expense_categories",
  "transactions",
  "securities",
  "positions",
  "position_snapshots",
  "liabilities",
  "loan_schedules",
  "income_sources",
  "budgets",
  "properties",
  "mortgages",
  "real_estate_cashflows",
  "businesses",
  "business_ownership",
  "business_financials",
  "business_valuations",
  "tax_profiles",
  "tax_rules",
  "economic_assumptions",
  "market_assumptions",
  "scenarios",
  "scenario_versions",
  "scenario_assumptions",
  "goals",
  "net_worth_snapshots",
  "documents",
  "document_metadata",
  "alerts",
  "external_sources",
  "currency_rates",
  "simulation_runs",
  "simulation_results",
  "decision_cases",
  "monthly_closes",
  "recurring_cash_flow_rules",
  "cash_flow_monthly_closes",
  "loan_early_repayments",
  "loan_charges",
  "loan_rate_changes",
  "loan_payment_changes",
  "liability_balance_observations",
  "net_worth_snapshot_items",
  "portfolio_events",
  "portfolio_envelope_policies",
  "real_estate_valuations",
  "real_estate_capital_events",
  "real_estate_operating_terms",
  "real_estate_financing_links",
  "business_capital_events",
  "business_holdings",
] as const;

/**
 * Index dont le nom est un état de schéma, pas un détail de performance. Ce n'est PAS un
 * inventaire exhaustif des index : seuls figurent ici ceux dont la présence ou l'absence
 * distingue deux versions du schéma. `net_worth_snapshot_items_owner_snapshot_idx` est
 * créé par `20260825063626` puis remplacé par `20260825063831` ; une base qui le porte
 * encore n'a donc appliqué que la première des deux, quelles que soient les versions
 * inscrites dans l'historique.
 */
const requiredIndexes = [
  "net_worth_snapshot_items_snapshot_owner_idx",
  // Cibles composites des FK de propriété du ledger portefeuille : sans elles, un
  // événement pourrait référencer le compte, le titre ou la transaction d'un autre
  // utilisateur.
  "financial_accounts_id_user_uidx",
  "securities_id_user_uidx",
  "transactions_id_user_uidx",
  // Unicité des ancrages : une enveloppe n'a qu'un point de départ par série.
  "portfolio_events_opening_cash_uk",
  "portfolio_events_opening_position_uk",
  // Index couvrants des FK : évitent les balayages complets lors des suppressions et
  // mises à jour de comptes ou de lots désignés.
  "portfolio_events_account_owner_idx",
  "portfolio_events_matched_lot_covering_idx",
  // Cibles composites des FK de propriété du domaine immobilier.
  "properties_id_user_uidx",
  "liabilities_id_user_uidx",
  // Un bien n'a qu'un prix d'achat et qu'un prix de cession.
  "real_estate_capital_events_acquisition_uk",
  "real_estate_capital_events_disposal_uk",
  // Index couvrants des FK immobilières.
  "real_estate_financing_links_liability_idx",
  "real_estate_financing_links_property_idx",
  "real_estate_capital_events_transaction_idx",
  "transactions_property_owner_idx",
  // Index dans l'ORDRE de la FK composite `(property_id, user_id)`. Ceux de Real Estate V2
  // sont en `(user_id, property_id)` : PostgreSQL ne peut pas s'en servir pour vérifier la
  // clé étrangère ni la cascader, et chaque suppression de bien balayait la table.
  "real_estate_valuations_property_owner_idx",
  "real_estate_capital_events_property_owner_idx",
  "real_estate_operating_terms_property_owner_idx",
  "businesses_id_user_uidx",
  "business_ownership_effective_uk",
  "business_ownership_business_owner_idx",
  "business_financials_business_owner_idx",
  "business_valuations_business_owner_idx",
  "business_capital_events_business_owner_idx",
  "business_holdings_parent_owner_idx",
  "business_holdings_child_owner_idx",
] as const;
const forbiddenIndexes = ["net_worth_snapshot_items_owner_snapshot_idx"] as const;

/**
 * Triggers dont l'absence supprimerait un invariant financier, et non une commodité.
 *
 * `real_estate_financing_links_allocation_guard` est le SEUL endroit où la règle « la
 * somme des quote-parts d'un même concours ne dépasse jamais 1 » est réellement garantie :
 * `authenticated` détient des droits d'écriture directs sur la table, et deux écritures
 * concurrentes contourneraient tout contrôle applicatif. Une base qui l'aurait perdu
 * accepterait de compter la même dette deux fois sans rien signaler.
 */
const requiredTriggers = ["real_estate_financing_links_allocation_guard"] as const;
/** Fonction portée par ce trigger. Hors nomenclature `lfo_` : ce n'est pas une RPC. */
const requiredTriggerFunctions = ["real_estate_allocation_guard"] as const;

const requiredConstraints = [
  "scenarios_investment_allocation_rate_ck",
  "expense_categories_cash_flow_kind_ck",
  "expense_categories_essentiality_ck",
  "expense_categories_behavior_ck",
  "transactions_kind_override_ck",
  "recurring_rules_frequency_ck",
  "recurring_rules_day_ck",
  "profiles_ledger_coverage_source_ck",
  "liabilities_deferral_kind_ck",
  "liabilities_deferral_months_ck",
  "liabilities_deferral_interest_ck",
  "loan_early_repayments_outcome_ck",
  "loan_early_repayments_amount_ck",
  "liabilities_amortisation_profile_ck",
  "liabilities_payment_frequency_ck",
  "liabilities_interest_convention_ck",
  "liabilities_rate_type_ck",
  "loan_rate_changes_kind_ck",
  "loan_payment_changes_kind_ck",
  "loan_payment_changes_amount_ck",
  "net_worth_snapshots_version_ck",
  "net_worth_snapshots_completeness_ck",
  "net_worth_snapshot_items_owner_fk",
  "portfolio_events_type_ck",
  "portfolio_events_security_shape_ck",
  "portfolio_events_quantity_shape_ck",
  "portfolio_events_matched_lot_ck",
  "portfolio_events_counterparty_ck",
  "portfolio_events_data_kind_ck",
  "portfolio_events_settlement_ck",
  "portfolio_events_account_fk",
  "portfolio_events_security_fk",
  "portfolio_events_counterparty_fk",
  "portfolio_events_transaction_fk",
  "portfolio_events_lot_target_uk",
  "portfolio_events_matched_lot_fk",
  "portfolio_envelope_policies_method_ck",
  "portfolio_envelope_policies_coverage_source_ck",
  "portfolio_envelope_policies_coverage_pair_ck",
  "portfolio_envelope_policies_account_fk",
  "portfolio_envelope_policies_account_uk",
  "properties_usage_ck",
  "properties_ownership_share_ck",
  "properties_disposal_after_acquisition_ck",
  "real_estate_valuations_property_fk",
  "real_estate_valuations_value_ck",
  "real_estate_valuations_method_ck",
  "real_estate_valuations_data_kind_ck",
  "real_estate_capital_events_property_fk",
  "real_estate_capital_events_transaction_fk",
  "real_estate_capital_events_amount_ck",
  "real_estate_capital_events_type_ck",
  "real_estate_capital_events_data_kind_ck",
  "real_estate_operating_terms_property_fk",
  "real_estate_operating_terms_effective_uk",
  "real_estate_operating_terms_amounts_ck",
  "real_estate_operating_terms_rates_ck",
  "real_estate_operating_terms_management_exclusive_ck",
  "real_estate_operating_terms_data_kind_ck",
  "real_estate_financing_links_property_fk",
  "real_estate_financing_links_liability_fk",
  "real_estate_financing_links_pair_uk",
  "real_estate_financing_links_share_ck",
  "transactions_property_fk",
  "business_ownership_business_fk",
  "business_financials_business_fk",
  "business_valuations_business_fk",
  "business_ownership_rates_ck",
  "business_valuations_value_ck",
  "business_capital_events_business_fk",
  "business_capital_events_transaction_fk",
  "business_capital_events_amount_ck",
  "business_capital_events_type_ck",
  "business_capital_events_ownership_delta_ck",
  "business_holdings_parent_fk",
  "business_holdings_child_fk",
  "business_holdings_no_self_ck",
  "business_holdings_rate_ck",
  "business_holdings_effective_uk",
] as const;

const requiredRpcs: Record<string, string> = {
  lfo_add_account:
    "p_user_id uuid, p_institution text, p_name text, p_account_type text, p_balance numeric, p_currency text, p_as_of_date date",
  lfo_add_transaction:
    "p_user_id uuid, p_account_id uuid, p_category_id uuid, p_transaction_date date, p_label text, p_amount numeric, p_currency text, p_update_balance boolean",
  lfo_update_scenario:
    "p_user_id uuid, p_scenario_id uuid, p_patch jsonb, p_updated_at timestamp with time zone",
  lfo_duplicate_scenario: "p_user_id uuid, p_scenario_id uuid, p_now timestamp with time zone",
  lfo_create_monthly_close:
    "p_user_id uuid, p_close_date date, p_gross_assets numeric, p_debt numeric, p_net_worth numeric, p_forecast_net_worth numeric, p_variance numeric",
  lfo_add_category:
    "p_user_id uuid, p_name text, p_group_name text, p_cash_flow_kind text, p_essentiality text, p_expense_behavior text, p_as_of_date date",
  lfo_close_cash_flow_month:
    "p_user_id uuid, p_month text, p_income numeric, p_consumer_expenses numeric, p_essential_expenses numeric, p_taxes_paid numeric, p_debt_service_paid numeric, p_investment_flows numeric, p_internal_transfers numeric, p_operating_surplus_before_debt numeric, p_post_debt_surplus numeric, p_unclassified_transaction_count integer",
  lfo_save_simulation:
    "p_user_id uuid, p_scenario_id uuid, p_seed integer, p_simulations integer, p_years integer, p_methodology text, p_points jsonb",
  lfo_save_debt_contract: "p_user_id uuid, p_payload jsonb",
  lfo_record_debt_balance:
    "p_user_id uuid, p_liability_id uuid, p_observed_at date, p_balance numeric, p_notes text",
  lfo_archive_debt: "p_user_id uuid, p_liability_id uuid",
  lfo_create_monthly_close_v2:
    "p_user_id uuid, p_close_date date, p_snapshot jsonb, p_items jsonb, p_forecast_net_worth numeric, p_variance numeric",
  lfo_record_portfolio_event: "p_user_id uuid, p_payload jsonb",
  lfo_delete_portfolio_event: "p_user_id uuid, p_event_id uuid",
  lfo_set_portfolio_envelope_policy: "p_user_id uuid, p_payload jsonb",
  lfo_save_real_estate_asset: "p_user_id uuid, p_payload jsonb",
  lfo_archive_real_estate_asset: "p_user_id uuid, p_property_id uuid",
  lfo_record_real_estate_valuation: "p_user_id uuid, p_payload jsonb",
  lfo_record_real_estate_capital_event: "p_user_id uuid, p_payload jsonb",
  lfo_delete_real_estate_capital_event: "p_user_id uuid, p_event_id uuid",
  lfo_set_real_estate_operating_terms: "p_user_id uuid, p_payload jsonb",
  lfo_set_real_estate_financing_link: "p_user_id uuid, p_payload jsonb",
  lfo_delete_real_estate_financing_link: "p_user_id uuid, p_link_id uuid",
  lfo_attribute_transaction_to_property:
    "p_user_id uuid, p_transaction_id uuid, p_property_id uuid",
  lfo_save_business: "p_user_id uuid, p_payload jsonb",
  lfo_archive_business: "p_user_id uuid, p_business_id uuid",
  lfo_record_business_ownership: "p_user_id uuid, p_payload jsonb",
  lfo_record_business_financials: "p_user_id uuid, p_payload jsonb",
  lfo_record_business_valuation: "p_user_id uuid, p_payload jsonb",
  lfo_record_business_capital_event: "p_user_id uuid, p_payload jsonb",
  lfo_set_business_holding: "p_user_id uuid, p_payload jsonb",
};

const storagePolicies = [
  "documents_owner_select",
  "documents_owner_insert",
  "documents_owner_update",
  "documents_owner_delete",
] as const;

/**
 * Contrôle d'inclusion : la base doit contenir au moins ce que le code attend. Reste le
 * bon contrôle pour les inventaires dont le repo n'est pas la liste exhaustive (une base
 * peut légitimement porter des objets d'infrastructure inconnus du code applicatif).
 */
function addMissing(
  failures: string[],
  label: string,
  expected: readonly string[],
  actual: Iterable<string>,
): void {
  const missing = missingFrom(expected, actual);
  if (missing.length > 0) failures.push(`${label} manquant(s) : ${missing.join(", ")}`);
}

/**
 * Contrôle d'égalité, dans les deux sens. Réservé aux inventaires dont le repo EST la
 * vérité exhaustive. L'historique de migrations en est le seul cas certain : une version
 * appliquée hors du repo signifie que `supabase/migrations/` ne reproduit plus la base,
 * donc que le code a cessé d'être la source de vérité du schéma.
 */
function addExactInventory(
  failures: string[],
  label: string,
  expected: readonly string[],
  actual: Iterable<string>,
): void {
  failures.push(...diffExactInventory(label, expected, actual));
}

const connectionString = required("SUPABASE_DB_URL");
const connectionUrl = new URL(connectionString);
const localHost = ["localhost", "127.0.0.1", "::1"].includes(connectionUrl.hostname);
const client = new Client({
  connectionString,
  ssl: localHost || connectionUrl.searchParams.get("sslmode") === "disable" ? false : true,
});

const failures: string[] = [];

try {
  await client.connect();
  await client.query("begin read only");
  await client.query("set local statement_timeout = '15s'");

  const columns = await client.query<{ table_name: string; column_name: string }>(`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
  `);
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of columns.rows) {
    const tableColumns = columnsByTable.get(row.table_name) ?? new Set<string>();
    tableColumns.add(row.column_name);
    columnsByTable.set(row.table_name, tableColumns);
  }
  addMissing(failures, "Table(s)", userOwnedTables, columnsByTable.keys());
  for (const [table, expected] of Object.entries(requiredColumns)) {
    addMissing(
      failures,
      `Colonne(s) de public.${table}`,
      expected,
      columnsByTable.get(table) ?? [],
    );
  }

  const constraints = await client.query<{ conname: string }>(`
    select con.conname
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class rel on rel.oid = con.conrelid
      join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
  `);
  addMissing(
    failures,
    "Contrainte(s)",
    requiredConstraints,
    constraints.rows.map((row) => row.conname),
  );

  const indexes = await client.query<{ indexname: string }>(`
    select indexname
      from pg_catalog.pg_indexes
     where schemaname = 'public'
  `);
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  addMissing(failures, "Index", requiredIndexes, indexNames);
  for (const index of forbiddenIndexes) {
    if (indexNames.has(index)) failures.push(`Index remplacé toujours présent : public.${index}`);
  }

  const triggers = await client.query<{ tgname: string }>(`
    select tg.tgname
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class rel on rel.oid = tg.tgrelid
      join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and not tg.tgisinternal
  `);
  addMissing(
    failures,
    "Trigger(s)",
    requiredTriggers,
    triggers.rows.map((row) => row.tgname),
  );

  const triggerFunctions = await client.query<{ proname: string }>(`
    select pr.proname
      from pg_catalog.pg_proc pr
      join pg_catalog.pg_namespace ns on ns.oid = pr.pronamespace
     where ns.nspname = 'public' and pr.prorettype = 'pg_catalog.trigger'::regtype
  `);
  addMissing(
    failures,
    "Fonction(s) de trigger",
    requiredTriggerFunctions,
    triggerFunctions.rows.map((row) => row.proname),
  );

  const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(`
    select rel.relname, rel.relrowsecurity
      from pg_catalog.pg_class rel
      join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and rel.relkind = 'r'
  `);
  const rlsByTable = new Map(rls.rows.map((row) => [row.relname, row.relrowsecurity]));
  for (const table of userOwnedTables) {
    if (rlsByTable.get(table) !== true) failures.push(`RLS inactif : public.${table}`);
  }

  const policies = await client.query<{
    tablename: string;
    policyname: string;
    roles: string[];
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(`
    select tablename, policyname, roles::text[], cmd, qual, with_check
      from pg_catalog.pg_policies
     where schemaname = 'public'
  `);
  for (const table of userOwnedTables) {
    const policy = policies.rows.find(
      (row) => row.tablename === table && row.policyname === "owner_all",
    );
    const ownerPredicate = (value: string | null) =>
      Boolean(value?.includes("auth.uid()") && value.includes("user_id"));
    if (!policy) {
      failures.push(`Policy owner_all absente : public.${table}`);
    } else if (
      policy.cmd !== "ALL" ||
      !policy.roles.includes("authenticated") ||
      !ownerPredicate(policy.qual) ||
      !ownerPredicate(policy.with_check)
    ) {
      failures.push(`Policy owner_all invalide : public.${table}`);
    }
  }

  const rpcs = await client.query<{
    name: string;
    arguments: string;
    result_type: string;
    security_definer: boolean;
    settings: string[] | null;
    anon_execute: boolean;
    authenticated_execute: boolean;
    service_role_execute: boolean;
  }>(`
    select proc.proname as name,
           pg_catalog.pg_get_function_identity_arguments(proc.oid) as arguments,
           pg_catalog.pg_get_function_result(proc.oid) as result_type,
           proc.prosecdef as security_definer,
           proc.proconfig as settings,
           pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE') as anon_execute,
           pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE') as authenticated_execute,
           pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE') as service_role_execute
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
     where ns.nspname = 'public' and proc.proname like 'lfo\\_%' escape '\\'
  `);
  addMissing(
    failures,
    "RPC lfo_*",
    Object.keys(requiredRpcs),
    rpcs.rows.map((row) => row.name),
  );
  const unexpectedRpcs = rpcs.rows.filter((row) => !(row.name in requiredRpcs));
  if (unexpectedRpcs.length > 0) {
    failures.push(`RPC lfo_* inattendue(s) : ${unexpectedRpcs.map((row) => row.name).join(", ")}`);
  }
  for (const rpc of rpcs.rows) {
    const expectedArguments = requiredRpcs[rpc.name];
    if (!expectedArguments) continue;
    if (rpc.arguments !== expectedArguments) {
      failures.push(
        `Signature RPC invalide : ${rpc.name}(${rpc.arguments}), attendu ${rpc.name}(${expectedArguments})`,
      );
    }
    if (rpc.result_type !== "uuid") failures.push(`Type de retour RPC invalide : ${rpc.name}`);
    if (rpc.security_definer) failures.push(`RPC SECURITY DEFINER interdite : ${rpc.name}`);
    if (!rpc.settings?.some((setting) => setting === 'search_path=""')) {
      failures.push(`search_path non verrouillé : ${rpc.name}`);
    }
    if (rpc.anon_execute) failures.push(`RPC exécutable par anon : ${rpc.name}`);
    if (rpc.authenticated_execute) failures.push(`RPC exécutable par authenticated : ${rpc.name}`);
    if (!rpc.service_role_execute)
      failures.push(`RPC non exécutable par service_role : ${rpc.name}`);
  }

  const bucket = await client.query<{
    id: string;
    public: boolean;
    file_size_limit: number | null;
  }>(`
    select id, public, file_size_limit
      from storage.buckets
     where id = 'family-office-documents'
  `);
  const documentsBucket = bucket.rows[0];
  if (!documentsBucket) {
    failures.push("Bucket Storage absent : family-office-documents");
  } else {
    if (documentsBucket.public) failures.push("Bucket Storage public : family-office-documents");
    if (Number(documentsBucket.file_size_limit) !== 8_388_608) {
      failures.push("Limite du bucket Storage invalide : family-office-documents");
    }
  }

  const storagePolicyRows = await client.query<{ policyname: string }>(`
    select policyname
      from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
  `);
  addMissing(
    failures,
    "Policy(s) Storage",
    storagePolicies,
    storagePolicyRows.rows.map((row) => row.policyname),
  );

  const migrations = await client.query<{ version: string }>(`
    select version
      from supabase_migrations.schema_migrations
     order by version
  `);
  addExactInventory(
    failures,
    "Migration(s) distante(s)",
    canonicalMigrations,
    migrations.rows.map((row) => row.version),
  );

  await client.query("rollback");
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    // La connexion peut avoir échoué avant l'ouverture de la transaction.
  }
  throw error;
} finally {
  await client.end();
}

if (failures.length > 0) {
  throw new Error(
    `Schéma Supabase non conforme (${failures.length} contrôle(s) en échec) :\n- ${failures.join("\n- ")}`,
  );
}

console.log(
  `Schéma Supabase vérifié en lecture seule : ${userOwnedTables.length} tables, ${requiredConstraints.length} contraintes, ${Object.keys(requiredRpcs).length} RPC, ${requiredTriggers.length} trigger(s) d'invariant, RLS/policies, Storage, index de snapshot et ${canonicalMigrations.length} migrations conformes.`,
);
