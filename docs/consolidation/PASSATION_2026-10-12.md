# Passation LFO, session du 12 octobre 2026 (diagnostic de reprise et lot A)

Branche locale `claude/peaceful-wozniak-r1kd0d`, avancée en fast-forward sur la tête de la
PR #52 (`749ac11`) puis enrichie de commits LOCAUX. Rien n'est poussé, rien n'est fusionné,
aucune migration n'est appliquée à une base hébergée, aucune donnée ni configuration de
production n'a été modifiée par cette session.

Diagnostic complet de la reprise : `DIAGNOSTIC_REPRISE_LFO_2026-10-12.md` (même dossier).

## 1. Faits établis avant le lot A

| Fait | Preuve |
|---|---|
| #50 (`8d22b08`) et #51 (`916cfe7`) sont des ancêtres directs de #52, sans patch manquant | `git merge-base --is-ancestor`, `git cherry` |
| #52 au SHA `749ac11` : lint, tsc, 2 506 tests / 178 fichiers, build, `gate:local` (62 migrations, 116 tables, 478 contraintes, 123 RPC) verts | exécutés le 12 octobre, Node 22.22 |
| B19, B20, B21 : aucun code ; cahier des charges B19 arbitré (D-UX-08 à D-UX-11) | `docs/consolidation/CAHIER_DES_CHARGES_B19_2026-09-25.md` |
| Les variables Supabase de Vercel ciblaient production ET preview, `SUPABASE_SECRET_KEY` compris | lecture des noms et cibles, aucune valeur |
| Correction faite par le propriétaire le 12 octobre : les neuf variables ciblent désormais la seule production. Les anciens déploiements preview peuvent conserver leurs identifiants ; un Supabase de preview indépendant reste à créer | déclaration du propriétaire |

## 2. Lot A, commits locaux

| Commit | Objet |
|---|---|
| `269476d` | Différé et acteur du contrat de dette déclarés : migration `20261012090000`, formulaire « À déclarer », smoke dédié |
| `b786e0a` | Variations M-1/M-3/M-12 au dernier jour du mois ; cash-flow libre `null` avec une dépense de montant inconnu |
| `46a6b91` | Sociétés : plus de fourchette ± 15 % inventée, pont EV → Equity du moteur, hypothèses non préremplies ; Dette : plus de rendement 5,5 % ; import de portefeuille sans euro supposé |
| `d025f5f` | `routeFailure` partagé et `SupabaseOperationError` : refus rédigés remontés, texte technique masqué ; deux `error.message` persistés retirés |
| ce commit | Documentation : décompte de migrations, doctrine `SECURITY DEFINER`, pré-contrôles, passation, diagnostic |

Décisions prises dans le lot, et pourquoi :

1. Clé `deferral` absente refusée, JSON `null` = « aucun différé » : c'est la règle CLÉ ABSENTE
   ≠ JSON NULL de CLAUDE.md §3, et tous les appelants du dépôt envoient déjà la clé.
2. Un test existant attendait un cash-flow libre de 1 200 € avec une dépense de montant
   inconnu : il figeait le défaut. Il a été corrigé, avec un oracle sur les seules dépenses
   déclarées et un test dédié qui exige `null`.
3. Les routes d'acquisition remontaient volontairement le texte des RPC. La règle retenue
   garde les refus RÉDIGÉS (`P0001`, `LF4xx`) et masque le reste, au lieu de tout masquer, ce
   qui aurait retiré à l'utilisateur la raison d'un refus.
4. Le Debt Engine reste la bibliothèque de dates de `balance-sheet-metrics` (il y était déjà
   importé) : l'extraction des utilitaires de dates est une dette consignée, pas faite ici.

## 3. Tests exécutés

| Contrôle | Résultat | Commit |
|---|---|---|
| Tests ciblés Dette et brouillons | PASS, 51 tests | `269476d` |
| `src/lib/data` et `src/lib/engine` | PASS, 72 fichiers / 1 168 tests | `b786e0a` |
| Business Equity, Dette, imports | PASS, 48 tests ; nouveaux tests rouges sur l'ancien code, verts après | `46a6b91` |
| `src/lib` et `src/app` | PASS, 143 fichiers / 2 268 tests | `d025f5f` |
| `npm run gate:local` | PASS : 63 migrations depuis zéro, 116 tables, 478 contraintes, 123 RPC, smokes et concurrence | `d025f5f` |
| `check:conflict-markers`, `npm run lint`, suite complète, `npm run build` | PASS : 180 fichiers / 2 521 tests (2 506 sur #52 + 15 du lot A), lint et build verts | `d025f5f` |
| Recettes navigateur, preview, Supabase hébergé | NOT_RUN / BLOCKED (pas d'environnement de recette) | : |
| HawkScan | NOT_RUN : ni `HAWK_API_KEY` ni application lancée | : |

Outils demandés : Graphify, Agent Skills (`/spec`, `/plan`…) et Ponytail ne sont pas installés
dans cette session cloud (ils le sont par le Codespace de la PR #53). Ils n'ont PAS été
utilisés. Substituts réellement exécutés : graphe d'imports par l'AST du compilateur
TypeScript, détection AST de code mort et de duplication, revue indépendante des migrations.
OmniRoute : non installé, non activé.

## 4. Pré-contrôles avant toute application des migrations

`PRECONTROLES_MIGRATIONS_2026-10-12.sql` : requêtes en lecture seule (P0 à P7), à exécuter par
un humain sur la base cible avant d'appliquer les dix-huit migrations absentes de la
production. Trois risques sur une base peuplée :

- `20260915064740` remplace 24 clés étrangères sans `NOT VALID` : une seule référence croisée
  ou un nom de contrainte différent fait échouer la migration entière (P1, P2) ;
- `20260924170000` ajoute deux contraintes validées immédiatement sur `liabilities` (P4) ;
- `20260914191901` exige que le propriétaire de `lfo_private.verify_session` lise
  `auth.sessions` et `auth.users` sur l'hébergé (P6) ; sinon l'authentification est bloquée.

## 5. Ouvert, consigné

- Formulaires Sociétés : forme juridique « SAS », devise « EUR » et date de période
  préremplies (identité plutôt qu'hypothèse financière) : à trancher au lot de la phase 8.
- `deferral_interest_treatment = 'UNKNOWN'` pour un contrat sans différé : valeur héritée,
  sans objet, conservée.
- Dette technique relevée par l'audit, non traitée : cycle de types autour de `src/lib/types.ts`,
  16 composants appelant directement des moteurs, `daysBetween` défini 7 fois, 12 formateurs
  monétaires, `Currency` à défaut « EUR » (latent tant que la devise n'est pas choisissable),
  24 exports morts démontrés, deux références de moteur mortes dans le registre KPI.
- UX relevée par l'audit, pour la revue de clôture 3C : deux `h1` par page, en-têtes en
  anglais, jargon visible, 21 tableaux sans rôle ARIA, aucun `prefers-color-scheme`.
- Documents fondateurs encore absents du dépôt : plan de refonte v2.0, `backlog.csv`,
  `profils_100.csv`. Les tickets au-delà de B21 ne sont rattachés que par la matrice de
  traçabilité du dossier consolidé.

## 6. Prochaine étape

B19 selon `CAHIER_DES_CHARGES_B19_2026-09-25.md`, puis B20 et B21. La clôture de 3C ouvre la
revue UX transversale (registre UX §4), puis B55 et la phase 4B (Flux).
