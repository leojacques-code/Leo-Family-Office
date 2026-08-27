# Career + Tax V2 — architecture canonique

## Chaîne de vérité

```text
career_roles + career_compensation_terms + career_events
                         │
                         ▼
              Compensation Engine pur
                         │ brut daté
                         ▼
tax_profiles + tax_rule_sets + tax_rules + tax_observations
                         │
                         ▼
                   Tax Engine pur
                         │ net cash daté
                         ▼
              adaptateur Cash Flow unique
                         │ surplus seulement si dépenses connues
                         ▼
                    Monthly Model
```

Career ne calcule aucun impôt. Tax ne crée aucun revenu ni transaction. L'adaptateur Cash Flow
ne crée aucune écriture bancaire : une transaction `ACTUAL` de revenu présente dans un mois
remplace le forecast Career/Tax. Le Monthly Model historique n'est pas réécrit ; il ne reçoit un
surplus dérivé que lorsque le net cash et les dépenses sont tous deux connus.

## Faits, projections et valeurs inconnues

Les rôles, termes et événements sont datés. Un changement de salaire crée un nouveau terme à date
d'effet. `TARGET`, `CONTRACTUAL`, `EARNED`, `PAID` et `PROJECTED` restent distincts ; seul `PAID`
rejoint le cash au mois de paiement. `ACTUAL`, `CONTRACTUAL`, `USER_ASSUMPTION`,
`MODEL_ASSUMPTION` et `PROJECTED` ne sont jamais fusionnés silencieusement.

`null` signifie inconnu et bloque la conséquence concernée. Zéro ne signifie zéro que s'il a été
explicitement déclaré. Un grant equity est un fait autonome : aucune valeur, fiscalité ou ligne de
salaire n'en est déduite sans paramètres suffisants.

## Tax Engine

Le moteur est paramétrique et versionné. Il sait appliquer des règles déclarées de cotisation,
déduction d'assiette, tranches progressives et retenue. Il sépare :

```text
brut → cotisations salariales → revenu imposable → liability annuelle
                                           └──────→ retenues/paiements/remboursements datés
```

La liability économique n'est donc jamais confondue avec le cash fiscal. Une observation peut
référencer une transaction ou un document existant mais ne duplique pas son cash. Sans profil ou
jeu de règles applicable, le résultat est `NOT_COMPUTABLE` avec `TAX_PROFILE_MISSING`,
`TAX_RULES_MISSING` ou un blocker plus précis. Aucune règle France réelle n'est livrée dans V2 :
le dépôt n'en contenait aucune qui soit vérifiée, sourcée et datée.

## Scénarios et explicabilité

Les scénarios `STAY`, `PROMOTION`, `NEW_JOB`, `UNEMPLOYMENT`, `FREELANCE` et `CUSTOM` décrivent des
hypothèses datées. La comparaison agrège brut, cotisations, cash fiscal, net, capacité d'épargne
si les dépenses sont connues, et impact cash cumulé. Elle ne recalcule jamais Net Worth : cette
trajectoire appartient au Monthly Model.

Chaque conséquence porte statut, provenance, confiance, méthode, hypothèses, blockers et flags.
Les écrans Career et Tax ne contiennent aucune formule financière ; ils rendent ces résultats et
leurs raisons d'être calculables ou non.

## Persistance et sécurité

La migration Career + Tax V2 étend `tax_profiles` et `tax_rules`, conserve `income_sources` comme
déclaration nette legacy, et ajoute les tables de faits Career, jeux de règles, observations et
items de revenu fiscal. Les résultats dérivés ne sont pas persistés. Les mutations composées sont
des RPC `SECURITY INVOKER`, réservées à `service_role`, avec RLS `owner_all`, références composites
`(id, user_id)` et index couvrants. Le smoke PostgreSQL écrit dans une transaction, teste les
refus cross-user puis rollbacke et compare les volumes avant/après.
