-- Correction NON DESTRUCTIVE d'un revenu net observé saisi à la main (B14).
--
--     DÉCISION ≠ CONSENTEMENT        ÉTAT ATTENDU ≠ ÉTAT COURANT
--     ANCIENNE VALEUR ≠ VALEUR REMPLACÉE
--
-- Même modèle que les corrections d'observation de position (`20260904093000`,
-- `20260905090000`) : la valeur canonique est corrigée EN PLACE, sous verrou, et la piste
-- immuable conserve le motif, l'avant, l'après, les champs modifiés, l'acteur VÉRIFIÉ et le
-- rôle PostgreSQL constaté. Aucune transaction de régularisation n'est fabriquée : une
-- saisie erronée n'est pas un flux économique, et une écriture compensatoire en ferait un.
--
-- Périmètre : les SEULS revenus saisis par `lfo_record_net_income` (source dédiée, nature
-- INCOME). Une opération importée se corrige par sa chaîne d'acquisition : corriger ici ce
-- que la source a écrit romprait sa provenance. Le compte, donc la devise, n'est pas
-- modifiable : changer de compte serait une autre observation.

create table if not exists public.transaction_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  transaction_id uuid not null,
  -- Acteur VÉRIFIÉ : établi côté serveur, jamais reçu du navigateur. Sans délégation dans le
  -- produit, il est le propriétaire : c'est ici qu'une délégation devra être décidée.
  actor_user_id uuid not null,
  executed_by text not null default current_user,
  reason text not null,
  before_values jsonb not null,
  after_values jsonb not null,
  changed_fields text[] not null,
  decided_at timestamptz not null default now(),
  -- RESTRICT partout : AUCUNE ANCIENNE VALEUR PERDUE, ni par la suppression de la
  -- transaction corrigée, ni par celle du propriétaire.
  constraint transaction_corrections_owner_fk
    foreign key (user_id) references auth.users(id) on delete restrict,
  constraint transaction_corrections_actor_fk
    foreign key (actor_user_id) references auth.users(id) on delete restrict,
  constraint transaction_corrections_transaction_fk
    foreign key (transaction_id, user_id)
    references public.transactions(id, user_id) on delete restrict,
  constraint transaction_corrections_actor_is_owner_ck check (actor_user_id = user_id),
  constraint transaction_corrections_reason_ck check (reason ~ '\S' and char_length(reason) <= 500),
  constraint transaction_corrections_before_ck check (jsonb_typeof(before_values) = 'object'),
  constraint transaction_corrections_after_ck check (jsonb_typeof(after_values) = 'object'),
  constraint transaction_corrections_changed_ck check (
    coalesce(array_length(changed_fields, 1), 0) >= 1
    and array_position(changed_fields, null) is null
    and changed_fields <@ array['amount', 'transaction_date', 'label']::text[]
  )
);

comment on table public.transaction_corrections is
  'Piste IMMUABLE des corrections de revenus nets saisis à la main : acteur vérifié, rôle constaté, motif, avant, après, champs modifiés. Ni modifiable, ni supprimable.';

create index if not exists transaction_corrections_transaction_idx
  on public.transaction_corrections(transaction_id, user_id, decided_at desc);
create index if not exists transaction_corrections_user_idx
  on public.transaction_corrections(user_id, decided_at desc);
create index if not exists transaction_corrections_actor_idx
  on public.transaction_corrections(actor_user_id);

-- La clé candidate (id, user_id) de `transactions` existe depuis `20260825193427`
-- (`transactions_id_user_uidx`) : la clé étrangère composite s'y appuie.

create or replace function public.transaction_correction_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'La piste des corrections de transaction est immuable';
end;
$$;

drop trigger if exists transaction_corrections_immutable on public.transaction_corrections;
create trigger transaction_corrections_immutable
  before update or delete on public.transaction_corrections
  for each row execute function public.transaction_correction_immutable();

-- Même convention que `position_snapshot_corrections` : la politique exprime la PROPRIÉTÉ des
-- lignes, c'est le privilège de table qui refuse la commande. `authenticated` ne reçoit que
-- SELECT ; toute écriture passe par la RPC, réservée à `service_role`.
alter table public.transaction_corrections enable row level security;
drop policy if exists owner_all on public.transaction_corrections;
create policy owner_all on public.transaction_corrections
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on table public.transaction_corrections from anon, authenticated;
grant select on table public.transaction_corrections to authenticated;

-- Correction d'un revenu net saisi.
--
-- Charge : transaction_id, reason, expected {amount, received_on, label}, corrected {…}.
-- `expected` porte les TROIS champs : l'état que l'appelant croit corriger se lit clé par
-- clé, et une clé absente est refusée (CLÉ ABSENTE ≠ JSON NULL). `corrected` porte au moins
-- un champ. Le verrou est pris AVANT la comparaison.
create or replace function public.lfo_correct_net_income(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
  v_reason text;
  v_expected jsonb;
  v_corrected jsonb;
  v_row public.transactions;
  v_new_amount numeric;
  v_new_date date;
  v_new_label text;
  v_changed text[] := array[]::text[];
  v_correction_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Charge de correction invalide';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('transaction_id', 'reason', 'expected', 'corrected') then
      raise exception 'Clé refusée : %', v_key;
    end if;
  end loop;
  if coalesce(jsonb_typeof(p_payload -> 'transaction_id'), 'absent') <> 'string'
     or (p_payload ->> 'transaction_id')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Revenu à corriger requis';
  end if;
  v_id := (p_payload ->> 'transaction_id')::uuid;
  if coalesce(jsonb_typeof(p_payload -> 'reason'), 'absent') <> 'string'
     or (p_payload ->> 'reason') !~ '\S' or char_length(p_payload ->> 'reason') > 500 then
    raise exception 'Motif de correction requis (500 caractères au plus)';
  end if;
  v_reason := btrim(p_payload ->> 'reason');

  v_expected := p_payload -> 'expected';
  v_corrected := p_payload -> 'corrected';
  if coalesce(jsonb_typeof(v_expected), 'absent') <> 'object'
     or coalesce(jsonb_typeof(v_corrected), 'absent') <> 'object' then
    raise exception 'État attendu et valeurs corrigées requis';
  end if;
  for v_key in select jsonb_object_keys(v_expected) loop
    if v_key not in ('amount', 'received_on', 'label') then
      raise exception 'Clé attendue refusée : %', v_key;
    end if;
  end loop;
  for v_key in select jsonb_object_keys(v_corrected) loop
    if v_key not in ('amount', 'received_on', 'label') then
      raise exception 'Clé corrigée refusée : %', v_key;
    end if;
  end loop;
  foreach v_key in array array['amount', 'received_on', 'label'] loop
    if coalesce(jsonb_typeof(v_expected -> v_key), 'absent') <> 'string' then
      raise exception 'État attendu incomplet : %', v_key;
    end if;
    if v_corrected ? v_key and jsonb_typeof(v_corrected -> v_key) <> 'string' then
      raise exception 'Valeur corrigée invalide : %', v_key;
    end if;
  end loop;
  if (v_expected ->> 'amount') !~ '^[0-9]{1,14}(\.[0-9]{1,6})?$'
     or (v_expected ->> 'received_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'État attendu mal formé';
  end if;

  -- Verrou AVANT comparaison : deux corrections concurrentes se sérialisent ici.
  select * into v_row
    from public.transactions
   where id = v_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'Revenu introuvable';
  end if;
  if v_row.source is distinct from 'Saisie revenu net observé'
     or v_row.kind_override is distinct from 'INCOME' then
    raise exception 'Seul un revenu net saisi à la main se corrige ici';
  end if;

  if v_row.amount <> (v_expected ->> 'amount')::numeric then
    raise exception 'Conflit : montant attendu %, trouvé %', v_expected ->> 'amount', v_row.amount;
  end if;
  if v_row.transaction_date::text <> (v_expected ->> 'received_on') then
    raise exception 'Conflit : date attendue %, trouvée %',
      v_expected ->> 'received_on', v_row.transaction_date;
  end if;
  if v_row.label <> (v_expected ->> 'label') then
    raise exception 'Conflit : libellé attendu différent du libellé enregistré';
  end if;

  v_new_amount := v_row.amount;
  v_new_date := v_row.transaction_date;
  v_new_label := v_row.label;
  if v_corrected ? 'amount' then
    if (v_corrected ->> 'amount') !~ '^[0-9]{1,14}(\.[0-9]{1,6})?$' then
      raise exception 'Montant corrigé invalide';
    end if;
    if (v_corrected ->> 'amount')::numeric <= 0 then
      raise exception 'Montant corrigé invalide : un revenu observé est strictement positif';
    end if;
    v_new_amount := (v_corrected ->> 'amount')::numeric;
  end if;
  if v_corrected ? 'received_on' then
    if (v_corrected ->> 'received_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Date corrigée invalide';
    end if;
    begin
      v_new_date := (v_corrected ->> 'received_on')::date;
    exception when others then
      raise exception 'Date corrigée inexistante au calendrier';
    end;
  end if;
  if v_corrected ? 'label' then
    v_new_label := nullif(btrim(v_corrected ->> 'label'), '');
    if v_new_label is null or char_length(v_new_label) > 180 then
      raise exception 'Libellé corrigé requis (180 caractères au plus)';
    end if;
  end if;

  if v_new_amount <> v_row.amount then v_changed := array_append(v_changed, 'amount'); end if;
  if v_new_date <> v_row.transaction_date then v_changed := array_append(v_changed, 'transaction_date'); end if;
  if v_new_label <> v_row.label then v_changed := array_append(v_changed, 'label'); end if;
  if coalesce(array_length(v_changed, 1), 0) = 0 then
    raise exception 'Aucune valeur modifiée : ce n''est pas une correction';
  end if;

  update public.transactions
     set amount = v_new_amount, transaction_date = v_new_date, label = v_new_label
   where id = v_id and user_id = p_user_id;

  insert into public.transaction_corrections (
    user_id, transaction_id, actor_user_id, reason, before_values, after_values, changed_fields
  ) values (
    p_user_id, v_id, p_user_id, v_reason,
    jsonb_build_object('amount', v_row.amount::text,
      'transaction_date', v_row.transaction_date::text, 'label', v_row.label),
    jsonb_build_object('amount', v_new_amount::text,
      'transaction_date', v_new_date::text, 'label', v_new_label),
    v_changed
  ) returning id into v_correction_id;

  return v_correction_id;
end;
$$;

revoke all on function public.lfo_correct_net_income(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_correct_net_income(uuid, jsonb) to service_role;
revoke all on function public.transaction_correction_immutable() from public, anon, authenticated;
