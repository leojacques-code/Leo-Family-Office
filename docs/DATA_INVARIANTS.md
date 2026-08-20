# Registre des invariants de données

Léo Family Office. Version 0.1 du 20 août 2026. Lane : Léo (Product Truth).
Base : commit `ef5bacf`. Date zéro : 2026-08-19. Devise de reporting : EUR.

## Statut

STATUT : PROVISOIRE. `docs/FINANCIAL_DEFINITIONS.md` est lui-même en V0.1 non relue
(Checkpoint 1). Conformément au plan §4, aucun invariant financier de ce registre ne
doit être traité comme définitif avant cette review. Les invariants marqués
`DÉPEND-DEF` reposent sur une définition encore ouverte et peuvent changer d'énoncé.

Ce registre ne modifie aucun code. Il ne prescrit aucune correction. Il énonce ce que
le produit ne doit jamais violer, et constate si le code d'aujourd'hui le respecte.

## Comment lire un invariant

| Champ | Sens |
|---|---|
| ID | identifiant stable, cité par les tests et les PR |
| NAME | nom court |
| RULE | énoncé formel, vérifiable |
| RATIONALE | pourquoi cette règle protège l'utilisateur |
| EXAMPLE | cas concret, chiffré, synthétique |
| FAILURE MODE | ce que voit l'utilisateur si la règle casse |
| HOW TO TEST | forme du test, pas son code |
| OWNER / MODULE | lane responsable et fichier cible |
| SEVERITY | BLOCKER / HIGH / MEDIUM / LOW |
| STATUT | RESPECTÉ / VIOLÉ / NON TESTABLE / NON APPLICABLE au commit `ef5bacf` |

SEVERITY qualifie la conséquence d'une violation, pas l'urgence du chantier.
BLOCKER signifie : un chiffre faux est présenté à l'utilisateur comme une vérité.

## Synthèse

| Catégorie | Total | RESPECTÉ | PARTIEL | VIOLÉ | NON TESTABLE |
|---|---:|---:|---:|---:|---:|
| A. Balance sheet | 7 | 2 | 2 | 1 | 2 |
| B. Cash | 5 | 1 | 1 | 3 | 0 |
| C. Investments | 6 | 0 | 0 | 4 | 2 |
| D. Debt | 9 | 1 | 1 | 5 | 2 |
| E. Real Estate | 5 | 0 | 1 | 4 | 0 |
| F. Transactions et transferts | 5 | 1 | 0 | 0 | 4 |
| G. Scénarios et projections | 7 | 4 | 1 | 2 | 0 |
| H. Provenance | 6 | 1 | 2 | 2 | 1 |
| I. Multi-devises | 4 | 0 | 0 | 3 | 1 |
| J. Monthly close | 4 | 0 | 1 | 3 | 0 |
| K. Intégrité historique | 4 | 2 | 2 | 0 | 0 |
| L. Réconciliation | 4 | 2 | 1 | 0 | 1 |
| M. Complétude | 4 | 0 | 1 | 3 | 0 |
| Total | 70 | 14 | 13 | 30 | 13 |

Lecture des statuts, au commit `ef5bacf` :
- RESPECTÉ : la règle est tenue par le code, et le plus souvent couverte par un test.
- PARTIEL : tenue sur un axe, prise en défaut sur un autre. Le détail est dans l'invariant.
- VIOLÉ : le code contredit la règle aujourd'hui.
- NON TESTABLE : la fonctionnalité concernée n'existe pas encore. La règle contraint le futur.

Trente invariants sur soixante-dix sont violés. Ce n'est pas un accident : le produit a été
généré vite, puis audité. Le registre sert à rendre cette dette explicite et priorisable, pas
à disqualifier la base existante, dont plusieurs propriétés fortes (non-double-comptage,
exclusion du cash d'enveloppe, MISSING jamais transformé en zéro, reproductibilité du seed)
sont déjà correctes et testées.

« NON TESTABLE » signifie que la fonctionnalité concernée n'existe pas encore : la règle
est écrite pour contraindre le futur, pas pour juger le présent.

---

## A. BALANCE SHEET

### INV-A-01 · Identité comptable du bilan
- RULE : `GrossAssets(t) - Liabilities(t) = NetWorth(t)` à la tolérance monétaire près, pour tout `t`.
- RATIONALE : c'est la seule égalité que l'utilisateur peut vérifier de tête. Si elle casse, plus rien n'est crédible.
- EXAMPLE : actifs 15 571,49 €, dettes 16 745,00 €, net -1 173,51 €.
- FAILURE MODE : trois cartes du cockpit ne s'additionnent pas ; l'utilisateur perd confiance sans savoir laquelle est fausse.
- HOW TO TEST : propriété sur jeu aléatoire de comptes et dettes ; tolérance explicite, pas d'égalité flottante stricte.
- OWNER / MODULE : Paul, `src/lib/engine/financial.ts:calculateNetWorth`.
- SEVERITY : BLOCKER.
- STATUT : PARTIEL. en valeur, VIOLÉ en test. `15571.49 - 16745` rend `-1173.5100000000002` et le test `financial.test.ts:40` échoue sur `toEqual`. Vérifié par exécution de `npx vitest run` le 20 août 2026 : 25 tests, 24 verts, 1 rouge. Voir INV-A-02.

### INV-A-02 · Tolérance monétaire explicite `DÉPEND-DEF`
- RULE : toute comparaison de montants utilise une tolérance déclarée. Aucune assertion d'égalité stricte sur un flottant monétaire.
- RATIONALE : la représentation binaire des décimaux rend l'égalité stricte non déterministe au centime.
- EXAMPLE : attendre `-1 173,51 €` à 0,005 € près plutôt que `toEqual(-1173.51)`.
- FAILURE MODE : suite de tests rouge sans bug financier réel, ou pire, suite rendue verte en corrigeant le moteur au lieu du test.
- HOW TO TEST : interdiction lint ou revue : aucun `toEqual` sur un nombre issu d'une somme de montants.
- OWNER / MODULE : Paul, tests financiers.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. La règle d'arrondi canonique n'est pas encore décidée (question 1 de `FINANCIAL_DEFINITIONS.md` §14).

### INV-A-03 · Un actif est compté exactement une fois
- RULE : aucun actif ne contribue à `GrossAssets` par plus d'un chemin.
- RATIONALE : le double comptage est le mode de défaillance le plus courant et le plus invisible d'un agrégateur patrimonial.
- EXAMPLE : PEA à 15 003,13 € contenant 8 698 € d'ETF et 6 304,57 € de cash. `GrossAssets` retient 15 003,13 €, pas 30 005,70 €.
- FAILURE MODE : patrimoine affiché environ doublé sur les comptes titres.
- HOW TO TEST : jeu avec positions dont la somme égale le solde, vérifier que `GrossAssets` n'augmente pas quand on ajoute des positions.
- OWNER / MODULE : Paul, `src/lib/data/shared.ts:deriveMetrics`.
- SEVERITY : BLOCKER.
- STATUT : RESPECTÉ. et testé (`shared.test.ts`, « additionne les soldes de comptes sans double compter les positions »).

### INV-A-04 · Les positions expliquent le solde, elles ne s'y ajoutent pas
- RULE : la valeur des positions d'un compte n'entre jamais dans `GrossAssets`. Elle sert à la réconciliation et à l'allocation.
- RATIONALE : corollaire opérationnel de INV-A-03, et convention LFO retenue (solde de compte = valeur comptable).
- EXAMPLE : ajouter une position de 500 € sans changer le solde du compte laisse `GrossAssets` inchangé et augmente le gap de réconciliation de 500 €.
- FAILURE MODE : chaque import de relevé de positions gonfle le patrimoine.
- HOW TO TEST : test d'invariance de `GrossAssets` sous ajout de position.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : BLOCKER.
- STATUT : RESPECTÉ.

### INV-A-05 · Périmètre déclaré dans le libellé
- RULE : un agrégat dont le périmètre est partiel porte cette limite dans son libellé affiché.
- RATIONALE : « Patrimoine brut » sans immobilier ni business equity n'est pas un patrimoine brut, c'est un sous-ensemble.
- EXAMPLE : afficher « Actifs financiers identifiés » et non « Patrimoine brut » tant que l'immobilier n'est pas persisté.
- FAILURE MODE : l'utilisateur croit son bilan exhaustif et prend une décision sur un périmètre tronqué.
- HOW TO TEST : revue de libellés, non automatisable ; checklist d'acceptance.
- OWNER / MODULE : Léo, `src/components/pages.tsx`.
- SEVERITY : HIGH.
- STATUT : PARTIEL. La page Net Worth porte un callout « Périmètre identifié », mais les cartes affichent « Patrimoine brut » sans réserve.

### INV-A-06 · Convention actif / passif stable `DÉPEND-DEF`
- RULE : la convention de traitement d'un solde bancaire négatif est unique, documentée, et appliquée partout de la même façon.
- RATIONALE : deux conventions coexistantes rendent `GrossAssets` non reproductible.
- EXAMPLE : CIC à -3,44 €, soit compté comme actif négatif dans `GrossAssets`, soit comme dette dans `Liabilities`. Jamais les deux, jamais l'un ici et l'autre là.
- FAILURE MODE : écart de 2 × |solde débiteur| entre deux écrans.
- HOW TO TEST : test de cohérence entre `deriveMetrics` et l'export CSV, sur un compte débiteur.
- OWNER / MODULE : Léo (décision), Paul (implémentation).
- SEVERITY : MEDIUM (3,44 € au seed, structurant en définition).
- STATUT : NON TESTABLE. convention non arrêtée.

### INV-A-07 · Immobilier et business equity entrent par leur equity, pas par leur valeur
- RULE : un bien immobilier financé entre au bilan par `valeur - dette adossée`, et la dette adossée n'est pas comptée deux fois dans `Liabilities`.
- RATIONALE : compter la valeur brute en actif et l'emprunt en passif est correct ; compter l'equity en actif et l'emprunt en passif double le levier.
- EXAMPLE : bien 220 000 €, prêt 180 000 €. Soit actif 220 000 et passif 180 000, soit actif 40 000 et passif 0. Jamais actif 40 000 et passif 180 000.
- FAILURE MODE : patrimoine net sous-estimé du montant de la dette immobilière.
- HOW TO TEST : golden case immobilier, comparer les deux conventions et vérifier l'égalité du net.
- OWNER / MODULE : Paul, futur module immobilier persisté.
- SEVERITY : BLOCKER (dès persistance).
- STATUT : NON TESTABLE. Aucun bien n'est persisté aujourd'hui.

---

## B. CASH

### INV-B-01 · Le cash d'enveloppe n'est jamais du cash bancaire
- RULE : le cash logé dans un PEA, un CTO, une assurance-vie ou toute enveloppe n'entre jamais dans `BankCash`.
- RATIONALE : ce cash n'est pas mobilisable sans sortie d'enveloppe, souvent fiscalement pénalisante ou interdite (PEA avant 5 ans).
- EXAMPLE : 6 304,57 € de cash PEA ne rejoignent pas les 354,08 € de cash bancaire. `BankCash` reste 354,08 €.
- FAILURE MODE : l'utilisateur croit disposer de 6 658,65 € de liquidité immédiate et engage une dépense qu'il ne peut pas couvrir.
- HOW TO TEST : jeu avec une position `isCash = true` sur un compte PEA ; vérifier `BankCash` inchangé.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : BLOCKER.
- STATUT : RESPECTÉ. Le filtre porte sur `type ∈ {BANK, SAVINGS}`, ce qui exclut PEA et CTO. Point fort du produit.

### INV-B-02 · La liquidité se déduit du champ liquidité, pas du type de compte
- RULE : la mobilisabilité d'un actif est portée par un attribut de liquidité, pas inférée du type de compte.
- RATIONALE : un livret bloqué et un livret A sont tous deux SAVINGS, avec des liquidités opposées.
- EXAMPLE : compte SAVINGS avec `liquidity = ILLIQUID` (épargne salariale bloquée) : exclu de `BankCash`.
- FAILURE MODE : réserve de sécurité surévaluée du montant des épargnes bloquées.
- HOW TO TEST : jeu avec un compte SAVINGS ILLIQUID ; vérifier son exclusion.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. Le champ `liquidity` existe sur `FinancialAccount`, il est affiché nulle part et n'est utilisé par aucun calcul.

### INV-B-03 · Une couverture s'exprime en mois, jamais en devise
- RULE : `EmergencyCoverageMonths` est un nombre de mois. Son rendu ne passe jamais par un formateur monétaire.
- RATIONALE : une unité fausse est une erreur d'ordre de grandeur, pas une coquille.
- EXAMPLE : 354,08 / 1 140 = 0,31 mois. Afficher « 0,31 mois », jamais « 0,31 € ».
- FAILURE MODE : l'utilisateur lit un montant là où le système parle d'une durée.
- HOW TO TEST : revue de rendu ; typage d'unité sur les métriques si le modèle l'adopte.
- OWNER / MODULE : Léo, `pages.tsx` `TodayPage`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `pages.tsx:76` rend `<Currency value={state.metrics.emergencyCoverageMonths} /> mois`, donc « 0,31 € mois ».

### INV-B-04 · Le dénominateur de la couverture inclut tout l'incompressible
- RULE : les dépenses incompressibles utilisées au dénominateur incluent le service de dette exigible.
- RATIONALE : une mensualité de prêt est aussi incompressible qu'un loyer.
- EXAMPLE : loyer 1 140 € et mensualité 284,72 € exigible donnent un dénominateur de 1 424,72 €, soit 0,25 mois de couverture et non 0,31.
- FAILURE MODE : réserve de sécurité surévaluée de 25 % dans cet exemple.
- HOW TO TEST : golden case avec un prêt exigible ; comparer les deux dénominateurs.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : MEDIUM.
- STATUT : VIOLÉ. Le dénominateur ne contient que les catégories de dépense marquées essentielles.

### INV-B-05 · Une couverture calculée sur un budget incomplet porte un drapeau
- RULE : si des catégories de dépense essentielles sont MISSING, la couverture affichée porte un drapeau d'incomplétude et un sens de biais.
- RATIONALE : ici le biais est connu : ajouter des dépenses fera baisser le ratio. L'utilisateur doit le savoir.
- EXAMPLE : « 0,31 mois, borne haute : 7 catégories essentielles sur 8 non renseignées ».
- FAILURE MODE : l'utilisateur se croit à 0,31 mois alors qu'il est peut-être à 0,15.
- HOW TO TEST : le drapeau apparaît dès qu'une catégorie essentielle est MISSING.
- OWNER / MODULE : Léo (spécification), Paul (drapeau).
- SEVERITY : HIGH.
- STATUT : PARTIEL. Un callout général existe sur la page Cash Flow ; la carte du cockpit affiche « de loyer couvert », ce qui est honnête mais pas un drapeau structuré.

---

## C. INVESTMENTS

### INV-C-01 · Une contribution n'est pas une performance
- RULE : un versement sur un compte d'investissement augmente la valeur du compte sans produire aucune performance.
- RATIONALE : règle fondamentale du business plan §9. Un portefeuille doublé par des versements n'a pas fait +100 %.
- EXAMPLE : PEA à 10 000 €, versement de 5 000 €. Valeur 15 000 €, performance 0 %, TWR 0 %, XIRR 0 %.
- FAILURE MODE : l'utilisateur attribue à sa sélection de titres ce qui vient de son effort d'épargne, et surestime sa compétence d'investisseur.
- HOW TO TEST : golden case « versement pur » ; toute métrique de performance doit rendre 0.
- OWNER / MODULE : Paul, futur Portfolio Engine.
- SEVERITY : BLOCKER (dès qu'une performance est affichée).
- STATUT : NON TESTABLE. Aucun calcul de performance n'existe. Voir INV-C-02.

### INV-C-02 · Aucun pourcentage de performance sans base de calcul
- RULE : une performance affichée doit être dérivable des données du système : cost basis, flux et dates présents.
- RATIONALE : un pourcentage sans base est une donnée inventée, ce que la doctrine LFO interdit explicitement.
- EXAMPLE : le CTO a `cost_basis = NULL` et aucun historique de flux. Aucune performance n'est calculable pour ce compte.
- FAILURE MODE : l'utilisateur croit à une performance de +77,71 % qu'aucune donnée ne soutient.
- HOW TO TEST : toute métrique de performance retourne MISSING si le cost basis ou l'historique de flux est absent.
- OWNER / MODULE : Léo (retrait immédiat), Paul (calcul).
- SEVERITY : BLOCKER.
- STATUT : VIOLÉ. `pages.tsx:157` affiche la chaîne littérale « +77,71 % » sous le libellé « Performance affichée » pour le CTO.

### INV-C-03 · Les métriques de portefeuille sont dérivées, jamais littérales
- RULE : aucune valeur monétaire ou pourcentage propre au portefeuille de l'utilisateur n'est écrit dans le code de l'interface.
- RATIONALE : une constante d'interface ne se met pas à jour avec les données ; elle devient fausse à la première correction.
- EXAMPLE : la concentration MSCI World doit se calculer `position.value / grossAssets`, jamais `8698 / grossAssets`.
- FAILURE MODE : après mise à jour du portefeuille, le cockpit affiche encore l'ancienne valeur, sans aucun signal.
- HOW TO TEST : revue statique ; interdiction lint des littéraux numériques monétaires dans `pages.tsx`.
- OWNER / MODULE : Léo, `pages.tsx`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `8698`, `703.12`, `14300`, `284.72` sont écrits en dur dans l'interface.

### INV-C-04 · Les entités sont référencées par relation, pas par identifiant littéral
- RULE : l'interface ne cible jamais un compte par une chaîne d'identifiant écrite en dur.
- RATIONALE : les identifiants Supabase sont des UUID générés. Un compte recréé change d'identifiant et l'écran se vide sans erreur.
- EXAMPLE : filtrer sur `account.type === "PEA"` plutôt que sur `account.id === "acc_pea"`.
- FAILURE MODE : panne silencieuse. La page Investments affiche 0 € sans message d'erreur.
- HOW TO TEST : renommer les identifiants du jeu de test et vérifier que les écrans restent peuplés.
- OWNER / MODULE : Léo, `pages.tsx` `InvestmentsPage` et `TodayPage`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `"acc_pea"` et `"acc_cto"` apparaissent en dur aux lignes 150 à 154 et 65.

### INV-C-05 · Le total d'une allocation égale l'agrégat qu'elle décompose
- RULE : la somme des tranches d'un graphique d'allocation égale la valeur affichée au centre, ou l'écart est explicitement nommé.
- RATIONALE : deux nombres différents pour la même chose, côte à côte, sur le même écran.
- EXAMPLE : tranches 8 698 + 6 304,57 + 214,28 + 354,08 = 15 570,93 €, centre 15 571,49 €, écart 0,56 € correspondant au gap PEA.
- FAILURE MODE : l'utilisateur additionne les pourcentages et n'obtient pas 100 %.
- HOW TO TEST : test de somme sur le jeu de données de l'allocation.
- OWNER / MODULE : Paul (extraction d'un moteur d'allocation), Léo (affichage de l'écart).
- SEVERITY : MEDIUM.
- STATUT : VIOLÉ. silencieusement. L'écart existe, il correspond exactement au gap de réconciliation déjà exposé ailleurs, mais rien ne le relie sur ce graphique.

### INV-C-06 · Frais et dividendes sont des flux distincts de la performance
- RULE : frais et dividendes sont enregistrés comme flux datés, jamais nettés silencieusement dans la valeur de position.
- RATIONALE : le fees drag et le rendement courant sont des analyses distinctes exigées par le business plan §9.
- EXAMPLE : dividende de 40 € réinvesti : contribution +40, performance de marché inchangée sur cet événement.
- FAILURE MODE : impossible de dire si la performance vient des prix ou des coupons.
- HOW TO TEST : golden case dividende ; vérifier la séparation.
- OWNER / MODULE : Paul, futur Portfolio Engine.
- SEVERITY : MEDIUM.
- STATUT : NON TESTABLE. Ni frais ni dividendes ne sont modélisés.

---

## D. DEBT

### INV-D-01 · Une dette ne devient jamais négative
- RULE : `LoanBalance(t) >= 0` pour tout `t`. Le principal remboursé d'une échéance est plafonné au solde restant.
- RATIONALE : un solde négatif transforme mécaniquement une dette en actif et fausse le patrimoine net.
- EXAMPLE : solde 200 €, mensualité 284,72 €. Principal remboursé 200 €, solde final 0 €, pas -84,72 €.
- FAILURE MODE : patrimoine net gonflé du dépassement, sans alerte.
- HOW TO TEST : échéancier complet ; `every(row => row.closingBalance >= 0)`.
- OWNER / MODULE : Paul, `financial.ts:amortizeLoan`.
- SEVERITY : BLOCKER.
- STATUT : RESPECTÉ. et testé (« caps the final contractual payment at the remaining balance »).

### INV-D-02 · Service de dette nul avant la première échéance `DÉPEND-DEF`
- RULE : si `t < firstPaymentDate`, la contribution de ce prêt au service de dette est 0.
- RATIONALE : un prêt en différé ne consomme pas de trésorerie. C'est précisément le cas d'usage « étudiant » que le business plan §1.2 exige de représenter.
- EXAMPLE : au 19 août 2026, un prêt dont la première échéance est le 5 décembre 2026 contribue 0 €, pas 284,72 €.
- FAILURE MODE : cash-flow libre sous-estimé de la mensualité pendant toute la période de différé, ici pendant 3,5 mois.
- HOW TO TEST : trois cas, `t` avant, égal et après `firstPaymentDate`.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : BLOCKER.
- STATUT : VIOLÉ. et l'arbitrage produit n'est pas rendu. Le code compte 284,72 € dès la date zéro via un filtre `firstPaymentDate <= "2027-08-19"`. L'interface et `docs/ASSUMPTIONS.md` affirment l'inverse. Voir `OPEN_QUESTIONS.md` Q-01.

### INV-D-03 · Service de dette nul après la maturité
- RULE : si `t > maturityDate`, ou si toutes les échéances sont payées, la contribution au service de dette est 0.
- RATIONALE : sinon le produit facture une mensualité perpétuelle.
- EXAMPLE : prêt échu le 5 novembre 2031 ; au 1er janvier 2032, contribution 0 €.
- FAILURE MODE : cash-flow libre sous-estimé indéfiniment après la fin du prêt.
- HOW TO TEST : `t` postérieur à `maturityDate`.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. Le filtre actuel ne teste jamais `maturityDate`.

### INV-D-04 · Une fenêtre temporelle se dérive, elle ne s'écrit pas
- RULE : aucune borne de date n'est une constante littérale. Toute fenêtre se dérive de la date d'observation.
- RATIONALE : une constante `"2027-08-19"` est correcte un seul jour et devient fausse ensuite, silencieusement.
- EXAMPLE : comparer `firstPaymentDate <= asOfDate` et non `firstPaymentDate <= "2027-08-19"`.
- FAILURE MODE : à partir d'août 2027, tout prêt à première échéance postérieure disparaît du service de dette.
- HOW TO TEST : exécuter `deriveMetrics` avec deux dates d'observation distinctes et vérifier que le résultat change de façon cohérente.
- OWNER / MODULE : Paul, `shared.ts:31`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ.

### INV-D-05 · Un échéancier contractuel prime sur un échéancier théorique
- RULE : quand un échéancier contractuel est fourni, il est la source de vérité. Aucune PMT théorique ne l'écrase, en totalité ou ligne à ligne.
- RATIONALE : la banque a raison contre le modèle. C'est la priorité de sources du business plan §6.1.
- EXAMPLE : PMT théorique 279,08 €, mensualité contractuelle 284,72 €. Le système retient 284,72 € et conserve la trace des deux.
- FAILURE MODE : les échéances affichées ne correspondent pas aux prélèvements réels ; l'utilisateur ne peut plus pointer son compte.
- HOW TO TEST : golden case CASE 10 ; vérifier que le paiement retenu est le contractuel.
- OWNER / MODULE : Paul, `amortizeLoan` et futur import d'échéancier.
- SEVERITY : BLOCKER.
- STATUT : PARTIEL. au niveau de la mensualité (`contractualPayment` est prioritaire). NON TESTABLE au niveau de l'échéancier ligne à ligne : aucun import n'existe.

### INV-D-06 · Un seul échéancier fait autorité
- RULE : pour un prêt donné, un seul échéancier est la référence à un instant donné. S'il en existe deux, l'un est explicitement dérivé de l'autre et daté.
- RATIONALE : deux sources non réconciliées divergent tôt ou tard sans que personne ne le remarque.
- EXAMPLE : la table `loan_schedules` et le recalcul client doivent produire les mêmes 60 lignes, ou l'une doit être supprimée.
- FAILURE MODE : la page Dette et l'export ne montrent pas le même échéancier.
- HOW TO TEST : comparer l'échéancier stocké et l'échéancier recalculé, ligne à ligne.
- OWNER / MODULE : Paul.
- SEVERITY : MEDIUM.
- STATUT : VIOLÉ. par construction. `loan_schedules` est écrite au seed et n'est jamais relue ; `DebtPage` recalcule côté client.

### INV-D-07 · Un remboursement de principal n'est pas une dépense économique
- RULE : le principal remboursé est un transfert du passif vers le patrimoine net, à patrimoine net constant. L'intérêt est la seule charge économique.
- RATIONALE : confondre les deux fait apparaître le désendettement comme un appauvrissement.
- EXAMPLE : mensualité 284,72 € à 0 % : trésorerie -284,72 €, dette -284,72 €, patrimoine net inchangé.
- FAILURE MODE : l'attribution de variation du patrimoine attribue au « coût de la dette » ce qui est de l'equity build-up.
- HOW TO TEST : golden case CASE 9 ; vérifier `ΔNetWorth = -intérêt` sur une échéance.
- OWNER / MODULE : Paul, futur moteur d'attribution.
- SEVERITY : HIGH.
- STATUT : NON TESTABLE. Aucun moteur d'attribution de variation n'existe.

### INV-D-08 · Le cash-out inclut assurance et frais
- RULE : le montant réellement débité comprend intérêt, principal, assurance et frais. Le modèle porte ces quatre composantes, même à zéro.
- RATIONALE : un prêt immobilier assuré coûte typiquement 10 à 20 % de plus que la somme intérêt + principal.
- EXAMPLE : mensualité 1 000 € dont 850 € de principal, 120 € d'intérêt, 30 € d'assurance.
- FAILURE MODE : cash-flow surestimé du montant de l'assurance, DSCR surestimé, décision d'achat faussée.
- HOW TO TEST : golden case avec assurance non nulle ; vérifier `cashOut = intérêt + principal + assurance + frais`.
- OWNER / MODULE : Paul, modèle `Liability` et `AmortizationRow`.
- SEVERITY : HIGH.
- STATUT : NON TESTABLE. Le modèle n'a ni champ assurance ni champ frais.

### INV-D-09 · Toutes les dettes sont traitées, pas seulement la première
- RULE : les écrans et calculs de dette itèrent sur l'ensemble des passifs.
- RATIONALE : `Liabilities` somme toutes les dettes ; si l'écran n'en montre qu'une, les deux périmètres divergent.
- EXAMPLE : deux prêts. `metrics.debt` compte les deux, la page Dette n'en amortit qu'un.
- FAILURE MODE : une dette existe dans le patrimoine net et nulle part ailleurs. Le produit plante aussi si la liste est vide.
- HOW TO TEST : jeu à zéro, une et deux dettes.
- OWNER / MODULE : Léo, `pages.tsx:DebtPage`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `const loan = state.liabilities[0]` ; l'accès à `loan.principal` lève une exception si la liste est vide.

---

## E. REAL ESTATE

### INV-E-01 · L'equity investie est la trésorerie réellement engagée
- RULE : `InvestedEquity = max(0, CoûtTotalProjet - MontantEmprunté)`.
- RATIONALE : si l'emprunt finance aussi les frais et les travaux, ces montants ne sortent pas de la poche de l'investisseur. Les compter dans l'equity gonfle le dénominateur de tous les ratios de rentabilité.
- EXAMPLE : projet 257 600 € (prix 220 000 + frais 17 600 + travaux 15 000 + mobilier 5 000), emprunt 227 600 €. Equity = 30 000 €, pas 67 600 €.
- FAILURE MODE : TRI, cash-on-cash et MOIC sous-estimés d'un facteur 2,25 dans cet exemple. Un projet rentable est rejeté.
- HOW TO TEST : golden case CASE 12 avec `loanAmount ≠ purchasePrice` ; vérifier `cashFlows[0] = -InvestedEquity`.
- OWNER / MODULE : Paul, `real-estate.ts:50`.
- SEVERITY : BLOCKER.
- STATUT : VIOLÉ. Le code calcule `downPayment + acquisitionCosts + renovation + furniture`, ce qui double-compte les frais quand ils sont financés.

### INV-E-02 · Le MOIC compte tous les flux, pas seulement les positifs
- RULE : `MOIC = Σ distributions nettes / equity investie`, les flux négatifs inclus.
- RATIONALE : un projet à cash-flow négatif pendant 9 ans puis une plus-value à la sortie n'a pas le même multiple qu'un projet à cash-flow positif partout.
- EXAMPLE : flux -3 000, -3 000, +80 000 sur equity 30 000. MOIC = 74 000 / 30 000 = 2,47, pas 80 000 / 30 000 = 2,67.
- FAILURE MODE : multiple optimiste, systématiquement.
- HOW TO TEST : golden case avec au moins un flux annuel négatif.
- OWNER / MODULE : Paul, `real-estate.ts:87` et `financial.ts:moic`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `totalPositiveFlows` applique `Math.max(0, value)` sur chaque flux.

### INV-E-03 · Le service de dette cesse quand le prêt est remboursé
- RULE : au-delà de la durée du prêt, le service de dette du projet est nul.
- RATIONALE : un horizon de détention supérieur à la durée du prêt est courant. Continuer à décaisser la mensualité fausse les dernières années.
- EXAMPLE : prêt 15 ans, détention 20 ans. Années 16 à 20 : service de dette 0, cash-flow net supérieur.
- FAILURE MODE : TRI sous-estimé sur les projets à long horizon.
- HOW TO TEST : golden case `holdingYears > loanYears`.
- OWNER / MODULE : Paul, `real-estate.ts:64`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `debtService` est une constante annuelle appliquée sur tout l'horizon.

### INV-E-04 · La valeur de sortie porte sur le bien, pas sur le prix d'achat seul
- RULE : la valeur de sortie s'applique à l'assiette qui a été valorisée, travaux capitalisés inclus quand ils créent de la valeur.
- RATIONALE : des travaux de 15 000 € qui ne changent pas la valeur de sortie sont une hypothèse forte, à afficher, pas à imposer par construction.
- EXAMPLE : prix 220 000 + travaux 15 000, croissance 1,5 %/an sur 10 ans. Assiette à choisir explicitement : 220 000 ou 235 000.
- FAILURE MODE : rentabilité des projets à travaux systématiquement sous-estimée.
- HOW TO TEST : golden case CASE 13 ; l'assiette de sortie est un paramètre explicite.
- OWNER / MODULE : Paul, `real-estate.ts:66` et 73.
- SEVERITY : MEDIUM.
- STATUT : PARTIEL. Le code applique la croissance à `purchasePrice` seul, sans le dire. Ce n'est pas faux, c'est non explicité.

### INV-E-05 · Un cash-flow négatif ne produit pas de crédit d'impôt implicite
- RULE : appliquer `(1 - taxRate)` à un flux négatif crée un remboursement fiscal. Ce traitement doit être un choix explicite, pas un effet de bord.
- RATIONALE : le déficit foncier est réel mais plafonné et conditionné. Le modéliser par une multiplication uniforme est faux dans la plupart des cas.
- EXAMPLE : flux -5 000 € avec `taxRate = 0,30` devient -3 500 €, soit 1 500 € d'économie d'impôt supposée acquise.
- FAILURE MODE : projets déficitaires embellis.
- HOW TO TEST : golden case à cash-flow négatif ; vérifier que le flux après impôt n'est pas mécaniquement amélioré.
- OWNER / MODULE : Paul, `real-estate.ts:64`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `(yearNoi - debtService) * (1 - input.taxRate)` s'applique quel que soit le signe.

---

## F. TRANSACTIONS ET TRANSFERTS

### INV-F-01 · Un transfert interne ne crée ni revenu ni dépense
- RULE : un mouvement entre deux comptes du même utilisateur laisse `MonthlyIncome`, `MonthlyExpenses` et `NetWorth` inchangés.
- RATIONALE : c'est le mode de défaillance numéro un des agrégateurs de budget. Chaque virement d'épargne apparaît comme une dépense.
- EXAMPLE : 500 € du compte courant vers le PEA. Cash bancaire -500, cash PEA +500, patrimoine net inchangé, dépenses inchangées, revenus inchangés, performance inchangée.
- FAILURE MODE : le taux d'épargne s'effondre à chaque virement d'épargne ; l'utilisateur croit dépenser ce qu'il épargne.
- HOW TO TEST : golden case CASE 5 ; comparer les métriques avant et après le transfert.
- OWNER / MODULE : Paul, futur moteur de transactions.
- SEVERITY : BLOCKER.
- STATUT : NON TESTABLE. Le modèle `Transaction` n'a qu'un `accountId` : un transfert n'est pas représentable comme une entité unique à deux jambes.

### INV-F-02 · Les deux jambes d'un transfert sont liées
- RULE : un transfert est une entité unique portant compte source, compte destination, montant et date. Il n'est pas deux transactions indépendantes.
- RATIONALE : deux lignes indépendantes ne peuvent pas être neutralisées de façon fiable dans les agrégats.
- EXAMPLE : `{from: courant, to: pea, amount: 500, date: 2026-09-01}`.
- FAILURE MODE : une jambe est catégorisée en dépense, l'autre en revenu, et le budget est faussé des deux côtés.
- HOW TO TEST : le modèle interdit un transfert sans compte destination.
- OWNER / MODULE : Paul, modèle de données.
- SEVERITY : HIGH.
- STATUT : NON TESTABLE.

### INV-F-03 · Une transaction et un solde ne se contredisent pas
- RULE : si une transaction met à jour un solde, le nouveau solde est daté de la transaction et sa provenance est DERIVED, jamais ACTUAL.
- RATIONALE : un solde reconstruit par calcul n'a pas le même statut qu'un solde relevé.
- EXAMPLE : solde relevé 355,48 € ACTUAL ; après une dépense saisie de -45,20 €, solde 310,28 € DERIVED.
- FAILURE MODE : un solde calculé est présenté comme une observation bancaire.
- HOW TO TEST : vérifier la provenance du solde inséré après `add_transaction`.
- OWNER / MODULE : Paul.
- SEVERITY : MEDIUM.
- STATUT : RESPECTÉ. pour l'adapter local (`kind = 'DERIVED'`, source « Transaction saisie »). À vérifier côté Supabase.

### INV-F-04 · Une catégorisation est révisable sans perte de la donnée d'origine
- RULE : recatégoriser une transaction ne modifie ni son montant, ni sa date, ni son libellé d'origine.
- RATIONALE : la catégorie est une interprétation, le reste est un fait.
- EXAMPLE : « CB CARREFOUR 45,20 » recatégorisé de « Autres » vers « Courses » : seul `categoryId` change.
- FAILURE MODE : perte de la trace bancaire, réconciliation impossible.
- HOW TO TEST : mutation de catégorie ; comparer tous les autres champs.
- OWNER / MODULE : Paul.
- SEVERITY : MEDIUM.
- STATUT : NON TESTABLE. Aucune mutation de recatégorisation n'existe.

### INV-F-05 · Une récurrence détectée reste une hypothèse
- RULE : une dépense récurrente inférée depuis l'historique porte la provenance DERIVED ou MODEL_ASSUMPTION, jamais ACTUAL.
- RATIONALE : « tu as payé 3 fois 12,99 € » est un fait ; « tu paieras 12,99 € le mois prochain » est une prévision.
- EXAMPLE : abonnement détecté à 12,99 €/mois, provenance MODEL_ASSUMPTION, confiance MEDIUM.
- FAILURE MODE : un budget prévisionnel présenté comme un budget constaté.
- HOW TO TEST : la détection de récurrence n'émet jamais d'ACTUAL.
- OWNER / MODULE : Paul, différé.
- SEVERITY : MEDIUM.
- STATUT : NON TESTABLE.

---

## G. SCÉNARIOS ET PROJECTIONS

### INV-G-01 · Un scénario ne modifie jamais un ACTUAL
- RULE : l'exécution d'un scénario n'écrit dans aucune donnée de provenance ACTUAL.
- RATIONALE : c'est la condition pour que le passé reste auditable pendant qu'on explore le futur.
- EXAMPLE : passer le rendement de 5,5 % à 8 % ne change ni les soldes, ni les positions, ni les clôtures.
- FAILURE MODE : l'historique se déforme au gré des simulations ; aucun résultat passé n'est reproductible.
- HOW TO TEST : capturer l'état ACTUAL avant et après une projection ; égalité stricte.
- OWNER / MODULE : Paul, `monte-carlo.ts`, `decision.ts`.
- SEVERITY : BLOCKER.
- STATUT : RESPECTÉ. Les moteurs sont des fonctions pures ; seules les tables `simulation_runs` et `simulation_results` reçoivent des écritures.

### INV-G-02 · Une hypothèse future ne réécrit pas l'historique
- RULE : modifier une hypothèse datée de `T` ne change aucune valeur calculée pour une date antérieure à `T`.
- RATIONALE : condition de reconstruction de n'importe quelle date passée, exigée par le business plan §3.3.
- EXAMPLE : passer l'inflation 2027 de 2 % à 4 % laisse le patrimoine net au 19 août 2026 à -1 173,51 €.
- FAILURE MODE : la clôture d'août 2026 change de valeur en janvier 2027.
- HOW TO TEST : recalcul d'une date passée avant et après édition d'hypothèse ; égalité.
- OWNER / MODULE : Paul.
- SEVERITY : BLOCKER.
- STATUT : RESPECTÉ. aujourd'hui parce qu'aucun calcul historique daté n'existe. À retester dès qu'un moteur mensuel existera.

### INV-G-03 · Même seed et mêmes inputs produisent le même output
- RULE : `runMonteCarlo(input)` est déterministe à seed fixé.
- RATIONALE : sans reproductibilité, aucune comparaison de scénarios n'a de sens et aucun résultat n'est auditable.
- EXAMPLE : deux exécutions avec seed 19082026, 3 000 simulations, 30 ans, donnent des percentiles identiques au bit près.
- FAILURE MODE : deux clics donnent deux conclusions ; le Decision Lab devient un générateur d'opinions.
- HOW TO TEST : égalité stricte de deux exécutions.
- OWNER / MODULE : Paul, `monte-carlo.ts`.
- SEVERITY : BLOCKER.
- STATUT : RESPECTÉ. et testé.

### INV-G-04 · Ordre des percentiles
- RULE : `P10 ≤ P25 ≤ P50 ≤ P75 ≤ P90` pour chaque année projetée.
- RATIONALE : contrainte structurelle de toute distribution ; sa violation révèle un bug d'interpolation ou de tri.
- EXAMPLE : année 10, P10 8 k€, P25 14 k€, P50 22 k€, P75 34 k€, P90 51 k€.
- FAILURE MODE : bande de confiance inversée, graphique incohérent.
- HOW TO TEST : parcours de tous les points.
- OWNER / MODULE : Paul.
- SEVERITY : HIGH.
- STATUT : RESPECTÉ. et testé.

### INV-G-05 · Le seed par défaut a une seule source
- RULE : la valeur par défaut du seed est définie une fois et importée partout.
- RATIONALE : trois définitions divergentes rendent les runs incomparables sans que rien ne le signale.
- EXAMPLE : `19082026` défini dans une constante partagée, référencée par la route API, `app-shell.tsx` et `ScenariosPage`.
- FAILURE MODE : deux exécutions apparemment identiques ne le sont pas.
- HOW TO TEST : recherche statique du littéral ; une seule occurrence attendue.
- OWNER / MODULE : Paul.
- SEVERITY : LOW.
- STATUT : VIOLÉ. Trois occurrences du littéral.

### INV-G-06 · Une projection déclare son périmètre et son unité
- RULE : une trajectoire indique si elle porte sur le brut ou le net, en nominal ou en réel, et si la dette y est incluse.
- RATIONALE : afficher une trajectoire de patrimoine brut croissante à côté d'un patrimoine net négatif est trompeur.
- EXAMPLE : « Patrimoine brut projeté, nominal, hors amortissement de la dette ».
- FAILURE MODE : l'utilisateur lit une trajectoire de richesse là où le système projette un agrégat partiel.
- HOW TO TEST : checklist d'acceptance sur les libellés de graphique.
- OWNER / MODULE : Léo.
- SEVERITY : HIGH.
- STATUT : PARTIEL. Le titre dit « Patrimoine brut projeté » et la légende distingue nominal et réel. L'exclusion de la dette n'est pas dite.

### INV-G-07 · Deux moteurs de projection ne coexistent pas sans réconciliation
- RULE : s'il existe une projection déterministe et une projection stochastique, la première est la médiane de la seconde à volatilité nulle, ou l'écart est documenté et affiché.
- RATIONALE : deux chiffres différents pour la même question, dans le même produit.
- EXAMPLE : à volatilité 0 et stress 0, la trajectoire déterministe et le P50 doivent coïncider.
- FAILURE MODE : le cockpit et la page Scénarios ne racontent pas la même histoire.
- HOW TO TEST : exécuter les deux moteurs à volatilité nulle et comparer.
- OWNER / MODULE : Paul.
- SEVERITY : MEDIUM.
- STATUT : VIOLÉ. Pas rapproché : le déterministe capitalise annuellement et ajoute l'épargne en fin d'année, le Monte-Carlo capitalise mensuellement et ajoute l'épargne chaque mois.

---

## H. PROVENANCE

### INV-H-01 · Toute valeur significative porte une provenance
- RULE : chaque donnée affichée porte un type parmi ACTUAL, USER_ASSUMPTION, MODEL_ASSUMPTION, EXTERNAL_DATA, DERIVED, MISSING.
- RATIONALE : c'est la promesse centrale du produit face à Finary.
- EXAMPLE : solde 355,48 € ACTUAL, rendement 5,5 % MODEL_ASSUMPTION, patrimoine net DERIVED.
- FAILURE MODE : l'utilisateur ne distingue plus ce qu'il possède de ce qu'il suppose.
- HOW TO TEST : checklist par écran.
- OWNER / MODULE : Léo, Paul.
- SEVERITY : HIGH.
- STATUT : PARTIEL. au niveau des entités. VIOLÉ au niveau des agrégats : `DashboardMetrics` ne porte aucune provenance ; `netWorth` est affiché sans badge.

### INV-H-02 · Une donnée manquante reste MISSING
- RULE : une valeur absente n'est jamais remplacée par 0, par une moyenne ou par une estimation implicite.
- RATIONALE : un zéro implicite est indiscernable d'un zéro réel.
- EXAMPLE : électricité non renseignée reste MISSING ; elle ne contribue pas 0 € au budget, elle ne contribue pas du tout, et le budget est marqué incomplet.
- FAILURE MODE : dépenses sous-estimées, taux d'épargne surestimé.
- HOW TO TEST : jeu avec catégories nulles ; vérifier l'exclusion du total et la présence du drapeau.
- OWNER / MODULE : Paul.
- SEVERITY : BLOCKER.
- STATUT : RESPECTÉ. `monthlyExpenses` filtre sur `monthlyAmount !== null`. Point fort du produit.

### INV-H-03 · La confiance d'un dérivé est bornée par celle de ses inputs
- RULE : `confidence(DERIVED) ≤ min(confidence(inputs))`.
- RATIONALE : un calcul n'améliore jamais la qualité de ses entrées.
- EXAMPLE : patrimoine net dérivé de soldes HIGH et d'une dette HIGH : HIGH. Cash-flow dérivé d'un budget à 5 % de complétude : LOW, quelle que soit la qualité du revenu.
- FAILURE MODE : un chiffre fragile est présenté avec la même assurance qu'un chiffre observé.
- HOW TO TEST : propriété sur des jeux à confiance mixte.
- OWNER / MODULE : Paul.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. Aucune propagation n'existe.

### INV-H-04 · Une saisie utilisateur n'est pas une vérification
- RULE : éditer une valeur ne fait pas passer automatiquement sa confiance à HIGH. La confiance est un attribut à part, éventuellement saisi.
- RATIONALE : l'utilisateur qui déplace un curseur de rendement de 5,5 % à 8 % n'a rien vérifié.
- EXAMPLE : après édition, provenance USER_ASSUMPTION et confiance inchangée ou demandée.
- FAILURE MODE : le registre des hypothèses affiche « confiance élevée » sur des chiffres inventés.
- HOW TO TEST : vérifier la confiance après `update_scenario` et `update_expense`.
- OWNER / MODULE : Léo (règle), Paul (implémentation).
- SEVERITY : MEDIUM.
- STATUT : VIOLÉ. `update_scenario` et `update_expense` forcent `confidence = 'HIGH'`.

### INV-H-05 · Une source externe n'écrase pas une correction manuelle
- RULE : un import (API, CSV, document) qui contredit une valeur corrigée manuellement produit un conflit à arbitrer, jamais une écriture silencieuse.
- RATIONALE : sinon chaque synchronisation efface le travail de l'utilisateur, et il cesse de corriger.
- EXAMPLE : solde corrigé à 355,48 € le 19 août ; import bancaire annonçant 340,00 € au 18 août : conflit présenté, correction conservée.
- FAILURE MODE : perte de données utilisateur, invisible.
- HOW TO TEST : golden case conflit ; vérifier qu'aucune écriture n'a lieu sans résolution.
- OWNER / MODULE : Paul, différé (Open Banking).
- SEVERITY : HIGH.
- STATUT : NON TESTABLE. Aucun import externe n'existe.

### INV-H-06 · Une règle fiscale porte une période d'effet
- RULE : toute règle fiscale porte juridiction, année, période d'effet, source et date de vérification. Une règle sans ces attributs n'est pas appliquée.
- RATIONALE : une règle appliquée hors de sa période produit un résultat faux avec l'apparence de la rigueur.
- EXAMPLE : barème 2026 appliqué à un revenu 2026 seulement ; barème 2027 coexistant sans réécrire 2026.
- FAILURE MODE : recalcul d'un passé fiscal avec des règles futures.
- HOW TO TEST : deux règles pour deux années ; vérifier la sélection par date.
- OWNER / MODULE : Paul, `tax.ts`.
- SEVERITY : HIGH.
- STATUT : PARTIEL. structurellement (`DatedTaxRule` porte ces champs) et prudent en pratique (aucune règle réelle chargée, statut MISSING assumé). Réserve : `socialContributionsRate` du type n'est pas utilisé par `employmentCompensation`, ce qui crée deux sources pour les cotisations.

---

## I. MULTI-DEVISES

### INV-I-01 · Aucune valeur non-EUR n'entre dans un agrégat EUR sans conversion
- RULE : une valeur dont la devise native diffère de la devise de reporting est convertie par un taux daté avant toute agrégation, ou exclue avec un drapeau.
- RATIONALE : additionner 1 000 USD et 1 000 EUR comme 2 000 EUR est une erreur d'environ 8 % sur la moitié du montant.
- EXAMPLE : compte USD à 1 000 USD, taux 0,92 EUR/USD au 19 août 2026 : contribue 920 € et non 1 000 €.
- FAILURE MODE : patrimoine faux, sans aucun signal.
- HOW TO TEST : jeu avec un compte USD ; vérifier soit la conversion, soit le rejet explicite.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : BLOCKER.
- STATUT : VIOLÉ. `deriveMetrics` somme `account.balance` sans lire `account.currency`. Le formulaire d'ajout accepte n'importe quel code de 3 lettres.

### INV-I-02 · Un taux de change est daté et sourcé
- RULE : tout taux porte une date d'observation et une source. Un taux non daté n'est pas utilisable.
- RATIONALE : sans date, impossible de reconstruire un bilan passé ni d'attribuer la performance de change.
- EXAMPLE : `{pair: "USD/EUR", rate: 0.92, date: "2026-08-19", source: "BCE"}`.
- FAILURE MODE : le patrimoine du mois dernier change quand le taux du jour change.
- HOW TO TEST : le modèle refuse un taux sans date.
- OWNER / MODULE : Paul, table `currency_rates`.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. en pratique. La table existe dans le schéma, elle n'est jamais alimentée ni lue ; `fxConvert(amount, eurPerUnit)` ne prend pas de date.

### INV-I-03 · Un taux manquant produit un MISSING, pas un taux de 1
- RULE : en l'absence de taux pour une devise et une date, la valeur est marquée MISSING et l'agrégat est marqué incomplet.
- RATIONALE : appliquer 1 par défaut est le pire des choix : plausible et faux.
- EXAMPLE : compte CHF sans taux : exclu de `GrossAssets`, drapeau « 1 compte non converti ».
- FAILURE MODE : conversion implicite à parité.
- HOW TO TEST : jeu avec une devise sans taux.
- OWNER / MODULE : Paul.
- SEVERITY : BLOCKER.
- STATUT : VIOLÉ. par le même mécanisme que INV-I-01.

### INV-I-04 · La performance de change est séparée de la performance de marché
- RULE : pour une position en devise étrangère, la variation de valeur en devise de reporting se décompose en effet prix et effet change.
- RATIONALE : sans cette séparation, l'utilisateur attribue à son choix de titre ce qui vient de l'euro.
- EXAMPLE : position 100 USD passant de 10 à 11 USD avec un taux passant de 0,92 à 0,88 : +10 % en USD, +5,2 % en EUR, dont -4,3 % d'effet change.
- FAILURE MODE : attribution de performance fausse.
- HOW TO TEST : golden case CASE 4 avec variation simultanée du prix et du taux.
- OWNER / MODULE : Paul, futur Portfolio Engine.
- SEVERITY : MEDIUM.
- STATUT : NON TESTABLE. aujourd'hui, aucune performance n'étant calculée.

---

## J. MONTHLY CLOSE

### INV-J-01 · Une clôture figée ne s'écrase pas silencieusement
- RULE : refermer un mois déjà clos exige une procédure explicite de réouverture, tracée. Sans elle, l'opération est refusée.
- RATIONALE : une clôture est une photographie. Si elle se réécrit, elle ne prouve plus rien.
- EXAMPLE : clôture d'août 2026 à -1 173,51 € ; nouvelle tentative en septembre : refus, ou réouverture tracée avec conservation de la version précédente.
- FAILURE MODE : perte définitive de l'historique patrimonial, sans trace.
- HOW TO TEST : deux appels de clôture sur la même date ; vérifier le refus ou la conservation.
- OWNER / MODULE : Paul, `local-repository.ts` et `supabase-repository.ts`.
- SEVERITY : BLOCKER.
- STATUT : VIOLÉ. `INSERT OR REPLACE` côté SQLite, upsert côté Supabase : la ligne précédente est perdue.

### INV-J-02 · Une clôture fige tout le périmètre, pas seulement le net
- RULE : une clôture enregistre soldes, positions, dettes, revenus, dépenses et allocation, pas seulement trois agrégats.
- RATIONALE : sans le détail, aucune attribution de variation n'est possible a posteriori.
- EXAMPLE : clôture d'août contenant les 6 soldes de compte, les 3 positions et le passif.
- FAILURE MODE : impossible de répondre à « pourquoi mon patrimoine a changé ».
- HOW TO TEST : la clôture restitue le détail suffisant à recalculer les agrégats.
- OWNER / MODULE : Paul.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `monthly_closes` ne stocke que `grossAssets`, `debt`, `netWorth`, `forecastNetWorth`, `variance`.

### INV-J-03 · Un champ nommé « forecast » contient une prévision
- RULE : `forecast_net_worth` contient la valeur projetée pour ce mois, produite avant ce mois. Sinon le champ change de nom.
- RATIONALE : « écart réel contre prévu » et « variation contre mois précédent » sont deux analyses différentes.
- EXAMPLE : prévision de septembre produite fin août à -1 050 € ; constat de septembre -1 100 € ; variance -50 €.
- FAILURE MODE : l'utilisateur croit mesurer sa capacité à tenir un plan alors qu'il mesure une variation.
- HOW TO TEST : le champ est alimenté par la projection, pas par la clôture précédente.
- OWNER / MODULE : Paul (implémentation), Léo (sémantique cible).
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `forecast = prior?.netWorth ?? null`, et l'interface promet « Écart réel vs prévu ».

### INV-J-04 · Une clôture est idempotente ou refusée
- RULE : la même opération de clôture répétée produit soit exactement le même état, soit un refus. Jamais un état différent.
- RATIONALE : une clôture non idempotente rend l'historique dépendant du nombre de clics.
- EXAMPLE : deux clics sur « Clôturer le mois » : une seule ligne dans `monthly_closes`, une seule dans `net_worth_snapshots`.
- FAILURE MODE : doublons de snapshots, variance calculée contre soi-même.
- HOW TO TEST : double appel ; compter les lignes.
- OWNER / MODULE : Paul.
- SEVERITY : MEDIUM.
- STATUT : PARTIEL. `monthly_closes` est upserté donc idempotent en cardinalité, mais `net_worth_snapshots` reçoit une insertion à chaque appel : deux clics créent deux snapshots.

---

## K. INTÉGRITÉ HISTORIQUE

### INV-K-01 · Une mise à jour de solde crée une observation, elle n'en modifie pas une
- RULE : corriger un solde insère une nouvelle ligne datée. L'ancienne reste.
- RATIONALE : permet de reconstruire n'importe quelle date passée et de tracer les corrections.
- EXAMPLE : solde 355,48 € au 19 août, puis 402,10 € au 25 août : deux lignes, pas une mise à jour.
- FAILURE MODE : impossible de savoir ce que le système affichait à une date donnée.
- HOW TO TEST : compter les lignes de `account_balances` après deux mises à jour.
- OWNER / MODULE : Paul.
- SEVERITY : HIGH.
- STATUT : RESPECTÉ. `update_account` fait un INSERT ; la lecture prend le plus récent par `balance_date` puis `created_at`.

### INV-K-02 · La date d'une observation est la date de l'observation
- RULE : la date portée par une donnée est celle de l'événement, pas celle de la saisie.
- RATIONALE : sinon toutes les données s'agglutinent à la date d'import et l'historique est faux.
- EXAMPLE : un solde relevé au 31 juillet et saisi le 19 août porte la date du 31 juillet.
- FAILURE MODE : historique compressé sur les dates de saisie.
- HOW TO TEST : saisir une donnée avec une date antérieure et vérifier son classement.
- OWNER / MODULE : Paul.
- SEVERITY : MEDIUM.
- STATUT : PARTIEL. partiellement. `add_account` et `update_expense` écrivent `effective_date = AS_OF_DATE`, une constante figée au 19 août 2026, quelle que soit la date réelle.

### INV-K-03 · Une version de scénario est immuable
- RULE : une version archivée d'un scénario n'est jamais modifiée ni supprimée.
- RATIONALE : permet de rejouer une décision passée avec les hypothèses de l'époque.
- EXAMPLE : scénario Central version 1 conservé après passage en version 2.
- FAILURE MODE : impossible d'expliquer pourquoi une décision a été prise.
- HOW TO TEST : modifier deux fois, vérifier trois lignes dans `scenario_versions`.
- OWNER / MODULE : Paul.
- SEVERITY : MEDIUM.
- STATUT : RESPECTÉ. `update_scenario` incrémente et archive le payload complet.

### INV-K-04 · Une simulation persistée conserve ses paramètres
- RULE : un run de simulation stocke seed, nombre de simulations, horizon, scénario et méthodologie, suffisamment pour être rejoué à l'identique.
- RATIONALE : une distribution sans ses paramètres n'est pas auditable.
- EXAMPLE : run persisté avec seed 19082026, 3 000 simulations, 30 ans, `scn_central`.
- FAILURE MODE : impossible de reproduire un graphique montré la semaine précédente.
- HOW TO TEST : rejouer un run depuis ses paramètres stockés ; égalité des percentiles.
- OWNER / MODULE : Paul.
- SEVERITY : LOW.
- STATUT : PARTIEL. dans le modèle. NON TESTABLE en pratique : aucun écran ne relit un run passé.

---

## L. RÉCONCILIATION

### INV-L-01 · Un écart de réconciliation reste ouvert tant qu'il n'est pas expliqué
- RULE : un écart au-delà de la tolérance produit un état persistant RECONCILIATION_REQUIRED, avec son montant, sa date et sa cause présumée.
- RATIONALE : la doctrine LFO interdit de faire disparaître un avertissement en inventant une donnée.
- EXAMPLE : PEA, écart 0,56 € au 19 août 2026, cause présumée : arrondi de valorisation ou position non listée.
- FAILURE MODE : l'écart est oublié, puis absorbé dans un futur import.
- HOW TO TEST : l'état existe comme donnée, pas comme texte d'interface.
- OWNER / MODULE : Paul (état), Léo (spécification).
- SEVERITY : HIGH.
- STATUT : PARTIEL. Les deux écarts (0,56 € PEA, 338,20 € prêt) sont exposés en alertes et en callouts, ce qui est honnête. Mais ce sont des lignes `alerts` seedées et un calcul d'interface, pas un état de réconciliation attaché à l'entité.

### INV-L-02 · Un écart ne crée jamais une position ni une ligne d'ajustement fictive
- RULE : aucun « plug » n'est créé pour faire tomber un écart à zéro.
- RATIONALE : un ajustement de bouclage est indiscernable d'une donnée réelle six mois plus tard.
- EXAMPLE : l'écart PEA de 0,56 € ne devient pas une position « divers 0,56 € ».
- FAILURE MODE : le bilan boucle et ment.
- HOW TO TEST : compter les positions avant et après détection d'écart.
- OWNER / MODULE : Paul.
- SEVERITY : BLOCKER.
- STATUT : RESPECTÉ. Le callout dit explicitement « sans créer de position fictive ».

### INV-L-03 · Le total déclaré reste la valeur comptable
- RULE : en cas d'écart entre le solde déclaré d'un compte et la somme de ses positions, le solde déclaré fait autorité pour le bilan.
- RATIONALE : convention LFO, cohérente avec INV-A-04.
- EXAMPLE : PEA compte pour 15 003,13 € au bilan, pas 15 002,57 €.
- FAILURE MODE : le bilan change selon la complétude du détail des positions.
- HOW TO TEST : ajouter une position et vérifier `GrossAssets` inchangé.
- OWNER / MODULE : Paul.
- SEVERITY : HIGH.
- STATUT : RESPECTÉ.

### INV-L-04 · La tolérance de réconciliation est déclarée par domaine
- RULE : chaque contrôle de réconciliation porte une tolérance explicite, adaptée au domaine.
- RATIONALE : 0,01 € est raisonnable sur un compte titres, absurde sur une valorisation immobilière.
- EXAMPLE : comptes 0,01 € ; échéancier de prêt 0,01 € ; valorisation immobilière 1 % ou 1 000 €.
- FAILURE MODE : soit des alertes permanentes ignorées, soit des écarts réels invisibles.
- HOW TO TEST : la tolérance est un paramètre, pas un littéral dans un `if`.
- OWNER / MODULE : Paul, Léo.
- SEVERITY : MEDIUM.
- STATUT : NON TESTABLE. Une seule tolérance existe, écrite en dur : `Math.abs(peaGap) > 0.01`.

---

## M. COMPLÉTUDE

### INV-M-01 · Un calcul incomplet sait le dire
- RULE : tout résultat produit à partir d'inputs partiels expose un indicateur de complétude, la liste des données manquantes matérielles et, quand il est connu, le sens du biais.
- RATIONALE : c'est la différence entre un chiffre et un chiffre utilisable pour décider.
- EXAMPLE : « Free cash flow -142,72 €, complétude 5 %, manquent 19 catégories de dépense, biais : le FCF réel est plus bas ».
- FAILURE MODE : fausse précision. Deux décimales sur un chiffre construit sur 5 % des données.
- HOW TO TEST : tout résultat expose un champ de complétude non nul.
- OWNER / MODULE : Léo (spécification), Paul (implémentation).
- SEVERITY : BLOCKER.
- STATUT : VIOLÉ. au sens structuré. Des callouts textuels existent sur plusieurs pages, ce qui est un bon début, mais aucun résultat ne porte de complétude comme donnée.

### INV-M-02 · La complétude se mesure par calcul, pas globalement
- RULE : la complétude est un attribut du résultat calculé, pas un score unique d'application.
- RATIONALE : le patrimoine net est complet à 100 % sur son périmètre, le cash-flow à 5 %. Un score global moyennerait les deux et n'aiderait personne.
- EXAMPLE : Net Worth 100 %, Cash Flow 5 %, Couverture de liquidité 14 %, Performance : non calculable.
- FAILURE MODE : un score unique rassure sur les zones fiables et masque les zones creuses.
- HOW TO TEST : chaque métrique expose sa propre complétude.
- OWNER / MODULE : Léo.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. `DashboardMetrics.dataCompleteness` est unique et ne mesure en réalité que le budget.

### INV-M-03 · La précision affichée ne dépasse pas la précision du modèle
- RULE : le nombre de décimales affichées reflète l'incertitude du calcul.
- RATIONALE : afficher un TRI à 0,01 % près sur un modèle à cinq hypothèses non sourcées est une fausse précision.
- EXAMPLE : TRI immobilier affiché « environ 8 % » plutôt que « 8,43 % » tant que la taxe foncière est MISSING.
- FAILURE MODE : l'utilisateur arbitre entre deux projets sur une différence de 0,2 % de TRI qui n'a aucun sens.
- HOW TO TEST : règle d'arrondi liée au niveau de complétude, vérifiée en revue d'acceptance.
- OWNER / MODULE : Léo.
- SEVERITY : HIGH.
- STATUT : VIOLÉ. Le TRI immobilier est affiché à une décimale de pourcentage, le MOIC à deux décimales, le DSCR à deux décimales, sur un modèle dont toutes les entrées sont des USER_ASSUMPTION par défaut.

### INV-M-04 · Une donnée indispensable manquante bloque l'affichage du résultat
- RULE : certains inputs sont indispensables. En leur absence, le résultat n'est pas affiché sous forme numérique : il affiche « non calculable » et la donnée requise.
- RATIONALE : mieux vaut un vide explicite qu'un nombre indéfendable.
- EXAMPLE : « FI ratio : non calculable, dépenses cibles manquantes ».
- FAILURE MODE : un chiffre produit par convention est lu comme un résultat.
- HOW TO TEST : jeu sans input indispensable ; vérifier l'état « non calculable ».
- OWNER / MODULE : Léo, Paul.
- SEVERITY : HIGH.
- STATUT : PARTIEL. La page Goals affiche « Non calculable » pour le FI ratio et le Freedom Coverage, ce qui est exemplaire. La page Investments affiche « +77,71 % » là où le même raisonnement imposerait « non calculable ».

---

## Points à soumettre à la review Checkpoint 2

1. INV-D-02 : le service de dette pendant un différé est-il 0 ou la mensualité contractuelle ? Trois définitions coexistent dans le produit aujourd'hui.
2. INV-A-02 : quelle règle d'arrondi monétaire canonique, et à quelle couche ?
3. INV-A-06 : convention actif ou passif pour un solde bancaire débiteur.
4. INV-E-04 : assiette de la valeur de sortie immobilière, avec ou sans travaux capitalisés.
5. INV-J-03 : renommer `forecast_net_worth` ou le brancher sur la projection.
6. INV-M-02 : complétude par métrique plutôt que globale, confirmer le principe avant de spécifier.
7. INV-G-07 : conserver, aligner ou supprimer la projection déterministe.
8. Manque-t-il une catégorie entière ? Candidats écartés faute de périmètre : fiscalité des enveloppes, cap table et dilution, événements de vie.
