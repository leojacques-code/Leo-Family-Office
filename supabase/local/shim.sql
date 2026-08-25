-- Doublure locale des schémas gérés par la plateforme Supabase (auth, storage,
-- supabase_migrations) et des rôles PostgREST. Ce fichier N'EST PAS une migration :
-- il ne décrit aucun objet applicatif, il ne doit jamais être appliqué à une base
-- distante, et `db:local:reset` refuse tout hôte non local.
--
-- Son unique rôle est de rendre `supabase/migrations/*.sql` applicable sur un
-- PostgreSQL nu, afin que le gate de schéma soit exécutable sans credential.
-- Toute colonne ajoutée ici doit l'être parce qu'une migration la référence,
-- jamais pour « ressembler » davantage à Supabase.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
  end if;
end $$;

-- Supabase accorde l'usage du schéma public aux rôles PostgREST ; les RPC réservées à
-- service_role en dépendent. Les privilèges de TABLE, eux, restent définis par les
-- migrations, et le verifier contrôle qu'anon n'en reçoit aucun.
grant usage on schema public to anon, authenticated, service_role;

-- Sur Supabase, l'accès TABLE de service_role vient des privilèges par défaut de la
-- plateforme, jamais d'un grant écrit dans une migration : le harnais doit donc les
-- reproduire, sinon les RPC serveur échouent en local alors qu'elles fonctionnent en
-- production. Les FONCTIONS sont volontairement exclues : chaque RPC doit porter son
-- `grant execute ... to service_role` explicite dans sa migration, et un défaut local
-- masquerait un grant oublié.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

create schema if not exists auth;

-- Les tables applicatives portent une FK vers auth.users(id) ; `created_at` est lu par
-- les smokes pour désigner le propriétaire.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

-- En production auth.uid() lit le JWT de la requête. En local, la valeur reste nulle :
-- les policies RLS sont donc créées et vérifiables, mais l'isolation multi-utilisateur
-- réelle ne peut pas être testée par ce harnais. C'est une limite assumée du gate local.
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner uuid,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id) on delete cascade,
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);

create or replace function storage.foldername(name text) returns text[]
  language sql immutable
  as $$ select string_to_array(name, '/') $$;

-- Historique des migrations tel que la CLI Supabase le tient. `db:local:reset` y inscrit
-- les versions du repo pour que le verifier compare deux historiques réels.
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
