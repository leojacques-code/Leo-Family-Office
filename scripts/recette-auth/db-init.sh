#!/usr/bin/env bash
# Recette Auth locale, étape 1 : un PostgreSQL 16 jetable dont le modèle de rôles est celui
# de Supabase hébergé, reproduit par les scripts OFFICIELS de github.com/supabase/postgres
# (init-scripts puis migrations de plateforme), et non par la doublure du gate
# (`supabase/local/shim.sql`, qui ne simule pas le fournisseur Auth).
#
# Comme l'image Supabase, le cluster est amorcé par `supabase_admin` : c'est ce qui permet la
# rétrogradation de `postgres` (non superutilisateur en production), sans laquelle une
# fonction SECURITY DEFINER posée par une migration aurait ici des droits qu'elle n'a pas là-bas.
#
# Les échecs attendus (extensions absentes d'un PostgreSQL nu : pgsodium, pg_graphql,
# orioledb, pgbouncer…) sont listés, pas masqués. N'écrit que sur 127.0.0.1.
set -euo pipefail
: "${RECETTE_DIR:?RECETTE_DIR requis (répertoire de travail hors dépôt)}"
PORT="${RECETTE_PG_PORT:-55432}"
CLUSTER="${RECETTE_PG_CLUSTER:-recette}"
PG_VERSION="${RECETTE_PG_VERSION:-16}"
case "$CLUSTER" in recette*) ;; *) echo "Cluster refusé : $CLUSTER (préfixe « recette » requis, ce script le détruit)"; exit 1 ;; esac
PW="$(cat "$RECETTE_DIR/pgpass.txt")"
PLATFORM="$RECETTE_DIR/pgrepo/migrations/db"
[ -d "$PLATFORM/init-scripts" ] || git clone -q --depth 1 --filter=blob:none --sparse \
  https://github.com/supabase/postgres.git "$RECETTE_DIR/pgrepo" \
  && git -C "$RECETTE_DIR/pgrepo" sparse-checkout set migrations/db

if pg_lsclusters -h | awk '{print $2}' | grep -qx "$CLUSTER"; then
  pg_dropcluster --stop "$PG_VERSION" "$CLUSTER"
fi
pwfile="$(mktemp /tmp/lfo-recette-pw.XXXXXX)"; printf '%s\n' "$PW" > "$pwfile"
chgrp postgres "$pwfile"; chmod 640 "$pwfile"   # lisible par initdb, pas par les autres comptes
pg_createcluster "$PG_VERSION" "$CLUSTER" -p "$PORT" -- --username=supabase_admin \
  --pwfile="$pwfile" --auth-local=trust --auth-host=scram-sha-256 >/dev/null
rm -f "$pwfile"
pg_ctlcluster "$PG_VERSION" "$CLUSTER" start

export PGHOST=127.0.0.1 PGPORT="$PORT" PGPASSWORD="$PW"
run() { # $1 rôle, $2 fichier : journalise les erreurs sans interrompre (extensions absentes)
  local out; out="$(psql -U "$1" -d postgres --no-psqlrc -q -f "$2" 2>&1 | grep -i 'error' || true)"
  [ -z "$out" ] || echo "  attendu/à lire  $(basename "$2") : $(echo "$out" | head -1 | cut -c1-160)"
}
psql -U supabase_admin -d postgres -q \
  -c "create role postgres superuser login password '$PW'; alter database postgres owner to postgres;"
for f in "$PLATFORM"/init-scripts/*.sql; do run postgres "$f"; done
psql -U postgres -d postgres -q -c "alter user supabase_admin with password '$PW'"
for f in "$PLATFORM"/migrations/*.sql; do run supabase_admin "$f"; done
# Mots de passe des rôles de service (roles.sql de l'auto-hébergement Supabase).
for role in authenticator supabase_auth_admin supabase_storage_admin; do
  psql -U supabase_admin -d postgres -q -c "alter user $role with password '$PW'"
done
psql -U supabase_admin -d postgres -tAc \
  "select 'postgres superuser = ' || rolsuper from pg_roles where rolname = 'postgres'"
# Écart connu : supautils et pg-safeupdate (garde-fous de plateforme) n'existent pas sur un
# PostgreSQL nu ; leur préchargement empêcherait PostgREST de se connecter. Ils ne portent pas
# sur la RLS, les grants ni la vérification de session éprouvés par cette recette.
for role in authenticator; do
  psql -U supabase_admin -d postgres -q -c "alter role $role reset session_preload_libraries"
done
