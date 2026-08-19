# Audit du moteur financier — Léo Family Office

Audit statique complet du repository au commit `ee0d16d` (branche `audit/financial-engine`), date zéro **2026-08-19**, devise de reporting **EUR**.

Périmètre : analyse seule. Aucune formule modifiée, aucun bug corrigé, aucun fichier fonctionnel touché. Ce document est le seul fichier créé.

Convention de priorité :
- **P0** — casse le contrat de confiance (suite de tests rouge, résultat financier faux, risque de perte de données).
- **P1** — erreur ou risque d'erreur financière matériel en usage normal, ou dérive entre définitions affichées.
- **P2** — définition floue, code mort, doublon conceptuel, constante magique sans impact immédiat.
- **P3** — hygiène, cosmétique, ergonomie d'explication.

---

## 0. Cartographie générale des moteurs

| Moteur | Fichier(s) | Appelé en production ? | Testé ? | Fiabilité |
|---|---|---|---|---|
| Primitives financières | `src/lib/engine/financial.ts` | Oui (data, UI, MC, decision, real-estate) | Oui, 7 tests dont **1 rouge** | Élevée, artefact flottant |
| Métriques cockpit (Net Worth / Cash Flow) | `src/lib/data/shared.ts` | Oui (2 adapters) | Oui, 6 tests | Moyenne (définitions contestables) |
| Monte-Carlo | `src/lib/engine/monte-carlo.ts` | Oui (`/api/projection`) | Oui, 3 tests | Moyenne (constantes temporelles) |
| Projection déterministe | `src/lib/engine/financial.ts` | Oui (UI `TodayPage` seulement) | Non | Moyenne (jamais réconciliée au MC) |
| Real Estate | `src/lib/engine/real-estate.ts` | Oui (UI, état local) | Oui, 1 test | Faible (formule d'equity discutée) |
| Tax | `src/lib/engine/tax.ts` | **Aucun appel site** | Oui, 2 tests | Faible (règles absentes) |
| Decision Lab | `src/lib/engine/decision.ts` | Oui (UI, inputs hardcodés) | **Non** | Faible (constantes magiques) |
| Career / Business / Goals / Timeline | `src/components/pages.tsx` (calculs inline) | Oui (UI seulement) | Non | Faible (100 % hardcodé) |
| FX / multi-devises | `src/lib/engine/financial.ts` (`fxConvert`) + `currency_rates` (schéma) | **Aucun appel site** | Oui, 1 test primitif | Faible (intégration absente) |

---

## 1. Primitives financières (`src/lib/engine/financial.ts`)

1. **État actuel** : moteur pur TypeScript, sans dépendance, le socle de tous les autres moteurs. 10 fonctions exportées. `applyScenarioOverrides` n'a aucun appel en production.
2. **Fichiers concernés** : `src/lib/engine/financial.ts`; consommé par `shared.ts`, `decision.ts`, `real-estate.ts`, `monte-carlo.ts` (types), `pages.tsx`, `local-repository.ts` (seed), `scripts/seed-supabase.ts`, `shared.test.ts`.
3. **Formules utilisées** :
   - `compoundReturn` : `V = P·(1 + r/n)^(n·t)`
   - `realValue` : `V = P / (1 + inflation)^t`
   - `fxConvert` : `V = montant × eurPerUnit` (convention EUR par unité, jamais utilisée en production)
   - `amortizeLoan` : PMT = `(P·r/12) / (1 − (1 + r/12)^(−n))`; principal plafonné au solde restant; dernière ligne plafonnée au capital (pas d'intérêt inventé)
   - `npv` : `Σ CFt / (1 + r)^t`
   - `irr` : bissection sur `[−0.9999, …]`, expansion du borne haute ×2, 160 itérations, tolérance 1e-8, retour `null` si pas de changement de signe du NPV
   - `moic` : `Σ distributions / capital investi`
   - `calculateNetWorth` : `grossAssets − Σ passifs`
   - `deterministicProjection` : chaque année `actif = actif·(1 + r) + épargne×12`, choc daté appliqué après capitalisation, valeur réelle = `realValue`
4. **Inputs / Outputs** : inputs numériques purs; outputs `AmortizationRow[]`, `number`, `{grossAssets, debt, netWorth}`, `ProjectionPoint[]`.
5. **Provenance des données** : aucune donnée interne; tout vient des appelants (état agrégé ou UI).
6. **Dépendances** : uniquement `@/lib/types` (types). Aucun import React/Supabase.
7. **Niveau de fiabilité** : élevé pour les primitives classiques (testées), **artefact de précision flottante visible** : `15571.49 − 16745 = −1173.5100000000002` (voir état des tests).
8. **Problèmes potentiels** :
   - `deterministicProjection` **ignore `salaryGrowth`** (champ du scénario jamais utilisé).
   - L'épargne mensuelle est ajoutée en fin d'année (décalage temporel vs MC qui ajoute mensuellement) → les deux moteurs ne produisent pas la même trajectoire pour les mêmes paramètres.
   - `irr` : ambiguïté multi-TRI non gérée; `guess=0.1` fixe; pas de borne haute du taux (expansion non bornée).
   - `moic` compte uniquement les flux **positifs** (`Σ max(0, CF)`) appelé depuis le real estate → MOIC asymétrique (voir Real Estate).
   - Aucun arrondi monétaire normalisé (float brut partout).
9. **Tests existants** : `src/lib/engine/__tests__/financial.test.ts` — 7 tests (compound, realValue, amortissement 0 %, plafonnement, NPV/IRR/MOIC, FX, net worth, overrides).
10. **Tests nécessaires** : `deterministicProjection` (croissance, épargne, choc, inflation, équivalence année zéro); `irr` multi-TRI / flux non conventionnels / `null`; plafonnement d'amortissement avec `contractualPayment < PMT`; `moic` avec flux négatifs.
11. **Priorité de correction** : **P1** — principalement pour la non-utilisation de `salaryGrowth` et la divergence déterministe/MC; primitives pures elles-mêmes P2.

> **P0 ponctuel lié :** le test « calculates net worth from accounts rather than positions » échoue (`toEqual` strict sur −1173.5100000000002 ≠ −1173.51). La suite `pnpm test` est **rouge à la ligne de base**.

---

## 2. Métriques cockpit — Net Worth & Cash Flow (`src/lib/data/shared.ts`)

1. **État actuel** : moteur de métriques central, partagé par les deux adapters (SQLite et Supabase). C'est le seul endroit où le patrimoine est agrégé.
2. **Fichiers concernés** : `src/lib/data/shared.ts` (`deriveMetrics`, `AS_OF_DATE`, `REPORTING_CURRENCY`), consommé par `local-repository.ts` et `supabase-repository.ts`.
3. **Formules utilisées** :
   - `grossAssets = Σ solde des comptes` (toutes catégories, y compris comptes débiteurs CIC −3,44 €)
   - `debt = Σ currentBalance des passifs`
   - `netWorth = grossAssets − debt`
   - `bankCash = Σ comptes type BANK + SAVINGS` (exclut PEA/CTO; le cash PEA n'est pas du cash bancaire)
   - `investedAssets = Σ positions dont isCash = false` (≠ soldes de comptes investissement)
   - `liquidNetWorth = grossAssets − debt` → **identique à `netWorth`** (doublon)
   - `monthlyIncome = Σ revenus actifs`
   - `monthlyExpenses = Σ catégories renseignées` (aucune substitution pour les nulles)
   - `monthlyDebtService = Σ monthlyPayment des passifs dont firstPaymentDate <= "2027-08-19"` (**date magique**, = AS_OF_DATE + 1 an non exprimée)
   - `freeCashFlow = monthlyIncome − monthlyExpenses − monthlyDebtService`
   - `savingsRate = freeCashFlow / monthlyIncome` (0 si revenu nul; **pas de plancher**)
   - `investmentRate = max(0, freeCashFlow) / monthlyIncome` (**pas de plafond à 1**)
   - `emergencyCoverageMonths = bankCash / dépenses essentielles connues` (dénominateur partiel : seul le loyer connu)
   - `dataCompleteness = catégories renseignées / catégories totales` (20 catégories incluant « Revenu » et « Investissement »)
4. **Inputs / Outputs** : `(accounts, liabilities, incomes, expenses, positions) → DashboardMetrics` (16 métriques).
5. **Provenance des données** : agrégation de lignes portant toutes une provenance (`ACTUAL`/`USER_ASSUMPTION`/`MISSING`…). Aucune provenance n'est recalculée ici.
6. **Dépendances** : `financial.ts` (`calculateNetWorth`) + types.
7. **Niveau de fiabilité** : moyen. Les comptes sont cohérents à la date zéro, mais trois définitions du service de dette coexistent (voir §8), la date de fenêtre est magique, et la multi-devise est ignorée (voir §15).
8. **Problèmes potentiels** :
   - `monthlyDebtService` inclut **dès aujourd'hui** les 284,72 € (première échéance 2026-12-05) via la fenêtre `<= 2027-08-19`, **ce que l'UI contredit** : « Avant échéance du prêt », « 0,00 € avant le 5 décembre 2026 » (explication cash flow, `pages.tsx:307`) → `freeCashFlow = −142,72 €` affiché pendant que l'explication annonce 0 € de dette exigible.
   - La fenêtre magique `"2027-08-19"` ne bouge jamais si `AS_OF_DATE` évolue; elle ignore aussi l'échéance (la mensualité serait comptée indéfiniment même après `maturityDate`).
   - `liquidNetWorth` duplique exactement `netWorth` (définition « liquide » absente).
   - `savingsRate` peut être < −100 % (dépenses > 2× revenus); `investmentRate` peut dépasser 100 %.
   - `dataCompleteness` compte les catégories « Revenu » et « Investissement » dans le dénominateur (20), or ce ne sont pas des dépenses → taux d'exhaustivité pessimiste de 15 %.
   - Les comptes multi-devises sont additionnés en valeur brute, **sans conversion** (voir §15).
   - `add_account` enregistre la nouvelle balance à `AS_OF_DATE` figé et non à la date du jour (toutes dates figées à la date zéro par design, mais dérive dès qu'on passe au mois suivant).
9. **Tests existants** : `src/lib/data/__tests__/shared.test.ts` — 6 tests (pas de double comptage positions, net worth, revenus inactifs, service de dette, complétude, divisions par zéro).
10. **Tests nécessaires** : fenêtre de date du service de dette (avant/après `firstPaymentDate`, après `maturityDate`); compte à devise non-EUR; `savingsRate` en négatif profond; `investmentRate > 1`; cohérence `liquidNetWorth === netWorth` (décision d'alignement à trancher).
11. **Priorité de correction** : **P1** (définition du service de dette contradictoire avec l'UI + fenêtre magique); doublon `liquidNetWorth` P2.

---

## 3. Debt (`src/lib/engine/financial.ts` + UI `src/components/pages.tsx`)

1. **État actuel** : pas de moteur Dette dédié; l'amortissement est calculé par `amortizeLoan` (primitive) depuis l'UI (`DebtPage`) sur **la première dette uniquement** (`liabilities[0]`). Une table `loan_schedules` est remplie au seed (dérivée `DERIVED`) mais **jamais relue**.
2. **Fichiers concernés** : `src/lib/engine/financial.ts` (`amortizeLoan`), `src/components/pages.tsx` (`DebtPage` :161-175), `src/lib/data/local-repository.ts` (:120-127), `scripts/seed-supabase.ts` (:126-131), `src/lib/data/schema.sql` (`loan_schedules`).
3. **Formules utilisées** : PMT standard de `amortizeLoan`; `contractualTotal = monthlyPayment × paymentCount`; `écart = contractualTotal − principal` (338,20 € affiché) — calculé dans l'UI.
4. **Inputs / Outputs** : `(principal, annualRate, payments, contractualPayment)` → échéancier 60 lignes. Inclut un « debt vs invest » via `compareDebtVsInvest` (voir §10).
5. **Provenance des données** : `lia_student` seedée `ACTUAL/HIGH` (« Données communiquées par Léo »); échéancier `DERIVED`.
6. **Dépendances** : `pages.tsx` → `financial.ts` + `decision.ts`; seed → `financial.ts`.
7. **Niveau de fiabilité** : moyen. L'échéancier 0 % est correct, mais l'écart contractuel de 338,20 € reste non résolu, l'échéancier bancaire réel n'est pas importé, et le panneau « Dates clés » est un texte statique (« 5 décembre 2026 », « 5 novembre 2031 ») non dérivé des champs de la dette.
8. **Problèmes potentiels** :
   - `DebtPage` ne traite que `liabilities[0]` : une seconde dette serait ignorée par l'échéancier (mais comptée dans `metrics.debt` → incohérence de périmètre).
   - `loan_schedules` écrite au seed mais jamais lue : deux échéanciers (BD vs recalcule client) peuvent diverger.
   - `compareDebtVsInvest` appelé avec `availableCash: 5000`, `volatility: 0.15`, `inflation: 0.02`, `years: 5`, `liquidityWeight: 0.03` **hardcodés** alors que « Capital disponible » est un curseur ailleurs (Decision Lab) → deux scénarios différents présentés comme le même arbitrage.
   - Coût d'intérêt dérivé affiché « 0,00 € » : correct à taux 0 %, mais affiché comme une vérité dérivée alors que des frais peuvent exister.
9. **Tests existants** : les tests d'`amortizeLoan` (2 cas dans `financial.test.ts`). Aucun test d'intégration du seed ni de l'UI.
10. **Tests nécessaires** : échéancier avec `contractualPayment < PMT` (solde résiduel), avec plusieurs dettes (périmètre de `DebtPage`), réconciliation `loan_schedules` stockée vs recalculée, écart 338,20 € (régression).
11. **Priorité de correction** : **P1** (périmètre `[0]` + double source d'échéancier + inputs hardcodés); textes statiques P3.

---

## 4. Investments (`src/components/pages.tsx` + `shared.ts`)

1. **État actuel** : pas de moteur Investissement dédié. L'UI calcule tout : gap de réconciliation PEA, allocation, concentrations, et affiche des valeurs **hardcodées** (plus-value, versements, performance CTO).
2. **Fichiers concernés** : `src/components/pages.tsx` (`InvestmentsPage` :149-162, `TodayPage` allocation :62-67), `src/lib/data/shared.ts` (`investedAssets`), `src/lib/data/local-repository.ts`/`supabase-repository.ts` (positions seedées).
3. **Formules utilisées** : `peaComponents = Σ positions PEA`; `peaGap = solde PEA − peaComponents`; `concentration = 8698 / grossAssets` (**valeur hardcodée**); allocation donut = positions par classe + `bankCash`; percentiles non calculés (aucun historique de prix).
4. **Inputs / Outputs** : positions `(valeur, costBasis, classe, isCash)` → réconciliation et allocation. Performance annoncée non calculée (string « +77,71 % »).
5. **Provenance des données** : positions `ACTUAL/HIGH` seedées; provenance affichée via badges.
6. **Dépendances** : `shared.ts` (métriques), `types.ts`.
7. **Niveau de fiabilité** : moyen à faible. La réconciliation PEA est honnête (gap 0,56 € exposé), mais les IDs de comptes **`acc_pea`/`acc_cto` sont hardcodés** et plusieurs valeurs clés sont des constantes de code.
8. **Problèmes potentiels** :
   - **IDs de comptes hardcodés** (`"acc_pea"`, `"acc_cto"`, `pages.tsx:150-154`) : si un compte PEA est recréé, les IDs changent (UUID) et l'UI se casse silencieusement.
   - `Concentration MSCI World = 8698 / grossAssets` : la valeur 8 698 € est **écrite en dur dans le code** (pages.tsx:156) ; si la position change, le chiffre reste faux.
   - « Plus-value PEA annoncée 703,12 € », « Versements annoncés 14 300 € », « +77,71 % » : constantes non dérivées des données.
   - La donut « Où sont les actifs » somme les tranches (15 570,93 €) ≠ centre (`grossAssets` 15 571,49 €) : écart de 0,56 € (le gap PEA) rendu visible → désynchronisation visuelle de deux définitions.
   - `investedAssets` (positions non-cash) ≠ total PEA+CTO affiché ailleurs : périmètre différent non étiqueté.
9. **Tests existants** : test de non-double-comptage des positions dans `shared.test.ts`. Aucun test UI (aucun framework UI installé).
10. **Tests nécessaires** : extraction de la logique `peaGap`/allocation dans un module testable; test de dérive d'IDs; test que les constantes (8698/703,12/14300) soient remplacées par des références aux données.
11. **Priorité de correction** : **P1** (IDs hardcodés + valeurs monétaires en dur dans l'UI, risque de faux chiffres).

---

## 5. Projection déterministe (`src/lib/engine/financial.ts` + `TodayPage`)

1. **État actuel** : moteur existant (`deterministicProjection`) mais exécuté **uniquement côté client** dans `TodayPage` (pages.tsx:61) — hors route API, hors persistence. Renommage important : il n'est pas réconcilié avec le Monte-Carlo.
2. **Fichiers concernés** : `src/lib/engine/financial.ts` (:103-116), `src/components/pages.tsx` (:61), `src/components/app-shell.tsx` (projection MC séparée).
3. **Formules utilisées** : `assets = assets·(1 + annualReturn) + monthlySavings·12` par an; choc `× (1 + shockMagnitude)` si `shockYear === year`; `real = nominal / (1 + inflation)^t`.
4. **Inputs / Outputs** : `(grossAssets, 12 ans, scénario Central)` → `[{year, nominal, real}]` mappé en `{year: 2026 + point.year}` — **base d'année 2026 hardcodée** dans l'UI, et le moteur ignore `salaryGrowth`.
5. **Provenance des données** : état actuel `ACTUAL` (actifs) + hypothèses `MODEL_ASSUMPTION` (scénario).
6. **Dépendances** : `financial.ts`; aucune des données de projection n'est persistée.
7. **Niveau de fiabilité** : moyen — la marge dépend entièrement du scénario « Central » dont les hypothèses sont `MODEL_ASSUMPTION/MEDIUM` (5,5 %, 15 % vol, 250 €/mois).
8. **Problèmes potentiels** : horaire annuel vs MC mensuel (trajectoires divergentes pour mêmes paramètres); la projection part de `grossAssets` mais ajoute 250 €/mois d'épargne **découplés du cash flow réel connu (−142,72 €)**; l'année de base 2026 est dupliquée dans l'UI et dans le MC.
9. **Tests existants** : aucun test de `deterministicProjection`.
10. **Tests nécessaires** : trajectoire nominale/réelle, application du choc, égalité « année 0 = initial », comparaison de référence déterministe vs médiane MC.
11. **Priorité de correction** : **P2** (moteur sain, mais non testé et non raccordé au pipeline API/persistence).

---

## 6. Monte-Carlo (`src/lib/engine/monte-carlo.ts`)

1. **État actuel** : moteur le plus complet; servi par `POST /api/projection`, reproductible par seed, simulé à pas mensuel, persisté (`simulation_runs/results`). Aucune modification d'architecture autorisée (stop-list).
2. **Fichiers concernés** : `src/lib/engine/monte-carlo.ts`, `src/app/api/projection/route.ts`, `src/components/app-shell.tsx` (`runProjection`), `src/components/pages.tsx` (`ScenariosPage`), `schema.sql` (`simulation_runs`, `simulation_results`), les deux adapters (`saveSimulation`).
3. **Formules utilisées** : PRNG `mulberry32`; normal via Box-Muller; Student-t à 5 ddl normalisée (`/√(5/3)`); rendement mensuel = `(1 + annualReturn)^(1/12) − 1 + (vol / √12) · z`; stress rare : si `rand < stressProbability/12`, rendement réduit de `0.12 + rand·0.15` (**amplitudes fixes −12 % à −27 %**); sorties : `assets = max(0, assets·(1 + r) + monthlySavings)`; choc daté après le mois 12; percentiles par interpolation linéaire de l'échantillon trié; `year = 2026 + year`; `age = (startingAge ?? 23) + year`.
4. **Inputs / Outputs** : `{scenario, initialAssets, years 1..80, simulations 100..20000, seed, startingAge?}` → `ProjectionResult {scenarioId, seed, simulations, points p10..p90, methodology}`. Validation Zod côté route (`zod` : `years ≤ 80`, `simulations ≤ 20000`).
5. **Provenance des données** : hypothèses `MODEL_ASSUMPTION` (scénarios versionnés), actifs de départ `ACTUAL`. Disclaimer de méthodologie stocké dans le résultat.
6. **Dépendances** : `types.ts`; `financial.ts` **n'est pas utilisé par le MC** (formules dupliquées en interne : capitalisation, choc, percentiles).
7. **Niveau de fiabilité** : moyen. Logique correcte et testée sur 3 propriétés, mais : **année de base « 2026 » hardcodée** (au lieu de `AS_OF_DATE`), âge de départ 23 par défaut, approfondissement des queues fixé en dur, `salaryGrowth` et `monthlySavings` sans croissance.
8. **Problèmes potentiels** : `year: 2026 + year` dérivera dès que `AS_OF_DATE` change; `startingAge` jamais transmis par l'API (toujours 23); amplitudes de stress codées (`0.12 + 0.15·rand`) non paramétrées par scénario; l'épargne mensuelle est constante (pas de lien avec `salaryGrowth` ni inflation); chaque clic « Lancer 3 000 simulations » persiste ~150 lignes (`simulation_results`) — le bouton `runProjection(selectedId, 30, 3000, seed)` part toujours de `grossAssets` (pas de lien avec les objectifs ni la dette amortie, la dette n'est pas décrémentée dans la projection).
9. **Tests existants** : `src/lib/engine/__tests__/monte-carlo.test.ts` — 3 tests (reproductibilité du seed, ordre des percentiles, choc daté).
10. **Tests nécessaires** : effet d'un stress rare en distribution (taille des queues); invariants `p50 ≈ capital initial` à vol=0 et taux=0; comportement à `simulations` faible (< 100 → throw); cohérence année/âge avec `AS_OF_DATE`; conservation de la somme `savings × 12` vs épargne mensuelle; stabilité numérique pour `vol` très élevé.
11. **Priorité de correction** : **P1** (année/âge hardcodés, amplitudes de stress fixes) ; le reste du moteur P2.

---

## 7. Real Estate (`src/lib/engine/real-estate.ts`)

1. **État actuel** : moteur complet d'underwriting (TRI, VAN, MOIC, LTV, DSCR, CoC), mais **cas de travail non patrimonial** : état React local, jamais persisté, jamais intégré au Net Worth. Table `properties/mortgages/real_estate_cashflows` existante dans le schéma, inutilisée par le code.
2. **Fichiers concernés** : `src/lib/engine/real-estate.ts`, `src/components/pages.tsx` (`RealEstatePage` :178-190), `schema.sql` (`properties`, `mortgages`, `real_estate_cashflows`).
3. **Formules utilisées** :
   - `totalProjectCost = prix + frais + travaux + mobilier`
   - PMT standard (réutilisée); `debtService = PMT × 12`
   - `effectiveRent = loyer × 12 × (1 − vacancyRate)`
   - `NOI = rente effective − charges annuelles` (charges **constantes** sur l'horizon, sans croissance)
   - `investedEquity = apport + frais + travaux + mobilier` ⚠️ voir §8
   - cash-flows annuels : `(NOIₜ − debtService) × (1 − taxRate)`; année de sortie + `exitValue × (1 − sellingCostsRate) − capital restant`
   - `exitValue = prix × (1 + croissance valeur)^horizon`
   - `grossYield = loyer×12 / prix; netYield = NOI / prix; LTV = loan / prix`
   - `cashOnCash = annualCashFlow / investedEquity`
   - `DSCR = NOI / debtService` (∞ si sans dette)
   - `totalInterest = max(0, PMT×months − loan)` (intérêt contractuel, inclut l'écart 338,20 € du prêt étudiant si appliqué)
   - `MOIC = Σ max(0, CF₁..CFₙ) / investedEquity` — **ignorer les flux négatifs de sortie**
   - `IRR` et `NPV` (taux d'actualisation par défaut **6 % hardcodé**) réutilisés depuis `financial.ts`
4. **Inputs / Outputs** : `RealEstateInputs` (16 champs) → `RealEstateResult` (17 champs dont `cashFlows[]`). CAGR propriété (`1.5 %`) et loyers (`1.5 %`) en hypothèses.
5. **Provenance des données** : 100 % `USER_ASSUMPTION` (defaults hardcodés dans `defaultProperty`, pages.tsx:178). Aucune donnée `ACTUAL`.
6. **Dépendances** : `financial.ts` (`irr`, `moic`, `npv`).
7. **Niveau de fiabilité** : **faible à moyen** :
   - `investedEquity = down + frais + travaux + mobilier` est **faux quand `loanAmount ≠ purchasePrice`**. Cas par défaut : projet 257 600 €, prêt 227 600 €, equity réelle = 30 000 € (apport). La formule renvoie 67 600 € → **CoC, IRR et MOIC sous-estimés** (dénominateur 2,25× trop grand).
   - Le calcul du principal (`annualPrincipal`) est mort (`void annualPrincipal`) : la dette est implicitement remboursée via le `debtService` annuel constant, mais si `monthlyPayment ≤ interest` (amortissement négatif), `outstanding` peut croître sans garde-fou.
   - MOIC positif-only : les flux de sortie négatifs ne comptent pas → MOIC optimiste.
   - Fiscalité ultra-simplifiée (taux effectif global unique, pas de distinction IR/plus-value/assurance), charges constantes, pas de CAPEX, pas d'ajustement `vacancyRate` au fil des ans (vacance appliquée au loyer initial seulement).
8. **Problèmes potentiels** : formule `investedEquity` (P1); `annualPrincipal` inutilisé (P2); MOIC asymétrique (P2); `discountRate = 0.06` magique (P3); zero-division protégée (`?? 0`) mais rendements sans sens (ex. `purchasePrice = 0`).
9. **Tests existants** : `src/lib/engine/__tests__/real-estate.test.ts` — **1 seul test** (totaux, rendement brut, longueur de cash-flows, IRR non nul, MOIC > 0).
10. **Tests nécessaires** : vérification du CF de sortie (principal restant, frais de vente, taxe); cas `loanAmount = purchasePrice` vs `loanAmount < purchasePrice` (formule d'equity); amortissement négatif; DSCR sans dette; MOIC avec flux de sortie négatif; égalité `cashFlows[0] = −equity`.
11. **Priorité de correction** : **P1** (formule d'equity), P2 (MOIC, principal mort).

---

## 8. Career (`src/components/pages.tsx`)

1. **État actuel** : **sandbox 100 % UI** — trajectoires hardcodées, aucune table, aucun moteur, distinction claire « hypothèses / pas des promesses » (bonne gouvernance affichée).
2. **Fichiers concernés** : `src/components/pages.tsx` (`CareerPage` :192-207), `ASSUMPTIONS.md` (registre).
3. **Formules utilisées** : `fixed = base × (1 + growth)^year`; `variable = bonus × 1.08^year` (**croissance variable fixe 8 %/an**); `total = fixed + variable` sur 9 ans à partir de **2027 hardcodé**. Pas d'actualisation, pas de conversion brut→net via le moteur fiscal (pourtant disponible).
4. **Inputs / Outputs** : 6 pistes hardcodées `{base, growth, bonus}` (42 k€ / 0,12; 42 / 0,16; 40 / 0,08; 40 / 0,09; 38 / 0,10; 20 / 0,28) → bandes salariales et courbe `salaryData`. MetricCards « 42 000 € », « 9 000 € », revenu net actuel 1 282 € (métrique), « ≈ 2 ans ».
5. **Provenance des données** : `MODEL_ASSUMPTION/LOW` (courbes non sourcées, datées 19 août 2026); assumption `asm_variable` = « Hypothèse faible confiance ».
6. **Dépendances** : `state.metrics.monthlyIncome` (affichage), `state.assumptions`. Aucun lien avec les moteurs salariaux.
7. **Niveau de fiabilité** : faible (assumé : bande 40–45 k€, 3–15 k€ variable).
8. **Problèmes potentiels** : calculs financés dans le JSX (Math.pow inline); le moteur `employmentCompensation` (tax.ts) est **inutilisé alors qu'il est prévu pour cela**; pas de jonction Career → Net Worth/projection (dans la stop-list, donc à signaler seulement); la variable brute 9 k€ est affichée comme si net venait du registre alors qu'elle ne correspond pas à la fiscalité.
9. **Tests existants** : aucun.
10. **Tests nécessaires** : extraction d'un moteur `career.ts` (piste → courbes) et tests de trajectoire; test de parité avec le convertisseur brut-net.
11. **Priorité de correction** : **P2** (hypothèses de mise à jour/paramétrage), P3 (calculs inline); l'intégration au Net Worth est différée (stop-list).

---

## 9. Business Equity (`src/components/pages.tsx`)

1. **État actuel** : **bac à sable 100 % UI**; calcul inline (pas de moteur `business.ts`). Tables `businesses/business_financials/business_valuations` présentes dans le schéma, jamais lues.
2. **Fichiers concernés** : `src/components/pages.tsx` (`BusinessPage` :210-224), `schema.sql`.
3. **Formules utilisées** : `EV = EBITDA × multiple`; `equityValue = EV − dette + cash`; `attribuable = equityValue × ownership%`; `marge = EBITDA / CA`. Toutes en JSX.
4. **Inputs / Outputs** : 6 curseurs (CA 500 000, EBITDA 80 000, multiple 6×, dette 100 000, cash 30 000, ownership 100 %) → 4 metrics. Defaults hardcodés.
5. **Provenance des données** : `USER_ASSUMPTION` (badge). Aucune donnée réelle.
6. **Dépendances** : aucune (React local state seul).
7. **Niveau de fiabilité** : faible (assumé : « aucune participation entrepreneuriale déclarée »).
8. **Problèmes potentiels** : formule d'EV/equity non testée, non persistée, non reliée au Net Worth; `ownership` sans limite inférieure (négatif possible via saisie ? — pas de `min`), `multiple` peut être négatif; labels « Dette nette brute » ambigus (dette + cash séparés).
9. **Tests existants** : aucun.
10. **Tests nécessaires** : moteur `business.ts` pur + tests (EV, equity, marge, ownership 0/100, divisions par zéro).
11. **Priorité de correction** : **P2** (aucun impact patrimonial actuel), mais P1 dès qu'une participation sera persistée.

---

## 10. Tax (`src/lib/engine/tax.ts`)

1. **État actuel** : moteur **existant mais jamais appelé en production**. Architecture datée (`DatedTaxRule`) correcte, mais **aucune règle française réelle** : la table `tax_rules` contient un placeholder `MISSING/UNKNOWN` (barème 2026 à confirmer), et l'UI ne calcule rien (« Règles actives vérifiées : 0 »).
2. **Fichiers concernés** : `src/lib/engine/tax.ts`, `src/components/pages.tsx` (`TaxPage` :226-233), `local-repository.ts` (:188-190), `seed-supabase.ts` (:199-204), `schema.sql` (`tax_profiles`, `tax_rules`).
3. **Formules utilisées** : `progressiveTax` : taxe marginale par tranches triées (`Σ max(0, min(revenu, borne_sup) − seuil) × taux`); `employmentCompensation` : `gross = fixe + variable`; `contributions = gross × employeeContributionRate`; `taxable = (gross − contributions) × (1 − deductibleAllowanceRate)`; `netAfterTax = netBeforeTax − incomeTax`.
4. **Inputs / Outputs** : `(taxableIncome, DatedTaxRule)` et `(grossFixed, grossVariable, employeeContributionRate, deductibleAllowanceRate, taxRule)` → pont brut→net.
5. **Provenance des données** : coordonnées `TaxProfile FR/INDIVIDUAL` (seed), règle placeholder `MISSING/UNKNOWN`, source `https://www.impots.gouv.fr` non vérifiée.
6. **Dépendances** : aucune (types only). Appelé uniquement par les tests.
7. **Niveau de fiabilité** : faible par absence de règles vérifiées — bon garde-fou : aucun calcul fiscal appliqué sans vérification.
8. **Problèmes potentiels** : **`socialContributionsRate` (champ du `DatedTaxRule`) n'est jamais utilisé** par `employmentCompensation` (contributions passées en paramètre) → double source de vérité; si le premier seuil est > 0 et qu'aucun seuil inférieur n'est défini, le revenu sous le 1er seuil n'est pas taxé (correct), mais si `threshold[0]` ≠ 0, pas d'ambiguïté gérée; pas de gestion CTO/PEA/plus-values (paramétrable affiché mais non implémenté); fiscalité immobilière simplifiée (taux effectif unique dans real-estate, non relié à ce moteur).
9. **Tests existants** : `src/lib/engine/__tests__/tax.test.ts` — 2 tests (tranches progressives sur fixture, pont brut-net).
10. **Tests nécessaires** : extrêmes de tranches (`taxableIncome = seuil exact`), revenu < premier seuil, barème FR de référence (hors scope auth/API), parité `socialContributionsRate` avec `employeeContributionRate`, fonctions d'arrondi.
11. **Priorité de correction** : **P2** (champ mort, non-utilisation) ; l'implémentation réelle du barème reste en stop-list (« Tax Engine réel »).

---

## 11. Scenarios (`src/lib/types.ts` + `local-repository`/`supabase-repository` + UI)

1. **État actuel** : données versionnées et duplicables, alimentionnées par `update_scenario` (version + 1, historisation `scenario_versions`, bascule `MODEL_ASSUMPTION → USER_ASSUMPTION` à la modification). `applyScenarioOverrides` existe mais n'est **jamais utilisé en production** (le MC consomme le scénario complet).
2. **Fichiers concernés** : `src/lib/types.ts` (`Scenario`), `local-repository.ts` (:161-174, 312-336), `supabase-repository.ts` (:281-312), `src/lib/validation/mutations.ts` (bornes : return ∈ [−0.99, 1], vol ∈ [0, 2], inflation ∈ [−0.1, 1], stress ∈ [0, 1], choc ∈ [−0.99, 5]), `pages.tsx` (`ScenariosPage`).
3. **Formules utilisées** : aucune dans le moteur scénario lui-même; il alimente `deterministicProjection` et `runMonteCarlo`. `salaryGrowth` est **stocké mais consommé nulle part** (ni déterministe, ni MC).
4. **Inputs / Outputs** : 8 paramètres modifiables → versions `scenario_versions`. Seed : 5 scénarios (Prudent 3,5 %/10 %; Central 5,5 %/15 %/250 €; Ambitieux 7 %/18 %/500 €; Stress 2,5 %/24 % + choc −35 % an 2; Très favorable 8,5 %/20 %/750 €).
5. **Provenance des données** : `MODEL_ASSUMPTION/MEDIUM` au seed; `USER_ASSUMPTION/HIGH` après édition (confiance automatiquement élevée — discutable mais assumé).
6. **Dépendances** : repos (SQLite/Supabase), validation Zod, UI.
7. **Niveau de fiabilité** : moyen; les scénarios remplacent les hypothèses futures **sans jamais toucher l'historique** (bonne propriété testée indirectement par `applyScenarioOverrides`).
8. **Problèmes potentiels** : `salaryGrowth` mort; le choc `shockYear` est relatif à l'année 1 du moteur (déterministe MC), pas à une année civile — risque de mauvaise interprétation (« année 2 » vs « 2027 »); seed par défaut `19082026` hardcodé à **3 endroits** (route, app-shell, ScenariosPage) — si l'un change, les runs ne sont plus comparables; l'édition passe toute confiance à HIGH sans vérification humaine; `duplicate_scenario` duplique jusqu'aux champs `created_at`.
9. **Tests existants** : aucun test dédié aux scénarios (versionnage, duplication, overrides) en dehors des 3 tests MC et du test `applyScenarioOverrides`.
10. **Tests nécessaires** : versionnage (update → version + 1, payload archivé), duplication (isolation), bornes de validation Zod (retour 400), `salaryGrowth` dans la projection (décision de l'utiliser ou le supprimer).
11. **Priorité de correction** : **P2** (`salaryGrowth` mort), P3 (seed multi-emplacements).

---

## 12. Decision Lab (`src/lib/engine/decision.ts`)

1. **État actuel** : moteur unique (`compareDebtVsInvest`), seul cas actif du Lab. Pas de table `decision_cases` utilisée (pourtant dans le schéma). Les autres cas (« Louer vs acheter », …) sont statiques.
2. **Fichiers concernés** : `src/lib/engine/decision.ts`, `src/components/pages.tsx` (`DebtPage` :169, `DecisionLabPage` :250-259).
3. **Formules utilisées** : `capital = min(dispo, dette)`; `intérêts évités = capital·(1 + taux_dette)^t − capital`; `valeur investie = capital·(1 + rendement)^t`; `riskHaircut = capital × vol × √t × 0.25` (**coefficient magique 25 %**); `liquidityValue = capital × liquidityWeight`; `opportunityAdvantage = gain invest − intérêts évités − riskHaircut + liquidityValue`; conclusions : seuil `vol > 15 %` → « Élevé ».
4. **Inputs / Outputs** : 9 paramètres → `{repay, invest, opportunityAdvantage, conclusion}` (bénéfices nominal/réel via `realValue`).
5. **Provenance des données** : `USER_ASSUMPTION`; deux sites d'appel **avec des inputs hardcodés et divergents** :
   - `DebtPage` : `availableCash: 5000`, `volatility: 0.15`, `inflation: 0.02`, `years: 5`, `liquidityWeight: 0.03`
   - `DecisionLabPage` : `debtRate: 0` (hardcodé, non dérivé de la dette — ici taux 0 % réel, mais code fragile), `inflation: 0.02`, `liquidityWeight: 0.03`, curseurs dispo/rendement/vol/horizon.
6. **Dépendances** : `financial.ts` (`compoundReturn`, `realValue`).
7. **Niveau de fiabilité** : faible — aucune propriété mathématique testée, constantes arbitraires (0.25, 0.15, 0.03), et la conclusion est lue comme reconmandation alors qu'elle est très dépendante des hypothèses.
8. **Problèmes potentiels** : **aucun test**; `riskHaircut` non sourcé; `liquidityWeight` non sourcé; `inflation` fixe 2 % dans l'UI alors que les scénarios ont leur propre inflation (2,5 % Prudent, 3,5 % Stress); disparité des sites d'appel (un même « arbitrage » peut donner deux conclusions); case « Rembourser vs investir » dupliquée en Debt et Lab, labels en dur; `conclusion` non internationalisable mais OK (app FR).
9. **Tests existants** : aucun (`decision.test.ts` absent).
10. **Tests nécessaires** : propriétés de base (capital plafonné à la dette; intérêts évités = 0 à taux 0; avantage = 0 si tous les inputs sont neutres), seuils de conclusion, absences de division par zéro (dette = 0).
11. **Priorité de correction** : **P1** (inputs hardcodés + aucun test pour un moteur qui émet des recommandations).

---

## 13. Goals (`src/components/pages.tsx`)

1. **État actuel** : simple CRUD (`add_goal`) + progression brute `netWorth / targetAmount` sur `max(0, netWorth)`. Milestones hardcodés.
2. **Fichiers concernés** : `pages.tsx` (`GoalsPage` :261-271), `local-repository.ts`/`supabase-repository.ts` (`add_goal`), `schema.sql` (`goals`).
3. **Formules utilisées** : `progress = max(0, netWorth) / target`; % atteint = `round(progress × 100)`; FI ratio, Freedom Coverage, Coast FIRE : **« Non calculable »** (dépenses souhaitées/revenus passifs absents).
4. **Inputs / Outputs** : `goals[]` (cible, date, priorité) → cartes de progression.
5. **Provenance des données** : `USER_ASSUMPTION`; seeds : 100 000 € (2032) et réserve 5 130 € (= 4,5 mois × loyer 1 140 € — cohérent avec `asm_emergency`).
6. **Dépendances** : `metrics.netWorth`.
7. **Niveau de fiabilité** : moyen (CRUD simple, pas de moteur de projection d'atteinte).
8. **Problèmes potentiels** : pas de moteur « quand l'objectif est-il atteint ? » (aucune liaison avec les scénarios/projection); gibier `milestones = [100k…20M]` hardcodé (non configurable malgré le libellé « Repères configurables »); target 5 130 € seedée manuellement (dépend du loyer si celui-ci change).
9. **Tests existants** : aucun (pas de tests de mutation `add_goal`).
10. **Tests nécessaires** : validation de `add_goal` (Zod), progression 0/netWorth négatif, lien hypotétique goals ↔ projection.
11. **Priorité de correction** : **P2** (le CRUD fonctionne; la valeur ajoutée « objectif atteignable » manque).

---

## 14. Monthly Close (`local-repository.ts` / `supabase-repository.ts`)

1. **État actuel** : fonctionnel via `create_monthly_close` (UPSERT sur `user_id+close_date`), snapshot `net_worth_snapshots` + ligne `monthly_closes` avec écart vs clôture précédente (`forecast_net_worth`, `variance`).
2. **Fichiers concernés** : `local-repository.ts` (:337-345), `supabase-repository.ts` (:314-328), `pages.tsx` (`TodayPage` bouton, `TimelinePage`).
3. **Formules utilisées** : `forecast = prior.netWorth ?? null` (le forecast n'est **pas** une projection — c'est la dernière clôture, pas la prévision déterministe/MC); `variance = netWorth − forecast`.
4. **Inputs / Outputs** : `{closeDate}` → `{grossAssets, debt, netWorth, forecastNetWorth, variance}`.
5. **Provenance des données** : snapshot `ACTUAL` (figé).
6. **Dépendances** : `deriveMetrics` (via `getDashboardState`).
7. **Niveau de fiabilité** : moyen — mécanique robuste (UPSERT idempotent), mais **le « forecast » n'est pas une prévision** : l'écart comparé est celui avec la clôture précédente, pas avec une trajectoire attendue (le Callout « Écart réel vs prévu » promet plus que ce qui est stocké).
8. **Problèmes potentiels** : terme `forecast_net_worth` trompeur (pas branché sur `deterministicProjection` ni MC); `INSER OR REPLACE`/UPSERT : refaire une clôture le même mois **écrase** l'historique (perte de données si la clôture est refaite après correction); `variance = netWorth − forecast` suppose que la clôture n+1 compare une valeur absolue — pas de normalisation temporelle.
9. **Tests existants** : aucun test de mutation `create_monthly_close`.
10. **Tests nécessaires** : idempotence du UPSERT, calcul de variance, écrasement/insert strict, liaison future forecast ↔ projection déterministe.
11. **Priorité de correction** : **P1** (écrasement possible + sémantique « prévu » trompeuse), la migration de schéma restant hors scope.

---

## 15. FX / Multi-currency (`src/lib/engine/financial.ts` + `schema.sql`)

1. **État actuel** : **primitif présent, intégration absente**. `fxConvert(amount, eurPerUnit)` existe et est testé, la table `currency_rates` est définie dans le schéma (SQLite et migrations Supabase), mais **aucun code** ne lit de taux, aucun compte/position non-EUR n'est convertible, et `REPORTING_CURRENCY = "EUR"` n'est qu'une étiquette.
2. **Fichiers concernés** : `financial.ts` (`fxConvert`), `shared.ts` (`REPORTING_CURRENCY`), `schema.sql` (`currency_rates`), `types.ts` (`FinancialAccount.currency`, `Position.currency`), `pages.tsx` (« Devise reporting EUR » statique).
3. **Formules utilisées** : `fxConvert` (multiplication simple) — jamais appelée.
4. **Inputs / Outputs** : `(montant, eurPerUnit) → montant EUR`.
5. **Provenance des données** : aucune (pas de source de taux — roadmap « market data, FX et inflation externes » différé volontairement).
6. **Dépendances** : aucune en production.
7. **Niveau de fiabilité** : **risque latent** : l'UI permet d'ajouter un compte avec devise arbitraire (validation : 3 caractères), et `deriveMetrics` somme les soldes **bruts** → un compte en USD serait déclaré comme EUR (sous-déclaration/erreur directe dans `grossAssets`, `bankCash`, `netWorth`).
8. **Problèmes potentiels** : addition multi-devise silencieuse; `fxConvert` sans appel; aucun fallback de taux ni source (`EXTERNAL_DATA` non utilisé); la position US (« Physical Gold USD » mentionné au CTO) est comptée en EUR sans conversion; `currency_rates` jamais alimentée.
9. **Tests existants** : 1 test de `fxConvert` (taux positif, rejet de 0).
10. **Tests nécessaires** : garde-fou `deriveMetrics` sur devise ≠ reporting (throw ou conversion); tests de `currency_rates` (source, date, unicité); test d'un compte USD fictif.
11. **Priorité de correction** : **P1** (risque d'erreur de patrimoine dès la saisie d'une devise non-EUR).

---

## 16. Synthèse transversale

### Critical findings

1. **Suite de tests rouge à la ligne de base** — 1 test échoue (`financial.test.ts:40`) : `15571.49 − 16745 = −1173.5100000000002` vs attendu `−1173.51` (`toEqual` strict sur float). Conséquence : `pnpm test` / `pnpm check` sont cassés dès le premier commit. **P0**.
2. **Service de dette auto-contradictoire** : `deriveMetrics` compte 284,72 € de mensualité dès aujourd'hui via la fenêtre magique `<= "2027-08-19"`, alors que l'UI affiche « Avant échéance du prêt », « 0,00 € avant le 5 décembre 2026 » et « Dette dès déc. 2026 » (3 définitions simultanées). `freeCashFlow` affiché −142,72 € « avant prêt ». **P1**.
3. **`investedEquity` du Real Estate double-compte les frais/travaux/mobilier quand `loanAmount ≠ purchasePrice`** (cas par défaut : equity réelle 30 k€ vs 67,6 k€ calculés) → IRR/CoC/MOIC systématiquement sous-estimés. **P1**.
4. **IDs de comptes et valeurs monétaires hardcodés dans l'UI** (`acc_pea`, `acc_cto`, 8 698 €, 703,12 €, 14 300 €, « +77,71 % ») : faux chiffres garantis dès la prochaine mise à jour de données. **P1**.
5. **Multi-devise silencieuse** : aucun garde-fou empêche un compte USD d'être additionné comme EUR dans toutes les métriques. **P1**.
6. **`salaryGrowth` stocké mais jamais consommé** (déterministe et MC), `applyScenarioOverrides` et `socialContributionsRate` inutilisés, `annualPrincipal` mort. **P2**.
7. **Année de base MC hardcodée (`2026`)** et âge par défaut 23, non dérivés de `AS_OF_DATE`/profil. **P1** (dérive temporelle), amplitudes de stress fixes **P2**.
8. **Deux moteurs de projection parallèles non réconciliés** (UI déterministe annuel vs API MC mensuel) : chiffres différents pour les mêmes hypothèses, sans note explicative commune. **P2**.

### Financial hardcodes found

| Valeur | Emplacement | Impact |
|---|---|---|
| `"2027-08-19"` (fenêtre service de dette) | `shared.ts:31` | P1 |
| `2026` (année de base MC) | `monte-carlo.ts:69` | P1 |
| `23` (âge par défaut MC) | `monte-carlo.ts:70` | P2 |
| `0.12 + rand×0.15` (amplitude stress) | `monte-carlo.ts:58` | P2 |
| `19082026` (seed par défaut ×3) | route projection, app-shell, ScenariosPage | P3 |
| `0.25` (riskHaircut), `0.15` (seuil vol), `0.03` (liquidityWeight) | `decision.ts:19,32` + 2 sites UI | P1 |
| `0.06` (taux actualisation) | `real-estate.ts:39` | P3 |
| `5000 €`, `0.02` inflation, `5 ans`, `0.15` vol | `pages.tsx:169,252` | P1 |
| `defaultProperty` (220 000 €, 17 600 €, 15 000 €, 227 600 €…) | `pages.tsx:178` | P2 |
| Pistes career (42 k€, 9 k€, taux de croissance, `1.08`) | `pages.tsx:194-200` | P2 |
| Business defaults (500 k€, 80 k€, 6×, 100 k€, 30 k€, 100 %) | `pages.tsx:211-216` | P2 |
| Investments (8 698 €, 703,12 €, 14 300 €, +77,71 %) | `pages.tsx:156-157` | P1 |
| Milestones goals (100 k€ → 20 M€) | `pages.tsx:264` | P3 |
| Titres de timeline (« 108 jours », « 284,72 € », dates) | `pages.tsx:103,142,284-290` | P2 |
| Mois du chart cash flow (Mars–Août, une seule donnée) | `pages.tsx:137` | P3 |
| `AS_OF_DATE = "2026-08-19"` (constante unique, mais non réutilisée par MC/UI) | `shared.ts:11` | P2 |

Valeurs seed (soldes, 16 745 €, 284,72 €, 60 mois, 1 282 €, loyer 1 140 €, scénarios, hypothèses) : **données**, pas code — portées `ACTUAL`/`MODEL_ASSUMPTION` avec réconciliations ouvertes documentées dans `docs/ASSUMPTIONS.md`. Hors « hardcode » au sens strict, mais à confirmer par documents réels (`docs/DATA_VERIFICATION.md`).

### Financial calculations located in UI

Toutes dans `src/components/pages.tsx` (moteur non extrait) :
- `TodayPage` : projection déterministe complète (ligne 61), allocation donut (62-67), somme mensualités dette (91), % de concentration divide par `grossAssets`.
- `InvestmentsPage` : `peaGap`, concentration (8 698 €), composantes position.
- `DebtPage` : `contractualTotal`, `écart`, comparaison `compareDebtVsInvest` avec inputs figés.
- `CashFlowPage` : chart (dernier mois seulement), coûts d'événement (284,72 €).
- `RealEstatePage` : `underwriteRealEstate` (moteur — conforme), `defaultProperty` (hardcodé).
- `CareerPage` : **toute la courbe salariale** (`Math.pow` inline, croissance variable 1.08, 9 ans).
- `BusinessPage` : **EV, equity value, marge** entièrement inline.
- `GoalsPage` : progression, milestones.
- `ScenariosPage` : seed, appels MC.
- `DecisionLabPage` : tout le calcul de décision (moteur) + defaults UI.

### Double-counting risks

1. Positions vs soldes de comptes : **géré correctement** (grossAssets depuis comptes, positions = explication) — validé par test. Limite : écart PEA de 0,56 € affiché dans la donut (slices 15 570,93 € ≠ centre 15 571,49 €).
2. `liquidNetWorth` ≡ `netWorth` (doublon de formule).
3. Service de dette : 3 définitions affichées sans recoupement (métrique fenêtrée / somme UI / explication « 0 € »).
4. Échéancier : `loan_schedules` (seed, `DERIVED`) vs recalcul client — double source non synchronisée.
5. Cash PEA : correctement exclu du cash bancaire (testé).
6. `monthlySavings` des scénarios vs `freeCashFlow` réel : projection en épargne 250 €/mois alors que le cash flow connu est −142,72 € — pas un double comptage mais deux mondes non reliés (une charge de dette potentielle manque dans la projection : la mensualité n'est pas déduite de l'épargne projetée).
7. CTO : solde compte 214,28 € = position 214,28 € — compté une fois comme actif, une fois dans `investedAssets` (périmètres distincts, mais non étiquetés).

### Disconnected modules

- **Real Estate** : non persisté, non relié au Net Worth (tables `properties`/`mortgages` inutilisées).
- **Business Equity** : bac à sable UI, tables `businesses` inutilisées.
- **Tax** : `tax.ts` sans appel en production; barème placeholder.
- **Career** : calculs inline, aucune table, `employmentCompensation` non branché.
- **Decision Lab** : `decision_cases` jamais écrites; 9 cas sur 10 statiques.
- **Goals** : aucun moteur d'atteinte; projection non branchée.
- **Timeline** : événements en dur; seules les `monthlyCloses` viennent de la BD.
- **FX** : `fxConvert`/`currency_rates` orphelins.
- **`loan_schedules`** : table écrite, jamais lue.
- **`applyScenarioOverrides`** : jamais appelé.
- **`salaryGrowth`** : jamais consommé.

### Existing test status

Exécution `npx vitest run` au commit `ee0d16d` (après `npm ci`, aucun changement de dép) :
- 6 fichiers de test, **25 tests : 24 pass, 1 échec**.
- Échec : `src/lib/engine/__tests__/financial.test.ts` → « calculates net worth from accounts rather than positions » : flottant `−1173.5100000000002` vs `−1173.51`.
- Couverture par fichier : financial 7 (1 rouge), shared 6, navigation 5, monte-carlo 3, tax 2, real-estate 1.
- **Zéro test** : `decision.ts`, `deterministicProjection`, mutations repository (local + supabase), validation Zod, routes API, pipeline MC→persistence, UI.

### Recommended order of remediation

1. **P0** — restaurer la suite verte : réduire la tolérance du test net worth (arrondi monétaire ou `toBeCloseTo`) — sans toucher au moteur.
2. **P1** — unifier le service de dette (fenêtre dérivée de `AS_OF_DATE`/`maturityDate`, une seule définition partagée entre `deriveMetrics`, UI et explications) et aligner les textes « Avant échéance ».
3. **P1** — corriger `investedEquity` du Real Estate (`equity = max(0, totalProjectCost − loanAmount)`) + test.
4. **P1** — extraire les constantes Investments dures (IDs `acc_pea`/`acc_cto`, 8 698 €, 703,12 €, 14 300 €) vers des données dérivées.
5. **P1** — garde-fou multi-devise dans `deriveMetrics` (rejeter ou convertir toute devise ≠ reporting).
6. **P1** — paramétrer année/âge de départ du MC depuis `AS_OF_DATE`/profil; unifier les seeds de projection.
7. **P1** — tests du Decision Lab + suppression des inputs UI figés (bascule curseurs communs).
8. **P2** — tests `deterministicProjection`, réconciliation déterministe vs MC; utilisation ou abandon de `salaryGrowth`, `applyScenarioOverrides`, `socialContributionsRate`, `annualPrincipal`.
9. **P2** — sortir Career/Business des calculs inline vers des moteurs purs testables, brancher `employmentCompensation`.
10. **P2** — `create_monthly_close` : lever l'écrasement (erreur si clôture existante) et brancher le « forecast » sur la projection réelle.
11. **P3** — cosmétique : seed 19082026 unique, mois du chart, milestones configurables, textes explicatifs dynamiques.

---

**Fichiers lus pour cet audit** (aucun modifié) :

- `src/lib/engine/financial.ts`, `monte-carlo.ts`, `real-estate.ts`, `tax.ts`, `decision.ts`
- `src/lib/engine/__tests__/financial.test.ts`, `monte-carlo.test.ts`, `real-estate.test.ts`, `tax.test.ts`
- `src/lib/data/shared.ts`, `local-repository.ts`, `supabase-repository.ts`, `repository.ts`, `contracts.ts`, `schema.sql`
- `src/lib/data/__tests__/shared.test.ts`
- `src/lib/types.ts`, `src/lib/navigation.ts`, `src/lib/auth.ts`, `src/lib/validation/mutations.ts`
- `src/lib/__tests__/navigation.test.ts`
- `src/components/pages.tsx`, `app-shell.tsx`, `ui.tsx`, `login-form.tsx`
- `src/app/api/state/route.ts`, `projection/route.ts`, `export/route.ts`, `documents/route.ts`, `auth/route.ts`
- `src/app/(workspace)/page.tsx`, `(workspace)/[section]/page.tsx`, `login/page.tsx`
- `src/proxy.ts`
- `scripts/seed-supabase.ts`
- `supabase/config.toml`, `supabase/migrations/202608190001_initial_family_office.sql`, `202608190002_scenario_parameters.sql`
- `docs/ARCHITECTURE.md`, `ASSUMPTIONS.md`, `DATA_VERIFICATION.md`, `ROADMAP.md`
- `package.json`, `vitest.config.ts`, `README.md`

**Points critiques nécessitant revue humaine** :
1. Décision de politique : faut-il que `monthlyDebtService` compte la mensualité pendant la période de différé (avant 2026-12-05) ? (définition métier).
2. Le « forecast » de la clôture mensuelle doit-il devenir la trajectoire déterministe ? (changement de sémantique).
3. Le Real Estate étudie un cas avec `loanAmount` > prix d'achat (financement des frais) : valider la formule d'equity retenue.
4. Confiance auto-`HIGH` après édition utilisateur (scénarios, budgets) : acceptable ?
5. Le barème fiscal 2026 doit rester non appliqué tant qu'il n'est pas vérifié (conformité au brief), mais son absence bloque toute sortie « net des taxes » crédible.
6. La date `AS_OF_DATE` est figée au 19/08/2026 : toute la chaîne (MC, UI, clôtures) devra être revue lors du passage au mois suivant.