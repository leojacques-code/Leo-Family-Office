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
  add column if not exists unbalanced_entry_count integer not null default 0;

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
  -- Les montants du FEC sont NON SIGNÉS : le sens est porté par la colonne, débit ou crédit.
  -- Un montant négatif signalerait une lecture fautive, pas une écriture en sens inverse.
  constraint fec_entry_lines_amount_sign_ck check (
    (debit is null or debit >= 0) and (credit is null or credit >= 0)
    and (currency_amount is null or currency_amount >= 0)
  ),
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
    coverage_declared, declared_period_start, declared_period_end, status, issues
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
    coalesce(v_session -> 'issues', '[]'::jsonb)
  )
  returning id into v_session_id;

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

-- Clôt la réception : décomptes, période observée, anomalies de fichier, statut ANALYZED.
-- Les décomptes sont RELUS en base plutôt que crus sur parole — ce que la base contient
-- est la seule mesure de ce qui a été reçu.
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
         entry_count = coalesce(nullif(p_payload ->> 'entry_count', '')::integer, 0),
         unbalanced_entry_count = coalesce(nullif(p_payload ->> 'unbalanced_entry_count', '')::integer, 0),
         row_count = counted.total,
         ready_count = counted.ready,
         warning_count = counted.warning,
         blocked_count = counted.blocked,
         ignored_count = counted.ignored,
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
    ) as counted
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
--     reconstruits ne sont pas fiables ;
--   * ligne BLOQUÉE : un montant illisible dans le fichier rend l'agrégat faux, et un
--     agrégat faux d'apparence complète est le pire résultat possible.
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
  v_unbalanced integer;
  v_blocked integer;
  v_financials_id uuid;
  v_committed integer := 0;
  v_period_start date;
  v_period_end date;
begin
  select ses.status, ses.source_id, src.target_business_id, ses.coverage_declared,
         ses.unbalanced_entry_count
    into v_status, v_source_id, v_business_id, v_coverage, v_unbalanced
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
  if coalesce(v_unbalanced, 0) > 0 then
    raise exception '% écriture(s) déséquilibrée(s) : la partie double n''est pas vérifiée', v_unbalanced;
  end if;

  select count(*)::integer into v_blocked
    from public.fec_entry_lines
   where session_id = v_session_id and user_id = p_user_id and status = 'BLOCKED';
  if v_blocked > 0 then
    raise exception '% ligne(s) illisible(s) : un agrégat construit dessus serait faux', v_blocked;
  end if;

  if v_financials is null then
    raise exception 'Charge de validation incomplète : l''instantané financier est obligatoire';
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
  public.lfo_open_fec_session(uuid, jsonb),
  public.lfo_append_fec_lines(uuid, jsonb),
  public.lfo_finalize_fec_session(uuid, jsonb),
  public.lfo_commit_fec_session(uuid, jsonb),
  public.lfo_discard_import_session(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.lfo_open_fec_session(uuid, jsonb),
  public.lfo_append_fec_lines(uuid, jsonb),
  public.lfo_finalize_fec_session(uuid, jsonb),
  public.lfo_commit_fec_session(uuid, jsonb),
  public.lfo_discard_import_session(uuid, uuid)
to service_role;
