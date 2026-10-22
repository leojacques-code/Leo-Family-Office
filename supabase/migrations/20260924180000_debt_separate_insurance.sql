-- B17 : assurance emprunteur SÉPARÉE (document 04, étape D ; backlog : « assurés, quotités,
-- primes et calendrier indépendant sans doublon »).
--
--     ASSURANCE INCONNUE ≠ ASSURANCE NULLE        QUOTITÉ ≠ PART DU PASSIF
--     ASSURANCE INCLUSE ≠ ASSURANCE EN SUS          UN COÛT, UNE FOIS
--
--   * `liabilities.insurance_mode` porte le choix initial exigé par le document 04 pour
--     prétendre calculer un coût complet : INCLUDED (dans les paiements), SEPARATE (prélevée
--     à part), NONE (absence confirmée), UNKNOWN (inconnue : coût incomplet). NULL = contrat
--     antérieur à B17, lu avec ses anciennes colonnes ; une dette encours seul n'en a pas.
--   * Une assurance SÉPARÉE a son propre calendrier : `loan_insurance_policies` (assureur,
--     contrat), `loan_insurance_insured` (assurés et quotités) et `loan_insurance_periods`
--     (première et dernière date de débit, fréquence, prime par débit ; plusieurs périodes
--     pour les variations). Le Debt Engine produit les débits à leurs propres dates.
--   * Aucun doublon : une assurance séparée exclut la prime par échéance du prêt, et des
--     polices ne s'enregistrent qu'en mode SEPARATE. Une quotité n'entre dans aucun calcul
--     de passif : elle décrit une couverture, pas une dette.
--   * Les prélèvements d'une règle (taux sur capital initial ou restant dû, grille) ne sont
--     pas déduits d'une prime isolée : seules des primes DÉCLARÉES par période sont prises en
--     charge ; une règle s'enregistre par son échéancier (phase 3C).
--   * Les tables sont en LECTURE SEULE pour le client : `lfo_save_debt_contract`, étendue
--     depuis sa DERNIÈRE version (`20260924150000`), est la seule porte d'écriture.

alter table public.liabilities
  add column if not exists insurance_mode text;

alter table public.liabilities
  add constraint liabilities_insurance_mode_ck
  check (
    insurance_mode is null
    or (
      terms_status = 'CONTRACT'
      and insurance_mode in ('INCLUDED', 'SEPARATE', 'NONE', 'UNKNOWN')
    )
  ),
  -- Un coût, une fois : séparée, absente ou inconnue n'ont pas de prime par échéance ;
  -- incluse l'est DANS le paiement.
  add constraint liabilities_insurance_consistency_ck
  check (
    insurance_mode is null
    or (insurance_mode = 'INCLUDED' and payment_includes_insurance is true)
    or (
      insurance_mode in ('SEPARATE', 'NONE', 'UNKNOWN')
      and monthly_insurance is null
      and payment_includes_insurance is distinct from true
    )
  );

create table if not exists public.loan_insurance_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  liability_id uuid not null,
  insurer text,
  contract_reference text,
  created_at timestamptz not null default now(),
  constraint loan_insurance_policies_liability_fk
    foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) on delete cascade,
  constraint loan_insurance_policies_text_ck check (
    (insurer is null or char_length(insurer) <= 160)
    and (contract_reference is null or char_length(contract_reference) <= 160)
  )
);
create unique index if not exists loan_insurance_policies_id_user_uidx
  on public.loan_insurance_policies(id, user_id);
create index if not exists loan_insurance_policies_liability_idx
  on public.loan_insurance_policies(liability_id, user_id);

create table if not exists public.loan_insurance_insured (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_id uuid not null,
  insured_name text not null,
  -- Quotité de couverture, en fraction (1 = 100 %). Deux emprunteurs peuvent être couverts
  -- chacun à 100 % : aucune somme n'est contrainte, et rien n'en dérive au passif.
  coverage_share numeric(7,6) not null,
  constraint loan_insurance_insured_policy_fk
    foreign key (policy_id, user_id)
    references public.loan_insurance_policies(id, user_id) on delete cascade,
  constraint loan_insurance_insured_name_ck
    check (insured_name ~ '\S' and char_length(insured_name) <= 160),
  constraint loan_insurance_insured_share_ck check (coverage_share > 0 and coverage_share <= 1)
);
create index if not exists loan_insurance_insured_policy_idx
  on public.loan_insurance_insured(policy_id, user_id);

create table if not exists public.loan_insurance_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_id uuid not null,
  first_debit_date date not null,
  -- NULL : jusqu'à la dernière échéance du prêt, choix DÉCLARÉ dans le formulaire.
  last_debit_date date,
  frequency text not null,
  premium_amount numeric(20,6) not null,
  constraint loan_insurance_periods_policy_fk
    foreign key (policy_id, user_id)
    references public.loan_insurance_policies(id, user_id) on delete cascade,
  constraint loan_insurance_periods_frequency_ck
    check (frequency in ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL')),
  constraint loan_insurance_periods_amount_ck check (premium_amount >= 0),
  constraint loan_insurance_periods_dates_ck
    check (last_debit_date is null or last_debit_date >= first_debit_date)
);
create index if not exists loan_insurance_periods_policy_idx
  on public.loan_insurance_periods(policy_id, user_id);

do $$
declare v_table text;
begin
  foreach v_table in array array['loan_insurance_policies', 'loan_insurance_insured', 'loan_insurance_periods']
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('drop policy if exists owner_all on public.%I', v_table);
    execute format(
      'create policy owner_all on public.%I for all to authenticated '
      'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      v_table
    );
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
  end loop;
end $$;

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
  v_mode text;
  v_policy jsonb;
  v_policy_id uuid;
  v_person jsonb;
  v_period jsonb;
begin
  v_liability_id := nullif(p_payload ->> 'liability_id', '')::uuid;
  v_existing := v_liability_id is not null;

  -- B17 : choix d'assurance DÉCLARÉ (document 04, étape D). Clé absente = contrat antérieur
  -- à B17, lu comme tel ; toute autre forme qu'une des quatre valeurs est refusée.
  if p_payload ? 'insurance_mode' then
    if coalesce(jsonb_typeof(p_payload -> 'insurance_mode'), 'absent') <> 'string'
       or (p_payload ->> 'insurance_mode') not in ('INCLUDED', 'SEPARATE', 'NONE', 'UNKNOWN') then
      raise exception 'Choix d''assurance invalide';
    end if;
    v_mode := p_payload ->> 'insurance_mode';
  end if;
  if p_payload ? 'insurance_policies'
     and coalesce(jsonb_typeof(p_payload -> 'insurance_policies'), 'absent') <> 'array' then
    raise exception 'Polices d''assurance attendues en liste';
  end if;
  if v_mode = 'SEPARATE' and jsonb_array_length(coalesce(p_payload -> 'insurance_policies', '[]'::jsonb)) = 0 then
    raise exception 'Une assurance séparée exige au moins une police';
  end if;
  if coalesce(v_mode, '') <> 'SEPARATE'
     and jsonb_array_length(coalesce(p_payload -> 'insurance_policies', '[]'::jsonb)) > 0 then
    raise exception 'Des polices séparées ne se déclarent qu''avec une assurance séparée';
  end if;

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
           insurance_mode = v_mode,
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
      facility_id, data_kind, confidence, source, notes, archived, insurance_mode
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
      p_payload ->> 'notes', false, v_mode
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

  -- Polices : remplacées en bloc comme les autres listes du contrat (B18 versionnera).
  delete from public.loan_insurance_policies
   where user_id = p_user_id and liability_id = v_liability_id;
  for v_policy in select value from jsonb_array_elements(coalesce(p_payload -> 'insurance_policies', '[]'))
  loop
    insert into public.loan_insurance_policies (
      user_id, liability_id, insurer, contract_reference
    ) values (
      p_user_id, v_liability_id,
      nullif(btrim(v_policy ->> 'insurer'), ''), nullif(btrim(v_policy ->> 'contract_reference'), '')
    ) returning id into v_policy_id;
    if jsonb_array_length(coalesce(v_policy -> 'periods', '[]'::jsonb)) = 0 then
      raise exception 'Une police d''assurance exige au moins une période de prime';
    end if;
    for v_person in select value from jsonb_array_elements(coalesce(v_policy -> 'insured', '[]'))
    loop
      insert into public.loan_insurance_insured (user_id, policy_id, insured_name, coverage_share)
      values (
        p_user_id, v_policy_id, btrim(v_person ->> 'name'),
        (v_person ->> 'coverage_share')::numeric
      );
    end loop;
    for v_period in select value from jsonb_array_elements(v_policy -> 'periods')
    loop
      insert into public.loan_insurance_periods (
        user_id, policy_id, first_debit_date, last_debit_date, frequency, premium_amount
      ) values (
        p_user_id, v_policy_id, (v_period ->> 'first_debit_date')::date,
        nullif(v_period ->> 'last_debit_date', '')::date, v_period ->> 'frequency',
        (v_period ->> 'premium_amount')::numeric
      );
    end loop;
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
