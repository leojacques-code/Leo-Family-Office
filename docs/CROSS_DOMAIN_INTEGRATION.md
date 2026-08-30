# Cross-domain integration — Global Financial Model

## Objectif

La passe d'intégration ne crée aucun nouveau moteur financier. Elle impose un contexte
unique à la chaîne déjà canonique :

```text
Canonical Balance Sheet
        +
dated domain facts
        ↓
Global Financial Context
        ↓
Event Engine → Monthly Model → Scenarios V2 → Goals V2 → Decision Lab V2
```

Le contexte fixe une seule date d'observation, une seule devise, un horizon mensuel exact,
un seul bilan d'ouverture, un seul jeu d'événements et un seul fingerprint de baseline.
Tous les résultats restent dérivés à la lecture.

## Audit des incohérences fermées

| Avant | Risque | Correction |
| --- | --- | --- |
| Scenarios, Goals, Decision Lab et l'API Projection assemblaient séparément bilan, timeline et baseline | Deux consommateurs pouvaient comparer des jeux d'événements différents | `global-financial-model.ts` devient le point de composition commun |
| `DashboardState.eventTimeline` est une vue pratique fixée à quarante ans | Un scénario autorisé jusqu'à 80 ans pouvait perdre silencieusement les événements postérieurs | Le contexte reconstruit toujours la timeline sur l'horizon exact demandé |
| Goals fingerprintait la timeline globale puis évaluait une trajectoire retaillée à l'horizon du scénario | Référence de baseline différente de celle réellement calculée | Le fingerprint vient désormais de la timeline exacte consommée par la comparaison |
| `canonicalBalanceSheetOf` disait reconstruire le bilan du repository mais omettait Real Estate et Business Equity | Les anciens fixtures ou états sans cache perdaient des actifs non financiers | La reconstruction réutilise les deux moteurs de domaine et leurs contributions canoniques |
| La timeline repository utilisait directement la constante applicative de date | Le cache dérivé pouvait diverger d'un `DashboardState.asOfDate` futur | Les bornes sont désormais dérivées du state construit |

## Contrat du Global Financial Context

`buildGlobalFinancialContext(state, horizonMonths)` expose :

- `asOfDate`, devise de reporting et date de fin exacte ;
- Canonical Balance Sheet complet, y compris immobilier et Business Equity ;
- bilan d'ouverture du Personal Monthly Financial Model ;
- timeline Event Engine reconstruite depuis les faits ;
- baseline fingerprintée ;
- versions courantes Scenarios et Goals ;
- blockers et complétude sans transformer un inconnu en zéro ;
- version de méthode `GLOBAL_FINANCIAL_MODEL_1`.

Les garde-fous refusent :

- un horizon hors de 1–960 mois ;
- un bilan daté différemment du state ;
- un Scenario ou Decision Case dont le cut-off ou l'horizon diverge du contexte ;
- une divergence de fingerprint entre le contexte et Scenarios V2.

## Graphe de vérité

```text
Career → Tax → operating cash consequences ┐
Debt → service + liability movement         │
Portfolio → capital + market exposure       ├→ Event Engine
Real Estate → cash + asset movement         │
Business → cash + equity movement           ┘
                                                ↓
Canonical opening → Personal Monthly Financial Model
                                                ↓
                         baseline / scenario monthly paths
                                      ↓                 ↓
                                  Goals V2       Decision Lab V2
```

Le principal de dette et les mouvements de capital conservent leurs deux jambes bilan et
restent neutres sur le patrimoine net. Les coûts économiques, revenus, dépenses et taxes
ne sont jamais recréés par la couche globale.

## Persistance et Supabase

Aucune migration n'est nécessaire : le Global Financial Model ne porte que des résultats
dérivés. Persister le contexte, ses agrégats ou ses évaluations comme faits créerait une
seconde vérité. Les snapshots immuables déjà prévus par Scenarios V2 et Decision Lab V2
restent les seuls artefacts de run persistables.

La passe ne contacte pas Supabase production. Les migrations existantes, la RLS, les RPC
et les contrats de version restent inchangés.

## Hors périmètre volontaire

- refonte du cockpit Today ;
- frise Timeline globale ;
- AI Advisor / Beyonder ;
- règles fiscales, FX ou market data nouvelles ;
- nouvelles hypothèses de valorisation ;
- suppression des colonnes de compatibilité Scenarios V1.

Today + Timeline est le chantier suivant et pourra lire ce contexte sans reconstruire une
nouvelle vérité financière.
