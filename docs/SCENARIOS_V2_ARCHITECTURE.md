# Scenarios V2 — architecture

## Invariants

1. La baseline est le bilan canonique et la timeline Event Engine observés à `asOf`.
2. L'historique `ACTUAL` ou `VERIFIED` n'est jamais réécrit par un scénario prospectif.
3. Une version de scénario est immuable et autosuffisante pour rejouer le calcul.
4. Un override vise une identité d'événement, jamais « tous les flux du mois ».
5. La structure déterministe et l'incertitude sont deux contrats distincts.
6. Le Month 0 est le bilan d'ouverture, sans rendement ni événement futur.
7. Aucun cash négatif fictif : le déficit devient un `FUNDING_GAP` explicite.
8. Aucune conversion FX implicite et aucune probabilité inventée.
9. Les résultats persistés sont des snapshots de run, pas des faits patrimoniaux.

## Ownership

| Concept                              | Propriétaire                         |
| ------------------------------------ | ------------------------------------ |
| faits réels et contractuels          | domaine canonique concerné           |
| conséquences économiques             | adaptateur de domaine + Event Engine |
| ordre, reconciliation, overrides     | Event Engine                         |
| trajectoire de bilan et funding gap  | Monthly Model                        |
| définition alternative et hypothèses | Scenarios V2                         |
| aléas de marché et seed              | uncertainty model / Monte Carlo      |
| snapshots reproductibles             | scenario version + simulation run    |

## Versioning

`scenarios` identifie le scénario et pointe vers `current_version`.
`scenario_versions` contient un `ScenarioVersionDefinition` complet. Une modification crée
toujours `version + 1` dans la même transaction. Les runs référencent le couple
`(scenario_id, scenario_version)` et embarquent les références baseline et assumptions.

Les cinq scénarios V1 de production sont convertis vers un payload V2 marqué
`legacyCompatibility`. Les colonnes plates ne disparaissent pas ; elles restent lisibles
par les anciens consommateurs pendant la migration applicative.

## Staleness

Un run historique n'est jamais modifié. Il est stale lorsque son fingerprint de baseline
diffère de celui construit aujourd'hui pour le même `asOf`. Le statut est dérivé au moment
de la lecture, pas réécrit dans l'historique.

## Explicabilité

Chaque point conserve les IDs de conséquences consommées, les blockers et l'inventaire
d'hypothèses. Le delta scénario-baseline utilise la même grille mensuelle et la même
transition, ce qui permet une attribution causale ultérieure sans recomputer avec une
méthodologie différente.
