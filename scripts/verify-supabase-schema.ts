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
  "20260827215014",
  "20260827215600",
  "20260828131216",
  "20260828131433",
  "20260829234017",
  "20260829234053",
  "20260829234259",
  "20260830154315",
  "20260831101500",
  "20260831154500",
  "20260831171500",
  "20260902093000",
  "20260903090000",
  "20260903120000",
  "20260903120500",
  "20260903190000",
  "20260903200000",
  "20260904093000",
  "20260905090000",
] as const;

const requiredColumns: Record<string, string[]> = {
  profiles: ["user_id", "ledger_coverage_start", "ledger_coverage_source"],
  scenarios: [
    "id",
    "scenario_status",
    "archived_at",
    "investment_allocation_rate",
    "annual_return",
    "annual_volatility",
    "monthly_savings",
  ],
  goals: [
    "id",
    "user_id",
    "name",
    "description",
    "target_amount",
    "target_date",
    "priority",
    "status",
    "current_version",
    "constraint_strength",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  goal_versions: ["id", "user_id", "goal_id", "version", "payload", "created_at"],
  decision_cases: [
    "id",
    "user_id",
    "name",
    "description",
    "decision_type",
    "inputs",
    "results",
    "status",
    "as_of_date",
    "horizon_months",
    "current_version",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  decision_case_versions: ["id", "user_id", "case_id", "version", "payload", "created_at"],
  decision_runs: [
    "id",
    "user_id",
    "case_id",
    "case_version",
    "run_snapshot",
    "result_snapshot",
    "baseline_fingerprint",
    "methodology_version",
    "as_of_date",
    "horizon_months",
    "run_mode",
    "seed",
    "stale_status",
    "completeness",
    "created_at",
  ],
  expense_categories: ["id", "cash_flow_kind", "essentiality", "expense_behavior", "archived"],
  transactions: ["id", "kind_override", "transfer_group_id", "property_id"],
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
  simulation_runs: [
    "id",
    "scenario_id",
    "scenario_version",
    "seed",
    "simulations",
    "years",
    "methodology",
    "as_of_date",
    "baseline_reference",
    "event_set_version",
    "assumptions_snapshot",
    "run_mode",
    "horizon_months",
    "methodology_version",
    "definition_snapshot",
  ],
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
    "snapshot_id",
    "derivation",
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
  businesses: [
    "id",
    "business_type",
    "functional_currency",
    "archived",
    "data_kind",
    "confidence",
    "sector",
    "country",
    "founded_on",
    "capital_history_start",
    "capital_history_source",
    "siren",
    "naf_code",
  ],
  business_ownership: [
    "id",
    "business_id",
    "ownership_rate",
    "economic_rate",
    "voting_rate",
    "fully_diluted_rate",
    "effective_date",
    "data_kind",
    "confidence",
    "shares_held",
    "shares_outstanding",
    "fully_diluted_shares",
    "share_class",
    "origin_event_id",
  ],
  business_financials: [
    "id",
    "business_id",
    "period_end",
    "currency",
    "revenue",
    "ebitda",
    "cash",
    "debt",
    "ebit",
    "net_income",
    "capex",
    "free_cash_flow",
    "data_kind",
    "confidence",
    "period_kind",
    "period_start",
    "period_label",
    "gross_profit",
    "depreciation_amortisation",
    "interest_expense",
    "tax_expense",
  ],
  business_valuations: [
    "id",
    "business_id",
    "valuation_date",
    "method",
    "currency",
    "enterprise_value",
    "equity_value",
    "valuation_multiple",
    "data_kind",
    "confidence",
    "multiple_low",
    "multiple_high",
    "metric_basis",
    "metric_period_end",
    "pre_money_equity_value",
    "primary_new_money",
    "secondary_amount",
    "investor_contribution",
    "preferred_rights_known",
  ],
  business_capital_events: [
    "id",
    "business_id",
    "event_type",
    "event_date",
    "amount",
    "currency",
    "ownership_delta",
    "transaction_id",
    "data_kind",
    "confidence",
    "amount_scope",
    "fees",
    "ownership_rate_after",
    "shares_delta",
    "price_per_share",
    "label",
  ],
  business_holdings: [
    "id",
    "parent_business_id",
    "child_business_id",
    "effective_date",
    "ownership_rate",
    "data_kind",
    "confidence",
  ],
  business_ebitda_adjustments: [
    "id",
    "user_id",
    "business_id",
    "period_end",
    "category",
    "label",
    "amount",
    "currency",
    "recurring",
    "data_kind",
    "confidence",
  ],
  business_bridge_items: [
    "id",
    "user_id",
    "business_id",
    "effective_date",
    "category",
    "label",
    "amount",
    "currency",
    "data_kind",
    "confidence",
  ],
  business_bridge_declarations: [
    "id",
    "user_id",
    "business_id",
    "effective_date",
    "status",
    "data_kind",
    "confidence",
    "source",
    "notes",
  ],
  business_dcf_assumptions: [
    "id",
    "user_id",
    "business_id",
    "valuation_date",
    "currency",
    "wacc",
    "tax_rate",
    "terminal_method",
    "terminal_growth",
    "terminal_exit_multiple",
    "terminal_exit_metric",
    "discount_convention",
  ],
  business_dcf_periods: [
    "id",
    "user_id",
    "dcf_id",
    "year_index",
    "revenue",
    "ebitda",
    "ebit",
    "depreciation_amortisation",
    "capex",
    "working_capital_change",
  ],
  import_upload_tickets: [
    "id",
    "user_id",
    "domain",
    "storage_path",
    "file_name",
    "content_type",
    "byte_size",
    "created_at",
    "expires_at",
    "consumed_at",
    "consumed_session_id",
    "consumed_run_id",
  ],
  fec_entry_lines: [
    "id",
    "user_id",
    "session_id",
    "raw_record_id",
    "business_id",
    "journal_code",
    "journal_lib",
    "entry_num",
    "entry_date",
    "account_num",
    "account_lib",
    "aux_account_num",
    "aux_account_lib",
    "piece_ref",
    "piece_date",
    "entry_label",
    "debit",
    "credit",
    "lettering_code",
    "lettering_date",
    "validation_date",
    "currency_amount",
    "currency_code",
    "pcg_class",
    "pcg_group",
    "status",
    "issues",
    "commit_state",
    "committed_at",
    "data_kind",
    "confidence",
  ],
  import_sources: [
    "id",
    "user_id",
    "kind",
    "domain",
    "provider",
    "label",
    "target_account_id",
    "target_business_id",
    "status",
    "adapter_version",
    "coverage_start",
    "coverage_end",
    "last_attempt_at",
    "last_success_at",
    "last_error",
    "data_kind",
    "confidence",
  ],
  import_sessions: [
    "id",
    "user_id",
    "source_id",
    "file_name",
    "file_hash",
    "file_size_bytes",
    "content_type",
    "encoding",
    "delimiter",
    "parser",
    "parser_version",
    "mapping",
    "conventions",
    "declared_currency",
    "observation_date",
    "stable_transaction_id_declared",
    "retain_file_requested",
    "declared_period_start",
    "declared_period_end",
    "observed_period_start",
    "observed_period_end",
    "fiscal_year_start",
    "fiscal_year_end",
    "coverage_declared",
    "entry_count",
    "unbalanced_entry_count",
    "staging_storage_path",
    "staging_cleanup_failed_at",
    "status",
    "row_count",
    "ready_count",
    "warning_count",
    "blocked_count",
    "duplicate_count",
    "ignored_count",
    "committed_count",
    "document_id",
    "issues",
    "analyzed_at",
    "committed_at",
    "discarded_at",
  ],
  import_raw_records: ["id", "user_id", "session_id", "row_number", "raw_line", "cells"],
  import_normalized_records: [
    "id",
    "user_id",
    "session_id",
    "raw_record_id",
    "target_domain",
    "account_id",
    "transaction_date",
    "value_date",
    "label",
    "amount",
    "currency",
    "external_transaction_id",
    "reference",
    "counterparty",
    "balance_after",
    "status",
    "dedupe_verdict",
    "match_key",
    "external_key",
    "matched_transaction_id",
    "issues",
    "commit_state",
    "committed_at",
    "data_kind",
    "confidence",
    "event_type",
    "security_id",
    "quantity",
    "unit_price",
    "gross_amount",
    "fee_amount",
    "tax_amount",
    "envelope_cash_amount",
    "market_value",
    "cost_basis",
    "instrument_source_key",
    "source_isin",
    "portfolio_event_id",
    "position_snapshot_id",
    "field_corrections",
    "corrected_at",
  ],
  // Piste IMMUABLE des corrections d'observations de position. Chaque colonne est un
  // fait distinct : l'identité DÉCLARÉE n'est pas l'identité CONSTATÉE, l'avant n'est pas
  // l'après, et « quelque chose a changé » ne dit pas quels champs.
  position_snapshot_corrections: [
    "id",
    "user_id",
    "session_id",
    "normalized_record_id",
    "position_snapshot_id",
    // ACTEUR VÉRIFIÉ, jamais reçu du navigateur. `decided_by` a été SUPPRIMÉE : une identité
    // déclarée librement par le client n'est pas une identité, et la garder à côté d'un rôle
    // constaté produisait deux vérités sur la même question.
    "actor_user_id",
    "executed_by",
    "reason",
    "before_values",
    "after_values",
    "changed_fields",
    "decided_at",
  ],
  import_record_links: [
    "id",
    "user_id",
    "session_id",
    "normalized_record_id",
    "target_domain",
    "transaction_id",
    "business_financials_id",
    "extraction_run_id",
    "portfolio_event_id",
    "position_snapshot_id",
  ],
  import_column_mappings: [
    "id",
    "user_id",
    "signature",
    "provider",
    "label",
    "headers",
    "mapping",
    "conventions",
    "version",
    "confirmed_at",
  ],
  career_roles: [
    "id",
    "user_id",
    "employer",
    "job_title",
    "employment_type",
    "industry",
    "country",
    "currency",
    "start_date",
    "end_date",
    "status",
    "data_kind",
    "confidence",
    "source",
    "notes",
  ],
  career_compensation_terms: [
    "id",
    "user_id",
    "role_id",
    "base_salary",
    "frequency",
    "guaranteed_bonus",
    "target_bonus",
    "target_bonus_rate",
    "discretionary_bonus",
    "commissions",
    "profit_sharing",
    "participation",
    "employer_benefits",
    "allowances",
    "other_taxable_compensation",
    "other_non_taxable_compensation",
    "working_time",
    "effective_from",
    "effective_to",
    "data_kind",
    "confidence",
    "source",
    "notes",
  ],
  career_events: [
    "id",
    "user_id",
    "role_id",
    "event_type",
    "event_date",
    "amount",
    "currency",
    "variable_state",
    "paid_date",
    "label",
    "data_kind",
    "confidence",
    "source",
    "notes",
  ],
  career_equity_grants: [
    "id",
    "user_id",
    "role_id",
    "company",
    "instrument_type",
    "grant_date",
    "quantity",
    "strike_price",
    "currency",
    "vesting_schedule",
    "expiry_date",
    "liquidity_status",
    "data_kind",
    "confidence",
    "source",
    "notes",
  ],
  career_scenarios: [
    "id",
    "user_id",
    "name",
    "scenario_type",
    "effective_from",
    "role_id",
    "assumptions",
    "data_kind",
    "confidence",
    "source",
    "notes",
  ],
  tax_profiles: [
    "id",
    "user_id",
    "effective_from",
    "effective_to",
    "jurisdiction",
    "marital_status",
    "dependants",
    "tax_shares",
    "withholding_settings",
    "social_contribution_regime",
    "professional_status",
    "special_regime",
    "source",
    "confidence",
    "notes",
  ],
  tax_rule_sets: [
    "id",
    "user_id",
    "jurisdiction",
    "tax_year",
    "name",
    "effective_from",
    "effective_to",
    "source",
    "source_date",
    "confidence",
    "status",
    "legal_reference",
    "notes",
  ],
  tax_rules: [
    "id",
    "user_id",
    "rule_set_id",
    "tax_type",
    "income_category",
    "effective_from",
    "effective_to",
    "source_date",
    "legal_note",
    "notes",
  ],
  tax_observations: [
    "id",
    "user_id",
    "observation_type",
    "observed_date",
    "tax_year",
    "amount",
    "currency",
    "transaction_id",
    "document_id",
    "data_kind",
    "confidence",
    "source",
    "notes",
  ],
  tax_income_items: [
    "id",
    "user_id",
    "income_category",
    "recognition_date",
    "cash_date",
    "gross_amount",
    "currency",
    "career_role_id",
    "career_event_id",
    "transaction_id",
    "data_kind",
    "confidence",
    "source",
    "notes",
  ],
  // ── Acquisition du registre d'entreprises ───────────────────────────────────────────
  // Les colonnes listées sont celles dont la DISPARITION changerait un invariant : identité,
  // provenance, fraîcheur, état de décision. Une colonne d'agrément n'y figure pas.
  external_sources: [
    "id",
    "user_id",
    "domain",
    "provider",
    "adapter_version",
    "capabilities",
    "auth_mode",
    "credential_env_var",
    "rate_limit_per_minute",
    "snapshot_ttl_minutes",
    "last_checked_at",
    "last_success_at",
    "last_error",
    "dataset_version",
    "declared_coverage",
  ],
  company_registry_snapshots: [
    "id",
    "user_id",
    "external_source_id",
    "provider",
    "endpoint",
    "query",
    "siren",
    "siret",
    "http_status",
    "payload",
    "payload_hash",
    "schema_version",
    "observed_at",
    "effective_at",
    "provider_updated_at",
    "stale_after",
    "error_code",
    "error_message",
    "data_kind",
    "confidence",
  ],
  company_registry_profiles: [
    "id",
    "user_id",
    "snapshot_id",
    "provider",
    "siren",
    "legal_name",
    "legal_form_code",
    "legal_form_label",
    "naf_code",
    "naf_label",
    "share_capital",
    "share_capital_currency",
    "created_on",
    "ceased_on",
    "registry_status",
    "head_office_siret",
    "establishment_count",
    "issues",
    "data_kind",
  ],
  company_registry_officers: [
    "id",
    "user_id",
    "snapshot_id",
    "position_index",
    "officer_kind",
    "last_name",
    "first_names",
    "birth_year",
    "role_label",
    "company_siren",
    "company_name",
  ],
  company_registry_establishments: [
    "id",
    "user_id",
    "snapshot_id",
    "siret",
    "is_head_office",
    "establishment_status",
    "naf_code",
  ],
  company_registry_documents: [
    "id",
    "user_id",
    "snapshot_id",
    "document_kind",
    "fiscal_year_end",
    "filing_date",
    "confidentiality",
    "download_available",
    "document_id",
    "retrieved_at",
  ],
  business_registry_links: [
    "id",
    "user_id",
    "business_id",
    "provider",
    "siren",
    "siret",
    "linked_snapshot_id",
    "match_basis",
    "linked_at",
  ],
  business_enrichment_decisions: [
    "id",
    "user_id",
    "business_id",
    "snapshot_id",
    "field_path",
    "candidate_value",
    "canonical_value_before",
    "state",
    "decided_at",
    "decided_reason",
    "superseded_by",
  ],
  // ── Document Intelligence, et première verticale : la liasse fiscale ────────────────
  // Colonnes dont la disparition changerait un invariant : provenance géométrique, valeur
  // brute, correction, cycle de vie, exercice lu.
  document_extraction_runs: [
    "id",
    "user_id",
    "business_id",
    "document_family",
    "detected_kind",
    "detected_variant",
    "detection_basis",
    "extractor",
    "extractor_version",
    "schema_version",
    "pdf_kind",
    "page_count",
    "text_char_count",
    "file_hash",
    "staging_storage_path",
    "staging_cleanup_failed_at",
    "document_id",
    "siren",
    "fiscal_year_start",
    "fiscal_year_end",
    "status",
    "field_count",
    "unknown_box_count",
    "blocked_field_count",
    "corrected_field_count",
    "failed_check_count",
    "not_computable_check_count",
    "supersedes_run_id",
    "issues",
    "validated_at",
    "linked_at",
    "rejected_at",
  ],
  document_extraction_fields: [
    "id",
    "user_id",
    "run_id",
    "page_number",
    "form_code",
    "form_part",
    "box_code",
    "occurrence",
    "label",
    "bbox_x",
    "bbox_y",
    "bbox_width",
    "bbox_height",
    "raw_value",
    "normalized_value",
    "unit",
    "extraction_method",
    "confidence",
    "confidence_score",
    "validation_status",
    "user_value",
    "user_corrected_at",
    "user_reason",
    "issues",
  ],
  document_extraction_checks: [
    "id",
    "user_id",
    "run_id",
    "check_code",
    "severity",
    "status",
    "expected_value",
    "actual_value",
    "difference",
    "tolerance",
    "operands",
    "message",
  ],
  real_estate_data_snapshots: [
    "query",
    "query_hash",
    "payload_hash",
    "retrieved_at",
    "stale_after",
    "record_count",
    "coverage_state",
    "status",
    "error_code",
  ],
  real_estate_comparable_sales: ["mutated_on", "price", "built_area_sqm", "lot_count", "raw"],
  real_estate_energy_certificates: [
    "issued_on",
    "valid_until",
    "method_version",
    "energy_label",
    "energy_value",
    "energy_unit",
    "raw",
  ],
  property_public_data_matches: [
    "target",
    "snapshot_id",
    "certificate_id",
    "match_basis",
    "match_score",
    "match_confidence",
    "state",
    "decided_reason",
    "superseded_by",
  ],
  import_instrument_resolutions: [
    "source_key",
    "state",
    "security_id",
    "basis",
    "decided_at",
    "decided_reason",
  ],
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
  "position_snapshot_corrections",
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
  "business_ebitda_adjustments",
  "business_bridge_items",
  "business_bridge_declarations",
  "business_dcf_assumptions",
  "business_dcf_periods",
  "import_sources",
  "import_sessions",
  "import_raw_records",
  "import_normalized_records",
  "import_record_links",
  "import_column_mappings",
  "career_roles",
  "career_compensation_terms",
  "career_events",
  "career_equity_grants",
  "career_scenarios",
  "tax_rule_sets",
  "tax_observations",
  "tax_income_items",
  "fec_entry_lines",
  "import_upload_tickets",
  "goal_versions",
  "decision_case_versions",
  "decision_runs",
  "company_registry_snapshots",
  "company_registry_profiles",
  "company_registry_officers",
  "company_registry_establishments",
  "company_registry_documents",
  "business_registry_links",
  "business_enrichment_decisions",
  "document_extraction_runs",
  "document_extraction_fields",
  "document_extraction_checks",
  "real_estate_data_snapshots",
  "real_estate_comparable_sales",
  "real_estate_energy_certificates",
  "property_public_data_matches",
  "import_instrument_resolutions",
  // Open Banking (AIS), lecture seule.
  "bank_providers",
  "bank_institutions",
  "bank_consents",
  "bank_provider_accounts",
  "bank_sync_cursors",
  "bank_sync_runs",
  "bank_sync_raw_pages",
  "bank_observed_transactions",
  "bank_balance_observations",
  "bank_reconciliation_decisions",
  // Onzième table Open Banking, ABSENTE de cet inventaire jusqu'ici. L'oubli était
  // silencieux et il a menti dans les deux sens : le gate annonçait « 105 tables » alors
  // que la base en reconstruisait 106, et la RLS comme la policy propriétaire de cette
  // table n'étaient VÉRIFIÉES par personne — elles existaient, mais rien ne le prouvait.
  // Le contrôle d'inventaire exact ajouté plus bas empêche la même dérive de recommencer.
  "bank_sync_events",
] as const;

const requiredIndexes = [
  // ── Réconciliation d'intégration ────────────────────────────────────────────────────
  // Unicité de l'identité démontrée dans le staging : à la VALIDATION, jamais à la LECTURE.
  // Elle remplace deux index concurrents — celui du socle, sans domaine, et celui de la
  // verticale portefeuille, qui interdisait de RELIRE une identité déjà validée.
  // ── Corrections d'observations de position ─────────────────────────────────────────
  // Les trois premiers couvrent les clés étrangères composites ; le quatrième sert la seule
  // lecture qui compte : « l'historique des corrections de CETTE observation ».
  "position_snapshot_corrections_snapshot_idx",
  "position_snapshot_corrections_session_idx",
  "position_snapshot_corrections_record_idx",
  "position_snapshot_corrections_user_idx",
  "import_normalized_records_committed_external_v2_uidx",
  "import_normalized_records_external_key_idx",
  "scenarios_id_user_uidx",
  "scenario_versions_id_user_uidx",
  "simulation_runs_id_user_uidx",
  "scenario_versions_user_scenario_version_idx",
  "scenario_assumptions_user_scenario_key_idx",
  "simulation_runs_user_scenario_created_idx",
  "simulation_runs_scenario_version_idx",
  "simulation_results_user_run_year_idx",
  "net_worth_snapshot_items_snapshot_owner_idx",
  "financial_accounts_id_user_uidx",
  "securities_id_user_uidx",
  "transactions_id_user_uidx",
  "portfolio_events_opening_cash_uk",
  "portfolio_events_opening_position_uk",
  "portfolio_events_account_owner_idx",
  "portfolio_events_matched_lot_covering_idx",
  "properties_id_user_uidx",
  "liabilities_id_user_uidx",
  "real_estate_capital_events_acquisition_uk",
  "real_estate_capital_events_disposal_uk",
  "real_estate_financing_links_liability_idx",
  "real_estate_financing_links_property_idx",
  "real_estate_capital_events_transaction_idx",
  "transactions_property_owner_idx",
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
  "business_financials_effective_uk",
  "business_valuations_effective_method_uk",
  "businesses_user_idx",
  "business_financials_user_idx",
  "business_valuations_user_idx",
  "business_capital_events_user_idx",
  "business_capital_events_id_user_uidx",
  "business_ownership_origin_event_idx",
  "business_ebitda_adjustments_business_owner_idx",
  "business_bridge_items_business_owner_idx",
  "business_bridge_declarations_business_owner_idx",
  "business_bridge_declarations_owner_date_idx",
  "business_capital_events_ownership_change_uk",
  "business_dcf_assumptions_business_owner_idx",
  "business_dcf_periods_dcf_idx",
  "business_ebitda_adjustments_user_idx",
  "business_bridge_items_user_idx",
  "business_dcf_assumptions_user_idx",
  "business_dcf_periods_user_idx",
  "business_holdings_user_idx",
  "business_ownership_user_idx",
  "documents_id_user_uidx",
  "documents_owner_storage_path_uidx",
  "import_sources_account_provider_uidx",
  "import_sources_id_user_uidx",
  "import_sources_user_idx",
  "import_sources_account_idx",
  "import_sessions_committed_file_uidx",
  "import_sessions_id_user_uidx",
  "import_sessions_source_idx",
  "import_sessions_user_idx",
  "import_sessions_document_idx",
  "import_raw_records_id_user_uidx",
  "import_raw_records_session_idx",
  "import_normalized_records_match_key_idx",
  "import_normalized_records_id_user_uidx",
  "import_normalized_records_session_idx",
  "import_normalized_records_raw_idx",
  "import_normalized_records_account_idx",
  "import_normalized_records_matched_idx",
  "import_normalized_records_user_idx",
  "import_record_links_session_idx",
  "import_record_links_normalized_idx",
  "import_record_links_transaction_idx",
  "import_record_links_user_idx",
  "import_column_mappings_user_idx",
  "business_financials_id_user_uidx",
  "import_sources_business_provider_uidx",
  "import_sources_business_idx",
  "import_record_links_business_idx",
  "fec_entry_lines_id_user_uidx",
  "fec_entry_lines_session_idx",
  "fec_entry_lines_raw_idx",
  "fec_entry_lines_business_idx",
  "fec_entry_lines_account_idx",
  "fec_entry_lines_group_idx",
  "fec_entry_lines_entry_idx",
  "fec_entry_lines_user_idx",
  "import_upload_tickets_id_user_uidx",
  "import_upload_tickets_user_idx",
  "import_upload_tickets_open_idx",
  "fec_entry_lines_business_owner_fk_idx",
  "import_upload_tickets_session_owner_fk_idx",
  "income_sources_id_user_uidx",
  "tax_profiles_id_user_uidx",
  "tax_profiles_owner_effective_uidx",
  "tax_rules_id_user_uidx",
  "income_sources_user_idx",
  "tax_profiles_user_idx",
  "tax_rules_user_idx",
  "career_roles_user_date_idx",
  "career_compensation_role_owner_idx",
  "career_events_role_owner_idx",
  "career_events_paid_idx",
  "career_equity_role_owner_idx",
  "career_scenarios_role_owner_idx",
  "tax_rule_sets_user_year_idx",
  "tax_rules_rule_set_owner_idx",
  "tax_observations_user_year_idx",
  "tax_observations_transaction_owner_idx",
  "tax_income_role_owner_idx",
  "tax_income_event_owner_idx",
  "tax_income_transaction_owner_idx",
  "career_equity_grants_user_idx",
  "career_scenarios_user_idx",
  "tax_income_items_user_idx",
  "tax_observations_document_owner_idx",
  "goals_id_user_uidx",
  "goal_versions_id_user_uidx",
  "goals_user_status_priority_idx",
  "goal_versions_user_goal_version_idx",
  "scenario_versions_scenario_owner_fk_idx",
  "scenario_assumptions_scenario_owner_fk_idx",
  "simulation_runs_scenario_owner_fk_idx",
  "simulation_results_run_owner_fk_idx",
  "goal_versions_goal_owner_fk_idx",
  "decision_cases_id_user_uidx",
  "decision_case_versions_id_user_uidx",
  "decision_runs_id_user_uidx",
  "decision_cases_user_status_idx",
  "decision_case_versions_user_case_version_idx",
  "decision_case_versions_case_owner_fk_idx",
  "decision_runs_user_case_created_idx",
  "decision_runs_case_version_idx",
  // Acquisition du registre d'entreprises. `businesses_siren_uidx` est l'invariant le plus
  // important de la liste : sans lui, deux sociétés du patrimoine porteraient le même SIREN
  // et la même participation serait comptée deux fois.
  "businesses_siren_uidx",
  "external_sources_id_user_uidx",
  "external_sources_user_idx",
  "company_registry_snapshots_id_user_uidx",
  "company_registry_snapshots_siren_idx",
  "company_registry_snapshots_source_idx",
  "company_registry_snapshots_user_idx",
  "company_registry_snapshots_failures_idx",
  "company_registry_profiles_id_user_uidx",
  "company_registry_profiles_siren_idx",
  "company_registry_profiles_snapshot_idx",
  "company_registry_profiles_user_idx",
  "company_registry_officers_id_user_uidx",
  "company_registry_officers_snapshot_idx",
  "company_registry_officers_user_idx",
  "company_registry_establishments_id_user_uidx",
  "company_registry_establishments_snapshot_idx",
  "company_registry_establishments_user_idx",
  "company_registry_documents_id_user_uidx",
  "company_registry_documents_snapshot_idx",
  "company_registry_documents_document_idx",
  "company_registry_documents_user_idx",
  "business_registry_links_id_user_uidx",
  "business_registry_links_business_idx",
  "business_registry_links_snapshot_idx",
  "business_registry_links_user_idx",
  "business_enrichment_decisions_id_user_uidx",
  // Une seule proposition OUVERTE par champ et par société.
  "business_enrichment_decisions_open_uidx",
  "business_enrichment_decisions_business_idx",
  "business_enrichment_decisions_snapshot_idx",
  "business_enrichment_decisions_superseded_idx",
  "business_enrichment_decisions_user_idx",
  // Document Intelligence. `document_extraction_runs_linked_file_uidx` est l'invariant le
  // plus important : il empêche qu'un même document produise deux fois un fait canonique
  // pour la même société.
  "document_extraction_runs_id_user_uidx",
  "document_extraction_runs_linked_file_uidx",
  "document_extraction_runs_business_idx",
  "document_extraction_runs_document_idx",
  "document_extraction_runs_supersedes_idx",
  "document_extraction_runs_open_idx",
  "document_extraction_runs_user_idx",
  "document_extraction_fields_id_user_uidx",
  "document_extraction_fields_run_idx",
  "document_extraction_fields_code_idx",
  "document_extraction_fields_attention_idx",
  "document_extraction_fields_user_idx",
  "document_extraction_checks_id_user_uidx",
  "document_extraction_checks_run_idx",
  "document_extraction_checks_user_idx",
  "import_upload_tickets_run_idx",
  "import_record_links_run_idx",
  "real_estate_data_snapshots_id_user_uidx",
  "real_estate_data_snapshots_lookup_idx",
  "real_estate_comparable_sales_id_user_uidx",
  "real_estate_comparable_sales_position_uidx",
  "real_estate_energy_certificates_id_user_uidx",
  "real_estate_energy_certificates_position_uidx",
  "property_public_data_matches_id_user_uidx",
  "property_public_data_matches_open_comparable_uidx",
  "property_public_data_matches_open_certificate_uidx",
  "property_public_data_matches_current_comparable_uidx",
  "property_public_data_matches_current_certificate_uidx",
  "real_estate_valuations_snapshot_idx",
  // Import de portefeuille. Les trois premiers sont des INVARIANTS, pas des optimisations :
  // deux détentions du même instrument dans la même enveloppe scinderaient la détention,
  // deux observations à la même date la cumuleraient, et sans identité unique un rejeu
  // écrirait des doublons.
  "positions_id_user_uidx",
  "positions_envelope_instrument_uidx",
  "position_snapshots_id_user_uidx",
  "position_snapshots_observation_uidx",
  "portfolio_events_id_user_uidx",
  "import_normalized_records_event_uidx",
  "import_normalized_records_snapshot_session_uidx",
  "import_normalized_records_snapshot_idx",
  "import_instrument_resolutions_id_user_uidx",
  "import_instrument_resolutions_key_uidx",
  // Open Banking — les trois unicités qui portent un invariant, pas une optimisation.
  "bank_provider_accounts_canonical_uidx",
  "bank_observed_transactions_identity_uidx",
  "bank_observed_transactions_committed_uidx",
  "bank_reconciliation_decisions_transaction_uidx",
  "bank_sync_runs_running_uidx",
  // Cibles de clés étrangères composées.
  "bank_providers_id_user_uidx",
  "bank_institutions_id_user_uidx",
  "bank_consents_id_user_uidx",
  "bank_provider_accounts_id_user_uidx",
  "bank_sync_cursors_id_user_uidx",
  "bank_sync_runs_id_user_uidx",
  "bank_sync_raw_pages_id_user_uidx",
  "bank_observed_transactions_id_user_uidx",
  "bank_balance_observations_id_user_uidx",
  "bank_reconciliation_decisions_id_user_uidx",
  "bank_sync_events_id_user_uidx",
  // Index de clés étrangères Open Banking. L'ORDRE des colonnes décide : une unicité
  // `(user_id, cible)` porte son invariant, pas la clé étrangère `(cible, user_id)`.
  "bank_institutions_canonical_fk_idx",
  "bank_provider_accounts_account_fk_idx",
  "bank_sync_cursors_account_fk_idx",
  "bank_sync_raw_pages_account_fk_idx",
  "bank_sync_raw_pages_session_fk_idx",
  "bank_reconciliation_decisions_observation_fk_idx",
  "bank_reconciliation_decisions_transaction_fk_idx",
] as const;
const forbiddenIndexes = [
  "net_worth_snapshot_items_owner_snapshot_idx",
  "business_valuations_effective_uk",
] as const;
const requiredTriggers = [
  "real_estate_financing_links_allocation_guard",
  "import_raw_records_immutable",
  "import_normalized_records_frozen",
  "import_record_links_immutable",
  "fec_entry_lines_frozen",
  "goal_versions_immutable_update",
  "goals_v2_update_guard",
  "decision_case_versions_immutable",
  "decision_runs_immutable",
  "company_registry_snapshots_immutable",
  "document_extraction_fields_frozen",
  "real_estate_snapshot_frozen",
  "real_estate_comparable_sale_frozen",
  "real_estate_energy_certificate_frozen",
  "bank_sync_raw_pages_immutable",
  "bank_observed_transactions_frozen",
  "position_snapshot_corrections_immutable",
] as const;
const requiredTriggerFunctions = [
  "real_estate_allocation_guard",
  "import_raw_record_immutable",
  "import_normalized_record_frozen",
  "import_record_link_immutable",
  "position_snapshot_correction_immutable",
  "fec_entry_line_frozen",
  "lfo_guard_goal_version_update",
  "lfo_guard_goal_v2_update",
  "lfo_guard_decision_snapshot_immutable",
  "company_registry_snapshot_immutable",
  "document_extraction_field_frozen",
  "real_estate_snapshot_frozen",
  "real_estate_public_row_frozen",
  "bank_sync_raw_page_immutable",
  "bank_observed_transaction_frozen",
] as const;

const requiredConstraints = [
  // ── Corrections d'observations de position ─────────────────────────────────────────
  // Les cinq contrôles qui empêchent la piste d'audit de mentir : un motif vide, un auteur
  // vide, un avant ou un après qui ne serait pas un objet, et une correction ne nommant
  // AUCUN champ modifié — un rejeu déguisé en décision.
  "position_snapshot_corrections_reason_ck",
  "position_snapshot_corrections_before_ck",
  "position_snapshot_corrections_after_ck",
  "position_snapshot_corrections_changed_ck",
  // Les trois clés composites : aucune décision ne traverse la frontière d'un propriétaire,
  // et `restrict` sur l'observation garantit qu'aucune ancienne valeur n'est perdue.
  "position_snapshot_corrections_session_fk",
  "position_snapshot_corrections_record_fk",
  "position_snapshot_corrections_snapshot_fk",
  // V1 : l'acteur EST le propriétaire. Ce produit n'a pas de délégation, donc aucune
  // décision ne peut honnêtement nommer quelqu'un d'autre. C'est ici qu'une future
  // délégation devra être décidée, plutôt que de se glisser sans le dire.
  "position_snapshot_corrections_actor_is_owner_ck",
  // Les deux clés vers `auth.users` sont en RESTRICT, et c'est une CONTRADICTION TRANCHÉE :
  // une cascade demandait une suppression que le trigger d'immuabilité refusait. La
  // suppression destructive d'un utilisateur portant une piste financière est interdite.
  "position_snapshot_corrections_actor_fk",
  "position_snapshot_corrections_owner_fk",
  // ── Réconciliation d'intégration ────────────────────────────────────────────────────
  // Formes FINALES des contraintes partagées par plusieurs verticales. Elles remplacent des
  // noms que deux migrations écrites en parallèle avaient choisis identiques :
  //   external_sources_domain_ck        → external_sources_domain_v2_ck
  //   external_sources_shape_ck         ┐
  //   external_sources_declared_shape_ck┘→ external_sources_shape_v2_ck (par DOMAINE)
  //   import_record_links_domain_v3_ck  → ..._domain_v4_ck
  //   import_record_links_target_v3_ck  → ..._target_v4_ck
  //   import_upload_tickets_domain_v2_ck→ ..._domain_v3_ck
  // Exiger un prédécesseur ferait échouer le gate sur une contrainte qui n'existe plus ;
  // ne pas exiger le successeur laisserait un rétrécissement muet passer.
  "external_sources_domain_v2_ck",
  "external_sources_shape_v2_ck",
  "external_sources_capabilities_v2_ck",
  "external_sources_domain_provider_uk",
  "import_record_links_domain_v4_ck",
  "import_record_links_target_v4_ck",
  "import_upload_tickets_domain_v3_ck",
  // Provenance d'une observation de position, par SESSION : une observation corrigée a un
  // historique de lectures, et l'unicité par observation seule faisait perdre sa provenance
  // à la session qui corrige.
  "import_record_links_snapshot_session_uk",
  "scenarios_status_ck",
  "scenarios_archive_shape_ck",
  "simulation_runs_mode_ck",
  "simulation_runs_horizon_ck",
  "scenario_versions_owner_fk",
  "scenario_assumptions_owner_fk",
  "simulation_runs_owner_fk",
  "simulation_runs_scenario_version_fk",
  "simulation_results_owner_fk",
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
  "business_ownership_rates_v2_ck",
  "business_ownership_shares_ck",
  "business_ownership_origin_event_fk",
  "business_valuations_basis_v2_ck",
  "business_valuations_method_ck",
  "business_valuations_multiple_ck",
  "business_valuations_metric_basis_ck",
  "business_valuations_round_ck",
  "businesses_capital_history_source_ck",
  "businesses_capital_history_start_ck",
  "business_financials_period_kind_ck",
  "business_financials_period_order_ck",
  "business_financials_non_negative_ck",
  "business_capital_events_business_fk",
  "business_capital_events_transaction_fk",
  "business_capital_events_amount_ck",
  "business_capital_events_type_v2_ck",
  "business_capital_events_amount_scope_ck",
  "business_capital_events_scope_domain_ck",
  "business_capital_events_fees_ck",
  "business_capital_events_ownership_after_ck",
  "business_capital_events_ownership_delta_ck",
  "business_ebitda_adjustments_business_fk",
  "business_ebitda_adjustments_category_ck",
  "business_ebitda_adjustments_data_kind_ck",
  "business_ebitda_adjustments_label_uk",
  "business_bridge_items_business_fk",
  "business_bridge_items_category_ck",
  "business_bridge_items_data_kind_ck",
  "business_bridge_items_label_uk",
  "business_bridge_declarations_business_fk",
  "business_bridge_declarations_status_ck",
  "business_bridge_declarations_effective_uk",
  "business_dcf_assumptions_business_fk",
  "business_dcf_assumptions_wacc_ck",
  "business_dcf_assumptions_tax_ck",
  "business_dcf_assumptions_terminal_ck",
  "business_dcf_assumptions_convention_ck",
  "business_dcf_assumptions_effective_uk",
  "business_dcf_periods_year_ck",
  "business_dcf_periods_non_negative_ck",
  "business_dcf_periods_year_uk",
  "business_holdings_parent_fk",
  "business_holdings_child_fk",
  "business_holdings_no_self_ck",
  "business_holdings_rate_ck",
  "business_holdings_effective_uk",
  "import_sources_account_fk",
  "import_sources_business_fk",
  "import_sources_kind_ck",
  "import_sources_status_ck",
  "import_sources_data_kind_ck",
  "import_sources_coverage_order_ck",
  "import_sessions_source_fk",
  "import_sessions_document_fk",
  "import_sessions_status_v2_ck",
  "import_sessions_fiscal_year_ck",
  "import_sessions_entry_counts_ck",
  "import_sessions_coverage_shape_ck",
  "import_sessions_counts_ck",
  "import_sessions_committed_shape_ck",
  "import_sessions_file_hash_ck",
  "import_sessions_declared_period_ck",
  "import_sessions_observed_period_ck",
  "import_raw_records_session_fk",
  "import_raw_records_row_uk",
  "import_raw_records_row_number_ck",
  "import_raw_records_cells_ck",
  "import_normalized_records_session_fk",
  "import_normalized_records_raw_fk",
  "import_normalized_records_account_fk",
  "import_normalized_records_matched_fk",
  "import_normalized_records_raw_uk",
  "import_normalized_records_status_ck",
  "import_normalized_records_verdict_ck",
  "import_normalized_records_commit_state_ck",
  "import_normalized_records_data_kind_ck",
  "import_normalized_records_issues_ck",
  "import_normalized_records_committable_ck",
  "import_record_links_session_fk",
  "import_record_links_normalized_fk",
  "import_record_links_transaction_fk",
  "import_record_links_business_fk",
  "import_record_links_normalized_uk",
  "import_record_links_transaction_uk",
  "import_record_links_business_session_uk",
  "fec_entry_lines_session_fk",
  "fec_entry_lines_raw_fk",
  "fec_entry_lines_business_fk",
  "fec_entry_lines_raw_uk",
  "fec_entry_lines_status_ck",
  "fec_entry_lines_commit_state_ck",
  "fec_entry_lines_data_kind_ck",
  "fec_entry_lines_issues_ck",
  "fec_entry_lines_pcg_class_ck",
  "fec_entry_lines_amount_shape_ck",
  "fec_entry_lines_currency_ck",
  "fec_entry_lines_committable_ck",
  "import_upload_tickets_path_uk",
  "import_upload_tickets_size_ck",
  "import_upload_tickets_expiry_ck",
  "import_upload_tickets_consumed_shape_ck",
  "import_upload_tickets_session_fk",
  "import_column_mappings_signature_uk",
  "import_column_mappings_headers_ck",
  "import_column_mappings_mapping_ck",
  "import_column_mappings_version_ck",
  "career_roles_type_ck",
  "career_roles_status_ck",
  "career_roles_dates_ck",
  "career_roles_data_kind_ck",
  "career_roles_id_user_uk",
  "career_compensation_role_fk",
  "career_compensation_frequency_ck",
  "career_compensation_dates_ck",
  "career_compensation_amounts_ck",
  "career_compensation_data_kind_ck",
  "career_compensation_effective_uk",
  "career_events_role_fk",
  "career_events_type_ck",
  "career_events_variable_state_ck",
  "career_events_paid_shape_ck",
  "career_events_amount_ck",
  "career_events_data_kind_ck",
  "career_events_id_user_uk",
  "career_equity_role_fk",
  "career_equity_type_ck",
  "career_equity_liquidity_ck",
  "career_equity_amounts_ck",
  "career_equity_expiry_ck",
  "career_scenarios_role_fk",
  "career_scenarios_type_ck",
  "career_scenarios_kind_ck",
  "tax_profiles_dates_ck",
  "tax_profiles_dependants_ck",
  "tax_rule_sets_dates_ck",
  "tax_rule_sets_status_ck",
  "tax_rule_sets_effective_uk",
  "tax_rule_sets_id_user_uk",
  "tax_rules_rule_set_fk",
  "tax_rules_type_ck",
  "tax_rules_category_ck",
  "tax_rules_dates_ck",
  "tax_observations_transaction_fk",
  "tax_observations_document_fk",
  "tax_observations_type_ck",
  "tax_observations_amount_ck",
  "tax_observations_kind_ck",
  "tax_income_role_fk",
  "tax_income_event_fk",
  "tax_income_transaction_fk",
  "tax_income_category_ck",
  "tax_income_amount_ck",
  "tax_income_kind_ck",
  "goals_status_ck",
  "goals_priority_ck",
  "goals_current_version_ck",
  "goals_constraint_strength_ck",
  "goals_archive_shape_ck",
  "goal_versions_version_ck",
  "goal_versions_goal_version_uk",
  "goal_versions_payload_ck",
  "goal_versions_owner_fk",
  "decision_cases_status_ck",
  "decision_cases_horizon_ck",
  "decision_cases_version_ck",
  "decision_cases_archive_shape_ck",
  "decision_case_versions_version_ck",
  "decision_case_versions_case_version_uk",
  "decision_case_versions_payload_ck",
  "decision_case_versions_owner_fk",
  "decision_runs_owner_fk",
  "decision_runs_case_version_fk",
  "decision_runs_horizon_ck",
  "decision_runs_mode_ck",
  "decision_runs_seed_ck",
  "decision_runs_stale_ck",
  "decision_runs_completeness_ck",
  "decision_runs_snapshot_ck",
  // ── Acquisition du registre d'entreprises ───────────────────────────────────────────
  // Chaque contrainte listée porte un invariant qu'aucun contrôle applicatif ne peut
  // garantir sous concurrence.
  "businesses_siren_shape_ck",
  "external_sources_auth_mode_ck",
  // Un NOM de variable d'environnement, jamais un secret collé par erreur.
  "external_sources_credential_ck",
  "external_sources_credential_shape_ck",
  "external_sources_declared_status_ck",
  "external_sources_quota_ck",
  "company_registry_snapshots_source_fk",
  "company_registry_snapshots_endpoint_ck",
  // Un instantané DIT quelque chose : une réponse, ou un échec nommé.
  "company_registry_snapshots_outcome_ck",
  "company_registry_snapshots_payload_hash_ck",
  "company_registry_snapshots_siren_ck",
  "company_registry_snapshots_siret_ck",
  "company_registry_snapshots_identity_ck",
  "company_registry_snapshots_query_ck",
  "company_registry_snapshots_bytes_ck",
  "company_registry_snapshots_data_kind_ck",
  "company_registry_snapshots_confidence_ck",
  "company_registry_profiles_snapshot_fk",
  "company_registry_profiles_snapshot_uk",
  "company_registry_profiles_siren_ck",
  "company_registry_profiles_head_office_ck",
  "company_registry_profiles_head_office_identity_ck",
  "company_registry_profiles_status_ck",
  "company_registry_profiles_life_order_ck",
  // Un montant sans devise n'est pas un montant. FX ABSENT ≠ FX ÉGAL À 1.
  "company_registry_profiles_capital_ck",
  "company_registry_profiles_capital_sign_ck",
  "company_registry_profiles_establishments_ck",
  "company_registry_profiles_issues_ck",
  "company_registry_profiles_data_kind_ck",
  "company_registry_profiles_confidence_ck",
  "company_registry_officers_snapshot_fk",
  "company_registry_officers_position_uk",
  "company_registry_officers_position_ck",
  "company_registry_officers_kind_ck",
  "company_registry_officers_identity_ck",
  "company_registry_officers_company_siren_ck",
  "company_registry_officers_birth_year_ck",
  "company_registry_establishments_snapshot_fk",
  "company_registry_establishments_siret_uk",
  "company_registry_establishments_siret_ck",
  "company_registry_establishments_status_ck",
  "company_registry_establishments_life_order_ck",
  "company_registry_documents_snapshot_fk",
  "company_registry_documents_document_fk",
  "company_registry_documents_kind_ck",
  "company_registry_documents_confidentiality_ck",
  "company_registry_documents_retrieved_ck",
  "business_registry_links_business_fk",
  "business_registry_links_snapshot_fk",
  "business_registry_links_business_uk",
  // UN SIREN, UNE SOCIÉTÉ : le pendant de `businesses_siren_uidx`.
  "business_registry_links_siren_uk",
  "business_registry_links_siren_ck",
  "business_registry_links_siret_ck",
  "business_registry_links_identity_ck",
  "business_registry_links_basis_ck",
  // Un rattachement « confirmé par le fournisseur » exige son instantané.
  "business_registry_links_basis_shape_ck",
  "business_enrichment_decisions_business_fk",
  // PAS de cascade : la provenance d'un fait décidé ne se supprime pas.
  "business_enrichment_decisions_snapshot_fk",
  "business_enrichment_decisions_superseded_fk",
  "business_enrichment_decisions_state_ck",
  "business_enrichment_decisions_decided_ck",
  // ACCEPTER UN VIDE N'EST PAS UN ENRICHISSEMENT.
  "business_enrichment_decisions_accept_shape_ck",
  "business_enrichment_decisions_field_path_ck",
  "business_enrichment_decisions_superseded_self_ck",
  // ── Document Intelligence ───────────────────────────────────────────────────────────
  "document_extraction_runs_business_fk",
  "document_extraction_runs_document_fk",
  "document_extraction_runs_supersedes_fk",
  "document_extraction_runs_family_ck",
  "document_extraction_runs_pdf_kind_ck",
  "document_extraction_runs_status_ck",
  "document_extraction_runs_counts_ck",
  "document_extraction_runs_validated_shape_ck",
  "document_extraction_runs_linked_shape_ck",
  "document_extraction_runs_rejected_shape_ck",
  // Un scan n'a rien lu : une lecture OCR_REQUIRED portant des cases est refusée.
  "document_extraction_runs_ocr_shape_ck",
  "document_extraction_runs_file_hash_ck",
  "document_extraction_runs_siren_ck",
  "document_extraction_runs_fiscal_order_ck",
  "document_extraction_runs_supersedes_self_ck",
  "document_extraction_fields_run_fk",
  "document_extraction_fields_box_uk",
  "document_extraction_fields_page_ck",
  "document_extraction_fields_occurrence_ck",
  "document_extraction_fields_unit_ck",
  "document_extraction_fields_method_ck",
  "document_extraction_fields_confidence_ck",
  "document_extraction_fields_confidence_score_ck",
  "document_extraction_fields_validation_ck",
  "document_extraction_fields_corrected_shape_ck",
  "document_extraction_fields_user_value_shape_ck",
  // CASE VIDE ≠ CASE À ZÉRO, et une valeur normalisée sans valeur brute sortirait de nulle part.
  "document_extraction_fields_raw_shape_ck",
  "document_extraction_fields_bbox_shape_ck",
  "document_extraction_fields_bbox_size_ck",
  "document_extraction_checks_run_fk",
  "document_extraction_checks_code_uk",
  "document_extraction_checks_severity_ck",
  "document_extraction_checks_status_ck",
  // Un contrôle passé ou échoué a comparé deux nombres. Sinon c'est NOT_COMPUTABLE.
  "document_extraction_checks_values_ck",
  "document_extraction_checks_tolerance_ck",
  "document_extraction_checks_operands_ck",
  "import_upload_tickets_run_fk",
  "import_upload_tickets_single_target_ck",
  "import_record_links_run_fk",
  "import_record_links_run_uk",
  // Les noms remplacés — `import_record_links_domain_v2_ck`, `..._target_v2_ck` et
  // `import_upload_tickets_domain_ck` — ne figurent PLUS dans cette liste : une contrainte
  // remplacée qu'on continue d'exiger ferait échouer le gate sur une base à jour.
  "real_estate_data_snapshots_dataset_ck",
  "real_estate_data_snapshots_coverage_ck",
  "real_estate_data_snapshots_status_ck",
  "real_estate_data_snapshots_stale_ck",
  "real_estate_data_snapshots_failure_shape_ck",
  "real_estate_data_snapshots_empty_shape_ck",
  "real_estate_comparable_sales_built_area_ck",
  "real_estate_comparable_sales_land_area_ck",
  "real_estate_comparable_sales_lots_ck",
  "real_estate_energy_certificates_energy_label_ck",
  "real_estate_energy_certificates_ghg_label_ck",
  "real_estate_energy_certificates_energy_unit_ck",
  "real_estate_energy_certificates_ghg_unit_ck",
  "real_estate_energy_certificates_validity_ck",
  "property_public_data_matches_target_ck",
  "property_public_data_matches_state_ck",
  "property_public_data_matches_target_shape_ck",
  "property_public_data_matches_accept_shape_ck",
  "property_public_data_matches_weak_accept_ck",
  "property_public_data_matches_superseded_fk",
  "real_estate_valuations_method_v2_ck",
  "real_estate_valuations_comparable_shape_ck",
  "real_estate_valuations_snapshot_method_ck",
  "real_estate_valuations_snapshot_fk",
  // Noms REMPLACÉS par la migration `portfolio_import_acquisition`, qui a étendu chaque
  // whitelist de domaine et chaque forme committable pour les deux domaines de portefeuille.
  // Ils ne sont donc plus exigés — ce sont leurs successeurs, listés plus haut, qui le sont :
  //   import_sources_domain_v2_ck        → import_sources_domain_v3_ck
  //   import_sources_domain_shape_v2_ck  → import_sources_domain_shape_v3_ck
  //   import_record_links_domain_v2_ck   → import_record_links_domain_v3_ck
  //   import_record_links_target_v2_ck   → import_record_links_target_v3_ck
  //   import_normalized_records_domain_ck       → ..._domain_v2_ck
  //   import_normalized_records_ready_shape_ck  → ..._ready_shape_v2_ck
  //   import_upload_tickets_domain_ck           → ..._domain_v2_ck
  // Import de portefeuille.
  "import_sources_domain_v3_ck",
  "import_sources_domain_shape_v3_ck",
  "import_normalized_records_domain_v2_ck",
  "import_normalized_records_ready_shape_v2_ck",
  "import_normalized_records_security_shape_ck",
  "import_normalized_records_event_type_ck",
  "import_normalized_records_quantity_ck",
  "import_normalized_records_written_shape_ck",
  "import_normalized_records_correction_shape_ck",
  "import_instrument_resolutions_state_ck",
  "import_instrument_resolutions_resolved_shape_ck",
  "import_instrument_resolutions_rejected_shape_ck",
  "import_instrument_resolutions_pending_shape_ck",
  // Open Banking — chaque contrainte porte une distinction que le code seul ne tiendrait pas.
  "bank_providers_secret_shape_ck",
  "bank_providers_secret_reference_ck",
  "bank_providers_auth_secret_ck",
  "bank_consents_scopes_ck",
  "bank_consents_expiry_shape_ck",
  "bank_consents_active_shape_ck",
  "bank_consents_revoked_shape_ck",
  "bank_consents_expired_shape_ck",
  "bank_consents_secret_shape_ck",
  "bank_provider_accounts_mapping_shape_ck",
  "bank_sync_runs_failure_shape_ck",
  "bank_sync_runs_finished_shape_ck",
  "bank_sync_runs_complete_shape_ck",
  "bank_sync_raw_pages_hash_ck",
  "bank_observed_transactions_original_shape_ck",
  "bank_observed_transactions_cancelled_ck",
  "bank_balance_observations_shape_ck",
  "bank_balance_observations_observation_uk",
  "bank_reconciliation_decisions_shape_ck",
  "bank_reconciliation_decisions_observation_uk",
  "bank_sync_events_event_uk",
  "bank_sync_events_processed_shape_ck",
  "bank_sync_events_unverified_ck",
] as const;

const requiredRpcs: Record<string, string> = {
  lfo_add_account:
    "p_user_id uuid, p_institution text, p_name text, p_account_type text, p_balance numeric, p_currency text, p_as_of_date date",
  lfo_add_transaction:
    "p_user_id uuid, p_account_id uuid, p_category_id uuid, p_transaction_date date, p_label text, p_amount numeric, p_currency text, p_update_balance boolean",
  lfo_update_scenario:
    "p_user_id uuid, p_scenario_id uuid, p_patch jsonb, p_updated_at timestamp with time zone",
  lfo_duplicate_scenario: "p_user_id uuid, p_scenario_id uuid, p_now timestamp with time zone",
  lfo_create_scenario_v2:
    "p_user_id uuid, p_name text, p_description text, p_color text, p_definition jsonb, p_now timestamp with time zone",
  lfo_save_scenario_version_v2:
    "p_user_id uuid, p_scenario_id uuid, p_expected_version integer, p_definition jsonb, p_updated_at timestamp with time zone",
  lfo_archive_scenario_v2:
    "p_user_id uuid, p_scenario_id uuid, p_archived_at timestamp with time zone",
  lfo_save_simulation_v2:
    "p_user_id uuid, p_scenario_id uuid, p_scenario_version integer, p_as_of_date date, p_baseline_reference jsonb, p_event_set_version text, p_assumptions_snapshot jsonb, p_run_mode text, p_horizon_months integer, p_methodology text, p_methodology_version text, p_definition_snapshot jsonb, p_seed integer, p_simulations integer, p_points jsonb",
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
  lfo_issue_import_upload_ticket: "p_user_id uuid, p_payload jsonb",
  lfo_consume_import_upload_ticket: "p_user_id uuid, p_ticket_id uuid",
  lfo_record_import_staging_cleanup: "p_user_id uuid, p_session_id uuid, p_removed boolean",
  lfo_fec_entry_balance: "p_user_id uuid, p_session_id uuid",
  lfo_open_fec_session: "p_user_id uuid, p_payload jsonb",
  lfo_append_fec_lines: "p_user_id uuid, p_payload jsonb",
  lfo_finalize_fec_session: "p_user_id uuid, p_payload jsonb",
  lfo_commit_fec_session: "p_user_id uuid, p_payload jsonb",
  lfo_save_career_package: "p_user_id uuid, p_payload jsonb",
  lfo_record_career_event: "p_user_id uuid, p_payload jsonb",
  lfo_set_tax_profile: "p_user_id uuid, p_payload jsonb",
  lfo_save_tax_rule_set: "p_user_id uuid, p_payload jsonb",
  lfo_record_tax_observation: "p_user_id uuid, p_payload jsonb",
  lfo_validate_goal_definition_v2: "p_definition jsonb",
  lfo_create_goal_v2: "p_user_id uuid, p_definition jsonb, p_now timestamp with time zone",
  lfo_save_goal_version_v2:
    "p_user_id uuid, p_goal_id uuid, p_expected_version integer, p_definition jsonb, p_updated_at timestamp with time zone",
  lfo_set_goal_status_v2:
    "p_user_id uuid, p_goal_id uuid, p_expected_version integer, p_status text, p_updated_at timestamp with time zone",
  lfo_validate_decision_case_version_v2: "p_definition jsonb",
  lfo_create_decision_case_v2: "p_user_id uuid, p_definition jsonb, p_now timestamp with time zone",
  lfo_save_decision_case_version_v2:
    "p_user_id uuid, p_case_id uuid, p_expected_version integer, p_definition jsonb, p_updated_at timestamp with time zone",
  lfo_save_decision_run_v2:
    "p_user_id uuid, p_case_id uuid, p_case_version integer, p_run jsonb, p_result jsonb, p_now timestamp with time zone",
  lfo_upsert_external_source: "p_user_id uuid, p_payload jsonb",
  lfo_record_registry_snapshot: "p_user_id uuid, p_payload jsonb",
  lfo_link_business_registry: "p_user_id uuid, p_payload jsonb",
  lfo_unlink_business_registry: "p_user_id uuid, p_business_id uuid, p_provider text",
  lfo_propose_business_enrichment: "p_user_id uuid, p_payload jsonb",
  lfo_decide_business_enrichment: "p_user_id uuid, p_payload jsonb",
  lfo_open_document_extraction: "p_user_id uuid, p_payload jsonb",
  lfo_append_document_extraction_fields: "p_user_id uuid, p_payload jsonb",
  lfo_evaluate_document_extraction_checks: "p_user_id uuid, p_payload jsonb",
  lfo_correct_document_extraction_field: "p_user_id uuid, p_payload jsonb",
  lfo_validate_document_extraction: "p_user_id uuid, p_run_id uuid",
  lfo_link_document_extraction_financials: "p_user_id uuid, p_payload jsonb",
  lfo_reject_document_extraction: "p_user_id uuid, p_run_id uuid, p_reason text",
  lfo_record_document_staging_cleanup: "p_user_id uuid, p_run_id uuid, p_removed boolean",
  lfo_upsert_public_data_source: "p_user_id uuid, p_payload jsonb",
  lfo_record_real_estate_snapshot: "p_user_id uuid, p_payload jsonb",
  lfo_append_real_estate_snapshot_rows: "p_user_id uuid, p_payload jsonb",
  lfo_propose_property_public_data_match: "p_user_id uuid, p_payload jsonb",
  lfo_decide_property_public_data_match: "p_user_id uuid, p_payload jsonb",
  lfo_promote_real_estate_market_estimate: "p_user_id uuid, p_payload jsonb",
  lfo_open_portfolio_session: "p_user_id uuid, p_payload jsonb",
  lfo_append_portfolio_rows: "p_user_id uuid, p_payload jsonb",
  lfo_stage_import_instruments: "p_user_id uuid, p_payload jsonb",
  lfo_resolve_import_instrument: "p_user_id uuid, p_payload jsonb",
  lfo_correct_portfolio_row: "p_user_id uuid, p_payload jsonb",
  lfo_finalize_portfolio_session: "p_user_id uuid, p_payload jsonb",
  lfo_commit_portfolio_session: "p_user_id uuid, p_payload jsonb",
  // Open Banking (AIS), lecture seule. Aucune primitive d'initiation de paiement n'existe.
  lfo_register_bank_provider: "p_user_id uuid, p_payload jsonb",
  lfo_open_bank_consent: "p_user_id uuid, p_payload jsonb",
  lfo_set_bank_consent_status: "p_user_id uuid, p_payload jsonb",
  lfo_sync_bank_accounts: "p_user_id uuid, p_payload jsonb",
  lfo_map_bank_account: "p_user_id uuid, p_payload jsonb",
  lfo_open_bank_sync_run: "p_user_id uuid, p_payload jsonb",
  lfo_append_bank_sync_page: "p_user_id uuid, p_payload jsonb",
  lfo_record_bank_balances: "p_user_id uuid, p_payload jsonb",
  lfo_finalize_bank_sync_run: "p_user_id uuid, p_payload jsonb",
  lfo_fail_bank_sync_run: "p_user_id uuid, p_payload jsonb",
  lfo_decide_bank_reconciliation: "p_user_id uuid, p_payload jsonb",
  lfo_commit_bank_sync_session: "p_user_id uuid, p_payload jsonb",
  lfo_record_bank_sync_event: "p_user_id uuid, p_payload jsonb",
};

/**
 * RPC dont le type de retour N'EST PAS un `uuid`, avec ce type DÉCLARÉ ici.
 *
 * La convention du dépôt reste celle-ci : une RPC d'ÉCRITURE retourne l'identifiant de ce
 * qu'elle a écrit, ce qui rend une écriture composée vérifiable par son appelant. Les
 * exceptions sont nommées une par une, jamais tolérées en bloc : un type de retour changé
 * en silence échoue comme le reste du gate.
 *
 * `lfo_fec_entry_balance` est une RPC de LECTURE D'INVARIANT — elle ne crée rien, donc elle
 * n'a aucun identifiant à rendre. Elle dérive des lignes persistées le nombre d'écritures et
 * de déséquilibres, parce que Σdébits = Σcrédits par écriture est l'invariant d'intégrité de
 * la source comptable et qu'un décompte fourni par l'appelant ne prouve rien de ce que la
 * base contient.
 *
 * `lfo_save_scenario_version_v2` rend le NUMÉRO DE VERSION résultant. C'est un choix du
 * domaine Scenarios : sur une écriture optimiste avec version attendue, le numéro obtenu est
 * l'information utile à l'appelant, davantage que l'identifiant de la ligne créée.
 */
const declaredReturnTypeRpcs: Record<string, string> = {
  lfo_fec_entry_balance: "TABLE(entries integer, unbalanced integer)",
  lfo_save_scenario_version_v2: "integer",
  lfo_validate_goal_definition_v2: "void",
  lfo_save_goal_version_v2: "integer",
  lfo_set_goal_status_v2: "integer",
  lfo_validate_decision_case_version_v2: "void",
  lfo_save_decision_case_version_v2: "integer",
  // Ces deux RPC rendent un DÉCOMPTE : « combien de propositions écrites » et « combien de
  // décisions appliquées » sont l'information utile à l'appelant, davantage qu'un identifiant
  // parmi plusieurs lignes touchées.
  lfo_propose_business_enrichment: "integer",
  lfo_decide_business_enrichment: "integer",
  // Ces deux RPC rendent un DÉCOMPTE : « combien de cases reçues » et « combien de contrôles
  // évalués » sont l'information utile à l'appelant, davantage qu'un identifiant parmi
  // plusieurs centaines de lignes touchées.
  lfo_append_document_extraction_fields: "integer",
  lfo_evaluate_document_extraction_checks: "integer",
  // Ces deux-là ne CRÉENT rien : elles rendent un DÉCOMPTE. Le nombre de lignes réellement
  // persistées pour l'une, le nombre de rapprochements remplacés pour l'autre. Rendre un
  // uuid les obligerait à inventer un identifiant qui ne désigne aucune ligne nouvelle.
  lfo_append_real_estate_snapshot_rows: "integer",
  lfo_decide_property_public_data_match: "integer",
  // Décomptes, pas identifiants : nombre de lignes reçues, d'instruments enregistrés, de
  // lignes touchées par une décision, de lignes prêtes, de faits écrits.
  lfo_append_portfolio_rows: "integer",
  lfo_stage_import_instruments: "integer",
  lfo_resolve_import_instrument: "integer",
  lfo_finalize_portfolio_session: "integer",
  lfo_commit_portfolio_session: "integer",
  // Décomptes DÉRIVÉS des lignes persistées : comptes vus, lignes écrites, soldes écrits,
  // lignes touchées par une décision, faits validés.
  lfo_sync_bank_accounts: "integer",
  lfo_append_bank_sync_page: "integer",
  lfo_record_bank_balances: "integer",
  lfo_finalize_bank_sync_run: "integer",
  lfo_decide_bank_reconciliation: "integer",
  lfo_commit_bank_sync_session: "integer",
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
  "import_upload_tickets",
  "goal_versions",
  "decision_case_versions",
  "decision_runs",
  // Le registre d'entreprises rejoint la même règle. `external_sources` était restée
  // inscriptible depuis la migration initiale, sans aucun usage applicatif : un client
  // capable de réécrire `capabilities` pourrait faire croire qu'un fournisseur publie un
  // capital social qu'il ne publie pas.
  "external_sources",
  "company_registry_snapshots",
  "company_registry_profiles",
  "company_registry_officers",
  "company_registry_establishments",
  "company_registry_documents",
  "business_registry_links",
  "business_enrichment_decisions",
  // La lecture documentaire rejoint la même règle : une case, un contrôle et une lecture
  // sont des observations, pas des données que le client réécrit.
  "document_extraction_runs",
  "document_extraction_fields",
  "document_extraction_checks",
  "real_estate_data_snapshots",
  "real_estate_comparable_sales",
  "real_estate_energy_certificates",
  "property_public_data_matches",
  "import_instrument_resolutions",
  // Les onze tables Open Banking sont une piste d'audit : une observation modifiable par le
  // client n'est plus une observation, et un événement de notification effaçable rouvrirait
  // le rejeu que son unicité existe pour refuser.
  "bank_providers",
  "bank_institutions",
  "bank_consents",
  "bank_provider_accounts",
  "bank_sync_cursors",
  "bank_sync_runs",
  "bank_sync_raw_pages",
  "bank_observed_transactions",
  "bank_balance_observations",
  "bank_reconciliation_decisions",
  "bank_sync_events",
  // Une correction d'observation de position rejoint la même règle, et pour la raison la
  // plus dure de toutes : elle est la SEULE trace de ce que la valeur remplacée disait. Un
  // client capable de la réécrire pourrait faire croire à un motif qu'il n'a pas donné.
  "position_snapshot_corrections",
] as const;

const storagePolicies = [
  "documents_owner_select",
  "documents_owner_insert",
  "documents_owner_update",
  "documents_owner_delete",
] as const;

function addMissing(
  failures: string[],
  label: string,
  expected: readonly string[],
  actual: Iterable<string>,
): void {
  const missing = missingFrom(expected, actual);
  if (missing.length > 0) failures.push(`${label} manquant(s) : ${missing.join(", ")}`);
}
function addExactInventory(
  failures: string[],
  label: string,
  expected: readonly string[],
  actual: Iterable<string>,
): void {
  failures.push(...diffExactInventory(label, expected, actual));
}

/**
 * Plafond d'analyse d'un FEC, répliqué ici depuis `src/lib/validation/fec-imports.ts`.
 *
 * Le gate ne peut pas importer un module applicatif — il tourne sans build. Le chiffre est
 * donc redit, et c'est précisément ce que le contrôle ci-dessous protège : si l'un des deux
 * bouge sans l'autre, le bucket devient le premier refus rencontré, et le contournement de
 * la limite de corps de requête ne sert plus à rien.
 */
const MAX_FEC_FILE_BYTES = 24 * 1024 * 1024;

/**
 * Nombre de tables publiques RÉELLEMENT constatées. Il est rendu dans le résumé à côté du
 * nombre attendu : annoncer la longueur d'une liste déclarative comme si c'était une mesure
 * est exactement ce qui a laissé « 105 tables » cohabiter avec 106 tables reconstruites.
 */
let observedTableCount = 0;

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

  const columns = await client.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  );
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of columns.rows) {
    const tableColumns = columnsByTable.get(row.table_name) ?? new Set<string>();
    tableColumns.add(row.column_name);
    columnsByTable.set(row.table_name, tableColumns);
  }
  // INVENTAIRE EXACT, et non seulement « rien ne manque ».
  //
  // `addMissing` ne regarde qu'un sens : il signale ce que le code attend et que la base
  // n'a pas. Une table réellement présente mais absente de cet inventaire passait donc
  // inaperçue — c'est exactement ce qui est arrivé à `bank_sync_events`, dont la RLS et la
  // policy n'étaient contrôlées par personne pendant que le gate se déclarait vert.
  //
  // Les VUES sont exclues : l'inventaire porte sur les tables de base, seules porteuses de
  // RLS et de policies. Le compte est donc directement comparable à celui que
  // `db:local:reset` annonce.
  const baseTables = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  observedTableCount = baseTables.rows.length;
  addExactInventory(
    failures,
    "Table(s) publique(s)",
    userOwnedTables,
    baseTables.rows.map((row) => row.table_name),
  );
  addMissing(failures, "Table(s)", userOwnedTables, columnsByTable.keys());
  for (const [table, expected] of Object.entries(requiredColumns))
    addMissing(
      failures,
      `Colonne(s) de public.${table}`,
      expected,
      columnsByTable.get(table) ?? [],
    );

  const constraints = await client.query<{ conname: string }>(
    `select con.conname from pg_catalog.pg_constraint con join pg_catalog.pg_class rel on rel.oid = con.conrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = 'public'`,
  );
  addMissing(
    failures,
    "Contrainte(s)",
    requiredConstraints,
    constraints.rows.map((row) => row.conname),
  );

  const indexes = await client.query<{ indexname: string }>(
    `select indexname from pg_catalog.pg_indexes where schemaname = 'public'`,
  );
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  addMissing(failures, "Index", requiredIndexes, indexNames);
  for (const index of forbiddenIndexes)
    if (indexNames.has(index)) failures.push(`Index remplacé toujours présent : public.${index}`);

  const triggers = await client.query<{ tgname: string }>(
    `select tg.tgname from pg_catalog.pg_trigger tg join pg_catalog.pg_class rel on rel.oid = tg.tgrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = 'public' and not tg.tgisinternal`,
  );
  addMissing(
    failures,
    "Trigger(s)",
    requiredTriggers,
    triggers.rows.map((row) => row.tgname),
  );
  const triggerFunctions = await client.query<{ proname: string }>(
    `select pr.proname from pg_catalog.pg_proc pr join pg_catalog.pg_namespace ns on ns.oid = pr.pronamespace where ns.nspname = 'public' and pr.prorettype = 'pg_catalog.trigger'::regtype`,
  );
  addMissing(
    failures,
    "Fonction(s) de trigger",
    requiredTriggerFunctions,
    triggerFunctions.rows.map((row) => row.proname),
  );

  const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
    `select rel.relname, rel.relrowsecurity from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = 'public' and rel.relkind = 'r'`,
  );
  const rlsByTable = new Map(rls.rows.map((row) => [row.relname, row.relrowsecurity]));
  for (const table of userOwnedTables)
    if (rlsByTable.get(table) !== true) failures.push(`RLS inactif : public.${table}`);

  const policies = await client.query<{
    tablename: string;
    policyname: string;
    roles: string[];
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `select tablename, policyname, roles::text[], cmd, qual, with_check from pg_catalog.pg_policies where schemaname = 'public'`,
  );
  for (const table of userOwnedTables) {
    if (table === "goal_versions") {
      const policy = policies.rows.find(
        (row) => row.tablename === table && row.policyname === "goal_versions_owner_select",
      );
      if (
        !policy ||
        policy.cmd !== "SELECT" ||
        !policy.roles.includes("authenticated") ||
        !policy.qual?.includes("auth.uid()") ||
        !policy.qual.includes("user_id")
      ) {
        failures.push("Policy de lecture propriétaire invalide : public.goal_versions");
      }
      continue;
    }
    const policy = policies.rows.find(
      (row) => row.tablename === table && row.policyname === "owner_all",
    );
    const ownerPredicate = (value: string | null) =>
      Boolean(value?.includes("auth.uid()") && value.includes("user_id"));
    if (!policy) failures.push(`Policy owner_all absente : public.${table}`);
    else if (
      policy.cmd !== "ALL" ||
      !policy.roles.includes("authenticated") ||
      !ownerPredicate(policy.qual) ||
      !ownerPredicate(policy.with_check)
    )
      failures.push(`Policy owner_all invalide : public.${table}`);
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
    if (!grants.has("SELECT"))
      failures.push(`Piste d'audit illisible par authenticated : public.${table}`);
    const writes = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].filter((privilege) =>
      grants.has(privilege),
    );
    if (writes.length > 0) {
      failures.push(
        `Piste d'audit inscriptible par authenticated : public.${table} (${writes.join(", ")})`,
      );
    }
  }

  const serviceRoleGoalDeletes = await client.query<{ table_name: string }>(`
    select table_name
      from information_schema.role_table_grants
     where table_schema = 'public'
       and grantee = 'service_role'
       and privilege_type = 'DELETE'
       and table_name in ('goals', 'goal_versions')`);
  for (const row of serviceRoleGoalDeletes.rows) {
    failures.push(`Suppression Goals V2 ouverte à service_role : public.${row.table_name}`);
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
     where ns.nspname = 'public'
       and proc.proname like 'lfo\\_%' escape '\\'
       and proc.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype`);
  addMissing(
    failures,
    "RPC lfo_*",
    Object.keys(requiredRpcs),
    rpcs.rows.map((row) => row.name),
  );
  const unexpectedRpcs = rpcs.rows.filter((row) => !(row.name in requiredRpcs));
  if (unexpectedRpcs.length > 0)
    failures.push(`RPC lfo_* inattendue(s) : ${unexpectedRpcs.map((row) => row.name).join(", ")}`);
  for (const rpc of rpcs.rows) {
    const expectedArguments = requiredRpcs[rpc.name];
    if (!expectedArguments) continue;
    if (rpc.arguments !== expectedArguments)
      failures.push(
        `Signature RPC invalide : ${rpc.name}(${rpc.arguments}), attendu ${rpc.name}(${expectedArguments})`,
      );
    // `uuid` par défaut : une RPC d'écriture retourne l'identifiant de ce qu'elle a écrit.
    // Les exceptions sont DÉCLARÉES au-dessus, une par une.
    const expectedResult = declaredReturnTypeRpcs[rpc.name] ?? "uuid";
    if (rpc.result_type !== expectedResult)
      failures.push(
        `Type de retour RPC invalide : ${rpc.name} retourne ${rpc.result_type}, attendu ${expectedResult}`,
      );
    if (rpc.security_definer) failures.push(`RPC SECURITY DEFINER interdite : ${rpc.name}`);
    if (!rpc.settings?.some((setting) => setting === 'search_path=""'))
      failures.push(`search_path non verrouillé : ${rpc.name}`);
    if (rpc.anon_execute) failures.push(`RPC exécutable par anon : ${rpc.name}`);
    if (rpc.authenticated_execute) failures.push(`RPC exécutable par authenticated : ${rpc.name}`);
    if (!rpc.service_role_execute)
      failures.push(`RPC non exécutable par service_role : ${rpc.name}`);
  }

  // ── Garde-fous SECURITY DEFINER ──────────────────────────────────────────────────────
  //
  // Deux garde-fous lisent l'existence d'un objet INDÉPENDAMMENT de la visibilité RLS de
  // l'appelant : SESSION ABSENTE ≠ SESSION INVISIBLE. Un garde qui décide à partir d'une
  // lecture filtrée par la RLS conclut « déjà supprimé » sur une simple absence de droit, et
  // AUTORISE.
  //
  // Ce sont les SEULES fonctions `security definer` du schéma applicatif, et aucune n'est
  // nommée `lfo_*` : le contrat « aucune RPC lfo_* en SECURITY DEFINER », vérifié
  // ci-dessus, reste donc entier.
  //
  // Le contrôle est PARAMÉTRÉ, pas copié. Les deux verticales l'avaient écrit deux fois à un
  // nom près, et deux copies dérivent : celle qu'on oublie de durcir devient la porte.
  const SECURITY_DEFINER_GUARDS = [
    { name: "import_session_freeze_state", args: "p_session_id uuid, p_user_id uuid" },
    { name: "bank_sync_freeze_state", args: "p_run_id uuid, p_user_id uuid" },
  ] as const;

  const guards = await client.query<{
    name: string;
    security_definer: boolean;
    result_type: string;
    arguments: string;
    volatility: string;
    settings: string[] | null;
    anon_execute: boolean;
    authenticated_execute: boolean;
    public_execute: boolean;
    service_role_execute: boolean;
  }>(
    `select proc.proname as name,
            proc.prosecdef as security_definer,
            pg_catalog.pg_get_function_result(proc.oid) as result_type,
            pg_catalog.pg_get_function_arguments(proc.oid) as arguments,
            proc.provolatile::text as volatility,
            proc.proconfig as settings,
            pg_catalog.has_function_privilege('anon', proc.oid, 'execute') as anon_execute,
            pg_catalog.has_function_privilege('authenticated', proc.oid, 'execute') as authenticated_execute,
            pg_catalog.has_function_privilege('public', proc.oid, 'execute') as public_execute,
            pg_catalog.has_function_privilege('service_role', proc.oid, 'execute') as service_role_execute
       from pg_catalog.pg_proc proc
       join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
      where ns.nspname = 'public' and proc.proname = any ($1::text[])`,
    [SECURITY_DEFINER_GUARDS.map((guard) => guard.name)],
  );

  // ── Lectures PURES hors contrat `lfo_*` ───────────────────────────────────────────────
  // `expected_numeric` et `expected_label` ne sont pas des RPC : elles ne portent pas le
  // préfixe, donc la requête `lfo\_%` ci-dessus ne les voit pas. Leur absence ferait
  // pourtant échouer `lfo_commit_portfolio_session` à l'exécution, très loin de la cause,
  // et une régression de leur volatilité ou de leur `search_path` passerait inaperçue.
  const PURE_READERS = [
    { name: "expected_numeric", result: "numeric" },
    { name: "expected_label", result: "text" },
  ] as const;

  const pureReaders = await client.query<{
    name: string;
    security_definer: boolean;
    result_type: string;
    arguments: string;
    volatility: string;
    settings: string[] | null;
    anon_execute: boolean;
    authenticated_execute: boolean;
    public_execute: boolean;
    service_role_execute: boolean;
  }>(
    `select proc.proname as name,
            proc.prosecdef as security_definer,
            pg_catalog.pg_get_function_result(proc.oid) as result_type,
            pg_catalog.pg_get_function_identity_arguments(proc.oid) as arguments,
            proc.provolatile::text as volatility,
            proc.proconfig as settings,
            pg_catalog.has_function_privilege('anon', proc.oid, 'execute') as anon_execute,
            pg_catalog.has_function_privilege('authenticated', proc.oid, 'execute') as authenticated_execute,
            pg_catalog.has_function_privilege('public', proc.oid, 'execute') as public_execute,
            pg_catalog.has_function_privilege('service_role', proc.oid, 'execute') as service_role_execute
       from pg_catalog.pg_proc proc
       join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
      where ns.nspname = 'public' and proc.proname = any ($1::text[])`,
    [PURE_READERS.map((reader) => reader.name)],
  );

  for (const expected of PURE_READERS) {
    const reader = pureReaders.rows.find((row) => row.name === expected.name);
    if (!reader) {
      failures.push(`Lecture pure absente : public.${expected.name}`);
      continue;
    }
    if (reader.arguments !== "p_expected jsonb, p_key text")
      failures.push(`Signature invalide : ${expected.name}(${reader.arguments})`);
    if (reader.result_type !== expected.result)
      failures.push(`Type de retour invalide : ${expected.name} -> ${reader.result_type}`);
    // `i` = immutable. Une lecture de charge ne dépend ni de la base ni de l'heure.
    if (reader.volatility !== "i")
      failures.push(`${expected.name} n'est pas IMMUTABLE : volatilité ${reader.volatility}`);
    if (reader.security_definer)
      failures.push(`${expected.name} ne doit PAS être SECURITY DEFINER`);
    if (!reader.settings?.some((setting) => setting === 'search_path=""'))
      failures.push(`search_path non verrouillé : ${expected.name}`);
    for (const [role, granted] of [
      ["anon", reader.anon_execute],
      ["authenticated", reader.authenticated_execute],
      ["public", reader.public_execute],
    ] as const) {
      if (granted) failures.push(`${expected.name} exécutable par ${role}`);
    }
    if (!reader.service_role_execute)
      failures.push(`${expected.name} non exécutable par service_role`);
  }

  // Aucune AUTRE fonction du schéma applicatif ne doit être `security definer`. Une
  // troisième apparue sans être déclarée ici passerait sinon tous les contrôles.
  const unexpectedDefiners = await client.query<{ name: string }>(
    `select proc.proname as name
       from pg_catalog.pg_proc proc
       join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
      where ns.nspname = 'public' and proc.prosecdef
        and proc.proname <> all ($1::text[])`,
    [SECURITY_DEFINER_GUARDS.map((guard) => guard.name)],
  );
  if (unexpectedDefiners.rows.length > 0) {
    failures.push(
      `Fonction(s) SECURITY DEFINER non déclarée(s) : ${unexpectedDefiners.rows
        .map((row) => row.name)
        .join(", ")}`,
    );
  }

  for (const expected of SECURITY_DEFINER_GUARDS) {
    const guard = guards.rows.find((row) => row.name === expected.name);
    if (!guard) {
      failures.push(`Garde-fou absent : public.${expected.name}`);
      continue;
    }
    if (!guard.security_definer)
      failures.push(
        `${expected.name} n'est pas SECURITY DEFINER : elle redeviendrait aveugle sous RLS`,
      );
    if (guard.arguments !== expected.args)
      failures.push(`Signature invalide : ${expected.name}(${guard.arguments})`);
    if (guard.result_type !== "text")
      failures.push(`Type de retour invalide : ${expected.name} -> ${guard.result_type}`);
    // `s` = stable. Une fonction de garde-fou ne doit rien écrire.
    if (guard.volatility !== "s")
      failures.push(`${expected.name} doit rester stable, sans écriture`);
    if (!guard.settings?.some((setting) => setting === 'search_path=""'))
      failures.push(`search_path non verrouillé : ${expected.name}`);
    for (const [role, granted] of [
      ["anon", guard.anon_execute],
      ["authenticated", guard.authenticated_execute],
      ["public", guard.public_execute],
    ] as const)
      if (granted) failures.push(`${expected.name} exécutable par ${role} : surface interdite`);
    if (!guard.service_role_execute)
      failures.push(`${expected.name} non exécutable par service_role`);
  }

  const buckets = await client.query<{
    id: string;
    public: boolean;
    file_size_limit: number | null;
    allowed_mime_types: string[] | null;
  }>(
    `select id, public, file_size_limit, allowed_mime_types from storage.buckets
      where id in ('family-office-documents', 'family-office-import-staging')`,
  );
  const documentsBucket = buckets.rows.find((row) => row.id === "family-office-documents");
  if (!documentsBucket) failures.push("Bucket Storage absent : family-office-documents");
  else {
    if (documentsBucket.public) failures.push("Bucket Storage public : family-office-documents");
    // Le coffre garde sa vocation : des archives petites et durables. Sa limite n'est PAS
    // relevée pour accueillir un FEC — l'analyse lourde appartient au staging.
    if (Number(documentsBucket.file_size_limit) !== 8_388_608)
      failures.push("Limite du bucket Storage invalide : family-office-documents");
    // Un FEC conservé est du texte à plat. Sans ce type, l'archivage échouerait APRÈS que
    // les faits ont été écrits — le pire moment pour l'apprendre.
    for (const mime of ["text/plain", "application/pdf", "text/csv"]) {
      if (!(documentsBucket.allowed_mime_types ?? []).includes(mime))
        failures.push(`Type MIME absent du bucket family-office-documents : ${mime}`);
    }
  }

  // STAGING ≠ COFFRE DOCUMENTAIRE. Le bucket de staging doit pouvoir accueillir ce que
  // l'application accepte d'analyser, sans quoi le contournement de la limite de corps de
  // requête ne sert à rien : le fichier éviterait la fonction serveur pour être refusé par
  // le stockage.
  const stagingBucket = buckets.rows.find((row) => row.id === "family-office-import-staging");
  if (!stagingBucket) failures.push("Bucket Storage absent : family-office-import-staging");
  else {
    if (stagingBucket.public) failures.push("Bucket Storage public : family-office-import-staging");
    if (Number(stagingBucket.file_size_limit) < MAX_FEC_FILE_BYTES)
      failures.push(
        `Limite du bucket family-office-import-staging (${stagingBucket.file_size_limit}) inférieure au plafond d'analyse (${MAX_FEC_FILE_BYTES})`,
      );
    // UNION de ce que les quatre verticales de FICHIER déposent réellement au staging :
    // texte à plat (relevé bancaire, FEC), PDF (liasse fiscale), classeur (portefeuille).
    // Un type manquant ferait échouer le dépôt APRÈS que le serveur a émis son billet, et
    // le contournement de la limite de corps de requête ne servirait alors à rien.
    for (const mime of [
      "text/plain",
      "text/csv",
      "text/tab-separated-values",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ]) {
      if (!(stagingBucket.allowed_mime_types ?? []).includes(mime))
        failures.push(`Type MIME absent du bucket family-office-import-staging : ${mime}`);
    }
  }
  const storagePolicyRows = await client.query<{
    policyname: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `select policyname, qual, with_check from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'`,
  );
  addMissing(
    failures,
    "Policy(s) Storage",
    storagePolicies,
    storagePolicyRows.rows.map((row) => row.policyname),
  );

  // AUCUNE policy ne doit ouvrir la zone de staging à `authenticated`. Le navigateur n'y
  // accède que par une URL signée, le serveur sous `service_role` : un droit de lecture ou
  // de liste n'ouvrirait aucun usage légitime et exposerait des comptabilités entières.
  for (const policy of storagePolicyRows.rows) {
    const expression = `${policy.qual ?? ""} ${policy.with_check ?? ""}`;
    if (expression.includes("family-office-import-staging")) {
      failures.push(
        `Policy Storage ouvrant la zone de staging : ${policy.policyname}. Le staging n'est accessible que par URL signée et sous service_role.`,
      );
    }
  }

  const migrations = await client.query<{ version: string }>(
    `select version from supabase_migrations.schema_migrations order by version`,
  );
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
    /* connexion possiblement interrompue avant BEGIN */
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
  `Schéma Supabase vérifié en lecture seule : ${userOwnedTables.length} tables attendues et ${observedTableCount} constatées, ${requiredConstraints.length} contraintes, ${Object.keys(requiredRpcs).length} RPC, ${requiredTriggers.length} trigger(s) d'invariant, ${readOnlyAuditTables.length} tables d'audit en lecture seule, RLS/policies, Storage, index de snapshot et ${canonicalMigrations.length} migrations conformes.`,
);
