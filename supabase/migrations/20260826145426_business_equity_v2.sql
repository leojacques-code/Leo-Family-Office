-- Business Equity V2 — facts only; valuation/performance remain derived in TypeScript.
alter table public.businesses
  add column if not exists business_type text,
  add column if not exists functional_currency char(3),
  add column if not exists archived boolean not null default false,
  add column if not exists data_kind text not null default 'USER_ASSUMPTION',
  add column if not exists confidence text not null default 'HIGH',
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.business_ownership
  add column if not exists economic_rate numeric(12,8),
  add column if not exists voting_rate numeric(12,8),
  add column if not exists fully_diluted_rate numeric(12,8),
  add column if not exists data_kind text not null default 'USER_ASSUMPTION',
  add column if not exists confidence text not null default 'HIGH',
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

alter table public.business_financials
  add column if not exists currency char(3),
  add column if not exists ebit numeric(20,6),
  add column if not exists net_income numeric(20,6),
  add column if not exists capex numeric(20,6),
  add column if not exists free_cash_flow numeric(20,6),
  add column if not exists confidence text not null default 'MEDIUM',
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

alter table public.business_valuations
  alter column enterprise_value drop not null,
  alter column equity_value drop not null,
  add column if not exists currency char(3),
  add column if not exists valuation_multiple numeric(20,8),
  add column if not exists confidence text not null default 'MEDIUM',
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists businesses_id_user_uidx on public.businesses(id, user_id);
create unique index if not exists transactions_id_user_uidx on public.transactions(id, user_id);

alter table public.business_ownership drop constraint if exists business_ownership_business_id_fkey;
alter table public.business_financials drop constraint if exists business_financials_business_id_fkey;
alter table public.business_valuations drop constraint if exists business_valuations_business_id_fkey;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='business_ownership_business_fk') then
    alter table public.business_ownership add constraint business_ownership_business_fk foreign key (business_id,user_id) references public.businesses(id,user_id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='business_financials_business_fk') then
    alter table public.business_financials add constraint business_financials_business_fk foreign key (business_id,user_id) references public.businesses(id,user_id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='business_valuations_business_fk') then
    alter table public.business_valuations add constraint business_valuations_business_fk foreign key (business_id,user_id) references public.businesses(id,user_id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='business_ownership_rates_ck') then
    alter table public.business_ownership add constraint business_ownership_rates_ck check (
      ownership_rate > 0 and ownership_rate <= 1 and
      (economic_rate is null or (economic_rate > 0 and economic_rate <= 1)) and
      (voting_rate is null or (voting_rate >= 0 and voting_rate <= 1)) and
      (fully_diluted_rate is null or (fully_diluted_rate > 0 and fully_diluted_rate <= 1))
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='business_valuations_value_ck') then
    alter table public.business_valuations add constraint business_valuations_value_ck check (enterprise_value is not null or equity_value is not null);
  end if;
end $$;

create unique index if not exists business_ownership_effective_uk on public.business_ownership(user_id,business_id,effective_date);
create index if not exists business_ownership_business_owner_idx on public.business_ownership(business_id,user_id);
create index if not exists business_financials_business_owner_idx on public.business_financials(business_id,user_id);
create index if not exists business_valuations_business_owner_idx on public.business_valuations(business_id,user_id);

create table if not exists public.business_capital_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null,
  event_type text not null,
  event_date date not null,
  amount numeric(20,6) not null,
  currency char(3) not null,
  ownership_delta numeric(12,8),
  transaction_id uuid,
  data_kind text not null default 'ACTUAL',
  confidence text not null default 'HIGH',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint business_capital_events_business_fk foreign key (business_id,user_id) references public.businesses(id,user_id) on delete cascade,
  constraint business_capital_events_transaction_fk foreign key (transaction_id,user_id) references public.transactions(id,user_id) on delete set null (transaction_id),
  constraint business_capital_events_amount_ck check (amount >= 0),
  constraint business_capital_events_type_ck check (event_type in ('OPENING_COST_BASIS','ACQUISITION','CAPITAL_INJECTION','SALE','DIVIDEND','DISTRIBUTION','CAPITAL_RETURN')),
  constraint business_capital_events_ownership_delta_ck check (ownership_delta is null or (ownership_delta >= -1 and ownership_delta <= 1))
);
create index if not exists business_capital_events_business_owner_idx on public.business_capital_events(business_id,user_id);
create index if not exists business_capital_events_transaction_owner_idx on public.business_capital_events(transaction_id,user_id) where transaction_id is not null;

create table if not exists public.business_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_business_id uuid not null,
  child_business_id uuid not null,
  effective_date date not null,
  ownership_rate numeric(12,8) not null,
  data_kind text not null default 'USER_ASSUMPTION',
  confidence text not null default 'HIGH',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint business_holdings_parent_fk foreign key (parent_business_id,user_id) references public.businesses(id,user_id) on delete cascade,
  constraint business_holdings_child_fk foreign key (child_business_id,user_id) references public.businesses(id,user_id) on delete cascade,
  constraint business_holdings_no_self_ck check (parent_business_id <> child_business_id),
  constraint business_holdings_rate_ck check (ownership_rate > 0 and ownership_rate <= 1),
  constraint business_holdings_effective_uk unique(user_id,parent_business_id,child_business_id,effective_date)
);
create index if not exists business_holdings_parent_owner_idx on public.business_holdings(parent_business_id,user_id);
create index if not exists business_holdings_child_owner_idx on public.business_holdings(child_business_id,user_id);

alter table public.business_capital_events enable row level security;
alter table public.business_holdings enable row level security;
drop policy if exists owner_all on public.business_capital_events;
create policy owner_all on public.business_capital_events for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists owner_all on public.business_holdings;
create policy owner_all on public.business_holdings for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.business_capital_events, public.business_holdings from anon;
grant select,insert,update,delete on public.business_capital_events, public.business_holdings to authenticated;

create or replace function public.lfo_save_business(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid := nullif(p_payload->>'business_id','')::uuid;
begin
  if nullif(p_payload->>'name','') is null then raise exception 'Nom de société requis'; end if;
  if v_id is null then
    v_id:=gen_random_uuid();
    insert into public.businesses(id,user_id,name,legal_form,status,business_type,functional_currency,archived,data_kind,confidence,source,notes,updated_at)
    values(v_id,p_user_id,p_payload->>'name',nullif(p_payload->>'legal_form',''),'ACTIVE',nullif(p_payload->>'business_type',''),upper(nullif(p_payload->>'functional_currency','')),false,'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now());
  else
    update public.businesses set name=p_payload->>'name',legal_form=nullif(p_payload->>'legal_form',''),business_type=nullif(p_payload->>'business_type',''),functional_currency=upper(nullif(p_payload->>'functional_currency','')),notes=nullif(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_user_id;
    if not found then raise exception 'Société introuvable'; end if;
  end if; return v_id;
end $$;

create or replace function public.lfo_archive_business(p_user_id uuid,p_business_id uuid) returns uuid language plpgsql security invoker set search_path='' as $$ begin update public.businesses set archived=true,status='ARCHIVED',updated_at=now() where id=p_business_id and user_id=p_user_id; if not found then raise exception 'Société introuvable'; end if; return p_business_id; end $$;

create or replace function public.lfo_record_business_ownership(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid; begin
  insert into public.business_ownership(user_id,business_id,ownership_rate,economic_rate,voting_rate,fully_diluted_rate,effective_date,data_kind,confidence,source,notes)
  values(p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'legal_rate')::numeric,nullif(p_payload->>'economic_rate','')::numeric,nullif(p_payload->>'voting_rate','')::numeric,nullif(p_payload->>'fully_diluted_rate','')::numeric,(p_payload->>'effective_date')::date,'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''))
  on conflict(user_id,business_id,effective_date) do update set ownership_rate=excluded.ownership_rate,economic_rate=excluded.economic_rate,voting_rate=excluded.voting_rate,fully_diluted_rate=excluded.fully_diluted_rate,source=excluded.source,notes=excluded.notes returning id into v_id; return v_id; end $$;

create or replace function public.lfo_record_business_financials(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid:=gen_random_uuid(); begin
  insert into public.business_financials(id,user_id,business_id,period_end,revenue,gross_margin,ebitda,ebit,net_income,cash,debt,working_capital,capex,free_cash_flow,currency,data_kind,confidence,source,notes)
  values(v_id,p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'period_end')::date,nullif(p_payload->>'revenue','')::numeric,nullif(p_payload->>'gross_margin','')::numeric,nullif(p_payload->>'ebitda','')::numeric,nullif(p_payload->>'ebit','')::numeric,nullif(p_payload->>'net_income','')::numeric,nullif(p_payload->>'cash','')::numeric,nullif(p_payload->>'gross_debt','')::numeric,nullif(p_payload->>'working_capital','')::numeric,nullif(p_payload->>'capex','')::numeric,nullif(p_payload->>'free_cash_flow','')::numeric,upper(nullif(p_payload->>'currency','')),coalesce(nullif(p_payload->>'data_kind',''),'ACTUAL'),coalesce(nullif(p_payload->>'confidence',''),'HIGH'),nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')); return v_id; end $$;

create or replace function public.lfo_record_business_valuation(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid:=gen_random_uuid(); begin
  insert into public.business_valuations(id,user_id,business_id,valuation_date,method,enterprise_value,equity_value,assumptions,data_kind,currency,valuation_multiple,confidence,source,notes)
  values(v_id,p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'valuation_date')::date,p_payload->>'method',nullif(p_payload->>'enterprise_value','')::numeric,nullif(p_payload->>'equity_value','')::numeric,coalesce(p_payload->'assumptions','{}'::jsonb),coalesce(nullif(p_payload->>'data_kind',''),'USER_ASSUMPTION'),upper(nullif(p_payload->>'currency','')),nullif(p_payload->>'valuation_multiple','')::numeric,coalesce(nullif(p_payload->>'confidence',''),'MEDIUM'),nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')); return v_id; end $$;

create or replace function public.lfo_record_business_capital_event(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid:=gen_random_uuid(); begin
  insert into public.business_capital_events(id,user_id,business_id,event_type,event_date,amount,currency,ownership_delta,transaction_id,data_kind,confidence,source,notes)
  values(v_id,p_user_id,(p_payload->>'business_id')::uuid,p_payload->>'event_type',(p_payload->>'event_date')::date,(p_payload->>'amount')::numeric,upper(p_payload->>'currency'),nullif(p_payload->>'ownership_delta','')::numeric,nullif(p_payload->>'transaction_id','')::uuid,coalesce(nullif(p_payload->>'data_kind',''),'ACTUAL'),coalesce(nullif(p_payload->>'confidence',''),'HIGH'),nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')); return v_id; end $$;

create or replace function public.lfo_set_business_holding(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid; begin
  insert into public.business_holdings(user_id,parent_business_id,child_business_id,effective_date,ownership_rate,data_kind,confidence,source,notes)
  values(p_user_id,(p_payload->>'parent_business_id')::uuid,(p_payload->>'child_business_id')::uuid,(p_payload->>'effective_date')::date,(p_payload->>'ownership_rate')::numeric,'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''))
  on conflict(user_id,parent_business_id,child_business_id,effective_date) do update set ownership_rate=excluded.ownership_rate,source=excluded.source,notes=excluded.notes returning id into v_id; return v_id; end $$;

revoke all on function public.lfo_save_business(uuid,jsonb), public.lfo_archive_business(uuid,uuid), public.lfo_record_business_ownership(uuid,jsonb), public.lfo_record_business_financials(uuid,jsonb), public.lfo_record_business_valuation(uuid,jsonb), public.lfo_record_business_capital_event(uuid,jsonb), public.lfo_set_business_holding(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.lfo_save_business(uuid,jsonb), public.lfo_archive_business(uuid,uuid), public.lfo_record_business_ownership(uuid,jsonb), public.lfo_record_business_financials(uuid,jsonb), public.lfo_record_business_valuation(uuid,jsonb), public.lfo_record_business_capital_event(uuid,jsonb), public.lfo_set_business_holding(uuid,jsonb) to service_role;
