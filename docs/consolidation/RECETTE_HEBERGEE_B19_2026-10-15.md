# B19 — intégration du staging Free et recette hébergée

**En cours. B19 non clôturé. B20/B21 non commencés.**

## Environnement vérifié

- Organisation `wniscyevfmnmtzbmjwlx`, plan Free, aucun paiement ni supplément créé.
- Production LFO `zwgrcznzymbfdiybeuvv` : ACTIVE_HEALTHY, aucune mutation.
- `leo-leaning` `vsitqibxhgcyrayzwyjb` : INACTIVE, pause sans suppression.
- Staging distinct `bjxhnwvomoznorijauyl`, `lfo-staging`, ACTIVE_HEALTHY, eu-west-1,
  PostgreSQL 17.11.0.003. Création manuelle confirmée par le propriétaire.
- État initial contrôlé : historique vide, zéro table publique, utilisateur, bucket et objet.
- Branche `codex/astra-b19-hosted-integration-20261015`, reprise au SHA
  `e0b593b5199057754b62fa1df9a8467935808d78`.

## Migrations et schéma

Les **64 migrations historiques** ont été appliquées en ordre, depuis le projet vierge.
L'arrêt après la 52e était une expiration de contexte du connecteur, sans échec SQL.
L'historique a été relu avant reprise à la 53e ; aucune double application.

Les empreintes des 64 SQL effectivement enregistrés ont été comparées aux fichiers :
**64 correspondances exactes**, ordre compris. Le MCP attribue des horodatages de lancement ;
leur correspondance est préservée dans les preuves avant alignement des versions/noms sur
ceux du dépôt. Cette opération ne modifie aucun SQL ni objet applicatif et ne concerne
que ce staging neuf. La migration B19 n'avait jamais été appliquée sur cette cible ; son
empreinte reste `4796ddf240dd703665c0042e21f8598bd0bd61cc8df9b8ce8252b71bbbf1b7e3`.

Constats après la chaîne : 117 tables publiques, toutes sous RLS ; 124 RPC métier ;
aucune contrainte publique non validée. Les 913 contraintes de catalogue incluent les
contraintes NOT NULL exposées par cette version PostgreSQL ; ce total n'est pas assimilé
au nombre de noms requis par le verifier.

`form_drafts`, `liability_events`, `liability_contract_versions` et `document_field_decisions`
existent. Les RPC de session, brouillon, événements et revue documentaire sont réservées
à `service_role`. La fonction privée de vérification de session est SECURITY DEFINER,
propriétaire postgres, search_path vide, inaccessible à anon/authenticated.

L'advisor sécurité ne remonte aucun lint. Aucun grant public anonyme ni droit client sur
`auth.users` / `auth.sessions` n'a été relevé. Ces constats ne remplacent pas la recette A/B.

### Défaut de provisioning et correction additive

Le projet neuf ne donne pas implicitement à `service_role` les droits SQL attendus sur
de nombreuses tables. La migration additive `20261015130044_explicit_server_role_grants`
est préparée pour rétablir la persistance serveur, sans droit client supplémentaire et
sans rouvrir la suppression des cinq tables d'audit Goals/Décisions. Le verifier est
renforcé pour détecter ce défaut. L'application et ses contrôles seront consignés ci-dessous.

## Storage

Les deux buckets créés par les migrations sont privés : coffre documentaire 8 Mio,
zone d'acquisition 32 Mio. CSV/XLSX sont admis. Le coffre vérifie le premier répertoire
égal à l'utilisateur authentifié ; UPDATE comporte USING et WITH CHECK. La zone temporaire
ne possède pas de politique client ; l'accès passe par les tickets signés du serveur.
Aucun document réel de production n'est copié.

## Vercel Preview

Huit variables créées pour **Preview et la seule branche Astra**, vers le staging identifié :
référence staging, URL serveur/publique, clé publiable serveur/publique, clé secrète serveur,
et deux noms de buckets. La clé serveur est de type Secret, jamais NEXT_PUBLIC.
Les neuf variables Production et la protection SSO `all_except_custom_domains` sont conservées.
Le garde-fou de refus d'une Preview vers la production reste actif.

Déploiement, SHA final, configuration des redirections et recettes : à compléter après contrôle.

## Recette

| Périmètre | Statut à ce point |
|---|---|
| Auth A/B, inscription, connexion, reconnexion | NOT_RUN |
| Isolation UI / API / RLS / Storage | NOT_RUN |
| Onboarding, premier compte et revenu | NOT_RUN |
| Dette 3B, assurance, événements, brouillons | NOT_RUN |
| B19 CSV et XLSX sur vraie fiche Dette | NOT_RUN |
| Revue, corrections motivées, validation et reprises | NOT_RUN |
| Captures bureau/tablette/mobile authentifiées | NOT_RUN |

La présence d'objets SQL, un build ou un test local ne constituent pas une recette hébergée.
La clôture B19 et le démarrage B20 restent interdits tant que cette recette n'est pas validée.
