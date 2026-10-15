# Intégration hébergée B19 — 15 octobre 2026

**Verdict : staging Free préparé, création en attente de la saisie du mot de passe PostgreSQL par le propriétaire. B19 n'est pas clôturé.**

La production n'a reçu aucune mutation SQL, migration, donnée de test ou modification de
configuration. Aucune fusion dans `main`. B20 et B21 ne sont pas commencés.

## Référence GitHub et conservation

- Dépôt : `leojacques-code/Leo-Family-Office`.
- HEAD distant source vérifié : `claude/peaceful-wozniak-r1kd0d`,
  `0f7ad7369f219f7fdd26ee963386e9800b53a99e`.
- L'écart avec `749ac119b4679d06b6f94caa711b0cad39528c3e` est bien de 14 commits.
- Branche d'intégration : `codex/astra-b19-hosted-integration-20261015`.
- Les deux annexes du commit `269161cdf2af7095161e861c8dc6c6b9d0ea1dc5` sont préservées
  par le commit distant `74416dedc53734877dea535600dca9f04d39ffa3`.
  Aucun merge d'historiques, aucun fichier applicatif repris de l'archive.
- Les onze empreintes du manifeste et le SHA-256 de l'archive ont été vérifiés.
  Le patch concerne la devise des projections et leur affichage, sur une ancienne base.
  Son utilité est documentaire : sa recette réelle et sa validation financière manquent.
  Il reste inactif. Une recherche bornée de motifs de credentials n'a trouvé aucun motif
  suspect dans ces onze fichiers ; cela ne constitue pas une certification exhaustive.

Sources lues : `CLAUDE.md`, passation du 12 octobre, précontrôles SQL, registre UX du
25 septembre, spécification V10 et dossier consolidé fournis. V10 actif prime sur ses
annexes historiques ; les décisions fondateur sont conservées.

## Audit Supabase en lecture seule

Projet `zwgrcznzymbfdiybeuvv`, organisation `wniscyevfmnmtzbmjwlx`, état
`ACTIVE_HEALTHY`, région `eu-west-1`, PostgreSQL `17.6.1.155`.

| Contrôle constaté | Résultat |
|---|---|
| Historique distant | 45 migrations, dernière `20260909190841` |
| Historique du dépôt | 64 migrations |
| Différence des ensembles de versions | 19 absentes ; aucune version distante hors dépôt |
| `public.lfo_verify_session(uuid,uuid)` et schéma `lfo_private` | Absents |
| `form_drafts`, `liability_events`, `liability_contract_versions` | Absents |
| `loan_insurance_policies`, `transaction_corrections`, `liability_terms_transitions` | Absents |
| B19 : `document_field_decisions` et migration `20261012140000` | Absents |
| Tables publiques | 107 ; toutes sous RLS |
| Politiques publiques | 107 ; toutes contiennent un prédicat `auth.uid()` |
| Grants directs `anon` sur les tables publiques | Aucun |
| Grants `anon`/`authenticated` sur `auth.users` et `auth.sessions` | Aucun |
| Fonctions publiques `SECURITY DEFINER` | Deux helpers de gel ; chemin vide, EXECUTE refusé à anon/authenticated |
| Contraintes publiques non validées | Aucune |
| Advisor sécurité | Avertissement historique : protection des mots de passe compromis désactivée |

Trois fonctions `lfo_guard_*` ont EXECUTE hérité mais retournent `trigger` : elles ne sont
pas des RPC métier ordinaires. Ce constat n'est pas présenté comme un accès métier démontré.

Ces lectures ne prouvent pas l'isolation A/B de la nouvelle branche : les nouvelles tables
et RPC ne sont pas déployées. Aucun compte de test n'a été créé sur la production.

Les signatures `lfo_verify_session`, `lfo_save_form_draft`, `lfo_record_debt_event` et
`lfo_open_schedule_extraction` ont aussi été vérifiées directement : absentes. Les RPC
communes `lfo_correct_document_extraction_field` et `lfo_validate_document_extraction`
existent déjà pour la liasse ; leur présence ne prouve pas l'extension B19. Voir
`rpc-signatures.json`.

### Précontrôles P0–P7 exécutés

Les SELECT de `PRECONTROLES_MIGRATIONS_2026-10-12.sql` ont été exécutés dans une transaction
`READ ONLY`, avec retour agrégé et alias non ambigus, puis `ROLLBACK`.

- P0 : historique attendu.
- P1 : zéro référence croisée sur chacune des 24 relations.
- P2 : 24 noms de clés étrangères attendus présents.
- P3 : les 6 index composites attendus présents.
- P4 : zéro défaut de complétude, de nombre de paiements ou de dates dans les dettes existantes.
- P5 : zéro observation future parmi les trois catégories vérifiées.
- P6 : l'exécuteur `postgres` a USAGE sur Auth et SELECT sur les deux tables ; les 5 colonnes
  attendues existent. Le propriétaire effectif et les permissions de la fonction créée en
  staging devront encore être relus après migration.
- P7 : aucune collision des nouveaux schémas, tables, colonnes et contraintes recherchés.

Preuves sans données personnelles : `preuves/integration-b19-2026-10-15/production-readonly.json`.
Le manifeste `migrations.json` donne les 64 chemins et SHA-256, dans l'ordre des versions,
avec la présence distante de chacun. Il vérifie le delta de versions, pas l'égalité octet
par octet des 45 migrations déjà appliquées ni l'absence de toute dérive du schéma.

### Storage

Les deux buckets existants sont privés : `family-office-documents` (8 Mio) et
`family-office-import-staging` (32 Mio). CSV et XLSX figurent dans leurs types permis.
Les quatre politiques du coffre vérifient le premier répertoire égal à `auth.uid()` ;
UPDATE comporte USING et WITH CHECK. Aucune politique client du bucket d'acquisition n'a été
trouvée : les dépôts y reposent sur les tickets signés du serveur. Aucun objet n'a été lu.

### Historique de la migration B19

La migration a changé dans `14965ee`, `0284a9b`, puis `f5231bf` ; la passation affirme des
applications locales jetables uniquement. Sa version est absente de la production auditée.
SHA-256 conservé : `4796ddf240dd703665c0042e21f8598bd0bd61cc8df9b8ce8252b71bbbf1b7e3`.
Le fichier n'a pas été réécrit pendant cette intégration.

Aucune base partagée ayant reçu une version précédente n'est identifiée. L'absence sur
la production ne prouve pas l'absence sur une base externe inconnue. Avant toute application
à une cible existante, relire son historique et, si cette version existe, comparer son SQL
enregistré. Une différence exige une migration additive, jamais un remplacement d'historique.

## Staging gratuit : décision exécutée et étape manuelle restante

Le fondateur a fixé un plafond absolu de **0 €** et autorisé la pause temporaire de
`leo-leaning` après audit non destructif, puis la création d'un projet distinct `lfo-staging`.
Aucun passage Pro, abonnement, carte, supplément ou ressource payante n'est autorisé.

### Audit préalable de `leo-leaning`

Projet `vsitqibxhgcyrayzwyjb`, région `eu-north-1`. Les requêtes d'audit ont été exécutées
en transaction `READ ONLY`, sans contenu métier ni identifiant personnel dans les preuves.
L'accès SQL avait d'abord échoué ; il a fonctionné lors de la vérification complémentaire.

| Contrôle | Constat avant pause |
|---|---|
| Auth | 10 utilisateurs ; dernière connexion le 19 août 2026 à 17:38 UTC |
| Activité Auth sur 7 / 30 jours | 0 / 0 utilisateurs |
| Sessions | 18 historiques ; dernière mise à jour le 19 août ; aucune sur 7 jours |
| `hub_profiles` | 10 lignes ; dernière modification le 3 août |
| `hub_progress` | 10 lignes ; dernière modification le 19 août |
| `hub_plan` | 1 ligne ; dernière modification le 28 juillet |
| Modifications métier sur 30 jours | 0 sur les trois tables |
| Storage | 0 objet |
| Edge Functions, serveurs externes, triggers webhook | Aucun |
| Extensions | Pas de `pg_cron`, `pg_net` ou wrapper externe |
| Connexions SQL observées | Services internes Supabase seulement |
| Console Integrations | Data API et Vault seulement ; aucun dépôt GitHub connecté |
| Site Vercel `leo-learning`, production | Déploiement READY au SHA `02d60151613b15758842fe614465eba493a8fe02` |
| Source exacte de ce déploiement | `CLOUD_ENABLED = false`, URL et clé Supabase vides, référence du projet absente |
| Configuration Vercel `leo-learning` | Aucune variable d'environnement |
| Autre projet Vercel `ubique` | Aucun nom de variable Supabase ; valeurs non déchiffrées |

Les journaux récents examinés ne montrent pas de trafic utilisateur établi : les événements
Auth relevés sont des démarrages et une erreur de connexion interne. Des événements système
ne sont pas assimilés à des requêtes utilisateur. Une absence de trafic sous rétention
courte, prise seule, n'aurait pas suffi à autoriser la pause.

L'ensemble de ces constats ne révèle pas de dépendance active à maintenir. La pause autorisée
a été exécutée par le connecteur ; retour `success: true`, puis statut **INACTIVE** vérifié.
Ce n'est ni une suppression ni une réinitialisation. Les données et configurations restent
sur le projet. Ne pas restaurer ce projet alors que LFO et le staging occupent déjà les deux
emplacements Free ; attendre l'interruption autorisée de la recette puis pauser le staging.

### Offre et formulaire de création vérifiés

L'organisation `wniscyevfmnmtzbmjwlx` indique toujours `plan: free`, `tier: tier_free`.
Avant pause, le formulaire signalait la limite de deux projets actifs ; après pause, cet
avertissement a disparu et le formulaire Free est disponible. Aucun paiement ni montant non
nul n'est demandé. Cela confirme le parcours gratuit, sans constituer un devis contractuel.

Formulaire préparé, **non soumis** : nom `lfo-staging`, région `eu-west-1`, Postgres standard,
Data API activée, exposition automatique des nouvelles tables désactivée. Aucun dépôt GitHub
relié pour éviter une application automatique des migrations avant leur contrôle. Aucun
trigger RLS supplémentaire créé par la console : les politiques du dépôt restent à appliquer
et vérifier. Les grants effectifs devront être contrôlés après les 64 migrations.

Les outils `get_cost` et `confirm_cost` sont annoncés par le connecteur mais indisponibles
côté serveur (`not returned by tools/list`). L'outil `create_project` exige l'identifiant de
confirmation ainsi indisponible ; aucun faux identifiant n'a été utilisé.

Le parcours web demande de définir un mot de passe PostgreSQL. Les règles du navigateur
imposent de passer la main au propriétaire avant saisie d'un nouvel identifiant secret et
de lui laisser la saisie et la soumission. Le champ est resté vide. Aucun secret n'a été
généré, lu ou consigné. La création reste donc à terminer par le propriétaire dans le
formulaire préparé, sans accepter aucune offre payante.

Preuves : `preuves/integration-b19-2026-10-15/free-staging-audit.json` et
`preuves/integration-b19-2026-10-15/lfo-staging-free-creation-20261015.jpg`.

| Projet | Référence | État vérifié à ce point |
|---|---|---|
| LFO production | `zwgrcznzymbfdiybeuvv` | ACTIVE_HEALTHY ; aucune mutation |
| `leo-leaning` | `vsitqibxhgcyrayzwyjb` | INACTIVE, pause confirmée |
| `lfo-staging` | Pas encore attribuée | Formulaire préparé ; projet non créé |

**Dépense engagée : 0 €.** Ni la configuration Production de Vercel ni la production
Supabase ne sont modifiées. Aucun nouveau compte, objet Storage ou donnée de test créé.

Référence officielle : [Billing FAQ — projets Free actifs et pauses](https://supabase.com/docs/guides/platform/billing-faq).

## Vercel : constat et préparation

Projet `prj_4YJeECIQaqDOEE8KodN6PotWaQfd`, équipe `team_imid03bTUOHeFNRs7h5Hu81R`.
Les neuf variables observées restent limitées à **Production**. Aucune valeur secrète de
production n'a été déchiffrée ou importée. La nouvelle branche requiert
`SUPABASE_PUBLISHABLE_KEY`, absent de cet inventaire ; l'ancien `NEXT_PUBLIC_*_ANON_KEY`
ne le remplace pas automatiquement dans le client Auth serveur.

Le déploiement `dpl_222QYRcPiPijM8J2NbtJCVVrBrYp`,
`https://leo-family-office-79w8wft0s-lech1.vercel.app`, est READY au SHA source `0f7ad736…`.
Ce statut décrit son build. Ce n'est pas une preview B19 fonctionnelle certifiée.
SSO est configuré sur `all_except_custom_domains` ; aucune protection n'a été désactivée.
Les anciens déploiements conservent potentiellement leur configuration d'origine : changer
les scopes actuels ne prouve pas leur absence d'accès historique à la production.

Un garde-fou est ajouté au build et avant la création des clients serveur Auth/données :
en `VERCEL_ENV=preview`, il exige une référence staging distincte de la production, deux URL
HTTPS strictement identiques sur ce staging, les deux copies de la même clé publiable moderne,
une clé serveur et aucun mode de fixture locale. Le refus porte un code fermé sans secrets.
Il n'ajoute aucune règle à l'environnement Production et ne sécurise pas rétroactivement les
anciens déploiements. Une preview sans staging échoue volontairement avant compilation.

Variables à créer **uniquement sur Preview et la branche d'intégration**, une fois le
staging créé et contrôlé :

| Variable | Valeur attendue |
|---|---|
| `LFO_STAGING_SUPABASE_PROJECT_REF` | Référence exacte du staging |
| `SUPABASE_URL` | URL du staging |
| `SUPABASE_PUBLISHABLE_KEY` | Clé `sb_publishable_` du staging |
| `SUPABASE_SECRET_KEY` | Clé serveur du staging, secrète, jamais NEXT_PUBLIC |
| `NEXT_PUBLIC_SUPABASE_URL` | Même URL du staging |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Même clé publiable du staging, malgré le nom historique |
| `SUPABASE_DOCUMENTS_BUCKET` | `family-office-documents` |
| `SUPABASE_IMPORT_STAGING_BUCKET` | `family-office-import-staging` |

`OWNER_USER_ID`, `LOCAL_ACCESS_CODE` et `SESSION_SECRET` ne doivent pas servir à substituer
une session fictive aux deux comptes réels de recette.

## Protocole de reprise après création Free

1. Vérifier que `lfo-staging` est bien créé dans l'organisation Free, sans supplément, et
   identifier sa référence avant toute mutation. Ne copier aucune donnée de production.
2. Sur ce projet vierge, appliquer les **64 migrations dans l'ordre** du manifeste, après
   contrôle de l'historique vide. Ne pas appliquer seulement les 19 absentes de production.
3. Contrôler historique, définitions, contraintes, propriétaires, grants, RLS, buckets et
   advisor. Exécuter les vérifications sur la cible explicitement identifiée.
4. Créer des clés staging, configurer les huit variables ci-dessus, Site URL et allowlist
   des retours `/auth/confirm` pour la seule preview retenue. Conserver PKCE et les cookies
   HttpOnly/Secure ; le callback existant n'accepte que `code`, avec destination relative fixe.
5. Déployer depuis un commit GitHub identifié. Relire les métadonnées du déploiement et son
   ciblage avant inscription ou dépôt documentaire. Conserver la protection Vercel.
6. Exécuter la matrice ci-dessous sur la vraie fiche Dette, puis seulement proposer B20.

## Matrice de recette hébergée

**Tous les parcours ci-dessous sont BLOCKED / NOT_RUN, faute de staging.**

| Périmètre | Actions et preuves attendues |
|---|---|
| Auth A/B | Inscription avec confirmation, connexion, déconnexion, reconnexion ; refresh ; lien expiré/autre navigateur ; session révoquée ; aucun objet fictif injecté |
| Isolation | B ne lit/modifie/rattache ni les objets de A, ni son document, son historique, son brouillon ou un lien signé ; tester UI, API, RLS et Storage avec identifiants connus |
| Premier compte/revenu | Solde et date déclarés, premier revenu observé, correction motivée, relecture après reconnexion ; cohérence Aujourd'hui, Patrimoine, Flux |
| Dette 3B | Encours seul ; contrat adaptatif ; assurance séparée ; événements, avenants, annulation, versions ; brouillon incomplet puis consommation explicite ; persistance |
| B19 CSV/XLSX | Dépôt réel, objet privé conservé, lien de pièce, cellules et localisation fidèles, candidats, correction motivée, confirmation, exclusion, journal |
| B19 refus | Cellule illisible non corrigée, fichier tronqué, contrôles non calculables, lecture incomplète, format interdit ; aucun succès inventé |
| B19 reprise | Interruption/reconnexion, conflit de révision, redépôt en revue refusé sans perdre les décisions, refus explicite puis nouveau dépôt, panne Storage/API et reprise |
| Cohérence | Valider une lecture ne crée pas de lignes canoniques `loan_schedules` ; rattachement réservé à B20, dû/payé/prévu à B21 |
| Visuel réel | Captures desktop 1440×900, tablette 900 px, mobile 390 px, vrai dossier Dette authentifié ; clavier, toucher, focus, défilement, thèmes |

L'encours seul reste importable sans contrat artificiel au lot B20, conformément à
l'arbitrage fondateur. La règle de redépôt déjà implémentée conserve les décisions : aucun
remplacement silencieux d'une lecture en revue.

## Limites UX/UI et sécurité restant à valider

La revue côte à côte existante est conservée. Ses tests de composants et l'ancienne page
temporaire avec réseau simulé ne valent pas recette de la vraie fiche. Aucune capture de
cette session n'est annoncée comme preuve responsive. Les tailles de texte/contrôles hors
B19, les deux h1, les titres et rails Sources restent dans la revue transversale prévue.
Objectifs et Décisions gardent leurs phases de refonte ; aucun déplacement silencieux.

Les politiques, permissions et sessions de staging doivent être testées sous deux identités,
pas seulement lues par un administrateur. La génération de lien signé doit vérifier le
propriétaire avant l'accès privilégié. Les paramètres Auth hébergés, SMTP/confirmation, PKCE,
Storage réel, erreurs et reprises ne sont pas certifiés par cette session.

## Vérifications locales

Code applicatif publié : `c52781869bfe3d093cca95dc5603139e194f7d09`.
Les journaux de cette session figurent dans `preuves/integration-b19-2026-10-15/`.

| Vérification exécutée | Résultat |
|---|---|
| Tests ciblés Auth/configuration/B19 | 7 fichiers, 67 tests PASS |
| Première suite complète, concurrence par défaut | 185 fichiers PASS, 1 échec de délai à 5 s dans `account-form.test.tsx` ; 2 588 tests PASS |
| Reprise isolée du formulaire bancaire | 5 tests PASS sans modification du test |
| Suite complète avec `--maxWorkers=2` | 186 fichiers, 2 589 tests PASS |
| `npm run lint` | PASS |
| `npm run check:conflict-markers` et `git diff --check` | PASS |
| `npm run build`, sans cible Preview | PASS, compilation et vérification TypeScript incluses |
| `VERCEL_ENV=preview npm run build`, sans staging | Refus attendu `PREVIEW_SUPABASE_CONFIGURATION_REFUSED` avant compilation |
| Build Vercel de `c527818…` | Même refus constaté sur `dpl_6T4tSva1cgaE8mnz3prRPKzsSbyP`, état ERROR attendu ; logs joints |

L'échec de délai initial n'est pas masqué. Les reprises passent ; la cause précise de ce
premier dépassement n'est pas démontrée. Aucune assertion ni aucun timeout n'a été affaibli.

La protection de preview est donc aussi observée sur Vercel, mais aucune recette fonctionnelle
hébergée n'a été réalisée. Aucun gate SQL local complet n'est annoncé : PostgreSQL et la pile
Auth/PostgREST/Storage locale ne sont pas disponibles dans cet environnement.
