-- B19 : revue des candidats documentaires d'un échéancier de dette, et historique des
-- décisions par case pour toutes les familles de Document Intelligence.
--
-- Cahier des charges : `docs/consolidation/CAHIER_DES_CHARGES_B19_2026-09-25.md` ; arbitrages
-- D-UX-08 à D-UX-11 (`docs/produit/DECISIONS_PRODUIT_UX_2026-09-25.md`).
--
-- Le modèle de `20260831154500_document_intelligence_foundation` est RETENU : un second modèle
-- de candidats serait une seconde vérité de revue. Ses six incompatibilités avec un échéancier
-- se résolvent ici, additivement :
--
--   1. une lecture vise une société OU une dette, jamais les deux, jamais aucune ;
--   2. une lecture porte son format source (PDF, CSV, XLSX) ; un fichier tabulaire a la nature
--      `NOT_PDF`, un PDF garde l'une de ses quatre natures ;
--   3. une case porte une page OU une ligne source, jamais aucune ;
--   4. une case tabulaire porte sa localisation : feuille, ligne, colonne reconnue, en-tête
--      imprimé, référence de cellule ;
--   5. les unités `MONEY` et `DATE` s'ajoutent ; la devise est portée par la lecture, jamais
--      supposée ; une date se lit et se corrige dans des colonnes de date ;
--   6. une décision sur une case laisse une trace IMMUABLE (avant, après, motif, acteur établi
--      côté serveur, rôle constaté) et transmet la révision qu'elle a lue : le verrou est pris
--      AVANT la comparaison, une révision périmée échoue en conflit (LF409).
--
-- Ce qui n'est PAS fait ici (B20, B21) : rattacher une lecture validée au prêt, écrire une
-- ligne de `loan_schedules`, importer l'assurance, statuer dû / payé / prévu. Aucune table
-- canonique n'est écrite par cette migration ni par ses RPC.
--
-- Fonctions reprises de leur DERNIÈRE version (toutes uniques, dans `20260831154500`) :
-- `document_extraction_field_frozen`, `lfo_append_document_extraction_fields`,
-- `lfo_correct_document_extraction_field`, `lfo_validate_document_extraction`.
-- Contraintes étendues après lecture de leur définition en vigueur ; leurs successeurs portent
-- des noms vérifiés libres.

-- ---------------------------------------------------------------------------
-- 1. Lectures : cible dette, format source, devise, couverture
-- ---------------------------------------------------------------------------

alter table public.document_extraction_runs alter column business_id drop not null;

alter table public.document_extraction_runs
  add column if not exists liability_id uuid,
  add column if not exists source_format text not null default 'PDF',
  add column if not exists sheet_name text,
  add column if not exists currency char(3),
  add column if not exists currency_source text,
  add column if not exists line_count integer,
  add column if not exists first_due_date date,
  add column if not exists last_due_date date,
  add column if not exists completeness text,
  add column if not exists completeness_reasons jsonb not null default '[]'::jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'document_extraction_runs_liability_fk'
  ) then
    alter table public.document_extraction_runs
      add constraint document_extraction_runs_liability_fk
      foreign key (liability_id, user_id)
      references public.liabilities(id, user_id) on delete cascade;
  end if;
end $$;

-- Successeur de `document_extraction_runs_pdf_kind_ck` (pdf_kind in NATIVE_TEXT, IMAGE_ONLY,
-- MIXED, UNREADABLE). Un fichier tabulaire n'est pas un PDF : sa nature est `NOT_PDF`, et un
-- PDF ne peut pas la porter.
alter table public.document_extraction_runs drop constraint document_extraction_runs_pdf_kind_ck;
alter table public.document_extraction_runs
  add constraint document_extraction_runs_pdf_kind_v2_ck check (
    case
      when source_format = 'PDF'
        then pdf_kind in ('NATIVE_TEXT', 'IMAGE_ONLY', 'MIXED', 'UNREADABLE')
      else pdf_kind = 'NOT_PDF'
    end
  );

alter table public.document_extraction_runs
  add constraint document_extraction_runs_source_format_ck
    check (source_format in ('PDF', 'CSV', 'XLSX')),
  -- Une liasse ou des comptes annuels visent une société ; un échéancier vise une dette.
  -- Jamais les deux : la même lecture alimenterait deux domaines. Jamais aucune : elle ne
  -- serait rattachable à rien.
  add constraint document_extraction_runs_target_ck check (
    case
      when document_family = 'AMORTIZATION_SCHEDULE'
        then liability_id is not null and business_id is null
      else business_id is not null and liability_id is null
    end
  ),
  add constraint document_extraction_runs_currency_ck
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  add constraint document_extraction_runs_currency_source_ck check (
    currency_source is null or currency_source in ('COLUMN', 'HEADER', 'CELL', 'DECLARED')
  ),
  -- Une devise sans origine, ou une origine sans devise, ne dit pas d'où vient l'unité.
  add constraint document_extraction_runs_currency_shape_ck
    check ((currency is null) = (currency_source is null)),
  add constraint document_extraction_runs_line_count_ck
    check (line_count is null or line_count >= 0),
  add constraint document_extraction_runs_due_order_ck check (
    first_due_date is null or last_due_date is null or last_due_date >= first_due_date
  ),
  add constraint document_extraction_runs_completeness_ck
    check (completeness is null or completeness in ('COMPLETE', 'PARTIAL')),
  add constraint document_extraction_runs_completeness_reasons_ck check (
    jsonb_typeof(completeness_reasons) = 'array'
    and (completeness is distinct from 'COMPLETE' or jsonb_array_length(completeness_reasons) = 0)
  );

create index if not exists document_extraction_runs_liability_idx
  on public.document_extraction_runs(liability_id, user_id, extracted_at desc)
  where liability_id is not null;

-- Un même fichier ne se VALIDE qu'une fois pour une même dette : une seconde lecture validée
-- du même contenu ferait deux candidats concurrents au rattachement (B20). Garanti par la
-- base, sous concurrence, et non par un contrôle applicatif.
create unique index if not exists document_extraction_runs_validated_schedule_uidx
  on public.document_extraction_runs(user_id, liability_id, file_hash)
  where liability_id is not null and file_hash is not null
    and status in ('VALIDATED', 'LINKED');

comment on column public.document_extraction_runs.liability_id is
  'Dette visée par un échéancier. Une lecture vise une société OU une dette, jamais les deux.';
comment on column public.document_extraction_runs.completeness is
  'COMPLETE seulement si le premier solde égale le capital du contrat ET le dernier est nul ; sinon PARTIAL, sans coût total annoncé.';

-- ---------------------------------------------------------------------------
-- 2. Cases : localisation tabulaire, unités MONEY et DATE, révision
-- ---------------------------------------------------------------------------

alter table public.document_extraction_fields alter column page_number drop not null;

alter table public.document_extraction_fields
  add column if not exists row_number integer,
  add column if not exists sheet_name text,
  add column if not exists column_key text,
  add column if not exists column_label text,
  add column if not exists cell_ref text,
  add column if not exists normalized_date date,
  add column if not exists user_date date,
  add column if not exists decision_revision integer not null default 0;

alter table public.document_extraction_fields
  -- Une case est située : une page de PDF OU une ligne de fichier tabulaire. Jamais aucune,
  -- sans quoi « d'où vient cette valeur ? » n'aurait pas de réponse ; jamais les deux.
  add constraint document_extraction_fields_location_ck
    check ((page_number is null) <> (row_number is null)),
  add constraint document_extraction_fields_row_ck check (row_number is null or row_number > 0),
  add constraint document_extraction_fields_cell_ref_ck
    check (cell_ref is null or cell_ref ~ '^[A-Z]{1,3}[1-9][0-9]*$'),
  add constraint document_extraction_fields_revision_ck check (decision_revision >= 0),
  -- Une date se lit et se corrige dans les colonnes de date, un nombre dans les colonnes de
  -- nombre : une valeur d'une unité ne se range jamais dans l'autre.
  add constraint document_extraction_fields_date_shape_ck check (
    case
      when unit = 'DATE' then normalized_value is null and user_value is null
      else normalized_date is null and user_date is null
    end
  ),
  -- Même règle que `raw_shape_ck` pour les dates : une date normalisée sans texte lu qui
  -- l'explique sortirait de nulle part.
  add constraint document_extraction_fields_raw_date_shape_ck check (
    extraction_method = 'USER_INPUT' or normalized_date is null or raw_value is not null
  );

-- Successeur de `document_extraction_fields_unit_ck` (EUR, PCT, COUNT, DAYS, TEXT).
alter table public.document_extraction_fields drop constraint document_extraction_fields_unit_ck;
alter table public.document_extraction_fields
  add constraint document_extraction_fields_unit_v2_ck check (
    unit in ('EUR', 'PCT', 'COUNT', 'DAYS', 'TEXT', 'MONEY', 'DATE')
  );

-- Successeurs de `corrected_shape_ck` et `user_value_shape_ck` : une correction de DATE
-- porte `user_date`. Les deux règles restent : une correction DIT QUAND et porte une valeur ;
-- une valeur corrigée sans le statut correspondant serait une correction invisible.
alter table public.document_extraction_fields
  drop constraint document_extraction_fields_corrected_shape_ck,
  drop constraint document_extraction_fields_user_value_shape_ck;
alter table public.document_extraction_fields
  add constraint document_extraction_fields_corrected_shape_v2_ck check (
    case
      when validation_status = 'CORRECTED'
        then (user_value is not null or user_date is not null) and user_corrected_at is not null
      else true
    end
  ),
  add constraint document_extraction_fields_user_value_shape_v2_ck check (
    (user_value is null and user_date is null) or validation_status = 'CORRECTED'
  );

-- `document_extraction_fields_box_uk` inclut `form_code`, NULL pour une case tabulaire :
-- PostgreSQL tient deux NULL pour distincts, l'unicité n'y serait pas garantie. Une case
-- tabulaire est unique par lecture et par code `L{ligne}.{colonne}`.
create unique index if not exists document_extraction_fields_tabular_box_uidx
  on public.document_extraction_fields(user_id, run_id, box_code)
  where row_number is not null;

comment on column public.document_extraction_fields.decision_revision is
  'Révision de la case. Une décision transmet celle qu''elle a lue ; une révision périmée échoue en conflit au lieu d''écraser une décision prise ailleurs.';

-- ---------------------------------------------------------------------------
-- 3. Gel de la lecture : la localisation tabulaire est une observation
-- ---------------------------------------------------------------------------
-- Reprise de la dernière version (`20260831154500`). Les comparaisons passent en
-- `is distinct from` : `page_number` peut désormais être NULL, et `NULL <> 3` ne lève rien.
create or replace function public.document_extraction_field_frozen()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.document_extraction_runs
   where id = coalesce(new.run_id, old.run_id) and user_id = coalesce(new.user_id, old.user_id);

  if tg_op = 'DELETE' then
    -- Une lecture qui a produit un fait ne perd pas ses cases : le fait deviendrait
    -- inexplicable.
    if v_status is null then
      return old;
    end if;
    if v_status = 'LINKED' then
      raise exception
        'Case d''une lecture rattachée à un fait canonique : la provenance ne se supprime pas';
    end if;
    return old;
  end if;

  if new.page_number is distinct from old.page_number
     or new.box_code <> old.box_code
     or new.form_code is distinct from old.form_code
     or new.occurrence <> old.occurrence
     or new.raw_value is distinct from old.raw_value
     or new.extraction_method <> old.extraction_method
     or new.bbox_x is distinct from old.bbox_x
     or new.bbox_y is distinct from old.bbox_y
     or new.bbox_width is distinct from old.bbox_width
     or new.bbox_height is distinct from old.bbox_height
     or new.row_number is distinct from old.row_number
     or new.sheet_name is distinct from old.sheet_name
     or new.column_key is distinct from old.column_key
     or new.column_label is distinct from old.column_label
     or new.cell_ref is distinct from old.cell_ref
     or new.normalized_date is distinct from old.normalized_date then
    raise exception
      'Ce que le document imprimait est immuable : corrigez la valeur (user_value), pas la lecture source';
  end if;

  if v_status = 'LINKED' then
    raise exception
      'Lecture rattachée à un fait canonique : elle est gelée, sans quoi le fait écrit deviendrait inexplicable';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Journal immuable des décisions par case
-- ---------------------------------------------------------------------------

create table if not exists public.document_field_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  run_id uuid not null,
  field_id uuid not null,
  -- Ordre total des décisions d'une case, attribué sous verrou : `now()` est le temps de la
  -- transaction et ne départage rien.
  decision_rank integer not null,
  action text not null,
  before_status text not null,
  before_value numeric(20,6),
  before_date date,
  after_status text not null,
  after_value numeric(20,6),
  after_date date,
  reason text,
  -- IDENTITÉ VÉRIFIÉE ≠ RÔLE D'EXÉCUTION : l'acteur est l'identité établie côté serveur, le rôle
  -- PostgreSQL constaté reste une colonne distincte.
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  executed_by text not null default current_user,
  decided_at timestamptz not null default now(),
  constraint document_field_decisions_field_fk
    foreign key (field_id, user_id)
    references public.document_extraction_fields(id, user_id) on delete cascade,
  constraint document_field_decisions_run_fk
    foreign key (run_id, user_id)
    references public.document_extraction_runs(id, user_id) on delete cascade,
  constraint document_field_decisions_rank_uk unique (user_id, field_id, decision_rank),
  constraint document_field_decisions_rank_ck check (decision_rank > 0),
  constraint document_field_decisions_action_ck check (action in ('REVIEW', 'CORRECT', 'REJECT')),
  constraint document_field_decisions_status_ck check (
    before_status in ('EXTRACTED', 'REVIEWED', 'CORRECTED', 'REJECTED', 'BLOCKED', 'UNKNOWN_BOX')
    and after_status in ('REVIEWED', 'CORRECTED', 'REJECTED')
  ),
  -- Sans délégation dans le produit, l'acteur est le propriétaire. Une future délégation se
  -- décidera ici, bruyamment.
  constraint document_field_decisions_actor_is_owner_ck check (actor_user_id = user_id),
  constraint document_field_decisions_reason_ck
    check (reason is null or length(btrim(reason)) between 1 and 500)
);

create unique index if not exists document_field_decisions_id_user_uidx
  on public.document_field_decisions(id, user_id);
create index if not exists document_field_decisions_field_idx
  on public.document_field_decisions(field_id, user_id, decision_rank);
create index if not exists document_field_decisions_run_idx
  on public.document_field_decisions(run_id, user_id, decided_at desc);
create index if not exists document_field_decisions_actor_idx
  on public.document_field_decisions(actor_user_id);

comment on table public.document_field_decisions is
  'Piste immuable des décisions sur une case lue : action, avant, après, motif, acteur vérifié, rôle constaté. Une décision n''efface jamais la précédente.';

-- Immuabilité. Une décision ne se met jamais à jour. Elle ne se supprime pas tant que sa
-- lecture existe : seule la disparition de la lecture elle-même l'emporte (cascade), sans
-- quoi une case pourrait perdre son historique en gardant sa valeur corrigée.
create or replace function public.document_field_decision_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Décision documentaire immuable : une nouvelle décision s''ajoute, elle ne réécrit pas la précédente';
  end if;
  if exists (
    select 1 from public.document_extraction_runs
     where id = old.run_id and user_id = old.user_id
  ) then
    raise exception 'Décision documentaire non supprimable tant que sa lecture existe';
  end if;
  return old;
end;
$$;

drop trigger if exists document_field_decisions_immutable on public.document_field_decisions;
create trigger document_field_decisions_immutable
  before update or delete on public.document_field_decisions
  for each row execute function public.document_field_decision_immutable();

alter table public.document_field_decisions enable row level security;
drop policy if exists owner_all on public.document_field_decisions;
create policy owner_all on public.document_field_decisions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on table public.document_field_decisions from anon, authenticated;
grant select on table public.document_field_decisions to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Ouverture d'un échéancier
-- ---------------------------------------------------------------------------
-- Le fichier a été lu côté serveur (`src/lib/acquisition/documents/schedule`) ; cette RPC
-- n'en reçoit que l'identité et les constats. Charge STRICTE : clé inconnue refusée, clé
-- d'acteur refusée.
create or replace function public.lfo_open_schedule_extraction(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_key text;
  v_liability_id uuid;
  v_hash text;
  v_status text;
  v_previous uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Ouverture d''échéancier : un objet est attendu' using errcode = 'LF422';
  end if;
  if p_payload ? 'actor_user_id' or p_payload ? 'decided_by' or p_payload ? 'executed_by' then
    raise exception 'L''acteur ne se déclare pas : il est établi par le serveur' using errcode = 'LF422';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in (
      'liability_id', 'status', 'source_format', 'sheet_name', 'file_name', 'file_hash',
      'file_size_bytes', 'content_type', 'document_id', 'extractor', 'extractor_version',
      'schema_version', 'currency', 'currency_source', 'line_count', 'first_due_date',
      'last_due_date', 'completeness', 'completeness_reasons', 'issues', 'error'
    ) then
      raise exception 'Ouverture d''échéancier : clé inconnue %', v_key using errcode = 'LF422';
    end if;
  end loop;

  v_liability_id := (p_payload ->> 'liability_id')::uuid;
  v_hash := p_payload ->> 'file_hash';
  v_status := p_payload ->> 'status';
  if v_liability_id is null then
    raise exception 'Échéancier sans dette visée : rien ne serait rattachable' using errcode = 'LF422';
  end if;
  if v_status is null or v_status not in ('EXTRACTED', 'FAILED') then
    raise exception 'Statut d''ouverture EXTRACTED ou FAILED attendu' using errcode = 'LF422';
  end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Empreinte SHA-256 du fichier attendue' using errcode = 'LF422';
  end if;

  -- Verrou de la dette AVANT toute comparaison : deux dépôts concurrents se sérialisent ici.
  perform 1 from public.liabilities
   where id = v_liability_id and user_id = p_user_id and archived = false
   for update;
  if not found then
    raise exception 'Dette introuvable ou archivée : aucune lecture ouverte' using errcode = 'LF404';
  end if;

  if exists (
    select 1 from public.document_extraction_runs
     where user_id = p_user_id and liability_id = v_liability_id
       and file_hash = v_hash and status in ('VALIDATED', 'LINKED')
  ) then
    raise exception 'Ce fichier a déjà été lu et validé pour cette dette : il n''est pas relu en silence'
      using errcode = 'LF409';
  end if;

  -- Lecture ouverte du même contenu : elle est REMPLACÉE, l'ancienne reste consultable.
  select id into v_previous
    from public.document_extraction_runs
   where user_id = p_user_id and liability_id = v_liability_id and file_hash = v_hash
     and status in ('EXTRACTED', 'REVIEWED', 'FAILED')
   order by extracted_at desc, created_at desc
   limit 1;

  insert into public.document_extraction_runs (
    id, user_id, business_id, liability_id, document_family, detection_basis, extractor,
    extractor_version, schema_version, source_format, pdf_kind, sheet_name, file_name,
    file_hash, file_size_bytes, content_type, document_id, currency, currency_source,
    line_count, first_due_date, last_due_date, completeness, completeness_reasons, status,
    supersedes_run_id, issues, error
  ) values (
    v_id, p_user_id, null, v_liability_id, 'AMORTIZATION_SCHEDULE', '[]'::jsonb,
    p_payload ->> 'extractor',
    p_payload ->> 'extractor_version',
    p_payload ->> 'schema_version',
    p_payload ->> 'source_format',
    'NOT_PDF',
    p_payload ->> 'sheet_name',
    p_payload ->> 'file_name',
    v_hash,
    (p_payload ->> 'file_size_bytes')::bigint,
    p_payload ->> 'content_type',
    (p_payload ->> 'document_id')::uuid,
    p_payload ->> 'currency',
    p_payload ->> 'currency_source',
    (p_payload ->> 'line_count')::integer,
    (p_payload ->> 'first_due_date')::date,
    (p_payload ->> 'last_due_date')::date,
    p_payload ->> 'completeness',
    coalesce(p_payload -> 'completeness_reasons', '[]'::jsonb),
    v_status,
    v_previous,
    coalesce(p_payload -> 'issues', '[]'::jsonb),
    p_payload ->> 'error'
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Lot de cases : la localisation tabulaire s'ajoute à la RPC EXISTANTE
-- ---------------------------------------------------------------------------
-- Reprise de la dernière version (`20260831154500`), étendue de clés optionnelles plutôt que
-- d'ouvrir un second chemin d'écriture. Une case de PDF reste inchangée.
create or replace function public.lfo_append_document_extraction_fields(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid := (p_payload ->> 'run_id')::uuid;
  v_status text;
  v_row jsonb;
  v_count integer := 0;
begin
  select status into v_status
    from public.document_extraction_runs
   where id = v_run_id and user_id = p_user_id
   for update;

  if v_status is null then
    raise exception 'Lecture documentaire introuvable';
  end if;
  -- Ajouter des cases à une lecture validée ou rattachée changerait ce que l'utilisateur a
  -- accepté, après qu'il l'a accepté.
  if v_status not in ('EXTRACTED', 'REVIEWED') then
    raise exception 'Lecture au statut % : elle ne reçoit plus de cases', v_status;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'fields', '[]'::jsonb))
  loop
    insert into public.document_extraction_fields (
      user_id, run_id, page_number, form_code, form_part, box_code, occurrence, label,
      bbox_x, bbox_y, bbox_width, bbox_height, raw_value, normalized_value, unit,
      extraction_method, confidence, confidence_score, validation_status, issues,
      row_number, sheet_name, column_key, column_label, cell_ref, normalized_date
    ) values (
      p_user_id, v_run_id,
      nullif(v_row ->> 'page_number', '')::integer,
      nullif(v_row ->> 'form_code', ''),
      nullif(v_row ->> 'form_part', ''),
      v_row ->> 'box_code',
      coalesce(nullif(v_row ->> 'occurrence', '')::integer, 0),
      nullif(v_row ->> 'label', ''),
      nullif(v_row ->> 'bbox_x', '')::numeric,
      nullif(v_row ->> 'bbox_y', '')::numeric,
      nullif(v_row ->> 'bbox_width', '')::numeric,
      nullif(v_row ->> 'bbox_height', '')::numeric,
      nullif(v_row ->> 'raw_value', ''),
      nullif(v_row ->> 'normalized_value', '')::numeric,
      coalesce(nullif(v_row ->> 'unit', ''), 'EUR'),
      coalesce(nullif(v_row ->> 'extraction_method', ''), 'NATIVE_TEXT_LAYOUT'),
      coalesce(nullif(v_row ->> 'confidence', ''), 'MEDIUM'),
      nullif(v_row ->> 'confidence_score', '')::numeric,
      coalesce(nullif(v_row ->> 'validation_status', ''), 'EXTRACTED'),
      coalesce(v_row -> 'issues', '[]'::jsonb),
      nullif(v_row ->> 'row_number', '')::integer,
      nullif(v_row ->> 'sheet_name', ''),
      nullif(v_row ->> 'column_key', ''),
      nullif(v_row ->> 'column_label', ''),
      nullif(v_row ->> 'cell_ref', ''),
      nullif(v_row ->> 'normalized_date', '')::date
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Décision sur une case : révision attendue, journal, ré-évaluation atomique
-- ---------------------------------------------------------------------------
-- Reprise de la dernière version (`20260831154500`) et étendue, pour TOUTES les familles
-- (liasse comprise) :
--
--   * `expected_revision` OBLIGATOIRE (nombre JSON entier) : le verrou de la case est pris
--     AVANT la comparaison, une révision périmée échoue en conflit (LF409) ;
--   * une correction de DATE porte `user_date` ; une case de texte ne se corrige pas ;
--   * chaque décision écrit une ligne IMMUABLE de `document_field_decisions` ;
--   * charge stricte : clé inconnue et clé d'acteur refusées ; montant en nombre fini, sans
--     NaN ni notation exponentielle.
--
-- Les actions restent `correct`, `reject`, `review` (forme reçue par le client existant). Le
-- motif reste facultatif : son absence est consignée telle quelle, jamais inventée.
create or replace function public.lfo_correct_document_extraction_field(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_field_id uuid;
  v_action text;
  v_expected integer;
  v_reason text;
  v_value numeric;
  v_date date;
  v_run_id uuid;
  v_status text;
  v_unit text;
  v_field_status text;
  v_revision integer;
  v_before_value numeric;
  v_before_date date;
  v_after_status text;
  v_rank integer;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Décision sur une case : un objet est attendu' using errcode = 'LF422';
  end if;
  if p_payload ? 'actor_user_id' or p_payload ? 'decided_by' or p_payload ? 'executed_by' then
    raise exception 'L''acteur ne se déclare pas : il est établi par le serveur' using errcode = 'LF422';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('field_id', 'action', 'expected_revision', 'user_value', 'user_date', 'reason') then
      raise exception 'Décision sur une case : clé inconnue %', v_key using errcode = 'LF422';
    end if;
  end loop;

  v_field_id := (p_payload ->> 'field_id')::uuid;
  v_action := p_payload ->> 'action';
  if v_action is null or v_action not in ('correct', 'reject', 'review') then
    raise exception 'Action correct, reject ou review attendue' using errcode = 'LF422';
  end if;
  -- Deux gardes : PostgreSQL ne garantit pas le court-circuit d'un OR avant un cast.
  if coalesce(jsonb_typeof(p_payload -> 'expected_revision'), 'absent') <> 'number'
     or (p_payload ->> 'expected_revision') !~ '^[0-9]{1,9}$' then
    raise exception 'Révision attendue obligatoire : sans elle, une seconde décision écraserait la première'
      using errcode = 'LF422';
  end if;
  v_expected := (p_payload ->> 'expected_revision')::integer;
  if p_payload ? 'reason'
     and coalesce(jsonb_typeof(p_payload -> 'reason'), 'absent') not in ('string', 'null') then
    raise exception 'Motif attendu en texte' using errcode = 'LF422';
  end if;
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');

  -- Verrou AVANT la comparaison.
  select f.run_id, r.status, f.unit, f.validation_status, f.decision_revision,
         coalesce(f.user_value, f.normalized_value), coalesce(f.user_date, f.normalized_date)
    into v_run_id, v_status, v_unit, v_field_status, v_revision, v_before_value, v_before_date
    from public.document_extraction_fields f
    join public.document_extraction_runs r on r.id = f.run_id and r.user_id = f.user_id
   where f.id = v_field_id and f.user_id = p_user_id
   for update of f, r;

  if v_run_id is null then
    raise exception 'Case introuvable' using errcode = 'LF404';
  end if;
  if v_status not in ('EXTRACTED', 'REVIEWED', 'VALIDATED') then
    raise exception 'Lecture au statut % : ses cases ne se corrigent plus', v_status;
  end if;
  if v_revision <> v_expected then
    raise exception 'Cette case a changé depuis votre lecture (révision % attendue, % courante) : relisez-la avant de décider',
      v_expected, v_revision using errcode = 'LF409';
  end if;

  if v_action = 'correct' then
    if v_unit = 'TEXT' then
      raise exception 'Une case de texte ne se corrige pas : elle n''entre dans aucun calcul'
        using errcode = 'LF422';
    end if;
    if v_unit = 'DATE' then
      if p_payload ? 'user_value' then
        raise exception 'Une case de date se corrige par user_date' using errcode = 'LF422';
      end if;
      if coalesce(jsonb_typeof(p_payload -> 'user_date'), 'absent') <> 'string'
         or (p_payload ->> 'user_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception
          'Correction sans valeur : corriger vers rien n''est pas une correction, c''est un rejet';
      end if;
      begin
        v_date := (p_payload ->> 'user_date')::date;
      exception when others then
        raise exception 'Date de correction inexistante au calendrier' using errcode = 'LF422';
      end;
    else
      if p_payload ? 'user_date' then
        raise exception 'Une case de nombre se corrige par user_value' using errcode = 'LF422';
      end if;
      if coalesce(jsonb_typeof(p_payload -> 'user_value'), 'absent') not in ('number', 'string') then
        raise exception
          'Correction sans valeur : corriger vers rien n''est pas une correction, c''est un rejet';
      end if;
      if (p_payload ->> 'user_value') !~ '^-?[0-9]+(\.[0-9]+)?$' then
        raise exception 'Montant de correction : nombre décimal fini attendu (ni NaN ni notation exponentielle)'
          using errcode = 'LF422';
      end if;
      v_value := (p_payload ->> 'user_value')::numeric;
    end if;
  elsif p_payload ? 'user_value' or p_payload ? 'user_date' then
    raise exception 'Seule une correction porte une valeur' using errcode = 'LF422';
  end if;

  if v_action = 'reject' then
    v_after_status := 'REJECTED';
    update public.document_extraction_fields
       set validation_status = 'REJECTED',
           user_value = null,
           user_date = null,
           user_corrected_at = now(),
           user_reason = v_reason,
           decision_revision = decision_revision + 1
     where id = v_field_id and user_id = p_user_id;
  elsif v_action = 'review' then
    v_after_status := 'REVIEWED';
    update public.document_extraction_fields
       set validation_status = 'REVIEWED',
           user_value = null,
           user_date = null,
           user_reason = v_reason,
           decision_revision = decision_revision + 1
     where id = v_field_id and user_id = p_user_id;
  else
    v_after_status := 'CORRECTED';
    update public.document_extraction_fields
       set validation_status = 'CORRECTED',
           user_value = v_value,
           user_date = v_date,
           user_corrected_at = now(),
           user_reason = v_reason,
           decision_revision = decision_revision + 1
     where id = v_field_id and user_id = p_user_id;
  end if;

  select coalesce(max(decision_rank), 0) + 1 into v_rank
    from public.document_field_decisions
   where field_id = v_field_id and user_id = p_user_id;

  insert into public.document_field_decisions (
    user_id, run_id, field_id, decision_rank, action, before_status, before_value, before_date,
    after_status, after_value, after_date, reason, actor_user_id
  ) values (
    p_user_id, v_run_id, v_field_id, v_rank, upper(v_action), v_field_status,
    case when v_unit = 'DATE' then null else v_before_value end,
    case when v_unit = 'DATE' then v_before_date else null end,
    v_after_status, v_value, v_date, v_reason, p_user_id
  );

  -- Une décision ramène la lecture en revue : elle n'est plus celle qui avait été validée.
  update public.document_extraction_runs
     set status = 'REVIEWED', reviewed_at = now(), validated_at = null
   where id = v_run_id and user_id = p_user_id and status in ('EXTRACTED', 'REVIEWED', 'VALIDATED');

  perform public.lfo_evaluate_document_extraction_checks(
    p_user_id, jsonb_build_object('run_id', v_run_id::text)
  );

  return v_field_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Validation de la LECTURE : un échéancier exige sa devise et des dates cohérentes
-- ---------------------------------------------------------------------------
-- Reprise de la dernière version (`20260831154500`). Pour un échéancier, trois conditions
-- s'ajoutent, toutes RELUES depuis les cases persistées (une charge forgée ne les contourne
-- pas) : une devise, aucune date d'échéance en double, des dates strictement croissantes.
-- Ce sont des comparaisons de dates, pas une formule financière. Aucun fait canonique n'est
-- écrit : rattacher la lecture au prêt est B20.
create or replace function public.lfo_validate_document_extraction(
  p_user_id uuid,
  p_run_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_family text;
  v_currency text;
  v_blocking integer;
  v_blocked integer;
  v_duplicates integer;
  v_disorder integer;
begin
  select status, document_family, currency into v_status, v_family, v_currency
    from public.document_extraction_runs
   where id = p_run_id and user_id = p_user_id
   for update;

  if v_status is null then
    raise exception 'Lecture documentaire introuvable';
  end if;
  if v_status in ('VALIDATED', 'LINKED') then
    return p_run_id;
  end if;
  if v_status not in ('EXTRACTED', 'REVIEWED') then
    raise exception 'Lecture au statut % : elle n''est pas validable', v_status;
  end if;

  -- Contrôles recomptés depuis la base. Un décompte de run pourrait avoir été écrit avant
  -- une correction ; les contrôles, eux, sont là.
  select count(*) filter (where status = 'FAILED' and severity = 'BLOCKING')
    into v_blocking
    from public.document_extraction_checks
   where run_id = p_run_id and user_id = p_user_id;

  if coalesce(v_blocking, 0) > 0 then
    raise exception
      '% contrôle(s) bloquant(s) en échec : valider ferait entrer dans le patrimoine une lecture que le document contredit',
      v_blocking;
  end if;

  select count(*) into v_blocked
    from public.document_extraction_fields
   where run_id = p_run_id and user_id = p_user_id and validation_status = 'BLOCKED';
  if coalesce(v_blocked, 0) > 0 then
    raise exception '% case(s) illisible(s) : corrigez-les ou rejetez-les avant de valider', v_blocked;
  end if;

  if v_family = 'AMORTIZATION_SCHEDULE' then
    if v_currency is null then
      raise exception 'Échéancier sans devise : déclarez-la avant de valider, aucune n''est supposée'
        using errcode = 'LF422';
    end if;

    with dates as (
      select row_number as line, coalesce(user_date, normalized_date) as due
        from public.document_extraction_fields
       where run_id = p_run_id and user_id = p_user_id and column_key = 'date'
         and validation_status <> 'REJECTED' and coalesce(user_date, normalized_date) is not null
    )
    select (select count(*) from (select due from dates group by due having count(*) > 1) d),
           (select count(*) from (
              select due, lag(due) over (order by line) as previous from dates
            ) o where o.previous is not null and o.due <= o.previous)
      into v_duplicates, v_disorder;
    if coalesce(v_duplicates, 0) > 0 then
      raise exception '% date(s) d''échéance en double : rejetez ou corrigez les lignes concernées avant de valider',
        v_duplicates using errcode = 'LF422';
    end if;
    if coalesce(v_disorder, 0) > 0 then
      raise exception 'Dates d''échéance non croissantes : l''ordre des lignes est à vérifier avant de valider'
        using errcode = 'LF422';
    end if;
  end if;

  update public.document_extraction_runs
     set status = 'VALIDATED', validated_at = now(),
         reviewed_at = coalesce(reviewed_at, now())
   where id = p_run_id and user_id = p_user_id;

  return p_run_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Privilèges des RPC
-- ---------------------------------------------------------------------------
revoke all on function public.lfo_open_schedule_extraction(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_open_schedule_extraction(uuid, jsonb) to service_role;
revoke all on function public.lfo_append_document_extraction_fields(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_append_document_extraction_fields(uuid, jsonb) to service_role;
revoke all on function public.lfo_correct_document_extraction_field(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_correct_document_extraction_field(uuid, jsonb) to service_role;
revoke all on function public.lfo_validate_document_extraction(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lfo_validate_document_extraction(uuid, uuid) to service_role;
