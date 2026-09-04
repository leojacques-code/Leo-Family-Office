-- ---------------------------------------------------------------------------
-- OPEN BANKING — AGRÉGATION DE COMPTES (AIS), LECTURE SEULE
-- ---------------------------------------------------------------------------
-- Cinquième verticale de la fondation d'acquisition. Elle l'ÉTEND sans la dupliquer, et
-- sans élargir aucune whitelist de domaine : une synchronisation bancaire alimente le MÊME
-- domaine cible qu'un relevé CSV, `CASH_FLOW_TRANSACTION`, et `import_sources.kind` prévoit
-- déjà `'API'`. Aucune contrainte partagée n'est donc remplacée par celle de l'Open Banking.
--
-- Ce qui est RÉUTILISÉ tel quel, sans une colonne ajoutée :
--
--   `import_sources`             registre de la source, une par compte canonique alimenté
--   `import_sessions`            l'acte de synchronisation, ses décomptes et son statut
--   `import_raw_records`         le BRUT par opération, immuable
--   `import_normalized_records`  le staging, ses verdicts et son état de commit
--   `import_record_links`        la provenance du fait canonique produit
--   `transactions`               le fait canonique, écrit par la seule porte existante
--
-- Ce que cette verticale AJOUTE, parce que rien ne le porte :
--
--   fournisseur et établissement, avec leurs CAPACITÉS DÉCLARÉES
--   consentement, daté, expirable et révocable
--   compte FOURNISSEUR, distinct de tout compte canonique
--   observation de SOLDE, distincte d'un solde canonique
--   page BRUTE d'API, unité réelle de ce qu'un fournisseur a rendu
--   observation d'opération, DURABLE et transverse aux synchronisations
--   décision humaine de réconciliation, durable elle aussi
--   curseur de reprise, exécutions et erreurs, événements de notification
--
-- ```text
-- OBSERVATION ≠ FAIT CANONIQUE            PENDING ≠ BOOKED
-- COMPTE FOURNISSEUR ≠ COMPTE CANONIQUE   SOLDE OBSERVÉ ≠ SOLDE CANONIQUE
-- SOLDE ABSENT ≠ SOLDE À ZÉRO             MONTANT ABSENT ≠ ZÉRO
-- IDENTIFIANT FOURNI ≠ IDENTITÉ DÉMONTRÉE RESSEMBLANCE ≠ DOUBLON
-- CAPACITÉ NON DÉCLARÉE ≠ CAPACITÉ ABSENTE EXPIRATION NON DÉCLARÉE ≠ SANS EXPIRATION
-- PAGE VIDE ≠ FIN DE PAGINATION           RÉFÉRENCE DE SECRET ≠ SECRET
-- ```
--
-- AUCUNE INITIATION DE PAIEMENT. Aucune table, aucune colonne et aucune RPC de ce fichier
-- ne décrit un ordre, un bénéficiaire de virement ou un mandat. Ce n'est pas une omission :
-- le périmètre est l'agrégation en lecture.
--
-- AUCUN SECRET N'EST PERSISTÉ. Les tables ne portent AUCUNE colonne capable d'accueillir un
-- jeton, un secret client ou une clé de signature : elles ne portent qu'une RÉFÉRENCE
-- OPAQUE — un nom de coffre et une clé dans ce coffre. Tant qu'aucun coffre à secrets n'est
-- validé pour ce dépôt, c'est la seule chose que la base sait de l'authentification, et un
-- jeton, même chiffré, n'y a pas de place où aller.

-- ---------------------------------------------------------------------------
-- 1. Fournisseurs et établissements
-- ---------------------------------------------------------------------------

create table if not exists public.bank_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Identifiant de l'ADAPTATEUR, pas de la marque : c'est le code qui lit, et sa version
  -- décide de la façon dont une réponse a été comprise.
  adapter_id text not null,
  adapter_version text not null,
  label text not null,
  auth_mode text not null,
  -- Capacités DÉCLARÉES par l'adaptateur, telles quelles. Elles ne sont jamais devinées :
  -- un fournisseur qui ne déclare pas ses identifiants stables n'en a pas, et la
  -- déduplication automatique est alors interdite.
  capabilities jsonb not null,
  base_url text,
  -- RÉFÉRENCE de secret, jamais un secret. Les deux colonnes désignent un coffre EXTERNE.
  secret_vault text,
  secret_key text,
  status text not null default 'DISCONNECTED',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_providers_adapter_uk unique (user_id, adapter_id),
  constraint bank_providers_auth_mode_ck check (
    auth_mode in ('OAUTH2_AUTHORIZATION_CODE', 'API_KEY', 'FIXTURE')
  ),
  constraint bank_providers_status_ck check (
    status in ('ACTIVE', 'STALE', 'REAUTH_REQUIRED', 'RATE_LIMITED', 'ERROR', 'DISCONNECTED')
  ),
  constraint bank_providers_capabilities_ck check (jsonb_typeof(capabilities) = 'object'),
  -- Une référence de secret est un COUPLE : un coffre sans clé ne désigne rien, une clé
  -- sans coffre ne dit pas où chercher.
  constraint bank_providers_secret_shape_ck check (
    (secret_vault is null and secret_key is null)
    or (secret_vault is not null and secret_key is not null)
  ),
  -- Forme d'une RÉFÉRENCE : courte, sans espace, sans point-virgule. Elle ne peut pas
  -- accueillir un jeton porteur. Ce n'est pas la garantie principale — la garantie est
  -- l'ABSENCE de colonne de valeur — mais elle rend l'erreur bruyante.
  constraint bank_providers_secret_reference_ck check (
    secret_key is null or secret_key ~ '^[A-Za-z0-9_.:/-]{1,200}$'
  ),
  -- Un adaptateur qui ne s'appuie sur aucun secret est un adaptateur de FIXTURE. Tout autre
  -- mode d'authentification exige de savoir OÙ le secret est conservé.
  constraint bank_providers_auth_secret_ck check (
    case when auth_mode = 'FIXTURE' then true else secret_vault is not null end
  )
);

create unique index if not exists bank_providers_id_user_uidx
  on public.bank_providers(id, user_id);
create index if not exists bank_providers_user_idx
  on public.bank_providers(user_id, created_at desc);

comment on table public.bank_providers is
  'Agrégateur de données bancaires et capacités qu''il DÉCLARE. Ne porte aucune valeur de secret : seulement une référence opaque vers un coffre externe.';
comment on column public.bank_providers.secret_key is
  'Clé dans un coffre EXTERNE. Jamais la valeur du secret : aucune colonne de cette table ne peut en accueillir une.';

create table if not exists public.bank_institutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null,
  -- Identifiant de l'établissement CHEZ LE FOURNISSEUR. Deux agrégateurs numérotent la même
  -- banque différemment : ce n'est pas une identité universelle.
  provider_institution_id text not null,
  name text not null,
  country_code char(2),
  -- Rattachement à l'établissement canonique, quand l'utilisateur l'a décidé. `null` = non
  -- rattaché, jamais un établissement créé d'office.
  institution_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_institutions_provider_fk
    foreign key (provider_id, user_id)
    references public.bank_providers(id, user_id) on delete cascade,
  constraint bank_institutions_institution_fk
    foreign key (institution_id) references public.institutions(id) on delete set null,
  constraint bank_institutions_provider_uk unique (user_id, provider_id, provider_institution_id)
);

create unique index if not exists bank_institutions_id_user_uidx
  on public.bank_institutions(id, user_id);
create index if not exists bank_institutions_provider_idx
  on public.bank_institutions(provider_id, user_id);

comment on table public.bank_institutions is
  'Établissement tel qu''un agrégateur le désigne. Rattaché à l''établissement canonique sur décision, jamais créé d''office.';

-- ---------------------------------------------------------------------------
-- 2. Consentements
-- ---------------------------------------------------------------------------
-- Un consentement est une AUTORISATION DATÉE, pas un état permanent. Trois faits sont
-- distincts et ne se déduisent pas l'un de l'autre :
--
--   EXPIRATION NON DÉCLARÉE ≠ SANS EXPIRATION : un fournisseur qui ne dit pas quand le
--   consentement expire n'a pas donné un consentement éternel. `expiry_declared` porte la
--   différence, et la base refuse une date d'expiration sans déclaration comme une
--   déclaration sans date.
--
--   RÉVOQUÉ ≠ EXPIRÉ : l'un est une décision de l'utilisateur, l'autre l'écoulement du
--   temps. Les confondre ferait proposer un renouvellement là où l'accès a été retiré.
--
--   ACTIF ≠ UTILISABLE : un consentement actif dont la portée ne couvre pas les
--   transactions ne permet pas de les lire, et la base l'énonce par ses portées.

create table if not exists public.bank_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null,
  bank_institution_id uuid,
  -- Référence du consentement CHEZ LE FOURNISSEUR.
  consent_reference text not null,
  scopes text[] not null,
  status text not null,
  requested_at timestamptz not null default now(),
  granted_at timestamptz,
  expiry_declared boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  last_error text,
  -- Référence de secret PROPRE au consentement, quand elle diffère de celle du fournisseur.
  secret_vault text,
  secret_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_consents_provider_fk
    foreign key (provider_id, user_id)
    references public.bank_providers(id, user_id) on delete cascade,
  constraint bank_consents_institution_fk
    foreign key (bank_institution_id, user_id)
    references public.bank_institutions(id, user_id) on delete set null (bank_institution_id),
  constraint bank_consents_reference_uk unique (user_id, provider_id, consent_reference),
  constraint bank_consents_status_ck check (
    status in ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REAUTH_REQUIRED', 'ERROR')
  ),
  constraint bank_consents_scopes_ck check (
    cardinality(scopes) >= 1
    and scopes <@ array['ACCOUNTS', 'BALANCES', 'TRANSACTIONS']::text[]
  ),
  constraint bank_consents_expiry_shape_ck check (
    case when expiry_declared then expires_at is not null else expires_at is null end
  ),
  -- Un consentement actif a été ACCORDÉ. Sans date d'octroi, rien ne dit depuis quand la
  -- lecture est autorisée.
  constraint bank_consents_active_shape_ck check (
    case when status = 'ACTIVE' then granted_at is not null else true end
  ),
  -- Une révocation est un FAIT daté et motivé. Un statut révoqué sans date ne dirait pas
  -- quand la lecture a cessé d'être autorisée.
  constraint bank_consents_revoked_shape_ck check (
    case when status = 'REVOKED' then revoked_at is not null else revoked_at is null end
  ),
  -- Un consentement expiré porte la date qui l'a fait expirer.
  constraint bank_consents_expired_shape_ck check (
    case when status = 'EXPIRED' then expires_at is not null else true end
  ),
  constraint bank_consents_secret_shape_ck check (
    (secret_vault is null and secret_key is null)
    or (secret_vault is not null and secret_key is not null)
  ),
  constraint bank_consents_secret_reference_ck check (
    secret_key is null or secret_key ~ '^[A-Za-z0-9_.:/-]{1,200}$'
  ),
  constraint bank_consents_expiry_order_ck check (
    expires_at is null or granted_at is null or expires_at >= granted_at
  )
);

create unique index if not exists bank_consents_id_user_uidx
  on public.bank_consents(id, user_id);
create index if not exists bank_consents_provider_idx
  on public.bank_consents(provider_id, user_id, created_at desc);
create index if not exists bank_consents_institution_idx
  on public.bank_consents(bank_institution_id, user_id)
  where bank_institution_id is not null;

comment on table public.bank_consents is
  'Autorisation de lecture DATÉE : portées, octroi, expiration DÉCLARÉE, révocation motivée. Une expiration non déclarée n''est pas une absence d''expiration.';

-- ---------------------------------------------------------------------------
-- 3. Comptes fournisseur
-- ---------------------------------------------------------------------------
-- COMPTE FOURNISSEUR ≠ COMPTE CANONIQUE. Un compte vu chez l'agrégateur n'entre au
-- patrimoine que si l'utilisateur le RATTACHE à un compte canonique. Rien n'est créé
-- d'office : un compte inventé ferait apparaître un actif que personne n'a déclaré.

create table if not exists public.bank_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_id uuid not null,
  provider_account_id text not null,
  bank_institution_id uuid,
  name text,
  -- Identifiant masqué tel que le fournisseur le rend. Jamais complété ni reconstruit.
  masked_identifier text,
  account_type text,
  currency char(3),
  -- Compte CANONIQUE alimenté. `null` = non rattaché : les opérations de ce compte
  -- fournisseur restent observées et bloquées à la validation.
  account_id uuid,
  mapped_at timestamptz,
  mapping_reason text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_provider_accounts_consent_fk
    foreign key (consent_id, user_id)
    references public.bank_consents(id, user_id) on delete cascade,
  constraint bank_provider_accounts_institution_fk
    foreign key (bank_institution_id, user_id)
    references public.bank_institutions(id, user_id) on delete set null (bank_institution_id),
  constraint bank_provider_accounts_account_fk
    foreign key (account_id, user_id)
    references public.financial_accounts(id, user_id) on delete set null (account_id),
  constraint bank_provider_accounts_provider_uk
    unique (user_id, consent_id, provider_account_id),
  -- Un rattachement est une DÉCISION datée. Sans date, rien ne dit quand le compte a
  -- commencé à alimenter le patrimoine.
  constraint bank_provider_accounts_mapping_shape_ck check (
    case when account_id is not null then mapped_at is not null else mapped_at is null end
  ),
  constraint bank_provider_accounts_currency_ck check (
    currency is null or currency ~ '^[A-Z]{3}$'
  )
);

create unique index if not exists bank_provider_accounts_id_user_uidx
  on public.bank_provider_accounts(id, user_id);
-- INVARIANT, pas une optimisation : un compte canonique est alimenté par AU PLUS UN compte
-- fournisseur. Sans cette unicité, deux comptes fournisseur rattachés au même compte
-- canonique écriraient deux fois les mêmes opérations, et le patrimoine serait faux sans
-- qu'aucune trace ne le dise.
create unique index if not exists bank_provider_accounts_canonical_uidx
  on public.bank_provider_accounts(user_id, account_id)
  where account_id is not null;
create index if not exists bank_provider_accounts_consent_idx
  on public.bank_provider_accounts(consent_id, user_id);
create index if not exists bank_provider_accounts_institution_idx
  on public.bank_provider_accounts(bank_institution_id, user_id)
  where bank_institution_id is not null;

comment on table public.bank_provider_accounts is
  'Compte tel que l''agrégateur le présente, distinct de tout compte canonique. Un compte canonique est alimenté par au plus un compte fournisseur : sans cette unicité, les mêmes opérations seraient écrites deux fois.';

-- ---------------------------------------------------------------------------
-- 4. Curseurs de reprise
-- ---------------------------------------------------------------------------
-- Le point de reprise DURABLE d'un compte. Une synchronisation interrompue au milieu de sa
-- pagination reprend ici, sans relire ce qui a déjà été écrit.

create table if not exists public.bank_sync_cursors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_account_id uuid not null,
  -- Curseur rendu par le fournisseur. `null` = repartir du début.
  cursor text,
  -- Dernier numéro de page RÉELLEMENT persisté, pour que la numérotation reste continue
  -- d'une reprise à l'autre.
  checkpoint_page_number integer not null default 0,
  -- La dernière pagination est-elle allée jusqu'à la fin DÉCLARÉE par le fournisseur ?
  complete boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint bank_sync_cursors_account_fk
    foreign key (provider_account_id, user_id)
    references public.bank_provider_accounts(id, user_id) on delete cascade,
  constraint bank_sync_cursors_account_uk unique (user_id, provider_account_id),
  constraint bank_sync_cursors_checkpoint_ck check (checkpoint_page_number >= 0)
);

create unique index if not exists bank_sync_cursors_id_user_uidx
  on public.bank_sync_cursors(id, user_id);

comment on table public.bank_sync_cursors is
  'Point de reprise durable d''un compte fournisseur. Un curseur absent signifie « repartir du début », jamais « terminé ».';

-- ---------------------------------------------------------------------------
-- 5. Exécutions de synchronisation
-- ---------------------------------------------------------------------------

create table if not exists public.bank_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_id uuid not null,
  provider_account_id uuid not null,
  -- Session d'acquisition de cette exécution. C'est elle qui porte le staging, les
  -- décomptes et la provenance : une exécution ne réinvente aucun de ces objets.
  session_id uuid,
  trigger text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_read integer not null default 0,
  items_read integer not null default 0,
  -- Curseur laissé par cette exécution. Conservé même en échec : une interruption ne doit
  -- jamais obliger à tout relire.
  resume_cursor text,
  complete boolean not null default false,
  failure_code text,
  failure_message text,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint bank_sync_runs_consent_fk
    foreign key (consent_id, user_id)
    references public.bank_consents(id, user_id) on delete cascade,
  constraint bank_sync_runs_account_fk
    foreign key (provider_account_id, user_id)
    references public.bank_provider_accounts(id, user_id) on delete cascade,
  constraint bank_sync_runs_session_fk
    foreign key (session_id, user_id)
    references public.import_sessions(id, user_id) on delete set null (session_id),
  constraint bank_sync_runs_trigger_ck check (trigger in ('MANUAL', 'WEBHOOK', 'SCHEDULED')),
  constraint bank_sync_runs_status_ck check (
    status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')
  ),
  -- Un échec NOMME sa cause. « La synchronisation a échoué » n'est pas un diagnostic.
  constraint bank_sync_runs_failure_shape_ck check (
    case when status = 'FAILED' then failure_code is not null else true end
  ),
  -- Une exécution terminée porte sa date de fin ; une exécution en cours n'en a pas.
  constraint bank_sync_runs_finished_shape_ck check (
    case when status = 'RUNNING' then finished_at is null else finished_at is not null end
  ),
  -- COMPLET signifie « le fournisseur a déclaré la fin ». Une exécution partielle ou en
  -- échec ne peut pas l'être, sans quoi la couverture serait surévaluée.
  constraint bank_sync_runs_complete_shape_ck check (
    case when status in ('PARTIAL', 'FAILED', 'RUNNING') then complete = false else true end
  ),
  constraint bank_sync_runs_counts_ck check (pages_read >= 0 and items_read >= 0),
  constraint bank_sync_runs_issues_ck check (jsonb_typeof(issues) = 'array')
);

create unique index if not exists bank_sync_runs_id_user_uidx
  on public.bank_sync_runs(id, user_id);
create index if not exists bank_sync_runs_account_idx
  on public.bank_sync_runs(provider_account_id, user_id, started_at desc);
create index if not exists bank_sync_runs_consent_idx
  on public.bank_sync_runs(consent_id, user_id, started_at desc);
create index if not exists bank_sync_runs_session_idx
  on public.bank_sync_runs(session_id, user_id) where session_id is not null;
-- Une seule exécution EN COURS par compte : deux synchronisations concurrentes du même
-- compte liraient les mêmes pages et écriraient deux fois les mêmes observations.
create unique index if not exists bank_sync_runs_running_uidx
  on public.bank_sync_runs(user_id, provider_account_id)
  where status = 'RUNNING';

comment on table public.bank_sync_runs is
  'Historique des synchronisations : pages lues, éléments lus, curseur de reprise, cause nommée d''un échec. Une seule exécution en cours par compte.';

-- ---------------------------------------------------------------------------
-- 6. Pages brutes
-- ---------------------------------------------------------------------------
-- Le BRUT d'une API est la PAGE, pas la ligne : c'est la page qui est demandée, rendue,
-- rejouée et reprise. Elle est conservée telle quelle, avec son empreinte, et elle est
-- IMMUABLE.
--
-- Le brut par OPÉRATION est conservé, lui, dans `import_raw_records` — la table du socle,
-- réutilisée sans modification. Les deux ne se recouvrent pas : l'une répond à « qu'a
-- répondu le fournisseur ? », l'autre à « d'où vient cette ligne ? ».

create table if not exists public.bank_sync_raw_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  session_id uuid not null,
  provider_account_id uuid not null,
  page_number integer not null,
  -- Curseur DEMANDÉ pour obtenir cette page. `null` pour la première.
  request_cursor text,
  next_cursor text,
  payload_hash text not null,
  -- Corps réellement reçu. C'est la seule chose qui permette de dire, dans six mois, ce que
  -- le fournisseur avait répondu.
  raw_payload text not null,
  item_count integer not null,
  received_at timestamptz not null default now(),
  constraint bank_sync_raw_pages_run_fk
    foreign key (run_id, user_id)
    references public.bank_sync_runs(id, user_id) on delete cascade,
  constraint bank_sync_raw_pages_session_fk
    foreign key (session_id, user_id)
    references public.import_sessions(id, user_id) on delete cascade,
  constraint bank_sync_raw_pages_account_fk
    foreign key (provider_account_id, user_id)
    references public.bank_provider_accounts(id, user_id) on delete cascade,
  constraint bank_sync_raw_pages_page_uk unique (user_id, session_id, page_number),
  constraint bank_sync_raw_pages_page_ck check (page_number > 0),
  constraint bank_sync_raw_pages_item_count_ck check (item_count >= 0),
  constraint bank_sync_raw_pages_hash_ck check (payload_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists bank_sync_raw_pages_id_user_uidx
  on public.bank_sync_raw_pages(id, user_id);
-- Recherche d'un REJEU : la même page rendue à l'identique lors d'une exécution ultérieure.
-- Ce n'est PAS une unicité, et c'est délibéré : une synchronisation qui relit la première
-- page sans nouvelle opération rend légitimement le même corps. Le rejeu se SIGNALE et se
-- compte une fois ; il ne se refuse pas au niveau de la page.
create index if not exists bank_sync_raw_pages_replay_idx
  on public.bank_sync_raw_pages(user_id, provider_account_id, payload_hash);
create index if not exists bank_sync_raw_pages_run_idx
  on public.bank_sync_raw_pages(run_id, user_id, page_number);

comment on table public.bank_sync_raw_pages is
  'Page BRUTE rendue par le fournisseur, immuable, avec son curseur et son empreinte. Aucune unicité sur l''empreinte : une page relue à l''identique est légitime, elle est signalée et non recomptée.';

-- ---------------------------------------------------------------------------
-- 7. Observations d'opérations
-- ---------------------------------------------------------------------------
-- L'observation est DURABLE et TRANSVERSE aux synchronisations. C'est ce qui distingue une
-- API d'un fichier : une opération vue en attente lundi et comptabilisée mercredi est la
-- MÊME opération, et deux lignes de staging dans deux sessions ne sauraient pas le dire.
--
-- Les trois dates sont conservées séparément. `operation_date` est la seule qui date le
-- fait canonique : choisir la date de comptabilisation déplacerait une dépense d'un mois.

create table if not exists public.bank_observed_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_account_id uuid not null,
  consent_id uuid not null,
  -- Session qui a observé cette opération pour la PREMIÈRE fois.
  first_session_id uuid not null,
  raw_page_id uuid not null,
  -- Position dans la page, pour retrouver l'élément exact dans le corps conservé.
  item_index integer not null,
  state text not null,
  -- Identifiant PRÉTENDU par le fournisseur. Conservé tel quel.
  provider_transaction_id text,
  operation_date date,
  value_date date,
  booking_date date,
  -- Montant SIGNÉ en devise native. `null` = non rendu par le fournisseur, jamais zéro.
  amount numeric(20, 6),
  currency char(3),
  label text,
  counterparty text,
  reference text,
  -- Montant d'origine quand la banque a converti. AUCUN taux n'en est déduit : le rapport
  -- des deux contient la marge de change de la banque, ce n'est pas un taux de marché.
  original_amount numeric(20, 6),
  original_currency char(3),
  -- Clé de RESSEMBLANCE, lisible, servant à expliquer. Aucune unicité ne s'y appuie.
  match_key text,
  -- Identité DÉMONTRÉE, renseignée uniquement quand l'adaptateur DÉCLARE ses identifiants
  -- stables. C'est la seule colonne qui porte une unicité.
  external_key text,
  -- Observation que celle-ci remplace, quand le fournisseur le DÉCLARE.
  replaces_observation_id uuid,
  superseded_by_observation_id uuid,
  -- Ligne de staging qui a réellement produit le fait canonique. Posée UNE fois.
  committed_normalized_record_id uuid,
  issues jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint bank_observed_transactions_account_fk
    foreign key (provider_account_id, user_id)
    references public.bank_provider_accounts(id, user_id) on delete cascade,
  constraint bank_observed_transactions_consent_fk
    foreign key (consent_id, user_id)
    references public.bank_consents(id, user_id) on delete cascade,
  constraint bank_observed_transactions_session_fk
    foreign key (first_session_id, user_id)
    references public.import_sessions(id, user_id) on delete cascade,
  constraint bank_observed_transactions_page_fk
    foreign key (raw_page_id, user_id)
    references public.bank_sync_raw_pages(id, user_id) on delete cascade,
  -- La provenance d'un fait écrit ne se détache pas : `restrict`, comme pour les liens
  -- d'import. Sans cela, l'observation pourrait perdre la ligne qui l'a écrite.
  constraint bank_observed_transactions_committed_fk
    foreign key (committed_normalized_record_id, user_id)
    references public.import_normalized_records(id, user_id) on delete restrict,
  constraint bank_observed_transactions_state_ck check (
    state in ('PENDING', 'BOOKED', 'CANCELLED', 'CORRECTED')
  ),
  constraint bank_observed_transactions_item_index_ck check (item_index >= 0),
  constraint bank_observed_transactions_currency_ck check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  constraint bank_observed_transactions_original_currency_ck check (
    original_currency is null or original_currency ~ '^[A-Z]{3}$'
  ),
  -- Un montant d'origine sans devise d'origine ne dit rien, et l'inverse non plus.
  constraint bank_observed_transactions_original_shape_ck check (
    (original_amount is null and original_currency is null)
    or (original_amount is not null and original_currency is not null)
  ),
  -- Une observation ne se remplace pas elle-même.
  constraint bank_observed_transactions_replaces_self_ck check (
    replaces_observation_id is null or replaces_observation_id <> id
  ),
  constraint bank_observed_transactions_superseded_self_ck check (
    superseded_by_observation_id is null or superseded_by_observation_id <> id
  ),
  constraint bank_observed_transactions_seen_order_ck check (last_seen_at >= first_seen_at),
  constraint bank_observed_transactions_issues_ck check (jsonb_typeof(issues) = 'array'),
  -- Une opération ANNULÉE par la banque n'est jamais écrite au canonique. La base le refuse
  -- plutôt que de compter sur la couche applicative.
  constraint bank_observed_transactions_cancelled_ck check (
    case when state = 'CANCELLED' then committed_normalized_record_id is null else true end
  )
);

create unique index if not exists bank_observed_transactions_id_user_uidx
  on public.bank_observed_transactions(id, user_id);
-- La SEULE unicité d'identité : une identité DÉMONTRÉE n'existe qu'une fois. Elle est
-- cherchée dans tout l'historique, sans filtre de date — une identité stable ne se périme
-- pas. Aucune unicité n'est posée sur `match_key` : une égalité de tuple ne prouve rien, et
-- l'y imposer supprimerait des dépenses réelles.
create unique index if not exists bank_observed_transactions_identity_uidx
  on public.bank_observed_transactions(user_id, external_key)
  where external_key is not null;
-- Une ligne de staging n'a produit qu'un fait : deux observations qui la revendiquent
-- seraient deux vérités de la même écriture.
create unique index if not exists bank_observed_transactions_committed_uidx
  on public.bank_observed_transactions(user_id, committed_normalized_record_id)
  where committed_normalized_record_id is not null;
create index if not exists bank_observed_transactions_account_idx
  on public.bank_observed_transactions(provider_account_id, user_id, operation_date desc);
create index if not exists bank_observed_transactions_match_idx
  on public.bank_observed_transactions(user_id, provider_account_id, match_key)
  where match_key is not null;
create index if not exists bank_observed_transactions_provider_id_idx
  on public.bank_observed_transactions(user_id, provider_account_id, provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists bank_observed_transactions_page_idx
  on public.bank_observed_transactions(raw_page_id, user_id);
create index if not exists bank_observed_transactions_session_idx
  on public.bank_observed_transactions(first_session_id, user_id);
create index if not exists bank_observed_transactions_consent_idx
  on public.bank_observed_transactions(consent_id, user_id);
create index if not exists bank_observed_transactions_replaces_idx
  on public.bank_observed_transactions(replaces_observation_id, user_id)
  where replaces_observation_id is not null;
create index if not exists bank_observed_transactions_superseded_idx
  on public.bank_observed_transactions(superseded_by_observation_id, user_id)
  where superseded_by_observation_id is not null;
create index if not exists bank_observed_transactions_committed_fk_idx
  on public.bank_observed_transactions(committed_normalized_record_id, user_id)
  where committed_normalized_record_id is not null;

-- Les deux auto-références ne peuvent PAS être déclarées dans le `create table` : elles
-- visent `(id, user_id)`, dont l'unicité composite n'existe qu'après l'index créé
-- ci-dessus. Les poser ici est le seul ordre possible, pas une préférence de style.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'bank_observed_transactions_replaces_fk'
  ) then
    alter table public.bank_observed_transactions
      add constraint bank_observed_transactions_replaces_fk
      foreign key (replaces_observation_id, user_id)
      references public.bank_observed_transactions(id, user_id)
      on delete set null (replaces_observation_id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'bank_observed_transactions_superseded_fk'
  ) then
    alter table public.bank_observed_transactions
      add constraint bank_observed_transactions_superseded_fk
      foreign key (superseded_by_observation_id, user_id)
      references public.bank_observed_transactions(id, user_id)
      on delete set null (superseded_by_observation_id);
  end if;
end $$;

comment on table public.bank_observed_transactions is
  'Opération OBSERVÉE, durable et transverse aux synchronisations. Les trois dates sont conservées séparément ; seule la date d''opération date le fait canonique. Unicité sur la seule identité démontrée.';

-- ---------------------------------------------------------------------------
-- 8. Observations de solde
-- ---------------------------------------------------------------------------
-- SOLDE OBSERVÉ ≠ SOLDE CANONIQUE, et un solde disponible n'est pas un solde comptable :
-- les additionner produirait un patrimoine faux. `amount` est nullable, parce que
-- SOLDE ABSENT ≠ SOLDE À ZÉRO.

create table if not exists public.bank_balance_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_account_id uuid not null,
  run_id uuid,
  balance_type text not null,
  amount numeric(20, 6),
  currency char(3),
  -- Date d'arrêté DÉCLARÉE par le fournisseur.
  observed_at date not null,
  retrieved_at timestamptz not null default now(),
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint bank_balance_observations_account_fk
    foreign key (provider_account_id, user_id)
    references public.bank_provider_accounts(id, user_id) on delete cascade,
  constraint bank_balance_observations_run_fk
    foreign key (run_id, user_id)
    references public.bank_sync_runs(id, user_id) on delete set null (run_id),
  -- Une observation par nature et par date : deux lectures du même jour sont la même
  -- observation, et la seconde CORRIGE la première au lieu de s'y ajouter.
  constraint bank_balance_observations_observation_uk
    unique (user_id, provider_account_id, balance_type, observed_at),
  constraint bank_balance_observations_type_ck check (
    balance_type in ('BOOKED', 'AVAILABLE', 'EXPECTED', 'CLOSING_BOOKED', 'INTERIM_AVAILABLE')
  ),
  constraint bank_balance_observations_currency_ck check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  -- Un montant sans devise n'est pas un montant : son total n'est pas calculable.
  constraint bank_balance_observations_shape_ck check (
    case when amount is not null then currency is not null else true end
  ),
  constraint bank_balance_observations_issues_ck check (jsonb_typeof(issues) = 'array')
);

create unique index if not exists bank_balance_observations_id_user_uidx
  on public.bank_balance_observations(id, user_id);
create index if not exists bank_balance_observations_account_idx
  on public.bank_balance_observations(provider_account_id, user_id, observed_at desc);
create index if not exists bank_balance_observations_run_idx
  on public.bank_balance_observations(run_id, user_id) where run_id is not null;

comment on table public.bank_balance_observations is
  'Solde OBSERVÉ chez le fournisseur, par nature et par date. Un montant absent reste absent : un solde inconnu n''est pas un solde à zéro.';

-- ---------------------------------------------------------------------------
-- 9. Décisions humaines de réconciliation
-- ---------------------------------------------------------------------------
-- Une décision est DURABLE. Sans cette table, chaque synchronisation reproposerait ce qui a
-- déjà été tranché : l'utilisateur devrait refuser la même opération indéfiniment, et une
-- fausse manœuvre finirait par la faire écrire deux fois.

create table if not exists public.bank_reconciliation_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  observation_id uuid not null,
  decision text not null,
  -- Transaction canonique DÉSIGNÉE par une décision de rattachement.
  linked_transaction_id uuid,
  reason text,
  -- Session au cours de laquelle la décision a été prise.
  session_id uuid,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint bank_reconciliation_decisions_observation_fk
    foreign key (observation_id, user_id)
    references public.bank_observed_transactions(id, user_id) on delete cascade,
  constraint bank_reconciliation_decisions_transaction_fk
    foreign key (linked_transaction_id, user_id)
    references public.transactions(id, user_id)
    on delete set null (linked_transaction_id),
  constraint bank_reconciliation_decisions_session_fk
    foreign key (session_id, user_id)
    references public.import_sessions(id, user_id) on delete set null (session_id),
  -- Une décision par observation. Changer d'avis remplace la décision, il n'en empile pas
  -- deux : deux décisions contradictoires ne diraient plus laquelle s'applique.
  constraint bank_reconciliation_decisions_observation_uk unique (user_id, observation_id),
  constraint bank_reconciliation_decisions_decision_ck check (
    decision in ('ACCEPT_NEW', 'LINK_EXISTING', 'REFUSE')
  ),
  -- Un rattachement DÉSIGNE une transaction ; une acceptation n'en désigne aucune, la
  -- transaction est produite par la validation. Un refus se MOTIVE : sans motif, la
  -- décision serait irrelisible dans six mois.
  constraint bank_reconciliation_decisions_shape_ck check (
    case decision
      when 'LINK_EXISTING' then linked_transaction_id is not null
      when 'ACCEPT_NEW' then linked_transaction_id is null
      when 'REFUSE' then linked_transaction_id is null
                          and reason is not null and length(btrim(reason)) > 0
      else false
    end
  )
);

create unique index if not exists bank_reconciliation_decisions_id_user_uidx
  on public.bank_reconciliation_decisions(id, user_id);
-- Une transaction canonique n'est revendiquée que par UNE observation : deux observations
-- rattachées à la même transaction en feraient deux fois la même dépense côté provenance.
create unique index if not exists bank_reconciliation_decisions_transaction_uidx
  on public.bank_reconciliation_decisions(user_id, linked_transaction_id)
  where linked_transaction_id is not null;
create index if not exists bank_reconciliation_decisions_session_idx
  on public.bank_reconciliation_decisions(session_id, user_id) where session_id is not null;

comment on table public.bank_reconciliation_decisions is
  'Décision humaine DURABLE sur une observation : accepter, rattacher à une transaction existante, ou refuser en motivant. Elle n''est jamais redemandée à la synchronisation suivante.';

-- ---------------------------------------------------------------------------
-- 10. Événements de notification
-- ---------------------------------------------------------------------------
-- PROTECTION CONTRE LE REJEU, portée par la BASE : l'identifiant d'événement du fournisseur
-- est UNIQUE. Un webhook renvoyé dix fois est écrit une fois, et les neuf autres sont
-- refusés par la contrainte, pas par une vérification applicative qu'une exécution
-- concurrente contournerait.

create table if not exists public.bank_sync_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null,
  consent_id uuid,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  -- La signature du webhook a-t-elle été VÉRIFIÉE côté serveur ? Un événement non vérifié
  -- est conservé et ne déclenche rien : il pourrait venir de n'importe qui.
  signature_verified boolean not null default false,
  status text not null default 'RECEIVED',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  run_id uuid,
  error text,
  constraint bank_sync_events_provider_fk
    foreign key (provider_id, user_id)
    references public.bank_providers(id, user_id) on delete cascade,
  constraint bank_sync_events_consent_fk
    foreign key (consent_id, user_id)
    references public.bank_consents(id, user_id) on delete set null (consent_id),
  constraint bank_sync_events_run_fk
    foreign key (run_id, user_id)
    references public.bank_sync_runs(id, user_id) on delete set null (run_id),
  constraint bank_sync_events_event_uk unique (user_id, provider_id, provider_event_id),
  constraint bank_sync_events_status_ck check (
    status in ('RECEIVED', 'IGNORED', 'PROCESSED', 'FAILED')
  ),
  constraint bank_sync_events_payload_ck check (jsonb_typeof(payload) = 'object'),
  constraint bank_sync_events_processed_shape_ck check (
    case when status in ('PROCESSED', 'IGNORED', 'FAILED') then processed_at is not null
    else processed_at is null end
  ),
  constraint bank_sync_events_failed_shape_ck check (
    case when status = 'FAILED' then error is not null else true end
  ),
  -- Un événement NON VÉRIFIÉ ne déclenche aucune exécution. C'est la base qui le refuse.
  constraint bank_sync_events_unverified_ck check (
    case when signature_verified = false then run_id is null else true end
  )
);

create unique index if not exists bank_sync_events_id_user_uidx
  on public.bank_sync_events(id, user_id);
create index if not exists bank_sync_events_provider_idx
  on public.bank_sync_events(provider_id, user_id, received_at desc);
create index if not exists bank_sync_events_consent_idx
  on public.bank_sync_events(consent_id, user_id) where consent_id is not null;
create index if not exists bank_sync_events_run_idx
  on public.bank_sync_events(run_id, user_id) where run_id is not null;

comment on table public.bank_sync_events is
  'Notification reçue d''un fournisseur. L''identifiant d''événement est UNIQUE : le rejeu est refusé par la base. Un événement non signé ne déclenche aucune synchronisation.';

-- ---------------------------------------------------------------------------
-- 11. RLS et privilèges — piste d'audit en LECTURE SEULE
-- ---------------------------------------------------------------------------
-- Même discipline que le socle d'acquisition : `authenticated` ne reçoit que le SELECT, et
-- toutes les écritures passent par les RPC `lfo_*` réservées à `service_role`.
--
-- Ce n'est pas décoratif ici plus qu'ailleurs. Une observation bancaire modifiable par le
-- client ne serait plus une observation, une décision de réconciliation supprimable ne
-- serait plus une décision, et un événement de notification effaçable rouvrirait le rejeu
-- que son unicité existe pour refuser.

do $$
declare target text;
begin
  foreach target in array array[
    'bank_providers', 'bank_institutions', 'bank_consents', 'bank_provider_accounts',
    'bank_sync_cursors', 'bank_sync_runs', 'bank_sync_raw_pages',
    'bank_observed_transactions', 'bank_balance_observations',
    'bank_reconciliation_decisions', 'bank_sync_events'
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
-- 12. Gel des pages brutes et de la provenance d'une observation écrite
-- ---------------------------------------------------------------------------
-- Une page brute ne se corrige pas : c'est ce que le fournisseur a répondu. Sa suppression
-- n'est ouverte que sur une exécution qui n'a produit AUCUN fait canonique.
--
-- L'existence de l'exécution est lue INDÉPENDAMMENT de la visibilité RLS de l'appelant.
-- SESSION ABSENTE ≠ SESSION INVISIBLE : un garde-fou qui décide à partir d'une lecture
-- filtrée par la RLS conclut « déjà supprimé » sur une simple absence de droit, et autorise.
-- C'est pourquoi la lecture passe par une fonction `security definer` à surface minimale,
-- nommée pour ce domaine — et NON `lfo_*`, afin que le contrat « aucune RPC `lfo_*` en
-- SECURITY DEFINER » reste entier.
create or replace function public.bank_sync_freeze_state(
  p_run_id uuid,
  p_user_id uuid
) returns text
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.bank_sync_runs r
       where r.id = p_run_id and r.user_id = p_user_id
    ) then 'ABSENT'
    when exists (
      select 1
        from public.bank_observed_transactions o
       where o.user_id = p_user_id
         and o.committed_normalized_record_id is not null
         and o.raw_page_id in (
           select p.id from public.bank_sync_raw_pages p
            where p.run_id = p_run_id and p.user_id = p_user_id
         )
    ) then 'FACTS_WRITTEN'
    else (
      select r.status from public.bank_sync_runs r
       where r.id = p_run_id and r.user_id = p_user_id
    )
  end
$$;

revoke all on function public.bank_sync_freeze_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bank_sync_freeze_state(uuid, uuid) to service_role;

comment on function public.bank_sync_freeze_state(uuid, uuid) is
  'État de gel d''une exécution de synchronisation, lu indépendamment de la visibilité RLS de l''appelant : ABSENT, FACTS_WRITTEN, ou le statut de l''exécution. Lecture interne du garde-fou des pages brutes, exécutable par service_role seul.';

create or replace function public.bank_sync_raw_page_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_state text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Une page brute est immuable : corriger l''observation, pas la réponse du fournisseur';
  end if;
  v_state := public.bank_sync_freeze_state(old.run_id, old.user_id);
  if v_state = 'ABSENT' then
    return old;
  end if;
  if v_state = 'FACTS_WRITTEN' then
    raise exception
      'Page brute d''une synchronisation qui a produit un fait canonique : sa provenance ne se supprime pas';
  end if;
  return old;
end;
$$;

drop trigger if exists bank_sync_raw_pages_immutable on public.bank_sync_raw_pages;
create trigger bank_sync_raw_pages_immutable
  before update or delete on public.bank_sync_raw_pages
  for each row execute function public.bank_sync_raw_page_immutable();

-- Une observation qui a produit un fait canonique est GELÉE sur ce qui décrit ce fait.
--
-- Le gel n'est PAS total, et l'exception est nommée : `last_seen_at`, `state`,
-- `superseded_by_observation_id` et `issues` décrivent la VIE de l'observation chez le
-- fournisseur, pas le fait produit. Une opération revue à chaque synchronisation doit
-- pouvoir dire qu'elle a été revue. Tout le reste — montant, dates, devise, libellé,
-- identité, ligne de staging — est figé : le modifier après coup raconterait une autre
-- histoire que celle qui a produit la transaction.
create or replace function public.bank_observed_transaction_frozen()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.committed_normalized_record_id is null then
    -- Une observation non écrite reste vivante. Seule sa ligne de staging, une fois posée,
    -- ne se retire plus : la provenance d'un fait ne se détache pas.
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Observation déjà écrite au canonique : elle ne se supprime pas';
  end if;

  if
    new.committed_normalized_record_id = old.committed_normalized_record_id
    and (to_jsonb(new) - 'last_seen_at' - 'state' - 'superseded_by_observation_id' - 'issues')
        = (to_jsonb(old) - 'last_seen_at' - 'state' - 'superseded_by_observation_id' - 'issues')
  then
    return new;
  end if;

  raise exception 'Observation déjà écrite au canonique : ce qui décrit le fait produit est gelé';
end;
$$;

drop trigger if exists bank_observed_transactions_frozen on public.bank_observed_transactions;
create trigger bank_observed_transactions_frozen
  before update or delete on public.bank_observed_transactions
  for each row execute function public.bank_observed_transaction_frozen();

-- ---------------------------------------------------------------------------
-- 13. RPC — écritures composées, aucune formule financière
-- ---------------------------------------------------------------------------
-- PostgreSQL persiste, TypeScript calcule. Ces fonctions écrivent des FAITS atomiquement et
-- vérifient des invariants ; elles ne lisent aucune API, ne classent aucun flux et ne
-- calculent aucun montant.
--
-- Aucune n'est `security definer` : chacune s'exécute avec les droits de l'appelant, dans un
-- `search_path` verrouillé, et n'est exécutable que par `service_role`.

-- Enregistre un adaptateur et ses capacités DÉCLARÉES. Convergente sur l'adaptateur : le
-- réenregistrer met à jour sa version et ses capacités sans créer un second registre, qui
-- produirait deux vérités sur ce que le fournisseur sait faire.
create or replace function public.lfo_register_bank_provider(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_adapter_id text := nullif(btrim(p_payload ->> 'adapter_id'), '');
  v_capabilities jsonb := p_payload -> 'capabilities';
begin
  if v_adapter_id is null then
    raise exception 'Adaptateur sans identifiant : une source anonyme n''est pas traçable';
  end if;
  if v_capabilities is null or jsonb_typeof(v_capabilities) <> 'object' then
    raise exception 'Capacités de l''adaptateur non déclarées : rien n''est supposé par défaut';
  end if;

  insert into public.bank_providers (
    user_id, adapter_id, adapter_version, label, auth_mode, capabilities, base_url,
    secret_vault, secret_key, status
  ) values (
    p_user_id,
    v_adapter_id,
    coalesce(nullif(btrim(p_payload ->> 'adapter_version'), ''), '1'),
    coalesce(nullif(btrim(p_payload ->> 'label'), ''), v_adapter_id),
    coalesce(nullif(btrim(p_payload ->> 'auth_mode'), ''), 'FIXTURE'),
    v_capabilities,
    nullif(btrim(p_payload ->> 'base_url'), ''),
    nullif(btrim(p_payload ->> 'secret_vault'), ''),
    nullif(btrim(p_payload ->> 'secret_key'), ''),
    coalesce(nullif(btrim(p_payload ->> 'status'), ''), 'DISCONNECTED')
  )
  on conflict (user_id, adapter_id) do update
     set adapter_version = excluded.adapter_version,
         label = excluded.label,
         auth_mode = excluded.auth_mode,
         capabilities = excluded.capabilities,
         base_url = excluded.base_url,
         secret_vault = excluded.secret_vault,
         secret_key = excluded.secret_key,
         status = excluded.status,
         updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Ouvre ou renouvelle un consentement. Convergente sur la référence du fournisseur : un
-- second appel pour la même référence RENOUVELLE, il ne crée pas un second consentement,
-- qui laisserait deux autorisations contradictoires sur le même accès.
create or replace function public.lfo_open_bank_consent(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_provider_id uuid := (p_payload ->> 'provider_id')::uuid;
  v_reference text := nullif(btrim(p_payload ->> 'consent_reference'), '');
  v_scopes text[] := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload -> 'scopes', '[]'::jsonb)) as value),
    array[]::text[]
  );
  v_expiry_declared boolean := coalesce((p_payload ->> 'expiry_declared')::boolean, false);
  v_expires_at timestamptz := (nullif(p_payload ->> 'expires_at', ''))::timestamptz;
  v_status text := coalesce(nullif(btrim(p_payload ->> 'status'), ''), 'PENDING');
begin
  if v_reference is null then
    raise exception 'Consentement sans référence fournisseur : rien ne dirait quelle autorisation il désigne';
  end if;
  if cardinality(v_scopes) = 0 then
    raise exception 'Consentement sans portée : une autorisation qui ne dit pas ce qu''elle autorise n''en est pas une';
  end if;
  if not exists (
    select 1 from public.bank_providers
     where id = v_provider_id and user_id = p_user_id
  ) then
    raise exception 'Fournisseur introuvable';
  end if;

  insert into public.bank_consents (
    user_id, provider_id, bank_institution_id, consent_reference, scopes, status,
    granted_at, expiry_declared, expires_at, secret_vault, secret_key
  ) values (
    p_user_id,
    v_provider_id,
    (nullif(p_payload ->> 'bank_institution_id', ''))::uuid,
    v_reference,
    v_scopes,
    v_status,
    case when v_status = 'ACTIVE'
         then coalesce((nullif(p_payload ->> 'granted_at', ''))::timestamptz, now())
         else (nullif(p_payload ->> 'granted_at', ''))::timestamptz end,
    v_expiry_declared,
    case when v_expiry_declared then v_expires_at else null end,
    nullif(btrim(p_payload ->> 'secret_vault'), ''),
    nullif(btrim(p_payload ->> 'secret_key'), '')
  )
  on conflict (user_id, provider_id, consent_reference) do update
     set scopes = excluded.scopes,
         status = excluded.status,
         granted_at = coalesce(excluded.granted_at, public.bank_consents.granted_at),
         expiry_declared = excluded.expiry_declared,
         expires_at = excluded.expires_at,
         bank_institution_id = coalesce(excluded.bank_institution_id, public.bank_consents.bank_institution_id),
         secret_vault = excluded.secret_vault,
         secret_key = excluded.secret_key,
         revoked_at = null,
         revoked_reason = null,
         last_error = null,
         updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Change le statut d'un consentement. Les transitions sont VÉRIFIÉES : un consentement
-- révoqué ne redevient pas actif par une mise à jour de statut, il exige un nouvel octroi.
create or replace function public.lfo_set_bank_consent_status(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_consent_id uuid := (p_payload ->> 'consent_id')::uuid;
  v_status text := nullif(btrim(p_payload ->> 'status'), '');
  v_reason text := nullif(btrim(p_payload ->> 'reason'), '');
  v_current text;
begin
  select status into v_current
    from public.bank_consents
   where id = v_consent_id and user_id = p_user_id
     for update;
  if v_current is null then
    raise exception 'Consentement introuvable';
  end if;
  if v_status is null then
    raise exception 'Statut de consentement absent';
  end if;

  -- RÉVOQUÉ est TERMINAL. Le réactiver silencieusement rendrait la révocation décorative :
  -- un nouvel octroi passe par `lfo_open_bank_consent`, qui enregistre un nouvel accord.
  if v_current = 'REVOKED' and v_status <> 'REVOKED' then
    raise exception
      'Consentement révoqué : la révocation est terminale, un nouvel octroi est nécessaire';
  end if;
  if v_status = 'REVOKED' and v_reason is null then
    raise exception 'Révocation sans motif : elle serait irrelisible dans six mois';
  end if;

  update public.bank_consents
     set status = v_status,
         revoked_at = case when v_status = 'REVOKED' then now() else null end,
         revoked_reason = case when v_status = 'REVOKED' then v_reason else null end,
         last_error = case when v_status in ('ERROR', 'REAUTH_REQUIRED') then v_reason else null end,
         updated_at = now()
   where id = v_consent_id and user_id = p_user_id;

  -- Un consentement qui n'autorise plus rien coupe la source : aucune synchronisation
  -- ultérieure ne doit pouvoir démarrer en croyant l'accès valide.
  if v_status in ('REVOKED', 'EXPIRED', 'REAUTH_REQUIRED', 'ERROR') then
    update public.import_sources s
       set status = case
                      when v_status = 'REVOKED' then 'DISCONNECTED'
                      when v_status = 'EXPIRED' then 'REAUTH_REQUIRED'
                      else v_status
                    end,
           last_error = v_reason,
           updated_at = now()
     where s.user_id = p_user_id
       and s.target_account_id in (
         select a.account_id from public.bank_provider_accounts a
          where a.consent_id = v_consent_id and a.user_id = p_user_id
            and a.account_id is not null
       );
  end if;

  return v_consent_id;
end;
$$;

-- Enregistre les comptes et établissements vus chez le fournisseur.
--
-- Aucun compte canonique n'est créé, et aucun rattachement n'est deviné : un compte
-- fournisseur naît NON RATTACHÉ. Créer un compte d'office ferait apparaître au patrimoine un
-- actif que personne n'a déclaré.
create or replace function public.lfo_sync_bank_accounts(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_consent_id uuid := (p_payload ->> 'consent_id')::uuid;
  v_provider_id uuid;
  v_account jsonb;
  v_institution_id uuid;
  v_seen integer := 0;
begin
  select provider_id into v_provider_id
    from public.bank_consents
   where id = v_consent_id and user_id = p_user_id
     for update;
  if v_provider_id is null then
    raise exception 'Consentement introuvable';
  end if;

  for v_account in select value from jsonb_array_elements(coalesce(p_payload -> 'accounts', '[]'::jsonb)) as value
  loop
    v_institution_id := null;
    if nullif(btrim(v_account ->> 'provider_institution_id'), '') is not null then
      insert into public.bank_institutions (
        user_id, provider_id, provider_institution_id, name, country_code
      ) values (
        p_user_id,
        v_provider_id,
        btrim(v_account ->> 'provider_institution_id'),
        coalesce(nullif(btrim(v_account ->> 'institution_name'), ''), btrim(v_account ->> 'provider_institution_id')),
        nullif(btrim(v_account ->> 'country_code'), '')
      )
      on conflict (user_id, provider_id, provider_institution_id) do update
         set name = excluded.name,
             country_code = coalesce(excluded.country_code, public.bank_institutions.country_code),
             updated_at = now()
      returning id into v_institution_id;
    end if;

    insert into public.bank_provider_accounts (
      user_id, consent_id, provider_account_id, bank_institution_id, name,
      masked_identifier, account_type, currency
    ) values (
      p_user_id,
      v_consent_id,
      btrim(v_account ->> 'provider_account_id'),
      v_institution_id,
      nullif(btrim(v_account ->> 'name'), ''),
      nullif(btrim(v_account ->> 'masked_identifier'), ''),
      nullif(btrim(v_account ->> 'account_type'), ''),
      nullif(btrim(v_account ->> 'currency'), '')
    )
    on conflict (user_id, consent_id, provider_account_id) do update
       set bank_institution_id = coalesce(excluded.bank_institution_id, public.bank_provider_accounts.bank_institution_id),
           name = coalesce(excluded.name, public.bank_provider_accounts.name),
           masked_identifier = coalesce(excluded.masked_identifier, public.bank_provider_accounts.masked_identifier),
           account_type = coalesce(excluded.account_type, public.bank_provider_accounts.account_type),
           currency = coalesce(excluded.currency, public.bank_provider_accounts.currency),
           last_seen_at = now(),
           updated_at = now();

    v_seen := v_seen + 1;
  end loop;

  -- Décompte DÉRIVÉ des lignes réellement persistées, jamais repris d'un décompte fourni
  -- par l'appelant.
  select count(*)::integer into v_seen
    from public.bank_provider_accounts
   where consent_id = v_consent_id and user_id = p_user_id;
  return v_seen;
end;
$$;

-- Rattache un compte fournisseur à un compte canonique, ou le détache.
--
-- C'est une DÉCISION, datée et motivée. Elle crée la source d'acquisition du compte
-- canonique — la même table que pour un relevé CSV, avec `kind = 'API'` : aucune whitelist
-- de domaine n'est élargie, une synchronisation bancaire alimente le domaine Cash Flow
-- comme un fichier.
create or replace function public.lfo_map_bank_account(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_provider_account_id uuid := (p_payload ->> 'provider_account_id')::uuid;
  v_account_id uuid := (nullif(p_payload ->> 'account_id', ''))::uuid;
  v_reason text := nullif(btrim(p_payload ->> 'reason'), '');
  v_consent_id uuid;
  v_provider_account text;
  v_adapter_id text;
  v_adapter_version text;
  v_label text;
begin
  select a.consent_id, a.provider_account_id, p.adapter_id, p.adapter_version,
         coalesce(a.name, a.provider_account_id)
    into v_consent_id, v_provider_account, v_adapter_id, v_adapter_version, v_label
    from public.bank_provider_accounts a
    join public.bank_consents c on c.id = a.consent_id and c.user_id = a.user_id
    join public.bank_providers p on p.id = c.provider_id and p.user_id = c.user_id
   where a.id = v_provider_account_id and a.user_id = p_user_id
     for update of a;
  if v_consent_id is null then
    raise exception 'Compte fournisseur introuvable';
  end if;

  if v_account_id is null then
    -- Détachement. Les observations DEMEURENT : ce que le fournisseur a dit reste vrai,
    -- seule l'alimentation du patrimoine cesse.
    update public.bank_provider_accounts
       set account_id = null, mapped_at = null, mapping_reason = v_reason, updated_at = now()
     where id = v_provider_account_id and user_id = p_user_id;
    return v_provider_account_id;
  end if;

  if not exists (
    select 1 from public.financial_accounts
     where id = v_account_id and user_id = p_user_id
  ) then
    raise exception 'Compte canonique introuvable';
  end if;

  update public.bank_provider_accounts
     set account_id = v_account_id,
         mapped_at = now(),
         mapping_reason = v_reason,
         updated_at = now()
   where id = v_provider_account_id and user_id = p_user_id;

  -- Source d'acquisition du compte canonique. `on conflict` sur l'index partiel existant :
  -- une source par (domaine, fournisseur, compte).
  insert into public.import_sources (
    user_id, kind, domain, provider, label, target_account_id, adapter_version, status
  ) values (
    p_user_id, 'API', 'CASH_FLOW_TRANSACTION', v_adapter_id,
    v_label, v_account_id, v_adapter_version, 'ACTIVE'
  )
  on conflict (user_id, domain, provider, target_account_id)
    where target_account_id is not null
  do update
     set label = excluded.label,
         adapter_version = excluded.adapter_version,
         status = 'ACTIVE',
         last_error = null,
         updated_at = now();

  return v_provider_account_id;
end;
$$;

-- Ouvre une exécution de synchronisation et sa session d'acquisition.
--
-- Les conditions sont vérifiées AVANT toute lecture du fournisseur, parce qu'un
-- consentement expiré ou révoqué ne doit pas produire d'appel : insister est précisément ce
-- qui fait bloquer un accès par un agrégateur.
create or replace function public.lfo_open_bank_sync_run(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_provider_account_id uuid := (p_payload ->> 'provider_account_id')::uuid;
  v_trigger text := coalesce(nullif(btrim(p_payload ->> 'trigger'), ''), 'MANUAL');
  v_consent_id uuid;
  v_account_id uuid;
  v_consent record;
  v_source_id uuid;
  v_adapter_id text;
  v_adapter_version text;
  v_session_id uuid;
  v_run_id uuid;
  v_cursor text;
  v_checkpoint integer;
begin
  select a.consent_id, a.account_id
    into v_consent_id, v_account_id
    from public.bank_provider_accounts a
   where a.id = v_provider_account_id and a.user_id = p_user_id
     for update;
  if v_consent_id is null then
    raise exception 'Compte fournisseur introuvable';
  end if;
  if v_account_id is null then
    raise exception
      'Compte fournisseur non rattaché : aucune opération ne peut viser un compte canonique inexistant';
  end if;

  select c.*, p.adapter_id as p_adapter_id, p.adapter_version as p_adapter_version
    into v_consent
    from public.bank_consents c
    join public.bank_providers p on p.id = c.provider_id and p.user_id = c.user_id
   where c.id = v_consent_id and c.user_id = p_user_id
     for update of c;
  if not found then
    raise exception 'Consentement introuvable';
  end if;
  v_adapter_id := v_consent.p_adapter_id;
  v_adapter_version := v_consent.p_adapter_version;

  if v_consent.status = 'REVOKED' then
    raise exception 'Consentement révoqué : aucune lecture n''est autorisée';
  end if;
  if v_consent.status <> 'ACTIVE' then
    raise exception 'Consentement non actif (statut %) : la lecture n''est pas autorisée', v_consent.status;
  end if;
  -- EXPIRATION NON DÉCLARÉE ≠ SANS EXPIRATION : seule une expiration DÉCLARÉE et dépassée
  -- interdit la lecture. Une absence de déclaration ne l'autorise pas davantage — elle est
  -- signalée par la couche applicative, qui ne peut rien affirmer de ce qui n'est pas dit.
  if v_consent.expiry_declared and v_consent.expires_at <= now() then
    raise exception 'Consentement expiré le % : il doit être renouvelé', v_consent.expires_at;
  end if;
  if not ('TRANSACTIONS' = any (v_consent.scopes)) then
    raise exception 'Consentement sans portée TRANSACTIONS : les opérations ne sont pas lisibles';
  end if;

  select id into v_source_id
    from public.import_sources
   where user_id = p_user_id and domain = 'CASH_FLOW_TRANSACTION'
     and provider = v_adapter_id and target_account_id = v_account_id;
  if v_source_id is null then
    raise exception 'Source d''acquisition absente : le compte doit être rattaché avant toute synchronisation';
  end if;

  insert into public.import_sessions (
    user_id, source_id, parser, parser_version, status, observation_date,
    stable_transaction_id_declared
  ) values (
    p_user_id, v_source_id, v_adapter_id, v_adapter_version, 'RECEIVING',
    (coalesce(nullif(p_payload ->> 'observation_date', ''), now()::date::text))::date,
    coalesce((p_payload ->> 'stable_transaction_id_declared')::boolean, false)
  )
  returning id into v_session_id;

  -- Curseur de reprise, créé au premier passage. Un curseur absent signifie « repartir du
  -- début », jamais « terminé ».
  insert into public.bank_sync_cursors (user_id, provider_account_id)
  values (p_user_id, v_provider_account_id)
  on conflict (user_id, provider_account_id) do nothing;

  select cursor, checkpoint_page_number into v_cursor, v_checkpoint
    from public.bank_sync_cursors
   where user_id = p_user_id and provider_account_id = v_provider_account_id;

  insert into public.bank_sync_runs (
    user_id, consent_id, provider_account_id, session_id, trigger, status, resume_cursor
  ) values (
    p_user_id, v_consent_id, v_provider_account_id, v_session_id, v_trigger, 'RUNNING', v_cursor
  )
  returning id into v_run_id;

  update public.import_sources
     set last_attempt_at = now(), updated_at = now()
   where id = v_source_id and user_id = p_user_id;

  return v_run_id;
end;
$$;

-- Écrit une PAGE : son brut, ses observations, son brut par opération et son staging, en une
-- seule transaction.
--
-- L'atomicité est le point : une page à moitié écrite laisserait des observations sans
-- staging, ou un curseur avancé sur des lignes absentes. Un échec au milieu d'une page
-- annule la page ENTIÈRE, et le curseur reste sur la page précédente.
--
-- IDEMPOTENCE. Rejouer la même page est refusé par l'unicité `(session, numéro de page)`.
-- Rejouer la même OPÉRATION est absorbé par l'identité démontrée : l'observation est
-- retrouvée et sa dernière vue mise à jour, elle n'est pas dupliquée.
create or replace function public.lfo_append_bank_sync_page(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid := (p_payload ->> 'run_id')::uuid;
  v_page jsonb := p_payload -> 'page';
  v_row jsonb;
  v_run record;
  v_account_id uuid;
  v_page_id uuid;
  v_raw_id uuid;
  v_observation_id uuid;
  v_normalized_id uuid;
  v_row_number integer;
  v_item_index integer := 0;
  v_external_key text;
  v_replaces uuid;
  v_written integer := 0;
begin
  select r.*, a.account_id as canonical_account_id
    into v_run
    from public.bank_sync_runs r
    join public.bank_provider_accounts a
      on a.id = r.provider_account_id and a.user_id = r.user_id
   where r.id = v_run_id and r.user_id = p_user_id
     for update of r;
  if not found then
    raise exception 'Exécution de synchronisation introuvable';
  end if;
  if v_run.status <> 'RUNNING' then
    raise exception 'Exécution non ouverte (statut %) : une page ne s''ajoute pas après la fin', v_run.status;
  end if;
  v_account_id := v_run.canonical_account_id;
  if v_account_id is null then
    raise exception 'Compte fournisseur détaché en cours de synchronisation : la page n''est pas écrite';
  end if;
  if v_page is null or jsonb_typeof(v_page) <> 'object' then
    raise exception 'Page absente du payload';
  end if;

  insert into public.bank_sync_raw_pages (
    user_id, run_id, session_id, provider_account_id, page_number,
    request_cursor, next_cursor, payload_hash, raw_payload, item_count
  ) values (
    p_user_id, v_run_id, v_run.session_id, v_run.provider_account_id,
    (v_page ->> 'page_number')::integer,
    nullif(v_page ->> 'request_cursor', ''),
    nullif(v_page ->> 'next_cursor', ''),
    v_page ->> 'payload_hash',
    v_page ->> 'raw_payload',
    coalesce((v_page ->> 'item_count')::integer, 0)
  )
  returning id into v_page_id;

  -- Numérotation CONTINUE dans la session, dérivée du brut déjà persisté : une reprise ne
  -- recommence pas à 1, sans quoi deux lignes brutes porteraient le même numéro.
  select coalesce(max(row_number), 0) into v_row_number
    from public.import_raw_records
   where session_id = v_run.session_id and user_id = p_user_id;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload -> 'rows', '[]'::jsonb)) as value
  loop
    v_row_number := v_row_number + 1;
    v_external_key := nullif(btrim(v_row ->> 'external_key'), '');

    -- BRUT par opération. `raw_line` porte le corps JSON de l'élément tel que le
    -- fournisseur l'a rendu ; `cells` en porte la forme structurée. La colonne est un
    -- tableau par héritage du socle fichier : l'objet y tient une seule place, et personne
    -- ne peut en conclure que la source avait une colonne.
    insert into public.import_raw_records (user_id, session_id, row_number, raw_line, cells)
    values (
      p_user_id, v_run.session_id, v_row_number,
      coalesce(v_row ->> 'raw_item', (v_row -> 'raw_item')::text, '{}'),
      jsonb_build_array(coalesce(v_row -> 'raw_item', '{}'::jsonb))
    )
    returning id into v_raw_id;

    -- OBSERVATION. Retrouvée par identité DÉMONTRÉE quand elle existe ; sinon créée. Un
    -- identifiant non déclaré stable ne sert pas de clé : deux opérations réelles
    -- identiques resteraient deux observations, et c'est voulu.
    v_observation_id := null;
    if v_external_key is not null then
      select id into v_observation_id
        from public.bank_observed_transactions
       where user_id = p_user_id and external_key = v_external_key
         for update;
    end if;

    v_replaces := null;
    if nullif(btrim(v_row ->> 'replaces_observation_id'), '') is not null then
      v_replaces := (v_row ->> 'replaces_observation_id')::uuid;
    end if;

    if v_observation_id is null then
      insert into public.bank_observed_transactions (
        user_id, provider_account_id, consent_id, first_session_id, raw_page_id, item_index,
        state, provider_transaction_id, operation_date, value_date, booking_date,
        amount, currency, label, counterparty, reference,
        original_amount, original_currency, match_key, external_key,
        replaces_observation_id, issues
      ) values (
        p_user_id, v_run.provider_account_id, v_run.consent_id, v_run.session_id, v_page_id,
        v_item_index,
        v_row ->> 'state',
        nullif(btrim(v_row ->> 'provider_transaction_id'), ''),
        (nullif(v_row ->> 'operation_date', ''))::date,
        (nullif(v_row ->> 'value_date', ''))::date,
        (nullif(v_row ->> 'booking_date', ''))::date,
        (nullif(v_row ->> 'amount', ''))::numeric,
        nullif(btrim(v_row ->> 'currency'), ''),
        nullif(v_row ->> 'label', ''),
        nullif(v_row ->> 'counterparty', ''),
        nullif(v_row ->> 'reference', ''),
        (nullif(v_row ->> 'original_amount', ''))::numeric,
        nullif(btrim(v_row ->> 'original_currency'), ''),
        nullif(v_row ->> 'match_key', ''),
        v_external_key,
        v_replaces,
        coalesce(v_row -> 'issues', '[]'::jsonb)
      )
      returning id into v_observation_id;
    else
      -- Réobservation d'une identité connue : seuls sa VIE chez le fournisseur et ses
      -- anomalies changent. Le montant, les dates et la devise du fait produit sont gelés
      -- par le trigger dès qu'une ligne de staging a été committée.
      update public.bank_observed_transactions
         set state = v_row ->> 'state',
             last_seen_at = now(),
             issues = coalesce(v_row -> 'issues', '[]'::jsonb)
       where id = v_observation_id and user_id = p_user_id;
    end if;

    -- Marque le remplacement PENDING → BOOKED, quand le fournisseur l'a DÉCLARÉ et que
    -- l'appelant a résolu l'observation remplacée. Rien n'est deviné ici.
    if v_replaces is not null then
      update public.bank_observed_transactions
         set superseded_by_observation_id = v_observation_id
       where id = v_replaces and user_id = p_user_id
         and superseded_by_observation_id is null;
    end if;

    -- STAGING. La table du socle, sans une colonne ajoutée. `external_key` n'y est posée
    -- que lorsque la session DÉCLARE la stabilité des identifiants : c'est la seule colonne
    -- du socle qui porte une unicité, et y écrire une clé instable rejetterait des
    -- opérations réelles.
    insert into public.import_normalized_records (
      user_id, session_id, raw_record_id, target_domain, account_id,
      transaction_date, value_date, label, amount, currency,
      external_transaction_id, reference, counterparty,
      status, dedupe_verdict, match_key, external_key, matched_transaction_id,
      issues, data_kind, confidence, source
    ) values (
      p_user_id, v_run.session_id, v_raw_id, 'CASH_FLOW_TRANSACTION', v_account_id,
      (nullif(v_row ->> 'operation_date', ''))::date,
      (nullif(v_row ->> 'value_date', ''))::date,
      nullif(v_row ->> 'label', ''),
      (nullif(v_row ->> 'amount', ''))::numeric,
      nullif(btrim(v_row ->> 'currency'), ''),
      nullif(btrim(v_row ->> 'provider_transaction_id'), ''),
      nullif(v_row ->> 'reference', ''),
      nullif(v_row ->> 'counterparty', ''),
      v_row ->> 'status',
      nullif(v_row ->> 'dedupe_verdict', ''),
      nullif(v_row ->> 'match_key', ''),
      v_external_key,
      (nullif(v_row ->> 'matched_transaction_id', ''))::uuid,
      coalesce(v_row -> 'issues', '[]'::jsonb),
      'ACTUAL', 'HIGH', 'Open Banking ' || v_run_id::text
    )
    returning id into v_normalized_id;

    v_item_index := v_item_index + 1;
    v_written := v_written + 1;
  end loop;

  -- CHECKPOINT. Le curseur n'avance qu'après l'écriture réelle de la page : une
  -- interruption reprend sur la page suivante, jamais au-delà de ce qui est persisté.
  update public.bank_sync_cursors
     set cursor = nullif(v_page ->> 'next_cursor', ''),
         checkpoint_page_number = (v_page ->> 'page_number')::integer,
         complete = (nullif(v_page ->> 'next_cursor', '') is null),
         updated_at = now()
   where user_id = p_user_id and provider_account_id = v_run.provider_account_id;

  -- Décomptes DÉRIVÉS des lignes persistées, jamais repris de l'appelant.
  update public.bank_sync_runs
     set pages_read = (
           select count(*)::integer from public.bank_sync_raw_pages
            where run_id = v_run_id and user_id = p_user_id
         ),
         items_read = (
           select count(*)::integer from public.import_normalized_records
            where session_id = v_run.session_id and user_id = p_user_id
         ),
         resume_cursor = nullif(v_page ->> 'next_cursor', '')
   where id = v_run_id and user_id = p_user_id;

  return v_written;
end;
$$;

-- Écrit les soldes observés. Une observation par nature et par date : la seconde lecture
-- d'un même jour CORRIGE la première au lieu de s'y ajouter.
create or replace function public.lfo_record_bank_balances(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid := (nullif(p_payload ->> 'run_id', ''))::uuid;
  v_provider_account_id uuid := (p_payload ->> 'provider_account_id')::uuid;
  v_balance jsonb;
  v_written integer := 0;
begin
  if not exists (
    select 1 from public.bank_provider_accounts
     where id = v_provider_account_id and user_id = p_user_id
  ) then
    raise exception 'Compte fournisseur introuvable';
  end if;

  for v_balance in select value from jsonb_array_elements(coalesce(p_payload -> 'balances', '[]'::jsonb)) as value
  loop
    insert into public.bank_balance_observations (
      user_id, provider_account_id, run_id, balance_type, amount, currency, observed_at, issues
    ) values (
      p_user_id, v_provider_account_id, v_run_id,
      v_balance ->> 'balance_type',
      -- ABSENT ≠ ZÉRO : un solde non servi reste `null`.
      (nullif(v_balance ->> 'amount', ''))::numeric,
      nullif(btrim(v_balance ->> 'currency'), ''),
      (v_balance ->> 'observed_at')::date,
      coalesce(v_balance -> 'issues', '[]'::jsonb)
    )
    on conflict (user_id, provider_account_id, balance_type, observed_at) do update
       set amount = excluded.amount,
           currency = excluded.currency,
           run_id = excluded.run_id,
           retrieved_at = now(),
           issues = excluded.issues;
    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

-- Clôt la réception : la session passe à ANALYZED et ses décomptes sont RELUS en base.
--
-- Une exécution n'est `SUCCEEDED` que si le fournisseur a DÉCLARÉ la fin de sa pagination.
-- Sinon elle est `PARTIAL`, et elle le dit : annoncer complet une lecture tronquée
-- surévaluerait la couverture de la source.
create or replace function public.lfo_finalize_bank_sync_run(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid := (p_payload ->> 'run_id')::uuid;
  v_complete boolean := coalesce((p_payload ->> 'complete')::boolean, false);
  v_issues jsonb := coalesce(p_payload -> 'issues', '[]'::jsonb);
  v_run record;
  v_rows integer;
  v_ready integer;
  v_warning integer;
  v_blocked integer;
  v_duplicate integer;
  v_ignored integer;
  v_start date;
  v_end date;
begin
  select * into v_run
    from public.bank_sync_runs
   where id = v_run_id and user_id = p_user_id
     for update;
  if not found then
    raise exception 'Exécution de synchronisation introuvable';
  end if;
  if v_run.status <> 'RUNNING' then
    raise exception 'Exécution déjà terminée (statut %)', v_run.status;
  end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'READY')::integer,
    count(*) filter (where status = 'WARNING')::integer,
    count(*) filter (where status = 'BLOCKED')::integer,
    count(*) filter (where status = 'DUPLICATE')::integer,
    count(*) filter (where status = 'IGNORED')::integer,
    min(transaction_date),
    max(transaction_date)
    into v_rows, v_ready, v_warning, v_blocked, v_duplicate, v_ignored, v_start, v_end
    from public.import_normalized_records
   where session_id = v_run.session_id and user_id = p_user_id;

  update public.import_sessions
     set status = 'ANALYZED',
         row_count = v_rows,
         ready_count = v_ready,
         warning_count = v_warning,
         blocked_count = v_blocked,
         duplicate_count = v_duplicate,
         ignored_count = v_ignored,
         observed_period_start = v_start,
         observed_period_end = v_end,
         issues = v_issues,
         analyzed_at = now()
   where id = v_run.session_id and user_id = p_user_id;

  update public.bank_sync_runs
     set status = case when v_complete then 'SUCCEEDED' else 'PARTIAL' end,
         complete = v_complete,
         finished_at = now(),
         issues = v_issues,
         items_read = v_rows
   where id = v_run_id and user_id = p_user_id;

  return v_rows;
end;
$$;

-- Clôt une exécution en ÉCHEC, en conservant son curseur de reprise.
--
-- La session est marquée `FAILED` et non supprimée : ce qui a été lu reste lisible, et la
-- prochaine exécution reprend au curseur. Un échec qui effacerait sa propre trace rendrait
-- le diagnostic impossible.
create or replace function public.lfo_fail_bank_sync_run(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid := (p_payload ->> 'run_id')::uuid;
  v_code text := nullif(btrim(p_payload ->> 'failure_code'), '');
  v_message text := nullif(btrim(p_payload ->> 'failure_message'), '');
  v_run record;
begin
  select * into v_run
    from public.bank_sync_runs
   where id = v_run_id and user_id = p_user_id
     for update;
  if not found then
    raise exception 'Exécution de synchronisation introuvable';
  end if;
  if v_code is null then
    raise exception 'Échec sans code : « la synchronisation a échoué » n''est pas un diagnostic';
  end if;
  if v_run.status <> 'RUNNING' then
    raise exception 'Exécution déjà terminée (statut %)', v_run.status;
  end if;

  update public.bank_sync_runs
     set status = 'FAILED',
         complete = false,
         finished_at = now(),
         failure_code = v_code,
         failure_message = v_message,
         resume_cursor = coalesce(nullif(p_payload ->> 'resume_cursor', ''), resume_cursor),
         issues = coalesce(p_payload -> 'issues', issues)
   where id = v_run_id and user_id = p_user_id;

  update public.import_sessions
     set status = 'FAILED', error = coalesce(v_message, v_code)
   where id = v_run.session_id and user_id = p_user_id
     and status = 'RECEIVING';

  update public.import_sources s
     set last_error = coalesce(v_message, v_code),
         status = case when v_code in ('CONSENT_EXPIRED', 'UNAUTHORIZED') then 'REAUTH_REQUIRED'
                       when v_code = 'CONSENT_REVOKED' then 'DISCONNECTED'
                       when v_code = 'RATE_LIMITED' then 'RATE_LIMITED'
                       else 'ERROR' end,
         updated_at = now()
   where s.user_id = p_user_id
     and s.target_account_id = (
       select a.account_id from public.bank_provider_accounts a
        where a.id = v_run.provider_account_id and a.user_id = p_user_id
     );

  return v_run_id;
end;
$$;

-- Enregistre une DÉCISION humaine de réconciliation, et la propage aux lignes de staging de
-- la session qui citent cette observation.
--
-- La décision est DURABLE : elle ne sera pas redemandée à la synchronisation suivante. Sans
-- cela, l'utilisateur devrait refuser la même opération indéfiniment, et une fausse manœuvre
-- finirait par la faire écrire deux fois.
create or replace function public.lfo_decide_bank_reconciliation(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_observation_id uuid := (p_payload ->> 'observation_id')::uuid;
  v_decision text := nullif(btrim(p_payload ->> 'decision'), '');
  v_transaction_id uuid := (nullif(p_payload ->> 'linked_transaction_id', ''))::uuid;
  v_reason text := nullif(btrim(p_payload ->> 'reason'), '');
  v_session_id uuid := (nullif(p_payload ->> 'session_id', ''))::uuid;
  v_observation record;
  v_touched integer := 0;
begin
  select * into v_observation
    from public.bank_observed_transactions
   where id = v_observation_id and user_id = p_user_id
     for update;
  if not found then
    raise exception 'Observation introuvable';
  end if;
  if v_decision is null then
    raise exception 'Décision de réconciliation absente';
  end if;

  -- Une observation DÉJÀ écrite au canonique ne se rejuge pas : la décision qui l'a écrite
  -- est celle qui compte, et en accepter une seconde doublerait la dépense.
  if v_observation.committed_normalized_record_id is not null then
    raise exception
      'Observation déjà écrite au canonique : sa réconciliation ne se rejoue pas';
  end if;
  -- Une opération ANNULÉE par la banque ne s'écrit jamais.
  if v_observation.state = 'CANCELLED' and v_decision = 'ACCEPT_NEW' then
    raise exception
      'Opération annulée par la banque : elle reste une observation et n''entre pas au canonique';
  end if;
  if v_decision = 'LINK_EXISTING' then
    if v_transaction_id is null then
      raise exception 'Rattachement sans transaction désignée';
    end if;
    if not exists (
      select 1 from public.transactions
       where id = v_transaction_id and user_id = p_user_id
    ) then
      raise exception 'Transaction canonique introuvable';
    end if;
  end if;

  insert into public.bank_reconciliation_decisions (
    user_id, observation_id, decision, linked_transaction_id, reason, session_id
  ) values (
    p_user_id, v_observation_id, v_decision,
    case when v_decision = 'LINK_EXISTING' then v_transaction_id else null end,
    v_reason, v_session_id
  )
  on conflict (user_id, observation_id) do update
     set decision = excluded.decision,
         linked_transaction_id = excluded.linked_transaction_id,
         reason = excluded.reason,
         session_id = excluded.session_id,
         decided_at = now();

  -- Propagation aux lignes de staging NON committées qui décrivent cette observation. Une
  -- ligne déjà écrite n'est pas touchée : son gel refuserait la modification, et c'est le
  -- bon comportement.
  update public.import_normalized_records r
     set status = case v_decision
                    when 'REFUSE' then 'IGNORED'
                    when 'LINK_EXISTING' then 'DUPLICATE'
                    else case when r.status = 'BLOCKED' then 'BLOCKED' else 'WARNING' end
                  end,
         dedupe_verdict = case v_decision
                            when 'LINK_EXISTING' then 'EXACT_DUPLICATE'
                            else r.dedupe_verdict
                          end,
         matched_transaction_id = case when v_decision = 'LINK_EXISTING'
                                       then v_transaction_id else r.matched_transaction_id end
   where r.user_id = p_user_id
     and r.commit_state = 'PENDING'
     and r.id in (
       select n.id
         from public.import_normalized_records n
         join public.import_raw_records raw
           on raw.id = n.raw_record_id and raw.user_id = n.user_id
        where n.user_id = p_user_id
          and n.session_id = coalesce(v_session_id, v_observation.first_session_id)
          and (
            (v_observation.external_key is not null and n.external_key = v_observation.external_key)
            or (v_observation.external_key is null
                and v_observation.provider_transaction_id is not null
                and n.external_transaction_id = v_observation.provider_transaction_id)
          )
     );
  get diagnostics v_touched = row_count;

  return v_touched;
end;
$$;

-- Valide une session de synchronisation : écrit les transactions canoniques, leur provenance
-- et la marque de commit de l'observation, en une seule transaction.
--
-- Seules les lignes `READY` et les lignes `WARNING` NOMMÉMENT incluses sont écrites. Une
-- ligne bloquée, doublon ou ignorée ne l'est jamais — la base le refuse par sa contrainte de
-- committabilité, et c'est ce refus qui protège réellement.
--
-- La transaction est écrite par la MÊME instruction que le socle fichier, avec
-- `manual_override = false` et sans catégorie : l'acquisition ne classe rien.
create or replace function public.lfo_commit_bank_sync_session(
  p_user_id uuid,
  p_payload jsonb
) returns integer
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
    raise exception 'Session de synchronisation introuvable';
  end if;
  -- IDEMPOTENCE APPLICATIVE : une session déjà validée rend son décompte sans rien réécrire.
  if v_status = 'COMMITTED' then
    select count(*)::integer into v_committed
      from public.import_record_links
     where session_id = v_session_id and user_id = p_user_id;
    return v_committed;
  end if;
  if v_status <> 'ANALYZED' then
    raise exception 'Session non validable (statut %)', v_status;
  end if;

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
      -- Observé par la banque, pas supposé par LFO. Aucune catégorie n'est inventée.
      'ACTUAL', 'HIGH', 'Open Banking ' || v_session_id::text, false
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

  -- L'OBSERVATION porte la ligne qui l'a écrite. C'est ce qui rend l'observation
  -- non reproposable à la synchronisation suivante : sans cette marque, la même opération
  -- redeviendrait « nouvelle » et serait écrite deux fois.
  update public.bank_observed_transactions o
     set committed_normalized_record_id = r.id
    from public.import_normalized_records r
   where o.user_id = p_user_id
     and r.user_id = p_user_id
     and r.session_id = v_session_id
     and r.commit_state = 'COMMITTED'
     and o.committed_normalized_record_id is null
     and (
       (o.external_key is not null and r.external_key = o.external_key)
       or (o.external_key is null
           and o.provider_transaction_id is not null
           and r.external_transaction_id = o.provider_transaction_id)
     );

  -- Une acceptation devient une décision ENREGISTRÉE, même quand l'utilisateur n'a fait que
  -- laisser une ligne prête cochée : sans trace, la synchronisation suivante ne saurait pas
  -- que la question a été tranchée.
  insert into public.bank_reconciliation_decisions (
    user_id, observation_id, decision, session_id
  )
  select p_user_id, o.id, 'ACCEPT_NEW', v_session_id
    from public.bank_observed_transactions o
    join public.import_normalized_records r
      on r.id = o.committed_normalized_record_id and r.user_id = o.user_id
   where o.user_id = p_user_id and r.session_id = v_session_id
  on conflict (user_id, observation_id) do nothing;

  select count(*)::integer into v_committed from public.import_record_links
   where session_id = v_session_id and user_id = p_user_id;

  -- Tout le reste est explicitement EXCLU : une ligne laissée PENDING laisserait croire
  -- qu'elle attend encore une décision.
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

  update public.import_sources
     set coverage_start = least(coverage_start, v_period_start),
         coverage_end = greatest(coverage_end, v_period_end),
         status = 'ACTIVE',
         last_success_at = now(),
         last_error = null,
         updated_at = now()
   where id = v_source_id and user_id = p_user_id;

  return v_committed;
end;
$$;

-- Enregistre une notification de fournisseur.
--
-- PROTECTION CONTRE LE REJEU portée par la BASE : l'unicité `(fournisseur, identifiant
-- d'événement)` refuse le second enregistrement. Une vérification applicative serait
-- contournée par deux livraisons concurrentes.
--
-- Un événement dont la SIGNATURE n'a pas été vérifiée est conservé et ne déclenche RIEN : il
-- pourrait venir de n'importe qui. La base refuse d'ailleurs de lui rattacher une exécution.
create or replace function public.lfo_record_bank_sync_event(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_provider_id uuid := (p_payload ->> 'provider_id')::uuid;
  v_event_id text := nullif(btrim(p_payload ->> 'provider_event_id'), '');
  v_verified boolean := coalesce((p_payload ->> 'signature_verified')::boolean, false);
begin
  if v_event_id is null then
    raise exception 'Événement sans identifiant fournisseur : le rejeu ne serait pas détectable';
  end if;
  if not exists (
    select 1 from public.bank_providers where id = v_provider_id and user_id = p_user_id
  ) then
    raise exception 'Fournisseur introuvable';
  end if;

  insert into public.bank_sync_events (
    user_id, provider_id, consent_id, provider_event_id, event_type, payload,
    signature_verified, status, processed_at
  ) values (
    p_user_id, v_provider_id,
    (nullif(p_payload ->> 'consent_id', ''))::uuid,
    v_event_id,
    coalesce(nullif(btrim(p_payload ->> 'event_type'), ''), 'UNKNOWN'),
    coalesce(p_payload -> 'payload', '{}'::jsonb),
    v_verified,
    case when v_verified then 'RECEIVED' else 'IGNORED' end,
    case when v_verified then null else now() end
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Privilèges des RPC
-- ---------------------------------------------------------------------------

revoke all on function
  public.lfo_register_bank_provider(uuid, jsonb),
  public.lfo_open_bank_consent(uuid, jsonb),
  public.lfo_set_bank_consent_status(uuid, jsonb),
  public.lfo_sync_bank_accounts(uuid, jsonb),
  public.lfo_map_bank_account(uuid, jsonb),
  public.lfo_open_bank_sync_run(uuid, jsonb),
  public.lfo_append_bank_sync_page(uuid, jsonb),
  public.lfo_record_bank_balances(uuid, jsonb),
  public.lfo_finalize_bank_sync_run(uuid, jsonb),
  public.lfo_fail_bank_sync_run(uuid, jsonb),
  public.lfo_decide_bank_reconciliation(uuid, jsonb),
  public.lfo_commit_bank_sync_session(uuid, jsonb),
  public.lfo_record_bank_sync_event(uuid, jsonb)
from public, anon, authenticated;

grant execute on function
  public.lfo_register_bank_provider(uuid, jsonb),
  public.lfo_open_bank_consent(uuid, jsonb),
  public.lfo_set_bank_consent_status(uuid, jsonb),
  public.lfo_sync_bank_accounts(uuid, jsonb),
  public.lfo_map_bank_account(uuid, jsonb),
  public.lfo_open_bank_sync_run(uuid, jsonb),
  public.lfo_append_bank_sync_page(uuid, jsonb),
  public.lfo_record_bank_balances(uuid, jsonb),
  public.lfo_finalize_bank_sync_run(uuid, jsonb),
  public.lfo_fail_bank_sync_run(uuid, jsonb),
  public.lfo_decide_bank_reconciliation(uuid, jsonb),
  public.lfo_commit_bank_sync_session(uuid, jsonb),
  public.lfo_record_bank_sync_event(uuid, jsonb)
to service_role;
