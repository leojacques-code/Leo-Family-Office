-- Léo Family Office — Acquisition du registre d'entreprises
--
-- Troisième verticale de la fondation d'acquisition, après le relevé bancaire CSV et le
-- FEC. Elle ne les duplique pas, et elle ne les REJOINT pas non plus : son unité n'est pas
-- un FICHIER DE LIGNES, c'est un INSTANTANÉ D'ENTITÉ.
--
-- Ce choix est le résultat d'un audit, pas un confort :
--
--   `import_sessions` / `import_raw_records` / `import_normalized_records` décrivent un
--   fichier lu ligne par ligne — numéro de ligne, séparateur, mapping de colonnes, verdict
--   de doublon par ligne. Un FEC est un fichier de lignes : l'extension était légitime.
--   Une réponse de registre n'en est pas un. L'y forcer imposerait `row_number = 1`,
--   `raw_line = <json>`, `delimiter = null`, `parser = null` : la piste d'audit MENTIRAIT
--   sur ce qui s'est passé. On ne réutilise donc pas ces tables ici.
--
--   Ce qui EST réutilisé, et qui compte davantage : la chaîne
--   `source → brut immuable → normalisé → validation → lien → fait canonique`, le
--   vocabulaire de provenance (`data_kind`, `confidence`, `source`), les clés étrangères
--   composites `(id, user_id)`, la discipline « `authenticated` ne lit, les RPC `lfo_*`
--   écrivent », le trigger d'immuabilité du brut, et `businesses(id, user_id)` comme
--   unique porte d'entrée du domaine Business Equity.
--
--   `external_sources` existait depuis la migration initiale, sans un seul usage
--   applicatif. Elle est ADOPTÉE plutôt que doublée : c'est elle qui devient le registre
--   des connexions de données externes.
--
-- Ce que cette migration ajoute :
--
--   external_sources            (ÉTENDUE) une connexion à un fournisseur externe : son
--                               domaine, son adaptateur, ce qu'il SERT réellement, le NOM
--                               de la variable d'environnement portant son secret — jamais
--                               le secret —, son quota et son état.
--
--   company_registry_snapshots  ce que le fournisseur a RÉELLEMENT répondu. Immuable. Un
--                               ÉCHEC est un instantané aussi : « le registre n'a pas
--                               répondu le 31 août » est un fait, pas un trou.
--
--   company_registry_profiles   ce que la lecture en a compris pour UNE entité légale.
--                               Staging : aucune ligne de `businesses` n'en dépend.
--
--   company_registry_officers        dirigeants publiés, en minimisation stricte.
--   company_registry_establishments  établissements publiés.
--   company_registry_documents       actes et comptes annuels DISPONIBLES chez le
--                                    fournisseur. Métadonnée, pas fichier.
--
--   business_registry_links     le rattachement explicite entre une société du patrimoine
--                               et une identité légale. Un SIREN ne se rattache qu'à UNE
--                               société : deux rattachements compteraient deux fois la
--                               même participation.
--
--   business_enrichment_decisions  la machine à états CHAMP PAR CHAMP. Aucun enrichissement
--                               ne modifie `businesses` sans une décision écrite, datée, et
--                               conservant la valeur canonique d'AVANT.
--
-- Invariants que cette migration fait tenir à la base, et non à l'application :
--
--   SNAPSHOT ≠ VÉRITÉ CANONIQUE. Écrire un instantané ne change rien au patrimoine.
--
--   CAPACITÉ NON SERVIE ≠ DONNÉE ABSENTE ≠ ZÉRO. Un fournisseur qui ne publie pas le
--   capital social ne dit pas que le capital est inconnu, et il ne dit surtout pas qu'il
--   vaut 0. La capacité est DÉCLARÉE par la connexion.
--
--   ACCEPTER UN VIDE N'EST PAS UN ENRICHISSEMENT. Une décision `ACCEPTED` portant une
--   valeur nulle effacerait une donnée canonique saisie par l'utilisateur au motif que le
--   registre ne la publie pas. La base le refuse.
--
--   PROVENANCE PAR CHAMP ≠ PROVENANCE DE LIGNE. `businesses.data_kind` qualifie la LIGNE :
--   le basculer en `EXTERNAL_DATA` parce qu'un seul champ vient du registre mentirait sur
--   tous les autres. La provenance par champ vit dans `business_enrichment_decisions`, et
--   nulle part ailleurs.
--
--   OBSERVATION PÉRIMÉE ≠ OBSERVATION FAUSSE. Un instantané dépassé reste lisible et
--   signalé, jamais corrigé, jamais indexé, jamais supprimé.
--
-- Ce qu'elle ne fait PAS :
--
--   * aucune formule financière en SQL ;
--   * aucune écriture dans `business_financials`, `business_valuations` ou
--     `business_ownership` : un registre publie une identité légale, pas une valorisation ;
--   * aucun capital social poussé dans `businesses` : la cap table de Business Equity V2.1
--     est la vérité de la détention, et un capital statutaire observé n'en est pas une
--     seconde ;
--   * aucun appel réseau. La base persiste ce que la couche `src/lib/acquisition/registry/`
--     a obtenu et compris.

-- ---------------------------------------------------------------------------
-- 1. `external_sources` — registre des connexions externes
-- ---------------------------------------------------------------------------
-- La table existait, vide de tout usage. Ses colonnes d'origine (`name`, `source_type`,
-- `url`, `last_checked_at`, `status`) sont conservées telles quelles.
--
-- Les contraintes ajoutées ne s'appliquent qu'aux lignes qui DÉCLARENT le nouveau contrat
-- (`domain is not null`). Une ligne héritée, dont on ne peut rien affirmer depuis ce dépôt,
-- reste valide : une migration ne juge pas rétroactivement des données qu'elle n'a pas
-- écrites.

alter table public.external_sources
  add column if not exists domain text,
  add column if not exists provider text,
  add column if not exists adapter_version text,
  -- Ce que ce fournisseur SERT réellement, champ par champ. Déclaration explicite :
  -- l'absence d'un champ dans cette liste signifie « non servi », et une donnée non servie
  -- ne devient jamais un zéro.
  add column if not exists capabilities jsonb not null default '[]'::jsonb,
  add column if not exists auth_mode text,
  -- NOM de la variable d'environnement portant le secret. Jamais sa valeur. Le format
  -- imposé ci-dessous (majuscules, chiffres, tirets bas) rejette mécaniquement un jeton
  -- collé ici par erreur : un token porte des minuscules, des points ou des `=`.
  add column if not exists credential_env_var text,
  add column if not exists rate_limit_per_minute integer,
  -- Durée au-delà de laquelle un instantané de ce fournisseur est SIGNALÉ périmé. `null` =
  -- aucune fraîcheur déclarée, ce qui n'est pas « toujours frais ».
  add column if not exists snapshot_ttl_minutes integer,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists external_sources_id_user_uidx
  on public.external_sources(id, user_id);
-- Une connexion par (domaine, fournisseur). Deux connexions au même registre porteraient
-- deux états de quota et deux historiques d'erreur contradictoires.
create unique index if not exists external_sources_domain_provider_uidx
  on public.external_sources(user_id, domain, provider)
  where domain is not null and provider is not null;
create index if not exists external_sources_user_idx
  on public.external_sources(user_id, created_at desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'external_sources_domain_ck') then
    alter table public.external_sources add constraint external_sources_domain_ck
      check (domain is null or domain in ('COMPANY_REGISTRY'));
  end if;

  -- Une connexion déclarée dit QUI elle interroge et AVEC QUEL adaptateur. Sans cela, un
  -- instantané relu dans deux ans ne serait plus explicable.
  if not exists (select 1 from pg_constraint where conname = 'external_sources_declared_shape_ck') then
    alter table public.external_sources add constraint external_sources_declared_shape_ck
      check (
        case when domain is not null
          then provider is not null and adapter_version is not null and auth_mode is not null
          else true
        end
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'external_sources_auth_mode_ck') then
    alter table public.external_sources add constraint external_sources_auth_mode_ck
      check (auth_mode is null or auth_mode in ('NONE', 'BEARER_TOKEN', 'BASIC'));
  end if;

  -- Un mode authentifié SANS nom de variable serait une connexion dont personne ne sait où
  -- chercher le secret ; un mode `NONE` AVEC un nom de variable suggérerait qu'un secret
  -- est utilisé alors qu'il ne l'est pas.
  if not exists (select 1 from pg_constraint where conname = 'external_sources_credential_ck') then
    alter table public.external_sources add constraint external_sources_credential_ck
      check (
        case
          when auth_mode is null then true
          when auth_mode = 'NONE' then credential_env_var is null
          else credential_env_var is not null
        end
      );
  end if;

  -- Garde-fou anti-fuite : un NOM de variable, pas un secret.
  if not exists (select 1 from pg_constraint where conname = 'external_sources_credential_shape_ck') then
    alter table public.external_sources add constraint external_sources_credential_shape_ck
      check (credential_env_var is null or credential_env_var ~ '^[A-Z][A-Z0-9_]{2,63}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'external_sources_capabilities_ck') then
    alter table public.external_sources add constraint external_sources_capabilities_ck
      check (jsonb_typeof(capabilities) = 'array');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'external_sources_declared_status_ck') then
    alter table public.external_sources add constraint external_sources_declared_status_ck
      check (
        case when domain is not null
          then status in ('ACTIVE', 'STALE', 'REAUTH_REQUIRED', 'RATE_LIMITED', 'ERROR',
                          'DISCONNECTED', 'CREDENTIALS_MISSING', 'FIXTURE')
          else true
        end
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'external_sources_quota_ck') then
    alter table public.external_sources add constraint external_sources_quota_ck
      check (
        (rate_limit_per_minute is null or rate_limit_per_minute > 0)
        and (snapshot_ttl_minutes is null or snapshot_ttl_minutes > 0)
      );
  end if;
end $$;

comment on table public.external_sources is
  'Registre des connexions à des fournisseurs de données externes. Porte le NOM de la variable d''environnement d''un secret, jamais le secret.';
comment on column public.external_sources.capabilities is
  'Champs réellement servis par ce fournisseur. Un champ absent de cette liste est NON SERVI : ce n''est ni une donnée manquante, ni un zéro.';
comment on column public.external_sources.snapshot_ttl_minutes is
  'Fraîcheur déclarée. Au-delà, un instantané est SIGNALÉ périmé, jamais corrigé. `null` = aucune fraîcheur déclarée, ce qui n''est pas « toujours frais ».';
comment on column public.external_sources.credential_env_var is
  'Nom de la variable d''environnement portant le secret côté serveur. Le format imposé rejette mécaniquement un jeton collé ici par erreur.';

-- ---------------------------------------------------------------------------
-- 2. `businesses` — identité légale
-- ---------------------------------------------------------------------------
-- Deux colonnes, et deux seulement. Un registre publie une IDENTITÉ, pas une finance :
-- capital social, effectifs et catégorie d'entreprise restent des OBSERVATIONS dans la
-- couche registre, et n'entrent pas dans `businesses`.

alter table public.businesses
  add column if not exists siren char(9),
  add column if not exists naf_code text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_siren_shape_ck') then
    alter table public.businesses add constraint businesses_siren_shape_ck
      check (siren is null or siren ~ '^[0-9]{9}$');
  end if;
end $$;

-- UN SIREN, UNE SOCIÉTÉ. Deux sociétés du patrimoine portant le même SIREN seraient la même
-- participation comptée deux fois — l'erreur exacte que le bilan canonique ne peut pas
-- détecter par lui-même. C'est un invariant de la base, pas un contrôle applicatif.
create unique index if not exists businesses_siren_uidx
  on public.businesses(user_id, siren)
  where siren is not null;

comment on column public.businesses.siren is
  'Identité légale de la société. Un SIREN ne se rattache qu''à une société du patrimoine : deux rattachements compteraient deux fois la même participation.';

-- ---------------------------------------------------------------------------
-- 3. Instantanés de registre — le brut, immuable
-- ---------------------------------------------------------------------------

create table if not exists public.company_registry_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_source_id uuid not null,
  -- Redit ici pour que l'instantané reste explicable même si la connexion est reconfigurée.
  provider text not null,
  -- Point d'entrée réellement appelé. Une recherche ouverte et une fiche d'entité ne
  -- portent pas la même information : les confondre ferait croire à une fiche complète.
  endpoint text not null,
  -- Ce qui a été DEMANDÉ. Sans la question, la réponse n'est pas interprétable.
  query jsonb not null,
  siren char(9),
  siret char(14),
  http_status integer,
  -- Réponse telle quelle. `null` quand l'appel a échoué : un échec est un fait daté.
  payload jsonb,
  payload_hash text,
  payload_bytes integer,
  -- Version du CONTRAT DE LECTURE appliqué. Quand l'adaptateur change d'interprétation,
  -- les anciens instantanés restent lisibles avec l'ancienne version.
  schema_version text not null,
  -- Quand NOUS avons observé. Distinct de tout arrêté de reporting.
  observed_at timestamptz not null default now(),
  -- Date à laquelle le FOURNISSEUR déclare la donnée valable. `null` = non déclarée, ce qui
  -- n'est pas « valable aujourd'hui ».
  effective_at date,
  provider_updated_at timestamptz,
  -- Dérivé de la fraîcheur déclarée par la connexion. `null` = aucune fraîcheur déclarée.
  stale_after timestamptz,
  error_code text,
  error_message text,
  data_kind text not null default 'EXTERNAL_DATA',
  confidence text not null default 'MEDIUM',
  source text,
  created_at timestamptz not null default now(),
  constraint company_registry_snapshots_source_fk
    foreign key (external_source_id, user_id)
    references public.external_sources(id, user_id) on delete cascade,
  constraint company_registry_snapshots_endpoint_ck check (
    endpoint in ('SEARCH', 'ENTITY', 'OFFICERS', 'ESTABLISHMENTS', 'DOCUMENTS')
  ),
  -- Un instantané DIT quelque chose : une réponse, ou un échec nommé. Une ligne portant ni
  -- l'une ni l'autre serait un trou déguisé en observation.
  constraint company_registry_snapshots_outcome_ck check (
    payload is not null or error_code is not null
  ),
  constraint company_registry_snapshots_payload_hash_ck check (
    case
      when payload is not null then payload_hash is not null and payload_hash ~ '^[0-9a-f]{64}$'
      else payload_hash is null
    end
  ),
  constraint company_registry_snapshots_siren_ck check (siren is null or siren ~ '^[0-9]{9}$'),
  constraint company_registry_snapshots_siret_ck check (siret is null or siret ~ '^[0-9]{14}$'),
  -- Un SIRET commence par le SIREN de son entité. Deux identités contradictoires dans la
  -- même ligne rendraient tout rattachement arbitraire.
  constraint company_registry_snapshots_identity_ck check (
    siren is null or siret is null or left(siret, 9) = siren
  ),
  constraint company_registry_snapshots_query_ck check (jsonb_typeof(query) = 'object'),
  constraint company_registry_snapshots_bytes_ck check (
    payload_bytes is null or payload_bytes >= 0
  ),
  constraint company_registry_snapshots_data_kind_ck check (
    data_kind in ('ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING')
  ),
  constraint company_registry_snapshots_confidence_ck check (
    confidence in ('HIGH', 'MEDIUM', 'LOW')
  )
);

create unique index if not exists company_registry_snapshots_id_user_uidx
  on public.company_registry_snapshots(id, user_id);
-- Deux appels identiques à deux instants différents sont DEUX observations, pas un doublon.
-- Aucune unicité ne porte donc sur le contenu ; la déduplication d'appels est un cache de
-- service, avec sa fraîcheur, et non une contrainte d'intégrité.
create index if not exists company_registry_snapshots_siren_idx
  on public.company_registry_snapshots(user_id, siren, observed_at desc)
  where siren is not null;
create index if not exists company_registry_snapshots_source_idx
  on public.company_registry_snapshots(external_source_id, user_id, observed_at desc);
create index if not exists company_registry_snapshots_user_idx
  on public.company_registry_snapshots(user_id, observed_at desc);
create index if not exists company_registry_snapshots_failures_idx
  on public.company_registry_snapshots(user_id, observed_at desc)
  where error_code is not null;

-- Le brut de registre ne se corrige pas, et il ne s'efface pas quand un fait s'y appuie.
--
-- Même doctrine que `import_raw_records` : corriger une lecture modifie la ligne
-- NORMALISÉE ou la décision d'enrichissement, jamais ce que le fournisseur a répondu. La
-- suppression reste ouverte à `service_role` pour la purge d'instantanés qui n'ont produit
-- AUCUNE décision — mais dès qu'une décision existe, la provenance est gelée.
create or replace function public.company_registry_snapshot_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_decisions integer;
begin
  if tg_op = 'UPDATE' then
    raise exception
      'Un instantané de registre est immuable : corriger la lecture normalisée ou la décision, pas la réponse du fournisseur';
  end if;

  select count(*) into v_decisions
    from public.business_enrichment_decisions
   where snapshot_id = old.id and user_id = old.user_id;

  if v_decisions > 0 then
    raise exception
      'Instantané rattaché à % décision(s) d''enrichissement : la provenance d''un fait décidé ne se supprime pas',
      v_decisions;
  end if;
  return old;
end;
$$;

comment on table public.company_registry_snapshots is
  'Ce que le fournisseur a réellement répondu. Immuable. Un échec est un instantané daté, pas un trou.';
comment on column public.company_registry_snapshots.effective_at is
  'Date à laquelle le fournisseur déclare la donnée valable. `null` = non déclarée, ce qui n''est pas « valable aujourd''hui ».';

-- ---------------------------------------------------------------------------
-- 4. Profils normalisés — le staging
-- ---------------------------------------------------------------------------
-- UNE lecture par instantané d'entité. Toutes les colonnes de contenu sont nullables : une
-- information que le fournisseur n'a pas publiée reste `null`, jamais une chaîne vide,
-- jamais un zéro. `siren` est la seule exception : une fiche sans identité n'est pas une
-- fiche, et l'instantané la porte alors avec son anomalie sans produire de profil.

create table if not exists public.company_registry_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  provider text not null,
  siren char(9) not null,
  legal_name text,
  trade_name text,
  acronym text,
  legal_form_code text,
  legal_form_label text,
  naf_code text,
  naf_label text,
  naf_nomenclature text,
  -- Capital social STATUTAIRE observé. Il reste ICI : la cap table de Business Equity est
  -- la vérité de la détention, et un capital publié n'en est pas une seconde.
  share_capital numeric(20,6),
  share_capital_currency char(3),
  employee_range_code text,
  employee_range_label text,
  employee_range_year integer,
  enterprise_category text,
  created_on date,
  ceased_on date,
  registry_status text,
  head_office_siret char(14),
  address_line text,
  postal_code text,
  city text,
  city_code text,
  country char(2),
  establishment_count integer,
  greffe text,
  rcs_number text,
  -- Ce que la lecture n'a PAS compris, champ par champ. Une liste vide signifie « tout ce
  -- qui était présent a été compris », jamais « tout était présent ».
  issues jsonb not null default '[]'::jsonb,
  data_kind text not null default 'EXTERNAL_DATA',
  confidence text not null default 'MEDIUM',
  source text,
  created_at timestamptz not null default now(),
  constraint company_registry_profiles_snapshot_fk
    foreign key (snapshot_id, user_id)
    references public.company_registry_snapshots(id, user_id) on delete cascade,
  -- Une lecture par instantané. Deux lectures concurrentes du même instantané seraient deux
  -- vérités normalisées de la même réponse.
  constraint company_registry_profiles_snapshot_uk unique (user_id, snapshot_id),
  constraint company_registry_profiles_siren_ck check (siren ~ '^[0-9]{9}$'),
  constraint company_registry_profiles_head_office_ck check (
    head_office_siret is null or head_office_siret ~ '^[0-9]{14}$'
  ),
  constraint company_registry_profiles_head_office_identity_ck check (
    head_office_siret is null or left(head_office_siret, 9) = siren
  ),
  constraint company_registry_profiles_status_ck check (
    registry_status is null or registry_status in ('ACTIVE', 'CEASED', 'UNKNOWN')
  ),
  -- Une cessation datée avant la création serait une lecture incohérente, pas une donnée.
  constraint company_registry_profiles_life_order_ck check (
    created_on is null or ceased_on is null or ceased_on >= created_on
  ),
  -- Un capital sans devise n'est pas un montant. FX ABSENT ≠ FX ÉGAL À 1.
  constraint company_registry_profiles_capital_ck check (
    case when share_capital is not null then share_capital_currency is not null else true end
  ),
  constraint company_registry_profiles_capital_sign_ck check (
    share_capital is null or share_capital >= 0
  ),
  constraint company_registry_profiles_establishments_ck check (
    establishment_count is null or establishment_count >= 0
  ),
  constraint company_registry_profiles_issues_ck check (jsonb_typeof(issues) = 'array'),
  constraint company_registry_profiles_data_kind_ck check (
    data_kind in ('ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING')
  ),
  constraint company_registry_profiles_confidence_ck check (
    confidence in ('HIGH', 'MEDIUM', 'LOW')
  )
);

create unique index if not exists company_registry_profiles_id_user_uidx
  on public.company_registry_profiles(id, user_id);
create index if not exists company_registry_profiles_siren_idx
  on public.company_registry_profiles(user_id, siren, created_at desc);
create index if not exists company_registry_profiles_snapshot_idx
  on public.company_registry_profiles(snapshot_id, user_id);
create index if not exists company_registry_profiles_user_idx
  on public.company_registry_profiles(user_id, created_at desc);

comment on table public.company_registry_profiles is
  'Lecture normalisée d''un instantané d''entité. Staging : aucune ligne de businesses n''en dépend sans décision explicite.';
comment on column public.company_registry_profiles.share_capital is
  'Capital social statutaire OBSERVÉ. Reste dans la couche registre : la cap table de Business Equity est la vérité de la détention.';

-- ---------------------------------------------------------------------------
-- 5. Dirigeants publiés — minimisation stricte
-- ---------------------------------------------------------------------------
-- Le registre publie l'ANNÉE de naissance d'un dirigeant, pas sa date complète. Le produit
-- n'a besoin de rien de plus pour distinguer deux homonymes, et stocker davantage que ce
-- que la source publie serait une aggravation gratuite du risque.

create table if not exists public.company_registry_officers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  -- Rang DANS LA RÉPONSE. C'est l'ordre que l'utilisateur relira chez le fournisseur.
  position_index integer not null,
  officer_kind text not null,
  last_name text,
  first_names text,
  birth_year integer,
  nationality text,
  role_label text,
  role_code text,
  company_siren char(9),
  company_name text,
  since_on date,
  created_at timestamptz not null default now(),
  constraint company_registry_officers_snapshot_fk
    foreign key (snapshot_id, user_id)
    references public.company_registry_snapshots(id, user_id) on delete cascade,
  constraint company_registry_officers_position_uk unique (user_id, snapshot_id, position_index),
  constraint company_registry_officers_position_ck check (position_index >= 0),
  constraint company_registry_officers_kind_ck check (officer_kind in ('PERSON', 'COMPANY', 'UNKNOWN')),
  -- Un dirigeant personne morale s'identifie par sa dénomination ou son SIREN ; une
  -- personne physique par son nom. Une ligne sans aucune des deux ne désigne personne.
  constraint company_registry_officers_identity_ck check (
    case
      when officer_kind = 'PERSON' then last_name is not null
      when officer_kind = 'COMPANY' then company_name is not null or company_siren is not null
      else true
    end
  ),
  constraint company_registry_officers_company_siren_ck check (
    company_siren is null or company_siren ~ '^[0-9]{9}$'
  ),
  -- Une année de naissance hors plage plausible est une lecture ratée, pas une personne.
  constraint company_registry_officers_birth_year_ck check (
    birth_year is null or (birth_year between 1900 and 2100)
  )
);

create unique index if not exists company_registry_officers_id_user_uidx
  on public.company_registry_officers(id, user_id);
create index if not exists company_registry_officers_snapshot_idx
  on public.company_registry_officers(snapshot_id, user_id, position_index);
create index if not exists company_registry_officers_user_idx
  on public.company_registry_officers(user_id, created_at desc);

comment on table public.company_registry_officers is
  'Dirigeants tels que PUBLIÉS par le registre. Minimisation : année de naissance seulement, jamais la date complète.';

-- ---------------------------------------------------------------------------
-- 6. Établissements publiés
-- ---------------------------------------------------------------------------

create table if not exists public.company_registry_establishments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  siret char(14) not null,
  is_head_office boolean,
  establishment_status text,
  address_line text,
  postal_code text,
  city text,
  city_code text,
  country char(2),
  naf_code text,
  naf_label text,
  employee_range_code text,
  created_on date,
  closed_on date,
  created_at timestamptz not null default now(),
  constraint company_registry_establishments_snapshot_fk
    foreign key (snapshot_id, user_id)
    references public.company_registry_snapshots(id, user_id) on delete cascade,
  -- Un établissement une fois par instantané. Le même SIRET répété serait une lecture
  -- fautive, et gonflerait un décompte d'établissements.
  constraint company_registry_establishments_siret_uk unique (user_id, snapshot_id, siret),
  constraint company_registry_establishments_siret_ck check (siret ~ '^[0-9]{14}$'),
  constraint company_registry_establishments_status_ck check (
    establishment_status is null or establishment_status in ('ACTIVE', 'CLOSED', 'UNKNOWN')
  ),
  constraint company_registry_establishments_life_order_ck check (
    created_on is null or closed_on is null or closed_on >= created_on
  )
);

create unique index if not exists company_registry_establishments_id_user_uidx
  on public.company_registry_establishments(id, user_id);
create index if not exists company_registry_establishments_snapshot_idx
  on public.company_registry_establishments(snapshot_id, user_id);
create index if not exists company_registry_establishments_user_idx
  on public.company_registry_establishments(user_id, created_at desc);

comment on table public.company_registry_establishments is
  'Établissements tels que publiés par le registre pour un instantané donné.';

-- ---------------------------------------------------------------------------
-- 7. Actes et comptes annuels DISPONIBLES
-- ---------------------------------------------------------------------------
-- Métadonnée, pas fichier. « Des comptes 2025 sont déposés et non confidentiels » est déjà
-- une information exploitable ; le téléchargement est un acte distinct, qui remplit
-- `document_id` quand il a réellement eu lieu.
--
-- FEC ≠ COMPTES ANNUELS, et un dépôt disponible ≠ un état financier lu : cette table ne
-- produit AUCUN fait Business. Elle dit ce qui existe chez le fournisseur.

create table if not exists public.company_registry_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  document_kind text not null,
  provider_document_id text,
  fiscal_year_end date,
  filing_date date,
  -- Un dépôt peut être déclaré confidentiel : la métadonnée existe, le contenu non.
  confidentiality text,
  -- Le fournisseur annonce-t-il le contenu comme récupérable ? `null` = non déclaré.
  download_available boolean,
  -- Renseigné UNIQUEMENT si le fichier a réellement été déposé au coffre.
  document_id uuid,
  retrieved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint company_registry_documents_snapshot_fk
    foreign key (snapshot_id, user_id)
    references public.company_registry_snapshots(id, user_id) on delete cascade,
  constraint company_registry_documents_document_fk
    foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete set null (document_id),
  constraint company_registry_documents_kind_ck check (
    document_kind in ('ACTE', 'ANNUAL_ACCOUNTS', 'BYLAWS', 'OTHER')
  ),
  constraint company_registry_documents_confidentiality_ck check (
    confidentiality is null or confidentiality in ('PUBLIC', 'CONFIDENTIAL', 'UNKNOWN')
  ),
  -- Un fichier au coffre est un fait daté. Sans date de récupération, la ligne prétendrait
  -- détenir un document sans dire quand.
  constraint company_registry_documents_retrieved_ck check (
    case when document_id is not null then retrieved_at is not null else true end
  )
);

create unique index if not exists company_registry_documents_id_user_uidx
  on public.company_registry_documents(id, user_id);
create index if not exists company_registry_documents_snapshot_idx
  on public.company_registry_documents(snapshot_id, user_id);
create index if not exists company_registry_documents_document_idx
  on public.company_registry_documents(document_id, user_id)
  where document_id is not null;
create index if not exists company_registry_documents_user_idx
  on public.company_registry_documents(user_id, created_at desc);

comment on table public.company_registry_documents is
  'Actes et comptes annuels DISPONIBLES chez le fournisseur. Métadonnée, pas fichier : aucun fait Business n''en découle.';

-- ---------------------------------------------------------------------------
-- 8. Rattachement société ↔ identité légale
-- ---------------------------------------------------------------------------

create table if not exists public.business_registry_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null,
  provider text not null,
  siren char(9) not null,
  siret char(14),
  -- Instantané qui a servi à rattacher. `null` autorisé : un utilisateur peut DÉCLARER un
  -- SIREN sans avoir interrogé le registre, et cette déclaration est un fait légitime.
  linked_snapshot_id uuid,
  -- Comment le rattachement a été établi. `DECLARED` = l'utilisateur l'affirme ;
  -- `PROVIDER_EXACT` = le fournisseur a répondu sur ce SIREN exact.
  match_basis text not null,
  linked_at timestamptz not null default now(),
  notes text,
  constraint business_registry_links_business_fk
    foreign key (business_id, user_id)
    references public.businesses(id, user_id) on delete cascade,
  constraint business_registry_links_snapshot_fk
    foreign key (linked_snapshot_id, user_id)
    references public.company_registry_snapshots(id, user_id)
    on delete set null (linked_snapshot_id),
  -- Une identité par (société, fournisseur) : deux fiches du même registre pour la même
  -- société seraient deux vérités légales concurrentes.
  constraint business_registry_links_business_uk unique (user_id, business_id, provider),
  -- UN SIREN, UNE SOCIÉTÉ, par fournisseur. Le pendant de `businesses_siren_uidx`.
  constraint business_registry_links_siren_uk unique (user_id, provider, siren),
  constraint business_registry_links_siren_ck check (siren ~ '^[0-9]{9}$'),
  constraint business_registry_links_siret_ck check (siret is null or siret ~ '^[0-9]{14}$'),
  constraint business_registry_links_identity_ck check (
    siret is null or left(siret, 9) = siren
  ),
  constraint business_registry_links_basis_ck check (
    match_basis in ('DECLARED', 'PROVIDER_EXACT')
  ),
  -- Un rattachement prétendant venir du fournisseur SANS instantané ne serait pas
  -- vérifiable : la preuve est la provenance, pas le libellé.
  constraint business_registry_links_basis_shape_ck check (
    case when match_basis = 'PROVIDER_EXACT' then linked_snapshot_id is not null else true end
  )
);

create unique index if not exists business_registry_links_id_user_uidx
  on public.business_registry_links(id, user_id);
create index if not exists business_registry_links_business_idx
  on public.business_registry_links(business_id, user_id);
create index if not exists business_registry_links_snapshot_idx
  on public.business_registry_links(linked_snapshot_id, user_id)
  where linked_snapshot_id is not null;
create index if not exists business_registry_links_user_idx
  on public.business_registry_links(user_id, linked_at desc);

comment on table public.business_registry_links is
  'Rattachement explicite entre une société du patrimoine et une identité légale. Un SIREN ne se rattache qu''à une société par fournisseur.';

-- ---------------------------------------------------------------------------
-- 9. Décisions d'enrichissement — la machine à états, champ par champ
-- ---------------------------------------------------------------------------
-- Le cœur de la verticale. AUCUN enrichissement ne modifie `businesses` sans une ligne ici.
--
-- Quatre états sont PERSISTÉS : `CANDIDATE`, `CONFLICT`, `ACCEPTED`, `REJECTED`. Un
-- cinquième, `STALE`, est DÉRIVÉ à la lecture depuis `stale_after` de l'instantané, et il
-- n'est volontairement pas stocké : un état qui dépend de l'heure qu'il est pourrit en
-- silence dès qu'il est figé en base. La péremption se calcule, elle ne se mémorise pas.

create table if not exists public.business_enrichment_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null,
  snapshot_id uuid not null,
  -- Champ canonique visé, dans le vocabulaire du domaine. La liste réellement applicable
  -- est verrouillée par la RPC de décision : un chemin inconnu ne peut pas écrire une
  -- colonne arbitraire.
  field_path text not null,
  -- Valeur PROPOSÉE, typée dans son jsonb.
  candidate_value jsonb,
  -- Ce que LFO portait AU MOMENT de la proposition. Sans cette photo, une décision relue
  -- plus tard ne dirait plus ce qu'elle a remplacé.
  canonical_value_before jsonb,
  state text not null,
  decided_at timestamptz,
  decided_reason text,
  -- Une proposition remplacée par une plus récente reste lisible.
  superseded_by uuid,
  created_at timestamptz not null default now(),
  constraint business_enrichment_decisions_business_fk
    foreign key (business_id, user_id)
    references public.businesses(id, user_id) on delete cascade,
  -- PAS de cascade : supprimer l'instantané d'une décision écrite laisserait un champ
  -- enrichi sans pouvoir dire d'où il vient. Le trigger d'immuabilité le refuse déjà ;
  -- cette contrainte le refuse même sous `service_role`.
  constraint business_enrichment_decisions_snapshot_fk
    foreign key (snapshot_id, user_id)
    references public.company_registry_snapshots(id, user_id) on delete restrict,
  constraint business_enrichment_decisions_state_ck check (
    state in ('CANDIDATE', 'CONFLICT', 'ACCEPTED', 'REJECTED')
  ),
  -- Une décision DIT QUAND elle a été prise.
  constraint business_enrichment_decisions_decided_ck check (
    case when state in ('ACCEPTED', 'REJECTED') then decided_at is not null else true end
  ),
  -- ACCEPTER UN VIDE N'EST PAS UN ENRICHISSEMENT.
  --
  -- Sans cette contrainte, « accepter tout » sur une fiche où le fournisseur ne publie pas
  -- la forme juridique effacerait la forme juridique saisie par l'utilisateur. Le
  -- patrimoine perdrait une information certaine au profit d'un silence.
  constraint business_enrichment_decisions_accept_shape_ck check (
    case
      when state = 'ACCEPTED'
        then candidate_value is not null and jsonb_typeof(candidate_value) <> 'null'
      else true
    end
  ),
  constraint business_enrichment_decisions_field_path_ck check (
    field_path ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  -- Une décision ne peut pas être remplacée par elle-même.
  constraint business_enrichment_decisions_superseded_self_ck check (
    superseded_by is null or superseded_by <> id
  )
);

create unique index if not exists business_enrichment_decisions_id_user_uidx
  on public.business_enrichment_decisions(id, user_id);

-- La clé étrangère de remplacement est POSTÉRIEURE à la table : elle se référence
-- elle-même sur `(id, user_id)`, et PostgreSQL exige que l'unicité visée existe DÉJÀ au
-- moment où la contrainte est créée.
--
-- Elle est DÉFERRÉE, et ce n'est pas un relâchement : remplacer une proposition demande de
-- marquer l'ancienne AVANT d'insérer la nouvelle, sans quoi l'unicité partielle sur les
-- états ouverts refuserait l'insertion. L'état intermédiaire désigne donc une ligne qui
-- n'existe pas encore, le temps d'une instruction. Différer le contrôle jusqu'au commit est
-- exactement l'outil prévu pour cela : l'intégrité est vérifiée sur l'état FINAL, et une
-- transaction qui ne réparerait pas son état intermédiaire échouerait toujours.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_enrichment_decisions_superseded_fk'
  ) then
    alter table public.business_enrichment_decisions
      add constraint business_enrichment_decisions_superseded_fk
      foreign key (superseded_by, user_id)
      references public.business_enrichment_decisions(id, user_id)
      on delete set null (superseded_by)
      deferrable initially deferred;
  end if;
end $$;
-- UNE proposition ouverte par champ et par société. Deux candidates concurrentes sur le
-- même champ mettraient l'utilisateur devant deux vérités externes sans arbitre.
create unique index if not exists business_enrichment_decisions_open_uidx
  on public.business_enrichment_decisions(user_id, business_id, field_path)
  where state in ('CANDIDATE', 'CONFLICT') and superseded_by is null;
create index if not exists business_enrichment_decisions_business_idx
  on public.business_enrichment_decisions(business_id, user_id, created_at desc);
create index if not exists business_enrichment_decisions_snapshot_idx
  on public.business_enrichment_decisions(snapshot_id, user_id);
create index if not exists business_enrichment_decisions_superseded_idx
  on public.business_enrichment_decisions(superseded_by, user_id)
  where superseded_by is not null;
create index if not exists business_enrichment_decisions_user_idx
  on public.business_enrichment_decisions(user_id, created_at desc);

comment on table public.business_enrichment_decisions is
  'Machine à états champ par champ d''un enrichissement. Aucun champ de businesses ne change sans une ligne ici, datée, conservant la valeur canonique d''avant.';
comment on column public.business_enrichment_decisions.state is
  'CANDIDATE, CONFLICT, ACCEPTED, REJECTED. Le cinquième état, STALE, est DÉRIVÉ de la péremption de l''instantané : un état dépendant de l''heure ne se persiste pas.';

-- Le trigger d'immuabilité du brut référence `business_enrichment_decisions` : il ne peut
-- être posé qu'ici, la table existant désormais.
drop trigger if exists company_registry_snapshots_immutable on public.company_registry_snapshots;
create trigger company_registry_snapshots_immutable
  before update or delete on public.company_registry_snapshots
  for each row execute function public.company_registry_snapshot_immutable();

-- ---------------------------------------------------------------------------
-- 10. RLS et privilèges
-- ---------------------------------------------------------------------------
-- `authenticated` LIT, les RPC `lfo_*` ÉCRIVENT. Une piste d'audit sur laquelle le client
-- peut écrire n'est pas une piste d'audit — et `external_sources`, restée ouverte en
-- écriture depuis la migration initiale sans aucun usage, rejoint la même règle : un client
-- capable de réécrire `capabilities` pourrait faire croire qu'un fournisseur publie un
-- capital social qu'il ne publie pas.

do $$
declare target text;
begin
  foreach target in array array[
    'external_sources',
    'company_registry_snapshots',
    'company_registry_profiles',
    'company_registry_officers',
    'company_registry_establishments',
    'company_registry_documents',
    'business_registry_links',
    'business_enrichment_decisions'
  ]
  loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists owner_all on public.%I', target);
    execute format(
      'create policy owner_all on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      target
    );
    execute format('revoke all on table public.%I from anon, authenticated', target);
    execute format('grant select on table public.%I to authenticated', target);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 11. RPC — écritures atomiques
-- ---------------------------------------------------------------------------

-- Déclare ou rafraîchit une connexion externe. Idempotente par (domaine, fournisseur).
--
-- Elle n'accepte JAMAIS un secret : seul le NOM de la variable d'environnement transite,
-- et son format est contraint par la table.
create or replace function public.lfo_upsert_external_source(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_domain text := nullif(p_payload ->> 'domain', '');
  v_provider text := nullif(p_payload ->> 'provider', '');
begin
  if v_domain is null or v_provider is null then
    raise exception 'Connexion externe sans domaine ou sans fournisseur : rien n''est déclaré';
  end if;

  select id into v_id
    from public.external_sources
   where user_id = p_user_id and domain = v_domain and provider = v_provider
   for update;

  if v_id is null then
    insert into public.external_sources (
      user_id, name, source_type, url, status, domain, provider, adapter_version,
      capabilities, auth_mode, credential_env_var, rate_limit_per_minute,
      snapshot_ttl_minutes, notes
    ) values (
      p_user_id,
      coalesce(nullif(p_payload ->> 'name', ''), v_provider),
      coalesce(nullif(p_payload ->> 'source_type', ''), 'API'),
      nullif(p_payload ->> 'url', ''),
      coalesce(nullif(p_payload ->> 'status', ''), 'ACTIVE'),
      v_domain,
      v_provider,
      nullif(p_payload ->> 'adapter_version', ''),
      coalesce(p_payload -> 'capabilities', '[]'::jsonb),
      nullif(p_payload ->> 'auth_mode', ''),
      nullif(p_payload ->> 'credential_env_var', ''),
      nullif(p_payload ->> 'rate_limit_per_minute', '')::integer,
      nullif(p_payload ->> 'snapshot_ttl_minutes', '')::integer,
      nullif(p_payload ->> 'notes', '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.external_sources
     set name = coalesce(nullif(p_payload ->> 'name', ''), name),
         source_type = coalesce(nullif(p_payload ->> 'source_type', ''), source_type),
         url = coalesce(nullif(p_payload ->> 'url', ''), url),
         status = coalesce(nullif(p_payload ->> 'status', ''), status),
         adapter_version = coalesce(nullif(p_payload ->> 'adapter_version', ''), adapter_version),
         capabilities = coalesce(p_payload -> 'capabilities', capabilities),
         auth_mode = coalesce(nullif(p_payload ->> 'auth_mode', ''), auth_mode),
         -- Le nom de variable peut être RETIRÉ en passant explicitement `null` : une
         -- connexion qui redevient anonyme ne doit pas garder une référence trompeuse.
         credential_env_var = case
           when p_payload ? 'credential_env_var' then nullif(p_payload ->> 'credential_env_var', '')
           else credential_env_var
         end,
         rate_limit_per_minute = case
           when p_payload ? 'rate_limit_per_minute'
             then nullif(p_payload ->> 'rate_limit_per_minute', '')::integer
           else rate_limit_per_minute
         end,
         snapshot_ttl_minutes = case
           when p_payload ? 'snapshot_ttl_minutes'
             then nullif(p_payload ->> 'snapshot_ttl_minutes', '')::integer
           else snapshot_ttl_minutes
         end,
         notes = coalesce(nullif(p_payload ->> 'notes', ''), notes),
         updated_at = now()
   where id = v_id and user_id = p_user_id;

  return v_id;
end;
$$;

-- Persiste un instantané et TOUT ce que sa lecture a produit, atomiquement.
--
-- Un échec de fournisseur passe par la même porte : il produit un instantané sans payload,
-- avec son code d'erreur, et met la connexion dans l'état correspondant. « Le registre n'a
-- pas répondu » est un fait, et le perdre ferait croire à une absence de donnée.
--
-- `stale_after` est dérivé de la fraîcheur DÉCLARÉE par la connexion, ici et non chez
-- l'appelant : une péremption calculée côté client serait une péremption négociable.
create or replace function public.lfo_record_registry_snapshot(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_snapshot jsonb := p_payload -> 'snapshot';
  v_profile jsonb := p_payload -> 'profile';
  v_id uuid;
  v_source_id uuid;
  v_provider text;
  v_ttl integer;
  v_error_code text;
  v_row jsonb;
  v_index integer := 0;
begin
  if v_snapshot is null then
    raise exception 'Instantané de registre absent du payload';
  end if;

  v_source_id := (v_snapshot ->> 'external_source_id')::uuid;

  select provider, snapshot_ttl_minutes into v_provider, v_ttl
    from public.external_sources
   where id = v_source_id and user_id = p_user_id;

  if v_provider is null then
    raise exception 'Connexion externe introuvable : aucun instantané ne peut être rattaché';
  end if;

  v_error_code := nullif(v_snapshot ->> 'error_code', '');

  insert into public.company_registry_snapshots (
    user_id, external_source_id, provider, endpoint, query, siren, siret, http_status,
    payload, payload_hash, payload_bytes, schema_version, observed_at, effective_at,
    provider_updated_at, stale_after, error_code, error_message, confidence, source
  ) values (
    p_user_id,
    v_source_id,
    v_provider,
    v_snapshot ->> 'endpoint',
    coalesce(v_snapshot -> 'query', '{}'::jsonb),
    nullif(v_snapshot ->> 'siren', ''),
    nullif(v_snapshot ->> 'siret', ''),
    nullif(v_snapshot ->> 'http_status', '')::integer,
    v_snapshot -> 'payload',
    nullif(v_snapshot ->> 'payload_hash', ''),
    nullif(v_snapshot ->> 'payload_bytes', '')::integer,
    coalesce(nullif(v_snapshot ->> 'schema_version', ''), 'unknown'),
    coalesce(nullif(v_snapshot ->> 'observed_at', '')::timestamptz, now()),
    nullif(v_snapshot ->> 'effective_at', '')::date,
    nullif(v_snapshot ->> 'provider_updated_at', '')::timestamptz,
    case
      when v_ttl is null then null
      else coalesce(nullif(v_snapshot ->> 'observed_at', '')::timestamptz, now())
           + make_interval(mins => v_ttl)
    end,
    v_error_code,
    nullif(v_snapshot ->> 'error_message', ''),
    coalesce(nullif(v_snapshot ->> 'confidence', ''), 'MEDIUM'),
    nullif(v_snapshot ->> 'source', '')
  )
  returning id into v_id;

  -- Le profil n'est écrit que si la lecture a IDENTIFIÉ l'entité. Une réponse sans SIREN
  -- reste un instantané avec son anomalie, jamais un profil sans identité.
  if v_profile is not null and nullif(v_profile ->> 'siren', '') is not null then
    insert into public.company_registry_profiles (
      user_id, snapshot_id, provider, siren, legal_name, trade_name, acronym,
      legal_form_code, legal_form_label, naf_code, naf_label, naf_nomenclature,
      share_capital, share_capital_currency, employee_range_code, employee_range_label,
      employee_range_year, enterprise_category, created_on, ceased_on, registry_status,
      head_office_siret, address_line, postal_code, city, city_code, country,
      establishment_count, greffe, rcs_number, issues, confidence, source
    ) values (
      p_user_id, v_id, v_provider,
      v_profile ->> 'siren',
      nullif(v_profile ->> 'legal_name', ''),
      nullif(v_profile ->> 'trade_name', ''),
      nullif(v_profile ->> 'acronym', ''),
      nullif(v_profile ->> 'legal_form_code', ''),
      nullif(v_profile ->> 'legal_form_label', ''),
      nullif(v_profile ->> 'naf_code', ''),
      nullif(v_profile ->> 'naf_label', ''),
      nullif(v_profile ->> 'naf_nomenclature', ''),
      nullif(v_profile ->> 'share_capital', '')::numeric,
      nullif(v_profile ->> 'share_capital_currency', ''),
      nullif(v_profile ->> 'employee_range_code', ''),
      nullif(v_profile ->> 'employee_range_label', ''),
      nullif(v_profile ->> 'employee_range_year', '')::integer,
      nullif(v_profile ->> 'enterprise_category', ''),
      nullif(v_profile ->> 'created_on', '')::date,
      nullif(v_profile ->> 'ceased_on', '')::date,
      nullif(v_profile ->> 'registry_status', ''),
      nullif(v_profile ->> 'head_office_siret', ''),
      nullif(v_profile ->> 'address_line', ''),
      nullif(v_profile ->> 'postal_code', ''),
      nullif(v_profile ->> 'city', ''),
      nullif(v_profile ->> 'city_code', ''),
      nullif(v_profile ->> 'country', ''),
      nullif(v_profile ->> 'establishment_count', '')::integer,
      nullif(v_profile ->> 'greffe', ''),
      nullif(v_profile ->> 'rcs_number', ''),
      coalesce(v_profile -> 'issues', '[]'::jsonb),
      coalesce(nullif(v_profile ->> 'confidence', ''), 'MEDIUM'),
      nullif(v_profile ->> 'source', '')
    );
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'officers', '[]'::jsonb))
  loop
    insert into public.company_registry_officers (
      user_id, snapshot_id, position_index, officer_kind, last_name, first_names,
      birth_year, nationality, role_label, role_code, company_siren, company_name, since_on
    ) values (
      p_user_id, v_id, v_index,
      coalesce(nullif(v_row ->> 'officer_kind', ''), 'UNKNOWN'),
      nullif(v_row ->> 'last_name', ''),
      nullif(v_row ->> 'first_names', ''),
      nullif(v_row ->> 'birth_year', '')::integer,
      nullif(v_row ->> 'nationality', ''),
      nullif(v_row ->> 'role_label', ''),
      nullif(v_row ->> 'role_code', ''),
      nullif(v_row ->> 'company_siren', ''),
      nullif(v_row ->> 'company_name', ''),
      nullif(v_row ->> 'since_on', '')::date
    );
    v_index := v_index + 1;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'establishments', '[]'::jsonb))
  loop
    insert into public.company_registry_establishments (
      user_id, snapshot_id, siret, is_head_office, establishment_status, address_line,
      postal_code, city, city_code, country, naf_code, naf_label, employee_range_code,
      created_on, closed_on
    ) values (
      p_user_id, v_id,
      v_row ->> 'siret',
      nullif(v_row ->> 'is_head_office', '')::boolean,
      nullif(v_row ->> 'establishment_status', ''),
      nullif(v_row ->> 'address_line', ''),
      nullif(v_row ->> 'postal_code', ''),
      nullif(v_row ->> 'city', ''),
      nullif(v_row ->> 'city_code', ''),
      nullif(v_row ->> 'country', ''),
      nullif(v_row ->> 'naf_code', ''),
      nullif(v_row ->> 'naf_label', ''),
      nullif(v_row ->> 'employee_range_code', ''),
      nullif(v_row ->> 'created_on', '')::date,
      nullif(v_row ->> 'closed_on', '')::date
    );
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'documents', '[]'::jsonb))
  loop
    insert into public.company_registry_documents (
      user_id, snapshot_id, document_kind, provider_document_id, fiscal_year_end,
      filing_date, confidentiality, download_available
    ) values (
      p_user_id, v_id,
      coalesce(nullif(v_row ->> 'document_kind', ''), 'OTHER'),
      nullif(v_row ->> 'provider_document_id', ''),
      nullif(v_row ->> 'fiscal_year_end', '')::date,
      nullif(v_row ->> 'filing_date', '')::date,
      nullif(v_row ->> 'confidentiality', ''),
      nullif(v_row ->> 'download_available', '')::boolean
    );
  end loop;

  -- L'état de la connexion suit le SORT RÉEL de l'appel.
  update public.external_sources
     set last_checked_at = now(),
         last_success_at = case when v_error_code is null then now() else last_success_at end,
         last_error = case when v_error_code is null then null else v_error_code end,
         status = case
           when v_error_code is null then 'ACTIVE'
           when v_error_code = 'RATE_LIMITED' then 'RATE_LIMITED'
           when v_error_code = 'CREDENTIALS_MISSING' then 'CREDENTIALS_MISSING'
           when v_error_code = 'UNAUTHORIZED' then 'REAUTH_REQUIRED'
           else 'ERROR'
         end,
         updated_at = now()
   where id = v_source_id and user_id = p_user_id;

  return v_id;
end;
$$;

-- Rattache une société à une identité légale, et écrit le SIREN canonique dans le même
-- mouvement. Deux vérités entretenues séparément par l'utilisateur seraient exactement ce
-- que la doctrine des mutations de détention interdit.
create or replace function public.lfo_link_business_registry(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_business_id uuid := (p_payload ->> 'business_id')::uuid;
  v_provider text := nullif(p_payload ->> 'provider', '');
  v_siren text := nullif(p_payload ->> 'siren', '');
  v_snapshot_id uuid := nullif(p_payload ->> 'linked_snapshot_id', '')::uuid;
  v_basis text := coalesce(nullif(p_payload ->> 'match_basis', ''), 'DECLARED');
  v_existing_siren text;
begin
  if v_business_id is null or v_provider is null or v_siren is null then
    raise exception 'Rattachement incomplet : société, fournisseur et SIREN sont requis';
  end if;

  select siren into v_existing_siren
    from public.businesses
   where id = v_business_id and user_id = p_user_id
   for update;

  if not found then
    raise exception 'Société introuvable : aucun rattachement écrit';
  end if;

  -- Un SIREN canonique DIFFÉRENT déjà présent n'est pas écrasé en silence : c'est un
  -- conflit d'identité, et l'utilisateur seul peut trancher quelle société il détient.
  if v_existing_siren is not null and v_existing_siren <> v_siren then
    raise exception
      'La société porte déjà le SIREN % : détachez-la avant de la rattacher à %',
      v_existing_siren, v_siren;
  end if;

  insert into public.business_registry_links (
    user_id, business_id, provider, siren, siret, linked_snapshot_id, match_basis, notes
  ) values (
    p_user_id, v_business_id, v_provider, v_siren,
    nullif(p_payload ->> 'siret', ''), v_snapshot_id, v_basis,
    nullif(p_payload ->> 'notes', '')
  )
  on conflict (user_id, business_id, provider) do update
     set siren = excluded.siren,
         siret = excluded.siret,
         linked_snapshot_id = excluded.linked_snapshot_id,
         match_basis = excluded.match_basis,
         notes = excluded.notes,
         linked_at = now()
  returning id into v_id;

  update public.businesses
     set siren = v_siren,
         updated_at = now()
   where id = v_business_id and user_id = p_user_id;

  return v_id;
end;
$$;

-- Détache une identité. Le SIREN canonique n'est retiré que s'il correspond RÉELLEMENT au
-- rattachement supprimé : détacher un fournisseur ne doit pas effacer l'identité établie
-- par un autre.
create or replace function public.lfo_unlink_business_registry(
  p_user_id uuid,
  p_business_id uuid,
  p_provider text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_siren text;
  v_remaining text;
begin
  delete from public.business_registry_links
   where user_id = p_user_id and business_id = p_business_id and provider = p_provider
  returning siren into v_siren;

  if v_siren is null then
    return p_business_id;
  end if;

  select siren into v_remaining
    from public.business_registry_links
   where user_id = p_user_id and business_id = p_business_id
   limit 1;

  update public.businesses
     set siren = v_remaining,
         updated_at = now()
   where id = p_business_id and user_id = p_user_id and siren = v_siren;

  return p_business_id;
end;
$$;

-- Écrit les propositions d'un instantané. AUCUNE colonne de `businesses` n'est touchée.
--
-- Les propositions ouvertes précédentes sur les mêmes champs sont MARQUÉES remplacées, pas
-- supprimées : l'historique des propositions est une piste d'audit, et l'unicité partielle
-- sur les états ouverts exige de toute façon qu'une seule reste vivante.
create or replace function public.lfo_propose_business_enrichment(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid := (p_payload ->> 'business_id')::uuid;
  v_snapshot_id uuid := (p_payload ->> 'snapshot_id')::uuid;
  v_row jsonb;
  v_new_id uuid;
  v_field text;
  v_state text;
  v_count integer := 0;
begin
  if v_business_id is null or v_snapshot_id is null then
    raise exception 'Proposition d''enrichissement sans société ou sans instantané';
  end if;

  perform 1 from public.businesses
   where id = v_business_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'Société introuvable : aucune proposition écrite';
  end if;

  perform 1 from public.company_registry_snapshots
   where id = v_snapshot_id and user_id = p_user_id;
  if not found then
    raise exception 'Instantané introuvable : aucune proposition écrite';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'fields', '[]'::jsonb))
  loop
    v_field := nullif(v_row ->> 'field_path', '');
    if v_field is null then
      raise exception 'Proposition sans champ visé : rien à décider';
    end if;

    v_state := coalesce(nullif(v_row ->> 'state', ''), 'CANDIDATE');
    -- Proposer n'est pas décider. Une proposition arrivant déjà « acceptée » contournerait
    -- la seule porte d'écriture dans `businesses`.
    if v_state not in ('CANDIDATE', 'CONFLICT') then
      raise exception
        'État de proposition invalide (%) : une proposition naît CANDIDATE ou CONFLICT', v_state;
    end if;

    -- L'identifiant est tiré AVANT l'insertion : les propositions ouvertes du même champ
    -- doivent être marquées remplacées d'abord, sans quoi l'unicité partielle sur les états
    -- ouverts refuserait la nouvelle ligne.
    v_new_id := gen_random_uuid();

    update public.business_enrichment_decisions
       set superseded_by = v_new_id
     where user_id = p_user_id
       and business_id = v_business_id
       and field_path = v_field
       and superseded_by is null
       and state in ('CANDIDATE', 'CONFLICT');

    insert into public.business_enrichment_decisions (
      id, user_id, business_id, snapshot_id, field_path, candidate_value,
      canonical_value_before, state
    ) values (
      v_new_id, p_user_id, v_business_id, v_snapshot_id,
      v_field,
      v_row -> 'candidate_value',
      v_row -> 'canonical_value_before',
      v_state
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Applique des décisions. C'est la SEULE porte par laquelle une donnée externe entre dans
-- `businesses`, et elle est atomique : la colonne canonique et l'état de la décision
-- changent ensemble, ou pas du tout.
--
-- La correspondance champ → colonne est un `case` EXPLICITE. Un chemin inconnu lève : sans
-- cette liste blanche, un appelant écrirait une colonne arbitraire par le nom du champ.
--
-- `businesses.data_kind` et `businesses.confidence` ne sont volontairement PAS touchés.
-- Ils qualifient la LIGNE : les basculer en `EXTERNAL_DATA` parce qu'un champ vient du
-- registre mentirait sur tous les autres champs saisis à la main. La provenance par champ
-- est dans cette table, et c'est sa raison d'exister.
create or replace function public.lfo_decide_business_enrichment(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid := (p_payload ->> 'business_id')::uuid;
  v_reason text := nullif(p_payload ->> 'reason', '');
  v_row jsonb;
  v_decision_id uuid;
  v_action text;
  v_field text;
  v_value jsonb;
  v_before jsonb;
  v_current jsonb;
  v_count integer := 0;
begin
  if v_business_id is null then
    raise exception 'Décision d''enrichissement sans société';
  end if;

  perform 1 from public.businesses
   where id = v_business_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'Société introuvable : aucune décision appliquée';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'decisions', '[]'::jsonb))
  loop
    v_decision_id := (v_row ->> 'decision_id')::uuid;
    v_action := v_row ->> 'action';

    select field_path, candidate_value, coalesce(canonical_value_before, 'null'::jsonb)
      into v_field, v_value, v_before
      from public.business_enrichment_decisions
     where id = v_decision_id and user_id = p_user_id and business_id = v_business_id
       and state in ('CANDIDATE', 'CONFLICT')
       and superseded_by is null
     for update;

    if v_field is null then
      raise exception 'Proposition % introuvable ou déjà décidée', v_decision_id;
    end if;

    if v_action = 'reject' then
      update public.business_enrichment_decisions
         set state = 'REJECTED', decided_at = now(), decided_reason = v_reason
       where id = v_decision_id and user_id = p_user_id;
      v_count := v_count + 1;
      continue;
    end if;

    if v_action <> 'accept' then
      raise exception 'Action d''enrichissement inconnue : %', coalesce(v_action, 'null');
    end if;

    if v_value is null or jsonb_typeof(v_value) = 'null' then
      raise exception
        'Champ % : accepter une valeur absente effacerait une donnée canonique. Un vide n''est pas un enrichissement',
        v_field;
    end if;

    -- CONCURRENCE OPTIMISTE SUR LA VALEUR CANONIQUE.
    --
    -- Entre la proposition et la décision, l'utilisateur a pu saisir lui-même le champ.
    -- Accepter alors la proposition écraserait une saisie PLUS RÉCENTE avec une observation
    -- plus ancienne, en silence. La photo prise à la proposition sert ici de version
    -- attendue : si le canonique a bougé, la décision est refusée et l'utilisateur reverra
    -- une proposition à jour.
    select coalesce(
             case v_field
               when 'name' then to_jsonb(name)
               when 'legal_form' then to_jsonb(legal_form)
               when 'sector' then to_jsonb(sector)
               when 'naf_code' then to_jsonb(naf_code)
               when 'country' then to_jsonb(country)
               when 'founded_on' then to_jsonb(founded_on)
             end,
             'null'::jsonb)
      into v_current
      from public.businesses
     where id = v_business_id and user_id = p_user_id;

    if v_current is distinct from v_before then
      raise exception
        'Champ % : la valeur canonique a changé depuis la proposition (attendu %, trouvé %). Relancez la comparaison',
        v_field, v_before::text, v_current::text;
    end if;

    -- Liste blanche. Chaque champ ici est une IDENTITÉ ou une CLASSIFICATION, jamais une
    -- valeur financière : aucun montant du registre n'entre dans `businesses`.
    case v_field
      when 'name' then
        update public.businesses set name = v_value #>> '{}', updated_at = now()
         where id = v_business_id and user_id = p_user_id;
      when 'legal_form' then
        update public.businesses set legal_form = v_value #>> '{}', updated_at = now()
         where id = v_business_id and user_id = p_user_id;
      when 'sector' then
        update public.businesses set sector = v_value #>> '{}', updated_at = now()
         where id = v_business_id and user_id = p_user_id;
      when 'naf_code' then
        update public.businesses set naf_code = v_value #>> '{}', updated_at = now()
         where id = v_business_id and user_id = p_user_id;
      when 'country' then
        update public.businesses set country = v_value #>> '{}', updated_at = now()
         where id = v_business_id and user_id = p_user_id;
      when 'founded_on' then
        update public.businesses set founded_on = (v_value #>> '{}')::date, updated_at = now()
         where id = v_business_id and user_id = p_user_id;
      else
        raise exception
          'Champ % hors liste blanche d''enrichissement : une donnée externe n''écrit pas une colonne arbitraire',
          v_field;
    end case;

    update public.business_enrichment_decisions
       set state = 'ACCEPTED', decided_at = now(), decided_reason = v_reason
     where id = v_decision_id and user_id = p_user_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Privilèges des RPC
-- ---------------------------------------------------------------------------
revoke all on function
  public.lfo_upsert_external_source(uuid, jsonb),
  public.lfo_record_registry_snapshot(uuid, jsonb),
  public.lfo_link_business_registry(uuid, jsonb),
  public.lfo_unlink_business_registry(uuid, uuid, text),
  public.lfo_propose_business_enrichment(uuid, jsonb),
  public.lfo_decide_business_enrichment(uuid, jsonb)
from public, anon, authenticated;

grant execute on function
  public.lfo_upsert_external_source(uuid, jsonb),
  public.lfo_record_registry_snapshot(uuid, jsonb),
  public.lfo_link_business_registry(uuid, jsonb),
  public.lfo_unlink_business_registry(uuid, uuid, text),
  public.lfo_propose_business_enrichment(uuid, jsonb),
  public.lfo_decide_business_enrichment(uuid, jsonb)
to service_role;
