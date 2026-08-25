# Léo Family Office

Application patrimoniale privée, desktop-first, datée au **19 août 2026** et exprimée en EUR. Elle privilégie l’exactitude des calculs, la traçabilité et des workflows réellement utilisables.

## Architecture de persistance

Supabase est l’unique couche de persistance dans tous les environnements :

- PostgreSQL est la source de vérité des données structurées ;
- Supabase Storage, bucket privé `family-office-documents`, stocke les documents ;
- `supabase/migrations/` est l’unique source de vérité du schéma ;
- `FamilyOfficeRepository` conserve la séparation application/persistance ;
- les moteurs financiers restent des fonctions TypeScript pures. Aucune formule n’est exécutée dans PostgreSQL.

L’authentification applicative reste temporairement fondée sur `SESSION_SECRET` et `LOCAL_ACCESS_CODE`. `OWNER_USER_ID` et le client Supabase serveur sont conservés ; ce sprint ne branche pas Supabase Auth.

## Démarrage local

Prérequis : Node.js 22+ et un projet Supabase de développement, ou Supabase CLI en local. Le développement ne doit jamais pointer par défaut vers la production.

```bash
npm ci
cp .env.example .env.local
```

Renseigner dans `.env.local` :

```text
SESSION_SECRET=...
LOCAL_ACCESS_CODE=...
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
SUPABASE_DB_URL=...
OWNER_USER_ID=...
SUPABASE_DOCUMENTS_BUCKET=family-office-documents
```

`SUPABASE_SECRET_KEY` et `SUPABASE_DB_URL` sont strictement serveur et ne doivent jamais être préfixées `NEXT_PUBLIC_`. La seconde n'est utilisée que par la vérification PostgreSQL read-only.

Appliquer et vérifier le schéma sur le projet de développement, puis amorcer une base vide une seule fois :

```bash
supabase migration list
supabase db push --dry-run
supabase db push
npm run db:verify
npm run seed:supabase
npm run dev
```

Le seed refuse toute cible déjà amorcée. Il n’existe aucun mode forcé et aucune suppression automatique.

## Environnements

- **Development** : Supabase CLI local ou projet Supabase de développement dédié.
- **Preview** : projet ou branche Supabase dédiée, lorsque disponible.
- **Production** : projet Supabase de production, jamais utilisé comme cible de développement par défaut.

Chaque environnement reçoit ses propres secrets serveur. Ne jamais exécuter de reset sur une base distante et ne jamais amorcer automatiquement la production au démarrage de Next.js.

## Commandes de qualité

```bash
npm run lint
npm run test
npm run build
npm run check
```

`npm run db:verify` ouvre une transaction PostgreSQL `READ ONLY`. Il échoue si les 47 tables, colonnes, contraintes, 12 RPC, permissions, RLS, policies, bucket Storage ou l'historique de migration divergent du code. Le contrôle des migrations est symétrique : une version attendue absente échoue, et une version appliquée hors du dépôt échoue aussi.

Le même contrôle s'exécute sans aucun credential, sur un PostgreSQL local jetable reconstruit depuis les seules migrations du dépôt :

```bash
npm run db:local:up
npm run gate:local
```

Le dépôt déclare 13 migrations. La production en porte deux de plus, dont le SQL réel n'a pas encore été récupéré : voir le registre des divergences dans `docs/SUPABASE_SETUP.md`. Jusqu'à sa clôture, `db:verify` contre la production échoue volontairement.

## Fonctionnalités

- cockpit patrimonial avec provenance et incertitude visibles ;
- comptes, soldes, transactions, budgets et clôtures ;
- PEA / CTO, positions et réconciliations ;
- Debt Engine V2/V2.1 et arbitrage rembourser vs investir ;
- scénarios versionnés et duplicables ;
- projection déterministe et Monte-Carlo reproductible, P10/P25/P50/P75/P90 ;
- immobilier, business equity, objectifs, exports et coffre documentaire privé.

## Schéma Supabase

Les migrations sont appliquées dans cet ordre, sans modification rétroactive :

1. `202608190001_initial_family_office.sql`
2. `202608190002_scenario_parameters.sql`
3. `202608240001_scenario_investment_allocation.sql`
4. `202608240002_cash_flow_engine_v2.sql`
5. `202608240003_debt_engine_v2.sql`
6. `202608240004_debt_engine_v2_1.sql`
7. `202608240005_supabase_only_runtime.sql`
8. `20260824230233_debt_contract_input.sql`
9. `20260824231522_debt_schedule_actual_priority.sql`
10. `20260825012954_debt_observation_user_index.sql`
11. `20260825020545_canonical_balance_sheet_v2.sql`
12. `20260825021127_liability_currency_balance_sheet_v2.sql`
13. `20260825021742_snapshot_item_owner_integrity.sql`

La migration 005 ajoute uniquement les fonctions RPC transactionnelles de persistance. Elle ne déplace aucune formule financière dans la base.
Les migrations Canonical Balance Sheet V2 enrichissent et versionnent les snapshots, sans supprimer ni écraser les données historiques ; toutes les formules restent dans les engines TypeScript.

## Sécurité

- session HttpOnly, `SameSite=Strict`, `Secure` en production ;
- validation Zod des mutations ;
- secret Supabase confiné aux modules serveur ;
- bucket documentaire privé ;
- RLS activé sur les tables exposées et aucun accès table pour `anon` ;
- fonctions RPC runtime réservées au rôle serveur.

Le client serveur utilise actuellement la secret key et contourne donc RLS. La frontière effective reste la session applicative ; Supabase Auth est une évolution séparée.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration Supabase](docs/SUPABASE_SETUP.md)
- [Hypothèses et réconciliations](docs/ASSUMPTIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Documents à vérifier](docs/DATA_VERIFICATION.md)
