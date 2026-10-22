-- Durcissement de la correction de revenu et de l'écriture d'opérations (suites de la
-- relecture indépendante de la tranche 2 ; décision du 24 septembre 2026).
--
-- `20260924120000` est publiée : elle n'est PAS réécrite. Cette migration la complète :
--
--   * `lfo_correct_net_income` (base : sa SEULE version, `20260924120000`) : refus métier sous
--     SQLSTATE dédiés (LF409 conflit, LF422 aucun changement, LF403 hors périmètre) dont le
--     message ne cite aucune valeur persistée ; dates comparées en `date` et sérialisées par
--     `to_char`, indépendamment de `DateStyle` ; date corrigée future refusée ; blancs Unicode
--     de bord retirés ; même échelle `numeric(20,6)` des deux côtés de la piste ;
--   * `lfo_add_transaction` (base : sa SEULE version, `202608240005`) : la devise vient du
--     compte, lue en base chez son propriétaire, et une devise d'appelant différente est
--     refusée ; même signature, même logique de solde dérivé ;
--   * `authenticated` perd INSERT, UPDATE et DELETE sur `transactions` : un client pouvait
--     réécrire un revenu corrigé sans trace, ou poser la source « Saisie revenu net observé »
--     sur une opération importée. Toutes les écritures de l'application passent par le
--     serveur (`service_role`) ; le client garde la lecture.

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
  v_expected_date date;
  v_row public.transactions;
  v_new_amount numeric(20,6);
  v_new_date date;
  v_new_label text;
  v_changed text[] := array[]::text[];
  v_correction_id uuid;
  -- Blancs de bord : classe POSIX plus espaces Unicode (insécables, fines, BOM). `\S` et
  -- `btrim` ne connaissent que l'ASCII : « » passait pour un motif.
  c_trim constant text :=
    '^[[:space:]   -​    　﻿]+|[[:space:]   -​    　﻿]+$';
  -- Jour courant dans le fuseau de reporting, même règle que l'application.
  v_today date := (now() at time zone 'Europe/Paris')::date;
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
  if coalesce(jsonb_typeof(p_payload -> 'reason'), 'absent') <> 'string' then
    raise exception 'Motif de correction requis (500 caractères au plus)';
  end if;
  v_reason := regexp_replace(p_payload ->> 'reason', c_trim, '', 'g');
  if v_reason = '' or char_length(v_reason) > 500 then
    raise exception 'Motif de correction requis (500 caractères au plus)';
  end if;

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
  begin
    v_expected_date := (v_expected ->> 'received_on')::date;
  exception when others then
    raise exception 'État attendu mal formé';
  end;

  -- Verrou AVANT comparaison : deux corrections concurrentes se sérialisent ici.
  select * into v_row
    from public.transactions
   where id = v_id and user_id = p_user_id
   for update;
  if not found
     or v_row.source is distinct from 'Saisie revenu net observé'
     or v_row.kind_override is distinct from 'INCOME' then
    raise exception 'Revenu hors périmètre de correction' using errcode = 'LF403';
  end if;

  -- Comparaisons en types natifs (un `::text` de date dépend de `DateStyle`) ; le message ne
  -- cite AUCUNE valeur persistée : il part dans les journaux PostgreSQL et PostgREST.
  if v_row.amount <> (v_expected ->> 'amount')::numeric
     or v_row.transaction_date <> v_expected_date
     or v_row.label <> (v_expected ->> 'label') then
    raise exception 'Conflit : l''état attendu ne correspond plus au revenu enregistré'
      using errcode = 'LF409';
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
    if v_new_date > v_today then
      raise exception 'Date corrigée future : un fait futur n''est pas un fait';
    end if;
  end if;
  if v_corrected ? 'label' then
    v_new_label := regexp_replace(v_corrected ->> 'label', c_trim, '', 'g');
    if v_new_label = '' or char_length(v_new_label) > 180 then
      raise exception 'Libellé corrigé requis (180 caractères au plus)';
    end if;
  end if;

  if v_new_amount <> v_row.amount then v_changed := array_append(v_changed, 'amount'); end if;
  if v_new_date <> v_row.transaction_date then
    v_changed := array_append(v_changed, 'transaction_date');
  end if;
  if v_new_label <> v_row.label then v_changed := array_append(v_changed, 'label'); end if;
  if coalesce(array_length(v_changed, 1), 0) = 0 then
    raise exception 'Aucune valeur modifiée : ce n''est pas une correction'
      using errcode = 'LF422';
  end if;

  update public.transactions
     set amount = v_new_amount, transaction_date = v_new_date, label = v_new_label
   where id = v_id and user_id = p_user_id;

  -- Même échelle et même format de date des deux côtés de la piste.
  insert into public.transaction_corrections (
    user_id, transaction_id, actor_user_id, reason, before_values, after_values, changed_fields
  ) values (
    p_user_id, v_id, p_user_id, v_reason,
    jsonb_build_object('amount', v_row.amount::numeric(20,6)::text,
      'transaction_date', to_char(v_row.transaction_date, 'YYYY-MM-DD'), 'label', v_row.label),
    jsonb_build_object('amount', v_new_amount::text,
      'transaction_date', to_char(v_new_date, 'YYYY-MM-DD'), 'label', v_new_label),
    v_changed
  ) returning id into v_correction_id;

  return v_correction_id;
end;
$$;

create or replace function public.lfo_add_transaction(
  p_user_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_transaction_date date,
  p_label text,
  p_amount numeric,
  p_currency text,
  p_update_balance boolean
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transaction_id uuid;
  v_account_currency text;
  v_latest_balance numeric;
  v_latest_date date;
begin
  -- La devise est celle du COMPTE, lue ici chez son propriétaire : une opération sur un
  -- compte en CHF est en CHF. Une devise d'appelant différente est REFUSÉE, jamais
  -- réécrite en silence ; `null` laisse la base décider.
  select currency into v_account_currency
    from public.financial_accounts
   where id = p_account_id and user_id = p_user_id;
  if not found then
    raise exception 'Compte introuvable' using errcode = 'LF403';
  end if;
  if p_currency is not null and upper(p_currency) <> v_account_currency then
    raise exception 'Devise différente de celle du compte' using errcode = 'LF422';
  end if;

  if p_update_balance then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_user_id::text || ':' || p_account_id::text, 0)
    );
  end if;

  insert into public.transactions (
    user_id, account_id, category_id, transaction_date, label, amount, currency,
    data_kind, confidence, source
  ) values (
    p_user_id, p_account_id, p_category_id, p_transaction_date, p_label, p_amount,
    v_account_currency,
    'ACTUAL', 'HIGH', 'Saisie manuelle'
  ) returning id into v_transaction_id;

  if p_update_balance then
    select balance, balance_date
      into v_latest_balance, v_latest_date
      from public.account_balances
     where user_id = p_user_id and account_id = p_account_id
     order by balance_date desc, created_at desc
     limit 1
     for update;

    if not found then
      raise exception 'Aucun solde connu pour le compte %', p_account_id;
    end if;

    -- Un snapshot postérieur contient déjà les mouvements antérieurs : seule une
    -- transaction strictement plus récente produit un nouveau solde dérivé.
    if p_transaction_date > v_latest_date then
      insert into public.account_balances (
        user_id, account_id, balance, balance_date, data_kind, confidence, source
      ) values (
        p_user_id, p_account_id, v_latest_balance + p_amount, p_transaction_date,
        'DERIVED', 'HIGH', 'Transaction saisie'
      );
    end if;
  end if;

  return v_transaction_id;
end;
$$;

revoke all on function public.lfo_correct_net_income(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_correct_net_income(uuid, jsonb) to service_role;
revoke all on function public.lfo_add_transaction(uuid,uuid,uuid,date,text,numeric,text,boolean)
  from public, anon, authenticated;
grant execute on function public.lfo_add_transaction(uuid,uuid,uuid,date,text,numeric,text,boolean)
  to service_role;

revoke insert, update, delete on table public.transactions from authenticated;
