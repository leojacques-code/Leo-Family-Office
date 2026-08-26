-- Business Equity V2.1 — invariants bloquants de la revue indépendante.
--
-- 1. Toute acquisition/cession/rachat qui change la quote-part écrit l'événement et la
--    détention après opération dans la même RPC.
-- 2. Le Quick Start ne peut créer qu'une société immédiatement calculable.
-- 3. Les autres termes du pont EV → Equity ont une complétude explicite et datée.
-- 4. Les hypothèses DCF restent protégées par leurs contraintes NOT NULL / CHECK.

-- ─── Complétude datée du pont EV → Equity ─────────────────────────────────────────────

create table if not exists public.business_bridge_declarations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null,
  effective_date date not null,
  status text not null,
  data_kind text not null default 'USER_ASSUMPTION',
  confidence text not null default 'HIGH',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_bridge_declarations_business_fk
    foreign key (business_id, user_id)
    references public.businesses(id, user_id) on delete cascade,
  constraint business_bridge_declarations_status_ck
    check (status in ('UNKNOWN','DECLARED_NONE','PARTIAL','COMPLETE')),
  constraint business_bridge_declarations_effective_uk
    unique (user_id, business_id, effective_date)
);

create index if not exists business_bridge_declarations_business_owner_idx
  on public.business_bridge_declarations(business_id, user_id);
create index if not exists business_bridge_declarations_owner_date_idx
  on public.business_bridge_declarations(user_id, business_id, effective_date desc);

alter table public.business_bridge_declarations enable row level security;
drop policy if exists owner_all on public.business_bridge_declarations;
create policy owner_all on public.business_bridge_declarations for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.business_bridge_declarations from anon;
grant select, insert, update, delete on table public.business_bridge_declarations to authenticated;

comment on table public.business_bridge_declarations is
  'Complétude datée et déclarée des ajustements du pont EV → Equity. Absence ou UNKNOWN ne vaut jamais zéro.';

-- Une seule opération modifiant la détention peut définir la détention résiduelle d'une
-- société à une date donnée. Sans cette unicité, deux événements pourraient revendiquer la
-- même ligne de détention et deux origines incompatibles.
create unique index if not exists business_capital_events_ownership_change_uk
  on public.business_capital_events(user_id, business_id, event_date)
  where event_type in ('ACQUISITION','SALE','BUYBACK');

-- ─── Base de valorisation + déclaration de bridge, en un acte ─────────────────────────

create or replace function public.lfo_record_business_valuation(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid;
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_date date := (p_payload->>'valuation_date')::date;
  v_bridge_status text := coalesce(nullif(p_payload->>'bridge_status',''),'UNKNOWN');
begin
  insert into public.business_valuations(
    id,user_id,business_id,valuation_date,method,enterprise_value,equity_value,assumptions,
    data_kind,currency,valuation_multiple,multiple_low,multiple_high,metric_basis,metric_period_end,
    pre_money_equity_value,primary_new_money,secondary_amount,investor_contribution,
    preferred_rights_known,confidence,source,notes,updated_at
  ) values(
    gen_random_uuid(),p_user_id,v_business,v_date,
    p_payload->>'method',nullif(p_payload->>'enterprise_value','')::numeric,
    nullif(p_payload->>'equity_value','')::numeric,coalesce(p_payload->'assumptions','{}'::jsonb),
    coalesce(nullif(p_payload->>'data_kind',''),'USER_ASSUMPTION'),
    upper(nullif(p_payload->>'currency','')),nullif(p_payload->>'valuation_multiple','')::numeric,
    nullif(p_payload->>'multiple_low','')::numeric,nullif(p_payload->>'multiple_high','')::numeric,
    nullif(p_payload->>'metric_basis',''),nullif(p_payload->>'metric_period_end','')::date,
    nullif(p_payload->>'pre_money_equity_value','')::numeric,
    nullif(p_payload->>'primary_new_money','')::numeric,
    nullif(p_payload->>'secondary_amount','')::numeric,
    nullif(p_payload->>'investor_contribution','')::numeric,
    nullif(p_payload->>'preferred_rights_known','')::boolean,
    coalesce(nullif(p_payload->>'confidence',''),'MEDIUM'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now()
  )
  on conflict(user_id,business_id,valuation_date,method) do update set
    enterprise_value=excluded.enterprise_value, equity_value=excluded.equity_value,
    assumptions=excluded.assumptions, data_kind=excluded.data_kind, currency=excluded.currency,
    valuation_multiple=excluded.valuation_multiple, multiple_low=excluded.multiple_low,
    multiple_high=excluded.multiple_high, metric_basis=excluded.metric_basis,
    metric_period_end=excluded.metric_period_end,
    pre_money_equity_value=excluded.pre_money_equity_value,
    primary_new_money=excluded.primary_new_money, secondary_amount=excluded.secondary_amount,
    investor_contribution=excluded.investor_contribution,
    preferred_rights_known=excluded.preferred_rights_known,
    confidence=excluded.confidence, source=excluded.source, notes=excluded.notes, updated_at=now()
  returning id into v_id;

  insert into public.business_bridge_declarations(
    user_id,business_id,effective_date,status,data_kind,confidence,source,notes,updated_at
  ) values(
    p_user_id,v_business,v_date,v_bridge_status,'USER_ASSUMPTION','HIGH',
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now()
  )
  on conflict(user_id,business_id,effective_date) do update set
    status=excluded.status, data_kind=excluded.data_kind, confidence=excluded.confidence,
    source=excluded.source, notes=excluded.notes, updated_at=now();

  return v_id;
end $$;

-- ─── Opération de capital + détention résiduelle, en un acte ──────────────────────────

create or replace function public.lfo_record_business_capital_event(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid := gen_random_uuid();
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_type text := p_payload->>'event_type';
  v_date date := (p_payload->>'event_date')::date;
  v_after numeric := nullif(p_payload->>'ownership_rate_after','')::numeric;
  v_before numeric;
  v_delta numeric;
  v_changes_ownership boolean := v_type in ('ACQUISITION','SALE','BUYBACK');
begin
  perform 1 from public.businesses
   where id=v_business and user_id=p_user_id
   for update;
  if not found then raise exception 'Société introuvable'; end if;

  if v_changes_ownership then
    if v_after is null then
      raise exception 'Détention après opération requise pour %', v_type;
    end if;
    select coalesce(economic_rate, ownership_rate)
      into v_before
      from public.business_ownership
     where user_id=p_user_id and business_id=v_business and effective_date < v_date
     order by effective_date desc, updated_at desc
     limit 1;
    if v_before is null then
      raise exception 'Détention antérieure inconnue : impossible de dériver la variation';
    end if;
    v_delta := v_after - v_before;
    if v_type='ACQUISITION' and v_delta <= 0 then
      raise exception 'Une acquisition doit augmenter la détention';
    end if;
    if v_type in ('SALE','BUYBACK') and v_delta >= 0 then
      raise exception 'Une cession ou un rachat doit réduire la détention';
    end if;
  end if;

  insert into public.business_capital_events(
    id,user_id,business_id,event_type,event_date,amount,amount_scope,fees,currency,
    ownership_delta,ownership_rate_after,shares_delta,price_per_share,label,
    transaction_id,data_kind,confidence,source,notes
  ) values(
    v_id,p_user_id,v_business,v_type,v_date,(p_payload->>'amount')::numeric,
    coalesce(nullif(p_payload->>'amount_scope',''),'USER_CASH'),
    nullif(p_payload->>'fees','')::numeric,upper(p_payload->>'currency'),
    case when v_changes_ownership then v_delta else null end,
    case when v_changes_ownership then v_after else null end,
    nullif(p_payload->>'shares_delta','')::numeric,
    nullif(p_payload->>'price_per_share','')::numeric,
    nullif(p_payload->>'label',''),nullif(p_payload->>'transaction_id','')::uuid,
    coalesce(nullif(p_payload->>'data_kind',''),'ACTUAL'),
    coalesce(nullif(p_payload->>'confidence',''),'HIGH'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')
  );

  if v_changes_ownership then
    insert into public.business_ownership(
      user_id,business_id,ownership_rate,economic_rate,effective_date,origin_event_id,
      data_kind,confidence,source,notes,updated_at
    ) values(
      p_user_id,v_business,v_after,v_after,v_date,v_id,'DERIVED','HIGH',
      nullif(p_payload->>'source',''),
      'Détention dérivée de l''opération ' || v_type || ' du ' || to_char(v_date,'DD/MM/YYYY'),now()
    )
    on conflict(user_id,business_id,effective_date) do update set
      ownership_rate=excluded.ownership_rate, economic_rate=excluded.economic_rate,
      origin_event_id=excluded.origin_event_id, data_kind=excluded.data_kind,
      confidence=excluded.confidence, source=excluded.source,
      notes=excluded.notes, updated_at=now();
  end if;

  return v_id;
end $$;

create or replace function public.lfo_delete_business_capital_event(p_user_id uuid, p_event_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if not exists(
    select 1 from public.business_capital_events where id=p_event_id and user_id=p_user_id
  ) then
    raise exception 'Événement de capital introuvable';
  end if;
  delete from public.business_ownership
   where origin_event_id=p_event_id and user_id=p_user_id;
  delete from public.business_capital_events
   where id=p_event_id and user_id=p_user_id;
  return p_event_id;
end $$;

-- ─── Quick Start strict : calculable ou parcours alternatif ───────────────────────────

create or replace function public.lfo_create_business_quick_start(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid := gen_random_uuid();
  v_currency char(3) := upper(coalesce(nullif(p_payload->>'currency',''),'EUR'));
  v_period date := (p_payload->>'period_end')::date;
  v_valuation_date date := (p_payload->>'valuation_date')::date;
  v_method text := p_payload->>'method';
  v_multiple numeric := nullif(p_payload->>'multiple','')::numeric;
  v_metric numeric;
  v_cash numeric := nullif(p_payload->>'cash','')::numeric;
  v_debt numeric := nullif(p_payload->>'gross_debt','')::numeric;
  v_legal numeric := nullif(p_payload->>'legal_rate','')::numeric;
  v_economic numeric := nullif(p_payload->>'economic_rate','')::numeric;
begin
  if nullif(p_payload->>'name','') is null then raise exception 'Nom de société requis'; end if;
  if v_method not in ('EBITDA_MULTIPLE','REVENUE_MULTIPLE') then
    raise exception 'Le démarrage rapide ne couvre que les méthodes par multiple';
  end if;
  v_metric := case when v_method='REVENUE_MULTIPLE'
    then nullif(p_payload->>'revenue','')::numeric
    else nullif(p_payload->>'ebitda','')::numeric end;
  if v_metric is null then raise exception 'Agrégat de valorisation requis'; end if;
  if v_multiple is null or v_multiple <= 0 then raise exception 'Multiple central requis'; end if;
  if v_cash is null then raise exception 'Trésorerie requise, saisir 0 si elle est nulle'; end if;
  if v_debt is null then raise exception 'Dette brute requise, saisir 0 si elle est nulle'; end if;
  if v_cash < 0 or v_debt < 0 then raise exception 'Trésorerie et dette brute doivent être positives ou nulles'; end if;
  if v_legal is null or v_legal <= 0 or v_legal > 1 or
     v_economic is null or v_economic <= 0 or v_economic > 1 then
    raise exception 'Détention économique valide requise';
  end if;
  if p_payload->>'bridge_status' is distinct from 'DECLARED_NONE' then
    raise exception 'Le Quick Start exige la déclaration explicite des autres ajustements du bridge';
  end if;

  insert into public.businesses(
    id,user_id,name,legal_form,status,business_type,functional_currency,archived,
    sector,country,capital_history_start,capital_history_source,
    data_kind,confidence,source,notes,updated_at
  ) values(
    v_id,p_user_id,p_payload->>'name',nullif(p_payload->>'legal_form',''),'ACTIVE',
    nullif(p_payload->>'business_type',''),v_currency,false,
    nullif(p_payload->>'sector',''),upper(nullif(p_payload->>'country','')),
    nullif(p_payload->>'capital_history_start','')::date,
    coalesce(nullif(p_payload->>'capital_history_source',''),'UNKNOWN'),
    'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now()
  );

  insert into public.business_ownership(
    user_id,business_id,ownership_rate,economic_rate,effective_date,data_kind,confidence,source
  ) values(
    p_user_id,v_id,v_legal,v_economic,v_period,'USER_ASSUMPTION','HIGH',
    nullif(p_payload->>'source','')
  );

  insert into public.business_financials(
    id,user_id,business_id,period_end,period_kind,period_label,revenue,ebitda,cash,debt,
    currency,data_kind,confidence,source
  ) values(
    gen_random_uuid(),p_user_id,v_id,v_period,
    coalesce(nullif(p_payload->>'period_kind',''),'ANNUAL'),nullif(p_payload->>'period_label',''),
    nullif(p_payload->>'revenue','')::numeric,nullif(p_payload->>'ebitda','')::numeric,
    v_cash,v_debt,v_currency,'ACTUAL','HIGH',nullif(p_payload->>'source','')
  );

  insert into public.business_valuations(
    id,user_id,business_id,valuation_date,method,assumptions,data_kind,currency,
    valuation_multiple,multiple_low,multiple_high,metric_basis,metric_period_end,
    confidence,source,updated_at
  ) values(
    gen_random_uuid(),p_user_id,v_id,v_valuation_date,v_method,'{}'::jsonb,
    'USER_ASSUMPTION',v_currency,v_multiple,
    nullif(p_payload->>'multiple_low','')::numeric,nullif(p_payload->>'multiple_high','')::numeric,
    case when v_method='REVENUE_MULTIPLE' then 'REVENUE' else 'EBITDA' end,v_period,
    'MEDIUM',nullif(p_payload->>'source',''),now()
  );

  insert into public.business_bridge_declarations(
    user_id,business_id,effective_date,status,data_kind,confidence,source
  ) values(
    p_user_id,v_id,v_valuation_date,'DECLARED_NONE','USER_ASSUMPTION','HIGH',
    nullif(p_payload->>'source','')
  );

  return v_id;
end $$;

revoke all on function public.lfo_record_business_valuation(uuid,jsonb),
  public.lfo_record_business_capital_event(uuid,jsonb),
  public.lfo_delete_business_capital_event(uuid,uuid),
  public.lfo_create_business_quick_start(uuid,jsonb)
from public, anon, authenticated;

grant execute on function public.lfo_record_business_valuation(uuid,jsonb),
  public.lfo_record_business_capital_event(uuid,jsonb),
  public.lfo_delete_business_capital_event(uuid,uuid),
  public.lfo_create_business_quick_start(uuid,jsonb)
to service_role;
