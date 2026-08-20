# Registre des hardcodes financiers

Léo Family Office. Version 0.1 du 20 août 2026. Lane : Léo (Product Truth).
Base : commit `ef5bacf`. Périmètre : `src/`, `scripts/`, `supabase/`.

## Statut et portée

Registre officiel. Aucun hardcode n'est corrigé par ce document. Il n'y a eu aucune
modification de code.

Ce registre complète la liste de `docs/ENGINE_AUDIT.md` §16 : il ajoute la
classification par catégorie, la provenance attendue, la maison de destination et le
propriétaire, comme demandé par le plan de développement §5 bloc D.

### Ce qui compte comme hardcode

Une valeur écrite dans le code source, alors qu'elle décrit une réalité financière
susceptible de changer sans que le code change. Trois questions permettent de trancher :

1. Cette valeur peut-elle devenir fausse sans qu'aucun développeur ne touche au code ?
2. Un utilisateur différent aurait-il une autre valeur ?
3. La valeur affichée à l'écran dépend-elle de cette constante ?

Si l'une des trois réponses est oui, c'est un hardcode à inscrire ici.

### Ce qui ne compte pas comme hardcode

Les données du seed patrimonial de production (soldes, capital du prêt, mensualité,
revenu, loyer) sont des données portées par la base, avec une provenance ACTUAL et des
réconciliations documentées. Elles figurent en fin de document dans une section
distincte, parce qu'elles posent un autre problème : ce sont des données personnelles
réelles versionnées dans un dépôt Git.

Les constantes purement techniques (tailles maximales de fichier, nombres d'itérations
de bissection, tolérances numériques, codes couleur, tailles d'icônes) sont hors
périmètre : elles ne portent aucune sémantique financière.

### Catégories

| Catégorie | Définition |
|---|---|
| DISPLAY_ONLY | valeur d'affichage sans effet sur un calcul |
| ACTUAL_SEED | donnée réelle de l'utilisateur, devrait vivre en base |
| USER_ASSUMPTION | hypothèse qui appartient à l'utilisateur, devrait être saisissable |
| MODEL_ASSUMPTION | paramètre du modèle, devrait être versionné et sourcé |
| EXTERNAL_DATA_PLACEHOLDER | tient lieu d'une donnée externe non branchée |
| DATE_MAGIC | date ou année écrite en dur, dérive avec le temps |
| BUG | la constante produit un résultat faux |
| HEURISTIC | coefficient arbitraire sans source |
| TEMPORARY_UI | échafaudage d'interface assumé |
| UNKNOWN | provenance non déterminable par lecture du code |

### Synthèse

| Priorité | Nombre | Sens |
|---|---:|---|
| P1 | 16 | produit un chiffre faux ou trompeur affiché à l'utilisateur |
| P2 | 11 | dérive certaine à court terme, ou paramètre non gouverné |
| P3 | 7 | hygiène, pas d'impact immédiat |
| Total | 34 | |

| Catégorie | Nombre |
|---|---:|
| BUG | 6 |
| DATE_MAGIC | 5 |
| ACTUAL_SEED | 6 |
| HEURISTIC | 5 |
| USER_ASSUMPTION | 4 |
| MODEL_ASSUMPTION | 4 |
| TEMPORARY_UI | 3 |
| EXTERNAL_DATA_PLACEHOLDER | 1 |
| Total | 34 |

---

## HC-01 · Fenêtre du service de dette

- VALUE : `"2027-08-19"`
- FILE : `src/lib/data/shared.ts:31`
- FUNCTION : `deriveMetrics`, filtre de `monthlyDebtService`
- PURPOSE : décider quels prêts entrent dans le service de dette mensuel
- CATEGORY : BUG, doublé de DATE_MAGIC
- PROVENANCE EXPECTED : dérivée de la date d'observation et de `maturityDate`, jamais littérale
- CURRENT RISK : la mensualité de 284,72 € est comptée dès la date zéro alors que la première échéance est le 5 décembre 2026, ce que l'interface et `docs/ASSUMPTIONS.md` contredisent tous les deux. Le FCF affiché vaut -142,72 € sous le libellé « avant échéance du prêt ». À partir du 19 août 2027, la constante inverse son effet : tout prêt à première échéance postérieure disparaîtra du service de dette.
- TEMPORARILY ACCEPTABLE ? Non. C'est le seul hardcode qui produit aujourd'hui un chiffre faux au premier écran du produit.
- TARGET HOME : `deriveMetrics(asOfDate, …)`, fenêtre `firstPaymentDate <= asOfDate <= maturityDate`
- OWNER : Paul, après arbitrage produit de Léo
- PRIORITY : P1

## HC-02 · Année de base du Monte-Carlo

- VALUE : `2026`
- FILE : `src/lib/engine/monte-carlo.ts:69`
- FUNCTION : `runMonteCarlo`, construction des points
- PURPOSE : convertir l'index d'année du modèle en année civile affichée
- CATEGORY : DATE_MAGIC
- PROVENANCE EXPECTED : dérivée de `AS_OF_DATE`
- CURRENT RISK : dès 2027, la distribution est étiquetée avec des années fausses. L'utilisateur lit « 2036 » sur un point qui correspond en réalité à 2037.
- TEMPORARILY ACCEPTABLE ? Oui jusqu'au 31 décembre 2026, non ensuite.
- TARGET HOME : paramètre `baseYear` dérivé de la date d'observation
- OWNER : Paul
- PRIORITY : P1

## HC-03 · Âge de départ du Monte-Carlo

- VALUE : `23`
- FILE : `src/lib/engine/monte-carlo.ts:70`
- FUNCTION : `runMonteCarlo`, `input.startingAge ?? 23`
- PURPOSE : afficher un âge en regard de chaque année projetée
- CATEGORY : ACTUAL_SEED
- PROVENANCE EXPECTED : profil utilisateur, ACTUAL, date de naissance
- CURRENT RISK : l'API `/api/projection` ne transmet jamais `startingAge`. La valeur par défaut est donc toujours utilisée. Elle est correcte pour un seul utilisateur, à une seule date.
- TEMPORARILY ACCEPTABLE ? Oui, tant que l'âge n'est pas affiché. Le champ `age` est présent dans `ProjectionPoint` mais n'est pas rendu par l'interface actuelle.
- TARGET HOME : table de profil utilisateur
- OWNER : Paul
- PRIORITY : P2

## HC-04 · Amplitude du stress rare

- VALUE : `0.12` et `0.15` dans `monthlyReturn -= 0.12 + random() * 0.15`
- FILE : `src/lib/engine/monte-carlo.ts:58`
- FUNCTION : `runMonteCarlo`
- PURPOSE : appliquer un choc mensuel de -12 % à -27 % lors d'un événement de stress
- CATEGORY : HEURISTIC
- PROVENANCE EXPECTED : paramètre de scénario, MODEL_ASSUMPTION versionnée et sourcée
- CURRENT RISK : le scénario Stress porte déjà `annualVolatility` et `stressProbability` comme paramètres modifiables, mais l'amplitude du stress ne l'est pas. Deux leviers sur trois sont exposés, le troisième est invisible. La forme de la queue gauche de la distribution n'est donc pas gouvernable par l'utilisateur.
- TEMPORARILY ACCEPTABLE ? Oui en V1, à condition que la méthodologie affichée le dise. Elle ne le dit pas aujourd'hui.
- TARGET HOME : champs `stressMagnitudeMin` et `stressMagnitudeRange` du scénario
- OWNER : Paul
- PRIORITY : P2

## HC-05 · Seed de projection par défaut, trois occurrences

- VALUE : `19082026`
- FILE : `src/app/api/projection/route.ts:14`, `src/components/app-shell.tsx:73`, `src/components/pages.tsx:239`
- FUNCTION : valeur par défaut du seed Monte-Carlo
- PURPOSE : rendre les projections reproductibles
- CATEGORY : MODEL_ASSUMPTION
- PROVENANCE EXPECTED : constante partagée unique
- CURRENT RISK : trois sources de vérité pour une constante dont dépend la comparabilité de tous les runs. Modifier l'une des trois rend deux exécutions apparemment identiques incomparables, sans aucun signal.
- TEMPORARILY ACCEPTABLE ? Oui, le risque est de maintenance, pas de justesse.
- TARGET HOME : `export const DEFAULT_PROJECTION_SEED` dans un module partagé
- OWNER : Paul
- PRIORITY : P3

## HC-06 · Horizon et nombre de simulations par défaut

- VALUE : `30` ans, `3000` simulations
- FILE : `src/components/app-shell.tsx:73`, `src/components/pages.tsx:245-246`
- FUNCTION : `runProjection`
- PURPOSE : paramètres par défaut de la projection
- CATEGORY : MODEL_ASSUMPTION
- PROVENANCE EXPECTED : préférence utilisateur ou constante nommée
- CURRENT RISK : faible. Le bouton affiche « Lancer 3 000 simulations », donc la valeur est visible et cohérente avec le code. Le nombre de simulations n'est pas un indicateur de qualité du modèle, comme le rappelle le business plan §12.3 : l'afficher en gros risque de le suggérer.
- TEMPORARILY ACCEPTABLE ? Oui.
- TARGET HOME : constantes nommées, mêmes que HC-05
- OWNER : Paul
- PRIORITY : P3

## HC-07 · Coefficient de décote de risque du Decision Lab

- VALUE : `0.25` dans `riskHaircut = capital × volatility × √years × 0.25`
- FILE : `src/lib/engine/decision.ts:19`
- FUNCTION : `compareDebtVsInvest`
- PURPOSE : pénaliser l'option d'investissement pour son risque
- CATEGORY : HEURISTIC
- PROVENANCE EXPECTED : méthode documentée et sourcée, ou paramètre exposé avec sa signification
- CURRENT RISK : ce coefficient détermine directement la conclusion affichée « L'investissement présente l'espérance ajustée du risque la plus élevée ». Il n'a aucune source, aucun test, et il n'est mentionné nulle part dans l'interface. Le produit émet une recommandation d'arbitrage patrimonial dont le paramètre décisif est invisible.
- TEMPORARILY ACCEPTABLE ? Non pour la conclusion affichée. Oui pour le calcul si la conclusion est retirée ou requalifiée en illustration.
- TARGET HOME : paramètre de préférence de risque, exposé et expliqué
- OWNER : Paul, arbitrage Léo sur le libellé de la conclusion
- PRIORITY : P1

## HC-08 · Seuil de qualification du risque

- VALUE : `0.15` dans `volatility > 0.15 ? "Élevé" : "Modéré"`
- FILE : `src/lib/engine/decision.ts:32`
- FUNCTION : `compareDebtVsInvest`
- PURPOSE : qualifier verbalement le risque
- CATEGORY : HEURISTIC
- PROVENANCE EXPECTED : échelle documentée
- CURRENT RISK : une volatilité de 14,9 % est « modérée » et 15,1 % est « élevée ». La discontinuité n'a pas de justification. Le mot est plus mémorable que le chiffre.
- TEMPORARILY ACCEPTABLE ? Oui si l'échelle est affichée.
- TARGET HOME : échelle nommée avec ses bornes
- OWNER : Paul
- PRIORITY : P2

## HC-09 · Poids de la liquidité

- VALUE : `0.03`
- FILE : `src/components/pages.tsx:169` et `252`, passé à `compareDebtVsInvest`
- FUNCTION : `DebtPage` et `DecisionLabPage`
- PURPOSE : valoriser le fait de conserver du capital disponible
- CATEGORY : HEURISTIC
- PROVENANCE EXPECTED : préférence utilisateur explicite
- CURRENT RISK : 3 % du capital est ajouté à l'avantage de l'option « investir » sans que l'utilisateur sache qu'une valeur est attribuée à sa liquidité, ni laquelle. Le chiffre entre directement dans `opportunityAdvantage`, qui est affiché.
- TEMPORARILY ACCEPTABLE ? Non tant que `opportunityAdvantage` est affiché comme un montant en euros.
- TARGET HOME : paramètre de préférence, avec explication
- OWNER : Paul, arbitrage Léo
- PRIORITY : P1

## HC-10 · Inflation figée du Decision Lab

- VALUE : `0.02`
- FILE : `src/components/pages.tsx:169` et `252`
- FUNCTION : appels à `compareDebtVsInvest`
- PURPOSE : convertir les bénéfices nominaux en bénéfices réels
- CATEGORY : MODEL_ASSUMPTION
- PROVENANCE EXPECTED : inflation du scénario sélectionné
- CURRENT RISK : les scénarios portent chacun leur inflation (2,0 % Central, 2,5 % Prudent, 3,5 % Stress), et le Decision Lab les ignore au profit d'un 2 % figé. Comparer un arbitrage sous le scénario Stress donne donc un résultat calculé sous des hypothèses qui ne sont pas celles du scénario affiché.
- TEMPORARILY ACCEPTABLE ? Non : c'est une incohérence entre deux écrans du même produit.
- TARGET HOME : lecture du scénario actif
- OWNER : Paul
- PRIORITY : P1

## HC-11 · Capital disponible figé de la page Dette

- VALUE : `availableCash: 5000`, `volatility: 0.15`, `years: 5`
- FILE : `src/components/pages.tsx:169`
- FUNCTION : `DebtPage`, encart « Rembourser à 0 % ou investir »
- PURPOSE : illustrer un arbitrage
- CATEGORY : USER_ASSUMPTION, matérialisée en dur
- PROVENANCE EXPECTED : cash réellement disponible, ou curseur explicite
- CURRENT RISK : le produit propose d'arbitrer 5 000 € alors que le cash bancaire réel de l'utilisateur est de 354,08 €. L'encart annonce « Rembourser 5 000 € » et « Investir 5 000 € » comme si la somme existait. Le Decision Lab, lui, propose un curseur de 500 à 16 745 €. Deux écrans, deux arbitrages différents, présentés comme le même.
- TEMPORARILY ACCEPTABLE ? Non : le montant n'existe pas et l'écran ne le dit pas.
- TARGET HOME : `metrics.bankCash` comme borne, ou curseur partagé avec le Decision Lab
- OWNER : Léo
- PRIORITY : P1

## HC-12 · Taux de la dette figé à zéro dans le Decision Lab

- VALUE : `debtRate: 0`
- FILE : `src/components/pages.tsx:252`
- FUNCTION : `DecisionLabPage`
- PURPOSE : taux de la dette dans l'arbitrage
- CATEGORY : BUG latent
- PROVENANCE EXPECTED : `liability.annualRate` du passif considéré
- CURRENT RISK : la valeur est juste aujourd'hui, par coïncidence, parce que le seul prêt est à 0 %. Dès qu'une dette à 3 % existe, le Decision Lab conclura « investir » avec des intérêts évités nuls, alors qu'ils ne le sont pas. Le résultat sera faux sans qu'aucun test ne le détecte : `decision.ts` n'a aucun test.
- TEMPORARILY ACCEPTABLE ? Non, pour une fonction qui produit une recommandation.
- TARGET HOME : dérivation depuis les passifs
- OWNER : Léo pour l'appel, Paul pour la couverture de test
- PRIORITY : P1

## HC-13 · Bornes du curseur de capital disponible

- VALUE : `min="500" max="16745"`
- FILE : `src/components/pages.tsx:256`
- FUNCTION : `DecisionLabPage`
- PURPOSE : borner le curseur au capital de la dette
- CATEGORY : ACTUAL_SEED
- PROVENANCE EXPECTED : `metrics.debt` ou `bankCash`
- CURRENT RISK : `16745` est le capital réel du prêt étudiant, écrit dans le balisage de l'interface. Si la dette change, le curseur ne suit pas.
- TEMPORARILY ACCEPTABLE ? Oui, effet limité au confort d'usage.
- TARGET HOME : `state.metrics.debt`
- OWNER : Léo
- PRIORITY : P2

## HC-14 · Taux d'actualisation de l'underwriting immobilier

- VALUE : `discountRate = 0.06`
- FILE : `src/lib/engine/real-estate.ts:39`
- FUNCTION : `underwriteRealEstate`, valeur par défaut
- PURPOSE : actualiser les flux pour calculer la VAN
- CATEGORY : MODEL_ASSUMPTION
- PROVENANCE EXPECTED : coût d'opportunité du capital de l'utilisateur, saisissable
- CURRENT RISK : la carte affiche « VAN à 6 % », donc la valeur est visible : c'est honnête. Mais elle n'est pas modifiable depuis l'interface, alors que c'est le paramètre qui décide du signe de la VAN. Un utilisateur dont le coût d'opportunité est de 8 % ne peut pas le tester.
- TEMPORARILY ACCEPTABLE ? Oui, parce que la valeur est affichée.
- TARGET HOME : champ de saisie du panneau d'hypothèses
- OWNER : Paul
- PRIORITY : P3

## HC-15 · Hypothèses du projet immobilier par défaut

- VALUE : `purchasePrice: 220000, acquisitionCosts: 17600, renovation: 15000, furniture: 5000, downPayment: 30000, loanAmount: 227600, annualRate: 0.035, loanYears: 25, monthlyRent: 1100, vacancyRate: 0.05, annualOperatingCosts: 3200, annualPropertyGrowth: 0.015, rentGrowth: 0.015, holdingYears: 10, sellingCostsRate: 0.06, taxRate: 0.3`
- FILE : `src/components/pages.tsx:178`, constante `defaultProperty`
- FUNCTION : état initial de `RealEstatePage`
- PURPOSE : proposer un projet de départ modifiable
- CATEGORY : USER_ASSUMPTION
- PROVENANCE EXPECTED : dernier projet enregistré, ou valeurs vides
- CURRENT RISK : modéré. Les seize champs sont modifiables et le badge USER_ASSUMPTION est présent, ce qui est correct. Deux réserves : les hypothèses ne sont jamais persistées, donc tout travail est perdu au rechargement ; et le jeu par défaut est un cas où `loanAmount` (227 600) dépasse `purchasePrice` (220 000), ce qui est précisément la configuration où la formule d'equity investie est la plus fausse. Le produit s'ouvre donc sur son propre pire cas.
- TEMPORARILY ACCEPTABLE ? Oui pour les valeurs, non pour l'absence de persistance annoncée par un bouton « Sauvegarder l'étude » inactif.
- TARGET HOME : table `properties`, déjà présente dans le schéma et inutilisée
- OWNER : Paul
- PRIORITY : P2

## HC-16 · Trajectoires de carrière

- VALUE : six pistes `{base: 42, growth: 0.12, bonus: 9}`, `{42, 0.16, 9}`, `{40, 0.08, 6}`, `{40, 0.09, 7}`, `{38, 0.10, 4}`, `{20, 0.28, 0}`
- FILE : `src/components/pages.tsx:194-199`
- FUNCTION : `CareerPage`
- PURPOSE : dessiner des courbes de rémunération comparées
- CATEGORY : EXTERNAL_DATA_PLACEHOLDER
- PROVENANCE EXPECTED : benchmarks externes datés et sourcés
- CURRENT RISK : douze paramètres décident de la forme de six courbes présentées comme des trajectoires de carrière. Aucun n'est sourcé. Le produit affiche un callout « Courbes non sourcées en V1 », ce qui est honnête et doit être maintenu tant que la source manque. Une croissance de 28 % par an sur neuf ans pour l'entrepreneuriat multiplie le fixe par 9,3 : c'est un ordre de grandeur, pas un benchmark.
- TEMPORARILY ACCEPTABLE ? Oui, grâce au callout.
- TARGET HOME : table de benchmarks EXTERNAL_DATA, avec source et date de vérification
- OWNER : Léo pour les sources, Paul pour le moteur
- PRIORITY : P2

## HC-17 · Croissance du variable de carrière

- VALUE : `1.08` dans `bonus × Math.pow(1.08, year)`
- FILE : `src/components/pages.tsx:200`
- FUNCTION : `CareerPage`
- PURPOSE : faire croître la part variable
- CATEGORY : HEURISTIC
- PROVENANCE EXPECTED : paramètre de piste, au même titre que `growth`
- CURRENT RISK : les six pistes ont chacune leur croissance de fixe, et partagent toutes la même croissance de variable, invisible. Le variable est pourtant la composante la plus dispersée en M&A et en private equity, précisément les deux pistes centrales du scénario de l'utilisateur.
- TEMPORARILY ACCEPTABLE ? Oui, sous le même callout que HC-16.
- TARGET HOME : champ `bonusGrowth` de chaque piste
- OWNER : Paul
- PRIORITY : P2

## HC-18 · Année de départ des courbes de carrière

- VALUE : `2027`
- FILE : `src/components/pages.tsx:200`
- FUNCTION : `CareerPage`, `year: 2027 + year`
- PURPOSE : étiqueter l'axe des abscisses
- CATEGORY : DATE_MAGIC
- PROVENANCE EXPECTED : date de début du premier contrat, ou date d'observation plus un an
- CURRENT RISK : l'axe restera ancré à 2027 indéfiniment.
- TEMPORARILY ACCEPTABLE ? Oui jusqu'à fin 2026.
- TARGET HOME : dérivation depuis la date d'observation
- OWNER : Paul
- PRIORITY : P3

## HC-19 · Fourchettes salariales affichées

- VALUE : `40 k€`, `42 k€`, `45 k€`, `3 k€`, `9 k€`, `15 k€`, `42000`, `9000`, `≈ 2 ans`
- FILE : `src/components/pages.tsx:203` et `205`
- FUNCTION : `CareerPage`, cartes de métriques et bandes salariales
- PURPOSE : afficher la fourchette du premier contrat
- CATEGORY : USER_ASSUMPTION
- PROVENANCE EXPECTED : registre `economic_assumptions`, déjà alimenté
- CURRENT RISK : la carte « Variable central » lit correctement `asm_variable` depuis le registre, mais la carte « Fixe central » affiche `42000` en dur alors que `asm_salary` existe en base avec exactement cette valeur. Deux comportements pour deux cartes voisines : l'une suit la donnée, l'autre non.
- TEMPORARILY ACCEPTABLE ? Non, le correctif est trivial et la donnée existe déjà.
- TARGET HOME : `state.assumptions`
- OWNER : Léo
- PRIORITY : P2

## HC-20 · Hypothèses du bac à sable business equity

- VALUE : `revenue 500000`, `ebitda 80000`, `multiple 6`, `debt 100000`, `cash 30000`, `ownership 100`
- FILE : `src/components/pages.tsx:211-216`
- FUNCTION : `BusinessPage`
- PURPOSE : état initial du calculateur de valorisation
- CATEGORY : USER_ASSUMPTION
- PROVENANCE EXPECTED : société réelle, ou champs vides
- CURRENT RISK : faible en patrimoine, le callout « Aucun actif business actuel » est explicite et les valeurs restent isolées du bilan. Réserve de formule : le champ est libellé « Dette nette brute » alors que le calcul fait `EV - dette + cash`, ce qui suppose une dette brute. Un utilisateur qui saisit une dette nette compte le cash deux fois.
- TEMPORARILY ACCEPTABLE ? Oui pour les valeurs, non pour le libellé.
- TARGET HOME : tables `businesses` et `business_valuations`, présentes et inutilisées
- OWNER : Léo pour le libellé, Paul pour le moteur
- PRIORITY : P2

## HC-21 · Plus-value PEA annoncée

- VALUE : `703.12`
- FILE : `src/components/pages.tsx:156` et `157`
- FUNCTION : `InvestmentsPage`, deux emplacements
- PURPOSE : afficher le gain latent du PEA
- CATEGORY : ACTUAL_SEED, écrite dans l'interface
- PROVENANCE EXPECTED : dérivée, `position.value - position.costBasis`
- CURRENT RISK : la valeur est aujourd'hui exacte, 8 698,00 - 7 994,88 = 703,12, mais elle est écrite en dur. À la première mise à jour de la valorisation de l'ETF, le gain affiché restera figé à 703,12 € pendant que la valeur du compte changera. L'utilisateur n'aura aucun signal.
- TEMPORARILY ACCEPTABLE ? Non, la donnée existe et le calcul tient en une soustraction.
- TARGET HOME : dérivation depuis les positions
- OWNER : Léo
- PRIORITY : P1

## HC-22 · Valeur de la position ETF

- VALUE : `8698`
- FILE : `src/components/pages.tsx:156`
- FUNCTION : `InvestmentsPage`, carte « Concentration MSCI World »
- PURPOSE : calculer la part de l'ETF dans les actifs bruts
- CATEGORY : ACTUAL_SEED, écrite dans l'interface
- PROVENANCE EXPECTED : `position.value`
- CURRENT RISK : le numérateur est figé, le dénominateur `grossAssets` est dynamique. La concentration affichée sera donc fausse dès la première mise à jour, et faussement crédible parce qu'elle bougera.
- TEMPORARILY ACCEPTABLE ? Non.
- TARGET HOME : dérivation depuis les positions
- OWNER : Léo
- PRIORITY : P1

## HC-23 · Versements PEA annoncés

- VALUE : `14300`
- FILE : `src/components/pages.tsx:157`
- FUNCTION : `InvestmentsPage`, ligne « Versements annoncés »
- PURPOSE : afficher le total versé sur le PEA
- CATEGORY : ACTUAL_SEED, non stockée
- PROVENANCE EXPECTED : historique des versements, absent du modèle
- CURRENT RISK : cette valeur n'existe nulle part en base. Elle n'est ni vérifiable ni réconciliable depuis le produit. `docs/ASSUMPTIONS.md` note d'ailleurs que 14 300 + 703,12 = 15 003,12, soit 0,01 € sous le total du compte, un second écart ouvert. La donnée est donc à la fois invisible pour le système et porteuse d'une anomalie.
- TEMPORARILY ACCEPTABLE ? Non.
- TARGET HOME : table de flux par compte, à créer
- OWNER : Léo pour le retrait immédiat, Paul pour le modèle de flux
- PRIORITY : P1

## HC-24 · Performance affichée du CTO

- VALUE : `"+77,71 %"`
- FILE : `src/components/pages.tsx:157`
- FUNCTION : `InvestmentsPage`, ligne « Performance affichée »
- PURPOSE : afficher la performance du compte-titres
- CATEGORY : BUG
- PROVENANCE EXPECTED : calcul de performance, impossible ici
- CURRENT RISK : c'est le hardcode le plus grave du registre. Le CTO a `cost_basis = NULL` et aucun historique de flux. Ce pourcentage n'est dérivable d'aucune donnée du système. Sur la même page, le produit affiche « Ventilation : Manquante » et un callout expliquant que volatilité, drawdown et Sharpe ne sont pas affichés faute d'historique fiable. Il applique donc à ces indicateurs une rigueur qu'il s'exonère d'appliquer à la performance elle-même.
- TEMPORARILY ACCEPTABLE ? Non. Le retrait est immédiat et sans coût : remplacer par « non calculable, cost basis manquant », comme la page Goals le fait déjà pour le FI ratio.
- TARGET HOME : Portfolio Engine, après import de l'historique de flux
- OWNER : Léo
- PRIORITY : P1

## HC-25 · Identifiants de comptes dans l'interface

- VALUE : `"acc_pea"`, `"acc_cto"`
- FILE : `src/components/pages.tsx:65`, `150`, `151`, `152`
- FUNCTION : `TodayPage` allocation, `InvestmentsPage`
- PURPOSE : retrouver le PEA et le CTO
- CATEGORY : BUG latent
- PROVENANCE EXPECTED : filtrage par `account.type`
- CURRENT RISK : ces identifiants sont ceux du seed SQLite. Côté Supabase, `add_account` génère des UUID. Un compte recréé rendra la page Investments vide, sans erreur, sans message : `pea?.balance ?? 0` affichera 0,00 € et la réconciliation cessera de se déclencher. Panne silencieuse sur l'écran qui porte le contrôle de cohérence.
- TEMPORARILY ACCEPTABLE ? Non.
- TARGET HOME : `accounts.filter(a => a.type === "PEA")`
- OWNER : Léo
- PRIORITY : P1

## HC-26 · Mensualité du prêt dans l'interface

- VALUE : `284.72` et `"284,72 €"`
- FILE : `src/components/pages.tsx:103`, `142`, `173`, `174`, `286`
- FUNCTION : `TodayPage` encart événement, `CashFlowPage` frise, `DebtPage` explications, `TimelinePage`
- PURPOSE : afficher la mensualité annoncée
- CATEGORY : ACTUAL_SEED, écrite dans l'interface
- PROVENANCE EXPECTED : `liability.monthlyPayment`
- CURRENT RISK : cinq occurrences de la même donnée, dont deux dans des panneaux « Explain calculation » qui prétendent exposer les inputs réels du calcul. Un panneau d'explication qui affiche une constante de code au lieu de la donnée utilisée est pire qu'une absence d'explication : il crée une confiance injustifiée.
- TEMPORARILY ACCEPTABLE ? Non pour les panneaux d'explication. Tolérable ailleurs à très court terme.
- TARGET HOME : `state.liabilities[…]`
- OWNER : Léo
- PRIORITY : P1

## HC-27 · Dates du prêt dans l'interface

- VALUE : `"5 décembre 2026"`, `"5 novembre 2031"`, `"60 mensualités"`, `"0,00 €"`, `"05 DÉC 2026"`, `"Dette dès déc. 2026"`
- FILE : `src/components/pages.tsx:103`, `142`, `173`, `286`, `289`
- FUNCTION : `DebtPage` panneau « Dates clés », `TodayPage`, `CashFlowPage`, `TimelinePage`
- PURPOSE : afficher les dates contractuelles
- CATEGORY : DATE_MAGIC
- PROVENANCE EXPECTED : `liability.firstPaymentDate`, `liability.maturityDate`, `liability.paymentCount`
- CURRENT RISK : le panneau s'intitule « Contrat annoncé » et affiche des dates qui ne viennent pas du contrat stocké. Les champs existent dans le modèle et sont peuplés. Le jour où l'échéancier bancaire réel sera importé et corrigera ces dates, l'écran continuera d'afficher les anciennes.
- TEMPORARILY ACCEPTABLE ? Non.
- TARGET HOME : champs de `Liability`
- OWNER : Léo
- PRIORITY : P1

## HC-28 · Compte à rebours de la première échéance

- VALUE : `"Dans 108 jours à la date zéro"`
- FILE : `src/components/pages.tsx:103`
- FUNCTION : `TodayPage`, encart « Prochain événement majeur »
- PURPOSE : indiquer le délai avant la première échéance
- CATEGORY : DATE_MAGIC
- PROVENANCE EXPECTED : `firstPaymentDate - asOfDate`
- CURRENT RISK : la valeur est exacte au 19 août 2026 et fausse tous les autres jours. Le libellé « à la date zéro » atténue le problème en le nommant, ce qui est une honnêteté partielle, mais un compte à rebours qui ne décompte pas est un compte à rebours faux.
- TEMPORARILY ACCEPTABLE ? Oui à très court terme, grâce au libellé.
- TARGET HOME : calcul de différence de dates
- OWNER : Léo
- PRIORITY : P2

## HC-29 · Date zéro affichée

- VALUE : `"Mercredi 19 août 2026"`, `"Au 19 août 2026"`, `"19 août 2026"`, `"Clôturer août 2026"`
- FILE : `src/components/pages.tsx:71`, `204`, `285`, `291`, `298`, `src/components/app-shell.tsx:126`
- FUNCTION : en-têtes et barre supérieure
- PURPOSE : dater l'état affiché
- CATEGORY : DATE_MAGIC
- PROVENANCE EXPECTED : `state.asOfDate`, disponible dans tous ces composants
- CURRENT RISK : la constante `AS_OF_DATE` existe dans `shared.ts` et est transmise jusqu'à l'interface via `state.asOfDate`. Six emplacements l'ignorent et réécrivent la date en français. Le 19 août 2026 est effectivement mercredi, la valeur est donc juste aujourd'hui. Elle sera fausse dès le premier changement de date zéro, et le bouton « Clôturer août 2026 » clôturera toujours août.
- TEMPORARILY ACCEPTABLE ? Oui pour quelques jours.
- TARGET HOME : `state.asOfDate` et un formateur de date
- OWNER : Léo
- PRIORITY : P2

## HC-30 · Valeurs monétaires dans les panneaux d'explication

- VALUE : `"15 003,13 €"`, `"8 698,00 €"`, `"6 304,57 €"`, `"16 745,00 €"`, `"16 745 €"`, `"60"`, `"0 %"`, `"−1 173,51 €"`, `"0,00 € avant le 5 décembre 2026"`, `"17 083,20 € − 16 745,00 € = 338,20 €"`
- FILE : `src/components/pages.tsx:158`, `171`, `173`, `306`, `307`
- FUNCTION : `setExplanation`, panneaux « Explain calculation »
- PURPOSE : montrer les inputs d'un calcul
- CATEGORY : BUG
- PROVENANCE EXPECTED : les valeurs réellement passées au calcul
- CURRENT RISK : le panneau « Explain calculation » est la promesse différenciante du produit face à Finary. Ces panneaux affichent des chaînes de caractères figées présentées comme les inputs du calcul, avec leur badge de provenance ACTUAL et leur date. Un badge ACTUAL sur une constante de code est une affirmation fausse sur la nature de la donnée. Le cas le plus problématique est `cashFlowExplanation` : il annonce « Service de dette actuel : 0,00 € avant le 5 décembre 2026 » alors que le moteur a bien retranché 284,72 € pour produire le chiffre affiché juste au-dessus.
- TEMPORARILY ACCEPTABLE ? Non.
- TARGET HOME : construction des explications à partir de `state`, comme le font déjà correctement `assetsExplanation`, `netWorthExplanation` et `liquidityExplanation` pour la plupart de leurs champs
- OWNER : Léo
- PRIORITY : P1

## HC-31 · Mois du graphique de cash-flow

- VALUE : `["Mars", "Avr.", "Mai", "Juin", "Juil.", "Août"]`, avec données au seul index 5
- FILE : `src/components/pages.tsx:137`
- FUNCTION : `CashFlowPage`, graphique « Historique observé »
- PURPOSE : afficher un historique de revenus et dépenses
- CATEGORY : TEMPORARY_UI
- PROVENANCE EXPECTED : agrégation mensuelle des transactions
- CURRENT RISK : le graphique s'intitule « Historique observé » et affiche cinq mois à zéro et un mois renseigné. Le texte sous le graphique précise « Les mois sans données sont affichés à zéro, et non estimés », ce qui est une bonne pratique. Reste que cinq barres à zéro dans un « historique observé » suggèrent une observation de zéro, pas une absence d'observation.
- TEMPORARILY ACCEPTABLE ? Oui, grâce au texte.
- TARGET HOME : agrégation des transactions par mois
- OWNER : Léo
- PRIORITY : P3

## HC-32 · Paliers patrimoniaux

- VALUE : `[100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000, 20000000]`
- FILE : `src/components/pages.tsx:264`
- FUNCTION : `GoalsPage`
- PURPOSE : afficher une frise de paliers
- CATEGORY : TEMPORARY_UI
- PROVENANCE EXPECTED : configuration utilisateur
- CURRENT RISK : le panneau s'intitule « Repères configurables » alors que la liste n'est pas configurable. Écart entre la promesse du libellé et le comportement.
- TEMPORARILY ACCEPTABLE ? Oui pour la liste, non pour le mot « configurables ».
- TARGET HOME : préférences utilisateur
- OWNER : Léo
- PRIORITY : P3

## HC-33 · Cas du Decision Lab

- VALUE : dix libellés dont neuf inactifs, marqués « Préparé »
- FILE : `src/components/pages.tsx:253`, `259`
- FUNCTION : `DecisionLabPage`, bandeau de cas
- PURPOSE : annoncer les arbitrages disponibles
- CATEGORY : TEMPORARY_UI
- PROVENANCE EXPECTED : liste des cas réellement implémentés
- CURRENT RISK : neuf boutons cliquables sans effet, portant la mention « Préparé ». Le mot suggère une disponibilité imminente plutôt qu'une absence. « Coming soon » est utilisé ailleurs dans le produit pour le même besoin, ce qui rend l'incohérence visible.
- TEMPORARILY ACCEPTABLE ? Oui si le libellé devient explicite.
- TARGET HOME : table `decision_cases`, présente dans le schéma et inutilisée
- OWNER : Léo
- PRIORITY : P3

## HC-34 · Statut d'adapter affiché

- VALUE : `"SQLite local"`, `"Supabase prêt à connecter"`, `"0"` données externes actives
- FILE : `src/components/pages.tsx:298`
- FUNCTION : `SettingsPage`
- PURPOSE : indiquer où sont stockées les données
- CATEGORY : BUG
- PROVENANCE EXPECTED : `repository.adapter`, exposé par l'interface `FamilyOfficeRepository`
- CURRENT RISK : en production sur Vercel, `resolveAdapterName()` retourne `supabase`. L'écran affirme donc à l'utilisateur que ses données sont dans un fichier SQLite local alors qu'elles sont dans PostgreSQL managé. C'est une affirmation fausse sur la localisation de données patrimoniales, sur la page qui porte le bloc « Security ». L'information exacte est disponible : le champ `adapter` existe déjà sur le repository, il n'est simplement pas remonté jusqu'à `DashboardState`.
- TEMPORARILY ACCEPTABLE ? Non.
- TARGET HOME : `DashboardState.adapter`, alimenté par `repository.adapter`
- OWNER : Léo pour le texte, Tom pour la remontée du champ si elle touche le repository
- PRIORITY : P1

---

## Données réelles versionnées dans le dépôt

Ce ne sont pas des hardcodes au sens strict : ce sont des données de seed portant une
provenance ACTUAL. Elles posent un problème distinct, qui n'est pas de justesse mais de
confidentialité, et qui relève de la lane de Tom.

| Donnée | Emplacements | Nature |
|---|---|---|
| Soldes bancaires 355,48 / 0,53 / 1,51 / -3,44 | `local-repository.ts`, `scripts/seed-supabase.ts`, `shared.test.ts` | patrimoine réel |
| PEA 15 003,13, ETF 8 698, cash PEA 6 304,57, coût 7 994,88 | idem | patrimoine réel |
| CTO 214,28 | idem | patrimoine réel |
| Prêt 16 745, mensualité 284,72, 60 échéances, 2026-12-05, 2031-11-05 | idem | dette réelle |
| Revenu net 1 282, loyer 1 140, revenu tennis 130 | idem | revenus et charges réels |
| Noms d'établissements réels : Boursobank, Revolut, CIC, Trade Republic, Bpifrance | idem | relations bancaires |
| Prénom de l'utilisateur, identifiant `usr_leo`, valeur de repli du code d'accès de développement | `local-repository.ts`, `auth.ts`, `login-form.tsx` | identité |

Constat : le dépôt contient l'inventaire patrimonial complet d'une personne physique
identifiée, avec le nom de ses établissements bancaires et de son prêteur, dans trois
fichiers distincts, plus les tests. Le dépôt est privé, ce qui limite l'exposition,
mais le plan prévoit l'arrivée de deux collaborateurs qui auront accès à ces données
sans que ce soit nécessaire à leur travail.

Trois options, à arbitrer par Léo, à mettre en oeuvre par Tom :
1. Remplacer le seed de développement par le golden dataset synthétique de
   `docs/GOLDEN_DATASET.md`, et charger les données réelles uniquement en production.
2. Conserver le seed réel et restreindre l'accès au dépôt, ce qui contredit l'arrivée
   des collaborateurs.
3. Anonymiser le seed en conservant les ordres de grandeur, ce qui casse les
   réconciliations documentées de `docs/ASSUMPTIONS.md`.

L'option 1 est la seule cohérente avec le plan de collaboration et avec la règle
« ne jamais coller de secret dans une IA » du business plan §A.4. Elle a un effet de
bord favorable : elle force les tests à ne plus dépendre du patrimoine réel, ce qui est
déjà le cas de `shared.test.ts` par accident, puisque ce test utilise deux comptes au
lieu de six et attend donc `-1 386,39 €` là où l'application affiche `-1 173,51 €`.

Ce point n'était pas dans le périmètre du bloc D. Il est signalé ici parce qu'il est
apparu pendant le recensement et qu'il ne relève pas de la lane de Léo seul.

## Ordre de traitement proposé

Cet ordre ne préjuge pas des arbitrages en attente. Il classe par « chiffre faux
visible » d'abord, « dérive certaine » ensuite.

1. HC-24, HC-30, HC-34 : trois affirmations fausses affichées à l'utilisateur, correction textuelle sans risque financier, lane Léo.
2. HC-01 : le seul hardcode qui fausse un montant du cockpit, après arbitrage produit.
3. HC-21, HC-22, HC-23, HC-25, HC-26, HC-27 : dérivation depuis les données, lane Léo.
4. HC-07, HC-09, HC-10, HC-11, HC-12 : gouvernance du Decision Lab, lane Paul, avec tests.
5. HC-02 : année de base du Monte-Carlo, avant le 31 décembre 2026.
6. HC-19, HC-28, HC-29, HC-13 : dérivations restantes.
7. Le reste, sans urgence.

## Points à soumettre à la review

1. Le seed de production contient-il des données personnelles qui ne devraient pas être partagées avec Paul et Tom ?
2. HC-07 et HC-09 : le Decision Lab doit-il continuer à afficher une conclusion, ou seulement des éléments de comparaison, tant que ses coefficients ne sont pas sourcés ?
3. HC-15 : le jeu d'hypothèses immobilier par défaut doit-il rester un cas où `loanAmount > purchasePrice` ?
4. HC-34 : la remontée de `repository.adapter` jusqu'à `DashboardState` touche un fichier de la lane de Tom. Qui la porte ?
