# Goals V2 — architecture

## Responsabilité

Goals V2 est la couche canonique d'intention : elle décrit une cible et évalue si une
valeur canonique ou une trajectoire Scenarios V2 la satisfait. Elle ne crée aucun fait,
événement, cash-flow, scénario, conseil ou optimisation.

```text
Canonical Balance Sheet ──► current metric
GoalVersionDefinition  ────► operator / target / deadline
ScenarioPath           ────► projected metric
                              │
                              ▼
                      Goal Evaluation Engine
```

## Persistance

- `goals` reste l'identité mutable légère et le pointeur `current_version`.
- `goal_versions.payload` contient chaque définition immuable.
- Toute modification importante crée une nouvelle version sous verrou optimiste.
- Pause, achievement explicite et archivage changent le cycle de vie via un RPC dédié et
  créent également une version, afin que la définition courante soit exacte.
- Une évaluation reste dérivée. Aucun résultat financier n'est persisté par Goals V2.

## Registre de métriques

Le registre est fermé et typé. Chaque entrée déclare sa source, son unité, sa direction,
son éventuel besoin d'entité et ses capacités CURRENT / PROJECTED.

Métriques projetables depuis `ScenarioPath` :

- `NET_WORTH`
- `LIQUID_NET_WORTH`
- `IMMEDIATE_CASH`
- `INVESTMENT_ASSETS`
- `TOTAL_LIABILITIES`
- `FUNDING_GAP`

Métriques courantes supplémentaires, non projetées faute de série canonique distincte :

- `LIQUID_ASSETS`
- `CONTRACTUAL_DEBT`
- `SPECIFIC_DEBT_BALANCE`
- `REAL_ESTATE_VALUE`
- `BUSINESS_EQUITY`

Goals ne reconstruit jamais une métrique manquante à partir d'une métrique voisine.

## Évaluation et statuts

- `ACHIEVED` : cible satisfaite aujourd'hui ou à la date évaluée.
- `ON_TRACK` : cible déterministe satisfaite au plus tard à la deadline.
- `AT_RISK` : cible satisfaite dans une trajectoire marquée partielle/stale, ou objectif
  sans deadline non atteint dans l'horizon disponible.
- `OFF_TRACK` : valeur calculable mais cible non satisfaite à la deadline.
- `OVERDUE` : deadline passée, observation historique disponible et cible non satisfaite.
- `NOT_COMPUTABLE` : valeur, devise, entité, historique ou horizon indispensable absent.

`AT_RISK` ne dépend donc d'aucun pourcentage caché.

Pour une deadline quotidienne, l'observation est le dernier point mensuel `<= deadline`.
Une fenêtre cible est satisfaite si au moins un point canonique de la fenêtre satisfait
l'opérateur. Aucune interpolation n'est faite.

## Monte Carlo

Une probabilité n'est calculée que depuis les chemins/samples individuels. Les seuls
percentiles P10/P50/P90 donnent `NOT_COMPUTABLE: MONTE_CARLO_SAMPLES_UNAVAILABLE`.

## Sécurité

- RLS owner sur `goals` et `goal_versions`.
- FK composite `(goal_id, user_id)`.
- RPC d'écriture `security invoker`, `search_path = ''`, exécutables uniquement par
  `service_role` conformément à la couche repository serveur.
- Aucun accès `anon`, aucune fixture de production, aucun reset.

