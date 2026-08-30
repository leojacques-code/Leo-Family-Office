# Decision Lab V2 — audit legacy et architecture

## Point de départ

- `main` initial : `8b591b2f84b81d36c39be53d357f81364aff0db9`.
- Goals V2 est présent via le merge de la PR #31 (`1a5dab0`).
- Le correctif du schema verifier est présent via le merge de la PR #33 (`8b591b2`).
- La table historique `public.decision_cases` porte une identité, `inputs jsonb` et
  `results jsonb`, mais aucune version reproductible ni aucun run immuable.

## Matrice d'audit

| Périmètre | Décision | Motif et remplacement |
| --- | --- | --- |
| `src/lib/engine/decision.ts` | DEPRECATE | Le comparateur dette/investissement local reste importable pour les régressions legacy, mais ne doit plus alimenter Decision Lab. Il capitalise localement un placement et expose des heuristiques expérimentales. |
| Tests `compareDebtVsInvest` | KEEP | Ils documentent les garanties legacy (dette à 0 %, convention de remboursement absente, aucune recommandation). |
| Page Decision Lab | REPLACE | L'écran mono-cas devient une comparaison de deux ou trois versions Scenarios V2 sur une baseline et des Goals communs. |
| `public.decision_cases` | EXTEND | Elle reste l'identité canonique du cas ; ajout de métadonnées de cycle de vie et d'un pointeur de version. |
| `inputs jsonb` / `results jsonb` | MIGRATE | Conservés pour compatibilité. Les nouvelles définitions vont dans des versions immuables et les résultats dans des snapshots de run immuables. |
| Scenarios V2 | REUSE | `runScenarioComparison` reste le seul producteur de trajectoires mensuelles et applique les overlays ADD/REPLACE/CANCEL via l'Event Engine. |
| Goals V2 | REUSE | `evaluateGoalAgainstTrajectory` et `evaluateGoalAttainmentProbability` restent les seuls évaluateurs de Goals. |
| Event Engine / Monthly Model | REUSE | Aucune transition mensuelle ni conséquence financière n'est recréée dans Decision Lab. |
| Debt, Portfolio, Real Estate, Business, Career, Tax | REUSE | Leurs conséquences arrivent par la timeline canonique ; Decision Lab ne connaît pas leurs formules. |
| Liens Debt → Decision Lab | KEEP | Le lien de navigation est conservé. Le calcul local affiché sur la page Debt reste legacy jusqu'à une migration dédiée de ce résumé. |
| Cash Flow / Real Estate / Business | EXTEND | Le parcours générique permet déjà de comparer leurs conséquences lorsque les scénarios sélectionnés portent ces événements. Aucun template non calculable n'est inventé. |
| Heuristiques `riskHaircut`, `liquidityValue` | DEPRECATE | Elles restent explicitement `MODEL_HEURISTIC / EXPERIMENTAL` dans l'API legacy et ne participent jamais à une conclusion V2. |

## Invariants retenus

1. Un `DecisionCase` porte une question, jamais une trajectoire.
2. Une `DecisionOption` référence exactement une version Scenarios V2 ou un overlay
   Scenarios V2 ; elle n'est jamais un fait financier.
3. Un `DecisionRun` fige la version du cas, les versions scénario/goal, la baseline, la
   méthodologie, le mode, le seed éventuel et les résultats dérivés.
4. Toutes les options partagent `asOfDate`, horizon, baseline et méthodologie. Une
   incompatibilité produit `INCOMPARABLE` et `INCOMPATIBLE_METHODOLOGY`.
5. Une valeur absente reste `null` et porte un blocker. Elle n'est jamais remplacée par zéro.
6. Une option partielle n'empêche pas les autres options et le cas de rester consultables.
7. La dominance est Pareto et objective : aucun Goal sélectionné dégradé, au moins un
   Goal amélioré, aucune nouvelle violation HARD, aucun nouveau blocker bloquant et aucun
   nouveau funding gap.
8. Sans samples Monte Carlo, la probabilité d'atteinte est `NOT_COMPUTABLE`. Les
   percentiles agrégés ne sont jamais convertis en probabilité.

## Architecture cible retenue

```text
CanonicalBalanceSheet + CanonicalTimeline
                 +
DecisionCaseVersion (options + goal versions)
                 ↓
Scenarios V2 / Event Engine / Monthly Model
                 ↓
ScenarioPath par option (même baseline)
                 ↓
Goals V2 par option et sur la baseline
                 ↓
DecisionComparison
  - métriques terminales et chemin des funding gaps
  - deltas baseline et option-à-option
  - impacts HARD/SOFT sans moyenne
  - trade-offs / dominance / blockers
  - provenance et staleness
```

Le premier parcours est volontairement générique : sélectionner deux ou trois scénarios
existants, sélectionner plusieurs Goals, puis comparer. Le template « rembourser vs
investir » ne devient V2 que lorsqu'un événement `EARLY_REPAYMENT` complet et une
`CONTRIBUTION` portant exactement le même capital peuvent être projetés par leurs moteurs.
Sans convention de remboursement anticipé, il reste `NOT_COMPUTABLE`.

## Persistance additive

- `decision_cases` reste l'identité légère et archive au lieu de supprimer.
- `decision_case_versions` fige la question, la baseline, les options et les Goals.
- `decision_runs` fige les définitions exactes et les résultats dérivés.
- Les versions et runs sont immuables, RLS owner-only, sans accès `anon` et écrits via les
  RPC serveur conformes à la doctrine existante.
- Un résultat de run n'est jamais relu comme état financier canonique.

## Hors remplacement immédiat

Le résumé expérimental de la page Debt n'est pas supprimé dans ce chantier : son lien vers
Decision Lab reste utile et sa suppression sans substitut ferait perdre une capacité. Il est
documenté comme legacy et ne produit déjà aucune recommandation. La page Decision Lab V2,
elle, n'importe plus ce moteur.
