# Architecture

## Principes

1. **Traçabilité** — chaque valeur importante porte un type, une confiance et, si disponible, une source et une date.
2. **Absence de double comptage** — le bilan additionne les derniers soldes ; les positions expliquent ces soldes sans s’y ajouter.
3. **Historique immuable** — un solde crée un snapshot daté et un scénario crée une version.
4. **Moteurs indépendants** — les calculs financiers, Cash Flow, Debt, Monte-Carlo, immobilier et décision restent des fonctions TypeScript pures.
5. **Persistance unique** — Supabase PostgreSQL et Supabase Storage sont obligatoires dans tous les environnements.

## Couches

- **UI** : App Router, composants React et Recharts.
- **Application** : routes `/api/state`, `/api/projection`, `/api/documents`, `/api/export`.
- **Moteurs** : transitions et formules financières TypeScript sans dépendance React ou base.
- **Data** : `FamilyOfficeRepository` expose l’état agrégé et les mutations. Son unique implémentation est `supabase-repository.ts`.
- **Schéma** : `supabase/migrations/` est la source de vérité PostgreSQL.
- **Documents** : bucket privé `family-office-documents`, avec métadonnées dans `public.documents`.
- **Vérification** : `db:verify` contrôle directement PostgreSQL dans une transaction `READ ONLY`; il ne constitue jamais une seconde définition du schéma.

Les pages, routes et composants continuent d’appeler `getRepository()`. Aucun composant UI n’accède directement à Supabase.

## Transactions

La migration `202608240005_supabase_only_runtime.sql` regroupe en fonctions PostgreSQL les écritures composées : compte + solde, transaction + solde dérivé, scénario + version, duplication + version, clôture + snapshot, catégorie + budget, clôture Cash Flow versionnée et simulation + percentiles.

Ces fonctions ne calculent aucune formule métier. Elles persistent des résultats déjà calculés par TypeScript. Une exception annule toute la fonction.

L’upload documentaire traverse deux systèmes : Storage puis PostgreSQL. Si l’insert des métadonnées échoue, le repository supprime immédiatement l’objet Storage créé et signale aussi un éventuel échec du rollback.

## Validation des données

Les nombres financiers obligatoires doivent être présents et finis. Une colonne obligatoire absente est traitée comme une chaîne de migrations incomplète, jamais comme zéro ou comme une valeur par défaut applicative. Les champs réellement optionnels conservent `null`.

Monte-Carlo refuse un état, un percentile ou une série contenant `NaN`, `Infinity` ou `-Infinity`. La persistance répète ce contrôle avant l’appel RPC.

## Modèle Monte-Carlo

Le moteur travaille mensuellement, utilise une Student-t à 5 degrés de liberté normalisée, une probabilité de stress rare et un choc daté optionnel. Le seed rend chaque simulation reproductible. Les percentiles portent sur le patrimoine net.

## Sécurité actuelle

L’accès applicatif reste fondé sur `SESSION_SECRET` et `LOCAL_ACCESS_CODE`. Le client serveur utilise `SUPABASE_SECRET_KEY` et `OWNER_USER_ID`; aucune clé secrète n’est exposée au navigateur. RLS et le bucket privé restent une défense en profondeur jusqu’à une future migration Supabase Auth, hors du périmètre actuel.
