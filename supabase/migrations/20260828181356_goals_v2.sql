-- Goals V2
--
-- `goals` reste l'identité légère de l'intention. Chaque définition reproductible est
-- un snapshot immuable dans `goal_versions`. Une évaluation n'est jamais persistée ici :
-- elle reste un résultat dérivé du bilan canonique ou d'une trajectoire Scenarios V2.

alter table public.goals
  add column if not exists description text,
  add column if not exists current_version integer not null default 1,
  add column if not exists constraint_strength text not null default 'SOFT',
  add column if not exists archived_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from public.goals
     where status not in ('ACTIVE', 'PAUSED', 'ACHIEVED', 'ARCHIVED')
  ) then
    raise exception 'Goals V2 refuse un status legacy inconnu';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'goals_status_ck' and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals add constraint goals_status_ck
      check (status in ('ACTIVE', 'PAUSED', 'ACHIEVED', 'ARCHIVED'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'goals_priority_ck' and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals add constraint goals_priority_ck
      check (priority between 1 and 99);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'goals_current_version_ck' and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals add constraint goals_current_version_ck
      check (current_version > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'goals_constraint_strength_ck' and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals add constraint goals_constraint_strength_ck
      check (constraint_strength in ('HARD', 'SOFT'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'goals_archive_shape_ck' and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals add constraint goals_archive_shape_ck
      check (
        (status = 'ARCHIVED' and archived_at is not null)
        or (status <> 'ARCHIVED' and archived_at is null)
      );
  end if;
end $$;

create table if not exists public.goal_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null,
  version integer not null constraint goal_versions_version_ck check (version > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint goal_versions_goal_version_uk unique(goal_id, version),
  constraint goal_versions_payload_ck check (
    pg_catalog.jsonb_typeof(payload) = 'object'
    and payload ->> 'schemaVersion' = '2'
  )
);

create unique index if not exists goals_id_user_uidx on public.goals(id, user_id);
create unique index if not exists goal_versions_id_user_uidx
  on public.goal_versions(id, user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'goal_versions_owner_fk'
       and conrelid = 'public.goal_versions'::regclass
  ) then
    alter table public.goal_versions add constraint goal_versions_owner_fk
      foreign key (goal_id, user_id)
      references public.goals(id, user_id) on delete restrict;
  end if;
end $$;

create index if not exists goals_user_status_priority_idx
  on public.goals(user_id, status, priority, id);
create index if not exists goal_versions_user_goal_version_idx
  on public.goal_versions(user_id, goal_id, version desc);

alter table public.goal_versions enable row level security;

drop policy if exists goal_versions_owner_select on public.goal_versions;
create policy goal_versions_owner_select on public.goal_versions
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.goal_versions from anon, authenticated;
grant select on public.goal_versions to authenticated;
revoke delete, truncate on public.goal_versions from service_role;
grant select, insert, update on public.goal_versions to service_role;

-- La couche applicative écrit via des RPC serveur. Cela empêche un client authentifié de
-- modifier l'identité sans créer la version correspondante.
revoke insert, update, delete, truncate, references, trigger on public.goals from authenticated;
grant select on public.goals to authenticated;

-- Les objectifs legacy deviennent une version V2 explicite. La devise vient du profil
-- du propriétaire ; si elle manque, JSON null est conservé et le moteur remontera
-- MISSING_CURRENCY au lieu de supposer EUR.
insert into public.goal_versions(user_id, goal_id, version, payload, created_at)
select
  goal.user_id,
  goal.id,
  1,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'methodologyVersion', 'GOALS_V2_CANONICAL_TRAJECTORY_1',
    'goalId', goal.id,
    'version', 1,
    'name', goal.name,
    'description', goal.description,
    'status', goal.status,
    'priority', goal.priority,
    'constraintStrength', goal.constraint_strength,
    'target', pg_catalog.jsonb_build_object(
      'metric', 'NET_WORTH',
      'operator', 'AT_LEAST',
      'value', goal.target_amount,
      'currency', nullif(pg_catalog.btrim(profile.reporting_currency::text), ''),
      'entityId', null
    ),
    'targetDate', goal.target_date,
    'targetWindow', null,
    'createdAt', goal.updated_at,
    'legacyCompatibility', true
  ),
  goal.updated_at
from public.goals as goal
left join public.profiles as profile on profile.user_id = goal.user_id
where not exists (
  select 1 from public.goal_versions as version where version.goal_id = goal.id
)
on conflict (goal_id, version) do nothing;

create or replace function public.lfo_validate_goal_definition_v2(p_definition jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_metric text := p_definition #>> '{target,metric}';
  v_operator text := p_definition #>> '{target,operator}';
  v_currency text := p_definition #>> '{target,currency}';
  v_value numeric;
begin
  if pg_catalog.jsonb_typeof(p_definition) <> 'object' then
    raise exception 'Goal V2 definition doit être un objet JSON';
  end if;
  if p_definition ->> 'schemaVersion' <> '2'
     or p_definition ->> 'methodologyVersion' <> 'GOALS_V2_CANONICAL_TRAJECTORY_1' then
    raise exception 'Contrat Goals V2 invalide';
  end if;
  if coalesce(pg_catalog.btrim(p_definition ->> 'name'), '') = '' then
    raise exception 'Goal name requis';
  end if;
  if p_definition ->> 'status' not in ('ACTIVE', 'PAUSED', 'ACHIEVED', 'ARCHIVED') then
    raise exception 'Goal status invalide';
  end if;
  if p_definition ->> 'constraintStrength' not in ('HARD', 'SOFT') then
    raise exception 'Goal constraint strength invalide';
  end if;
  if v_metric not in (
    'NET_WORTH', 'LIQUID_NET_WORTH', 'IMMEDIATE_CASH', 'LIQUID_ASSETS',
    'INVESTMENT_ASSETS', 'TOTAL_LIABILITIES', 'CONTRACTUAL_DEBT', 'FUNDING_GAP',
    'SPECIFIC_DEBT_BALANCE', 'REAL_ESTATE_VALUE', 'BUSINESS_EQUITY'
  ) then
    raise exception 'Goal target metric invalide';
  end if;
  if v_operator not in ('AT_LEAST', 'AT_MOST', 'EQUAL') then
    raise exception 'Goal target operator invalide';
  end if;
  if v_metric in (
    'NET_WORTH', 'LIQUID_NET_WORTH', 'IMMEDIATE_CASH', 'LIQUID_ASSETS',
    'INVESTMENT_ASSETS', 'REAL_ESTATE_VALUE', 'BUSINESS_EQUITY'
  ) and v_operator not in ('AT_LEAST', 'EQUAL') then
    raise exception 'Opérateur incompatible avec une métrique d’actif';
  end if;
  if v_metric in (
    'TOTAL_LIABILITIES', 'CONTRACTUAL_DEBT', 'FUNDING_GAP', 'SPECIFIC_DEBT_BALANCE'
  ) and v_operator not in ('AT_MOST', 'EQUAL') then
    raise exception 'Opérateur incompatible avec une métrique de passif';
  end if;
  if v_metric = 'SPECIFIC_DEBT_BALANCE'
     and nullif(p_definition #>> '{target,entityId}', '') is null then
    raise exception 'Cette métrique exige une entité';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Goal currency invalide';
  end if;
  begin
    v_value := (p_definition #>> '{target,value}')::numeric;
  exception when others then
    raise exception 'Goal target value invalide';
  end;
  if v_value < 0 then raise exception 'Goal target value doit être positive ou nulle'; end if;
  if (p_definition -> 'targetDate') <> 'null'::jsonb
     and (p_definition -> 'targetWindow') <> 'null'::jsonb then
    raise exception 'Goal targetDate et targetWindow sont mutuellement exclusifs';
  end if;
  if (p_definition -> 'targetWindow') <> 'null'::jsonb then
    if (p_definition #>> '{targetWindow,startDate}')::date
       > (p_definition #>> '{targetWindow,endDate}')::date then
      raise exception 'Goal target window invalide';
    end if;
  end if;
  if (p_definition ->> 'priority')::integer not between 1 and 99 then
    raise exception 'Goal priority invalide';
  end if;
end;
$$;

create or replace function public.lfo_create_goal_v2(
  p_user_id uuid,
  p_definition jsonb,
  p_now timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_goal_id uuid := pg_catalog.gen_random_uuid();
  v_definition jsonb;
begin
  perform public.lfo_validate_goal_definition_v2(p_definition);
  if p_definition ->> 'status' <> 'ACTIVE' then
    raise exception 'Un nouvel objectif doit être ACTIVE';
  end if;
  v_definition := p_definition || pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'methodologyVersion', 'GOALS_V2_CANONICAL_TRAJECTORY_1',
    'goalId', v_goal_id,
    'version', 1,
    'status', 'ACTIVE',
    'createdAt', p_now,
    'legacyCompatibility', false
  );
  perform public.lfo_validate_goal_definition_v2(v_definition);
  insert into public.goals(
    id, user_id, name, description, target_amount, target_date, priority, status,
    current_version, constraint_strength, archived_at, created_at, updated_at
  ) values (
    v_goal_id, p_user_id, v_definition ->> 'name', v_definition ->> 'description',
    (v_definition #>> '{target,value}')::numeric,
    coalesce(
      (v_definition ->> 'targetDate')::date,
      (v_definition #>> '{targetWindow,endDate}')::date
    ),
    (v_definition ->> 'priority')::integer, 'ACTIVE', 1,
    v_definition ->> 'constraintStrength', null, p_now, p_now
  );
  insert into public.goal_versions(user_id, goal_id, version, payload, created_at)
  values (p_user_id, v_goal_id, 1, v_definition, p_now);
  return v_goal_id;
end;
$$;

create or replace function public.lfo_save_goal_version_v2(
  p_user_id uuid,
  p_goal_id uuid,
  p_expected_version integer,
  p_definition jsonb,
  p_updated_at timestamptz
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.goals%rowtype;
  v_version integer;
  v_definition jsonb;
begin
  perform public.lfo_validate_goal_definition_v2(p_definition);
  select * into v_current from public.goals
   where id = p_goal_id and user_id = p_user_id for update;
  if not found then raise exception 'Goal not found'; end if;
  if v_current.current_version <> p_expected_version then
    raise exception 'Goal version conflict: expected %, current %',
      p_expected_version, v_current.current_version;
  end if;
  if v_current.status = 'ARCHIVED' then
    raise exception 'Un objectif archivé doit être réactivé avant modification';
  end if;
  if p_definition ->> 'status' <> v_current.status then
    raise exception 'Changer le status requiert lfo_set_goal_status_v2';
  end if;
  v_version := v_current.current_version + 1;
  v_definition := p_definition || pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'methodologyVersion', 'GOALS_V2_CANONICAL_TRAJECTORY_1',
    'goalId', p_goal_id,
    'version', v_version,
    'createdAt', p_updated_at,
    'legacyCompatibility', false
  );
  perform public.lfo_validate_goal_definition_v2(v_definition);
  perform pg_catalog.set_config('lfo.goal_version_write', 'on', true);
  update public.goals set
    name = v_definition ->> 'name',
    description = v_definition ->> 'description',
    target_amount = (v_definition #>> '{target,value}')::numeric,
    target_date = coalesce(
      (v_definition ->> 'targetDate')::date,
      (v_definition #>> '{targetWindow,endDate}')::date
    ),
    priority = (v_definition ->> 'priority')::integer,
    constraint_strength = v_definition ->> 'constraintStrength',
    current_version = v_version,
    updated_at = p_updated_at
  where id = p_goal_id and user_id = p_user_id;
  perform pg_catalog.set_config('lfo.goal_version_write', 'off', true);
  insert into public.goal_versions(user_id, goal_id, version, payload, created_at)
  values (p_user_id, p_goal_id, v_version, v_definition, p_updated_at);
  return v_version;
end;
$$;

create or replace function public.lfo_set_goal_status_v2(
  p_user_id uuid,
  p_goal_id uuid,
  p_expected_version integer,
  p_status text,
  p_updated_at timestamptz
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.goals%rowtype;
  v_definition jsonb;
  v_version integer;
begin
  if p_status not in ('ACTIVE', 'PAUSED', 'ACHIEVED', 'ARCHIVED') then
    raise exception 'Goal status invalide';
  end if;
  select * into v_current from public.goals
   where id = p_goal_id and user_id = p_user_id for update;
  if not found then raise exception 'Goal not found'; end if;
  if v_current.current_version <> p_expected_version then
    raise exception 'Goal version conflict: expected %, current %',
      p_expected_version, v_current.current_version;
  end if;
  select payload into v_definition from public.goal_versions
   where goal_id = p_goal_id and user_id = p_user_id
     and version = v_current.current_version;
  if v_definition is null then raise exception 'Goal current version not found'; end if;
  v_version := v_current.current_version + 1;
  v_definition := v_definition || pg_catalog.jsonb_build_object(
    'status', p_status,
    'version', v_version,
    'createdAt', p_updated_at
  );
  perform public.lfo_validate_goal_definition_v2(v_definition);
  perform pg_catalog.set_config('lfo.goal_version_write', 'on', true);
  update public.goals set
    status = p_status,
    archived_at = case when p_status = 'ARCHIVED' then p_updated_at else null end,
    current_version = v_version,
    updated_at = p_updated_at
  where id = p_goal_id and user_id = p_user_id;
  perform pg_catalog.set_config('lfo.goal_version_write', 'off', true);
  insert into public.goal_versions(user_id, goal_id, version, payload, created_at)
  values (p_user_id, p_goal_id, v_version, v_definition, p_updated_at);
  return v_version;
end;
$$;

create or replace function public.lfo_guard_goal_version_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Goal versions are immutable';
end;
$$;

drop trigger if exists goal_versions_immutable_update on public.goal_versions;
create trigger goal_versions_immutable_update
before update on public.goal_versions
for each row execute function public.lfo_guard_goal_version_update();

create or replace function public.lfo_guard_goal_version_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Goal versions are immutable and cannot be deleted';
end;
$$;

drop trigger if exists goal_versions_immutable_delete on public.goal_versions;
create trigger goal_versions_immutable_delete
before delete on public.goal_versions
for each row execute function public.lfo_guard_goal_version_delete();

create or replace function public.lfo_guard_goal_v2_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.target_amount is distinct from old.target_amount
    or new.target_date is distinct from old.target_date
    or new.priority is distinct from old.priority
    or new.constraint_strength is distinct from old.constraint_strength
    or new.current_version is distinct from old.current_version
    or new.status is distinct from old.status
    or new.archived_at is distinct from old.archived_at
  ) and coalesce(pg_catalog.current_setting('lfo.goal_version_write', true), '') <> 'on' then
    raise exception 'Goal lifecycle/version changes require a Goals V2 RPC';
  end if;
  return new;
end;
$$;

drop trigger if exists goals_v2_update_guard on public.goals;
create trigger goals_v2_update_guard
before update on public.goals
for each row execute function public.lfo_guard_goal_v2_update();

revoke all on function public.lfo_validate_goal_definition_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.lfo_create_goal_v2(uuid,jsonb,timestamptz)
  from public, anon, authenticated;
revoke all on function public.lfo_save_goal_version_v2(uuid,uuid,integer,jsonb,timestamptz)
  from public, anon, authenticated;
revoke all on function public.lfo_set_goal_status_v2(uuid,uuid,integer,text,timestamptz)
  from public, anon, authenticated;

grant execute on function public.lfo_validate_goal_definition_v2(jsonb) to service_role;
grant execute on function public.lfo_create_goal_v2(uuid,jsonb,timestamptz) to service_role;
grant execute on function public.lfo_save_goal_version_v2(uuid,uuid,integer,jsonb,timestamptz)
  to service_role;
grant execute on function public.lfo_set_goal_status_v2(uuid,uuid,integer,text,timestamptz)
  to service_role;

comment on table public.goal_versions is
  'Snapshots immuables des intentions Goals V2 ; aucune valeur financière dérivée.';
comment on column public.goals.current_version is
  'Version exacte de goal_versions utilisée comme définition courante.';
