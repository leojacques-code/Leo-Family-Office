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

### Liquidité, historique et attribution

Les couvertures cash/liquide utilisent les dépenses essentielles connues et les sorties Debt Engine réellement exigibles à 30 jours. Une dépense essentielle manquante rend la couverture non calculable; un dénominateur explicitement nul produit `NO_SHORT_TERM_OBLIGATIONS`, jamais `0 mois` ou `Infinity`. Les horizons dette 30j/90j/12m additionnent les lignes datées du Debt Engine, sans mensualiser une échéance trimestrielle. Une variation historique n'existe que si un snapshot complet au plus tard à la date de référence existe.

L'attribution du Δ Net Worth additionne seulement les contributions observables et conserve `RECONCILIATION_UNEXPLAINED` pour le résiduel. Les transferts internes et le remboursement de principal sont neutres; intérêts, assurance et frais sont des coûts économiques.

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
