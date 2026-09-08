# Productisation — Phase 1 : shell, navigation, canvas, inspecteur

Dossier de la phase 1 du plan de refonte (`AUDIT_PRODUIT_UX_LFO_ET_PLAN_DE_REFONTE`,
§37 ligne 1, PR UX-1 du §11). Il suit les Étapes 0 à 8 du sas obligatoire du §36.

Le contrat UX de l'Étape 4 n'est pas un fichier séparé : il est constitué du §11, du §7,
du §17 et du §10.2 du plan, et de la spécification `design_v10.md` §0 à §30 comme aide
visuelle. En cas de contradiction, LE PLAN TRANCHE — c'est la règle donnée par le
propriétaire du produit, et la section 4.3 ci-dessous en donne l'unique application.

---

## Étape 0 — Base

|                          |                                                       |
| ------------------------ | ----------------------------------------------------- |
| Branche de départ        | `claude/elegant-pascal-ao2lwq` (et non `origin/main`) |
| Commit de base           | `d963b27`, sommet de la phase 0                       |
| Base commune avec `main` | `fd42684`                                             |

La phase 0 est donc DÉJÀ dans la base : `FinancialDateContext`, les primitives de saisie,
le traducteur de langage, les registres et leurs quatorze `PageManifest`, les gates de
contenu. La phase 1 les CONSOMME et n'en réécrit aucun.

---

## Étape 1 — Audit de preuves

Chaque constat est relevé dans le code de la base, avec l'endroit où il se lit. Aucun
n'est repris du plan sans vérification : le plan décrit un état observé à sa date, et un
audit qui recopie son texte ne prouve pas que l'état est encore celui-là.

### A1 — Dix-huit destinations présentées comme équivalentes

`src/lib/navigation.ts` à `d963b27` porte 18 entrées dans une seule liste plate, séparées
par deux `break: true` purement visuels. Elles mêlent une tâche (`today`), un outil
(`advisor`), neuf domaines, trois espaces de projection, un livrable (`reports`), trois
sources et l'administration (`settings`). Constat 5.5 du plan confirmé.

### A2 — Navigation en anglais

16 des 18 libellés sont anglais : `Today`, `Net Worth`, `Cash Flow`, `Investments`,
`Debt`, `Real Estate`, `Career`, `Business Equity`, `Tax`, `Scenarios`, `Decision Lab`,
`Goals`, `Reports`, `Imports`, `Timeline`, `Settings`. `Documents` s'écrit à l'identique
dans les deux langues, `Beyonder` est un nom de produit. Le repli de `sectionLabel()`
renvoyait la chaîne `"Today"`. Critère du §11 « navigation entièrement française » non
tenu.

### A3 — Aucune des trois zones du poste de travail n'existe

`src/components/app-shell.tsx` à `d963b27` : la page reçoit `SectionContent` directement
dans `.content-area`. Il n'y a ni rail de sources, ni inspecteur, ni en-tête de domaine
portant la question dominante. Les quatorze `PageManifest` de la phase 0 existent mais
AUCUN n'est lu par le shell.

### A4 — L'explication d'un chiffre masque le chiffre

L'explication s'affichait dans `Modal` (`src/components/ui`). Une modale masque le
canvas : on ne pouvait donc pas comparer le chiffre expliqué à ce qui l'entourait, ce que
le §17 nomme « approfondir sans quitter son contexte ».

### A5 — Fil d'Ariane narratif

`<span className="breadcrumb">Léo Family Office</span>` suivi du nom de section, dans
`.topbar-left`. Le §4.1 de V10 refuse le « long breadcrumb narrative ».

### A6 — Aucun anneau de focus dans la feuille du shell

`git show d963b27:src/app/globals.css | grep -c focus-visible` → **0**. Les 3 500 lignes de
`globals.css` ne contenaient aucune règle `:focus-visible` ; seul `primitives.css`, écrit en
phase 0, en portait 4. Un utilisateur au clavier ne savait pas où il se trouvait dans la
barre latérale. Critère du §11 « états focus et dialogs accessibles » non tenu.

### A7 — La modale ne piégeait pas le focus

`Modal` gérait Échap mais ni le piège de focus ni la restitution : au clavier, la
tabulation sortait derrière le dialogue et continuait dans la page masquée, puis le focus
se perdait à la fermeture. `aria-modal` n'y change rien : il informe le lecteur d'écran que
le reste est inerte, il n'empêche pas la tabulation de l'atteindre.

### A8 — Typographie sous le plancher

Le gate écrit en Étape 5 (`src/lib/presentation/design-system.ts`), passé sur la feuille de
`d963b27`, relève **11 déclarations du périmètre shell** sous 12 px, jusqu'à 8 px
(`.busy-indicator`), et **154 dans les pages**. Le §10.2 et la mesure technique du §13
interdisent tout texte fonctionnel sous 12 px.

### A9 — Contrôles sous 40 px

`.sidebar nav a` : 35 px. `.icon-button` : 34 × 34 px. `.button` : 34 px de haut et 10,5 px
de texte. `.profile-switch` et `.logout-button` : aucune hauteur déclarée, donc une hauteur
qui dépend du libellé. Le §10.2 exige au moins 40 px.

### A10 — Aucun sélecteur Réel/Simulation

Rien dans le shell ne distingue une hypothèse d'un fait, alors que les manifestes de la
phase 0 déclarent déjà `realityModes` page par page. Le §6.4 exige que le changement
« modifie la géométrie ou le fond de la surface, pas seulement un badge minuscule ».

---

## Étape 2 — Nettoyage ciblé

Strictement les surfaces que cette phase remplace. Le §36-2 interdit le « nettoyage global
non lié », et la phase 0 a déjà coûté un commit de rétablissement (`940e41d`) pour l'avoir
oublié.

- suppression des règles `.breadcrumb`, `.topbar-left > div` et `.topbar-left strong` :
  leur balisage est retiré par cette phase (A5), et un sélecteur sans balisage se met à
  décrire un écran qui n'existe plus ;
- suppression de `.as-of` et de sa neutralisation en media query : la date est désormais en
  zone A, portée par `.workstation-date`. Garder les deux laisserait deux vérités de style
  pour une seule information ;
- retrait de la propriété `break` de `NavigationItem` : elle servait à poser un séparateur
  visuel dans la liste plate, que le regroupement remplace.

Rien d'autre n'a été reformaté : `git status` ne montre aucun fichier hors périmètre.

---

## Étape 3 — Refactor habilitant

Trois déplacements de structure, sans changement de comportement financier.

1. **`NAV_ITEMS` change de rôle sans changer de nom.** Il n'est plus ce que la barre
   latérale affiche : il est la liste que le routeur accepte. `isValidSection()`,
   `isRoutedSection()` et `ROUTED_SECTION_IDS` continuent de le lire. Le renommer aurait
   cassé le routage sans rien apporter. La barre latérale lit `NAV_GROUPS`.
2. **`useDialogFocus`** extrait l'accessibilité clavier d'une surface superposée, de sorte
   que le tiroir et l'inspecteur en mode dialogue partagent un seul comportement. Deux
   implémentations divergeraient au premier correctif.
3. **`WorkspaceShell`** reçoit le contenu de domaine en `children`. C'est ce qui permet
   d'installer le cadre SANS toucher aux quatorze compositions, que le §14 interdit de
   refaire dans une seule PR.

---

## Étape 4 — Contrat UX de la phase

### 4.1 Navigation (§7 du plan, transcrit)

Six entrées de premier niveau, dans l'ordre du parcours du §3 : suivre, comprendre,
prévoir, comparer, décider, revoir.

| Entrée      | Sous-vues                                                              | Ce qu'elle permet                     |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------- |
| Aujourd'hui | Aujourd'hui                                                            | comprendre la situation et agir       |
| Patrimoine  | Vue d'ensemble, Comptes et placements, Immobilier, Entreprises, Dettes | suivre ce que l'on possède et doit    |
| Flux        | Transactions et budget, Revenus et carrière, Fiscalité                 | comprendre l'argent qui entre et sort |
| Projets     | Objectifs, Scénarios                                                   | se projeter sans altérer le réel      |
| Décisions   | Cas à comparer                                                         | arbitrer avec des critères explicites |
| Sources     | Connexions et imports, Documents, Activité                             | alimenter et auditer les faits        |

Trois sections SORTENT de la navigation principale, sans perdre leur URL :

| Section          | Où on l'atteint  | Référence                                                  |
| ---------------- | ---------------- | ---------------------------------------------------------- |
| Analyse Beyonder | vue secondaire   | §35 : « Beyonder n'est plus une destination principale »   |
| Rapports         | action d'en-tête | §7 : « action globale Rapports et historique de clôtures » |
| Paramètres       | menu du profil   | §34 : « Settings quitte la navigation principale »         |

AUCUNE ROUTE N'EST SUPPRIMÉE. Les 18 destinations d'avant la phase répondent toujours : le
plan les DÉPLACE, il ne demande nulle part de casser des liens déjà partagés.

### 4.2 Zones (§17 du plan, §2 et §4 de V10)

| Zone                     | Contenu                                                                                                        | Géométrie                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A — en-tête opérationnel | domaine, question dominante, date et fraîcheur, sélecteur Réel/Simulation, outils, au plus UNE action primaire | hauteur maximale 88 px (§2 de V10)               |
| B — rail de sources      | sources pertinentes du domaine, avec nom, période, fraîcheur, état                                             | 2,5 à 3 colonnes sur 16                          |
| C — canvas financier     | le contenu du domaine                                                                                          | 9 à 10,5 colonnes sur 16, minimum 580 px de haut |
| E — inspecteur           | 4 à 6 faits visibles, formule, provenance, volet technique                                                     | 2,5 à 3 colonnes sur 16                          |

Budget de texte du §3 de V10, appliqué par les types : libellé de domaine 2 mots,
question 14 à 16 mots et AUCUN paragraphe explicatif dessous, titre de source 2 mots,
indication 4 mots.

### 4.3 Typographie et contrôles (§10.2 du plan) — arbitrage D1

Le §10.2 du plan et le §3 de V10 se contredisent : V10 tolère des libellés d'inspecteur à
10-11 px, le plan interdit tout texte fonctionnel sous 12 px et exige des contrôles d'au
moins 40 px. **LE PLAN TRANCHE**, par décision explicite du propriétaire du produit : « le
design md est une aide, la vérité absolue provient de l'audit ». Plancher retenu : 12 px,
contrôles 40 px.

### 4.4 Réel / Simulation (§6.4 du plan, §5 de V10)

Le mode vit dans le SHELL, il est global et persistant : passer d'un domaine à l'autre ne
doit pas faire oublier qu'on regardait une simulation. Il descend sur la RACINE du poste de
travail par `data-reality-mode`, et c'est le CSS qui transforme la surface — trame violette,
bordure en pointillés, filigrane « Simulation isolée ». Une page qui ne déclare qu'un mode
n'a PAS de sélecteur : un contrôle à une seule option ment.

### 4.5 Hors périmètre, explicitement

- les compositions des quatorze domaines : le §37 leur donne leurs propres phases, et le
  §14 interdit de « refaire toutes les pages dans une seule PR » ;
- les 152 déclarations typographiques des pages : traitées par cliquet, cf. arbitrage D2 ;
- `.button` et `.icon-button` en tant que classes partagées : redimensionnées seulement
  dans les conteneurs du shell, cf. arbitrage D2 ;
- les modèles de lecture par route et la sérialisation de `DashboardState` : mesure
  technique du §13, dont le point ouvert est tranché en 4.6 ;
- l'onboarding, Today et l'inbox : phase 2 ;
- tout moteur financier : aucun n'est modifié, aucun calcul ne change.

### 4.6 Point ouvert tranché : faut-il déjà toucher `getDashboardState()` ?

**NON, et la phase n'a pas eu à le faire.** La question devait arrêter le travail si elle se
posait en pratique. Elle ne s'est pas posée, et voici pourquoi, site par site :

- `AppShell` conserve `initialState` dans son `useState` : la forme de l'état ne change pas ;
- `SectionProps` est inchangé, donc aucune page ne voit de différence ;
- les zones du poste de travail sont des conteneurs de présentation : elles ne lisent aucun
  champ de `DashboardState` hors `asOfDate`, déjà présent ;
- `SourceRail` ne rend RIEN sans sources déclarées, et les sources d'un domaine sont
  déclarées par la phase de ce domaine : aucun nouveau modèle de lecture n'est requis ;
- `Inspector` réutilise le `setExplanation` existant, déjà passé aux pages.

Découper `getDashboardState()` en modèles de lecture par route reste une mesure technique du
§13, à faire domaine par domaine avec la page qui le consomme. L'anticiper ici aurait
mélangé un refactor de données à une PR de shell, et rendu illisible la revue visuelle.

---

## Étape 5 — Implémentation

### Fichiers créés

| Fichier                                           | Rôle                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/components/workstation/workspace-shell.tsx`  | cadre à trois zones, `data-reality-mode`, `data-with-rail`, `data-with-inspector`, `data-viewport`       |
| `src/components/workstation/source-rail.tsx`      | zone B, onze catégories concrètes closes, trois états, `null` si aucune source                           |
| `src/components/workstation/inspector.tsx`        | zone E, six faits visibles, colonne persistante ou dialogue selon la largeur                             |
| `src/components/workstation/reality-mode.tsx`     | contrôle segmenté `radiogroup`, filigrane « Simulation isolée »                                          |
| `src/components/workstation/financial-drawer.tsx` | tiroir d'édition : les formulaires n'occupent pas le canvas                                              |
| `src/components/workstation/use-dialog-focus.ts`  | piège de focus aux deux bords, Échap, restitution du focus                                               |
| `src/app/workstation.css`                         | géométrie des zones, transformation du mode simulation, points de rupture, taille des contrôles du shell |
| `src/lib/presentation/design-system.ts`           | gate du plancher typographique et de la taille des contrôles                                             |

### Fichiers modifiés

- `src/lib/navigation.ts` : `NAV_GROUPS`, `SECONDARY_SECTIONS`, `groupOfSection()`,
  `secondarySection()`, libellés français, repli LU dans la table et non recopié ;
- `src/components/app-shell.tsx` : navigation à six entrées, sous-vues du seul groupe
  courant, menu de profil, Rapports en action d'en-tête, fil d'Ariane supprimé, état de
  mode, `WorkspaceShell` autour de `SectionContent`, `Inspector` à la place de la modale
  d'explication ;
- `src/app/globals.css` : tokens `--font-mono` et `--simulation*`, 13 déclarations remontées
  à 12 px, anneaux de focus du shell, suppression des règles mortes ;
- `src/app/layout.tsx` : import de `workstation.css`.

### Réponses aux points de rupture (responsive desktop/tablette, §11)

| Largeur   | Comportement                                                     |
| --------- | ---------------------------------------------------------------- |
| ≥ 1280 px | trois colonnes, géométrie nominale                               |
| ≤ 1279 px | l'inspecteur passe SOUS le canvas                                |
| ≤ 1023 px | le rail passe sous le canvas, en liste horizontale               |
| ≤ 899 px  | une page `DESKTOP_ONLY` affiche son avis au lieu de se comprimer |

---

## Étape 6 — Validation

| Gate                 | Résultat                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `npm run lint`       | vert                                                                                         |
| `npx tsc --noEmit`   | vert                                                                                         |
| `npm run test`       | 110 fichiers, 2 009 tests, vert                                                              |
| `npm run build`      | vert                                                                                         |
| `npm run gate:local` | NON EXÉCUTÉ, et sans objet : aucune migration, aucune RPC, aucun accès base dans cette phase |

Tests ajoutés par la phase : 11 (navigation), 6 (cadre et mode), 9 (clavier et inspecteur),
9 (navigation du shell rendue), 13 (gates du système de design).

### Ce que les tests prouvent, et ce qu'ils ne prouvent pas

Ils prouvent : six entrées et pas dix-huit, aucun libellé anglais, aucune route perdue,
exclusivité groupe/secondaire, présence et absence des zones selon le manifeste, absence de
sélecteur sur une page à un seul mode, `data-reality-mode` sur la racine, filigrane en
simulation, piège de focus aux deux bords, Échap, restitution du focus, exclusion des
contrôles masqués, colonne persistante non piégée, six faits avant défilement, zéro
déclaration de shell sous 12 px, zéro contrôle de shell sous 40 px.

Ils ne prouvent PAS : la géométrie réellement rendue. Le gate du système de design lit des
DÉCLARATIONS, il ne mesure pas une boîte : il ne suit ni la cascade complète, ni la
spécificité, ni une taille héritée, ni un `transform`. Et jsdom n'a aucune mise en page —
`offsetParent` et `getClientRects()` y sont vides pour tout élément, ce qui a d'ailleurs
imposé de rendre déclaratif le filtre de visibilité du piège de focus : un garde-fou
qu'aucun test ne peut exercer ne garde rien. La vérification visuelle est la recette du §41,
et elle est humaine.

---

## Étape 7 — Revue indépendante

**ELLE N'EST PAS FAITE, ET CE N'EST PAS À L'AGENT DE L'APPROUVER.** Le propriétaire du
produit la conduit lui-même, en visuel, sur la preview. Les quatre critères du §11 à
observer :

1. la question principale de chaque espace est-elle compréhensible en cinq secondes ?
2. aucun formulaire massif au-dessus de la ligne de flottaison ?
3. la navigation est-elle entièrement française ?
4. les états de focus et les dialogues sont-ils accessibles au clavier ?

---

## Arbitrages

### D1 — Le plan tranche contre V10 sur la typographie

Décrit en 4.3. Conséquence : les libellés d'inspecteur sont à 12 px et non 10-11 px, ce qui
réduit la densité que V10 visait. C'est le prix de la lisibilité, et c'est la décision du
propriétaire du produit.

### D2 — Le plancher typographique est un CLIQUET, pas une reprise générale

Les pages portent 152 déclarations sous 12 px. Les remonter toutes changerait la densité des
quatorze domaines dans la PR du shell, ce que le §11 refuse comme « grande PR de redesign
transversal » et le §14 comme « refaire toutes les pages dans une seule PR ».

Retenu : zéro dans le périmètre du shell, et une dette de pages plafonnée par
`PAGE_TEXT_FLOOR_DEBT`, qui ne peut que décroître. Le test échoue DANS LES DEUX SENS : une
déclaration ajoutée dépasse le plafond, une déclaration corrigée demande d'abaisser la
constante. Chaque phase de domaine solde la sienne.

Même raisonnement pour la taille des contrôles : `.button` et `.icon-button` sont partagés
avec les pages, les règles de 40 px sont donc portées par les conteneurs du shell
(`.topbar`, `.sidebar`, `.inspector-header`, `.drawer-header`).

### D3 — L'inspecteur est une colonne, pas une modale

A4 le motive. Conséquence d'accessibilité : le piège de focus ne s'active QUE lorsque
l'inspecteur devient un dialogue, sur fenêtre étroite. Enfermer le focus dans une colonne
persistante empêcherait de revenir au canvas.

### D4 — Le groupe « Aujourd'hui » et sa sous-vue portent le même libellé

Le groupe et sa sous-vue unique partagent l'identifiant `today`. Leur donner deux libellés
faisait répondre `sectionLabel("today")` autre chose que ce que la barre latérale affichait :
un titre de page se contredisait avec l'entrée sélectionnée. C'est un test qui l'a trouvé,
pas une relecture.

---

## Limites connues, à la fin de la phase

1. **Aucun rail de sources n'affiche quoi que ce soit.** Le composant existe et est testé,
   mais les sources d'un domaine sont déclarées par la phase de ce domaine. Un rail qui
   afficherait « aucune source » ferait exactement la carte vide que le §6 de V10 refuse.
2. **L'inspecteur n'affiche que ce que l'explication existante contient** : libellé, valeur,
   date, formule. Provenance détaillée, correction de rattachement et édition du fait
   sélectionné sont dans le contrat du §17 et appartiennent aux phases de domaine.
3. **Les compositions des pages sont inchangées.** Le canvas reçoit le contenu tel qu'il
   existe : grilles génériques, cartes de KPI, formulaires en ligne. La « suppression
   progressive de la dépendance aux grilles génériques » du §11 commence ici et n'y finit
   pas.
4. **La dette typographique des pages reste de 152 déclarations**, dont 32 à 9 px, 29 à
   8 px et 12 à 7 px. Elle est mesurée et plafonnée, pas résorbée.
5. **`getDashboardState()` sérialise toujours tout l'état.** Mesure technique du §13, non
   traitée, cf. 4.6.
6. **La géométrie n'est pas vérifiée automatiquement**, cf. Étape 6.

---

# Complément du 8 septembre 2026 — reprise de la phase 1 sur `origin/main`

Ce complément n'efface rien de ce qui précède. Il consigne une seconde passe sur la MÊME
phase, demandée après que la première a été mergée, et il corrige les points où la première
avait laissé son résultat obligatoire incomplet.

## C.0 — Ce que la base était réellement

La phase 1 était DÉJÀ dans `main`. La PR #46, intitulée « Phase 0 » et dont la description ne
décrit que la phase 0, portait neuf commits dont les trois `feat(phase-1)` ci-dessus. Elle a
été mergée le 8 septembre 2026 à 08:44.

|                              |                                                |
| ---------------------------- | ---------------------------------------------- |
| `origin/main` au départ      | `c86b834`                                      |
| Écart branche / `main`       | 0 commit dans les deux sens                    |
| Gates sur cette base         | lint vert, `tsc` vert, 110 fichiers, 2 009 tests vert |

Conséquence de procédure : la phase 1 n'a jamais eu son propre sas §36, et son Étape 7 n'a
jamais été conduite. Le propriétaire du produit a arbitré de la COMPLÉTER EN PLACE plutôt que
de révoquer les trois commits, `main` restant la base que l'Étape 0 impose.

## C.1 — Écarts relevés dans le code mergé

Chacun est vérifié dans le code, pas repris du dossier ci-dessus.

### E1 — `SourceRail` n'était monté par aucune page

`app-shell.tsx` ne l'importait pas. Douze manifestes sur quatorze déclaraient pourtant
`SOURCE_RAIL` dans leurs zones : ils décrivaient une colonne que rien ne dessinait. La trame
V10 comptait donc DEUX zones persistantes sur trois, et le critère 3 du gate visuel du §12.3
— « les sources restent invisibles » — était rouge sur les quatorze écrans.

### E2 — `manifest.primaryAction` était ignoré

Treize manifestes sur quatorze portaient le libellé de leur action primaire. La prop
`primaryAction` de `WorkspaceShell` existait et n'était jamais passée. Le §17 déclare la zone A
« toujours présente » avec « une action primaire maximum ».

### E3 — `FinancialCanvas` n'existait pas comme module

Nommé au §10.2 dans la structure cible et listé au §11 parmi les composants de la PR UX-1. La
zone C était un `<main>` écrit en ligne dans le cadre.

### E4 — La zone E réservait sa colonne à vide

`Inspector` rend `null` sans sélection, et le cadre le passait quand même : la racine portait
donc toujours `data-with-inspector="true"`, et la grille réservait 2,75 colonnes sur 16 à un
élément inexistant. Le canvas perdait un sixième de sa largeur sur les quatorze écrans, contre
les 9 à 10,5 colonnes que le §2 de V10 lui donne. Non relevé par la première passe, et
invisible dans le DOM : seule la géométrie était fausse.

### E5 — `FinancialDrawer` n'est monté par aucune page

Constat maintenu, et non corrigé : voir C.4.

## C.2 — Arbitrage D5 : la pertinence se déclare, l'état se lit

SOURCE PERTINENTE ≠ SOURCE DÉTENUE. Le §17 veut que chaque source du rail affiche son état et
sa fraîcheur ; une page ne peut pas les DÉCLARER, puisqu'ils dépendent de ce que l'utilisateur
a fourni. Écrire l'état au manifeste aurait annoncé « À jour » sur une dette saisie à la main,
ou « À fournir » sur une comptabilité déjà importée.

`PageManifest` gagne donc `sources`, où chaque ligne déclare une catégorie, un nom, la FAMILLE
DE FAITS qui prouverait la possession, et le passage du plan qui la fonde. `rail-sources.ts`
lit la réponse dans les faits. Aucune finance n'y est calculée : ni montant, ni conversion, ni
moteur, seulement des présences et des dates que les faits portent déjà.

### D5.1 — `A_RENOUVELER` n'est jamais émis

Décider qu'un relevé est « à actualiser » suppose un seuil : trois mois, deux ans ? La
section 16 interdit de décider « si une anomalie est assez importante pour alerter », et la
section 40 range la fraîcheur parmi les couches dont les règles restent versionnées et
sourcées. Le plan n'en donne aucun. La date est AFFICHÉE, l'utilisateur juge, et un test
vérifie qu'aucun état intermédiaire ne sort même sur des faits vieux de dix ans.

### D5.2 — Le plan tranche encore contre V10 sur les catégories

Le §17 énumère « contrat, échéancier, compte, relevé, fiche de paie, liasse, FEC, acte, BAIL,
avis fiscal, VALORISATION, DOCUMENT ou donnée manuelle ». Le §6 de V10 omet les trois dernières.
Le plan tranche, comme en D1 : sans elles, le bail d'un bien loué et la valorisation d'un actif
seraient indéclarables alors que le §17 les nomme comme sources.

### D5.3 — Ce qui n'est pas prouvable n'est pas déclaré

Le §27 nomme le FEC, le registre et la cap table parmi les sources d'Entreprises. Aucun fait de
`DashboardState` ne répond « l'utilisateur détient-il un FEC ? » : les écritures vivent en base
et ne traversent pas l'état. Une ligne dont l'état serait indéterminable afficherait « À
fournir » sur une comptabilité déjà là. Elles ne sont donc PAS déclarées, et leur absence est
écrite ici plutôt que laissée à constater.

## C.3 — Arbitrage D6 : un libellé déclaré n'est pas une action servie

LIBELLÉ DÉCLARÉ ≠ ACTION SERVIE. « Importer un échéancier » n'a pas d'implémentation avant la
phase 3, « Ajouter un document fiscal » avant la phase 7 : rendre les treize libellés aurait
produit des boutons inertes, qui se présentent comme des chemins praticables sans en être. Le
cadre exige donc DEUX conditions — un libellé au manifeste et une action enregistrée par la
page — et ne rend rien sinon. Même raisonnement que le sélecteur Réel/Simulation masqué sur une
page à mode unique.

Quatre pages sont servies, celles dont le formulaire EXISTANT répond à l'intention du libellé :

| Page         | Libellé du manifeste     | Formulaire existant ouvert |
| ------------ | ------------------------ | -------------------------- |
| Objectifs    | Créer un objectif        | « Créer un objectif »      |
| Scénarios    | Créer un scénario        | « Nouveau scénario »       |
| Entreprises  | Ajouter une société      | « Nouvelle société »       |
| Flux         | Ajouter une opération    | « Ajouter une transaction » |

Neuf ne le sont pas, et la dette est plafonnée par `PRIMARY_ACTION_DEBT`. Le gate LIT LES
FICHIERS de page pour vérifier que les quatre annoncées appellent réellement le hook : sans
cela, la liste serait une intention qu'on pourrait rallonger sans rien brancher.

Trois boutons primaires quittent le canvas — Objectifs, Entreprises, Flux — parce qu'ils
déclenchaient l'action que la zone A porte désormais et que le §17 en autorise UNE. Les boutons
d'ÉTAT VIDE restent : le §11 veut qu'un profil vide obtienne un parcours d'installation.

## C.4 — Hors périmètre de ce complément, explicitement

- **Les formulaires ne migrent pas vers `FinancialDrawer`.** Le §7 de V10 dit « right drawer OR
  MODAL editor » : les quatre pages servies utilisent déjà une modale, donc aucune des deux
  sources n'exige la migration, et la faire changerait la surface de saisie de quatre domaines
  dans la PR du shell. `FinancialDrawer` reste monté par ses seuls tests.
- **L'action secondaire « Gérer les indicateurs » du §17 reste absente.** Son comportement —
  afficher, masquer, épingler — est la personnalisation du §23, que le §37 place en phase 10.
  Un contrôle permanent qui n'agirait pas serait le mensonge que D6 refuse.
- **Le sélecteur d'entité du §17 reste absent.** Le §17 le veut « seulement si plusieurs
  existent », et aucun manifeste ne déclare comment une page énumère ses entités.
- **Un clic sur une source surligne sa ligne, il ne remplit pas l'inspecteur.** Le §4.2 de V10
  le demande ; la provenance par source appartient à la phase du domaine qui la possède.
- **Les compositions des quatorze domaines, la dette typographique des pages,
  `getDashboardState()`** : inchangés, comme en 4.5.

## C.5 — Validation

| Gate                 | Résultat                                                                |
| -------------------- | ----------------------------------------------------------------------- |
| `npm run lint`       | vert                                                                    |
| `npx tsc --noEmit`   | vert                                                                    |
| `npm run test`       | 116 fichiers, 2 061 tests, vert (contre 110 et 2 009 sur la base)        |
| `npm run build`      | vert                                                                    |
| `npm run gate:local` | NON EXÉCUTÉ, et sans objet : aucune migration, aucune RPC, aucun accès base |

`git diff origin/main -- src/lib/engine` est VIDE : aucun calcul financier n'est modifié.

### Défauts trouvés par les tests écrits ici, dans du code de ce complément

1. `rail-sources.ts` faisait confiance au type de `DashboardState`, qui déclare plusieurs
   familles comme obligatoires alors que l'état réellement construit ne les porte pas toujours.
   La page tombait au lieu de répondre « À fournir » à une question qui a une réponse.
2. Le hook d'action primaire écrivait sa référence PENDANT le rendu, ce qui ne déclenche aucune
   mise à jour et se lit différemment selon l'ordre des rendus.
3. Le bouton de la zone A vivait dans `.workstation-controls`, que le gate du système de design
   ne regardait pas : sa liste de contrôles est NOMINATIVE. Le bouton le plus important de
   l'écran était le seul contrôle du shell sous 40 px et sous 12 px. La règle CSS et
   l'inscription au gate ont été ajoutées ensemble.

### Ce que les tests ne prouvent toujours pas

La géométrie réellement rendue. Le défaut E4 en est la démonstration : le DOM était correct et
seule la grille était fausse, donc aucun test de DOM ne pouvait le voir — c'est un test de
COUVERTURE DES ZONES, comparant le rendu au manifeste, qui l'a attrapé. jsdom n'a pas de mise
en page ; la vérification visuelle reste humaine.

## C.6 — Étape 7

**ELLE N'EST TOUJOURS PAS FAITE, ET CE N'EST PAS À L'AGENT DE L'APPROUVER.** Elle porte
désormais sur la phase 1 ENTIÈRE, les trois commits mergés compris, qui n'avaient jamais été
revus visuellement. Aux quatre critères du §11 déjà listés en Étape 7 s'ajoutent :

5. le rail de sources est-il lisible, et son état correspond-il à ce que vous avez fourni ?
6. l'action primaire est-elle au bon endroit sur les quatre pages qui la servent, et son
   absence est-elle acceptable sur les neuf autres ?
7. le canvas a-t-il retrouvé sa largeur, l'inspecteur n'apparaissant plus qu'à la sélection ?
