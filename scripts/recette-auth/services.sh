#!/usr/bin/env bash
# Recette Auth locale, étape 2 : services Supabase OFFICIELS (binaires ou sources publiés,
# aux versions de l'auto-hébergement Supabase) derrière la passerelle Kong et son kong.yml
# officiel. Configuration voulue proche du projet hébergé : confirmation d'adresse ACTIVE,
# inscription ouverte, connexion anonyme fermée. Seul écart assumé : JWT de 120 s au lieu de
# 3 600 s, pour observer le renouvellement de session pendant la recette.
set -euo pipefail
: "${RECETTE_DIR:?RECETTE_DIR requis}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PW="$(cat "$RECETTE_DIR/pgpass.txt")"
JWT_SECRET="$(cat "$RECETTE_DIR/jwt_secret.txt")"
ANON="$(cat "$RECETTE_DIR/anon.key")"
SERVICE="$(cat "$RECETTE_DIR/service.key")"
PG="127.0.0.1:${RECETTE_PG_PORT:-55432}"
GATEWAY_PORT="${RECETTE_GATEWAY_PORT:-55321}"
SITE_URL="${RECETTE_SITE_URL:-http://localhost:3120}"
LOGS="$RECETTE_DIR/logs"; mkdir -p "$LOGS"

node "$HERE/smtp-sink.mjs" > "$LOGS/smtp.log" 2>&1 &
echo $! > "$RECETTE_DIR/smtp.pid"

(
  cd "$RECETTE_DIR"
  export GOTRUE_API_HOST=127.0.0.1 GOTRUE_API_PORT=55999 PORT=55999
  export API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT"
  export GOTRUE_DB_DRIVER=postgres
  export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PW@$PG/postgres?sslmode=disable"
  export GOTRUE_DB_MIGRATIONS_PATH="$RECETTE_DIR/migrations"
  export GOTRUE_SITE_URL="$SITE_URL" GOTRUE_URI_ALLOW_LIST="$SITE_URL/**"
  export GOTRUE_DISABLE_SIGNUP=false GOTRUE_EXTERNAL_EMAIL_ENABLED=true
  export GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false GOTRUE_MAILER_AUTOCONFIRM=false
  export GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_JWT_AUD=authenticated
  export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_EXP="${RECETTE_JWT_EXP:-120}"
  export GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_ISSUER="$API_EXTERNAL_URL/auth/v1"
  export GOTRUE_SMTP_ADMIN_EMAIL=recette@lfo.invalid GOTRUE_SMTP_HOST=127.0.0.1
  export GOTRUE_SMTP_PORT="${RECETTE_SMTP_PORT:-55025}" GOTRUE_SMTP_SENDER_NAME="LFO recette"
  export GOTRUE_SMTP_MAX_FREQUENCY=1s GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
  export GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify
  export GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify
  exec ./auth serve
) > "$LOGS/auth.log" 2>&1 &
echo $! > "$RECETTE_DIR/auth.pid"

cat > "$RECETTE_DIR/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:$PW@$PG/postgres?sslmode=disable"
db-schemas = "public,storage,graphql_public"
db-anon-role = "anon"
db-extra-search-path = "public"
db-max-rows = 1000
db-use-legacy-gucs = false
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = 55300
CONF
"$RECETTE_DIR/postgrest" "$RECETTE_DIR/postgrest.conf" > "$LOGS/rest.log" 2>&1 &
echo $! > "$RECETTE_DIR/rest.pid"

if [ -f "$RECETTE_DIR/storage-src/dist/start/server.js" ]; then
  (
    cd "$RECETTE_DIR/storage-src"
    export ANON_KEY="$ANON" SERVICE_KEY="$SERVICE" AUTH_JWT_SECRET="$JWT_SECRET"
    export POSTGREST_URL=http://127.0.0.1:55300
    export DATABASE_URL="postgres://supabase_storage_admin:$PW@$PG/postgres?sslmode=disable"
    export STORAGE_PUBLIC_URL="http://127.0.0.1:$GATEWAY_PORT" REQUEST_ALLOW_X_FORWARDED_PATH=true
    export FILE_SIZE_LIMIT=52428800 STORAGE_BACKEND=file GLOBAL_S3_BUCKET=stub
    export FILE_STORAGE_BACKEND_PATH="$RECETTE_DIR/storage-data" TENANT_ID=stub REGION=local
    export ENABLE_IMAGE_TRANSFORMATION=false SERVER_HOST=127.0.0.1 SERVER_PORT=55500 PORT=55500
    export DB_INSTALL_ROLES=false
    exec "${RECETTE_NODE:-node}" dist/start/server.js
  ) > "$LOGS/storage.log" 2>&1 &
  echo $! > "$RECETTE_DIR/storage.pid"
fi

sed -e 's#http://auth:9999#http://127.0.0.1:55999#g' \
    -e 's#http://rest:3000#http://127.0.0.1:55300#g' \
    -e 's#http://storage:5000#http://127.0.0.1:55500#g' \
    "$RECETTE_DIR/kong/kong.yml" > "$RECETTE_DIR/kong/kong.local.yml"
docker rm -f lfo-recette-kong >/dev/null 2>&1 || true
docker run -d --name lfo-recette-kong --network host \
  -v "$RECETTE_DIR/kong/kong.local.yml:/home/kong/temp.yml:ro" \
  -v "$RECETTE_DIR/kong/kong-entrypoint.sh:/home/kong/kong-entrypoint.sh:ro" \
  -e KONG_DATABASE=off -e KONG_DECLARATIVE_CONFIG=/usr/local/kong/kong.yml \
  -e KONG_ROUTER_FLAVOR=expressions -e KONG_DNS_ORDER=LAST,A,CNAME \
  -e KONG_PLUGINS=request-transformer,cors,key-auth,acl,basic-auth,request-termination,ip-restriction,post-function \
  -e KONG_PROXY_LISTEN="127.0.0.1:$GATEWAY_PORT" -e KONG_ADMIN_LISTEN=off -e KONG_STATUS_LISTEN=off \
  -e KONG_NGINX_PROXY_PROXY_BUFFER_SIZE=160k -e "KONG_NGINX_PROXY_PROXY_BUFFERS=64 160k" \
  -e SUPABASE_ANON_KEY="$ANON" -e SUPABASE_SERVICE_KEY="$SERVICE" \
  -e DASHBOARD_USERNAME=disabled -e DASHBOARD_PASSWORD="$(head -c 24 /dev/urandom | base64)" \
  --entrypoint /bin/sh kong/kong:3.9.3 /home/kong/kong-entrypoint.sh > /dev/null
echo "Passerelle : http://127.0.0.1:$GATEWAY_PORT  (journaux : $LOGS)"
