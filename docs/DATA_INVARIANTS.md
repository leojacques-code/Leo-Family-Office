# Registre des invariants de données

Léo Family Office. Version 0.2 du 20 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
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
| IMPLEMENTATION STATUS | RESPECTED / PARTIAL / VIOLATED / NOT_APPLICABLE au commit `ef5bacf` : ce que le code fait |
| TEST STATUS | COVERED / PARTIAL / UNCOVERED / FAILING au même commit : ce que la suite prouve |

Les deux derniers champs sont volontairement séparés. Un calcul juste dont le test est
mal écrit n'est pas un calcul faux, et un calcul faux couvert par un test qui verrouille
l'erreur n'est pas un calcul sûr. Confondre les deux axes conduit à corriger le mauvais
artefact.

SEVERITY qualifie la conséquence d'une violation, pas l'urgence du chantier.
BLOCKER signifie : un chiffre faux est présenté à l'utilisateur comme une vérité.

## Synthèse

Deux axes distincts, jamais fusionnés : ce que le code fait, et ce que la suite de tests
prouve. Un calcul financièrement correct dont le test échoue pour une raison de
représentation flottante reste RESPECTED côté implémentation et FAILING côté test.
INV-A-01 est exactement ce cas, et c'est la raison pour laquelle les deux axes existent.

IMPLEMENTATION STATUS, au commit `ef5bacf` :

| Catégorie | Total | RESPECTED | PARTIAL | VIOLATED | NOT_APPLICABLE |
|---|---:|---:|---:|---:|---:|
| A. Balance sheet | 7 | 3 | 1 | 1 | 2 |
| B. Cash, liquidité et taux de flux | 7 | 1 | 1 | 5 | 0 |
| C. Investments | 6 | 0 | 0 | 4 | 2 |
| D. Debt | 9 | 1 | 1 | 5 | 2 |
| E. Real Estate | 5 | 0 | 0 | 5 | 0 |
| F. Transactions et transferts | 5 | 1 | 0 | 0 | 4 |
| G. Scénarios et projections | 8 | 4 | 1 | 3 | 0 |
| H. Provenance | 6 | 1 | 2 | 2 | 1 |
| I. Multi-devises | 4 | 0 | 0 | 3 | 1 |
| J. Monthly close | 4 | 0 | 1 | 3 | 0 |
| K. Intégrité historique | 4 | 3 | 1 | 0 | 0 |
| L. Réconciliation | 4 | 2 | 1 | 0 | 1 |
| M. Complétude | 5 | 0 | 1 | 4 | 0 |
| Total | 74 | 16 | 10 | 35 | 13 |

TEST STATUS, au même commit :

| Catégorie | Total | COVERED | PARTIAL | UNCOVERED | FAILING |
|---|---:|---:|---:|---:|---:|
| A. Balance sheet | 7 | 2 | 0 | 3 | 2 |
| B. Cash, liquidité et taux de flux | 7 | 1 | 1 | 5 | 0 |
| C. Investments | 6 | 0 | 0 | 6 | 0 |
| D. Debt | 9 | 1 | 1 | 7 | 0 |
| E. Real Estate | 5 | 0 | 0 | 5 | 0 |
| F. Transactions et transferts | 5 | 0 | 0 | 5 | 0 |
| G. Scénarios et projections | 8 | 2 | 1 | 5 | 0 |
| H. Provenance | 6 | 1 | 1 | 4 | 0 |
| I. Multi-devises | 4 | 0 | 1 | 3 | 0 |
| J. Monthly close | 4 | 0 | 0 | 4 | 0 |
| K. Intégrité historique | 4 | 0 | 0 | 4 | 0 |
| L. Réconciliation | 4 | 0 | 1 | 3 | 0 |
| M. Complétude | 5 | 0 | 0 | 5 | 0 |
| Total | 74 | 7 | 6 | 59 | 2 |

Lecture des statuts d'implémentation :
- RESPECTED : le code tient la règle.
- PARTIAL : tenue sur un axe, prise en défaut sur un autre. Le détail est dans l'invariant.
- VIOLATED : le code contredit la règle.
- NOT_APPLICABLE : la fonctionnalité concernée n'existe pas. La règle contraint le futur, elle ne juge pas le présent.

Lecture des statuts de test :
- COVERED : un test automatisé verrouille la règle.
- PARTIAL : une partie seulement de la règle est couverte.
- UNCOVERED : aucun test. Inclut tout ce qui vit dans `pages.tsx`, hors de portée de la suite faute de framework de test d'interface.
- FAILING : un test existe et échoue.

35 invariants sur 74 sont violés par l'implémentation. Ce n'est pas un accident : le
produit a été généré vite, puis audité. Le registre sert à rendre cette dette explicite et
priorisable, pas à disqualifier la base existante, dont plusieurs propriétés fortes
(non-double-comptage, exclusion du cash d'enveloppe, MISSING jamais transformé en zéro,
reproductibilité du seed) sont déjà correctes et testées.

Un second chiffre mérite d'être lu à part : 59 invariants sur 74 ne sont couverts par
aucun test. C'est le principal risque de régression du dépôt, indépendamment des
violations, et il ne se réduira pas en corrigeant des formules.

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
- IMPLEMENTATION STATUS : RESPECTED. en valeur, VIOLÉ en test. `15571.49 - 16745` rend `-1173.5100000000002` et le test `financial.test.ts:40` échoue sur `toEqual`. Vérifié par exécution de `npx vitest run` le 20 août 2026 : 25 tests, 24 verts, 1 rouge. Voir INV-A-02.
- TEST STATUS : FAILING. Le calcul est financièrement exact. `financial.test.ts:40` échoue sur une égalité stricte de flottant, ce qui est un défaut du test, pas de la formule. Voir INV-A-02.

### INV-A-02 · Tolérance monétaire explicite `DÉPEND-DEF`
- RULE : décision canonique. Les calculs internes s'effectuent en **pleine précision**,
  sans arrondi intermédiaire. L'arrondi n'intervient qu'à deux frontières : la
  **restitution** (affichage, export, rapport) et le **contrat** (montant d'une échéance
  effectivement débitée, montant d'une facture). Corollaire de test : toute comparaison
  de montants utilise une tolérance déclarée, aucune assertion d'égalité stricte sur un
  flottant monétaire.
- RATIONALE : arrondir à chaque agrégation dégrade la précision sur les calculs itératifs,
  un échéancier de 240 lignes en premier. Ne jamais arrondir laisse fuir des artefacts de
  représentation binaire jusqu'à l'écran. Arrondir aux deux seules frontières où un
  montant devient un engagement ou une information résout les deux problèmes.
- EXAMPLE : `15571.49 - 16745` vaut `-1173.5100000000002` en interne, s'affiche
  `-1 173,51 €`, et le test attend `-1 173,51 €` à 0,005 € près plutôt que
  `toEqual(-1173.51)`.
- FAILURE MODE : suite de tests rouge sans bug financier réel, ou pire, suite rendue verte en corrigeant le moteur au lieu du test.
- HOW TO TEST : interdiction lint ou revue : aucun `toEqual` sur un nombre issu d'une somme de montants.
- OWNER / MODULE : Paul, tests financiers.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : NOT_APPLICABLE. La règle d'arrondi canonique n'est pas encore décidée (question 1 de `FINANCIAL_DEFINITIONS.md` §14).
- TEST STATUS : FAILING. Convention de test, pas de code applicatif. La règle d'arrondi canonique est désormais fixée ; le test doit être aligné dessus.

### INV-A-03 · Un actif est compté exactement une fois
- RULE : aucun actif ne contribue à `GrossAssets` par plus d'un chemin.
- RATIONALE : le double comptage est le mode de défaillance le plus courant et le plus invisible d'un agrégateur patrimonial.
- EXAMPLE : PEA à 15 003,13 € contenant 8 698 € d'ETF et 6 304,57 € de cash. `GrossAssets` retient 15 003,13 €, pas 30 005,70 €.
- FAILURE MODE : patrimoine affiché environ doublé sur les comptes titres.
- HOW TO TEST : jeu avec positions dont la somme égale le solde, vérifier que `GrossAssets` n'augmente pas quand on ajoute des positions.
- OWNER / MODULE : Paul, `src/lib/data/shared.ts:deriveMetrics`.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : RESPECTED. et testé (`shared.test.ts`, « additionne les soldes de comptes sans double compter les positions »).
- TEST STATUS : COVERED. `shared.test.ts`, « additionne les soldes de comptes sans double compter les positions ».

### INV-A-04 · Les positions expliquent le solde, elles ne s'y ajoutent pas
- RULE : la valeur des positions d'un compte n'entre jamais dans `GrossAssets`. Elle sert à la réconciliation et à l'allocation.
- RATIONALE : corollaire opérationnel de INV-A-03, et convention LFO retenue (solde de compte = valeur comptable).
- EXAMPLE : ajouter une position de 500 € sans changer le solde du compte laisse `GrossAssets` inchangé et augmente le gap de réconciliation de 500 €.
- FAILURE MODE : chaque import de relevé de positions gonfle le patrimoine.
- HOW TO TEST : test d'invariance de `GrossAssets` sous ajout de position.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : RESPECTED.
- TEST STATUS : COVERED. Couvert par le même test que INV-A-03.

### INV-A-05 · Périmètre déclaré dans le libellé
- RULE : un agrégat dont le périmètre est partiel porte cette limite dans son libellé
  affiché. Décision canonique : tant que le bilan ne contient que des actifs financiers,
  le libellé est **« Actifs financiers identifiés »**. Le terme « Patrimoine brut » est
  réservé à un agrégat contenant effectivement immobilier, business equity et autres
  actifs.
- RATIONALE : « Patrimoine brut » sans immobilier ni business equity n'est pas un
  patrimoine brut, c'est un sous-ensemble. Le libellé promet un périmètre que le calcul
  n'a pas.
- EXAMPLE : au commit `ef5bacf`, afficher « Actifs financiers identifiés 15 571,49 € ».
- FAILURE MODE : l'utilisateur croit son bilan exhaustif et prend une décision sur un périmètre tronqué.
- HOW TO TEST : revue de libellés, non automatisable ; checklist d'acceptance.
- OWNER / MODULE : Léo, `src/components/pages.tsx`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : PARTIAL. La page Net Worth porte un callout « Périmètre identifié », mais les cartes affichent « Patrimoine brut » sans réserve.
- TEST STATUS : UNCOVERED. Non automatisable ; relève de la checklist d'acceptance.

### INV-A-06 · Un solde bancaire négatif est un passif court terme
- RULE : décision canonique. Un solde bancaire débiteur est un **passif court terme**
  (découvert), pas un actif de valeur négative. Il entre dans `Liabilities`, jamais dans
  `GrossAssets`. `GrossAssets` est donc la somme des soldes **positifs** des comptes.
  La convention est unique et s'applique identiquement au cockpit, aux exports et aux
  clôtures.
- RATIONALE : un découvert est économiquement une dette, souvent la plus chère du bilan.
  Le traiter en actif négatif préserve une additivité naïve au prix d'une fausse
  représentation, et masque le découvert dans les analyses de passif et de liquidité.
- EXAMPLE : compte à -3,44 €. `GrossAssets` ne le contient pas. `Liabilities` reçoit
  3,44 €. `NetWorth` est inchangé par rapport à la convention actif négatif, ce qui est
  attendu : seule la présentation du bilan change, pas le net.
- FAILURE MODE : deux conventions coexistantes produisent un écart de 2 fois le solde
  débiteur entre deux écrans. Une convention actif négatif masque un découvert dans les
  indicateurs de dette et de liquidité.
- HOW TO TEST : jeu avec un compte débiteur ; vérifier `GrossAssets` sans lui,
  `Liabilities` avec lui, `NetWorth` identique aux deux conventions, et cohérence avec
  l'export CSV.
- OWNER / MODULE : Léo pour la sémantique produit ; Paul pour la dérivation ; Tom si la
  convention impose une colonne ou une vue dédiée.
- SEVERITY : MEDIUM (3,44 € au seed, structurant en définition).
- IMPLEMENTATION STATUS : VIOLATED. convention non arrêtée.
- TEST STATUS : UNCOVERED. La convention canonique est désormais fixée : le code compte encore le solde débiteur en actif négatif.

### INV-A-07 · Un bien entre en valeur brute, sa dette en passif, son equity est DERIVED
- RULE : un bien immobilier entre dans `GrossAssets` à sa **valeur brute de marché**. L'emprunt adossé entre dans `Liabilities` à son capital restant dû. `RealEstateEquity` est une grandeur **DERIVED** (`valeur brute - dette adossée`) destinée à l'analyse et au reporting : elle n'est **jamais** additionnée en plus dans `GrossAssets`, ni ailleurs dans le bilan. La même règle s'applique au business equity : valeur de la participation en actif, dette de la structure en passif quand elle est consolidée, equity attribuable en DERIVED.
- RATIONALE : la convention brute est la seule qui préserve l'information de levier. Une convention nette masque le LTV, le DSCR et l'exposition au risque de prix. Le danger n'est pas de choisir une convention plutôt que l'autre, c'est de mélanger les deux : compter l'equity en actif *et* l'emprunt en passif retranche la dette deux fois.
- EXAMPLE : bien valorisé 220 000 €, emprunt 180 000 €. `GrossAssets` reçoit 220 000, `Liabilities` reçoit 180 000, `NetWorth` contribue pour 40 000. `RealEstateEquity` vaut 40 000 en DERIVED, affichable, jamais sommable. Le total du bilan ne doit jamais être 220 000 + 40 000, ni 40 000 - 180 000.
- FAILURE MODE : deux erreurs symétriques. Sommer l'equity en plus surévalue le patrimoine de 40 000. Entrer l'equity en actif tout en gardant l'emprunt en passif sous-évalue le patrimoine de 180 000.
- HOW TO TEST : golden case immobilier ; vérifier `GrossAssets` égal à la valeur brute, `Liabilities` égal au capital restant dû, et qu'aucun agrégat ne consomme `RealEstateEquity`. Vérifier aussi que `RealEstateEquity` porte bien la provenance DERIVED.
- OWNER / MODULE : Paul pour la règle d'entrée au bilan et la dérivation ; Tom pour la persistance (`properties`, `mortgages`, présentes au schéma et inutilisées).
- SEVERITY : BLOCKER (dès persistance).
- IMPLEMENTATION STATUS : NOT_APPLICABLE. Aucun bien n'est persisté aujourd'hui.
- TEST STATUS : UNCOVERED. Aucun bien n'est persisté.

---

## B. CASH, LIQUIDITÉ ET TAUX DE FLUX

### INV-B-01 · Le cash d'enveloppe n'est jamais du cash bancaire
- RULE : le cash logé dans un PEA, un CTO, une assurance-vie ou toute enveloppe n'entre jamais dans `BankCash`.
- RATIONALE : ce cash n'est pas mobilisable sans sortie d'enveloppe, souvent fiscalement pénalisante ou interdite (PEA avant 5 ans).
- EXAMPLE : 6 304,57 € de cash PEA ne rejoignent pas les 354,08 € de cash bancaire. `BankCash` reste 354,08 €.
- FAILURE MODE : l'utilisateur croit disposer de 6 658,65 € de liquidité immédiate et engage une dépense qu'il ne peut pas couvrir.
- HOW TO TEST : jeu avec une position `isCash = true` sur un compte PEA ; vérifier `BankCash` inchangé.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : RESPECTED. Le filtre porte sur `type ∈ {BANK, SAVINGS}`, ce qui exclut PEA et CTO. Point fort du produit.
- TEST STATUS : COVERED. Couvert indirectement par `shared.test.ts`.

### INV-B-02 · La liquidité se déduit du champ liquidité, pas du type de compte
- RULE : la mobilisabilité d'un actif est portée par un attribut de liquidité, pas inférée du type de compte.
- RATIONALE : un livret bloqué et un livret A sont tous deux SAVINGS, avec des liquidités opposées.
- EXAMPLE : compte SAVINGS avec `liquidity = ILLIQUID` (épargne salariale bloquée) : exclu de `BankCash`.
- FAILURE MODE : réserve de sécurité surévaluée du montant des épargnes bloquées.
- HOW TO TEST : jeu avec un compte SAVINGS ILLIQUID ; vérifier son exclusion.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. Le champ `liquidity` existe sur `FinancialAccount`, il est affiché nulle part et n'est utilisé par aucun calcul.
- TEST STATUS : UNCOVERED.

### INV-B-03 · Une couverture s'exprime en mois, jamais en devise
- RULE : `EmergencyCoverageMonths` est un nombre de mois. Son rendu ne passe jamais par un formateur monétaire.
- RATIONALE : une unité fausse est une erreur d'ordre de grandeur, pas une coquille.
- EXAMPLE : 354,08 / 1 140 = 0,31 mois. Afficher « 0,31 mois », jamais « 0,31 € ».
- FAILURE MODE : l'utilisateur lit un montant là où le système parle d'une durée.
- HOW TO TEST : revue de rendu ; typage d'unité sur les métriques si le modèle l'adopte.
- OWNER / MODULE : Léo, `pages.tsx` `TodayPage`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `pages.tsx:76` rend `<Currency value={state.metrics.emergencyCoverageMonths} /> mois`, donc « 0,31 € mois ».
- TEST STATUS : UNCOVERED. Aucun framework de test d'interface.

### INV-B-04 · Le dénominateur de la couverture inclut tout l'incompressible
- RULE : les dépenses incompressibles utilisées au dénominateur incluent le service de dette exigible.
- RATIONALE : une mensualité de prêt est aussi incompressible qu'un loyer.
- EXAMPLE : loyer 1 140 € et mensualité 284,72 € exigible donnent un dénominateur de 1 424,72 €, soit 0,25 mois de couverture et non 0,31.
- FAILURE MODE : réserve de sécurité surévaluée de 25 % dans cet exemple.
- HOW TO TEST : golden case avec un prêt exigible ; comparer les deux dénominateurs.
- OWNER / MODULE : Paul, `deriveMetrics`.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : VIOLATED. Le dénominateur ne contient que les catégories de dépense marquées essentielles.
- TEST STATUS : UNCOVERED.

### INV-B-05 · Une couverture calculée sur un budget incomplet porte un drapeau
- RULE : si des catégories de dépense essentielles sont MISSING, la couverture affichée porte un drapeau d'incomplétude et un sens de biais.
- RATIONALE : ici le biais est connu : ajouter des dépenses fera baisser le ratio. L'utilisateur doit le savoir.
- EXAMPLE : « 0,31 mois, borne haute : 7 catégories essentielles sur 8 non renseignées ».
- FAILURE MODE : l'utilisateur se croit à 0,31 mois alors qu'il est peut-être à 0,15.
- HOW TO TEST : le drapeau apparaît dès qu'une catégorie essentielle est MISSING.
- OWNER / MODULE : Léo (spécification), Paul (drapeau).
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : PARTIAL. Un callout général existe sur la page Cash Flow ; la carte du cockpit affiche « de loyer couvert », ce qui est honnête mais pas un drapeau structuré.
- TEST STATUS : UNCOVERED.

### INV-B-06 · LiquidAssets, NetLiquidityPosition30d et LiquidNetWorth sont trois grandeurs distinctes
- RULE : trois définitions séparées, trois noms, trois usages. Aucune n'est un alias
  d'une autre, aucune n'est un alias de `NetWorth`.

      LiquidAssets(t)             = Σ actifs mobilisables sous 30 jours
                                    sans pénalité ni perte de valeur significative

      NetLiquidityPosition30d(t)  = LiquidAssets(t)
                                    - Σ engagements exigibles dans les 30 jours

      LiquidNetWorth(t)           = LiquidAssets(t) - Σ Liabilities(t)

  `LiquidAssets` est un stock d'actifs. `NetLiquidityPosition30d` est une position de
  trésorerie à horizon court, seule pertinente pour « puis-je payer ce qui tombe ce
  mois-ci ». `LiquidNetWorth` répond à « que resterait-il si je devais solder toutes mes
  dettes avec mes seuls actifs liquides », et il est structurellement inférieur à
  `NetWorth` dès qu'il existe un actif illiquide.
- RATIONALE : ces trois questions sont posées à des moments différents et appellent des
  réponses différentes. Les confondre sous un nom unique produit une métrique qui répond
  à une question que personne ne pose. C'est le cas aujourd'hui : `liquidNetWorth` vaut
  exactement `netWorth`, donc n'apporte rien et suggère une information de liquidité
  qu'il ne contient pas.
- EXAMPLE : cash bancaire 2 000, PEA mobilisable 20 000, bien immobilier 220 000, prêt
  immobilier 180 000 dont 900 exigibles dans les 30 jours. `LiquidAssets` = 22 000.
  `NetLiquidityPosition30d` = 22 000 - 900 = 21 100. `LiquidNetWorth` = 22 000 - 180 000
  = -158 000. `NetWorth` = 242 000 - 180 000 = 62 000. Quatre nombres, quatre sens.
- FAILURE MODE : un utilisateur lit `LiquidNetWorth` comme une réserve disponible et
  engage une dépense qu'il ne peut pas couvrir, ou l'inverse, renonce à un projet parce
  qu'une métrique négative le décourage sans raison.
- HOW TO TEST : jeu comportant au moins un actif illiquide et une dette à échéance
  proche ; vérifier que les trois grandeurs diffèrent, et qu'aucune n'égale `NetWorth`.
- OWNER / MODULE : Léo pour la sémantique et les libellés ; Paul pour les trois
  dérivations et la qualification de liquidité par actif.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. Une seule métrique existe, `liquidNetWorth`, et elle
  est identique à `netWorth`. Les deux autres n'existent pas.
- TEST STATUS : UNCOVERED.

### INV-B-07 · Savings Rate et Investment Rate sont des flux constatés, pas des proxys du FCF
- RULE :

      SavingsRate(période)    = épargne effectivement constituée sur la période
                                / revenu net encaissé sur la période

      InvestmentRate(période) = montant effectivement investi sur la période
                                / revenu net encaissé sur la période

  Les trois numérateurs et dénominateurs se lisent dans le **ledger de flux**. Tant que
  ce ledger n'existe pas, les deux métriques sont **NOT_COMPUTABLE**. Elles ne sont pas
  approximées par le free cash flow, ni par une capacité d'épargne théorique, ni par une
  différence entre deux soldes.
- RATIONALE : le FCF est une capacité, l'épargne est un fait. Un mois à FCF positif où
  tout a été dépensé a un taux d'épargne nul. Proxifier revient à afficher une intention
  sous le nom d'un constat, ce qui est précisément le type d'affirmation que le produit
  s'interdit ailleurs. Second motif : `investmentRate` calculé comme `max(0, FCF) / revenu`
  est mathématiquement identique à `savingsRate` dès que le FCF est positif, donc deux
  métriques affichées pour une seule information.
- EXAMPLE : revenu net 3 000, dépenses 1 600, FCF 1 400, mais aucun virement vers un
  compte d'épargne ni vers un compte-titres sur la période. `SavingsRate` = 0 %,
  `InvestmentRate` = 0 %, et non 46,7 %. Autre cas : même revenu, 500 versés sur le PEA
  dont 300 investis et 200 laissés en cash PEA. `SavingsRate` = 16,7 %,
  `InvestmentRate` = 10,0 %.
- FAILURE MODE : l'utilisateur croit épargner ce qu'il n'a pas épargné, et calibre ses
  objectifs sur une discipline qu'il n'a pas démontrée.
- HOW TO TEST : jeu sans transaction : les deux métriques doivent rendre NOT_COMPUTABLE,
  pas 0 et pas le FCF. Jeu avec transferts internes : le virement vers le PEA compte en
  épargne, l'achat de titres compte en investissement, sans double comptage.
- OWNER / MODULE : Léo pour la sémantique et l'état non calculable ; Paul pour les
  formules ; Tom pour le ledger de flux et le modèle de transfert dont elles dépendent.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. Les deux métriques sont dérivées du FCF, et
  `investmentRate` duplique `savingsRate` quand le FCF est positif.
- TEST STATUS : PARTIAL. `shared.test.ts` verrouille le comportement actuel, donc verrouille le proxy.

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
- IMPLEMENTATION STATUS : NOT_APPLICABLE. Aucun calcul de performance n'existe. Voir INV-C-02.
- TEST STATUS : UNCOVERED. Aucun calcul de performance n'existe.

### INV-C-02 · Aucun pourcentage de performance sans base de calcul
- RULE : une performance affichée doit être dérivable des données du système : cost basis, flux et dates présents.
- RATIONALE : un pourcentage sans base est une donnée inventée, ce que la doctrine LFO interdit explicitement.
- EXAMPLE : le CTO a `cost_basis = NULL` et aucun historique de flux. Aucune performance n'est calculable pour ce compte.
- FAILURE MODE : l'utilisateur croit à une performance de +77,71 % qu'aucune donnée ne soutient.
- HOW TO TEST : toute métrique de performance retourne MISSING si le cost basis ou l'historique de flux est absent.
- OWNER / MODULE : Léo (retrait immédiat), Paul (calcul).
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : VIOLATED. `pages.tsx:157` affiche la chaîne littérale « +77,71 % » sous le libellé « Performance affichée » pour le CTO.
- TEST STATUS : UNCOVERED.

### INV-C-03 · Les métriques de portefeuille sont dérivées, jamais littérales
- RULE : aucune valeur monétaire ou pourcentage propre au portefeuille de l'utilisateur n'est écrit dans le code de l'interface.
- RATIONALE : une constante d'interface ne se met pas à jour avec les données ; elle devient fausse à la première correction.
- EXAMPLE : la concentration MSCI World doit se calculer `position.value / grossAssets`, jamais `8698 / grossAssets`.
- FAILURE MODE : après mise à jour du portefeuille, le cockpit affiche encore l'ancienne valeur, sans aucun signal.
- HOW TO TEST : revue statique ; interdiction lint des littéraux numériques monétaires dans `pages.tsx`.
- OWNER / MODULE : Léo, `pages.tsx`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `8698`, `703.12`, `14300`, `284.72` sont écrits en dur dans l'interface.
- TEST STATUS : UNCOVERED.

### INV-C-04 · Les entités sont référencées par relation, pas par identifiant littéral
- RULE : l'interface ne cible jamais un compte par une chaîne d'identifiant écrite en dur.
- RATIONALE : les identifiants Supabase sont des UUID générés. Un compte recréé change d'identifiant et l'écran se vide sans erreur.
- EXAMPLE : filtrer sur `account.type === "PEA"` plutôt que sur `account.id === "acc_pea"`.
- FAILURE MODE : panne silencieuse. La page Investments affiche 0 € sans message d'erreur.
- HOW TO TEST : renommer les identifiants du jeu de test et vérifier que les écrans restent peuplés.
- OWNER / MODULE : Léo, `pages.tsx` `InvestmentsPage` et `TodayPage`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `"acc_pea"` et `"acc_cto"` apparaissent en dur aux lignes 150 à 154 et 65.
- TEST STATUS : UNCOVERED.

### INV-C-05 · Le total d'une allocation égale l'agrégat qu'elle décompose
- RULE : la somme des tranches d'un graphique d'allocation égale la valeur affichée au centre, ou l'écart est explicitement nommé.
- RATIONALE : deux nombres différents pour la même chose, côte à côte, sur le même écran.
- EXAMPLE : tranches 8 698 + 6 304,57 + 214,28 + 354,08 = 15 570,93 €, centre 15 571,49 €, écart 0,56 € correspondant au gap PEA.
- FAILURE MODE : l'utilisateur additionne les pourcentages et n'obtient pas 100 %.
- HOW TO TEST : test de somme sur le jeu de données de l'allocation.
- OWNER / MODULE : Paul (extraction d'un moteur d'allocation), Léo (affichage de l'écart).
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : VIOLATED. silencieusement. L'écart existe, il correspond exactement au gap de réconciliation déjà exposé ailleurs, mais rien ne le relie sur ce graphique.
- TEST STATUS : UNCOVERED. Le calcul vit dans le JSX, donc hors de portée de la suite.

### INV-C-06 · Frais et dividendes sont des flux distincts de la performance
- RULE : frais et dividendes sont enregistrés comme flux datés, jamais nettés silencieusement dans la valeur de position.
- RATIONALE : le fees drag et le rendement courant sont des analyses distinctes exigées par le business plan §9.
- EXAMPLE : dividende de 40 € réinvesti : contribution +40, performance de marché inchangée sur cet événement.
- FAILURE MODE : impossible de dire si la performance vient des prix ou des coupons.
- HOW TO TEST : golden case dividende ; vérifier la séparation.
- OWNER / MODULE : Paul pour les formules de performance ; Tom pour le modèle de flux, frais et dividendes, à créer.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : NOT_APPLICABLE. Ni frais ni dividendes ne sont modélisés.
- TEST STATUS : UNCOVERED. Ni frais ni dividendes ne sont modélisés.

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
- IMPLEMENTATION STATUS : RESPECTED. et testé (« caps the final contractual payment at the remaining balance »).
- TEST STATUS : COVERED. `financial.test.ts`, « caps the final contractual payment at the remaining balance ».

### INV-D-02 · Le service de dette est la somme des cash-out contractuellement exigibles
- RULE :

      DebtService(période) = Σ LoanScheduleEntry.totalCashOut
                             pour toute échéance dont la date d'exigibilité
                             tombe dans la période

  `totalCashOut` est le montant réellement débité : intérêt + principal + assurance +
  frais, lorsque ces composantes existent. Trois conséquences qui découlent de la règle
  et ne sont pas des cas particuliers :
  1. avant la première échéance exigible, aucune ligne d'échéancier ne tombe dans la
     période, donc `DebtService = 0` ;
  2. en différé partiel, les lignes d'échéancier portent un `totalCashOut` égal aux
     intérêts intercalaires, donc `DebtService` vaut ce montant, ni 0, ni la mensualité
     de la phase d'amortissement ;
  3. après la dernière échéance, plus aucune ligne ne tombe dans la période, donc
     `DebtService = 0`.
- RATIONALE : définir le service de dette par une fenêtre de dates appliquée à un champ
  `monthlyPayment` unique oblige à traiter le différé, la maturité, les paliers et
  l'assurance comme autant d'exceptions. Le définir par l'échéancier supprime les
  exceptions : l'échéancier porte déjà l'information. C'est aussi la seule définition
  compatible avec la priorité des sources du business plan §6.1, où un échéancier
  bancaire importé fait autorité.
- EXAMPLE : prêt à 0 %, première échéance le 5 décembre 2026, 60 échéances de 284,72 €.
  Au 19 août 2026, aucune ligne exigible : 0 €. Au 5 décembre 2026 : 284,72 €. Prêt en
  différé partiel de 20 000 € à 2 % : 33,33 € par mois pendant le différé, puis 350,56 €.
- FAILURE MODE : cash-flow libre faux dans les deux sens. Sous-estimé pendant un différé
  total, surestimé pendant un différé partiel traité comme un différé total, et
  sous-estimé indéfiniment après la maturité.
- HOW TO TEST : golden cases CASE 8 et CASE 11 ; quatre points d'observation par prêt,
  avant première échéance, à la première échéance, en cours, après maturité.
- OWNER / MODULE : Paul pour la définition et la dérivation ; Tom pour le modèle
  `LoanScheduleEntry` et sa persistance.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : VIOLATED. et l'arbitrage produit n'est pas rendu. Le code compte 284,72 € dès la date zéro via un filtre `firstPaymentDate <= "2027-08-19"`. L'interface et `docs/ASSUMPTIONS.md` affirment l'inverse. Voir `OPEN_QUESTIONS.md` Q-01.
- TEST STATUS : UNCOVERED. Aucun test des fenêtres d'exigibilité.

### INV-D-03 · Un échéancier couvre exactement la vie du prêt, ni avant ni après
- RULE : l'échéancier d'un prêt ne comporte aucune ligne antérieure à la première
  échéance contractuelle, ni postérieure à la dernière. Corollaire de INV-D-02 : un prêt
  échu contribue 0 au service de dette, sans qu'aucune règle supplémentaire soit
  nécessaire.
- RATIONALE : la borne temporelle appartient à l'échéancier, pas au calcul qui le lit.
  Un calcul qui doit se souvenir de tester la maturité finira par l'oublier quelque part.
- EXAMPLE : prêt de 60 échéances, première le 5 décembre 2026, dernière le 5 novembre
  2031. L'échéancier compte exactement 60 lignes. Au 1er janvier 2032, aucune n'est
  exigible.
- FAILURE MODE : mensualité perpétuelle si la borne haute est absente, ou service de
  dette anticipé si la borne basse l'est.
- HOW TO TEST : cardinalité de l'échéancier égale au nombre d'échéances contractuelles ;
  observation postérieure à la maturité.
- OWNER / MODULE : Paul pour la génération de l'échéancier dérivé ; Tom pour la
  contrainte de cardinalité en base.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. Le filtre actuel ne teste jamais `maturityDate`.
- TEST STATUS : UNCOVERED.

### INV-D-04 · Une fenêtre temporelle se dérive, elle ne s'écrit pas
- RULE : aucune borne de date n'est une constante littérale. Toute fenêtre se dérive de la date d'observation.
- RATIONALE : une constante `"2027-08-19"` est correcte un seul jour et devient fausse ensuite, silencieusement.
- EXAMPLE : comparer `firstPaymentDate <= asOfDate` et non `firstPaymentDate <= "2027-08-19"`.
- FAILURE MODE : à partir d'août 2027, tout prêt à première échéance postérieure disparaît du service de dette.
- HOW TO TEST : exécuter `deriveMetrics` avec deux dates d'observation distinctes et vérifier que le résultat change de façon cohérente.
- OWNER / MODULE : Paul, `shared.ts:31`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED.
- TEST STATUS : UNCOVERED.

### INV-D-05 · Un échéancier contractuel prime sur un échéancier théorique
- RULE : quand un échéancier contractuel est fourni, il est la source de vérité. Aucune PMT théorique ne l'écrase, en totalité ou ligne à ligne.
- RATIONALE : la banque a raison contre le modèle. C'est la priorité de sources du business plan §6.1.
- EXAMPLE : PMT théorique 279,08 €, mensualité contractuelle 284,72 €. Le système retient 284,72 € et conserve la trace des deux.
- FAILURE MODE : les échéances affichées ne correspondent pas aux prélèvements réels ; l'utilisateur ne peut plus pointer son compte.
- HOW TO TEST : golden case CASE 10 ; vérifier que le paiement retenu est le contractuel.
- OWNER / MODULE : Paul pour la priorité des sources ; Tom pour l'import et la persistance de l'échéancier.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : PARTIAL. au niveau de la mensualité (`contractualPayment` est prioritaire). NON TESTABLE au niveau de l'échéancier ligne à ligne : aucun import n'existe.
- TEST STATUS : PARTIAL. La priorité de la mensualité contractuelle est couverte par `financial.test.ts` ; la priorité ligne à ligne ne l'est pas.

### INV-D-06 · Un seul échéancier fait autorité
- RULE : pour un prêt donné, un seul échéancier est la référence à un instant donné. S'il en existe deux, l'un est explicitement dérivé de l'autre et daté.
- RATIONALE : deux sources non réconciliées divergent tôt ou tard sans que personne ne le remarque.
- EXAMPLE : la table `loan_schedules` et le recalcul client doivent produire les mêmes 60 lignes, ou l'une doit être supprimée.
- FAILURE MODE : la page Dette et l'export ne montrent pas le même échéancier.
- HOW TO TEST : comparer l'échéancier stocké et l'échéancier recalculé, ligne à ligne.
- OWNER / MODULE : Paul pour la règle de source unique ; Tom pour la lecture de `loan_schedules`.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : VIOLATED. par construction. `loan_schedules` est écrite au seed et n'est jamais relue ; `DebtPage` recalcule côté client.
- TEST STATUS : UNCOVERED.

### INV-D-07 · Le remboursement de principal est neutre sur le patrimoine net
- RULE : au moment du paiement, un remboursement de principal diminue simultanément un
  actif (la trésorerie) et un passif (le capital restant dû), du même montant. Il est
  donc **neutre sur le patrimoine net**. L'intérêt, l'assurance et les frais sont les
  seules composantes de l'échéance qui réduisent le patrimoine net.
- RATIONALE : formulation comptable, et non métaphorique. Il n'y a pas de « transfert
  vers le patrimoine net » : les deux jambes de l'écriture s'annulent. Cette précision
  compte pour l'attribution de variation, où le principal remboursé apparaît comme un
  poste à somme nulle entre trésorerie et dette, pas comme un enrichissement.
- EXAMPLE : échéance de 284,72 € à 0 %. Trésorerie -284,72 €, dette -284,72 €,
  `ΔNetWorth` = 0. Échéance de 554,60 € dont 304,60 € de principal et 250,00 €
  d'intérêt : trésorerie -554,60 €, dette -304,60 €, `ΔNetWorth` = -250,00 €.
- FAILURE MODE : deux erreurs symétriques. Compter le principal en dépense fait
  apparaître le désendettement comme un appauvrissement. Le compter en enrichissement
  fait apparaître une création de valeur là où il n'y a qu'un changement de composition
  du bilan.
- HOW TO TEST : golden case CASE 9 ; vérifier `ΔNetWorth = -(intérêt + assurance + frais)`
  sur une échéance, et `ΔNetWorth = 0` sur un prêt à 0 % sans assurance ni frais.
- OWNER / MODULE : Paul, futur moteur d'attribution de variation.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : NOT_APPLICABLE. Aucun moteur d'attribution de variation n'existe.
- TEST STATUS : UNCOVERED. Aucun moteur d'attribution de variation n'existe.

### INV-D-08 · `totalCashOut` porte ses quatre composantes, même nulles
- RULE : chaque `LoanScheduleEntry` expose `interest`, `principal`, `insurance`, `fees`
  et `totalCashOut`, avec `totalCashOut = interest + principal + insurance + fees`. Les
  quatre composantes existent toujours, y compris à zéro. Aucune n'est déduite par
  soustraction à l'affichage.
- RATIONALE : c'est la condition pour que INV-D-02 soit calculable. Un modèle qui ne
  porte pas l'assurance ne peut pas produire un service de dette juste, et l'écart n'est
  pas marginal : un prêt immobilier assuré coûte typiquement 10 à 20 % de plus que la
  somme intérêt plus principal.
- EXAMPLE : échéance de 1 000 € dont 850 € de principal, 120 € d'intérêt, 30 €
  d'assurance, 0 € de frais. `totalCashOut` vaut 1 000 €, et le DSCR se calcule sur
  1 000 €, pas sur 970 €.
- FAILURE MODE : cash-flow surestimé du montant de l'assurance, DSCR surestimé, décision
  d'achat faussée dans le sens favorable.
- HOW TO TEST : golden case avec assurance et frais non nuls ; vérifier l'identité de
  somme et la présence des quatre champs à zéro sur un prêt sans assurance.
- OWNER / MODULE : Tom pour les champs du modèle et la migration ; Paul pour l'identité
  de somme et son test.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : NOT_APPLICABLE. Le modèle n'a ni champ assurance ni champ frais.
- TEST STATUS : UNCOVERED. Le modèle n'a ni champ assurance ni champ frais.

### INV-D-09 · Toutes les dettes sont traitées, pas seulement la première
- RULE : les écrans et calculs de dette itèrent sur l'ensemble des passifs.
- RATIONALE : `Liabilities` somme toutes les dettes ; si l'écran n'en montre qu'une, les deux périmètres divergent.
- EXAMPLE : deux prêts. `metrics.debt` compte les deux, la page Dette n'en amortit qu'un.
- FAILURE MODE : une dette existe dans le patrimoine net et nulle part ailleurs. Le produit plante aussi si la liste est vide.
- HOW TO TEST : jeu à zéro, une et deux dettes.
- OWNER / MODULE : Léo, `pages.tsx:DebtPage`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `const loan = state.liabilities[0]` ; l'accès à `loan.principal` lève une exception si la liste est vide.
- TEST STATUS : UNCOVERED.

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
- IMPLEMENTATION STATUS : VIOLATED. Le code calcule `downPayment + acquisitionCosts + renovation + furniture`, ce qui double-compte les frais quand ils sont financés.
- TEST STATUS : UNCOVERED. Le test existant ne couvre pas le cas `loanAmount` différent de `purchasePrice`.

### INV-E-02 · MOIC = (distributions + valeur résiduelle) / total des contributions
- RULE :

      MOIC = (Σ distributions encaissées + valeur résiduelle à la date d'évaluation)
             / Σ contributions en equity

  Le dénominateur comprend **toutes** les contributions, y compris les apports
  complémentaires postérieurs à l'investissement initial : appels de fonds, comblement
  de cash-flow négatif, CAPEX non financé, refinancement à la charge de l'investisseur.
  Un flux annuel négatif n'est pas une distribution négative : c'est une contribution
  supplémentaire, et il va au dénominateur, pas au numérateur.
- RATIONALE : le MOIC répond à « combien ai-je récupéré pour chaque euro sorti de ma
  poche ». Netter les contributions dans le numérateur, ou les ignorer, répond à une
  autre question et flatte le résultat dans les deux cas. La valeur résiduelle rend le
  multiple interprétable avant la sortie, sur un projet non liquidé.
- EXAMPLE : equity initiale 30 000, flux annuels -3 000 puis -3 000, sortie nette
  +80 000. Contributions totales = 30 000 + 3 000 + 3 000 = 36 000. Distributions =
  80 000. Valeur résiduelle après cession = 0. MOIC = 80 000 / 36 000 = **2,22**.
  Ni 2,47 (contributions nettées au numérateur), ni 2,67 (contributions ignorées).
- FAILURE MODE : multiple optimiste dans les deux variantes fautives, et d'autant plus
  optimiste que le projet consomme de la trésorerie, c'est-à-dire précisément sur les
  projets les plus risqués.
- HOW TO TEST : golden case CASE 13, avec au moins un flux annuel négatif et une valeur
  résiduelle non nulle ; vérifier que le flux négatif augmente le dénominateur et
  n'apparaît pas au numérateur.
- OWNER / MODULE : Paul, `real-estate.ts:87` et `financial.ts:moic`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `totalPositiveFlows` applique `Math.max(0, value)` sur chaque flux.
- TEST STATUS : UNCOVERED.

### INV-E-03 · Le service de dette cesse quand le prêt est remboursé
- RULE : au-delà de la durée du prêt, le service de dette du projet est nul.
- RATIONALE : un horizon de détention supérieur à la durée du prêt est courant. Continuer à décaisser la mensualité fausse les dernières années.
- EXAMPLE : prêt 15 ans, détention 20 ans. Années 16 à 20 : service de dette 0, cash-flow net supérieur.
- FAILURE MODE : TRI sous-estimé sur les projets à long horizon.
- HOW TO TEST : golden case `holdingYears > loanYears`.
- OWNER / MODULE : Paul, `real-estate.ts:64`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `debtService` est une constante annuelle appliquée sur tout l'horizon.
- TEST STATUS : UNCOVERED.

### INV-E-04 · Le coût des travaux et la valeur qu'ils créent sont deux grandeurs séparées
- RULE : le montant des travaux est un **coût certain**, connu, décaissé. La valeur qu'ils
  créent est une **hypothèse distincte**, portée par un champ explicite
  (`postRenovationValue`, ou `valueCreationFromWorks`), avec sa propre provenance et sa
  propre confiance. Aucune équivalence implicite entre les deux : un euro de travaux ne
  vaut pas par construction un euro de valeur créée. L'assiette de la valeur de sortie
  est `postRenovationValue` quand elle est renseignée, le prix d'achat sinon, et le choix
  est visible.
- RATIONALE : capitaliser les travaux 1 pour 1 dans la valeur suppose une création de
  valeur parfaite, ce qui est faux pour l'essentiel des travaux d'entretien et discutable
  même pour une rénovation lourde. Les ignorer suppose une création nulle, ce qui est
  faux dans l'autre sens. Les deux conventions implicites sont des hypothèses fortes
  déguisées en mécanique de calcul. La seule position tenable est de demander l'hypothèse.
- EXAMPLE : prix 200 000, travaux 30 000 (coût certain, ACTUAL une fois les devis
  signés). `postRenovationValue` = 245 000 (USER_ASSUMPTION), soit une valeur créée de
  15 000 pour 30 000 dépensés. La croissance annuelle s'applique à 245 000. Si
  `postRenovationValue` est MISSING, l'assiette est 200 000 et le résultat porte le
  drapeau correspondant.
- FAILURE MODE : capitalisation 1 pour 1 implicite, rentabilité surestimée sur tout
  projet à travaux ; ou assiette au prix d'achat seul, rentabilité sous-estimée. Dans les
  deux cas l'utilisateur ne sait pas quelle hypothèse il a acceptée.
- HOW TO TEST : golden case CASE 13 ; vérifier que le coût des travaux et la valeur créée
  sont deux entrées distinctes, que `postRenovationValue` absent produit un drapeau, et
  qu'aucun chemin de calcul ne dérive l'un de l'autre.
- OWNER / MODULE : Paul, `real-estate.ts:66` et 73.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : VIOLATED. Le code applique la croissance à `purchasePrice` seul, sans le dire. Ce n'est pas faux, c'est non explicité.
- TEST STATUS : UNCOVERED. La règle a été renforcée : le code ne porte aucun champ de valeur créée par les travaux.

### INV-E-05 · Un cash-flow négatif ne produit pas de crédit d'impôt implicite
- RULE : appliquer `(1 - taxRate)` à un flux négatif crée un remboursement fiscal. Ce traitement doit être un choix explicite, pas un effet de bord.
- RATIONALE : le déficit foncier est réel mais plafonné et conditionné. Le modéliser par une multiplication uniforme est faux dans la plupart des cas.
- EXAMPLE : flux -5 000 € avec `taxRate = 0,30` devient -3 500 €, soit 1 500 € d'économie d'impôt supposée acquise.
- FAILURE MODE : projets déficitaires embellis.
- HOW TO TEST : golden case à cash-flow négatif ; vérifier que le flux après impôt n'est pas mécaniquement amélioré.
- OWNER / MODULE : Paul, `real-estate.ts:64`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `(yearNoi - debtService) * (1 - input.taxRate)` s'applique quel que soit le signe.
- TEST STATUS : UNCOVERED.

---

## F. TRANSACTIONS ET TRANSFERTS

### INV-F-01 · Un transfert interne ne crée ni revenu ni dépense
- RULE : un mouvement entre deux comptes du même utilisateur laisse `MonthlyIncome`, `MonthlyExpenses` et `NetWorth` inchangés.
- RATIONALE : c'est le mode de défaillance numéro un des agrégateurs de budget. Chaque virement d'épargne apparaît comme une dépense.
- EXAMPLE : 500 € du compte courant vers le PEA. Cash bancaire -500, cash PEA +500, patrimoine net inchangé, dépenses inchangées, revenus inchangés, performance inchangée.
- FAILURE MODE : le taux d'épargne s'effondre à chaque virement d'épargne ; l'utilisateur croit dépenser ce qu'il épargne.
- HOW TO TEST : golden case CASE 5 ; comparer les métriques avant et après le transfert.
- OWNER / MODULE : Paul pour la neutralité dans les agrégats ; Tom pour le modèle de transfert et les repositories.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : NOT_APPLICABLE. Le modèle `Transaction` n'a qu'un `accountId` : un transfert n'est pas représentable comme une entité unique à deux jambes.
- TEST STATUS : UNCOVERED. Le modèle `Transaction` ne porte qu'un `accountId`.

### INV-F-02 · Les deux jambes d'un transfert sont liées
- RULE : un transfert est une entité unique portant compte source, compte destination, montant et date. Il n'est pas deux transactions indépendantes.
- RATIONALE : deux lignes indépendantes ne peuvent pas être neutralisées de façon fiable dans les agrégats.
- EXAMPLE : `{from: courant, to: pea, amount: 500, date: 2026-09-01}`.
- FAILURE MODE : une jambe est catégorisée en dépense, l'autre en revenu, et le budget est faussé des deux côtés.
- HOW TO TEST : le modèle interdit un transfert sans compte destination.
- OWNER / MODULE : Tom, modèle de données et migration.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : NOT_APPLICABLE.
- TEST STATUS : UNCOVERED.

### INV-F-03 · Une transaction et un solde ne se contredisent pas
- RULE : si une transaction met à jour un solde, le nouveau solde est daté de la transaction et sa provenance est DERIVED, jamais ACTUAL.
- RATIONALE : un solde reconstruit par calcul n'a pas le même statut qu'un solde relevé.
- EXAMPLE : solde relevé 355,48 € ACTUAL ; après une dépense saisie de -45,20 €, solde 310,28 € DERIVED.
- FAILURE MODE : un solde calculé est présenté comme une observation bancaire.
- HOW TO TEST : vérifier la provenance du solde inséré après `add_transaction`.
- OWNER / MODULE : Tom, repositories : provenance du solde dérivé.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : RESPECTED. pour l'adapter local (`kind = 'DERIVED'`, source « Transaction saisie »). À vérifier côté Supabase.
- TEST STATUS : UNCOVERED. Vérifié par lecture pour l'adapter local ; l'adapter Supabase reste à vérifier.

### INV-F-04 · Une catégorisation est révisable sans perte de la donnée d'origine
- RULE : recatégoriser une transaction ne modifie ni son montant, ni sa date, ni son libellé d'origine.
- RATIONALE : la catégorie est une interprétation, le reste est un fait.
- EXAMPLE : « CB CARREFOUR 45,20 » recatégorisé de « Autres » vers « Courses » : seul `categoryId` change.
- FAILURE MODE : perte de la trace bancaire, réconciliation impossible.
- HOW TO TEST : mutation de catégorie ; comparer tous les autres champs.
- OWNER / MODULE : Tom, repositories : mutation de recatégorisation à créer.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : NOT_APPLICABLE. Aucune mutation de recatégorisation n'existe.
- TEST STATUS : UNCOVERED. Aucune mutation de recatégorisation n'existe.

### INV-F-05 · Une récurrence détectée reste une hypothèse
- RULE : une dépense récurrente inférée depuis l'historique porte la provenance DERIVED ou MODEL_ASSUMPTION, jamais ACTUAL.
- RATIONALE : « tu as payé 3 fois 12,99 € » est un fait ; « tu paieras 12,99 € le mois prochain » est une prévision.
- EXAMPLE : abonnement détecté à 12,99 €/mois, provenance MODEL_ASSUMPTION, confiance MEDIUM.
- FAILURE MODE : un budget prévisionnel présenté comme un budget constaté.
- HOW TO TEST : la détection de récurrence n'émet jamais d'ACTUAL.
- OWNER / MODULE : Paul pour la règle de provenance ; Tom pour la détection et sa persistance. Différé.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : NOT_APPLICABLE.
- TEST STATUS : UNCOVERED.

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
- IMPLEMENTATION STATUS : RESPECTED. Les moteurs sont des fonctions pures ; seules les tables `simulation_runs` et `simulation_results` reçoivent des écritures.
- TEST STATUS : PARTIAL. La non-mutation est couverte pour `applyScenarioOverrides` ; la propriété globale ne l'est pas.

### INV-G-02 · Une hypothèse future ne réécrit pas l'historique
- RULE : modifier une hypothèse datée de `T` ne change aucune valeur calculée pour une date antérieure à `T`.
- RATIONALE : condition de reconstruction de n'importe quelle date passée, exigée par le business plan §3.3.
- EXAMPLE : passer l'inflation 2027 de 2 % à 4 % laisse le patrimoine net au 19 août 2026 à -1 173,51 €.
- FAILURE MODE : la clôture d'août 2026 change de valeur en janvier 2027.
- HOW TO TEST : recalcul d'une date passée avant et après édition d'hypothèse ; égalité.
- OWNER / MODULE : Paul.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : RESPECTED. aujourd'hui parce qu'aucun calcul historique daté n'existe. À retester dès qu'un moteur mensuel existera.
- TEST STATUS : UNCOVERED. Aucun calcul historique daté n'existe encore, donc rien à contredire.

### INV-G-03 · Même seed et mêmes inputs produisent le même output
- RULE : `runMonteCarlo(input)` est déterministe à seed fixé.
- RATIONALE : sans reproductibilité, aucune comparaison de scénarios n'a de sens et aucun résultat n'est auditable.
- EXAMPLE : deux exécutions avec seed 19082026, 3 000 simulations, 30 ans, donnent des percentiles identiques au bit près.
- FAILURE MODE : deux clics donnent deux conclusions ; le Decision Lab devient un générateur d'opinions.
- HOW TO TEST : égalité stricte de deux exécutions.
- OWNER / MODULE : Paul, `monte-carlo.ts`.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : RESPECTED. et testé.
- TEST STATUS : COVERED. `monte-carlo.test.ts`, « is exactly reproducible with a seed ».

### INV-G-04 · Ordre des percentiles
- RULE : `P10 ≤ P25 ≤ P50 ≤ P75 ≤ P90` pour chaque année projetée.
- RATIONALE : contrainte structurelle de toute distribution ; sa violation révèle un bug d'interpolation ou de tri.
- EXAMPLE : année 10, P10 8 k€, P25 14 k€, P50 22 k€, P75 34 k€, P90 51 k€.
- FAILURE MODE : bande de confiance inversée, graphique incohérent.
- HOW TO TEST : parcours de tous les points.
- OWNER / MODULE : Paul.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : RESPECTED. et testé.
- TEST STATUS : COVERED. `monte-carlo.test.ts`, « returns ordered percentiles for every year ».

### INV-G-08 · Un choc est daté, il n'est pas indexé sur une année de projection
- RULE : décision canonique. Un choc de scénario est porté par une **date d'effet**
  (`shockDate`) ou par une **période d'effet** (`effectiveFrom`, `effectiveTo`), jamais
  par un entier relatif à l'année 1 de la projection.
- RATIONALE : un entier relatif change de sens dès que la date d'observation bouge. Un
  choc « année 2 » saisi en 2026 désigne 2027 ; le même scénario rejoué en 2028 désigne
  2029, sans que rien n'ait été modifié. Une date est stable, comparable entre scénarios,
  et alignable sur un événement réel du business plan §12.2.
- EXAMPLE : `shockDate = "2029-03-01"`, magnitude -35 %. Le choc tombe à cette date quelle
  que soit la date de lancement de la projection. Le scénario Stress actuel, qui porte
  `shockYear = 2`, désigne aujourd'hui 2027 sans qu'aucun libellé ne l'indique.
- FAILURE MODE : l'utilisateur place un choc à une année qu'il n'a pas voulue, et deux
  projections lancées à des dates différentes ne sont plus comparables.
- HOW TO TEST : même scénario projeté depuis deux dates d'observation distinctes ;
  vérifier que le choc tombe à la même date civile dans les deux runs.
- OWNER / MODULE : Léo pour la sémantique et le libellé ; Paul pour le moteur ; Tom pour
  la migration des colonnes `shock_year` vers `shock_date`.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : VIOLATED. `shockYear` est un entier relatif à l'année 1.
- TEST STATUS : UNCOVERED.

### INV-G-05 · Le seed par défaut a une seule source
- RULE : la valeur par défaut du seed est définie une fois et importée partout.
- RATIONALE : trois définitions divergentes rendent les runs incomparables sans que rien ne le signale.
- EXAMPLE : `19082026` défini dans une constante partagée, référencée par la route API, `app-shell.tsx` et `ScenariosPage`.
- FAILURE MODE : deux exécutions apparemment identiques ne le sont pas.
- HOW TO TEST : recherche statique du littéral ; une seule occurrence attendue.
- OWNER / MODULE : Paul.
- SEVERITY : LOW.
- IMPLEMENTATION STATUS : VIOLATED. Trois occurrences du littéral.
- TEST STATUS : UNCOVERED. Trois occurrences du littéral.

### INV-G-06 · Une projection déclare son périmètre et son unité
- RULE : une trajectoire indique si elle porte sur le brut ou le net, en nominal ou en réel, et si la dette y est incluse.
- RATIONALE : afficher une trajectoire de patrimoine brut croissante à côté d'un patrimoine net négatif est trompeur.
- EXAMPLE : « Patrimoine brut projeté, nominal, hors amortissement de la dette ».
- FAILURE MODE : l'utilisateur lit une trajectoire de richesse là où le système projette un agrégat partiel.
- HOW TO TEST : checklist d'acceptance sur les libellés de graphique.
- OWNER / MODULE : Léo.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : PARTIAL. Le titre dit « Patrimoine brut projeté » et la légende distingue nominal et réel. L'exclusion de la dette n'est pas dite.
- TEST STATUS : UNCOVERED.

### INV-G-07 · La projection déterministe consomme le même moteur mensuel que le Monte-Carlo
- RULE : décision canonique. La projection déterministe est **conservée** : elle a une
  valeur d'explicabilité que la distribution n'a pas. Elle doit consommer le **même
  moteur de bilan mensuel** que le Monte-Carlo, exécuté à volatilité nulle et sans
  stress. Conséquence vérifiable : à volatilité 0 et probabilité de stress 0, la
  trajectoire déterministe et le P50 coïncident exactement.
- RATIONALE : deux implémentations parallèles de la même trajectoire divergent toujours.
  Ici l'une capitalise annuellement et ajoute l'épargne en fin d'année, l'autre capitalise
  mensuellement et l'ajoute chaque mois : elles ne peuvent pas coïncider. Un moteur unique
  supprime la question de la réconciliation au lieu de la documenter.
- EXAMPLE : scénario à 5 % de rendement, 400 € d'épargne mensuelle, volatilité 0.
  Trajectoire déterministe et P50 identiques à la tolérance monétaire près, année par
  année.
- FAILURE MODE : le cockpit et la page Scénarios ne racontent pas la même histoire, à
  deux clics d'écart, sans qu'aucun texte ne l'explique.
- HOW TO TEST : exécuter les deux sorties du moteur unique à volatilité nulle et comparer
  point à point.
- OWNER / MODULE : Paul.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : VIOLATED. Pas rapproché : le déterministe capitalise annuellement et ajoute l'épargne en fin d'année, le Monte-Carlo capitalise mensuellement et ajoute l'épargne chaque mois.
- TEST STATUS : UNCOVERED. Les deux moteurs n'ont jamais été comparés à volatilité nulle.

---

## H. PROVENANCE

### INV-H-01 · Toute valeur significative porte une provenance
- RULE : chaque donnée affichée porte un type parmi ACTUAL, USER_ASSUMPTION, MODEL_ASSUMPTION, EXTERNAL_DATA, DERIVED, MISSING.
- RATIONALE : c'est la promesse centrale du produit face à Finary.
- EXAMPLE : solde 355,48 € ACTUAL, rendement 5,5 % MODEL_ASSUMPTION, patrimoine net DERIVED.
- FAILURE MODE : l'utilisateur ne distingue plus ce qu'il possède de ce qu'il suppose.
- HOW TO TEST : checklist par écran.
- OWNER / MODULE : Léo pour la règle produit ; Paul pour la propagation vers les agrégats ; Tom pour les colonnes de provenance.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : PARTIAL. au niveau des entités. VIOLÉ au niveau des agrégats : `DashboardMetrics` ne porte aucune provenance ; `netWorth` est affiché sans badge.
- TEST STATUS : UNCOVERED.

### INV-H-02 · Une donnée manquante reste MISSING
- RULE : une valeur absente n'est jamais remplacée par 0, par une moyenne ou par une estimation implicite.
- RATIONALE : un zéro implicite est indiscernable d'un zéro réel.
- EXAMPLE : électricité non renseignée reste MISSING ; elle ne contribue pas 0 € au budget, elle ne contribue pas du tout, et le budget est marqué incomplet.
- FAILURE MODE : dépenses sous-estimées, taux d'épargne surestimé.
- HOW TO TEST : jeu avec catégories nulles ; vérifier l'exclusion du total et la présence du drapeau.
- OWNER / MODULE : Paul.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : RESPECTED. `monthlyExpenses` filtre sur `monthlyAmount !== null`. Point fort du produit.
- TEST STATUS : COVERED. `shared.test.ts`, exclusion des montants nuls du total.

### INV-H-03 · La confiance d'un dérivé est bornée par celle de ses inputs
- RULE : `confidence(DERIVED) ≤ min(confidence(inputs))`.
- RATIONALE : un calcul n'améliore jamais la qualité de ses entrées.
- EXAMPLE : patrimoine net dérivé de soldes HIGH et d'une dette HIGH : HIGH. Cash-flow dérivé d'un budget à 5 % de complétude : LOW, quelle que soit la qualité du revenu.
- FAILURE MODE : un chiffre fragile est présenté avec la même assurance qu'un chiffre observé.
- HOW TO TEST : propriété sur des jeux à confiance mixte.
- OWNER / MODULE : Paul.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. Aucune propagation n'existe.
- TEST STATUS : UNCOVERED.

### INV-H-04 · Une saisie utilisateur n'est pas une vérification
- RULE : éditer une valeur ne fait pas passer automatiquement sa confiance à HIGH. La confiance est un attribut à part, éventuellement saisi.
- RATIONALE : l'utilisateur qui déplace un curseur de rendement de 5,5 % à 8 % n'a rien vérifié.
- EXAMPLE : après édition, provenance USER_ASSUMPTION et confiance inchangée ou demandée.
- FAILURE MODE : le registre des hypothèses affiche « confiance élevée » sur des chiffres inventés.
- HOW TO TEST : vérifier la confiance après `update_scenario` et `update_expense`.
- OWNER / MODULE : Léo pour la règle ; Tom pour les mutations, qui vivent dans les repositories.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : VIOLATED. `update_scenario` et `update_expense` forcent `confidence = 'HIGH'`.
- TEST STATUS : UNCOVERED.

### INV-H-05 · Une source externe n'écrase pas une correction manuelle
- RULE : un import (API, CSV, document) qui contredit une valeur corrigée manuellement produit un conflit à arbitrer, jamais une écriture silencieuse.
- RATIONALE : sinon chaque synchronisation efface le travail de l'utilisateur, et il cesse de corriger.
- EXAMPLE : solde corrigé à 355,48 € le 19 août ; import bancaire annonçant 340,00 € au 18 août : conflit présenté, correction conservée.
- FAILURE MODE : perte de données utilisateur, invisible.
- HOW TO TEST : golden case conflit ; vérifier qu'aucune écriture n'a lieu sans résolution.
- OWNER / MODULE : Tom, imports externes et mécanisme de conflit. Différé.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : NOT_APPLICABLE. Aucun import externe n'existe.
- TEST STATUS : UNCOVERED. Aucun import externe n'existe.

### INV-H-06 · Une règle fiscale porte une période d'effet
- RULE : toute règle fiscale porte juridiction, année, période d'effet, source et date de vérification. Une règle sans ces attributs n'est pas appliquée.
- RATIONALE : une règle appliquée hors de sa période produit un résultat faux avec l'apparence de la rigueur.
- EXAMPLE : barème 2026 appliqué à un revenu 2026 seulement ; barème 2027 coexistant sans réécrire 2026.
- FAILURE MODE : recalcul d'un passé fiscal avec des règles futures.
- HOW TO TEST : deux règles pour deux années ; vérifier la sélection par date.
- OWNER / MODULE : Paul, `tax.ts`.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : PARTIAL. structurellement (`DatedTaxRule` porte ces champs) et prudent en pratique (aucune règle réelle chargée, statut MISSING assumé). Réserve : `socialContributionsRate` du type n'est pas utilisé par `employmentCompensation`, ce qui crée deux sources pour les cotisations.
- TEST STATUS : PARTIAL. `tax.test.ts` couvre le barème sur une règle fictive, pas la sélection par période d'effet.

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
- IMPLEMENTATION STATUS : VIOLATED. `deriveMetrics` somme `account.balance` sans lire `account.currency`. Le formulaire d'ajout accepte n'importe quel code de 3 lettres.
- TEST STATUS : UNCOVERED.

### INV-I-02 · Un taux de change est daté et sourcé
- RULE : tout taux porte une date d'observation et une source. Un taux non daté n'est pas utilisable.
- RATIONALE : sans date, impossible de reconstruire un bilan passé ni d'attribuer la performance de change.
- EXAMPLE : `{pair: "USD/EUR", rate: 0.92, date: "2026-08-19", source: "BCE"}`.
- FAILURE MODE : le patrimoine du mois dernier change quand le taux du jour change.
- HOW TO TEST : le modèle refuse un taux sans date.
- OWNER / MODULE : Tom pour la table `currency_rates` et son alimentation ; Paul pour la signature datée de la conversion.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. en pratique. La table existe dans le schéma, elle n'est jamais alimentée ni lue ; `fxConvert(amount, eurPerUnit)` ne prend pas de date.
- TEST STATUS : PARTIAL. `fxConvert` est testé isolément, sans date ni source.

### INV-I-03 · Un taux manquant produit un MISSING, pas un taux de 1
- RULE : en l'absence de taux pour une devise et une date, la valeur est marquée MISSING et l'agrégat est marqué incomplet.
- RATIONALE : appliquer 1 par défaut est le pire des choix : plausible et faux.
- EXAMPLE : compte CHF sans taux : exclu de `GrossAssets`, drapeau « 1 compte non converti ».
- FAILURE MODE : conversion implicite à parité.
- HOW TO TEST : jeu avec une devise sans taux.
- OWNER / MODULE : Paul.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : VIOLATED. par le même mécanisme que INV-I-01.
- TEST STATUS : UNCOVERED.

### INV-I-04 · La performance de change est séparée de la performance de marché
- RULE : pour une position en devise étrangère, la variation de valeur en devise de reporting se décompose en effet prix et effet change.
- RATIONALE : sans cette séparation, l'utilisateur attribue à son choix de titre ce qui vient de l'euro.
- EXAMPLE : position 100 USD passant de 10 à 11 USD avec un taux passant de 0,92 à 0,88 : +10 % en USD, +5,2 % en EUR, dont -4,3 % d'effet change.
- FAILURE MODE : attribution de performance fausse.
- HOW TO TEST : golden case CASE 4 avec variation simultanée du prix et du taux.
- OWNER / MODULE : Paul, futur Portfolio Engine.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : NOT_APPLICABLE. aujourd'hui, aucune performance n'étant calculée.
- TEST STATUS : UNCOVERED. Aucune performance n'est calculée.

---

## J. MONTHLY CLOSE

### INV-J-01 · Une clôture se rouvre explicitement et se version, elle ne s'écrase jamais
- RULE : décision canonique, option « réouverture explicite avec versionnage ». Une
  clôture existante ne peut pas être remplacée par une nouvelle clôture. Elle doit
  d'abord être **rouverte** par une opération explicite, distincte, tracée (auteur, date,
  motif). La nouvelle clôture crée alors une **version supplémentaire** ; **toutes les
  versions antérieures sont conservées**, aucune n'est supprimée ni modifiée. La version
  courante est désignée, les autres restent consultables.
- RATIONALE : le refus strict a été écarté parce qu'il est intenable en pratique : une
  correction de solde postérieure à une clôture est un cas normal, pas une anomalie.
  Interdire la reclôture pousserait à ne pas corriger. Le versionnage autorise la
  correction tout en conservant ce que le système affirmait à chaque instant, ce qui est
  la propriété réellement recherchée.
- EXAMPLE : clôture d'août 2026 à -1 173,51 €, version 1. Un relevé arrive en septembre
  et corrige un solde. Réouverture tracée, nouvelle clôture version 2 à -1 168,20 €. La
  version 1 reste lisible, avec sa date et le motif de réouverture.
- FAILURE MODE : sans versionnage, perte définitive d'un point d'historique patrimonial,
  sans aucune trace. Avec refus strict, l'utilisateur cesse de corriger ses données.
- HOW TO TEST : clôture, puis reclôture sans réouverture, qui doit être refusée ; puis
  réouverture tracée et reclôture, qui doit produire deux versions consultables.
- OWNER / MODULE : Tom pour le modèle de versionnage, les repositories et la contrainte
  d'unicité ; Léo pour la sémantique de la réouverture.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : VIOLATED. `INSERT OR REPLACE` côté SQLite, upsert côté Supabase : la ligne précédente est perdue.
- TEST STATUS : UNCOVERED. Aucun test de mutation de clôture.

### INV-J-02 · Une clôture fige tout le périmètre, pas seulement le net
- RULE : une clôture enregistre soldes, positions, dettes, revenus, dépenses et allocation, pas seulement trois agrégats.
- RATIONALE : sans le détail, aucune attribution de variation n'est possible a posteriori.
- EXAMPLE : clôture d'août contenant les 6 soldes de compte, les 3 positions et le passif.
- FAILURE MODE : impossible de répondre à « pourquoi mon patrimoine a changé ».
- HOW TO TEST : la clôture restitue le détail suffisant à recalculer les agrégats.
- OWNER / MODULE : Tom pour le périmètre figé et le schéma de clôture ; Paul pour les grandeurs financières à conserver.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `monthly_closes` ne stocke que `grossAssets`, `debt`, `netWorth`, `forecastNetWorth`, `variance`.
- TEST STATUS : UNCOVERED.

### INV-J-03 · `forecast_net_worth` contient une vraie prévision future
- RULE : décision canonique. `forecast_net_worth` contient la valeur **projetée pour ce
  mois, produite avant ce mois**, par le moteur de projection, avec la trace du scénario
  et de la version utilisés. Il ne contient jamais le patrimoine net de la clôture
  précédente. La variation entre deux clôtures est une grandeur distincte, qui porte son
  propre nom.
- RATIONALE : « écart réel contre prévu » mesure la capacité à tenir un plan.
  « variation contre mois précédent » mesure un mouvement. Les deux sont utiles, ce sont
  deux analyses différentes, et le champ ne peut pas porter les deux.
- EXAMPLE : fin août, la projection annonce -1 050 € pour septembre. Fin septembre, le
  constat est -1 100 €. `forecast_net_worth` vaut -1 050 €, `variance` vaut -50 €, et la
  variation contre la clôture d'août est calculée à part.
- FAILURE MODE : l'utilisateur croit mesurer sa discipline d'exécution alors qu'il mesure
  une variation, et le rituel mensuel perd ce qui en fait un différenciant.
- HOW TO TEST : le champ est alimenté par la projection et non par la clôture précédente ;
  une clôture sans projection préalable laisse le champ MISSING plutôt que de le remplir
  par défaut.
- OWNER / MODULE : Léo pour la sémantique cible ; Paul pour la source de la prévision ;
  Tom pour la colonne et sa migration.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `forecast = prior?.netWorth ?? null`, et l'interface promet « Écart réel vs prévu ».
- TEST STATUS : UNCOVERED.

### INV-J-04 · Une clôture est idempotente ou refusée
- RULE : la même opération de clôture répétée produit soit exactement le même état, soit un refus. Jamais un état différent.
- RATIONALE : une clôture non idempotente rend l'historique dépendant du nombre de clics.
- EXAMPLE : deux clics sur « Clôturer le mois » : une seule ligne dans `monthly_closes`, une seule dans `net_worth_snapshots`.
- FAILURE MODE : doublons de snapshots, variance calculée contre soi-même.
- HOW TO TEST : double appel ; compter les lignes.
- OWNER / MODULE : Tom, idempotence et contrainte d'unicité dans les repositories.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : PARTIAL. `monthly_closes` est upserté donc idempotent en cardinalité, mais `net_worth_snapshots` reçoit une insertion à chaque appel : deux clics créent deux snapshots.
- TEST STATUS : UNCOVERED.

---

## K. INTÉGRITÉ HISTORIQUE

### INV-K-01 · Une mise à jour de solde crée une observation, elle n'en modifie pas une
- RULE : corriger un solde insère une nouvelle ligne datée. L'ancienne reste.
- RATIONALE : permet de reconstruire n'importe quelle date passée et de tracer les corrections.
- EXAMPLE : solde 355,48 € au 19 août, puis 402,10 € au 25 août : deux lignes, pas une mise à jour.
- FAILURE MODE : impossible de savoir ce que le système affichait à une date donnée.
- HOW TO TEST : compter les lignes de `account_balances` après deux mises à jour.
- OWNER / MODULE : Tom, repositories : insertion plutôt que mise à jour.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : RESPECTED. `update_account` fait un INSERT ; la lecture prend le plus récent par `balance_date` puis `created_at`.
- TEST STATUS : UNCOVERED. Vérifié par lecture, non couvert par un test de mutation.

### INV-K-02 · La date d'une observation est la date de l'observation
- RULE : la date portée par une donnée est celle de l'événement, pas celle de la saisie.
- RATIONALE : sinon toutes les données s'agglutinent à la date d'import et l'historique est faux.
- EXAMPLE : un solde relevé au 31 juillet et saisi le 19 août porte la date du 31 juillet.
- FAILURE MODE : historique compressé sur les dates de saisie.
- HOW TO TEST : saisir une donnée avec une date antérieure et vérifier son classement.
- OWNER / MODULE : Tom, repositories : date d'effet réelle plutôt que constante.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : PARTIAL. partiellement. `add_account` et `update_expense` écrivent `effective_date = AS_OF_DATE`, une constante figée au 19 août 2026, quelle que soit la date réelle.
- TEST STATUS : UNCOVERED.

### INV-K-03 · Une version de scénario est immuable
- RULE : une version archivée d'un scénario n'est jamais modifiée ni supprimée.
- RATIONALE : permet de rejouer une décision passée avec les hypothèses de l'époque.
- EXAMPLE : scénario Central version 1 conservé après passage en version 2.
- FAILURE MODE : impossible d'expliquer pourquoi une décision a été prise.
- HOW TO TEST : modifier deux fois, vérifier trois lignes dans `scenario_versions`.
- OWNER / MODULE : Tom, repositories et table `scenario_versions`.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : RESPECTED. `update_scenario` incrémente et archive le payload complet.
- TEST STATUS : UNCOVERED. Vérifié par lecture.

### INV-K-04 · Une simulation persistée conserve ses paramètres
- RULE : un run de simulation stocke seed, nombre de simulations, horizon, scénario et méthodologie, suffisamment pour être rejoué à l'identique.
- RATIONALE : une distribution sans ses paramètres n'est pas auditable.
- EXAMPLE : run persisté avec seed 19082026, 3 000 simulations, 30 ans, `scn_central`.
- FAILURE MODE : impossible de reproduire un graphique montré la semaine précédente.
- HOW TO TEST : rejouer un run depuis ses paramètres stockés ; égalité des percentiles.
- OWNER / MODULE : Tom, repositories et tables `simulation_runs` et `simulation_results`.
- SEVERITY : LOW.
- IMPLEMENTATION STATUS : RESPECTED. dans le modèle. NON TESTABLE en pratique : aucun écran ne relit un run passé.
- TEST STATUS : UNCOVERED. Le modèle porte les paramètres ; aucun écran ni test ne rejoue un run.

---

## L. RÉCONCILIATION

### INV-L-01 · Un écart de réconciliation reste ouvert tant qu'il n'est pas expliqué
- RULE : un écart au-delà de la tolérance produit un état persistant RECONCILIATION_REQUIRED, avec son montant, sa date et sa cause présumée.
- RATIONALE : la doctrine LFO interdit de faire disparaître un avertissement en inventant une donnée.
- EXAMPLE : PEA, écart 0,56 € au 19 août 2026, cause présumée : arrondi de valorisation ou position non listée.
- FAILURE MODE : l'écart est oublié, puis absorbé dans un futur import.
- HOW TO TEST : l'état existe comme donnée, pas comme texte d'interface.
- OWNER / MODULE : Léo pour la spécification ; Paul pour le calcul de l'écart ; Tom pour l'état persisté.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : PARTIAL. Les deux écarts (0,56 € PEA, 338,20 € prêt) sont exposés en alertes et en callouts, ce qui est honnête. Mais ce sont des lignes `alerts` seedées et un calcul d'interface, pas un état de réconciliation attaché à l'entité.
- TEST STATUS : UNCOVERED.

### INV-L-02 · Un écart ne crée jamais une position ni une ligne d'ajustement fictive
- RULE : aucun « plug » n'est créé pour faire tomber un écart à zéro.
- RATIONALE : un ajustement de bouclage est indiscernable d'une donnée réelle six mois plus tard.
- EXAMPLE : l'écart PEA de 0,56 € ne devient pas une position « divers 0,56 € ».
- FAILURE MODE : le bilan boucle et ment.
- HOW TO TEST : compter les positions avant et après détection d'écart.
- OWNER / MODULE : Paul.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : RESPECTED. Le callout dit explicitement « sans créer de position fictive ».
- TEST STATUS : UNCOVERED.

### INV-L-03 · Le total déclaré reste la valeur comptable
- RULE : en cas d'écart entre le solde déclaré d'un compte et la somme de ses positions, le solde déclaré fait autorité pour le bilan.
- RATIONALE : convention LFO, cohérente avec INV-A-04.
- EXAMPLE : PEA compte pour 15 003,13 € au bilan, pas 15 002,57 €.
- FAILURE MODE : le bilan change selon la complétude du détail des positions.
- HOW TO TEST : ajouter une position et vérifier `GrossAssets` inchangé.
- OWNER / MODULE : Paul.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : RESPECTED.
- TEST STATUS : PARTIAL. Couvert indirectement par le test de non-double-comptage.

### INV-L-04 · La tolérance de réconciliation est déclarée par domaine
- RULE : chaque contrôle de réconciliation porte une tolérance explicite, adaptée au domaine.
- RATIONALE : 0,01 € est raisonnable sur un compte titres, absurde sur une valorisation immobilière.
- EXAMPLE : comptes 0,01 € ; échéancier de prêt 0,01 € ; valorisation immobilière 1 % ou 1 000 €.
- FAILURE MODE : soit des alertes permanentes ignorées, soit des écarts réels invisibles.
- HOW TO TEST : la tolérance est un paramètre, pas un littéral dans un `if`.
- OWNER / MODULE : Paul, Léo.
- SEVERITY : MEDIUM.
- IMPLEMENTATION STATUS : NOT_APPLICABLE. Une seule tolérance existe, écrite en dur : `Math.abs(peaGap) > 0.01`.
- TEST STATUS : UNCOVERED. Une seule tolérance existe, écrite en dur.

---

## M. COMPLÉTUDE

### INV-M-01 · Complétude, confiance et incertitude de modèle sont trois axes distincts
- RULE : trois grandeurs orthogonales, jamais fusionnées en un indicateur unique.

  | Axe | Question | Porte sur | Exemple de valeur |
  |---|---|---|---|
  | COMPLETENESS | ai-je toutes les données nécessaires ? | la **couverture des inputs** | 3 charges renseignées sur 5 |
  | CONFIDENCE / DATA QUALITY | les données que j'ai sont-elles fiables ? | la **qualité des inputs présents** | solde relevé HIGH, loyer déclaré MEDIUM |
  | MODEL UNCERTAINTY | le modèle est-il adapté à la question ? | la **structure du calcul** | vacance appliquée au loyer initial seulement |

  Un résultat peut être complet à 100 %, de confiance HIGH, et porter une incertitude de
  modèle élevée. L'inverse est vrai aussi : un modèle exact appliqué à des données
  partielles reste inexploitable.
- RATIONALE : les fusionner produit un indicateur qui ne dit ni ce qui manque, ni ce qui
  est douteux, ni ce qui est simplifié, et qui ne permet donc aucune action corrective
  ciblée. Un utilisateur qui voit « fiabilité 60 % » ne sait pas s'il doit saisir une
  donnée, vérifier un relevé, ou se méfier de la formule.
- EXAMPLE : TRI immobilier. COMPLETENESS 60 % (taxe foncière et CAPEX manquants).
  CONFIDENCE MEDIUM (les charges connues viennent d'une estimation, pas d'un avis).
  MODEL UNCERTAINTY élevée (charges constantes sur 10 ans, vacance non indexée, taux
  d'imposition effectif unique). Trois actions différentes : obtenir un avis de taxe
  foncière, sourcer les charges, ou changer de modèle.
- FAILURE MODE : un score unique masque celui des trois axes qui est le plus dégradé, et
  oriente l'utilisateur vers la mauvaise correction.
- HOW TO TEST : tout résultat expose les trois axes séparément ; aucun n'est dérivé des
  deux autres.
- OWNER / MODULE : Léo pour la sémantique des trois axes ; Paul pour leur calcul et leur
  propagation.
- SEVERITY : BLOCKER.
- IMPLEMENTATION STATUS : VIOLATED. au sens structuré. Des callouts textuels existent sur plusieurs pages, ce qui est un bon début, mais aucun résultat ne porte de complétude comme donnée.
- TEST STATUS : UNCOVERED. La règle a été renforcée : les trois axes n'existent ni séparément ni ensemble.

### INV-M-02 · La complétude se mesure par calcul, pas globalement
- RULE : la complétude est un attribut du résultat calculé, pas un score unique d'application. La même règle vaut pour les deux autres axes de INV-M-01.
- RATIONALE : le patrimoine net est complet à 100 % sur son périmètre, le cash-flow à 5 %. Un score global moyennerait les deux et n'aiderait personne.
- EXAMPLE : Net Worth 100 %, Cash Flow 5 %, Couverture de liquidité 13 %, Performance : non calculable.
- FAILURE MODE : un score unique rassure sur les zones fiables et masque les zones creuses.
- HOW TO TEST : chaque métrique expose sa propre complétude.
- OWNER / MODULE : Léo.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. `DashboardMetrics.dataCompleteness` est unique et ne mesure en réalité que le budget.
- TEST STATUS : UNCOVERED.

### INV-M-03 · La précision affichée est bornée par les trois axes, pas par la seule complétude
- RULE : le nombre de décimales affichées est borné par **le plus dégradé des trois axes**
  de INV-M-01, jamais par la complétude seule.

      displayPrecision = min( précision autorisée par COMPLETENESS,
                              précision autorisée par CONFIDENCE,
                              précision autorisée par MODEL UNCERTAINTY )

  Une complétude de 100 % n'autorise donc pas deux décimales si le modèle est grossier ou
  si les inputs sont de confiance faible.
- RATIONALE : lier mécaniquement la précision au seul score de complétude produit
  exactement la fausse précision que la règle cherche à éviter. Un underwriting dont
  toutes les entrées sont renseignées mais toutes hypothétiques serait affiché à deux
  décimales alors que c'est le cas où la précision est la moins justifiée.
- EXAMPLE : underwriting immobilier dont les seize entrées sont renseignées, donc
  COMPLETENESS 100 %, mais toutes USER_ASSUMPTION, donc CONFIDENCE LOW, et modèle à
  charges constantes, donc MODEL UNCERTAINTY élevée. TRI affiché « environ 8 % », pas
  « 8,43 % ».
- FAILURE MODE : l'utilisateur arbitre entre deux projets sur une différence de 0,2 % de
  TRI qui n'a aucun sens, parce que l'affichage lui a signalé une précision que le modèle
  n'a pas.
- HOW TO TEST : jeu à complétude 100 % et confiance LOW ; vérifier que la précision est
  dégradée malgré la complétude parfaite.
- OWNER / MODULE : Léo pour la règle de restitution ; Paul pour la borne issue des axes.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. Le TRI immobilier est affiché à une décimale de pourcentage, le MOIC à deux décimales, le DSCR à deux décimales, sur un modèle dont toutes les entrées sont des USER_ASSUMPTION par défaut.
- TEST STATUS : UNCOVERED.

### INV-M-04 · Une donnée indispensable manquante bloque l'affichage du résultat
- RULE : certains inputs sont indispensables. En leur absence, le résultat n'est pas affiché sous forme numérique : il affiche « non calculable » et la donnée requise.
- RATIONALE : mieux vaut un vide explicite qu'un nombre indéfendable.
- EXAMPLE : « FI ratio : non calculable, dépenses cibles manquantes ».
- FAILURE MODE : un chiffre produit par convention est lu comme un résultat.
- HOW TO TEST : jeu sans input indispensable ; vérifier l'état « non calculable ».
- OWNER / MODULE : Léo, Paul.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : PARTIAL. La page Goals affiche « Non calculable » pour le FI ratio et le Freedom Coverage, ce qui est exemplaire. La page Investments affiche « +77,71 % » là où le même raisonnement imposerait « non calculable ».
- TEST STATUS : UNCOVERED.

### INV-M-05 · L'incertitude de modèle est déclarée par le modèle, pas déduite des données
- RULE : tout moteur déclare explicitement ses simplifications structurantes, sous forme
  de liste attachée au résultat. Cette liste ne se calcule pas depuis les données : elle
  est écrite par le propriétaire du calcul, révisée à chaque modification de formule, et
  affichée dans le panneau d'explication.
- RATIONALE : c'est le seul des trois axes de INV-M-01 qu'aucune donnée ne peut révéler.
  Un moteur qui applique la vacance au loyer initial seulement produira des résultats
  parfaitement cohérents et silencieusement faux sur un horizon long. Seul l'auteur du
  moteur sait que la simplification existe.
- EXAMPLE : le Monte-Carlo doit déclarer cinq simplifications : la dette n'est pas
  amortie dans la projection, l'épargne est constante et sans lien avec le cash-flow
  constaté, l'amplitude du stress est fixe, l'inflation n'entre pas dans les percentiles,
  `salaryGrowth` n'est pas consommé. Aucune n'est visible dans les données.
- FAILURE MODE : un résultat complet, de confiance élevée, structurellement inadapté à la
  question posée, et rien ne le signale.
- HOW TO TEST : chaque moteur expose une liste non vide ou une déclaration explicite
  d'absence de simplification ; revue à chaque modification de formule.
- OWNER / MODULE : Paul pour les moteurs financiers ; Léo pour la restitution.
- SEVERITY : HIGH.
- IMPLEMENTATION STATUS : VIOLATED. Seul le Monte-Carlo porte une chaîne de méthodologie,
  qui décrit la méthode et non ses limites.
- TEST STATUS : UNCOVERED.

---

## Points à soumettre à la review Checkpoint 2

1. INV-D-02 : le service de dette pendant un différé est-il 0 ou la mensualité contractuelle ? Trois définitions coexistent dans le produit aujourd'hui.
2. INV-A-02 : quelle règle d'arrondi monétaire canonique, et à quelle couche ?
3. INV-A-06 : convention actif ou passif pour un solde bancaire débiteur.
4. INV-E-04 : assiette de la valeur de sortie immobilière, avec ou sans travaux capitalisés.
5. INV-J-03 : renommer `forecast_net_worth` ou le brancher sur la projection.
6. INV-M-02 : complétude par métrique plutôt que globale, confirmer le principe avant de spécifier.
7. Manque-t-il une catégorie entière ? Candidats écartés faute de périmètre : fiscalité des enveloppes, cap table et dilution, événements de vie.

Les points suivants ont été tranchés au Checkpoint GPT-5.6 Sol et ne sont plus ouverts :
convention de bilan brute pour l'immobilier (INV-A-07), formule du MOIC (INV-E-02),
définition du service de dette par `totalCashOut` (INV-D-02), séparation des trois
grandeurs de liquidité (INV-B-06), taux d'épargne et d'investissement non calculables
tant que le ledger n'existe pas (INV-B-07), séparation complétude, confiance et
incertitude de modèle (INV-M-01), arrondi à la restitution et au contrat (INV-A-02),
solde débiteur en passif court terme (INV-A-06), `forecast_net_worth` comme vraie
prévision (INV-J-03), projection déterministe sur le moteur mensuel commun (INV-G-07),
choc daté (INV-G-08), libellé « Actifs financiers identifiés » (INV-A-05), séparation du
coût des travaux et de la valeur créée (INV-E-04), réouverture explicite et versionnage
des clôtures (INV-J-01).
