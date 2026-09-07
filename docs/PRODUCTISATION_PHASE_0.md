# Productisation Phase 0 : date, saisie, langage, registres

Document de phase du chantier de productisation décrit par `AUDIT_PRODUIT_UX_LFO_ET_PLAN_DE_REFONTE`
version 2.0. Il couvre le sas obligatoire de la section 36 pour la phase 0 de la séquence de la
section 37, et il est la référence de revue de cette phase.

Ce document n'est pas un compte rendu d'intention : chaque constat porte son fichier et sa ligne,
et chaque décision porte son motif. Un constat sans preuve rattachable n'y figure pas.

## Étape 0 : rebase et périmètre

| Élément                             | Valeur constatée                                                     |
| ----------------------------------- | -------------------------------------------------------------------- |
| Base réelle                         | `origin/main` au SHA `fd42684301aa9b0722d9f19ca202aff26ec36f29`      |
| SHA attendu par le plan             | `fd42684301aa9b0722d9f19ca202aff26ec36f29` (identique)               |
| Écart local                         | `git rev-list --left-right --count origin/main...HEAD` renvoie `0 0` |
| Migrations du dépôt                 | 44, inchangées par cette phase                                       |
| Migrations appliquées en production | 33 au dernier état communiqué, inchangées par cette phase            |
| Branche de développement            | `claude/elegant-pascal-ao2lwq`                                       |

### Périmètre autorisé

La phase 0 touche quatre objets et rien d'autre : la date financière, les primitives de saisie, la
traduction du langage technique, les registres de composition. Le résultat obligatoire de la
section 37 est : « Plus de zéro fabriqué, date juste, codes masqués, manifests en place ».

Sont dans le périmètre :

- `src/lib/data/shared.ts` et les consommateurs de `AS_OF_DATE` ;
- les helpers de saisie et de formatage de `src/components/pages/shared.tsx` et `src/components/ui.tsx` ;
- la nouvelle couche `src/lib/presentation/` (date, langage, registres) ;
- la nouvelle couche `src/components/primitives/` ;
- les tokens CSS invalides de `src/app/globals.css` ;
- l'outillage de gates et de tests.

Sont hors périmètre, et ne doivent pas être touchés :

- les moteurs de `src/lib/engine/` : aucune formule, aucun seuil, aucune convention ;
- la couche `src/lib/acquisition/` et les sept verticales d'acquisition ;
- le schéma PostgreSQL : aucune migration n'est ajoutée par cette phase ;
- la navigation à six entrées, le `WorkspaceShell`, le rail de sources et l'inspecteur, qui sont la
  phase 1 ;
- la composition visuelle des pages, qui appartient aux phases 1 à 10.

### Contradiction du plan à résoudre, pas à ignorer

La section 11 exige simultanément deux critères pour cette phase :

1. « le site n'affiche plus le 19 août 2026 comme aujourd'hui » ;
2. « aucun calcul financier n'est modifié ».

Ces deux critères sont incompatibles si `AS_OF_DATE` est remplacée en bloc : la constante alimente
l'année fiscale, la fenêtre de ledger et la fraîcheur, donc remplacer sa valeur change des résultats.
La contradiction se résout en séparant les ROLES de la constante, pas en choisissant un critère
contre l'autre. C'est l'objet de la décision D1 ci-dessous.

## Étape 1 : audit de l'existant

Toutes les mesures ci-dessous sont relevées sur le SHA de base.

### 1.1 La date financière

`src/lib/data/shared.ts:39` définit :

```ts
export const AS_OF_DATE = "2026-08-19";
```

48 occurrences dans 9 fichiers : `scripts/seed-supabase.ts`, `src/lib/data/shared.ts`,
`src/lib/data/supabase-repository.ts`, `src/lib/data/fec-repository.ts`,
`src/lib/data/import-repository.ts`, `src/lib/data/open-banking-repository.ts`,
`src/lib/validation/mutations.ts` et deux fichiers de test.

L'audit constate que la constante ne porte pas un rôle mais TROIS, mélangés :

| Rôle                   | Nature réelle                                       | Exemples constatés                                                                                                                         |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| R1 date de reporting   | Date d'arrêté, immuable dans un rapport             | `supabase-repository.ts:1676`, `:1713`, `:1730`, `:1745`, `:1759`, `:1768`, `:1793` (`asOfDate` des contextes de domaine)                  |
| R2 date opérationnelle | « Aujourd'hui », ce que l'utilisateur lit à l'écran | `supabase-repository.ts:352` (fenêtre de ledger), `:1664` (année fiscale), `:1682`, `:1683`, `:1691`, `:1692` (règles fiscales en vigueur) |
| R3 date de repli       | Valeur inventée quand une date d'observation manque | `supabase-repository.ts:238` (createdAt), `:533` (solde de compte), `:575` (valorisation de position), `:814` (solde de dette)             |

Le plan ne décrit que R1 et R2 (section 5.1). R3 est un constat propre à cet audit et il est plus
grave que les deux autres : c'est une donnée fabriquée à la place d'une donnée absente, exactement
ce que la section 8 interdit. Un solde de compte sans observation datée se présente aujourd'hui comme
observé au 19 août 2026, et sa fraîcheur en est déduite. Le mensonge n'est pas visible à l'écran :
il est indistinguable d'une vraie observation.

Deux occurrences de R2 sont des écritures et non des lectures : `supabase-repository.ts:2549` et
`:2871` passent `p_as_of_date: AS_OF_DATE` à une RPC, et `:2580` écrit `effective_date: AS_OF_DATE`.
Une écriture datée d'une constante gelée persiste une date fausse, elle ne se contente pas de
l'afficher.

### 1.2 La saisie numérique

`src/components/pages/shared.tsx:59` définit l'unique helper de saisie du produit :

```ts
export const inputNumber = (value: string) => Number(value.replace(",", "."));
```

24 appels dans 5 fichiers : `scenarios/page.tsx` (12), `cash-flow/page.tsx` (5),
`net-worth/page.tsx` (3), `goals/page.tsx` (3), `shared.tsx` (1).

Trois défauts constatés :

1. `Number("")` vaut `0`. Un champ vidé par l'utilisateur produit donc un zéro déclaré, sans
   qu'aucune ligne de code n'ait décidé d'un zéro. C'est la violation directe de `NULL ≠ ZERO` en
   entrée de chaîne.
2. `Number("1,5,3")` vaut `NaN`, et `NaN` traverse le helper sans être arrêté.
3. Le helper ne connaît que la virgule décimale. `1 234,56` avec une espace de milliers, ou
   `1 234,56` avec une espace insécable, produit `NaN`.

Le dépôt compte 252 balises `<input>` dans les composants, dont 59 avec `type="number"`. Deux champs
sont initialisés à la chaîne `"0"` : `business-equity/forms.tsx:2188` et
`business-equity/views.tsx:1021`. Le comportement décrit par le plan (saisir `15000` produit
`015000`) découle de cette initialisation combinée à un champ contrôlé.

Aucune primitive de saisie n'existe : les 252 champs sont des `<input>` nus, chacun avec sa propre
gestion d'état.

### 1.3 Le langage technique visible

102 occurrences de `NOT_COMPUTABLE` ou de la chaîne « Non calculable » dans 19 fichiers de
composants. La concentration confirme le constat 5.6 du plan :

| Fichier                           | Occurrences |
| --------------------------------- | ----------- |
| `investments/page.tsx`            | 19          |
| `goals/page.tsx`                  | 10          |
| `real-estate/page.tsx`            | 8           |
| `imports/portfolio-section.tsx`   | 8           |
| `imports/liasse-section.tsx`      | 8           |
| `pages/shared.tsx`                | 7           |
| `imports/public-data-section.tsx` | 7           |
| `business-equity/views.tsx`       | 7           |
| autres (11 fichiers)              | 28          |

La source est `src/components/pages/shared.tsx:63` : `export const NOT_COMPUTABLE = "Non calculable"`,
utilisée comme valeur de repli par `formatEur`, `OptionalCurrency`, `formatNativeOptional`, et
dupliquée en littéral dans `src/components/ui.tsx:33` et `:45`.

`src/components/ui.tsx:54-62` rend les six valeurs de `DataKind` en ANGLAIS : `Actual`,
`User assumption`, `Model assumption`, `External`, `Derived`, `Missing`. Ce sont des codes internes
à peine déguisés, dans une interface dont le plan exige qu'elle soit entièrement française.

46 sites rendent directement dans du JSX une expression dont le nom se termine par `reason`, `code`,
`status`, `kind`, `quality` ou `blocker` : la valeur affichée est donc la valeur d'union
`SCREAMING_SNAKE_CASE` du moteur. Aucun traducteur central n'existe.

Les huit états utilisateur de la section 6.3 du plan (disponible, partiel mais utile, inconnu non
essentiel, inconnu activable, inconnu bloquant, déclaré absent, conflit de sources, erreur système)
n'ont aucune représentation dans le code : la seule distinction disponible aujourd'hui est
« valeur ou `null` », et `null` est rendu par une chaîne unique.

### 1.4 Les tokens CSS

`src/app/globals.css` compte 3 442 lignes et définit 26 variables sur `:root`, redéfinies pour
`:root[data-theme="dark"]`.

Trois variables sont utilisées sans être définies :

| Variable      | Sites                                         | Gravité                                                                                                                                   |
| ------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `--muted`     | `globals.css:3337`, `:3353`, `:3370`, `:3398` | Bug réel : aucun repli, la déclaration `color` est invalide et la couleur héritée s'applique                                              |
| `--font-mono` | `globals.css:3374`                            | Repli `monospace` déclaré, dégradation silencieuse mais fonctionnelle                                                                     |
| `--accent`    | `globals.css:3428`                            | Repli `#2f6f62` déclaré, mais cette couleur n'appartient à aucun token de la palette : c'est une couleur orpheline sur un anneau de focus |

`--text-muted` existe et porte exactement l'intention de `--muted`. Les quatre sites sont donc une
faute de frappe propagée, pas un token manquant à créer.

### 1.5 L'état global et le couplage

`src/app/(workspace)/page.tsx` et `src/app/(workspace)/[section]/page.tsx` appellent tous deux
`repository.getDashboardState()` puis passent l'état entier à `AppShell`. Les 18 sections du produit
sont donc servies par un unique modèle de lecture.

`src/lib/types.ts:818` déclare `DashboardState` avec plus de 60 champs couvrant comptes, positions,
portefeuille, immobilier, sociétés, carrière, fiscalité, timeline, dettes, transactions, clôtures,
scénarios, objectifs, décisions, documents et hypothèses.

Ce constat est confirmé et il n'est PAS traité par cette phase : découpler les modèles de lecture
appartient au refactor habilitant de chaque phase de domaine, section 36 étape 3. La phase 0 ne doit
pas y toucher, mais elle ne doit rien faire qui renforce le couplage.

### 1.6 La taille des composants

21 238 lignes de TSX. Sept fichiers dépassent la recommandation de 400 lignes de la section 13 par
plus du double :

| Fichier                        | Lignes |
| ------------------------------ | ------ |
| `business-equity/forms.tsx`    | 2 358  |
| `business-equity/views.tsx`    | 1 539  |
| `real-estate/page.tsx`         | 1 291  |
| `cash-flow/page.tsx`           | 1 176  |
| `investments/page.tsx`         | 925    |
| `imports/registry-section.tsx` | 916    |
| `scenarios/page.tsx`           | 900    |

15 déclarations distinctes de `Intl.NumberFormat` réparties sur 12 fichiers : le formatage monétaire
est réimplémenté domaine par domaine. Ces fichiers sont hors périmètre de la phase 0 sauf pour ce
qui concerne la saisie et la traduction.

### 1.7 Les primitives et les tests

`src/components/ui.tsx` compte 274 lignes et expose 11 primitives : `Currency`, `Percent`,
`DataBadge`, `SectionHeader`, `MetricCard`, `ProgressBar`, `Callout`, `Modal`, `Explanation`,
`ExplanationPanel`, `EmptyState`. Aucune n'est un champ de saisie.

`src/lib/presentation/` existe déjà avec quatre modules : `today-cockpit.ts`, `timeline-view.ts`,
`historical-closes.ts`, `scenario-view.ts`. La couche est donc amorcée et doit être étendue, pas
créée.

97 fichiers de test. `vitest.config.ts` déclare `environment: "node"` et
`include: ["src/**/*.test.ts", "scripts/**/*.test.ts"]`. Aucun fichier `.test.tsx` n'existe, et ni
`jsdom` ni `@testing-library/react` ne figurent dans les dépendances. Le critère de phase « effacer
un montant ne produit jamais zéro » est donc intestable en l'état : il porte sur un comportement de
rendu et de clavier.

### 1.8 Décisions KEEP / REUSE / EXTEND / DEPRECATE / REPLACE

| Objet                                       | Décision            | Motif                                                                                            |
| ------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `AS_OF_DATE` comme constante exportée       | REPLACE             | Une constante ne peut pas porter trois rôles ; elle devient un contexte à trois champs nommés    |
| `ledgerWindowStart(asOfDate)`               | KEEP                | La fonction est correcte : elle prend déjà sa date en paramètre, seul son défaut est fautif      |
| `REPORTING_CURRENCY`                        | KEEP                | Hors périmètre et non fautif                                                                     |
| `inputNumber`                               | REPLACE             | `Number("")` valant zéro est le défaut central de la phase ; le remplaçant renvoie `null`        |
| Champs `<input>` nus                        | EXTEND              | Les primitives sont créées en phase 0 ; leur adoption page par page suit chaque phase de domaine |
| `NOT_COMPUTABLE` comme chaîne d'affichage   | DEPRECATE           | Reste un état du moteur, cesse d'être un libellé ; la surface consomme le traducteur             |
| `Currency`, `Percent`                       | EXTEND              | Gardent leur formatage, délèguent le rendu de l'absence au traducteur                            |
| `DataBadge`                                 | REPLACE             | Six libellés anglais remplacés par la traduction française du registre de langage                |
| `src/lib/presentation/`                     | EXTEND              | Couche déjà existante et correctement placée                                                     |
| `src/components/ui.tsx`                     | KEEP                | Les 11 primitives restent ; les primitives de saisie vont dans un module distinct                |
| `var(--muted)`                              | REPLACE             | Faute de frappe pour `--text-muted`, quatre sites                                                |
| `var(--accent, #2f6f62)`                    | REPLACE             | Couleur orpheline sur un anneau de focus, remplacée par un token de la palette                   |
| `var(--font-mono, monospace)`               | KEEP                | Repli valide ; le token sera défini avec la typographie de la phase 1                            |
| `getDashboardState()`                       | KEEP en phase 0     | Le découplage appartient au refactor de chaque phase de domaine                                  |
| `deriveMetrics()`                           | KEEP sans extension | Dette connue ; la phase 0 ne crée aucun KPI depuis cette seconde vérité                          |
| `vitest.config.ts` en `environment: "node"` | EXTEND              | Un second projet en environnement `jsdom` s'ajoute, l'existant reste inchangé                    |

## Étape 2 : clean ciblé

Le clean est strictement limité au périmètre. Aucun nettoyage global non lié n'est lancé.

1. `--muted` remplacé par `--text-muted` sur les quatre sites de `globals.css`.
2. `var(--accent, #2f6f62)` remplacé par un token de la palette existante sur l'anneau de focus.
3. Les deux littéraux « Non calculable » de `src/components/ui.tsx` cessent d'être écrits en dur et
   passent par le traducteur.
4. Les six libellés anglais de `DataBadge` sont supprimés au profit du registre de langage.
5. Les deux `useState("0")` de Business Equity sont ramenés à l'absence, conformément à la
   section 18.3 : « aucun nombre prérempli à zéro ».

Ne sont PAS nettoyées en phase 0, et sont consignées comme dette de périmètre :

- les 15 déclarations de `Intl.NumberFormat` : leur consolidation touche 12 fichiers de domaine, donc
  12 phases ;
- les 7 composants de plus de 800 lignes : leur découpage est le refactor habilitant de leur phase ;
- les 3 442 lignes de `globals.css` : leur découpage par primitives appartient à la phase 1.

## Étape 3 : refactor habilitant

Aucun moteur n'est modifié. Trois modules nouveaux, tous purs.

```text
src/lib/
  financial-date.ts        contexte de date à rôles nommés (today, asOfDate)
src/lib/presentation/
  language/
    index.ts               traducteur central des états et raisons
    states.ts              les huit états utilisateur de la section 6.3
    data-kind.ts           les six DataKind en français
  registry/
    contracts.ts           PageManifest, ObjectiveManifest, FieldDefinition, KpiDefinition
    kpis.ts                registre des KPI
    objectives.ts          registre des objectifs
    pages.ts               les 14 manifestes de page
    validate.ts            les six refus de la section 39
src/components/primitives/
  money-input.tsx
  percent-input.tsx
  date-input.tsx
  optional-number-input.tsx
  parse.ts                 fonctions pures de lecture de saisie, testables sans rendu
```

`src/lib/presentation/` ne recalcule aucune finance. Elle traduit des résultats de moteur en
décisions d'affichage, et elle refuse d'afficher ce qu'elle n'a pas compris.

`financial-date.ts` est en revanche à la RACINE de `src/lib/` et non dans `presentation/` : le
repository et les schémas de validation en sont consommateurs, et une couche de données qui importe
une couche de présentation inverserait l'architecture de la section 2 de la constitution. Le module
est pur et ne dépend que des utilitaires de date déjà présents dans les moteurs.

## Étape 4 : contrat de la phase 0

Quatre arbitrages étaient indéterminés dans le plan. Ils ont été tranchés par le propriétaire du
produit le 7 septembre 2026, et ils sont consignés ici comme décisions, pas comme hypothèses.

### D1 : origine de la date financière

**Décision : clôture persistée, sinon aujourd'hui. Aucune migration.**

```text
today          = horloge serveur, fuseau Europe/Paris, date civile
asOfDate       = date de la dernière clôture mensuelle persistée
                 = today si aucune clôture n'existe
reportingPeriod = mois calendaire de asOfDate
timezone       = "Europe/Paris"
```

Conséquences assumées :

- R1 (date de reporting) est servi par `asOfDate`, qui reste immuable tant qu'aucune clôture plus
  récente n'est persistée : l'exigence 5.1 « la date de clôture reste immuable dans un rapport » est
  tenue ;
- R2 (date opérationnelle) est servi par `today` : l'écran cesse d'annoncer le 19 août 2026 ;
- les valeurs dépendant de `asOfDate` changeront le jour où une clôture plus récente sera
  persistée. Ce n'est pas une modification de calcul : c'est le calcul existant appliqué à une date
  déclarée au lieu d'une date gelée dans le code. Aucune formule, aucun seuil, aucune convention de
  moteur n'est touché ;
- aucune colonne n'est ajoutée à `profiles`. Le pilotage explicite de la date de référence par
  l'utilisateur appartient à la page Settings, section 34, phase 10.

Un point reste non résolu et n'est pas comblé par une supposition : les écritures de
`supabase-repository.ts:2549`, `:2580` et `:2871` datent une persistance. Elles reçoivent `today`,
parce qu'une écriture constate un acte au moment où il est fait, pas à la date d'arrêté d'un
rapport. Ce choix est explicite et signalé ici pour la revue.

### D2 : les dates fabriquées

**Décision : corriger maintenant, sans propager un nullable dans le typage.**

L'implémentation a montré qu'aucun drapeau de provenance n'était nécessaire, et qu'aucun typage ne
devait changer : les types autorisaient DÉJÀ l'absence. `Liability.balanceDate` et
`Position.valuationDate` sont déclarés optionnels dans `src/lib/types.ts`, et `balance-sheet.ts:295`
comme `real-estate.ts:846` lisent déjà `liability.balanceDate ?? …`. Le typage était donc plus
honnête que la couche de données : c'est le repository qui remplissait un champ qu'il avait le droit
de laisser vide.

Les quatre sites se répartissent en trois cas distincts, et les traiter identiquement aurait été une
erreur :

| Site                             | Cas réel                                                                                                                                                    | Correction                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `:533` solde de compte           | `finiteNumber(balance?.balance, …)` refuse déjà la ligne juste au-dessus : la branche de repli est du CODE MORT                                             | Le refus devient explicite, les branches mortes sont supprimées          |
| `:575` valorisation de position  | Idem, et la même branche fabriquait aussi une DEVISE (`REPORTING_CURRENCY`)                                                                                 | Idem : un titre en dollars ne peut pas être rendu avec un symbole euro   |
| `:814` solde de dette            | Réellement atteignable : `liabilities.current_balance` est `not null` alors que `liability_balance_observations` est une table arrivée plus tard            | Le champ optionnel est simplement OMIS quand aucune observation n'existe |
| `:238` `createdAt` d'un objectif | `goals.created_at` et `goals.updated_at` sont `not null default now()` : leur absence signale une chaîne de migrations incomplète, pas une donnée manquante | `requiredField` lève, comme partout ailleurs dans le fichier             |

Un repli écrit comme une tolérance mais jamais atteint est plus dangereux qu'un refus : une
relecture y voit une permission, et la première fois que la branche devient atteignable elle
fabrique une donnée. Les deux branches mortes sont donc supprimées et non conservées.

### D3 : périmètre des registres

**Décision : contrats, gates CI, et les 14 manifestes de page complets dès la phase 0.**

Les 14 manifestes sont ceux des sections 20 à 33 du plan : Aujourd'hui, Patrimoine, Flux, Placements,
Dette, Immobilier, Carrière, Entreprises, Fiscalité, Objectifs, Scénarios, Décisions, Sources,
Rapports. Settings (section 34) et Beyonder (section 35) quittent la navigation principale et ne sont
pas des manifestes de page.

Ce que les manifestes portent en phase 0 : la question principale, l'ordre des zones, les KPI
essentiels, les objectifs autorisés, les états supportés, la règle Réel/Simulation, la stratégie
d'affichage. Ils sont TRANSCRITS du plan, ils ne sont pas inventés : la section 16 interdit à une IA
de décider quelles sections apparaissent ou quels KPI sont prioritaires.

Ce que les manifestes ne portent pas en phase 0 : aucun composant, aucun rendu. Un manifeste est une
donnée, et la phase 0 ne branche aucune page dessus. Le branchement est le travail de chaque phase de
domaine, qui revoit son manifeste avant d'implémenter sa page comme l'exige la section 39.

### D4 : infrastructure de tests composants

**Décision : ajouter `jsdom` et `@testing-library/react` en phase 0.**

Motif : le critère « effacer un montant ne produit jamais zéro » porte sur un comportement de rendu
et d'événement clavier. Un test de fonction pure sur `parseMoney` ne le prouve pas, parce que le bug
constaté naît de la combinaison d'un champ contrôlé et d'un état initialisé.

Deux projets vitest coexistent : le projet `node` existant reste inchangé et garde ses 97 fichiers,
un projet `dom` s'ajoute pour les `*.test.tsx`.

### Critères d'acceptation de la phase

| Critère                                                          | Preuve attendue                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| La surface n'affiche plus le 19 août 2026 comme aujourd'hui      | `AS_OF_DATE` n'est plus exportée ; test du contexte de date                      |
| Aucune date fabriquée                                            | Les quatre sites de R3 ne référencent plus de date de repli ; test de repository |
| Effacer un montant ne produit jamais zéro                        | Test composant clavier : saisir puis effacer rend `null`, jamais `0`             |
| Aucun zéro prérempli                                             | Aucun `useState("0")` sur un champ monétaire                                     |
| Les codes techniques ne sont plus visibles hors détail technique | Gate de texte sur les surfaces principales                                       |
| Les manifestes existent et sont valides                          | Les six refus de la section 39 s'exécutent en test                               |
| Aucun calcul financier modifié                                   | `src/lib/engine/` inchangé au diff ; les 97 fichiers de test existants passent   |
| Aucune migration                                                 | `supabase/migrations/` inchangé, 44 fichiers                                     |

### Ce que la phase 0 ne fait pas

- elle ne regroupe pas la navigation en six entrées : c'est la phase 1 ;
- elle n'installe ni `WorkspaceShell`, ni rail de sources, ni inspecteur : c'est la phase 1 ;
- elle ne remplace pas les 252 champs `<input>` du produit : chaque phase de domaine adopte les
  primitives dans son périmètre ;
- elle ne masque aucune carte « Non calculable » d'une page de domaine : requalifier les 102
  occurrences relève de la composition de chaque page, donc de sa phase ;
- elle ne découple aucun modèle de lecture de `getDashboardState()` ;
- elle ne touche ni Supabase Auth, ni `OWNER_USER_ID`.

## Étape 5 : implémentation

Cinq lots, dans cet ordre, chacun avec ses gates verts avant le suivant.

### Lot 1 : la date financière

`src/lib/financial-date.ts` remplace la constante par un contexte à rôles nommés. Les 21 usages
du repository sont reclassés UN PAR UN, pas remplacés en bloc : fenêtre de ledger, année fiscale
et règles fiscales en vigueur sur `today` ; contextes de domaine, bilan canonique, ledger et
analytics portefeuille, immobilier, Business Equity et métriques de flux sur `asOfDate` ; les
trois écritures sur `today`, parce qu'une écriture constate un acte au moment où il est fait.

Deux conséquences non prévues par le plan sont apparues à l'implémentation :

1. `mutations.ts` bornait deux saisies à la constante. Le lendemain de l'arrêté, toute date de
   fait Business et toute déclaration de couverture de ledger étaient donc REFUSÉES. Le produit
   devenait inutilisable le jour suivant sa clôture.
2. Le seul test en échec, `ledger-coverage.test.ts`, affirmait le refus du 20 août 2026. Il
   prouvait le bug au lieu de l'invariant. Ses bornes se dérivent maintenant du jour courant, de
   sorte qu'il ne périme plus.

### Lot 2 : la saisie

`src/lib/presentation/input-parse.ts` rend un résultat DISCRIMINÉ, et quatre primitives
(`MoneyInput`, `PercentInput`, `DateInput`, `OptionalNumberInput`) distinguent la valeur
committée, la chaîne en cours d'édition et le résultat de lecture. C'est l'absence de cette
distinction qui produisait le `015000` du constat 5.2.

Les 24 appels d'`inputNumber` ont été corrigés un par un, TypeScript ayant servi à les trouver.
Trois fabrications de zéro étaient réellement atteignables :

- un rendement annuel effacé partait à `Number("") / 100`, donc un rendement DÉCLARÉ à 0 %, et la
  trajectoire projetée s'aplatissait sans alerte ;
- une priorité d'objectif vide devenait `Math.max(1, Math.trunc(0))`, donc priorité MAXIMALE, et
  l'objectif remontait en tête du cockpit ; une cible vide devenait un objectif de 0 € atteint
  d'office ;
- `eventForm.amount ? … : 0` écrivait le zéro en clair.

`optionalNumber` de Business Equity était une TROISIÈME convention de lecture, qui acceptait
`1e5` et confondait illisible avec vide. Elle délègue désormais à la lecture unique.
`isRealCalendarDate` était dupliquée dans la validation : deux définitions, c'est un champ qui
accepte ce que l'écriture refuse.

### Lot 3 : le langage

`src/lib/presentation/language/` porte les huit états de la section 6.3, leur comportement, la
taxonomie d'inbox à quatre familles, les six natures de donnée en français et 172 traductions de
codes de réserve.

Le registre est construit sur la source AUTORITATIVE et non sur une heuristique. Une première
extraction par proximité du mot `blockers` rendait 284 candidats dont la moitié étaient des
membres d'unions de domaine (`RENT_RECEIPT`, `REVENUE_MULTIPLE`, `MODEL_ASSUMPTION`) : les
traduire comme des réserves aurait fait passer une valeur normale pour un problème.

Business Equity portait DÉJÀ son traducteur français, `business-equity-explain.ts`, et il fait
mieux : il résout un identifiant de société en NOM et date le motif. Ses 59 codes ont donc été
RETIRÉS du registre après y avoir été écrits, et ses unions sont exclues du gate avec leur motif.
Deux libellés concurrents pour le même code, sans que rien ne dise lequel fait foi, aurait été
pire que l'absence de traduction.

### Lot 4 : les registres

Les quatre contrats de la section 39, les quatorze manifestes de page, 48 KPI et 44
objectifs. Ces trois nombres se lisent à leur source, `pages.ts`, `kpis.ts` et
`objectives.ts` : la constitution du dépôt rappelle qu'un compte écrit de mémoire dérive,
et la section 5 de `CLAUDE.md` en porte trois exemples.
Le registre des champs reste VIDE : la section 39 place les `FieldDefinition` « avant
l'implémentation d'une page », donc dans la phase du domaine.

### Lot 5 : les gates et le volet technique

Six sites rendaient une empreinte en clair, dont les bandeaux d'Aujourd'hui et de Beyonder, les
deux pages les plus consultées. Aujourd'hui rendait en outre `kind.replaceAll("_", " ")`, ce qui
donnait « MODEL ASSUMPTION » : un code dont on a retiré la ponctuation n'est pas devenu du
français. La même bande mélangeait DEUX taxonomies distinctes, la nature de la donnée et le
niveau de preuve, comme si elles n'en formaient qu'une.

`TechnicalDetails` est le volet prévu par le constat 5.4 : replié par défaut, copiable,
`monospace`. Il est le SEUL endroit exempté du gate de contenu, et l'exemption est nominative.

## Étape 6 : validation

| Gate                 | État                                                            |
| -------------------- | --------------------------------------------------------------- |
| `npm run lint`       | vert                                                            |
| `npm run test`       | vert, 1 966 tests dans 106 fichiers, dont 27 tests composants   |
| `npx tsc --noEmit`   | vert                                                            |
| `npm run build`      | vert                                                            |
| `npm run gate:local` | non requis : le périmètre DB est inchangé (section 36 étape 6)  |
| `npm run db:verify`  | non requis, et hors environnement d'agent en tout état de cause |

Les quatre gates ajoutés par cette phase tournent dans `npm run test`, donc dans `npm run check`
sans modification de script :

| Gate                      | Ce qu'il refuse                                                           |
| ------------------------- | ------------------------------------------------------------------------- |
| `language.test.ts`        | un code de réserve déclaré sans traduction, et une traduction morte       |
| `registry.test.ts`        | les cinq refus vérifiables de la section 39, plus trois contrôles croisés |
| `surface-content.test.ts` | une empreinte, un UUID ou un identifiant rendu comme texte                |
| `money-input.test.tsx`    | qu'effacer un montant produise un zéro                                    |

Chacun est prouvé sur un cas construit exprès, et pas seulement sur les registres livrés : une
règle qui ne trouve rien peut être verte parce qu'elle est correcte, ou verte parce qu'elle ne
cherche pas. Le contrôle de contenu a d'ailleurs été corrigé par son propre test, qui a révélé
qu'il manquait `<p>Empreinte : {…}</p>`, c'est-à-dire le motif exact que la page Rapports
portait.

### Limites connues des gates, écrites plutôt que découvertes plus tard

- le gate de traduction lit les unions de réserve DÉCLARÉES. Les moteurs qui poussent leurs codes
  en littéraux sans type nommé (bilan canonique, analytics portefeuille, cash-flow, carrière,
  modèle mensuel) y échappent. `translateIssues` les couvre à l'exécution en traitant tout code
  inconnu comme un incident. Faire déclarer leur union à ces moteurs fermerait la brèche, mais
  reviendrait à modifier `src/lib/engine/`, hors périmètre ;
- le contrôle de contenu est LEXICAL et non syntaxique : il ne suit pas une variable
  intermédiaire, et il ne lit pas le rendu réel. Un contrôle exact demanderait de monter les
  pages avec un état complet, ce qui est le travail de la recette de la section 41 ;
- le sixième refus de la section 39, « une section générée dynamiquement hors manifeste », n'est
  pas vérifiable tant qu'aucune page n'est branchée sur son manifeste. `unverifiableRules()` le
  NOMME plutôt que de le taire : un gate silencieux sur une règle donne l'illusion qu'elle est
  tenue.

## Étape 7 : revue indépendante

À conduire par un autre agent sur le SHA exact de la branche, avec pour mandat explicite de vérifier
qu'aucun moteur n'a été simplifié et qu'aucun calcul n'a changé.

## Étape 8 : rapport et décision

Le verdict `READY / NOT READY` de cette phase est rendu en fin de branche, et le gate de la
section 42 reste la décision du propriétaire du produit, pas celle d'un agent.
