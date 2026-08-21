# Critères d'acceptation V1

Léo Family Office. Version 0.2 du 20 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
Base : commit `ef5bacf`.

## Objet et portée

Ce document définit ce qu'il faut pour qu'un module soit considéré comme terminé en V1.
Il ne décrit pas une roadmap : il décrit une barre. Un module qui ne passe pas cette
barre n'est pas « presque fini », il est en cours.

Cinq exigences par module, dans cet ordre :

| Exigence | Question à laquelle elle répond |
|---|---|
| FAIRE | que peut faire l'utilisateur, concrètement |
| PERSISTER | qu'est-ce qui survit à un rechargement de page |
| EXPLIQUER | quel calcul peut être ouvert et justifié |
| TESTER | quel comportement est verrouillé par un test automatisé |
| SIGNALER | qu'est-ce que le module dit de lui-même quand il ne sait pas |

La cinquième exigence est celle qui distingue LFO d'un tableau de bord. Un module qui
fait, persiste, explique et teste, mais qui ne sait pas dire ce qu'il ignore, ne passe
pas la barre.

### Convention de notation

`[x]` critère satisfait au commit `ef5bacf`, vérifié.
`[~]` critère partiellement satisfait, la limite est nommée.
`[ ]` critère non satisfait.

### État global

| Module | FAIRE | PERSISTER | EXPLIQUER | TESTER | SIGNALER | Verdict V1 |
|---|---|---|---|---|---|---|
| Net Worth | proche | oui | partiel | oui | partiel | à durcir |
| Accounts | oui | oui | non | non | partiel | à durcir |
| Cash Flow | partiel | oui | faux | partiel | partiel | non |
| Transactions | minimal | oui | non | non | non | non |
| Budget | oui | oui | non | partiel | oui | à durcir |
| Investments | partiel | oui | partiel | minimal | partiel | non |
| Debt | partiel | partiel | partiel | partiel | oui | non |
| Real Estate | oui | non | partiel | minimal | non | non |
| Career | partiel | non | non | non | oui | non |
| Business Equity | oui | non | non | non | oui | non |
| Tax | non | placeholder | non | partiel | oui | non |
| Scenarios | oui | oui | partiel | partiel | non | à durcir |
| Monte-Carlo | oui | oui | oui | oui | partiel | à durcir |
| Decision Lab | minimal | non | non | non | non | non |
| Goals | oui | oui | non | non | oui | à durcir |
| Monthly Close | oui | partiel | non | non | non | non |
| Documents | oui | oui | sans objet | non | oui | à durcir |
| Exports | oui | sans objet | sans objet | non | non | à durcir |

Verdict « à durcir » : le module fait ce qu'il annonce, il lui manque des tests, de
l'explicabilité ou des signaux. Verdict « non » : il manque une capacité, pas seulement
de la finition.

---

## Net Worth

FAIRE
- [x] voir les actifs bruts, les dettes et le patrimoine net à une date donnée
- [x] voir la ventilation par compte et par type
- [ ] voir la variation depuis la dernière clôture
- [ ] voir l'attribution de cette variation : épargne, marché, principal remboursé, revalorisations, frais, taxes
- [ ] inclure l'immobilier et le business equity dans le périmètre, ou déclarer leur absence par le libellé « Actifs financiers identifiés »
- [ ] entrer un actif financé en valeur brute, sa dette en passif, et n'afficher son equity qu'en DERIVED non sommable

PERSISTER
- [x] chaque solde est daté et historisé, une correction crée une nouvelle observation
- [x] l'historique précédent reste lisible

EXPLIQUER
- [x] la formule `actifs bruts moins dettes` est exposée avec ses inputs
- [~] les inputs sont dérivés de `state` pour les comptes, mais la note de bas de panneau contient une valeur figée
- [ ] la provenance de l'agrégat lui-même est absente : `netWorth` n'a ni type ni confiance

TESTER
- [x] absence de double comptage des positions
- [x] calcul du patrimoine net
- [ ] compte en devise étrangère
- [ ] compte débiteur exclu de `GrossAssets` et compté en passif court terme
- [ ] tolérance monétaire alignée sur la règle canonique : pleine précision en interne, arrondi à la restitution. Le test actuel est rouge sur une égalité stricte, et c'est le test qui doit changer, pas la formule

SIGNALER
- [x] callout « Périmètre identifié » sur la page dédiée
- [ ] la carte du cockpit ne porte aucune réserve de périmètre
- [ ] aucun signal quand un compte n'a pas été mis à jour depuis longtemps

---

## Accounts

FAIRE
- [x] ajouter un compte avec institution, nom, type, devise et solde
- [x] mettre à jour un solde avec sa date
- [ ] archiver ou clôturer un compte
- [ ] importer des comptes depuis un relevé ou une connexion

PERSISTER
- [x] comptes, institutions et soldes datés
- [x] statut `ACTIVE` porté par le modèle

EXPLIQUER
- [ ] aucun panneau d'explication sur cet écran

TESTER
- [ ] aucun test sur les mutations de compte, ni local, ni Supabase
- [ ] aucun test de validation Zod des mutations

SIGNALER
- [x] badge de provenance sur chaque compte
- [~] la date du solde est stockée, elle n'est pas mise en avant quand elle est ancienne
- [ ] aucun contrôle sur la devise : un code de 3 lettres quelconque est accepté et le montant sera agrégé à parité

---

## Liquidité

FAIRE
- [ ] voir `LiquidAssets`, les actifs mobilisables sous 30 jours sans pénalité
- [ ] voir `NetLiquidityPosition30d`, ce qui reste après les engagements du mois
- [ ] voir `LiquidNetWorth`, ce qui resterait après solde de toutes les dettes
- [ ] voir, pour chaque actif exclu, le motif de son exclusion

PERSISTER
- [ ] la qualification de liquidité par actif : le champ `liquidity` existe sur `FinancialAccount` et n'est exploité par aucun calcul

EXPLIQUER
- [ ] trois panneaux distincts, un par grandeur, dont celui de `LiquidNetWorth` doit dire qu'un résultat négatif n'est pas une anomalie

TESTER
- [ ] jeu comportant un actif illiquide et une dette à échéance proche ; les trois grandeurs doivent différer, et aucune ne doit égaler `NetWorth`

SIGNALER
- [ ] un actif dont la liquidité n'est pas qualifiée est exclu par défaut et signalé, jamais inclus par défaut

Module entièrement absent au commit `ef5bacf` : une seule métrique existe,
`liquidNetWorth`, et elle est un alias exact de `netWorth`.

---

## Cash Flow

FAIRE
- [x] voir revenus actifs, dépenses connues et cash-flow libre
- [ ] voir le taux d'épargne et le taux d'investissement, qui doivent afficher « non calculable » tant que le ledger de flux n'existe pas, et non un proxy du cash-flow libre
- [ ] voir le cash-flow sur une période choisie, pas seulement au mois courant
- [ ] voir un historique réel
- [ ] voir une prévision à 30, 90 et 365 jours
- [ ] voir les taxes comme une ligne distincte

PERSISTER
- [x] revenus, budget et passifs persistés
- [ ] aucun agrégat mensuel figé, tout est recalculé à la volée

EXPLIQUER
- [~] un panneau existe
- [ ] il affiche « Service de dette actuel : 0,00 € » alors que le moteur a retranché 284,72 €. L'explication contredit le chiffre expliqué. C'est le seul cas du produit où un panneau d'explication est faux et non simplement figé

TESTER
- [x] service de dette et cash-flow libre couverts par `shared.test.ts`
- [ ] aucun test du service de dette par somme des `totalCashOut` exigibles : avant première échéance, en différé partiel, en amortissement, après maturité
- [ ] aucun test du taux d'épargne en valeur négative profonde

SIGNALER
- [x] callout indiquant le nombre de catégories non renseignées
- [~] la carte affiche « dépenses incomplètes » sans quantifier
- [ ] le cash-flow n'expose pas sa complétude comme une donnée exploitable

---

## Transactions

FAIRE
- [x] ajouter une transaction avec date, libellé, catégorie, montant signé
- [x] répercuter ou non le mouvement sur le solde du compte
- [ ] enregistrer un transfert interne comme une entité à deux jambes
- [ ] importer un fichier CSV bancaire
- [ ] recatégoriser une transaction
- [ ] supprimer ou corriger une transaction

PERSISTER
- [x] transaction persistée avec sa provenance
- [x] le solde dérivé est marqué DERIVED, pas ACTUAL

EXPLIQUER
- [ ] sans objet en l'état, aucun calcul dérivé des transactions

TESTER
- [ ] aucun test sur `add_transaction`, ni sur la répercussion du solde

SIGNALER
- [x] état vide explicite quand aucune transaction n'existe
- [ ] aucun signal de doublon, de récurrence ou de transfert probable

Note : c'est le module qui bloque le plus de valeur en aval. Sans transactions, le
budget reste déclaratif, le cash-flow reste théorique, la performance reste
incalculable et la réserve de sécurité reste une estimation.

---

## Budget

FAIRE
- [x] renseigner un montant mensuel par catégorie
- [x] laisser une catégorie vide sans qu'elle soit interprétée comme zéro
- [x] distinguer essentiel et discrétionnaire
- [ ] comparer budget et réalisé
- [ ] gérer plusieurs niveaux de train de vie, le champ `lifestyle` existe et n'est jamais exploité

PERSISTER
- [x] montant, provenance, confiance et date d'effet
- [~] la date d'effet est écrite à `AS_OF_DATE` figé, pas à la date réelle de saisie

EXPLIQUER
- [ ] aucun panneau d'explication

TESTER
- [x] exclusion des montants nuls du total
- [x] calcul de complétude
- [ ] aucun test de la mutation elle-même

SIGNALER
- [x] badge MISSING sur chaque catégorie non renseignée
- [x] compteur de catégories vides dans un callout
- [x] aucune substitution silencieuse

Budget est le module qui applique le mieux la doctrine « une donnée manquante reste
manquante ». Il est cité ici comme référence pour les autres.

---

## Investments

FAIRE
- [x] voir les positions, leur classe d'actif et leur valeur
- [x] voir l'écart entre le solde d'un compte et la somme de ses positions
- [ ] saisir ou importer une position
- [ ] voir une performance calculée, séparée des versements
- [ ] voir l'allocation avec un objectif et un écart à cet objectif
- [ ] voir les frais et les dividendes

PERSISTER
- [x] positions et valorisations datées
- [ ] aucun historique de flux par position

EXPLIQUER
- [~] un panneau expose la formule de réconciliation
- [ ] ses trois inputs sont des chaînes figées portant un badge ACTUAL

TESTER
- [x] un test sur l'exclusion du cash des actifs investis
- [ ] aucun test sur la réconciliation, qui vit dans l'interface

SIGNALER
- [x] écart de réconciliation exposé, avec la phrase « sans créer de position fictive »
- [x] refus explicite d'afficher volatilité, drawdown et Sharpe faute d'historique
- [ ] une performance de +77,71 % est affichée sans base de calcul, ce qui contredit directement les deux points précédents sur le même écran

---

## Debt

FAIRE
- [x] voir le capital, le taux, la mensualité et l'échéancier dérivé
- [x] voir l'écart entre le total contractuel et le capital
- [ ] ajouter un prêt depuis l'interface
- [ ] importer un échéancier bancaire réel
- [ ] voir plusieurs dettes, l'écran n'en traite qu'une
- [ ] voir intérêts et principal séparément sur la période
- [ ] voir les échéances à venir sur une fenêtre choisie

PERSISTER
- [x] le passif est persisté avec ses dates et son nombre d'échéances
- [~] `loan_schedules` est écrite au seed et jamais relue, l'interface recalcule à chaque affichage
- [ ] `currentBalance` n'est jamais recalculé après paiement

EXPLIQUER
- [~] deux panneaux existent, écart contractuel et amortissement à 0 %
- [ ] leurs inputs sont des chaînes figées

TESTER
- [x] amortissement à 0 % sans invention d'intérêt
- [x] plafonnement de la dernière échéance au solde restant
- [ ] aucun test de la fenêtre de service de dette, ni du différé, ni de la maturité
- [ ] aucun test avec plusieurs dettes

SIGNALER
- [x] alerte HIGH sur l'écart de 338,20 €
- [x] callout précisant que seul le document bancaire pourra l'expliquer
- [~] l'écart est signalé comme un texte, pas comme un état de réconciliation attaché au passif

Debt applique bien la doctrine sur la réconciliation, et mal la doctrine sur la
temporalité. C'est le module où l'écart entre l'ambition du business plan et
l'implémentation est le plus rentable à combler.

---

## Real Estate

FAIRE
- [x] saisir seize hypothèses et obtenir TRI, VAN, MOIC, LTV, DSCR, cash-on-cash
- [ ] enregistrer une étude
- [ ] comparer plusieurs études
- [ ] voir des sensibilités sur prix, loyer, travaux, taux, vacance et sortie
- [ ] intégrer un bien acquis au patrimoine

PERSISTER
- [ ] rien n'est enregistré. Les tables `properties`, `mortgages` et `real_estate_cashflows` existent et ne sont jamais écrites. Un bouton « Sauvegarder l'étude » est présent et inactif

EXPLIQUER
- [~] un panneau expose la formule du TRI avec des inputs dérivés du résultat, ce qui est correct
- [ ] aucune explication du calcul de l'equity investie, qui est pourtant le paramètre le plus déterminant et le plus faux

TESTER
- [x] un test couvre les totaux, le rendement brut, la longueur des flux et la non-nullité du TRI
- [ ] aucun test avec `loanAmount` différent de `purchasePrice`, c'est-à-dire le cas où la formule d'equity est fausse
- [ ] aucun test du MOIC avec apports complémentaires au dénominateur
- [ ] aucun test séparant le coût des travaux de la valeur qu'ils créent
- [ ] aucun test du flux de sortie, du principal restant, ni de la fiscalité
- [ ] aucun test avec un horizon supérieur à la durée du prêt

SIGNALER
- [x] callout « Cas de travail non patrimonial », qui isole correctement le bac à sable
- [x] badge USER_ASSUMPTION sur le panneau d'hypothèses
- [ ] aucune complétude affichée, aucune donnée manquante nommée
- [ ] précision affichée non dégradée : un DSCR à deux décimales sur un modèle entièrement hypothétique

---

## Career

FAIRE
- [x] choisir une trajectoire parmi six et voir une courbe de rémunération brute
- [ ] convertir le brut en net, alors que `employmentCompensation` existe dans `tax.ts` et n'est appelé par aucun code de production
- [ ] saisir sa propre trajectoire
- [ ] relier la trajectoire au patrimoine projeté

PERSISTER
- [ ] rien n'est enregistré, aucune table

EXPLIQUER
- [ ] aucun panneau

TESTER
- [ ] aucun test, toute la logique est dans le JSX

SIGNALER
- [x] callout « Courbes non sourcées en V1 » avec la date
- [x] badge MODEL_ASSUMPTION
- [~] la carte « Fixe central » affiche une constante alors que la donnée existe dans le registre d'hypothèses, contrairement à la carte voisine qui lit bien le registre

---

## Business Equity

FAIRE
- [x] calculer une valeur d'entreprise, une equity value et une valeur attribuable
- [ ] enregistrer une société
- [ ] gérer une cap table et une dilution
- [ ] modéliser une levée ou une sortie

PERSISTER
- [ ] rien n'est enregistré. Les tables `businesses`, `business_financials` et `business_valuations` existent et ne sont jamais écrites

EXPLIQUER
- [ ] aucun panneau

TESTER
- [ ] aucun test, tout le calcul est dans le JSX

SIGNALER
- [x] callout « Aucun actif business actuel », qui isole correctement le bac à sable
- [~] le champ « Dette nette brute » est ambigu : le calcul fait `EV moins dette plus cash`, ce qui suppose une dette brute. Un utilisateur qui saisit une dette nette compte le cash deux fois

---

## Tax

FAIRE
- [ ] aucun calcul fiscal n'est produit par l'application
- [ ] saisir un profil fiscal
- [ ] voir un résultat après impôt avec sa règle et sa date de vérification

PERSISTER
- [~] `tax_profiles` est seedée, `tax_rules` contient un placeholder MISSING

EXPLIQUER
- [ ] aucun panneau

TESTER
- [x] deux tests sur `progressiveTax` et `employmentCompensation`, sur une règle fictive explicitement nommée « fixture de test, pas une règle française »
- [ ] aucun test de sélection de règle par période d'effet

SIGNALER
- [x] « Règles actives vérifiées : 0 »
- [x] callout « Pas de conseil fiscal »
- [x] hypothèse `asm_tax` en confiance faible dans le registre

Tax est le module le plus honnête du produit : il ne calcule rien et le dit. C'est le
comportement attendu. La barre V1 pour ce module n'est pas « calculer l'impôt », c'est
« ne jamais produire un après-impôt sans règle datée et sourcée », et elle est
franchie.

---

## Scenarios

FAIRE
- [x] voir cinq scénarios avec leurs paramètres
- [x] modifier huit paramètres, ce qui crée une version
- [x] dupliquer un scénario
- [ ] comparer quatre scénarios côte à côte
- [ ] revenir à une version précédente
- [ ] supprimer un scénario

PERSISTER
- [x] scénarios et versions archivées
- [x] le payload complet est conservé à chaque version

EXPLIQUER
- [~] les paramètres sont visibles sur chaque carte
- [ ] `shockYear` est un entier relatif à l'année 1, sans unité affichée. Un utilisateur qui saisit « 2 » en pensant « 2028 » obtient un choc en 2027
- [ ] `salaryGrowth` est stocké, modifiable, et consommé par aucun moteur

TESTER
- [x] `applyScenarioOverrides` ne mute pas la base
- [ ] aucun test du versionnage, de la duplication, ni des bornes Zod

SIGNALER
- [x] badge de provenance par scénario
- [ ] l'édition force la confiance à HIGH sans vérification
- [ ] aucun signal sur `salaryGrowth`, paramètre modifiable et sans effet

---

## Monte-Carlo

FAIRE
- [x] lancer une projection avec seed, horizon et nombre de simulations
- [x] voir P10, P25, P50, P75, P90 par année
- [ ] rejouer un run passé depuis ses paramètres persistés
- [ ] comparer deux runs

PERSISTER
- [x] runs et résultats persistés avec méthodologie, seed, horizon et nombre de simulations
- [ ] aucun écran ne relit un run persisté

EXPLIQUER
- [x] panneau exposant formule, simulations, seed, scénario et méthodologie, tous dérivés du résultat
- [x] c'est le seul panneau d'explication du produit dont tous les inputs sont réels

TESTER
- [x] reproductibilité stricte à seed fixé
- [x] ordre des percentiles sur chaque année
- [x] choc daté déterministe
- [ ] aucun test d'invariance à volatilité nulle, ni de cohérence de l'année civile

SIGNALER
- [x] formulation honnête des percentiles, « des simulations du modèle »
- [x] méthodologie stockée avec le run
- [ ] la dette n'est pas décrémentée dans la projection, et rien ne le dit
- [ ] l'épargne projetée n'a aucun lien avec le cash-flow constaté, et rien ne le dit

---

## Decision Lab

FAIRE
- [x] comparer rembourser et investir sur quatre paramètres
- [ ] les neuf autres cas annoncés, tous inactifs
- [ ] comparer plus de deux univers
- [ ] appliquer le même scénario macro aux alternatives

PERSISTER
- [ ] rien n'est enregistré. La table `decision_cases` existe et n'est jamais écrite

EXPLIQUER
- [ ] aucun panneau. Le module qui produit une recommandation est le seul du produit à n'offrir aucune explication

TESTER
- [ ] aucun test. `decision.ts` est le seul moteur sans fichier de test

SIGNALER
- [~] la conclusion précise « sous les hypothèses, sans rendre le résultat certain »
- [ ] trois coefficients déterminent la conclusion et ne sont ni affichés, ni sourcés
- [ ] l'inflation utilisée n'est pas celle du scénario actif
- [ ] le capital arbitré est écrit en dur et diffère entre deux écrans

Barre V1 pour ce module, arrêtée par la décision canonique Q-11 du 21 août 2026 : le
module peut comparer et classer des résultats objectifs, il ne peut pas émettre de
recommandation prescriptive fondée sur des heuristiques non validées. Il cesse donc
d'afficher une recommandation, et il étiquette `riskHaircut`, `liquidityWeight` et le
seuil de risque en `MODEL_HEURISTIC / EXPERIMENTAL`, avec formule et impact auditables.
La levée de cette contrainte exige trois conditions cumulatives : méthodologie
documentée, testée, approuvée.

---

## Goals

FAIRE
- [x] créer un objectif avec montant et date cible
- [x] voir la progression
- [ ] modifier ou supprimer un objectif
- [ ] affecter des comptes à un objectif
- [ ] savoir si l'objectif est atteignable, et à quelle date

PERSISTER
- [x] objectifs persistés avec priorité et statut

EXPLIQUER
- [ ] aucun panneau

TESTER
- [ ] aucun test

SIGNALER
- [x] « Non calculable » pour le FI ratio et le Freedom Coverage, avec la donnée manquante nommée
- [x] progression plancher à zéro quand le patrimoine net est négatif
- [~] « Repères configurables » n'est pas configurable

Goals est cité en référence pour son traitement du « non calculable ». C'est le
comportement que la page Investments devrait adopter pour la performance du CTO.

---

## Monthly Close

FAIRE
- [x] clôturer un mois
- [x] voir la liste des clôtures
- [ ] rouvrir une clôture par une procédure explicite et tracée, produisant une version supplémentaire
- [ ] consulter toutes les versions antérieures d'une clôture, dont aucune n'est jamais supprimée
- [ ] voir l'attribution de la variation entre deux clôtures

PERSISTER
- [~] trois agrégats sont figés, pas le détail. Aucune attribution ultérieure n'est possible
- [ ] une seconde clôture du même mois écrase la première sans trace
- [ ] une clôture répétée crée un snapshot supplémentaire à chaque appel

EXPLIQUER
- [ ] aucun panneau

TESTER
- [ ] aucun test de la mutation, ni de son idempotence

SIGNALER
- [x] état vide explicite quand aucune clôture n'existe
- [ ] le callout promet un « écart réel contre prévu » que le stockage ne permet pas de produire

---

## Documents

FAIRE
- [x] déposer un fichier avec une catégorie
- [x] voir l'inbox et le compteur par catégorie
- [ ] classer, renommer, supprimer
- [ ] télécharger un document déposé
- [ ] extraire des données d'un document

PERSISTER
- [x] métadonnées et fichier persistés, bucket privé en production

EXPLIQUER
- sans objet

TESTER
- [ ] aucun test de la route, ni des contrôles de type et de taille

SIGNALER
- [x] types et taille annoncés à l'utilisateur avant dépôt
- [x] message d'erreur explicite en cas de refus
- [~] « Stockage local privé dans cette V1 » est faux en production

---

## Exports

FAIRE
- [x] exporter le bilan en CSV
- [x] exporter l'état complet en JSON
- [ ] exporter les transactions, les positions ou l'échéancier
- [ ] rapport PDF et IC memo, annoncés « Coming soon »

PERSISTER
- sans objet

EXPLIQUER
- sans objet

TESTER
- [ ] aucun test de la route d'export

SIGNALER
- [ ] le CSV ne contient que comptes et dettes, et rien ne l'indique à l'utilisateur
- [ ] l'export ne porte ni la date de génération, ni la complétude des données exportées

---

## Barre V1 minimale, proposition

Un module est acceptable en V1 s'il satisfait les cinq conditions suivantes. C'est une
proposition d'arbitrage, pas une décision.

1. Toute valeur affichée est dérivée des données, jamais écrite dans le code.
2. Tout calcul affiché a un panneau d'explication dont les inputs sont réels.
3. Tout calcul affiché a au moins un golden case et un test de cas limite.
4. Tout calcul expose les trois axes de fiabilité séparément, complétude, confiance et
   incertitude de modèle, et déclare le sens du biais quand il est connu. La précision
   affichée est bornée par le plus dégradé des trois.
5. Aucun libellé n'affirme une capacité que le module n'a pas.

Au commit `ef5bacf`, aucun module ne satisfait les cinq conditions. Monte-Carlo satisfait
les conditions 1, 2 et 3. Budget satisfait les conditions 1, 4 et 5.

## Points à soumettre à la review

1. La barre V1 proposée ci-dessus est-elle la bonne, ou trop haute pour une V1 ?
2. Decision Lab : retirer la recommandation, ou financer les tests et l'exposition des paramètres ?
3. Real Estate : la persistance est-elle un prérequis V1, ou le bac à sable suffit-il tant qu'aucun achat n'est envisagé ?
4. Transactions et import CSV : est-ce le premier chantier V1, compte tenu du fait qu'il débloque budget, cash-flow, performance et réserve de sécurité ?
5. Faut-il un module « Attribution de variation », absent de cette liste parce qu'il n'existe pas, alors qu'il est la promesse centrale du business plan §5.2 ?
