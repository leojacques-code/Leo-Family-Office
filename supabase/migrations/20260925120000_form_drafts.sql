-- Brouillons persistants (document 03 §8 ; arbitrage du 25 septembre 2026). Migration
-- ADDITIVE, limitée au domaine Dette et extensible par domaine.
--
--     BROUILLON ≠ OBSERVATION ≠ CONTRAT        ENREGISTRER UN BROUILLON ≠ VALIDER
--     VERSION ATTENDUE ≠ VERSION COURANTE
--
--   * `form_drafts` garde l'état d'un formulaire, même incomplet ou contradictoire. Aucune
--     table canonique n'y fait référence, aucun moteur ne la lit, aucune RPC de fait ne la
--     consulte : un brouillon n'alimente ni le patrimoine, ni un échéancier, ni un calcul.
--   * Le contenu est un objet JSON opaque pour la base, plafonné à 64 Kio, avec la version
--     du schéma de l'application qui l'a écrit. La base contrôle sa FORME, jamais sa finance.
--   * Concurrence : chaque écriture porte la version qu'elle a lue. Le verrou est pris AVANT
--     la comparaison ; une version périmée échoue en conflit révisable (`LF409`) au lieu
--     d'écraser une saisie faite ailleurs. Un brouillon disparu répond `LF404`.
--   * Un seul brouillon par dette existante (modification ou promotion) ; plusieurs
--     brouillons de dette nouvelle sont permis. Une dette supprimée emporte ses brouillons.
--   * Lecture seule pour le client, sous RLS ; deux RPC réservées à `service_role` écrivent.
--     Toute clé inconnue, dont une clé d'acteur, est refusée.
--   * Conservation : jusqu'à suppression par l'utilisateur ou validation du formulaire, qui
--     retire le brouillon qu'elle consomme.

create table if not exists public.form_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  kind text not null,
  subject_id uuid,
  title text not null,
  content jsonb not null,
  schema_version integer not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_drafts_domain_ck check (domain in ('DEBT')),
  constraint form_drafts_kind_ck check (
    (domain = 'DEBT' and kind in ('DEBT_CONTRACT_NEW', 'DEBT_CONTRACT_EDIT', 'DEBT_CONTRACT_PROMOTION'))
  ),
  constraint form_drafts_subject_ck check ((kind = 'DEBT_CONTRACT_NEW') = (subject_id is null)),
  constraint form_drafts_title_ck check (char_length(btrim(title)) between 1 and 160),
  constraint form_drafts_content_ck check (
    jsonb_typeof(content) = 'object' and pg_column_size(content) <= 65536
  ),
  constraint form_drafts_schema_version_ck check (schema_version between 1 and 1000),
  constraint form_drafts_version_ck check (version >= 1),
  constraint form_drafts_subject_fk foreign key (subject_id, user_id)
    references public.liabilities(id, user_id) on delete cascade
);
create unique index if not exists form_drafts_subject_uidx
  on public.form_drafts(user_id, subject_id) where subject_id is not null;
create index if not exists form_drafts_user_idx on public.form_drafts(user_id, updated_at desc);

alter table public.form_drafts enable row level security;
drop policy if exists owner_all on public.form_drafts;
create policy owner_all on public.form_drafts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on table public.form_drafts from anon, authenticated;
grant select on table public.form_drafts to authenticated;

create or replace function public.lfo_save_form_draft(
  p_user_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
  v_row public.form_drafts%rowtype;
  v_expected integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Brouillon invalide' using errcode = 'LF422';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in (
      'draft_id', 'expected_version', 'domain', 'kind', 'subject_id', 'title', 'content',
      'schema_version'
    ) then
      raise exception 'Clé refusée : %', v_key using errcode = 'LF422';
    end if;
  end loop;
  if coalesce(jsonb_typeof(p_payload -> 'content'), 'absent') <> 'object' then
    raise exception 'Contenu de brouillon attendu en objet' using errcode = 'LF422';
  end if;
  if coalesce(jsonb_typeof(p_payload -> 'schema_version'), 'absent') <> 'number' then
    raise exception 'Version de schéma attendue en nombre' using errcode = 'LF422';
  end if;

  if coalesce(jsonb_typeof(p_payload -> 'draft_id'), 'null') = 'null' then
    -- Création : aucune version attendue n'a de sens.
    if p_payload ? 'expected_version' then
      raise exception 'Version attendue sans brouillon existant' using errcode = 'LF422';
    end if;
    begin
      insert into public.form_drafts (
        user_id, domain, kind, subject_id, title, content, schema_version
      ) values (
        p_user_id, p_payload ->> 'domain', p_payload ->> 'kind',
        nullif(p_payload ->> 'subject_id', '')::uuid, p_payload ->> 'title',
        p_payload -> 'content', (p_payload ->> 'schema_version')::integer
      ) returning * into v_row;
    exception when unique_violation then
      raise exception 'Un brouillon existe déjà pour cette dette' using errcode = 'LF409';
    end;
  else
    v_id := (p_payload ->> 'draft_id')::uuid;
    if coalesce(jsonb_typeof(p_payload -> 'expected_version'), 'absent') <> 'number' then
      raise exception 'Version attendue requise pour modifier un brouillon' using errcode = 'LF422';
    end if;
    v_expected := (p_payload ->> 'expected_version')::integer;
    -- Verrou AVANT la comparaison : deux enregistrements concurrents se sérialisent ici.
    select * into v_row from public.form_drafts
     where id = v_id and user_id = p_user_id
     for update;
    if not found then
      raise exception 'Brouillon introuvable' using errcode = 'LF404';
    end if;
    if v_row.version <> v_expected then
      raise exception 'Brouillon modifié depuis son ouverture' using errcode = 'LF409';
    end if;
    if v_row.domain is distinct from p_payload ->> 'domain'
       or v_row.kind is distinct from p_payload ->> 'kind'
       or v_row.subject_id is distinct from nullif(p_payload ->> 'subject_id', '')::uuid then
      raise exception 'Un brouillon ne change ni de domaine, ni de nature, ni de dette' using errcode = 'LF422';
    end if;
    update public.form_drafts
       set title = p_payload ->> 'title',
           content = p_payload -> 'content',
           schema_version = (p_payload ->> 'schema_version')::integer,
           version = v_row.version + 1,
           updated_at = now()
     where id = v_id
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'version', v_row.version,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.lfo_delete_form_draft(
  p_user_id uuid,
  p_draft_id uuid,
  p_expected_version integer
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version integer;
begin
  select version into v_version from public.form_drafts
   where id = p_draft_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'Brouillon introuvable' using errcode = 'LF404';
  end if;
  if p_expected_version is null or v_version <> p_expected_version then
    raise exception 'Brouillon modifié depuis son ouverture' using errcode = 'LF409';
  end if;
  delete from public.form_drafts where id = p_draft_id and user_id = p_user_id;
end;
$$;

revoke all on function public.lfo_save_form_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_save_form_draft(uuid, jsonb) to service_role;
revoke all on function public.lfo_delete_form_draft(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.lfo_delete_form_draft(uuid, uuid, integer) to service_role;
