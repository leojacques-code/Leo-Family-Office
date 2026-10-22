#!/usr/bin/env bash
# Arrête la pile de recette locale (processus et conteneur Kong). Ne supprime aucune donnée.
: "${RECETTE_DIR:?RECETTE_DIR requis}"
for name in smtp auth rest storage; do
  [ -f "$RECETTE_DIR/$name.pid" ] && kill "$(cat "$RECETTE_DIR/$name.pid")" 2>/dev/null
  rm -f "$RECETTE_DIR/$name.pid"
done
docker rm -f lfo-recette-kong >/dev/null 2>&1 || true
echo "Pile de recette arrêtée."
