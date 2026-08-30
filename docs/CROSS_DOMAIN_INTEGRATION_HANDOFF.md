# Cross-domain integration — handoff

## Base

- `main` initial : `aaad253fca838b405a37d93bf69cf7ef546ac366`.
- PR #34 Decision Lab V2 confirmée mergée avant le démarrage.
- Branche : `feature/cross-domain-integration`.

## Implémentation

- Global Financial Context dérivé et versionné `GLOBAL_FINANCIAL_MODEL_1`.
- Timeline reconstruite sur l'horizon exact de chaque Scenario ou Decision Case.
- Bilan, opening, baseline et versions courantes partagés par Scenarios, Goals, Decision Lab
  et l'API Projection.
- Reconstruction de secours du Canonical Balance Sheet alignée sur le repository pour Real
  Estate et Business Equity.
- Provenance globale ajoutée aux évaluations Decision Lab produites par ce chemin.
- Aucune table, migration, RPC, policy ou donnée dérivée supplémentaire.

## Tests ciblés

- alignement cut-off / horizon / baseline ;
- événement au-delà du cache 40 ans conservé sur un horizon 50 ans ;
- refus des horizons incompatibles ;
- chaîne Scenarios → Goals → Decision Lab sur la même baseline ;
- déterminisme et absence de mutation des faits ;
- reconstruction Real Estate + Business Equity sans cache de bilan.

## Gates

À compléter après le gate final :

- TypeScript : PASS
- lint zéro warning : PASS
- tests : PASS — 64 fichiers / 1 252 tests
- build : PASS — Next.js 16.3.3
- PostgreSQL local jetable / schema verifier / smokes : PENDING
- Vercel preview : PENDING
- Supabase production : jamais contactée

## Étape suivante

Après merge : Today + Timeline, exclusivement comme consommateurs du Global Financial
Context et des moteurs existants.
