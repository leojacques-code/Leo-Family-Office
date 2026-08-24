# Configuration Supabase

Supabase est la persistance unique en développement, preview et production. Utiliser des projets ou branches distincts ; le développement ne doit jamais écrire par défaut dans la production.

## 1. Environnements et secrets

Créer `.env.local` à partir de `.env.example` :

```text
SESSION_SECRET=
LOCAL_ACCESS_CODE=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
OWNER_USER_ID=
SUPABASE_DOCUMENTS_BUCKET=family-office-documents
```

`SUPABASE_SECRET_KEY` est strictement serveur. Ne jamais la préfixer `NEXT_PUBLIC_` et ne jamais l’importer dans un composant client.

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
supabase db push
```

Ordre attendu :

1. `202608190001_initial_family_office.sql`
2. `202608190002_scenario_parameters.sql`
3. `202608240001_scenario_investment_allocation.sql`
4. `202608240002_cash_flow_engine_v2.sql`
5. `202608240003_debt_engine_v2.sql`
6. `202608240004_debt_engine_v2_1.sql`
7. `202608240005_supabase_only_runtime.sql`

Ne jamais modifier une migration déjà appliquée. Toute évolution future reçoit un nouveau fichier. Ne jamais exécuter `supabase db reset` sur une base distante.

La migration 005 ajoute des RPC transactionnelles réservées au rôle serveur. Elles regroupent les écritures, sans déplacer les formules financières en SQL.

## 4. Vérifications

Après application :

```bash
npm run db:verify
supabase db advisors
```

`db:verify` est read-only et contrôle les tables/colonnes structurantes des scénarios, Cash Flow V2, Debt V2/V2.1, ledger et simulations.

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
