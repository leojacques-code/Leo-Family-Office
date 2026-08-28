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
  "20260826145426",
  "20260826145803",
  "20260826194551",
  "20260826194605",
  "20260826194644",
  "20260827155134",
  "20260827180000",
] as const;

const requiredColumns: Record<string, string[]> = {
  profiles: ["user_id", "ledger_coverage_start", "ledger_coverage_source"],
  scenarios: ["id", "investment_allocation_rate", "annual_return", "annual_volatility", "monthly_savings"],
  expense_categories: ["id", "cash_flow_kind", "essentiality", "expense_behavior", "archived"],
  transactions: ["id", "kind_override", "transfer_group_id", "property_id"],
  currency_rates: ["id", "user_id", "base_currency", "quote_currency", "rate", "rate_date", "source", "data_kind"],
  liabilities: ["id", "monthly_insurance", "recurring_fees", "payment_includes_insurance", "deferral_kind", "deferral_months", "deferral_interest_treatment", "amortisation_profile", "balloon_amount", "payment_frequency", "interest_convention", "rate_type", "facility_id", "archived", "currency"],
  loan_schedules: ["id", "insurance", "fees"],
  loan_early_repayments: ["id", "liability_id", "amount", "penalty", "outcome"],
  loan_charges: ["id", "liability_id", "amount", "financed"],
  loan_rate_changes: ["id", "liability_id", "annual_rate", "term_kind"],
  loan_payment_changes: ["id", "liability_id", "amount", "term_kind"],
  liability_balance_observations: ["id", "liability_id", "observed_at", "balance", "data_kind", "confidence"],
  net_worth_snapshots: ["id", "version", "financial_assets", "liquid_assets", "account_overdrafts", "contractual_debt", "other_liabilities", "total_liabilities", "reporting_currency", "completeness_status", "composition", "provenance"],
  net_worth_snapshot_items: ["id", "snapshot_id", "domain", "entity_id", "side", "native_amount", "currency", "fx_rate", "reporting_amount", "valuation_date", "valuation_method", "quality_status"],
  monthly_closes: ["id", "version", "account_overdrafts", "contractual_debt", "other_liabilities", "total_liabilities", "liquid_assets", "reporting_currency", "completeness_status"],
  recurring_cash_flow_rules: ["id", "cash_flow_kind", "frequency"],
  cash_flow_monthly_closes: ["id", "month", "version", "post_debt_surplus"],
  simulation_runs: ["id", "scenario_id", "seed", "simulations", "years", "methodology"],
  simulation_results: ["id", "run_id", "year", "p10", "p25", "p50", "p75", "p90"],
  portfolio_events: ["id", "account_id", "security_id", "event_type", "event_date", "settlement_date", "quantity", "unit_price", "gross_amount", "fee_amount", "tax_amount", "envelope_cash_amount", "currency", "counterparty_account_id", "transaction_id", "matched_acquisition_event_id", "is_lot_opening", "matched_lot_is_opening", "data_kind", "confidence"],
  portfolio_envelope_policies: ["id", "account_id", "lot_matching_method", "ledger_coverage_start", "ledger_coverage_source"],
  properties: ["id", "property_usage", "debt_financed", "ownership_share", "acquisition_date", "disposal_date", "archived", "data_kind", "confidence"],
  real_estate_valuations: ["id", "property_id", "valued_at", "value", "currency", "valuation_method", "data_kind", "confidence"],
  real_estate_capital_events: ["id", "property_id", "event_type", "event_date", "amount", "currency", "transaction_id", "data_kind", "confidence"],
  real_estate_operating_terms: ["id", "property_id", "effective_from", "currency", "annual_gross_rent", "vacancy_rate", "annual_operating_charges", "annual_property_tax", "annual_insurance", "annual_maintenance", "annual_management_fees", "management_fee_rate", "annual_other_costs", "effective_income_tax_rate"],
  real_estate_financing_links: ["id", "property_id", "liability_id", "allocation_share", "data_kind", "confidence"],
  businesses: ["id", "business_type", "functional_currency", "archived", "data_kind", "confidence", "sector", "country", "founded_on", "capital_history_start", "capital_history_source"],
  business_ownership: ["id", "business_id", "ownership_rate", "economic_rate", "voting_rate", "fully_diluted_rate", "effective_date", "data_kind", "confidence", "shares_held", "shares_outstanding", "fully_diluted_shares", "share_class", "origin_event_id"],
  business_financials: ["id", "business_id", "period_end", "currency", "revenue", "ebitda", "cash", "debt", "ebit", "net_income", "capex", "free_cash_flow", "data_kind", "confidence", "period_kind", "period_start", "period_label", "gross_profit", "depreciation_amortisation", "interest_expense", "tax_expense"],
  business_valuations: ["id", "business_id", "valuation_date", "method", "currency", "enterprise_value", "equity_value", "valuation_multiple", "data_kind", "confidence", "multiple_low", "multiple_high", "metric_basis", "metric_period_end", "pre_money_equity_value", "primary_new_money", "secondary_amount", "investor_contribution", "preferred_rights_known"],
  business_capital_events: ["id", "business_id", "event_type", "event_date", "amount", "currency", "ownership_delta", "transaction_id", "data_kind", "confidence", "amount_scope", "fees", "ownership_rate_after", "shares_delta", "price_per_share", "label"],
  business_holdings: ["id", "parent_business_id", "child_business_id", "effective_date", "ownership_rate", "data_kind", "confidence"],
  business_ebitda_adjustments: ["id", "user_id", "business_id", "period_end", "category", "label", "amount", "currency", "recurring", "data_kind", "confidence"],
  business_bridge_items: ["id", "user_id", "business_id", "effective_date", "category", "label", "amount", "currency", "data_kind", "confidence"],
  business_bridge_declarations: ["id", "user_id", "business_id", "effective_date", "status", "data_kind", "confidence", "source", "notes"],
  business_dcf_assumptions: ["id", "user_id", "business_id", "valuation_date", "currency", "wacc", "tax_rate", "terminal_method", "terminal_growth", "terminal_exit_multiple", "terminal_exit_metric", "discount_convention"],
  business_dcf_periods: ["id", "user_id", "dcf_id", "year_index", "revenue", "ebitda", "ebit", "depreciation_amortisation", "capex", "working_capital_change"],
  fec_entry_lines: ["id", "user_id", "session_id", "raw_record_id", "business_id", "journal_code", "journal_lib", "entry_num", "entry_date", "account_num", "account_lib", "aux_account_num", "aux_account_lib", "piece_ref", "piece_date", "entry_label", "debit", "credit", "lettering_code", "lettering_date", "validation_date", "currency_amount", "currency_code", "pcg_class", "pcg_group", "status", "issues", "commit_state", "committed_at", "data_kind", "confidence"],
  import_sources: ["id", "user_id", "kind", "domain", "provider", "label", "target_account_id", "target_business_id", "status", "adapter_version", "coverage_start", "coverage_end", "last_attempt_at", "last_success_at", "last_error", "data_kind", "confidence"],
  import_sessions: ["id", "user_id", "source_id", "file_name", "file_hash", "file_size_bytes", "content_type", "encoding", "delimiter", "parser", "parser_version", "mapping", "conventions", "declared_currency", "observation_date", "stable_transaction_id_declared", "retain_file_requested", "declared_period_start", "declared_period_end", "observed_period_start", "observed_period_end", "fiscal_year_start", "fiscal_year_end", "coverage_declared", "entry_count", "unbalanced_entry_count", "status", "row_count", "ready_count", "warning_count", "blocked_count", "duplicate_count", "ignored_count", "committed_count", "document_id", "issues", "analyzed_at", "committed_at", "discarded_at"],
  import_raw_records: ["id", "user_id", "session_id", "row_number", "raw_line", "cells"],
  import_normalized_records: ["id", "user_id", "session_id", "raw_record_id", "target_domain", "account_id", "transaction_date", "value_date", "label", "amount", "currency", "external_transaction_id", "reference", "counterparty", "balance_after", "status", "dedupe_verdict", "match_key", "external_key", "matched_transaction_id", "issues", "commit_state", "committed_at", "data_kind", "confidence"],
  import_record_links: ["id", "user_id", "session_id", "normalized_record_id", "target_domain", "transaction_id", "business_financials_id"],
  import_column_mappings: ["id", "user_id", "signature", "provider", "label", "headers", "mapping", "conventions", "version", "confirmed_at"],
};

const userOwnedTables = [
  "profiles", "institutions", "asset_classes", "financial_accounts", "account_balances", "expense_categories", "transactions", "securities", "positions", "position_snapshots", "liabilities", "loan_schedules", "income_sources", "budgets", "properties", "mortgages", "real_estate_cashflows", "businesses", "business_ownership", "business_financials", "business_valuations", "tax_profiles", "tax_rules", "economic_assumptions", "market_assumptions", "scenarios", "scenario_versions", "scenario_assumptions", "goals", "net_worth_snapshots", "documents", "document_metadata", "alerts", "external_sources", "currency_rates", "simulation_runs", "simulation_results", "decision_cases", "monthly_closes", "recurring_cash_flow_rules", "cash_flow_monthly_closes", "loan_early_repayments", "loan_charges", "loan_rate_changes", "loan_payment_changes", "liability_balance_observations", "net_worth_snapshot_items", "portfolio_events", "portfolio_envelope_policies", "real_estate_valuations", "real_estate_capital_events", "real_estate_operating_terms", "real_estate_financing_links", "business_capital_events", "business_holdings", "business_ebitda_adjustments", "business_bridge_items", "business_bridge_declarations", "business_dcf_assumptions", "business_dcf_periods",
  "import_sources", "import_sessions", "import_raw_records", "import_normalized_records", "import_record_links", "import_column_mappings",
  "fec_entry_lines",
] as const;

const requiredIndexes = [
  "net_worth_snapshot_items_snapshot_owner_idx", "financial_accounts_id_user_uidx", "securities_id_user_uidx", "transactions_id_user_uidx", "portfolio_events_opening_cash_uk", "portfolio_events_opening_position_uk", "portfolio_events_account_owner_idx", "portfolio_events_matched_lot_covering_idx", "properties_id_user_uidx", "liabilities_id_user_uidx", "real_estate_capital_events_acquisition_uk", "real_estate_capital_events_disposal_uk", "real_estate_financing_links_liability_idx", "real_estate_financing_links_property_idx", "real_estate_capital_events_transaction_idx", "transactions_property_owner_idx", "real_estate_valuations_property_owner_idx", "real_estate_capital_events_property_owner_idx", "real_estate_operating_terms_property_owner_idx", "businesses_id_user_uidx", "business_ownership_effective_uk", "business_ownership_business_owner_idx", "business_financials_business_owner_idx", "business_valuations_business_owner_idx", "business_capital_events_business_owner_idx", "business_holdings_parent_owner_idx", "business_holdings_child_owner_idx", "business_financials_effective_uk", "business_valuations_effective_method_uk", "businesses_user_idx", "business_financials_user_idx", "business_valuations_user_idx", "business_capital_events_user_idx", "business_capital_events_id_user_uidx", "business_ownership_origin_event_idx", "business_ebitda_adjustments_business_owner_idx", "business_bridge_items_business_owner_idx", "business_bridge_declarations_business_owner_idx", "business_bridge_declarations_owner_date_idx", "business_capital_events_ownership_change_uk", "business_dcf_assumptions_business_owner_idx", "business_dcf_periods_dcf_idx", "business_ebitda_adjustments_user_idx", "business_bridge_items_user_idx", "business_dcf_assumptions_user_idx", "business_dcf_periods_user_idx", "business_holdings_user_idx", "business_ownership_user_idx",
  "documents_id_user_uidx", "documents_owner_storage_path_uidx", "import_sources_account_provider_uidx", "import_sources_id_user_uidx", "import_sources_user_idx", "import_sources_account_idx", "import_sessions_committed_file_uidx", "import_sessions_id_user_uidx", "import_sessions_source_idx", "import_sessions_user_idx", "import_sessions_document_idx", "import_raw_records_id_user_uidx", "import_raw_records_session_idx", "import_normalized_records_match_key_idx", "import_normalized_records_committed_external_uidx", "import_normalized_records_id_user_uidx", "import_normalized_records_session_idx", "import_normalized_records_raw_idx", "import_normalized_records_account_idx", "import_normalized_records_matched_idx", "import_normalized_records_user_idx", "import_record_links_session_idx", "import_record_links_normalized_idx", "import_record_links_transaction_idx", "import_record_links_user_idx", "import_column_mappings_user_idx",
  "business_financials_id_user_uidx", "import_sources_business_provider_uidx", "import_sources_business_idx", "import_record_links_business_idx", "fec_entry_lines_id_user_uidx", "fec_entry_lines_session_idx", "fec_entry_lines_raw_idx", "fec_entry_lines_business_idx", "fec_entry_lines_account_idx", "fec_entry_lines_group_idx", "fec_entry_lines_entry_idx", "fec_entry_lines_user_idx",
] as const;
const forbiddenIndexes = ["net_worth_snapshot_items_owner_snapshot_idx", "business_valuations_effective_uk"] as const;
const requiredTriggers = ["real_estate_financing_links_allocation_guard", "import_raw_records_immutable", "import_normalized_records_frozen", "import_record_links_immutable", "fec_entry_lines_frozen"] as const;
const requiredTriggerFunctions = ["real_estate_allocation_guard", "import_raw_record_immutable", "import_normalized_record_frozen", "import_record_link_immutable", "fec_entry_line_frozen"] as const;

const requiredConstraints = [
  "scenarios_investment_allocation_rate_ck", "expense_categories_cash_flow_kind_ck", "expense_categories_essentiality_ck", "expense_categories_behavior_ck", "transactions_kind_override_ck", "recurring_rules_frequency_ck", "recurring_rules_day_ck", "profiles_ledger_coverage_source_ck", "liabilities_deferral_kind_ck", "liabilities_deferral_months_ck", "liabilities_deferral_interest_ck", "loan_early_repayments_outcome_ck", "loan_early_repayments_amount_ck", "liabilities_amortisation_profile_ck", "liabilities_payment_frequency_ck", "liabilities_interest_convention_ck", "liabilities_rate_type_ck", "loan_rate_changes_kind_ck", "loan_payment_changes_kind_ck", "loan_payment_changes_amount_ck", "net_worth_snapshots_version_ck", "net_worth_snapshots_completeness_ck", "net_worth_snapshot_items_owner_fk", "portfolio_events_type_ck", "portfolio_events_security_shape_ck", "portfolio_events_quantity_shape_ck", "portfolio_events_matched_lot_ck", "portfolio_events_counterparty_ck", "portfolio_events_data_kind_ck", "portfolio_events_settlement_ck", "portfolio_events_account_fk", "portfolio_events_security_fk", "portfolio_events_counterparty_fk", "portfolio_events_transaction_fk", "portfolio_events_lot_target_uk", "portfolio_events_matched_lot_fk", "portfolio_envelope_policies_method_ck", "portfolio_envelope_policies_coverage_source_ck", "portfolio_envelope_policies_coverage_pair_ck", "portfolio_envelope_policies_account_fk", "portfolio_envelope_policies_account_uk", "properties_usage_ck", "properties_ownership_share_ck", "properties_disposal_after_acquisition_ck", "real_estate_valuations_property_fk", "real_estate_valuations_value_ck", "real_estate_valuations_method_ck", "real_estate_valuations_data_kind_ck", "real_estate_capital_events_property_fk", "real_estate_capital_events_transaction_fk", "real_estate_capital_events_amount_ck", "real_estate_capital_events_type_ck", "real_estate_capital_events_data_kind_ck", "real_estate_operating_terms_property_fk", "real_estate_operating_terms_effective_uk", "real_estate_operating_terms_amounts_ck", "real_estate_operating_terms_rates_ck", "real_estate_operating_terms_management_exclusive_ck", "real_estate_operating_terms_data_kind_ck", "real_estate_financing_links_property_fk", "real_estate_financing_links_liability_fk", "real_estate_financing_links_pair_uk", "real_estate_financing_links_share_ck", "transactions_property_fk", "business_ownership_business_fk", "business_financials_business_fk", "business_valuations_business_fk", "business_ownership_rates_v2_ck", "business_ownership_shares_ck", "business_ownership_origin_event_fk", "business_valuations_basis_v2_ck", "business_valuations_method_ck", "business_valuations_multiple_ck", "business_valuations_metric_basis_ck", "business_valuations_round_ck", "businesses_capital_history_source_ck", "businesses_capital_history_start_ck", "business_financials_period_kind_ck", "business_financials_period_order_ck", "business_financials_non_negative_ck", "business_capital_events_business_fk", "business_capital_events_transaction_fk", "business_capital_events_amount_ck", "business_capital_events_type_v2_ck", "business_capital_events_amount_scope_ck", "business_capital_events_scope_domain_ck", "business_capital_events_fees_ck", "business_capital_events_ownership_after_ck", "business_capital_events_ownership_delta_ck", "business_ebitda_adjustments_business_fk", "business_ebitda_adjustments_category_ck", "business_ebitda_adjustments_data_kind_ck", "business_ebitda_adjustments_label_uk", "business_bridge_items_business_fk", "business_bridge_items_category_ck", "business_bridge_items_data_kind_ck", "business_bridge_items_label_uk", "business_bridge_declarations_business_fk", "business_bridge_declarations_status_ck", "business_bridge_declarations_effective_uk", "business_dcf_assumptions_business_fk", "business_dcf_assumptions_wacc_ck", "business_dcf_assumptions_tax_ck", "business_dcf_assumptions_terminal_ck", "business_dcf_assumptions_convention_ck", "business_dcf_assumptions_effective_uk", "business_dcf_periods_year_ck", "business_dcf_periods_non_negative_ck", "business_dcf_periods_year_uk", "business_holdings_parent_fk", "business_holdings_child_fk", "business_holdings_no_self_ck", "business_holdings_rate_ck", "business_holdings_effective_uk",
  "import_sources_account_fk", "import_sources_business_fk", "import_sources_kind_ck", "import_sources_domain_v2_ck", "import_sources_status_ck", "import_sources_data_kind_ck", "import_sources_domain_shape_v2_ck", "import_sources_coverage_order_ck",
  "import_sessions_source_fk", "import_sessions_document_fk", "import_sessions_status_v2_ck", "import_sessions_fiscal_year_ck", "import_sessions_entry_counts_ck", "import_sessions_counts_ck", "import_sessions_committed_shape_ck", "import_sessions_file_hash_ck", "import_sessions_declared_period_ck", "import_sessions_observed_period_ck",
  "import_raw_records_session_fk", "import_raw_records_row_uk", "import_raw_records_row_number_ck", "import_raw_records_cells_ck",
  "import_normalized_records_session_fk", "import_normalized_records_raw_fk", "import_normalized_records_account_fk", "import_normalized_records_matched_fk", "import_normalized_records_raw_uk", "import_normalized_records_domain_ck", "import_normalized_records_status_ck", "import_normalized_records_verdict_ck", "import_normalized_records_commit_state_ck", "import_normalized_records_data_kind_ck", "import_normalized_records_issues_ck", "import_normalized_records_ready_shape_ck", "import_normalized_records_committable_ck",
  "import_record_links_session_fk", "import_record_links_normalized_fk", "import_record_links_transaction_fk", "import_record_links_business_fk", "import_record_links_normalized_uk", "import_record_links_transaction_uk", "import_record_links_business_session_uk", "import_record_links_domain_v2_ck", "import_record_links_target_v2_ck",
  "fec_entry_lines_session_fk", "fec_entry_lines_raw_fk", "fec_entry_lines_business_fk", "fec_entry_lines_raw_uk", "fec_entry_lines_status_ck", "fec_entry_lines_commit_state_ck", "fec_entry_lines_data_kind_ck", "fec_entry_lines_issues_ck", "fec_entry_lines_pcg_class_ck", "fec_entry_lines_amount_sign_ck", "fec_entry_lines_amount_shape_ck", "fec_entry_lines_currency_ck", "fec_entry_lines_committable_ck",
  "import_column_mappings_signature_uk", "import_column_mappings_headers_ck", "import_column_mappings_mapping_ck", "import_column_mappings_version_ck",
] as const;

const requiredRpcs: Record<string, string> = {
  lfo_add_account: "p_user_id uuid, p_institution text, p_name text, p_account_type text, p_balance numeric, p_currency text, p_as_of_date date",
  lfo_add_transaction: "p_user_id uuid, p_account_id uuid, p_category_id uuid, p_transaction_date date, p_label text, p_amount numeric, p_currency text, p_update_balance boolean",
  lfo_update_scenario: "p_user_id uuid, p_scenario_id uuid, p_patch jsonb, p_updated_at timestamp with time zone",
  lfo_duplicate_scenario: "p_user_id uuid, p_scenario_id uuid, p_now timestamp with time zone",
  lfo_create_monthly_close: "p_user_id uuid, p_close_date date, p_gross_assets numeric, p_debt numeric, p_net_worth numeric, p_forecast_net_worth numeric, p_variance numeric",
  lfo_add_category: "p_user_id uuid, p_name text, p_group_name text, p_cash_flow_kind text, p_essentiality text, p_expense_behavior text, p_as_of_date date",
  lfo_close_cash_flow_month: "p_user_id uuid, p_month text, p_income numeric, p_consumer_expenses numeric, p_essential_expenses numeric, p_taxes_paid numeric, p_debt_service_paid numeric, p_investment_flows numeric, p_internal_transfers numeric, p_operating_surplus_before_debt numeric, p_post_debt_surplus numeric, p_unclassified_transaction_count integer",
  lfo_save_simulation: "p_user_id uuid, p_scenario_id uuid, p_seed integer, p_simulations integer, p_years integer, p_methodology text, p_points jsonb",
  lfo_save_debt_contract: "p_user_id uuid, p_payload jsonb",
  lfo_record_debt_balance: "p_user_id uuid, p_liability_id uuid, p_observed_at date, p_balance numeric, p_notes text",
  lfo_archive_debt: "p_user_id uuid, p_liability_id uuid",
  lfo_create_monthly_close_v2: "p_user_id uuid, p_close_date date, p_snapshot jsonb, p_items jsonb, p_forecast_net_worth numeric, p_variance numeric",
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
  lfo_attribute_transaction_to_property: "p_user_id uuid, p_transaction_id uuid, p_property_id uuid",
  lfo_save_business: "p_user_id uuid, p_payload jsonb",
  lfo_archive_business: "p_user_id uuid, p_business_id uuid",
  lfo_record_business_ownership: "p_user_id uuid, p_payload jsonb",
  lfo_record_business_financials: "p_user_id uuid, p_payload jsonb",
  lfo_record_business_valuation: "p_user_id uuid, p_payload jsonb",
  lfo_record_business_capital_event: "p_user_id uuid, p_payload jsonb",
  lfo_set_business_holding: "p_user_id uuid, p_payload jsonb",
  lfo_delete_business_holding: "p_user_id uuid, p_holding_id uuid",
  lfo_delete_business_ownership: "p_user_id uuid, p_ownership_id uuid",
  lfo_delete_business_financials: "p_user_id uuid, p_financials_id uuid",
  lfo_delete_business_valuation: "p_user_id uuid, p_valuation_id uuid",
  lfo_delete_business_capital_event: "p_user_id uuid, p_event_id uuid",
  lfo_record_business_ebitda_adjustment: "p_user_id uuid, p_payload jsonb",
  lfo_delete_business_ebitda_adjustment: "p_user_id uuid, p_adjustment_id uuid",
  lfo_record_business_bridge_item: "p_user_id uuid, p_payload jsonb",
  lfo_delete_business_bridge_item: "p_user_id uuid, p_item_id uuid",
  lfo_set_business_dcf: "p_user_id uuid, p_payload jsonb",
  lfo_delete_business_dcf: "p_user_id uuid, p_dcf_id uuid",
  lfo_apply_business_funding_round: "p_user_id uuid, p_payload jsonb",
  lfo_create_business_quick_start: "p_user_id uuid, p_payload jsonb",
  lfo_analyze_import_session: "p_user_id uuid, p_payload jsonb",
  lfo_commit_import_session: "p_user_id uuid, p_payload jsonb",
  lfo_discard_import_session: "p_user_id uuid, p_session_id uuid",
  lfo_attach_import_document: "p_user_id uuid, p_payload jsonb",
  lfo_save_import_mapping: "p_user_id uuid, p_payload jsonb",
  lfo_open_fec_session: "p_user_id uuid, p_payload jsonb",
  lfo_append_fec_lines: "p_user_id uuid, p_payload jsonb",
  lfo_finalize_fec_session: "p_user_id uuid, p_payload jsonb",
  lfo_commit_fec_session: "p_user_id uuid, p_payload jsonb",
};

/**
 * Tables de la piste d'audit d'acquisition. `authenticated` n'y a que le SELECT : toute
 * écriture passe par une RPC réservée à `service_role`.
 *
 * Ce contrôle n'est pas cosmétique. Une piste d'audit sur laquelle le client peut écrire
 * n'est pas une piste d'audit : un DELETE direct sur un enregistrement brut ou sur un lien
 * de provenance laisserait survivre une transaction étiquetée « importée » dont l'origine
 * aurait disparu. Une migration ultérieure qui referait un `grant ... on all tables`
 * rouvrirait la brèche en silence ; le gate la refuse.
 */
const readOnlyAuditTables = [
  "import_sources",
  "import_sessions",
  "import_raw_records",
  "import_normalized_records",
  "import_record_links",
  "import_column_mappings",
  "fec_entry_lines",
] as const;

const storagePolicies = ["documents_owner_select", "documents_owner_insert", "documents_owner_update", "documents_owner_delete"] as const;

function addMissing(failures: string[], label: string, expected: readonly string[], actual: Iterable<string>): void {
  const missing = missingFrom(expected, actual);
  if (missing.length > 0) failures.push(`${label} manquant(s) : ${missing.join(", ")}`);
}
function addExactInventory(failures: string[], label: string, expected: readonly string[], actual: Iterable<string>): void {
  failures.push(...diffExactInventory(label, expected, actual));
}

const connectionString = required("SUPABASE_DB_URL");
const connectionUrl = new URL(connectionString);
const localHost = ["localhost", "127.0.0.1", "::1"].includes(connectionUrl.hostname);
const client = new Client({ connectionString, ssl: localHost || connectionUrl.searchParams.get("sslmode") === "disable" ? false : true });
const failures: string[] = [];

try {
  await client.connect();
  await client.query("begin read only");
  await client.query("set local statement_timeout = '15s'");

  const columns = await client.query<{ table_name: string; column_name: string }>(`select table_name, column_name from information_schema.columns where table_schema = 'public'`);
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of columns.rows) {
    const tableColumns = columnsByTable.get(row.table_name) ?? new Set<string>();
    tableColumns.add(row.column_name);
    columnsByTable.set(row.table_name, tableColumns);
  }
  addMissing(failures, "Table(s)", userOwnedTables, columnsByTable.keys());
  for (const [table, expected] of Object.entries(requiredColumns)) addMissing(failures, `Colonne(s) de public.${table}`, expected, columnsByTable.get(table) ?? []);

  const constraints = await client.query<{ conname: string }>(`select con.conname from pg_catalog.pg_constraint con join pg_catalog.pg_class rel on rel.oid = con.conrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = 'public'`);
  addMissing(failures, "Contrainte(s)", requiredConstraints, constraints.rows.map((row) => row.conname));

  const indexes = await client.query<{ indexname: string }>(`select indexname from pg_catalog.pg_indexes where schemaname = 'public'`);
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  addMissing(failures, "Index", requiredIndexes, indexNames);
  for (const index of forbiddenIndexes) if (indexNames.has(index)) failures.push(`Index remplacé toujours présent : public.${index}`);

  const triggers = await client.query<{ tgname: string }>(`select tg.tgname from pg_catalog.pg_trigger tg join pg_catalog.pg_class rel on rel.oid = tg.tgrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = 'public' and not tg.tgisinternal`);
  addMissing(failures, "Trigger(s)", requiredTriggers, triggers.rows.map((row) => row.tgname));
  const triggerFunctions = await client.query<{ proname: string }>(`select pr.proname from pg_catalog.pg_proc pr join pg_catalog.pg_namespace ns on ns.oid = pr.pronamespace where ns.nspname = 'public' and pr.prorettype = 'pg_catalog.trigger'::regtype`);
  addMissing(failures, "Fonction(s) de trigger", requiredTriggerFunctions, triggerFunctions.rows.map((row) => row.proname));

  const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(`select rel.relname, rel.relrowsecurity from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = 'public' and rel.relkind = 'r'`);
  const rlsByTable = new Map(rls.rows.map((row) => [row.relname, row.relrowsecurity]));
  for (const table of userOwnedTables) if (rlsByTable.get(table) !== true) failures.push(`RLS inactif : public.${table}`);

  const policies = await client.query<{ tablename: string; policyname: string; roles: string[]; cmd: string; qual: string | null; with_check: string | null }>(`select tablename, policyname, roles::text[], cmd, qual, with_check from pg_catalog.pg_policies where schemaname = 'public'`);
  for (const table of userOwnedTables) {
    const policy = policies.rows.find((row) => row.tablename === table && row.policyname === "owner_all");
    const ownerPredicate = (value: string | null) => Boolean(value?.includes("auth.uid()") && value.includes("user_id"));
    if (!policy) failures.push(`Policy owner_all absente : public.${table}`);
    else if (policy.cmd !== "ALL" || !policy.roles.includes("authenticated") || !ownerPredicate(policy.qual) || !ownerPredicate(policy.with_check)) failures.push(`Policy owner_all invalide : public.${table}`);
  }

  const auditGrants = await client.query<{ table_name: string; privilege_type: string }>(`
    select table_name, privilege_type
      from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated'`);
  const grantsByTable = new Map<string, Set<string>>();
  for (const row of auditGrants.rows) {
    const grants = grantsByTable.get(row.table_name) ?? new Set<string>();
    grants.add(row.privilege_type);
    grantsByTable.set(row.table_name, grants);
  }
  for (const table of readOnlyAuditTables) {
    const grants = grantsByTable.get(table) ?? new Set<string>();
    if (!grants.has("SELECT")) failures.push(`Piste d'audit illisible par authenticated : public.${table}`);
    const writes = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].filter((privilege) => grants.has(privilege));
    if (writes.length > 0) {
      failures.push(`Piste d'audit inscriptible par authenticated : public.${table} (${writes.join(", ")})`);
    }
  }

  const rpcs = await client.query<{ name: string; arguments: string; result_type: string; security_definer: boolean; settings: string[] | null; anon_execute: boolean; authenticated_execute: boolean; service_role_execute: boolean }>(`
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
     where ns.nspname = 'public' and proc.proname like 'lfo\\_%' escape '\\'`);
  addMissing(failures, "RPC lfo_*", Object.keys(requiredRpcs), rpcs.rows.map((row) => row.name));
  const unexpectedRpcs = rpcs.rows.filter((row) => !(row.name in requiredRpcs));
  if (unexpectedRpcs.length > 0) failures.push(`RPC lfo_* inattendue(s) : ${unexpectedRpcs.map((row) => row.name).join(", ")}`);
  for (const rpc of rpcs.rows) {
    const expectedArguments = requiredRpcs[rpc.name];
    if (!expectedArguments) continue;
    if (rpc.arguments !== expectedArguments) failures.push(`Signature RPC invalide : ${rpc.name}(${rpc.arguments}), attendu ${rpc.name}(${expectedArguments})`);
    if (rpc.result_type !== "uuid") failures.push(`Type de retour RPC invalide : ${rpc.name}`);
    if (rpc.security_definer) failures.push(`RPC SECURITY DEFINER interdite : ${rpc.name}`);
    if (!rpc.settings?.some((setting) => setting === 'search_path=""')) failures.push(`search_path non verrouillé : ${rpc.name}`);
    if (rpc.anon_execute) failures.push(`RPC exécutable par anon : ${rpc.name}`);
    if (rpc.authenticated_execute) failures.push(`RPC exécutable par authenticated : ${rpc.name}`);
    if (!rpc.service_role_execute) failures.push(`RPC non exécutable par service_role : ${rpc.name}`);
  }

  const bucket = await client.query<{ id: string; public: boolean; file_size_limit: number | null }>(`select id, public, file_size_limit from storage.buckets where id = 'family-office-documents'`);
  const documentsBucket = bucket.rows[0];
  if (!documentsBucket) failures.push("Bucket Storage absent : family-office-documents");
  else {
    if (documentsBucket.public) failures.push("Bucket Storage public : family-office-documents");
    if (Number(documentsBucket.file_size_limit) !== 8_388_608) failures.push("Limite du bucket Storage invalide : family-office-documents");
  }
  const storagePolicyRows = await client.query<{ policyname: string }>(`select policyname from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'`);
  addMissing(failures, "Policy(s) Storage", storagePolicies, storagePolicyRows.rows.map((row) => row.policyname));

  const migrations = await client.query<{ version: string }>(`select version from supabase_migrations.schema_migrations order by version`);
  addExactInventory(failures, "Migration(s) distante(s)", canonicalMigrations, migrations.rows.map((row) => row.version));
  await client.query("rollback");
} catch (error) {
  try { await client.query("rollback"); } catch { /* connexion possiblement interrompue avant BEGIN */ }
  throw error;
} finally {
  await client.end();
}

if (failures.length > 0) {
  throw new Error(`Schéma Supabase non conforme (${failures.length} contrôle(s) en échec) :\n- ${failures.join("\n- ")}`);
}

console.log(`Schéma Supabase vérifié en lecture seule : ${userOwnedTables.length} tables, ${requiredConstraints.length} contraintes, ${Object.keys(requiredRpcs).length} RPC, ${requiredTriggers.length} trigger(s) d'invariant, ${readOnlyAuditTables.length} tables d'audit en lecture seule, RLS/policies, Storage, index de snapshot et ${canonicalMigrations.length} migrations conformes.`);
