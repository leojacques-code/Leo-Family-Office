# Spécification d'Explain Calculation

Léo Family Office. Version 0.2 du 20 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
Base : commit `ef5bacf`. Aucun code n'est écrit ici.

## 1. Objet

Explain Calculation est la promesse différenciante la plus concrète du produit face à
Finary : tout chiffre affiché doit pouvoir être ouvert et justifié.

Le mécanisme existe déjà. `ExplanationPanel` dans `src/components/ui.tsx` affiche une
formule, une liste d'inputs avec leur badge de provenance, leur date et leur source, et
une note de lecture. Six métriques l'utilisent. La conception est bonne.

Le problème n'est pas le mécanisme, c'est son contenu : plusieurs panneaux affichent des
chaînes de caractères écrites dans le code, portant un badge ACTUAL et une date. Un
badge ACTUAL sur une constante est une affirmation fausse sur la nature de la donnée.
Un panneau d'explication qui ment est plus dommageable qu'une absence d'explication,
parce qu'il crée une confiance injustifiée.

Cette spécification décrit ce que chaque panneau doit contenir, et pour chaque grande
métrique, ce qu'il contient aujourd'hui.

## 2. Contrat d'une explication

Neuf champs. Les six premiers sont obligatoires.

| Champ | Obligatoire | Contenu |
|---|---|---|
| `formula` | oui | l'expression réellement évaluée, dans la notation du produit |
| `inputs` | oui | chaque terme de la formule, avec valeur, unité, provenance, date et source |
| `result` | oui | la valeur produite, avec son unité et sa précision d'affichage |
| `provenance` | oui | la provenance de l'agrégat lui-même, presque toujours DERIVED |
| `asOf` | oui | date d'observation à laquelle le calcul est valide |
| `completeness` | oui | statut, complétude, manquants, sens du biais, voir `COMPLETENESS_MODEL_SPEC.md` |
| `assumptions` | si applicable | hypothèses de modèle utilisées, avec leur provenance |
| `version` | recommandé | version de la formule, pour reproduire un résultat archivé |
| `reportingUnit` | recommandé | devise de reporting et taux utilisés le cas échéant |

### Cinq règles non négociables

1. Chaque valeur d'input est calculée depuis l'état, jamais écrite dans le code. Une
   explication qui ne se recalcule pas avec les données n'explique rien.
2. La provenance affichée est celle de la donnée réellement utilisée. Un ACTUAL sur une
   constante est interdit.
3. La formule affichée est celle qui a été évaluée. Si le moteur retranche un terme,
   la formule le montre.
4. Un input MISSING apparaît dans la liste, marqué MISSING, avec son effet sur le
   résultat. On n'explique pas seulement ce qu'on a utilisé, on explique aussi ce qu'on
   n'a pas eu.
5. Un résultat non calculable a quand même une explication : elle dit ce qui manque.

### Ce qu'une explication ne doit pas faire

- Reformuler le résultat en langage naturel sans montrer le calcul.
- Afficher une formule générale théorique différente de celle exécutée.
- Omettre une hypothèse de modèle parce qu'elle a une valeur par défaut.
- Présenter une convention comme une évidence. La convention est une hypothèse.

## 3. État des six panneaux existants

Vérifié au commit `ef5bacf`.

| Panneau | Fichier | Inputs dérivés | Verdict |
|---|---|---|---|
| Actifs bruts identifiés | `pages.tsx:305` | oui, construits depuis `state.accounts` | correct, à compléter |
| Patrimoine net identifié | `pages.tsx:306` | oui pour les deux inputs, note figée à « -1 173,51 € » | presque correct |
| Couverture de liquidité | `pages.tsx:307` | oui, mais la formule annonce « dépenses essentielles » et l'input passé est `monthlyExpenses` | formule et input divergent |
| Cash flow mensuel connu | `pages.tsx:307` | deux inputs dérivés, le troisième est la chaîne « 0,00 € avant le 5 décembre 2026 » | faux |
| Réconciliation des investissements | `pages.tsx:158` | trois chaînes figées avec badge ACTUAL | faux |
| Écart du prêt étudiant | `pages.tsx:171` | trois chaînes figées avec badge ACTUAL | faux |
| Amortissement à 0 % | `pages.tsx:173` | trois chaînes figées avec badge ACTUAL | faux |
| TRI immobilier | `pages.tsx:186` | oui, construits depuis `result.cashFlows` | correct |
| Monte-Carlo | `pages.tsx:251` | oui, construits depuis `projection` | correct, référence |

Trois panneaux sur neuf sont corrects. Le panneau Monte-Carlo est la référence à
imiter : formule réelle, simulations, seed, scénario et méthodologie, tous dérivés du
résultat effectivement produit.

Le panneau Cash flow est le seul dont un input contredit le résultat affiché
immédiatement au-dessus. C'est le finding UI-001 de `docs/UI_STATE_AUDIT.md`.

---

## 4. Spécification par métrique

Pour chaque métrique : formule cible, inputs, provenance attendue, hypothèses,
manquants, et écart avec l'implémentation actuelle.

### 4.1 Patrimoine net

FORMULA
    NetWorth(t) = GrossAssets(t) - Liabilities(t)

INPUTS
- `GrossAssets(t)` : DERIVED, daté, avec sa propre explication ouvrable. Somme des soldes
  positifs des comptes, plus la valeur brute des actifs non financiers quand ils existent
- `Liabilities(t)` : DERIVED, daté, avec sa propre explication ouvrable. Inclut les
  soldes bancaires débiteurs, traités en passif court terme, et les dettes adossées aux
  actifs financés
- toute equity dérivée (immobilière, business) est affichée pour information et
  explicitement marquée comme non sommable

PROVENANCE : DERIVED, confiance bornée par le minimum des deux composants.
ASSUMPTIONS : un solde bancaire débiteur est un passif court terme ; un actif financé
entre en valeur brute avec sa dette en passif, l'equity restant DERIVED et non sommable ;
périmètre limité aux actifs financiers, d'où le libellé « Actifs financiers identifiés » ;
devise unique EUR sans conversion.
MISSING : immobilier, business equity, autres actifs, tous hors périmètre.
COMPLETENESS : COMPLETE sur le périmètre déclaré, biais NONE, précision 2 décimales.
REPORTING UNIT : EUR, aucun taux appliqué.

ÉCART ACTUEL : la note du panneau contient « Ce chiffre vaut -1 173,51 € à la date
zéro », valeur figée. Les hypothèses de convention et de périmètre ne sont pas listées.

### 4.2 Actifs bruts

FORMULA
    GrossAssets(t) = Σ dernier solde connu de chaque compte actif, converti en EUR

INPUTS : un par compte, avec institution, solde, date du solde, provenance et source.
PROVENANCE : DERIVED.
ASSUMPTIONS : les positions expliquent les soldes et ne s'y ajoutent pas ; un solde
négatif est compté comme un actif de valeur négative.
MISSING : aucun taux de change appliqué ; aucun signal si un solde est ancien.
COMPLETENESS : COMPLETE sur le périmètre financier.

ÉCART ACTUEL : le panneau est correct sur les inputs. Il n'expose ni la convention de
non-double-comptage comme hypothèse, ni l'âge des soldes, ni l'absence de conversion.

### 4.3 Cash bancaire

FORMULA
    BankCash(t) = Σ solde des comptes dont la liquidité est immédiate

INPUTS : un par compte retenu, plus la liste des comptes exclus avec le motif.
PROVENANCE : DERIVED.
ASSUMPTIONS : le type de compte sert aujourd'hui de proxy à la liquidité ; le cash
logé dans une enveloppe (PEA, CTO) est exclu.
MISSING : le champ `liquidity` du modèle n'est pas utilisé ; un livret bloqué serait
compté à tort.
COMPLETENESS : COMPLETE.

ÉCART ACTUEL : aucun panneau dédié. Le cash bancaire est expliqué indirectement par le
panneau de couverture de liquidité. Lister les comptes exclus et le motif de leur
exclusion est le point le plus utile à ajouter : c'est là que se joue l'invariant
« le cash PEA n'est pas du cash bancaire », et l'utilisateur ne le voit nulle part.

### 4.3 bis Grandeurs de liquidité

Trois panneaux distincts, un par grandeur, conformément à `FINANCIAL_DEFINITIONS.md` §3.2.

`LiquidAssets` : formule `Σ actifs mobilisables sous 30 jours sans pénalité`. Inputs :
un par actif retenu, plus la liste des actifs exclus avec le motif d'exclusion, qui est
l'information la plus utile du panneau.

`NetLiquidityPosition30d` : formule `LiquidAssets - Σ engagements exigibles sous 30 jours`.
Inputs : `LiquidAssets` avec son explication ouvrable, plus le détail des engagements,
échéance par échéance.

`LiquidNetWorth` : formule `LiquidAssets - Σ Liabilities`. Le panneau doit dire
explicitement que cette grandeur est structurellement inférieure au patrimoine net dès
qu'un actif illiquide existe, et qu'un résultat négatif n'est pas une anomalie.

ÉCART ACTUEL : aucun de ces trois panneaux n'existe, et la métrique unique qui en tient
lieu est un alias de `NetWorth`.

### 4.4 Couverture de liquidité

FORMULA
    EmergencyCoverageMonths(t) = BankCash(t) / DépensesEssentiellesConnues(t)

Unité du résultat : mois.

INPUTS
- `BankCash(t)` : DERIVED
- somme des dépenses essentielles connues : DERIVED, avec le nombre de catégories
  essentielles renseignées sur le total
- liste nommée des catégories essentielles manquantes

PROVENANCE : DERIVED.
ASSUMPTIONS : seules les catégories marquées essentielles entrent au dénominateur ; le
service de dette n'y entre pas.
MISSING : 7 catégories essentielles sur 8 au seed : électricité, internet, téléphone,
assurance, transport, courses, santé.
COMPLETENESS : PARTIAL, 13 %, biais OVER. La couverture réelle est inférieure à celle
affichée, et le sens du biais doit être écrit en toutes lettres.
PRÉCISION : ordre de grandeur, une décimale au plus.

ÉCART ACTUEL, trois points :
1. La formule affichée annonce « dépenses essentielles mensuelles connues », l'input
   passé au panneau est `monthlyExpenses`, c'est-à-dire toutes les dépenses connues. Au
   seed les deux coïncident parce que la seule dépense renseignée est essentielle, ce
   qui masque la divergence. Elle apparaîtra dès la deuxième catégorie renseignée.
2. Le résultat est rendu par le formateur monétaire : « 0,31 € mois ».
3. Le sens du biais est mentionné en prose (« la couverture réelle est probablement
   inférieure ») mais n'est pas une donnée structurée.

C'est la métrique où la spécification apporte le plus de valeur immédiate : trois
défauts distincts, tous corrigibles sans toucher au moteur.

### 4.5 Cash-flow libre

FORMULA CIBLE
    FCF(t) = MonthlyIncome(t) - MonthlyExpenses(t) - Taxes(t) - DebtService(t)

La ligne Taxes apparaît même à zéro, sinon le résultat est un FCF avant impôt présenté
comme un FCF.

INPUTS
- revenus actifs, ligne par ligne, avec les sources inactives listées et leur motif
- dépenses connues, avec le compte de catégories renseignées
- taxes, aujourd'hui 0, MISSING plutôt que 0 tant qu'aucun moteur fiscal n'est branché
- service de dette exigible à la date `t`, avec pour chaque prêt sa contribution et la
  raison : exigible, en différé, échu

PROVENANCE : DERIVED.
ASSUMPTIONS : définition du service de dette pendant un différé, question ouverte Q-01.
MISSING : 19 catégories de dépense sur 20 ; l'impôt sur le revenu.
COMPLETENESS : PARTIAL, 5 %, biais UNDER.
PRÉCISION : ordre de grandeur.

ÉCART ACTUEL : le troisième input est la chaîne « 0,00 € avant le 5 décembre 2026 »,
alors que le moteur a retranché 284,72 €. Le panneau explique donc un calcul qui n'est
pas celui qui a produit le nombre affiché. Aucune ligne Taxes. Aucune complétude.

Point de méthode : ce panneau doit être corrigé même avant l'arbitrage sur le service
de dette. Quelle que soit la définition retenue, le panneau doit montrer ce que le
moteur fait.

### 4.6 Service de dette

FORMULA CIBLE
    DebtService(t) = Σ paiementContractuel_i(t)
                     pour les prêts tels que firstPaymentDate_i <= t <= maturityDate_i

INPUTS : par prêt, le nom, la mensualité contractuelle, la première échéance, la
maturité, et le statut de contribution : exigible, en différé, échu.
PROVENANCE : ACTUAL pour les termes du contrat, DERIVED pour l'agrégat.
ASSUMPTIONS : traitement du différé, partiel ou total ; assurance et frais non modélisés.
MISSING : assurance ; frais ; échéancier bancaire réel.
COMPLETENESS : PARTIAL tant que l'échéancier réel n'est pas importé, biais UNDER,
puisque l'assurance manquante ne peut qu'augmenter le décaissement.

ÉCART ACTUEL : aucun panneau dédié. La contribution de chaque prêt et son motif ne sont
visibles nulle part. C'est le panneau manquant le plus utile du produit : il rendrait
visible en un coup d'oeil la contradiction de Q-01.

### 4.7 Amortissement d'un prêt

FORMULA
    intérêt(k) = solde(k-1) × taux / 12
    principal(k) = min(solde(k-1), paiement - intérêt(k))
    solde(k) = solde(k-1) - principal(k)

INPUTS : capital, taux, nombre d'échéances, mensualité retenue, et surtout la source de
cette mensualité : contractuelle fournie par la banque, ou PMT théorique dérivée.
PROVENANCE : ACTUAL pour les termes, DERIVED pour l'échéancier.
ASSUMPTIONS : mensualité constante ; aucune assurance ; aucun frais ; aucun
remboursement anticipé ; dernière échéance plafonnée au solde restant.
MISSING : échéancier bancaire réel ; assurance ; frais.
COMPLETENESS : PARTIAL. Écart contractuel de 338,20 € non expliqué au seed.

ÉCART ACTUEL : le panneau existe et sa formule est juste. Ses trois inputs sont des
chaînes figées. Il n'indique pas laquelle des deux sources de mensualité a été retenue,
alors que c'est l'information la plus importante du panneau au regard de la priorité des
sources du business plan §6.1.

### 4.8 Écart contractuel

FORMULA
    ÉcartContractuel = (mensualité × nombre d'échéances) - capital emprunté

INPUTS : mensualité, nombre d'échéances, capital, tous ACTUAL avec leur source.
PROVENANCE : DERIVED.
ASSUMPTIONS : aucune. C'est une identité arithmétique.
MISSING : la cause de l'écart. Candidates à lister : assurance, frais de dossier,
nombre d'échéances erroné, capital réellement débloqué différent du capital nominal.
COMPLETENESS : le résultat est complet, sa cause est inconnue. C'est une distinction
qui doit apparaître : un calcul complet peut avoir une conclusion incomplète.

ÉCART ACTUEL : le panneau existe, ses inputs sont figés, et sa note est bonne :
« Aucune explication n'est supposée. » C'est exactement le bon ton.

### 4.9 Réconciliation d'un compte

FORMULA
    Gap(compte, t) = SoldeDéclaré(compte, t) - Σ ValeurPositions(compte, t)

INPUTS : solde déclaré avec sa date ; chaque position avec sa valeur et sa date ;
la tolérance appliquée.
PROVENANCE : DERIVED.
ASSUMPTIONS : le solde déclaré fait autorité pour le bilan ; aucune position n'est créée
pour absorber l'écart.
MISSING : la cause de l'écart.
COMPLETENESS : complet en calcul, cause inconnue.

ÉCART ACTUEL : les trois inputs sont figés. La tolérance de 0,01 € n'est pas exposée.
La note est excellente : « Le cash PEA est une position interne au PEA et n'est jamais
ajouté au cash bancaire. » Elle énonce un invariant à l'utilisateur, c'est le meilleur
usage possible de ce champ.

### 4.10 Projection Monte-Carlo

FORMULA
    A(t+1) = max(0, A(t) × (1 + r(t)) + épargne mensuelle)
    r(t) = (1 + rendement annuel)^(1/12) - 1 + (volatilité / √12) × z(t)
    z(t) suit une Student-t à 5 degrés de liberté, normalisée

INPUTS : actifs initiaux, scénario nommé et versionné, nombre de simulations, seed,
horizon.
PROVENANCE : ACTUAL pour les actifs initiaux, MODEL_ASSUMPTION pour le scénario.
ASSUMPTIONS à exposer, aujourd'hui absentes du panneau :
- la dette n'est pas décrémentée dans la projection ;
- l'épargne mensuelle est constante et sans lien avec le cash-flow constaté ;
- l'amplitude du stress rare est fixe, non paramétrable par scénario ;
- l'inflation n'entre pas dans les percentiles affichés ;
- `salaryGrowth` du scénario n'est pas consommé.
MISSING : aucun input manquant, mais cinq hypothèses structurantes non déclarées.
COMPLETENESS : le calcul est complet, le modèle est simplifié. Distinction à faire
apparaître.

ÉCART ACTUEL : le panneau est le meilleur du produit sur la forme, tous ses inputs sont
réels, et la méthodologie stockée avec le run est affichée. Il lui manque les cinq
hypothèses ci-dessus, dont la première est la plus importante : projeter un patrimoine
brut croissant à côté d'un patrimoine net négatif sans dire que la dette est absente du
modèle est trompeur.

### 4.11 Underwriting immobilier

FORMULA cible pour l'equity investie
    InvestedEquity = max(0, CoûtTotalProjet - MontantEmprunté)

FORMULA cible pour le MOIC
    MOIC = (Σ distributions + valeur résiduelle) / Σ contributions en equity

Les apports complémentaires, y compris le comblement d'un cash-flow négatif, entrent au
dénominateur et non en déduction du numérateur.

INPUTS : les seize hypothèses, chacune avec sa provenance, toutes USER_ASSUMPTION par
défaut ; les flux annuels ; le flux de sortie décomposé en prix de cession, frais de
vente, dette restante et fiscalité.
PROVENANCE : DERIVED pour les résultats, USER_ASSUMPTION pour toutes les entrées.
ASSUMPTIONS à exposer :
- l'assiette de la valeur de sortie : `postRenovationValue` quand elle est renseignée, prix d'achat sinon. Le coût des travaux et la valeur qu'ils créent sont deux entrées distinctes, jamais dérivées l'une de l'autre ;
- les charges annuelles sont constantes sur l'horizon ;
- la vacance s'applique au loyer initial seulement ;
- le taux d'imposition est un taux effectif unique, sans lien avec le moteur fiscal ;
- le service de dette est constant sur l'horizon, même après extinction du prêt.
MISSING : taxe foncière réelle, assurance propriétaire, provision CAPEX.
COMPLETENESS : PARTIAL, biais UNDER sur le rendement.
PRÉCISION : à dégrader, voir `COMPLETENESS_MODEL_SPEC.md` §8.

ÉCART ACTUEL : le panneau du TRI est correct sur la forme, ses trois inputs sont
dérivés. Il n'expose ni l'equity investie, ni les cinq hypothèses ci-dessus. L'equity
investie est le paramètre le plus déterminant du TRI et le seul actuellement faux : elle
devrait être le premier input du panneau.

### 4.12 Arbitrage rembourser ou investir

FORMULA
    intérêtsÉvités = capital × (1 + tauxDette)^t - capital
    valeurInvestie = capital × (1 + rendement)^t
    décoteDeRisque = capital × volatilité × √t × 0,25
    valeurLiquidité = capital × poidsLiquidité
    avantage = (valeurInvestie - capital) - intérêtsÉvités - décoteDeRisque + valeurLiquidité

INPUTS : capital arbitré et son origine ; taux de la dette et sa source ; rendement
espéré ; volatilité ; horizon ; inflation et son origine, scénario ou valeur par défaut.
ASSUMPTIONS à exposer, toutes actuellement invisibles :
- le coefficient de décote de risque vaut 0,25, il n'est pas sourcé ;
- le poids de liquidité vaut 0,03, il n'est pas sourcé ;
- le seuil de qualification du risque est à 15 % de volatilité ;
- l'inflation utilisée est 2 %, indépendamment du scénario sélectionné.
MISSING : la fiscalité des deux options ; le coût d'opportunité réel ; le downside.
COMPLETENESS : PARTIAL. Le business plan §13.1 exige que le Decision Lab n'arbitre pas
sur un seul critère.

ÉCART ACTUEL : aucun panneau d'explication. C'est le seul moteur du produit qui émet une
recommandation et le seul à n'offrir aucune explication. C'est aussi le seul moteur sans
test. La priorité proposée est simple : tant qu'il n'y a pas de panneau, il ne devrait
pas y avoir de recommandation.

---

## 5. Priorités

Classées par gain de crédibilité rapporté au coût.

1. Corriger les quatre panneaux dont les inputs sont figés. Les données existent toutes
   dans `state`. Aucune modification de moteur. Zone verte.
2. Corriger le panneau du cash-flow, qui affirme un input contraire au calcul exécuté.
3. Déclarer `modelSimplifications` sur les cinq moteurs existants. C'est du texte écrit
   par le propriétaire du moteur, sans code, et cela révèle immédiatement les cas où un
   résultat complet est structurellement inadapté.
4. Ajouter le panneau manquant du service de dette, par prêt, par échéance exigible et
   par motif de contribution nulle.
5. Ajouter les trois axes de fiabilité aux panneaux existants : complétude, confiance,
   incertitude de modèle, avec le sens du biais.
6. Ajouter un panneau à l'arbitrage du Decision Lab, ou retirer sa recommandation.
7. Exposer l'equity investie et le détail du MOIC dans le panneau immobilier.

Les points 1 à 3 se traitent dans la lane de Léo, sans toucher aux moteurs.

## 6. Points à soumettre à la review

1. Faut-il exposer `version` de formule dès la V1, ou seulement quand un résultat sera archivé dans une clôture ? La décision de versionnage des clôtures (INV-J-01) rend la question plus pressante : une clôture en version 2 doit pouvoir dire avec quelle version de formule elle a été produite.
2. Une explication doit-elle être exportable, par exemple dans le backup JSON, pour qu'un tiers puisse rejouer le calcul ?
3. Les hypothèses de modèle doivent-elles apparaître dans le panneau principal ou dans un second niveau ? Le panneau Monte-Carlo en aurait cinq, ce qui alourdit.
4. Un panneau doit-il exister pour un résultat NOT_COMPUTABLE, ou le message « non calculable » suffit-il ?
