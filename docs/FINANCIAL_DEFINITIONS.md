# Définitions financières canoniques

Léo Family Office. Version 0.2 du 20 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
Date zéro de référence : 2026-08-19. Devise de reporting : EUR.

## Statut de ce document

STATUT : PROVISOIRE, EN ATTENTE DE REVIEW (Checkpoint 1, GPT-5.6 Sol).

Ce fichier n'existait pas au moment d'exécuter le plan de développement du 20 août.
Le plan (§4, « Gate avant de commencer ») le liste pourtant comme prérequis de
`docs/DATA_INVARIANTS.md`, et §13 en fait le Checkpoint 1. Un registre d'invariants
sans définitions canoniques n'est pas auditable : un invariant ne peut contraindre
qu'une grandeur nommée. Ce document a donc été rédigé pour fermer ce gate, et non
parce qu'il figurait dans les tâches du jour.

Conséquence à respecter : tant que ce fichier n'est pas relu, aucun invariant financier
de `DATA_INVARIANTS.md` ne doit être considéré comme définitif, et aucune correction de
moteur ne doit s'y référer comme à une vérité stabilisée.

Sources utilisées pour rédiger ce document :

| Source | Nature | Usage ici |
|---|---|---|
| `docs/ENGINE_AUDIT.md` (commit `ee0d16d`) | audit statique interne | état constaté des formules |
| Code du dépôt au commit `ef5bacf` | source primaire | formules réellement exécutées |
| `LEO_FAMILY_OFFICE_BUSINESS_PLAN_COMPLET_COLLABORATEURS_20260820.pdf` | PDF natif, 35 pages, texte extrait | définitions cibles |
| `Beyonder_Business_Plan` (PDF natif, 7 pages) | contexte écosystème | contraintes de provenance |
| Exécution de `npx vitest run` le 20 août 2026 | mesure directe | 25 tests, 24 verts, 1 rouge |

## 1. Convention de lecture

Chaque définition porte trois lignes distinctes qu'il ne faut jamais confondre :

- DÉFINITION CIBLE : ce que la grandeur doit signifier dans LFO.
- ÉTAT DU CODE : ce que le code calcule aujourd'hui.
- ÉCART : la différence, quand elle existe, et son propriétaire.

Une définition dont l'écart n'est pas nul ne doit pas être affichée à l'utilisateur
sous son nom cible tant que l'écart n'est pas fermé ou explicitement étiqueté.

Notation :
- `t` : instant d'observation, toujours daté.
- Toute somme est exprimée en devise de reporting après conversion FX datée.
- « connu » qualifie un agrégat calculé sur les seules lignes non MISSING.

## 2. Bilan patrimonial

### 2.1 Gross Assets (actifs bruts)

DÉFINITION CIBLE
Somme, à la date `t`, de la valeur de marché de tous les actifs détenus, convertie en
devise de reporting au taux daté de `t`, chaque actif compté exactement une fois.

    GrossAssets(t) = Σ FinancialAssets(t) + Σ RealEstateValue(t)
                   + Σ BusinessEquityValue(t) + Σ OtherAssets(t)

Règle de non-double-comptage : un compte d'investissement entre par son solde de compte
OU par la somme de ses positions, jamais par les deux. La convention LFO retenue est
le solde de compte, les positions servant d'explication.

Convention canonique de bilan, arrêtée au Checkpoint : un actif financé entre en
**valeur brute**, la dette adossée entre en **passif**, et l'equity correspondante est
une grandeur **DERIVED** qui n'est jamais additionnée en plus. Un bien valorisé
220 000 € financé par 180 000 € d'emprunt contribue 220 000 € à `GrossAssets` et
180 000 € à `Liabilities` ; `RealEstateEquity` vaut 40 000 € en dérivé, affichable,
jamais sommable. La même règle s'applique au business equity. Voir INV-A-07.

Décision de libellé : tant que `GrossAssets` ne contient que des actifs financiers, la
grandeur s'affiche **« Actifs financiers identifiés »**. Le terme « Patrimoine brut »
est réservé au périmètre complet.

ÉTAT DU CODE
`calculateNetWorth` (`src/lib/engine/financial.ts:93`) somme `account.balance` sur tous
les comptes actifs. Les positions ne sont pas ajoutées. Immobilier, business equity et
autres actifs ne sont pas dans le périmètre : les tables existent, aucun code ne les lit.

ÉCART
1. Périmètre : seuls les actifs financiers sont couverts, et le libellé affiché est
   « Patrimoine brut », qui surdéclare. Le libellé canonique est « Actifs financiers
   identifiés ».
2. Un compte débiteur (-3,44 € au seed) est compté comme un actif de valeur négative.
   La convention canonique en fait un passif court terme (voir §2.4).
3. Aucune conversion FX : voir §7.
4. Aucune règle d'entrée au bilan pour un actif financé : les tables `properties` et
   `mortgages` existent et ne sont jamais lues.
Propriétaires : Léo pour le libellé et la sémantique, Paul pour les dérivations, Tom
pour la persistance des actifs non financiers.

### 2.2 Liabilities (dettes)

DÉFINITION CIBLE
Somme des capitaux restant dus à la date `t`, hors intérêts futurs non courus, chaque
dette au capital effectivement dû et non au capital nominal d'origine.

    Liabilities(t) = Σ LoanBalance_i(t)

ÉTAT DU CODE
Somme de `liability.currentBalance`. Au seed, `currentBalance = principal = 16 745 €`
parce qu'aucun remboursement n'a eu lieu avant la première échéance du 5 décembre 2026.

ÉCART
`currentBalance` n'est jamais recalculé depuis un échéancier. Il restera figé à
16 745 € même après plusieurs échéances payées, tant qu'aucune écriture ne le met à
jour. Propriétaire : Paul (Debt Engine).

### 2.3 Net Worth

DÉFINITION CIBLE

    NetWorth(t) = GrossAssets(t) - Liabilities(t)

ÉTAT DU CODE
Conforme. Valeur au seed : 15 571,49 - 16 745 = -1 173,51 €.

RÈGLE D'ARRONDI CANONIQUE, arrêtée au Checkpoint
Les calculs internes s'effectuent en **pleine précision**, sans arrondi intermédiaire.
L'arrondi n'intervient qu'à deux frontières :
- la **restitution** : affichage, export, rapport ;
- le **contrat** : montant d'une échéance effectivement débitée, montant facturé.

Motif : arrondir à chaque agrégation dégrade la précision sur les calculs itératifs, un
échéancier de 240 lignes en premier. Ne jamais arrondir laisse fuir des artefacts de
représentation binaire jusqu'à l'écran. Arrondir aux deux seules frontières où un
montant devient un engagement ou une information résout les deux problèmes.

Corollaire de test : toute comparaison de montants utilise une tolérance déclarée.

ÉCART
Le calcul rend -1 173,5100000000002 en interne, ce qui est **correct** au regard de la
règle. Le test `financial.test.ts:40` compare par `toEqual` strict et échoue : le défaut
est dans le test, pas dans la formule. Constat vérifié par exécution directe le
20 août 2026. C'est le seul test rouge du dépôt. Propriétaire : Paul.

### 2.4 Convention d'un compte bancaire débiteur

DÉFINITION CANONIQUE, arrêtée au Checkpoint
Un solde bancaire débiteur est un **passif court terme** (découvert). Il entre dans
`Liabilities`, jamais dans `GrossAssets`. `GrossAssets` est donc la somme des soldes
**positifs** des comptes.

    GrossAssets(t)  = Σ solde(compte) pour solde > 0
    Liabilities(t)  = Σ capital restant dû + Σ |solde(compte)| pour solde < 0

Motif du choix : un découvert est économiquement une dette, souvent la plus chère du
bilan. Le traiter en actif négatif préserve une additivité de façade au prix d'une
fausse représentation, et le rend invisible dans toute analyse de passif ou de
liquidité. `NetWorth` est inchangé par le choix : seule la présentation du bilan
diffère.

ÉTAT DU CODE : convention opposée, implicite, jamais documentée. Le solde de -3,44 €
est agrégé dans `GrossAssets`.

ÉCART : impact chiffré actuel 3,44 €, donc négligeable en valeur, structurant en
définition et bloquant dès qu'un découvert autorisé de plusieurs milliers d'euros
apparaît. Propriétaires : Léo pour la sémantique, Paul pour la dérivation.

## 3. Liquidité

### 3.1 Bank Cash

DÉFINITION CIBLE
Somme des soldes des comptes dont la liquidité est immédiate et dont les fonds sont
mobilisables sans contrainte d'enveloppe fiscale ni de délai de règlement.

ÉTAT DU CODE
`bankCash = Σ comptes de type BANK ou SAVINGS`. Le cash logé dans un PEA ou un CTO est
exclu. Valeur au seed : 354,08 €.

ÉCART
Aucun écart de formule. Écart de nommage : le type de compte sert de proxy à la
liquidité alors que le champ `liquidity` existe déjà sur `FinancialAccount` et n'est
pas utilisé pour ce calcul. Un livret bloqué typé SAVINGS entrerait à tort dans le
cash disponible. Propriétaire : Paul.

### 3.2 Trois grandeurs de liquidité, à ne jamais confondre

DÉFINITIONS CANONIQUES, arrêtées au Checkpoint
Trois grandeurs distinctes, trois noms, trois usages. Aucune n'est un alias d'une autre,
aucune n'est un alias de `NetWorth`.

    LiquidAssets(t)            = Σ actifs mobilisables sous 30 jours
                                 sans pénalité ni perte de valeur significative

    NetLiquidityPosition30d(t) = LiquidAssets(t)
                                 - Σ engagements exigibles dans les 30 jours

    LiquidNetWorth(t)          = LiquidAssets(t) - Σ Liabilities(t)

| Grandeur | Question à laquelle elle répond | Usage |
|---|---|---|
| `LiquidAssets` | de quoi puis-je disposer rapidement ? | stock, base des deux autres |
| `NetLiquidityPosition30d` | puis-je payer ce qui tombe ce mois-ci ? | pilotage de trésorerie |
| `LiquidNetWorth` | que resterait-il si je soldais tout avec mes seuls actifs liquides ? | résilience, stress |

`LiquidNetWorth` est structurellement inférieur à `NetWorth` dès qu'il existe un actif
illiquide, et il peut être négatif alors que le patrimoine net est largement positif.
C'est attendu, et c'est précisément l'information qu'il porte.

EXEMPLE
Cash 2 000, PEA mobilisable 20 000, bien immobilier 220 000, prêt 180 000 dont 900
exigibles dans les 30 jours. `LiquidAssets` = 22 000. `NetLiquidityPosition30d` = 21 100.
`LiquidNetWorth` = -158 000. `NetWorth` = 62 000. Quatre nombres, quatre sens.

ÉTAT DU CODE
Une seule métrique existe, `liquidNetWorth = grossAssets - debt`, soit exactement
`netWorth`. La notion de liquidité n'intervient nulle part. Les deux autres grandeurs
n'existent pas.

ÉCART
BLOQUANT au sens de la définition : la métrique existante porte un nom qui affirme une
information de liquidité qu'elle ne contient pas. Elle doit être remplacée par les trois
grandeurs ci-dessus, dont le calcul suppose de qualifier la liquidité de chaque actif,
c'est-à-dire d'exploiter enfin le champ `liquidity` de `FinancialAccount`.
Propriétaires : Léo pour la sémantique et les libellés, Paul pour les trois dérivations.

### 3.3 Emergency Coverage (couverture de la réserve)

DÉFINITION CIBLE

    EmergencyCoverageMonths(t) = LiquiditéMobilisable(t) / DépensesIncompressiblesMensuelles(t)

Unité : mois. Ce n'est pas un montant.

ÉTAT DU CODE
`bankCash / Σ dépenses essentielles connues`. Au seed : 354,08 / 1 140 = 0,3106 mois.

ÉCART
1. Le dénominateur ne contient que le loyer, seule dépense essentielle renseignée.
   La couverture réelle est donc surestimée, pas sous-estimée : ajouter des dépenses
   essentielles fera baisser le ratio.
2. Le dénominateur ignore le service de dette, qui est pourtant incompressible.
3. L'interface affiche cette valeur avec le composant `<Currency>`, donc « 0,31 € ».
   Erreur d'unité visible par l'utilisateur (voir `UI_STATE_AUDIT.md`, finding UI-002).
Propriétaire : Paul pour 1 et 2, Léo pour 3.

## 4. Flux et cash-flow

### 4.1 Monthly Income

DÉFINITION CIBLE
Somme des revenus nets récurrents actifs à la date `t`, hors revenus exceptionnels et
hors revenus dont la date de début est future ou inconnue.

ÉTAT DU CODE
Conforme : `Σ income.monthlyNet` filtré sur `income.active`. Le revenu « professeur de
tennis » (130 €) est inactif faute de date de début : comportement correct et conforme
à la doctrine « ne jamais activer sans date réelle ».

### 4.2 Monthly Expenses (connues)

DÉFINITION CIBLE
Somme des dépenses mensuelles récurrentes dont le montant est renseigné. Aucune
substitution, aucune moyenne implicite, aucune estimation pour les catégories MISSING.

ÉTAT DU CODE
Conforme. Au seed : 1 140 € (loyer seul, 1 catégorie sur 20 renseignée).

ÉCART
Aucun sur la formule. Le nom affiché doit impérativement porter « connues » : la valeur
n'est pas une dépense mensuelle, c'est une borne inférieure des dépenses mensuelles.

### 4.3 Monthly Debt Service

DÉFINITION CANONIQUE, arrêtée au Checkpoint

    DebtService(période) = Σ LoanScheduleEntry.totalCashOut
                           pour toute échéance dont la date d'exigibilité
                           tombe dans la période

    totalCashOut = interest + principal + insurance + fees

La définition passe par l'**échéancier**, pas par une fenêtre de dates appliquée à un
champ `monthlyPayment`. Trois conséquences en découlent, sans qu'aucune soit un cas
particulier à coder :

| Situation | Ce que porte l'échéancier | DebtService |
|---|---|---|
| avant la première échéance | aucune ligne exigible | 0 |
| différé total | lignes à `totalCashOut` nul, ou absence de ligne | 0 |
| différé partiel | lignes portant les intérêts intercalaires | intérêts réellement exigibles |
| amortissement | lignes complètes | intérêt + principal + assurance + frais |
| après la dernière échéance | aucune ligne exigible | 0 |

Assurance et frais sont inclus dès lors qu'ils existent. Le cash-out est le montant
réellement débité, pas la somme intérêt plus principal.

Motif du choix : définir le service de dette par une fenêtre appliquée à une mensualité
unique oblige à traiter le différé, la maturité, les paliers et l'assurance comme autant
d'exceptions. Le définir par l'échéancier supprime les exceptions, parce que
l'échéancier porte déjà l'information. C'est aussi la seule définition compatible avec
la priorité des sources du business plan §6.1, où un échéancier bancaire importé fait
autorité.

ÉTAT DU CODE
`Σ monthlyPayment` filtré sur `firstPaymentDate <= "2027-08-19"`. La borne est une
constante littérale, pas une dérivation de la date zéro, et la maturité n'est pas
testée. Au seed, le prêt étudiant (première échéance 2026-12-05) est donc compté
dès la date zéro : 284,72 €.

ÉCART
BLOQUANT, et double. D'une part le modèle ne porte pas d'échéancier lisible : la table
`loan_schedules` est écrite au seed et jamais relue, et `AmortizationRow` n'a ni
`insurance`, ni `fees`, ni `totalCashOut`. La définition canonique n'est donc pas
calculable en l'état. D'autre part trois définitions coexistent dans le produit :
- moteur : 284,72 € comptés dès le 19 août 2026 ;
- explication affichée à l'utilisateur : « Service de dette actuel : 0,00 € avant le
  5 décembre 2026 » (`pages.tsx:307`) ;
- `docs/ASSUMPTIONS.md` : « La mensualité étudiante n'entre dans le cash flow exigible
  qu'à partir du 5 décembre 2026 », et annonce un cash-flow de +142 €/mois.
Le produit affiche -142,72 €/mois en le libellant « avant échéance du prêt ».
L'arbitrage est rendu : la définition canonique ci-dessus fait foi, et la valeur juste au
19 août 2026 est 0 € de service de dette, donc +142 € de cash-flow libre avant impôt.
Propriétaires : Paul pour la dérivation et les tests, Tom pour le modèle
`LoanScheduleEntry` et sa persistance. Voir `OPEN_QUESTIONS.md` Q-01, fermée.

### 4.4 Free Cash Flow personnel

DÉFINITION CIBLE

    FCF(t) = MonthlyIncome(t) - MonthlyExpenses(t) - Taxes(t) - DebtService(t)

Les taxes doivent apparaître explicitement même à zéro, sinon le FCF affiché est un
FCF avant impôt présenté comme un FCF.

ÉTAT DU CODE
`freeCashFlow = monthlyIncome - monthlyExpenses - monthlyDebtService`. Aucune ligne
Taxes. Au seed : 1 282 - 1 140 - 284,72 = -142,72 €.

ÉCART
1. Statut fiscal du FCF non étiqueté : c'est un FCF avant impôt sur le revenu.
2. Hérite intégralement de l'écart §4.3.
3. La valeur repose sur 1 catégorie de dépense sur 20 : elle est structurellement
   surestimée, et devrait porter un drapeau d'incomplétude bloquant (voir
   `COMPLETENESS_MODEL_SPEC.md`).

### 4.5 Savings Rate et Investment Rate

DÉFINITIONS CANONIQUES, arrêtées au Checkpoint
Ce sont des **métriques de flux constatés**, lues dans le ledger de flux :

    SavingsRate(période)    = épargne effectivement constituée sur la période
                              / revenu net encaissé sur la période

    InvestmentRate(période) = montant effectivement investi sur la période
                              / revenu net encaissé sur la période

Décision explicite : **tant que le ledger de flux n'existe pas, ces deux métriques sont
NOT_COMPUTABLE**. Elles ne sont approximées ni par le free cash flow, ni par une
capacité d'épargne théorique, ni par une différence entre deux soldes.

Motif : le FCF est une capacité, l'épargne est un fait. Un mois à FCF positif où tout a
été dépensé a un taux d'épargne nul. Proxifier revient à afficher une intention sous le
nom d'un constat, ce que le produit s'interdit partout ailleurs. Second motif :
`max(0, FCF) / revenu` est mathématiquement identique à `FCF / revenu` dès que le FCF est
positif, donc deux métriques affichées pour une seule information.

EXEMPLE
Revenu net 3 000, dépenses 1 600, FCF 1 400, aucun virement d'épargne ni achat de titres
sur la période. `SavingsRate` = 0 %, `InvestmentRate` = 0 %, pas 46,7 %. Autre cas :
500 versés sur le PEA dont 300 investis en titres et 200 laissés en cash PEA.
`SavingsRate` = 16,7 %, `InvestmentRate` = 10,0 %.

ÉTAT DU CODE
- `savingsRate = freeCashFlow / monthlyIncome`, non borné : -11,1 % au seed.
- `investmentRate = max(0, freeCashFlow) / monthlyIncome`, soit 0 au seed.

ÉCART
Les deux métriques sont des proxys du FCF, ce que la définition canonique interdit
explicitement. `shared.test.ts` verrouille par ailleurs ce comportement, donc verrouille
le proxy. Propriétaires : Léo pour l'état non calculable, Paul pour les formules, Tom
pour le ledger de flux dont elles dépendent.

## 5. Investissements

### 5.1 Invested Assets

DÉFINITION CIBLE
Valeur de marché des positions détenues hors cash, tous comptes confondus.

ÉTAT DU CODE
`Σ position.value` pour `isCash = false`. Au seed : 8 698 + 214,28 = 8 912,28 €.

ÉCART
Le périmètre diffère de « solde des comptes d'investissement » (15 003,13 + 214,28 =
15 217,41 €) sans que l'interface ne le signale. Deux nombres légitimes, deux
définitions, un seul libellé. Propriétaire : Léo (libellés), Paul (exposition).

### 5.2 Performance et enrichissement

DÉFINITION CIBLE (règle fondamentale du business plan §9)
Performance ≠ enrichissement. Les versements, retraits et transferts internes doivent
être exclus du calcul de performance.

    PerformanceMarché = ΔValeur - Contributions + Retraits

Les métriques cibles sont TWR (indépendant des flux, pour juger l'allocation) et XIRR
(pondéré par les flux, pour juger le résultat investisseur). Les deux, pas l'un des deux.

ÉTAT DU CODE
Aucun calcul de performance n'existe. Ce qui est affiché est constitué de constantes :
« Plus-value PEA annoncée 703,12 € », « Versements annoncés 14 300 € », « Performance
affichée +77,71 % » sur le CTO. Ces trois valeurs sont écrites en dur dans
`pages.tsx:156-157`, et la dernière n'est dérivable d'aucune donnée du système : le CTO
n'a pas de cost basis (`cost_basis = NULL`).

ÉCART
BLOQUANT en présentation : un pourcentage de performance affiché sans base de calcul
est une donnée inventée au sens de la doctrine LFO. Propriétaire : Léo, immédiat.

### 5.3 Réconciliation d'un compte d'investissement

DÉFINITION CIBLE

    Gap(compte, t) = SoldeDéclaré(compte, t) - Σ ValeurPositions(compte, t)

Un gap non nul au-delà de la tolérance est une anomalie ouverte, pas une position à
créer. Le solde déclaré reste la valeur comptable.

ÉTAT DU CODE
Conforme, et c'est un point fort du produit. Au seed : 15 003,13 - (8 698 + 6 304,57)
= 0,56 €, exposé en alerte et en callout. Tolérance affichée : 0,01 €.

ÉCART
Le calcul vit dans l'interface (`InvestmentsPage`), pas dans un moteur testable, et
identifie les comptes par identifiant littéral `"acc_pea"` / `"acc_cto"`.
Propriétaire : Paul (extraction moteur), Léo (spécification).

### 5.4 Multiples de retour sur equity

DÉFINITION CANONIQUE DU MOIC, arrêtée au Checkpoint

    MOIC = (Σ distributions encaissées + valeur résiduelle à la date d'évaluation)
           / Σ contributions en equity

Le dénominateur comprend **toutes** les contributions, y compris les apports
complémentaires postérieurs à l'investissement initial : appels de fonds, comblement de
cash-flow négatif, CAPEX non financé, refinancement à la charge de l'investisseur.

Règle de signe, qui est le point où l'erreur se produit : un flux périodique négatif
n'est pas une distribution négative. C'est une **contribution supplémentaire**. Il va au
dénominateur, il ne se retranche pas du numérateur.

La valeur résiduelle rend le multiple interprétable avant la sortie, sur un projet non
liquidé. Elle vaut 0 après cession complète.

EXEMPLE
Equity initiale 30 000, flux annuels -3 000 puis -3 000, sortie nette +80 000.
Contributions = 30 000 + 3 000 + 3 000 = 36 000. Distributions = 80 000. Valeur
résiduelle = 0. MOIC = 80 000 / 36 000 = **2,22**. Ni 2,47, qui netterait les
contributions au numérateur, ni 2,67, qui les ignorerait.

ÉTAT DU CODE
`moic(totalDistributions, investedCapital)` est appelé depuis `real-estate.ts` avec
`totalPositiveFlows`, c'est-à-dire `Σ max(0, flux)`. Les flux négatifs sont donc écartés
du numérateur sans rejoindre le dénominateur : c'est la variante la plus optimiste des
trois. Le dénominateur `investedEquity` est par ailleurs faux, voir INV-E-01.

ÉCART
Deux erreurs cumulatives, qui jouent dans le même sens sur le numérateur et dans le sens
inverse sur le dénominateur. Le MOIC affiché n'est donc comparable à rien.
Propriétaire : Paul, `financial.ts:moic` et `real-estate.ts:87`.

Note : TRI et VAN ne sont pas redéfinis ici, leurs définitions standard sont correctes
dans le code. Seul leur dénominateur d'equity est en cause, traité par INV-E-01.

## 6. Dette

### 6.1 Priorité des sources d'échéancier

DÉFINITION CIBLE (business plan §6.1)

| Niveau | Source | Comportement |
|---|---|---|
| 1 | échéancier bancaire contractuel importé | prioritaire, normalisé, source conservée |
| 2 | contrat sans échéancier | générer un échéancier DERIVED |
| 3 | données incomplètes ou incohérentes | drapeau de réconciliation, ne jamais inventer |

Un échéancier de niveau 1 ne doit jamais être écrasé par un calcul de niveau 2.

ÉTAT DU CODE
`amortizeLoan(principal, rate, payments, contractualPayment?)` accepte une mensualité
contractuelle et l'utilise si elle est fournie : le mécanisme de priorité existe au
niveau de la mensualité. En revanche il n'existe aucun mécanisme d'import d'un
échéancier ligne à ligne, la table `loan_schedules` est écrite au seed et jamais relue,
et `DebtPage` recalcule l'échéancier côté client à chaque affichage.

ÉCART
Deux échéanciers coexistent (base et recalcul client) sans réconciliation. Le niveau 1
n'est pas implémentable aujourd'hui. Propriétaire : Paul.

### 6.2 Écart contractuel

DÉFINITION CIBLE

    ÉcartContractuel = (mensualité × nombre d'échéances) - capital emprunté

Un écart positif à taux 0 % n'a pas d'explication mécanique : il révèle soit des frais,
soit une assurance, soit une donnée déclarée fausse. Il doit rester ouvert.

ÉTAT DU CODE
Calculé dans l'interface. Au seed : 284,72 × 60 - 16 745 = 338,20 €. Exposé en alerte
HIGH et en callout. Comportement conforme à la doctrine.

ÉCART
Le calcul est dans l'UI, pas dans un moteur. Le statut « RECONCILIATION REQUIRED »
demandé par le business plan §6.2 n'existe pas comme état de donnée : c'est un texte.

### 6.3 Principal, intérêt et cash-out

DÉFINITION CIBLE
Trois grandeurs distinctes qui ne doivent jamais être confondues :
- Intérêt : charge économique de la période, réduit le patrimoine net.
- Principal : au moment du paiement, la trésorerie et le passif diminuent simultanément
  du même montant. Le remboursement de principal est donc **neutre sur le patrimoine
  net**.
- Cash-out : intérêt + principal + assurance + frais, ce qui sort effectivement du compte.

Formulation comptable, et non métaphorique : il n'y a pas de « transfert vers le
patrimoine net », les deux jambes de l'écriture s'annulent. Un remboursement de principal
n'est pas une charge, mais c'est bien une sortie de trésorerie. La distinction compte
pour l'attribution de variation, où le principal apparaît comme un poste à somme nulle
entre trésorerie et dette, pas comme un enrichissement.

ÉTAT DU CODE
`amortizeLoan` produit `payment`, `interest`, `principal`, `closingBalance`. Assurance
et frais n'existent pas dans le modèle. Le cash-out est donc structurellement
sous-estimé pour tout prêt assuré.

ÉCART
Modèle `Liability` sans assurance ni frais. Propriétaire : Paul.

## 7. Multi-devises

DÉFINITION CIBLE
Toute valeur porte une devise native. Aucune valeur n'entre dans un agrégat exprimé en
devise de reporting sans conversion par un taux daté, dont la source et la date sont
conservées. Un taux non disponible produit un MISSING, pas une conversion implicite à 1.

ÉTAT DU CODE
`fxConvert(amount, eurPerUnit)` existe, est testé, et n'est appelé nulle part.
`deriveMetrics` additionne `account.balance` sans regarder `account.currency`. Le
formulaire d'ajout de compte accepte n'importe quel code de 3 lettres.

ÉCART
BLOQUANT dès qu'un compte non-EUR est saisi : la valeur est comptée à 1 pour 1.
Aucune barrière, aucun avertissement. Le CTO contient déjà une ligne « Physical Gold
USD » selon `docs/DATA_VERIFICATION.md`, agrégée en euros. Propriétaire : Paul.

## 8. Temporalité

### 8.1 ACTUAL, hypothèse et scénario

DÉFINITION CIBLE
- Un ACTUAL est une observation datée. Il n'est jamais modifié par un scénario.
- Un scénario n'exprime que des hypothèses portant sur des dates postérieures à la
  date zéro.
- Modifier une hypothèse ne réécrit jamais un historique.

ÉTAT DU CODE
Conforme au niveau du stockage : les scénarios sont des lignes séparées, versionnées
(`scenario_versions`), et le Monte-Carlo lit le scénario sans écrire dans les données
ACTUAL. `applyScenarioOverrides` est pur et testé pour la non-mutation.

ÉCART
Le champ `shockYear` est un entier relatif à l'année 1 de la projection, pas une année
civile. Un utilisateur qui saisit « 2 » en pensant « 2028 » obtient un choc en 2027.
Aucune unité n'est affichée.

DÉCISION CANONIQUE : remplacer conceptuellement `shockYear` par une **date d'effet**
(`shockDate`) ou une **période d'effet** (`effectiveFrom`, `effectiveTo`). Motif : un
entier relatif change de sens dès que la date d'observation bouge, ce qui rend deux
projections lancées à des dates différentes non comparables. Une date est stable et
alignable sur un événement réel. Propriétaires : Léo pour la sémantique et le libellé,
Paul pour le moteur, Tom pour la migration de colonne.

### 8.2 Monthly Close

DÉFINITION CANONIQUE, arrêtée au Checkpoint
Une clôture mensuelle est une photographie figée. Le mécanisme retenu est la
**réouverture explicite avec versionnage** :

1. une clôture existante ne peut pas être remplacée par une nouvelle clôture ;
2. elle doit d'abord être **rouverte** par une opération distincte et tracée, portant
   auteur, date et motif ;
3. la reclôture crée alors une **version supplémentaire** ;
4. **toutes les versions sont conservées**, aucune n'est supprimée ni modifiée ; la
   version courante est désignée, les autres restent consultables.

Le refus strict a été écarté : une correction de solde postérieure à une clôture est un
cas normal, pas une anomalie, et interdire la reclôture pousserait à ne pas corriger. Le
versionnage autorise la correction tout en conservant ce que le système affirmait à
chaque instant, ce qui est la propriété réellement recherchée.

    Variance(mois) = NetWorthConstaté(mois) - NetWorthPrévu(mois)

où « prévu » désigne la projection produite **avant** le mois, jamais la clôture
précédente. `forecast_net_worth` contient donc une vraie prévision future, avec la trace
du scénario et de la version utilisés ; en l'absence de projection préalable, le champ
reste MISSING plutôt que d'être rempli par défaut. La variation entre deux clôtures est
une grandeur distincte, qui porte son propre nom.

ÉTAT DU CODE
`create_monthly_close` fait un UPSERT sur `(user_id, close_date)` : relancer la clôture
d'un mois déjà clos écrase silencieusement la ligne précédente. Le champ
`forecast_net_worth` reçoit le `netWorth` de la clôture précédente, pas une prévision.
`variance` mesure donc une variation, pas un écart au plan.

ÉCART
1. Écrasement silencieux : viole la définition de « figé ». Aucune notion de version,
   aucune opération de réouverture.
2. Le champ `forecast_net_worth` contient la clôture précédente, pas une prévision.
   L'interface promet « Écart réel vs prévu » alors que le système calcule « écart au
   mois précédent ».
3. La clôture ne fige que trois agrégats, ce qui rend toute attribution de variation
   ultérieure impossible.
Propriétaires : Tom pour le modèle de versionnage et les repositories, Léo pour la
sémantique de la réouverture, Paul pour la source de la prévision.

## 9. Projection et distribution

### 9.1 Deux moteurs, deux trajectoires

ÉTAT DU CODE
- `deterministicProjection` : pas annuel, épargne ajoutée en fin d'année, exécuté
  uniquement côté client dans `TodayPage`, jamais persisté.
- `runMonteCarlo` : pas mensuel, épargne ajoutée chaque mois, exécuté par
  `POST /api/projection`, persisté.

À paramètres identiques, les deux moteurs ne produisent pas la même trajectoire, et
aucun texte ne l'explique à l'utilisateur.

DÉCISION CANONIQUE, arrêtée au Checkpoint
La projection déterministe est **conservée** : elle a une valeur d'explicabilité que la
distribution n'a pas, et le cockpit a besoin d'une trajectoire lisible sans lancer 3 000
simulations. Elle doit consommer le **même moteur de bilan mensuel** que le
Monte-Carlo, exécuté à volatilité nulle et sans stress.

Propriété vérifiable qui en découle : à volatilité 0 et probabilité de stress 0, la
trajectoire déterministe et le P50 coïncident exactement, année par année, à la
tolérance monétaire près. C'est un test, pas une intention.

Motif : deux implémentations parallèles de la même trajectoire divergent toujours. Un
moteur unique supprime la question de la réconciliation au lieu de la documenter.
Propriétaire : Paul.

### 9.2 Percentiles

DÉFINITION CIBLE
P10 signifie : dans 90 % des simulations du modèle, le résultat est supérieur. Cette
phrase décrit le modèle et ses hypothèses, jamais le futur.

Contrainte structurelle : P10 ≤ P25 ≤ P50 ≤ P75 ≤ P90 pour toute année.

ÉTAT DU CODE
Conforme, testé (`monte-carlo.test.ts`), et l'interface porte bien la formulation
« des simulations du modèle ». Point fort à préserver.

ÉCART
La projection part de `grossAssets` et n'inclut ni la dette, ni son amortissement, ni
l'inflation dans les percentiles. Une trajectoire de « patrimoine brut projeté » est
présentée à côté d'un patrimoine net négatif. Propriétaire : Paul.

### 9.3 Reproductibilité

DÉFINITION CIBLE
Même seed et mêmes inputs produisent exactement les mêmes outputs.

ÉTAT DU CODE
Conforme et testé. Le seed par défaut `19082026` est cependant écrit en dur à trois
endroits (route API, `app-shell.tsx`, `ScenariosPage`) : trois sources de vérité pour
une constante qui conditionne la comparabilité des runs.

## 10. Provenance

DÉFINITION CIBLE (business plan §3.1, reprise du modèle `Provenance` existant)

| Type | Définition |
|---|---|
| ACTUAL | donnée observée, datée, sourcée |
| USER_ASSUMPTION | hypothèse saisie explicitement par l'utilisateur |
| MODEL_ASSUMPTION | hypothèse produite par le moteur, dont la valeur est discutable |
| MODEL_HEURISTIC / EXPERIMENTAL | coefficient de jugement dont la méthode elle-même n'est pas validée |
| EXTERNAL_DATA | donnée issue d'une source externe datée |
| DERIVED | résultat de calcul sur d'autres données |
| MISSING | information matériellement absente |

Règles :
- Un `MODEL_HEURISTIC / EXPERIMENTAL` ne peut jamais porter seul une conclusion, un
  classement ou une recommandation. Sa formule et son impact sur le résultat sont
  auditables, c'est-à-dire que le résultat sans lui doit rester consultable. Décision
  canonique Q-11, fermée le 21 août 2026.
- Une donnée MISSING ne devient jamais 0 par défaut.
- Un DERIVED ne peut pas avoir une confiance supérieure à celle de son input le plus
  faible.
- Une source externe ne met jamais à jour une correction manuelle validée sans
  mécanisme de conflit explicite.

ÉTAT DU CODE
Le type existe, il est porté par toutes les entités et affiché par `DataBadge`. C'est
un point fort réel du produit.

ÉCART
1. La règle de propagation de confiance n'existe pas : `deriveMetrics` produit des
   agrégats sans provenance ni confiance. `netWorth` n'a pas de provenance.
2. Toute édition utilisateur force `confidence = 'HIGH'`, y compris sur un scénario
   modélisé.

   DÉCISION CANONIQUE : une donnée éditée par l'utilisateur devient USER_ASSUMPTION, et
   cela **n'implique aucune confiance HIGH**. La confiance est un attribut distinct de la
   provenance : elle qualifie la vérification, pas l'intention. Déplacer un curseur de
   rendement de 5,5 % à 8 % ne vérifie rien. La confiance conserve donc sa valeur
   antérieure, ou est demandée explicitement, mais n'est jamais élevée par effet de bord
   d'une saisie.
3. Aucun mécanisme de conflit import / correction manuelle n'existe, faute d'import.
Propriétaires : Paul pour 1, Léo pour la règle du point 2 et Tom pour les mutations qui
la portent (elles vivent dans les repositories), différé pour 3.

## 11. Complétude, confiance et incertitude de modèle

DÉFINITIONS CANONIQUES, arrêtées au Checkpoint
Un calcul techniquement exécutable n'est pas économiquement fiable, pour trois raisons
**indépendantes** qui appellent trois grandeurs distinctes, jamais fusionnées.

| Axe | Question | Porte sur | Action corrective |
|---|---|---|---|
| COMPLETENESS | ai-je toutes les données nécessaires ? | couverture des inputs | saisir la donnée manquante |
| CONFIDENCE / DATA QUALITY | les données présentes sont-elles fiables ? | qualité des inputs présents | vérifier ou sourcer |
| MODEL UNCERTAINTY | le modèle est-il adapté à la question ? | structure du calcul | changer de modèle |

Ces trois axes sont orthogonaux. Un résultat peut être complet à 100 %, de confiance
HIGH, et porter une incertitude de modèle élevée. Un modèle exact appliqué à des données
partielles reste inexploitable. Les fusionner produit un indicateur qui ne dit ni ce qui
manque, ni ce qui est douteux, ni ce qui est simplifié, et n'oriente donc vers aucune
correction.

Conséquence sur la restitution : la précision d'affichage est bornée par **le plus
dégradé des trois axes**, jamais par la complétude seule. Un underwriting dont les seize
entrées sont renseignées mais toutes hypothétiques a une complétude de 100 % et ne mérite
pas deux décimales.

ÉTAT DU CODE
Un seul indicateur existe : `dataCompleteness = catégories de budget renseignées /
catégories de budget totales`. Au seed : 1 / 20 = 5 %. Le dénominateur inclut les
catégories « Revenu » et « Investissement », qui ne sont pas des dépenses. Ni la
confiance des agrégats, ni l'incertitude de modèle n'existent.

ÉCART
La métrique porte un nom qui promet un score global de complétude des données et ne
mesure que le budget. Les deux autres axes sont entièrement absents, dont
MODEL UNCERTAINTY, que seule une déclaration du propriétaire du calcul peut produire.
Spécification complète dans `COMPLETENESS_MODEL_SPEC.md`. Propriétaires : Léo pour la
sémantique des trois axes, Paul pour leur calcul et leur propagation.

## 12. Fiscalité

DÉFINITION CIBLE
Toute règle fiscale porte une juridiction, une année, une période d'effet, une source
et une date de vérification. Trois statuts de résultat sont possibles : PRE-TAX,
AFTER-TAX ESTIMATED, AFTER-TAX VERIFIED.

ÉTAT DU CODE
`DatedTaxRule` porte bien juridiction, année, source et `verifiedAt`. Aucune règle
française réelle n'est chargée : la table contient un placeholder MISSING / UNKNOWN.
Le moteur `tax.ts` n'est appelé par aucun code de production, uniquement par ses tests.
L'interface affiche « Règles actives vérifiées : 0 ».

ÉCART
Conforme à la doctrine : aucune règle non vérifiée n'est appliquée. C'est le bon
comportement. Deux réserves :
1. `DatedTaxRule` porte un champ `socialContributionsRate` que `employmentCompensation`
   n'utilise pas : deux sources de vérité pour les cotisations.
2. `underwriteRealEstate` applique un `taxRate` unique et effectif, sans lien avec le
   moteur fiscal. Le résultat immobilier est donc AFTER-TAX ESTIMATED sans le dire.
Propriétaire : Paul.

## 13. Ce que ce document ne définit pas encore

Ces grandeurs sont citées dans le business plan mais n'ont ni définition canonique ni
implémentation. Elles ne doivent pas être affichées avant d'être définies.

| Grandeur | Raison du report |
|---|---|
| Attribution de variation du patrimoine | exige un ledger de flux mensuel inexistant |
| TWR, XIRR | exigent l'historique des flux par compte |
| Fees drag, FX attribution | exigent frais et FX datés |
| Real Estate Equity dans le Net Worth | exige la persistance immobilière |
| Business Equity dans le Net Worth | exige cap table et valorisation persistées |
| Freedom Coverage | exige des revenus passifs et une dépense cible |
| FI ratio, Coast FIRE | exigent une dépense cible en retraite |
| Savings Engine (minimum / recommended / accelerated) | exige un historique de dépenses |
| Liquidity Engine (minimum / target / opportunity buffer) | exige stabilité de revenu mesurée |

## 14. Décisions rendues au Checkpoint 1

Les dix points soumis à la review ont été tranchés. Ils ne sont plus ouverts, et les
sections correspondantes portent désormais la mention « DÉFINITION CANONIQUE ».

| # | Point | Décision | Section |
|---|---|---|---|
| 1 | arrondi monétaire | pleine précision en interne, arrondi à la restitution et au contrat | §2.3 |
| 2 | compte bancaire débiteur | passif court terme, hors `GrossAssets` | §2.4 |
| 3 | service de dette en différé | somme des `LoanScheduleEntry.totalCashOut` exigibles ; 0 avant la première échéance ; intérêts en différé partiel | §4.3 |
| 4 | `liquidNetWorth` | remplacé par trois grandeurs distinctes : `LiquidAssets`, `NetLiquidityPosition30d`, `LiquidNetWorth` | §3.2 |
| 5 | taux d'épargne et d'investissement | métriques de flux constatés ; NOT_COMPUTABLE tant que le ledger n'existe pas | §4.5 |
| 6 | `forecast_net_worth` | vraie prévision future, jamais la clôture précédente | §8.2 |
| 7 | confiance après édition | une édition ne fait pas passer la confiance à HIGH | §10 |
| 8 | projection déterministe | conservée, sur le même moteur mensuel que le Monte-Carlo | §9.1 |
| 9 | `shockYear` | remplacé par `shockDate` ou une période d'effet | §8.1 |
| 10 | libellé du périmètre | « Actifs financiers identifiés » tant que le bilan est financier | §2.1 |

S'ajoutent quatre décisions non listées initialement et rendues au même Checkpoint :

| Point | Décision | Section |
|---|---|---|
| entrée au bilan d'un actif financé | valeur brute en actif, dette en passif, equity DERIVED jamais sommée | §2.1 |
| MOIC | (distributions + valeur résiduelle) / total des contributions, apports complémentaires inclus | §5.4 |
| complétude, confiance, incertitude de modèle | trois axes orthogonaux, précision bornée par le plus dégradé | §11 |
| clôture mensuelle | réouverture explicite et versionnage, toutes versions conservées | §8.2 |

### Points encore ouverts après ce Checkpoint

1. Poids et seuil de matérialité du calcul de complétude, voir `COMPLETENESS_MODEL_SPEC.md`.
2. Assiette de la valeur de sortie immobilière : `postRenovationValue` est désormais un champ obligatoire, sa valeur par défaut reste à décider.
3. Qualification de la liquidité par type d'actif, prérequis des trois grandeurs de §3.2.
4. Granularité du ledger de flux, prérequis des taux d'épargne et d'investissement de §4.5.
