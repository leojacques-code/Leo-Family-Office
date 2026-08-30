-- Decision Lab V2
--
-- `decision_cases` reste l'identité légère de la question. Les définitions et runs sont
-- des snapshots immuables : ils reproduisent un calcul, mais ne deviennent jamais l'état
-- financier canonique.

alter table public.decision_cases
  add column if not exists description text,
  add column if not exists as_of_date date,
  add column if not exists horizon_months integer,
  add column if not exists current_version integer not null default 1,
  add column if not exists archived_at timestamptz;

do $$
begin
  if exists (
    select 1 from public.decision_cases
     where status not in ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED')
  ) then
    raise exception 'Decision Lab V2 refuse un status legacy inconnu';
  end if;
end $$;

update public.decision_cases
   set as_of_date = coalesce(as_of_date, created_at::date),
       horizon_months = coalesce(
         horizon_months,
         case
           when inputs ->> 'horizonMonths' ~ '^[1-9][0-9]*$'
             then least(960, (inputs ->> 'horizonMonths')::integer)
           else 1
         end
       ),
       archived_at = case
         when status = 'ARCHIVED' then coalesce(archived_at, updated_at)
         else null
       end;

alter table public.decision_cases
  alter column as_of_date set not null,
  alter column horizon_months set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'decision_cases_status_ck'
       and conrelid = 'public.decision_cases'::regclass
  ) then
    alter table public.decision_cases add constraint decision_cases_status_ck
      check (status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'decision_cases_horizon_ck'
       and conrelid = 'public.decision_cases'::regclass
  ) then
    alter table public.decision_cases add constraint decision_cases_horizon_ck
      check (horizon_months between 1 and 960);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'decision_cases_version_ck'
       and conrelid = 'public.decision_cases'::regclass
  ) then
    alter table public.decision_cases add constraint decision_cases_version_ck
      check (current_version > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'decision_cases_archive_shape_ck'
       and conrelid = 'public.decision_cases'::regclass
  ) then
    alter table public.decision_cases add constraint decision_cases_archive_shape_ck
      check (
        (status = 'ARCHIVED' and archived_at is not null)
        or (status <> 'ARCHIVED' and archived_at is null)
      );
  end if;
end $$;

create table public.decision_case_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  version integer not null constraint decision_case_versions_version_ck check (version > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint decision_case_versions_case_version_uk unique(case_id, version),
  constraint decision_case_versions_payload_ck check (
    pg_catalog.jsonb_typeof(payload) = 'object'
    and payload ->> 'schemaVersion' in ('1', '2')
  )
);

create table public.decision_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  case_version integer not null,
  run_snapshot jsonb not null,
  result_snapshot jsonb not null,
  baseline_fingerprint text not null,
  methodology_version text not null,
  as_of_date date not null,
  horizon_months integer not null,
  run_mode text not null,
  seed integer,
  stale_status text not null,
  completeness text not null,
  created_at timestamptz not null default now(),
  constraint decision_runs_horizon_ck check (horizon_months between 1 and 960),
  constraint decision_runs_mode_ck check (run_mode in ('DETERMINISTIC', 'MONTE_CARLO')),
  constraint decision_runs_seed_ck check (
    (run_mode = 'DETERMINISTIC' and seed is null)
    or run_mode = 'MONTE_CARLO'
  ),
  constraint decision_runs_stale_ck check (
    stale_status in ('CURRENT', 'STALE_BASELINE', 'STALE_REFERENCE')
  ),
  constraint decision_runs_completeness_ck check (
    completeness in ('READY', 'PARTIAL', 'NOT_COMPUTABLE')
  ),
  constraint decision_runs_snapshot_ck check (
    pg_catalog.jsonb_typeof(run_snapshot) = 'object'
    and pg_catalog.jsonb_typeof(result_snapshot) = 'object'
  )
);

create unique index decision_cases_id_user_uidx on public.decision_cases(id, user_id);
create unique index decision_case_versions_id_user_uidx
  on public.decision_case_versions(id, user_id);
create unique index decision_runs_id_user_uidx on public.decision_runs(id, user_id);

alter table public.decision_case_versions add constraint decision_case_versions_owner_fk
  foreign key (case_id, user_id)
  references public.decision_cases(id, user_id) on delete cascade;
alter table public.decision_runs add constraint decision_runs_owner_fk
  foreign key (case_id, user_id)
  references public.decision_cases(id, user_id) on delete cascade;
alter table public.decision_runs add constraint decision_runs_case_version_fk
  foreign key (case_id, case_version)
  references public.decision_case_versions(case_id, version);

create index decision_cases_user_status_idx
  on public.decision_cases(user_id, status, updated_at desc);
create index decision_case_versions_user_case_version_idx
  on public.decision_case_versions(user_id, case_id, version desc);
create index decision_case_versions_case_owner_fk_idx
  on public.decision_case_versions(case_id, user_id);
create index decision_runs_user_case_created_idx
  on public.decision_runs(user_id, case_id, created_at desc);
create index decision_runs_case_version_idx
  on public.decision_runs(case_id, case_version);

-- Toute ligne legacy devient une version explicitement marquée legacy. Le run historique
-- n'est pas inventé : les anciens `results` restent sur l'identité, uniquement pour
-- compatibilité de lecture.
insert into public.decision_case_versions(user_id, case_id, version, payload, created_at)
select
  decision.user_id,
  decision.id,
  1,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'methodologyVersion', 'DECISION_LAB_V1_LEGACY_UNKNOWN',
    'caseId', decision.id,
    'version', 1,
    'name', decision.name,
    'description', decision.description,
    'decisionType', decision.decision_type,
    'status', decision.status,
    'asOfDate', decision.as_of_date,
    'horizonMonths', decision.horizon_months,
    'baseline', null,
    'selectedGoals', '[]'::jsonb,
    'options', '[]'::jsonb,
    'legacyInputs', decision.inputs,
    'createdAt', decision.created_at
  ),
  decision.created_at
from public.decision_cases as decision
where not exists (
  select 1 from public.decision_case_versions as version
   where version.case_id = decision.id
);

alter table public.decision_case_versions enable row level security;
alter table public.decision_runs enable row level security;

drop policy if exists owner_all on public.decision_case_versions;
create policy owner_all on public.decision_case_versions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists owner_all on public.decision_runs;
create policy owner_all on public.decision_runs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.decision_cases, public.decision_case_versions, public.decision_runs
  from anon, authenticated;
grant select on public.decision_cases, public.decision_case_versions, public.decision_runs
  to authenticated;
revoke delete, truncate on public.decision_cases, public.decision_case_versions,
  public.decision_runs from service_role;
grant select, insert, update on public.decision_cases to service_role;
grant select, insert on public.decision_case_versions, public.decision_runs to service_role;

create or replace function public.lfo_validate_decision_case_version_v2(p_definition jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case_id uuid;
  v_version integer;
  v_as_of date;
  v_horizon integer;
  v_created_at timestamptz;
  v_option_count integer;
  v_goal_count integer;
begin
  if p_definition is null or pg_catalog.jsonb_typeof(p_definition) <> 'object'
     or p_definition ->> 'schemaVersion' is distinct from '2'
     or p_definition ->> 'methodologyVersion'
        is distinct from 'DECISION_LAB_V2_SCENARIOS_GOALS_1' then
    raise exception 'Contrat Decision Lab V2 invalide';
  end if;
  begin
    v_case_id := (p_definition ->> 'caseId')::uuid;
    v_version := (p_definition ->> 'version')::integer;
    v_as_of := (p_definition ->> 'asOfDate')::date;
    v_horizon := (p_definition ->> 'horizonMonths')::integer;
    v_created_at := (p_definition ->> 'createdAt')::timestamptz;
  exception when others then
    raise exception 'Métadonnées Decision Lab V2 invalides';
  end;
  if v_case_id is null or v_version < 1 or v_as_of is null or v_created_at is null
     or v_horizon not between 1 and 960
     or coalesce(pg_catalog.btrim(p_definition ->> 'name'), '') = ''
     or p_definition ->> 'status' not in ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED') then
    raise exception 'Métadonnées Decision Lab V2 invalides';
  end if;
  if pg_catalog.jsonb_typeof(p_definition -> 'baseline') <> 'object'
     or coalesce(p_definition #>> '{baseline,openingFingerprint}', '') = '' then
    raise exception 'Baseline Decision Lab V2 invalide';
  end if;
  if pg_catalog.jsonb_typeof(p_definition -> 'options') <> 'array'
     or pg_catalog.jsonb_typeof(p_definition -> 'selectedGoals') <> 'array' then
    raise exception 'Options ou Goals Decision Lab V2 invalides';
  end if;
  v_option_count := pg_catalog.jsonb_array_length(p_definition -> 'options');
  v_goal_count := pg_catalog.jsonb_array_length(p_definition -> 'selectedGoals');
  if v_option_count not between 2 and 3 or v_goal_count > 99 then
    raise exception 'Decision Lab V2 requiert deux ou trois options et au plus 99 Goals';
  end if;
  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_definition -> 'options') as option
     where option #>> '{scenarioDefinition,asOfDate}' is distinct from p_definition ->> 'asOfDate'
        or (option #>> '{scenarioDefinition,horizonMonths}')::integer <> v_horizon
        or option #>> '{scenarioDefinition,methodologyVersion}'
           is distinct from 'SCENARIOS_V2_EVENT_MONTHLY_1'
        or option #>> '{scenarioReference,scenarioId}'
           is distinct from option #>> '{scenarioDefinition,scenarioId}'
        or (option #>> '{scenarioReference,scenarioVersion}')::integer
           <> (option #>> '{scenarioDefinition,version}')::integer
  ) then
    raise exception 'Options Decision Lab V2 non comparables';
  end if;
end;
$$;

create or replace function public.lfo_create_decision_case_v2(
  p_user_id uuid,
  p_definition jsonb,
  p_now timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case_id uuid := (p_definition ->> 'caseId')::uuid;
begin
  if p_user_id is null then
    raise exception 'Ownership Decision Lab V2 invalide';
  end if;
  perform public.lfo_validate_decision_case_version_v2(p_definition);
  if (p_definition ->> 'version')::integer <> 1 then
    raise exception 'Un nouveau Decision Case commence en version 1';
  end if;
  insert into public.decision_cases(
    id, user_id, name, description, decision_type, inputs, results, status,
    as_of_date, horizon_months, current_version, created_at, updated_at, archived_at
  ) values (
    v_case_id, p_user_id, p_definition ->> 'name', p_definition ->> 'description',
    p_definition ->> 'decisionType', '{}'::jsonb, null, p_definition ->> 'status',
    (p_definition ->> 'asOfDate')::date, (p_definition ->> 'horizonMonths')::integer,
    1, p_now, p_now,
    case when p_definition ->> 'status' = 'ARCHIVED' then p_now else null end
  );
  insert into public.decision_case_versions(user_id, case_id, version, payload, created_at)
  values (p_user_id, v_case_id, 1, p_definition, p_now);
  return v_case_id;
end;
$$;

create or replace function public.lfo_save_decision_case_version_v2(
  p_user_id uuid,
  p_case_id uuid,
  p_expected_version integer,
  p_definition jsonb,
  p_updated_at timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current integer;
  v_version integer := p_expected_version + 1;
begin
  if p_user_id is null then
    raise exception 'Ownership Decision Lab V2 invalide';
  end if;
  select current_version into v_current
    from public.decision_cases
   where id = p_case_id and user_id = p_user_id
   for update;
  if v_current is null then raise exception 'Decision Case introuvable'; end if;
  if v_current <> p_expected_version then raise exception 'Decision Case version conflict'; end if;
  if p_definition ->> 'caseId' is distinct from p_case_id::text
     or (p_definition ->> 'version')::integer <> v_version then
    raise exception 'Nouvelle version Decision Lab V2 incohérente';
  end if;
  perform public.lfo_validate_decision_case_version_v2(p_definition);
  update public.decision_cases set
    name = p_definition ->> 'name',
    description = p_definition ->> 'description',
    decision_type = p_definition ->> 'decisionType',
    status = p_definition ->> 'status',
    as_of_date = (p_definition ->> 'asOfDate')::date,
    horizon_months = (p_definition ->> 'horizonMonths')::integer,
    current_version = v_version,
    archived_at = case when p_definition ->> 'status' = 'ARCHIVED' then p_updated_at else null end,
    updated_at = p_updated_at
   where id = p_case_id and user_id = p_user_id;
  insert into public.decision_case_versions(user_id, case_id, version, payload, created_at)
  values (p_user_id, p_case_id, v_version, p_definition, p_updated_at);
  return v_version;
end;
$$;

create or replace function public.lfo_save_decision_run_v2(
  p_user_id uuid,
  p_case_id uuid,
  p_case_version integer,
  p_run jsonb,
  p_result jsonb,
  p_now timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid := (p_run ->> 'id')::uuid;
  v_owner uuid;
begin
  if p_user_id is null then
    raise exception 'Ownership Decision Lab V2 invalide';
  end if;
  select user_id into v_owner from public.decision_case_versions
   where case_id = p_case_id and version = p_case_version and user_id = p_user_id;
  if v_owner is null then raise exception 'Version Decision Case introuvable'; end if;
  if p_run ->> 'caseId' is distinct from p_case_id::text
     or (p_run ->> 'caseVersion')::integer <> p_case_version
     or p_run ->> 'methodologyVersion'
        is distinct from 'DECISION_LAB_V2_SCENARIOS_GOALS_1'
     or pg_catalog.jsonb_typeof(p_result) <> 'object' then
    raise exception 'Snapshot Decision Run invalide';
  end if;
  insert into public.decision_runs(
    id, user_id, case_id, case_version, run_snapshot, result_snapshot,
    baseline_fingerprint, methodology_version, as_of_date, horizon_months,
    run_mode, seed, stale_status, completeness, created_at
  ) values (
    v_run_id, p_user_id, p_case_id, p_case_version, p_run, p_result,
    p_run ->> 'baselineFingerprint', p_run ->> 'methodologyVersion',
    (p_run ->> 'asOfDate')::date, (p_run ->> 'horizonMonths')::integer,
    p_run ->> 'runMode', nullif(p_run ->> 'seed', '')::integer,
    p_run ->> 'staleStatus', p_result ->> 'completeness', p_now
  );
  return v_run_id;
end;
$$;

create or replace function public.lfo_guard_decision_snapshot_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Decision Lab V2 snapshots are immutable';
end;
$$;

create trigger decision_case_versions_immutable
before update or delete on public.decision_case_versions
for each row execute function public.lfo_guard_decision_snapshot_immutable();

create trigger decision_runs_immutable
before update or delete on public.decision_runs
for each row execute function public.lfo_guard_decision_snapshot_immutable();

revoke all on function public.lfo_validate_decision_case_version_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.lfo_create_decision_case_v2(uuid,jsonb,timestamptz)
  from public, anon, authenticated;
revoke all on function public.lfo_save_decision_case_version_v2(uuid,uuid,integer,jsonb,timestamptz)
  from public, anon, authenticated;
revoke all on function public.lfo_save_decision_run_v2(uuid,uuid,integer,jsonb,jsonb,timestamptz)
  from public, anon, authenticated;

grant execute on function public.lfo_validate_decision_case_version_v2(jsonb) to service_role;
grant execute on function public.lfo_create_decision_case_v2(uuid,jsonb,timestamptz) to service_role;
grant execute on function public.lfo_save_decision_case_version_v2(uuid,uuid,integer,jsonb,timestamptz)
  to service_role;
grant execute on function public.lfo_save_decision_run_v2(uuid,uuid,integer,jsonb,jsonb,timestamptz)
  to service_role;

comment on table public.decision_cases is
  'Identités légères des questions Decision Lab V2 ; aucune vérité financière dérivée.';
comment on table public.decision_case_versions is
  'Versions immuables des questions, options Scenarios V2 et Goals sélectionnés.';
comment on table public.decision_runs is
  'Snapshots immuables et reproductibles de résultats dérivés Decision Lab V2.';
