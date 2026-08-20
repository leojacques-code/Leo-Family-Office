# Questions ouvertes

Léo Family Office. Version 0.1 du 20 août 2026. Lane : Léo (Product Truth).
Base : commit `ef5bacf`.

## Usage

Une question entre ici quand elle bloque une décision et qu'elle ne se tranche pas par
la lecture du code. Elle en sort quand la réponse est écrite, datée et reportée dans le
document de référence concerné.

Règle de collaboration : n'imposez pas une convention par un commit. Une définition qui
entre dans le code sans être écrite quelque part est une dette invisible.

| Champ | Sens |
|---|---|
| BLOQUE | ce qui ne peut pas avancer tant que la réponse n'est pas donnée |
| DÉCIDEUR | qui tranche |
| ÉCHÉANCE | quand la réponse est nécessaire |
| IMPACT SI NON TRANCHÉ | ce qui se passe si on laisse courir |

### État

| ID | Sujet | Décideur | Échéance | Statut |
|---|---|---|---|---|
| Q-01 | Service de dette pendant un différé | Léo | avant toute correction du cash-flow | ouverte |
| Q-02 | Arrondi monétaire canonique | Paul, arbitrage Léo | avant de rendre la suite verte | ouverte |
| Q-03 | Convention actif ou passif d'un compte débiteur | Léo | avant l'import de comptes | ouverte |
| Q-04 | `liquidNetWorth` : implémenter ou retirer | Léo | avant la V1 | ouverte |
| Q-05 | `savingsRate` et `investmentRate` : deux métriques ou une | Léo | avant l'import de transactions | ouverte |
| Q-06 | Sémantique de `forecast_net_worth` | Léo | avant la deuxième clôture | ouverte |
| Q-07 | Confiance forcée à HIGH après édition | Léo | avant la V1 | ouverte |
| Q-08 | Projection déterministe : conserver, aligner ou supprimer | Léo | avant tout travail sur les projections | ouverte |
| Q-09 | `shockYear` : année relative ou civile | Léo | avant la V1 | ouverte |
| Q-10 | Assiette de la valeur de sortie immobilière | Paul, arbitrage Léo | avant de corriger le moteur immobilier | ouverte |
| Q-11 | Decision Lab : recommandation ou comparaison | Léo | immédiat | ouverte |
| Q-12 | Données personnelles réelles dans le dépôt | Léo, mise en oeuvre Tom | avant l'arrivée de Paul et Tom | ouverte |
| Q-13 | npm ou pnpm | Tom | avant l'arrivée de Paul et Tom | ouverte |
| Q-14 | Topologie de branches inexistante | Léo | avant l'arrivée de Paul et Tom | ouverte |
| Q-15 | Périmètre nommé « Patrimoine brut » | Léo | avec les correctifs de copie | ouverte |
| Q-16 | Clôture d'un mois déjà clos : refus ou réouverture | Léo | avant la deuxième clôture | ouverte |
| Q-17 | Barre d'acceptation V1 | Léo | avant le 24 août | ouverte |
| Q-18 | Ordre entre parité Finary et profondeur Finary+ | Léo | avant le 24 août | ouverte |

---

## Q-01 · Service de dette pendant un différé

CONTEXTE
Trois définitions coexistent dans le produit, sans qu'aucune ne soit désignée comme la
bonne :
- le moteur (`shared.ts:31`) compte 284,72 € dès la date zéro, via un filtre
  `firstPaymentDate <= "2027-08-19"` ;
- l'interface affiche ce résultat sous les libellés « Avant échéance du prêt » et
  « Disponible avant prêt », et son panneau d'explication annonce « Service de dette
  actuel : 0,00 € avant le 5 décembre 2026 » ;
- `docs/ASSUMPTIONS.md` annonce un cash-flow de +142 € par mois, soit la définition
  opposée, avec un signe opposé.

Le test `shared.test.ts` verrouille le comportement du moteur en attendant `-142,72`.
La documentation et la suite de tests sont donc en désaccord formel.

OPTIONS
- A. Le service de dette est nul avant la première échéance. Cohérent avec le business
  plan §1.2, qui exige de représenter le cas « étudiant, prêt différé, première échéance
  future ». Le cash-flow libre passe à +142 €. Il faut alors afficher séparément une
  ligne « engagement futur » pour que l'utilisateur ne découvre pas la mensualité en
  décembre.
- B. Le service de dette compte l'engagement dès qu'il est connu. Plus prudent pour le
  pilotage, cohérent avec le chiffre affiché aujourd'hui. Il faut alors corriger trois
  libellés et une ligne de documentation.
- C. Deux métriques distinctes : service exigible, et service engagé. Plus juste, plus
  coûteux, et cohérent avec la doctrine « profondeur dans le moteur, simplicité dans
  l'interface ».

Nuance apportée par le golden dataset CASE 11 : la règle ne peut pas s'énoncer « 0 avant
la première échéance ». Un différé partiel décaisse les intérêts pendant le différé. La
formulation correcte est « le paiement contractuel exigible à cette date », qui vaut 0
en différé total et les intérêts en différé partiel.

BLOQUE : correction de `deriveMetrics`, correction des libellés du cockpit, correction
de `docs/ASSUMPTIONS.md`, invariant INV-D-02, golden cases CASE 8 et CASE 11.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant toute correction du cash-flow.
IMPACT SI NON TRANCHÉ : le produit continue d'afficher un chiffre sous un libellé qui le
contredit, sur son premier écran. Paul risque d'implémenter la définition A en croyant
corriger un bug, et de casser un test qui verrouille la définition B.

---

## Q-02 · Arrondi monétaire canonique

CONTEXTE
`15571.49 - 16745` rend `-1173.5100000000002`. Le test `financial.test.ts:40` échoue sur
une comparaison stricte. C'est le seul test rouge du dépôt, et il rend `pnpm check`
rouge.

OPTIONS
- A. Arrondir à la présentation seulement. Le moteur garde la précision maximale, les
  tests utilisent des tolérances. Simple, sans effet de bord, mais les agrégats ne
  bouclent pas exactement.
- B. Arrondir dans le moteur, à chaque agrégation, en half-even sur 2 décimales. Les
  agrégats bouclent, la précision se dégrade sur les calculs itératifs comme les
  échéanciers à 240 lignes.
- C. Représenter les montants en centimes entiers. Correct, et c'est une refonte du
  modèle de données.

BLOQUE : passage de la suite au vert, invariants INV-A-01 et INV-A-02, définition des
tolérances du golden dataset.
DÉCIDEUR : Paul propose, Léo arbitre.
ÉCHÉANCE : avant de rendre la suite verte, donc avant tout autre travail sur les tests.
IMPACT SI NON TRANCHÉ : la suite reste rouge, et un échec rouge permanent finit par ne
plus être lu. C'est le pire état possible pour une base de tests.

---

## Q-03 · Convention actif ou passif d'un compte débiteur

CONTEXTE
Le compte CIC est à -3,44 €. Il est compté comme un actif de valeur négative. Le
business plan annexe A.1 note lui-même « convention actif/passif à formaliser ».

OPTIONS
- A. Actif de valeur négative. Simple, additif, conserve l'identité comptable.
- B. Passif court terme. Plus juste économiquement, impose de redéfinir `GrossAssets`
  comme la somme des soldes positifs seulement.

BLOQUE : invariant INV-A-06, définition de `GrossAssets`, export CSV.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant l'import de comptes, qui multipliera les cas.
IMPACT SI NON TRANCHÉ : 3,44 € aujourd'hui. Un découvert autorisé de plusieurs milliers
d'euros demain, avec deux écrans qui ne s'accordent pas.

---

## Q-04 · `liquidNetWorth`

CONTEXTE
La métrique vaut exactement `grossAssets - debt`, c'est-à-dire `netWorth`. La notion de
liquidité n'intervient nulle part dans son calcul. Elle porte un nom qui ne correspond
pas à ce qu'elle mesure.

OPTIONS
- A. Implémenter la définition : actifs mobilisables sous 30 jours moins dettes
  exigibles sous 30 jours. Suppose de qualifier la liquidité de chaque actif, ce qui
  suppose Q-03 tranchée et le champ `liquidity` réellement exploité.
- B. Retirer la métrique du type `DashboardMetrics`.
- C. La renommer, mais un doublon renommé reste un doublon.

BLOQUE : invariant §3.2 de `FINANCIAL_DEFINITIONS.md`, nettoyage de `DashboardMetrics`.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant la V1.
IMPACT SI NON TRANCHÉ : la métrique n'est affichée nulle part aujourd'hui, le risque est
qu'elle le soit un jour sous son nom.

---

## Q-05 · `savingsRate` et `investmentRate`

CONTEXTE
`savingsRate = freeCashFlow / monthlyIncome`, non borné.
`investmentRate = max(0, freeCashFlow) / monthlyIncome`.
Les deux mesurent le cash-flow libre, aucune ne mesure l'épargne ni l'investissement
constatés. Elles sont identiques dès que le cash-flow est positif.

OPTIONS
- A. Une seule métrique, honnêtement nommée « taux de cash-flow libre », jusqu'à ce que
  les transactions permettent de mesurer l'épargne réelle.
- B. Conserver les deux et les redéfinir sur des flux constatés, ce qui suppose l'import
  de transactions.

BLOQUE : libellés du cockpit et de la page Cash Flow.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant l'import de transactions.
IMPACT SI NON TRANCHÉ : le produit affiche un « taux d'épargne provisoire » de -11,1 %
qui ne mesure pas une épargne.

---

## Q-06 · Sémantique de `forecast_net_worth`

CONTEXTE
Le champ reçoit le patrimoine net de la clôture précédente. `variance` mesure donc une
variation entre deux mois, pas un écart au plan. L'interface promet « Écart réel vs
prévu ».

OPTIONS
- A. Renommer en `previous_net_worth` et `variation`, et corriger le texte. Sans coût,
  sans valeur ajoutée.
- B. Brancher le champ sur la projection produite avant le mois. C'est la promesse du
  business plan §14.3, et cela suppose de persister une prévision mensuelle, ce qui
  n'existe pas.

BLOQUE : invariant INV-J-03, golden case CASE 18, texte de la page Timeline.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant la deuxième clôture réelle, sinon la première variance sera fausse et
archivée.
IMPACT SI NON TRANCHÉ : le rituel mensuel, qui est un différenciant fort du produit,
mesure autre chose que ce qu'il annonce.

---

## Q-07 · Confiance forcée à HIGH après édition

CONTEXTE
`update_scenario` et `update_expense` passent `confidence` à `HIGH` à chaque
modification. Déplacer un curseur de rendement de 5,5 % à 8 % produit donc une hypothèse
de confiance élevée.

OPTIONS
- A. Conserver la confiance précédente.
- B. Demander la confiance à l'utilisateur, ce qui alourdit chaque saisie.
- C. Déduire la confiance du type : un montant saisi depuis un document est HIGH, un
  curseur de scénario est MEDIUM au mieux.

BLOQUE : invariant INV-H-04, crédibilité du registre d'hypothèses de la page Settings.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant la V1.
IMPACT SI NON TRANCHÉ : le registre affiche « confiance élevée » sur des paramètres
inventés, ce qui vide le mécanisme de confiance de son sens.

---

## Q-08 · Projection déterministe

CONTEXTE
Deux moteurs coexistent. Le déterministe capitalise annuellement et ajoute l'épargne en
fin d'année, exécuté côté client, jamais persisté. Le Monte-Carlo capitalise
mensuellement et ajoute l'épargne chaque mois, exécuté par l'API, persisté. À paramètres
identiques ils ne produisent pas la même trajectoire, et rien ne l'explique.

OPTIONS
- A. Aligner le déterministe sur le pas mensuel du Monte-Carlo. Le déterministe devient
  alors la médiane à volatilité nulle, ce qui est cohérent et vérifiable par un test.
- B. Supprimer le déterministe et afficher le P50 du Monte-Carlo sur le cockpit. Coût :
  un appel API au chargement de la page d'accueil.
- C. Conserver les deux et documenter l'écart.

BLOQUE : invariant INV-G-07, graphique du cockpit.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant tout travail sur les projections.
IMPACT SI NON TRANCHÉ : deux chiffres différents pour la même question, dans le même
produit, à deux clics d'écart.

---

## Q-09 · `shockYear`

CONTEXTE
Le champ est un entier relatif à l'année 1 de la projection. Le scénario Stress porte
`shockYear = 2`, ce qui signifie 2027 et non 2028. Le formulaire affiche « Année du
choc » sans unité.

OPTIONS
- A. Conserver l'année relative et corriger le libellé en « Année de projection du
  choc, 1 égale la première année ».
- B. Passer en année civile, ce qui impose une migration des données existantes.

BLOQUE : libellé du formulaire de scénario, description du scénario Stress.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant la V1.
IMPACT SI NON TRANCHÉ : un utilisateur place un choc à la mauvaise année sans s'en
apercevoir.

---

## Q-10 · Assiette de la valeur de sortie immobilière

CONTEXTE
`exitValue = purchasePrice × (1 + croissance)^horizon`. Les travaux ne sont pas dans
l'assiette. Sur le jeu par défaut, 15 000 € de travaux ne créent aucune valeur de
sortie. Ce n'est pas nécessairement faux, mais ce n'est pas dit.

OPTIONS
- A. Assiette égale au prix d'achat. Conservateur. À afficher comme hypothèse.
- B. Assiette égale au prix d'achat plus travaux capitalisés. Plus favorable, et discutable
  selon la nature des travaux.
- C. Paramètre explicite, avec une valeur par défaut conservatrice.

BLOQUE : invariant INV-E-04, golden case CASE 13, correction du moteur immobilier.
DÉCIDEUR : Paul propose, Léo arbitre.
ÉCHÉANCE : avant de corriger le moteur immobilier, pour ne pas corriger deux fois.
IMPACT SI NON TRANCHÉ : les projets à travaux sont systématiquement sous-évalués, sans
que l'utilisateur sache pourquoi.

---

## Q-11 · Decision Lab, recommandation ou comparaison

CONTEXTE
`compareDebtVsInvest` affiche un bandeau « Espérance ajustée supérieure » et un
« Avantage ajusté » en euros. Trois coefficients non sourcés déterminent la conclusion :
décote de risque 0,25, poids de liquidité 0,03, seuil de risque 0,15. Le moteur n'a
aucun test. Le business plan §13.1 pose la règle inverse : ne jamais conclure sur un
seul critère, exposer liquidité, risque, downside, coût d'opportunité et flexibilité.

OPTIONS
- A. Retirer le bandeau et l'avantage chiffré, ne présenter que les éléments de
  comparaison. Immédiat, sans coût, dans la zone verte.
- B. Financer les tests et exposer les paramètres. Coûteux, et c'est la bonne cible.
- C. Statu quo.

BLOQUE : rien techniquement. C'est un risque produit, pas une dépendance.
DÉCIDEUR : Léo.
ÉCHÉANCE : immédiat.
IMPACT SI NON TRANCHÉ : le produit recommande un arbitrage patrimonial sur la base de
trois coefficients arbitraires, non testés et invisibles. C'est le risque le plus élevé
du dépôt rapporté à son coût de correction.

---

## Q-12 · Données personnelles réelles dans le dépôt

CONTEXTE
Le dépôt contient l'inventaire patrimonial complet d'une personne physique identifiée :
soldes de six comptes, contenu du PEA et du CTO, capital et échéancier du prêt, revenu
net, loyer, noms des cinq établissements. Ces données sont dans
`src/lib/data/local-repository.ts`, `scripts/seed-supabase.ts` et
`src/lib/data/__tests__/shared.test.ts`. Le plan prévoit l'arrivée de deux
collaborateurs qui n'ont pas besoin de ces données pour travailler.

OPTIONS
- A. Remplacer le seed de développement par le golden dataset synthétique, et charger
  les données réelles uniquement en production. Effet de bord favorable : les tests
  cessent de dépendre du patrimoine réel.
- B. Restreindre l'accès au dépôt, ce qui contredit l'arrivée des collaborateurs.
- C. Anonymiser en conservant les ordres de grandeur, ce qui casse les réconciliations
  documentées.

BLOQUE : rien techniquement. C'est une décision de confidentialité.
DÉCIDEUR : Léo décide, Tom met en oeuvre.
ÉCHÉANCE : avant l'arrivée de Paul et Tom.
IMPACT SI NON TRANCHÉ : deux collaborateurs auront accès à un inventaire patrimonial
nominatif sans nécessité opérationnelle.

---

## Q-13 · npm ou pnpm

CONTEXTE
Le dépôt contient `package-lock.json`, produit par npm. Toute la documentation parle de
pnpm, et `README.md` recommande `pnpm install --frozen-lockfile`, commande qui échoue
faute de `pnpm-lock.yaml`. C'est le premier obstacle qu'un nouvel arrivant rencontrera.

OPTIONS
- A. npm, aligner la documentation et les scripts.
- B. pnpm, générer et versionner `pnpm-lock.yaml`, supprimer `package-lock.json`.

BLOQUE : la première commande que taperont Paul et Tom. La configuration de CI.
DÉCIDEUR : Tom, qui possède la CI.
ÉCHÉANCE : avant l'arrivée de Paul et Tom.
IMPACT SI NON TRANCHÉ : deux collaborateurs perdent leur première heure, et deux
lockfiles concurrents peuvent apparaître.

---

## Q-14 · Topologie de branches inexistante

CONTEXTE
Le plan de développement §3 et le business plan §19.1 décrivent une topologie à six
branches : `main`, `audit/financial-engine`, `integration/v1.2-hardening`,
`leo/phase0`, `finance/paul-sprint`, `platform/tom-security`. Le dépôt ne contient
aujourd'hui que `leo/phase0` et `claude/plan-de-leo-qakf68`, qui pointent sur le même
commit. Il n'existe ni `main`, ni branche d'intégration.

Conséquence directe : la règle « toutes les PR ciblent `integration/v1.2-hardening` »
n'est pas applicable, et deux collaborateurs qui commenceraient maintenant n'auraient
pas de point de convergence.

OPTIONS
- A. Créer la topologie complète avant l'arrivée de Paul et Tom.
- B. Simplifier : une branche d'intégration et deux branches de travail, sans branche
  d'audit gelée.

BLOQUE : la règle de PR, la revue croisée, l'ordre de merge.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant l'arrivée de Paul et Tom.
IMPACT SI NON TRANCHÉ : les collaborateurs travaillent sans point de rendez-vous, et le
plan du 22 août (revue des PR de Paul et Tom) est inexécutable.

---

## Q-15 · Périmètre nommé « Patrimoine brut »

CONTEXTE
L'agrégat ne contient que les actifs financiers. Ni immobilier, ni business equity, ni
autres actifs. Les tables existent et ne sont jamais lues.

OPTIONS
- A. Renommer en « Actifs financiers identifiés ».
- B. Conserver le nom et ajouter une réserve de périmètre sur chaque carte.

BLOQUE : invariant INV-A-05, libellés du cockpit et de la page Net Worth.
DÉCIDEUR : Léo.
ÉCHÉANCE : avec les correctifs de copie.
IMPACT SI NON TRANCHÉ : l'utilisateur croit son bilan exhaustif.

---

## Q-16 · Clôture d'un mois déjà clos

CONTEXTE
`create_monthly_close` fait un upsert. Reclôturer janvier écrase la ligne de janvier
sans trace. Par ailleurs `net_worth_snapshots` reçoit une insertion à chaque appel, sans
contrainte d'unicité côté SQLite : deux clics créent deux snapshots.

OPTIONS
- A. Refus strict. Une clôture existante ne peut pas être remplacée.
- B. Réouverture explicite et tracée, conservant la version précédente.

BLOQUE : invariants INV-J-01 et INV-J-04, golden case CASE 18.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant la deuxième clôture réelle.
IMPACT SI NON TRANCHÉ : perte définitive d'un point d'historique patrimonial, sans
aucune trace.

---

## Q-17 · Barre d'acceptation V1

CONTEXTE
`docs/ACCEPTANCE_CRITERIA_V1.md` propose cinq conditions pour qu'un module soit
acceptable en V1. Au commit `ef5bacf`, aucun module ne les satisfait toutes.

QUESTION : la barre est-elle la bonne, ou est-elle trop haute pour une V1 ?

BLOQUE : la définition de ce qui reste à faire avant de fusionner vers `main`.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant le 24 août.
IMPACT SI NON TRANCHÉ : Codex auditera sans critère d'acceptation partagé, et rendra un
avis sur une cible implicite.

---

## Q-18 · Ordre entre parité Finary et profondeur Finary+

CONTEXTE
`docs/FINARY_GAP_MATRIX.md` identifie cinq écarts majeurs. Le premier, l'agrégation
automatique des comptes et des transactions, est un écart de parité : sans lui, le
principe « maximum de données, minimum de saisie » est inversé. Le troisième, le Debt
Engine contract-aware, est un écart de différenciation : le socle existe et le retour
sur effort est élevé.

QUESTION : construire d'abord la parité qui rend le produit utilisable au quotidien, ou
d'abord la profondeur qui le rend unique ?

BLOQUE : la roadmap post-24 août.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant le 24 août.
IMPACT SI NON TRANCHÉ : le travail de Paul et Tom s'oriente par défaut vers ce qui est
techniquement le plus proche, pas vers ce qui a le plus de valeur.

---

## Questions fermées

Aucune à ce jour. Ce document est créé le 20 août 2026.

Quand une question est tranchée, elle descend ici avec sa réponse, sa date et le
document de référence mis à jour. Elle n'est pas supprimée : la trace de l'arbitrage
vaut autant que l'arbitrage.
