# Configuration Supabase

Supabase est l'adapter de **production**. SQLite reste l'adapter de développement local.
La version antérieure de ce document est conservée dans `SUPABASE_SETUP.v1.md`.

## 1. Créer le projet

Région UE, `eu-west-3` (Paris) pour limiter la latence depuis les fonctions Vercel européennes.

## 2. Créer l'utilisateur propriétaire

Toutes les tables portent `user_id uuid not null references auth.users(id)`. Un utilisateur
Auth réel doit exister avant tout insert, y compris avec la secret key.

1. Authentication, Users, Add user, méthode email + mot de passe.
2. Relever l'UUID affiché : c'est la valeur de `OWNER_USER_ID`.

`enable_signup = false` dans `supabase/config.toml` : aucune inscription publique n'est possible.

## 3. Appliquer les migrations

```bash
supabase link --project-ref <ref>
supabase db push
```

Deux migrations sont appliquées dans l'ordre :

- `202608190001_initial_family_office.sql` : schéma complet, grants explicites, RLS sur toutes
  les tables à `user_id`, bucket privé `family-office-documents`.
- `202608190002_scenario_parameters.sql` : colonnes de paramètres sur `public.scenarios`,
  contrainte de cohérence du choc daté, index de lecture du cockpit.

La migration initiale n'est **pas** idempotente (`create table` sans `if not exists`) : elle ne
doit être appliquée qu'une fois, sur une base vierge. La seconde est rejouable.

Lancer ensuite les advisors Database et Security de la console Supabase et traiter les
avertissements avant mise en service.

## 4. Vérifier les garde-fous

- Storage : le bucket `family-office-documents` existe et est **privé** (`public = false`),
  limite 8 Mio, types MIME restreints.
- Table Editor : RLS activé sur toutes les tables à `user_id`, policy `owner_all` présente.
- API : le rôle `anon` n'a aucun grant sur `public`.

## 5. Amorcer les données

```bash
node --env-file=.env.local --experimental-strip-types scripts/seed-supabase.ts
```

Le script refuse de tourner si des comptes existent déjà pour `OWNER_USER_ID`, sauf avec
`--force`. Il reprend à l'identique le jeu de données de l'adapter local et réutilise
`amortizeLoan` du moteur pour l'échéancier du prêt : aucune formule n'est recalculée à la main.

## 6. Modèle de sécurité actuel, à connaître

Supabase Auth n'est pas branché côté application. L'accès reste protégé par
`LOCAL_ACCESS_CODE` et le cookie de session vérifié dans `src/proxy.ts` et les route handlers.

Le serveur accède à PostgreSQL avec la **secret key** (service role), qui **contourne RLS**.
Conséquences :

- la clé est strictement serveur : jamais préfixée `NEXT_PUBLIC_`, jamais importée dans un
  composant `"use client"`. `src/lib/data/supabase-client.ts` porte `import "server-only"` ;
- RLS et les policies du bucket restent en place comme défense en profondeur et redeviendront
  la frontière effective le jour où Supabase Auth sera branché ;
- la frontière de sécurité effective aujourd'hui est le cookie de session. Un `SESSION_SECRET`
  faible ou fuité expose l'ensemble des données.

## 7. Bascule ultérieure vers Supabase Auth

1. Renseigner `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. Remplacer `LoginForm` par un flux Supabase Auth (magic link ou passkey) et `@supabase/ssr`
   pour la propagation de session.
3. Dans `supabase-client.ts`, construire le client à partir du JWT de la requête au lieu de la
   secret key, et supprimer `OWNER_USER_ID` au profit de `auth.uid()`.
4. Tester RLS avec deux utilisateurs : A ne doit jamais lire ni écrire une ligne de B.
5. Tester le bucket : insert, select, update et delete restreints au dossier `{auth.uid()}/`.

## 8. Limite connue

PostgREST n'expose pas de transaction multi-requêtes. Côté Supabase, `add_account`
(établissement + compte + solde) et `update_scenario` (mise à jour + version) ne sont pas
atomiques, contrairement au `BEGIN IMMEDIATE` de l'adapter SQLite. Sur un cockpit
mono-utilisateur le risque est faible. Le rendre atomique demande des fonctions RPC
PostgreSQL, à envisager si des écritures concurrentes apparaissent.
