-- Premier revenu net OBSERVÉ (B14, premier fait ; document 05 §4).
--
--     REVENU NET OBSERVÉ ≠ SALAIRE BRUT ≠ PRÉVISION DE CARRIÈRE
--
-- « Un revenu net observé peut être enregistré sans fiche de paie ni montant brut. Il alimente
-- Flux, pas une reconstruction fictive de cotisations. » La doctrine du dépôt range déjà un
-- revenu observé au ledger : `career-tax-cash-flow.ts` fait remplacer la prévision par la
-- transaction bancaire ACTUAL classée INCOME. Cette RPC écrit donc UNE transaction de ce type,
-- et rien d'autre : aucun brut, aucun impôt, aucun rôle de carrière n'en est déduit.
--
-- Trois choix, chacun contre une erreur précise :
--   * la DEVISE est celle du compte crédité, lue en base, jamais reçue du client : un revenu
--     versé sur un compte en CHF n'est pas un revenu en EUR parce que le profil lit en EUR ;
--   * la nature INCOME est portée par `kind_override`, sans catégorie : un espace neuf n'en a
--     aucune, et en créer une d'office serait décider de la classification à sa place ;
--   * AUCUN solde n'est modifié : le solde observé d'un compte est un autre fait. Le dériver
--     de ce revenu compterait deux fois un versement déjà inclus dans le solde relevé.
create or replace function public.lfo_record_net_income(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_account_id uuid;
  v_currency text;
  v_amount_text text;
  v_label text;
  v_date date;
  v_transaction_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Charge de revenu invalide';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('account_id', 'received_on', 'amount', 'label', 'notes') then
      raise exception 'Clé refusée : %', v_key;
    end if;
  end loop;

  -- CLÉ ABSENTE ≠ JSON NULL ≠ CHAÎNE : chaque garde nomme le cas absent.
  if coalesce(jsonb_typeof(p_payload -> 'account_id'), 'absent') <> 'string'
     or (p_payload ->> 'account_id')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Compte crédité requis';
  end if;
  v_account_id := (p_payload ->> 'account_id')::uuid;
  select currency into v_currency
    from public.financial_accounts
   where id = v_account_id and user_id = p_user_id;
  if not found then
    raise exception 'Compte introuvable';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Devise du compte inconnue : le revenu ne peut pas être daté dans une devise supposée';
  end if;

  if coalesce(jsonb_typeof(p_payload -> 'amount'), 'absent') <> 'string' then
    raise exception 'Montant attendu en texte';
  end if;
  v_amount_text := p_payload ->> 'amount';
  -- Deux gardes successives : SQL ne garantit pas l'ordre d'évaluation d'un OR, et le cast
  -- d'un texte non numérique lèverait une erreur au mauvais message.
  -- 14 chiffres entiers : la précision réelle de `numeric(20,6)`.
  if v_amount_text is null or v_amount_text !~ '^[0-9]{1,14}(\.[0-9]{1,6})?$' then
    raise exception 'Montant net invalide';
  end if;
  if v_amount_text::numeric <= 0 then
    raise exception 'Montant net invalide : un revenu observé est strictement positif';
  end if;

  if coalesce(jsonb_typeof(p_payload -> 'received_on'), 'absent') <> 'string'
     or (p_payload ->> 'received_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Date de versement requise';
  end if;
  begin
    v_date := (p_payload ->> 'received_on')::date;
  exception when others then
    raise exception 'Date de versement inexistante au calendrier';
  end;

  if coalesce(jsonb_typeof(p_payload -> 'label'), 'absent') <> 'string'
     or coalesce(jsonb_typeof(p_payload -> 'notes'), 'null') not in ('string', 'null') then
    raise exception 'Libellé et note sont des textes';
  end if;
  if char_length(coalesce(p_payload ->> 'notes', '')) > 500 then
    raise exception 'Note trop longue (500 caractères au plus) : refusée plutôt que tronquée';
  end if;
  v_label := nullif(btrim(p_payload ->> 'label'), '');
  if v_label is null or char_length(v_label) > 180 then
    raise exception 'Libellé du revenu requis (180 caractères au plus)';
  end if;

  insert into public.transactions (
    user_id, account_id, category_id, transaction_date, label, amount, currency,
    data_kind, confidence, source, notes, manual_override, kind_override
  ) values (
    p_user_id, v_account_id, null, v_date, v_label, v_amount_text::numeric, v_currency,
    'ACTUAL', 'HIGH', 'Saisie revenu net observé',
    nullif(btrim(p_payload ->> 'notes'), ''), true, 'INCOME'
  ) returning id into v_transaction_id;

  return v_transaction_id;
end;
$$;

revoke all on function public.lfo_record_net_income(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_record_net_income(uuid, jsonb) to service_role;
