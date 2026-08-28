# Event Engine V1

## Ownership

L'Event Engine est une projection, pas un ledger supplémentaire. Les domaines restent
propriétaires des faits et des calculs. Les adaptateurs de
`src/lib/engine/event-adapters.ts` traduisent ces sorties vers les contrats de
`event-contracts.ts`. `event-engine.ts` ne connaît ni amortissement, ni lot, ni valorisation,
ni barème fiscal.

## Les quatre concepts

1. **Domain fact** : contrat, prêt, détention, bail, propriété.
2. **Domain event** : changement de rémunération, remboursement, cession, capital event.
3. **Canonical economic consequence** : cash, income/expense, tax, principal/intérêt,
   asset/liability delta, economic cost.
4. **Scenario event** : override `ADD`, `REPLACE` ou `CANCEL`, toujours séparé du baseline.

## Contrat temporel

Chaque événement canonique porte :

- `effectiveDate` et `eventDate` ;
- date de création quand la source la fournit ;
- domaine, type et cible ;
- `OBSERVED`, `CONTRACTUAL`, `PROJECTED`, `USER_ASSUMPTION` ou `MODEL_ASSUMPTION` ;
- confiance, source et provenance ;
- `PLANNED`, `ACTIVE`, `COMPLETED`, `CANCELLED` ou `SUPERSEDED` ;
- forme `ONE_OFF`, `STATE_CHANGE`, `RECURRING_RULE` ou `SCHEDULE_CONSEQUENCE` ;
- convention `IMMEDIATE`, `MONTH_BOUNDARY`, `DOMAIN_PRORATION` ou `NOT_APPLICABLE`.

Les dates sont des dates civiles ISO. Aucune conversion UTC/local n'intervient dans la
timeline.

## Precedence et conflits

Ordre total :

```text
effective date
→ state update
→ domain calculation
→ tax
→ cash consequence
→ domain precedence
→ explicit sequence
→ business type / target / stable id
```

L'identifiant n'intervient qu'en dernier départage, après toutes les règles métier. Deux
state changes de même type, même cible et même date créent un conflit explicite. Aucun des
deux n'est choisi silencieusement. Les cycles ou références de supersession manquantes sont
également signalés.

## Actual vs expected

Le rapprochement utilise une clé métier portée par l'adaptateur : transaction liée,
liability/month, property/month ou salaire/month. `date + amount` n'est jamais une identité.

Lorsqu'un actual existe :

- son cash remplace le cash attendu ;
- income/expense/tax observés remplacent les mêmes grandeurs attendues ;
- la décomposition non visible à la banque reste issue du domaine : principal, intérêt,
  liability delta, brut, tax liability ;
- expected, actual et variance restent explicables.

## Monthly Model

`runDeterministicEventModel` consomme les conséquences rapprochées. Il applique :

- operating/tax cash avant service de dette ;
- Debt consequences issues du seul Debt Engine ;
- mouvements de capital Portfolio sur les actifs de marché ;
- mouvements Real Estate/Business sur les actifs non financiers ;
- passifs non Debt séparément.

Une contribution Portfolio `cash -10 000 / asset +10 000` et une acquisition cash
`cash -X / asset +X` sont neutres avant fees/tax. Le principal Debt réduit cash et passif,
donc seul intérêt + assurance + frais constitue un coût économique.

## FX et calcul partiel

Chaque conséquence conserve sa devise native et sa date économique. Le pont Monthly Model
refuse de sommer une autre devise et produit `FX_RATE_REQUIRED`. Event Engine ne choisit
aucun taux.

Un événement non calculable reste dans la timeline. Les champs requis restent `null` et les
blockers expliquent la lacune. Les statuts `PRE_TAX`, `AFTER_TAX_ESTIMATED`,
`AFTER_TAX_VERIFIED` et `NOT_COMPUTABLE` empêchent de présenter un net après impôt inventé.

## Supabase et sécurité

Event Engine V1 n'ajoute aucune table, vue ou RPC :

- aucune seconde vérité dérivée ;
- aucune nouvelle exposition Data API ;
- aucune nouvelle policy RLS à maintenir ;
- l'isolation propriétaire est celle des tables de domaine existantes ;
- le calcul se fait après les lectures serveur filtrées par `user_id`.

Scenarios V2 décidera plus tard de la persistance des overrides. Elle devra être additive,
RLS owner-isolated, sans accès `anon`, avec FK composites quand une cible typée existe.

## Performance

Les tris sont `O(n log n)`, les rapprochements sont indexés en mémoire par clé, et la
projection récurrente est bornée à 600 occurrences (50 ans). Aucune règle n'est matérialisée
en base. Le golden test déroule 480 mois et vérifie l'identité des sorties indépendamment de
l'ordre des entrées.
