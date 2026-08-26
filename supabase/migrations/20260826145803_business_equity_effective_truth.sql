-- Business Equity V2 hardening: one canonical dated snapshot per business/date.
-- Without this, same-day duplicate financial/valuation rows make latestAt() nondeterministic.
create unique index if not exists business_financials_effective_uk
  on public.business_financials(user_id, business_id, period_end);
create unique index if not exists business_valuations_effective_uk
  on public.business_valuations(user_id, business_id, valuation_date);

-- Cover owner foreign keys / owner-filtered reads introduced or extended by Business Equity V2.
create index if not exists businesses_user_idx on public.businesses(user_id);
create index if not exists business_financials_user_idx on public.business_financials(user_id);
create index if not exists business_valuations_user_idx on public.business_valuations(user_id);
create index if not exists business_capital_events_user_idx on public.business_capital_events(user_id);

create or replace function public.lfo_record_business_financials(p_user_id uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  insert into public.business_financials(
    id,user_id,business_id,period_end,revenue,gross_margin,ebitda,ebit,net_income,cash,debt,
    working_capital,capex,free_cash_flow,currency,data_kind,confidence,source,notes
  ) values(
    gen_random_uuid(),p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'period_end')::date,
    nullif(p_payload->>'revenue','')::numeric,nullif(p_payload->>'gross_margin','')::numeric,
    nullif(p_payload->>'ebitda','')::numeric,nullif(p_payload->>'ebit','')::numeric,
    nullif(p_payload->>'net_income','')::numeric,nullif(p_payload->>'cash','')::numeric,
    nullif(p_payload->>'gross_debt','')::numeric,nullif(p_payload->>'working_capital','')::numeric,
    nullif(p_payload->>'capex','')::numeric,nullif(p_payload->>'free_cash_flow','')::numeric,
    upper(nullif(p_payload->>'currency','')),coalesce(nullif(p_payload->>'data_kind',''),'ACTUAL'),
    coalesce(nullif(p_payload->>'confidence',''),'HIGH'),nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')
  )
  on conflict(user_id,business_id,period_end) do update set
    revenue=excluded.revenue,
    gross_margin=excluded.gross_margin,
    ebitda=excluded.ebitda,
    ebit=excluded.ebit,
    net_income=excluded.net_income,
    cash=excluded.cash,
    debt=excluded.debt,
    working_capital=excluded.working_capital,
    capex=excluded.capex,
    free_cash_flow=excluded.free_cash_flow,
    currency=excluded.currency,
    data_kind=excluded.data_kind,
    confidence=excluded.confidence,
    source=excluded.source,
    notes=excluded.notes
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.lfo_record_business_valuation(p_user_id uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  insert into public.business_valuations(
    id,user_id,business_id,valuation_date,method,enterprise_value,equity_value,assumptions,data_kind,
    currency,valuation_multiple,confidence,source,notes
  ) values(
    gen_random_uuid(),p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'valuation_date')::date,
    p_payload->>'method',nullif(p_payload->>'enterprise_value','')::numeric,
    nullif(p_payload->>'equity_value','')::numeric,coalesce(p_payload->'assumptions','{}'::jsonb),
    coalesce(nullif(p_payload->>'data_kind',''),'USER_ASSUMPTION'),upper(nullif(p_payload->>'currency','')),
    nullif(p_payload->>'valuation_multiple','')::numeric,coalesce(nullif(p_payload->>'confidence',''),'MEDIUM'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')
  )
  on conflict(user_id,business_id,valuation_date) do update set
    method=excluded.method,
    enterprise_value=excluded.enterprise_value,
    equity_value=excluded.equity_value,
    assumptions=excluded.assumptions,
    data_kind=excluded.data_kind,
    currency=excluded.currency,
    valuation_multiple=excluded.valuation_multiple,
    confidence=excluded.confidence,
    source=excluded.source,
    notes=excluded.notes
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.lfo_record_business_financials(uuid,jsonb), public.lfo_record_business_valuation(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.lfo_record_business_financials(uuid,jsonb), public.lfo_record_business_valuation(uuid,jsonb) to service_role;
