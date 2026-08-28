# Audit Career + Tax V2

Audit daté du 26 août 2026, réalisé avant toute modification applicative ou migration.
Base de code : `origin/main@5598e68`, après merge des PR #23 et #24.

## État réel

- L'onglet Career est un prototype entièrement local au composant. Six trajectoires, les
  salaires, les bonus et leurs croissances sont codés en dur dans React. Aucun fait de carrière
  ne vient du repository.
- L'onglet Tax est une page de gouvernance statique. Il affiche France / individuel / 2026 en
  dur et ne lit ni `tax_profiles` ni `tax_rules`.
- `income_sources` porte seulement un `monthly_net` sans devise, fin de validité, employeur,
  nature du revenu ni pont brut-net. Production : 3 lignes, dont une valeur observée, une
  hypothèse inactive et une valeur manquante.
- `tax_profiles` porte résidence, foyer et date de début seulement. Production : 1 ligne.
- `tax_rules` porte un JSON libre. La seule ligne de production est explicitement `MISSING` et
  ne contient aucun barème utilisable.
- `src/lib/engine/tax.ts` additionne fixe et variable, applique un taux unique de cotisations,
  un abattement unique et un barème progressif. Il ne distingue ni paiement, acquisition,
  retenue, liability, cash tax, statut ni absence de règle.
- `deriveFlowMetrics()` additionne les `monthly_net` actifs et transforme aujourd'hui un
  `monthly_net = null` en zéro. Cette métrique déclarative alimente le cockpit, mais pas le Cash
  Flow Engine V2 canonique.
- Cash Flow V2 sait déjà distinguer revenu, impôt, remboursement et priorité de l'observé. Les
  transactions de production sont actuellement vides. Le moteur ne connaît pas encore de
  conséquences Career/Tax projetées.
- le Monthly Model conserve le contrat `scenario.monthlySavings` = surplus opérationnel mensuel
  avant dette. Il documente explicitement l'absence actuelle de Career → Tax → Cash Flow.
- les scénarios globaux portent encore `salary_growth`, mais cette hypothèse n'est consommée par
  aucun moteur canonique. La page Career possède une seconde logique de croissance locale.
- Decision Lab ne calcule que « rembourser vs investir ». Les cas carrière affichés sont des
  placeholders et `decision_cases` ne contient aucune ligne.
- `DashboardState` transporte les anciennes `incomes`, mais ni profil fiscal, ni règle fiscale,
  ni fait de carrière.
- aucune mutation, RPC ou écriture atomique Career/Tax n'existe.
- Supabase production est alignée exactement sur les 24 migrations du dépôt. Les tables legacy
  ont RLS et `owner_all`, mais seulement leur PK comme index ; les trois FK `user_id` sont
  signalées non couvertes par l'advisor performance. Aucun RPC `lfo_*career*` ou `lfo_*tax*`
  n'existe. Le seul warning security global est la protection des mots de passe compromis
  désactivée, antérieure et hors périmètre.

## Inventaire de décision

### KEEP

- `FamilyOfficeRepository`, l'implémentation Supabase unique et le mapping strict des `null`.
- `DataKind`, provenance, confiance, dates d'effet et statuts explicites.
- Cash Flow V2 pour les transactions observées et sa priorité ACTUAL.
- le contrat Monthly Model `monthlySavings` avant service de dette.
- le FX Engine comme unique convertisseur.
- les scénarios globaux et Decision Lab pour leurs domaines actuels, sans y réimplémenter Career.
- RLS `owner_all`, RPC runtime réservées à `service_role`, migrations additives et smokes rollbackés.

### REUSE

- `tax_profiles` comme identité du profil fiscal, enrichie de façon additive et datée.
- `tax_rules` comme règle atomique déclarée, rattachée à un rule set versionné.
- `income_sources` uniquement comme compatibilité de flux net legacy jusqu'à migration explicite ;
  aucune donnée brute ou fiscale ne sera reconstruite depuis son `monthly_net`.
- `computeObservedCashFlow()` pour faire primer une transaction bancaire réelle sur une
  conséquence projetée de même nature.
- les primitives d'explicabilité et de rendu `null → Non calculable`.

### DEPRECATE

- la page Career codée en dur et ses trajectoires locales.
- les libellés statiques de la page Tax.
- `employmentCompensation()` dans sa forme actuelle et tout brut → net à taux unique implicite.
- `Scenario.salaryGrowth` comme entrée de Career : conservé pour compatibilité de schéma, mais ne
  devient pas une hypothèse canonique du nouveau domaine.
- `income_sources` comme source de vérité Career. Elle reste lisible pour l'historique legacy.

### REPLACE

- les calculs React Career par un Compensation Engine pur sur faits datés.
- le moteur fiscal V1 par un moteur paramétrique qui sépare cotisations, revenu imposable,
  liability, retenue, paiement, remboursement et solde.
- les chiffres statiques Career/Tax par les résultats dérivés du `DashboardState` canonique.
- la conversion `monthly_net null → 0` par un résultat explicitement non calculable dès qu'une
  source active a un montant inconnu.

### MIGRATE

- ajouter des faits datés : rôles, termes de rémunération, événements, equity grants et scénarios
  de carrière.
- enrichir le profil fiscal existant sans imposer de champs français.
- versionner les ensembles de règles et rattacher les règles atomiques existantes.
- ajouter observations fiscales et items de revenu fiscal sans créer de transactions historiques.
- indexer toutes les FK existantes et nouvelles, ajouter les FK composites d'isolation propriétaire,
  RLS, grants explicites et RPC atomiques.
- ne pas convertir automatiquement les 3 lignes `income_sources` : le net historique ne permet
  pas de déduire honnêtement le brut, les cotisations ou l'impôt.

## Frontières retenues

```text
Career facts -> Compensation Engine -> gross monthly consequences
             -> Tax Engine -> net monthly consequences
             -> Cash Flow forecast adapter (ACTUAL transaction wins)
             -> one optional Monthly Model input
```

Career ne calcule aucun impôt. Tax ne crée aucun revenu. Aucun résultat Career/Tax ne crée une
transaction observée, une dette fiscale au bilan ou une trajectoire patrimoniale locale.

## Fiscalité réelle

Aucune règle France 2026 vérifiée n'existe dans le dépôt ou en production. Cette livraison ne
créera donc aucun barème français. Les cas réels sans rule set déclaré retourneront
`TAX_RULES_MISSING`; les tests utiliseront exclusivement des règles paramétriques synthétiques
identifiées comme telles.
