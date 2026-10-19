# B19 — intégration du staging Free et recette hébergée

**En cours. B19 non clôturé. B20/B21 non commencés.**

La suite de la recette dans le navigateur authentifié et les anomalies trouvées sont suivies
dans [RECETTE_VISUELLE_B19_2026-10-19.md](RECETTE_VISUELLE_B19_2026-10-19.md).

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

Le contrôle sécurité courant remonte un avertissement Auth : protection contre les mots
de passe compromis désactivée. Aucun autre lint sécurité n'est remonté. Aucun grant public
anonyme ni droit client sur `auth.users` / `auth.sessions` n'a été relevé. Ces constats ne
remplacent pas la recette A/B. Voir la [documentation Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### Défaut de provisioning et correction additive

Le projet neuf ne donne pas implicitement à `service_role` les droits SQL attendus sur
de nombreuses tables. La migration additive `20261015130044_explicit_server_role_grants`
est appliquée sur le staging pour rétablir la persistance serveur, sans droit client supplémentaire et
sans rouvrir la suppression des cinq tables d'audit Goals/Décisions. Le verifier est
renforcé pour détecter ce défaut. Le staging contient désormais **65 migrations**.
Le contrôle courant confirme 117 tables publiques sous RLS, zéro RPC métier `lfo_%`
exécutable par `anon` ou `authenticated` (fonctions trigger exclues), deux buckets privés
et zéro ligne dans `loan_schedules`.

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

Déploiement applicatif contrôlé :

- SHA `c0331a20588428b1a03cd8aad61f9793b7d3cff2`.
- Preview READY : <https://leo-family-office-379zofqnf-lech1.vercel.app>.
- ID `dpl_rKTDNftdWJ3CZoiiTYDBpL47HBrD`, cible Preview (`target: null`).
- Alias de branche : <https://leo-family-office-git-codex-astra-b19-hosted-integ-ce3b7b-lech1.vercel.app>.

Site URL Supabase : alias de branche ci-dessus. Deux redirections exactes `/auth/confirm`
sont autorisées : cet alias et cette Preview. La configuration a été enregistrée et
relue dans le tableau de bord du **projet staging** ; aucun wildcard ni URL de production.
Preuve : [auth-redirects.jpg](preuves/integration-b19-2026-10-15/auth-redirects.jpg).
Le libellé « main PRODUCTION » de la console Supabase désigne la branche par défaut du
projet `lfo-staging`, pas le projet LFO de production.

## Recette

| Périmètre                                     | Résultat hébergé et limite                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth A/B                                      | Connexion API de deux utilisateurs distincts, refresh réel, déconnexion et ancien cookie refusé 401, reconnexion persistante : PASS. Utilisateurs synthétiques provisionnés et confirmés administrativement ; inscription et confirmation par e-mail non certifiées.                                                                                                              |
| Isolation API / RLS / Storage                 | PASS : B ne lit ni ne modifie les objets de A ; 12 contrôles sur tables sensibles, RPC serveur refusée à A/B/anon, lecture propriétaire Storage permise, lectures étrangères et dépôt dans le préfixe de A refusés. Isolation visuelle non certifiée.                                                                                                                             |
| Premier compte et revenu                      | PASS via API déployée : solde observé 3 000 €, revenu observé 2 500 € sans modification implicite du solde ; relecture persistante. Parcours visuel d'onboarding non certifié.                                                                                                                                                                                                    |
| Dette, assurance et brouillons                | PASS via API déployée : encours observé 2 000 €, contrat déclaré, assurance séparée, brouillon incomplet hors canon et conflit de version 409.                                                                                                                                                                                                                                    |
| B19 CSV / XLSX                                | PASS via vrais dépôts multipart sur la Preview : fichiers conservés dans le bucket privé, 16 cellules par document, coordonnées et feuille conservées, téléchargement signé du CSV identique octet par octet.                                                                                                                                                                     |
| Revue et reprise                              | PASS via API : correction motivée et brut conservé, révision périmée 409, exclusion puis réintégration avec historique, redépôt en revue refusé 409 sans écrasement, validation CSV/XLSX et persistance après reconnexion.                                                                                                                                                        |
| Refus documentaires / avenants / cohérence    | PASS via API : cellule illisible bloquée puis corrigée sans perdre le brut ; lecture partielle signalée même après validation ; rejet explicite puis redépôt avec historique ; PDF 400 et faux XLSX 422 ; avenant et annulation motivée conservés ; trésorerie 3 000 €, dette 2 000 €, patrimoine net 1 000 € cohérents ; Aujourd’hui et pages Dette/Patrimoine/Flux disponibles. |
| Captures bureau/tablette/mobile authentifiées | NOT_RUN : navigateur sur l'écran de connexion ; connexion utilisateur sécurisée requise.                                                                                                                                                                                                                                                                                          |

Le premier passage a trouvé un défaut réel : un revenu visant un compte étranger était
refusé par PostgreSQL mais remontait en 500. La correction du repository transforme le
refus métier `P0001` en réponse 422 à message fixe, sans information SQL ou existence de
compte. Une erreur technique de droits continue de remonter en 500. Deux tests de
régression ajoutés ; **14 tests ciblés, lint et build PASS**. La recette du même appel
sur le SHA corrigé confirme 422.

La saisie d'un motif de correction est demandée dans l'interface ; la base et la règle
existantes autorisent son absence. Une première assertion du harnais a été rectifiée en
conséquence, sans ajouter de règle produit. Deux statuts JSON de document `VALIDATED`
qui masquaient le statut de test ont également été séparés en `run_status` et `PASS`.
L'assertion initiale qui exigeait de refuser toute lecture partielle a aussi été corrigée :
le cahier B19 §3.8 et §6 permet de valider une lecture d'extrait, en conservant son périmètre
`PARTIAL` et ses avertissements, sans annoncer le coût total du prêt. Cette erreur du
harnais est conservée dans `hosted-acceptance-harness-partial-assumption.json` ; elle
ne constitue pas un défaut applicatif ni une modification de la règle produit.

## Preuves et reproductibilité

Résultat : **19 étapes HTTP applicatives et 6 groupes de contrôles de sécurité PASS**.
Les résultats applicatifs portent sur le SHA `c0331a2…`, y compris les étapes reprises
sans rejouer les écritures déjà vérifiées. Les commits de preuves ultérieurs ne modifient
pas le code applicatif ; ils ne constituent pas une nouvelle recette navigateur.

- [hosted-acceptance.json](preuves/integration-b19-2026-10-15/hosted-acceptance.json) : appels réels de l'application déployée, avec SHA et reprise des étapes déjà réussies sur ce même SHA.
- [hosted-security.json](preuves/integration-b19-2026-10-15/hosted-security.json) : six groupes de contrôles directs Auth, PostgREST/RLS, RPC et Storage, tous PASS.
- [hosted-project-status.json](preuves/integration-b19-2026-10-15/hosted-project-status.json) : organisation toujours Free, production et staging actifs, `leo-leaning` toujours en pause.
- [hosted-environment.json](preuves/integration-b19-2026-10-15/hosted-environment.json) : état courant du schéma, advisor et métadonnées du déploiement, sans secret.
- [hosted-acceptance-initial-failure.json](preuves/integration-b19-2026-10-15/hosted-acceptance-initial-failure.json) : défaut initial conservé pour audit.
- `scripts/hosted-b19-acceptance.mjs` et `scripts/hosted-b19-security.mjs` : garde-fou sur la référence staging et données réservées aux deux comptes synthétiques. Les configurations privées et accès temporaires Vercel restent hors dépôt.
- `preuves/integration-b19-2026-10-15/fixtures/` : CSV et classeur OOXML standard généré par openpyxl pour la prochaine recette visuelle. Le dépôt XLSX HTTP vérifié emploie le constructeur ZIP de fixtures du lecteur existant.

Ces données synthétiques et le staging restent disponibles pour la recette du propriétaire.
La pièce originale, le candidat extrait et les décisions sont conservés séparément.

## Travail restant avant clôture

Effectuer l'inscription et la confirmation e-mail réelles, les cas de lien expiré/autre
navigateur, le parcours Dette complet dans le navigateur authentifié et la recette
visuelle demandée en bureau/tablette/mobile (clavier, focus, toucher, défilement, thèmes).
La panne Storage/API et sa reprise contrôlée restent à éprouver. Le SMTP par défaut ne
constitue pas une configuration d'envoi générale. Aucun SMTP payant ni supplément activé.

La présence d'objets SQL, un build ou un test local ne constituent pas une recette hébergée.
La clôture B19 et le démarrage B20 restent interdits tant que cette recette n'est pas validée.

L’onglet de la Preview testée est préparé sur « Créer mon espace », champs vides
([signup-ready.jpg](preuves/integration-b19-2026-10-15/signup-ready.jpg)). La création
d’un nouveau mot de passe doit être effectuée par le propriétaire dans le navigateur ;
aucun identifiant secret n’est demandé dans le chat. Avec le SMTP par défaut, employer
une adresse autorisée par le projet Supabase. Ce passage manuel permettra de poursuivre
la recette visuelle et la vérification de confirmation, sans les certifier à l’avance.
