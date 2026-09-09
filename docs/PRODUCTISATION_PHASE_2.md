# Productisation — Phase 2 : onboarding, Aujourd'hui, boîte de réception, démonstration

Dossier de la phase 2 du plan de refonte (`AUDIT_PRODUIT_UX_LFO_ET_PLAN_DE_REFONTE`, §37
ligne 2, PR UX-2 du §11). Il suit les Étapes 0 à 8 du sas obligatoire du §36.

Résultat obligatoire du §37 : **première utilisation guidée et trois actions maximum**.

Le contrat UX de l'Étape 4 est constitué du §11, du §17, du §18, du §19, du §20, du §32,
du §35 et du §10.2 du plan, avec `design_v10.md` comme aide de conception. **En cas de
contradiction, le plan tranche** — règle donnée par le propriétaire du produit, appliquée
par la phase 1 (son arbitrage D1) et par les sections 4.6 et 4.7 ci-dessous.

---

## Étape 0 — Base

|                          |                                                 |
| ------------------------ | ----------------------------------------------- |
| Branche de départ        | `origin/main`                                   |
| Commit de base           | `d759d0d`, sommet de la phase 1 (seconde passe) |
| Base commune avec `main` | `d759d0d` — aucun contournement de branche      |

Les phases 0 et 1 sont donc DÉJÀ dans la base : contexte de date financière, primitives de
saisie, traducteur de langage, registres et leurs quatorze `PageManifest`, gates de contenu et
de design, trame V10 à trois zones, navigation à six entrées. La phase 2 les CONSOMME.

---

## Étape 1 — Audit de preuves

Chaque constat est relevé dans le code de la base, à `d759d0d`. Aucun n'est repris du plan
sans vérification : le plan décrit un état observé à sa date, et un audit qui recopie son texte
ne prouve pas que l'état est encore celui-là.

### A1 — Deux points de la dette de phase 1 étaient DÉJÀ soldés

Le brief de mission annonçait que `FinancialCanvas` n'existait pas comme module et que
`SourceRail` n'était monté par aucune page. Les deux sont FAUX à `d759d0d` : les commits
`14fbe5f` et `3e82e6c`, seconde passe de la phase 1, ont créé
`src/components/workstation/financial-canvas.tsx` et branché `SourceRail` et `Inspector` dans
`app-shell.tsx`. Un audit qui aurait recopié le brief aurait « recréé » un module existant.

Reste vrai : `financial-drawer.tsx` n'était monté par aucune page (point E5 des limites de la
phase 1). Il l'est maintenant, par la boîte de réception.

### A2 — Aujourd'hui était une grille générique de KPI

`src/components/pages/today/page.tsx` à `d759d0d` : `<section className="metrics-grid four">`
avec quatre `MetricCard`, puis `<section className="dashboard-grid">` avec quatre `<article
className="panel">`, puis une bande de boutons. Les critères 2 et 6 du gate visuel du §12.3
étaient rouges : « une grille générique de KPI constitue la composition par défaut » et « le
visuel principal pourrait appartenir à n'importe quel domaine ».

### A3 — Des codes techniques s'affichaient sur la page la plus consultée

Quatre occurrences dans le même fichier :

- `view.nextEvent?.type.replaceAll("_", " ")` — rendait « RENT RECEIPT », « EQUITY VEST » ;
- `` `${...} · ${view.nextEvent.domain} · ${view.nextEvent.dataKind}` `` — « CASH_FLOW · OBSERVED » ;
- `goal.evaluation?.status ?? "NOT_COMPUTABLE"` ;
- `view.context.blockers[0]?.code` — le code de moteur, en titre du panneau « Risque principal ».

Constat 5.4 du plan confirmé. Le traducteur de la phase 0 existait et n'était pas appelé.

### A4 — Six vues d'inbox demandées, aucune existante

Le §32 demande « À vérifier, Conflits, Données manquantes, Données anciennes, À venir et
Résolus automatiquement ». Aucune boîte de réception n'existait ; `task-inbox.tsx`, que le
§10.2 nomme dans la structure cible, n'existait pas. La taxonomie `IssueFamily` de la phase 0
porte QUATRE familles, qui répondent à une autre question — voir l'arbitrage D3.

### A5 — « Je ne suis pas concerné » n'était représentable nulle part

`grep -rn "DECLARED_NONE" src/lib` : le type existe dans `language/states.ts` et dans les
`supportedStates` des manifestes, et AUCUNE table, mutation ni méthode de dépôt ne portait la
réponse. Le produit ne pouvait donc pas distinguer « cet utilisateur n'a pas de bien » de
« cet utilisateur n'a rien saisi », et les deux se rendaient identiquement. Constat 5.6.

### A6 — Aucun onboarding

Aucun composant, aucune route, aucune persistance. Le §19 en demande six écrans d'entrée et un
chemin initial court de cinq étapes.

### A7 — `getDashboardState()` servait Aujourd'hui

`src/app/(workspace)/page.tsx` appelait `repository.getDashboardState()` et passait l'état
entier à `AppShell`, qui le passait à `SectionContent`, qui le passait à `TodayPage`, qui
appelait `buildTodayCockpit(state)` — donc les moteurs — depuis un composant client. Mesure
technique du §13 non tenue : « aucune page de domaine ne sérialise tout `DashboardState` ».

### A8 — Décisions KEEP / REUSE / EXTEND / DEPRECATE / REPLACE

| Élément                                                        | Décision  | Motif                                                                                                                                   |
| -------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/engine/**`                                            | KEEP      | Critère d'acceptation : aucun calcul financier modifié                                                                                  |
| Registres de la phase 0                                        | REUSE     | Manifeste `today` révisé en v2, KPI et objectifs inchangés                                                                              |
| `translateIssues`, `STATE_CONTRACTS`                           | REUSE     | Le traducteur existait, il n'était pas appelé                                                                                           |
| `WorkspaceShell`, `SourceRail`, `Inspector`, `FinancialCanvas` | REUSE     | Zones de la phase 1, montées telles quelles                                                                                             |
| `FinancialDrawer`                                              | REUSE     | Orphelin depuis la phase 1, monté par l'inbox                                                                                           |
| `today-cockpit.ts`                                             | KEEP      | Devenu module PARTAGÉ (advisor, reporting, timeline) malgré son nom ; son renommage appartient à une phase qui possède ces domaines     |
| `rail-sources.ts`                                              | EXTEND    | Fraîcheur d'un échéancier corrigée, cf. arbitrage D5                                                                                    |
| `codes.ts`                                                     | EXTEND    | Cinq codes du bilan canonique ajoutés, cf. arbitrage D4                                                                                 |
| `code-inventory.ts`                                            | EXTEND    | Gate inverse aveugle aux codes interpolés, cf. arbitrage D4                                                                             |
| Page Aujourd'hui                                               | REPLACE   | Composition, source de données et langage                                                                                               |
| `.dashboard-grid` / `.span-2` (CSS)                            | DEPRECATE | Orphelines après la réécriture : plus aucun `.tsx` ne les porte                                                                         |
| `create_monthly_close` sur Aujourd'hui                         | DEPRECATE | §20 : « Today n'a pas de formulaire financier propre » ; le manifeste déclare `primaryAction: null`. L'action reste servie par Activité |

---

## Étape 2 — Nettoyage ciblé

Limité au périmètre, comme le §36 l'exige (« ne jamais lancer un nettoyage global non lié ») :

- quatre rendus de code technique retirés d'Aujourd'hui (A3) ;
- `.dashboard-grid` et `.span-2` supprimées de `globals.css`, avec leurs deux déclinaisons
  responsive : plus aucun composant ne les portait après la réécriture ;
- `TodayPage` retiré de l'aiguillage `SectionContent`, qui ne sert plus que les treize
  sections encore alimentées par l'état global ;
- aucune migration supprimée, aucune donnée touchée.

La dette typographique des pages reste plafonnée à **152** déclarations et n'augmente pas :
`today.css` est écrit intégralement au-dessus du plancher de 12 px. Elle ne DÉCROÎT pas non
plus, et c'est une limite : les classes que l'ancienne page portait (`metric-card`, `panel`,
`eyebrow`) sont partagées avec les treize autres pages, et les remonter serait la « grande PR
de redesign transversal » que le §11 interdit.

---

## Étape 3 — Refactor habilitant

### 3.1 Le modèle de lecture, et ce qu'il change réellement

`src/lib/data/read-models/today.ts` livre `getTodayReadModel()`, nommé par le §10.2. La route
racine l'appelle et ne touche plus `getDashboardState()`. **Les treize autres pages gardent
l'état global** jusqu'à leur propre phase (§14).

La frontière n'est pas déclarative : `AppShellSource` est une union discriminée
`{ kind: "TODAY", model } | { kind: "SECTION", state }`, de sorte qu'Aujourd'hui ne peut PAS
recevoir `DashboardState`, même par accident. Tant que le composant dispose de l'état, il peut
recalculer, et la mesure du §13 reste inatteignable quelle que soit la discipline.

### 3.2 Les mutations ne rendent plus l'état global

`src/app/api/today/route.ts` : `GET` rend le modèle, `POST` écrit une déclaration et rend le
modèle RELU. Le §10.2 : « une mutation ne doit plus renvoyer tout `DashboardState`. Elle
renvoie l'entité affectée, la nouvelle version du modèle local ou un signal d'invalidation
ciblé. »

### 3.3 La couche de présentation

`src/lib/presentation/today/`, nommée par le §10.2 : `contracts.ts`, `domains.ts`,
`answers.ts`, `flow.ts`, `obligations.ts`, `inbox.ts`, `actions.ts`, `onboarding.ts`,
`view.ts`. `buildTodayView` est une **fonction pure** : elle ne lit ni base, ni requête, ni
horloge — la date d'arrêté lui est donnée. C'est ce qui rend les cinq états du §41 testables en
quelques lignes, sans Supabase ni React.

Aucun montant n'y est calculé. Tous arrivent agrégés par les moteurs canoniques.

### 3.4 Le traducteur d'événements

`src/lib/presentation/language/events.ts` : les 61 types d'événement canoniques, les 8
domaines et les 5 natures de preuve, en français. L'exhaustivité est tenue par le TYPE
(`Record<CanonicalEventType, string>`) et non par un test de comptage : un compte recopié se
met à jour sans qu'on regarde ce qu'il compte.

---

## Étape 4 — Contrat UX de la phase

### 4.1 Trois arbitrages demandés au propriétaire AVANT le code

Le §36 Étape 4 : « si le contrat n'est pas déterminé, l'IA s'arrête et demande un arbitrage.
Elle ne choisit pas silencieusement. » Trois points ne l'étaient pas.

| Question                                                                | Réponse retenue                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Où persiste « je n'ai pas de bien / société / dette » ?                 | **Migration minimale** : une table de déclarations de domaine et une RPC, rien d'autre. Motif d'usage, horizon et densité d'affichage (§19.1 items 2, 3 et 6) restent hors périmètre : ce sont des réglages, que le §20 range dans le paramétrage de la page |
| Quel périmètre pour la démonstration du §19.3 ?                         | **Démo cadrée phase 2** : Aujourd'hui, sa boîte de réception et son parcours. Les huit domaines des phases 3 à 10 ne sont pas fixturés                                                                                                                       |
| Que fait la vue « Données anciennes » sans seuil de fraîcheur déclaré ? | **Vue honnête et vide** : elle existe et déclare qu'aucun seuil n'est déclaré                                                                                                                                                                                |

### 4.2 Question principale et zones

Question du manifeste, inchangée : **« Que dois-je comprendre et faire maintenant ? »**

Zones servies, dans l'ordre du manifeste v2 : `OPERATIONAL_HEADER`, `SOURCE_RAIL`,
`FINANCIAL_CANVAS`, `CONTEXTUAL_ACTIONS`, `AVAILABLE_ANALYSIS`, `INSPECTOR`.

### 4.3 Le canvas : les six questions du §3, répondues par une géométrie

| Question du §3                                      | Forme retenue                                                                            | KPI de registre                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Combien est-ce que je possède réellement ?          | Objet de stock : le patrimoine net, avec une barre dont la part remplie est la liquidité | `net_worth`                                             |
| Combien est disponible maintenant ?                 | La même barre, lue à l'autre échelle, avec sa part en pourcentage                        | `immediate_cash`                                        |
| Est-ce que ma situation s'améliore ou se dégrade ?  | Barre d'écart entre deux clôtures, décomposée en causes de largeur proportionnelle       | `net_worth_change_since_close`                          |
| Suis-je en sécurité par rapport à mes engagements ? | Ruban du mois : revenu → dépenses essentielles → service de dette → solde libre          | `free_cash_flow_after_debt`, `upcoming_obligations_30d` |
| Où vais-je si je ne change rien ?                   | Piste de trajectoire vers l'échéance de l'objectif                                       | `goal_progress`                                         |
| Quelle décision mérite mon attention ?              | Compte de ce qui attend une décision, entrée vers l'inbox                                | `pending_review_count`                                  |

Aucune valeur absente n'est DESSINÉE : une barre à largeur nulle affirmerait un zéro. Les blocs
dont la valeur est `null` rendent leur ÉTAT parmi les huit du §6.3. C'est `NULL ≠ ZERO` appliqué
au dessin, et le §22 de V10 : « missing data changes geometry, not just text ».

### 4.4 Le parcours d'installation

Cinq points du §19.2, dont quatre étapes et un résultat :

1. connecter ou importer la banque ;
2. connecter ou importer les placements ;
3. ajouter un bien, une société ou une dette — **seulement si applicable** ;
4. déposer les documents disponibles ;
5. **au plus cinq** éléments à préciser (porté par `toClarify`, pas par la liste d'étapes).

Une étape est FAITE quand les faits le prouvent, jamais quand l'utilisateur a cliqué. Elle est
CLOSE quand tous ses domaines sont déclarés non concernés. L'étape 3 groupe trois domaines
parce que le plan les groupe : les séparer ferait de « je n'ai ni bien, ni société, ni dette »
trois refus successifs.

Trois réponses, celles du §18.1 : **Oui / Non / Je ne sais pas encore**. Et un quatrième état
qui n'est pas une réponse : l'absence de déclaration.

```text
ABSENCE DE LIGNE  ≠  UNDECIDED  ≠  DECLARED_NONE
la question n'a       elle l'a été,      l'utilisateur a
jamais été posée      réponse « pas      déclaré n'être
                      encore »           pas concerné
```

### 4.5 La boîte de réception

Six vues (§32), en ONGLETS dans un tiroir — le §11 de V10 la veut en « compact drawer / side
tray », et six sections empilées seraient la pile verticale que le §13 de V10 rejette.

Chaque tâche porte les quatre explications du §11 : **ce qui s'est passé, pourquoi cela compte,
la preuve, ce que change l'acceptation**. Elles sont repliées par défaut (§4.4 de V10 :
« explanation appears on interaction, not permanently »).

### 4.6 Beyonder : où il est, et où il n'est pas

Le §35 : « le moteur déterministe décide des faits, de la calculabilité, de la matérialité et
des actions autorisées. Le provider génératif peut reformuler exclusivement à partir des
preuves citées. »

Cette phase livre **le moteur déterministe**, et rien du provider. Le classement des trois
actions est un ordre écrit dans `actions.ts`, lisible et reproductible ; les explications des
tâches sont composées par famille de réserve, pas générées. Aucun appel au provider n'est
ajouté, et l'expérience ne dépend donc pas de sa disponibilité — ce que le §35 exige aussi.

C'est délibérément l'inverse d'une page de logs : le §20 interdit « une liste de cinquante
alertes », et le plafond de trois actions est appliqué par le modèle et vérifié par un test.

### 4.7 Hors périmètre, explicitement

- **les six écrans d'entrée du §19.1** : seuls les domaines concernés (item 4) sont
  implémentés et persistés. Motif d'usage, horizon et préférences d'affichage sont des
  réglages, arbitrés hors périmètre ;
- **la démonstration complète du §19.3** : huit domaines sur dix ne sont pas fixturés ;
- **la zone D en catalogue « Aller plus loin »** (§17) : le manifeste la déclare, la page ne
  la rend pas encore. Aujourd'hui n'a pas de KPI activable — ses six KPI sont tous essentiels,
  et un catalogue vide serait une carte vide ;
- **l'inspecteur enrichi** : il rend ce que l'explication existante contient, comme en phase 1.
  Correction de rattachement et édition du fait sélectionné appartiennent aux phases de domaine ;
- **l'attribution d'une réserve de moteur à un domaine** : une réserve porte un code, pas un
  domaine. Voir les limites connues, point 3 ;
- **les treize autres pages** : inchangées, y compris leur dépendance à `getDashboardState()`.

---

## Étape 5 — Implémentation

### Fichiers créés

```text
supabase/migrations/20260909190841_user_domain_declarations.sql
scripts/smoke-domain-declarations.ts
src/lib/presentation/language/events.ts
src/lib/presentation/today/{contracts,domains,answers,flow,obligations,inbox,actions,onboarding,view}.ts
src/lib/data/read-models/{today,today-demo}.ts
src/app/api/today/route.ts
src/app/demo/page.tsx
src/components/demo-workspace.tsx
src/components/workstation/task-inbox.tsx
src/components/pages/today/{canvas,figures,installation}.tsx
src/app/today.css
```

### Fichiers modifiés

```text
src/app/(workspace)/page.tsx           route racine → getTodayReadModel()
src/app/(workspace)/[section]/page.tsx nouvelle forme de source
src/app/layout.tsx                     import de today.css
src/app/login/page.tsx                 accès à la démonstration (§19.3)
src/app/globals.css                    CSS orpheline retirée
src/proxy.ts                           /demo public
src/components/app-shell.tsx           deux formes de source, rail conditionnel
src/components/pages.tsx               Aujourd'hui sort de l'aiguillage
src/components/pages/today/page.tsx    réécrite
src/lib/data/repository.ts             deux méthodes de déclaration
src/lib/data/supabase-repository.ts    leur implémentation
src/lib/presentation/registry/pages.ts manifeste today v2
src/lib/presentation/rail-sources.ts   fraîcheur d'un échéancier (D5)
src/lib/presentation/language/codes.ts cinq codes du bilan (D4)
src/lib/presentation/language/code-inventory.ts gate inverse et codes interpolés (D4)
scripts/verify-supabase-schema.ts      table, index, contrainte, trigger, RPC
package.json                           smoke dans gate:local
CLAUDE.md, docs/SUPABASE_SETUP.md      registre de schéma
```

---

## Étape 6 — Validation

| Gate                                     | Résultat                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                           | vert                                                                                                                                                                              |
| `npm run test`                           | **2 127** tests, 121 fichiers, verts (base : 2 061 / 116)                                                                                                                         |
| `npm run build`                          | vert, `/api/today` et `/demo` dans les routes                                                                                                                                     |
| `npm run gate:local`                     | **45** migrations rejouées depuis zéro, **107** tables, 436 contraintes, 115 RPC, 18 triggers d'invariant, 40 tables d'audit en lecture seule, 20 smokes + 2 de concurrence verts |
| `git diff origin/main -- src/lib/engine` | **vide**                                                                                                                                                                          |

82 tests portent sur le périmètre de la phase : les cinq états du §41, le plafond de trois
actions, les six vues d'inbox, les quatre explications de chaque tâche, `null ≠ 0`, la fenêtre
de trente jours, le cloisonnement de la démonstration, le contrat de la route, et la surface
rendue au clavier et à la souris.

### Défauts trouvés par les tests et les probes de cette phase

Six, tous dans du code écrit ici ou révélé par le premier branchement d'une page :

1. **`now()` ne donne aucun ordre.** Le smoke de la migration a échoué au premier essai : deux
   déclarations écrites dans la même transaction portent le même `created_at`, et « laquelle
   est la dernière ? » n'avait pas de réponse. Corrigé par un rang par domaine, attribué sous
   verrou. HORODATAGE ≠ ORDRE.
2. **Un code de moteur non traduit atteignait la surface.** `POSITION_UNDER_EXPLAINED` n'était
   dans aucun registre : la boîte de réception a affiché « Réserve non traduite » au premier
   essai de la démonstration. C'est la brèche que `code-inventory.ts` documentait en phase 0
   sans que personne ne puisse la voir, faute de page branchée.
3. **Le gate inverse était aveugle aux codes interpolés.** Une fois les traductions ajoutées,
   il les a accusées d'être mortes : le bilan écrit ``  `POSITION_${item.state}:…` ``, et la
   recherche de littéraux ne voyait que `POSITION`.
4. **Des opérations bancaires comptabilisées s'affichaient comme échéances à venir.** Filtrer
   sur la seule nature de preuve ne suffit pas : NATURE DE PREUVE ≠ NATURE D'ÉVÉNEMENT.
5. **Le rail annonçait la fraîcheur d'un échéancier comme une date future.** Il rendait la
   dernière date d'échéance du prêt — son horizon — sous un libellé « Au … » qui annonce une
   mise à jour. HORIZON ≠ FRAÎCHEUR.
6. **La colonne du rail était réservée à un rail vide.** `Boolean(sourceRail)` est vrai pour un
   élément qui rendra `null` : c'est le point E4 de la phase 1, côté rail. Le défaut n'était pas
   atteignable par un manifeste — le gate de registre l'interdit — mais la décision est
   maintenant gardée par un test.

### Ce que les tests prouvent, et ce qu'ils ne prouvent pas

Ils prouvent : la composition, les états, les plafonds, le langage, le cloisonnement de la
démonstration, l'ordre déterministe, le contrat de la route, l'absence de code technique sur la
surface rendue, l'ouverture et la fermeture au clavier.

Ils ne prouvent pas : la GÉOMÉTRIE réelle. Les largeurs proportionnelles, les proportions du
§2 de V10 et la lisibilité à 1440 × 900 et 1280 × 800 ne sont pas mesurées — un test jsdom ne
met en page rien. Le gate visuel du §12.3 et les snapshots du §12.2 restent une vérification
humaine sur la preview, et c'est l'objet de l'Étape 7.

---

## Étape 7 — Revue indépendante

**Elle n'est pas accordée par cet agent.** Le §36 la confie à un autre acteur, et le
propriétaire du produit l'a réservée : elle est visuelle, sur la preview, au SHA exact.

Points à regarder en priorité, parce que ce sont ceux qu'aucun test ne couvre :

1. la composition du canvas à 1440 × 900 et 1280 × 800 : le §2 de V10 veut le canvas visible
   sans défilement, et les proportions 68-75 % de contenu analytique ;
2. les largeurs proportionnelles du ruban et des causes : elles encodent des montants, et une
   proportion fausse est un mensonge visuel qu'aucun test ne voit ;
3. le parcours d'installation sur un profil réellement vide, et la persistance d'un « Non »
   après rechargement ;
4. `/demo` sans session, en navigation privée ;
5. les six onglets de l'inbox, dont « Données anciennes » et son motif de vacuité.

---

## Étape 8 — Rapport et décision

Voir la synthèse remise avec la PR. Verdict proposé : **READY** pour la revue visuelle, sous
les limites ci-dessous. Le gate du §42 reste au propriétaire : sept de ses huit décisions sont
instruites ici, la huitième — la preview approuvée — ne l'est pas.

---

## Arbitrages

### D1 — Aujourd'hui obtient un rail de sources, contre son manifeste v1

Le manifeste v1 de la phase 0 déclarait `sources: []` et supprimait la zone B, au motif que
Today « n'est pas un domaine, il n'a pas de source propre ». C'est vrai, et insuffisant : les
six réponses du §3 changent de SENS selon la fraîcheur de ce qui les alimente — un patrimoine
net au 30 juin lu le 8 septembre n'est pas le même chiffre — et le critère 3 du gate visuel du
§12.3 fait échouer une page dont « les sources restent invisibles ».

Le rail porte donc six lignes, et chacune répond à « quelle réponse du §3 cette source
décide-t-elle ? ». Il ne reproduit PAS le rail de Patrimoine, qui liste ce qui compose le
bilan. Manifeste passé en **version 2**, comme le §39 l'exige d'un contrat revu avant
implémentation.

Demandé par le propriétaire du produit dans le brief de mission ; le §38 règle 5 exige une
justification utilisateur pour un changement d'ordre de page, et c'est celle-ci.

### D2 — `goal_progress` entre aux KPI essentiels du manifeste

Le §20 item 4 impose une « trajectoire courte vers les objectifs actifs » au canvas, et la
cinquième question du §3 — « où vais-je si je ne change rien ? » — n'avait aucun KPI de
registre dans le manifeste v1. La servir quand même aurait été la composition libre que le §16
interdit, et le quatrième refus de CI du §39 ne l'aurait pas vu : il ne contrôle que les KPI
DÉCLARÉS, pas ceux qu'une page rend. Un test ferme l'écart pour cette page, en confrontant les
KPI réellement servis au manifeste.

### D3 — Les six vues du §32 ne sont pas les quatre familles du §11

La phase 0 a livré `IssueFamily` — incomplet, à confirmer, conflit, incident — qui répond à
« de quelle NATURE est cette réserve ». Les six vues du §32 répondent à « dans quel ONGLET se
range-t-elle ». Trois vues ne dérivent d'aucune famille : « À venir » n'est pas une anomalie,
« Résolus automatiquement » n'est pas un problème, « Données anciennes » n'est pas une absence.

La famille `INCIDENT` va dans « À vérifier », et c'est le seul placement qui soit un choix :
le §32 n'a pas de vue « Incidents ». « À vérifier » est la vue de ce qui demande un examen
explicite, et un incident en demande un ; le ranger dans « Conflits » aurait affirmé une
contradiction de sources là où il n'y a qu'une panne, et lui inventer une septième vue aurait
modifié le §32 sans décision écrite (§38 règle 2). La tâche garde son état `SYSTEM_ERROR`, donc
son rendu reste distinct.

### D4 — Cinq codes du bilan canonique sont traduits, et le gate inverse est étendu

`code-inventory.ts` déclarait en phase 0 que le bilan canonique, le portefeuille, le cash-flow,
la carrière et le modèle mensuel « poussent leurs codes en littéraux, sans type nommé » et
échappent au gate. La brèche était invisible : aucune page n'appelait le traducteur. La
première page branchée l'a ouverte au premier écran.

Les cinq codes traduits sont ceux qui ATTEIGNENT Aujourd'hui. `POSITION_NOT_APPLICABLE` n'est
PAS traduit, et c'est délibéré : le bilan ne l'émet que pour les états différents de
`RECONCILED`, il n'atteint donc jamais la liste des réserves, et le déclarer produirait une
traduction morte.

Le gate inverse recompose désormais les préfixes interpolés avec les littéraux du même fichier.
Le résultat est un SURENSEMBLE, acceptable ici et nulle part ailleurs : ce gate ne détecte que
les traductions mortes, où un faux positif affaiblit un peu la vérification, jamais n'accuse à
tort. L'inventaire direct, qui lui accuse, ne s'en sert pas.

### D5 — La fraîcheur d'un échéancier est celle de son encours

`rail-sources.ts` rendait la plus récente des dates d'ÉCHÉANCE, c'est-à-dire une date future :
la dernière échéance du prêt. Le rail l'affiche sous « Au … », qui annonce une date de mise à
jour, et un prêt à échéance 2027 s'annonçait relu en 2027.

Le fichier appartient à la phase 1 et sert aussi Dette, Immobilier et Flux. La correction est
faite ici quand même, pour une raison simple : Aujourd'hui est la première page à RENDRE ce
rail, et livrer une page qui affiche sciemment une date fausse n'est pas une option. Deux tests
de la phase 1 attendaient l'ancien comportement et sont corrigés avec leur motif.

### D6 — La démonstration n'a ni barre latérale ni navigation

Elle est cadrée sur Aujourd'hui. Afficher les six entrées du §7 conduirait un visiteur non
authentifié vers treize pages qui le renverraient à l'écran de connexion. C'est l'argument que
la phase 1 a retenu pour son action primaire non servie : « un contrôle qui ne fait rien coûte
plus qu'un contrôle absent ».

### D7 — `/demo` est publique, et sa sûreté est structurelle

Le §19.3 la veut atteignable depuis l'écran de connexion, donc sans session. C'est le SEUL
élargissement de la surface publique de la refonte, et il ne repose pas sur une promesse de
relecture : le module de données de la démonstration n'importe ni `getRepository`, ni le client
Supabase, ni la lecture d'état. Il n'existe aucun chemin depuis cette route vers une donnée
réelle, et un test le vérifie sur les imports du module, commentaires retirés.

### D8 — Une déclaration ne fait pas taire une réserve de moteur

Un domaine déclaré non concerné ne produit plus aucune DEMANDE : ni étape de parcours, ni
action prioritaire, ni question de cadrage. Il ne fait pas disparaître une réserve qu'un moteur
a déjà émise sur des faits existants — et c'est le bon sens de la règle plutôt qu'une
limitation : si des faits existent dans un domaine déclaré absent, la contradiction est
précisément ce qu'il faut montrer. Le §16 interdit de choisir entre la déclaration et le fait,
et la boîte de réception les montre tous les deux.

En pratique, le cas où une suppression serait souhaitable ne se présente presque pas : sans
faits dans le domaine, les moteurs n'émettent rien à son sujet.

---

## Limites connues, à la fin de la phase

1. **La géométrie n'est pas vérifiée automatiquement.** Les largeurs proportionnelles, les
   proportions du §2 de V10 et la lisibilité aux tailles cibles sont une vérification humaine.
   Les snapshots visuels du §12.2 ne sont pas outillés dans ce dépôt.
2. **Quatre des six écrans d'entrée du §19.1 ne sont pas implémentés** : motif d'usage,
   horizon, mode d'alimentation et préférences d'affichage. Arbitré hors périmètre.
3. **Une réserve de moteur n'est pas attribuée à un domaine.** Elle porte un code, pas un
   domaine, et les préfixes réels (`MISSING_`, `LEDGER_`, `NON_`, `FX_`) traversent plusieurs
   domaines : une attribution par heuristique enverrait l'utilisateur au mauvais endroit. La
   destination d'une tâche est donc grossière — Patrimoine ou Activité. L'attribution fine
   appartient à chaque phase de domaine, qui connaît ses codes.
4. **La vue « Résolus automatiquement » est vide dans la démonstration.** Elle se remplit quand
   un moteur émet une réserve qu'il a réglée lui-même ; le jeu de démonstration n'en fabrique
   pas une pour l'occasion.
5. **La vue « Données anciennes » ne peut rien contenir** tant qu'aucun seuil de fraîcheur n'est
   déclaré. C'est l'arbitrage retenu, et la vue le dit.
6. **La démonstration ne couvre pas les huit domaines des phases 3 à 10** (§19.3).
7. **La dette typographique des pages reste de 152 déclarations.** Plafonnée, pas résorbée : les
   classes concernées sont partagées avec les treize autres pages.
8. **`today-cockpit.ts` porte un nom trompeur** : il est de fait un module partagé par Beyonder,
   le reporting et l'Activité. Son renommage appartient à une phase qui possède ces domaines.
9. **L'alignement avec la production n'est pas établi.** Le dépôt porte 45 migrations, la
   production 33 au dernier état communiqué. Le push distant et `npm run db:verify` restent des
   étapes humaines.
