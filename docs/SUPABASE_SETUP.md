# Configuration Supabase

Supabase est la persistance unique en développement, preview et production. Utiliser des projets ou branches distincts ; le développement ne doit jamais écrire par défaut dans la production.

## 1. Environnements et secrets

Créer `.env.local` à partir de `.env.example` :

```text
SESSION_SECRET=
LOCAL_ACCESS_CODE=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_DB_URL=
OWNER_USER_ID=
SUPABASE_DOCUMENTS_BUCKET=family-office-documents
```

`SUPABASE_SECRET_KEY` et `SUPABASE_DB_URL` sont strictement serveur. Ne jamais les préfixer `NEXT_PUBLIC_` ni les importer dans un composant client. `SUPABASE_DB_URL` sert uniquement à `db:verify` et doit viser le même environnement que les autres variables.

Environnements recommandés :

- Development : Supabase CLI local ou projet de développement dédié ;
- Preview : projet ou branche Supabase dédiée si disponible ;
- Production : projet de production isolé.

## 2. Utilisateur propriétaire

Les tables référencent `auth.users(id)`. Créer l’utilisateur propriétaire dans Supabase Auth et renseigner son UUID dans `OWNER_USER_ID`. L’application continue néanmoins d’utiliser `LOCAL_ACCESS_CODE` pour l’accès : cette exigence de FK ne constitue pas une migration Supabase Auth.

## 3. Migrations

Vérifier la CLI avec ses aides intégrées, puis inspecter l’état avant tout push :

```bash
supabase --version
supabase --help
supabase migration list
supabase db reset # cible locale uniquement
supabase db push --dry-run
supabase db push
```

Ordre attendu : celui du tri alphabétique de `supabase/migrations/`, soit à ce jour les
25 fichiers du dossier. La liste canonique vit dans le dépôt et dans
`canonicalMigrations` du verifier ; ne pas la dupliquer ici pour éviter une troisième
vérité qui se périme.

Ne jamais modifier une migration déjà appliquée. Toute évolution future reçoit un nouveau fichier. Ne jamais exécuter `supabase db reset` sur une base distante.

La migration 005 ajoute des RPC transactionnelles réservées au rôle serveur. Elles regroupent les écritures, sans déplacer les formules financières en SQL.

La migration `20260826090117_real_estate_v2` installe Real Estate V2. Elle complète `properties` (usage, quote-part détenue, dates d'acquisition et de cession, `archived`, provenance), relâche le `NOT NULL` des colonnes héritées `property_type` et `status` plutôt que de les remplir d'une valeur fabriquée, crée quatre tables de faits et neuf RPC (`lfo_save_real_estate_asset`, `lfo_archive_real_estate_asset`, `lfo_record_real_estate_valuation`, `lfo_record_real_estate_capital_event`, `lfo_delete_real_estate_capital_event`, `lfo_set_real_estate_operating_terms`, `lfo_set_real_estate_financing_link`, `lfo_delete_real_estate_financing_link`, `lfo_attribute_transaction_to_property`), ajoute la colonne d'attribution `transactions.property_id` et les index uniques `(id, user_id)` sur `properties` et `liabilities` qui servent de cibles aux clés étrangères composites. Elle ne crée aucune seconde vérité : le passif immobilier reste porté par `liabilities`, les flux réels par `transactions`.

Elle installe aussi le trigger `real_estate_financing_links_allocation_guard`, porté par la fonction `real_estate_allocation_guard` (hors nomenclature `lfo_`, qui reste réservée aux RPC appelables par `service_role`). Ce trigger est l'INVARIANT de non double comptage de dette : `authenticated` détient des droits d'écriture directs sur la table, et deux écritures concurrentes liraient le même total avant leurs insertions respectives. Le trigger verrouille la ligne du concours avant de resommer, ce qui sérialise les écrivains ; le contrôle équivalent dans la RPC n'est conservé que pour son message d'erreur lisible. Le verifier refuse une base qui aurait perdu ce trigger ou sa fonction.

La migration `20260826090347_real_estate_fk_covering_indexes` corrige un défaut de performance trouvé pendant le gate distant : les clés étrangères composites `(property_id, user_id)` de `real_estate_valuations`, `real_estate_capital_events` et `real_estate_operating_terms` n'avaient d'index que dans l'ordre inverse, `(user_id, property_id)`, inutilisable par PostgreSQL pour vérifier ou cascader une clé étrangère. Elle n'ajoute que trois index et ne touche à aucun autre objet ; les index d'origine sont conservés, ils servent les lectures par propriétaire. Même schéma que `20260825193606` pour le ledger portefeuille.

Les deux migrations Real Estate ont été appliquées en production le 26 août 2026 et contrôlées par `db:verify`, par les advisors Supabase, et par un test d'isolation exécuté sous le rôle `authenticated` réel : quote-part cumulée à 1 acceptée, au-delà refusée, accès inter-utilisateurs refusé par RLS, écritures annulées sans fixture persistée. C'est cette dernière vérification que le gate local ne peut pas produire, `auth.uid()` y restant nul.

La migration `20260826145426_business_equity_v2` a installé les faits Business Equity : types de société, quote-parts, périodes financières, valorisations, événements de capital et rattachements de holdings. `20260826145803_business_equity_effective_truth` y a ajouté l'unicité par date des périodes et des valorisations, plus les index de propriété.

La migration `20260826194551_business_equity_v2_1` installe le VALUATION ENGINE. Elle porte un invariant de schéma, pas un simple ajout de colonnes : **une valorisation dérivée n'est jamais persistée**. La contrainte `business_valuations_basis_v2_ck` impose `enterprise_value is null and equity_value is null` sur toute méthode dérivée (multiple d'EBITDA, multiple de chiffre d'affaires, DCF, tour de table, transparence des participations) ; ces deux colonnes ne restent renseignables que sur les chemins réellement observés (expertise, transaction) ou explicitement assumés comme saisie libre. Les lignes V2 qui portaient un montant saisi sous un libellé de méthode dérivée ont été renommées `USER_ESTIMATE` par la migration elle-même, leur libellé d'origine conservé en note : la mise en conformité ne perd aucune donnée et n'en invente aucune.

Elle ajoute par ailleurs quatre tables de faits — `business_ebitda_adjustments`, `business_bridge_items`, `business_dcf_assumptions`, `business_dcf_periods` — la couverture déclarée de l'historique de capital sur `businesses`, les nombres de titres sur `business_ownership`, la qualification des périodes sur `business_financials`, la distinction `amount_scope` entre distribution sociale et cash personnel sur `business_capital_events`, et quinze RPC (dont `lfo_create_business_quick_start`, `lfo_apply_business_funding_round`, `lfo_set_business_dcf` et les suppressions ciblées).

Trois contraintes d'origine sont REMPLACÉES sous un nom nouveau plutôt que modifiées : `business_ownership_rates_ck` devient `business_ownership_rates_v2_ck` et accepte une détention à 0 % — une cession totale est un fait représentable, l'ancienne contrainte la rendait insaisissable ; `business_valuations_value_ck` devient `business_valuations_basis_v2_ck` ; `business_capital_events_type_ck` devient `business_capital_events_type_v2_ck` et admet le rachat de titres. L'index unique `business_valuations_effective_uk` est remplacé par `business_valuations_effective_method_uk` : deux valorisations de MÉTHODES différentes doivent pouvoir coexister à la même date, sans quoi une expertise et une offre de transaction divergentes s'écrasent l'une l'autre au lieu d'exposer leur conflit. Le verifier interdit désormais l'ancien index, dont la présence signale une base qui n'a pas appliqué V2.1.

La migration `20260826194605_business_equity_v2_1_indexes` porte les index couvrants des clés étrangères introduites, écrits dans l'ORDRE des FK composites `(business_id, user_id)`. Même schéma que Portfolio Data Foundation et Real Estate V2 : une migration de fond, puis les index que les advisors révèlent.

La migration `20260826194644_business_equity_v2_1_blocking_invariants` ferme les quatre incohérences bloquantes identifiées en revue : changements de détention atomiques avec l'événement de capital ; Quick Start strictement calculable ; complétude explicite des autres éléments du bridge EV → Equity via `business_bridge_declarations` (`UNKNOWN`, `DECLARED_NONE`, `PARTIAL`, `COMPLETE`) ; maintien strict de `NULL ≠ ZERO` sur les hypothèses, notamment DCF.

Les trois migrations Business Equity V2.1 ont été appliquées en production le 26 août 2026. Le gate distant a vérifié : 24 migrations exactes ; nouvelles tables et contraintes présentes ; RLS `owner_all` ; `anon` sans accès ; RPC Business réservées à `service_role` ; smoke transactionnel rollbacké couvrant Quick Start, cession 100 % → 70 %, acquisition, sortie totale → 0 %, origine de l'ownership ; rejet du Quick Start sans cash ; DCF à taux fiscal 0 % explicitement accepté et taux manquant rejeté ; tentative inter-utilisateurs refusée ; aucune fixture persistée. L'advisor sécurité ne remonte aucun nouveau finding Business, uniquement le warning Auth historique `Leaked Password Protection Disabled`. L'advisor performance ne remonte aucun nouveau FK Business V2.1 non indexé. Le dernier `gate:local` complet n'a pas pu être rejoué sur la machine Claude faute de PostgreSQL local ; le gate PostgreSQL réel de production et les smokes rollbackés couvrent le blocage de livraison.

La migration `20260827155134_data_acquisition_foundation` installe la couche d'acquisition. Elle ajoute six tables — `import_sources`, `import_sessions`, `import_raw_records`, `import_normalized_records`, `import_record_links`, `import_column_mappings` — l'index unique `(id, user_id)` sur `documents` qui sert de cible à une clé étrangère composite, le trigger `import_raw_records_immutable` porté par `import_raw_record_immutable`, et quatre RPC (`lfo_analyze_import_session`, `lfo_commit_import_session`, `lfo_discard_import_session`, `lfo_save_import_mapping`).

Elle ne touche à AUCUN domaine financier : aucune colonne ajoutée à `transactions`, aucune contrainte modifiée, aucune RPC existante remplacée. Le seul point de contact est l'écriture de `public.transactions` par `lfo_commit_import_session`, avec `category_id` nul, `data_kind = 'ACTUAL'` et `manual_override = false` : une transaction importée reste NON CLASSÉE, et le Cash Flow Engine la compte comme telle sans modification.

La piste d'audit est en LECTURE SEULE : `authenticated` ne reçoit que le `SELECT` sur les six tables, et toutes les écritures passent par les RPC réservées à `service_role`. Le verifier contrôle cet état — une migration ultérieure qui referait un `grant ... on all tables in schema public` rouvrirait la brèche en silence, et le gate la refuse.

Les invariants portés par la BASE, pas par l'application :

- un enregistrement brut ne se **modifie** jamais, et ne se **supprime** que par l'abandon d'une session encore analysée — protéger seulement l'`UPDATE` laissait un `DELETE` cascader vers la ligne normalisée et son lien, en laissant survivre une transaction étiquetée « importée » sans origine ;
- une ligne normalisée **committée** est gelée (`import_normalized_records_frozen`), et le gel est EXHAUSTIF : la comparaison porte sur `to_jsonb(new) - 'matched_transaction_id'` contre son équivalent sur `old`, donc sur la ligne entière et sur les colonnes futures. Seule exception, explicite : le jumeau désigné peut passer à `null` si rien d'autre ne change — une liste manuelle de colonnes laissait réécrire `reference`, `value_date`, `counterparty`, `balance_after` et `confidence` sous couvert d'un détachement ;
- un lien de provenance est **immuable en `UPDATE` comme en `DELETE`**, et sa clé étrangère vers `transactions` est en `restrict` : ne refuser que l'`UPDATE` laissait le rôle serveur supprimer le lien, ce qui désarmait la clé étrangère et rendait la transaction supprimable sans trace ;
- un contenu de fichier ne peut être validé qu'une fois par source — `import_sessions_committed_file_uidx`, partiel sur le statut `COMMITTED`, de sorte qu'une analyse abandonnée ne bloque rien ;
- une identité DÉMONTRÉE ne s'écrit qu'une fois — `import_normalized_records_committed_external_uidx`.

Aucune unicité ne pèse sur `match_key`, et c'est un choix. Une contrainte sur `(compte, date, montant, devise, libellé)` refuserait un troisième achat réellement identique, et le refus viendrait de la base : message opaque, aucune décision possible. L'index correspondant existe pour la lecture, non pour l'unicité.

`documents_owner_storage_path_uidx` complète la conservation : le fichier d'un import validé est stocké à un chemin dérivé de son SHA-256, et cette unicité garantit qu'un objet Storage n'est décrit que par une ligne `documents`. `lfo_attach_import_document` sérialise le rattachement par un verrou consultatif sur (propriétaire, empreinte).

`import_normalized_records_ready_shape_ck` complète l'ensemble : une ligne déclarée prête ou signalée doit porter sa date, son libellé, son montant, sa devise et son compte. `READY` signifie committable ; une ligne prête incomplète produirait une transaction incomplète.

Cette migration a été corrigée EN PLACE à deux reprises après revue, **avant** son premier push. La doctrine « ne jamais modifier une migration déjà appliquée » protège un historique réel : tant que rien n'avait touché la production, empiler des correctifs aurait figé dans le schéma une sémantique de déduplication reconnue fausse et laissé au dépôt trois fichiers pour un seul état voulu. Cette latitude est désormais CLOSE : la migration est appliquée, son contenu est gelé, et toute évolution passe par un nouveau fichier.

**Cette migration a été appliquée en production le 27 août 2026**, sous la version `20260827155134`. La version du dépôt a été renommée pour correspondre exactement à l'historique réel : `supabase_migrations.schema_migrations` et `supabase/migrations/` doivent porter les mêmes 25 versions, et le verifier échoue dans les deux sens si ce n'est pas le cas. Aucune ligne de SQL n'a été modifiée par ce renommage.

Contrôles passés en production après application : six tables d'acquisition présentes ; RLS actif sur les six ; `anon` sans aucun accès ; `authenticated` en SELECT seul, sans INSERT, UPDATE ni DELETE ; cinq RPC d'acquisition réservées à `service_role` ; triggers d'immuabilité présents ; smoke analyse → validation réussi puis intégralement rollbacké ; UPDATE et DELETE d'un enregistrement brut refusés ; modification d'une ligne normalisée committée refusée ; DELETE d'un lien de provenance refusé ; suppression d'une transaction liée refusée ; isolation RLS vérifiée sous claim `authenticated` réel — propriétaire visible, autre UUID invisible. Aucune fixture persistée. L'advisor sécurité ne remonte que le warning Auth historique `Leaked Password Protection Disabled` ; l'advisor performance ne remonte aucune clé étrangère d'acquisition non indexée.

C'est le seul contrôle que le gate local ne peut pas produire : `auth.uid()` y reste nul.

La migration `20260827215014_career_tax_v2` installe Career + Tax V2 de manière additive,
sans barème France codé en dur et sans résultat calculé persisté. Elle crée huit tables de
faits ou d'hypothèses protégées par RLS et cinq RPC atomiques exclusivement exécutables par
`service_role`. La migration corrective `20260827215600_career_tax_v2_fk_indexes` ajoute les
quatre index de clés étrangères signalés après application par l'advisor PostgreSQL, sans
modifier de donnée ni de règle métier.

Les deux migrations ont été appliquées en production le 27 août 2026. L'inventaire distant
porte exactement les 27 versions du dépôt. Le smoke transactionnel a validé l'écriture
atomique d'un package de rémunération, d'un événement payé, d'un profil fiscal, d'un jeu de
règles remplacé de façon idempotente et d'une observation fiscale ; les références et
écritures cross-user ont été refusées, puis l'isolation propriétaire/tiers a été vérifiée
sous le rôle `authenticated`. Le `ROLLBACK` final a supprimé les deux utilisateurs de test
et toutes leurs données : les huit nouvelles tables sont restées vides. La migration
complète avait auparavant été appliquée puis annulée dans une transaction de prévalidation,
ce qui fournit sur le PostgreSQL cible l'équivalent du gate de reconstruction local lorsque
le runtime courant ne dispose pas d'un serveur PostgreSQL jetable.

Après la migration corrective, l'advisor performance ne signale plus aucune clé étrangère
Career + Tax non indexée ; ses seuls constats sur ce périmètre sont les index encore inutilisés,
ce qui est attendu sur des tables vides. L'advisor sécurité ne remonte que le warning Auth
historique [`Leaked Password Protection Disabled`](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
sans finding introduit par Career + Tax.

La migration `20260825193427_portfolio_data_foundation` ajoute le ledger portefeuille et ses trois RPC (`lfo_record_portfolio_event`, `lfo_delete_portfolio_event`, `lfo_set_portfolio_envelope_policy`). Elle crée aussi trois index uniques `(id, user_id)` sur `financial_accounts`, `securities` et `transactions` : ce sont les cibles des clés étrangères composites qui empêchent un événement de référencer l'objet d'un autre utilisateur. La migration `20260825193606_portfolio_fk_covering_indexes` couvre le côté référençant des deux clés étrangères signalées par l'advisor Postgres. Les deux sont appliquées en production et vérifiées par assertions SQL transactionnelles.

### Registre des divergences de schéma

Une divergence se documente, elle ne se comble pas par une hypothèse. Reconstituer du SQL depuis le nom d'une migration produirait une fausse vérité de schéma : toute reconstruction ultérieure de la base divergerait silencieusement de la production.

| Constaté le | Divergence                                                                                                                                    | État                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-25  | `20260825063626_snapshot_item_owner_fk_index` et `20260825063831_snapshot_item_fk_covering_index` appliquées en production, absentes du dépôt | Clôturée le 2026-08-25 : SQL réel extrait de la production en lecture seule, committé verbatim, historique canonique porté à 15 versions |

Procédure appliquée, à reprendre telle quelle en cas de nouvelle divergence :

```sql
select version, name, statements
  from supabase_migrations.schema_migrations
 where version in ('20260825063626', '20260825063831')
 order by version;
```

1. extraire les `statements` réels sur la production, en lecture seule ;
2. créer les fichiers de migration avec ce contenu verbatim, sans le reformuler ;
3. ajouter les versions à `canonicalMigrations` du verifier, au README et à la doc ;
4. `npm run gate:local` puis `npm run db:verify` contre la production, les deux verts ;
5. datter la clôture dans le registre et dans le message de commit.

Tant que l'étape 1 n'est pas faite, ne créer aucun fichier de migration : le dépôt doit déclarer une divergence connue plutôt qu'une migration inventée.

Ces deux migrations ne portent que des index. La seconde remplace l'index de la première : l'état final ne contient que `net_worth_snapshot_items_snapshot_owner_idx`, sur `(snapshot_id, user_id)`, qui couvre la FK composite posée par `20260825021742`. Le verifier contrôle désormais cet état final, et refuse une base qui porterait encore l'index intermédiaire : une base peut inscrire les deux versions dans son historique sans avoir appliqué la seconde.

## 4. Vérifications

Après application :

```bash
npm run db:verify
supabase db advisors
```

`db:verify` ouvre une transaction PostgreSQL `READ ONLY` via `SUPABASE_DB_URL`. Il contrôle les tables et colonnes structurantes, les contraintes, les 54 RPC et leurs permissions, les triggers qui portent un invariant financier, RLS, policies `owner_all`, bucket et policies Storage, ainsi que les versions de migration.

Le contrôle des migrations est symétrique : une version attendue absente échoue, **et** une version appliquée hors du dépôt échoue également. Une base en avance sur le dépôt signifie que `supabase/migrations/` ne reproduit plus la base, donc que le code a cessé d'être la source de vérité du schéma. Les autres inventaires restent des contrôles d'inclusion : une base peut légitimement porter des objets d'infrastructure inconnus du code applicatif.

## 4 bis. Gate local sans credential

Le schéma est vérifiable sans aucun accès distant, sur un PostgreSQL local jetable :

```bash
npm run db:local:up     # installe et démarre PostgreSQL, crée la base jetable
npm run gate:local      # reset depuis les migrations + db:verify:local + smokes
```

`gate:local` enchaîne le reset, `db:verify:local`, les smokes en rollback intégral, puis `smoke:local:concurrency`. Ce dernier est le seul à VALIDER des écritures avant de les nettoyer : prouver qu'une contrainte résiste à la concurrence demande deux transactions simultanées dont l'une doit être visible de l'autre. Il refuse donc tout hôte non local, et reste hors de `smoke:local`, qui doit demeurer exécutable contre une base réelle.

`db:local:reset` détruit sa base cible, la reconstruit à partir des seules migrations du dépôt, y inscrit l'historique correspondant et crée un propriétaire local minimal pour les smokes. Il ne lit jamais `SUPABASE_DB_URL` et refuse tout hôte non local : pointer la production est impossible.

`supabase/local/shim.sql` double les schémas gérés par la plateforme (`auth`, `storage`, `supabase_migrations`), les rôles PostgREST et les privilèges par défaut de `service_role`. Ce n'est pas une migration. Les privilèges de FONCTION en sont volontairement exclus : chaque RPC doit porter son `grant execute ... to service_role` explicite, qu'un défaut local masquerait.

Ce que le gate local prouve : les migrations reconstruisent un schéma conforme depuis zéro, les RPC transactionnelles fonctionnent, les smokes annulent intégralement leurs écritures.

Ce qu'il ne prouve pas : l'état réel de la production, l'isolation RLS effective sous un JWT (`auth.uid()` reste nul en local), le comportement réel de Storage, ni les données. Le push distant et `npm run db:verify` restent des étapes humaines.

Contrôler aussi :

- bucket `family-office-documents` privé, limite et MIME conformes ;
- RLS activé sur les tables exposées ;
- policy d’isolation par `user_id` ;
- aucun grant table pour `anon` ;
- RPC `lfo_*` exécutables uniquement par `service_role`.

## 5. Seed one-shot

Uniquement sur une base vide :

```bash
npm run seed:supabase
```

Le script vérifie les tables qu’il alimente avant la première insertion. Si une donnée existe, il s’arrête avec la liste des tables concernées. `--force` est volontairement désactivé. Le script ne supprime rien et ne doit jamais être lancé automatiquement au démarrage de Next.js.

La taxonomie Cash Flow V2 est fournie explicitement pour chaque catégorie (`cash_flow_kind`, `essentiality`, `expense_behavior`, `archived`). Aucun moteur ne la déduit de `group_name`.

## 6. Modèle de sécurité actuel

Le cookie applicatif protégé par `SESSION_SECRET` et `LOCAL_ACCESS_CODE` reste la frontière d’accès. Le client serveur utilise la secret key et contourne RLS ; sa confidentialité est donc critique. RLS reste actif comme défense en profondeur.

Une future migration vers Supabase Auth devra être traitée séparément, avec tests multi-utilisateurs et client lié au JWT de la requête. Elle ne fait pas partie de l’architecture Supabase-only actuelle.
