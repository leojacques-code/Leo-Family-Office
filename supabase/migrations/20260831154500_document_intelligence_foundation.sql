-- Léo Family Office — Document Intelligence, et première verticale : la liasse fiscale
--
-- Quatrième verticale de la fondation d'acquisition. Elle ajoute ce qui manquait entre le
-- coffre documentaire — un fichier stocké, jamais lu — et les moteurs de domaine : une
-- LECTURE de document, case par case, avec sa provenance géométrique, ses contrôles, ses
-- corrections humaines et son rattachement à un fait canonique.
--
-- Ce qu'elle ajoute :
--
--   document_extraction_runs    un acte d'extraction. Fichier, empreinte, famille de
--                               document, formulaire DÉTECTÉ avec sa preuve, nature du PDF,
--                               extracteur et sa version, décomptes, cycle de vie.
--
--   document_extraction_fields  une case lue. Page, formulaire, code de case, libellé,
--                               cadre géométrique, valeur BRUTE telle qu'imprimée, valeur
--                               normalisée, unité, méthode d'extraction, confiance, statut
--                               de validation, et correction utilisateur éventuelle.
--
--   document_extraction_checks  le résultat d'un contrôle. Ses opérandes, son écart, sa
--                               tolérance, et son STATUT — dont `NOT_COMPUTABLE`, qui n'est
--                               PAS un échec et surtout pas un succès.
--
-- Ce qu'elle RÉUTILISE, et qui compte davantage que ce qu'elle ajoute :
--
--   * `import_upload_tickets` et le chemin « navigateur → stockage privé » du FEC. Un PDF ne
--     traverse pas la fonction serveur : le billet est émis par le serveur, le chemin est
--     calculé en base, l'usage est unique et expirant. Rien de tout cela n'est réécrit.
--
--   * `import_record_links` comme UNIQUE pont de provenance. Une troisième forme s'y ajoute :
--     `TAX_RETURN_FINANCIALS`. Le FEC avait déjà rendu `normalized_record_id` nullable pour
--     une forme dont l'unité n'était pas une ligne ; la même logique s'applique ici, et
--     préférer une seconde table de liens ferait deux endroits où chercher « pourquoi cette
--     donnée existe-t-elle ? ».
--
--   * `lfo_record_business_financials`, chemin d'écriture EXISTANT et unique de
--     `business_financials`. Un second chemin serait une seconde vérité sur la même table.
--
--   * la doctrine complète : brut immuable, correction sur la couche normalisée, RPC `lfo_*`
--     réservées à `service_role`, `authenticated` en lecture seule, clés composites
--     `(id, user_id)`.
--
-- Invariants que la base fait tenir :
--
--   DOCUMENT ≠ LECTURE ≠ FAIT CANONIQUE. Trois étages, trois actes explicites. Déposer un
--   PDF n'écrit rien ; le lire n'écrit rien de canonique ; seule la liaison écrit un fait.
--
--   OCR_REQUIRED ≠ ÉCHEC ≠ VALEUR SUPPOSÉE. Un PDF sans couche texte est un fait technique
--   nommé. Aucune valeur n'en est déduite, et le run reste lisible.
--
--   CONTRÔLE NON CALCULABLE ≠ CONTRÔLE PASSÉ. Un contrôle dont les opérandes n'ont pas été
--   trouvés dans le document rend `NOT_COMPUTABLE`. Le compter comme réussi laisserait
--   valider une liasse dont l'équilibre n'a jamais été vérifié.
--
--   VALEUR BRUTE ≠ VALEUR NORMALISÉE ≠ VALEUR CORRIGÉE. Trois colonnes distinctes. Corriger
--   une lecture n'efface JAMAIS ce que le document imprimait.
--
--   CASE INCONNUE ≠ CASE IGNORÉE. Un code de case absent du registre de spécifications est
--   conservé avec le statut `UNKNOWN_BOX`. L'écarter perdrait une information imprimée.
--
--   LIASSE FISCALE ≠ COMPTE DE RÉSULTAT NORMALISÉ. Aucun EBITDA n'est écrit depuis une
--   liasse : un EBITDA est une convention, et la choisir est un jugement humain qui
--   appartient au ledger de Quality of Earnings. Même règle que pour le FEC.
--
--   CONFLIT DE SOURCES ≠ CHOIX SILENCIEUX D'UNE SOURCE. Une période financière déjà
--   renseignée par une autre origine n'est jamais écrasée. La preuve est la provenance.
--
-- Ce qu'elle ne fait PAS :
--
--   * aucune extraction en SQL. La lecture d'un PDF vit dans `src/lib/acquisition/documents/`.
--   * aucun OCR. Un PDF scanné rend `OCR_REQUIRED`, et rien d'autre.
--   * aucune valorisation, aucun retraitement normatif, aucun état financier reconstruit
--     au-delà de ce que le document imprime.

-- ---------------------------------------------------------------------------
-- 1. Zone de staging : le PDF y est accepté
-- ---------------------------------------------------------------------------
-- Ajout ADDITIF au bucket de staging. Sans lui, le dépôt direct échouerait au stockage,
-- APRÈS que le serveur a émis un billet : le contournement de la limite de corps de requête
-- ne servirait à rien.
update storage.buckets
   set allowed_mime_types = allowed_mime_types || array['application/pdf']
 where id = 'family-office-import-staging'
   and not ('application/pdf' = any(coalesce(allowed_mime_types, array[]::text[])));

-- ---------------------------------------------------------------------------
-- 2. Actes d'extraction
-- ---------------------------------------------------------------------------

create table if not exists public.document_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Société visée. Une liasse sans société n'est rattachable à rien.
  business_id uuid not null,
  -- Famille de document. C'est elle qui décide quel extracteur s'applique, et elle est
  -- DÉCLARÉE au dépôt : la deviner du contenu avant de savoir quoi chercher n'a pas de sens.
  document_family text not null,
  -- Formulaire réellement RECONNU dans le contenu. `null` = non reconnu, ce qui n'est pas
  -- « aucun formulaire » : le document reste lisible et ses cases restent extraites.
  detected_kind text,
  -- Millésime ou exercice reconnu. `null` = non reconnu.
  detected_variant text,
  -- PREUVE de la détection : les chaînes réellement trouvées, et à quelle page. Sans elle,
  -- « c'est une 2050 » est une affirmation invérifiable.
  detection_basis jsonb not null default '[]'::jsonb,
  extractor text not null,
  extractor_version text not null,
  schema_version text not null,
  -- Nature du PDF, telle qu'OBSERVÉE. `IMAGE_ONLY` est un fait technique, pas un échec.
  pdf_kind text not null,
  page_count integer,
  text_char_count integer,
  file_name text,
  file_hash text,
  file_size_bytes bigint,
  content_type text,
  -- Objet de staging, tant qu'il n'a pas été nettoyé. Même doctrine que le FEC : une
  -- suppression qui échoue CONSERVE la référence, sans quoi un document sensible resterait
  -- au stockage sans que rien ne sache où.
  staging_storage_path text,
  staging_cleanup_failed_at timestamptz,
  -- Fichier conservé au coffre privé, quand l'utilisateur l'a demandé.
  document_id uuid,
  -- Identité et exercice LUS DANS LE DOCUMENT. `null` = non lus, jamais devinés.
  siren char(9),
  fiscal_year_start date,
  fiscal_year_end date,
  status text not null,
  field_count integer not null default 0,
  unknown_box_count integer not null default 0,
  blocked_field_count integer not null default 0,
  corrected_field_count integer not null default 0,
  failed_check_count integer not null default 0,
  not_computable_check_count integer not null default 0,
  -- Version d'extraction : une relecture du même fichier remplace la précédente sans
  -- l'effacer. `null` = première lecture.
  supersedes_run_id uuid,
  issues jsonb not null default '[]'::jsonb,
  error text,
  extracted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  validated_at timestamptz,
  linked_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  constraint document_extraction_runs_business_fk
    foreign key (business_id, user_id)
    references public.businesses(id, user_id) on delete cascade,
  constraint document_extraction_runs_document_fk
    foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete set null (document_id),
  constraint document_extraction_runs_family_ck check (
    document_family in (
      'TAX_RETURN', 'ANNUAL_ACCOUNTS', 'BANK_STATEMENT', 'CONTRACT',
      'AMORTIZATION_SCHEDULE', 'WEALTH_DOCUMENT', 'OTHER'
    )
  ),
  constraint document_extraction_runs_pdf_kind_ck check (
    pdf_kind in ('NATIVE_TEXT', 'IMAGE_ONLY', 'MIXED', 'UNREADABLE')
  ),
  -- Cycle de vie. `VALIDATED` dit « la lecture est juste » ; `LINKED` dit « un fait canonique
  -- en est sorti ». Les deux sont des décisions distinctes, et les confondre priverait
  -- l'utilisateur du droit de valider une lecture sans en tirer un fait.
  constraint document_extraction_runs_status_ck check (
    status in ('EXTRACTED', 'OCR_REQUIRED', 'FAILED', 'REVIEWED', 'VALIDATED', 'LINKED', 'REJECTED')
  ),
  constraint document_extraction_runs_counts_ck check (
    field_count >= 0 and unknown_box_count >= 0 and blocked_field_count >= 0
    and corrected_field_count >= 0 and failed_check_count >= 0
    and not_computable_check_count >= 0
  ),
  -- Chaque état terminal DIT QUAND il a été atteint.
  constraint document_extraction_runs_validated_shape_ck check (
    case when status in ('VALIDATED', 'LINKED') then validated_at is not null else true end
  ),
  constraint document_extraction_runs_linked_shape_ck check (
    case when status = 'LINKED' then linked_at is not null else true end
  ),
  constraint document_extraction_runs_rejected_shape_ck check (
    case when status = 'REJECTED' then rejected_at is not null else true end
  ),
  -- Un PDF sans couche texte ne peut pas avoir été lu. Un run `OCR_REQUIRED` portant des
  -- cases prétendrait avoir extrait ce qu'il déclare ne pas savoir lire.
  constraint document_extraction_runs_ocr_shape_ck check (
    case when status = 'OCR_REQUIRED' then field_count = 0 else true end
  ),
  constraint document_extraction_runs_file_hash_ck check (
    file_hash is null or file_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint document_extraction_runs_siren_ck check (siren is null or siren ~ '^[0-9]{9}$'),
  constraint document_extraction_runs_fiscal_order_ck check (
    fiscal_year_start is null or fiscal_year_end is null
    or fiscal_year_end >= fiscal_year_start
  ),
  constraint document_extraction_runs_basis_ck check (jsonb_typeof(detection_basis) = 'array'),
  constraint document_extraction_runs_issues_ck check (jsonb_typeof(issues) = 'array'),
  constraint document_extraction_runs_pages_ck check (
    (page_count is null or page_count >= 0)
    and (text_char_count is null or text_char_count >= 0)
    and (file_size_bytes is null or file_size_bytes > 0)
  )
);

create unique index if not exists document_extraction_runs_id_user_uidx
  on public.document_extraction_runs(id, user_id);

-- La clé étrangère de version est POSTÉRIEURE : elle se référence elle-même sur
-- `(id, user_id)`. Aucune déférence n'est nécessaire ici — une nouvelle lecture désigne une
-- lecture qui EXISTE DÉJÀ, il n'y a pas d'état intermédiaire.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'document_extraction_runs_supersedes_fk'
  ) then
    alter table public.document_extraction_runs
      add constraint document_extraction_runs_supersedes_fk
      foreign key (supersedes_run_id, user_id)
      references public.document_extraction_runs(id, user_id)
      on delete set null (supersedes_run_id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'document_extraction_runs_supersedes_self_ck'
  ) then
    alter table public.document_extraction_runs
      add constraint document_extraction_runs_supersedes_self_ck
      check (supersedes_run_id is null or supersedes_run_id <> id);
  end if;
end $$;

-- IDEMPOTENCE : un même contenu de fichier ne produit qu'UN fait canonique par société.
-- Une relecture reste possible tant qu'aucun fait n'a été écrit ; dès qu'il l'est, réimporter
-- la même liasse est refusé par la base, même si l'interface était contournée.
create unique index if not exists document_extraction_runs_linked_file_uidx
  on public.document_extraction_runs(user_id, business_id, file_hash)
  where file_hash is not null and status = 'LINKED';
create index if not exists document_extraction_runs_business_idx
  on public.document_extraction_runs(business_id, user_id, extracted_at desc);
create index if not exists document_extraction_runs_document_idx
  on public.document_extraction_runs(document_id, user_id)
  where document_id is not null;
create index if not exists document_extraction_runs_supersedes_idx
  on public.document_extraction_runs(supersedes_run_id, user_id)
  where supersedes_run_id is not null;
create index if not exists document_extraction_runs_user_idx
  on public.document_extraction_runs(user_id, extracted_at desc);
create index if not exists document_extraction_runs_open_idx
  on public.document_extraction_runs(user_id, business_id, status)
  where status in ('EXTRACTED', 'REVIEWED', 'VALIDATED');

comment on table public.document_extraction_runs is
  'Un acte d''extraction documentaire : fichier, formulaire détecté avec sa preuve, nature du PDF, extracteur, décomptes et cycle de vie. Répond à « d''où vient cette case ? ».';
comment on column public.document_extraction_runs.detection_basis is
  'Preuve de la détection : chaînes réellement trouvées et page. Sans elle, « c''est une 2050 » est invérifiable.';
comment on column public.document_extraction_runs.status is
  'VALIDATED = la lecture est jugée juste. LINKED = un fait canonique en est sorti. Deux décisions distinctes.';

-- ---------------------------------------------------------------------------
-- 3. Cases lues
-- ---------------------------------------------------------------------------

create table if not exists public.document_extraction_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  -- Page DANS LE DOCUMENT, telle que l'utilisateur la voit dans son lecteur.
  page_number integer not null,
  -- Formulaire porteur, quand il est reconnu. Deux formulaires d'une même liasse peuvent
  -- porter le même code de case : les confondre mélangerait un actif et un passif.
  form_code text,
  form_part text,
  -- Code de case tel qu'IMPRIMÉ dans le document. Il n'est PAS pris dans une table de
  -- référence : il est lu. Aucun code n'est donc inventé, et un formulaire inconnu reste
  -- exploitable.
  box_code text not null,
  -- Occurrence, quand un même code apparaît plusieurs fois sur une page. Elle existe pour
  -- ne RIEN perdre : sans elle, la seconde occurrence écraserait la première.
  occurrence integer not null default 0,
  label text,
  -- Cadre géométrique dans le repère du PDF, quand il est disponible. C'est lui qui permet
  -- de montrer à l'utilisateur OÙ la valeur a été lue.
  bbox_x numeric(12,3),
  bbox_y numeric(12,3),
  bbox_width numeric(12,3),
  bbox_height numeric(12,3),
  -- Valeur telle qu'imprimée, caractère pour caractère. Jamais réécrite.
  raw_value text,
  -- Valeur comprise. `null` = non comprise, jamais zéro.
  normalized_value numeric(20,6),
  unit text not null default 'EUR',
  extraction_method text not null,
  confidence text not null default 'MEDIUM',
  confidence_score numeric(5,4),
  validation_status text not null default 'EXTRACTED',
  -- Correction utilisateur. Elle vit à CÔTÉ de la valeur lue, jamais à sa place.
  user_value numeric(20,6),
  user_corrected_at timestamptz,
  user_reason text,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint document_extraction_fields_run_fk
    foreign key (run_id, user_id)
    references public.document_extraction_runs(id, user_id) on delete cascade,
  -- Une lecture par case, par formulaire et par occurrence.
  constraint document_extraction_fields_box_uk
    unique (user_id, run_id, form_code, box_code, occurrence),
  constraint document_extraction_fields_page_ck check (page_number > 0),
  constraint document_extraction_fields_occurrence_ck check (occurrence >= 0),
  constraint document_extraction_fields_unit_ck check (
    unit in ('EUR', 'PCT', 'COUNT', 'DAYS', 'TEXT')
  ),
  constraint document_extraction_fields_method_ck check (
    extraction_method in ('NATIVE_TEXT_LAYOUT', 'NATIVE_TEXT_LABEL', 'OCR', 'USER_INPUT')
  ),
  constraint document_extraction_fields_confidence_ck check (
    confidence in ('HIGH', 'MEDIUM', 'LOW')
  ),
  constraint document_extraction_fields_confidence_score_ck check (
    confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)
  ),
  -- `UNKNOWN_BOX` : le code est lu, le registre de spécifications ne le connaît pas. Ce
  -- n'est ni une erreur, ni une raison d'écarter la ligne.
  constraint document_extraction_fields_validation_ck check (
    validation_status in ('EXTRACTED', 'REVIEWED', 'CORRECTED', 'REJECTED', 'BLOCKED', 'UNKNOWN_BOX')
  ),
  -- Une correction DIT QUAND, et elle porte une valeur : « corriger vers rien » n'est pas une
  -- correction, c'est un rejet, et il a son propre statut.
  constraint document_extraction_fields_corrected_shape_ck check (
    case
      when validation_status = 'CORRECTED' then user_value is not null and user_corrected_at is not null
      else true
    end
  ),
  -- Une valeur corrigée sans le statut correspondant serait une correction invisible.
  constraint document_extraction_fields_user_value_shape_ck check (
    user_value is null or validation_status = 'CORRECTED'
  ),
  -- CASE VIDE ≠ CASE À ZÉRO. Une case de liasse laissée blanche ne déclare RIEN : son code
  -- est imprimé, sa valeur non. La ligne existe donc sans valeur brute ni valeur normalisée,
  -- et c'est une information — la compter zéro fausserait tout total construit dessus.
  --
  -- Ce qui est refusé, c'est l'inverse : une valeur NORMALISÉE sans valeur brute qui
  -- l'explique. Elle sortirait de nulle part.
  constraint document_extraction_fields_raw_shape_ck check (
    case
      when extraction_method = 'USER_INPUT' then true
      when normalized_value is not null then raw_value is not null
      else true
    end
  ),
  -- Un cadre géométrique est complet ou absent. Trois coordonnées sur quatre ne désignent
  -- aucune zone, et laisseraient croire à une position connue.
  constraint document_extraction_fields_bbox_shape_ck check (
    (bbox_x is null and bbox_y is null and bbox_width is null and bbox_height is null)
    or (bbox_x is not null and bbox_y is not null and bbox_width is not null and bbox_height is not null)
  ),
  constraint document_extraction_fields_bbox_size_ck check (
    (bbox_width is null or bbox_width >= 0) and (bbox_height is null or bbox_height >= 0)
  ),
  constraint document_extraction_fields_issues_ck check (jsonb_typeof(issues) = 'array')
);

create unique index if not exists document_extraction_fields_id_user_uidx
  on public.document_extraction_fields(id, user_id);
create index if not exists document_extraction_fields_run_idx
  on public.document_extraction_fields(run_id, user_id, page_number);
-- Recherche par code de case : c'est ainsi que les contrôles résolvent leurs opérandes.
create index if not exists document_extraction_fields_code_idx
  on public.document_extraction_fields(user_id, run_id, box_code);
create index if not exists document_extraction_fields_user_idx
  on public.document_extraction_fields(user_id, created_at desc);
create index if not exists document_extraction_fields_attention_idx
  on public.document_extraction_fields(user_id, run_id, validation_status)
  where validation_status in ('BLOCKED', 'UNKNOWN_BOX', 'CORRECTED');

comment on table public.document_extraction_fields is
  'Une case lue : page, formulaire, code imprimé, libellé, cadre géométrique, valeur brute, valeur normalisée, méthode, confiance, statut et correction éventuelle.';
comment on column public.document_extraction_fields.box_code is
  'Code de case tel qu''IMPRIMÉ dans le document. Il est LU, jamais pris dans une table de référence : aucun code n''est donc inventé.';
comment on column public.document_extraction_fields.raw_value is
  'Valeur telle qu''imprimée. Jamais réécrite : une correction remplit `user_value`, à côté.';

-- ---------------------------------------------------------------------------
-- 4. Contrôles
-- ---------------------------------------------------------------------------
-- Un contrôle porte son verdict ET ses opérandes. « Le bilan est équilibré » sans dire quelles
-- cases ont été comparées n'est pas un contrôle, c'est une affirmation.

create table if not exists public.document_extraction_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  check_code text not null,
  label text,
  severity text not null,
  -- `NOT_COMPUTABLE` n'est NI un échec NI un succès : les opérandes n'ont pas été trouvés.
  status text not null,
  expected_value numeric(20,6),
  actual_value numeric(20,6),
  difference numeric(20,6),
  tolerance numeric(20,6) not null default 0,
  -- Cases RÉELLEMENT utilisées, gauche et droite. C'est la traçabilité du contrôle.
  operands jsonb not null default '{}'::jsonb,
  message text,
  evaluated_at timestamptz not null default now(),
  constraint document_extraction_checks_run_fk
    foreign key (run_id, user_id)
    references public.document_extraction_runs(id, user_id) on delete cascade,
  constraint document_extraction_checks_code_uk unique (user_id, run_id, check_code),
  constraint document_extraction_checks_severity_ck check (
    severity in ('BLOCKING', 'WARNING', 'INFO')
  ),
  constraint document_extraction_checks_status_ck check (
    status in ('PASSED', 'FAILED', 'NOT_COMPUTABLE')
  ),
  -- Un contrôle passé ou échoué a comparé DEUX nombres. Sans eux, son verdict n'est pas
  -- reproductible ; c'est alors `NOT_COMPUTABLE` qu'il faut écrire.
  constraint document_extraction_checks_values_ck check (
    case
      when status in ('PASSED', 'FAILED')
        then expected_value is not null and actual_value is not null and difference is not null
      else true
    end
  ),
  constraint document_extraction_checks_tolerance_ck check (tolerance >= 0),
  constraint document_extraction_checks_operands_ck check (jsonb_typeof(operands) = 'object')
);

create unique index if not exists document_extraction_checks_id_user_uidx
  on public.document_extraction_checks(id, user_id);
create index if not exists document_extraction_checks_run_idx
  on public.document_extraction_checks(run_id, user_id, status);
create index if not exists document_extraction_checks_user_idx
  on public.document_extraction_checks(user_id, evaluated_at desc);

comment on table public.document_extraction_checks is
  'Résultat d''un contrôle documentaire, avec ses opérandes réels. NOT_COMPUTABLE n''est ni un échec ni un succès : les opérandes n''ont pas été trouvés.';

-- ---------------------------------------------------------------------------
-- 5. Gel de la lecture
-- ---------------------------------------------------------------------------
-- Deux règles, et elles ne se recouvrent pas :
--
--   1. ce que le DOCUMENT imprimait ne se réécrit JAMAIS, à aucun stade. Code de case, page,
--      cadre, valeur brute et méthode sont l'observation. Corriger une lecture remplit
--      `user_value` et passe le statut à `CORRECTED` ;
--
--   2. dès qu'un FAIT CANONIQUE est sorti de ce run, la lecture entière est gelée, y compris
--      les corrections : le fait écrit serait sinon explicable par une lecture qui a changé
--      depuis.
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

  if new.page_number <> old.page_number
     or new.box_code <> old.box_code
     or coalesce(new.form_code, '') <> coalesce(old.form_code, '')
     or new.occurrence <> old.occurrence
     or coalesce(new.raw_value, '') <> coalesce(old.raw_value, '')
     or new.extraction_method <> old.extraction_method
     or coalesce(new.bbox_x, -1) <> coalesce(old.bbox_x, -1)
     or coalesce(new.bbox_y, -1) <> coalesce(old.bbox_y, -1)
     or coalesce(new.bbox_width, -1) <> coalesce(old.bbox_width, -1)
     or coalesce(new.bbox_height, -1) <> coalesce(old.bbox_height, -1) then
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

drop trigger if exists document_extraction_fields_frozen on public.document_extraction_fields;
create trigger document_extraction_fields_frozen
  before update or delete on public.document_extraction_fields
  for each row execute function public.document_extraction_field_frozen();

-- ---------------------------------------------------------------------------
-- 6. Billet d'upload : le domaine documentaire rejoint le chemin existant
-- ---------------------------------------------------------------------------
alter table public.import_upload_tickets
  add column if not exists consumed_run_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_upload_tickets_run_fk'
  ) then
    alter table public.import_upload_tickets add constraint import_upload_tickets_run_fk
      foreign key (consumed_run_id, user_id)
      references public.document_extraction_runs(id, user_id)
      on delete set null (consumed_run_id);
  end if;
end $$;

alter table public.import_upload_tickets drop constraint if exists import_upload_tickets_domain_ck;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_upload_tickets_domain_v2_ck'
  ) then
    alter table public.import_upload_tickets add constraint import_upload_tickets_domain_v2_ck
      check (domain in ('BUSINESS_ACCOUNTING', 'DOCUMENT_EXTRACTION'));
  end if;
  -- Un billet alimente UNE lecture : une session comptable OU une extraction documentaire.
  -- Les deux à la fois signifierait que le même objet a été réclamé par deux chemins.
  if not exists (
    select 1 from pg_constraint where conname = 'import_upload_tickets_single_target_ck'
  ) then
    alter table public.import_upload_tickets add constraint import_upload_tickets_single_target_ck
      check (consumed_session_id is null or consumed_run_id is null);
  end if;
end $$;

create index if not exists import_upload_tickets_run_idx
  on public.import_upload_tickets(consumed_run_id, user_id)
  where consumed_run_id is not null;

comment on column public.import_upload_tickets.consumed_run_id is
  'Lecture documentaire alimentée par ce billet. Un billet sert une session comptable OU une extraction, jamais les deux.';

-- ---------------------------------------------------------------------------
-- 7. Pont de provenance : troisième forme
-- ---------------------------------------------------------------------------
-- `import_record_links` reste l'UNIQUE endroit où l'on demande « pourquoi cette donnée
-- existe-t-elle ? ». Le FEC avait déjà rendu `normalized_record_id` nullable pour une forme
-- dont l'unité n'était pas une ligne ; `session_id` le devient pour la même raison. La forme
-- de chaque domaine est refermée par le `case`, et le `else false` refuse tout domaine ajouté
-- sans forme déclarée.
alter table public.import_record_links
  add column if not exists extraction_run_id uuid;

alter table public.import_record_links alter column session_id drop not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_record_links_run_fk'
  ) then
    alter table public.import_record_links add constraint import_record_links_run_fk
      foreign key (extraction_run_id, user_id)
      references public.document_extraction_runs(id, user_id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'import_record_links_run_uk'
  ) then
    alter table public.import_record_links add constraint import_record_links_run_uk
      unique (user_id, extraction_run_id, business_financials_id);
  end if;
end $$;

alter table public.import_record_links drop constraint if exists import_record_links_domain_v2_ck;
alter table public.import_record_links drop constraint if exists import_record_links_target_v2_ck;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_record_links_domain_v3_ck'
  ) then
    alter table public.import_record_links add constraint import_record_links_domain_v3_ck
      check (target_domain in ('CASH_FLOW_TRANSACTION', 'BUSINESS_ACCOUNTING', 'TAX_RETURN_FINANCIALS'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'import_record_links_target_v3_ck'
  ) then
    alter table public.import_record_links add constraint import_record_links_target_v3_ck
      check (
        case
          when target_domain = 'CASH_FLOW_TRANSACTION'
            then transaction_id is not null and business_financials_id is null
                 and normalized_record_id is not null and session_id is not null
                 and extraction_run_id is null
          when target_domain = 'BUSINESS_ACCOUNTING'
            then business_financials_id is not null and transaction_id is null
                 and normalized_record_id is null and session_id is not null
                 and extraction_run_id is null
          when target_domain = 'TAX_RETURN_FINANCIALS'
            then business_financials_id is not null and transaction_id is null
                 and normalized_record_id is null and session_id is null
                 and extraction_run_id is not null
          else false
        end
      );
  end if;
end $$;

create index if not exists import_record_links_run_idx
  on public.import_record_links(extraction_run_id, user_id)
  where extraction_run_id is not null;

comment on column public.import_record_links.extraction_run_id is
  'Lecture documentaire qui a produit ce fait. Troisième forme du pont de provenance : son unité est un RUN, pas une ligne.';

-- ---------------------------------------------------------------------------
-- 8. RLS et privilèges
-- ---------------------------------------------------------------------------
do $$
declare target text;
begin
  foreach target in array array[
    'document_extraction_runs',
    'document_extraction_fields',
    'document_extraction_checks'
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
-- 9. RPC
-- ---------------------------------------------------------------------------

-- Ouvre une lecture. Le fichier est DÉJÀ au stockage : cette RPC ne reçoit qu'une identité.
--
-- Idempotence : le même contenu déjà RATTACHÉ à un fait pour la même société est refusé.
-- Une lecture encore ouverte du même contenu est REMPLACÉE — relire après correction d'un
-- extracteur est légitime, et n'a produit aucun fait.
create or replace function public.lfo_open_document_extraction(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_business_id uuid := (p_payload ->> 'business_id')::uuid;
  v_hash text := nullif(p_payload ->> 'file_hash', '');
  v_status text := coalesce(nullif(p_payload ->> 'status', ''), 'EXTRACTED');
  v_previous uuid;
begin
  if v_business_id is null then
    raise exception 'Lecture documentaire sans société cible : rien ne serait rattachable';
  end if;

  perform 1 from public.businesses
   where id = v_business_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'Société introuvable : aucune lecture ouverte';
  end if;

  if v_hash is not null then
    if exists (
      select 1 from public.document_extraction_runs
       where user_id = p_user_id and business_id = v_business_id
         and file_hash = v_hash and status = 'LINKED'
    ) then
      raise exception
        'Ce document a déjà produit un fait canonique pour cette société : le réimporter le compterait deux fois';
    end if;

    -- Lecture ouverte du même contenu : elle est REMPLACÉE, et l'ancienne reste lisible.
    select id into v_previous
      from public.document_extraction_runs
     where user_id = p_user_id and business_id = v_business_id
       and file_hash = v_hash
       and status in ('EXTRACTED', 'REVIEWED', 'VALIDATED', 'OCR_REQUIRED', 'FAILED')
     order by extracted_at desc
     limit 1;
  end if;

  insert into public.document_extraction_runs (
    id, user_id, business_id, document_family, detected_kind, detected_variant,
    detection_basis, extractor, extractor_version, schema_version, pdf_kind, page_count,
    text_char_count, file_name, file_hash, file_size_bytes, content_type,
    staging_storage_path, siren, fiscal_year_start, fiscal_year_end, status,
    supersedes_run_id, issues, error
  ) values (
    v_id, p_user_id, v_business_id,
    coalesce(nullif(p_payload ->> 'document_family', ''), 'TAX_RETURN'),
    nullif(p_payload ->> 'detected_kind', ''),
    nullif(p_payload ->> 'detected_variant', ''),
    coalesce(p_payload -> 'detection_basis', '[]'::jsonb),
    coalesce(nullif(p_payload ->> 'extractor', ''), 'unknown'),
    coalesce(nullif(p_payload ->> 'extractor_version', ''), '0'),
    coalesce(nullif(p_payload ->> 'schema_version', ''), 'unknown'),
    coalesce(nullif(p_payload ->> 'pdf_kind', ''), 'UNREADABLE'),
    nullif(p_payload ->> 'page_count', '')::integer,
    nullif(p_payload ->> 'text_char_count', '')::integer,
    nullif(p_payload ->> 'file_name', ''),
    v_hash,
    nullif(p_payload ->> 'file_size_bytes', '')::bigint,
    nullif(p_payload ->> 'content_type', ''),
    nullif(p_payload ->> 'staging_storage_path', ''),
    nullif(p_payload ->> 'siren', ''),
    nullif(p_payload ->> 'fiscal_year_start', '')::date,
    nullif(p_payload ->> 'fiscal_year_end', '')::date,
    v_status,
    v_previous,
    coalesce(p_payload -> 'issues', '[]'::jsonb),
    nullif(p_payload ->> 'error', '')
  );

  return v_id;
end;
$$;

-- Reçoit un lot de cases. Une liasse complète en porte plusieurs centaines : le lot est la
-- seule concession au volume, et il ne change rien à la sémantique — chaque case reste
-- rattachée à SA page et à SON code imprimé.
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
      extraction_method, confidence, confidence_score, validation_status, issues
    ) values (
      p_user_id, v_run_id,
      (v_row ->> 'page_number')::integer,
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
      coalesce(v_row -> 'issues', '[]'::jsonb)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ÉVALUE les contrôles depuis les cases PERSISTÉES.
--
-- L'appelant fournit la DÉFINITION d'un contrôle — quelles cases comparer, avec quelle
-- tolérance — parce que ces cases ont été résolues depuis les libellés du document. Mais
-- l'ARITHMÉTIQUE est faite ici, sur les lignes en base : une charge forgée ne peut donc pas
-- déclarer une liasse équilibrée que les cases ne montrent pas. Même doctrine que
-- `lfo_fec_entry_balance`.
--
-- La valeur retenue par case est la CORRECTION quand elle existe, la lecture sinon : c'est
-- exactement la valeur sur laquelle l'utilisateur décide.
--
-- Une case absente rend le contrôle `NOT_COMPUTABLE`. Elle ne vaut PAS zéro : traiter une
-- case introuvable comme nulle ferait « passer » un équilibre que rien n'a vérifié.
create or replace function public.lfo_evaluate_document_extraction_checks(
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
  v_definitions jsonb;
  v_left numeric;
  v_right numeric;
  v_left_missing integer;
  v_right_missing integer;
  v_left_matched integer;
  v_right_matched integer;
  v_left_requested integer;
  v_right_requested integer;
  v_tolerance numeric;
  v_check_status text;
  v_difference numeric;
  v_count integer := 0;
  v_failed integer;
  v_not_computable integer;
begin
  select status into v_status
    from public.document_extraction_runs
   where id = v_run_id and user_id = p_user_id
   for update;
  if v_status is null then
    raise exception 'Lecture documentaire introuvable';
  end if;
  if v_status = 'LINKED' then
    raise exception 'Lecture rattachée à un fait canonique : ses contrôles sont gelés';
  end if;

  -- Les définitions viennent du payload, ou sont RELUES depuis les contrôles déjà persistés.
  -- Ce second chemin sert la ré-évaluation après correction : les opérandes sont en base, il
  -- n'y a aucune raison de les redemander au client.
  v_definitions := p_payload -> 'checks';
  if v_definitions is null then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'check_code', check_code,
                 'label', label,
                 'severity', severity,
                 'tolerance', tolerance,
                 'left', operands -> 'left',
                 'right', operands -> 'right',
                 'message', message
               )
             ),
             '[]'::jsonb)
      into v_definitions
      from public.document_extraction_checks
     where run_id = v_run_id and user_id = p_user_id;
  end if;

  for v_row in select * from jsonb_array_elements(v_definitions)
  loop
    v_tolerance := coalesce(nullif(v_row ->> 'tolerance', '')::numeric, 0);

    -- Chaque code doit désigner EXACTEMENT une case exploitable.
    --
    --   zéro case  → l'opérande est absent du document ;
    --   deux cases → le même code apparaît deux fois, et additionner les deux inventerait un
    --                total que le document ne porte pas.
    --
    -- Les deux situations rendent le contrôle NON CALCULABLE. Sommer « ce qu'on a trouvé »
    -- produirait un verdict qui a l'air d'un contrôle sans en être un.
    select count(f.id),
           count(distinct code.value),
           count(*) filter (where f.id is not null and coalesce(f.user_value, f.normalized_value) is null),
           coalesce(sum(coalesce(f.user_value, f.normalized_value)), 0)
      into v_left_matched, v_left_requested, v_left_missing, v_left
      from jsonb_array_elements_text(coalesce(v_row -> 'left', '[]'::jsonb)) as code(value)
      left join public.document_extraction_fields f
        on f.user_id = p_user_id and f.run_id = v_run_id and f.box_code = code.value
       and f.validation_status <> 'REJECTED';

    select count(f.id),
           count(distinct code.value),
           count(*) filter (where f.id is not null and coalesce(f.user_value, f.normalized_value) is null),
           coalesce(sum(coalesce(f.user_value, f.normalized_value)), 0)
      into v_right_matched, v_right_requested, v_right_missing, v_right
      from jsonb_array_elements_text(coalesce(v_row -> 'right', '[]'::jsonb)) as code(value)
      left join public.document_extraction_fields f
        on f.user_id = p_user_id and f.run_id = v_run_id and f.box_code = code.value
       and f.validation_status <> 'REJECTED';

    if coalesce(v_left_requested, 0) = 0 or coalesce(v_right_requested, 0) = 0
       or v_left_matched <> v_left_requested or v_right_matched <> v_right_requested
       or coalesce(v_left_missing, 0) > 0 or coalesce(v_right_missing, 0) > 0 then
      v_check_status := 'NOT_COMPUTABLE';
      v_difference := null;
      v_left := null;
      v_right := null;
    else
      v_difference := v_left - v_right;
      v_check_status := case when abs(v_difference) <= v_tolerance then 'PASSED' else 'FAILED' end;
    end if;

    insert into public.document_extraction_checks (
      user_id, run_id, check_code, label, severity, status, expected_value, actual_value,
      difference, tolerance, operands, message
    ) values (
      p_user_id, v_run_id,
      v_row ->> 'check_code',
      nullif(v_row ->> 'label', ''),
      coalesce(nullif(v_row ->> 'severity', ''), 'WARNING'),
      v_check_status,
      v_right,
      v_left,
      v_difference,
      v_tolerance,
      jsonb_build_object('left', coalesce(v_row -> 'left', '[]'::jsonb), 'right', coalesce(v_row -> 'right', '[]'::jsonb)),
      nullif(v_row ->> 'message', '')
    )
    on conflict (user_id, run_id, check_code) do update
       set status = excluded.status,
           severity = excluded.severity,
           label = excluded.label,
           expected_value = excluded.expected_value,
           actual_value = excluded.actual_value,
           difference = excluded.difference,
           tolerance = excluded.tolerance,
           operands = excluded.operands,
           message = excluded.message,
           evaluated_at = now();

    v_count := v_count + 1;
  end loop;

  select count(*) filter (where status = 'FAILED' and severity = 'BLOCKING'),
         count(*) filter (where status = 'NOT_COMPUTABLE')
    into v_failed, v_not_computable
    from public.document_extraction_checks
   where run_id = v_run_id and user_id = p_user_id;

  -- Les décomptes de la lecture sont DÉRIVÉS des lignes persistées, jamais repris d'un
  -- décompte fourni par l'appelant.
  update public.document_extraction_runs
     set failed_check_count = coalesce(v_failed, 0),
         not_computable_check_count = coalesce(v_not_computable, 0),
         field_count = (
           select count(*) from public.document_extraction_fields
            where run_id = v_run_id and user_id = p_user_id
         ),
         unknown_box_count = (
           select count(*) from public.document_extraction_fields
            where run_id = v_run_id and user_id = p_user_id and validation_status = 'UNKNOWN_BOX'
         ),
         blocked_field_count = (
           select count(*) from public.document_extraction_fields
            where run_id = v_run_id and user_id = p_user_id and validation_status = 'BLOCKED'
         ),
         corrected_field_count = (
           select count(*) from public.document_extraction_fields
            where run_id = v_run_id and user_id = p_user_id and validation_status = 'CORRECTED'
         )
   where id = v_run_id and user_id = p_user_id;

  return v_count;
end;
$$;

-- Corrige la lecture d'une case, et RÉ-ÉVALUE les contrôles dans la même transaction.
--
-- Sans la ré-évaluation atomique, l'utilisateur verrait une case corrigée à côté d'un
-- contrôle calculé sur l'ancienne valeur, et validerait un état qui n'a jamais existé.
create or replace function public.lfo_correct_document_extraction_field(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_field_id uuid := (p_payload ->> 'field_id')::uuid;
  v_run_id uuid;
  v_status text;
  v_value numeric := nullif(p_payload ->> 'user_value', '')::numeric;
  v_action text := coalesce(nullif(p_payload ->> 'action', ''), 'correct');
begin
  select f.run_id, r.status into v_run_id, v_status
    from public.document_extraction_fields f
    join public.document_extraction_runs r on r.id = f.run_id and r.user_id = f.user_id
   where f.id = v_field_id and f.user_id = p_user_id
   for update of f;

  if v_run_id is null then
    raise exception 'Case introuvable';
  end if;
  if v_status not in ('EXTRACTED', 'REVIEWED', 'VALIDATED') then
    raise exception 'Lecture au statut % : ses cases ne se corrigent plus', v_status;
  end if;

  if v_action = 'reject' then
    update public.document_extraction_fields
       set validation_status = 'REJECTED',
           user_value = null,
           user_corrected_at = now(),
           user_reason = nullif(p_payload ->> 'reason', '')
     where id = v_field_id and user_id = p_user_id;
  elsif v_action = 'review' then
    update public.document_extraction_fields
       set validation_status = 'REVIEWED',
           user_reason = nullif(p_payload ->> 'reason', '')
     where id = v_field_id and user_id = p_user_id;
  else
    if v_value is null then
      raise exception
        'Correction sans valeur : corriger vers rien n''est pas une correction, c''est un rejet';
    end if;
    update public.document_extraction_fields
       set validation_status = 'CORRECTED',
           user_value = v_value,
           user_corrected_at = now(),
           user_reason = nullif(p_payload ->> 'reason', '')
     where id = v_field_id and user_id = p_user_id;
  end if;

  -- Une correction ramène la lecture en revue : elle n'est plus celle qui avait été validée.
  update public.document_extraction_runs
     set status = 'REVIEWED', reviewed_at = now(), validated_at = null
   where id = v_run_id and user_id = p_user_id and status in ('EXTRACTED', 'REVIEWED', 'VALIDATED');

  perform public.lfo_evaluate_document_extraction_checks(
    p_user_id, jsonb_build_object('run_id', v_run_id::text)
  );

  return v_field_id;
end;
$$;

-- Valide la LECTURE. Aucun fait canonique n'est écrit ici, et c'est délibéré : juger une
-- lecture juste et en tirer un fait sont deux décisions.
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
  v_blocking integer;
  v_blocked integer;
begin
  select status into v_status
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

  update public.document_extraction_runs
     set status = 'VALIDATED', validated_at = now(),
         reviewed_at = coalesce(reviewed_at, now())
   where id = p_run_id and user_id = p_user_id;

  return p_run_id;
end;
$$;

-- Écrit le FAIT CANONIQUE et sa provenance, atomiquement. Seule porte de sortie vers
-- Business Equity.
--
-- Le fait est écrit par `lfo_record_business_financials`, la RPC EXISTANTE : un second chemin
-- d'écriture serait une seconde vérité sur la même table.
--
-- Aucun EBITDA, aucun EBIT, aucun capex n'est accepté ici. Une liasse fiscale n'est pas un
-- compte de résultat normalisé : choisir une convention d'EBITDA est un jugement humain qui
-- appartient au ledger de Quality of Earnings. Même règle que pour le FEC.
create or replace function public.lfo_link_document_extraction_financials(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid := (p_payload ->> 'run_id')::uuid;
  v_financials jsonb := p_payload -> 'financials';
  v_status text;
  v_business_id uuid;
  v_fy_end date;
  v_period_end date;
  v_existing_id uuid;
  v_financials_id uuid;
  v_forbidden text;
begin
  select status, business_id, fiscal_year_end
    into v_status, v_business_id, v_fy_end
    from public.document_extraction_runs
   where id = v_run_id and user_id = p_user_id
   for update;

  if v_status is null then
    raise exception 'Lecture documentaire introuvable';
  end if;
  if v_status = 'LINKED' then
    return v_run_id;
  end if;
  if v_status <> 'VALIDATED' then
    raise exception
      'Lecture au statut % : validez la lecture avant d''en tirer un fait canonique', v_status;
  end if;
  if v_financials is null then
    raise exception 'Charge de liaison incomplète : l''instantané financier est obligatoire';
  end if;

  -- L'exercice est LU dans le document. Sans lui, la date de clôture du fait serait
  -- choisie par l'appelant, et un instantané financier daté au hasard est pire qu'absent.
  if v_fy_end is null then
    raise exception
      'Exercice non lu dans le document : un instantané financier sans date de clôture démontrée n''est pas écrit';
  end if;

  v_period_end := nullif(v_financials ->> 'period_end', '')::date;
  if v_period_end is null then
    raise exception 'Instantané financier sans date de clôture : rien à écrire';
  end if;
  if v_period_end <> v_fy_end then
    raise exception
      'La clôture demandée (%) ne correspond pas à l''exercice lu dans le document (%)',
      v_period_end, v_fy_end;
  end if;

  -- Champs dont la définition demande un jugement : refusés, pas ignorés. Les ignorer
  -- silencieusement laisserait croire qu''ils ont été pris en compte.
  select string_agg(key, ', ')
    into v_forbidden
    from jsonb_object_keys(v_financials) as key
   where key in ('ebitda', 'ebit', 'capex', 'free_cash_flow', 'working_capital', 'gross_margin');
  if v_forbidden is not null then
    raise exception
      'Champ(s) % refusé(s) depuis une liasse : leur définition est une convention, et la choisir appartient au ledger de Quality of Earnings',
      v_forbidden;
  end if;

  -- ── CONFLIT DE SOURCES ────────────────────────────────────────────────────────────
  -- Une période déjà renseignée n'est écrasée que si elle vient DÉJÀ d'une lecture de liasse.
  -- La preuve est la provenance, pas un libellé.
  select bf.id into v_existing_id
    from public.business_financials bf
   where bf.user_id = p_user_id
     and bf.business_id = v_business_id
     and bf.period_end = v_period_end;

  if v_existing_id is not null and not exists (
    select 1 from public.import_record_links link
     where link.user_id = p_user_id
       and link.business_financials_id = v_existing_id
       and link.target_domain = 'TAX_RETURN_FINANCIALS'
  ) then
    raise exception
      'BUSINESS_FINANCIALS_SOURCE_CONFLICT : une période financière existe déjà au % pour cette société, depuis une autre source. LFO ne l''écrase pas automatiquement.',
      v_period_end;
  end if;

  v_financials_id := public.lfo_record_business_financials(
    p_user_id,
    v_financials || jsonb_build_object('business_id', v_business_id::text)
  );

  insert into public.import_record_links (
    user_id, session_id, normalized_record_id, target_domain, transaction_id,
    business_financials_id, extraction_run_id
  ) values (
    p_user_id, null, null, 'TAX_RETURN_FINANCIALS', null, v_financials_id, v_run_id
  )
  on conflict (user_id, extraction_run_id, business_financials_id) do nothing;

  update public.document_extraction_runs
     set status = 'LINKED', linked_at = now()
   where id = v_run_id and user_id = p_user_id;

  return v_run_id;
end;
$$;

-- Rejette une lecture. Une lecture rattachée à un fait n'est PAS rejetable : on n'annule pas
-- un fait en effaçant l'explication de son existence.
create or replace function public.lfo_reject_document_extraction(
  p_user_id uuid,
  p_run_id uuid,
  p_reason text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.document_extraction_runs
   where id = p_run_id and user_id = p_user_id
   for update;

  if v_status is null then
    raise exception 'Lecture documentaire introuvable';
  end if;
  if v_status = 'LINKED' then
    raise exception
      'Lecture rattachée à un fait canonique : elle ne se rejette pas. Retirez d''abord le fait';
  end if;

  update public.document_extraction_runs
     set status = 'REJECTED', rejected_at = now(), rejection_reason = nullif(p_reason, '')
   where id = p_run_id and user_id = p_user_id;

  return p_run_id;
end;
$$;

-- Enregistre le SORT de l'objet de staging d'une lecture. Même doctrine que le FEC : une
-- suppression qui échoue CONSERVE le chemin, sans quoi une liasse fiscale resterait au
-- stockage sans que rien ne sache où.
create or replace function public.lfo_record_document_staging_cleanup(
  p_user_id uuid,
  p_run_id uuid,
  p_removed boolean
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.document_extraction_runs
     set staging_storage_path = case when p_removed then null else staging_storage_path end,
         staging_cleanup_failed_at = case when p_removed then null else now() end
   where id = p_run_id and user_id = p_user_id;
  return p_run_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9 bis. Aucune modification de `lfo_record_business_financials`
-- ---------------------------------------------------------------------------
-- Une première version de cette migration réécrivait cette RPC pour lui faire accepter les
-- bornes de l'exercice. C'était une RÉGRESSION, et elle est consignée ici parce que le piège
-- se reproduira : la fonction a été révisée trois fois depuis sa création, et la version la
-- plus ancienne est celle qu'on trouve en premier dans l'historique. La réécrire à partir de
-- celle-là supprimait son `on conflict do update` — donc toute correction d'une période déjà
-- renseignée — et quatre colonnes ajoutées depuis.
--
-- La version en vigueur, posée par `20260826194551_business_equity_v2_1`, accepte DÉJÀ
-- `period_start`, `period_kind` et `period_label`. Il n'y avait rien à changer.
--
-- Règle qui en découle : avant de remplacer une RPC existante, chercher sa DERNIÈRE version
-- dans l'historique, jamais la première. Le gate complet l'a détecté — le smoke de cette
-- verticale, seul, ne l'aurait pas vu.

-- ---------------------------------------------------------------------------
-- 10. Privilèges des RPC
-- ---------------------------------------------------------------------------
revoke all on function
  public.lfo_open_document_extraction(uuid, jsonb),
  public.lfo_append_document_extraction_fields(uuid, jsonb),
  public.lfo_evaluate_document_extraction_checks(uuid, jsonb),
  public.lfo_correct_document_extraction_field(uuid, jsonb),
  public.lfo_validate_document_extraction(uuid, uuid),
  public.lfo_link_document_extraction_financials(uuid, jsonb),
  public.lfo_reject_document_extraction(uuid, uuid, text),
  public.lfo_record_document_staging_cleanup(uuid, uuid, boolean)
from public, anon, authenticated;

grant execute on function
  public.lfo_open_document_extraction(uuid, jsonb),
  public.lfo_append_document_extraction_fields(uuid, jsonb),
  public.lfo_evaluate_document_extraction_checks(uuid, jsonb),
  public.lfo_correct_document_extraction_field(uuid, jsonb),
  public.lfo_validate_document_extraction(uuid, uuid),
  public.lfo_link_document_extraction_financials(uuid, jsonb),
  public.lfo_reject_document_extraction(uuid, uuid, text),
  public.lfo_record_document_staging_cleanup(uuid, uuid, boolean)
to service_role;
