# Event Engine — audit initial

## Résultat

Le repository possède déjà les faits datés et les moteurs nécessaires. Le manque n'était
pas une table globale d'événements, mais une projection temporelle commune et un contrat de
conséquences mensuelles. L'architecture retenue est donc :

```text
domain facts + domain schedules
             ↓
      typed domain adapters
             ↓
     canonical event timeline
             ↓
reconciled monthly consequences
             ↓
 Monthly Model / Scenarios V2
```

Aucun résultat dérivé n'est persisté. Un événement Portfolio, Real Estate, Business,
Career, Tax ou Debt reste la propriété de sa table et de son moteur.

## Classification

### KEEP

- `transactions` : vérité du cash observé ;
- `recurring_cash_flow_rules` : règles contractuelles, sans matérialisation en base ;
- Debt Engine et ses échéanciers contractuel, forward et fourni ;
- Portfolio ledger, lots, PnL et rapprochements ;
- Real Estate facts, operating terms, capital events et liens de financement ;
- Business Equity ownership, valuations, capital events et capital view ;
- Career roles, compensation terms, events et conséquences mensuelles ;
- Tax profiles, rule sets, observations et calcul Career → Tax ;
- Canonical Balance Sheet et FX Engine ;
- provenance, `DataKind`, confiance, `null = inconnu` ;
- `DashboardState` comme enveloppe de lecture serveur.

### REUSE

- `CareerEvent`, `PortfolioEvent`, `RealEstateCapitalEvent`, `BusinessCapitalEvent` ;
- `loan_rate_changes`, `loan_payment_changes`, remboursements anticipés et schedules ;
- `TaxObservation` pour liability, withholding, payment et refund ;
- transactions liées par identifiant aux faits Portfolio, Real Estate, Business et Tax ;
- conventions civiles de date et fonctions de calendrier existantes ;
- `CareerTaxMonthlyConsequence` pour la priorité du cash bancaire réel.

### EXTEND

- `DashboardState.eventTimeline` : projection dérivée sur quarante ans ;
- Monthly Model : chemin optionnel alimenté par les conséquences Event Engine ;
- contrat de scénario : `ADD`, `REPLACE`, `CANCEL`, sans construire Scenarios V2 ;
- explicabilité : source event, domaine, moteur, formule, hypothèses et blockers ;
- rapprochement actual/expected avec variance et conservation des composantes non observées.

### DEPRECATE

- `Scenario.monthlySavings` comme source future du surplus, lorsque des conséquences
  canoniques sont disponibles. Il reste supporté pour Scenarios V1 ;
- `IncomeSource.monthlyNet` comme projection de carrière : Career V2 est propriétaire ;
- tout tri temporel qui dépendrait de l'ordre de retour SQL ou de l'UUID.

### REPLACE

- aucune table ni primitive de domaine dans Event Engine V1 ;
- Scenarios V1 sera remplacé plus tard par baseline + event overrides, mais ce chantier ne
  le fait pas.

## État des domaines audités

| Domaine     | Fait propriétaire                 | Date canonique                       | Conséquence consommée                        |
| ----------- | --------------------------------- | ------------------------------------ | -------------------------------------------- |
| Career      | rôles, termes, events             | start/end, effective, event/paid     | Career → Tax → cash mensuel                  |
| Tax         | profils, rules, observations      | effective/observed                   | liability, cash tax, refund                  |
| Debt        | contrat + termes + schedules      | effective/due                        | principal, intérêt, assurance, frais, passif |
| Cash Flow   | transaction/règle                 | transaction/occurrence               | cash observé ou contractuel                  |
| Portfolio   | ledger event                      | event/settlement                     | cash d'enveloppe, capital, income, fees, tax |
| Real Estate | asset/terms/capital event         | acquisition/disposal/effective/event | capital et operating terms attribués         |
| Business    | ownership/valuation/capital event | effective/valuation/event            | personal cash via capital view               |

## Risques écartés

- pas de `events(type text, payload jsonb)` ;
- pas de copie d'un loan schedule dans une autre table ;
- pas de conversion FX dans l'orchestrateur ;
- pas de barème fiscal ou taux arbitraire dans Event Engine ;
- pas de matérialisation de 480 lignes récurrentes en base ;
- pas de suppression silencieuse des événements annulés ou remplacés ;
- pas de déduplication par `date + amount`.
