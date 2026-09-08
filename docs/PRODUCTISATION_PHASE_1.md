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
