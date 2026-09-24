-- Dette connue par son SEUL encours (B14, premier fait ; B15 au backlog).
--
--     ENCOURS OBSERVÉ ≠ CONTRAT        TERME INCONNU ≠ TERME À ZÉRO
--
-- Un utilisateur sait souvent ce qu'il doit à une date sans connaître taux, mensualité ou
-- durée. Jusqu'ici `liabilities` exigeait ces termes (NOT NULL), si bien qu'une telle dette ne
-- pouvait être saisie qu'en inventant un contrat. Une dette « encours seul » porte désormais
-- `terms_status = 'OUTSTANDING_ONLY'`, et la contrainte ci-dessous garantit que TOUS ses
-- termes sont NULL : aucune valeur par défaut (profil amortissable, fréquence mensuelle, taux
-- fixe, absence de différé) ne vient affirmer ce que l'utilisateur n'a pas déclaré.
--
-- Une ligne `CONTRACT` garde exactement les garanties d'avant : chacune des colonnes qui
-- étaient NOT NULL l'est toujours pour elle, par la même contrainte. Les lignes existantes
-- prennent `CONTRACT` par défaut et la satisfont (elles avaient toutes ces valeurs).
--
-- Passage d'un encours seul à un contrat : NON livré ici (B16). La contrainte refuse qu'une
-- mise à jour de contrat vienne remplir les termes d'une ligne OUTSTANDING_ONLY sans changer
-- son statut : l'échec est bruyant, jamais une ligne à moitié contractuelle.

alter table public.liabilities
  add column if not exists terms_status text not null default 'CONTRACT';

alter table public.liabilities
  alter column lender drop not null,
  alter column principal drop not null,
  alter column annual_rate drop not null,
  alter column monthly_payment drop not null,
  alter column payment_count drop not null,
  alter column first_payment_date drop not null,
  alter column maturity_date drop not null,
  alter column rate_type drop not null,
  alter column deferral_kind drop not null,
  alter column deferral_months drop not null,
  alter column deferral_interest_treatment drop not null,
  alter column amortisation_profile drop not null,
  alter column payment_frequency drop not null,
  alter column interest_convention drop not null;

alter table public.liabilities
  add constraint liabilities_terms_status_ck
  check (terms_status in ('CONTRACT', 'OUTSTANDING_ONLY'));

alter table public.liabilities
  add constraint liabilities_terms_completeness_ck
  check (
    (
      terms_status = 'CONTRACT'
      and lender is not null
      and principal is not null
      and annual_rate is not null
      and monthly_payment is not null
      and payment_count is not null
      and first_payment_date is not null
      and maturity_date is not null
      and rate_type is not null
      and deferral_kind is not null
      and deferral_months is not null
      and deferral_interest_treatment is not null
      and amortisation_profile is not null
      and payment_frequency is not null
      and interest_convention is not null
    )
    or (
      terms_status = 'OUTSTANDING_ONLY'
      and principal is null
      and annual_rate is null
      and monthly_payment is null
      and payment_count is null
      and first_payment_date is null
      and maturity_date is null
      and rate_type is null
      and deferral_kind is null
      and deferral_months is null
      and deferral_interest_treatment is null
      and amortisation_profile is null
      and payment_frequency is null
      and interest_convention is null
      and monthly_insurance is null
      and recurring_fees is null
      and payment_includes_insurance is null
      and balloon_amount is null
      and facility_id is null
    )
  );

comment on column public.liabilities.terms_status is
  'CONTRACT : termes déclarés et complets. OUTSTANDING_ONLY : seul l''encours est connu, tous les termes sont NULL par contrainte. Terme inconnu ≠ terme à zéro.';

-- Écriture atomique d'une dette « encours seul » et de sa première observation datée.
--
-- La charge est STRICTE : toute clé hors contrat est refusée, clé d'acteur comprise
-- (l'acteur est `p_user_id`, établi côté serveur). Le montant voyage en TEXTE et doit être
-- un décimal positif écrit en notation simple : `NaN`, l'exponentielle et le signe sont
-- refusés, bien que `numeric` les accepterait. La devise est déclarée, jamais supposée.
create or replace function public.lfo_record_outstanding_debt(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_liability_id uuid := gen_random_uuid();
  v_key text;
  v_name text;
  v_lender text;
  v_balance_text text;
  v_balance numeric;
  v_currency text;
  v_observed_at date;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Charge de dette invalide';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('name', 'lender', 'balance', 'currency', 'observed_at', 'notes') then
      raise exception 'Clé refusée : %', v_key;
    end if;
  end loop;

  v_name := nullif(btrim(p_payload ->> 'name'), '');
  if v_name is null or char_length(v_name) > 160 then
    raise exception 'Nom de dette requis (160 caractères au plus)';
  end if;
  v_lender := nullif(btrim(p_payload ->> 'lender'), '');
  if v_lender is not null and char_length(v_lender) > 160 then
    raise exception 'Créancier trop long';
  end if;

  -- CLÉ ABSENTE ≠ JSON NULL ≠ CHAÎNE : `jsonb_typeof` d'une clé absente vaut NULL, et
  -- `NULL <> 'string'` vaut NULL, donc une garde écrite sans `coalesce` laisserait passer
  -- l'oubli. Chaque garde nomme explicitement le cas absent.
  if coalesce(jsonb_typeof(p_payload -> 'balance'), 'absent') <> 'string' then
    raise exception 'Encours attendu en texte';
  end if;
  v_balance_text := p_payload ->> 'balance';
  if v_balance_text is null or v_balance_text !~ '^[0-9]{1,18}(\.[0-9]{1,6})?$' then
    raise exception 'Encours invalide';
  end if;
  v_balance := v_balance_text::numeric;

  v_currency := p_payload ->> 'currency';
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Devise ISO à trois lettres requise';
  end if;

  if coalesce(jsonb_typeof(p_payload -> 'observed_at'), 'absent') <> 'string'
     or (p_payload ->> 'observed_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Date d''observation requise';
  end if;
  v_observed_at := (p_payload ->> 'observed_at')::date;

  insert into public.liabilities (
    id, user_id, name, lender, current_balance, currency, terms_status,
    principal, annual_rate, monthly_payment, payment_count, first_payment_date,
    maturity_date, rate_type, deferral_kind, deferral_months, deferral_interest_treatment,
    amortisation_profile, payment_frequency, interest_convention,
    data_kind, confidence, source, notes, archived
  ) values (
    v_liability_id, p_user_id, v_name, v_lender, v_balance, v_currency, 'OUTSTANDING_ONLY',
    null, null, null, null, null,
    null, null, null, null, null,
    null, null, null,
    'ACTUAL', 'HIGH', 'Saisie encours seul', left(nullif(btrim(p_payload ->> 'notes'), ''), 500), false
  );

  insert into public.liability_balance_observations (
    user_id, liability_id, observed_at, balance, data_kind, confidence, source
  ) values (
    p_user_id, v_liability_id, v_observed_at, v_balance, 'ACTUAL', 'HIGH',
    'Saisie encours observé'
  );

  return v_liability_id;
end;
$$;

revoke all on function public.lfo_record_outstanding_debt(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.lfo_record_outstanding_debt(uuid, jsonb) to service_role;
