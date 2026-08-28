# Goals V2 — audit legacy

Point de départ : `main` au merge `52ce813137d8fd25f2dba11ff3d5dd5f0b186b2e`
(PR #28 Scenarios V2).

## État observé

- `public.goals` contient 2 objectifs `ACTIVE` en production.
- Colonnes : `id`, `user_id`, `name`, `target_amount`, `target_date`, `priority`, `status`.
- RLS activée avec une politique `owner_all` limitée à `auth.uid() = user_id`.
- Index de lecture : `(user_id, priority)`.
- Aucune table de versions, aucun snapshot d'évaluation, aucune référence scénario.
- L'UI suppose implicitement `NET_WORTH AT_LEAST target_amount` en devise de reporting.
- La mutation `add_goal` écrit directement dans la table sans version ni contrat de métrique.
- Today ne lit que le premier objectif trié par priorité et réutilise la même hypothèse Net Worth.
- Timeline et Decision Cases ne calculent actuellement aucun état Goal.

La production possède 29 migrations, jusqu'à
`20260828131433_fec_corporate_acquisition_fk_indexes`. La migration Scenarios V2
`20260828180000_scenarios_v2.sql` est présente dans le repository mergé mais sa promotion
reste un chantier d'infrastructure séparé. Goals V2 ne la modifie pas.

## Matrice de décision

| Primitive | Décision | Motif |
| --- | --- | --- |
| `goals` | EXTEND | Conserve l'identité et les deux lignes existantes. |
| `target_amount` / `target_date` / `priority` | KEEP | Compatibilité de lecture et backfill explicite de la version V2. |
| `status` | EXTEND | Ajout d'`ARCHIVED` et cycle de vie contrôlé. |
| `goal_versions` | EXTEND | Nouveau snapshot JSON immuable, minimal pour la reproductibilité. |
| `add_goal` | DEPRECATE | Conservée pour compatibilité, remplacée dans l'UI par les RPC V2. |
| calcul Net Worth dans la page | REPLACE | Remplacé par le registre typé et le moteur pur. |
| `CanonicalBalanceSheet` | REUSE | Source exclusive des valeurs courantes. |
| `ScenarioPath` | REUSE | Source exclusive des valeurs projetées. |
| Monthly Model / Event Engine | REUSE INDIRECT | Goals consomme leur sortie Scenarios, sans les appeler ni les réimplémenter. |
| Today summary | MIGRATE | Lecture compacte du résultat courant V2, sans refonte Today. |
| Timeline / Decision Lab | KEEP | Contrat préparé, aucune nouvelle logique dans cette PR. |
| évaluation persistée | KEEP DERIVED | Calcul à la lecture ; pas de seconde vérité financière. |
| milestones statiques / FIRE cards | DEPRECATE | Repères non canoniques retirés de la page Goals V2. |

## Risques legacy traités

- Les anciens objectifs n'avaient ni métrique ni devise explicites. Le backfill les marque
  comme compatibilité historique `NET_WORTH / AT_LEAST` et reprend la devise de reporting
  du propriétaire, au lieu d'inventer une devise globale.
- `NULL` n'est jamais converti en zéro : une métrique incomplète remonte ses blockers.
- Une deadline quotidienne observe le dernier point mensuel disponible `<= deadline` ;
  aucune interpolation n'est créée.
- Une dette, une entreprise ou un bien ciblé exige un `entityId` réel.
- Les percentiles Monte Carlo existants ne sont jamais transformés en probabilité.

