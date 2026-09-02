-- ===========================================================================
-- REAL ESTATE PUBLIC DATA — DVF (mutations foncières) et DPE (performance énergétique)
--
-- Cinquième verticale de la fondation d'acquisition. Elle fait entrer dans LFO deux jeux
-- de données PUBLIQUES rattachables à un bien détenu, et rien d'autre : ni valorisation
-- automatique, ni indexation, ni correction d'une observation existante.
--
-- Ce qu'elle ne fait PAS, et c'est le cœur de sa conception :
--
--   * DVF NE VALORISE PAS MON BIEN. Une mutation DVF est la vente de QUELQU'UN D'AUTRE.
--     Un jeu de comparables n'est pas une valorisation : c'est un ensemble de faits sur
--     d'autres transactions. Écrire une valeur dans real_estate_valuations depuis DVF sans
--     décision humaine explicite reviendrait à inventer la valeur du patrimoine.
--
--   * UNE ADRESSE NE PROUVE PAS UNE IDENTITÉ. Un DPE trouvé au « 12 rue X » n'est pas
--     forcément MON appartement dans cet immeuble : un immeuble porte autant de DPE que de
--     lots. Le rapprochement est une HYPOTHÈSE avec un score et une base nommée, jamais une
--     preuve, et il n'est jamais accepté d'office. Même doctrine que
--     RESSEMBLANCE ≠ DOUBLON dans l'acquisition bancaire.
--
--   * UN RÉSULTAT VIDE N'EST PAS UNE ABSENCE DE MARCHÉ. DVF ne couvre pas l'intégralité du
--     territoire : la couverture est DÉCLARÉE par l'adaptateur, jamais présumée. Une requête
--     sans résultat sur une zone non couverte ne dit rien du marché, et un instantané qui ne
--     porte aucun enregistrement ne peut alimenter aucun rapprochement.
--
--   * AUCUN PRIX AU M² N'EST PERSISTÉ. Il est DÉRIVÉ à la lecture, par un moteur pur, à
--     partir du prix et de la surface réellement lus. Une surface absente rend le prix
--     unitaire NON CALCULABLE ; elle ne vaut pas zéro.
--
--   * AUCUNE DATE DE VALIDITÉ DE DPE N'EST CALCULÉE. Elle est lue telle que la source la
--     déclare. Une validité inconnue reste `null` et se signale ; la déduire d'une règle
--     réglementaire que ce dépôt ne contient pas produirait une date sans source.
--
-- Écritures : uniquement par RPC lfo_*, `security invoker`, `set search_path = ''`,
-- réservées à service_role. Le client LIT. Aucune formule financière en SQL.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. external_sources ADOPTÉE comme registre des connexions externes
-- ---------------------------------------------------------------------------
-- Cette table existe depuis la migration initiale, avec six colonnes et aucun usage
-- applicatif. Elle est ADOPTÉE plutôt que doublée : un jeu de données publiques est bien
-- une connexion externe, avec un adaptateur, une version, une fraîcheur et une couverture.
--
-- import_sources n'est PAS réutilisée, et ce n'est pas un oubli : son unité est un fichier
-- lu ligne par ligne alimentant UN domaine canonique, et sa contrainte de forme exige une
-- enveloppe bancaire cible. Un jeu de mutations foncières n'alimente aucune enveloppe.

alter table public.external_sources add column if not exists domain text;
alter table public.external_sources add column if not exists provider text;
alter table public.external_sources add column if not exists adapter_version text;
-- Millésime du jeu de données, tel que le publieur le nomme. Deux millésimes ne sont pas
-- deux versions d'une même vérité : ce sont deux jeux, et un chiffre en porte le nom.
alter table public.external_sources add column if not exists dataset_version text;
-- CAPACITÉ NON SERVIE ≠ DONNÉE ABSENTE ≠ ZÉRO. L'adaptateur déclare ce qu'il sait rendre ;
-- ce qu'il ne sert pas ne devient jamais un « non » sur le fond.
alter table public.external_sources add column if not exists capabilities jsonb not null default '{}'::jsonb;
-- Couverture DÉCLARÉE du jeu : ce que le publieur dit couvrir, et ce qu'il dit ne pas
-- couvrir. C'est la seule chose qui rend un résultat vide interprétable.
alter table public.external_sources add column if not exists declared_coverage jsonb not null default '{}'::jsonb;
alter table public.external_sources add column if not exists licence text;
alter table public.external_sources add column if not exists base_url text;
-- Fraîcheur DÉCLARÉE. Sans elle, aucun instantané n'est réutilisable : un cache sans durée
-- de vie déclarée est un chiffre dont on ignore l'âge.
alter table public.external_sources add column if not exists snapshot_ttl_minutes integer;
alter table public.external_sources add column if not exists last_success_at timestamptz;
alter table public.external_sources add column if not exists last_error text;
alter table public.external_sources add column if not exists created_at timestamptz not null default now();
alter table public.external_sources add column if not exists updated_at timestamptz not null default now();

-- Clé composite : toute liaison de ce dépôt passe par (id, user_id), sans quoi une ligne
-- d'un autre utilisateur pourrait être référencée par un identifiant seul.
create unique index if not exists external_sources_id_user_uidx
  on public.external_sources(id, user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'external_sources_domain_ck'
  ) then
    -- Un seul domaine dans cette migration. En ajouter un suppose d'ajouter les tables
    -- d'instantané correspondantes : un domaine déclaré sans support serait une promesse
    -- que la base ne tient pas.
    alter table public.external_sources add constraint external_sources_domain_ck
      check (domain is null or domain in ('REAL_ESTATE_PUBLIC_DATA'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'external_sources_shape_ck'
  ) then
    -- Un domaine déclaré exige son adaptateur nommé et versionné : un instantané sans
    -- version d'adaptateur n'est pas rejouable.
    alter table public.external_sources add constraint external_sources_shape_ck
      check (
        case when domain is not null
          then provider is not null and adapter_version is not null
               and snapshot_ttl_minutes is not null and snapshot_ttl_minutes > 0
        else true end
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'external_sources_provider_uk'
  ) then
    -- Deux adaptateurs du même provider pour le même utilisateur seraient deux vérités de
    -- fraîcheur concurrentes sur la même source.
    alter table public.external_sources add constraint external_sources_provider_uk
      unique (user_id, provider);
  end if;
end $$;

comment on table public.external_sources is
  'Registre des connexions externes : adaptateur, version, capacités déclarées, couverture déclarée et fraîcheur. Ne porte AUCUNE donnée métier.';
comment on column public.external_sources.declared_coverage is
  'Couverture DÉCLARÉE du jeu de données. Un résultat vide n''est interprétable qu''à la lumière de cette déclaration : hors couverture, il ne dit rien.';
comment on column public.external_sources.capabilities is
  'Ce que l''adaptateur sait rendre. CAPACITÉ NON SERVIE ≠ DONNÉE ABSENTE ≠ ZÉRO.';

-- ---------------------------------------------------------------------------
-- 1. Instantané d'interrogation — brut immuable
-- ---------------------------------------------------------------------------
-- Un instantané est le FAIT « telle requête a été posée à telle date et a rendu tel
-- contenu ». Il est écrit même quand la requête échoue : une interrogation tentée laisse
-- toujours une trace, sans quoi l'absence de donnée serait indistinguable d'un oubli.

create table if not exists public.real_estate_data_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null,
  -- Jeu interrogé, tel que l'adaptateur le nomme.
  dataset text not null,
  dataset_version text,
  -- Paramètres RÉELLEMENT envoyés. Pas une intention : ce qui est parti.
  query jsonb not null,
  -- Empreintes calculées côté application sur un JSON canonique (clés triées). Elles
  -- servent l'identité de la requête et la comparaison de contenu, jamais une déduplication
  -- automatique : deux lectures identiques à deux dates sont deux observations.
  query_hash text not null,
  payload_hash text not null,
  retrieved_at timestamptz not null,
  -- Fraîcheur DÉCLARÉE, calculée depuis snapshot_ttl_minutes de la source. Un instantané
  -- au-delà de cette borne n'est pas faux : il est PÉRIMÉ, et se signale comme tel.
  stale_after timestamptz not null,
  http_status integer,
  -- DÉRIVÉ des lignes réellement persistées par la RPC, jamais reçu de l'appelant. Même
  -- doctrine que Σdébits = Σcrédits par écriture du FEC : un décompte fourni ne prouve rien.
  record_count integer not null default 0,
  -- Couverture de la zone interrogée, telle que l'adaptateur la déclare.
  coverage_state text not null,
  coverage_note text,
  status text not null,
  error_code text,
  error_message text,
  data_kind text not null default 'EXTERNAL_DATA',
  confidence text not null default 'MEDIUM',
  source text,
  created_at timestamptz not null default now(),
  constraint real_estate_data_snapshots_source_fk
    foreign key (source_id, user_id)
    references public.external_sources(id, user_id) on delete cascade,
  constraint real_estate_data_snapshots_dataset_ck check (dataset in ('DVF', 'DPE')),
  constraint real_estate_data_snapshots_coverage_ck check (
    coverage_state in ('DECLARED_COVERED', 'DECLARED_NOT_COVERED', 'COVERAGE_UNKNOWN')
  ),
  constraint real_estate_data_snapshots_status_ck check (
    status in ('RETRIEVED', 'EMPTY', 'FAILED', 'NOT_SERVED')
  ),
  constraint real_estate_data_snapshots_count_ck check (record_count >= 0),
  -- Une fraîcheur nulle ou négative n'est pas une fraîcheur.
  constraint real_estate_data_snapshots_stale_ck check (stale_after > retrieved_at),
  -- Un échec ne porte aucun enregistrement, et il porte son motif : « ça n'a pas marché »
  -- sans code est indistinguable d'un résultat vide.
  constraint real_estate_data_snapshots_failure_shape_ck check (
    case when status in ('FAILED', 'NOT_SERVED')
      then record_count = 0 and error_code is not null
    else error_code is null end
  ),
  -- RÉSULTAT VIDE ≠ RÉSULTAT OBTENU. Les deux statuts sont distincts parce que les deux
  -- faits sont distincts, et le vide n'autorise aucun rapprochement.
  constraint real_estate_data_snapshots_empty_shape_ck check (
    case when status = 'EMPTY' then record_count = 0
         when status = 'RETRIEVED' then record_count > 0
    else true end
  ),
  constraint real_estate_data_snapshots_data_kind_ck check (
    data_kind in ('ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING')
  ),
  constraint real_estate_data_snapshots_confidence_ck check (
    confidence in ('HIGH', 'MEDIUM', 'LOW')
  )
);

create unique index if not exists real_estate_data_snapshots_id_user_uidx
  on public.real_estate_data_snapshots(id, user_id);
create index if not exists real_estate_data_snapshots_lookup_idx
  on public.real_estate_data_snapshots(user_id, dataset, query_hash, retrieved_at desc);
create index if not exists real_estate_data_snapshots_source_idx
  on public.real_estate_data_snapshots(source_id, user_id);
create index if not exists real_estate_data_snapshots_fresh_idx
  on public.real_estate_data_snapshots(user_id, dataset, stale_after desc)
  where status = 'RETRIEVED';

comment on table public.real_estate_data_snapshots is
  'Instantané immuable d''une interrogation de donnée publique. Écrit même en échec. record_count est DÉRIVÉ des lignes persistées.';

-- Le brut est immuable. Corriger une lecture n'est pas récrire ce que la source a rendu :
-- la correction vit dans la décision de rapprochement, jamais ici.
create or replace function public.real_estate_snapshot_frozen()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un instantané de donnée publique ne se supprime pas : il est la preuve de ce qui a été lu';
  end if;
  if new.query is distinct from old.query
     or new.query_hash is distinct from old.query_hash
     or new.payload_hash is distinct from old.payload_hash
     or new.retrieved_at is distinct from old.retrieved_at
     or new.dataset is distinct from old.dataset
     or new.source_id is distinct from old.source_id then
    raise exception 'Instantané % : le contenu lu est immuable. Une nouvelle lecture crée un nouvel instantané', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists real_estate_snapshot_frozen on public.real_estate_data_snapshots;
create trigger real_estate_snapshot_frozen
  before update or delete on public.real_estate_data_snapshots
  for each row execute function public.real_estate_snapshot_frozen();

-- ---------------------------------------------------------------------------
-- 2. Mutations comparables (DVF) — les ventes de QUELQU'UN D'AUTRE
-- ---------------------------------------------------------------------------
-- Aucun prix au m² n'est stocké ici. Il se dérive du prix et de la surface, à la lecture,
-- et seulement quand les deux existent. Une mutation portant plusieurs lots pour un prix
-- unique n'a PAS de prix unitaire : le moteur l'exclut du calcul en le disant.

create table if not exists public.real_estate_comparable_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  row_index integer not null,
  -- Identifiant de mutation TEL QUE LU. Sa stabilité n'est pas présumée : il sert la
  -- traçabilité, jamais une clé d'unicité inter-fichiers.
  mutation_ref text,
  mutated_on date not null,
  price numeric(20,6) not null,
  currency char(3) not null,
  property_kind text,
  -- Surfaces NULLABLES et qui le restent. SURFACE ABSENTE ≠ SURFACE NULLE : un bien de
  -- zéro mètre carré n'existe pas, et une surface inconnue rend le prix unitaire non
  -- calculable au lieu de le rendre infini.
  built_area_sqm numeric(12,3),
  land_area_sqm numeric(12,3),
  room_count integer,
  -- Nombre de lots portés par la mutation, tel que lu. Au-delà de un, le prix est global.
  lot_count integer,
  commune_code char(5),
  postal_code char(5),
  street_label text,
  cadastral_section text,
  -- Enregistrement brut de la ligne, immuable.
  raw jsonb not null,
  data_kind text not null default 'EXTERNAL_DATA',
  confidence text not null default 'MEDIUM',
  created_at timestamptz not null default now(),
  constraint real_estate_comparable_sales_snapshot_fk
    foreign key (snapshot_id, user_id)
    references public.real_estate_data_snapshots(id, user_id) on delete cascade,
  constraint real_estate_comparable_sales_price_ck check (price >= 0),
  constraint real_estate_comparable_sales_built_area_ck check (built_area_sqm is null or built_area_sqm > 0),
  constraint real_estate_comparable_sales_land_area_ck check (land_area_sqm is null or land_area_sqm > 0),
  constraint real_estate_comparable_sales_rooms_ck check (room_count is null or room_count > 0),
  constraint real_estate_comparable_sales_lots_ck check (lot_count is null or lot_count > 0),
  constraint real_estate_comparable_sales_row_ck check (row_index >= 0),
  constraint real_estate_comparable_sales_data_kind_ck check (
    data_kind in ('ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING')
  ),
  constraint real_estate_comparable_sales_confidence_ck check (
    confidence in ('HIGH', 'MEDIUM', 'LOW')
  )
);

create unique index if not exists real_estate_comparable_sales_id_user_uidx
  on public.real_estate_comparable_sales(id, user_id);
-- Position dans l'instantané : elle rend chaque ligne repérable sans jamais servir
-- d'identité métier.
create unique index if not exists real_estate_comparable_sales_position_uidx
  on public.real_estate_comparable_sales(user_id, snapshot_id, row_index);
create index if not exists real_estate_comparable_sales_snapshot_idx
  on public.real_estate_comparable_sales(snapshot_id, user_id);
create index if not exists real_estate_comparable_sales_geo_idx
  on public.real_estate_comparable_sales(user_id, commune_code, mutated_on desc);

comment on table public.real_estate_comparable_sales is
  'Mutations foncières PUBLIQUES lues dans un instantané. Ce sont les ventes d''autrui : aucune ne valorise un bien détenu. Aucun prix au m² persisté.';
comment on column public.real_estate_comparable_sales.lot_count is
  'Nombre de lots de la mutation, tel que lu. Au-delà de un, le prix est global et le prix au m² n''existe pas.';

-- ---------------------------------------------------------------------------
-- 3. Diagnostics de performance énergétique (DPE)
-- ---------------------------------------------------------------------------
-- L'étiquette est un fait imprimé. Sa valeur chiffrée n'est interprétable qu'avec son
-- unité, et la validité est LUE, jamais calculée.

create table if not exists public.real_estate_energy_certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  row_index integer not null,
  certificate_ref text,
  issued_on date,
  -- TELLE QUE DÉCLARÉE par la source. `null` = validité inconnue, et non « valide ».
  -- La déduire d'une règle absente de ce dépôt produirait une date sans source.
  valid_until date,
  -- Version de méthode telle que lue. Deux DPE de méthodes différentes ne sont pas
  -- comparables terme à terme, et le nom de la méthode est ce qui le dit.
  method_version text,
  energy_label char(1),
  energy_value numeric(12,3),
  energy_unit text,
  ghg_label char(1),
  ghg_value numeric(12,3),
  ghg_unit text,
  living_area_sqm numeric(12,3),
  building_kind text,
  construction_year integer,
  address_label text,
  postal_code char(5),
  commune_code char(5),
  raw jsonb not null,
  data_kind text not null default 'EXTERNAL_DATA',
  confidence text not null default 'MEDIUM',
  created_at timestamptz not null default now(),
  constraint real_estate_energy_certificates_snapshot_fk
    foreign key (snapshot_id, user_id)
    references public.real_estate_data_snapshots(id, user_id) on delete cascade,
  -- ÉTIQUETTE ABSENTE ≠ ÉTIQUETTE G. Une étiquette inconnue reste inconnue.
  constraint real_estate_energy_certificates_energy_label_ck check (
    energy_label is null or energy_label in ('A', 'B', 'C', 'D', 'E', 'F', 'G')
  ),
  constraint real_estate_energy_certificates_ghg_label_ck check (
    ghg_label is null or ghg_label in ('A', 'B', 'C', 'D', 'E', 'F', 'G')
  ),
  -- VALEUR SANS UNITÉ = VALEUR NON INTERPRÉTABLE. Un 250 sans unité ne veut rien dire.
  constraint real_estate_energy_certificates_energy_unit_ck check (
    case when energy_value is not null then energy_unit is not null else true end
  ),
  constraint real_estate_energy_certificates_ghg_unit_ck check (
    case when ghg_value is not null then ghg_unit is not null else true end
  ),
  constraint real_estate_energy_certificates_validity_ck check (
    valid_until is null or issued_on is null or valid_until > issued_on
  ),
  constraint real_estate_energy_certificates_area_ck check (
    living_area_sqm is null or living_area_sqm > 0
  ),
  constraint real_estate_energy_certificates_year_ck check (
    construction_year is null or (construction_year between 1000 and 2200)
  ),
  constraint real_estate_energy_certificates_row_ck check (row_index >= 0),
  constraint real_estate_energy_certificates_data_kind_ck check (
    data_kind in ('ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING')
  ),
  constraint real_estate_energy_certificates_confidence_ck check (
    confidence in ('HIGH', 'MEDIUM', 'LOW')
  )
);

create unique index if not exists real_estate_energy_certificates_id_user_uidx
  on public.real_estate_energy_certificates(id, user_id);
create unique index if not exists real_estate_energy_certificates_position_uidx
  on public.real_estate_energy_certificates(user_id, snapshot_id, row_index);
create index if not exists real_estate_energy_certificates_snapshot_idx
  on public.real_estate_energy_certificates(snapshot_id, user_id);
create index if not exists real_estate_energy_certificates_geo_idx
  on public.real_estate_energy_certificates(user_id, commune_code, issued_on desc);

comment on table public.real_estate_energy_certificates is
  'Diagnostics de performance énergétique PUBLICS lus dans un instantané. La validité est lue, jamais calculée. Étiquette absente ≠ étiquette G.';
comment on column public.real_estate_energy_certificates.valid_until is
  'Fin de validité TELLE QUE DÉCLARÉE par la source. `null` = inconnue, jamais « valide ».';

-- Brut immuable, même trigger de gel pour les deux tables de lignes.
create or replace function public.real_estate_public_row_frozen()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une ligne lue dans un instantané ne se supprime pas isolément : elle appartient à ce qui a été lu';
  end if;
  if new.raw is distinct from old.raw
     or new.snapshot_id is distinct from old.snapshot_id
     or new.row_index is distinct from old.row_index then
    raise exception 'Ligne % : le contenu lu est immuable', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists real_estate_comparable_sale_frozen on public.real_estate_comparable_sales;
create trigger real_estate_comparable_sale_frozen
  before update or delete on public.real_estate_comparable_sales
  for each row execute function public.real_estate_public_row_frozen();

drop trigger if exists real_estate_energy_certificate_frozen on public.real_estate_energy_certificates;
create trigger real_estate_energy_certificate_frozen
  before update or delete on public.real_estate_energy_certificates
  for each row execute function public.real_estate_public_row_frozen();

-- ---------------------------------------------------------------------------
-- 4. Rapprochement bien ↔ donnée publique — une DÉCISION, pas une déduction
-- ---------------------------------------------------------------------------
-- L'identité se démontre, elle ne se présume pas. Un rapprochement naît CANDIDAT, avec un
-- score et une base nommée, et ne devient ACCEPTÉ que sur décision explicite. Un score
-- élevé n'accepte rien tout seul : une adresse identique désigne un immeuble, pas un lot.

create table if not exists public.property_public_data_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null,
  target text not null,
  snapshot_id uuid not null,
  -- Requis pour un DPE : un diagnostic se rattache à un enregistrement précis. Interdit
  -- pour un jeu de comparables, dont l'unité est l'instantané entier.
  certificate_id uuid,
  -- Composantes NOMMÉES du rapprochement : code commune, code postal, voie, numéro,
  -- surface, distance. Un score sans ses composantes est un chiffre non auditable.
  match_basis jsonb not null,
  match_score numeric(6,4),
  match_confidence text not null,
  state text not null default 'CANDIDATE',
  decided_at timestamptz,
  decided_reason text,
  superseded_by uuid,
  created_at timestamptz not null default now(),
  constraint property_public_data_matches_property_fk
    foreign key (property_id, user_id)
    references public.properties(id, user_id) on delete cascade,
  constraint property_public_data_matches_snapshot_fk
    foreign key (snapshot_id, user_id)
    references public.real_estate_data_snapshots(id, user_id) on delete cascade,
  constraint property_public_data_matches_certificate_fk
    foreign key (certificate_id, user_id)
    references public.real_estate_energy_certificates(id, user_id) on delete cascade,
  constraint property_public_data_matches_target_ck check (
    target in ('COMPARABLE_SET', 'ENERGY_CERTIFICATE')
  ),
  constraint property_public_data_matches_state_ck check (
    state in ('CANDIDATE', 'CONFLICT', 'ACCEPTED', 'REJECTED')
  ),
  constraint property_public_data_matches_confidence_ck check (
    match_confidence in ('HIGH', 'MEDIUM', 'LOW')
  ),
  constraint property_public_data_matches_score_ck check (
    match_score is null or (match_score >= 0 and match_score <= 1)
  ),
  -- Chaque cible a sa forme. Un DPE sans enregistrement rattaché, ou un jeu de comparables
  -- pointant un DPE, seraient deux rapprochements dont personne ne saurait dire l'objet.
  constraint property_public_data_matches_target_shape_ck check (
    case target
      when 'ENERGY_CERTIFICATE' then certificate_id is not null
      when 'COMPARABLE_SET' then certificate_id is null
      else false
    end
  ),
  -- Accepter exige une base nommée et une date de décision. Un rapprochement accepté sans
  -- base serait exactement le « ça se ressemble » que la doctrine refuse.
  constraint property_public_data_matches_accept_shape_ck check (
    case when state = 'ACCEPTED'
      then decided_at is not null and match_basis <> '{}'::jsonb
    else true end
  ),
  -- Accepter un rapprochement FAIBLE exige de dire pourquoi. Le motif est la trace de la
  -- décision humaine, et sans lui un rattachement douteux deviendrait indiscernable d'un
  -- rattachement évident.
  constraint property_public_data_matches_weak_accept_ck check (
    case when state = 'ACCEPTED' and match_confidence = 'LOW'
      then decided_reason is not null and length(btrim(decided_reason)) > 0
    else true end
  ),
  constraint property_public_data_matches_reject_shape_ck check (
    case when state = 'REJECTED' then decided_at is not null else true end
  )
);

create unique index if not exists property_public_data_matches_id_user_uidx
  on public.property_public_data_matches(id, user_id);

-- Un seul rapprochement OUVERT par cible : deux propositions concurrentes sur le même
-- objet obligeraient l'utilisateur à arbitrer entre deux formulations du même doute.
create unique index if not exists property_public_data_matches_open_comparable_uidx
  on public.property_public_data_matches(user_id, property_id, snapshot_id)
  where target = 'COMPARABLE_SET' and state in ('CANDIDATE', 'CONFLICT') and superseded_by is null;
create unique index if not exists property_public_data_matches_open_certificate_uidx
  on public.property_public_data_matches(user_id, property_id, certificate_id)
  where target = 'ENERGY_CERTIFICATE' and state in ('CANDIDATE', 'CONFLICT') and superseded_by is null;

-- UN SEUL jeu de comparables et UN SEUL DPE acceptés à la fois par bien. Deux DPE acceptés
-- rendraient l'étiquette du bien indéterminée ; deux jeux de comparables acceptés
-- rendraient l'estimation de marché indéterminée. L'historique est conservé par supersede.
create unique index if not exists property_public_data_matches_current_comparable_uidx
  on public.property_public_data_matches(user_id, property_id)
  where target = 'COMPARABLE_SET' and state = 'ACCEPTED' and superseded_by is null;
create unique index if not exists property_public_data_matches_current_certificate_uidx
  on public.property_public_data_matches(user_id, property_id)
  where target = 'ENERGY_CERTIFICATE' and state = 'ACCEPTED' and superseded_by is null;

create index if not exists property_public_data_matches_property_idx
  on public.property_public_data_matches(user_id, property_id, created_at desc);
create index if not exists property_public_data_matches_snapshot_idx
  on public.property_public_data_matches(snapshot_id, user_id);
create index if not exists property_public_data_matches_certificate_idx
  on public.property_public_data_matches(certificate_id, user_id)
  where certificate_id is not null;

-- La chaîne de supersede se réfère à elle-même : l'index unique composite doit exister
-- avant que la contrainte puisse le viser. DEFERRABLE parce que marquer l'ancien
-- rapprochement et insérer le nouveau se font dans le même ordre logique, pas dans le même
-- ordre physique.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'property_public_data_matches_superseded_fk'
  ) then
    alter table public.property_public_data_matches
      add constraint property_public_data_matches_superseded_fk
      foreign key (superseded_by, user_id)
      references public.property_public_data_matches(id, user_id)
      on delete set null (superseded_by)
      deferrable initially deferred;
  end if;
end $$;

comment on table public.property_public_data_matches is
  'Rapprochement DÉCIDÉ entre un bien détenu et une donnée publique. Naît CANDIDAT, ne devient ACCEPTÉ que sur décision explicite. Un score n''accepte rien seul.';

-- ---------------------------------------------------------------------------
-- 5. real_estate_valuations — une méthode de plus, et sa preuve obligatoire
-- ---------------------------------------------------------------------------
-- Une estimation par comparables N'EST PAS une estimation notariale ni une expertise. Lui
-- laisser emprunter NOTARY_ESTIMATE ferait passer un modèle pour une observation. Elle
-- reçoit donc son propre nom, et la base exige la preuve qui va avec.

alter table public.real_estate_valuations add column if not exists snapshot_id uuid;
-- Convention et intrants RÉELLEMENT utilisés : nom de la convention, prix unitaire retenu,
-- surface retenue, nombre de comparables, dispersion, exclusions et leur motif. UN CHIFFRE
-- DÉRIVÉ SANS SA CONVENTION EST UN CHIFFRE ORPHELIN.
alter table public.real_estate_valuations add column if not exists derivation jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'real_estate_valuations_snapshot_fk'
  ) then
    -- CASCADE assumé : une valeur dérivée dont la preuve disparaît ne doit pas survivre en
    -- chiffre orphelin. Aucune RPC ne supprime d'instantané, et le trigger de gel le refuse.
    alter table public.real_estate_valuations
      add constraint real_estate_valuations_snapshot_fk
      foreign key (snapshot_id, user_id)
      references public.real_estate_data_snapshots(id, user_id) on delete cascade;
  end if;
end $$;

-- Whitelist de méthodes étendue additivement. L'ancienne contrainte est remplacée par une
-- version nommée : les six méthodes existantes sont conservées à l'identique.
alter table public.real_estate_valuations drop constraint if exists real_estate_valuations_method_ck;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'real_estate_valuations_method_v2_ck'
  ) then
    alter table public.real_estate_valuations add constraint real_estate_valuations_method_v2_ck
      check (
        valuation_method in (
          'MARKET_APPRAISAL', 'NOTARY_ESTIMATE', 'AGENT_ESTIMATE',
          'INDEX_ADJUSTED', 'USER_ESTIMATE', 'PURCHASE_PRICE', 'COMPARABLE_SALES'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'real_estate_valuations_comparable_shape_ck'
  ) then
    -- Une valeur par comparables sans son instantané et sans sa convention serait un chiffre
    -- sans source rattachable. C'est la base qui le refuse, pas l'application.
    alter table public.real_estate_valuations
      add constraint real_estate_valuations_comparable_shape_ck
      check (
        case when valuation_method = 'COMPARABLE_SALES'
          then snapshot_id is not null
               and derivation is not null
               and derivation ? 'convention'
               and derivation ? 'comparable_count'
        else true end
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'real_estate_valuations_snapshot_method_ck'
  ) then
    -- Réciproque : un instantané rattaché à une méthode qui n'en dérive pas laisserait
    -- croire qu'une expertise vient d'un jeu public.
    alter table public.real_estate_valuations
      add constraint real_estate_valuations_snapshot_method_ck
      check (
        case when snapshot_id is not null
          then valuation_method = 'COMPARABLE_SALES'
        else true end
      );
  end if;
end $$;

create index if not exists real_estate_valuations_snapshot_idx
  on public.real_estate_valuations(snapshot_id, user_id)
  where snapshot_id is not null;

comment on column public.real_estate_valuations.derivation is
  'Convention et intrants réellement utilisés par une estimation dérivée. Obligatoire pour COMPARABLE_SALES : un chiffre dérivé sans sa convention est un chiffre orphelin.';
comment on column public.real_estate_valuations.snapshot_id is
  'Instantané de donnée publique qui justifie une estimation par comparables. Obligatoire pour COMPARABLE_SALES, interdit ailleurs.';

-- ---------------------------------------------------------------------------
-- 6. RLS et privilèges de table
-- ---------------------------------------------------------------------------
-- Les tables d'instantané et de lignes lues sont en LECTURE SEULE pour le client : elles
-- portent une piste d'audit, et une piste d'audit qu'on peut récrire ne prouve rien. Les
-- rapprochements le sont aussi : une décision se prend par RPC, pas par un UPDATE direct.

do $$
declare target text;
begin
  foreach target in array array[
    'external_sources',
    'real_estate_data_snapshots',
    'real_estate_comparable_sales',
    'real_estate_energy_certificates',
    'property_public_data_matches'
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
-- 6 bis. Extension ADDITIVE de la RPC de valorisation existante
-- ---------------------------------------------------------------------------
-- `lfo_record_real_estate_valuation` reste l'UNIQUE porte d'écriture de
-- real_estate_valuations. Elle est ici étendue de deux clés de charge, et de rien d'autre.
--
-- Pourquoi une extension plutôt qu'un second chemin d'écriture : la contrainte
-- `real_estate_valuations_comparable_shape_ck` exige la preuve et la convention AU MOMENT DE
-- L'INSERTION. PostgreSQL ne connaît pas de contrainte CHECK différable, donc les poser par
-- un UPDATE ultérieur est impossible. Restaient deux options : insérer depuis la nouvelle
-- RPC — ce qui créerait une seconde vérité d'écriture sur la même table — ou étendre la RPC
-- existante. La seconde est la seule compatible avec « une seule vérité par domaine ».
--
-- Compatibilité : les deux clés sont OPTIONNELLES et valent `null` en leur absence. Tous les
-- appels existants restent donc inchangés dans leur comportement, et les six méthodes
-- préexistantes ne peuvent pas porter d'instantané — la contrainte réciproque l'interdit.
--
-- Cette définition est reprise de la DERNIÈRE version en vigueur de la fonction
-- (`20260826090117_real_estate_v2.sql`, jamais redéfinie depuis), et non de sa première :
-- réécrire une RPC depuis une version périmée fait disparaître silencieusement ce que les
-- migrations ultérieures y avaient ajouté.
create or replace function public.lfo_record_real_estate_valuation(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_property_id uuid;
begin
  v_property_id := (p_payload ->> 'property_id')::uuid;
  if not exists (
    select 1 from public.properties where id = v_property_id and user_id = p_user_id
  ) then
    raise exception 'Bien immobilier introuvable';
  end if;

  v_id := gen_random_uuid();
  insert into public.real_estate_valuations (
    id, user_id, property_id, valued_at, value, currency, valuation_method,
    data_kind, confidence, source, notes,
    -- AJOUT : preuve et convention d'une valeur dérivée. `null` pour toute autre méthode.
    snapshot_id, derivation
  ) values (
    v_id, p_user_id, v_property_id,
    (p_payload ->> 'valued_at')::date,
    (p_payload ->> 'value')::numeric,
    upper(p_payload ->> 'currency'),
    p_payload ->> 'valuation_method',
    coalesce(nullif(p_payload ->> 'data_kind', ''), 'EXTERNAL_DATA'),
    coalesce(nullif(p_payload ->> 'confidence', ''), 'MEDIUM'),
    nullif(p_payload ->> 'source', ''),
    nullif(p_payload ->> 'notes', ''),
    (nullif(p_payload ->> 'snapshot_id', ''))::uuid,
    p_payload -> 'derivation'
  );
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC — écritures composées, aucune formule financière
-- ---------------------------------------------------------------------------

-- Enregistre ou rafraîchit un adaptateur de donnée publique. Ne touche à aucune donnée
-- métier : elle déclare seulement d'où l'on lit, avec quelles capacités et quelle fraîcheur.
create or replace function public.lfo_upsert_public_data_source(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_provider text;
begin
  v_provider := nullif(btrim(p_payload ->> 'provider'), '');
  if v_provider is null then
    raise exception 'Un adaptateur sans provider ne peut pas être identifié';
  end if;

  insert into public.external_sources (
    id, user_id, name, source_type, url, status,
    domain, provider, adapter_version, dataset_version,
    capabilities, declared_coverage, licence, base_url, snapshot_ttl_minutes, created_at, updated_at
  ) values (
    gen_random_uuid(), p_user_id,
    coalesce(nullif(p_payload ->> 'label', ''), v_provider),
    coalesce(nullif(p_payload ->> 'source_type', ''), 'PUBLIC_DATA'),
    nullif(p_payload ->> 'base_url', ''),
    coalesce(nullif(p_payload ->> 'status', ''), 'ACTIVE'),
    coalesce(nullif(p_payload ->> 'domain', ''), 'REAL_ESTATE_PUBLIC_DATA'),
    v_provider,
    coalesce(nullif(p_payload ->> 'adapter_version', ''), '1'),
    nullif(p_payload ->> 'dataset_version', ''),
    coalesce(p_payload -> 'capabilities', '{}'::jsonb),
    coalesce(p_payload -> 'declared_coverage', '{}'::jsonb),
    nullif(p_payload ->> 'licence', ''),
    nullif(p_payload ->> 'base_url', ''),
    coalesce((p_payload ->> 'snapshot_ttl_minutes')::integer, 1440),
    now(), now()
  )
  on conflict (user_id, provider) do update set
    name = excluded.name,
    source_type = excluded.source_type,
    url = excluded.url,
    status = excluded.status,
    domain = excluded.domain,
    adapter_version = excluded.adapter_version,
    dataset_version = excluded.dataset_version,
    capabilities = excluded.capabilities,
    declared_coverage = excluded.declared_coverage,
    licence = excluded.licence,
    base_url = excluded.base_url,
    snapshot_ttl_minutes = excluded.snapshot_ttl_minutes,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Persiste un instantané et ses lignes, en une transaction. `record_count` est DÉRIVÉ des
-- lignes réellement écrites : aucun décompte fourni par l'appelant n'est repris.
--
-- Un échec de lecture s'écrit aussi : il porte son code et zéro ligne. Une lecture tentée
-- laisse toujours une trace, sinon un silence de la source serait indistinguable d'un
-- oubli de l'utilisateur.
create or replace function public.lfo_record_real_estate_snapshot(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_source_id uuid;
  v_status text;
  v_dataset text;
  v_ttl integer;
  v_retrieved timestamptz;
  v_written integer;
  v_row jsonb;
  v_index integer := 0;
begin
  v_source_id := (p_payload ->> 'source_id')::uuid;
  if not exists (
    select 1 from public.external_sources where id = v_source_id and user_id = p_user_id
  ) then
    raise exception 'Adaptateur de donnée publique introuvable';
  end if;

  select snapshot_ttl_minutes into v_ttl
    from public.external_sources where id = v_source_id and user_id = p_user_id;
  if v_ttl is null then
    raise exception 'Adaptateur % sans durée de fraîcheur déclarée : aucun instantané ne serait réutilisable', v_source_id;
  end if;

  v_dataset := p_payload ->> 'dataset';
  v_status := p_payload ->> 'status';
  v_retrieved := coalesce((p_payload ->> 'retrieved_at')::timestamptz, now());

  v_id := gen_random_uuid();
  insert into public.real_estate_data_snapshots (
    id, user_id, source_id, dataset, dataset_version, query, query_hash, payload_hash,
    retrieved_at, stale_after, http_status, record_count,
    coverage_state, coverage_note, status, error_code, error_message,
    data_kind, confidence, source
  ) values (
    v_id, p_user_id, v_source_id, v_dataset,
    nullif(p_payload ->> 'dataset_version', ''),
    coalesce(p_payload -> 'query', '{}'::jsonb),
    p_payload ->> 'query_hash',
    p_payload ->> 'payload_hash',
    v_retrieved,
    v_retrieved + make_interval(mins => v_ttl),
    (p_payload ->> 'http_status')::integer,
    0,
    coalesce(nullif(p_payload ->> 'coverage_state', ''), 'COVERAGE_UNKNOWN'),
    nullif(p_payload ->> 'coverage_note', ''),
    -- Statut provisoire : il est arrêté plus bas, sur les lignes RÉELLEMENT écrites.
    case when v_status in ('FAILED', 'NOT_SERVED') then v_status else 'EMPTY' end,
    nullif(p_payload ->> 'error_code', ''),
    nullif(p_payload ->> 'error_message', ''),
    coalesce(nullif(p_payload ->> 'data_kind', ''), 'EXTERNAL_DATA'),
    coalesce(nullif(p_payload ->> 'confidence', ''), 'MEDIUM'),
    nullif(p_payload ->> 'source', '')
  );

  if v_status in ('FAILED', 'NOT_SERVED') then
    -- Rien à écrire, et surtout : rien à déduire.
    return v_id;
  end if;

  if v_dataset = 'DVF' then
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'sales', '[]'::jsonb))
    loop
      insert into public.real_estate_comparable_sales (
        id, user_id, snapshot_id, row_index, mutation_ref, mutated_on, price, currency,
        property_kind, built_area_sqm, land_area_sqm, room_count, lot_count,
        commune_code, postal_code, street_label, cadastral_section, raw, confidence
      ) values (
        gen_random_uuid(), p_user_id, v_id, v_index,
        nullif(v_row ->> 'mutation_ref', ''),
        (v_row ->> 'mutated_on')::date,
        (v_row ->> 'price')::numeric,
        upper(v_row ->> 'currency'),
        nullif(v_row ->> 'property_kind', ''),
        (nullif(v_row ->> 'built_area_sqm', ''))::numeric,
        (nullif(v_row ->> 'land_area_sqm', ''))::numeric,
        (nullif(v_row ->> 'room_count', ''))::integer,
        (nullif(v_row ->> 'lot_count', ''))::integer,
        nullif(v_row ->> 'commune_code', ''),
        nullif(v_row ->> 'postal_code', ''),
        nullif(v_row ->> 'street_label', ''),
        nullif(v_row ->> 'cadastral_section', ''),
        coalesce(v_row -> 'raw', '{}'::jsonb),
        coalesce(nullif(v_row ->> 'confidence', ''), 'MEDIUM')
      );
      v_index := v_index + 1;
    end loop;

    select count(*) into v_written
      from public.real_estate_comparable_sales
      where user_id = p_user_id and snapshot_id = v_id;

  elsif v_dataset = 'DPE' then
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'certificates', '[]'::jsonb))
    loop
      insert into public.real_estate_energy_certificates (
        id, user_id, snapshot_id, row_index, certificate_ref, issued_on, valid_until,
        method_version, energy_label, energy_value, energy_unit,
        ghg_label, ghg_value, ghg_unit, living_area_sqm, building_kind, construction_year,
        address_label, postal_code, commune_code, raw, confidence
      ) values (
        gen_random_uuid(), p_user_id, v_id, v_index,
        nullif(v_row ->> 'certificate_ref', ''),
        (nullif(v_row ->> 'issued_on', ''))::date,
        (nullif(v_row ->> 'valid_until', ''))::date,
        nullif(v_row ->> 'method_version', ''),
        nullif(v_row ->> 'energy_label', ''),
        (nullif(v_row ->> 'energy_value', ''))::numeric,
        nullif(v_row ->> 'energy_unit', ''),
        nullif(v_row ->> 'ghg_label', ''),
        (nullif(v_row ->> 'ghg_value', ''))::numeric,
        nullif(v_row ->> 'ghg_unit', ''),
        (nullif(v_row ->> 'living_area_sqm', ''))::numeric,
        nullif(v_row ->> 'building_kind', ''),
        (nullif(v_row ->> 'construction_year', ''))::integer,
        nullif(v_row ->> 'address_label', ''),
        nullif(v_row ->> 'postal_code', ''),
        nullif(v_row ->> 'commune_code', ''),
        coalesce(v_row -> 'raw', '{}'::jsonb),
        coalesce(nullif(v_row ->> 'confidence', ''), 'MEDIUM')
      );
      v_index := v_index + 1;
    end loop;

    select count(*) into v_written
      from public.real_estate_energy_certificates
      where user_id = p_user_id and snapshot_id = v_id;
  else
    raise exception 'Jeu de données % non pris en charge', v_dataset;
  end if;

  update public.real_estate_data_snapshots
    set record_count = v_written,
        status = case when v_written > 0 then 'RETRIEVED' else 'EMPTY' end
    where id = v_id and user_id = p_user_id;

  update public.external_sources
    set last_success_at = now(), last_error = null, updated_at = now()
    where id = v_source_id and user_id = p_user_id;

  return v_id;
end;
$$;

-- Ajoute un lot de lignes à un instantané déjà ouvert.
--
-- Elle existe parce qu'un instantané peut porter plus de lignes qu'une charge de requête n'en
-- transporte raisonnablement. Elle ne rouvre RIEN : le contenu déjà écrit reste immuable (le
-- trigger de gel le garantit), et seul le décompte est recalculé — DÉRIVÉ des lignes
-- persistées, jamais repris d'un total fourni par l'appelant.
--
-- `row_offset` est imposé par l'appelant parce que la position d'une ligne dans la LECTURE
-- doit être conservée : la recalculer depuis le nombre de lignes déjà écrites la ferait
-- dépendre de l'ordre d'arrivée des lots.
create or replace function public.lfo_append_real_estate_snapshot_rows(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_dataset text;
  v_offset integer;
  v_index integer;
  v_row jsonb;
  v_written integer;
begin
  v_snapshot_id := (p_payload ->> 'snapshot_id')::uuid;
  v_offset := coalesce((p_payload ->> 'row_offset')::integer, 0);
  if v_offset < 0 then
    raise exception 'Décalage de ligne négatif : la position d''une ligne dans la lecture ne se devine pas';
  end if;

  select dataset into v_dataset
    from public.real_estate_data_snapshots
    where id = v_snapshot_id and user_id = p_user_id;
  if not found then
    raise exception 'Instantané introuvable';
  end if;

  v_index := v_offset;

  if v_dataset = 'DVF' then
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'sales', '[]'::jsonb))
    loop
      insert into public.real_estate_comparable_sales (
        id, user_id, snapshot_id, row_index, mutation_ref, mutated_on, price, currency,
        property_kind, built_area_sqm, land_area_sqm, room_count, lot_count,
        commune_code, postal_code, street_label, cadastral_section, raw, confidence
      ) values (
        gen_random_uuid(), p_user_id, v_snapshot_id, v_index,
        nullif(v_row ->> 'mutation_ref', ''),
        (v_row ->> 'mutated_on')::date,
        (v_row ->> 'price')::numeric,
        upper(v_row ->> 'currency'),
        nullif(v_row ->> 'property_kind', ''),
        (nullif(v_row ->> 'built_area_sqm', ''))::numeric,
        (nullif(v_row ->> 'land_area_sqm', ''))::numeric,
        (nullif(v_row ->> 'room_count', ''))::integer,
        (nullif(v_row ->> 'lot_count', ''))::integer,
        nullif(v_row ->> 'commune_code', ''),
        nullif(v_row ->> 'postal_code', ''),
        nullif(v_row ->> 'street_label', ''),
        nullif(v_row ->> 'cadastral_section', ''),
        coalesce(v_row -> 'raw', '{}'::jsonb),
        coalesce(nullif(v_row ->> 'confidence', ''), 'MEDIUM')
      );
      v_index := v_index + 1;
    end loop;

    select count(*) into v_written
      from public.real_estate_comparable_sales
      where user_id = p_user_id and snapshot_id = v_snapshot_id;

  elsif v_dataset = 'DPE' then
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'certificates', '[]'::jsonb))
    loop
      insert into public.real_estate_energy_certificates (
        id, user_id, snapshot_id, row_index, certificate_ref, issued_on, valid_until,
        method_version, energy_label, energy_value, energy_unit,
        ghg_label, ghg_value, ghg_unit, living_area_sqm, building_kind, construction_year,
        address_label, postal_code, commune_code, raw, confidence
      ) values (
        gen_random_uuid(), p_user_id, v_snapshot_id, v_index,
        nullif(v_row ->> 'certificate_ref', ''),
        (nullif(v_row ->> 'issued_on', ''))::date,
        (nullif(v_row ->> 'valid_until', ''))::date,
        nullif(v_row ->> 'method_version', ''),
        nullif(v_row ->> 'energy_label', ''),
        (nullif(v_row ->> 'energy_value', ''))::numeric,
        nullif(v_row ->> 'energy_unit', ''),
        nullif(v_row ->> 'ghg_label', ''),
        (nullif(v_row ->> 'ghg_value', ''))::numeric,
        nullif(v_row ->> 'ghg_unit', ''),
        (nullif(v_row ->> 'living_area_sqm', ''))::numeric,
        nullif(v_row ->> 'building_kind', ''),
        (nullif(v_row ->> 'construction_year', ''))::integer,
        nullif(v_row ->> 'address_label', ''),
        nullif(v_row ->> 'postal_code', ''),
        nullif(v_row ->> 'commune_code', ''),
        coalesce(v_row -> 'raw', '{}'::jsonb),
        coalesce(nullif(v_row ->> 'confidence', ''), 'MEDIUM')
      );
      v_index := v_index + 1;
    end loop;

    select count(*) into v_written
      from public.real_estate_energy_certificates
      where user_id = p_user_id and snapshot_id = v_snapshot_id;
  else
    raise exception 'Jeu de données % non pris en charge', v_dataset;
  end if;

  update public.real_estate_data_snapshots
    set record_count = v_written,
        status = case when v_written > 0 then 'RETRIEVED' else 'EMPTY' end
    where id = v_snapshot_id and user_id = p_user_id;

  return v_written;
end;
$$;

-- Propose un rapprochement. Refuse ce qui ne peut pas être rapproché : un instantané vide,
-- en échec, ou hors couverture déclarée ne rapproche rien.
create or replace function public.lfo_propose_property_public_data_match(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_property_id uuid;
  v_snapshot_id uuid;
  v_certificate_id uuid;
  v_target text;
  v_snapshot record;
begin
  v_property_id := (p_payload ->> 'property_id')::uuid;
  v_snapshot_id := (p_payload ->> 'snapshot_id')::uuid;
  v_certificate_id := (nullif(p_payload ->> 'certificate_id', ''))::uuid;
  v_target := p_payload ->> 'target';

  if not exists (
    select 1 from public.properties where id = v_property_id and user_id = p_user_id
  ) then
    raise exception 'Bien immobilier introuvable';
  end if;

  select * into v_snapshot
    from public.real_estate_data_snapshots
    where id = v_snapshot_id and user_id = p_user_id;
  if not found then
    raise exception 'Instantané de donnée publique introuvable';
  end if;

  -- RÉSULTAT VIDE ≠ ABSENCE DE MARCHÉ, et un vide ne se rapproche de rien.
  if v_snapshot.status <> 'RETRIEVED' then
    raise exception 'Instantané % au statut % : aucun rapprochement ne peut s''y appuyer', v_snapshot_id, v_snapshot.status;
  end if;
  if v_snapshot.coverage_state = 'DECLARED_NOT_COVERED' then
    raise exception 'Instantané % déclaré hors couverture : ce qu''il ne contient pas ne prouve rien', v_snapshot_id;
  end if;

  if v_target = 'ENERGY_CERTIFICATE' then
    if v_certificate_id is null then
      raise exception 'Un rapprochement de DPE désigne un diagnostic précis, pas un instantané entier';
    end if;
    if not exists (
      select 1 from public.real_estate_energy_certificates
      where id = v_certificate_id and user_id = p_user_id and snapshot_id = v_snapshot_id
    ) then
      raise exception 'Diagnostic % introuvable dans l''instantané %', v_certificate_id, v_snapshot_id;
    end if;
  elsif v_target = 'COMPARABLE_SET' then
    if v_certificate_id is not null then
      raise exception 'Un jeu de comparables ne désigne aucun diagnostic';
    end if;
    if v_snapshot.dataset <> 'DVF' then
      raise exception 'Un jeu de comparables se lit dans un instantané DVF, pas dans %', v_snapshot.dataset;
    end if;
  else
    raise exception 'Cible de rapprochement % non prise en charge', v_target;
  end if;

  -- Une base de rapprochement vide n'est pas une base : elle rendrait la décision
  -- inauditable, et la contrainte d'acceptation la refuserait de toute façon.
  if coalesce(p_payload -> 'match_basis', '{}'::jsonb) = '{}'::jsonb then
    raise exception 'Rapprochement sans base nommée : un score seul ne se relit pas';
  end if;

  v_id := gen_random_uuid();
  insert into public.property_public_data_matches (
    id, user_id, property_id, target, snapshot_id, certificate_id,
    match_basis, match_score, match_confidence, state
  ) values (
    v_id, p_user_id, v_property_id, v_target, v_snapshot_id, v_certificate_id,
    p_payload -> 'match_basis',
    (nullif(p_payload ->> 'match_score', ''))::numeric,
    coalesce(nullif(p_payload ->> 'match_confidence', ''), 'LOW'),
    coalesce(nullif(p_payload ->> 'state', ''), 'CANDIDATE')
  );
  return v_id;
end;
$$;

-- Tranche un rapprochement. Accepter remplace le rapprochement courant de la même cible
-- par supersede : deux acceptations simultanées rendraient l'étiquette ou l'estimation
-- indéterminées, et l'index partiel les refuse.
create or replace function public.lfo_decide_property_public_data_match(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match record;
  v_decision text;
  v_reason text;
  v_superseded integer := 0;
begin
  v_decision := p_payload ->> 'decision';
  v_reason := nullif(btrim(p_payload ->> 'reason'), '');

  select * into v_match
    from public.property_public_data_matches
    where id = (p_payload ->> 'match_id')::uuid and user_id = p_user_id
    for update;
  if not found then
    raise exception 'Rapprochement introuvable';
  end if;
  if v_match.state not in ('CANDIDATE', 'CONFLICT') then
    raise exception 'Rapprochement déjà tranché (%) : une décision ne se rejoue pas', v_match.state;
  end if;
  if v_match.superseded_by is not null then
    raise exception 'Rapprochement remplacé : il ne se tranche plus';
  end if;

  if v_decision = 'REJECT' then
    update public.property_public_data_matches
      set state = 'REJECTED', decided_at = now(), decided_reason = v_reason
      where id = v_match.id and user_id = p_user_id;
    return 0;
  end if;

  if v_decision <> 'ACCEPT' then
    raise exception 'Décision % non prise en charge', v_decision;
  end if;

  -- Un rapprochement faible accepté sans motif serait indiscernable d'un rapprochement
  -- évident. La base le refuse ; le message le dit avant.
  if v_match.match_confidence = 'LOW' and v_reason is null then
    raise exception 'Rapprochement de confiance faible : un motif explicite est requis pour l''accepter';
  end if;

  -- Remplacement du rapprochement courant de la même cible, s'il existe.
  if v_match.target = 'ENERGY_CERTIFICATE' then
    update public.property_public_data_matches
      set superseded_by = v_match.id
      where user_id = p_user_id
        and property_id = v_match.property_id
        and target = 'ENERGY_CERTIFICATE'
        and state = 'ACCEPTED'
        and superseded_by is null
        and id <> v_match.id;
    get diagnostics v_superseded = row_count;
  else
    update public.property_public_data_matches
      set superseded_by = v_match.id
      where user_id = p_user_id
        and property_id = v_match.property_id
        and target = 'COMPARABLE_SET'
        and state = 'ACCEPTED'
        and superseded_by is null
        and id <> v_match.id;
    get diagnostics v_superseded = row_count;
  end if;

  update public.property_public_data_matches
    set state = 'ACCEPTED', decided_at = now(), decided_reason = v_reason
    where id = v_match.id and user_id = p_user_id;

  return v_superseded;
end;
$$;

-- Promeut une estimation de marché en valorisation canonique.
--
-- Cette RPC NE CALCULE PAS la valeur, et ce partage est délibéré :
--
--   * la médiane d'un prix au m² multipliée par une surface est une FORMULE FINANCIÈRE.
--     La constitution la place en TypeScript, dans un moteur pur et testé, jamais en SQL ;
--
--   * mais un nombre reçu du client ne doit pas pouvoir être arbitraire. La base VÉRIFIE
--     donc, sans recalculer : elle exige un rapprochement ACCEPTÉ, un instantané encore
--     frais, une surface déclarée, un nombre minimal de comparables, et elle refuse toute
--     valeur qui sort de l'INTERVALLE des prix unitaires réellement persistés multiplié par
--     la surface. Un encadrement n'est pas un calcul de valorisation : c'est un contrôle
--     d'intégrité, du même ordre que Σdébits = Σcrédits.
create or replace function public.lfo_promote_real_estate_market_estimate(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match record;
  v_snapshot record;
  v_surface numeric;
  v_value numeric;
  v_currency text;
  v_valued_at date;
  v_count integer;
  v_min_unit numeric;
  v_max_unit numeric;
  v_min_allowed numeric;
  v_max_allowed numeric;
  v_derivation jsonb;
  v_valuation_id uuid;
begin
  select * into v_match
    from public.property_public_data_matches
    where id = (p_payload ->> 'match_id')::uuid and user_id = p_user_id;
  if not found then
    raise exception 'Rapprochement introuvable';
  end if;
  if v_match.target <> 'COMPARABLE_SET' then
    raise exception 'Seul un jeu de comparables produit une estimation de marché';
  end if;
  if v_match.state <> 'ACCEPTED' or v_match.superseded_by is not null then
    raise exception 'Le jeu de comparables doit être ACCEPTÉ et courant : une estimation ne se fonde pas sur un rapprochement non tranché';
  end if;

  select * into v_snapshot
    from public.real_estate_data_snapshots
    where id = v_match.snapshot_id and user_id = p_user_id;
  if not found then
    raise exception 'Instantané justifiant le rapprochement introuvable';
  end if;
  -- Un instantané périmé n'est pas faux, mais il ne fonde pas une écriture canonique
  -- silencieuse : relire est un acte gratuit, écrire un chiffre périmé ne l'est pas.
  if v_snapshot.stale_after <= now() then
    raise exception 'Instantané périmé depuis % : relisez la source avant d''écrire une valorisation', v_snapshot.stale_after;
  end if;

  -- SURFACE ABSENTE ≠ SURFACE NULLE : sans surface déclarée, l'estimation n'est pas
  -- calculable, et elle ne se remplace pas par une hypothèse.
  select surface_sqm into v_surface
    from public.properties where id = v_match.property_id and user_id = p_user_id;
  if v_surface is null or v_surface <= 0 then
    raise exception 'Surface du bien non déclarée : une estimation au mètre carré n''est pas calculable';
  end if;

  -- Intervalle des prix unitaires RÉELLEMENT persistés. Les mutations multi-lots et celles
  -- sans surface en sont exclues : elles n'ont pas de prix unitaire.
  select count(*), min(price / built_area_sqm), max(price / built_area_sqm)
    into v_count, v_min_unit, v_max_unit
    from public.real_estate_comparable_sales
    where user_id = p_user_id
      and snapshot_id = v_match.snapshot_id
      and built_area_sqm is not null
      and price > 0
      and coalesce(lot_count, 1) = 1;

  if v_count is null or v_count = 0 then
    raise exception 'Aucune mutation exploitable dans l''instantané : sans surface ni prix unitaire, il n''y a rien à comparer';
  end if;

  v_value := (p_payload ->> 'value')::numeric;
  v_currency := upper(p_payload ->> 'currency');
  v_valued_at := (p_payload ->> 'valued_at')::date;
  v_derivation := p_payload -> 'derivation';

  if v_value is null or v_currency is null or v_valued_at is null then
    raise exception 'Valeur, devise et date d''estimation sont requises';
  end if;
  if v_derivation is null or not (v_derivation ? 'convention') then
    raise exception 'Une estimation dérivée porte le NOM de sa convention, sans quoi le chiffre est orphelin';
  end if;

  -- Encadrement : contrôle d'intégrité, pas de valorisation. Une valeur hors de l'intervalle
  -- observé ne peut pas venir des comparables persistés.
  v_min_allowed := v_min_unit * v_surface;
  v_max_allowed := v_max_unit * v_surface;
  if v_value < v_min_allowed or v_value > v_max_allowed then
    raise exception
      'Valeur % hors de l''intervalle des comparables persistés (% à % pour % m²) : elle ne dérive pas de cet instantané',
      v_value, round(v_min_allowed, 2), round(v_max_allowed, 2), v_surface;
  end if;

  -- Écriture par le CHEMIN EXISTANT : lfo_record_real_estate_valuation reste l'unique
  -- porte d'entrée de real_estate_valuations. Aucune seconde vérité de valorisation.
  -- Les intrants RÉELLEMENT utilisés sont ajoutés à la convention fournie, et non
  -- substitués : l'appelant nomme sa convention, la base atteste ce qu'elle a mesuré.
  v_derivation := v_derivation
    || jsonb_build_object(
         'match_id', v_match.id,
         'comparable_count', v_count,
         'unit_price_min', v_min_unit,
         'unit_price_max', v_max_unit,
         'surface_sqm', v_surface
       );

  -- La preuve et la convention entrent DANS l'insertion : la contrainte de forme les exige
  -- au moment de l'écriture, et une contrainte CHECK n'est pas différable.
  v_valuation_id := public.lfo_record_real_estate_valuation(
    p_user_id,
    jsonb_build_object(
      'property_id', v_match.property_id,
      'valued_at', v_valued_at,
      'value', v_value,
      'currency', v_currency,
      'valuation_method', 'COMPARABLE_SALES',
      -- MODEL_ASSUMPTION, et non EXTERNAL_DATA : les mutations sont des faits externes,
      -- l'estimation qui s'en déduit est un modèle sous convention déclarée.
      'data_kind', 'MODEL_ASSUMPTION',
      'confidence', coalesce(nullif(p_payload ->> 'confidence', ''), 'LOW'),
      'source', coalesce(nullif(p_payload ->> 'source', ''), v_snapshot.dataset),
      'notes', nullif(p_payload ->> 'notes', ''),
      'snapshot_id', v_match.snapshot_id,
      'derivation', v_derivation
    )
  );

  return v_valuation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Privilèges des RPC
-- ---------------------------------------------------------------------------
revoke all on function
  public.lfo_upsert_public_data_source(uuid, jsonb),
  public.lfo_record_real_estate_snapshot(uuid, jsonb),
  public.lfo_append_real_estate_snapshot_rows(uuid, jsonb),
  public.lfo_propose_property_public_data_match(uuid, jsonb),
  public.lfo_decide_property_public_data_match(uuid, jsonb),
  public.lfo_promote_real_estate_market_estimate(uuid, jsonb)
from public, anon, authenticated;

grant execute on function
  public.lfo_upsert_public_data_source(uuid, jsonb),
  public.lfo_record_real_estate_snapshot(uuid, jsonb),
  public.lfo_append_real_estate_snapshot_rows(uuid, jsonb),
  public.lfo_propose_property_public_data_match(uuid, jsonb),
  public.lfo_decide_property_public_data_match(uuid, jsonb),
  public.lfo_promote_real_estate_market_estimate(uuid, jsonb)
to service_role;
