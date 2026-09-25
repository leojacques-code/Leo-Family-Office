-- Relecture indépendante de B18 (25 septembre 2026). Migration ADDITIVE : la migration
-- `20260925130000_debt_events` n'est pas réécrite, ses deux RPC sont remplacées ici depuis
-- LEUR DERNIÈRE VERSION (celle de `20260925130000`), avec deux corrections seulement.
--
--     ÉTAT CONSTATÉ ≠ ÉTAT DE CRÉATION         FORME INVALIDE ≠ ERREUR DE CONVERSION
--
--   1. Un contrat enregistré avant le versionnement n'a aucune version : sa première
--      correction remplaçait ses termes sans en garder l'état antérieur. Ces termes sont
--      désormais figés, AVANT la modification, dans une version de nature `BASELINE`
--      (« termes en vigueur avant le versionnement »). Elle n'est PAS appelée « création » :
--      l'état de création n'est pas connu, et le prétendre inventerait une histoire. Sa
--      forme est celle des lignes de la base (`shape = DATABASE_ROWS`), distincte de la
--      charge d'enregistrement des autres versions, et le dit.
--   2. `lfo_record_debt_event` : les gardes de forme qui enchaînaient un contrôle de type et
--      une conversion dans un même OR sont séparées. PostgreSQL ne garantit pas le
--      court-circuit d'un OR : une durée de report `1e12`, une date `2026-13-45` ou un
--      identifiant mal formé répondaient une erreur de conversion brute au lieu de `LF422`.
--      Rien n'était écrit, mais le refus n'était pas nommé.
--
-- Contrainte de nature : `liability_contract_versions_kind_ck` (définie par
-- `20260925130000`, lue en base avant extension) est remplacée par son successeur
-- `liability_contract_versions_kind_v2_ck`, qui ajoute `BASELINE`.

alter table public.liability_contract_versions
  drop constraint if exists liability_contract_versions_kind_ck;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'liability_contract_versions_kind_v2_ck'
       and conrelid = 'public.liability_contract_versions'::regclass
  ) then
    alter table public.liability_contract_versions
      add constraint liability_contract_versions_kind_v2_ck check (
        change_kind in ('BASELINE', 'INITIAL', 'PROMOTION', 'CORRECTION')
      );
  end if;
end;
$$;

create or replace function public.lfo_record_debt_event(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_liability_id uuid;
  v_terms_status text;
  v_kind text;
  v_nature text;
  v_date date;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_content jsonb;
  v_allowed text[];
  v_balance_after numeric;
  v_amount numeric;
  v_rate numeric;
  v_payment numeric;
  v_observation_id uuid;
  v_event_id uuid;
  v_maturity date;
  v_months numeric;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Événement invalide' using errcode = 'LF422';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('liability_id', 'event_kind', 'nature', 'effective_date', 'source', 'content') then
      raise exception 'Clé refusée : %', v_key using errcode = 'LF422';
    end if;
  end loop;
  -- Chaque conversion est gardée : une forme invalide répond `LF422`, jamais une erreur
  -- de conversion brute (PostgreSQL ne garantit pas le court-circuit d'un OR avant un cast).
  begin
    v_liability_id := (p_payload ->> 'liability_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'Identifiant de dette invalide' using errcode = 'LF422';
  end;
  v_kind := p_payload ->> 'event_kind';
  v_nature := p_payload ->> 'nature';
  if coalesce(jsonb_typeof(p_payload -> 'effective_date'), 'absent') <> 'string'
     then
    raise exception 'Date d''effet requise' using errcode = 'LF422';
  end if;
  if (p_payload ->> 'effective_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Date d''effet invalide' using errcode = 'LF422';
  end if;
  begin
    v_date := (p_payload ->> 'effective_date')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'Date d''effet inexistante au calendrier' using errcode = 'LF422';
  end;
  v_content := p_payload -> 'content';
  if v_date is null then
    raise exception 'Date d''effet requise' using errcode = 'LF422';
  end if;
  if coalesce(jsonb_typeof(v_content), 'absent') <> 'object' then
    raise exception 'Contenu d''événement attendu en objet' using errcode = 'LF422';
  end if;

  -- Contenu fermé par nature d'événement : aucune clé d'acteur, aucune valeur calculée.
  v_allowed := case v_kind
    when 'RATE_CHANGE' then array['annual_rate']
    when 'PAYMENT_CHANGE' then array['payment_amount']
    when 'DEFERRAL' then array['months', 'deferral_kind', 'interest_treatment', 'term_effect']
    when 'AMENDMENT' then array['annual_rate', 'payment_amount', 'maturity_date', 'note']
    when 'EARLY_REPAYMENT' then array['amount', 'penalty', 'outcome', 'balance_after']
    when 'FULL_REPAYMENT' then array['amount', 'penalty']
    else null
  end;
  if v_allowed is null then
    raise exception 'Nature d''événement inconnue' using errcode = 'LF422';
  end if;
  for v_key in select jsonb_object_keys(v_content) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'Clé de contenu refusée : %', v_key using errcode = 'LF422';
    end if;
  end loop;

  if v_nature = 'OBSERVED' and v_date > v_today then
    raise exception using
      errcode = 'LF425',
      message = 'Date d''observation future : un fait observé ne peut pas être daté après aujourd''hui';
  end if;
  if v_nature = 'PLANNED' and v_date <= v_today then
    raise exception 'Un remboursement prévu est daté après aujourd''hui ; effectué, il est observé' using errcode = 'LF422';
  end if;

  -- Contrôles de FORME du contenu ; aucune conséquence financière n'est calculée ici.
  if v_kind in ('RATE_CHANGE', 'AMENDMENT') then
    v_rate := public.debt_event_amount(v_content, 'annual_rate', v_kind = 'RATE_CHANGE');
    if v_rate is not null and v_rate > 10 then
      raise exception 'Taux hors bornes' using errcode = 'LF422';
    end if;
  end if;
  if v_kind in ('PAYMENT_CHANGE', 'AMENDMENT') then
    v_payment := public.debt_event_amount(v_content, 'payment_amount', v_kind = 'PAYMENT_CHANGE');
  end if;
  if v_kind = 'AMENDMENT' and v_content ? 'maturity_date' then
    if coalesce(jsonb_typeof(v_content -> 'maturity_date'), 'absent') <> 'string' then
      raise exception 'Nouvelle dernière échéance invalide : une date postérieure à l''effet' using errcode = 'LF422';
    end if;
    if (v_content ->> 'maturity_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Nouvelle dernière échéance invalide : une date postérieure à l''effet' using errcode = 'LF422';
    end if;
    begin
      v_maturity := (v_content ->> 'maturity_date')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'Nouvelle dernière échéance inexistante au calendrier' using errcode = 'LF422';
    end;
    if v_maturity <= v_date then
      raise exception 'Nouvelle dernière échéance invalide : une date postérieure à l''effet' using errcode = 'LF422';
    end if;
  end if;
  if v_kind = 'AMENDMENT' and v_rate is null and v_payment is null
     and not (v_content ? 'maturity_date') then
    raise exception 'Un avenant change au moins le taux, la mensualité ou la durée' using errcode = 'LF422';
  end if;
  if v_kind = 'DEFERRAL' then
    -- Trois gardes successives : le type, puis l'entier, puis les bornes, comparées en
    -- `numeric` AVANT toute conversion en entier (1e12 déborderait un `integer`).
    if coalesce(jsonb_typeof(v_content -> 'months'), 'absent') <> 'number' then
      raise exception 'Durée du report invalide' using errcode = 'LF422';
    end if;
    v_months := (v_content ->> 'months')::numeric;
    if v_months <> trunc(v_months) or v_months < 1 or v_months > 120 then
      raise exception 'Durée du report invalide' using errcode = 'LF422';
    end if;
    if coalesce(v_content ->> 'deferral_kind', '') not in ('PRINCIPAL_ONLY', 'TOTAL')
       or coalesce(v_content ->> 'interest_treatment', '') not in ('PAID', 'CAPITALISED', 'UNKNOWN')
       or coalesce(v_content ->> 'term_effect', '') not in ('EXTEND_TERM', 'RECALCULATE_PAYMENT', 'UNKNOWN') then
      raise exception 'Report : nature, intérêts et effet sur la durée à déclarer' using errcode = 'LF422';
    end if;
  end if;
  if v_kind in ('EARLY_REPAYMENT', 'FULL_REPAYMENT') then
    v_amount := public.debt_event_amount(v_content, 'amount', true);
    if v_amount <= 0 then
      raise exception 'Capital remboursé strictement positif' using errcode = 'LF422';
    end if;
    perform public.debt_event_amount(v_content, 'penalty', false);
  end if;
  if v_kind = 'EARLY_REPAYMENT' then
    if coalesce(v_content ->> 'outcome', '') not in ('SHORTEN_TERM', 'REDUCE_PAYMENT', 'UNKNOWN') then
      raise exception 'Convention du remboursement à déclarer' using errcode = 'LF422';
    end if;
    v_balance_after := public.debt_event_amount(v_content, 'balance_after', false);
    if v_balance_after is not null and v_nature <> 'OBSERVED' then
      raise exception 'Seul un remboursement effectué porte un encours constaté' using errcode = 'LF422';
    end if;
  end if;

  -- Verrou AVANT les contrôles d'état : deux événements concurrents se sérialisent ici.
  select terms_status into v_terms_status
    from public.liabilities
   where id = v_liability_id and user_id = p_user_id and archived = false
   for update;
  if not found then
    raise exception 'Dette introuvable ou archivée' using errcode = 'LF404';
  end if;
  if v_terms_status <> 'CONTRACT' then
    raise exception 'Une dette connue par son seul encours se met à jour par un nouvel encours' using errcode = 'LF422';
  end if;

  -- Encours CONSTATÉ après un remboursement effectué : observation ACTUAL atomique.
  if v_kind = 'FULL_REPAYMENT' or v_balance_after is not null then
    insert into public.liability_balance_observations (
      user_id, liability_id, observed_at, balance, data_kind, confidence, source
    ) values (
      p_user_id, v_liability_id, v_date,
      case when v_kind = 'FULL_REPAYMENT' then 0 else v_balance_after end,
      'ACTUAL', 'HIGH',
      case when v_kind = 'FULL_REPAYMENT' then 'Solde total du prêt' else 'Remboursement anticipé' end
    ) returning id into v_observation_id;
    -- L'encours courant suit l'observation constatée, sauf si une observation porte une
    -- date STRICTEMENT postérieure : un fait ancien ne remplace pas un fait plus récent.
    -- (HORODATAGE ≠ ORDRE : on compare des dates d'observation, pas des instants de saisie.)
    update public.liabilities
       set current_balance = case when v_kind = 'FULL_REPAYMENT' then 0 else v_balance_after end
     where id = v_liability_id and user_id = p_user_id
       and not exists (
         select 1 from public.liability_balance_observations
          where liability_id = v_liability_id and user_id = p_user_id and observed_at > v_date
       );
  end if;

  insert into public.liability_events (
    user_id, liability_id, event_kind, nature, effective_date, source, payload,
    observation_id, actor_user_id
  ) values (
    p_user_id, v_liability_id, v_kind, v_nature, v_date, btrim(p_payload ->> 'source'),
    v_content, v_observation_id, p_user_id
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;


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

revoke all on function public.lfo_record_debt_event(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_record_debt_event(uuid, jsonb) to service_role;
revoke all on function public.lfo_save_debt_contract(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_save_debt_contract(uuid, jsonb) to service_role;
