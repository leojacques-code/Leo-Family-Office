-- B18 : événements et avenants de dette VERSIONNÉS (document 04 §6 ; backlog : « remboursement,
-- taux, report et solde conservés dans l'historique »). Migration ADDITIVE.
--
--     ÉVÉNEMENT OBSERVÉ ≠ MODIFICATION CONTRACTUELLE ≠ SIMULATION
--     CORRECTION D'UNE SAISIE ≠ AVENANT              ANNULER ≠ EFFACER
--
--   * `liability_events` : journal IMMUABLE des événements de la vie d'un prêt. Chaque
--     événement porte sa date d'effet, sa source, sa nature et son contenu :
--       - RATE_CHANGE, PAYMENT_CHANGE, DEFERRAL, AMENDMENT : modifications CONTRACTUELLES
--         (révision notifiée, palier, report d'échéances, avenant) ;
--       - EARLY_REPAYMENT : OBSERVÉ (effectué, jamais daté après aujourd'hui) ou PRÉVU
--         (annoncé au prêteur, daté dans le futur) ;
--       - FULL_REPAYMENT : OBSERVÉ seulement ; il écrit l'encours nul constaté.
--     Une SIMULATION n'est jamais écrite ici : elle reste un aperçu de l'application ou un
--     scénario du Decision Lab.
--   * Un remboursement OBSERVÉ peut porter le capital restant dû indiqué par le prêteur : il
--     est alors écrit, dans la même transaction, comme observation ACTUAL à la date de
--     l'événement. Sans lui, aucun encours n'est calculé en base : l'application signale que
--     l'encours observé précède le remboursement.
--   * Annuler un événement saisi par erreur ajoute une ligne immuable à
--     `liability_event_cancellations` (motif obligatoire) ; l'événement reste lisible.
--   * `liability_contract_versions` : chaque enregistrement du contrat laisse une version
--     immuable des termes DÉCLARÉS (création, promotion, correction, avec motif).
--   * Pistes financières : `RESTRICT` vers la dette, aucune suppression ni modification, et
--     lecture seule pour le client. Aucune formule financière en SQL : la base contrôle la
--     forme ; le Debt Engine traduit les événements actifs en trajectoire.

create table if not exists public.liability_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  liability_id uuid not null,
  event_kind text not null,
  nature text not null,
  effective_date date not null,
  source text not null,
  payload jsonb not null,
  observation_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  constraint liability_events_liability_fk foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) on delete restrict,
  constraint liability_events_owner_actor_ck check (actor_user_id = user_id),
  constraint liability_events_kind_ck check (
    event_kind in ('RATE_CHANGE', 'PAYMENT_CHANGE', 'DEFERRAL', 'AMENDMENT', 'EARLY_REPAYMENT', 'FULL_REPAYMENT')
  ),
  constraint liability_events_nature_ck check (
    (event_kind in ('RATE_CHANGE', 'PAYMENT_CHANGE', 'DEFERRAL', 'AMENDMENT') and nature = 'CONTRACTUAL')
    or (event_kind = 'EARLY_REPAYMENT' and nature in ('OBSERVED', 'PLANNED'))
    or (event_kind = 'FULL_REPAYMENT' and nature = 'OBSERVED')
  ),
  constraint liability_events_source_ck check (char_length(btrim(source)) between 1 and 200),
  constraint liability_events_payload_ck check (
    jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192
  )
);
create unique index if not exists liability_events_id_user_uidx
  on public.liability_events(id, user_id);
create index if not exists liability_events_liability_idx
  on public.liability_events(liability_id, user_id, effective_date);
create index if not exists liability_events_actor_idx on public.liability_events(actor_user_id);

create table if not exists public.liability_event_cancellations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  event_id uuid not null,
  reason text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  cancelled_at timestamptz not null default now(),
  constraint liability_event_cancellations_event_fk foreign key (event_id, user_id)
    references public.liability_events(id, user_id) on delete restrict,
  constraint liability_event_cancellations_owner_actor_ck check (actor_user_id = user_id),
  constraint liability_event_cancellations_reason_ck check (char_length(btrim(reason)) between 1 and 500)
);
create unique index if not exists liability_event_cancellations_event_uidx
  on public.liability_event_cancellations(event_id);
create index if not exists liability_event_cancellations_actor_idx
  on public.liability_event_cancellations(actor_user_id);

create table if not exists public.liability_contract_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  liability_id uuid not null,
  version_no integer not null,
  change_kind text not null,
  change_reason text,
  terms jsonb not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  constraint liability_contract_versions_liability_fk foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) on delete restrict,
  constraint liability_contract_versions_owner_actor_ck check (actor_user_id = user_id),
  constraint liability_contract_versions_kind_ck check (
    change_kind in ('INITIAL', 'PROMOTION', 'CORRECTION')
  ),
  constraint liability_contract_versions_number_ck check (version_no >= 1),
  constraint liability_contract_versions_terms_ck check (jsonb_typeof(terms) = 'object'),
  constraint liability_contract_versions_reason_ck check (
    change_reason is null or char_length(change_reason) <= 500
  )
);
create unique index if not exists liability_contract_versions_number_uidx
  on public.liability_contract_versions(liability_id, version_no);
create index if not exists liability_contract_versions_owner_idx
  on public.liability_contract_versions(user_id, liability_id);
create index if not exists liability_contract_versions_actor_idx
  on public.liability_contract_versions(actor_user_id);

create or replace function public.lfo_debt_history_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'L''historique de la dette est immuable : une erreur s''annule, elle ne s''efface pas';
end;
$$;
revoke all on function public.lfo_debt_history_immutable() from public, anon, authenticated;

drop trigger if exists liability_events_immutable on public.liability_events;
create trigger liability_events_immutable
  before update or delete on public.liability_events
  for each row execute function public.lfo_debt_history_immutable();
drop trigger if exists liability_event_cancellations_immutable on public.liability_event_cancellations;
create trigger liability_event_cancellations_immutable
  before update or delete on public.liability_event_cancellations
  for each row execute function public.lfo_debt_history_immutable();
drop trigger if exists liability_contract_versions_immutable on public.liability_contract_versions;
create trigger liability_contract_versions_immutable
  before update or delete on public.liability_contract_versions
  for each row execute function public.lfo_debt_history_immutable();

do $$
declare v_table text;
begin
  foreach v_table in array array['liability_events', 'liability_event_cancellations', 'liability_contract_versions']
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

-- Montant en TEXTE décimal simple : aucun flottant, ni NaN, ni notation exponentielle.
create or replace function public.debt_event_amount(p_payload jsonb, p_key text, p_required boolean)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if not (p_payload ? p_key) or jsonb_typeof(p_payload -> p_key) = 'null' then
    if p_required then
      raise exception 'Montant requis : %', p_key using errcode = 'LF422';
    end if;
    return null;
  end if;
  if jsonb_typeof(p_payload -> p_key) <> 'string' then
    raise exception 'Montant attendu en texte : %', p_key using errcode = 'LF422';
  end if;
  v_text := p_payload ->> p_key;
  if v_text !~ '^[0-9]{1,14}(\.[0-9]{1,6})?$' then
    raise exception 'Montant invalide : %', p_key using errcode = 'LF422';
  end if;
  return v_text::numeric;
end;
$$;
-- Aide interne, hors du contrat `lfo_*` : appelée par la RPC sous `service_role` seulement.
revoke all on function public.debt_event_amount(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.debt_event_amount(jsonb, text, boolean) to service_role;

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
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Événement invalide' using errcode = 'LF422';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('liability_id', 'event_kind', 'nature', 'effective_date', 'source', 'content') then
      raise exception 'Clé refusée : %', v_key using errcode = 'LF422';
    end if;
  end loop;
  v_liability_id := (p_payload ->> 'liability_id')::uuid;
  v_kind := p_payload ->> 'event_kind';
  v_nature := p_payload ->> 'nature';
  v_date := (p_payload ->> 'effective_date')::date;
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
    if coalesce(jsonb_typeof(v_content -> 'maturity_date'), 'absent') <> 'string'
       or (v_content ->> 'maturity_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (v_content ->> 'maturity_date')::date <= v_date then
      raise exception 'Nouvelle dernière échéance invalide : une date postérieure à l''effet' using errcode = 'LF422';
    end if;
  end if;
  if v_kind = 'AMENDMENT' and v_rate is null and v_payment is null
     and not (v_content ? 'maturity_date') then
    raise exception 'Un avenant change au moins le taux, la mensualité ou la durée' using errcode = 'LF422';
  end if;
  if v_kind = 'DEFERRAL' then
    if coalesce(jsonb_typeof(v_content -> 'months'), 'absent') <> 'number'
       or (v_content ->> 'months')::numeric <> trunc((v_content ->> 'months')::numeric)
       or (v_content ->> 'months')::integer not between 1 and 120 then
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

create or replace function public.lfo_cancel_debt_event(
  p_user_id uuid,
  p_event_id uuid,
  p_reason text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_liability_id uuid;
  v_id uuid;
begin
  select liability_id into v_liability_id
    from public.liability_events
   where id = p_event_id and user_id = p_user_id;
  if not found then
    raise exception 'Événement introuvable' using errcode = 'LF404';
  end if;
  -- Même verrou que l'enregistrement : annulation et ajout se sérialisent par dette.
  perform 1 from public.liabilities
   where id = v_liability_id and user_id = p_user_id
   for update;
  if exists (select 1 from public.liability_event_cancellations where event_id = p_event_id) then
    raise exception 'Événement déjà annulé' using errcode = 'LF409';
  end if;
  insert into public.liability_event_cancellations (user_id, event_id, reason, actor_user_id)
  values (p_user_id, p_event_id, btrim(coalesce(p_reason, '')), p_user_id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.lfo_record_debt_event(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_record_debt_event(uuid, jsonb) to service_role;
revoke all on function public.lfo_cancel_debt_event(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.lfo_cancel_debt_event(uuid, uuid, text) to service_role;

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

revoke all on function public.lfo_save_debt_contract(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_save_debt_contract(uuid, jsonb) to service_role;
