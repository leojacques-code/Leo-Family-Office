-- Léo Family Office — production PostgreSQL/Supabase schema
-- Apply through the Supabase CLI after linking a project. All user data is private by default.

create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  reporting_currency char(3) not null default 'EUR',
  created_at timestamptz not null default now()
);

create table public.institutions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, country_code char(2), external_identifier text,
  unique(user_id, name)
);

create table public.asset_classes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, parent_id uuid references public.asset_classes(id), productive boolean not null default true
);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  institution_id uuid references public.institutions(id), name text not null, account_type text not null,
  currency char(3) not null default 'EUR', liquidity text not null, status text not null default 'ACTIVE',
  data_kind text not null check (data_kind in ('ACTUAL','USER_ASSUMPTION','MODEL_ASSUMPTION','EXTERNAL_DATA','DERIVED','MISSING')),
  confidence text not null, source text, effective_date date, notes text, created_at timestamptz not null default now()
);

create table public.account_balances (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.financial_accounts(id) on delete cascade,
  balance numeric(20,6) not null, balance_date date not null, data_kind text not null, confidence text not null,
  source text, created_at timestamptz not null default now()
);
create index account_balances_latest_idx on public.account_balances(user_id, account_id, balance_date desc, created_at desc);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, group_name text not null, essential boolean not null default false
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.financial_accounts(id), category_id uuid references public.expense_categories(id),
  transaction_date date not null, label text not null, amount numeric(20,6) not null, currency char(3) not null,
  data_kind text not null, confidence text not null, source text, notes text, manual_override boolean not null default true,
  created_at timestamptz not null default now()
);
create index transactions_user_date_idx on public.transactions(user_id, transaction_date desc);

create table public.securities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, ticker text, isin text, currency char(3) not null, asset_class_id uuid references public.asset_classes(id)
);

create table public.positions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.financial_accounts(id) on delete cascade,
  security_id uuid not null references public.securities(id), is_cash boolean not null default false,
  data_kind text not null, confidence text not null, source text, notes text
);

create table public.position_snapshots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade, snapshot_date date not null,
  quantity numeric(30,10), cost_basis numeric(20,6), market_value numeric(20,6) not null, currency char(3) not null,
  data_kind text not null, confidence text not null, source text, created_at timestamptz not null default now()
);
create index position_snapshots_latest_idx on public.position_snapshots(user_id, position_id, snapshot_date desc, created_at desc);

create table public.liabilities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  lender text not null, name text not null, principal numeric(20,6) not null, current_balance numeric(20,6) not null,
  annual_rate numeric(12,8) not null, monthly_payment numeric(20,6) not null, payment_count integer not null,
  first_payment_date date not null, maturity_date date not null, rate_type text not null default 'FIXED',
  data_kind text not null, confidence text not null, source text, notes text
);

create table public.loan_schedules (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  liability_id uuid not null references public.liabilities(id) on delete cascade, payment_number integer not null,
  due_date date not null, opening_balance numeric(20,6) not null, payment numeric(20,6) not null,
  interest numeric(20,6) not null, principal numeric(20,6) not null, closing_balance numeric(20,6) not null,
  data_kind text not null, unique(liability_id, payment_number)
);

create table public.income_sources (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, monthly_net numeric(20,6), active boolean not null default false, start_date date,
  data_kind text not null, confidence text not null, source text, effective_date date, notes text
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.expense_categories(id), lifestyle text not null,
  monthly_amount numeric(20,6), data_kind text not null, confidence text not null, source text, effective_date date,
  unique(user_id, category_id, lifestyle)
);

create table public.properties (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, property_type text not null, location text, purchase_price numeric(20,6), surface_sqm numeric(12,3),
  status text not null, inputs jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table public.mortgages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade, principal numeric(20,6) not null,
  annual_rate numeric(12,8) not null, term_months integer not null, insurance_rate numeric(12,8) not null default 0
);

create table public.real_estate_cashflows (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade, cashflow_date date not null,
  cashflow_type text not null, amount numeric(20,6) not null, data_kind text not null
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, legal_form text, status text not null, created_at timestamptz not null default now()
);

create table public.business_ownership (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade, ownership_rate numeric(12,8) not null,
  dilution_adjusted_rate numeric(12,8), effective_date date not null
);

create table public.business_financials (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade, period_end date not null,
  revenue numeric(20,6), gross_margin numeric(12,8), ebitda numeric(20,6), cash numeric(20,6), debt numeric(20,6),
  working_capital numeric(20,6), data_kind text not null
);

create table public.business_valuations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade, valuation_date date not null,
  method text not null, enterprise_value numeric(20,6) not null, equity_value numeric(20,6) not null,
  assumptions jsonb not null, data_kind text not null
);

create table public.tax_profiles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  residency_country char(2) not null, household_status text not null, effective_from date not null
);

create table public.tax_rules (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  jurisdiction text not null, name text not null, tax_year integer not null, rule jsonb not null,
  source text not null, verified_at date, data_kind text not null, confidence text not null
);

create table public.economic_assumptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, value jsonb, unit text not null, data_kind text not null, confidence text not null,
  source text, effective_date date, updated_at timestamptz not null default now(), notes text
);

create table public.market_assumptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  asset_class_id uuid references public.asset_classes(id), name text not null, expected_return numeric(12,8),
  volatility numeric(12,8), inflation numeric(12,8), correlations jsonb, stress_regime jsonb,
  data_kind text not null, confidence text not null, source text, effective_date date
);

create table public.scenarios (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, description text not null, color text not null, current_version integer not null default 1,
  data_kind text not null, confidence text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.scenario_versions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  scenario_id uuid not null references public.scenarios(id) on delete cascade, version integer not null,
  payload jsonb not null, created_at timestamptz not null default now(), unique(scenario_id, version)
);

create table public.scenario_assumptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  scenario_id uuid not null references public.scenarios(id) on delete cascade, assumption_key text not null,
  value jsonb, data_kind text not null, confidence text not null, unique(scenario_id, assumption_key)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, target_amount numeric(20,6) not null, target_date date, priority integer not null, status text not null
);

create table public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null, gross_assets numeric(20,6) not null, debt numeric(20,6) not null,
  net_worth numeric(20,6) not null, data_kind text not null, created_at timestamptz not null default now(),
  unique(user_id, snapshot_date)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, category text not null, storage_path text not null, size_bytes bigint not null,
  status text not null, uploaded_at timestamptz not null default now()
);

create table public.document_metadata (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade, metadata_key text not null,
  metadata_value jsonb, unique(document_id, metadata_key)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  severity text not null, title text not null, detail text not null, status text not null,
  created_at timestamptz not null default now(), resolved_at timestamptz
);

create table public.external_sources (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, source_type text not null, url text, last_checked_at timestamptz, status text not null
);

create table public.currency_rates (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  base_currency char(3) not null, quote_currency char(3) not null, rate numeric(20,10) not null,
  rate_date date not null, source text not null, data_kind text not null,
  unique(user_id, base_currency, quote_currency, rate_date, source)
);

create table public.simulation_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  scenario_id uuid not null references public.scenarios(id), seed integer not null, simulations integer not null,
  years integer not null, methodology text not null, created_at timestamptz not null default now()
);

create table public.simulation_results (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.simulation_runs(id) on delete cascade, year integer not null,
  p10 numeric(20,6) not null, p25 numeric(20,6) not null, p50 numeric(20,6) not null,
  p75 numeric(20,6) not null, p90 numeric(20,6) not null, unique(run_id, year)
);

create table public.decision_cases (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, decision_type text not null, inputs jsonb not null, results jsonb,
  status text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.monthly_closes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  close_date date not null, gross_assets numeric(20,6) not null, debt numeric(20,6) not null,
  net_worth numeric(20,6) not null, forecast_net_worth numeric(20,6), variance numeric(20,6),
  created_at timestamptz not null default now(), unique(user_id, close_date)
);

-- New Supabase projects no longer expose SQL-created tables to the Data API automatically.
-- Explicit grants are paired with RLS below; anon receives no table access.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

do $$
declare target record;
begin
  for target in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'user_id'
  loop
    execute format('alter table public.%I enable row level security', target.table_name);
    execute format('drop policy if exists owner_all on public.%I', target.table_name);
    execute format(
      'create policy owner_all on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      target.table_name
    );
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-office-documents', 'family-office-documents', false, 8388608,
  array['application/pdf','image/png','image/jpeg','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists documents_owner_select on storage.objects;
create policy documents_owner_select on storage.objects for select to authenticated
using (bucket_id = 'family-office-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists documents_owner_insert on storage.objects;
create policy documents_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'family-office-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists documents_owner_update on storage.objects;
create policy documents_owner_update on storage.objects for update to authenticated
using (bucket_id = 'family-office-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'family-office-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists documents_owner_delete on storage.objects;
create policy documents_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'family-office-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
