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
- **Vérification** : `db:verify` contrôle directement PostgreSQL dans une transaction `READ ONLY`; il ne constitue jamais une seconde définition du schéma. Le contrôle de l'historique de migration est symétrique : le dépôt et la base doivent décrire la même histoire, dans les deux sens. `gate:local` rejoue ce contrôle sur une base locale reconstruite depuis les seules migrations, sans credential.

Les pages, routes et composants continuent d’appeler `getRepository()`. Aucun composant UI n’accède directement à Supabase.

## Vérité financière des consommateurs

Un écran ne construit aucune vérité financière. Il lit le Canonical Balance Sheet déjà calculé
par le repository, via les sélecteurs de `src/lib/engine/balance-sheet-view.ts` : ces fonctions
groupent, sélectionnent et soustraient des montants **déjà convertis**, elles ne résolvent aucun
taux de change et ne resomment aucun solde natif.

Trois interdits en découlent, vérifiés par les tests :

1. **Aucune addition de devises différentes.** Un total de groupe passe par `accountGroupTotal`,
   qui rend le total non calculable si une ligne n’est pas convertible.
2. **Aucune allocation reconstruite localement.** `buildCanonicalAllocation` produit la
   ventilation et doit boucler exactement sur `financialAssets` ; un résiduel non nul est un bug.
3. **Aucune valeur manquante rendue en zéro.** Un agrégat `null` s’affiche « Non calculable ».

`DashboardMetrics` sépare explicitement les deux origines : la structure patrimoniale vient du
bilan canonique (`composeDashboardMetrics`), les flux déclarés viennent de `deriveFlowMetrics`,
qui ne lit plus ni compte ni position.

## Portfolio Data Foundation

Le portefeuille a désormais deux vérités distinctes, qui ne se recouvrent jamais.

**L'état observé** (`positions`, `position_snapshots`) dit ce qu'une ligne VAUT aujourd'hui.
Il alimente seul le Canonical Balance Sheet, exactement comme avant.

**Le ledger** (`portfolio_events`) dit comment elle s'est CONSTITUÉE : ancrages d'ouverture,
apports, retraits, achats, ventes, dividendes, coupons, frais, taxes et transferts. Il ne
produit aucune ligne de bilan et n'entre dans aucun total patrimonial. `buildPortfolioLedger()`
en dérive les lots, le coût de revient, le cash d'enveloppe théorique et les écarts de
réconciliation ; le bilan reste bit pour bit identique avec ou sans ledger, ce qu'un test
vérifie.

Quatre règles fondent le moteur.

1. **Une observation n'est pas un historique.** Une enveloppe dont la profondeur d'historique
   n'est pas déclarée (`portfolio_envelope_policies.ledger_coverage_start` à `null`) conserve son
   état observé intact ; le ledger dit simplement qu'il ne l'explique pas. Aucun achat n'est
   reconstitué pour faire boucler une position.
2. **La convention d'appariement ne se devine pas.** Sans `lot_matching_method` déclarée, et dès
   qu'il existe plus d'un lot ouvert, le coût de revient cédé est `NOT_COMPUTABLE`. Avec un seul
   lot ouvert, l'appariement est mécaniquement univoque et reste calculé. La quantité, elle, ne
   dépend d'aucune convention et reste toujours connue.
3. **Aucune conversion de change.** Le FX Engine reste l'unique moteur de change. Convertir un
   flux historique à un taux non observé inventerait une opération de change : une enveloppe dont
   le ledger mélange les devises est déclarée non réconciliable, pas convertie.
4. **Aucune seconde vérité Cash Flow.** Un événement externe à l'enveloppe (apport, retrait,
   transfert) POINTE la jambe bancaire déjà classée dans `transactions` ; il n'en crée ni n'en
   reclasse aucune. Le moteur signale une jambe manquante, un écart de montant, un virement vers
   l'enveloppe classé en `EXPENSE`, ou une opération interne indûment rattachée à un compte
   bancaire. Corriger reste le travail du Cash Flow Engine.

Aucun lot, coût de revient ni PnL n'est persisté : les persister créerait une vérité qui se
périmerait à la première correction d'événement. Seuls les faits et les déclarations le sont.

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
