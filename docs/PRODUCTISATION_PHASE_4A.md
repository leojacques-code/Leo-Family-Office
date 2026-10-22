# Phase 4A : poste de travail Patrimoine

Rapport de phase au format du §36 étape 8 du plan de refonte. Base `origin/main` au SHA
`bd1782c`, merge de #49.

Périmètre volontairement réduit à Patrimoine. Le §37 met Net Worth et Cash Flow dans la même
phase 4 ; les livrer ensemble serait la « grande PR de redesign transversal » que le §11 refuse,
et laisserait Cash Flow indisponible pour la branche Debt en cours. Arbitrage acté par le
propriétaire du produit avant écriture de la moindre ligne.

## 1. État initial

`src/components/pages/net-worth/page.tsx`, 12 Ko, rendait dans la zone C : un `SectionHeader`
intitulé « Net Worth », une `metrics-grid four` de quatre `MetricCard`, un `Callout` de
périmètre, un `ConversionNotice`, deux `AccountTable` et une liste de dettes.

Cinq constats, tous vérifiés dans le code avant modification et gelés par des tests de
caractérisation au commit `1a7c178`.

| #   | Constat                                                                         | Nature                     |
| --- | ------------------------------------------------------------------------------- | -------------------------- |
| 1   | Second en-tête doublant la zone A, titre en anglais                             | Usage                      |
| 2   | Grille générique de KPI comme visuel principal                                  | Usage, §29 critères 2 et 6 |
| 3   | Action primaire déclarée « Ajouter un actif ou un passif » non servie           | Usage                      |
| 4   | Immobilier et sociétés détenues absents de l'écran, présents au bilan canonique | **Vérité**                 |
| 5   | Répartition et évolution depuis clôture jamais rendues, moteurs présents        | **Vérité**                 |

Le constat 4 est le plus grave : `canonicalBalanceSheetOf` injecte les contributions
`REAL_ESTATE` et `BUSINESS_EQUITY`, et la page qui répond à « que possédé-je réellement »
n'affichait que comptes bancaires et comptes titres. Un utilisateur détenant un bien et une
société lisait un patrimoine amputé sans qu'aucune réserve ne le signale.

## 2. Décisions par composant

| Composant                                                                       | Décision                                     | Motif                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `SectionHeader` de la page                                                      | REPLACE                                      | Double la zone A ; titre anglais                          |
| `metrics-grid four`                                                             | REPLACE                                      | §29 critères 2 et 6                                       |
| `AccountTable`                                                                  | KEEP, déplacé derrière « Analyse détaillée » | §28 ; l'information ne se perd pas                        |
| `ConversionNotice`, `Callout` de périmètre                                      | KEEP                                         | Déjà honnêtes, déjà français                              |
| `Modal` + `requiredNumberInput`                                                 | REPLACE par `FinancialDrawer` + `MoneyInput` | §7 et §29 critère 8 ; trois états de saisie               |
| `canonicalLineInput`, `allocationExplanation`, `issueSummary`, `AggregateValue` | REUSE                                        | Vérités de présentation déjà livrées                      |
| `buildCloseChange`                                                              | REUSE                                        | Vérité unique de l'évolution, déjà servie par Aujourd'hui |
| `accountGroupTotal`                                                             | EXTEND vers `lineGroupTotal`                 | Une seule convention d'agrégation de lignes               |

## 3. Ce qui a été construit

### 3.1 Modèle de lecture, `src/lib/presentation/net-worth-view.ts`

Fonction pure. Aucun taux de change résolu, aucun solde natif resommé, aucune quote-part
appliquée : celle de l'immobilier et des sociétés est DÉJÀ portée par leurs contributions.

Cinq familles d'actif et trois groupes de passif, partitionnés par premier match, le dernier
bucket servant de filet : une contribution d'un domaine futur n'y disparaît pas en silence. Le
bouclage est VÉRIFIABLE et vérifié : la somme des familles doit redonner l'agrégat canonique, et
un écart s'affiche comme incident, parce qu'aucun total ne le dirait.

`lineGroupTotal` devient la convention unique d'agrégation d'un groupe de lignes converties.
Elle remonte les DEUX causes d'un montant absent, taux de change et réserve de valorisation, là
où `accountGroupTotal` ne remontait que la première : une quote-part non déclarée disparaissait
derrière un « non calculable » sans motif.

### 3.2 Canvas, `balance-canvas.tsx`

`ACTIFS − DETTES = PATRIMOINE NET`. La hauteur d'une famille encode son montant, et les deux
colonnes partagent une base de proportion : sans elle, 16 745 € de dette et 334 200 € d'actifs
se dessineraient à hauteur comparable.

HAUTEUR INCONNUE ≠ HAUTEUR NULLE. Une famille sans montant convertible devient une zone
détourée, de hauteur fixe et visiblement non mesurée, comme le §22 de V10 l'exige. Un zéro
DÉCLARÉ garde sa hauteur de zéro. La distinction est testée dans les deux sens. Une part en
pourcentage n'est rendue que si son dénominateur est calculable.

### 3.3 Panneaux secondaires, `insights.tsx`

Trois panneaux compacts, chacun disant ce qu'il NE couvre pas.

La composition ventile les seuls actifs financiers, périmètre de bouclage du KPI
`asset_allocation`, et l'écrit. Une enveloppe dont l'exposition n'est pas fiable est signalée,
jamais inventée.

L'évolution rend ses causes poste à poste, ou sa réserve. Jamais un écart approximatif : le §9
refuse toute variation dont les deux clôtures ne sont pas comparables, et il n'y a rien à saisir
pour rendre comparables deux périmètres qui ont changé.

La détention déclare que l'immobilier et les sociétés entrent déjà pondérés, et que les comptes
financiers entrent EN TOTALITÉ faute de quote-part dans le modèle de données.

### 3.4 Condition de clôture, `monthlyCloseReadiness`

Elle était un `throw` du repository. La surface ne pouvait que la deviner : un bouton actif sur
un bilan incomplet provoquait une erreur AU CLIC sans nommer ce qui manquait. Elle est déclarée
une fois, dans les vues du bilan canonique, et le repository comme l'écran la lisent au même
endroit. La liste des agrégats requis est celle des colonnes que la RPC reçoit et que les
comparaisons relisent. `ready` se lit sur les VALEURS et non sur la longueur des réserves.

### 3.5 Tiroir d'actif, `asset-drawer.tsx`

`FinancialDrawer` et `MoneyInput`. Trois états distingués : vide, illisible, zéro DÉCLARÉ. Le
message de formulaire les distingue aussi, car il disait « champ vide » sur une saisie portant
« abc ». Une mise à jour n'hérite pas du solde connu : la valeur saisie est une nouvelle
observation. Un solde négatif est accepté, et le tiroir annonce ce qu'il devient.

## 4. Invariants tenus

- `NULL ≠ ZERO` : une famille sans montant n'a pas de hauteur ; un champ vide n'est pas un
  solde nul ; une saisie illisible n'est pas zéro.
- `LIQUIDITÉ ≠ PATRIMOINE NET` : dit explicitement dans le panneau de détention.
- `ASSET ≠ LIABILITY` : un solde négatif devient un découvert au passif, testé.
- `DETTE CORPORATE ≠ DETTE PERSONNELLE` et aucun passif immobilier : rappelés dans
  l'inspecteur du total des dettes.
- Quote-part jamais supposée entière : la réserve du moteur remonte jusqu'au bloc, testé.
- `FX ABSENT ≠ FX ÉGAL À 1` : le motif remonte jusqu'au bloc, testé.
- Une incohérence sur une famille n'efface pas la certitude des autres, testé.

Aucun moteur financier modifié, aucune migration, aucun KPI hors registre. `lineGroupTotal` et
`monthlyCloseReadiness` sont des ajouts de LECTURE dans le module dont le rôle déclaré est
« sélectionner, grouper et soustraire des montants déjà convertis ».

## 5. Tests

| Fichier                                         | Portée                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/net-worth-view.test.ts`              | 15 cas : cinq familles, bouclage, géométrie, vide, valorisation absente, quote-part non déclarée, FX absent, zéro déclaré, découvert, quatre cas de comparabilité de clôture |
| `net-worth/__tests__/characterisation.test.tsx` | 5 cas : contrat de la zone C, dont l'atteignabilité réelle de l'analyse détaillée                                                                                            |
| `net-worth/__tests__/balance-canvas.test.tsx`   | 8 cas : proportion, zone détourée, zéro déclaré, part non rendue, évolution, sélections                                                                                      |
| `net-worth/__tests__/insights.test.tsx`         | 10 cas : ventilation, exposition non fiable, clôture disponible ou refusée avec motif, causes, détention                                                                     |
| `net-worth/__tests__/asset-drawer.test.tsx`     | 11 cas : solde vide, illisible, zéro, négatif, virgule décimale, date, devise, dialogue                                                                                      |

Suite complète : **127 fichiers, 2 180 tests**, contre 122 et 2 131 sur la base. `npm run lint`,
`npx tsc --noEmit` et `npm run build` verts. Aucune donnée personnelle dans les fixtures.

Pas de gate base de données : le périmètre ne touche pas le schéma. `npm run gate:local` et
`npm run db:verify` n'ont donc PAS été exécutés, et rien ici ne prétend le contraire.

## 6. Limites connues, à la fin de la phase

1. **L'action primaire n'est pas servie, et `PRIMARY_ACTION_DEBT` reste à 9.** Le manifeste
   déclare « Ajouter un actif ou un passif ». La moitié « passif » n'a aucun chemin d'écriture
   honnête : les seuls producteurs de passif du bilan canonique sont le découvert de compte et
   le contrat de dette, et ce dernier exige capital, taux, paiement et nombre d'échéances.
   Les réclamer pour déclarer une dette au bilan reproduirait le défaut que les remarques
   d'utilisation signalent sur Debt. Le commentaire du registre interdit par ailleurs de compter
   servie une telle action branchée sur un formulaire qui n'ajoute qu'un compte. **Décision
   attendue** : servir après la phase 3, ou changer le libellé du manifeste par décision écrite.
2. **La famille « Autres actifs » ne peut rien contenir.** Les domaines `OTHER_ASSET` et
   `OTHER_LIABILITY` existent dans le type des contributions et AUCUN producteur ne les émet.
   Un objet de collection, un portefeuille de cryptoactifs ou une créance ne sont pas
   représentables. La famille est conservée comme filet de bouclage, pas comme promesse.
3. **La quote-part n'existe pas sur un compte financier.** Arbitré hors périmètre par le
   propriétaire du produit : le patrimoine attribuable ne couvre que immobilier et sociétés, et
   la page le déclare. La migration appartient à une phase qui touche le schéma.
4. **Une création de compte ne porte pas de date d'observation.** `add_account` ne la transporte
   pas et la RPC date le solde au jour opérationnel du serveur. Le tiroir ne la demande donc pas
   et le dit ; l'étendre demande une signature de RPC, donc une migration.
5. **La géométrie n'est pas vérifiée automatiquement.** Proportions du §2 de V10, lisibilité aux
   tailles cibles et rendu mobile restent une vérification humaine. Les snapshots visuels du
   §12.2 ne sont pas outillés dans ce dépôt. Même limite qu'aux phases 1 et 2.
6. **Deux ratios que le §10 de V10 place dans l'inspecteur Patrimoine ne sont pas rendus** :
   part liquide des actifs bruts et concentration du plus gros compte. Ils ne sont pas au
   registre des KPI de la page, et le §38 exige d'une nouvelle mesure une entrée portant
   formule, source et règle d'affichage. Les rétablir demande deux entrées de registre.
7. **La dette typographique des pages reste de 152 déclarations.** `net-worth.css` n'en ajoute
   aucune sous 12 px, et les 152 restantes vivent dans `globals.css`, partagé.
8. **Cash Flow, seconde moitié de la phase 4 du §37, n'est pas commencé.**

## 7. Coexistence avec la phase 3 Debt

La branche `codex/debt-phase-3`, PR #50, était en brouillon et en cours au démarrage de cette
phase. Aucun fichier n'est commun aux deux branches : les dix fichiers de #50 sont les
composants Debt, `src/lib/acquisition/debt-schedule.ts`, `primary-action-debt.ts` et son test,
et aucun n'est touché ici. La renonciation à servir l'action primaire, motivée en §6.1 pour des
raisons de vérité, supprime au passage le seul conflit qui était prévu.

## 8. Verdict

**NOT READY** pour fusion, et la branche doit rester en brouillon. Deux décisions manquent, et
une IA ne franchit pas le gate du §42 à la place du propriétaire du produit :

- gate 4, contrat UX : le libellé de l'action primaire (limite 1) ;
- gate 7, preview : aucune revue visuelle n'a été faite sur le SHA exact.

Le reste est acquis : audit, clean ciblé, refactor habilitant, cas dégradés, invariants et
gates automatiques.
