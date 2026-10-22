-- B17, complément : détails d'une police d'assurance SÉPARÉE demandés par le document 04,
-- étape D (« assureur, contrat, emprunteurs assurés, quotités, dates d'effet et de fin,
-- fréquence, montant fixe ou règle de calcul, base assurée, variations, échéancier propre et
-- compte débité si connu »). Migration ADDITIVE : `20260924180000` n'est pas réécrite.
--
--     DATE D'EFFET ≠ PREMIER DÉBIT        BASE ASSURÉE ≠ RÈGLE DE CALCUL
--     COMPTE DÉBITÉ ≠ RAPPROCHEMENT
--
--   * `effective_date` / `end_date` : période de COUVERTURE du contrat d'assurance. Elles ne
--     produisent aucun débit : le calendrier reste celui des périodes de prime déclarées.
--   * `insured_base` : sur quoi l'assureur dit calculer la prime (capital initial, capital
--     restant dû, autre). DESCRIPTIF SEULEMENT : aucune prime n'en est déduite, le document 04
--     interdisant de déduire un mécanisme d'une prime isolée. Une règle se saisit par son
--     échéancier (phase 3C, B20).
--   * `debit_account_id` : compte sur lequel la prime est prélevée, si connu. Il sert au
--     rapprochement « prévu / payé » de B21 ; il ne prouve aucun paiement. Un compte supprimé
--     ne supprime pas la police : la référence repasse à inconnu.
--   * Toutes ces colonnes sont NULL par défaut : inconnu, jamais une valeur supposée.
--   * `lfo_save_debt_contract` est reprise de sa DERNIÈRE version (`20260924180000`), avec
--     les seules nouvelles clés de police ; aucune autre ligne n'est modifiée.

alter table public.loan_insurance_policies
  add column if not exists effective_date date,
  add column if not exists end_date date,
  add column if not exists insured_base text,
  add column if not exists debit_account_id uuid;

alter table public.loan_insurance_policies
  add constraint loan_insurance_policies_coverage_dates_ck
    check (end_date is null or effective_date is null or end_date >= effective_date),
  add constraint loan_insurance_policies_insured_base_ck
    check (insured_base is null or insured_base in ('INITIAL_CAPITAL', 'OUTSTANDING_CAPITAL', 'OTHER')),
  add constraint loan_insurance_policies_debit_account_fk
    foreign key (debit_account_id, user_id)
    references public.financial_accounts(id, user_id) on delete set null (debit_account_id);

create index if not exists loan_insurance_policies_debit_account_idx
  on public.loan_insurance_policies(debit_account_id, user_id)
  where debit_account_id is not null;

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
    -- B17 complément : dates d'effet et de fin, base assurée et compte débité sont
    -- descriptifs et facultatifs. Clé absente ou JSON null = inconnu ; une chaîne vide n'est
    -- pas une date ni un compte, elle est refusée plutôt qu'aplatie en NULL.
    if (v_policy ? 'debit_account_id' and jsonb_typeof(v_policy -> 'debit_account_id') not in ('string', 'null'))
       or (v_policy ->> 'debit_account_id') = ''
       or (v_policy ->> 'effective_date') = ''
       or (v_policy ->> 'end_date') = ''
       or (v_policy ->> 'insured_base') = '' then
      raise exception 'Détail de police invalide : valeur vide';
    end if;
    insert into public.loan_insurance_policies (
      user_id, liability_id, insurer, contract_reference,
      effective_date, end_date, insured_base, debit_account_id
    ) values (
      p_user_id, v_liability_id,
      nullif(btrim(v_policy ->> 'insurer'), ''), nullif(btrim(v_policy ->> 'contract_reference'), ''),
      (v_policy ->> 'effective_date')::date, (v_policy ->> 'end_date')::date,
      v_policy ->> 'insured_base', (v_policy ->> 'debit_account_id')::uuid
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
