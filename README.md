# Léo Family Office

Application patrimoniale privée, desktop-first, datée au **19 août 2026** et exprimée en EUR. Cette V1 privilégie l’exactitude des calculs, la traçabilité des données et les workflows réellement utilisables.

## Démarrage local

Prérequis : Node.js 24.

```bash
npm ci
npm run dev
```

Ouvrir `http://localhost:3000`. Sans fichier `.env.local`, le code de développement vous sera donné par un administrateur.

Pour une configuration privée durable :

```bash
cp .env.example .env.local
```

Renseigner ensuite deux valeurs longues et aléatoires :

```text
SESSION_SECRET=...
LOCAL_ACCESS_CODE=...
```

En production, l’application refuse de créer une session si ces secrets sont absents.

## Commandes de qualité

```bash
npm run lint
npm run test
npm run build
npm run check
```

## Ce qui fonctionne

- cockpit patrimonial avec provenance et incertitude visibles ;
- comptes et soldes modifiables avec historique daté ;
- ajout de transactions et mise à jour optionnelle du solde ;
- budget mensuel progressif, sans compléter silencieusement les catégories manquantes ;
- PEA / CTO, positions et contrôles de réconciliation ;
- prêt étudiant, amortissement à 0 % et arbitrage rembourser vs investir ;
- scénarios Prudent, Central, Ambitieux, Stress et Très favorable, versionnés et duplicables ;
- projection déterministe et Monte-Carlo à queues épaisses, seed reproductible, P10/P25/P50/P75/P90 ;
- trajectoires de carrière, clairement marquées comme hypothèses ;
- underwriting immobilier avec TRI, VAN, MOIC, LTV, DSCR et cash-on-cash ;
- sandbox de valorisation business equity ;
- objectifs, timeline et clôture mensuelle persistante ;
- coffre documentaire local privé avec contrôle de taille et de type ;
- exports CSV et backup JSON ;
- bouton « Explain calculation » sur les métriques structurantes.

## Stockage et persistance

Le mode exécutable autonome utilise SQLite via `node:sqlite` et crée `data/family-office.db`. Le schéma normalisé couvre les comptes, soldes, transactions, positions, dettes, revenus, budgets, scénarios, projections, immobilier, business equity, documents, décisions et clôtures.

Le schéma PostgreSQL/Supabase de production est livré dans [`supabase/migrations/202608190001_initial_family_office.sql`](supabase/migrations/202608190001_initial_family_office.sql). Il active RLS sur toutes les tables utilisateur, retire l’accès `anon`, limite le stockage documentaire et isole chaque ligne par `auth.uid()`.

Une instance Supabase n’a pas été créée ni reliée, car aucune organisation, région ou clé de projet n’a été fournie. La migration est prête ; le branchement du repository Supabase et le remplacement de la session locale par Supabase Auth sont listés dans la roadmap.

## Architecture

```text
src/app                 UI et routes Next.js
src/components          cockpit et modules métier
src/lib/engine          moteurs financiers purs et testables
src/lib/data            schéma et repository persistant local
src/lib/validation      validation des mutations
supabase/migrations     schéma PostgreSQL, RLS et storage privé
docs                    décisions, hypothèses et roadmap
```

Les composants UI n’embarquent pas les formules structurantes. Le moteur financier ne dépend ni de React ni de la base, et les scénarios ne modifient jamais les historiques `ACTUAL`.

## Sécurité

- session HttpOnly, `SameSite=Strict`, `Secure` en production ;
- double contrôle : proxy de routes + autorisation dans chaque API ;
- validation Zod de toutes les mutations ;
- limites de taille et allow-list MIME pour les documents ;
- aucun identifiant bancaire, aucune clé sensible côté client ;
- aucun ordre ni écriture vers une banque ou un courtier ;
- Supabase RLS et bucket privé prêts pour le déploiement.

Le mode local n’est pas destiné à être exposé directement sur Internet. Pour cela, finaliser Supabase Auth, déployer la migration, stocker les secrets dans l’hébergeur et exécuter un audit RLS.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Hypothèses et réconciliations](docs/ASSUMPTIONS.md)
- [Roadmap et fonctions différées](docs/ROADMAP.md)
- [Documents réels à vérifier](docs/DATA_VERIFICATION.md)
- [Configuration Supabase](docs/SUPABASE_SETUP.md)

## Déploiement Vercel

### Variables d'environnement

À créer sur les scopes **Production** et **Preview**.

| Variable | Valeur | Nature |
| --- | --- | --- |
| `DATA_ADAPTER` | `supabase` | serveur |
| `SESSION_SECRET` | 32 octets aléatoires (`openssl rand -base64 32`) | serveur, sensible |
| `LOCAL_ACCESS_CODE` | code d'accès privé | serveur, sensible |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | serveur |
| `SUPABASE_SECRET_KEY` | secret key du projet Supabase | serveur, sensible |
| `OWNER_USER_ID` | UUID de l'utilisateur Supabase Auth propriétaire | serveur |
| `SUPABASE_DOCUMENTS_BUCKET` | `family-office-documents` | serveur, optionnel |

`SUPABASE_SECRET_KEY` ne doit jamais être préfixée `NEXT_PUBLIC_`. Elle contourne RLS et
n'est lue que par `src/lib/data/supabase-client.ts`, qui porte `import "server-only"`.

`NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ne servent qu'à la bascule
vers Supabase Auth. Tant que l'accès passe par `LOCAL_ACCESS_CODE`, aucun composant client
n'appelle Supabase : les laisser vides serait trompeur, les omettre est correct.

### Séquence de mise en service

1. Appliquer les migrations Supabase, voir `docs/SUPABASE_SETUP.md`.
2. Créer les variables ci-dessus dans Vercel.
3. `npm run seed:supabase` en local, pointé sur le projet de production.
4. Déployer, puis vérifier `/login`, `/`, `/net-worth`, `/scenarios`, `/api/state`,
   `/api/export?format=csv` et une projection.

### Choix d'adapter

`DATA_ADAPTER=local` utilise SQLite dans `./data`. `DATA_ADAPTER=supabase` utilise PostgreSQL.
Sans valeur explicite, l'application choisit `supabase` si `VERCEL` est défini, `local` sinon :
le filesystem Vercel est en lecture seule et `node:sqlite` est expérimental sous Node 22.
