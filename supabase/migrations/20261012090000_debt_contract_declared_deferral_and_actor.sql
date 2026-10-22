-- Lot A du 12 octobre 2026 : deux déclarations du contrat de dette cessent d'être supposées.
--
-- 1. Différé. Depuis `20260824230233`, `lfo_save_debt_contract` écrivait
--    `coalesce(p_payload #>> '{deferral,kind}', 'NONE')` et `coalesce(... months, 0)` : une
--    clé `deferral` ABSENTE, ou un différé dont la nature ou la durée manquait, devenait
--    « aucun différé » ou « zéro mois », contre CLAUDE.md §3 (CLÉ ABSENTE ≠ JSON NULL ≠ ZÉRO)
--    et TERME INCONNU ≠ TERME À ZÉRO. Le JSON `null` reste la déclaration explicite « aucun
--    différé », que le client envoie déjà (`supabase-repository.ts`, `deferral: … : null`) ;
--    la clé absente et l'objet incomplet sont désormais REFUSÉS (LF422). Tous les appelants
--    du dépôt envoient la clé : aucun chemin existant ne change de comportement.
--
-- 2. Acteur. La RPC n'avait pas de liste de clés refusées : `actor_user_id`, `decided_by` ou
--    `executed_by` étaient ignorés pour l'écriture, mais recopiés dans `terms` de la version
--    immuable (`p_payload - 'change_reason'`). Ils sont refusés, comme dans
--    `20260905090000_portfolio_correction_actor_and_expected`.
--
-- Reprise de la DERNIÈRE définition (`20260925140000_debt_review_versions_and_guards`),
-- vérifiée comme unique version postérieure aux six précédentes ; seuls les deux blocs
-- ci-dessus et les trois affectations de différé changent. Aucune donnée n'est modifiée :
-- les lignes existantes gardent leurs valeurs. Migration additive, jamais appliquée à une
-- base hébergée par un agent.

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
  v_current_mode text;
  v_change_kind text;
  v_deferral jsonb;
  v_deferral_key text;
  v_deferral_kind text;
  v_deferral_months integer;
  v_deferral_treatment text;
begin
  -- Lot A, 12 octobre 2026. L'ACTEUR NE SE DÉCLARE PAS : il est l'identité établie par le
  -- serveur (`p_user_id`). Une clé d'acteur dans la charge est REFUSÉE et non ignorée, sans
  -- quoi elle serait recopiée telle quelle dans la version immuable des termes.
  if p_payload ? 'actor_user_id' or p_payload ? 'decided_by' or p_payload ? 'executed_by' then
    raise exception 'Contrat de dette : l''acteur ne se déclare pas ; `actor_user_id`, `decided_by` et `executed_by` sont refusés dans la charge'
      using errcode = 'LF422';
  end if;

  -- Lot A, 12 octobre 2026. Le différé se DÉCLARE. CLÉ ABSENTE ≠ JSON NULL : le JSON `null`
  -- dit « aucun différé », une clé absente est un oubli et il est refusé au lieu d'être lu
  -- comme une absence de différé. Un différé déclaré est complet ou refusé : aucune durée,
  -- nature ou traitement des intérêts n'est supposé.
  if not (p_payload ? 'deferral') then
    raise exception 'Différé non déclaré : null pour « aucun différé », sinon nature, durée et traitement des intérêts'
      using errcode = 'LF422';
  end if;
  v_deferral := p_payload -> 'deferral';
  if jsonb_typeof(v_deferral) = 'null' then
    v_deferral_kind := 'NONE';
    v_deferral_months := 0;
    -- Valeur portée par les contrats sans différé depuis `202608240003` : sans différé, le
    -- traitement des intérêts différés est sans objet, la colonne n'est pas lue.
    v_deferral_treatment := 'UNKNOWN';
  elsif jsonb_typeof(v_deferral) <> 'object' then
    raise exception 'Différé attendu en objet ou null' using errcode = 'LF422';
  else
    for v_deferral_key in select jsonb_object_keys(v_deferral) loop
      if v_deferral_key not in ('kind', 'months', 'interest_treatment') then
        raise exception 'Différé : clé inconnue %', v_deferral_key using errcode = 'LF422';
      end if;
    end loop;
    if coalesce(jsonb_typeof(v_deferral -> 'kind'), 'absent') <> 'string'
       or (v_deferral ->> 'kind') not in ('PRINCIPAL_ONLY', 'TOTAL') then
      raise exception 'Différé : nature PRINCIPAL_ONLY ou TOTAL attendue (null pour « aucun »)'
        using errcode = 'LF422';
    end if;
    -- Deux gardes : PostgreSQL ne garantit pas le court-circuit d'un OR avant un cast.
    if coalesce(jsonb_typeof(v_deferral -> 'months'), 'absent') <> 'number'
       or (v_deferral ->> 'months') !~ '^[1-9][0-9]{0,3}$' then
      raise exception 'Différé : durée en nombre entier positif d''échéances attendue'
        using errcode = 'LF422';
    end if;
    if coalesce(jsonb_typeof(v_deferral -> 'interest_treatment'), 'absent') <> 'string'
       or (v_deferral ->> 'interest_treatment') not in ('PAID', 'CAPITALISED', 'UNKNOWN') then
      raise exception 'Différé : traitement des intérêts PAID, CAPITALISED ou UNKNOWN attendu'
        using errcode = 'LF422';
    end if;
    v_deferral_kind := v_deferral ->> 'kind';
    v_deferral_months := (v_deferral ->> 'months')::integer;
    v_deferral_treatment := v_deferral ->> 'interest_treatment';
  end if;

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
    select terms_status, insurance_mode into v_terms_status, v_current_mode
      from public.liabilities
     where id = v_liability_id and user_id = p_user_id and archived = false
     for update;
    if not found then
      raise exception 'Dette introuvable ou archivée';
    end if;
    -- Une dette dont le choix d'assurance est DÉCLARÉ ne redevient pas « antérieure à B17 »
    -- par l'oubli d'une clé : CLÉ ABSENTE ≠ DÉCLARATION RETIRÉE.
    if v_current_mode is not null and not (p_payload ? 'insurance_mode') then
      raise exception 'Choix d''assurance absent : cette dette en a déjà un, il se modifie, il ne s''efface pas';
    end if;
    if v_terms_status = 'OUTSTANDING_ONLY' then
      if not (p_payload ? 'promote_outstanding') then
        raise exception 'Dette connue par son seul encours : décrire son contrat est une décision explicite (promote_outstanding)';
      end if;
      v_promote := true;
    elsif p_payload ? 'promote_outstanding' then
      raise exception 'Cette dette a déjà un contrat : rien à promouvoir';
    end if;

    -- Contrat enregistré AVANT le versionnement (antérieur à `20260925130000`) : sans
    -- version, sa première correction effacerait les termes en vigueur sans trace. Ils
    -- sont donc figés tels que la base les porte, AVANT toute modification, dans une
    -- version de référence. Ce n'est pas l'état de création (inconnu) : c'est l'état
    -- constaté au moment de la première correction, et la version le dit.
    if v_terms_status = 'CONTRACT' and not exists (
      select 1 from public.liability_contract_versions
       where liability_id = v_liability_id and user_id = p_user_id
    ) then
      insert into public.liability_contract_versions (
        user_id, liability_id, version_no, change_kind, change_reason, terms, actor_user_id
      ) values (
        p_user_id, v_liability_id, 1, 'BASELINE',
        'Termes en vigueur avant le versionnement, figés à la première correction',
        jsonb_build_object(
          'shape', 'DATABASE_ROWS',
          'liability', (
            select to_jsonb(l) - 'user_id' from public.liabilities l
             where l.id = v_liability_id and l.user_id = p_user_id
          ),
          'rate_schedule', coalesce((
            select jsonb_agg(to_jsonb(r) - 'user_id' order by r.effective_from)
              from public.loan_rate_changes r
             where r.liability_id = v_liability_id and r.user_id = p_user_id
          ), '[]'::jsonb),
          'payment_schedule', coalesce((
            select jsonb_agg(to_jsonb(r) - 'user_id' order by r.effective_from)
              from public.loan_payment_changes r
             where r.liability_id = v_liability_id and r.user_id = p_user_id
          ), '[]'::jsonb),
          'early_repayments', coalesce((
            select jsonb_agg(to_jsonb(r) - 'user_id' order by r.repayment_date)
              from public.loan_early_repayments r
             where r.liability_id = v_liability_id and r.user_id = p_user_id
          ), '[]'::jsonb),
          'charges', coalesce((
            select jsonb_agg(to_jsonb(r) - 'user_id' order by r.charge_date)
              from public.loan_charges r
             where r.liability_id = v_liability_id and r.user_id = p_user_id
          ), '[]'::jsonb),
          'provided_schedule', coalesce((
            select jsonb_agg(to_jsonb(r) - 'user_id' order by r.payment_number)
              from public.loan_schedules r
             where r.liability_id = v_liability_id and r.user_id = p_user_id
          ), '[]'::jsonb),
          'insurance_policies', coalesce((
            select jsonb_agg(
                     (to_jsonb(p) - 'user_id')
                     || jsonb_build_object(
                          'insured', coalesce((
                            select jsonb_agg(to_jsonb(i) - 'user_id' order by i.insured_name)
                              from public.loan_insurance_insured i
                             where i.policy_id = p.id and i.user_id = p_user_id
                          ), '[]'::jsonb),
                          'periods', coalesce((
                            select jsonb_agg(to_jsonb(q) - 'user_id' order by q.first_debit_date)
                              from public.loan_insurance_periods q
                             where q.policy_id = p.id and q.user_id = p_user_id
                          ), '[]'::jsonb)
                        )
                     order by p.created_at
                   )
              from public.loan_insurance_policies p
             where p.liability_id = v_liability_id and p.user_id = p_user_id
          ), '[]'::jsonb)
        ),
        p_user_id
      );
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
           deferral_kind = v_deferral_kind,
           deferral_months = v_deferral_months,
           deferral_interest_treatment = v_deferral_treatment,
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
      v_deferral_kind, v_deferral_months, v_deferral_treatment,
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
    -- Deux périodes d'une même police qui se recouvrent compteraient deux primes pour un
    -- même débit. Une période sans dernier débit court jusqu'à la fin du prêt.
    if exists (
      select 1
        from public.loan_insurance_periods a
        join public.loan_insurance_periods b
          on b.policy_id = a.policy_id and b.id <> a.id
       where a.policy_id = v_policy_id
         and a.first_debit_date <= b.first_debit_date
         and (a.last_debit_date is null or a.last_debit_date >= b.first_debit_date)
    ) then
      raise exception 'Périodes de prime qui se chevauchent dans une même police';
    end if;
  end loop;

  -- B18 : chaque enregistrement laisse une VERSION immuable des termes déclarés. Création,
  -- promotion et correction se distinguent ; un avenant daté est un événement, pas une
  -- correction (`lfo_record_debt_event`).
  v_change_kind := case
    when v_promote then 'PROMOTION'
    when not v_existing then 'INITIAL'
    else 'CORRECTION'
  end;
  if p_payload ? 'change_reason'
     and coalesce(jsonb_typeof(p_payload -> 'change_reason'), 'absent') not in ('string', 'null') then
    raise exception 'Motif de correction attendu en texte' using errcode = 'LF422';
  end if;
  insert into public.liability_contract_versions (
    user_id, liability_id, version_no, change_kind, change_reason, terms, actor_user_id
  ) values (
    p_user_id,
    v_liability_id,
    coalesce(
      (select max(version_no) from public.liability_contract_versions
        where liability_id = v_liability_id and user_id = p_user_id),
      0
    ) + 1,
    v_change_kind,
    nullif(btrim(coalesce(p_payload ->> 'change_reason', '')), ''),
    p_payload - 'change_reason',
    p_user_id
  );

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
