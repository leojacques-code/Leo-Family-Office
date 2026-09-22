-- Contexte déclaratif de l’espace ; aucun moteur fiscal ou arrêté financier implicite.
-- Nullable et sans backfill : aucune résidence ou date n’est inventée.
alter table public.profiles
  add column residence_country text,
  add column context_date date,
  add constraint profiles_residence_country_ck check (
    residence_country is null or (
      residence_country = btrim(residence_country)
      and char_length(residence_country) between 1 and 80
    )
  ),
  add constraint profiles_context_date_ck check (
    context_date is null or (isfinite(context_date) and context_date between date '0001-01-01' and date '9999-12-31')
  );
comment on column public.profiles.residence_country is
  'Pays de résidence déclaré pour le contexte de l’espace ; ne détermine pas une résidence fiscale.';
comment on column public.profiles.context_date is
  'Date de référence du contexte déclaré ; ne remplace ni la date des faits ni la date de valorisation.';
