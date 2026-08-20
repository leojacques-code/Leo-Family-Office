# Définitions financières canoniques

Léo Family Office. Version 0.1 du 20 août 2026. Lane : Léo (Product Truth).
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

ÉTAT DU CODE
`calculateNetWorth` (`src/lib/engine/financial.ts:93`) somme `account.balance` sur tous
les comptes actifs. Les positions ne sont pas ajoutées. Immobilier, business equity et
autres actifs ne sont pas dans le périmètre : les tables existent, aucun code ne les lit.

ÉCART
1. Périmètre : seuls les actifs financiers sont couverts. Le nom affiché « Patrimoine
   brut » surdéclare le périmètre. Il faut lire « actifs financiers identifiés ».
2. Un compte débiteur (CIC à -3,44 € au seed) est compté comme un actif de valeur
   négative, pas comme un passif. Convention à formaliser (voir §2.4).
3. Aucune conversion FX : voir §7.
Propriétaire de l'écart : Léo pour le nom, Paul pour le périmètre, Tom pour rien ici.

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

ÉCART
Artefact de précision flottante : le calcul rend -1 173,5100000000002. Le test
`financial.test.ts:40` échoue sur `toEqual` strict. Constat vérifié par exécution
directe le 20 août 2026. C'est le seul test rouge du dépôt.
Décision de définition requise : LFO retient-il un arrondi monétaire canonique
(2 décimales, half-even) au niveau de la couche de présentation, du moteur, ou des
deux ? Tant que la réponse n'est pas donnée, aucun invariant d'égalité comptable ne
peut être testé autrement qu'avec une tolérance. Propriétaire : Paul, arbitrage Léo.

### 2.4 Convention actif / passif d'un compte débiteur

DÉFINITION CIBLE À TRANCHER (non résolue)
Deux conventions sont défendables :
- A. Un solde bancaire négatif reste un actif de valeur négative. Simple, additif,
  conserve l'identité Gross - Liabilities = Net.
- B. Un solde bancaire négatif devient un passif court terme. Plus juste au sens
  économique, mais casse l'additivité naïve et impose de définir GrossAssets comme
  somme des soldes positifs seulement.

ÉTAT DU CODE : convention A, implicite, jamais documentée.

ÉCART : le business plan (annexe A.1) note « CIC -3,44 € : convention actif/passif à
formaliser ». Elle ne l'est toujours pas. Impact chiffré actuel : 3,44 €, donc
négligeable en valeur, structurant en définition. Propriétaire : Léo.

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

### 3.2 Liquid Net Worth

DÉFINITION CIBLE

    LiquidNetWorth(t) = Σ actifs mobilisables sous 30 jours sans pénalité majeure
                        - Σ dettes exigibles sous 30 jours

ÉTAT DU CODE
`liquidNetWorth = grossAssets - debt`, soit exactement `netWorth`. La notion de
liquidité n'intervient nulle part.

ÉCART
BLOQUANT au sens de la définition : la métrique porte un nom qui ment. Deux issues
possibles : implémenter la définition cible, ou retirer la métrique. Ne pas la laisser
affichée sous ce nom. Propriétaire : Paul pour le calcul, Léo pour la décision.

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

DÉFINITION CIBLE

    DebtService(t) = Σ paiementContractuel_i(t) pour les prêts tels que
                     firstPaymentDate_i <= t <= maturityDate_i

Un prêt en différé, dont la première échéance est postérieure à `t`, contribue 0.
Un prêt échu contribue 0.

ÉTAT DU CODE
`Σ monthlyPayment` filtré sur `firstPaymentDate <= "2027-08-19"`. La borne est une
constante littérale, pas une dérivation de la date zéro, et la maturité n'est pas
testée. Au seed, le prêt étudiant (première échéance 2026-12-05) est donc compté
dès la date zéro : 284,72 €.

ÉCART
BLOQUANT. Trois définitions coexistent aujourd'hui dans le produit :
- moteur : 284,72 € comptés dès le 19 août 2026 ;
- explication affichée à l'utilisateur : « Service de dette actuel : 0,00 € avant le
  5 décembre 2026 » (`pages.tsx:307`) ;
- `docs/ASSUMPTIONS.md` : « La mensualité étudiante n'entre dans le cash flow exigible
  qu'à partir du 5 décembre 2026 », et annonce un cash-flow de +142 €/mois.
Le produit affiche -142,72 €/mois en le libellant « avant échéance du prêt ».
Arbitrage produit requis avant toute correction de code : voir `OPEN_QUESTIONS.md` Q-01.
Propriétaire : Léo pour l'arbitrage, Paul pour l'implémentation.

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

DÉFINITION CIBLE
- SavingsRate = épargne effectivement constituée sur la période / revenu net de la période.
- InvestmentRate = montant effectivement investi sur la période / revenu net de la période.
Ces deux grandeurs se mesurent sur des flux constatés, pas sur un FCF théorique.

ÉTAT DU CODE
- `savingsRate = freeCashFlow / monthlyIncome`, non borné : -11,1 % au seed.
- `investmentRate = max(0, freeCashFlow) / monthlyIncome`, soit 0 au seed.

ÉCART
Les deux métriques mesurent la même chose (le FCF), pas l'épargne ni l'investissement
constatés. `investmentRate` est identique à `savingsRate` dès que le FCF est positif :
c'est un doublon. Aucune des deux ne doit être présentée comme un taux d'épargne tant
que les transactions ne sont pas importées. Propriétaire : Paul, arbitrage Léo.

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
- Principal : transfert d'un passif vers un actif, patrimoine net inchangé.
- Cash-out : intérêt + principal + assurance + frais, ce qui sort du compte.

Un remboursement de principal n'est pas une dépense au sens du compte de résultat
personnel, mais c'est bien une sortie de trésorerie.

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
Aucune unité n'est affichée. Propriétaire : Léo (libellé), Paul (convention).

### 8.2 Monthly Close

DÉFINITION CIBLE
Une clôture mensuelle est une photographie figée. Elle n'est réécrite que par une
procédure explicite de réouverture, tracée.

    Variance(mois) = NetWorthConstaté(mois) - NetWorthPrévu(mois)

où « prévu » désigne la projection produite avant le mois, pas la clôture précédente.

ÉTAT DU CODE
`create_monthly_close` fait un UPSERT sur `(user_id, close_date)` : relancer la clôture
d'un mois déjà clos écrase silencieusement la ligne précédente. Le champ
`forecast_net_worth` reçoit le `netWorth` de la clôture précédente, pas une prévision.
`variance` mesure donc une variation, pas un écart au plan.

ÉCART
1. Écrasement silencieux : viole la définition de « figé ».
2. Le champ `forecast_net_worth` porte un nom faux. L'interface promet « Écart réel vs
   prévu » alors que le système calcule « écart au mois précédent ».
Propriétaire : Paul, arbitrage Léo sur la sémantique cible.

## 9. Projection et distribution

### 9.1 Deux moteurs, deux trajectoires

ÉTAT DU CODE
- `deterministicProjection` : pas annuel, épargne ajoutée en fin d'année, exécuté
  uniquement côté client dans `TodayPage`, jamais persisté.
- `runMonteCarlo` : pas mensuel, épargne ajoutée chaque mois, exécuté par
  `POST /api/projection`, persisté.

À paramètres identiques, les deux moteurs ne produisent pas la même trajectoire, et
aucun texte ne l'explique à l'utilisateur.

DÉFINITION CIBLE
Un seul moteur de trajectoire. La projection déterministe doit être la médiane du
modèle à volatilité nulle, ou être supprimée. Propriétaire : Paul, arbitrage Léo.

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
| MODEL_ASSUMPTION | hypothèse produite par le moteur |
| EXTERNAL_DATA | donnée issue d'une source externe datée |
| DERIVED | résultat de calcul sur d'autres données |
| MISSING | information matériellement absente |

Règles :
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
   modélisé. Une saisie n'est pas une vérification.
3. Aucun mécanisme de conflit import / correction manuelle n'existe, faute d'import.
Propriétaire : Paul pour 1, Léo pour 2, différé pour 3.

## 11. Complétude

DÉFINITION CIBLE
Un calcul techniquement exécutable n'est pas économiquement fiable. La complétude
mesure la part des inputs matériellement nécessaires qui sont réellement renseignés,
pondérée par leur poids dans le résultat.

ÉTAT DU CODE
`dataCompleteness = catégories de budget renseignées / catégories de budget totales`.
Au seed : 1 / 20 = 5 %. Le dénominateur inclut les catégories « Revenu » et
« Investissement », qui ne sont pas des dépenses.

ÉCART
La métrique s'appelle `dataCompleteness` dans le type `DashboardMetrics` mais ne
mesure que la complétude du budget. Le nom promet un score global. Spécification
complète dans `COMPLETENESS_MODEL_SPEC.md`. Propriétaire : Léo.

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

## 14. Points soumis à la review Checkpoint 1

1. Arrondi monétaire canonique : quelle règle, à quelle couche ?
2. Convention actif / passif d'un compte bancaire débiteur.
3. `monthlyDebtService` pendant un différé : 0 ou mensualité contractuelle ?
4. `liquidNetWorth` : implémenter la définition ou retirer la métrique ?
5. `savingsRate` et `investmentRate` : conserver deux métriques ou une seule ?
6. `forecast_net_worth` de la clôture mensuelle : renommer ou brancher sur la projection ?
7. Confiance automatique HIGH après édition utilisateur : acceptable ?
8. Projection déterministe : conserver, aligner sur le Monte-Carlo, ou supprimer ?
9. `shockYear` : année relative ou année civile ?
10. Périmètre nommé « Patrimoine brut » alors que seuls les actifs financiers sont couverts.
