# Passation LFO, session du 24 septembre 2026

Reprise par un agent Claude pendant l'indisponibilité d'Astra. Ce document se lit après
`CLAUDE.md` et `docs/consolidation/REPRISE.md` ; il ne les remplace pas.

## 1. État du dépôt

| Élément | Valeur |
|---|---|
| Branche de travail | `claude/blissful-dirac-4ar700` |
| Base de la branche | historique original Astra `52542b9` (restauré depuis les bundles, arbre `ce14571…`) |
| Branche de sauvegarde Astra | `codex/lfo-backup-20260916` = `0e730f7`, **non modifiée** |
| `main` | `bd1782c`, **non modifiée** |
| Dernier commit | voir `git log -1` sur la branche ; le SHA exact figure dans le message de fin de session |

La session a travaillé dans un clone cloud neuf : **le poste local d'Astra n'était pas
accessible**. Tout travail local postérieur au 23 septembre qui n'aurait pas été poussé est
inconnu de cette session. Avant de reprendre, comparer le HEAD local d'Astra à `52542b9` : s'il
l'a dépassé, fusionner (sans réécriture d'historique) plutôt que repartir de cette branche.

Contrôle d'intégrité exécuté : les six bundles de `docs/consolidation/sauvegarde` ont les
empreintes de `RESTAURATION.md`, la restauration donne `52542b9` / `ce14571…`, `git fsck --full`
sans erreur, arbre identique au snapshot GitHub hors dossier `sauvegarde/`.

## 2. Commits de la session

| Commit | Objet |
|---|---|
| `52ed0e3` | Diagnostic expurgé des 503 d'Auth, route `/auth/confirm`, recette Auth locale |
| `c90e5af` | Suites de la relecture indépendante (fixation de session, pannes fournisseur, recette durcie) |
| `20f608c` | Dette connue par son seul encours (migration `20260924081000`) |
| `26d28c5` | Premier revenu net observé (migration `20260924091000`), tuiles Flux « Non observé » |
| suivants | Suites de la seconde relecture (faux zéros aval, dates futures, devise fermée, précision SQL, export, rapport), passation |

## 3. Le 503 de `POST /api/auth` : cause établie

Preview `dpl_2AFAmcjBbiTXkhHJJnHDk7RxYhTH` (commit `0e730f7`).

1. **Cause immédiate, démontrée** : `SUPABASE_PUBLISHABLE_KEY` n'existe sur Vercel ni en
   production ni en preview (liste des NOMS de variables, aucune valeur lue).
   `supabaseAuthConfiguration()` levait `AUTH_NOT_CONFIGURED` dans le `try`, avant tout
   réseau ; le `catch` répondait 503 sans journal. Reproduit à l'identique en local (même build,
   variable retirée) : 503, même message, journal `AUTH_NOT_CONFIGURED`.
2. **Cause suivante, masquée** : toutes les variables Vercel ciblent ensemble `production` et
   `preview`, donc la preview parle à la base de PRODUCTION, qui n'a pas `lfo_verify_session`.
   Ajouter la seule clé donnerait `AUTH_SESSION_CHECK_MISSING` (503) après une connexion Auth
   réussie, et une inscription depuis la preview créerait de vrais comptes en production.
   **Ne pas corriger en ajoutant la clé aux variables partagées.**

Correction de code livrée (le reste est de la configuration, voir §8) :

- journal `lfo.auth.failure` à code fermé (`AUTH_NOT_CONFIGURED`, `AUTH_KEY_REJECTED`,
  `AUTH_SESSION_CHECK_MISSING`, `AUTH_SESSION_CHECK_FAILED`, `PROFILE_INITIALIZATION_FAILED`,
  `AUTH_PROVIDER_UNAVAILABLE`, `AUTH_DATA_NOT_CONFIGURED`), étape, heure ; jamais le message ;
- auth-js ne lève pas sur panne : statut 0 ou ≥ 500 → 503 `AUTH_PROVIDER_UNAVAILABLE`, 401
  sans code auth-js (clé refusée par la passerelle) → 503 `AUTH_KEY_REJECTED`. Vérifié sur pile
  réelle : clé fausse, GoTrue arrêté, identifiants faux (401 sans journal) ;
- `/auth/confirm` : le lien de confirmation n'avait aucune route de retour. Seule la forme PKCE
  `code` est acceptée ; la forme `token_hash` a été retirée (fixation de session possible, constat
  de relecture). Destination fixe, redirection relative 303.

## 4. Environnement de recette : ce qui existe

Aucun connecteur Supabase dans la session, et les registres d'images Docker sont refusés par la
politique réseau. La recette hébergée n'a donc pas pu être créée. À la place,
`scripts/recette-auth/` monte sur 127.0.0.1 une **pile Supabase auto-hébergée** avec les
composants OFFICIELS : PostgreSQL 16 au modèle de rôles hébergé (scripts `supabase/postgres`,
`postgres` rétrogradé), GoTrue v2.196.0, PostgREST v14.17, Storage v1.74.0 (construit depuis
ses sources), passerelle Kong 3.9.3 avec le `kong.yml` officiel, collecteur SMTP local. Écarts
connus et bornés : README du dossier.

**Ce que cette recette prouve** : le parcours de l'application (build de production) contre de
vrais serveurs Auth, PostgREST et Storage. **Ce qu'elle ne prouve pas** : la configuration du
projet Supabase hébergé, la preview Vercel, l'envoi réel de mails.

## 5. Recettes exécutées

| Recette | Build | Résultat | Preuves |
|---|---|---|---|
| Auth A/B (`parcours-ab.mjs`) | `jiVBB2KT84FsdtrUQYnga` (final) | 35/35 | `preuves/recette-auth-2026-09-24/` |
| Premiers faits B14 (`parcours-b14.mjs`) | `jiVBB2KT84FsdtrUQYnga` (final) | 25/25 | `preuves/b14-premiers-faits-2026-09-24/` |

Exécutions intermédiaires : Auth 35/35 sur `lH_DJt6owxN2DuTdZu6gf`, premiers faits 23/23 sur
`dhVRa8y6BaL_o7a9lWUPb`. Le build final est celui des suites de la seconde relecture ; il est
construit depuis le dernier commit de la session, sur une base de recette reconstruite depuis zéro.

Auth A/B couvre : création, confirmation d'adresse par le vrai lien d'Auth, refus avant
confirmation, profil vide unique, nom d'espace relu, persistance de session, renouvellement du
JWT (expiration 120 s en recette), isolation A/B par l'API applicative, PostgREST (RLS, 42501),
RPC serveur refusée, Storage (lecture, URL signée, dépôt, liste refusés ; contrôles positifs),
déconnexion, rejeu des anciens cookies refusé, révocation, et R7 : **session expirée par
`not_after` refusée par l'application alors que GoTrue l'accepte encore**, ce qui prouve
`lfo_verify_session`.

Une première exécution « 35/35 » avait tourné sur un serveur antérieur aux correctifs (port déjà
occupé au redémarrage) : elle a été écartée, et `app.sh` refuse désormais un port occupé.

Premiers faits B14 couvre : dette par son seul encours (saisie, termes NULL en base, passif au
bilan, patrimoine net, service de dette PARTIAL, cash-flow libre inconnu, domaine Dettes reconnu
dans Aujourd'hui, correction par nouvelle observation, rechargement, historique à deux
observations), compte ajouté (patrimoine suivi), revenu net observé (Flux et Aujourd'hui,
aucun solde dérivé, patrimoine net inchangé, aucun brut ni impôt ni rôle de carrière fabriqué),
bureau 1280 × 900 et mobile 390 × 844 sans débordement.

## 6. Tests et contrôles

- `npm run lint`, `tsc --noEmit` : propres.
- `vitest` : 2 383 tests / 160 fichiers verts au dernier passage de la session.
- `npm run gate:local` (base à doublure d'Astra) : vert, 51 migrations, 441 contraintes,
  118 RPC, tous les smokes dont `smoke-debt-outstanding` et `smoke-net-income`.
- Vérificateur et smokes aussi exécutés sur la pile Supabase locale (schémas auth et storage
  réels, `postgres` non superutilisateur).
- Aucune migration, écriture ni configuration n'a touché Supabase production ou Vercel.

## 7. Fonctionnalités réellement utilisables (sur la pile locale)

| Fonction | Développée | Testée localement | Sur GitHub | Preview Vercel | Validée sur Supabase hébergé |
|---|---|---|---|---|---|
| Connexion / création / confirmation | oui | oui (pile réelle) | oui | build READY, 503 attendu (clé absente) | **non** |
| Isolation A/B (API, RLS, Storage) | Astra + oui | oui (pile réelle) | oui | non | **non** |
| Accueil (nom, contexte, intention) | Astra | oui | oui | non | non |
| Premier compte daté | Astra | oui | oui | non | non |
| Dette par son seul encours | oui | oui | oui | non | non |
| Premier revenu net observé | oui | oui | oui | non | non |
| Correction d'un revenu observé | **non** | : | : | : | : |
| Document (B14 volet documentaire) | non repris | : | : | : | : |

## 8. Décisions et accès nécessaires

1. **Environnement de recette hébergé** (bloquant pour déclarer Auth validée) : branche Supabase
   (Astra avait relevé 0,01344 USD/h, soit environ 9,8 USD par mois si elle reste active) ou
   projet dédié. Il faut aussi un connecteur Supabase dans la session, ou une création manuelle.
2. **Variables Vercel limitées à `preview`**, pointant la recette : `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, sur le même projet. Auth : Site URL et redirection
   `https://<hôte>/auth/confirm`, avec un motif limité à l'équipe (`*-lech1.vercel.app`) et
   jamais `*.vercel.app`.
3. **Avant toute fusion vers `main`** : six migrations à appliquer en production,
   `SUPABASE_PUBLISHABLE_KEY` à ajouter en production, et vérification que le propriétaire des
   données existantes se connecte avec le compte Auth dont l'identifiant est `OWNER_USER_ID`.
   Sans cela, l'accès actuel par code est coupé ou le propriétaire arrive sur un espace vide.
4. **Correction d'une transaction observée** (revenu net) : aucune voie n'existe. Choisir entre
   une supersession auditée (recommandée, sur le modèle des corrections de portefeuille) et une
   écriture de régularisation signée.
5. **Flux multidevise** : le moteur Flux additionne les montants sans conversion (défaut
   préexistant). Le tiroir de revenu refuse une devise différente de la lecture en attendant la
   phase Flux.

## 9. Constats consignés, non traités

- Formateur monétaire global : « 1 500,5 € » au lieu de « 1 500,50 € ».
- Flux, « Structure des dépenses » : « 0 € » par catégorie quand rien n'est observé (même défaut
  que les tuiles, corrigé seulement pour elles).
- `lfo_set_real_estate_financing_link` accepte l'identifiant d'une dette encours seul par appel
  direct (l'écran ne le propose pas) : lien orphelin possible, equity du bien surestimée. À
  refuser dans la RPC (dernière version : `20260826090117_real_estate_v2.sql`).
- `lfo_save_debt_contract` appelé avec une dette encours seul : refus par contrainte (aucun état
  incohérent), mais message générique 500.
- `.panel-note` global à 9 px, sous le plancher typographique de 12 px.
- Mobile Aujourd'hui : six cartes de sources avant les actions d'installation.
- Refus d'écriture croisée par clé étrangère composite rendu en 500 générique au lieu d'un 404,
  et journal `console.error(fallback, error)` des routes `/api/state` et `/api/documents` qui
  reprend le message du fournisseur.
- Formulaire « Ajouter une opération » inutilisable pour un espace neuf : il exige une catégorie,
  et un espace neuf n'en a aucune.
- Export CSV : les contrats y sont datés de la date d'arrêté et non de leur observation.
- Flux du mois dans Aujourd'hui : cash-flow observé sans service de dette observé alors qu'une
  dette existe. Cohérent (réel ≠ contractuel) et signalé « partiel », mais la lecture peut
  tromper.

## 10. Prochain ticket

1. Obtenir la recette hébergée (décision 1), puis rejouer `parcours-ab.mjs` et
   `parcours-b14.mjs` contre elle et contre la preview, sur un SHA exact.
2. Décider la correction des transactions observées (décision 4) et la livrer pour le revenu.
3. Volet documentaire de B14 (document 08 §4 point 7), puis B15 à B18 (Dette 3B) : l'observation
   seule est livrée, le passage d'un encours seul à un contrat (B16) reste à faire, et la
   contrainte de base le refuse aujourd'hui bruyamment.
