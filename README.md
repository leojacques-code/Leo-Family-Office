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

`npm run db:verify` ouvre une transaction PostgreSQL `READ ONLY`. Il échoue si les tables, colonnes, contraintes, 49 RPC, 4 triggers d'invariant, tables d'audit en lecture seule, permissions, RLS, policies, bucket Storage ou l'historique de migration divergent du code. Le contrôle des migrations est symétrique : une version attendue absente échoue, et une version appliquée hors du dépôt échoue aussi.

Le même contrôle s'exécute sans aucun credential, sur un PostgreSQL local jetable reconstruit depuis les seules migrations du dépôt :

```bash
npm run db:local:up
npm run gate:local
```

Le dépôt porte **25 migrations** ; la production en compte **24**. La 25e, `20260827093000_data_acquisition_foundation`, est verte au gate local et **n'a pas encore été poussée** : le push distant et `npm run db:verify` restent des étapes humaines, et aucun gate distant n'est déclaré vert sans avoir été exécuté. Les migrations 16 et 17 installent la fondation Portfolio puis les index couvrant ses clés étrangères. Les migrations 18 et 19 installent Real Estate V2 puis les index couvrant ses clés étrangères composites. Les migrations 20 et 21 installent Business Equity V2. Les migrations 22 à 24 installent Business Equity V2.1, ses index et ses invariants bloquants ; elles ont été appliquées en production le 26 août 2026 puis contrôlées par smokes transactionnels rollbackés, isolation `authenticated`, permissions RPC, RLS et advisors Supabase. Le registre des divergences de `docs/SUPABASE_SETUP.md` conserve l'historique de la divergence clôturée le 25 août 2026 et la procédure à reprendre si une autre apparaît.

## Fonctionnalités

- cockpit patrimonial avec provenance et incertitude visibles ;
- comptes, soldes, transactions, budgets et clôtures ;
- PEA / CTO, positions et réconciliations ;
- Debt Engine V2/V2.1 et arbitrage rembourser vs investir ;
- scénarios versionnés et duplicables ;
- projection déterministe et Monte-Carlo reproductible, P10/P25/P50/P75/P90 ;
- immobilier, business equity, objectifs, exports et coffre documentaire privé ;
- import de relevés bancaires CSV avec preview, déduplication et provenance ligne à ligne.

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
14. `20260825063626_snapshot_item_owner_fk_index.sql`
15. `20260825063831_snapshot_item_fk_covering_index.sql`
16. `20260825193427_portfolio_data_foundation.sql`
17. `20260825193606_portfolio_fk_covering_indexes.sql`
18. `20260826090117_real_estate_v2.sql`
19. `20260826090347_real_estate_fk_covering_indexes.sql`
20. `20260826145426_business_equity_v2.sql`
21. `20260826145803_business_equity_effective_truth.sql`
22. `20260826194551_business_equity_v2_1.sql`
23. `20260826194605_business_equity_v2_1_indexes.sql`
24. `20260826194644_business_equity_v2_1_blocking_invariants.sql`
25. `20260827093000_data_acquisition_foundation.sql`

La migration 005 ajoute uniquement les fonctions RPC transactionnelles de persistance. Elle ne déplace aucune formule financière dans la base.
Les migrations Canonical Balance Sheet V2 enrichissent et versionnent les snapshots, sans supprimer ni écraser les données historiques ; toutes les formules restent dans les engines TypeScript.
La migration 16 ajoute le ledger portefeuille (`portfolio_events`, `portfolio_envelope_policies`) et ses RPC. Aucun lot ni coût de revient n'y est persisté : ces grandeurs sont dérivées par `src/lib/engine/portfolio.ts`. La migration 17 couvre les clés étrangères du ledger avec leurs index dédiés.
Les migrations 14 et 15 ne portent que des index de `net_worth_snapshot_items` : la 15 remplace l'index de la 14, l'état final couvrant la FK composite `(snapshot_id, user_id)`.

Les migrations 20 et 21 installent les faits Business Equity et leur vérité datée. La migration 22 installe le VALUATION ENGINE et porte l'invariant central du domaine : **une valorisation dérivée n'est jamais persistée**. `business_valuations_basis_v2_ck` interdit une Enterprise Value ou une Equity Value sur une méthode dérivée ; la base ne stocke qu'un multiple, une base financière, des retraitements d'EBITDA (`business_ebitda_adjustments`), des éléments de pont (`business_bridge_items`), des paramètres de DCF (`business_dcf_assumptions`, `business_dcf_periods`) et les termes d'un tour de table. EV, Equity Value, fourchette, valeur attribuable, MOIC et XIRR sont dérivés par `src/lib/engine/business-valuation.ts` et ses voisins. Elle relâche aussi la détention à 0 % — une cession totale est un fait — et remplace l'unicité par date des valorisations par une unicité par date ET méthode, pour qu'une expertise et une transaction divergentes coexistent au lieu de s'écraser. La migration 23 ajoute les index couvrants dans l'ORDRE des clés étrangères composites `(business_id, user_id)`. La migration 24 ajoute la complétude explicite du bridge EV → Equity, les changements de détention atomiques avec leur événement et le Quick Start strict : une donnée inconnue ne devient jamais zéro.

La migration 25 installe la Data Acquisition Foundation : six tables de staging (`import_sources`, `import_sessions`, `import_raw_records`, `import_normalized_records`, `import_record_links`, `import_column_mappings`), le trigger d'immuabilité `import_raw_records_immutable` et quatre RPC. Elle ne touche à AUCUN domaine financier : son seul point de contact est l'écriture de `transactions` avec `category_id` nul, donc une opération importée reste NON CLASSÉE et le Cash Flow Engine la compte comme telle. L'idempotence est portée aux deux seuls endroits où l'identité est démontrable : un contenu de fichier ne se valide qu'une fois par source, et un identifiant de transaction dont la stabilité est DÉCLARÉE ne s'écrit qu'une fois — cherché dans tout l'historique, sans filtre de date. Aucune unicité ne pèse sur une simple égalité de tuple — elle refuserait un troisième achat réellement identique. La piste d'audit est en lecture seule pour `authenticated`, le brut est immuable, la provenance d'un fait écrit est gelée, et la clé étrangère du lien de provenance est en `restrict` : une transaction importée ne peut pas perdre son origine. Voir `docs/DATA_ACQUISITION.md`.

La migration 18 installe Real Estate V2 : quatre tables de faits (`real_estate_valuations`, `real_estate_capital_events`, `real_estate_operating_terms`, `real_estate_financing_links`), les colonnes canoniques de `properties`, la colonne d'attribution `transactions.property_id`, neuf RPC et le trigger `real_estate_financing_links_allocation_guard`. Ce trigger est le seul endroit où la règle « la somme des quote-parts d'un même concours ne dépasse jamais 1 » est réellement garantie : il verrouille la ligne de dette, donc il tient sous concurrence et sur une écriture directe hors RPC. Elle ne crée AUCUNE seconde vérité : la dette immobilière reste une ligne de `liabilities` à laquelle le bien se rattache par une quote-part, et les flux réels restent des lignes de `transactions` simplement rattachées à un bien. Rendement, equity, plus-value et coût économique du financement sont dérivés par `src/lib/engine/real-estate.ts`. Les tables héritées `mortgages` et `real_estate_cashflows` y sont marquées obsolètes et ne sont ni lues ni écrites. La migration 19 ajoute les index couvrants dans l'ORDRE des clés étrangères composites `(property_id, user_id)` des trois tables de faits.

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
