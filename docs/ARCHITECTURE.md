# Architecture

## Principes

1. **Traçabilité** — chaque valeur importante porte un type (`ACTUAL`, `USER_ASSUMPTION`, `MODEL_ASSUMPTION`, `EXTERNAL_DATA`, `DERIVED`, `MISSING`), une confiance et, si disponible, une source et une date.
2. **Absence de double comptage** — le bilan additionne les derniers soldes des comptes. Les positions PEA/CTO expliquent ces soldes mais ne s’y ajoutent jamais.
3. **Historique immuable** — une mise à jour de solde crée un nouvel `account_balance`; un scénario crée une nouvelle version.
4. **Moteurs indépendants** — finance, fiscalité, Monte-Carlo, immobilier et décision sont des fonctions TypeScript pures.
5. **Adapters** — l’interface ne connaît que l’état agrégé et les mutations applicatives. Le repository local peut être remplacé par un repository Supabase.

## Couches

- **UI layer** : App Router, composants React et graphiques Recharts.
- **Application/service layer** : routes `/api/state`, `/api/projection`, `/api/documents`, `/api/export`.
- **Financial engine** : compound return, inflation, FX, amortissement, VAN, TRI, MOIC, net worth.
- **Scenario engine** : overrides, versions, trajectoire déterministe et Monte-Carlo.
- **Decision engine** : comparaison multicritère dette vs investissement ; framework extensible.
- **Data layer** : interface `FamilyOfficeRepository` (`src/lib/data/repository.ts`) et deux adapters interchangeables, SQLite pour le développement et Supabase/PostgreSQL pour la production. La sélection se fait par `DATA_ADAPTER`, avec import dynamique : `node:sqlite` n'est jamais évalué en production.
- **Integration layer** : emplacements prévus pour Supabase, Open Banking, market data et imports CSV.

## Modèle Monte-Carlo

Le moteur travaille mensuellement et utilise une Student-t à 5 degrés de liberté normalisée, plus une probabilité de stress rare et un choc daté optionnel. Il évite ainsi une distribution normale naïve, sans prétendre modéliser objectivement le futur. Le seed rend chaque simulation reproductible.

Les percentiles suivent cette convention :

- P10 : environ 90 % des simulations du modèle terminent au-dessus ;
- P50 : médiane ;
- P90 : environ 10 % terminent au-dessus.

## Navigation

`src/lib/navigation.ts` est un module partagé serveur/client, sans `"use client"` et sans import
de composants. Il n'exporte que des données sérialisables et des fonctions pures. Le crash de
production `validSections.has is not a function` venait de l'export d'un `Set` depuis un module
client vers une page serveur : la sérialisation ne préserve pas les `Set`. Aucun `Set` ne doit
franchir cette frontière.

## Passage à Supabase

Le schéma de production reprend toutes les familles de données demandées, ajoute `user_id` aux tables privées, active RLS et utilise un bucket privé. Le passage en production exige :

1. créer et relier le projet Supabase ;
2. appliquer la migration et exécuter les advisors ;
3. amorcer les données avec `pnpm seed:supabase` ;
4. renseigner les variables Vercel listées dans le README.

Le repository Supabase est implémenté (`src/lib/data/supabase-repository.ts`). Il reste à
remplacer l’accès par code local par Supabase Auth SSR, ce qui rendra RLS de nouveau
contraignant : voir `docs/SUPABASE_SETUP.md`, sections 6 et 7.

## Extension vers l’ERP personnel

Les IDs sont stables, les domaines sont séparés et le moteur ne dépend pas de l’interface. Un futur cockpit ERP pourra consommer les mêmes services sans fusionner prématurément Family Office, LM Pilot, M&A ou les autres modules.
