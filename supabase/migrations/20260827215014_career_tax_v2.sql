-- Career + Tax V2 — additive facts and declared rules only.
-- No fiscal formula or derived net cash is persisted here.

create unique index if not exists income_sources_id_user_uidx on public.income_sources(id,user_id);
create unique index if not exists tax_profiles_id_user_uidx on public.tax_profiles(id,user_id);
create unique index if not exists tax_profiles_owner_effective_uidx on public.tax_profiles(user_id,effective_from);
create unique index if not exists tax_rules_id_user_uidx on public.tax_rules(id,user_id);
create unique index if not exists documents_id_user_uidx on public.documents(id,user_id);
create index if not exists income_sources_user_idx on public.income_sources(user_id);
create index if not exists tax_profiles_user_idx on public.tax_profiles(user_id);
create index if not exists tax_rules_user_idx on public.tax_rules(user_id);

create table public.career_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  employer text, job_title text, employment_type text not null, industry text, country char(2),
  currency char(3) not null, start_date date not null, end_date date, status text not null,
  data_kind text not null, confidence text not null, source text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint career_roles_type_ck check (employment_type in ('EMPLOYEE','INTERN','FREELANCE','CONTRACTOR','ENTREPRENEUR','CORPORATE_OFFICER','UNEMPLOYED','OTHER')),
  constraint career_roles_status_ck check (status in ('ACTIVE','ENDED','FUTURE')),
  constraint career_roles_dates_ck check (end_date is null or end_date >= start_date),
  constraint career_roles_data_kind_ck check (data_kind in ('ACTUAL','CONTRACTUAL','USER_ASSUMPTION','MODEL_ASSUMPTION','PROJECTED','MISSING')),
  constraint career_roles_id_user_uk unique(id,user_id)
);

create table public.career_compensation_terms (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null, base_salary numeric(20,6), frequency text not null,
  guaranteed_bonus numeric(20,6), target_bonus numeric(20,6), target_bonus_rate numeric(12,8),
  discretionary_bonus numeric(20,6), commissions numeric(20,6), profit_sharing numeric(20,6),
  participation numeric(20,6), employer_benefits numeric(20,6), allowances numeric(20,6),
  other_taxable_compensation numeric(20,6), other_non_taxable_compensation numeric(20,6),
  working_time numeric(12,4), effective_from date not null, effective_to date,
  data_kind text not null, confidence text not null, source text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint career_compensation_role_fk foreign key(role_id,user_id) references public.career_roles(id,user_id) on delete cascade,
  constraint career_compensation_frequency_ck check (frequency in ('MONTHLY','ANNUAL','DAILY','HOURLY')),
  constraint career_compensation_dates_ck check (effective_to is null or effective_to >= effective_from),
  constraint career_compensation_amounts_ck check (
    (base_salary is null or base_salary >= 0) and (guaranteed_bonus is null or guaranteed_bonus >= 0) and
    (target_bonus is null or target_bonus >= 0) and (target_bonus_rate is null or target_bonus_rate between 0 and 10) and
    (discretionary_bonus is null or discretionary_bonus >= 0) and (commissions is null or commissions >= 0) and
    (profit_sharing is null or profit_sharing >= 0) and (participation is null or participation >= 0) and
    (employer_benefits is null or employer_benefits >= 0) and (allowances is null or allowances >= 0) and
    (other_taxable_compensation is null or other_taxable_compensation >= 0) and
    (other_non_taxable_compensation is null or other_non_taxable_compensation >= 0) and
    (working_time is null or working_time > 0)),
  constraint career_compensation_data_kind_ck check (data_kind in ('ACTUAL','CONTRACTUAL','USER_ASSUMPTION','MODEL_ASSUMPTION','PROJECTED','MISSING')),
  constraint career_compensation_effective_uk unique(user_id,role_id,effective_from)
);

create table public.career_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid, event_type text not null, event_date date not null, amount numeric(20,6), currency char(3),
  variable_state text, paid_date date, label text, data_kind text not null, confidence text not null,
  source text, notes text, created_at timestamptz not null default now(),
  constraint career_events_role_fk foreign key(role_id,user_id) references public.career_roles(id,user_id) on delete cascade,
  constraint career_events_type_ck check (event_type in ('JOB_START','JOB_END','PROMOTION','SALARY_CHANGE','BONUS_TARGET_CHANGE','BONUS_EARNED','BONUS_PAID','COMMISSION','UNEMPLOYMENT','SABBATICAL','FREELANCE_START','FREELANCE_END','EQUITY_GRANT','EQUITY_VEST','OTHER')),
  constraint career_events_variable_state_ck check (variable_state is null or variable_state in ('TARGET','CONTRACTUAL','EARNED','PAID','PROJECTED')),
  constraint career_events_paid_shape_ck check ((variable_state = 'PAID' and paid_date is not null) or variable_state is distinct from 'PAID'),
  constraint career_events_amount_ck check (amount is null or amount >= 0),
  constraint career_events_data_kind_ck check (data_kind in ('ACTUAL','CONTRACTUAL','USER_ASSUMPTION','MODEL_ASSUMPTION','PROJECTED','MISSING')),
  constraint career_events_id_user_uk unique(id,user_id)
);

create table public.career_equity_grants (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid, company text not null, instrument_type text not null, grant_date date not null,
  quantity numeric(20,6), strike_price numeric(20,6), currency char(3), vesting_schedule jsonb not null default '{}'::jsonb,
  expiry_date date, liquidity_status text not null, data_kind text not null, confidence text not null,
  source text, notes text, created_at timestamptz not null default now(),
  constraint career_equity_role_fk foreign key(role_id,user_id) references public.career_roles(id,user_id) on delete cascade,
  constraint career_equity_type_ck check (instrument_type in ('STOCK_OPTION','RSU','BSPCE','FREE_SHARE','CARRIED_INTEREST','MANAGEMENT_PACKAGE','EMPLOYEE_SHARE','OTHER')),
  constraint career_equity_liquidity_ck check (liquidity_status in ('ILLIQUID','LIQUID','UNKNOWN')),
  constraint career_equity_amounts_ck check ((quantity is null or quantity >= 0) and (strike_price is null or strike_price >= 0)),
  constraint career_equity_expiry_ck check (expiry_date is null or expiry_date >= grant_date)
);

create table public.career_scenarios (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, scenario_type text not null, effective_from date not null, role_id uuid,
  assumptions jsonb not null default '{}'::jsonb, data_kind text not null, confidence text not null,
  source text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint career_scenarios_role_fk foreign key(role_id,user_id) references public.career_roles(id,user_id) on delete set null (role_id),
  constraint career_scenarios_type_ck check (scenario_type in ('STAY','PROMOTION','NEW_JOB','UNEMPLOYMENT','FREELANCE','CUSTOM')),
  constraint career_scenarios_kind_ck check (data_kind in ('USER_ASSUMPTION','MODEL_ASSUMPTION','PROJECTED'))
);

alter table public.tax_profiles
  add column if not exists jurisdiction text,
  add column if not exists marital_status text,
  add column if not exists dependants integer,
  add column if not exists tax_shares numeric(12,6),
  add column if not exists withholding_settings jsonb not null default '{}'::jsonb,
  add column if not exists social_contribution_regime text,
  add column if not exists professional_status text,
  add column if not exists special_regime text,
  add column if not exists effective_to date,
  add column if not exists source text,
  add column if not exists confidence text not null default 'UNKNOWN',
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.tax_profiles add constraint tax_profiles_dates_ck check (effective_to is null or effective_to >= effective_from);
alter table public.tax_profiles add constraint tax_profiles_dependants_ck check (dependants is null or dependants >= 0);

create table public.tax_rule_sets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  jurisdiction text not null, tax_year integer not null, name text not null, effective_from date not null,
  effective_to date, source text not null, source_date date not null, confidence text not null,
  status text not null, legal_reference text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint tax_rule_sets_dates_ck check (effective_to is null or effective_to >= effective_from),
  constraint tax_rule_sets_status_ck check (status in ('DRAFT','DECLARED','VERIFIED','STALE')),
  constraint tax_rule_sets_effective_uk unique(user_id,jurisdiction,tax_year,name,effective_from),
  constraint tax_rule_sets_id_user_uk unique(id,user_id)
);

alter table public.tax_rules
  add column if not exists rule_set_id uuid,
  add column if not exists tax_type text,
  add column if not exists income_category text,
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists source_date date,
  add column if not exists legal_note text,
  add column if not exists notes text;
alter table public.tax_rules add constraint tax_rules_rule_set_fk foreign key(rule_set_id,user_id) references public.tax_rule_sets(id,user_id) on delete cascade;
alter table public.tax_rules add constraint tax_rules_type_ck check (tax_type is null or tax_type in ('PAYROLL_CONTRIBUTION','TAXABLE_DEDUCTION','INCOME_TAX_BRACKETS','WITHHOLDING_RATE'));
alter table public.tax_rules add constraint tax_rules_category_ck check (income_category is null or income_category in ('EMPLOYMENT','PROFESSIONAL','OTHER'));
alter table public.tax_rules add constraint tax_rules_dates_ck check (effective_to is null or effective_from is null or effective_to >= effective_from);

create table public.tax_observations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  observation_type text not null, observed_date date not null, tax_year integer not null, amount numeric(20,6) not null,
  currency char(3) not null, transaction_id uuid, document_id uuid, data_kind text not null default 'ACTUAL',
  confidence text not null, source text, notes text, created_at timestamptz not null default now(),
  constraint tax_observations_transaction_fk foreign key(transaction_id,user_id) references public.transactions(id,user_id) on delete set null (transaction_id),
  constraint tax_observations_document_fk foreign key(document_id,user_id) references public.documents(id,user_id) on delete set null (document_id),
  constraint tax_observations_type_ck check (observation_type in ('LIABILITY','WITHHELD','PAID','REFUND','BALANCE_DUE')),
  constraint tax_observations_amount_ck check (amount >= 0),
  constraint tax_observations_kind_ck check (data_kind = 'ACTUAL')
);

create table public.tax_income_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  income_category text not null, recognition_date date not null, cash_date date,
  gross_amount numeric(20,6), currency char(3) not null, career_role_id uuid, career_event_id uuid,
  transaction_id uuid, data_kind text not null, confidence text not null, source text, notes text,
  created_at timestamptz not null default now(),
  constraint tax_income_role_fk foreign key(career_role_id,user_id) references public.career_roles(id,user_id) on delete set null (career_role_id),
  constraint tax_income_event_fk foreign key(career_event_id,user_id) references public.career_events(id,user_id) on delete set null (career_event_id),
  constraint tax_income_transaction_fk foreign key(transaction_id,user_id) references public.transactions(id,user_id) on delete set null (transaction_id),
  constraint tax_income_category_ck check (income_category in ('EMPLOYMENT','BONUS','PROFESSIONAL','DIVIDEND','INTEREST','SECURITIES_GAIN','BUSINESS_DISTRIBUTION','REAL_ESTATE_INCOME','REAL_ESTATE_SALE','OTHER')),
  constraint tax_income_amount_ck check (gross_amount is null or gross_amount >= 0),
  constraint tax_income_kind_ck check (data_kind in ('ACTUAL','CONTRACTUAL','USER_ASSUMPTION','MODEL_ASSUMPTION','PROJECTED','MISSING'))
);

create index career_roles_user_date_idx on public.career_roles(user_id,start_date,end_date);
create index career_compensation_role_owner_idx on public.career_compensation_terms(role_id,user_id,effective_from desc);
create index career_events_role_owner_idx on public.career_events(role_id,user_id,event_date);
create index career_events_paid_idx on public.career_events(user_id,paid_date) where paid_date is not null;
create index career_equity_role_owner_idx on public.career_equity_grants(role_id,user_id,grant_date);
create index career_scenarios_role_owner_idx on public.career_scenarios(role_id,user_id,effective_from);
create index tax_rule_sets_user_year_idx on public.tax_rule_sets(user_id,jurisdiction,tax_year);
create index tax_rules_rule_set_owner_idx on public.tax_rules(rule_set_id,user_id,effective_from);
create index tax_observations_user_year_idx on public.tax_observations(user_id,tax_year,observed_date);
create index tax_observations_transaction_owner_idx on public.tax_observations(transaction_id,user_id) where transaction_id is not null;
create index tax_income_role_owner_idx on public.tax_income_items(career_role_id,user_id,recognition_date);
create index tax_income_event_owner_idx on public.tax_income_items(career_event_id,user_id) where career_event_id is not null;
create index tax_income_transaction_owner_idx on public.tax_income_items(transaction_id,user_id) where transaction_id is not null;

do $$ declare target text; begin
  foreach target in array array['career_roles','career_compensation_terms','career_events','career_equity_grants','career_scenarios','tax_rule_sets','tax_observations','tax_income_items'] loop
    execute format('alter table public.%I enable row level security',target);
    execute format('create policy owner_all on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',target);
    execute format('revoke all on table public.%I from anon',target);
    execute format('grant select,insert,update,delete on table public.%I to authenticated',target);
    execute format('grant select,insert,update,delete on table public.%I to service_role',target);
  end loop;
end $$;

create or replace function public.lfo_save_career_package(p_user_id uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_role_id uuid := coalesce(nullif(p_payload->>'role_id','')::uuid,gen_random_uuid()); v_term jsonb := p_payload->'compensation';
begin
  insert into public.career_roles(id,user_id,employer,job_title,employment_type,industry,country,currency,start_date,end_date,status,data_kind,confidence,source,notes)
  values(v_role_id,p_user_id,nullif(p_payload->>'employer',''),nullif(p_payload->>'job_title',''),p_payload->>'employment_type',nullif(p_payload->>'industry',''),upper(nullif(p_payload->>'country','')),upper(p_payload->>'currency'),(p_payload->>'start_date')::date,nullif(p_payload->>'end_date','')::date,p_payload->>'status',p_payload->>'data_kind',p_payload->>'confidence',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''))
  on conflict(id) do update set employer=excluded.employer,job_title=excluded.job_title,employment_type=excluded.employment_type,industry=excluded.industry,country=excluded.country,currency=excluded.currency,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,data_kind=excluded.data_kind,confidence=excluded.confidence,source=excluded.source,notes=excluded.notes,updated_at=now()
  where career_roles.user_id=p_user_id;
  if not found then raise exception 'career role does not belong to user'; end if;
  if v_term is not null then
    insert into public.career_compensation_terms(user_id,role_id,base_salary,frequency,guaranteed_bonus,target_bonus,target_bonus_rate,discretionary_bonus,commissions,profit_sharing,participation,employer_benefits,allowances,other_taxable_compensation,other_non_taxable_compensation,working_time,effective_from,effective_to,data_kind,confidence,source,notes)
    values(p_user_id,v_role_id,nullif(v_term->>'base_salary','')::numeric,v_term->>'frequency',nullif(v_term->>'guaranteed_bonus','')::numeric,nullif(v_term->>'target_bonus','')::numeric,nullif(v_term->>'target_bonus_rate','')::numeric,nullif(v_term->>'discretionary_bonus','')::numeric,nullif(v_term->>'commissions','')::numeric,nullif(v_term->>'profit_sharing','')::numeric,nullif(v_term->>'participation','')::numeric,nullif(v_term->>'employer_benefits','')::numeric,nullif(v_term->>'allowances','')::numeric,nullif(v_term->>'other_taxable_compensation','')::numeric,nullif(v_term->>'other_non_taxable_compensation','')::numeric,nullif(v_term->>'working_time','')::numeric,(v_term->>'effective_from')::date,nullif(v_term->>'effective_to','')::date,v_term->>'data_kind',v_term->>'confidence',nullif(v_term->>'source',''),nullif(v_term->>'notes',''))
    on conflict(user_id,role_id,effective_from) do update set base_salary=excluded.base_salary,frequency=excluded.frequency,guaranteed_bonus=excluded.guaranteed_bonus,target_bonus=excluded.target_bonus,target_bonus_rate=excluded.target_bonus_rate,discretionary_bonus=excluded.discretionary_bonus,commissions=excluded.commissions,profit_sharing=excluded.profit_sharing,participation=excluded.participation,employer_benefits=excluded.employer_benefits,allowances=excluded.allowances,other_taxable_compensation=excluded.other_taxable_compensation,other_non_taxable_compensation=excluded.other_non_taxable_compensation,working_time=excluded.working_time,effective_to=excluded.effective_to,data_kind=excluded.data_kind,confidence=excluded.confidence,source=excluded.source,notes=excluded.notes,updated_at=now();
  end if;
  return v_role_id;
end $$;

create or replace function public.lfo_record_career_event(p_user_id uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid; begin
  insert into public.career_events(user_id,role_id,event_type,event_date,amount,currency,variable_state,paid_date,label,data_kind,confidence,source,notes)
  values(p_user_id,nullif(p_payload->>'role_id','')::uuid,p_payload->>'event_type',(p_payload->>'event_date')::date,nullif(p_payload->>'amount','')::numeric,upper(nullif(p_payload->>'currency','')),nullif(p_payload->>'variable_state',''),nullif(p_payload->>'paid_date','')::date,nullif(p_payload->>'label',''),p_payload->>'data_kind',p_payload->>'confidence',nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')) returning id into v_id; return v_id;
end $$;

create or replace function public.lfo_save_tax_rule_set(p_user_id uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid := coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid()); v_rule jsonb; begin
  insert into public.tax_rule_sets(id,user_id,jurisdiction,tax_year,name,effective_from,effective_to,source,source_date,confidence,status,legal_reference,notes)
  values(v_id,p_user_id,p_payload->>'jurisdiction',(p_payload->>'tax_year')::integer,p_payload->>'name',(p_payload->>'effective_from')::date,nullif(p_payload->>'effective_to','')::date,p_payload->>'source',(p_payload->>'source_date')::date,p_payload->>'confidence',p_payload->>'status',nullif(p_payload->>'legal_reference',''),nullif(p_payload->>'notes',''))
  on conflict(id) do update set jurisdiction=excluded.jurisdiction,tax_year=excluded.tax_year,name=excluded.name,effective_from=excluded.effective_from,effective_to=excluded.effective_to,source=excluded.source,source_date=excluded.source_date,confidence=excluded.confidence,status=excluded.status,legal_reference=excluded.legal_reference,notes=excluded.notes,updated_at=now() where tax_rule_sets.user_id=p_user_id;
  if not found then raise exception 'tax rule set does not belong to user'; end if;
  delete from public.tax_rules where user_id=p_user_id and rule_set_id=v_id;
  for v_rule in select * from jsonb_array_elements(coalesce(p_payload->'rules','[]'::jsonb)) loop
    insert into public.tax_rules(user_id,jurisdiction,name,tax_year,rule,source,verified_at,data_kind,confidence,rule_set_id,tax_type,income_category,effective_from,effective_to,source_date,legal_note,notes)
    values(p_user_id,p_payload->>'jurisdiction',v_rule->>'name',(p_payload->>'tax_year')::integer,v_rule->'parameters',p_payload->>'source',nullif(v_rule->>'verified_at','')::date,'USER_ASSUMPTION',v_rule->>'confidence',v_id,v_rule->>'tax_type',v_rule->>'income_category',(v_rule->>'effective_from')::date,nullif(v_rule->>'effective_to','')::date,(p_payload->>'source_date')::date,nullif(v_rule->>'legal_note',''),nullif(v_rule->>'notes',''));
  end loop;
  return v_id;
end $$;

create or replace function public.lfo_set_tax_profile(p_user_id uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid := coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
begin
  insert into public.tax_profiles(id,user_id,residency_country,household_status,effective_from,jurisdiction,marital_status,dependants,tax_shares,withholding_settings,social_contribution_regime,professional_status,special_regime,effective_to,source,confidence,notes)
  values(v_id,p_user_id,upper(p_payload->>'residency_country'),p_payload->>'household_status',(p_payload->>'effective_from')::date,nullif(p_payload->>'jurisdiction',''),nullif(p_payload->>'marital_status',''),nullif(p_payload->>'dependants','')::integer,nullif(p_payload->>'tax_shares','')::numeric,coalesce(p_payload->'withholding_settings','{}'::jsonb),nullif(p_payload->>'social_contribution_regime',''),nullif(p_payload->>'professional_status',''),nullif(p_payload->>'special_regime',''),nullif(p_payload->>'effective_to','')::date,nullif(p_payload->>'source',''),p_payload->>'confidence',nullif(p_payload->>'notes',''))
  on conflict(id) do update set residency_country=excluded.residency_country,household_status=excluded.household_status,effective_from=excluded.effective_from,jurisdiction=excluded.jurisdiction,marital_status=excluded.marital_status,dependants=excluded.dependants,tax_shares=excluded.tax_shares,withholding_settings=excluded.withholding_settings,social_contribution_regime=excluded.social_contribution_regime,professional_status=excluded.professional_status,special_regime=excluded.special_regime,effective_to=excluded.effective_to,source=excluded.source,confidence=excluded.confidence,notes=excluded.notes,updated_at=now()
  where tax_profiles.user_id=p_user_id;
  if not found then raise exception 'tax profile does not belong to user'; end if;
  return v_id;
end $$;

create or replace function public.lfo_record_tax_observation(p_user_id uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid; begin
  insert into public.tax_observations(user_id,observation_type,observed_date,tax_year,amount,currency,transaction_id,document_id,confidence,source,notes)
  values(p_user_id,p_payload->>'observation_type',(p_payload->>'observed_date')::date,(p_payload->>'tax_year')::integer,(p_payload->>'amount')::numeric,upper(p_payload->>'currency'),nullif(p_payload->>'transaction_id','')::uuid,nullif(p_payload->>'document_id','')::uuid,p_payload->>'confidence',nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')) returning id into v_id; return v_id;
end $$;

revoke all on function public.lfo_save_career_package(uuid,jsonb),public.lfo_record_career_event(uuid,jsonb),public.lfo_set_tax_profile(uuid,jsonb),public.lfo_save_tax_rule_set(uuid,jsonb),public.lfo_record_tax_observation(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.lfo_save_career_package(uuid,jsonb),public.lfo_record_career_event(uuid,jsonb),public.lfo_set_tax_profile(uuid,jsonb),public.lfo_save_tax_rule_set(uuid,jsonb),public.lfo_record_tax_observation(uuid,jsonb) to service_role;

comment on table public.income_sources is 'LEGACY net income declarations. Not Career truth; no gross, payroll or tax may be inferred from monthly_net.';
comment on table public.career_compensation_terms is 'Dated compensation facts. A salary change is a new effective term; null never means zero.';
comment on table public.tax_rule_sets is 'Versioned declared tax rule sets. No unsourced jurisdiction rule is created by LFO.';
comment on table public.tax_observations is 'Observed tax facts; transaction_id references cash already present and never creates a second flow.';
