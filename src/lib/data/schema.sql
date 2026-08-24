PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  reporting_currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TEXT NOT NULL,
  -- Profondeur d'historique déclarée du ledger LFO, globale et non par établissement.
  -- NULL signifie « non déclarée », jamais « depuis toujours ». Jamais déduite d'une
  -- transaction observée. Miroir exact de profiles.ledger_coverage_start côté Postgres.
  ledger_coverage_start TEXT,
  ledger_coverage_source TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (ledger_coverage_source IN ('MANUAL', 'IMPORT', 'API'))
);

CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country_code TEXT,
  external_identifier TEXT
);

CREATE TABLE IF NOT EXISTS asset_classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES asset_classes(id),
  productive INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS financial_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  liquidity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  effective_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS account_balances (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
  balance REAL NOT NULL,
  balance_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_balances_latest ON account_balances(account_id, balance_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  essential INTEGER NOT NULL DEFAULT 0,
  -- Nature canonique du flux. Le moteur ne lit jamais le libellé de la catégorie.
  cash_flow_kind TEXT NOT NULL DEFAULT 'EXPENSE',
  essentiality TEXT NOT NULL DEFAULT 'UNKNOWN',
  expense_behavior TEXT NOT NULL DEFAULT 'UNKNOWN',
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  transaction_date TEXT NOT NULL,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  notes TEXT,
  -- Nature imposée à cette ligne seule, prioritaire sur celle de la catégorie.
  kind_override TEXT,
  -- Rapproche les deux jambes d'un même transfert interne.
  transfer_group_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS securities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ticker TEXT,
  isin TEXT,
  currency TEXT NOT NULL,
  asset_class_id TEXT NOT NULL REFERENCES asset_classes(id)
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
  security_id TEXT NOT NULL REFERENCES securities(id),
  is_cash INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  quantity REAL,
  cost_basis REAL,
  market_value REAL NOT NULL,
  currency TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_position_snapshots_latest ON position_snapshots(position_id, snapshot_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS liabilities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  lender TEXT NOT NULL,
  name TEXT NOT NULL,
  principal REAL NOT NULL,
  current_balance REAL NOT NULL,
  annual_rate REAL NOT NULL,
  monthly_payment REAL NOT NULL,
  payment_count INTEGER NOT NULL,
  first_payment_date TEXT NOT NULL,
  maturity_date TEXT NOT NULL,
  rate_type TEXT NOT NULL DEFAULT 'FIXED'
    CHECK (rate_type IN ('FIXED', 'VARIABLE')),
  -- Forme du remboursement et périodicité. Les défauts reproduisent le comportement
  -- historique : amortissable mensuel à taux proportionnel.
  amortisation_profile TEXT NOT NULL DEFAULT 'AMORTIZING'
    CHECK (amortisation_profile IN ('AMORTIZING', 'INTEREST_ONLY', 'BULLET', 'BALLOON')),
  balloon_amount REAL,
  payment_frequency TEXT NOT NULL DEFAULT 'MONTHLY'
    CHECK (payment_frequency IN ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL')),
  interest_convention TEXT NOT NULL DEFAULT 'PROPORTIONAL'
    CHECK (interest_convention IN ('PROPORTIONAL', 'ACTUAL_365')),
  -- Une tranche reste une dette à part entière ; ceci ne fait que les regrouper.
  facility_id TEXT,
  -- Termes optionnels du contrat. NULL signifie « non renseigné », jamais « zéro » :
  -- c'est cette distinction qui permet au moteur de signaler une ambiguïté.
  monthly_insurance REAL,
  recurring_fees REAL,
  payment_includes_insurance INTEGER,
  deferral_kind TEXT NOT NULL DEFAULT 'NONE'
    CHECK (deferral_kind IN ('NONE', 'PRINCIPAL_ONLY', 'TOTAL')),
  deferral_months INTEGER NOT NULL DEFAULT 0,
  deferral_interest_treatment TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (deferral_interest_treatment IN ('PAID', 'CAPITALISED', 'UNKNOWN')),
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  notes TEXT
);

-- Remboursements anticipés. `penalty` NULL = indemnité inconnue, jamais nulle par défaut.
CREATE TABLE IF NOT EXISTS loan_early_repayments (
  id TEXT PRIMARY KEY,
  liability_id TEXT NOT NULL REFERENCES liabilities(id),
  repayment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  penalty REAL,
  outcome TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (outcome IN ('SHORTEN_TERM', 'REDUCE_PAYMENT', 'UNKNOWN'))
);

-- Frais ponctuels datés, hors échéancier : dossier, garantie, avenant.
CREATE TABLE IF NOT EXISTS loan_charges (
  id TEXT PRIMARY KEY,
  liability_id TEXT NOT NULL REFERENCES liabilities(id),
  charge_date TEXT NOT NULL,
  amount REAL NOT NULL,
  label TEXT NOT NULL,
  -- 1 : frais incorporé au financement, aucun décaissement mais l'encours augmente.
  financed INTEGER NOT NULL DEFAULT 0
);

-- Termes datés : un taux ou un paiement qui change à partir d'une date.
-- term_kind distingue une clause du contrat d'une hypothèse que nous posons.
CREATE TABLE IF NOT EXISTS loan_rate_changes (
  id TEXT PRIMARY KEY,
  liability_id TEXT NOT NULL REFERENCES liabilities(id),
  effective_from TEXT NOT NULL,
  annual_rate REAL NOT NULL,
  term_kind TEXT NOT NULL DEFAULT 'CONTRACTUAL'
    CHECK (term_kind IN ('CONTRACTUAL', 'ASSUMPTION')),
  UNIQUE(liability_id, effective_from)
);

CREATE TABLE IF NOT EXISTS loan_payment_changes (
  id TEXT PRIMARY KEY,
  liability_id TEXT NOT NULL REFERENCES liabilities(id),
  effective_from TEXT NOT NULL,
  amount REAL NOT NULL,
  term_kind TEXT NOT NULL DEFAULT 'CONTRACTUAL'
    CHECK (term_kind IN ('CONTRACTUAL', 'ASSUMPTION')),
  UNIQUE(liability_id, effective_from)
);

-- Échéancier stocké. Seules les lignes kind='ACTUAL' constituent un échéancier bancaire
-- réel et priment sur toute reconstruction : une ligne DERIVED reste une hypothèse.
CREATE TABLE IF NOT EXISTS loan_schedules (
  id TEXT PRIMARY KEY,
  liability_id TEXT NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  payment_number INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  opening_balance REAL NOT NULL,
  payment REAL NOT NULL,
  interest REAL NOT NULL,
  principal REAL NOT NULL,
  insurance REAL NOT NULL DEFAULT 0,
  fees REAL NOT NULL DEFAULT 0,
  closing_balance REAL NOT NULL,
  kind TEXT NOT NULL,
  UNIQUE(liability_id, payment_number)
);

CREATE TABLE IF NOT EXISTS income_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  monthly_net REAL,
  active INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  effective_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  lifestyle TEXT NOT NULL,
  monthly_amount REAL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  effective_date TEXT,
  UNIQUE(user_id, category_id, lifestyle)
);

CREATE TABLE IF NOT EXISTS tax_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  residency_country TEXT NOT NULL,
  household_status TEXT NOT NULL,
  effective_from TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_rules (
  id TEXT PRIMARY KEY,
  jurisdiction TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  value REAL,
  unit TEXT,
  source TEXT,
  verified_at TEXT,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS economic_assumptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  unit TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  effective_date TEXT,
  updated_at TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS market_assumptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  asset_class_id TEXT REFERENCES asset_classes(id),
  name TEXT NOT NULL,
  expected_return REAL,
  volatility REAL,
  inflation REAL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  effective_date TEXT
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  color TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  annual_return REAL NOT NULL,
  annual_volatility REAL NOT NULL,
  annual_inflation REAL NOT NULL,
  monthly_savings REAL NOT NULL,
  investment_allocation_rate REAL NOT NULL DEFAULT 1,
  salary_growth REAL NOT NULL,
  stress_probability REAL NOT NULL,
  shock_year INTEGER,
  shock_magnitude REAL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenario_versions (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(scenario_id, version)
);

CREATE TABLE IF NOT EXISTS scenario_assumptions (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  assumption_key TEXT NOT NULL,
  value_number REAL,
  value_text TEXT,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  UNIQUE(scenario_id, assumption_key)
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  target_date TEXT,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  snapshot_date TEXT NOT NULL,
  gross_assets REAL NOT NULL,
  debt REAL NOT NULL,
  net_worth REAL NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monthly_closes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  close_date TEXT NOT NULL,
  gross_assets REAL NOT NULL,
  debt REAL NOT NULL,
  net_worth REAL NOT NULL,
  forecast_net_worth REAL,
  variance REAL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, close_date)
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  property_type TEXT NOT NULL,
  location TEXT,
  purchase_price REAL,
  surface_sqm REAL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mortgages (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  principal REAL NOT NULL,
  annual_rate REAL NOT NULL,
  term_months INTEGER NOT NULL,
  insurance_rate REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS real_estate_cashflows (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  cashflow_date TEXT NOT NULL,
  cashflow_type TEXT NOT NULL,
  amount REAL NOT NULL,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  legal_form TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_ownership (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  ownership_rate REAL NOT NULL,
  effective_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_financials (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  period_end TEXT NOT NULL,
  revenue REAL,
  ebitda REAL,
  cash REAL,
  debt REAL,
  working_capital REAL,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_valuations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  valuation_date TEXT NOT NULL,
  method TEXT NOT NULL,
  enterprise_value REAL NOT NULL,
  equity_value REAL NOT NULL,
  assumptions_json TEXT NOT NULL,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_metadata (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  metadata_key TEXT NOT NULL,
  metadata_value TEXT,
  UNIQUE(document_id, metadata_key)
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  url TEXT,
  last_checked_at TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS currency_rates (
  id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  rate_date TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  UNIQUE(base_currency, quote_currency, rate_date, source)
);

CREATE TABLE IF NOT EXISTS simulation_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  seed INTEGER NOT NULL,
  simulations INTEGER NOT NULL,
  years INTEGER NOT NULL,
  methodology TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS simulation_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  p10 REAL NOT NULL,
  p25 REAL NOT NULL,
  p50 REAL NOT NULL,
  p75 REAL NOT NULL,
  p90 REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  results_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_cash_flow_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  cash_flow_kind TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  account_id TEXT REFERENCES financial_accounts(id),
  amount REAL NOT NULL,
  frequency TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  day_of_month INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_user ON recurring_cash_flow_rules(user_id, active);

CREATE TABLE IF NOT EXISTS cash_flow_monthly_closes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,
  version INTEGER NOT NULL,
  income REAL NOT NULL,
  consumer_expenses REAL NOT NULL,
  essential_expenses REAL NOT NULL,
  taxes_paid REAL NOT NULL,
  debt_service_paid REAL NOT NULL,
  investment_flows REAL NOT NULL,
  internal_transfers REAL NOT NULL,
  operating_surplus_before_debt REAL NOT NULL,
  post_debt_surplus REAL NOT NULL,
  unclassified_transaction_count INTEGER NOT NULL,
  closed_at TEXT NOT NULL,
  UNIQUE(user_id, month, version)
);
