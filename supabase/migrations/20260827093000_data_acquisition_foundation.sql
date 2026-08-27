-- Léo Family Office — Data Acquisition Foundation
--
-- Jusqu'ici, tout fait entrait dans LFO par une saisie. Le seul chemin d'import existant
-- était le coffre `documents` : un fichier stocké, sans lecture, sans provenance, sans
-- lien avec un fait financier. Cette migration pose la couche d'ACQUISITION manquante.
--
-- Ce qu'elle ajoute, et rien de plus :
--
--   import_sources             d'où l'information vient. Une source connaît son domaine
--                              cible, son adaptateur, son état et la période qu'elle a
--                              réellement alimentée.
--
--   import_sessions            un acte d'import. Fichier, empreinte, encodage,
--                              séparateur, mapping appliqué, conventions retenues,
--                              décomptes, résultat. C'est la pièce qui répond plus tard à
--                              « pourquoi cette donnée existe-t-elle dans LFO ? ».
--
--   import_raw_records         ce que la source a RÉELLEMENT fourni. Immuable : un
--                              trigger refuse toute mise à jour. Corriger une lecture ne
--                              réécrit jamais ce que la banque a dit.
--
--   import_normalized_records  ce que le parseur en a compris, avec ses ambiguïtés, son
--                              statut et son verdict de déduplication. C'est le STAGING :
--                              y écrire ne modifie AUCUNE vérité canonique.
--
--   import_record_links        le pont entre une ligne normalisée et le fait canonique
--                              qu'elle a produit. Une colonne cible par domaine, avec sa
--                              vraie clé étrangère : ajouter un domaine est une migration
--                              additive, pas une intégrité de façade.
--
--   import_column_mappings     un mapping validé par l'utilisateur, réutilisable pour une
--                              signature de format IDENTIQUE, jamais approchante.
--
-- Ce qu'elle ne fait PAS, volontairement :
--
--   * aucune formule financière en SQL. Les RPC résolvent des références et écrivent de
--     façon atomique. Toute la lecture d'un relevé vit dans `src/lib/acquisition/`.
--   * aucune catégorie de flux inventée. Une transaction issue d'un import naît avec
--     `category_id` NULL, et le Cash Flow Engine la compte comme NON CLASSÉE.
--   * aucun solde recalculé. `account_balances` reste la vérité observée du compte : une
--     somme de lignes importées n'en est pas une seconde.
--   * aucun transfert interne rapproché. `transfer_group_id` appartient au Cash Flow
--     Engine, qui seul décide de la nature économique d'un flux.
--   * aucune profondeur d'historique déclarée. La période OBSERVÉE d'un import ne certifie
--     pas son exhaustivité : `profiles.ledger_coverage_start` reste une déclaration de
--     l'utilisateur, et cette migration n'y touche pas.

-- ---------------------------------------------------------------------------
-- 0. Cibles composites (id, user_id) pour les clés étrangères de propriété
-- ---------------------------------------------------------------------------
-- Même règle que `portfolio_events` : une ligne portant user A ne doit pas pouvoir
-- désigner le compte, la transaction ou le document de user B, même par écriture directe.

create unique index if not exists documents_id_user_uidx
  on public.documents(id, user_id);

-- ---------------------------------------------------------------------------
-- 1. Registre des sources
-- ---------------------------------------------------------------------------

create table if not exists public.import_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Nature technique. `API` et `MANUAL` sont déclarés parce qu'une source peut changer de
  -- nature sans changer d'identité : le même compte bancaire alimenté par fichier
  -- aujourd'hui et par connecteur demain reste la même source.
  kind text not null,
  -- Domaine canonique alimenté. Un seul existe : y en ajouter un suppose d'ajouter la
  -- colonne de liaison correspondante dans `import_record_links`.
  domain text not null,
  -- NOT NULL volontaire : sur un index unique, deux `null` sont distincts, et une source
  -- sans provider pourrait donc être créée en double pour le même compte.
  provider text not null,
  label text not null,
  -- Enveloppe cible pour le domaine Cash Flow. `null` pour un domaine qui n'en a pas.
  target_account_id uuid,
  status text not null default 'FILE_ONLY',
  adapter_version text not null,
  -- Période RÉELLEMENT alimentée par les sessions committées de cette source. C'est une
  -- observation cumulée, jamais une certification d'exhaustivité.
  coverage_start date,
  coverage_end date,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  notes text,
  data_kind text not null default 'ACTUAL',
  confidence text not null default 'HIGH',
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_sources_account_fk
    foreign key (target_account_id, user_id)
    references public.financial_accounts(id, user_id) on delete cascade,
  constraint import_sources_kind_ck check (kind in ('FILE_CSV', 'API', 'MANUAL')),
  constraint import_sources_domain_ck check (domain in ('CASH_FLOW_TRANSACTION')),
  constraint import_sources_status_ck check (
    status in ('ACTIVE', 'STALE', 'REAUTH_REQUIRED', 'RATE_LIMITED', 'ERROR',
               'DISCONNECTED', 'FILE_ONLY', 'MANUAL')
  ),
  constraint import_sources_data_kind_ck check (
    data_kind in ('ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING')
  ),
  -- Le domaine Cash Flow exige une enveloppe : une transaction sans compte ne serait
  -- réconciliable par rien.
  constraint import_sources_domain_shape_ck check (
    case when domain = 'CASH_FLOW_TRANSACTION' then target_account_id is not null else true end
  ),
  constraint import_sources_coverage_order_ck check (
    coverage_start is null or coverage_end is null or coverage_end >= coverage_start
  )
);

-- Une source par (provider, domaine, enveloppe) : deux registres pour le même flux
-- feraient deux historiques de couverture contradictoires.
create unique index if not exists import_sources_account_provider_uidx
  on public.import_sources(user_id, domain, provider, target_account_id)
  where target_account_id is not null;
create unique index if not exists import_sources_id_user_uidx
  on public.import_sources(id, user_id);
create index if not exists import_sources_user_idx on public.import_sources(user_id, created_at desc);
create index if not exists import_sources_account_idx
  on public.import_sources(target_account_id, user_id)
  where target_account_id is not null;

comment on table public.import_sources is
  'Registre des sources d''acquisition. Une source connaît son domaine cible, son adaptateur, son état et la période qu''elle a réellement alimentée.';
comment on column public.import_sources.coverage_start is
  'Début de la période réellement alimentée par les imports committés. Observation cumulée, jamais une certification d''exhaustivité.';

-- ---------------------------------------------------------------------------
-- 2. Sessions d'import
-- ---------------------------------------------------------------------------

create table if not exists public.import_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null,
  file_name text,
  -- SHA-256 hexadécimal du fichier reçu. Clé d'idempotence : le même contenu ne peut pas
  -- être committé deux fois pour la même source.
  file_hash text,
  file_size_bytes bigint,
  content_type text,
  encoding text,
  delimiter text,
  parser text not null,
  parser_version text not null,
  -- Mapping RÉELLEMENT appliqué et conventions RÉELLEMENT retenues. Sans elles, un montant
  -- relu dans six mois ne serait plus explicable.
  mapping jsonb,
  conventions jsonb,
  -- Devise déclarée pour cet import quand la source n'en fournit aucune. Déclaration
  -- explicite, jamais héritée en silence du compte cible.
  declared_currency char(3),
  -- Date à laquelle l'import est RÉELLEMENT effectué. Distincte de la date d'arrêté du
  -- reporting : une opération bookée la veille est un fait réel même si le cockpit arrête
  -- ses comptes le mois précédent. C'est elle, et elle seule, qui qualifie une date de
  -- future pendant la lecture du fichier.
  observation_date date,
  -- L'utilisateur DÉCLARE-T-IL que la colonne d'identifiant de ce format porte un
  -- identifiant unique et stable ? `false` par défaut : aucun nom d'en-tête ne le prouve,
  -- et seule une identité démontrée autorise un rejet automatique de doublon.
  stable_transaction_id_declared boolean not null default false,
  -- Période que l'utilisateur DÉCLARE avoir exportée. Distincte de la période observée, et
  -- volontairement non branchée sur `profiles.ledger_coverage_start`.
  declared_period_start date,
  declared_period_end date,
  observed_period_start date,
  observed_period_end date,
  status text not null,
  row_count integer not null default 0,
  ready_count integer not null default 0,
  warning_count integer not null default 0,
  blocked_count integer not null default 0,
  duplicate_count integer not null default 0,
  ignored_count integer not null default 0,
  committed_count integer not null default 0,
  -- Fichier conservé dans le coffre privé, quand l'utilisateur l'a demandé.
  document_id uuid,
  issues jsonb not null default '[]'::jsonb,
  error text,
  analyzed_at timestamptz not null default now(),
  committed_at timestamptz,
  discarded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint import_sessions_source_fk
    foreign key (source_id, user_id)
    references public.import_sources(id, user_id) on delete cascade,
  constraint import_sessions_document_fk
    foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete set null (document_id),
  constraint import_sessions_status_ck check (
    status in ('ANALYZED', 'COMMITTED', 'DISCARDED', 'FAILED')
  ),
  constraint import_sessions_counts_ck check (
    row_count >= 0 and ready_count >= 0 and warning_count >= 0 and blocked_count >= 0
    and duplicate_count >= 0 and ignored_count >= 0 and committed_count >= 0
  ),
  -- Une session committée dit COMBIEN et QUAND. Sans ces deux faits, l'audit s'arrête.
  constraint import_sessions_committed_shape_ck check (
    case when status = 'COMMITTED' then committed_at is not null else true end
  ),
  constraint import_sessions_file_hash_ck check (
    file_hash is null or file_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint import_sessions_declared_period_ck check (
    declared_period_start is null or declared_period_end is null
    or declared_period_end >= declared_period_start
  ),
  constraint import_sessions_observed_period_ck check (
    observed_period_start is null or observed_period_end is null
    or observed_period_end >= observed_period_start
  )
);

-- IDEMPOTENCE : un contenu de fichier ne peut être COMMITTÉ qu'une fois par source. Une
-- session analysée puis abandonnée ne bloque rien ; une session committée bloque, et c'est
-- exactement le but — réimporter le même relevé ne doit pas doubler les données, même si
-- le moteur de déduplication était contourné.
create unique index if not exists import_sessions_committed_file_uidx
  on public.import_sessions(user_id, source_id, file_hash)
  where file_hash is not null and status = 'COMMITTED';
create unique index if not exists import_sessions_id_user_uidx
  on public.import_sessions(id, user_id);
create index if not exists import_sessions_source_idx
  on public.import_sessions(source_id, user_id, created_at desc);
create index if not exists import_sessions_user_idx
  on public.import_sessions(user_id, created_at desc);
create index if not exists import_sessions_document_idx
  on public.import_sessions(document_id, user_id)
  where document_id is not null;

comment on table public.import_sessions is
  'Un acte d''import : fichier, empreinte, mapping appliqué, conventions retenues, décomptes et résultat. Piste d''audit d''une donnée importée.';

-- ---------------------------------------------------------------------------
-- 3. Enregistrements bruts — immuables
-- ---------------------------------------------------------------------------

create table if not exists public.import_raw_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  -- Numéro de ligne DANS LE FICHIER : c'est celui que l'utilisateur lit dans son tableur.
  row_number integer not null,
  raw_line text not null,
  cells jsonb not null,
  created_at timestamptz not null default now(),
  constraint import_raw_records_session_fk
    foreign key (session_id, user_id)
    references public.import_sessions(id, user_id) on delete cascade,
  constraint import_raw_records_row_uk unique (user_id, session_id, row_number),
  constraint import_raw_records_row_number_ck check (row_number > 0),
  constraint import_raw_records_cells_ck check (jsonb_typeof(cells) = 'array')
);

create unique index if not exists import_raw_records_id_user_uidx
  on public.import_raw_records(id, user_id);
create index if not exists import_raw_records_session_idx
  on public.import_raw_records(session_id, user_id, row_number);

-- Le brut ne se corrige pas, et il ne s'efface pas non plus.
--
-- Une transaction reçue pour 51,84 € reste ce que la banque a dit, même quand
-- l'utilisateur reclasse la dépense : c'est la ligne NORMALISÉE ou le fait CANONIQUE qui
-- change, jamais l'observation source.
--
-- Ne protéger que l'UPDATE ne suffisait pas : une SUPPRESSION du brut cascade vers la
-- ligne normalisée et son lien de provenance, et laisserait donc survivre une transaction
-- importée dont l'origine aurait disparu. La suppression n'est autorisée que sur une
-- session ENCORE ANALYSÉE — le chemin d'abandon officiel, qui n'a produit aucun fait.
create or replace function public.import_raw_record_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Un enregistrement brut est immuable : corriger la ligne normalisée, pas la source';
  end if;
  select status into v_status
    from public.import_sessions
   where id = old.session_id and user_id = old.user_id;

  -- Session déjà absente : la suppression vient de la CASCADE d'une session supprimée. Ce
  -- chemin n'est ouvert qu'à `service_role`, et il est lui-même barré dès qu'une ligne
  -- normalisée de la session est committée — le gel de la provenance refuse alors sa propre
  -- cascade. Une session sans fait écrit peut donc être remplacée ; une session qui en a
  -- produit ne peut pas disparaître.
  if v_status is null then
    return old;
  end if;

  if v_status <> 'ANALYZED' then
    raise exception
      'Enregistrement brut d''une session % : la provenance d''un fait écrit ne se supprime pas',
      v_status;
  end if;
  return old;
end;
$$;

drop trigger if exists import_raw_records_immutable on public.import_raw_records;
create trigger import_raw_records_immutable
  before update or delete on public.import_raw_records
  for each row execute function public.import_raw_record_immutable();

comment on table public.import_raw_records is
  'Ce que la source a réellement fourni, ligne par ligne. Immuable : un trigger refuse toute mise à jour, et toute suppression hors abandon d''une session encore analysée.';

-- ---------------------------------------------------------------------------
-- 4. Enregistrements normalisés — le staging
-- ---------------------------------------------------------------------------

create table if not exists public.import_normalized_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  raw_record_id uuid not null,
  target_domain text not null,
  account_id uuid,
  transaction_date date,
  value_date date,
  label text,
  -- Montant SIGNÉ en devise native. `null` = non compris ou absent, jamais zéro.
  amount numeric(20,6),
  currency char(3),
  -- Identifiant PRÉTENDU par la source. Conservé tel quel ; il ne devient une identité
  -- que si la session déclare sa stabilité.
  external_transaction_id text,
  -- Référence descriptive : référence bancaire, numéro d'opération, motif. Une banque peut
  -- la répéter ou la réutiliser : elle ne décide JAMAIS d'une identité.
  reference text,
  counterparty text,
  balance_after numeric(20,6),
  status text not null,
  -- `null` = déduplication NON ÉVALUÉE (ligne vide, hors périmètre, ou trop incomplète
  -- pour avoir une identité). Ce n'est pas « nouvelle ».
  dedupe_verdict text,
  -- Clé de RAPPROCHEMENT, lisible, servant à expliquer pourquoi deux lignes se ressemblent.
  -- Ce n'est PAS une identité : aucune contrainte d'unicité ne s'y appuie, parce qu'une
  -- égalité de tuple entre deux fichiers distincts ne prouve pas qu'il s'agit de la même
  -- opération. Y mettre une unicité supprimerait des dépenses réelles.
  match_key text,
  -- Identité DÉMONTRÉE, préfixée par la source. Renseignée uniquement quand la stabilité
  -- de l'identifiant est déclarée. C'est la seule colonne qui porte une unicité.
  external_key text,
  matched_transaction_id uuid,
  issues jsonb not null default '[]'::jsonb,
  commit_state text not null default 'PENDING',
  committed_at timestamptz,
  data_kind text not null default 'ACTUAL',
  confidence text not null default 'HIGH',
  source text,
  created_at timestamptz not null default now(),
  constraint import_normalized_records_session_fk
    foreign key (session_id, user_id)
    references public.import_sessions(id, user_id) on delete cascade,
  constraint import_normalized_records_raw_fk
    foreign key (raw_record_id, user_id)
    references public.import_raw_records(id, user_id) on delete cascade,
  constraint import_normalized_records_account_fk
    foreign key (account_id, user_id)
    references public.financial_accounts(id, user_id) on delete cascade,
  -- Le doublon désigné peut disparaître : le lien se détache, la ligne reste.
  constraint import_normalized_records_matched_fk
    foreign key (matched_transaction_id, user_id)
    references public.transactions(id, user_id)
    on delete set null (matched_transaction_id),
  -- Une ligne brute produit UNE lecture. Deux lectures concurrentes de la même ligne
  -- seraient deux vérités normalisées du même fait.
  constraint import_normalized_records_raw_uk unique (user_id, raw_record_id),
  constraint import_normalized_records_domain_ck check (target_domain in ('CASH_FLOW_TRANSACTION')),
  constraint import_normalized_records_status_ck check (
    status in ('READY', 'WARNING', 'BLOCKED', 'DUPLICATE', 'IGNORED')
  ),
  constraint import_normalized_records_verdict_ck check (
    dedupe_verdict is null
    or dedupe_verdict in ('NEW', 'EXACT_DUPLICATE', 'PROBABLE_DUPLICATE', 'POSSIBLE_MATCH')
  ),
  constraint import_normalized_records_commit_state_ck check (
    commit_state in ('PENDING', 'COMMITTED', 'EXCLUDED')
  ),
  constraint import_normalized_records_data_kind_ck check (
    data_kind in ('ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING')
  ),
  constraint import_normalized_records_issues_ck check (jsonb_typeof(issues) = 'array'),
  -- READY signifie COMMITTABLE. Une ligne prête dont le montant, la date, la devise ou le
  -- libellé manquerait produirait une transaction incomplète : la base le refuse.
  constraint import_normalized_records_ready_shape_ck check (
    case
      when status = 'READY' or status = 'WARNING' then
        transaction_date is not null and label is not null
        and amount is not null and currency is not null and account_id is not null
      else true
    end
  ),
  -- Seule une ligne prête ou signalée peut avoir été écrite. Un doublon, une ligne bloquée
  -- ou ignorée committée serait précisément le bug que cette couche existe pour empêcher.
  constraint import_normalized_records_committable_ck check (
    case
      when commit_state = 'COMMITTED' then status in ('READY', 'WARNING') and committed_at is not null
      else true
    end
  )
);

-- La clé de rapprochement est INDEXÉE, jamais UNIQUE.
--
-- Une unicité sur (compte, date, montant, devise, libellé) supprimerait des faits réels :
-- trois cafés identiques le même jour sont trois dépenses, et un relevé partiel qui en
-- contient un ne prouve pas qu'il s'agit d'un des deux déjà connus. L'idempotence est
-- portée là où l'identité est réellement démontrable : l'empreinte du FICHIER au niveau
-- session, et l'identifiant stable ci-dessous.
create index if not exists import_normalized_records_match_key_idx
  on public.import_normalized_records(user_id, account_id, match_key)
  where match_key is not null;
-- Idempotence par IDENTITÉ DÉMONTRÉE : un identifiant stable ne s'écrit qu'une fois.
create unique index if not exists import_normalized_records_committed_external_uidx
  on public.import_normalized_records(user_id, external_key)
  where commit_state = 'COMMITTED' and external_key is not null;
create unique index if not exists import_normalized_records_id_user_uidx
  on public.import_normalized_records(id, user_id);
create index if not exists import_normalized_records_session_idx
  on public.import_normalized_records(session_id, user_id, status);
create index if not exists import_normalized_records_raw_idx
  on public.import_normalized_records(raw_record_id, user_id);
create index if not exists import_normalized_records_account_idx
  on public.import_normalized_records(account_id, user_id)
  where account_id is not null;
create index if not exists import_normalized_records_matched_idx
  on public.import_normalized_records(matched_transaction_id, user_id)
  where matched_transaction_id is not null;
create index if not exists import_normalized_records_user_idx
  on public.import_normalized_records(user_id, created_at desc);

comment on table public.import_normalized_records is
  'Staging : ce que le parseur a compris d''une ligne brute, avec ses anomalies, son statut et son verdict de déduplication. Y écrire ne modifie aucune vérité canonique.';
comment on column public.import_normalized_records.dedupe_verdict is
  'null = déduplication non évaluée (ligne vide, hors périmètre ou incomplète). Ce n''est pas « nouvelle ».';
comment on column public.import_normalized_records.match_key is
  'Clé de rapprochement lisible. PAS une identité : aucune unicité ne s''y appuie, une égalité de tuple entre deux fichiers ne prouvant pas la même opération.';
comment on column public.import_normalized_records.external_key is
  'Identité démontrée (identifiant stable déclaré), préfixée par la source. Seule colonne portant une unicité.';

-- ---------------------------------------------------------------------------
-- 5. Liens vers les faits canoniques
-- ---------------------------------------------------------------------------

create table if not exists public.import_record_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  normalized_record_id uuid not null,
  target_domain text not null,
  -- Une colonne cible par domaine, avec sa vraie clé étrangère. Ajouter Portfolio ou Real
  -- Estate demandera une colonne et une ligne de check : c'est le prix d'une intégrité
  -- réelle plutôt que d'un `target_id uuid` sans contrainte.
  transaction_id uuid,
  created_at timestamptz not null default now(),
  constraint import_record_links_session_fk
    foreign key (session_id, user_id)
    references public.import_sessions(id, user_id) on delete cascade,
  constraint import_record_links_normalized_fk
    foreign key (normalized_record_id, user_id)
    references public.import_normalized_records(id, user_id) on delete cascade,
  -- PAS de cascade, et c'est l'invariant d'audit : supprimer une transaction importée
  -- alors que sa provenance existe encore la laisserait étiquetée « importée » sans
  -- pouvoir dire d'où elle vient. La suppression est REFUSÉE ; le jour où un chemin de
  -- suppression existera, il devra retirer la provenance explicitement.
  constraint import_record_links_transaction_fk
    foreign key (transaction_id, user_id)
    references public.transactions(id, user_id) on delete restrict,
  constraint import_record_links_normalized_uk unique (user_id, normalized_record_id),
  constraint import_record_links_transaction_uk unique (user_id, transaction_id),
  constraint import_record_links_domain_ck check (target_domain in ('CASH_FLOW_TRANSACTION')),
  constraint import_record_links_target_ck check (
    case when target_domain = 'CASH_FLOW_TRANSACTION' then transaction_id is not null else false end
  )
);

create index if not exists import_record_links_session_idx
  on public.import_record_links(session_id, user_id);
create index if not exists import_record_links_normalized_idx
  on public.import_record_links(normalized_record_id, user_id);
create index if not exists import_record_links_transaction_idx
  on public.import_record_links(transaction_id, user_id);
create index if not exists import_record_links_user_idx
  on public.import_record_links(user_id, created_at desc);

comment on table public.import_record_links is
  'Pont entre une ligne normalisée et le fait canonique qu''elle a produit. Répond à « pourquoi cette donnée existe-t-elle ? ».';

-- ---------------------------------------------------------------------------
-- 6. Mappings mémorisés
-- ---------------------------------------------------------------------------

create table if not exists public.import_column_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Signature du format : en-têtes normalisés et séparateur. Un mapping n'est réutilisé
  -- que pour une signature IDENTIQUE. « Presque le même fichier » n'est pas le même.
  signature text not null,
  provider text,
  label text not null,
  headers jsonb not null,
  mapping jsonb not null,
  conventions jsonb,
  version integer not null default 1,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint import_column_mappings_signature_uk unique (user_id, signature),
  constraint import_column_mappings_headers_ck check (jsonb_typeof(headers) = 'array'),
  constraint import_column_mappings_mapping_ck check (jsonb_typeof(mapping) = 'object'),
  constraint import_column_mappings_version_ck check (version > 0)
);

create index if not exists import_column_mappings_user_idx
  on public.import_column_mappings(user_id, confirmed_at desc);

comment on table public.import_column_mappings is
  'Mapping colonne → champ validé par l''utilisateur, réutilisable pour une signature de format identique. Versionné, jamais supposé éternel.';

-- ---------------------------------------------------------------------------
-- 6 bis. Gel de la provenance d'un fait écrit
-- ---------------------------------------------------------------------------

-- Une ligne normalisée COMMITTÉE est gelée. Sans ce gel, la provenance d'un fait canonique
-- pourrait être réécrite après coup : un montant, une date ou un statut modifiés
-- raconteraient une autre histoire que celle qui a réellement produit la transaction.
create or replace function public.import_normalized_record_frozen()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.commit_state <> 'COMMITTED' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Seule exception au gel : le JUMEAU DÉSIGNÉ a disparu. `matched_transaction_id` ne
  -- décrit pas le fait produit par cette ligne, seulement l'opération à laquelle elle
  -- ressemblait ; sa suppression est un fait, pas une falsification. Tout le reste doit
  -- être inchangé, sinon c'est une réécriture de provenance déguisée.
  if
    tg_op = 'UPDATE'
    and new.matched_transaction_id is null
    and old.matched_transaction_id is not null
    and new.session_id = old.session_id
    and new.raw_record_id = old.raw_record_id
    and new.commit_state = old.commit_state
    and new.status = old.status
    and new.account_id is not distinct from old.account_id
    and new.transaction_date is not distinct from old.transaction_date
    and new.label is not distinct from old.label
    and new.amount is not distinct from old.amount
    and new.currency is not distinct from old.currency
    and new.dedupe_verdict is not distinct from old.dedupe_verdict
    and new.match_key is not distinct from old.match_key
    and new.external_key is not distinct from old.external_key
    and new.issues is not distinct from old.issues
  then
    return new;
  end if;

  raise exception 'Ligne normalisée déjà écrite au canonique : sa provenance est gelée';
end;
$$;

drop trigger if exists import_normalized_records_frozen on public.import_normalized_records;
create trigger import_normalized_records_frozen
  before update or delete on public.import_normalized_records
  for each row execute function public.import_normalized_record_frozen();

-- Un lien de provenance est créé une fois, à la validation, et ne change jamais. Le
-- modifier permettrait de faire pointer une transaction existante vers une autre ligne
-- source, donc de falsifier l'audit sans rien supprimer.
create or replace function public.import_record_link_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Un lien de provenance est immuable';
end;
$$;

drop trigger if exists import_record_links_immutable on public.import_record_links;
create trigger import_record_links_immutable
  before update on public.import_record_links
  for each row execute function public.import_record_link_immutable();

-- ---------------------------------------------------------------------------
-- 7. RLS et privilèges — piste d'audit en LECTURE SEULE
-- ---------------------------------------------------------------------------
-- Le balayage de la migration initiale ne s'est exécuté qu'une fois : chaque table créée
-- après lui doit poser sa propre isolation.
--
-- Contrairement aux tables de domaine, les tables d'acquisition n'accordent à
-- `authenticated` que le SELECT. Toutes leurs écritures passent par les RPC `lfo_*`,
-- réservées à `service_role`.
--
-- Ce n'est pas un durcissement décoratif. Une piste d'audit sur laquelle le client peut
-- écrire n'est pas une piste d'audit : un DELETE direct sur un enregistrement brut ou sur
-- un lien de provenance laisserait survivre une transaction étiquetée « importée » dont
-- l'origine aurait disparu. La politique `owner_all` reste `FOR ALL` — elle exprime la
-- PROPRIÉTÉ des lignes — et c'est le privilège de table qui refuse la commande.

do $$
declare target text;
begin
  foreach target in array array[
    'import_sources', 'import_sessions', 'import_raw_records',
    'import_normalized_records', 'import_record_links', 'import_column_mappings'
  ]
  loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists owner_all on public.%I', target);
    execute format(
      'create policy owner_all on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      target
    );
    -- `revoke all` est nécessaire avant le grant : la migration initiale accorde en bloc
    -- les quatre commandes sur toutes les tables du schéma, et une migration ultérieure
    -- pourrait le refaire. Le verifier contrôle l'état final.
    execute format('revoke all on table public.%I from anon, authenticated', target);
    execute format('grant select on table public.%I to authenticated', target);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. RPC — écritures composées, aucune formule financière
-- ---------------------------------------------------------------------------

-- Persiste une analyse complète : source, session, lignes brutes et lignes normalisées,
-- en une seule transaction. AUCUNE écriture canonique n'a lieu ici : c'est le dry-run.
--
-- Idempotence : une session ANALYSÉE portant la même empreinte de fichier pour la même
-- source est REMPLACÉE — réanalyser après avoir corrigé un mapping est légitime. Une
-- session déjà COMMITTÉE est refusée : le même contenu ne s'écrit pas deux fois.
create or replace function public.lfo_analyze_import_session(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source jsonb := p_payload -> 'source';
  v_session jsonb := p_payload -> 'session';
  v_source_id uuid;
  v_session_id uuid;
  v_account_id uuid;
  v_file_hash text;
  v_raw jsonb;
  v_normalized jsonb;
begin
  if v_source is null or v_session is null then
    raise exception 'Charge d''analyse incomplète : source et session sont obligatoires';
  end if;

  v_account_id := nullif(v_source ->> 'target_account_id', '')::uuid;
  if v_account_id is null then
    raise exception 'Enveloppe cible obligatoire pour le domaine Cash Flow';
  end if;
  if not exists (
    select 1 from public.financial_accounts
     where id = v_account_id and user_id = p_user_id and status = 'ACTIVE'
  ) then
    raise exception 'Compte cible introuvable ou inactif';
  end if;

  -- Registre des sources : une source par (domaine, provider, enveloppe).
  insert into public.import_sources (
    user_id, kind, domain, provider, label, target_account_id, status, adapter_version,
    notes, source
  ) values (
    p_user_id,
    v_source ->> 'kind',
    v_source ->> 'domain',
    v_source ->> 'provider',
    v_source ->> 'label',
    v_account_id,
    coalesce(nullif(v_source ->> 'status', ''), 'FILE_ONLY'),
    v_source ->> 'adapter_version',
    nullif(v_source ->> 'notes', ''),
    nullif(v_source ->> 'source', '')
  )
  on conflict (user_id, domain, provider, target_account_id) where target_account_id is not null
  do update set
    label = excluded.label,
    adapter_version = excluded.adapter_version,
    last_attempt_at = now(),
    updated_at = now()
  returning id into v_source_id;

  v_file_hash := nullif(v_session ->> 'file_hash', '');

  if v_file_hash is not null and exists (
    select 1 from public.import_sessions
     where user_id = p_user_id and source_id = v_source_id
       and file_hash = v_file_hash and status = 'COMMITTED'
  ) then
    raise exception 'Ce fichier a déjà été importé et validé pour cette source';
  end if;

  -- Une analyse antérieure du même contenu est remplacée : elle n'a produit aucun fait.
  if v_file_hash is not null then
    delete from public.import_sessions
     where user_id = p_user_id and source_id = v_source_id
       and file_hash = v_file_hash and status = 'ANALYZED';
  end if;

  insert into public.import_sessions (
    user_id, source_id, file_name, file_hash, file_size_bytes, content_type,
    encoding, delimiter, parser, parser_version, mapping, conventions,
    declared_currency, observation_date, stable_transaction_id_declared,
    declared_period_start, declared_period_end,
    observed_period_start, observed_period_end, status,
    row_count, ready_count, warning_count, blocked_count, duplicate_count, ignored_count,
    document_id, issues
  ) values (
    p_user_id, v_source_id,
    nullif(v_session ->> 'file_name', ''),
    v_file_hash,
    nullif(v_session ->> 'file_size_bytes', '')::bigint,
    nullif(v_session ->> 'content_type', ''),
    nullif(v_session ->> 'encoding', ''),
    nullif(v_session ->> 'delimiter', ''),
    v_session ->> 'parser',
    v_session ->> 'parser_version',
    v_session -> 'mapping',
    v_session -> 'conventions',
    upper(nullif(v_session ->> 'declared_currency', '')),
    nullif(v_session ->> 'observation_date', '')::date,
    coalesce((v_session ->> 'stable_transaction_id_declared')::boolean, false),
    nullif(v_session ->> 'declared_period_start', '')::date,
    nullif(v_session ->> 'declared_period_end', '')::date,
    nullif(v_session ->> 'observed_period_start', '')::date,
    nullif(v_session ->> 'observed_period_end', '')::date,
    'ANALYZED',
    coalesce(nullif(v_session ->> 'row_count', '')::integer, 0),
    coalesce(nullif(v_session ->> 'ready_count', '')::integer, 0),
    coalesce(nullif(v_session ->> 'warning_count', '')::integer, 0),
    coalesce(nullif(v_session ->> 'blocked_count', '')::integer, 0),
    coalesce(nullif(v_session ->> 'duplicate_count', '')::integer, 0),
    coalesce(nullif(v_session ->> 'ignored_count', '')::integer, 0),
    nullif(v_session ->> 'document_id', '')::uuid,
    coalesce(v_session -> 'issues', '[]'::jsonb)
  )
  returning id into v_session_id;

  v_raw := coalesce(p_payload -> 'raw', '[]'::jsonb);
  if jsonb_typeof(v_raw) <> 'array' then
    raise exception 'Les lignes brutes doivent être un tableau';
  end if;

  insert into public.import_raw_records (user_id, session_id, row_number, raw_line, cells)
  select
    p_user_id, v_session_id,
    (entry ->> 'row_number')::integer,
    coalesce(entry ->> 'raw_line', ''),
    coalesce(entry -> 'cells', '[]'::jsonb)
  from jsonb_array_elements(v_raw) as entry;

  v_normalized := coalesce(p_payload -> 'normalized', '[]'::jsonb);
  if jsonb_typeof(v_normalized) <> 'array' then
    raise exception 'Les lignes normalisées doivent être un tableau';
  end if;

  -- Chaque ligne normalisée est rattachée à SA ligne brute par le numéro de ligne du
  -- fichier : c'est ce rattachement qui rend la provenance traçable jusqu'à la cellule.
  insert into public.import_normalized_records (
    user_id, session_id, raw_record_id, target_domain, account_id,
    transaction_date, value_date, label, amount, currency, external_transaction_id,
    reference, counterparty, balance_after, status, dedupe_verdict, match_key,
    external_key, matched_transaction_id, issues, source
  )
  select
    p_user_id, v_session_id, raw.id,
    'CASH_FLOW_TRANSACTION',
    v_account_id,
    nullif(entry ->> 'transaction_date', '')::date,
    nullif(entry ->> 'value_date', '')::date,
    nullif(entry ->> 'label', ''),
    nullif(entry ->> 'amount', '')::numeric,
    upper(nullif(entry ->> 'currency', '')),
    nullif(entry ->> 'external_transaction_id', ''),
    nullif(entry ->> 'reference', ''),
    nullif(entry ->> 'counterparty', ''),
    nullif(entry ->> 'balance_after', '')::numeric,
    entry ->> 'status',
    nullif(entry ->> 'dedupe_verdict', ''),
    nullif(entry ->> 'match_key', ''),
    nullif(entry ->> 'external_key', ''),
    nullif(entry ->> 'matched_transaction_id', '')::uuid,
    coalesce(entry -> 'issues', '[]'::jsonb),
    nullif(v_session ->> 'parser', '')
  from jsonb_array_elements(v_normalized) as entry
  join public.import_raw_records raw
    on raw.session_id = v_session_id
   and raw.user_id = p_user_id
   and raw.row_number = (entry ->> 'row_number')::integer;

  return v_session_id;
end;
$$;

-- Écrit les faits canoniques d'une session analysée.
--
-- Une seule frontière est franchie ici, et elle l'est explicitement :
--   * READY est écrit ;
--   * WARNING est écrit UNIQUEMENT si l'utilisateur l'a nommément inclus ;
--   * BLOCKED, DUPLICATE et IGNORED ne sont jamais écrits.
--
-- La transaction créée naît SANS catégorie : le Cash Flow Engine la comptera comme non
-- classée, et c'est la vérité. Aucun solde n'est recalculé.
--
-- Idempotence : une session déjà committée retourne son identifiant sans rien réécrire.
create or replace function public.lfo_commit_import_session(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid := (p_payload ->> 'session_id')::uuid;
  v_include uuid[] := coalesce(
    (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_payload -> 'include_record_ids', '[]'::jsonb)) as value),
    array[]::uuid[]
  );
  v_status text;
  v_source_id uuid;
  v_committed integer := 0;
  v_period_start date;
  v_period_end date;
begin
  select status, source_id into v_status, v_source_id
    from public.import_sessions
   where id = v_session_id and user_id = p_user_id
     for update;

  if v_status is null then
    raise exception 'Session d''import introuvable';
  end if;
  if v_status = 'COMMITTED' then
    return v_session_id;
  end if;
  if v_status <> 'ANALYZED' then
    raise exception 'Session d''import non validable (statut %)', v_status;
  end if;

  -- Une seule instruction écrit les trois faits : la transaction, son lien de provenance
  -- et l'état de la ligne normalisée. `as materialized` n'est pas décoratif : `batch`
  -- appelle `gen_random_uuid()` et est lu trois fois. Sans matérialisation forcée, une
  -- réévaluation produirait des identifiants différents dans chaque branche, et les liens
  -- de provenance désigneraient des transactions inexistantes.
  with batch as materialized (
    select
      id as normalized_id,
      gen_random_uuid() as transaction_id,
      account_id, transaction_date, label, amount, currency
      from public.import_normalized_records
     where session_id = v_session_id
       and user_id = p_user_id
       and commit_state = 'PENDING'
       and (status = 'READY' or (status = 'WARNING' and id = any (v_include)))
  ),
  inserted as (
    insert into public.transactions (
      id, user_id, account_id, category_id, transaction_date, label, amount, currency,
      data_kind, confidence, source, manual_override
    )
    select
      batch.transaction_id, p_user_id, batch.account_id, null,
      batch.transaction_date, batch.label, batch.amount, batch.currency,
      -- Observé par la banque, pas supposé par LFO. `manual_override = false` distingue un
      -- fait importé d'une saisie, et aucune catégorie n'est inventée.
      'ACTUAL', 'HIGH', 'Import ' || v_session_id::text, false
    from batch
    returning id
  ),
  linked as (
    insert into public.import_record_links (
      user_id, session_id, normalized_record_id, target_domain, transaction_id
    )
    select p_user_id, v_session_id, batch.normalized_id, 'CASH_FLOW_TRANSACTION', batch.transaction_id
    from batch
    returning normalized_record_id
  )
  update public.import_normalized_records
     set commit_state = 'COMMITTED', committed_at = now()
   where user_id = p_user_id
     and id in (select normalized_id from batch);

  select count(*)::integer into v_committed from public.import_record_links
   where session_id = v_session_id and user_id = p_user_id;

  -- Tout le reste de la session est explicitement EXCLU : une ligne laissée PENDING
  -- laisserait croire qu'elle attend encore une décision.
  update public.import_normalized_records
     set commit_state = 'EXCLUDED'
   where session_id = v_session_id and user_id = p_user_id and commit_state = 'PENDING';

  select min(transaction_date), max(transaction_date)
    into v_period_start, v_period_end
    from public.import_normalized_records
   where session_id = v_session_id and user_id = p_user_id and commit_state = 'COMMITTED';

  update public.import_sessions
     set status = 'COMMITTED', committed_at = now(), committed_count = v_committed
   where id = v_session_id and user_id = p_user_id;

  -- Période RÉELLEMENT alimentée par cette source, cumulée. Observation, pas certification.
  update public.import_sources
     set coverage_start = least(coverage_start, v_period_start),
         coverage_end = greatest(coverage_end, v_period_end),
         last_success_at = now(),
         last_error = null,
         updated_at = now()
   where id = v_source_id and user_id = p_user_id;

  return v_session_id;
end;
$$;

-- Abandonne une analyse. La session reste dans l'historique avec ses décomptes ; ses
-- lignes de staging sont libérées, parce qu'elles n'ont produit aucun fait. Une session
-- committée n'est pas abandonnable : on n'annule pas un fait en effaçant sa trace.
create or replace function public.lfo_discard_import_session(
  p_user_id uuid,
  p_session_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.import_sessions
   where id = p_session_id and user_id = p_user_id
     for update;
  if v_status is null then
    raise exception 'Session d''import introuvable';
  end if;
  if v_status <> 'ANALYZED' then
    raise exception 'Seule une session analysée peut être abandonnée (statut %)', v_status;
  end if;

  -- Ordre imposé par les gardes d'immuabilité : les lignes normalisées d'abord (aucune
  -- n'est committée sur une session ANALYSÉE), puis le brut. Le statut ne passe à
  -- DISCARDED qu'ensuite, sans quoi la garde du brut refuserait sa propre suppression.
  delete from public.import_normalized_records
   where session_id = p_session_id and user_id = p_user_id;

  delete from public.import_raw_records
   where session_id = p_session_id and user_id = p_user_id;

  update public.import_sessions
     set status = 'DISCARDED', discarded_at = now()
   where id = p_session_id and user_id = p_user_id;

  return p_session_id;
end;
$$;

-- Mémorise un mapping validé pour une signature de format. Une nouvelle validation
-- incrémente la version : un mapping n'est jamais supposé éternel.
create or replace function public.lfo_save_import_mapping(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.import_column_mappings (
    user_id, signature, provider, label, headers, mapping, conventions
  ) values (
    p_user_id,
    p_payload ->> 'signature',
    nullif(p_payload ->> 'provider', ''),
    p_payload ->> 'label',
    coalesce(p_payload -> 'headers', '[]'::jsonb),
    coalesce(p_payload -> 'mapping', '{}'::jsonb),
    p_payload -> 'conventions'
  )
  on conflict (user_id, signature) do update
    set provider = excluded.provider,
        label = excluded.label,
        headers = excluded.headers,
        mapping = excluded.mapping,
        conventions = excluded.conventions,
        version = public.import_column_mappings.version + 1,
        confirmed_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.lfo_analyze_import_session(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lfo_commit_import_session(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lfo_discard_import_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.lfo_save_import_mapping(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_analyze_import_session(uuid, jsonb) to service_role;
grant execute on function public.lfo_commit_import_session(uuid, jsonb) to service_role;
grant execute on function public.lfo_discard_import_session(uuid, uuid) to service_role;
grant execute on function public.lfo_save_import_mapping(uuid, jsonb) to service_role;
