#!/usr/bin/env bash
# Provisionne un PostgreSQL local jetable pour le gate de schéma (sessions cloud, CI,
# poste sans CLI Supabase). Idempotent. N'écrit jamais ailleurs qu'en local.
#
# Le mot de passe ci-dessous est un identifiant de base jetable, pas un secret : il ne
# donne accès qu'à une base reconstruite à chaque `db:local:reset`.
set -euo pipefail

DB_NAME="${LFO_LOCAL_DB_NAME:-lfo_local}"
DB_USER="${LFO_LOCAL_DB_USER:-postgres}"
DB_PASSWORD="${LFO_LOCAL_DB_PASSWORD:-lfo_local}"
PG_VERSION="${LFO_LOCAL_PG_VERSION:-16}"

as_postgres() { sudo -n -u postgres "$@"; }

if ! command -v psql >/dev/null 2>&1 || ! [ -d "/etc/postgresql/${PG_VERSION}" ]; then
  echo "Installation de PostgreSQL ${PG_VERSION}..."
  sudo -n apt-get install -y --no-install-recommends "postgresql-${PG_VERSION}" \
    || sudo -n apt-get install -y --no-install-recommends postgresql
fi

if ! as_postgres pg_isready -q 2>/dev/null; then
  echo "Démarrage du cluster ${PG_VERSION}/main..."
  sudo -n pg_ctlcluster "${PG_VERSION}" main start || true
  for _ in $(seq 1 20); do
    as_postgres pg_isready -q 2>/dev/null && break
    sleep 1
  done
fi

as_postgres pg_isready -q

as_postgres psql -q -c "alter role ${DB_USER} with password '${DB_PASSWORD}';"
if ! as_postgres psql -tAq -c "select 1 from pg_database where datname = '${DB_NAME}';" | grep -q 1; then
  as_postgres psql -q -c "create database ${DB_NAME};"
fi

echo "Base locale prête : postgres://${DB_USER}:***@127.0.0.1:5432/${DB_NAME}"
echo "Étape suivante : npm run db:local:reset"
