# Recette Auth locale à deux utilisateurs

Outil de recette, pas une migration ni un composant de l'application. Il éprouve le parcours
réel de LFO (build de production) contre les serveurs Supabase OFFICIELS, auto-hébergés sur
127.0.0.1, sans aucun credential ni aucune écriture distante.

## Ce que la recette prouve, et ce qu'elle ne prouve pas

Prouvé sur cette pile : création de compte, confirmation par le lien réellement émis par Auth,
connexion, déconnexion, rejeu de cookies refusé, renouvellement de JWT, révocation de session,
espace vierge, isolation A/B par l'API applicative, PostgREST (RLS), la RPC serveur et Storage.

Non prouvé : la configuration du projet Supabase HÉBERGÉ (Site URL, liste de redirections,
modèles et envoi de mails, clés), la preview Vercel, les limites de débit du service hébergé.
Une recette locale ne remplace pas la recette sur l'environnement hébergé ; elle la prépare.

## Écarts connus avec le service hébergé

| Écart | Raison | Effet sur la recette |
|---|---|---|
| PostgreSQL 16 nu au lieu de l'image `supabase/postgres` | registres d'images refusés par la politique réseau de la session | modèle de rôles reproduit par les scripts officiels `supabase/postgres` |
| `supautils` et `pg-safeupdate` absents | extensions de plateforme | préchargement retiré pour `authenticator` ; aucun effet sur RLS et grants |
| `supautils.policy_grants` émulé | `postgres` doit créer les politiques de `storage.objects` | `supabase_storage_admin` accordé à `postgres` le temps des migrations seulement |
| JWT de 120 s | observer le renouvellement pendant la recette | hébergé : 3 600 s par défaut |
| collecteur SMTP local | aucun mail envoyé | le lien suivi est celui qu'Auth a généré |
| Storage construit depuis ses sources (Node 24) | image indisponible | même version que l'auto-hébergement Supabase (v1.74.0) |

## Exécution

Prérequis : PostgreSQL 16 (`pg_createcluster`), Docker (image `kong/kong:3.9.3`), Node 24 pour
Storage et l'application, `playwright` installé hors dépôt, Chromium.

```sh
export RECETTE_DIR=/chemin/hors/depot     # clés, binaires, journaux ; jamais commité
# 1. Secrets éphémères et binaires officiels
openssl rand -hex 24 > "$RECETTE_DIR/pgpass.txt"; openssl rand -hex 32 > "$RECETTE_DIR/jwt_secret.txt"
curl -sSL https://github.com/supabase/auth/releases/download/v2.196.0/auth-v2.196.0-x86.tar.gz | tar xz -C "$RECETTE_DIR"
curl -sSL https://github.com/PostgREST/postgrest/releases/download/v14.17/postgrest-v14.17-linux-static-x86-64.tar.xz | tar xJ -C "$RECETTE_DIR"
git clone --depth 1 --branch v1.74.0 https://github.com/supabase/storage.git "$RECETTE_DIR/storage-src"
(cd "$RECETTE_DIR/storage-src" && npm ci && npm run build)
# kong.yml et kong-entrypoint.sh officiels : github.com/supabase/supabase, docker/volumes/api
mkdir -p "$RECETTE_DIR/kong" && cp <supabase>/docker/volumes/api/kong{.yml,-entrypoint.sh} "$RECETTE_DIR/kong/"
node scripts/recette-auth/keys.mjs
# 2. Base au modèle de rôles hébergé, puis schéma auth (GoTrue) et storage (Storage)
bash scripts/recette-auth/db-init.sh
bash scripts/recette-auth/services.sh     # GoTrue applique ses migrations au démarrage
# 3. Migrations LFO en `postgres` non superutilisateur
RECETTE_ADMIN_DB_URL=postgres://supabase_admin:…@127.0.0.1:55432/postgres \
RECETTE_DB_URL=postgres://postgres:…@127.0.0.1:55432/postgres \
  node --experimental-strip-types scripts/recette-auth/apply-migrations.ts
# 4. Application : SUPABASE_URL=http://127.0.0.1:55321, clés anon/service de RECETTE_DIR
npm run build && npx next start -p 3120 -H localhost
# 5. Parcours A/B
RECETTE_APP=http://localhost:3120 RECETTE_OUT=… RECETTE_PLAYWRIGHT=…/package.json \
RECETTE_CHROMIUM=/opt/pw-browsers/chromium RECETTE_ADMIN_DB_URL=… node scripts/recette-auth/parcours-ab.mjs
bash scripts/recette-auth/stop.sh
```

Chaque script refuse un hôte non local. Les comptes créés portent le domaine réservé
`lfo.invalid` ; la base est jetable et reconstruite par `db-init.sh`.
