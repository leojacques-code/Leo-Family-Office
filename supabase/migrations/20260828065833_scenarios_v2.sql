-- Scenarios V2
--
-- Un scénario reste une identité légère. Sa définition reproductible est un snapshot
-- immuable dans scenario_versions.payload. Les résultats restent des RUNS, jamais une
-- seconde vérité patrimoniale.

alter table public.scenarios
  add column if not exists scenario_status text not null default 'ACTIVE',
  add column if not exists archived_at timestamptz;

alter table public.simulation_runs
  add column if not exists scenario_version integer,
  add column if not exists as_of_date date,
  add column if not exists baseline_reference jsonb,
  add column if not exists event_set_version text,
  add column if not exists assumptions_snapshot jsonb,
  add column if not exists run_mode text,
  add column if not exists horizon_months integer,
  add column if not exists methodology_version text,
  add column if not exists definition_snapshot jsonb;

-- Les runs V1 gardent la version qui existait au moment du calcul. Les métadonnées qui
-- n'étaient pas persistées sont marquées LEGACY_UNKNOWN au lieu d'être inventées.
update public.simulation_runs as run
   set scenario_version = coalesce(
         (
           select max(version)
             from public.scenario_versions as version
            where version.scenario_id = run.scenario_id
              and version.created_at <= run.created_at
         ),
         (
           select min(version)
             from public.scenario_versions as version
            where version.scenario_id = run.scenario_id
         )
       ),
       as_of_date = coalesce(as_of_date, run.created_at::date),
       baseline_reference = coalesce(
         baseline_reference,
         pg_catalog.jsonb_build_object(
           'kind', 'LEGACY_UNKNOWN',
           'asOfDate', run.created_at::date,
           'openingFingerprint', 'LEGACY_UNKNOWN',
           'eventSetVersion', 'LEGACY_UNKNOWN',
           'eventIds', '[]'::jsonb
         )
       ),
       event_set_version = coalesce(event_set_version, 'LEGACY_UNKNOWN'),
       assumptions_snapshot = coalesce(assumptions_snapshot, '{}'::jsonb),
       run_mode = coalesce(run_mode, 'MONTE_CARLO'),
       horizon_months = coalesce(horizon_months, run.years * 12),
       methodology_version = coalesce(methodology_version, 'SCENARIOS_V1_MONTHLY'),
       definition_snapshot = coalesce(
         definition_snapshot,
         (
           select version.payload
             from public.scenario_versions as version
            where version.scenario_id = run.scenario_id
            order by
              (version.version = coalesce(
                (
                  select max(candidate.version)
                    from public.scenario_versions as candidate
                   where candidate.scenario_id = run.scenario_id
                     and candidate.created_at <= run.created_at
                ),
                version.version
              )) desc,
              version.version asc
            limit 1
         )
       );

alter table public.simulation_runs
  alter column scenario_version set not null,
  alter column as_of_date set not null,
  alter column baseline_reference set not null,
  alter column event_set_version set not null,
  alter column assumptions_snapshot set not null,
  alter column run_mode set not null,
  alter column horizon_months set not null,
  alter column methodology_version set not null,
  alter column definition_snapshot set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'scenarios_status_ck'
       and conrelid = 'public.scenarios'::regclass
  ) then
    alter table public.scenarios add constraint scenarios_status_ck
      check (scenario_status in ('DRAFT', 'ACTIVE', 'ARCHIVED'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'scenarios_archive_shape_ck'
       and conrelid = 'public.scenarios'::regclass
  ) then
    alter table public.scenarios add constraint scenarios_archive_shape_ck
      check (
        (scenario_status = 'ARCHIVED' and archived_at is not null)
        or (scenario_status <> 'ARCHIVED' and archived_at is null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'simulation_runs_mode_ck'
       and conrelid = 'public.simulation_runs'::regclass
  ) then
    alter table public.simulation_runs add constraint simulation_runs_mode_ck
      check (run_mode in ('DETERMINISTIC', 'MONTE_CARLO'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'simulation_runs_horizon_ck'
       and conrelid = 'public.simulation_runs'::regclass
  ) then
    alter table public.simulation_runs add constraint simulation_runs_horizon_ck
      check (horizon_months between 1 and 960);
  end if;
end $$;

-- Garanties d'ownership composites. Les FK simples historiques sont conservées pour une
-- migration additive et sans lock destructif ; ces contraintes empêchent désormais qu'un
-- enfant porte un user_id différent de son parent.
create unique index if not exists scenarios_id_user_uidx
  on public.scenarios(id, user_id);
create unique index if not exists scenario_versions_id_user_uidx
  on public.scenario_versions(id, user_id);
create unique index if not exists simulation_runs_id_user_uidx
  on public.simulation_runs(id, user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'scenario_versions_owner_fk'
       and conrelid = 'public.scenario_versions'::regclass
  ) then
    alter table public.scenario_versions add constraint scenario_versions_owner_fk
      foreign key (scenario_id, user_id)
      references public.scenarios(id, user_id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'scenario_assumptions_owner_fk'
       and conrelid = 'public.scenario_assumptions'::regclass
  ) then
    alter table public.scenario_assumptions add constraint scenario_assumptions_owner_fk
      foreign key (scenario_id, user_id)
      references public.scenarios(id, user_id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'simulation_runs_owner_fk'
       and conrelid = 'public.simulation_runs'::regclass
  ) then
    alter table public.simulation_runs add constraint simulation_runs_owner_fk
      foreign key (scenario_id, user_id)
      references public.scenarios(id, user_id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'simulation_runs_scenario_version_fk'
       and conrelid = 'public.simulation_runs'::regclass
  ) then
    alter table public.simulation_runs add constraint simulation_runs_scenario_version_fk
      foreign key (scenario_id, scenario_version)
      references public.scenario_versions(scenario_id, version);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'simulation_results_owner_fk'
       and conrelid = 'public.simulation_results'::regclass
  ) then
    alter table public.simulation_results add constraint simulation_results_owner_fk
      foreign key (run_id, user_id)
      references public.simulation_runs(id, user_id) on delete cascade;
  end if;
end $$;

create index if not exists scenario_versions_user_scenario_version_idx
  on public.scenario_versions(user_id, scenario_id, version desc);
create index if not exists scenario_assumptions_user_scenario_key_idx
  on public.scenario_assumptions(user_id, scenario_id, assumption_key);
create index if not exists simulation_runs_user_scenario_created_idx
  on public.simulation_runs(user_id, scenario_id, created_at desc);
create index if not exists simulation_runs_scenario_version_idx
  on public.simulation_runs(scenario_id, scenario_version);
create index if not exists simulation_results_user_run_year_idx
  on public.simulation_results(user_id, run_id, year);

-- Crée une nouvelle version V2 pour chaque scénario legacy sans modifier son historique V1.
with legacy as (
  select scenario.*, scenario.current_version + 1 as v2_version
    from public.scenarios as scenario
   where not exists (
     select 1
       from public.scenario_versions as version
      where version.scenario_id = scenario.id
        and version.payload ->> 'schemaVersion' = '2'
   )
), inserted as (
  insert into public.scenario_versions(user_id, scenario_id, version, payload, created_at)
  select
    legacy.user_id,
    legacy.id,
    legacy.v2_version,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 2,
      'methodologyVersion', 'SCENARIOS_V2_EVENT_MONTHLY_1',
      'scenarioId', legacy.id,
      'version', legacy.v2_version,
      'asOfDate', current_date,
      'horizonMonths', 480,
      'lifecycleStatus', 'ACTIVE',
      'overrides', '[]'::jsonb,
      'assumptions', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'key', 'portfolio.annual_return', 'label', 'Rendement portefeuille',
          'value', legacy.annual_return, 'unit', 'ratio', 'currency', null,
          'effectiveDate', current_date, 'kind', 'USER_ASSUMPTION',
          'source', 'Scenarios V1 compatibility'
        ),
        pg_catalog.jsonb_build_object(
          'key', 'portfolio.annual_volatility', 'label', 'Volatilité portefeuille',
          'value', legacy.annual_volatility, 'unit', 'ratio', 'currency', null,
          'effectiveDate', current_date, 'kind', 'USER_ASSUMPTION',
          'source', 'Scenarios V1 compatibility'
        ),
        pg_catalog.jsonb_build_object(
          'key', 'economy.annual_inflation', 'label', 'Inflation annuelle',
          'value', legacy.annual_inflation, 'unit', 'ratio', 'currency', null,
          'effectiveDate', current_date, 'kind', 'USER_ASSUMPTION',
          'source', 'Scenarios V1 compatibility'
        ),
        pg_catalog.jsonb_build_object(
          'key', 'cash_flow.legacy_monthly_surplus', 'label', 'Surplus mensuel legacy',
          'value', legacy.monthly_savings, 'unit', 'EUR', 'currency', 'EUR',
          'effectiveDate', current_date, 'kind', 'USER_ASSUMPTION',
          'source', 'Scenarios V1 compatibility'
        )
      ),
      'market', pg_catalog.jsonb_build_object(
        'annualReturn', legacy.annual_return,
        'annualVolatility', legacy.annual_volatility,
        'annualInflation', legacy.annual_inflation,
        'stressProbability', legacy.stress_probability,
        'shockYear', legacy.shock_year,
        'shockMagnitude', legacy.shock_magnitude,
        'randomVariables', pg_catalog.jsonb_build_array('PORTFOLIO_RETURN')
      ),
      'capitalAllocation', pg_catalog.jsonb_build_object(
        'investmentAllocationRate', legacy.investment_allocation_rate,
        'source', 'LEGACY_COMPATIBILITY'
      ),
      'createdAt', now(),
      'legacyCompatibility', pg_catalog.jsonb_build_object(
        'monthlySavings', legacy.monthly_savings,
        'salaryGrowth', legacy.salary_growth
      )
    ),
    now()
  from legacy
  returning scenario_id, version
)
update public.scenarios as scenario
   set current_version = inserted.version,
       updated_at = now()
  from inserted
 where scenario.id = inserted.scenario_id;

create or replace function public.lfo_create_scenario_v2(
  p_user_id uuid,
  p_name text,
  p_description text,
  p_color text,
  p_definition jsonb,
  p_now timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scenario_id uuid := pg_catalog.gen_random_uuid();
  v_definition jsonb;
begin
  if pg_catalog.jsonb_typeof(p_definition) <> 'object' then
    raise exception 'Scenario V2 definition doit être un objet JSON';
  end if;
  v_definition := p_definition || pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'methodologyVersion', 'SCENARIOS_V2_EVENT_MONTHLY_1',
    'scenarioId', v_scenario_id,
    'version', 1,
    'lifecycleStatus', 'DRAFT',
    'createdAt', p_now
  );
  insert into public.scenarios(
    id, user_id, name, description, color, current_version,
    annual_return, annual_volatility, annual_inflation, monthly_savings,
    investment_allocation_rate, salary_growth, stress_probability, shock_year,
    shock_magnitude, data_kind, confidence, created_at, updated_at, scenario_status
  ) values (
    v_scenario_id, p_user_id, p_name, p_description, p_color, 1,
    coalesce((v_definition #>> '{market,annualReturn}')::numeric, 0),
    coalesce((v_definition #>> '{market,annualVolatility}')::numeric, 0),
    coalesce((v_definition #>> '{market,annualInflation}')::numeric, 0),
    coalesce((v_definition #>> '{legacyCompatibility,monthlySavings}')::numeric, 0),
    coalesce((v_definition #>> '{capitalAllocation,investmentAllocationRate}')::numeric, 0),
    coalesce((v_definition #>> '{legacyCompatibility,salaryGrowth}')::numeric, 0),
    coalesce((v_definition #>> '{market,stressProbability}')::numeric, 0),
    (v_definition #>> '{market,shockYear}')::integer,
    (v_definition #>> '{market,shockMagnitude}')::numeric,
    'USER_ASSUMPTION', 'HIGH', p_now, p_now, 'DRAFT'
  );
  insert into public.scenario_versions(user_id, scenario_id, version, payload, created_at)
  values (p_user_id, v_scenario_id, 1, v_definition, p_now);
  return v_scenario_id;
end;
$$;

create or replace function public.lfo_save_scenario_version_v2(
  p_user_id uuid,
  p_scenario_id uuid,
  p_expected_version integer,
  p_definition jsonb,
  p_updated_at timestamptz
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.scenarios%rowtype;
  v_version integer;
  v_definition jsonb;
begin
  if pg_catalog.jsonb_typeof(p_definition) <> 'object' then
    raise exception 'Scenario V2 definition doit être un objet JSON';
  end if;
  select * into v_current
    from public.scenarios
   where id = p_scenario_id and user_id = p_user_id
   for update;
  if not found then raise exception 'Scenario not found'; end if;
  if v_current.current_version <> p_expected_version then
    raise exception 'Scenario version conflict: expected %, current %',
      p_expected_version, v_current.current_version;
  end if;
  v_version := v_current.current_version + 1;
  v_definition := p_definition || pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'methodologyVersion', 'SCENARIOS_V2_EVENT_MONTHLY_1',
    'scenarioId', p_scenario_id,
    'version', v_version,
    'createdAt', p_updated_at
  );
  update public.scenarios set
    current_version = v_version,
    annual_return = coalesce((v_definition #>> '{market,annualReturn}')::numeric, annual_return),
    annual_volatility = coalesce((v_definition #>> '{market,annualVolatility}')::numeric, annual_volatility),
    annual_inflation = coalesce((v_definition #>> '{market,annualInflation}')::numeric, annual_inflation),
    investment_allocation_rate = coalesce(
      (v_definition #>> '{capitalAllocation,investmentAllocationRate}')::numeric,
      investment_allocation_rate
    ),
    stress_probability = coalesce(
      (v_definition #>> '{market,stressProbability}')::numeric,
      stress_probability
    ),
    shock_year = (v_definition #>> '{market,shockYear}')::integer,
    shock_magnitude = (v_definition #>> '{market,shockMagnitude}')::numeric,
    scenario_status = case
      when v_definition ->> 'lifecycleStatus' in ('DRAFT', 'ACTIVE')
        then v_definition ->> 'lifecycleStatus'
      else scenario_status
    end,
    data_kind = 'USER_ASSUMPTION',
    confidence = 'HIGH',
    updated_at = p_updated_at
  where id = p_scenario_id and user_id = p_user_id;
  insert into public.scenario_versions(user_id, scenario_id, version, payload, created_at)
  values (p_user_id, p_scenario_id, v_version, v_definition, p_updated_at);
  return v_version;
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
  v_source_definition jsonb;
  v_copy public.scenarios%rowtype;
  v_definition jsonb;
begin
  select * into v_source from public.scenarios
   where id = p_scenario_id and user_id = p_user_id;
  if not found then raise exception 'Scenario not found'; end if;
  select payload into v_source_definition
    from public.scenario_versions
   where scenario_id = p_scenario_id and user_id = p_user_id
     and version = v_source.current_version;
  insert into public.scenarios(
    user_id, name, description, color, current_version, annual_return,
    annual_volatility, annual_inflation, monthly_savings, investment_allocation_rate,
    salary_growth, stress_probability, shock_year, shock_magnitude,
    data_kind, confidence, created_at, updated_at, scenario_status
  ) values (
    p_user_id, v_source.name || ' — copie', v_source.description, v_source.color, 1,
    v_source.annual_return, v_source.annual_volatility, v_source.annual_inflation,
    v_source.monthly_savings, v_source.investment_allocation_rate,
    v_source.salary_growth, v_source.stress_probability, v_source.shock_year,
    v_source.shock_magnitude, 'USER_ASSUMPTION', 'HIGH', p_now, p_now, 'DRAFT'
  ) returning * into v_copy;
  v_definition := coalesce(v_source_definition, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'methodologyVersion', 'SCENARIOS_V2_EVENT_MONTHLY_1',
    'scenarioId', v_copy.id,
    'version', 1,
    'lifecycleStatus', 'DRAFT',
    'createdAt', p_now
  );
  insert into public.scenario_versions(user_id, scenario_id, version, payload, created_at)
  values (p_user_id, v_copy.id, 1, v_definition, p_now);
  return v_copy.id;
end;
$$;

create or replace function public.lfo_archive_scenario_v2(
  p_user_id uuid,
  p_scenario_id uuid,
  p_archived_at timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.scenarios
     set scenario_status = 'ARCHIVED', archived_at = p_archived_at, updated_at = p_archived_at
   where id = p_scenario_id and user_id = p_user_id;
  if not found then raise exception 'Scenario not found'; end if;
  return p_scenario_id;
end;
$$;

create or replace function public.lfo_save_simulation_v2(
  p_user_id uuid,
  p_scenario_id uuid,
  p_scenario_version integer,
  p_as_of_date date,
  p_baseline_reference jsonb,
  p_event_set_version text,
  p_assumptions_snapshot jsonb,
  p_run_mode text,
  p_horizon_months integer,
  p_methodology text,
  p_methodology_version text,
  p_definition_snapshot jsonb,
  p_seed integer,
  p_simulations integer,
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
  perform 1 from public.scenario_versions
   where scenario_id = p_scenario_id
     and version = p_scenario_version
     and user_id = p_user_id;
  if not found then raise exception 'Scenario version not found'; end if;
  if p_run_mode not in ('DETERMINISTIC', 'MONTE_CARLO') then
    raise exception 'Mode de run invalide';
  end if;
  if p_run_mode = 'MONTE_CARLO' and p_simulations < 100 then
    raise exception 'Monte Carlo requiert au moins 100 simulations et un résultat';
  end if;
  insert into public.simulation_runs(
    user_id, scenario_id, scenario_version, seed, simulations, years, methodology,
    as_of_date, baseline_reference, event_set_version, assumptions_snapshot, run_mode,
    horizon_months, methodology_version, definition_snapshot
  ) values (
    p_user_id, p_scenario_id, p_scenario_version, p_seed, p_simulations,
    pg_catalog.ceil(p_horizon_months / 12.0)::integer, p_methodology,
    p_as_of_date, p_baseline_reference, p_event_set_version, p_assumptions_snapshot,
    p_run_mode, p_horizon_months, p_methodology_version, p_definition_snapshot
  ) returning id into v_run_id;
  insert into public.simulation_results(user_id, run_id, year, p10, p25, p50, p75, p90)
  select p_user_id, v_run_id, point.year, point.p10, point.p25, point.p50,
         point.p75, point.p90
    from pg_catalog.jsonb_to_recordset(p_points) as point(
      year integer, p10 numeric, p25 numeric, p50 numeric, p75 numeric, p90 numeric
    );
  return v_run_id;
end;
$$;

-- Compatibilité de l'ancienne route de projection avec les nouvelles colonnes NOT NULL.
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
declare
  v_run_id uuid;
  v_version integer;
  v_definition jsonb;
begin
  if pg_catalog.jsonb_typeof(p_points) <> 'array'
     or pg_catalog.jsonb_array_length(p_points) = 0 then
    raise exception 'simulation_results doit contenir au moins un point';
  end if;
  select scenario.current_version, version.payload
    into v_version, v_definition
    from public.scenarios as scenario
    join public.scenario_versions as version
      on version.scenario_id = scenario.id
     and version.version = scenario.current_version
     and version.user_id = scenario.user_id
   where scenario.id = p_scenario_id and scenario.user_id = p_user_id;
  if not found then raise exception 'Scenario not found'; end if;
  insert into public.simulation_runs(
    user_id, scenario_id, scenario_version, seed, simulations, years, methodology,
    as_of_date, baseline_reference, event_set_version, assumptions_snapshot, run_mode,
    horizon_months, methodology_version, definition_snapshot
  ) values (
    p_user_id, p_scenario_id, v_version, p_seed, p_simulations, p_years, p_methodology,
    current_date,
    pg_catalog.jsonb_build_object(
      'kind', 'LEGACY_ROUTE', 'asOfDate', current_date,
      'openingFingerprint', 'LEGACY_ROUTE', 'eventSetVersion', 'LEGACY_ROUTE',
      'eventIds', '[]'::jsonb
    ),
    'LEGACY_ROUTE', '{}'::jsonb, 'MONTE_CARLO', p_years * 12,
    'SCENARIOS_V1_MONTHLY', v_definition
  ) returning id into v_run_id;
  insert into public.simulation_results(user_id, run_id, year, p10, p25, p50, p75, p90)
  select p_user_id, v_run_id, point.year, point.p10, point.p25, point.p50,
         point.p75, point.p90
    from pg_catalog.jsonb_to_recordset(p_points) as point(
      year integer, p10 numeric, p25 numeric, p50 numeric, p75 numeric, p90 numeric
    );
  return v_run_id;
end;
$$;

-- Fonctions serveur uniquement. Les tables conservent leur RLS owner_all existante.
revoke all on function public.lfo_create_scenario_v2(uuid,text,text,text,jsonb,timestamptz)
  from public, anon, authenticated;
revoke all on function public.lfo_save_scenario_version_v2(uuid,uuid,integer,jsonb,timestamptz)
  from public, anon, authenticated;
revoke all on function public.lfo_archive_scenario_v2(uuid,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.lfo_save_simulation_v2(uuid,uuid,integer,date,jsonb,text,jsonb,text,integer,text,text,jsonb,integer,integer,jsonb)
  from public, anon, authenticated;

grant execute on function public.lfo_create_scenario_v2(uuid,text,text,text,jsonb,timestamptz)
  to service_role;
grant execute on function public.lfo_save_scenario_version_v2(uuid,uuid,integer,jsonb,timestamptz)
  to service_role;
grant execute on function public.lfo_archive_scenario_v2(uuid,uuid,timestamptz)
  to service_role;
grant execute on function public.lfo_save_simulation_v2(uuid,uuid,integer,date,jsonb,text,jsonb,text,integer,text,text,jsonb,integer,integer,jsonb)
  to service_role;

comment on column public.scenarios.scenario_status is
  'Lifecycle Scenarios V2 : DRAFT, ACTIVE ou ARCHIVED.';
comment on column public.simulation_runs.definition_snapshot is
  'Définition exacte utilisée par le run ; snapshot reproductible, jamais vérité canonique.';
comment on column public.simulation_runs.baseline_reference is
  'Référence/fingerprint du bilan et de la timeline canoniques observés à as_of_date.';
