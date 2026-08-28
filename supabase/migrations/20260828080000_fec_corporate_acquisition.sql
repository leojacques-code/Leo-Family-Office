-- ---------------------------------------------------------------------------------------
-- FEC / CORPORATE DATA ACQUISITION V1
--
-- Deuxième verticale de la couche d'acquisition. Elle ne crée PAS un second pipeline :
-- le registre de sources, les sessions, le brut immuable, la piste d'audit en lecture
-- seule et les liens de provenance sont ceux de `20260827155134_data_acquisition_foundation`.
-- Cette migration les ÉTEND, additivement, à un nouveau domaine.
--
-- Ce que le domaine comptable apporte :
--
--   import_sources.domain      'BUSINESS_ACCOUNTING' en plus de 'CASH_FLOW_TRANSACTION'.
--                              Une source comptable vise une SOCIÉTÉ, pas une enveloppe
--                              bancaire : `target_business_id` au lieu de
--                              `target_account_id`, et jamais les deux.
--
--   fec_entry_lines            les écritures lues, ligne à ligne, avec les 18 champs
--                              réglementaires conservés tels quels. C'est le staging du
--                              domaine, et la SOURCE de tout poste dérivable ensuite :
--                              stocks, clients, fournisseurs, dettes fiscales, comptes
--                              courants d'associés ne sont donc PAS dupliqués dans un
--                              modèle canonique parallèle.
--
--   import_record_links        une colonne cible de plus, avec sa vraie clé étrangère
--                              vers `business_financials`. Une seule table de provenance,
--                              comme prévu — pas un `target_id uuid` sans contrainte.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
--
--   * elle ne persiste AUCUN état financier reconstruit. Compte de résultat, bilan, EBE,
--     marge commerciale et BFR sont dérivés à la lecture par `src/lib/acquisition/fec`,
--     à partir des écritures conservées. Les persister créerait une seconde vérité que
--     rien ne garderait synchrone ;
--   * elle ne touche à aucun moteur financier, ni au schéma de Career ou de Tax ;
--   * elle ne modifie pas le contenu de la migration `20260827155134`, appliquée en
--     production. Les contraintes qu'elle doit élargir sont remplacées sous un NOUVEAU
--     nom, selon la convention déjà suivie par Business Equity V2.1.
--
-- FEC ≠ COMPTES ANNUELS. Un fichier des écritures comptables est une source comptable
-- détaillée ; il ne porte ni liasse, ni annexe, ni retraitement de consolidation. Ce que
-- l'on en reconstruit est un CANDIDAT, et son intégration exige une couverture déclarée.
-- ---------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Clé composite manquante sur `business_financials`
-- ---------------------------------------------------------------------------
-- Le lien de provenance porte une vraie clé étrangère (id, user_id) : sans elle, un lien
-- pourrait désigner l'instantané financier d'un AUTRE propriétaire.
create unique index if not exists business_financials_id_user_uidx
  on public.business_financials(id, user_id);

-- ---------------------------------------------------------------------------
-- 2. Registre des sources — domaine comptable
-- ---------------------------------------------------------------------------
alter table public.import_sources
  add column if not exists target_business_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_sources_business_fk') then
    alter table public.import_sources add constraint import_sources_business_fk
      foreign key (target_business_id, user_id)
      references public.businesses(id, user_id) on delete cascade;
  end if;
end $$;

-- Domaines reconnus. Chaque ajout suppose la colonne de liaison correspondante dans
-- `import_record_links` : c'est la contrepartie d'une intégrité réelle.
alter table public.import_sources drop constraint if exists import_sources_domain_ck;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_sources_domain_v2_ck') then
    alter table public.import_sources add constraint import_sources_domain_v2_ck
      check (domain in ('CASH_FLOW_TRANSACTION', 'BUSINESS_ACCOUNTING'));
  end if;
end $$;

-- Une source vise UNE cible, et le `else false` ferme la porte : un domaine ajouté sans
-- forme déclarée est refusé, plutôt qu'accepté sans cible.
alter table public.import_sources drop constraint if exists import_sources_domain_shape_ck;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_sources_domain_shape_v2_ck') then
    alter table public.import_sources add constraint import_sources_domain_shape_v2_ck
      check (
        case
          when domain = 'CASH_FLOW_TRANSACTION'
            then target_account_id is not null and target_business_id is null
          when domain = 'BUSINESS_ACCOUNTING'
            then target_business_id is not null and target_account_id is null
          else false
        end
      );
  end if;
end $$;

-- Une source comptable par (provider, société) : deux registres pour la même comptabilité
-- feraient deux historiques de couverture contradictoires.
create unique index if not exists import_sources_business_provider_uidx
  on public.import_sources(user_id, domain, provider, target_business_id)
  where target_business_id is not null;
create index if not exists import_sources_business_idx
  on public.import_sources(target_business_id, user_id)
  where target_business_id is not null;

comment on column public.import_sources.target_business_id is
  'Société visée par une source comptable. Une source vise une enveloppe bancaire OU une société, jamais les deux.';

-- ---------------------------------------------------------------------------
-- 3. Sessions d'import — exercice déclaré et réception fragmentée
-- ---------------------------------------------------------------------------
alter table public.import_sessions
  -- Exercice DÉCLARÉ par l'utilisateur. Distinct de la période observée dans le fichier :
  -- des dates minimale et maximale ne prouvent pas qu'un exercice est complet.
  add column if not exists fiscal_year_start date,
  add column if not exists fiscal_year_end date,
  -- L'utilisateur DÉCLARE-T-IL que ce fichier couvre l'exercice entier ? `false` par
  -- défaut : sans cette déclaration, les totaux restent exacts pour les lignes fournies et
  -- ne constituent pas un compte de résultat annuel.
  add column if not exists coverage_declared boolean not null default false,
  -- Décomptes propres à la partie double. Une comptabilité déséquilibrée n'est pas
  -- fiable, et le nombre d'écritures concernées est un fait d'audit.
  add column if not exists entry_count integer not null default 0,
  add column if not exists unbalanced_entry_count integer not null default 0,
  -- Objet de staging privé dont cette session a été lue. Il permet de reprendre le fichier
  -- à la VALIDATION sans le faire retransiter par la route, et de le supprimer quand il
  -- n'a plus de raison d'exister. `null` = plus aucun objet de staging.
  add column if not exists staging_storage_path text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_sessions_fiscal_year_ck') then
    alter table public.import_sessions add constraint import_sessions_fiscal_year_ck
      check (
        fiscal_year_start is null or fiscal_year_end is null
        or fiscal_year_end > fiscal_year_start
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_sessions_entry_counts_ck') then
    alter table public.import_sessions add constraint import_sessions_entry_counts_ck
      check (entry_count >= 0 and unbalanced_entry_count >= 0);
  end if;
  -- Déclarer qu'un fichier couvre « l'exercice entier » sans dire QUEL exercice n'a aucun
  -- sens : sans bornes, il n'y a pas de période à couvrir. La validation applicative pose
  -- déjà la règle ; la base la pose aussi, parce qu'un invariant qui ne vit que dans une
  -- API se contourne par la première écriture directe.
  if not exists (select 1 from pg_constraint where conname = 'import_sessions_coverage_shape_ck') then
    alter table public.import_sessions add constraint import_sessions_coverage_shape_ck
      check (
        coverage_declared = false
        or (fiscal_year_start is not null and fiscal_year_end is not null)
      );
  end if;
end $$;

-- Un FEC de plusieurs dizaines de milliers de lignes ne passe pas dans un seul appel RPC :
-- il est reçu par lots. L'état `RECEIVING` dit la vérité de cette phase — une session qui
-- reçoit encore ses lignes n'est pas une session analysée, et ses décomptes ne veulent
-- encore rien dire.
alter table public.import_sessions drop constraint if exists import_sessions_status_ck;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_sessions_status_v2_ck') then
    alter table public.import_sessions add constraint import_sessions_status_v2_ck
      check (status in ('RECEIVING', 'ANALYZED', 'COMMITTED', 'DISCARDED', 'FAILED'));
  end if;
end $$;

comment on column public.import_sessions.coverage_declared is
  'Couverture de l''exercice DÉCLARÉE par l''utilisateur. Sans elle, aucune reconstruction n''est intégrable au domaine Business.';

-- ---------------------------------------------------------------------------
-- 3 bis. Billets d'upload — le fichier ne traverse pas la fonction serveur
-- ---------------------------------------------------------------------------
-- Un FEC d'exercice pèse couramment plus que ce qu'une fonction serverless accepte en corps
-- de requête. Le faire transiter par la route d'API le condamnerait à être refusé AVANT
-- même que le code s'exécute : la fonctionnalité annoncée à 150 000 lignes n'existerait
-- pas en production.
--
-- Le fichier va donc DIRECTEMENT du navigateur au stockage privé, et la route ne reçoit
-- qu'une RÉFÉRENCE. Cette table est cette référence, et elle est ÉMISE PAR LE SERVEUR :
--
--   * le chemin de stockage est CALCULÉ ici, jamais reçu du client. Une API qui croit un
--     chemin fourni par son appelant laisse lire — ou écraser — le fichier d'un autre ;
--   * le billet appartient à un propriétaire, et un billet d'un autre propriétaire est
--     invisible sous RLS comme il est introuvable sous `service_role` filtré ;
--   * il est À USAGE UNIQUE : `consumed_at` non nul le retire du jeu. Sans cela, un même
--     objet de staging pourrait alimenter deux sessions et deux vérités ;
--   * il EXPIRE. Un billet oublié n'est pas une porte ouverte indéfiniment.
create table if not exists public.import_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Domaine d'acquisition auquel ce billet est destiné. Un billet FEC ne sert pas un
  -- import bancaire : la cible se déclare, elle ne se déduit pas du contenu.
  domain text not null,
  -- Chemin CALCULÉ par le serveur dans le bucket privé. Jamais reçu du client.
  storage_path text not null,
  file_name text,
  content_type text,
  byte_size bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_session_id uuid,
  constraint import_upload_tickets_domain_ck check (domain in ('BUSINESS_ACCOUNTING')),
  constraint import_upload_tickets_path_uk unique (user_id, storage_path),
  constraint import_upload_tickets_size_ck check (byte_size > 0),
  constraint import_upload_tickets_expiry_ck check (expires_at > created_at),
  -- Un billet rattaché à une session est nécessairement consommé. L'inverse n'est PAS vrai,
  -- et c'est important : un billet est consommé À LA LECTURE du fichier, avant que la
  -- session existe. Si l'analyse échoue ensuite — en-tête inexploitable, dépôt incomplet —
  -- le billet reste consommé sans session, et c'est la vérité : l'objet a bien été réclamé
  -- une fois, et il ne doit pas pouvoir l'être une seconde.
  constraint import_upload_tickets_consumed_shape_ck check (
    consumed_session_id is null or consumed_at is not null
  ),
  constraint import_upload_tickets_session_fk
    foreign key (consumed_session_id, user_id)
    references public.import_sessions(id, user_id) on delete set null (consumed_session_id)
);

create unique index if not exists import_upload_tickets_id_user_uidx
  on public.import_upload_tickets(id, user_id);
create index if not exists import_upload_tickets_user_idx
  on public.import_upload_tickets(user_id, created_at desc);
create index if not exists import_upload_tickets_open_idx
  on public.import_upload_tickets(user_id, expires_at)
  where consumed_at is null;

comment on table public.import_upload_tickets is
  'Référence serveur d''un fichier déposé DIRECTEMENT au stockage privé. Le chemin est calculé côté serveur, le billet est à usage unique et expire : la route d''API ne reçoit jamais le fichier, ni un chemin fourni par le client.';

alter table public.import_upload_tickets enable row level security;
drop policy if exists owner_all on public.import_upload_tickets;
create policy owner_all on public.import_upload_tickets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on table public.import_upload_tickets from anon, authenticated;
grant select on table public.import_upload_tickets to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Écritures comptables — staging du domaine, et source des postes dérivés
-- ---------------------------------------------------------------------------
-- Les 18 champs réglementaires sont conservés TELS QUELS, y compris ceux qu'aucun calcul
-- n'utilise aujourd'hui : `piece_ref`, `lettering_code`, `validation_date` sont ce que la
-- comptabilité a écrit, et une relecture dans six ans en aura besoin.
--
-- `debit` et `credit` sont nullables, et la distinction est financièrement significative :
--
--     ABSENT  ≠  ZÉRO
--
-- Un côté absent face à un côté renseigné vaut zéro par la CONVENTION du format. Un zéro
-- explicitement transmis est une valeur. Les deux côtés absents ne sont pas un montant nul :
-- la ligne est bloquée.
create table if not exists public.fec_entry_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  raw_record_id uuid not null,
  business_id uuid not null,
  -- Les 18 champs du format, dans leur ordre réglementaire.
  journal_code text not null,
  journal_lib text,
  entry_num text not null,
  entry_date date,
  account_num text not null,
  account_lib text,
  aux_account_num text,
  aux_account_lib text,
  piece_ref text,
  piece_date date,
  entry_label text,
  debit numeric(20, 6),
  credit numeric(20, 6),
  lettering_code text,
  lettering_date date,
  validation_date date,
  currency_amount numeric(20, 6),
  currency_code char(3),
  -- Classification comptable DÉTERMINISTE, dérivée du numéro de compte. Ce n'est PAS un
  -- jugement économique : aucun retraitement, aucune qualification `DEBT_LIKE`.
  pcg_class smallint,
  pcg_group text not null,
  status text not null,
  issues jsonb not null default '[]'::jsonb,
  commit_state text not null default 'PENDING',
  committed_at timestamptz,
  data_kind text not null default 'ACTUAL',
  confidence text not null default 'HIGH',
  source text,
  created_at timestamptz not null default now(),
  constraint fec_entry_lines_session_fk
    foreign key (session_id, user_id)
    references public.import_sessions(id, user_id) on delete cascade,
  constraint fec_entry_lines_raw_fk
    foreign key (raw_record_id, user_id)
    references public.import_raw_records(id, user_id) on delete cascade,
  constraint fec_entry_lines_business_fk
    foreign key (business_id, user_id)
    references public.businesses(id, user_id) on delete cascade,
  -- Une ligne du fichier produit UNE écriture lue. Deux lectures de la même ligne brute
  -- seraient deux vérités concurrentes.
  constraint fec_entry_lines_raw_uk unique (user_id, raw_record_id),
  constraint fec_entry_lines_status_ck check (status in ('READY', 'WARNING', 'BLOCKED', 'IGNORED')),
  constraint fec_entry_lines_commit_state_ck check (commit_state in ('PENDING', 'COMMITTED', 'EXCLUDED')),
  constraint fec_entry_lines_data_kind_ck check (
    data_kind in ('ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING')
  ),
  constraint fec_entry_lines_issues_ck check (jsonb_typeof(issues) = 'array'),
  constraint fec_entry_lines_pcg_class_ck check (pcg_class is null or (pcg_class between 1 and 7)),
  -- AUCUNE contrainte de signe, et c'est le texte primaire qui l'impose : l'arrêté du
  -- 29 juillet 2013 autorise explicitement des valeurs numériques SIGNÉES. Un débit de
  -- −1 200 est une écriture valide — typiquement une contrepassation — et le refuser
  -- rejetterait des FEC parfaitement conformes. Lui appliquer une valeur absolue serait
  -- pire encore : cela inverserait le sens économique de l'opération sans laisser de trace.
  -- Une ligne sans aucun côté renseigné n'a pas de montant : elle est BLOQUÉE, jamais
  -- silencieusement comptée pour zéro.
  constraint fec_entry_lines_amount_shape_ck check (
    debit is not null or credit is not null or status = 'BLOCKED'
  ),
  -- Un montant en devise sans code devise n'est pas interprétable, et le supposer égal à
  -- la devise de tenue serait un taux de change implicite égal à 1.
  constraint fec_entry_lines_currency_ck check (
    currency_amount is null or currency_code is not null
  ),
  -- Ce qui est écrit au canonique doit être lisible : une écriture committée a une date et
  -- un compte, et n'est ni bloquée ni ignorée.
  constraint fec_entry_lines_committable_ck check (
    case
      when commit_state = 'COMMITTED'
        then status in ('READY', 'WARNING') and entry_date is not null and committed_at is not null
      else true
    end
  )
);

create unique index if not exists fec_entry_lines_id_user_uidx
  on public.fec_entry_lines(id, user_id);
create index if not exists fec_entry_lines_session_idx
  on public.fec_entry_lines(session_id, user_id);
create index if not exists fec_entry_lines_raw_idx
  on public.fec_entry_lines(raw_record_id, user_id);
-- Lecture principale du domaine : les écritures committées d'une société, par date.
create index if not exists fec_entry_lines_business_idx
  on public.fec_entry_lines(user_id, business_id, entry_date)
  where commit_state = 'COMMITTED';
-- Lecture par compte : c'est ainsi que l'on remonte un poste de bilan à ses écritures.
create index if not exists fec_entry_lines_account_idx
  on public.fec_entry_lines(user_id, business_id, account_num);
create index if not exists fec_entry_lines_group_idx
  on public.fec_entry_lines(user_id, business_id, pcg_group);
create index if not exists fec_entry_lines_entry_idx
  on public.fec_entry_lines(user_id, session_id, journal_code, entry_num);
create index if not exists fec_entry_lines_user_idx
  on public.fec_entry_lines(user_id, created_at desc);

comment on table public.fec_entry_lines is
  'Écritures comptables lues d''un FEC, 18 champs réglementaires conservés tels quels. Staging du domaine, et source unique des postes dérivés (BFR, comptes courants, dette comptable).';
comment on column public.fec_entry_lines.debit is
  'Débit. NULL = côté ABSENT du fichier ; 0 = zéro réellement transmis. Les deux côtés absents bloquent la ligne.';
comment on column public.fec_entry_lines.pcg_group is
  'Groupe comptable dérivé du numéro de compte. Classification COMPTABLE, jamais un jugement économique ni une qualification debt-like.';

-- Une écriture committée est gelée, comme une ligne normalisée bancaire committée.
--
-- Sans ce gel, la provenance d'un instantané financier pourrait être réécrite après coup :
-- un montant ou une date modifiés raconteraient une autre histoire que celle qui a
-- réellement produit le fait Business.
create or replace function public.fec_entry_line_frozen()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.commit_state <> 'COMMITTED' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Écriture comptable déjà écrite au canonique : sa provenance est gelée';
end;
$$;

drop trigger if exists fec_entry_lines_frozen on public.fec_entry_lines;
create trigger fec_entry_lines_frozen
  before update or delete on public.fec_entry_lines
  for each row execute function public.fec_entry_line_frozen();

-- ---------------------------------------------------------------------------
-- 5. Le brut immuable accepte l'état de réception
-- ---------------------------------------------------------------------------
-- Même doctrine qu'à l'origine : le brut ne se corrige pas, et sa suppression n'est
-- ouverte que sur une session qui n'a produit AUCUN fait. `RECEIVING` en fait partie —
-- une session interrompue en cours de réception est précisément le cas où rien n'a été
-- écrit au canonique.
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
  -- chemin n'est ouvert qu'à `service_role`, et il est lui-même barré dès qu'une ligne de
  -- staging de la session est committée — le gel de la provenance refuse alors sa propre
  -- cascade.
  if v_status is null then
    return old;
  end if;

  if v_status not in ('RECEIVING', 'ANALYZED') then
    raise exception
      'Enregistrement brut d''une session % : la provenance d''un fait écrit ne se supprime pas',
      v_status;
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Liens de provenance — cible comptable
-- ---------------------------------------------------------------------------
alter table public.import_record_links
  add column if not exists business_financials_id uuid;

-- Un fait produit par une SESSION entière n'a pas de ligne normalisée unique à désigner :
-- un instantané financier annuel est l'agrégat de milliers d'écritures. La colonne devient
-- donc nullable, et la contrainte de forme impose la cohérence par domaine.
alter table public.import_record_links alter column normalized_record_id drop not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_record_links_business_fk') then
    -- PAS de cascade, même invariant d'audit que pour les transactions : supprimer un
    -- instantané financier importé alors que sa provenance existe encore le laisserait
    -- étiqueté « importé » sans pouvoir dire d'où il vient.
    alter table public.import_record_links add constraint import_record_links_business_fk
      foreign key (business_financials_id, user_id)
      references public.business_financials(id, user_id) on delete restrict;
  end if;
  -- Une session ne se lie qu'une fois au même instantané. L'unicité n'est PAS posée sur
  -- l'instantané seul, et c'est délibéré : `lfo_record_business_financials` converge sur
  -- (société, date de clôture), donc un FEC réimporté après correction met à jour la MÊME
  -- ligne. La provenance d'un agrégat est un HISTORIQUE de sessions, là où celle d'une
  -- transaction est un fait unique. Ce que chaque session a réellement lu reste
  -- reconstituable depuis ses écritures conservées.
  if not exists (select 1 from pg_constraint where conname = 'import_record_links_business_session_uk') then
    alter table public.import_record_links add constraint import_record_links_business_session_uk
      unique (user_id, session_id, business_financials_id);
  end if;
end $$;

alter table public.import_record_links drop constraint if exists import_record_links_domain_ck;
alter table public.import_record_links drop constraint if exists import_record_links_target_ck;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_record_links_domain_v2_ck') then
    alter table public.import_record_links add constraint import_record_links_domain_v2_ck
      check (target_domain in ('CASH_FLOW_TRANSACTION', 'BUSINESS_ACCOUNTING'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_record_links_target_v2_ck') then
    alter table public.import_record_links add constraint import_record_links_target_v2_ck
      check (
        case
          when target_domain = 'CASH_FLOW_TRANSACTION'
            then transaction_id is not null and normalized_record_id is not null
                 and business_financials_id is null
          when target_domain = 'BUSINESS_ACCOUNTING'
            then business_financials_id is not null and transaction_id is null
                 and normalized_record_id is null
          else false
        end
      );
  end if;
end $$;

create index if not exists import_record_links_business_idx
  on public.import_record_links(business_financials_id, user_id)
  where business_financials_id is not null;

comment on column public.import_record_links.business_financials_id is
  'Instantané financier produit par une session comptable. Agrégat de la session entière : la provenance en est un historique, pas un fait unique.';

-- ---------------------------------------------------------------------------
-- 7. RLS et privilèges — la nouvelle table rejoint la piste d'audit
-- ---------------------------------------------------------------------------
-- `authenticated` n'a que le SELECT : toutes les écritures passent par les RPC `lfo_*`,
-- réservées à `service_role`. Une piste d'audit sur laquelle le client peut écrire n'est
-- pas une piste d'audit.
alter table public.fec_entry_lines enable row level security;
drop policy if exists owner_all on public.fec_entry_lines;
create policy owner_all on public.fec_entry_lines
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on table public.fec_entry_lines from anon, authenticated;
grant select on table public.fec_entry_lines to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RPC — réception fragmentée, puis validation atomique
-- ---------------------------------------------------------------------------

-- Émet un billet d'upload. Le chemin de stockage est CALCULÉ ici, à partir du propriétaire
-- et de l'identifiant du billet : il ne peut donc désigner ni le fichier d'un autre
-- propriétaire, ni un chemin choisi par l'appelant.
create or replace function public.lfo_issue_import_upload_ticket(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_size bigint := nullif(p_payload ->> 'byte_size', '')::bigint;
  v_ttl_minutes integer := coalesce(nullif(p_payload ->> 'ttl_minutes', '')::integer, 30);
begin
  if v_size is null or v_size <= 0 then
    raise exception 'Taille de fichier absente ou nulle : aucun billet d''upload émis';
  end if;

  insert into public.import_upload_tickets (
    id, user_id, domain, storage_path, file_name, content_type, byte_size, expires_at
  ) values (
    v_id,
    p_user_id,
    coalesce(nullif(p_payload ->> 'domain', ''), 'BUSINESS_ACCOUNTING'),
    -- Chemin dérivé du propriétaire et du billet. Aucune part n'en vient du client.
    p_user_id::text || '/import-staging/' || v_id::text,
    nullif(p_payload ->> 'file_name', ''),
    nullif(p_payload ->> 'content_type', ''),
    v_size,
    now() + make_interval(mins => v_ttl_minutes)
  );

  return v_id;
end;
$$;

-- Consomme un billet. À USAGE UNIQUE, et le verrou de ligne le garantit sous concurrence :
-- deux analyses simultanées du même billet ne peuvent pas conclure toutes les deux qu'il
-- est libre. Un billet expiré, déjà consommé, ou d'un autre propriétaire est introuvable.
create or replace function public.lfo_consume_import_upload_ticket(
  p_user_id uuid,
  p_ticket_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_consumed timestamptz;
  v_expires timestamptz;
begin
  select consumed_at, expires_at into v_consumed, v_expires
    from public.import_upload_tickets
   where id = p_ticket_id and user_id = p_user_id
     for update;

  if v_expires is null then
    raise exception 'Billet d''upload introuvable';
  end if;
  if v_consumed is not null then
    raise exception 'Billet d''upload déjà consommé : un objet de staging n''alimente qu''une session';
  end if;
  if v_expires <= now() then
    raise exception 'Billet d''upload expiré : redéposez le fichier';
  end if;

  update public.import_upload_tickets
     set consumed_at = now()
   where id = p_ticket_id and user_id = p_user_id;

  return p_ticket_id;
end;
$$;

-- Oublie le chemin de staging d'une session : l'objet a été supprimé, la référence n'a plus
-- de sens. Une session qui pointerait vers un objet inexistant ferait croire à une copie
-- disponible.
create or replace function public.lfo_clear_import_staging_path(
  p_user_id uuid,
  p_session_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.import_sessions
     set staging_storage_path = null
   where id = p_session_id and user_id = p_user_id;
  return p_session_id;
end;
$$;

-- Ouvre une session comptable et enregistre la source. Aucune ligne n'est encore reçue.
--
-- Idempotence : le même contenu de fichier déjà COMMITTÉ pour la même source est refusé.
-- Une session encore en réception ou analysée portant la même empreinte est REMPLACÉE :
-- reprendre un import interrompu ou réanalyser après correction est légitime, et n'a
-- produit aucun fait.
create or replace function public.lfo_open_fec_session(
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
  v_business_id uuid;
  v_source_id uuid;
  v_session_id uuid;
  v_file_hash text;
begin
  if v_source is null or v_session is null then
    raise exception 'Charge d''ouverture incomplète : source et session sont obligatoires';
  end if;

  v_business_id := nullif(v_source ->> 'target_business_id', '')::uuid;
  if v_business_id is null then
    raise exception 'Société cible obligatoire pour le domaine comptable';
  end if;
  if not exists (
    select 1 from public.businesses
     where id = v_business_id and user_id = p_user_id and coalesce(archived, false) = false
  ) then
    raise exception 'Société cible introuvable ou archivée';
  end if;

  insert into public.import_sources (
    user_id, kind, domain, provider, label, target_business_id, status, adapter_version,
    notes, source
  ) values (
    p_user_id,
    coalesce(nullif(v_source ->> 'kind', ''), 'FILE_CSV'),
    'BUSINESS_ACCOUNTING',
    v_source ->> 'provider',
    v_source ->> 'label',
    v_business_id,
    coalesce(nullif(v_source ->> 'status', ''), 'FILE_ONLY'),
    v_source ->> 'adapter_version',
    nullif(v_source ->> 'notes', ''),
    nullif(v_source ->> 'source', '')
  )
  on conflict (user_id, domain, provider, target_business_id) where target_business_id is not null
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

  if v_file_hash is not null then
    delete from public.import_sessions
     where user_id = p_user_id and source_id = v_source_id
       and file_hash = v_file_hash and status in ('RECEIVING', 'ANALYZED');
  end if;

  insert into public.import_sessions (
    user_id, source_id, file_name, file_hash, file_size_bytes, content_type,
    encoding, delimiter, parser, parser_version, conventions, declared_currency,
    observation_date, retain_file_requested, fiscal_year_start, fiscal_year_end,
    coverage_declared, declared_period_start, declared_period_end, status, issues,
    staging_storage_path
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
    v_session -> 'conventions',
    upper(nullif(v_session ->> 'declared_currency', '')),
    nullif(v_session ->> 'observation_date', '')::date,
    coalesce((v_session ->> 'retain_file_requested')::boolean, false),
    nullif(v_session ->> 'fiscal_year_start', '')::date,
    nullif(v_session ->> 'fiscal_year_end', '')::date,
    coalesce((v_session ->> 'coverage_declared')::boolean, false),
    nullif(v_session ->> 'declared_period_start', '')::date,
    nullif(v_session ->> 'declared_period_end', '')::date,
    'RECEIVING',
    coalesce(v_session -> 'issues', '[]'::jsonb),
    nullif(v_session ->> 'staging_storage_path', '')
  )
  returning id into v_session_id;

  -- Le billet consommé désigne la session qu'il a alimentée : la provenance d'un objet de
  -- staging se lit dans les deux sens.
  if nullif(v_session ->> 'upload_ticket_id', '') is not null then
    update public.import_upload_tickets
       set consumed_session_id = v_session_id
     where id = (v_session ->> 'upload_ticket_id')::uuid and user_id = p_user_id;
  end if;

  return v_session_id;
end;
$$;

-- Reçoit un LOT de lignes : le brut et son écriture lue, en une seule instruction.
--
-- Un FEC de 50 000 lignes ne passe pas dans un appel unique. Le lot est la seule
-- concession faite au volume, et elle ne change rien à la sémantique : chaque écriture
-- reste rattachée à SA ligne brute par le numéro de ligne du fichier.
create or replace function public.lfo_append_fec_lines(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid := (p_payload ->> 'session_id')::uuid;
  v_status text;
  v_business_id uuid;
  v_rows jsonb := coalesce(p_payload -> 'rows', '[]'::jsonb);
  v_parser text;
begin
  select ses.status, src.target_business_id, ses.parser
    into v_status, v_business_id, v_parser
    from public.import_sessions ses
    join public.import_sources src on src.id = ses.source_id and src.user_id = ses.user_id
   where ses.id = v_session_id and ses.user_id = p_user_id
     for update of ses;

  if v_status is null then
    raise exception 'Session d''import introuvable';
  end if;
  if v_status <> 'RECEIVING' then
    raise exception 'Session non ouverte à la réception (statut %)', v_status;
  end if;
  if v_business_id is null then
    raise exception 'Session sans société cible : source non comptable';
  end if;
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Les lignes reçues doivent être un tableau';
  end if;

  -- `as materialized` n'est pas décoratif : `raw` appelle `gen_random_uuid()` et est lu
  -- deux fois. Sans matérialisation forcée, une réévaluation produirait des identifiants
  -- différents dans chaque branche, et les écritures désigneraient un brut inexistant.
  with batch as (
    select
      (entry ->> 'row_number')::integer as row_number,
      coalesce(entry ->> 'raw_line', '') as raw_line,
      coalesce(entry -> 'cells', '[]'::jsonb) as cells,
      entry -> 'line' as line
    from jsonb_array_elements(v_rows) as entry
  ),
  raw as materialized (
    select gen_random_uuid() as raw_id, batch.* from batch
  ),
  inserted_raw as (
    insert into public.import_raw_records (id, user_id, session_id, row_number, raw_line, cells)
    select raw.raw_id, p_user_id, v_session_id, raw.row_number, raw.raw_line, raw.cells
    from raw
    returning id
  )
  insert into public.fec_entry_lines (
    user_id, session_id, raw_record_id, business_id,
    journal_code, journal_lib, entry_num, entry_date, account_num, account_lib,
    aux_account_num, aux_account_lib, piece_ref, piece_date, entry_label,
    debit, credit, lettering_code, lettering_date, validation_date,
    currency_amount, currency_code, pcg_class, pcg_group, status, issues, source
  )
  select
    p_user_id, v_session_id, raw.raw_id, v_business_id,
    coalesce(raw.line ->> 'journal_code', ''),
    nullif(raw.line ->> 'journal_lib', ''),
    coalesce(raw.line ->> 'entry_num', ''),
    nullif(raw.line ->> 'entry_date', '')::date,
    coalesce(raw.line ->> 'account_num', ''),
    nullif(raw.line ->> 'account_lib', ''),
    nullif(raw.line ->> 'aux_account_num', ''),
    nullif(raw.line ->> 'aux_account_lib', ''),
    nullif(raw.line ->> 'piece_ref', ''),
    nullif(raw.line ->> 'piece_date', '')::date,
    nullif(raw.line ->> 'entry_label', ''),
    nullif(raw.line ->> 'debit', '')::numeric,
    nullif(raw.line ->> 'credit', '')::numeric,
    nullif(raw.line ->> 'lettering_code', ''),
    nullif(raw.line ->> 'lettering_date', '')::date,
    nullif(raw.line ->> 'validation_date', '')::date,
    nullif(raw.line ->> 'currency_amount', '')::numeric,
    upper(nullif(raw.line ->> 'currency_code', '')),
    nullif(raw.line ->> 'pcg_class', '')::smallint,
    coalesce(raw.line ->> 'pcg_group', 'UNCLASSIFIED'),
    raw.line ->> 'status',
    coalesce(raw.line -> 'issues', '[]'::jsonb),
    v_parser
  from raw
  where raw.line is not null;

  return v_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8 bis. Intégrité de la source comptable, dérivée des lignes persistées
-- ---------------------------------------------------------------------------
-- Σdébits = Σcrédits PAR ÉCRITURE. C'est l'invariant d'intégrité du format, pas un calcul
-- financier : il ne produit ni résultat, ni valorisation, et ne duplique aucun moteur. Il
-- vit ici parce qu'un décompte fourni par l'appelant ne prouve rien — la base est le seul
-- endroit qui puisse affirmer ce que les lignes persistées contiennent réellement.
--
-- Les lignes BLOQUÉES et IGNORÉES sont exclues : contrôler l'équilibre d'une écriture dont
-- un montant est illisible produirait un FAUX déséquilibre. Même règle que la lecture pure.
--
-- La tolérance de 0,005 absorbe l'arrondi de présentation, et rien de plus.
create or replace function public.lfo_fec_entry_balance(
  p_user_id uuid,
  p_session_id uuid
) returns table (entries integer, unbalanced integer)
language sql
security invoker
set search_path = ''
as $$
  with per_entry as (
    select
      journal_code,
      entry_num,
      sum(coalesce(debit, 0)) - sum(coalesce(credit, 0)) as imbalance
      from public.fec_entry_lines
     where user_id = p_user_id
       and session_id = p_session_id
       and status not in ('BLOCKED', 'IGNORED')
     group by journal_code, entry_num
  )
  select
    count(*)::integer,
    count(*) filter (where abs(imbalance) > 0.005)::integer
    from per_entry;
$$;

-- Clôt la réception : décomptes, période observée, anomalies de fichier, statut ANALYZED.
--
-- TOUS les décomptes sont DÉRIVÉS des lignes persistées, y compris le nombre d'écritures et
-- le nombre d'écritures déséquilibrées. Aucun n'est repris de la charge d'appel : ce que la
-- base contient est la seule mesure de ce qui a été reçu, et un décompte fourni par
-- l'appelant est un décompte que l'appelant peut se tromper — ou mentir — à produire.
--
-- Le contrôle de partie double en SQL n'est PAS une formule financière déplacée dans la
-- base, et il ne duplique aucun moteur : Σdébits = Σcrédits par écriture est l'invariant
-- d'INTÉGRITÉ de la source comptable, du même ordre que « la somme des quote-parts d'un
-- concours ne dépasse pas 1 ». Les états financiers, eux, restent calculés en TypeScript.
create or replace function public.lfo_finalize_fec_session(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid := (p_payload ->> 'session_id')::uuid;
  v_status text;
begin
  select status into v_status
    from public.import_sessions
   where id = v_session_id and user_id = p_user_id
     for update;
  if v_status is null then
    raise exception 'Session d''import introuvable';
  end if;
  if v_status <> 'RECEIVING' then
    raise exception 'Session non ouverte à la réception (statut %)', v_status;
  end if;

  update public.import_sessions ses
     set status = 'ANALYZED',
         analyzed_at = now(),
         issues = coalesce(p_payload -> 'issues', ses.issues),
         row_count = counted.total,
         ready_count = counted.ready,
         warning_count = counted.warning,
         blocked_count = counted.blocked,
         ignored_count = counted.ignored,
         entry_count = balance.entries,
         unbalanced_entry_count = balance.unbalanced,
         observed_period_start = counted.period_start,
         observed_period_end = counted.period_end
    from (
      select
        count(*)::integer as total,
        count(*) filter (where status = 'READY')::integer as ready,
        count(*) filter (where status = 'WARNING')::integer as warning,
        count(*) filter (where status = 'BLOCKED')::integer as blocked,
        count(*) filter (where status = 'IGNORED')::integer as ignored,
        min(entry_date) filter (where status <> 'BLOCKED') as period_start,
        max(entry_date) filter (where status <> 'BLOCKED') as period_end
        from public.fec_entry_lines
       where session_id = v_session_id and user_id = p_user_id
    ) as counted,
    (select * from public.lfo_fec_entry_balance(p_user_id, v_session_id)) as balance
   where ses.id = v_session_id and ses.user_id = p_user_id;

  return v_session_id;
end;
$$;

-- Écrit le fait canonique d'une session comptable : l'instantané financier de la société,
-- ses écritures gelées, et le lien de provenance — en une seule transaction.
--
-- Trois refus structurels, et aucun n'est une précaution décorative :
--
--   * couverture non DÉCLARÉE : des totaux exacts sur les lignes fournies ne constituent
--     pas un exercice, et l'écrire comme tel surévaluerait ou sous-évaluerait la société ;
--   * écriture DÉSÉQUILIBRÉE : la partie double n'est pas vérifiée, donc les états
--     reconstruits ne sont pas fiables. Le déséquilibre est RECALCULÉ ici depuis les lignes
--     persistées, jamais relu sur `import_sessions.unbalanced_entry_count` : cette colonne
--     est un fait d'audit utile à l'affichage, mais elle est modifiable, et un invariant qui
--     repose sur une valeur modifiable n'est pas un invariant ;
--   * ligne BLOQUÉE : un montant illisible dans le fichier rend l'agrégat faux, et un
--     agrégat faux d'apparence complète est le pire résultat possible ;
--   * écriture HORS de l'exercice déclaré : un exercice annoncé complet qui contient des
--     écritures d'une autre période ne produit le résultat d'AUCUNE période réelle ;
--   * PÉRIODE FINANCIÈRE DÉJÀ RENSEIGNÉE PAR UNE AUTRE SOURCE.
--
--         CONFLIT DE SOURCES  ≠  CHOIX SILENCIEUX D'UNE SOURCE
--
--     `lfo_record_business_financials` converge sur (société, date de clôture). Sans le
--     contrôle ci-dessous, importer le FEC 2025 ÉCRASERAIT sans un mot une période saisie
--     à la main, des comptes annuels vérifiés ou une autre source externe — et rien, dans
--     la ligne écrite, ne permettrait ensuite de s'en apercevoir.
--
--     Une réimportation FEC → FEC est une CORRECTION, et elle reste autorisée : la source
--     est la même, la nouvelle lecture remplace l'ancienne. Tout le reste est REFUSÉ.
--
--     Ce n'est pas un moteur de fusion de sources, et ce n'en sera pas un ici : pour une
--     V1, un REFUS SÛR vaut mieux qu'un arbitrage automatique. La résolution de précédence
--     multi-source est un chantier distinct, et il demandera une décision humaine.
--
-- La valorisation n'est pas touchée : ce qui est écrit est un FAIT financier daté. Aucune
-- Enterprise Value, aucun multiple, aucun retraitement normatif d'EBITDA.
create or replace function public.lfo_commit_fec_session(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid := (p_payload ->> 'session_id')::uuid;
  v_financials jsonb := p_payload -> 'financials';
  v_status text;
  v_source_id uuid;
  v_business_id uuid;
  v_coverage boolean;
  v_fy_start date;
  v_fy_end date;
  v_unbalanced integer;
  v_blocked integer;
  v_out_of_period integer;
  v_financials_id uuid;
  v_existing_financials_id uuid;
  v_financials_period_end date;
  v_committed integer := 0;
  v_period_start date;
  v_period_end date;
begin
  select ses.status, ses.source_id, src.target_business_id, ses.coverage_declared,
         ses.fiscal_year_start, ses.fiscal_year_end
    into v_status, v_source_id, v_business_id, v_coverage, v_fy_start, v_fy_end
    from public.import_sessions ses
    join public.import_sources src on src.id = ses.source_id and src.user_id = ses.user_id
   where ses.id = v_session_id and ses.user_id = p_user_id
     for update of ses;

  if v_status is null then
    raise exception 'Session d''import introuvable';
  end if;
  if v_status = 'COMMITTED' then
    return v_session_id;
  end if;
  if v_status <> 'ANALYZED' then
    raise exception 'Session d''import non validable (statut %)', v_status;
  end if;
  if v_business_id is null then
    raise exception 'Session sans société cible : source non comptable';
  end if;
  if v_coverage is not true then
    raise exception 'Couverture de l''exercice non déclarée : la reconstruction n''est pas un exercice complet';
  end if;
  -- Partie double RECALCULÉE depuis les lignes persistées. Un décompte de session pourrait
  -- avoir été remis à zéro entre l'analyse et la validation ; les lignes, elles, sont là.
  select unbalanced into v_unbalanced
    from public.lfo_fec_entry_balance(p_user_id, v_session_id);
  if coalesce(v_unbalanced, 0) > 0 then
    raise exception '% écriture(s) déséquilibrée(s) : la partie double n''est pas vérifiée', v_unbalanced;
  end if;

  select count(*)::integer into v_blocked
    from public.fec_entry_lines
   where session_id = v_session_id and user_id = p_user_id and status = 'BLOCKED';
  if v_blocked > 0 then
    raise exception '% ligne(s) illisible(s) : un agrégat construit dessus serait faux', v_blocked;
  end if;

  -- Un exercice DÉCLARÉ complet ne peut pas contenir des écritures d'une autre période.
  -- Les mélanger produirait un résultat qui n'est celui d'aucun exercice réel, et rien dans
  -- le fait canonique écrit ne permettrait ensuite de s'en apercevoir.
  select count(*)::integer into v_out_of_period
    from public.fec_entry_lines
   where session_id = v_session_id and user_id = p_user_id
     and status not in ('BLOCKED', 'IGNORED')
     and entry_date is not null
     and (entry_date < v_fy_start or entry_date > v_fy_end);
  if coalesce(v_out_of_period, 0) > 0 then
    raise exception
      '% ligne(s) hors de l''exercice déclaré (% → %) : corrigez les bornes de l''exercice, ou n''importez que le fichier de l''exercice',
      v_out_of_period, v_fy_start, v_fy_end;
  end if;

  if v_financials is null then
    raise exception 'Charge de validation incomplète : l''instantané financier est obligatoire';
  end if;

  -- ── CONFLIT DE SOURCES ────────────────────────────────────────────────────────────
  --
  -- Une période financière déjà renseignée n'est écrasée que si elle vient DÉJÀ d'un import
  -- comptable. La preuve est la provenance : un lien `BUSINESS_ACCOUNTING` vers cette ligne.
  -- Son absence signifie une autre origine — saisie, comptes annuels, source externe — et
  -- l'import s'arrête. Le contrôle vit ICI, dans la RPC : dans l'interface ou le
  -- repository, il se contournerait par le premier appel direct.
  v_financials_period_end := (v_financials ->> 'period_end')::date;
  if v_financials_period_end is null then
    raise exception 'Instantané financier sans date de clôture : rien à écrire';
  end if;

  select bf.id into v_existing_financials_id
    from public.business_financials bf
   where bf.user_id = p_user_id
     and bf.business_id = v_business_id
     and bf.period_end = v_financials_period_end;

  if v_existing_financials_id is not null and not exists (
    select 1
      from public.import_record_links link
     where link.user_id = p_user_id
       and link.business_financials_id = v_existing_financials_id
       and link.target_domain = 'BUSINESS_ACCOUNTING'
  ) then
    raise exception
      'BUSINESS_FINANCIALS_SOURCE_CONFLICT : une période financière existe déjà au % pour cette société, depuis une autre source. LFO ne l''écrase pas automatiquement.',
      v_financials_period_end;
  end if;

  -- Le fait canonique est écrit par la RPC Business existante, et par elle seule : un
  -- second chemin d'écriture serait une seconde vérité sur la même table.
  v_financials_id := public.lfo_record_business_financials(
    p_user_id,
    v_financials || jsonb_build_object('business_id', v_business_id::text)
  );

  update public.fec_entry_lines
     set commit_state = 'COMMITTED', committed_at = now()
   where session_id = v_session_id and user_id = p_user_id
     and commit_state = 'PENDING' and status in ('READY', 'WARNING');

  update public.fec_entry_lines
     set commit_state = 'EXCLUDED'
   where session_id = v_session_id and user_id = p_user_id and commit_state = 'PENDING';

  insert into public.import_record_links (
    user_id, session_id, normalized_record_id, target_domain, transaction_id,
    business_financials_id
  ) values (
    p_user_id, v_session_id, null, 'BUSINESS_ACCOUNTING', null, v_financials_id
  )
  on conflict (user_id, session_id, business_financials_id) do nothing;

  select count(*)::integer, min(entry_date), max(entry_date)
    into v_committed, v_period_start, v_period_end
    from public.fec_entry_lines
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

-- Abandon d'une analyse : chemin UNIQUE, étendu au domaine comptable et à l'état de
-- réception. Une session committée reste inabandonnable : on n'annule pas un fait en
-- effaçant sa trace.
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
  if v_status not in ('RECEIVING', 'ANALYZED') then
    raise exception 'Seule une session en réception ou analysée peut être abandonnée (statut %)', v_status;
  end if;

  -- Ordre imposé par les gardes d'immuabilité : les lignes de staging d'abord (aucune
  -- n'est committée sur une session non validée), puis le brut. Le statut ne passe à
  -- DISCARDED qu'ensuite, sans quoi la garde du brut refuserait sa propre suppression.
  delete from public.import_normalized_records
   where session_id = p_session_id and user_id = p_user_id;

  delete from public.fec_entry_lines
   where session_id = p_session_id and user_id = p_user_id;

  delete from public.import_raw_records
   where session_id = p_session_id and user_id = p_user_id;

  update public.import_sessions
     set status = 'DISCARDED', discarded_at = now()
   where id = p_session_id and user_id = p_user_id;

  return p_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Privilèges des RPC
-- ---------------------------------------------------------------------------
revoke all on function
  public.lfo_issue_import_upload_ticket(uuid, jsonb),
  public.lfo_consume_import_upload_ticket(uuid, uuid),
  public.lfo_clear_import_staging_path(uuid, uuid),
  public.lfo_fec_entry_balance(uuid, uuid),
  public.lfo_open_fec_session(uuid, jsonb),
  public.lfo_append_fec_lines(uuid, jsonb),
  public.lfo_finalize_fec_session(uuid, jsonb),
  public.lfo_commit_fec_session(uuid, jsonb),
  public.lfo_discard_import_session(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.lfo_issue_import_upload_ticket(uuid, jsonb),
  public.lfo_consume_import_upload_ticket(uuid, uuid),
  public.lfo_clear_import_staging_path(uuid, uuid),
  public.lfo_fec_entry_balance(uuid, uuid),
  public.lfo_open_fec_session(uuid, jsonb),
  public.lfo_append_fec_lines(uuid, jsonb),
  public.lfo_finalize_fec_session(uuid, jsonb),
  public.lfo_commit_fec_session(uuid, jsonb),
  public.lfo_discard_import_session(uuid, uuid)
to service_role;
