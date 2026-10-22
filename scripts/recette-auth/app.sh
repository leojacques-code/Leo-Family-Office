#!/usr/bin/env bash
# Démarre le build de production de LFO contre la pile locale, et SEULEMENT elle.
# Refuse un port déjà occupé : un ancien serveur resté vivant servirait un build périmé,
# et la recette validerait alors un code qui n'est pas celui qu'elle croit tester.
# Usage : RECETTE_DIR=… [RECETTE_APP_PORT=3120] [RECETTE_NODE=…] bash app.sh [start|stop]
set -euo pipefail
: "${RECETTE_DIR:?RECETTE_DIR requis}"
PORT="${RECETTE_APP_PORT:-3120}"
PIDFILE="$RECETTE_DIR/app-$PORT.pid"
NODE="${RECETTE_NODE:-node}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "${1:-start}" = "stop" ]; then
  [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"; exit 0
fi
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "Port $PORT déjà occupé : arrêtez l'ancien serveur avant de tester ce build." >&2; exit 1
fi
export SUPABASE_URL="http://127.0.0.1:${RECETTE_GATEWAY_PORT:-55321}"
export NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL"
export SUPABASE_PUBLISHABLE_KEY="${RECETTE_PUBLISHABLE_KEY_OVERRIDE:-$(cat "$RECETTE_DIR/anon.key")}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(cat "$RECETTE_DIR/anon.key")"
export SUPABASE_SECRET_KEY="$(cat "$RECETTE_DIR/service.key")"
unset LFO_AUTH_MODE OWNER_USER_ID
cd "$REPO"
"$NODE" node_modules/next/dist/bin/next start -p "$PORT" -H localhost \
  > "$RECETTE_DIR/logs/app-$PORT.log" 2>&1 &
echo $! > "$PIDFILE"
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:$PORT/login" && break; sleep 0.5
done
echo "Application : http://localhost:$PORT (BUILD_ID $(cat .next/BUILD_ID), pid $(cat "$PIDFILE"))"
