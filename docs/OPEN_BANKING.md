# Open Banking (AIS) : agrégation de comptes, lecture seule

Cinquième verticale de la fondation d'acquisition. Elle lit une banque par l'intermédiaire
d'un agrégateur, produit des **observations** datées, et n'écrit un fait canonique que sur
décision humaine.

Elle **étend** la fondation sans la dupliquer, et **sans élargir aucune whitelist de
domaine** : une synchronisation bancaire alimente le même domaine cible qu'un relevé CSV,
`CASH_FLOW_TRANSACTION`, et `import_sources.kind` prévoyait déjà `'API'`.

## 1. Ce que cette couche ne fait pas

**Aucune initiation de paiement.** Le contrat d'adaptateur n'expose que trois méthodes de
lecture : `listAccounts`, `listBalances`, `listTransactions`. Il n'y a ni `initiatePayment`,
ni `createTransfer`, ni `submitOrder`, et ce n'est pas un oubli. Deux contrôles le
vérifient structurellement plutôt que déclarativement :

- un test de surface sur le schéma de la route : les neuf actions sont énumérées, et aucune
  ne correspond à `payment|payout|transfer|virement|mandate|beneficiar|prelevement` ;
- une assertion SQL dans le smoke : aucune fonction `bank_*` ou `lfo_*bank*`, et aucune
  colonne d'une table `bank_*`, ne porte un nom de cette famille.

Elle ne **classe** aucun flux : une opération importée naît sans catégorie, et le Cash Flow
Engine la compte comme non classée. Elle ne **convertit** aucune devise. Elle ne **déduit**
aucun montant d'une variation de solde. Elle ne **crée** aucun compte canonique.

## 2. Les frontières qui structurent le domaine

```text
OBSERVATION ≠ FAIT CANONIQUE              PENDING ≠ BOOKED
COMPTE FOURNISSEUR ≠ COMPTE CANONIQUE     SOLDE OBSERVÉ ≠ SOLDE CANONIQUE
SOLDE ABSENT ≠ SOLDE À ZÉRO               MONTANT ABSENT ≠ ZÉRO
IDENTIFIANT FOURNI ≠ IDENTITÉ DÉMONTRÉE   RESSEMBLANCE ≠ DOUBLON
CAPACITÉ NON DÉCLARÉE ≠ CAPACITÉ ABSENTE  EXPIRATION NON DÉCLARÉE ≠ SANS EXPIRATION
PAGE VIDE ≠ FIN DE PAGINATION             CURSEUR IDENTIQUE ≠ FIN
RÉVOQUÉ ≠ EXPIRÉ                          RÉFÉRENCE DE SECRET ≠ SECRET
DATE D'OPÉRATION ≠ DATE DE VALEUR ≠ DATE DE COMPTABILISATION
```

### Les trois dates

Elles sont conservées **séparément**, et seule la date d'**opération** date le fait
canonique. Retenir la date de comptabilisation déplacerait une dépense d'un mois à l'autre
sans que rien ne le dise. Une date d'opération absente **bloque** la ligne : elle n'est
jamais remplacée par une autre.

Une date non servie par le fournisseur est signalée `BANK_VALUE_DATE_NOT_SERVED` ou
`BANK_BOOKING_DATE_NOT_SERVED` : **non servie**, pas égale à la date d'opération.

### Ce qu'un adaptateur DÉCLARE

`BankProviderCapabilities` exige que chaque champ soit renseigné : un adaptateur doit se
prononcer. Le champ décisif est `stableTransactionIds`. Un agrégateur qui ne garantit pas
la stabilité de ses identifiants n'en a pas : aucune identité n'est construite, et la
déduplication automatique est **interdite** — un identifiant réattribué rejetterait des
opérations réelles.

## 3. Réutilisation de la fondation

| Objet                                | Décision                             | Motif                                                                                                 |
| ------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `import_sources`                     | **REUSE**, table inchangée           | `kind = 'API'`, `domain = 'CASH_FLOW_TRANSACTION'` : aucune whitelist élargie                         |
| `import_sessions`                    | **REUSE**, table inchangée           | une synchronisation est un acte d'import : `RECEIVING` → `ANALYZED` → `COMMITTED`, avec ses décomptes |
| `import_raw_records`                 | **REUSE**, table inchangée           | brut par opération, immuable, numéroté dans la session                                                |
| `import_normalized_records`          | **REUSE**, table inchangée           | staging, verdicts, corrections, état de commit — tout y était                                         |
| `import_record_links`                | **REUSE**, table inchangée           | provenance du fait canonique                                                                          |
| `transactions`                       | **REUSE strict**                     | écrit par la même instruction que le socle fichier                                                    |
| `institutions`, `financial_accounts` | **REUSE**, rattachement sur décision | aucun compte ni établissement créé d'office                                                           |
| `account_balances`                   | **NON TOUCHÉE**                      | un solde observé chez un agrégateur n'est pas un solde canonique                                      |

**Aucune colonne n'est ajoutée à une table du socle**, et aucune contrainte partagée n'est
remplacée. C'est ce qui rend l'intégration future avec les autres verticales indolore sur ce
périmètre.

### Pourquoi le brut d'une API est la PAGE

Le brut d'un fichier est la ligne ; celui d'une API est la **page** : c'est elle qui est
demandée, rendue, rejouée et reprise. `bank_sync_raw_pages` la conserve telle quelle, avec
son curseur de requête, son curseur suivant et son empreinte. `import_raw_records` conserve
en parallèle le brut par **opération**, ce qui répond à une autre question : « d'où vient
cette ligne ? ». Les deux ne se recouvrent pas.

`import_raw_records.cells` est un tableau par héritage du socle fichier : l'objet JSON de
l'opération y tient une seule place, et `raw_line` porte son corps verbatim. Personne ne
peut en conclure que la source avait une colonne.

## 4. Onze tables ajoutées

| Table                           | Ce qu'elle porte                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `bank_providers`                | adaptateur, version, capacités **déclarées**, mode d'authentification, **référence** de secret |
| `bank_institutions`             | établissement tel que l'agrégateur le désigne, rattachable au canonique                        |
| `bank_consents`                 | portées, octroi, expiration **déclarée**, révocation motivée                                   |
| `bank_provider_accounts`        | compte fournisseur, distinct du canonique, rattachement daté                                   |
| `bank_sync_cursors`             | point de reprise durable et numéro de page checkpointé                                         |
| `bank_sync_runs`                | exécutions : pages, éléments, curseur de reprise, cause nommée d'un échec                      |
| `bank_sync_raw_pages`           | page brute immuable, avec empreinte                                                            |
| `bank_observed_transactions`    | observation **durable**, transverse aux synchronisations                                       |
| `bank_balance_observations`     | solde observé, par nature et par date                                                          |
| `bank_reconciliation_decisions` | décision humaine **durable** sur une observation                                               |
| `bank_sync_events`              | notifications, avec **unicité** de l'identifiant d'événement                                   |

### Les unicités qui portent un invariant

- **`bank_provider_accounts_canonical_uidx`** — un compte canonique est alimenté par **au
  plus un** compte fournisseur. Sans elle, deux comptes fournisseur rattachés au même compte
  canonique écriraient deux fois les mêmes opérations, et le patrimoine serait faux sans
  qu'aucune trace ne le dise.
- **`bank_observed_transactions_identity_uidx`** — une identité **démontrée** n'existe
  qu'une fois. Aucune unicité n'est posée sur `match_key` : une égalité de tuple ne prouve
  rien, et l'y imposer supprimerait des dépenses réelles.
- **`bank_observed_transactions_committed_uidx`** — une ligne de staging n'a produit qu'un
  fait : deux observations qui la revendiquent seraient deux vérités de la même écriture.
- **`bank_reconciliation_decisions_transaction_uidx`** — une transaction canonique n'est
  revendiquée que par une observation.
- **`bank_sync_runs_running_uidx`** — une seule exécution **en cours** par compte. C'est la
  garantie de concurrence : deux synchronisations simultanées liraient les mêmes pages et
  écriraient deux fois les mêmes observations. Portée par la base, donc valable sous
  concurrence réelle, pas par une vérification applicative.
- **`bank_sync_events_event_uk`** — protection contre le **rejeu** d'une notification. Une
  vérification applicative serait contournée par deux livraisons concurrentes.
- **`bank_balance_observations_observation_uk`** — une observation par nature et par date :
  la seconde lecture d'un même jour **corrige** la première au lieu de s'y ajouter.

Il n'y a **délibérément aucune** unicité sur l'empreinte d'une page : une synchronisation
qui relit la première page sans nouvelle opération rend légitimement le même corps. Le
rejeu est **signalé** et compté une fois, il n'est pas refusé au niveau de la page.

## 5. Secrets : ce que la base sait, et ce qu'elle ne saura jamais

Aucune table ne porte de colonne capable d'accueillir un jeton, un secret client ou une clé
de signature. C'est la garantie principale : **l'absence de colonne de valeur**. Les tables
ne portent qu'un couple `secret_vault` / `secret_key`, qui désigne un coffre **externe**.

Trois contraintes rendent l'erreur bruyante par-dessus :

- `bank_providers_secret_shape_ck` — un coffre sans clé ne désigne rien, une clé sans coffre
  ne dit pas où chercher ;
- `bank_providers_secret_reference_ck` — forme d'une **référence** : courte, sans espace.
  Une valeur de jeton porteur ne passe pas ;
- `bank_providers_auth_secret_ck` — seul un adaptateur de **fixture** peut ne s'appuyer sur
  aucun secret. Tout autre mode d'authentification exige de savoir où le secret est conservé.

La couche pure ne voit qu'une `SecretReference` : un nom de coffre et une clé, jamais une
valeur. Le schéma de la route est `.strict()` et n'a **aucun champ** où un secret pourrait
entrer : un test le vérifie pour `token`, `accessToken`, `clientSecret`, `webhookSecret` et
`apiKey`.

Tant qu'aucun coffre à secrets n'est validé pour ce dépôt, c'est tout ce que la base sait de
l'authentification — et un jeton, même chiffré, n'y a pas de place où aller.

## 6. Pagination, reprise et rejeu

```text
PAGE VIDE ≠ FIN DE PAGINATION      un fournisseur peut rendre une page vide et un curseur
CURSEUR IDENTIQUE ≠ FIN            un curseur qui ne progresse pas est une BOUCLE
MÊME EMPREINTE ≠ PAGE UTILE        une page déjà persistée est un REJEU, non recomptée
```

Seul un curseur `null` déclare la fin. Une boucle est **nommée**
(`BANK_CURSOR_NOT_ADVANCING`) et interrompue. Le plafond `MAX_PAGES_PER_SYNC = 200`
**refuse** au lieu de tronquer : la synchronisation se déclare incomplète et son curseur
reste exploitable.

Le curseur n'avance qu'**après** l'écriture réelle de la page. Une interruption reprend sur
la page suivante, jamais au-delà de ce qui est persisté. Un échec **conserve** son curseur
et ne supprime pas les pages déjà lues.

Un échec **réessayable** — 429, 5xx, timeout, erreur réseau — est retenté au plus
`MAX_ATTEMPTS_PER_PAGE = 3` fois. Un échec non réessayable — consentement expiré ou révoqué,
401, 403 — arrête la pagination **immédiatement** : réessayer un consentement révoqué ne le
ressuscite pas, et insister est ce qui fait bloquer un accès par un agrégateur.

## 7. Identité, cycle de vie et réconciliation

L'ordre des contrôles va de la preuve la plus forte à la plus faible, et s'arrête à la
première. L'inverser ferait qualifier de « ressemblance » une identité démontrée, donc
laisserait écrire deux fois la même opération.

1. **Décision humaine déjà prise** sur cette observation. Une décision prise ne se
   redemande pas, et une observation déjà écrite n'est **jamais** reproposée.
2. **Identité démontrée**, cherchée dans **tout** l'historique canonique, sans aucun filtre
   de date — une identité stable ne se périme pas. La borner à une fenêtre ferait annoncer
   « nouvelle » une opération que l'index unique refuserait ensuite, et tout le commit
   échouerait.
3. **Remplacement `PENDING` → `BOOKED`**, uniquement quand le fournisseur le **déclare** par
   l'identifiant de l'opération remplacée, et seulement s'il déclare ses identifiants
   stables. Deviner un remplacement à la ressemblance ferait disparaître une opération
   réelle le jour où deux montants identiques coexistent. Si l'opération remplacée a **déjà**
   été écrite, c'est une **correction** du fait canonique, pas une nouvelle dépense.
4. **Ressemblance**, dans une fenêtre de 3 jours, jamais une preuve. Chaque transaction
   connue n'est revendiquée qu'**une** fois : trois cafés identiques face à deux transactions
   connues en rapprochent deux et laissent le troisième **nouveau**.

Une observation illisible n'a pas d'identité : la déduplication n'est **pas évaluée**, et
`null` ne veut pas dire « nouvelle ».

Une opération en attente reste `WARNING` même déclarée nouvelle : elle est committable sur
décision, jamais d'office. Une opération **annulée** par la banque est conservée comme
observation et refusée au canonique par la base elle-même
(`bank_observed_transactions_cancelled_ck`).

## 8. Gel du brut et de la provenance

Une page brute ne se corrige pas. Sa suppression n'est ouverte que sur une exécution qui n'a
produit **aucun** fait canonique, et l'existence de l'exécution est lue
**indépendamment de la visibilité RLS de l'appelant** :

> SESSION ABSENTE ≠ SESSION INVISIBLE. Un garde-fou qui décide à partir d'une lecture
> filtrée par la RLS conclut « déjà supprimé » sur une simple absence de droit, et
> **autorise**.

`public.bank_sync_freeze_state(uuid, uuid)` rend `ABSENT`, `FACTS_WRITTEN` ou le statut de
l'exécution. `SECURITY DEFINER` y est nécessaire et non commode. Surface minimale, chaque
condition vérifiée par le gate de schéma : `stable`, `search_path` verrouillé à vide, objets
qualifiés, aucun `execute` pour `public`, `anon` ni `authenticated`, et un nom **hors** du
contrat `lfo_*` — qui reste sans aucune RPC `SECURITY DEFINER`.

Une observation qui a produit un fait est **gelée** sur ce qui décrit ce fait. L'exception
est **nommée** : `last_seen_at`, `state`, `superseded_by_observation_id` et `issues`
décrivent la vie de l'observation chez le fournisseur, pas le fait produit — une opération
revue à chaque synchronisation doit pouvoir dire qu'elle a été revue.

## 9. Parcours utilisateur couvert

Onglet **Connexion bancaire** de la page Imports, à côté de Relevé bancaire et Comptabilité :

1. créer un consentement sandbox (portées, expiration déclarée) ; 2. découvrir les comptes,
   tous **non rattachés** ; 3. rattacher un compte fournisseur à un compte canonique, ou le
   détacher ; 4. synchroniser ; 5. lire le rapport : pages, décomptes, anomalies nommées,
   curseur de reprise ; 6. voir les soldes observés, un solde non servi affiché **absent** ;
2. réconcilier : accepter, rattacher à une opération connue, ou refuser en motivant ;
3. valider, ce qui écrit les transactions et leur provenance ; 9. rejouer une
   synchronisation sans créer de doublon ; 10. révoquer le consentement ; 11. consulter
   l'historique des exécutions et les observations conservées ; 12. tester le rejeu d'une
   notification, refusé par la base.

## 10. Ce qui est DEFERRED, et pourquoi

**Aucun adaptateur d'agrégateur réel n'est fourni.** Sans contrat signé, sans identifiants
et sans réponse réelle à observer, écrire un adaptateur Bridge, Powens, Nordigen, Tink ou
Plaid de mémoire produirait un **faux support** : du code qui paraît prêt et qui échoue au
premier appel, ou pire, qui lit la mauvaise colonne et fausse des montants.

Un fournisseur réel s'ajoute dans `resolveProvider`, et il reste `BLOCKED_EXTERNAL` jusqu'à
ce qu'un contrat et des identifiants existent. Le contrat neutre est conçu pour qu'un
adaptateur réel n'ait **rien** à changer en amont : mêmes types, mêmes capacités déclarées,
même pagination.

Le fournisseur **sandbox** couvre la chaîne complète sans réseau, à partir d'un catalogue de
scénarios **côté serveur** : nominal avec page vide au milieu, `PENDING` → `BOOKED`,
correction et annulation, devise étrangère, champs manquants, identifiants non stables, 429
puis succès, 5xx persistant, consentement révoqué, 401, curseur bloqué.

Le navigateur choisit un scénario par son **nom** ; il n'en fournit jamais le contenu.
Laisser le client décrire les opérations ferait de l'écran une porte d'injection de faits
« bancaires », et un test le vérifie.

## 11. Webhooks : ce qui est implémenté, et ce qui ne l'est pas

`lfo_record_bank_sync_event` enregistre une notification, et l'unicité
`(fournisseur, identifiant d'événement)` refuse le rejeu. Un événement dont la **signature
n'a pas été vérifiée** est conservé, marqué `IGNORED`, et la base refuse de lui rattacher une
exécution (`bank_sync_events_unverified_ck`).

**La vérification de signature elle-même est `BLOCKED_EXTERNAL`** : elle dépend du schéma de
signature d'un fournisseur réel et de sa clé, qui n'existent pas ici. Aucune route publique
de réception de webhook n'est exposée, et c'est délibéré : une route publique qui accepterait
un événement sans pouvoir en vérifier la provenance serait une porte d'entrée, pas une
notification.

## 12. Fichiers

| Rôle                       | Chemin                                                    |
| -------------------------- | --------------------------------------------------------- |
| Schéma                     | `supabase/migrations/20260903120000_open_banking_ais.sql` |
| Contrat d'adaptateur       | `src/lib/acquisition/banking/types.ts`                    |
| Lecture d'une observation  | `src/lib/acquisition/banking/normalize.ts`                |
| Pagination, reprise, rejeu | `src/lib/acquisition/banking/pagination.ts`               |
| Identité et réconciliation | `src/lib/acquisition/banking/reconcile.ts`                |
| Fournisseur sandbox        | `src/lib/acquisition/banking/providers/sandbox.ts`        |
| Catalogue de scénarios     | `src/lib/data/open-banking-scenarios.ts`                  |
| Contrats de données        | `src/lib/data/open-banking-contracts.ts`                  |
| Repository                 | `src/lib/data/open-banking-repository.ts`                 |
| Validation                 | `src/lib/validation/open-banking.ts`                      |
| Route                      | `src/app/api/imports/open-banking/route.ts`               |
| Écran                      | `src/components/pages/imports/open-banking-section.tsx`   |
| Smoke                      | `scripts/smoke-open-banking.ts`                           |
