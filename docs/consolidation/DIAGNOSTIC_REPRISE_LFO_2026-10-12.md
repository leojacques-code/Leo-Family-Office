# Diagnostic de reprise LFO, 12 octobre 2026

Investigation en lecture seule. Aucun fichier du dépôt modifié, aucun commit, aucun push, aucune
écriture Supabase ou Vercel.

Addendum du même jour : le propriétaire a restreint les neuf variables Vercel à la seule
production (§1, vérification Vercel) ; le lot 1 recommandé ci-dessous a été exécuté comme
« lot A », voir . Session cloud Claude Code (pas le Codespace de la PR #53), branche
désignée `claude/peaceful-wozniak-r1kd0d` (identique à `main`, `bd1782c`).

## 0. Sources lues et leur statut

| Source | Statut de lecture |
|---|---|
| `CLAUDE.md` (main et PR #52) | Lu intégralement |
| `docs/consolidation/*` (PR #52) : REPRISE, passations 24 et 25 sept. v1/v2, matrices 3B v1 à v3, cadrage et cahier B19 | Lus |
| `docs/produit/DECISIONS_PRODUIT_UX_2026-09-25.md` (D-UX-01 à D-UX-11) | Lu |
| `docs/PRODUCTISATION_PHASE_3_START.md`, `PHASE_4A.md`, `ROADMAP.md` | Lus ; phases 0 à 2 lues par extraits |
| `LFO_Dossier_consolide_2026-09-11.md` (fourni le 12 oct.) | Lu par sections (synthèse, arbitrages A01 à A15, spécification Dettes §4 à §8, programme §1 à §10, limites). SHA-256 `5326d684…930d714`, identique à l'empreinte de `REPRISE.md` |
| `design_v10.md` (fourni le 12 oct.) | Partie active V10 lue (§0 à §4, §10 à §12, §22 à §30) ; annexes V9 non lues |
| Plan de refonte `AUDIT_PRODUIT_UX…` v2.0 (§11, §36, §37, §42) | **ABSENT** : cité par les rapports de phase, introuvable sur toutes les branches |
| `backlog.csv` (60 tickets), `profils_100.csv`, documents 00 à 09 séparés | **ABSENTS** : conservés hors dépôt (`../source/LFO_Programme` sur le poste d'Astra) |

Conséquence : statuts fiables pour B01 à B21 (sourcés par passations et matrices) ; pour B22 à B60,
seuls les rattachements de la matrice de traçabilité du dossier (§4 du registre des sources) sont
connus, pas les critères de sortie exacts.

## 1. État réel du projet

### Git et PR (vérifié au niveau des commits)

| Élément | Constat | Preuve |
|---|---|---|
| `main` | `bd1782c`, fusion de #49 ; phases 0, 1, 2 de productisation | `git log` |
| PR #50 (`codex/debt-phase-3`, `8d22b08`) | Ancêtre direct de #52, aucun patch manquant | `merge-base --is-ancestor` OUI ; `git cherry` vide |
| PR #51 (`claude/compassionate-galileo-muge41`, `916cfe7`) | Ancêtre direct de #52, aucun patch manquant | idem |
| PR #52 (`claude/blissful-dirac-4ar700`, `749ac11`) | 64 commits, 345 fichiers, +34 380/−1 603 ; mergeable « clean » ; brouillon | GitHub |
| PR #53 (`chore/codespaces-claude-toolkit`, `7cea3d9`) | Outillage seul (6 fichiers), indépendant de #52 | `git diff --stat` |
| `codex/lfo-backup-20260916` | Sauvegarde (bundles, annexes) ; arbre source restauré dans #52 selon `REPRISE.md` | 7 commits « backup » non ancêtres, attendu |
| `codex/astra-supabase-reconciliation-20261001` | #52 + 1 commit : brouillon « devise des projections » archivé, non intégré, non validé | `BROUILLON_PROJECTION_2026-10-01.md` |
| CI GitHub | **Aucune** (`.github/` absent) : seuls Vercel Preview et Supabase Preview (ignoré) tournent | check-runs #52 |

### Contrôles réexécutés aujourd'hui sur #52 au SHA `749ac11`

| Contrôle | Résultat |
|---|---|
| `check:conflict-markers` | PASS |
| `npm run lint` | PASS |
| `tsc --noEmit` | PASS |
| `vitest run` | PASS, 2 506 tests / 178 fichiers |
| `npm run build` | PASS |
| `npm run gate:local` (PostgreSQL 16 local jetable) | PASS : 62 migrations depuis zéro, 116 tables, 478 contraintes, 123 RPC, 26 triggers, 58 tables d'audit, smokes et concurrence verts |
| Recettes navigateur | NOT_RUN (dernières : 25 sept., pile Supabase auto-hébergée locale) |
| Preview Vercel, Supabase hébergé, `db:verify` distant | BLOCKED (voir §1.3) |

Écart d'environnement : Node 22.22 ici contre `engines: 24.x` ; aucun effet constaté.

### Vérification Vercel (lecture seule, noms et cibles uniquement, aucune valeur déchiffrée)

Les 9 variables Supabase/applicatives, dont `SUPABASE_SECRET_KEY`, `SUPABASE_URL`, `OWNER_USER_ID`
et `LOCAL_ACCESS_CODE`, ciblent **production ET preview**. `SUPABASE_PUBLISHABLE_KEY` est absente.
Conséquence : chaque push d'une branche est déployé en preview avec les credentials serveur de la
base de production (dernier déploiement : #53, 12 oct., READY). La preview de #52 (62 migrations)
parle à une production à 45 migrations. Ce point est la condition préalable à tout push.

## 2. Matrice de correspondance

Statuts : MERGED, IMPLEMENTED_IN_PR, VERIFIED_LOCAL, PARTIAL, BLOCKED_EXTERNAL, NOT_STARTED.

| Ordre programme | Ticket | Objet | Commits / fichiers | Preuve | Statut | Reste à faire |
|---|---|---|---|---|---|---|
| Phases UX 0, 1, 2 | : | Date financière, primitives, registres, shell trois zones, six entrées, Aujourd'hui | PR #46 à #49 | Rapports de phase | MERGED | Gates visuels §42 non outillés |
| 1 | B01/B02 | Consolidation, baseline | `docs/consolidation/REPRISE.md` | : | IMPLEMENTED_IN_PR | Fusion |
| 2 | B03 | Simulation honnête (A07) | `63820c1` | Recette locale 12 sept. | VERIFIED_LOCAL | Isolation réelle/simulation complète : B44 |
| 2 | B04 | Réserve sur liquidité (A13) | `63820c1` | Recette locale | VERIFIED_LOCAL | Affectation des ressources : B43 |
| 2 | B05 | Incident JWT F04 | `63820c1` | Diagnostic expurgé, retry | PARTIAL | Cause non démontrée, incident ouvert |
| 2 | B06 | GET catalogue sans écriture (F14) | `63820c1` | SQL avant/après | VERIFIED_LOCAL | : |
| 3 | B07 | Champs vides, date de solde | `f2ad138` | Recette compte | PARTIAL | Prouvé sur le compte seulement |
| 3 | B08 | Provenance honnête (F07) | `f2ad138` | Tests | PARTIAL | Liens pièce/objet : B46 |
| 3 | B09 | Lecture ciblée Dettes | `bccb97d` | 2 180 tests, panne injectée | VERIFIED_LOCAL | Autres domaines encore sur `getDashboardState` |
| 4 | B10 | Reprise PR 50 | `fcba269` + `8d22b08` | 2 196 tests, recette | VERIFIED_LOCAL | PDF, mapping libre : 3C |
| 5 | B11 | Reprise PR 51 (A12) | `2b9bacf` + `916cfe7` | 2 251 tests, recette clôture | VERIFIED_LOCAL | Revue visuelle preview (gate 7) : BLOCKED_EXTERNAL ; actif/passif génériques : B55 |
| 6 | B12 | Session personnelle (11A) | `a7c2de1`, `52ed0e3`, `c90e5af`, migration `20260914191901` | Auth A/B 35/35 (pile locale) | VERIFIED_LOCAL | Recette hébergée : BLOCKED_EXTERNAL |
| 6 | B13 | Isolation des références | `ba72da3`, migration `20260915064740` | smoke 25 contrôles | VERIFIED_LOCAL | Storage HTTP A/B hébergé : BLOCKED_EXTERNAL |
| 6 | B14 | Accueil, contexte, premiers faits | `b555092`, `c345fa6`, `20f608c`, `26d28c5`, `5b7fc50` | B14 41/41 ; premier utilisateur 18/18 | PARTIAL | Volet documentaire (B19), devise de lecture choisissable (phase Flux), revue sans action dominante |
| 6 | : | Devises Dettes, Objectifs, Decision Lab | `94bb175`, `49835c5`, `2e55013` | Recettes locales | VERIFIED_LOCAL | Scénarios/Monte-Carlo : brouillon non intégré (PARTIAL) ; Immobilier |
| 7 | B15 | Dette par son seul encours | `20f608c`, migration `20260924081000` | 41/41 | VERIFIED_LOCAL | : |
| 7 | B16 | Contrat adaptatif | `f66c67b`, `cf24a23` | 3B 31/31 | VERIFIED_LOCAL | Variantes (amortissement constant, indexé, renouvelable) affectées |
| 7 | B17 | Assurance séparée | `164952a` à `ed467df` | 3B A1 à A9 | VERIFIED_LOCAL | Règle de prime par barème, rapprochement payé |
| 7 | B18 | Événements, versions | `a2d8d64`, `30085be`, `5121b46` | événements 18/18 | VERIFIED_LOCAL | Déblocages, impayés, refinancement affectés |
| 7 | : | Brouillons, dates d'observation, `account_balances` | `b068af1`, `c134fdf` | 13/13, smoke dates | VERIFIED_LOCAL | LF425 non étendu à portfolio et immobilier |
| 8 | B19 | Revue des candidats documentaires | Cahier des charges `749ac11` (D-UX-08 à 11 arbitrés) | : | NOT_STARTED | Tout le code |
| 8 | B20 | Rattachement échéancier et assurance | : | : | NOT_STARTED | Dépend de B19 |
| 8 | B21 | Dû, payé, prévu | : | : | NOT_STARTED | Dépend de B20 ; F10 ouvert |
| 9 | B22 à B25 | Phase 4B Flux, récurrences, rapprochement (F08) | Moteur Cash Flow V2 fusionné | : | NOT_STARTED (productisation) | Rapport 4A limite 8 |
| 10 | B26 à B29 | Phase 5 Comptes et placements | Moteurs Portfolio fusionnés | : | NOT_STARTED | : |
| 11-12 | B30 à B33 | Phases 6A/6B Immobilier | Real Estate V2 fusionné | : | NOT_STARTED | : |
| 13 | B34 à B38 (rattachement présumé) | Phase 7 Revenus, fiscalité | Career + Tax fusionnés | : | NOT_STARTED | IDs exacts à confirmer par `backlog.csv` |
| 14 | B39 à B42 | Phase 8 Participations | Business Equity V2.1 fusionné | : | NOT_STARTED | : |
| 15 | B43 à B45 | Phase 9 Objectifs, scénarios, décisions | Moteurs V2 fusionnés | : | NOT_STARTED | D-UX-06/07 |
| 16 | B46 à B49 | Phase 10 Sources, rapports | : | : | NOT_STARTED | : |
| transverse | B51, B55, B56, B57 | Isolation exhaustive, autres actifs/passifs, cent profils, accessibilité | : | : | NOT_STARTED / ouverts | B55 complète 4A |

## 3. Audit des dépendances (substitut à Graphify)

Graphify n'est pas installé dans cette session cloud. Il n'a pas été installé : paquet PyPI tiers
non audité, alors que la PR #53 laisse ouverte la « revue sécurité des plugins tiers ». Substitut
déterministe : graphe d'imports par l'AST du compilateur TypeScript du dépôt (285 fichiers de prod,
1 038 arêtes prod). Scripts rejouables : `scratchpad/audit-deps/`.

| Constat | Preuve | Gravité |
|---|---|---|
| Aucun cycle à l'exécution ; un cycle de TYPES de 25 fichiers causé par `src/lib/types.ts`, qui importe des sorties de moteurs alors que 20 moteurs l'importent | `types.ts:671-1154` | Maintenabilité |
| Moteurs purs respectés (aucun React, next, Supabase, data) ; mais `engine/debt.ts:1` importe `presentation/currency.ts` pour rédiger ses drapeaux | `debt.ts:1` | Couplage |
| `acquisition/debt-schedule.ts:2` importe `presentation/input-parse` et additionne intérêts, assurance, frais (synthèse) | `debt-schedule.ts:28-67` | À qualifier en B19 |
| 16 composants appellent directement des moteurs ; seul Aujourd'hui passe par un modèle de lecture | `audit-deps/analysis.txt` (COMP-ENGINE) | Architecture |
| Inversion data → présentation : repository et read-model importent le registre de pages | `supabase-repository.ts:14,15,110` | Couplage |
| Ordre amont/aval : `monthly-financial-model.ts:19` dépend du moteur d'événements, contraire à l'ordre écrit au §7 de CLAUDE.md | : | À trancher en doc |
| Le Debt Engine sert de bibliothèque de dates (8 importeurs) ; `daysBetween` défini 7 fois | : | Dette technique |
| Registre KPI : deux références de moteur mortes (`canonicalAllocation`, `outstandingAt`) non contrôlées | `kpis.ts:147,428` | Fiabilité du registre |
| Propagation : debt 82, fx 77, balance-sheet 66 dépendants à l'exécution ; `supabase-repository.ts` 4 221 lignes | `propagation.txt` | Risque de changement |

## 4. Audit qualité et UX (substitut à Ponytail et Agent Skills)

Agent Skills (`/spec`, `/plan`, `/build`, `/test`, `/review`, `/webperf`, `/code-simplify`) et
Ponytail ne sont pas installés dans cette session (ils le seraient dans le Codespace de #53).
Équivalents utilisés : scripts AST locaux, relecture ciblée, compétences `engineering:*`,
`code-review` et `simplify` disponibles. Scripts : `scratchpad/audit-quality/`.

### Défauts financiers démontrés (relus par moi, tous déjà présents sur `main`, donc en production)

| # | Défaut | Preuve | Invariant violé |
|---|---|---|---|
| F-1 | Fourchette de multiples inventée à ±15 % quand bas/haut ne sont pas déclarés | `business-equity/views.tsx:362-364` | §8 « convention non fournie » |
| F-2 | Pont EV → Equity recodé dans le composant | `views.tsx:345-355` contre `engine/business-valuation.ts:333` | Une couche aval ne recalcule pas |
| F-3 | Cash-flow libre calculé en excluant les dépenses à montant inconnu | `data/shared.ts` `deriveFlowMetrics` | NULL ≠ ZÉRO |
| F-4 | `addMonths` sans plafonnement : 31 mars − 1 mois = 3 mars ; variations M-1, M-3, M-12 sur une mauvaise référence | `engine/balance-sheet-metrics.ts:100-103` | Dates |
| F-5 | Hypothèses préremplies : quote-part 100 %, multiple 6, WACC 10 %, IS 25 %, croissance 2 % ; rendement 5,5 % côté Dette | `business-equity/forms.tsx:135,137,1636-1641` ; `debt/page.tsx:86` | §8, D-UX-04 |
| F-6 | Borne non déclarée affichée « 0.00 × » | `views.tsx:416` | NULL ≠ ZÉRO |
| F-7 | Montant de devise inconnue affiché en € | `imports/portfolio-section.tsx:74` | Devise jamais supposée |

### Sécurité

| Constat | Preuve |
|---|---|
| Variables serveur de production exposées aux previews (§1.3) | Vercel |
| 7 routes renvoient `error.message` brut au navigateur (texte PostgreSQL/Supabase) ; aucune fuite de jeton démontrée | `api/registry/route.ts:44`, `api/imports/*`, `api/documents/extraction/route.ts:43` |
| Migrations #52 : aucune régression de RPC ; trois risques sur base peuplée (B13 24 FK sans `NOT VALID`, contraintes `liabilities` en `20260924170000`, droits `auth.*` du définisseur en `20260914191901`) | `scratchpad/audit-migrations/notes-2026-10-12.md`, pré-contrôles P0 à P7 |
| `lfo_save_debt_contract` ignore une clé d'acteur au lieu de la refuser ; `deferral` absent devient « NONE/0 » | `20260925140000:414-449,614` |

### Maintenabilité et UX

- Monolithes : `createSupabaseRepository` 3 493 lignes, `executeMutation` 1 546, `CashFlowPage`
  1 410, `DebtContractForm` 1 355 ; 64 fonctions de plus de 200 lignes.
- 24 exports exécutables morts démontrés ; duplication `engine/debt.ts:1304-1331` = `:1825-1852` ;
  12 formateurs monétaires ; `Currency` avec défaut « EUR » sur 49 appels sur 80 (latent tant que
  la devise de lecture n'est pas choisissable).
- V10 : seules Aujourd'hui et Patrimoine ont un canevas propre ; action primaire non branchée sur
  7 pages ; 12 en-têtes en anglais ; deux `h1` par page ; 169 occurrences de jargon visible ;
  153 tailles sous 12 px ; aucun `prefers-color-scheme` ; 21 tableaux sur 22 sans rôle ARIA.
- Tests : 11 dossiers de page sur 18 sans test ; `engine/business-capital.ts` sans test direct.
- Non établi par analyse statique : proportions réelles V10 §2, contraste, lecteur d'écran,
  débordement mobile.

## 5. Roadmap opérationnelle

| Lot | Contenu | Critères de sortie | Dépend de | Effort relatif | Risques |
|---|---|---|---|---|---|
| H (humain, parallèle) | Restreindre les variables Supabase à `production` ; recette Supabase séparée ; pré-contrôles P0 à P7 ; `SUPABASE_PUBLISHABLE_KEY` ; Site URL `/auth/confirm` ; `OWNER_USER_ID` | Preview isolée, recette #52 sur SHA exact | Vous | : | Bloque toute fusion de #52 |
| 1 | Correctifs de vérité F-1 à F-7 + `routeFailure()` partagé | Tests de caractérisation rouges puis verts ; oracles indépendants (dates, FCF) ; aucun moteur modifié hors `addMonths` | : | S à M | Faible ; touche 6 fichiers |
| 2 | B19 selon le cahier des charges du 25 sept. | Critères §7 du cahier ; gate local ; recette navigateur locale ; relecture indépendante | Lot 1 conseillé, non requis | L | Migration additive sur Document Intelligence ; extension de `lfo_correct_document_extraction_field` (dernière version) |
| 3 | B20 rattachement échéancier et assurance | Dossier §4 « Validation et correction ultérieure » ; Patrimoine et Flux cohérents après rechargement | B19 | L | Remplacement d'échéancier, conflits de versions |
| 4 | B21 dû, payé, prévu | Métriques §5 du dossier, trois noms distincts (D-UX-01) | B20 | M | Rapprochement avec opérations |
| 5 | Revue UX transversale de clôture 3C (registre §4) | Titres FR, `h1` unique, jargon, aides `MetricHelp`, tableaux ARIA, rail Sources compact | B21 | M | Pas de refonte générale |
| 6 | B55 (complète 4A) puis phase 4B Flux (B22 à B25) | Selon `backlog.csv` | Lot 5 ; `backlog.csv` requis | L | Devise de lecture choisissable : prop `currency` obligatoire avant |
| 7+ | Phases 5, 6A, 6B, 7, 8, 9, 10, 11B, 12 | Programme §2 et §3 | Séquentiel | : | : |

Fondations transversales, traitées seulement quand un lot touche le fichier : extraction des
utilitaires de dates hors de `debt.ts`, `types.ts` découplé des moteurs, formateur monétaire unique,
CI GitHub (lint, test, build) sans secret.

## 6. Stratégie Git

1. Base de développement : la tête de #52 (`749ac11`). Elle contient `main`, #50, #51, B03 à B18.
   Partir de `main` réintroduirait des conflits sur `data/shared.ts`, `balance-sheet-metrics.ts` et
   `debt/page.tsx`, que #52 modifie.
2. Branche de travail : `claude/peaceful-wozniak-r1kd0d`, avancée en fast-forward de `bd1782c` vers
   `749ac11` (descendant direct : aucune réécriture d'historique), puis PR empilée avec base
   `claude/blissful-dirac-4ar700`, pour garder #52 relisible.
3. #50 et #51 : à fermer comme « reprises dans #52 » après sa fusion, pas à fusionner séparément.
4. #52 : à conserver ; fusion seulement après le lot H et une recette hébergée.
5. #53 : indépendante ; fusionnable après votre validation du Codespace. Compléter `.graphifyignore`
   (`*.bundle`, `*.png`, `docs/consolidation/**`, `supabase/.temp/`) avant tout `/graphify .`.
6. `codex/astra-supabase-reconciliation-20261001` : brouillon de devise des projections à
   réconcilier plus tard (phase 9 ou lot devise), jamais recopié en bloc.
7. Ne pas pousser tant que les previews ont les credentials de production.

## 7. Premier lot recommandé : correctifs de vérité (lot 1)

- Périmètre : F-1 à F-7 et les 7 routes `error.message`.
- Fichiers : `src/components/pages/business-equity/views.tsx`, `forms.tsx`, `src/lib/data/shared.ts`,
  `src/lib/engine/balance-sheet-metrics.ts`, `src/components/pages/debt/page.tsx`,
  `src/components/pages/imports/portfolio-section.tsx`, un module `src/app/api/_shared/route-failure.ts`
  et les 7 routes.
- Tests : caractérisation avant correction (31 mars, 29 février, fin de mois ; dépense inconnue ;
  multiple bas absent) ; oracle indépendant écrit à la main ; non-régression complète ; build.
- Résultat attendu : une hypothèse non fournie reste vide et bloque, un inconnu reste inconnu à
  l'écran et dans le cash-flow libre, une variation mensuelle compare la bonne clôture, aucun texte
  d'erreur interne n'atteint le navigateur.
- Alternative : commencer directement par B19 (ordre du programme), et intégrer F-1 à F-7 en lot 5.
