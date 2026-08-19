PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  reporting_currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TEXT NOT NULL
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
  essential INTEGER NOT NULL DEFAULT 0
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
  rate_type TEXT NOT NULL DEFAULT 'FIXED',
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS loan_schedules (
  id TEXT PRIMARY KEY,
  liability_id TEXT NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  payment_number INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  opening_balance REAL NOT NULL,
  payment REAL NOT NULL,
  interest REAL NOT NULL,
  principal REAL NOT NULL,
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
