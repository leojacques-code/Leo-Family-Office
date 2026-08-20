# Spécification du modèle de complétude

Léo Family Office. Version 0.1 du 20 août 2026. Lane : Léo (Product Truth).
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

## 2. Ce que le modèle n'est pas

- Ce n'est pas un score de gamification. Aucun objectif de « 100 % de complétude ».
- Ce n'est pas un score unique d'application. Voir §4.
- Ce n'est pas un indicateur de confiance dans la donnée. La confiance qualifie une
  source, la complétude qualifie un calcul. Une donnée peut être présente et peu fiable,
  ou absente sans conséquence.
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

| Champ | Type | Sens |
|---|---|---|
| `status` | COMPLETE, PARTIAL, NOT_COMPUTABLE | verdict binaire d'utilisabilité |
| `completeness` | 0 à 1 | part pondérée des inputs matériels renseignés |
| `missing` | liste | inputs absents, nommés en langage utilisateur |
| `missingCritical` | liste | sous-ensemble des INDISPENSABLE absents |
| `biasDirection` | UNDER, OVER, UNKNOWN, NONE | sens dans lequel le résultat va bouger |
| `displayPrecision` | entier | décimales autorisées, voir §8 |

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

Règle : le nombre de décimales affichées ne dépasse jamais la précision que le modèle
peut soutenir.

Barème proposé, à valider :

| Complétude | Montants | Taux et ratios | Formulation |
|---|---|---|---|
| 100 % | 2 décimales | 2 décimales de point de pourcentage | valeur exacte |
| 80 à 99 % | 0 décimale | 1 décimale | valeur approchée |
| 50 à 79 % | arrondi au multiple de 10 ou 100 selon l'ordre de grandeur | 0 décimale | « environ » |
| moins de 50 % | ordre de grandeur seulement | 0 décimale, ou fourchette | « indicatif » |
| NOT_COMPUTABLE | pas de nombre | pas de nombre | « non calculable » |

Application au cas actuel du TRI immobilier de CASE 14 du golden dataset : complétude
60 % sur les charges, donc « environ 6 % » et non « 6,32 % ».

Cette règle est la plus visible pour l'utilisateur et la moins coûteuse à implémenter.
Elle est aussi celle qui protège le mieux contre la fausse précision, qui est l'un des
modes de défaillance nommés dans le business plan §3.2.

## 9. Propagation

Un agrégat hérite de la complétude de ses composants.

    completeness(agrégat) = min(completeness(composants))
    biasDirection(agrégat) = UNKNOWN si les composants ont des biais opposés

Le minimum, et non la moyenne : un agrégat n'est pas plus fiable que son maillon le
plus faible. Une moyenne diluerait précisément l'information qui compte.

Corollaire, aligné sur `DATA_INVARIANTS.md` INV-H-03 : la confiance d'un dérivé est
elle aussi bornée par celle de ses inputs. Complétude et confiance se propagent selon
la même règle, et restent deux grandeurs distinctes.

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

| Résultat | Statut | Complétude | Manquants matériels | Biais | Précision |
|---|---|---:|---|---|---|
| Patrimoine net | COMPLETE sur périmètre financier | 100 % | immobilier, business equity, autres actifs, tous hors périmètre déclaré | NONE | 2 décimales |
| Cash bancaire | COMPLETE | 100 % | aucun | NONE | 2 décimales |
| Actifs investis | COMPLETE | 100 % | aucun | NONE | 2 décimales |
| Dépenses mensuelles | PARTIAL | 5 % | 19 catégories | UNDER | ordre de grandeur |
| Cash-flow libre | PARTIAL | 5 % | 19 catégories, taxes | UNDER | ordre de grandeur |
| Couverture de liquidité | PARTIAL | 13 % | 7 dépenses essentielles sur 8 (électricité, internet, téléphone, assurance, transport, courses, santé), service de dette absent du dénominateur | OVER | ordre de grandeur |
| Performance du CTO | NOT_COMPUTABLE | sans objet | cost basis, historique de flux | sans objet | pas de nombre |

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
3. Ajouter `biasDirection`, saisi à la main par le propriétaire du calcul. Trois valeurs
   suffisent.
4. Ajouter `completeness` avec des poids égaux à 1.
5. Ajouter la règle de précision d'affichage.
6. Ajouter les poids différenciés, seulement là où l'ordre de grandeur le justifie.

Les étapes 1 à 3 apportent l'essentiel de la valeur. Les étapes 4 à 6 affinent.

## 13. Points à soumettre à la review

1. Le seuil de matérialité de 10 % est-il le bon, ou faut-il un seuil absolu par domaine ?
2. La propagation par minimum est-elle trop conservatrice pour un agrégat à nombreux composants ?
3. Le barème de précision d'affichage doit-il s'appliquer aussi aux exports CSV et JSON, ou seulement à l'interface ?
4. `completeness` doit-il être persisté avec une clôture mensuelle, pour pouvoir dire plus tard « cette clôture était complète à 40 % » ?
5. Faut-il un statut intermédiaire entre PARTIAL et NOT_COMPUTABLE, par exemple STALE, pour une donnée présente mais périmée ?
