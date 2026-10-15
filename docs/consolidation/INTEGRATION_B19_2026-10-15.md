# Intégration hébergée B19 — 15 octobre 2026

**Verdict : BLOQUÉ avant création du staging et recette hébergée. B19 n'est pas clôturé.**

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

## Staging et coût : décision requise

L'organisation connectée est en offre **Free**. Deux projets actifs sont inventoriés : LFO et
`leo-leaning`. Seule la branche par défaut `main` existe pour LFO. Le second projet n'est pas
identifié comme staging LFO ; il n'est ni réaffecté, ni réinitialisé, ni modifié.

Le connecteur de devis échoue : `MCP tool get_cost was not returned by tools/list`.
Il n'existe donc pas de devis de compte vérifié dans cette session.

Tarifs publics consultés le 15 octobre 2026 :

- Free : deux projets actifs maximum ; Branching indisponible.
- Pro : à partir de 25 USD/mois ; les projets supplémentaires consomment du compute,
  annoncé à partir de 10 USD/mois par projet, avec 10 USD/mois de crédit compute par organisation.
- Une branche Micro démarre à 0,01344 USD/heure, soit 0,32256 USD par 24 heures et
  9,6768 USD par 720 heures, hors autres consommations. Les crédits compute et le Spend Cap
  ne couvrent pas son compute.

**Ce ne sont pas un total ferme ni une autorisation de souscription.** Le passage Pro peut
aussi facturer les deux projets existants. Le récapitulatif de la console doit confirmer le
total applicable, les tailles de compute, les taxes et la période avant accord du propriétaire.
Aucun abonnement ou staging payant n'a été créé.

Références officielles : [tarifs](https://supabase.com/pricing),
[Branching](https://supabase.com/docs/guides/deployment),
[facturation des branches](https://supabase.com/docs/guides/platform/manage-your-usage/branching).

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

## Protocole de reprise après accord

1. Obtenir le récapitulatif exact du coût et l'accord. Créer une cible isolée sans copie de
   données personnelles. Identifier sa référence avant toute mutation.
2. Si branche initialisée depuis le schéma de production : relire ses versions et appliquer
   uniquement les 19 migrations manquantes dans l'ordre du manifeste. Si projet vierge :
   appliquer les 64 migrations. Ne pas supposer qu'une branche est initialisée correctement.
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
