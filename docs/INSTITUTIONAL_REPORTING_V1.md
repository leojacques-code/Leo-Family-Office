# Institutional Reporting V1

## Audit et sources canoniques

| Élément                                                     | Décision            | Raison                                                           |
| ----------------------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| Bilan canonique, Global Financial Context                   | KEEP / REUSE        | Seule vérité patrimoniale, date, devise et baseline.             |
| Event Engine, Today V2, Goals V2, Decision Lab V2, Beyonder | REUSE               | Reporting restitue leurs résultats sans formule de domaine.      |
| `MonthlyClose`                                              | REUSE               | Seule source ponctuelle effectivement conservée pour les revues. |
| `/api/export` CSV/JSON                                      | KEEP                | Export brut distinct du document institutionnel.                 |
| View model Reporting et PDF                                 | EXTEND              | Couche pure à la demande ; aucune persistance.                   |
| Reconstitution historique depuis l'état courant             | DEPRECATE / REPLACE | Interdite ; une lacune devient `NOT_COMPUTABLE`.                 |
| Migration                                                   | AUCUNE              | Aucun rapport, PDF, résultat ou paramètre dérivé n'est persisté. |

`buildInstitutionalReport` reçoit un `DashboardState` déjà isolé par le repository serveur. Il
compose un manifest et des sections triées, puis calcule un fingerprint stable. L'heure technique
est fournie uniquement au renderer PDF et n'entre jamais dans le fingerprint financier.

## Matrice de calculabilité et honnêteté historique

| Rapport          | Source historique minimale | Comportement sans source             |
| ---------------- | -------------------------- | ------------------------------------ |
| Current Snapshot | contexte canonique actuel  | rapport partiel                      |
| Monthly Review   | une ou deux clôtures       | ponctuel ou non calculable           |
| Annual Review    | clôtures de l'année        | sections historiques non calculables |
| IC Memo          | Decision Case/version      | memo de surveillance incomplet       |

Le repository transporte les colonnes existantes `version`, `reporting_currency`,
`completeness_status` et `composition`. Pour chaque date, seule la plus haute version est retenue ;
`created_at`, puis l'identifiant, départagent les égalités. Deux versions du même jour ne forment
jamais deux périodes. La sélection est partagée avec Today/Timeline, qui alimentent Beyonder.

Une variation exige deux dates distinctes, une même devise historique connue, une complétude
`COMPLETE`, deux valeurs finies et une convention de composition compatible. Les quatre clés
persistées par `lfo_create_monthly_close_v2` identifient `CANONICAL_BALANCE_SHEET_V2` ; un JSON legacy
vide ou une forme inconnue ne prouve pas cette convention et bloque la comparaison. Une version de
méthodologie explicitement différente la bloque également. Chaque valeur conserve sa propre devise ;
`UNKNOWN` ne devient jamais la devise actuelle. `NULL` reste inconnu, zéro reste zéro et une base
nulle interdit le ratio. La composition est celle de chaque clôture, sans reconstruction actuelle.

Le repository lit intégralement les trois tables Decision Lab avec filtre propriétaire, pagination
et ordre total. Il suit `current_version` sans repli vers une version antérieure. Il sélectionne le
dernier run par date d'enregistrement puis identifiant, et prend exclusivement le résultat de cette
ligne. Les deux côtés de chaque association vérifient `user_id`, le cas et sa version. Les snapshots
sont validés avant exposition ; un snapshot invalide produit un blocker et aucun résultat de secours.
Une identité legacy reste visible, sans transformer ses anciens `inputs/results` en run V2.

Le mémo exige un run `CURRENT`, la version exacte du cas, la date canonique et le fingerprint
applicable à l'horizon du cas. Il vérifie également les références, les événements de baseline et
l'égalité complète du run et de la définition dans le résultat. Sinon les impacts sont
`NOT_COMPUTABLE`, sans conclusion, avec blockers et provenance historique.

## Structure

- **Current Snapshot** : synthèse, bilan, liquidité, cash-flow, dette, portefeuille, immobilier,
  Business Equity, carrière, fiscalité, Goals, décisions, événements, Beyonder, qualité et preuves.
- **Monthly Review** : deux dernières clôtures réellement disponibles et limites historiques.
- **Annual Review** : première et dernière clôture de l'année explicitement choisie.
- **IC Memo** : question, options enregistrées, résultats Decision Lab disponibles, risques,
  preuves et prochaine décision humaine. Il n'ajoute aucune option et aucune recommandation.

Chaque montant porte date, devise, nature, calculabilité et moteur/source. Les états `ACTUAL`,
`OBSERVED`, `CONTRACTUAL`, `PROJECTED`, `USER_ASSUMPTION` et `MODEL_ASSUMPTION` restent distincts.

## Contrat PDF et sécurité

`GET /api/reports/pdf` exige la session, valide une allow-list de types, borne l'année et
l'identifiant de Decision Case et `expectedFingerprint`, puis reconstruit le rapport depuis le
repository serveur. L'interface transmet le fingerprint exact de l'aperçu. Une différence renvoie
HTTP 409 et demande de recharger l'aperçu. L'année et le cas sélectionnés entrent dans le fingerprint ;
les paramètres inactifs sont normalisés. Aucun montant ni contenu financier client n'est accepté.
Le writer Node produit directement les objets PDF et la pagination : aucun HTML utilisateur,
JavaScript, formule, URL, navigateur, police distante ou secret client n'est exécuté. Le texte est
borné, nettoyé des contrôles et échappé pour la syntaxe PDF. La réponse porte `application/pdf`, un
nom fixe sûr, `private, no-store` et `nosniff`. Le document n'est ni journalisé ni conservé.

Le writer ne nécessite aucune dépendance d'exécution supplémentaire. La conversion Unicode vers
Windows-1252 est explicite, après normalisation NFC ; `é è à ç œ ’ — • €` sont préservés. Les scalaires
non représentables sont remplacés par `?` et les octets non ASCII sont échappés en octal dans le PDF,
jamais tronqués par `Buffer.from(unicode, "latin1")`. PDF.js est une dépendance de développement
verrouillée pour l'extraction texte indépendante, en plus des tests de structure et d'offsets.

## Tests, déploiement et rollback

Exécuter les tests Reporting et route PDF, TypeScript, lint, suite complète, build, puis le gate
PostgreSQL local. Vérifier `%PDF`, la taille, les en-têtes, `/login`, la protection de `/reports` et
un téléchargement authentifié sur la preview. Déployer comme tout build Next.js, sans migration.
Rollback : revenir le commit applicatif ; aucune donnée, table, bucket ou artefact n'est à annuler.

Les clôtures legacy sans métadonnées fiables restent visibles mais ne permettent pas de variation.
Aucune migration n'est nécessaire : les colonnes et les tables utilisées existent déjà.
