# Spécification du modèle de complétude

Léo Family Office. Version 0.2 du 20 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
Base : commit `ef5bacf`. Aucun code n'est écrit ici, aucun score n'est implémenté.

## 1. Le problème que ce modèle résout

Un calcul techniquement exécutable n'est pas économiquement fiable.

Exemple actuel, non théorique : le cockpit affiche un cash-flow libre de -142,72 €,
avec deux décimales. Ce chiffre est construit sur un budget dont une catégorie sur
vingt est renseignée. Il est arithmétiquement exact et économiquement dénué de sens :
la valeur réelle est nécessairement plus basse, d'un montant inconnu qui dépasse
probablement l'ordre de grandeur du chiffre affiché.

Le modèle de complétude sert à répondre à trois questions, dans cet ordre :

1. Ce résultat est-il utilisable pour décider ?
2. Que manque-t-il exactement ?
3. Dans quel sens le résultat va-t-il bouger quand cela sera renseigné ?

La troisième question est la plus utile et la plus souvent oubliée. Quand le sens du
biais est connu, le dire vaut plus qu'un pourcentage.

## 2. Trois axes orthogonaux, jamais fusionnés

Décision canonique du Checkpoint. La fiabilité d'un résultat se décompose en trois
grandeurs indépendantes, qui ne se combinent en aucun score unique.

| Axe | Question | Porte sur | Qui le renseigne | Action corrective |
|---|---|---|---|---|
| COMPLETENESS | ai-je toutes les données nécessaires ? | couverture des inputs | le système, par comptage | saisir la donnée manquante |
| CONFIDENCE / DATA QUALITY | les données présentes sont-elles fiables ? | qualité des inputs présents | la provenance de chaque input | vérifier, sourcer, dater |
| MODEL UNCERTAINTY | le modèle est-il adapté à la question ? | structure du calcul | le propriétaire du moteur, par déclaration | changer de modèle |

Les trois sont indépendants. Un résultat peut être complet à 100 %, de confiance HIGH,
et porter une incertitude de modèle élevée. Un modèle exact appliqué à des données
partielles reste inexploitable. Une donnée présente peut être fausse.

Le troisième axe est le seul qu'aucune donnée ne peut révéler : seul l'auteur du moteur
sait qu'il applique la vacance au loyer initial seulement, ou qu'il n'amortit pas la
dette dans la projection. Il se déclare, il ne se calcule pas.

### Pourquoi ne pas fusionner

Un indicateur unique ne dit ni ce qui manque, ni ce qui est douteux, ni ce qui est
simplifié. Il n'oriente donc vers aucune correction. Un utilisateur qui lit
« fiabilité 60 % » ne sait pas s'il doit saisir une donnée, obtenir un justificatif, ou
se méfier de la formule. Trois axes, trois actions.

## 2 bis. Ce que le modèle n'est pas

- Ce n'est pas un score de gamification. Aucun objectif de « 100 % de complétude ».
- Ce n'est pas un score unique d'application. Voir §4.
- Ce n'est pas un indicateur de confiance dans la donnée : la confiance est l'axe 2,
  distinct.
- Ce n'est pas une mesure de la qualité du modèle : c'est l'axe 3, distinct.
- Ce n'est pas une mesure de progression du produit.

## 3. État actuel

`DashboardMetrics.dataCompleteness` vaut aujourd'hui :

    catégories de budget renseignées / catégories de budget totales

Soit 1 / 20 = 5 % au seed. Trois défauts :

1. Le nom promet une complétude de données, la mesure ne porte que sur le budget.
2. Le dénominateur inclut les catégories « Revenu » et « Investissement », qui ne sont
   pas des dépenses. Le taux est donc pessimiste de deux points.
3. Il s'agit d'un score unique. Le patrimoine net, complet à 100 % sur son périmètre,
   et le cash-flow, complet à 5 %, partagent le même indicateur.

L'interface l'affiche correctement, « 5 % des catégories de dépenses renseignées »,
ce qui est plus honnête que le nom de la métrique dans le code.

## 4. Principe fondateur : la complétude est un attribut du calcul

Un score global moyennerait des zones fiables et des zones creuses, et rassurerait à
tort. La complétude appartient au résultat, pas à l'application.

Illustration sur l'état actuel :

| Résultat | Complétude | Lecture |
|---|---:|---|
| Patrimoine net | 100 % sur le périmètre financier | complet, périmètre restreint à déclarer |
| Cash bancaire | 100 % | complet |
| Dépenses mensuelles | 5 % | inutilisable pour décider |
| Cash-flow libre | 5 % | inutilisable, biais connu vers le bas |
| Couverture de liquidité | 13 % | borne haute, biais connu vers le bas |
| Performance de portefeuille | non calculable | input indispensable absent |
| TRI immobilier | 60 % sur les charges | indicatif, biais connu vers le bas |

Un score unique aurait produit une moyenne autour de 55 %, qui n'aurait aidé personne.

## 5. Classification des inputs

Chaque calcul déclare ses inputs dans l'une de trois catégories.

### INDISPENSABLE

Sans cet input, le calcul n'a pas de sens. Le résultat n'est pas affiché sous forme
numérique : il affiche « non calculable » et nomme la donnée requise.

Exemples : le cost basis pour une performance ; une dépense cible pour un FI ratio ;
un taux de change pour agréger une devise étrangère ; une date de première échéance
pour un service de dette.

### MATÉRIEL

Le calcul s'exécute, mais son résultat est significativement affecté. Seuil de
matérialité proposé : un input est matériel si son absence peut déplacer le résultat de
plus de 10 % de sa valeur, ou de plus d'un montant de référence à définir par domaine.

Le résultat est affiché, avec sa complétude, la liste des manquants et le sens du biais
s'il est connu. La précision d'affichage est dégradée, voir §8.

Exemples : la taxe foncière dans un TRI immobilier ; les dépenses essentielles dans une
couverture de liquidité ; l'assurance dans un coût de crédit.

### ACCESSOIRE

Le calcul est fiable sans cet input. Son absence est notée dans le détail, elle
n'affecte ni l'affichage principal, ni la précision.

Exemples : le libellé d'une position ; le pays d'une institution ; la couleur d'un
scénario.

### Règle de classement

Un input est INDISPENSABLE si son absence rend le résultat non défini ou arbitraire.
Il est MATÉRIEL si son absence rend le résultat biaisé de façon connue.
Il est ACCESSOIRE dans tous les autres cas.

Le classement appartient au propriétaire du calcul, il est écrit à côté de la formule,
et il est revu à chaque modification de cette formule.

## 6. Grandeurs exposées par un calcul

Tout résultat matériellement incomplet expose au minimum :

| Champ | Axe | Type | Sens |
|---|---|---|---|
| `status` | 1 | COMPLETE, PARTIAL, NOT_COMPUTABLE | verdict d'utilisabilité |
| `completeness` | 1 | 0 à 1 | part pondérée des inputs matériels renseignés |
| `missing` | 1 | liste | inputs absents, nommés en langage utilisateur |
| `missingCritical` | 1 | liste | sous-ensemble des INDISPENSABLE absents |
| `confidence` | 2 | HIGH, MEDIUM, LOW, UNKNOWN | qualité des inputs présents, bornée par le plus faible |
| `lowConfidenceInputs` | 2 | liste | inputs présents mais faiblement sourcés |
| `modelUncertainty` | 3 | LOW, MEDIUM, HIGH | appréciation déclarée par le propriétaire du moteur |
| `modelSimplifications` | 3 | liste | simplifications structurantes, déclarées, non calculées |
| `biasDirection` | transverse | UNDER, OVER, UNKNOWN, NONE | sens dans lequel le résultat va bouger |
| `displayPrecision` | transverse | entier | décimales autorisées, voir §8 |

`biasDirection` se lit du point de vue du résultat affiché : UNDER signifie que le
résultat réel est inférieur au résultat affiché.

## 7. Calcul de la complétude

Proposition, à valider.

    completeness = Σ poids(i) pour i renseigné et matériel
                 / Σ poids(i) pour i matériel

Les inputs INDISPENSABLE ne participent pas à cette moyenne : leur absence bascule le
statut à NOT_COMPUTABLE, sans nuance.

Les poids sont déclarés par le propriétaire du calcul, et par défaut égaux à 1. Deux
raisons de s'écarter de 1 :

- l'ordre de grandeur : la taxe foncière pèse plus lourd que l'assurance propriétaire
  dans un NOI ;
- la fréquence : une charge annuelle pèse autant qu'une charge mensuelle si elle est
  ramenée à la même période.

Un poids non déclaré vaut 1. Un poids déclaré est documenté à côté de la formule.

### Cas particulier des ensembles ouverts

Le budget est un ensemble ouvert : rien ne garantit que les vingt catégories couvrent
toutes les dépenses réelles. Une complétude de 100 % sur le budget ne prouve donc pas
que les dépenses sont complètes.

Conséquence : pour un ensemble ouvert, la complétude mesure la couverture du modèle,
pas la couverture de la réalité. Elle doit être libellée en conséquence, par exemple
« 100 % des catégories déclarées renseignées », jamais « dépenses complètes ». C'est
d'ailleurs ce que fait déjà correctement l'interface actuelle.

## 8. Précision d'affichage

Règle canonique : la précision affichée est bornée par **le plus dégradé des trois
axes**, jamais par la complétude seule.

    displayPrecision = min( niveau autorisé par COMPLETENESS,
                            niveau autorisé par CONFIDENCE,
                            niveau autorisé par MODEL UNCERTAINTY )

Ce point est le correctif le plus important apporté au Checkpoint. Lier mécaniquement la
précision au seul score de complétude produit exactement la fausse précision que la règle
cherche à éviter : un underwriting dont les seize entrées sont renseignées mais toutes
hypothétiques afficherait deux décimales, alors que c'est le cas où la précision est la
moins justifiée.

Barème par axe, à valider :

| Niveau | COMPLETENESS | CONFIDENCE | MODEL UNCERTAINTY | Montants | Taux et ratios | Formulation |
|---|---|---|---|---|---|---|
| 3 | 100 % | HIGH | LOW | 2 décimales | 2 décimales de point | valeur exacte |
| 2 | 80 à 99 % | MEDIUM | LOW à MEDIUM | 0 décimale | 1 décimale | valeur approchée |
| 1 | 50 à 79 % | LOW | MEDIUM | arrondi au multiple de 10 ou 100 selon l'ordre de grandeur | 0 décimale | « environ » |
| 0 | moins de 50 % | UNKNOWN | HIGH | ordre de grandeur seulement | 0 décimale, ou fourchette | « indicatif » |
| bloqué | NOT_COMPUTABLE | sans objet | sans objet | pas de nombre | pas de nombre | « non calculable » |

Deux applications qui montrent que la borne ne vient pas toujours du même axe :

- TRI de CASE 14 : COMPLETENESS 60 % (niveau 1), CONFIDENCE LOW (niveau 1),
  MODEL UNCERTAINTY MEDIUM (niveau 1). Borne = niveau 1, donc « environ 6 % » et non
  « 6,32 % ». Ici les trois axes concordent.
- Underwriting de CASE 12, toutes entrées renseignées : COMPLETENESS 100 % (niveau 3),
  CONFIDENCE LOW car tout est USER_ASSUMPTION (niveau 1), MODEL UNCERTAINTY MEDIUM
  (niveau 1). Borne = niveau 1. La complétude parfaite n'autorise pas deux décimales.
  C'est le cas que l'ancien barème traitait mal.

Cette règle est la plus visible pour l'utilisateur et la moins coûteuse à implémenter.
Elle est aussi celle qui protège le mieux contre la fausse précision, qui est l'un des
modes de défaillance nommés dans le business plan §3.2.

## 9. Propagation

Un agrégat hérite de la complétude de ses composants.

    completeness(agrégat)      = min(completeness(composants))
    confidence(agrégat)        = min(confidence(composants))
    modelUncertainty(agrégat)  = max(modelUncertainty(composants))
    biasDirection(agrégat)     = UNKNOWN si les composants ont des biais opposés

Le minimum pour les deux premiers axes, le maximum pour le troisième : dans les trois cas
la règle dit la même chose, un agrégat n'est pas plus fiable que son maillon le plus
faible. Une moyenne diluerait précisément l'information qui compte.

Les trois se propagent séparément et restent trois grandeurs distinctes à l'arrivée,
conformément à `DATA_INVARIANTS.md` INV-M-01 et INV-H-03.

## 10. Affichage

Trois niveaux, du plus discret au plus explicite.

### Niveau 1, en ligne

Un indicateur discret à côté de la valeur, non intrusif. Il indique le statut, pas le
détail. Il ne doit pas transformer chaque écran en champ de mines : la majorité des
chiffres du produit seront PARTIAL pendant longtemps.

### Niveau 2, au survol ou au clic

Complétude en pourcentage, liste des manquants nommés en langage utilisateur, sens du
biais quand il est connu.

Formulation type : « Complétude 60 %. Manquent : taxe foncière réelle, provision pour
travaux. Le rendement réel est probablement inférieur à celui affiché. »

### Niveau 3, dans le panneau Explain calculation

Section dédiée du panneau existant, listant chaque input avec son statut, son poids, sa
provenance et sa date. C'est le lieu naturel : le panneau expose déjà formule, inputs,
provenance et date. Il lui manque la complétude.

### Ce qu'il ne faut pas faire

- Afficher un pourcentage sans nommer ce qui manque. Un chiffre seul n'est pas actionnable.
- Bloquer l'affichage d'un résultat PARTIAL. L'utilisateur a le droit de voir un ordre de grandeur, il a le droit de savoir que c'en est un.
- Utiliser une couleur rouge pour PARTIAL. Rouge signifie erreur, pas incomplétude.
- Additionner les complétudes de plusieurs écrans en un score de progression.

## 11. Ce que le modèle change sur l'état actuel

Application aux sept résultats principaux du produit, à titre d'illustration.

| Résultat | Statut | COMPLETENESS | CONFIDENCE | MODEL UNCERTAINTY | Biais | Précision |
|---|---|---:|---|---|---|---|
| Patrimoine net | COMPLETE sur périmètre financier | 100 % | HIGH | LOW | NONE | 2 décimales |
| Cash bancaire | COMPLETE | 100 % | HIGH | LOW | NONE | 2 décimales |
| Actifs investis | COMPLETE | 100 % | HIGH | LOW | NONE | 2 décimales |
| Dépenses mensuelles | PARTIAL | 5 % | HIGH sur la seule ligne connue | LOW | UNDER | ordre de grandeur |
| Cash-flow libre | PARTIAL | 5 % | MEDIUM, taxes absentes du modèle | MEDIUM | UNDER | ordre de grandeur |
| Couverture de liquidité | PARTIAL | 13 % | HIGH | MEDIUM, service de dette hors dénominateur | OVER | ordre de grandeur |
| Underwriting immobilier | PARTIAL | 60 % | LOW, tout en USER_ASSUMPTION | HIGH, charges constantes, vacance non indexée, fiscalité forfaitaire | UNDER | ordre de grandeur |
| Projection Monte-Carlo | COMPLETE | 100 % | MEDIUM | HIGH, dette non amortie, épargne constante, stress fixe | UNKNOWN | ordre de grandeur |
| Performance du CTO | NOT_COMPUTABLE | sans objet | sans objet | sans objet | sans objet | pas de nombre |
| Taux d'épargne et d'investissement | NOT_COMPUTABLE | sans objet | sans objet | sans objet | sans objet | pas de nombre |

Deux lignes méritent une lecture attentive.

La projection Monte-Carlo est **complète** au sens de l'axe 1, et c'est précisément le
cas que l'ancien barème traitait mal : elle aurait affiché deux décimales. Son incertitude
de modèle est élevée, pour cinq raisons déclarées et non calculables, dont la principale
est que la dette n'y est pas amortie.

Les taux d'épargne et d'investissement passent en NOT_COMPUTABLE, conformément à la
décision du Checkpoint reprise en INV-B-07 : ce sont des métriques de flux constatés, et
le ledger de flux n'existe pas. Elles ne sont plus proxifiées par le cash-flow libre.

La dernière ligne est celle qui compte le plus : le modèle de complétude, s'il avait
existé, aurait empêché mécaniquement l'affichage de « +77,71 % ». C'est le meilleur
argument pour l'implémenter tôt.

Note sur la ligne « Couverture de liquidité » : le biais est OVER, c'est-à-dire que la
couverture réelle est inférieure aux 0,31 mois affichés, pour deux raisons cumulatives
(dénominateur incomplet, service de dette absent du dénominateur). C'est le seul
résultat du produit dont le biais joue dans le sens rassurant, ce qui en fait le plus
dangereux.

## 12. Ordre d'implémentation proposé

1. Classer les inputs de six calculs seulement : patrimoine net, cash bancaire,
   dépenses mensuelles, cash-flow libre, couverture de liquidité, performance de
   portefeuille. Ces six couvrent le cockpit.
2. Implémenter `status` et `missingCritical`, sans pondération ni pourcentage. Cela
   suffit à empêcher l'affichage d'un NOT_COMPUTABLE, ce qui est le gain principal.
3. Déclarer `modelSimplifications` sur les cinq moteurs existants. C'est du texte écrit
   par le propriétaire du moteur, sans code, et cela révèle immédiatement les cas où un
   résultat complet est structurellement inadapté.
4. Ajouter `biasDirection`, saisi à la main par le propriétaire du calcul. Trois valeurs
   suffisent.
5. Ajouter `completeness` avec des poids égaux à 1, et propager `confidence` depuis la
   provenance des inputs, qui existe déjà.
6. Ajouter la règle de précision d'affichage, bornée par les trois axes.
7. Ajouter les poids différenciés, seulement là où l'ordre de grandeur le justifie.

Les étapes 1 à 3 apportent l'essentiel de la valeur, et l'étape 3 ne coûte que du temps
de rédaction. Les étapes 4 à 7 affinent.

## 13. Points à soumettre à la review

Tranché au Checkpoint : les trois axes sont séparés, et la précision d'affichage est
bornée par le plus dégradé des trois, jamais par la complétude seule.

Encore ouvert :

1. Le seuil de matérialité de 10 % est-il le bon, ou faut-il un seuil absolu par domaine ?
2. La propagation par minimum est-elle trop conservatrice pour un agrégat à nombreux composants ?
3. Le barème de précision d'affichage doit-il s'appliquer aussi aux exports CSV et JSON, ou seulement à l'interface ?
4. Les trois axes doivent-ils être persistés avec une clôture mensuelle, pour pouvoir dire plus tard « cette clôture était complète à 40 %, de confiance MEDIUM » ?
5. Faut-il un statut intermédiaire entre PARTIAL et NOT_COMPUTABLE, par exemple STALE, pour une donnée présente mais périmée ? Cela relèverait de l'axe CONFIDENCE plutôt que de l'axe COMPLETENESS.
6. `modelUncertainty` est une appréciation déclarée, donc subjective. Faut-il une grille de qualification pour la rendre comparable entre moteurs ?
