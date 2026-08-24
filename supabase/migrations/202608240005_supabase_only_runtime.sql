-- Léo Family Office — runtime Supabase-only
--
-- Les moteurs restent en TypeScript. Ces fonctions ne calculent aucune donnée financière :
-- elles regroupent uniquement les écritures qui forment une unité applicative atomique.
-- Une exception PostgreSQL annule automatiquement toute la fonction.

create or replace function public.lfo_add_account(
  p_user_id uuid,
  p_institution text,
  p_name text,
  p_account_type text,
  p_balance numeric,
  p_currency text,
  p_as_of_date date
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_account_id uuid;
begin
  insert into public.institutions (user_id, name, country_code)
  values (p_user_id, p_institution, 'FR')
  on conflict (user_id, name) do update set name = excluded.name
  returning id into v_institution_id;

  insert into public.financial_accounts (
    user_id, institution_id, name, account_type, currency, liquidity, status,
    data_kind, confidence, source, effective_date
  ) values (
    p_user_id, v_institution_id, p_name, p_account_type, p_currency,
    case when p_account_type in ('BANK', 'SAVINGS') then 'IMMEDIATE' else 'LIQUID' end,
    'ACTIVE', 'ACTUAL', 'HIGH', 'Saisie manuelle', p_as_of_date
  ) returning id into v_account_id;

  insert into public.account_balances (
    user_id, account_id, balance, balance_date, data_kind, confidence, source
  ) values (
    p_user_id, v_account_id, p_balance, p_as_of_date, 'ACTUAL', 'HIGH', 'Saisie manuelle'
  );

  return v_account_id;
end;
$$;

create or replace function public.lfo_add_transaction(
  p_user_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_transaction_date date,
  p_label text,
  p_amount numeric,
  p_currency text,
  p_update_balance boolean
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transaction_id uuid;
  v_latest_balance numeric;
  v_latest_date date;
begin
  if p_update_balance then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_user_id::text || ':' || p_account_id::text, 0)
    );
  end if;

  insert into public.transactions (
    user_id, account_id, category_id, transaction_date, label, amount, currency,
    data_kind, confidence, source
  ) values (
    p_user_id, p_account_id, p_category_id, p_transaction_date, p_label, p_amount, p_currency,
    'ACTUAL', 'HIGH', 'Saisie manuelle'
  ) returning id into v_transaction_id;

  if p_update_balance then
    select balance, balance_date
      into v_latest_balance, v_latest_date
      from public.account_balances
     where user_id = p_user_id and account_id = p_account_id
     order by balance_date desc, created_at desc
     limit 1
     for update;

    if not found then
      raise exception 'Aucun solde connu pour le compte %', p_account_id;
    end if;

    -- Un snapshot postérieur contient déjà les mouvements antérieurs : seule une
    -- transaction strictement plus récente produit un nouveau solde dérivé.
    if p_transaction_date > v_latest_date then
      insert into public.account_balances (
        user_id, account_id, balance, balance_date, data_kind, confidence, source
      ) values (
        p_user_id, p_account_id, v_latest_balance + p_amount, p_transaction_date,
        'DERIVED', 'HIGH', 'Transaction saisie'
      );
    end if;
  end if;

  return v_transaction_id;
end;
$$;

create or replace function public.lfo_update_scenario(
  p_user_id uuid,
  p_scenario_id uuid,
  p_patch jsonb,
  p_updated_at timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.scenarios%rowtype;
  v_updated public.scenarios%rowtype;
  v_version integer;
  v_unknown_key text;
begin
  select keys.key into v_unknown_key
    from pg_catalog.jsonb_object_keys(p_patch) as keys(key)
   where keys.key not in (
     'annual_return', 'annual_volatility', 'annual_inflation', 'monthly_savings',
     'investment_allocation_rate', 'salary_growth', 'stress_probability',
     'shock_year', 'shock_magnitude'
   )
   limit 1;
  if v_unknown_key is not null then
    raise exception 'Champ de scénario non supporté : %', v_unknown_key;
  end if;

  select * into v_current
    from public.scenarios
   where id = p_scenario_id and user_id = p_user_id
   for update;
  if not found then raise exception 'Scenario not found'; end if;

  v_version := v_current.current_version + 1;
  update public.scenarios set
    annual_return = case when p_patch ? 'annual_return' then (p_patch ->> 'annual_return')::numeric else annual_return end,
    annual_volatility = case when p_patch ? 'annual_volatility' then (p_patch ->> 'annual_volatility')::numeric else annual_volatility end,
    annual_inflation = case when p_patch ? 'annual_inflation' then (p_patch ->> 'annual_inflation')::numeric else annual_inflation end,
    monthly_savings = case when p_patch ? 'monthly_savings' then (p_patch ->> 'monthly_savings')::numeric else monthly_savings end,
    investment_allocation_rate = case when p_patch ? 'investment_allocation_rate' then (p_patch ->> 'investment_allocation_rate')::numeric else investment_allocation_rate end,
    salary_growth = case when p_patch ? 'salary_growth' then (p_patch ->> 'salary_growth')::numeric else salary_growth end,
    stress_probability = case when p_patch ? 'stress_probability' then (p_patch ->> 'stress_probability')::numeric else stress_probability end,
    shock_year = case when p_patch ? 'shock_year' then (p_patch ->> 'shock_year')::integer else shock_year end,
    shock_magnitude = case when p_patch ? 'shock_magnitude' then (p_patch ->> 'shock_magnitude')::numeric else shock_magnitude end,
    current_version = v_version,
    data_kind = 'USER_ASSUMPTION',
    confidence = 'HIGH',
    updated_at = p_updated_at
  where id = p_scenario_id and user_id = p_user_id
  returning * into v_updated;

  insert into public.scenario_versions (user_id, scenario_id, version, payload)
  values (p_user_id, p_scenario_id, v_version, pg_catalog.to_jsonb(v_updated));
  return p_scenario_id;
end;
$$;

create or replace function public.lfo_duplicate_scenario(
  p_user_id uuid,
  p_scenario_id uuid,
  p_now timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.scenarios%rowtype;
  v_copy public.scenarios%rowtype;
begin
  select * into v_source from public.scenarios
   where id = p_scenario_id and user_id = p_user_id;
  if not found then raise exception 'Scenario not found'; end if;

  insert into public.scenarios (
    user_id, name, description, color, current_version, annual_return,
    annual_volatility, annual_inflation, monthly_savings, investment_allocation_rate,
    salary_growth, stress_probability, shock_year, shock_magnitude,
    data_kind, confidence, created_at, updated_at
  ) values (
    p_user_id, v_source.name || ' — copie', v_source.description, v_source.color, 1,
    v_source.annual_return, v_source.annual_volatility, v_source.annual_inflation,
    v_source.monthly_savings, v_source.investment_allocation_rate,
    v_source.salary_growth, v_source.stress_probability, v_source.shock_year,
    v_source.shock_magnitude, 'USER_ASSUMPTION', 'HIGH', p_now, p_now
  ) returning * into v_copy;

  insert into public.scenario_versions (user_id, scenario_id, version, payload)
  values (p_user_id, v_copy.id, 1, pg_catalog.to_jsonb(v_copy));
  return v_copy.id;
end;
$$;

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
declare v_close_id uuid;
begin
  insert into public.monthly_closes (
    user_id, close_date, gross_assets, debt, net_worth, forecast_net_worth, variance
  ) values (
    p_user_id, p_close_date, p_gross_assets, p_debt, p_net_worth,
    p_forecast_net_worth, p_variance
  ) on conflict (user_id, close_date) do update set
    gross_assets = excluded.gross_assets,
    debt = excluded.debt,
    net_worth = excluded.net_worth,
    forecast_net_worth = excluded.forecast_net_worth,
    variance = excluded.variance
  returning id into v_close_id;

  insert into public.net_worth_snapshots (
    user_id, snapshot_date, gross_assets, debt, net_worth, data_kind
  ) values (
    p_user_id, p_close_date, p_gross_assets, p_debt, p_net_worth, 'ACTUAL'
  ) on conflict (user_id, snapshot_date) do update set
    gross_assets = excluded.gross_assets,
    debt = excluded.debt,
    net_worth = excluded.net_worth,
    data_kind = excluded.data_kind;
  return v_close_id;
end;
$$;

create or replace function public.lfo_add_category(
  p_user_id uuid,
  p_name text,
  p_group_name text,
  p_cash_flow_kind text,
  p_essentiality text,
  p_expense_behavior text,
  p_as_of_date date
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_category_id uuid;
begin
  insert into public.expense_categories (
    user_id, name, group_name, essential, cash_flow_kind, essentiality,
    expense_behavior, archived
  ) values (
    p_user_id, p_name, p_group_name, p_essentiality = 'ESSENTIAL', p_cash_flow_kind,
    p_essentiality, p_expense_behavior, false
  ) returning id into v_category_id;

  insert into public.budgets (
    user_id, category_id, lifestyle, monthly_amount, data_kind, confidence, source,
    effective_date
  ) values (
    p_user_id, v_category_id, 'COMFORTABLE', null, 'MISSING', 'UNKNOWN',
    'À renseigner', p_as_of_date
  );
  return v_category_id;
end;
$$;

create or replace function public.lfo_close_cash_flow_month(
  p_user_id uuid,
  p_month text,
  p_income numeric,
  p_consumer_expenses numeric,
  p_essential_expenses numeric,
  p_taxes_paid numeric,
  p_debt_service_paid numeric,
  p_investment_flows numeric,
  p_internal_transfers numeric,
  p_operating_surplus_before_debt numeric,
  p_post_debt_surplus numeric,
  p_unclassified_transaction_count integer
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version integer;
  v_close_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_month, 0)
  );
  select coalesce(max(version), 0) + 1 into v_version
    from public.cash_flow_monthly_closes
   where user_id = p_user_id and month = p_month;

  insert into public.cash_flow_monthly_closes (
    user_id, month, version, income, consumer_expenses, essential_expenses, taxes_paid,
    debt_service_paid, investment_flows, internal_transfers,
    operating_surplus_before_debt, post_debt_surplus, unclassified_transaction_count
  ) values (
    p_user_id, p_month, v_version, p_income, p_consumer_expenses, p_essential_expenses,
    p_taxes_paid, p_debt_service_paid, p_investment_flows, p_internal_transfers,
    p_operating_surplus_before_debt, p_post_debt_surplus, p_unclassified_transaction_count
  ) returning id into v_close_id;
  return v_close_id;
end;
$$;

create or replace function public.lfo_save_simulation(
  p_user_id uuid,
  p_scenario_id uuid,
  p_seed integer,
  p_simulations integer,
  p_years integer,
  p_methodology text,
  p_points jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_run_id uuid;
begin
  if pg_catalog.jsonb_typeof(p_points) <> 'array'
     or pg_catalog.jsonb_array_length(p_points) = 0 then
    raise exception 'simulation_results doit contenir au moins un point';
  end if;

  insert into public.simulation_runs (
    user_id, scenario_id, seed, simulations, years, methodology
  ) values (
    p_user_id, p_scenario_id, p_seed, p_simulations, p_years, p_methodology
  ) returning id into v_run_id;

  insert into public.simulation_results (user_id, run_id, year, p10, p25, p50, p75, p90)
  select p_user_id, v_run_id, point.year, point.p10, point.p25, point.p50,
         point.p75, point.p90
    from pg_catalog.jsonb_to_recordset(p_points) as point(
      year integer, p10 numeric, p25 numeric, p50 numeric, p75 numeric, p90 numeric
    );
  return v_run_id;
end;
$$;

-- Le runtime appelle ces fonctions exclusivement avec la secret key côté serveur.
-- Elles ne constituent pas une API publique et ne doivent pas être exposées aux clients.
revoke all on function public.lfo_add_account(uuid,text,text,text,numeric,text,date) from public, anon, authenticated;
revoke all on function public.lfo_add_transaction(uuid,uuid,uuid,date,text,numeric,text,boolean) from public, anon, authenticated;
revoke all on function public.lfo_update_scenario(uuid,uuid,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.lfo_duplicate_scenario(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.lfo_create_monthly_close(uuid,date,numeric,numeric,numeric,numeric,numeric) from public, anon, authenticated;
revoke all on function public.lfo_add_category(uuid,text,text,text,text,text,date) from public, anon, authenticated;
revoke all on function public.lfo_close_cash_flow_month(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,integer) from public, anon, authenticated;
revoke all on function public.lfo_save_simulation(uuid,uuid,integer,integer,integer,text,jsonb) from public, anon, authenticated;

grant execute on function public.lfo_add_account(uuid,text,text,text,numeric,text,date) to service_role;
grant execute on function public.lfo_add_transaction(uuid,uuid,uuid,date,text,numeric,text,boolean) to service_role;
grant execute on function public.lfo_update_scenario(uuid,uuid,jsonb,timestamptz) to service_role;
grant execute on function public.lfo_duplicate_scenario(uuid,uuid,timestamptz) to service_role;
grant execute on function public.lfo_create_monthly_close(uuid,date,numeric,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.lfo_add_category(uuid,text,text,text,text,text,date) to service_role;
grant execute on function public.lfo_close_cash_flow_month(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,integer) to service_role;
grant execute on function public.lfo_save_simulation(uuid,uuid,integer,integer,integer,text,jsonb) to service_role;
