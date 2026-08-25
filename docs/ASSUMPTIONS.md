# Hypothèses et réconciliations

Date zéro : **19 août 2026**. Devise de reporting : **EUR**.

## Contrat Canonical Balance Sheet V2

- **Gross Assets** = somme des contributions `ASSET` primaires, positives et converties. Un solde négatif n'y entre jamais.
- **Total Liabilities** = dettes contractuelles personnelles + découverts de comptes + autres passifs personnels canoniques.
- **Net Worth** = Gross Assets − Total Liabilities.
- **Immediate Cash** = soldes positifs des comptes bancaires/livrets classés `IMMEDIATE`. Le cash interne d'une enveloppe reste séparé.
- **Liquid Assets** = actifs dont la classification explicite n'est pas `ILLIQUID`; **Liquid Net Worth** = Liquid Assets − Total Liabilities.
- **Net Financial Debt** = passifs financiers personnels − Immediate Cash.
- Les soldes de comptes sont la source comptable primaire. Les positions expliquent composition et exposition, mais ne s'ajoutent jamais au solde.
- `ProductiveAssets` représente les positions de marché réconciliées. `ProductiveNetWorth` reste `NOT_COMPUTABLE` tant que les passifs ne sont pas attribués à des actifs précis.

### FX et qualité

La convention est `rate(base, quote) = unités de quote pour une unité de base`; la conversion multiplie donc la valeur native par ce taux. Le moteur choisit le dernier taux daté `rateDate <= valuationDate`, inverse une paire opposée avec provenance `DERIVED`, et utilise une identité `1` également `DERIVED` pour une même devise. Un taux vieux de 0 à 3 jours calendaires est accepté; au-delà il reste calculable mais porte `STALE_FX`. Sans taux admissible, l'agrégat devient `PARTIAL` ou `NOT_COMPUTABLE` et conserve seulement `knownValue`; aucune parité 1:1 n'est inventée. Aucun arrondi intermédiaire n'est appliqué.

Une contribution porte sa date, sa méthode (`OBSERVED_BALANCE`, `MARKET_VALUE`, `EXTERNAL_VALUATION`, `USER_ESTIMATE`, `MODEL_ESTIMATE`, `PURCHASE_PRICE`, `COST_BASIS`), sa provenance, sa confiance et son statut de réconciliation. Prix d'achat et coût de revient ne sont jamais assimilés automatiquement à une valeur courante.

### Exposition par enveloppe

L'exposition est établie **enveloppe par enveloppe**, jamais sur un portefeuille global. Chaque
compte d'investissement porte sa propre qualité de réconciliation, et une enveloppe incohérente
ne dit rien des autres :

- composition ≤ valeur comptable et conversions disponibles → l'exposition de marché et le cash
  d'enveloppe sont connus ; le reliquat éventuel est porté **sans exposition** ;
- composition > valeur comptable (`OVER_EXPLAINED`), ou conversion manquante (`MISSING`) →
  **aucune** exposition n'est attribuée à cette enveloppe, sa valeur comptable reste entière dans
  la poche sans exposition connue, et les autres enveloppes conservent la leur.

Exemple : un PEA de 50 000 € parfaitement réconcilié et un CTO de 2 000 € `OVER_EXPLAINED`
donnent 50 000 € d'exposition connue et projetée, 2 000 € de valeur comptable sans exposition, et
zéro euro inventé au CTO. Le portefeuille global n'est jamais ramené à zéro parce qu'une seule
enveloppe est en défaut. Les écarts de réconciliation sont conservés et signalés
(`POSITION_OVER_EXPLAINED`, `ENVELOPE_EXPOSURE_UNKNOWN`, `POSITION_OUTSIDE_ENVELOPE`).

Une position logée hors enveloppe d'investissement (compte bancaire, compte à découvert) n'est
réconciliée par rien : elle est signalée et n'apporte aucune exposition projetable.

### Plus-value latente et change

La plus-value latente convertit valeur de marché et coût d'acquisition **au même taux daté**.
Le résultat est donc une plus-value en devise locale convertie : l'effet de change sur le capital
investi n'en est pas séparé, et la ligne porte `FX_PNL_NOT_ISOLATED` pour le dire. Un seul coût
d'acquisition manquant rend la grandeur non calculable ; aucune base de coût n'est reconstruite.

### Liquidité, historique et attribution

Les couvertures cash/liquide utilisent les dépenses essentielles connues et les sorties Debt Engine réellement exigibles à 30 jours. Une dépense essentielle manquante rend la couverture non calculable; un dénominateur explicitement nul produit `NO_SHORT_TERM_OBLIGATIONS`, jamais `0 mois` ou `Infinity`. Les horizons dette 30j/90j/12m additionnent les lignes datées du Debt Engine, sans mensualiser une échéance trimestrielle. Une variation historique n'existe que si un snapshot complet au plus tard à la date de référence existe.

L'attribution du Δ Net Worth additionne seulement les contributions observables et conserve `RECONCILIATION_UNEXPLAINED` pour le résiduel. Les transferts internes et le remboursement de principal sont neutres; intérêts, assurance et frais sont des coûts économiques.

## Métriques legacy encore en place

Les grandeurs patrimoniales du cockpit (actifs bruts, dettes, patrimoine net, cash immédiat,
actifs liquides, liquid net worth, actifs investis, productive net worth, couverture de
liquidité) proviennent **exclusivement** du bilan canonique. Les anciennes dérivations locales
qui resommaient les soldes natifs ont été supprimées, ainsi que `calculateNetWorth` et
`fxConvert` : elles constituaient une seconde vérité, non datée et sans devise.

Restent volontairement legacy, dans `deriveFlowMetrics` : revenus mensuels actifs, dépenses
renseignées, service de dette du mois, free cash flow connu, taux d'épargne et
d'investissement constatés, complétude budgétaire. Ce sont des agrégats de flux **déclarés** ;
les objets sous-jacents (revenus, catégories de dépenses) ne portent pas de devise et sont donc
implicitement en devise de reporting. Les remplacer suppose de faire du Cash Flow Engine V2 la
source unique des flux du cockpit, c'est-à-dire un chantier Cash Flow et Career, pas un simple
alignement de consommateur.

## Hypothèses explicites

Les hypothèses chiffrées propres à l'utilisateur sont conservées dans Supabase, avec leur type,
leur confiance et leur source. Elles ne sont pas recopiées dans le dépôt. Les scénarios fournis
par l'interface sont des paramètres de modèle modifiables, jamais des prévisions ni des conseils.
Une règle fiscale non vérifiée reste `MISSING` et n'est pas transformée en certitude.

## Réconciliations ouvertes

### Enveloppe d'investissement

Le solde total observé reste la valeur comptable primaire. Les positions et le cash interne
expliquent sa composition sans être additionnés une seconde fois. Tout écart de composition est
conservé comme réconciliation ouverte ; aucune position fictive n'est créée.

### Dette contractuelle

L'encours observé fait foi. Un échéancier dérivé plafonne le dernier remboursement au capital
restant et ne remplace jamais le contrat ou l'échéancier bancaire.

### Compte-titres

Lorsqu'une ventilation de positions est incomplète, seul le solde observé est comptabilisé. Les
positions non chiffrées ne sont pas inventées et aucun coût historique n'est reconstruit.

### Cash flow

Une dépense essentielle manquante rend la couverture incomplète. Les échéances de dette n'entrent
dans le cash flow exigible qu'à leur date contractuelle effective.

## Contrat Portfolio Data Foundation

Le ledger portefeuille est une couche de FAITS. Il ne produit aucun montant de bilan et
n'entre dans aucun agrégat patrimonial : le Canonical Balance Sheet reste la vérité des
montants, et les positions observées continuent d'expliquer les enveloppes sans s'y ajouter.

### Nature des événements

| Nature                             | Direction      | Effet                                                                                |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `OPENING_POSITION`, `OPENING_CASH` | `OPENING`      | ancrage observé au début de la couverture déclarée ; ni apport, ni opération interne |
| `CONTRIBUTION`, `TRANSFER_IN`      | `EXTERNAL_IN`  | argent ou titres neufs entrant dans l'enveloppe                                      |
| `WITHDRAWAL`, `TRANSFER_OUT`       | `EXTERNAL_OUT` | sortie hors de l'enveloppe                                                           |
| `BUY`, `SELL`                      | `INTERNAL`     | arbitrage : cash d'enveloppe contre titres, et réciproquement                        |
| `DIVIDEND`, `INTEREST`             | `INTERNAL`     | rendement du capital déjà investi, jamais un apport                                  |
| `FEE`, `TAX`                       | `INTERNAL`     | coût économique supporté par l'enveloppe                                             |

La direction est DÉRIVÉE de la nature ; elle n'est ni saisie ni persistée. Un utilisateur ne
peut pas décréter qu'un achat est un apport. Compter un ancrage d'ouverture comme un apport
ferait passer pour de l'argent neuf un capital déjà investi et détruirait toute mesure de
performance construite ensuite sur ce ledger.

### Coût de revient et produit de cession

Le mouvement de cash d'enveloppe observé prime : c'est ce qui est réellement sorti ou entré,
frais et taxes inclus. À défaut, la reconstitution `brut + frais + taxes` (ou `brut − frais −
taxes` à la cession) n'est retenue que si les trois composantes sont connues. Des frais
inconnus ne sont pas des frais nuls : ils rendent le coût inconnu, et le moteur pose
`ACQUISITION_FEES_UNKNOWN`. Quand les deux chemins sont disponibles et divergent au-delà d'un
centime, l'écart est signalé plutôt qu'arbitré.

Un transfert de titres entrant n'apporte aucun prix : son coût de revient est celui du lot
d'origine, que LFO ne connaît pas (`TRANSFER_IN_COST_UNKNOWN`). Le déclarer nul fabriquerait une
plus-value à la première vente.

### Date d'analyse et ancrages

Toute grandeur dérivée est datée. Un événement postérieur à la date d'analyse est conservé comme
fait et compté dans `futureEventCount`, mais n'affecte ni le cash, ni les lots, ni les quantités,
ni le PnL à cette date. Un événement daté du jour même de l'analyse est retenu.

Un ancrage (`OPENING_CASH`, `OPENING_POSITION`) est un NIVEAU observé au début de la couverture,
jamais un mouvement. Il contient déjà tout ce qui l'a précédé : les événements antérieurs sont
écartés de la série dérivée et comptés dans `supersededEventCount`. Sur une même date, l'ancrage
précède les opérations du jour, qui s'y ajoutent normalement.

Trois cas rendent la dérivation impossible plutôt qu'approximative :

- ancrage antérieur à la couverture déclarée : entre les deux dates, rien ne garantit
  l'exhaustivité (`LEDGER_ANCHOR_BEFORE_COVERAGE`) ;
- instrument sans ancrage dont des opérations précèdent la couverture : le stock de départ est
  inconnu (`LEDGER_QUANTITY_NOT_ANCHORED`) ;
- ancrage de cash absent alors qu'une couverture est déclarée (`LEDGER_CASH_ANCHOR_MISSING`).

### Lot désigné (convention `SPECIFIC_LOT`)

Une cession ne peut désigner qu'un événement qui ouvre réellement un lot du même instrument,
dans la même enveloppe et pour le même propriétaire. Les quatre conditions sont portées par une
clé étrangère composite, donc opposables à toute écriture, y compris hors RPC. Désigner le
dividende encaissé sur la ligne, une autre vente ou le lot d'un titre voisin est refusé par la
base : le moteur n'a pas à rattraper une donnée structurellement impossible.

Sans désignation alors que la convention l'exige, le coût cédé reste `NOT_COMPUTABLE`
(`SPECIFIC_LOT_REFERENCE_MISSING`) ; désigner un lot déjà épuisé donne
`SPECIFIC_LOT_NOT_OPEN`.

### Cash d'enveloppe dérivé

`cash dérivé = ancrage OPENING_CASH + Σ mouvements de cash`. Il reste `null` sans ancrage, dès
qu'un mouvement porte un effet inconnu, ou dès que le ledger mélange deux devises. L'écart avec
le cash observé (positions `isCash` de l'enveloppe, dans la devise du compte) est chiffré et
qualifié `RECONCILED` / `UNDER_EXPLAINED` / `OVER_EXPLAINED` / `MISSING`, jamais supposé nul.

### Cas de référence

Un PEA observé à 15 000 €, composé de 8 700 € d'ETF et 6 300 € de cash, sans aucun historique :
le bilan affiche 15 000 €, le ledger affiche zéro événement, `Historique non déclaré`, et rend
`NOT_COMPUTABLE` pour le cash dérivé, les lots et le coût de revient. Aucun achat n'est
reconstitué. Dès que l'utilisateur saisit l'ancrage, un apport de 5 000 €, un achat de 20 ETF,
5 € de frais, un dividende de 47 € et une vente partielle, le ledger explique la position et le
cash correspondants, et l'écart avec l'observation devient mesurable.

## Contrat Portfolio Analytics

Les analytics ne commencent que sur une enveloppe dont la couverture est `DECLARED`. L'absence
d'un type d'événement vaut alors zéro dans cette fenêtre exhaustive ; sans couverture déclarée,
elle reste inconnue. Les ancrages d'ouverture ne sont jamais des contributions.

### Performance et flux

- **Gain économique** = valeur de clôture − valeur d'ouverture − contributions + retraits.
- **TWR** : les valorisations comptables exactes doivent exister aux deux bornes et à chaque date
  de flux externe. Le flux est traité en fin de journée :
  `r = (valeur de fin − flux externe net entrant) / valeur de début − 1`. Les sous-périodes sont
  chaînées géométriquement. Un flux à la date d'ouverture ou sans valorisation datée bloque le
  calcul ; aucun Modified Dietz silencieux ne le remplace.
- **XIRR** : valeur d'ouverture et contributions sont des cash-flows négatifs pour l'investisseur,
  retraits et valeur finale sont positifs. La base annuelle est Actual/365. Le solveur explore le
  domaine `r > -100 %` et refuse un résultat lorsqu'il ne trouve aucune racine ou en trouve
  plusieurs.

Le PnL réalisé vient exclusivement des cessions appariées par le ledger. Le PnL non réalisé exige
des quantités réconciliées et un coût ouvert complet pour chaque position ; sa valeur de marché
est convertie par le FX Engine à la date de valorisation. L'effet de change sur le capital investi
n'est pas isolé et reste signalé. Frais et taxes des achats/ventes sont déjà incorporés aux coûts
et produits nets ; l'attribution ne les soustrait pas une seconde fois.

### Risque, allocation et attribution

Le drawdown est un **drawdown observé** sur l'indice de richesse TWR, pas une estimation quotidienne
entre deux observations. La volatilité annualisée exige au moins douze rendements mensuels avec
des intervalles de 25 à 35 jours. Sharpe reste non calculable sans taux sans risque daté ; bêta et
corrélations restent non calculables sans benchmark et historique de prix aligné.

L'allocation boucle sur la valeur comptable des enveloppes. Toute valeur non expliquée forme une
poche `UNEXPOSED`. Top 1, top 5, HHI et nombre effectif de positions ne sont calculés que si toute
l'exposition est connue ; le cash d'enveloppe est exclu de leur dénominateur. L'attribution par
titre n'est admise que depuis une ouverture de valeur nulle, faute de valorisations par titre à la
borne initiale. Elle doit réconcilier le gain économique au centime. Une allocation cible absente
rend le drift `TARGET_ALLOCATION_MISSING`, jamais zéro.
