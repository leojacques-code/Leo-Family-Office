-- Léo Family Office — Debt Contract Input
--
-- Le contrat et l'encours observé suivent désormais deux chemins distincts : modifier
-- les termes ne réécrit jamais le solde, tandis qu'une nouvelle observation conserve son
-- historique et met à jour l'ancre courante. Les collections d'un contrat sont remplacées
-- dans une unique transaction PostgreSQL par l'appel RPC.

alter table public.liabilities
  add column if not exists archived boolean not null default false;

create table if not exists public.liability_balance_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  liability_id uuid not null references public.liabilities(id) on delete cascade,
  observed_at date not null,
  balance numeric(20,6) not null check (balance >= 0),
  data_kind text not null default 'ACTUAL',
  confidence text not null default 'HIGH',
  source text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists liability_balance_observations_latest_idx
  on public.liability_balance_observations(liability_id, observed_at desc, created_at desc);

insert into public.liability_balance_observations (
  user_id, liability_id, observed_at, balance, data_kind, confidence, source
)
select l.user_id, l.id, date '2026-08-19', l.current_balance, 'ACTUAL', 'HIGH',
       'Encours antérieur à Debt Contract Input'
  from public.liabilities l
 where not exists (
   select 1
     from public.liability_balance_observations o
    where o.liability_id = l.id
 );

alter table public.liability_balance_observations enable row level security;
drop policy if exists owner_all on public.liability_balance_observations;
create policy owner_all on public.liability_balance_observations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.liability_balance_observations from anon;
grant select, insert, update, delete on table public.liability_balance_observations to authenticated;

create or replace function public.lfo_save_debt_contract(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_liability_id uuid;
  v_existing boolean;
  v_item jsonb;
begin
  v_liability_id := nullif(p_payload ->> 'liability_id', '')::uuid;
  v_existing := v_liability_id is not null;

  if v_existing then
    if not exists (
      select 1 from public.liabilities
       where id = v_liability_id and user_id = p_user_id and archived = false
    ) then
      raise exception 'Dette introuvable ou archivée';
    end if;

    update public.liabilities
       set lender = p_payload ->> 'lender',
           name = p_payload ->> 'name',
           principal = (p_payload ->> 'principal')::numeric,
           annual_rate = (p_payload ->> 'annual_rate')::numeric,
           monthly_payment = (p_payload ->> 'payment_amount')::numeric,
           payment_count = (p_payload ->> 'payment_count')::integer,
           first_payment_date = (p_payload ->> 'first_payment_date')::date,
           maturity_date = (p_payload ->> 'maturity_date')::date,
           rate_type = p_payload ->> 'rate_type',
           monthly_insurance = (p_payload ->> 'insurance_amount')::numeric,
           recurring_fees = (p_payload ->> 'recurring_fees')::numeric,
           payment_includes_insurance = (p_payload ->> 'payment_includes_insurance')::boolean,
           deferral_kind = coalesce(p_payload #>> '{deferral,kind}', 'NONE'),
           deferral_months = coalesce((p_payload #>> '{deferral,months}')::integer, 0),
           deferral_interest_treatment = coalesce(
             p_payload #>> '{deferral,interest_treatment}', 'UNKNOWN'
           ),
           amortisation_profile = p_payload ->> 'amortisation_profile',
           balloon_amount = (p_payload ->> 'balloon_amount')::numeric,
           payment_frequency = p_payload ->> 'payment_frequency',
           interest_convention = p_payload ->> 'interest_convention',
           facility_id = p_payload ->> 'facility_id',
           data_kind = 'USER_ASSUMPTION',
           confidence = 'HIGH',
           source = 'Saisie contrat',
           notes = p_payload ->> 'notes'
     where id = v_liability_id and user_id = p_user_id;
  else
    v_liability_id := gen_random_uuid();
    insert into public.liabilities (
      id, user_id, lender, name, principal, current_balance, annual_rate,
      monthly_payment, payment_count, first_payment_date, maturity_date, rate_type,
      monthly_insurance, recurring_fees, payment_includes_insurance,
      deferral_kind, deferral_months, deferral_interest_treatment,
      amortisation_profile, balloon_amount, payment_frequency, interest_convention,
      facility_id, data_kind, confidence, source, notes, archived
    ) values (
      v_liability_id, p_user_id, p_payload ->> 'lender', p_payload ->> 'name',
      (p_payload ->> 'principal')::numeric, (p_payload ->> 'initial_balance')::numeric,
      (p_payload ->> 'annual_rate')::numeric, (p_payload ->> 'payment_amount')::numeric,
      (p_payload ->> 'payment_count')::integer, (p_payload ->> 'first_payment_date')::date,
      (p_payload ->> 'maturity_date')::date, p_payload ->> 'rate_type',
      (p_payload ->> 'insurance_amount')::numeric,
      (p_payload ->> 'recurring_fees')::numeric,
      (p_payload ->> 'payment_includes_insurance')::boolean,
      coalesce(p_payload #>> '{deferral,kind}', 'NONE'),
      coalesce((p_payload #>> '{deferral,months}')::integer, 0),
      coalesce(p_payload #>> '{deferral,interest_treatment}', 'UNKNOWN'),
      p_payload ->> 'amortisation_profile', (p_payload ->> 'balloon_amount')::numeric,
      p_payload ->> 'payment_frequency', p_payload ->> 'interest_convention',
      p_payload ->> 'facility_id', 'USER_ASSUMPTION', 'HIGH', 'Saisie contrat',
      p_payload ->> 'notes', false
    );

    insert into public.liability_balance_observations (
      user_id, liability_id, observed_at, balance, data_kind, confidence, source
    ) values (
      p_user_id, v_liability_id, (p_payload ->> 'balance_date')::date,
      (p_payload ->> 'initial_balance')::numeric, 'ACTUAL', 'HIGH', 'Saisie encours initial'
    );
  end if;

  delete from public.loan_rate_changes
   where user_id = p_user_id and liability_id = v_liability_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'rate_schedule', '[]'))
  loop
    insert into public.loan_rate_changes (
      user_id, liability_id, effective_from, annual_rate, term_kind
    ) values (
      p_user_id, v_liability_id, (v_item ->> 'effective_from')::date,
      (v_item ->> 'annual_rate')::numeric, v_item ->> 'kind'
    );
  end loop;

  delete from public.loan_payment_changes
   where user_id = p_user_id and liability_id = v_liability_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'payment_schedule', '[]'))
  loop
    insert into public.loan_payment_changes (
      user_id, liability_id, effective_from, amount, term_kind
    ) values (
      p_user_id, v_liability_id, (v_item ->> 'effective_from')::date,
      (v_item ->> 'amount')::numeric, v_item ->> 'kind'
    );
  end loop;

  delete from public.loan_early_repayments
   where user_id = p_user_id and liability_id = v_liability_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'early_repayments', '[]'))
  loop
    insert into public.loan_early_repayments (
      id, user_id, liability_id, repayment_date, amount, penalty, outcome
    ) values (
      coalesce(nullif(v_item ->> 'id', '')::uuid, gen_random_uuid()), p_user_id,
      v_liability_id, (v_item ->> 'date')::date, (v_item ->> 'amount')::numeric,
      (v_item ->> 'penalty')::numeric, v_item ->> 'outcome'
    );
  end loop;

  delete from public.loan_charges
   where user_id = p_user_id and liability_id = v_liability_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'charges', '[]'))
  loop
    insert into public.loan_charges (
      id, user_id, liability_id, charge_date, amount, label, financed
    ) values (
      coalesce(nullif(v_item ->> 'id', '')::uuid, gen_random_uuid()), p_user_id,
      v_liability_id, (v_item ->> 'date')::date, (v_item ->> 'amount')::numeric,
      v_item ->> 'label', (v_item ->> 'financed')::boolean
    );
  end loop;

  delete from public.loan_schedules
   where user_id = p_user_id and liability_id = v_liability_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'provided_schedule', '[]'))
  loop
    insert into public.loan_schedules (
      user_id, liability_id, payment_number, due_date, opening_balance, payment,
      interest, principal, insurance, fees, closing_balance, data_kind
    ) values (
      p_user_id, v_liability_id, (v_item ->> 'payment_number')::integer,
      (v_item ->> 'due_date')::date, (v_item ->> 'opening_balance')::numeric,
      (v_item ->> 'payment')::numeric, (v_item ->> 'interest')::numeric,
      (v_item ->> 'principal')::numeric, (v_item ->> 'insurance')::numeric,
      (v_item ->> 'fees')::numeric, (v_item ->> 'closing_balance')::numeric, 'ACTUAL'
    );
  end loop;

  return v_liability_id;
end;
$$;

create or replace function public.lfo_record_debt_balance(
  p_user_id uuid,
  p_liability_id uuid,
  p_observed_at date,
  p_balance numeric,
  p_notes text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_observation_id uuid;
begin
  if p_balance < 0 then raise exception 'Encours négatif interdit'; end if;
  if not exists (
    select 1 from public.liabilities
     where id = p_liability_id and user_id = p_user_id and archived = false
  ) then
    raise exception 'Dette introuvable ou archivée';
  end if;

  insert into public.liability_balance_observations (
    user_id, liability_id, observed_at, balance, data_kind, confidence, source, notes
  ) values (
    p_user_id, p_liability_id, p_observed_at, p_balance,
    'ACTUAL', 'HIGH', 'Saisie encours observé', p_notes
  ) returning id into v_observation_id;

  update public.liabilities
     set current_balance = p_balance
   where id = p_liability_id and user_id = p_user_id;

  return v_observation_id;
end;
$$;

create or replace function public.lfo_archive_debt(
  p_user_id uuid,
  p_liability_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.liabilities
     where id = p_liability_id and user_id = p_user_id
       and archived = false and current_balance <= 0.01
  ) then
    raise exception 'Seule une dette éteinte peut être archivée';
  end if;
  update public.liabilities set archived = true
   where id = p_liability_id and user_id = p_user_id;
  return p_liability_id;
end;
$$;

revoke all on function public.lfo_save_debt_contract(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lfo_record_debt_balance(uuid, uuid, date, numeric, text)
  from public, anon, authenticated;
revoke all on function public.lfo_archive_debt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lfo_save_debt_contract(uuid, jsonb) to service_role;
grant execute on function public.lfo_record_debt_balance(uuid, uuid, date, numeric, text)
  to service_role;
grant execute on function public.lfo_archive_debt(uuid, uuid) to service_role;
