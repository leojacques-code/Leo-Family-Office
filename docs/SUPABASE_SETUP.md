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
13 fichiers listés dans le README. La liste canonique vit dans le dépôt et dans
`canonicalMigrations` du verifier ; ne pas la dupliquer ici pour éviter une troisième
vérité qui se périme.

Ne jamais modifier une migration déjà appliquée. Toute évolution future reçoit un nouveau fichier. Ne jamais exécuter `supabase db reset` sur une base distante.

La migration 005 ajoute des RPC transactionnelles réservées au rôle serveur. Elles regroupent les écritures, sans déplacer les formules financières en SQL.

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

`db:verify` ouvre une transaction PostgreSQL `READ ONLY` via `SUPABASE_DB_URL`. Il contrôle les 47 tables et colonnes structurantes, contraintes, 12 RPC et leurs permissions, RLS, policies `owner_all`, bucket et policies Storage, ainsi que les versions de migration.

Le contrôle des migrations est symétrique : une version attendue absente échoue, **et** une version appliquée hors du dépôt échoue également. Une base en avance sur le dépôt signifie que `supabase/migrations/` ne reproduit plus la base, donc que le code a cessé d'être la source de vérité du schéma. Les autres inventaires restent des contrôles d'inclusion : une base peut légitimement porter des objets d'infrastructure inconnus du code applicatif.

## 4 bis. Gate local sans credential

Le schéma est vérifiable sans aucun accès distant, sur un PostgreSQL local jetable :

```bash
npm run db:local:up     # installe et démarre PostgreSQL, crée la base jetable
npm run gate:local      # reset depuis les migrations + db:verify:local + smokes
```

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
