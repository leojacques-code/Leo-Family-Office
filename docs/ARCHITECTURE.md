# Architecture

## Principes

1. **Traçabilité** — chaque valeur importante porte un type, une confiance et, si disponible, une source et une date.
2. **Absence de double comptage** — le bilan additionne les derniers soldes ; les positions expliquent ces soldes sans s’y ajouter.
3. **Historique immuable** — un solde crée un snapshot daté et un scénario crée une version.
4. **Moteurs indépendants** — les calculs financiers, Cash Flow, Debt, Monte-Carlo, immobilier et décision restent des fonctions TypeScript pures.
5. **Persistance unique** — Supabase PostgreSQL et Supabase Storage sont obligatoires dans tous les environnements.

## Couches

- **UI** : App Router, composants React et Recharts.
- **Application** : routes `/api/state`, `/api/projection`, `/api/documents`, `/api/export`.
- **Moteurs** : transitions et formules financières TypeScript sans dépendance React ou base.
- **Data** : `FamilyOfficeRepository` expose l’état agrégé et les mutations. Son unique implémentation est `supabase-repository.ts`.
- **Schéma** : `supabase/migrations/` est la source de vérité PostgreSQL.
- **Documents** : bucket privé `family-office-documents`, avec métadonnées dans `public.documents`.
- **Vérification** : `db:verify` contrôle directement PostgreSQL dans une transaction `READ ONLY`; il ne constitue jamais une seconde définition du schéma. Le contrôle de l'historique de migration est symétrique : le dépôt et la base doivent décrire la même histoire, dans les deux sens. `gate:local` rejoue ce contrôle sur une base locale reconstruite depuis les seules migrations, sans credential.

Les pages, routes et composants continuent d’appeler `getRepository()`. Aucun composant UI n’accède directement à Supabase.

## Vérité financière des consommateurs

Un écran ne construit aucune vérité financière. Il lit le Canonical Balance Sheet déjà calculé
par le repository, via les sélecteurs de `src/lib/engine/balance-sheet-view.ts` : ces fonctions
groupent, sélectionnent et soustraient des montants **déjà convertis**, elles ne résolvent aucun
taux de change et ne resomment aucun solde natif.

Trois interdits en découlent, vérifiés par les tests :

1. **Aucune addition de devises différentes.** Un total de groupe passe par `accountGroupTotal`,
   qui rend le total non calculable si une ligne n’est pas convertible.
2. **Aucune allocation reconstruite localement.** `buildCanonicalAllocation` produit la
   ventilation et doit boucler exactement sur `financialAssets` ; un résiduel non nul est un bug.
3. **Aucune valeur manquante rendue en zéro.** Un agrégat `null` s’affiche « Non calculable ».

`DashboardMetrics` sépare explicitement les deux origines : la structure patrimoniale vient du
bilan canonique (`composeDashboardMetrics`), les flux déclarés viennent de `deriveFlowMetrics`,
qui ne lit plus ni compte ni position.

## Portfolio Data Foundation

Le portefeuille a désormais deux vérités distinctes, qui ne se recouvrent jamais.

**L'état observé** (`positions`, `position_snapshots`) dit ce qu'une ligne VAUT aujourd'hui.
Il alimente seul le Canonical Balance Sheet, exactement comme avant.

**Le ledger** (`portfolio_events`) dit comment elle s'est CONSTITUÉE : ancrages d'ouverture,
apports, retraits, achats, ventes, dividendes, coupons, frais, taxes et transferts. Il ne
produit aucune ligne de bilan et n'entre dans aucun total patrimonial. `buildPortfolioLedger()`
en dérive les lots, le coût de revient, le cash d'enveloppe théorique et les écarts de
réconciliation ; le bilan reste bit pour bit identique avec ou sans ledger, ce qu'un test
vérifie.

Cinq règles fondent le moteur.

0. **La lecture est datée.** Les événements postérieurs à `asOfDate` sont conservés comme faits
   mais n'entrent dans aucune grandeur dérivée à cette date : un achat saisi pour la semaine
   prochaine ne détient rien aujourd'hui et n'a rien débité. Symétriquement, un ancrage
   d'ouverture est un NIVEAU qui contient déjà tout ce qui l'a précédé : les événements
   antérieurs sont écartés de la série et signalés (`LEDGER_EVENT_BEFORE_ANCHOR`), jamais
   rejoués par-dessus. Un ancrage antérieur à la couverture déclarée laisse entre les deux
   dates une période dont rien ne garantit l'exhaustivité : la série ne la traverse pas. Un
   instrument sans ancrage dont des opérations précèdent la couverture a un stock de départ
   inconnu, donc une quantité et un coût `NOT_COMPUTABLE`.
1. **Une observation n'est pas un historique.** Une enveloppe dont la profondeur d'historique
   n'est pas déclarée (`portfolio_envelope_policies.ledger_coverage_start` à `null`) conserve son
   état observé intact ; le ledger dit simplement qu'il ne l'explique pas. Aucun achat n'est
   reconstitué pour faire boucler une position.
2. **La convention d'appariement ne se devine pas.** Sans `lot_matching_method` déclarée, et dès
   qu'il existe plus d'un lot ouvert, le coût de revient cédé est `NOT_COMPUTABLE`. Avec un seul
   lot ouvert, l'appariement est mécaniquement univoque et reste calculé. La quantité, elle, ne
   dépend d'aucune convention et reste toujours connue.
3. **Aucune conversion de change.** Le FX Engine reste l'unique moteur de change. Convertir un
   flux historique à un taux non observé inventerait une opération de change : une enveloppe dont
   le ledger mélange les devises est déclarée non réconciliable, pas convertie.
4. **Aucune seconde vérité Cash Flow.** Un événement externe à l'enveloppe (apport, retrait,
   transfert) POINTE la jambe bancaire déjà classée dans `transactions` ; il n'en crée ni n'en
   reclasse aucune. Le moteur signale une jambe manquante, un écart de montant, un virement vers
   l'enveloppe classé en `EXPENSE`, ou une opération interne indûment rattachée à un compte
   bancaire. Corriger reste le travail du Cash Flow Engine.

Aucun lot, coût de revient ni PnL n'est persisté : les persister créerait une vérité qui se
périmerait à la première correction d'événement. Seuls les faits et les déclarations le sont.

Côté intégrité, la base ne délègue rien à la RPC. Une seule clé étrangère composite ferme les
quatre frontières du lot désigné par une cession : même propriétaire, même enveloppe, même
instrument, et un événement qui **ouvre réellement un lot**. Elle référence
`(id, user_id, account_id, security_id, is_lot_opening)`, où `is_lot_opening` est une colonne
générée valant vrai pour `OPENING_POSITION`, `BUY` et `TRANSFER_IN` porteurs d'un instrument ;
côté référençant, `matched_lot_is_opening` vaut `true` dès qu'un lot est désigné et `null` sinon,
ce qui neutralise la contrainte quand aucun lot ne l'est. Un « lot spécifique » structurellement
impossible (le dividende encaissé sur la ligne, une autre vente, le lot d'un titre voisin) est
donc refusé par la base, pas seulement signalé après coup par le moteur. Le `CHECK` associé exige
un instrument sur la cession : sans lui, un `security_id` nul désactiverait la clé étrangère sous
MATCH SIMPLE. `is_lot_opening` duplique `ACQUISITION_TYPES` du moteur ; un test épingle la liste
côté TypeScript pour rendre toute divergence visible.
Les liens sortants (`transaction_id`, `counterparty_account_id`) utilisent `on delete set null`
avec **liste de colonnes** : sans elle, une FK composite annulerait aussi `user_id`, qui est
`NOT NULL`, et la suppression de la transaction échouerait au lieu de détacher le lien.

## Portfolio Analytics

`buildPortfolioAnalytics()` est une couche pure en aval de trois vérités existantes :

- `account_balances` fournit les valorisations comptables datées de chaque enveloppe ;
- `PortfolioLedger` fournit les flux, lots, coûts et PnL réalisés ;
- le Canonical Balance Sheet fournit la valeur et l'exposition courantes, avec le FX Engine comme
  unique convertisseur.

Le moteur ne persiste aucun rendement. Il produit, enveloppe par enveloppe, gain économique, TWR,
XIRR, PnL réalisé et non réalisé, revenus, frais, taxes, drawdown observé, volatilité annualisée et
attribution lorsque leur preuve est complète. Chaque métrique porte son propre statut et ses
blocages : une allocation actuelle peut donc rester exploitable alors que le TWR ne l'est pas.
Les agrégats monétaires d'une enveloppe sont exprimés dans sa devise : les flux et charges sont
convertis à leur date d'événement, les produits de cession à la date de cession, les coûts à la
date d'acquisition et les positions à leur date de valorisation. Cette normalisation utilise
uniquement le FX Engine ; elle ne consomme jamais directement un PnL ou un coût agrégé en devises
natives. Si une conversion historique fidèle n'est plus reconstructible, la métrique est
`NOT_COMPUTABLE` avec un blocage explicite.

L'allocation et la concentration globales consomment exclusivement les expositions du bilan. Une
poche non exposée est affichée comme telle ; elle n'est ni répartie entre les classes connues ni
supposée diversifiée. Le drift reste `NOT_COMPUTABLE` tant qu'une allocation cible datée n'existe
pas. Les composants React ne contiennent aucune formule : ils rendent le résultat et les motifs
produits par le moteur.

## Real Estate V2

`buildRealEstatePortfolio()` est une couche pure en aval de quatre vérités qu'elle ne détient pas :

- les faits immobiliers (`properties`, `real_estate_valuations`, `real_estate_capital_events`,
  `real_estate_operating_terms`) disent ce que le bien est, ce qu'il vaut, ce qu'il a coûté et ce
  qu'il rapporte ;
- le **Debt Engine** fournit la totalité du financement. Le moteur immobilier n'amortit rien :
  chaque encours vient de `outstandingBalanceAt`, chaque service de dette et chaque coût
  économique de `debtServiceBreakdownForPeriod`. `real_estate_financing_links` ne porte qu'une
  quote-part, jamais un passif ;
- le **Cash Flow Engine** classe les flux réels. `computeObservedCashFlow` est appelé sur le
  sous-ensemble des transactions rattachées à un bien par `transactions.property_id`, après leur
  seule normalisation monétaire par le FX Engine : aucune nature n'est réinterprétée, aucun flux
  n'est créé ;
- le **FX Engine** est l'unique convertisseur. Chaque fait est converti à SA date ; un taux absent
  rend la grandeur dépendante `NOT_COMPUTABLE` et ne vaut jamais 1.

Une transaction immobilière en devise étrangère est convertie au taux historique de sa date avant
d'entrer dans l'agrégat observé ; si un seul taux manque, l'agrégat complet reste
`NOT_COMPUTABLE`. À l'inverse, une échéance de dette future en devise étrangère n'a pas de taux
historique : faute de courbe FX future explicitement modélisée, service de dette, principal, coût
économique et encours projeté restent `NOT_COMPUTABLE`. Le dernier spot n'est jamais figé en
silence pour fabriquer une projection.

Le domaine produit **une seule ligne de bilan par bien, du côté actif**, en devise native : c'est le
Canonical Balance Sheet qui convertit, une fois, avec sa propre traçabilité. Il n'émet **aucune
ligne de passif** : la dette immobilière est déjà au bilan par `liabilities`, et en émettre une ici
la compterait deux fois. Un bien sans valorisation, ou dont la quote-part détenue n'est pas
déclarée, émet une ligne de montant `null` portant ses motifs : l'actif existe, son montant est
inconnu, et l'actif brut devient `PARTIAL` au lieu d'être silencieusement sous-évalué.

Un terme d'exploitation ou une famille de coûts de capital non déclarée n'est jamais traité comme
nul. Déclarer un événement de frais d'acquisition ou de capex à 0 est une information ; ne rien
déclarer n'en est pas une, et coût de revient, plus-value et rendements dépendants restent
`NOT_COMPUTABLE` en disant lequel manque. Les événements postérieurs à la date de lecture sont
ignorés et signalés. Chaque rendement nomme son dénominateur (`grossYieldOnValue`, `grossYieldOnCost`,
`netYieldOnValue`, `netYieldOnCost`) : un rendement sur prix nu et un rendement sur coût complet ne
sont pas la même grandeur. Aucune fiscalité n'est produite sans taux effectif déclaré par
l'utilisateur, et l'assiette à laquelle ce taux s'applique est nommée dans le résultat
(`REAL_ESTATE_TAX_BASE_CONVENTION`) plutôt que laissée implicite.

### Absence de rattachement n'est pas absence de dette

`RealEstateFinancingState` distingue trois situations, et cette distinction est la plus
coûteuse du domaine :

- `LINKED` — un concours est rattaché : les conséquences viennent du Debt Engine ;
- `DECLARED_NONE` — l'utilisateur a DÉCLARÉ que le bien n'est financé par aucune dette. Zéro
  est alors une valeur, et l'equity du bien vaut sa valeur attribuable ;
- `UNKNOWN` — rien n'est rattaché et rien n'est déclaré, ou une dette est déclarée sans être
  rattachée. Dette attribuée, equity, apport réel, cash flow et rendements sur fonds propres
  sont tous `NOT_COMPUTABLE`.

Sans cette distinction, un bien dont le crédit n'a pas encore été saisi afficherait la même
equity qu'un bien acheté comptant, et le patrimoine serait surévalué du montant entier de la
dette. Un rattachement contredisant une déclaration d'achat comptant l'emporte, parce qu'il
pointe une dette réelle, et la contradiction est signalée.

Le capital emprunté d'origine est un montant HISTORIQUE dont la date de décaissement
n'existe pas dans le modèle de dette : la première échéance la suit, parfois de plusieurs
mois. En devise de reporting il est exact ; dans toute autre devise il reste
`NOT_COMPUTABLE`, comme l'apport réel qui en dépend. Aucune date approchée n'est substituée.

Les revenus observés d'un bien sont la somme des flux rattachés que le Cash Flow Engine
classe en revenu. Ce n'est pas « le loyer observé » : LFO ne porte aucune nature de revenu
locatif, et un flux rattaché peut être une indemnité, une régularisation ou une subvention.
L'écart avec le loyer déclaré est donc un écart entre deux grandeurs de nature différente,
utile pour repérer un décrochage, jamais une mesure de manque de loyer.

`real-estate-scenarios.ts` est la couche de projection, strictement séparée des faits :
conservation, cession, refinancement, travaux et étude d'un projet non détenu. Un crédit
hypothétique y passe par `syntheticLoan`, qui construit une `Liability` confiée au Debt Engine :
LFO n'a qu'un moteur d'amortissement. `amortizeLoan` de `financial.ts` est déprécié et sans
consommateur applicatif. Une hypothèse de croissance non fournie n'est pas remplacée par zéro : le
scénario reste incalculable et le dit.

Le refinancement distingue son coût économique de son flux initial : `nouveau capital − encours
soldé − indemnité − frais`. Une différence de principal est donc une entrée ou une sortie de
trésorerie, jamais une économie d'intérêt. Un financement de travaux supérieur au capex, un crédit
prospectif supérieur au coût total ou toute combinaison future multi-devise sans courbe FX rend la
métrique concernée `NOT_COMPUTABLE` au lieu d'inventer la destination de l'excédent ou le change.

Le Personal Monthly Financial Model porte les actifs non financiers **constants** sur toute la
projection, comme il porte déjà les passifs sans échéancier, avec le drapeau
`NON_FINANCIAL_ASSET_PROJECTION_TERMS_MISSING`. Les faire disparaître au mois 1 traiterait un
inconnu comme un zéro ; leur appliquer une croissance inventerait un rendement immobilier.

## Data Acquisition Foundation

`src/lib/acquisition/` lit une source. C'est une couche PURE — aucun accès base, aucun React — et elle ne calcule aucune finance : elle produit des CANDIDATS de faits, avec leurs ambiguïtés déclarées.

```text
FICHIER → RAW (immuable) → NORMALISÉ (staging) → DÉDUPLIQUÉ → PREVIEW → CANONIQUE
```

Six tables portent cette chaîne : `import_sources`, `import_sessions`, `import_raw_records`, `import_normalized_records`, `import_record_links`, `import_column_mappings`. Elles sont lues par `src/lib/data/import-repository.ts`, VOLONTAIREMENT séparé de `FamilyOfficeRepository` : le staging d'un import est volumineux et ne concerne aucun écran financier, le charger dans `getDashboardState()` ferait payer à tout le cockpit une donnée que seule la page Imports consomme.

Ce que cette couche ne fait jamais : classer un flux, recalculer un solde, rapprocher un transfert interne, déclarer une profondeur d'historique. Une transaction importée naît avec `category_id` nul et le Cash Flow Engine la compte comme non classée — c'est la vérité, pas un défaut.

Deux ambiguïtés sont structurelles et changent le résultat financier : la convention décimale (`1,234` vaut 1,234 ou 1 234) et l'ordre jour/mois (`03/04/2026`). Elles se résolvent au niveau de la COLONNE quand une valeur la tranche, et bloquent les lignes concernées sinon. Les conventions retenues sont persistées sur la session, de sorte qu'un montant relu plus tard reste confrontable à la règle qui l'a produit.

La déduplication repose sur un principe unique : L'IDENTITÉ SE DÉMONTRE. Une égalité de tuple `compte / date / montant / devise / libellé` ne prouve rien entre deux fichiers distincts — un relevé partiel contenant un troisième achat identique ne dit pas qu'il s'agit d'un des deux déjà connus. Deux preuves seulement autorisent un rejet automatique : l'empreinte du FICHIER déjà validé, et un identifiant de transaction dont la stabilité est DÉCLARÉE pour la session. Le nom d'un en-tête n'en est jamais une, d'où la séparation entre `externalTransactionId` et `reference`. Tout le reste est une ressemblance signalée, exclue par défaut et écrite sur décision explicite.

L'identité se cherche dans TOUT l'historique, la ressemblance dans une fenêtre de dates : `ExistingTransactionFact` ne porte donc aucune clé d'identité, et le type rend la confusion impossible. Borner l'identité produisait un verdict « nouvelle » suivi d'une violation d'index au commit.

La date d'observation d'un import est distincte d'`AS_OF_DATE` : une opération bookée hier est un fait même si le reporting est arrêté le mois précédent, et c'est aux moteurs aval de l'écarter d'une lecture à leur date.

La piste d'audit est en lecture seule pour `authenticated` : le brut est immuable, la provenance d'un fait écrit est gelée, et la clé étrangère du lien de provenance est en `restrict`. Une transaction importée ne peut donc pas perdre son origine, même par écriture directe.

Détail complet, formats supportés et limites : `docs/DATA_ACQUISITION.md`.

## Lecture paginée des ledgers

`readAllPages` (`src/lib/data/pagination.ts`) lit une source page par page et **refuse** de
rendre un résultat tronqué. Un ledger amputé de ses dernières pages produirait des quantités, un
cash et un coût de revient parfaitement calculés sur des faits incomplets, donc faux sans que
rien ne le dise. C'est une défaillance de la couche données, pas une incertitude financière :
elle remonte comme `LedgerTruncationError`, au même titre qu'une erreur PostgREST. Le ledger
portefeuille et la fenêtre de transactions passent tous deux par ce chemin.

## Transactions

La migration `202608240005_supabase_only_runtime.sql` regroupe en fonctions PostgreSQL les écritures composées : compte + solde, transaction + solde dérivé, scénario + version, duplication + version, clôture + snapshot, catégorie + budget, clôture Cash Flow versionnée et simulation + percentiles.

Ces fonctions ne calculent aucune formule métier. Elles persistent des résultats déjà calculés par TypeScript. Une exception annule toute la fonction.

L’upload documentaire traverse deux systèmes : Storage puis PostgreSQL. Si l’insert des métadonnées échoue, le repository supprime immédiatement l’objet Storage créé et signale aussi un éventuel échec du rollback.

## Validation des données

Les nombres financiers obligatoires doivent être présents et finis. Une colonne obligatoire absente est traitée comme une chaîne de migrations incomplète, jamais comme zéro ou comme une valeur par défaut applicative. Les champs réellement optionnels conservent `null`.

Monte-Carlo refuse un état, un percentile ou une série contenant `NaN`, `Infinity` ou `-Infinity`. La persistance répète ce contrôle avant l’appel RPC.

## Modèle Monte-Carlo

Le moteur travaille mensuellement, utilise une Student-t à 5 degrés de liberté normalisée, une probabilité de stress rare et un choc daté optionnel. Le seed rend chaque simulation reproductible. Les percentiles portent sur le patrimoine net.

## Sécurité actuelle

L’accès applicatif reste fondé sur `SESSION_SECRET` et `LOCAL_ACCESS_CODE`. Le client serveur utilise `SUPABASE_SECRET_KEY` et `OWNER_USER_ID`; aucune clé secrète n’est exposée au navigateur. RLS et le bucket privé restent une défense en profondeur jusqu’à une future migration Supabase Auth, hors du périmètre actuel.
