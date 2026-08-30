# Decision Lab V2 — handoff

## COMPLETED

- Audit legacy et architecture documentés.
- Contrats typés `DecisionCase`, `DecisionCaseVersion`, `DecisionOption` et `DecisionRun`.
- Moteur pur `evaluateDecisionCase` au-dessus de Scenarios V2 et Goals V2.
- Comparaison 2/3 options, deltas baseline et option-à-option, opportunity cost, funding
  gaps temporels, Goals HARD/SOFT, dominance Pareto, trade-offs, blockers et provenance.
- Probabilité `NOT_COMPUTABLE` sans samples Monte Carlo ; aucune inférence depuis les
  percentiles et aucun score opaque.
- Migration additive `20260830154315_decision_lab_v2.sql`, schema verifier et smoke local
  transactionnel ajoutés. Aucune migration existante modifiée et aucun contact avec
  Supabase production.
- UI générique : sélection de 2/3 scénarios existants, Goals communs, comparaison et
  enregistrement du cas/run.
- 50 tests Decision Lab ciblés, plus 4 tests de persistance.
- `npx tsc --noEmit`, lint zéro warning, 1 246 tests et build Next.js verts.
- Smoke navigateur public : `/login` répond 200, contenu non vide, aucun overlay d'erreur.
- Trois commits locaux cohérents sur `feature/decision-lab-v2`.

## PARTIAL

- Le smoke navigateur a validé le shell public mais pas l'écran authentifié Decision Lab :
  aucun code d'accès ni environnement Supabase local n'est présent sur cet hôte.
- La migration, le schema verifier et le smoke Decision Lab sont prêts mais non exécutés
  contre un PostgreSQL réel sur cet hôte.
- La preview Vercel est construisible localement, mais aucune URL distante n'a été créée.

## BLOCKED

- PostgreSQL local : `docker`, `psql`, `postgres` et Homebrew sont absents. Le script Linux
  `db-local-up.sh` n'est pas applicable à ce Mac. Supabase production n'a pas été utilisée.
- GitHub : `gh` est absent et le remote HTTPS n'a aucun credential ; `git push` échoue par
  `could not read Username`. La branche distante et la Draft PR ne peuvent pas être créées.
- Vercel : la CLI est déconnectée. Le mode temporaire non authentifié a été refusé, car il
  téléverserait le dépôt vers une destination externe non authentifiée.

## REMAINING

1. Exécuter la reconstruction PostgreSQL locale, le verifier et tous les smokes.
2. Ouvrir l'application avec un environnement local authentifié et tester le parcours
   Decision Lab V2 complet.
3. Pousser les trois commits sur `feature/decision-lab-v2`.
4. Ouvrir une Draft PR `Decision Lab V2`, attendre les checks et la preview Vercel.
5. Inspecter la preview ; ne pas merger automatiquement.

## NEXT EXACT STEP

Sur une machine disposant de PostgreSQL local et des sessions GitHub/Vercel authentifiées :

```sh
npm run gate:local
git push -u origin feature/decision-lab-v2
gh pr create --draft --base main --head feature/decision-lab-v2 --title "Decision Lab V2" --body-file docs/DECISION_LAB_V2_HANDOFF.md
```

Puis attendre que la preview Git de la Draft PR soit `READY`, ouvrir son URL et tester le
parcours authentifié. Ne lancer aucune commande Supabase avec `--linked` et ne pas merger.

## Rapport A–Z

- A. Main initial : `main`, SHA `8b591b2f84b81d36c39be53d357f81364aff0db9`.
- B. Goals V2 + PR #33 : présents, merges #31 et #33 confirmés.
- C. Audit legacy : `docs/DECISION_LAB_V2_AUDIT.md`.
- D. Architecture : trajectoires Scenarios V2 → Goals V2 → comparaison pure.
- E. Cases/options/runs : contrats et snapshots versionnés implémentés.
- F. Scenarios V2 : `runScenarioComparison`, overlays ADD/REPLACE/CANCEL, versions exactes.
- G. Goals V2 : évaluations de trajectoire et probabilité consommées directement.
- H. Comparison engine : métriques, deltas, paires, opportunity cost et chemin des gaps.
- I. Multi-objectifs : HARD/SOFT séparés, conflits visibles, aucune moyenne.
- J. Dominance/trade-offs : dominance Pareto objective uniquement.
- K. Risk/Monte Carlo : samples requis ; sinon `NOT_COMPUTABLE`.
- L. Persistence : additive, identités + versions/runs immuables.
- M. Security/RLS : owner-only, anon révoqué, RPC serveur, FKs composites.
- N. UI : parcours générique implémenté ; smoke authentifié restant.
- O. Tests : 50 ciblés + 4 persistance ; suite complète 1 246/1 246.
- P. PostgreSQL/schema verifier/smoke : code prêt, gate non exécuté faute de runtime local.
- Q. tsc : vert.
- R. lint : vert, zéro warning.
- S. tests : verts, 63 fichiers et 1 246 tests.
- T. build : vert, Next.js 16.3.3.
- U. Vercel preview : bloquée, aucune URL.
- V. Branche distante : bloquée, absente.
- W. PR URL : bloquée, aucune PR.
- X. HEAD SHA : `6e0205179aba6c44214a0f3c695d3978d785869f` avant ce handoff.
- Y. Working tree : propre avant ajout de ce handoff ; doit être propre après son commit.
- Z. État : `NOT READY` tant que P, U, V et W ne sont pas verts.
