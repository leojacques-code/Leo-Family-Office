# Scenarios V2 — audit initial

Date de l'audit : 2026-08-28  
Base Git : `main` au merge commit `83bd34f1eb75553ccf4891fec7f249c5692e5297`  
Dépendance : Event Engine V1 présent et mergé via la PR #27.

## Doctrine

Un scénario n'est pas une copie du patrimoine. Il est une version immuable d'overrides et
d'hypothèses appliqués à une baseline canonique datée. Les moteurs Career, Tax, Debt,
Portfolio, Real Estate et Business restent propriétaires de leurs faits et de leurs
formules. L'Event Engine orchestre leurs conséquences et le Monthly Model déroule le bilan.

## Inventaire KEEP / REUSE / EXTEND / MIGRATE / DEPRECATE / REPLACE

| Primitive actuelle                                       | Décision                           | Motif / cible V2                                                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scenarios`                                              | **KEEP + EXTEND**                  | Identité, métadonnées et pointeur `current_version`. Les colonnes V1 restent compatibles, mais ne sont plus la définition principale d'une trajectoire.            |
| `scenario_versions`                                      | **REUSE**                          | Source immuable et reproductible de chaque définition V2. Le `payload` JSONB contient overlays, inventaire d'hypothèses, cut-off, horizon et paramètres de marché. |
| `scenario_assumptions`                                   | **MIGRATE + DEPRECATE**            | Table legacy actuellement vide en production. Les anciennes clés restent lisibles ; les nouvelles versions figent leur inventaire dans le payload.                 |
| `simulation_runs`                                        | **EXTEND**                         | Doit référencer version exacte, as-of, baseline, event set, mode, horizon et snapshot des hypothèses.                                                              |
| `simulation_results`                                     | **KEEP**                           | Snapshot de résultat d'un run, jamais vérité patrimoniale canonique. Les percentiles existants restent compatibles.                                                |
| `annual_return`, `annual_volatility`, `annual_inflation` | **MIGRATE**                        | Deviennent des market assumptions typées et sourcées dans la version V2. Les colonnes restent un cache de compatibilité V1.                                        |
| `monthly_savings`                                        | **DEPRECATE**                      | Compatibilité simplifiée seulement. Dès que la timeline canonique est disponible, le surplus provient des conséquences Career/Tax/Cash Flow.                       |
| `investment_allocation_rate`                             | **REUSE**                          | Règle explicite d'allocation, jamais implicite. Elle migre dans le contrat V2.                                                                                     |
| `salary_growth`                                          | **DEPRECATE**                      | Ne doit pas devenir un mini Career Engine. Une évolution de rémunération passe par un événement Career.                                                            |
| `stress_probability`, `shock_year`, `shock_magnitude`    | **MIGRATE**                        | Inputs explicites de l'uncertainty model, séparés de la structure déterministe.                                                                                    |
| `lfo_update_scenario`                                    | **KEEP pour V1 + REPLACE pour V2** | Compatibilité inchangée ; une RPC V2 atomique créera une nouvelle version au lieu d'écraser la définition.                                                         |
| `lfo_duplicate_scenario`                                 | **EXTEND**                         | Duplique l'identité et la version V2 courante sans recopier le patrimoine canonique.                                                                               |
| `lfo_save_simulation`                                    | **EXTEND**                         | Persiste la provenance reproductible complète du run.                                                                                                              |
| `Scenario` TypeScript                                    | **KEEP + EXTEND**                  | Les champs V1 restent disponibles ; la définition V2 courante est optionnelle pour les anciens fixtures.                                                           |
| `runDeterministicModel`                                  | **KEEP**                           | Compatibilité et tests V1.                                                                                                                                         |
| `runDeterministicEventModel`                             | **REUSE**                          | Transition canonique pour baseline et scénarios V2.                                                                                                                |
| `runMonteCarlo`                                          | **EXTEND**                         | Même transition mensuelle ; seuls les inputs de marché explicitement aléatoires changent.                                                                          |
| `applyScenarioOverrides` Event Engine                    | **REUSE**                          | Sémantique unique `ADD / REPLACE / CANCEL`, avec cibles métier stables.                                                                                            |
| page Scenarios V1                                        | **REPLACE progressivement**        | Liste, détail, timeline de changements, inventaire d'hypothèses et comparaison baseline/scénario.                                                                  |
| `/api/projection`                                        | **EXTEND**                         | Route serveur authentifiée ; accepte et sauvegarde la version exacte utilisée.                                                                                     |
| Goals / Decision Cases                                   | **KEEP hors scope**                | Consommateurs futurs des trajectoires, deltas et distributions. Aucun moteur parallèle dans cette PR.                                                              |
| Real Estate / Business scenario helpers                  | **KEEP**                           | Outils de domaine spécialisés ; Scenarios V2 peut les appeler mais ne recopie pas leurs formules.                                                                  |
| `career_scenarios`                                       | **KEEP**                           | Fait/hypothèse Career propriétaire du domaine, pas remplacement du scénario patrimonial global.                                                                    |

## Audit production Supabase en lecture seule

Projet `zwgrcznzymbfdiybeuvv`, PostgreSQL 17.6 :

- 5 scénarios, 5 versions, 0 ligne dans `scenario_assumptions` ;
- 5 runs et 155 points de simulation ;
- 27 migrations appliquées, identiques au dépôt avant Scenarios V2 ;
- RLS activé sur les cinq tables Scenarios/Simulation ;
- politiques `owner_all` basées sur `(select auth.uid()) = user_id` ;
- aucun accès `anon` ;
- Event Engine non persistant et présent dans `main` ;
- aucun nom de scénario ni montant personnel lu pendant l'audit.

La production contient donc de vraies données legacy à préserver. La migration V2 devra
être additive, backfiller une définition V2 pour chaque scénario existant et conserver les
runs historiques.

## Défauts legacy à corriger

1. Une version ne fige aujourd'hui que la ligne plate `scenarios`.
2. Un run ne référence pas la version exacte utilisée.
3. `as_of`, baseline reference, mode, event set et assumptions snapshot sont absents.
4. Les relations `scenario_id` et `run_id` ne garantissent pas toutes la cohérence du
   `user_id` par FK composite.
5. Plusieurs FK n'ont pas d'index couvrant orienté selon leurs lectures/cascades.
6. La page calcule encore une trajectoire depuis `monthlySavings` et ne compare pas à une
   baseline Event Engine.
7. Le Monte Carlo persiste des percentiles reproductibles par seed, mais pas l'intégralité
   des inputs qui rendent le run autonome.

## Architecture cible

```text
Canonical DashboardState @ asOf
        │
        ├── Domain adapters ──> Canonical baseline timeline
        │
ScenarioVersionDefinition
  ├── ADD / REPLACE / CANCEL overlays
  ├── explicit assumptions + provenance
  ├── market uncertainty model
  └── capital allocation rule
        │
        ▼
Event Engine applyScenarioOverrides
        │
        ▼
Canonical monthly consequences
        │
        ▼
Personal Monthly Financial Model
        │
        ├── deterministic baseline / scenario / delta
        └── Monte Carlo with the same transition
```

Les événements antérieurs ou égaux au cut-off observé ne peuvent pas être remplacés ou
annulés par une simulation prospective. Un backtest devra utiliser un contrat distinct.

## Migration prévue

La migration sera créée avec la CLI Supabase et restera additive :

- enrichissement de `simulation_runs` ;
- FK composites d'ownership et indexes couvrants ;
- nouvelles RPC V2 `security invoker`, accessibles seulement à `service_role` ;
- backfill des cinq versions legacy vers un payload V2 compatible ;
- aucune fixture et aucun push production avant revue.

Les tables existantes restent celles exposées au Data API. Tout nouveau privilège sera
explicite, conformément au changement Supabase 2026 sur l'auto-exposition des objets.
