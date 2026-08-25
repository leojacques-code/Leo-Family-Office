-- Canonical Balance Sheet / Net Worth Engine V2
--
-- Évolution sans suppression de données : les anciennes colonnes `debt` restent lisibles
-- comme dette legacy, tandis que `total_liabilities` porte désormais la sémantique V2.
-- Une date de snapshot peut avoir plusieurs versions ; aucune version ACTUAL n'est écrasée.

alter table public.net_worth_snapshots
  add column if not exists version integer not null default 1,
  add column if not exists financial_assets numeric(20,6),
  add column if not exists liquid_assets numeric(20,6),
  add column if not exists account_overdrafts numeric(20,6),
  add column if not exists contractual_debt numeric(20,6),
  add column if not exists other_liabilities numeric(20,6),
  add column if not exists total_liabilities numeric(20,6),
  add column if not exists reporting_currency char(3) not null default 'EUR',
  add column if not exists completeness_status text not null default 'COMPLETE',
  add column if not exists data_completeness numeric(8,6),
  add column if not exists composition jsonb not null default '{}'::jsonb,
  add column if not exists provenance jsonb not null default '{}'::jsonb;

update public.net_worth_snapshots
   set financial_assets = coalesce(financial_assets, gross_assets),
       contractual_debt = coalesce(contractual_debt, debt),
       total_liabilities = coalesce(total_liabilities, debt),
       account_overdrafts = coalesce(account_overdrafts, 0),
       other_liabilities = coalesce(other_liabilities, 0)
 where financial_assets is null
    or contractual_debt is null
    or total_liabilities is null
    or account_overdrafts is null
    or other_liabilities is null;

alter table public.net_worth_snapshots
  drop constraint if exists net_worth_snapshots_user_id_snapshot_date_key;

create unique index if not exists net_worth_snapshots_user_date_version_uidx
  on public.net_worth_snapshots(user_id, snapshot_date, version);
create index if not exists net_worth_snapshots_history_idx
  on public.net_worth_snapshots(user_id, snapshot_date desc, version desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'net_worth_snapshots_version_ck'
       and conrelid = 'public.net_worth_snapshots'::regclass
  ) then
    alter table public.net_worth_snapshots
      add constraint net_worth_snapshots_version_ck check (version > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'net_worth_snapshots_completeness_ck'
       and conrelid = 'public.net_worth_snapshots'::regclass
  ) then
    alter table public.net_worth_snapshots
      add constraint net_worth_snapshots_completeness_ck
      check (completeness_status in ('COMPLETE', 'PARTIAL', 'NOT_COMPUTABLE'));
  end if;
end;
$$;

create table if not exists public.net_worth_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null references public.net_worth_snapshots(id) on delete cascade,
  domain text not null,
  entity_id text not null,
  side text not null check (side in ('ASSET', 'LIABILITY')),
  category text not null,
  subcategory text,
  native_amount numeric(20,6) not null check (native_amount >= 0),
  currency char(3) not null,
  fx_rate numeric(20,10),
  fx_rate_date date,
  reporting_amount numeric(20,6),
  valuation_date date not null,
  valuation_method text not null,
  valuation_status text not null,
  data_kind text not null,
  confidence text not null,
  quality_status text not null,
  source text,
  flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists net_worth_snapshot_items_snapshot_idx
  on public.net_worth_snapshot_items(snapshot_id);
create index if not exists net_worth_snapshot_items_user_date_idx
  on public.net_worth_snapshot_items(user_id, valuation_date desc);

alter table public.net_worth_snapshot_items enable row level security;
drop policy if exists owner_all on public.net_worth_snapshot_items;
create policy owner_all on public.net_worth_snapshot_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.net_worth_snapshot_items from anon;
grant select, insert, update, delete on table public.net_worth_snapshot_items to authenticated;
grant all on table public.net_worth_snapshot_items to service_role;

alter table public.monthly_closes
  add column if not exists version integer not null default 1,
  add column if not exists account_overdrafts numeric(20,6),
  add column if not exists contractual_debt numeric(20,6),
  add column if not exists other_liabilities numeric(20,6),
  add column if not exists total_liabilities numeric(20,6),
  add column if not exists liquid_assets numeric(20,6),
  add column if not exists reporting_currency char(3) not null default 'EUR',
  add column if not exists completeness_status text not null default 'COMPLETE',
  add column if not exists composition jsonb not null default '{}'::jsonb;

update public.monthly_closes
   set contractual_debt = coalesce(contractual_debt, debt),
       total_liabilities = coalesce(total_liabilities, debt),
       account_overdrafts = coalesce(account_overdrafts, 0),
       other_liabilities = coalesce(other_liabilities, 0)
 where contractual_debt is null
    or total_liabilities is null
    or account_overdrafts is null
    or other_liabilities is null;

alter table public.monthly_closes
  drop constraint if exists monthly_closes_user_id_close_date_key;
create unique index if not exists monthly_closes_user_date_version_uidx
  on public.monthly_closes(user_id, close_date, version);

create or replace function public.lfo_create_monthly_close_v2(
  p_user_id uuid,
  p_close_date date,
  p_snapshot jsonb,
  p_items jsonb,
  p_forecast_net_worth numeric,
  p_variance numeric
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_close_id uuid;
  v_snapshot_id uuid;
  v_version integer;
  v_item jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_close_date::text));
  select coalesce(max(version), 0) + 1 into v_version
    from public.net_worth_snapshots
   where user_id = p_user_id and snapshot_date = p_close_date;

  insert into public.monthly_closes (
    user_id, close_date, version, gross_assets, debt, net_worth,
    forecast_net_worth, variance, account_overdrafts, contractual_debt,
    other_liabilities, total_liabilities, liquid_assets, reporting_currency,
    completeness_status, composition
  ) values (
    p_user_id, p_close_date, v_version,
    (p_snapshot->>'gross_assets')::numeric,
    (p_snapshot->>'contractual_debt')::numeric,
    (p_snapshot->>'net_worth')::numeric,
    p_forecast_net_worth, p_variance,
    (p_snapshot->>'account_overdrafts')::numeric,
    (p_snapshot->>'contractual_debt')::numeric,
    (p_snapshot->>'other_liabilities')::numeric,
    (p_snapshot->>'total_liabilities')::numeric,
    (p_snapshot->>'liquid_assets')::numeric,
    p_snapshot->>'reporting_currency',
    p_snapshot->>'completeness_status',
    coalesce(p_snapshot->'composition', '{}'::jsonb)
  ) returning id into v_close_id;

  insert into public.net_worth_snapshots (
    user_id, snapshot_date, version, gross_assets, debt, net_worth, data_kind,
    financial_assets, liquid_assets, account_overdrafts, contractual_debt,
    other_liabilities, total_liabilities, reporting_currency,
    completeness_status, data_completeness, composition, provenance
  ) values (
    p_user_id, p_close_date, v_version,
    (p_snapshot->>'gross_assets')::numeric,
    (p_snapshot->>'contractual_debt')::numeric,
    (p_snapshot->>'net_worth')::numeric,
    coalesce(p_snapshot->>'data_kind', 'ACTUAL'),
    (p_snapshot->>'financial_assets')::numeric,
    (p_snapshot->>'liquid_assets')::numeric,
    (p_snapshot->>'account_overdrafts')::numeric,
    (p_snapshot->>'contractual_debt')::numeric,
    (p_snapshot->>'other_liabilities')::numeric,
    (p_snapshot->>'total_liabilities')::numeric,
    p_snapshot->>'reporting_currency',
    p_snapshot->>'completeness_status',
    (p_snapshot->>'data_completeness')::numeric,
    coalesce(p_snapshot->'composition', '{}'::jsonb),
    coalesce(p_snapshot->'provenance', '{}'::jsonb)
  ) returning id into v_snapshot_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.net_worth_snapshot_items (
      user_id, snapshot_id, domain, entity_id, side, category, subcategory,
      native_amount, currency, fx_rate, fx_rate_date, reporting_amount,
      valuation_date, valuation_method, valuation_status, data_kind,
      confidence, quality_status, source, flags
    ) values (
      p_user_id, v_snapshot_id, v_item->>'domain', v_item->>'entity_id',
      v_item->>'side', v_item->>'category', v_item->>'subcategory',
      (v_item->>'native_amount')::numeric, v_item->>'currency',
      nullif(v_item->>'fx_rate', '')::numeric,
      nullif(v_item->>'fx_rate_date', '')::date,
      nullif(v_item->>'reporting_amount', '')::numeric,
      (v_item->>'valuation_date')::date, v_item->>'valuation_method',
      v_item->>'valuation_status', v_item->>'data_kind', v_item->>'confidence',
      v_item->>'quality_status', v_item->>'source', coalesce(v_item->'flags', '[]'::jsonb)
    );
  end loop;
  return v_close_id;
end;
$$;

-- L'ancien contrat reste disponible, mais devient append-only : plus aucun UPSERT ACTUAL.
create or replace function public.lfo_create_monthly_close(
  p_user_id uuid,
  p_close_date date,
  p_gross_assets numeric,
  p_debt numeric,
  p_net_worth numeric,
  p_forecast_net_worth numeric,
  p_variance numeric
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_close_id uuid;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_close_date::text));
  select coalesce(max(version), 0) + 1 into v_version
    from public.net_worth_snapshots
   where user_id = p_user_id and snapshot_date = p_close_date;
  insert into public.monthly_closes (
    user_id, close_date, version, gross_assets, debt, net_worth,
    forecast_net_worth, variance, contractual_debt, total_liabilities
  ) values (
    p_user_id, p_close_date, v_version, p_gross_assets, p_debt, p_net_worth,
    p_forecast_net_worth, p_variance, p_debt, p_debt
  ) returning id into v_close_id;
  insert into public.net_worth_snapshots (
    user_id, snapshot_date, version, gross_assets, debt, net_worth, data_kind,
    financial_assets, contractual_debt, total_liabilities
  ) values (
    p_user_id, p_close_date, v_version, p_gross_assets, p_debt, p_net_worth,
    'ACTUAL', p_gross_assets, p_debt, p_debt
  );
  return v_close_id;
end;
$$;

revoke all on function public.lfo_create_monthly_close_v2(uuid,date,jsonb,jsonb,numeric,numeric)
  from public, anon, authenticated;
grant execute on function public.lfo_create_monthly_close_v2(uuid,date,jsonb,jsonb,numeric,numeric)
  to service_role;

comment on column public.monthly_closes.debt is
  'Legacy contractual-debt field. Use total_liabilities for Canonical Balance Sheet V2.';
comment on column public.net_worth_snapshots.debt is
  'Legacy contractual-debt field. Use total_liabilities for Canonical Balance Sheet V2.';
