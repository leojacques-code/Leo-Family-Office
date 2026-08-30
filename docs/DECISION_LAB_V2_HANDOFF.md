# Decision Lab V2 — handoff

## COMPLETED

- Audit legacy et architecture documentés.
- Contrats typés `DecisionCase`, `DecisionCaseVersion`, `DecisionOption` et `DecisionRun`.
- Moteur pur `evaluateDecisionCase` au-dessus de Scenarios V2 et Goals V2.
- Comparaison de deux ou trois options, deltas, opportunity cost, funding gaps temporels,
  Goals HARD/SOFT, dominance Pareto, trade-offs, blockers et provenance.
- Probabilité `NOT_COMPUTABLE` sans samples Monte Carlo ; aucune inférence depuis des
  percentiles et aucun score opaque.
- Migration additive `20260830154315_decision_lab_v2.sql`, schema verifier et smoke
  transactionnel Decision Lab V2.
- UI générique : sélection de scénarios, Goals communs, comparaison et enregistrement du
  cas/run.
- 50 tests Decision Lab ciblés, plus 4 tests de persistance.
- `npx tsc --noEmit`, lint zéro warning, 63 fichiers / 1 246 tests et build Next.js verts.
- PostgreSQL 17.11 local jetable : reconstruction depuis zéro de 33 migrations et 79 tables.
- Schema verifier vert : 79 tables, 262 contraintes, 74 RPC, 9 triggers, 11 tables d'audit
  et 33 migrations conformes.
- Tous les smokes PostgreSQL verts, y compris Scenarios V2, Goals V2, Decision Lab V2 et
  concurrence Real Estate. Les smokes transactionnels ont rollbacké leurs écritures.
- Branche distante `feature/decision-lab-v2` publiée via la connexion GitHub du plugin.
- Supabase production n'a jamais été contactée.

## PARTIAL

- Le smoke navigateur public a validé `/login`, mais le parcours authentifié Decision Lab
  n'est pas testable sans compte de preview et environnement de données approprié.
- La preview Vercel du head de PR doit encore atteindre `READY` et être inspectée.

## BLOCKED

- Aucun blocker de code ou de base de données.

## REMAINING

1. Ouvrir la Draft PR depuis `feature/decision-lab-v2` vers `main`.
2. Attendre la preview Vercel correspondant exactement au head de la PR.
3. Vérifier que le déploiement est `READY` et que `/login` se charge sans erreur.
4. Ne pas merger automatiquement.

## NEXT EXACT STEP

Créer la Draft PR, vérifier ses checks GitHub et son déploiement Vercel, puis mettre à jour
ce handoff avec l'URL et le SHA finaux. Ne lancer aucune commande Supabase avec `--linked`.

## Rapport A–Z

- A. Main initial : `main`, SHA `8b591b2f84b81d36c39be53d357f81364aff0db9`.
- B. Goals V2 + PR #33 : présents, merges #31 et #33 confirmés.
- C. Audit legacy : `docs/DECISION_LAB_V2_AUDIT.md`.
- D. Architecture : trajectoires Scenarios V2 → Goals V2 → comparaison pure.
- E. Cases/options/runs : contrats et snapshots versionnés implémentés.
- F. Scenarios V2 : overlays ADD/REPLACE/CANCEL et versions exactes.
- G. Goals V2 : évaluations de trajectoire et probabilité consommées directement.
- H. Comparison engine : métriques, deltas, paires, opportunity cost et chemin des gaps.
- I. Multi-objectifs : HARD/SOFT séparés, conflits visibles, aucune moyenne.
- J. Dominance/trade-offs : dominance Pareto objective uniquement.
- K. Risk/Monte Carlo : samples requis ; sinon `NOT_COMPUTABLE`.
- L. Persistence : additive, identités + versions/runs immuables.
- M. Security/RLS : owner-only, anon révoqué, RPC serveur, FKs composites.
- N. UI : parcours générique implémenté ; smoke authentifié limité par l'environnement.
- O. Tests : 50 ciblés + 4 persistance ; suite complète 1 246/1 246.
- P. PostgreSQL/schema verifier/smoke : verts sur PostgreSQL 17.11 local jetable.
- Q. tsc : vert.
- R. lint : vert, zéro warning.
- S. tests : verts, 63 fichiers et 1 246 tests.
- T. build : vert, Next.js 16.3.3.
- U. Vercel preview : en attente de la Draft PR.
- V. Branche distante : `feature/decision-lab-v2` publiée.
- W. PR URL : en attente de création.
- X. HEAD SHA : à relever après publication finale du handoff.
- Y. Working tree : propre après commit du handoff.
- Z. État : `NOT READY` uniquement tant que la preview Vercel du head final n'est pas `READY`.
