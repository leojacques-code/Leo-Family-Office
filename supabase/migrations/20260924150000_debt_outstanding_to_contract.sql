-- B16 : passage d'une dette connue par son SEUL encours à un contrat, sans second passif.
--
--     ENCOURS OBSERVÉ ≠ CONTRAT        DÉCISION ≠ EFFET DE BORD D'UNE ÉDITION
--
-- `20260924081000` a introduit `terms_status = 'OUTSTANDING_ONLY'` et refusé, par contrainte,
-- qu'une édition de contrat remplisse les termes d'une telle ligne sans changer son statut.
-- Cette migration ouvre le passage DÉCIDÉ :
--
--   * la même ligne `liabilities` passe à `CONTRACT` : aucune seconde dette, donc aucun double
--     comptage au passif ;
--   * l'encours courant et l'historique `liability_balance_observations` restent intacts :
--     l'observé reste l'observé, le contrat décrit l'attendu, et le Debt Engine les confronte
--     (réconciliation) sans jamais recalculer l'un pour coller à l'autre ;
--   * la promotion exige la clé `promote_outstanding: true` ; une édition ordinaire d'une ligne
--     encours seul reste refusée bruyamment, et la clé est refusée sur une dette déjà
--     contractuelle comme à la création ;
--   * la décision laisse une trace immuable (`liability_terms_transitions`) : acteur vérifié =
--     propriétaire, rôle constaté, date. Le statut antérieur n'est donc jamais perdu.
--
-- `lfo_save_debt_contract` est ÉTENDUE et non doublée : une seconde porte d'écriture sur
-- `liabilities` serait une seconde vérité. Base : sa SEULE et dernière version,
-- `20260824230233_debt_contract_input.sql` (définition vérifiée identique en base locale).

create table if not exists public.liability_terms_transitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  liability_id uuid not null,
  actor_user_id uuid not null,
  executed_by text not null default current_user,
  from_status text not null,
  to_status text not null,
  decided_at timestamptz not null default now(),
  constraint liability_terms_transitions_owner_fk
    foreign key (user_id) references auth.users(id) on delete restrict,
  constraint liability_terms_transitions_actor_fk
    foreign key (actor_user_id) references auth.users(id) on delete restrict,
  constraint liability_terms_transitions_liability_fk
    foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) on delete restrict,
  constraint liability_terms_transitions_actor_is_owner_ck check (actor_user_id = user_id),
  constraint liability_terms_transitions_direction_ck
    check (from_status = 'OUTSTANDING_ONLY' and to_status = 'CONTRACT')
);

comment on table public.liability_terms_transitions is
  'Piste IMMUABLE des passages d''une dette encours seul à un contrat : acteur vérifié, rôle constaté, date. Ni modifiable, ni supprimable.';

create index if not exists liability_terms_transitions_liability_idx
  on public.liability_terms_transitions(liability_id, user_id);
create index if not exists liability_terms_transitions_actor_idx
  on public.liability_terms_transitions(actor_user_id);

create or replace function public.liability_terms_transition_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'La piste des passages au contrat est immuable';
end;
$$;

drop trigger if exists liability_terms_transitions_immutable on public.liability_terms_transitions;
create trigger liability_terms_transitions_immutable
  before update or delete on public.liability_terms_transitions
  for each row execute function public.liability_terms_transition_immutable();

alter table public.liability_terms_transitions enable row level security;
drop policy if exists owner_all on public.liability_terms_transitions;
create policy owner_all on public.liability_terms_transitions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on table public.liability_terms_transitions from anon, authenticated;
grant select on table public.liability_terms_transitions to authenticated;
revoke all on function public.liability_terms_transition_immutable() from public, anon, authenticated;

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
  v_terms_status text;
  v_promote boolean := false;
begin
  v_liability_id := nullif(p_payload ->> 'liability_id', '')::uuid;
  v_existing := v_liability_id is not null;

  -- B16 : `promote_outstanding` est une DÉCISION, pas un effet de bord d'une édition. Seul
  -- le booléen JSON `true` est lu comme tel ; toute autre forme est refusée (CLÉ ABSENTE ≠
  -- JSON NULL ≠ CHAÎNE « true »).
  if p_payload ? 'promote_outstanding' then
    -- Deux gardes : PostgreSQL ne garantit pas le court-circuit d'un OR avant un cast.
    if jsonb_typeof(p_payload -> 'promote_outstanding') <> 'boolean' then
      raise exception 'promote_outstanding accepte seulement true';
    end if;
    if (p_payload ->> 'promote_outstanding')::boolean is distinct from true then
      raise exception 'promote_outstanding accepte seulement true';
    end if;
    if not v_existing then
      raise exception 'Seule une dette existante connue par son seul encours se décrit par promotion';
    end if;
  end if;

  if v_existing then
    -- Verrou AVANT la lecture du statut : deux décisions concurrentes se sérialisent ici.
    select terms_status into v_terms_status
      from public.liabilities
     where id = v_liability_id and user_id = p_user_id and archived = false
     for update;
    if not found then
      raise exception 'Dette introuvable ou archivée';
    end if;
    if v_terms_status = 'OUTSTANDING_ONLY' then
      if not (p_payload ? 'promote_outstanding') then
        raise exception 'Dette connue par son seul encours : décrire son contrat est une décision explicite (promote_outstanding)';
      end if;
      v_promote := true;
    elsif p_payload ? 'promote_outstanding' then
      raise exception 'Cette dette a déjà un contrat : rien à promouvoir';
    end if;

    -- La ligne est la MÊME : aucun second passif. L'encours courant et l'historique des
    -- observations ne sont pas touchés ; seuls les termes sont décrits.
    update public.liabilities
       set terms_status = 'CONTRACT',
           lender = p_payload ->> 'lender',
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

  if v_promote then
    insert into public.liability_terms_transitions (
      user_id, liability_id, actor_user_id, from_status, to_status
    ) values (
      p_user_id, v_liability_id, p_user_id, 'OUTSTANDING_ONLY', 'CONTRACT'
    );
  end if;

  return v_liability_id;
end;
$$;

revoke all on function public.lfo_save_debt_contract(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_save_debt_contract(uuid, jsonb) to service_role;
