# Intégration de la fondation d'acquisition

Ce document décrit ce que l'INTÉGRATION a produit, et rien d'autre. Chaque verticale garde son
propre document : `DATA_ACQUISITION.md` (relevé bancaire CSV), `FEC_ACQUISITION.md`,
`COMPANY_REGISTRY_ACQUISITION.md`, `DOCUMENT_INTELLIGENCE.md`, `REAL_ESTATE_PUBLIC_DATA.md`,
`PORTFOLIO_IMPORT.md`, `OPEN_BANKING.md`. Ce fichier ne les répète pas : il dit ce qui n'existait
dans AUCUN d'eux, parce que personne ne l'avait vu depuis une seule verticale.

## 1. Ce que l'intégration a démontré

Cinq verticales ont été développées en parallèle sur des branches distinctes, chacune verte sur
son propre gate. Rejouées ENSEMBLE depuis une base vide, elles ont produit six conflits réels sur
les objets qu'elles partagent. **Trois d'entre eux étaient SILENCIEUX** : aucune migration
n'échouait, la base se construisait, et le refus n'arrivait qu'à la première écriture d'une
verticale, loin de sa cause.

C'est la valeur du rejeu complet, et c'est ce que ni la revue de diff ni un smoke de verticale
unique ne pouvaient voir : un `add constraint ... if not exists` sur un nom déjà pris par une
autre verticale ne fait rien, sans erreur, et laisse en vigueur la version la plus ÉTROITE.

Règle appliquée partout dans la réconciliation : **élargir, jamais remplacer par plus étroit**, et
lire la définition RÉELLEMENT ACTIVE par `pg_get_constraintdef`, jamais la définition que le
fichier prétend poser.

## 2. Les six conflits, et leur résolution

Migration : `20260903190000_acquisition_integration_reconciliation`.

| #   | Objet partagé                          | Conflit                                                                                                                                                                          | Symptôme                                                          | Résolution                                                                                                                                 |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `external_sources` (forme)             | Registre exige provider + version + mode d'authentification ; donnée publique exige provider + version + TTL de fraîcheur. La première contrainte posée refusait l'autre domaine | SILENCIEUX : refus à la première écriture de l'autre verticale    | `external_sources_shape_v2_ck`, forme déclarée PAR DOMAINE, `else true` hors des domaines qu'elle connaît                                  |
| 2   | `external_sources.capabilities`        | Registre écrit un tableau, donnée publique un objet. `jsonb_typeof = 'array'` refusait l'objet                                                                                   | `lfo_upsert_public_data_source` échouait à CHAQUE appel           | `external_sources_capabilities_v2_ck`, type attendu par domaine                                                                            |
| 3   | `external_sources` (unicité)           | `unique (user_id, provider)` : un même fournisseur servant deux domaines ne pouvait pas exister deux fois                                                                        | Refus au second domaine                                           | `external_sources_domain_provider_uk` sur `(user_id, domain, provider)`, et `lfo_upsert_public_data_source` réécrit sur cette clé          |
| 4   | `import_record_links` (domaines)       | PR2 et PR4 ont tous deux choisi le suffixe `_v3_ck` ; le second `add constraint` nu interrompait le rejeu                                                                        | ERREUR de migration, visible                                      | `import_record_links_domain_v4_ck` et `_target_v4_ck`, union des CINQ domaines cibles, chaque branche énumérant TOUTES les colonnes cibles |
| 5   | `import_upload_tickets` (domaines)     | Trois domaines de dépôt à réconcilier sous un nom déjà pris                                                                                                                      | ERREUR de migration                                               | `import_upload_tickets_domain_v3_ck`                                                                                                       |
| 6   | `import_normalized_records` (identité) | Unicité de `external_key` par propriétaire, sans le domaine cible ni l'état de validation. Open Banking ré-observe la même opération à chaque synchronisation                    | SILENCIEUX : relire une identité déjà validée devenait impossible | `import_normalized_records_committed_external_v2_uidx` sur `(user_id, target_domain, external_key)`, partiel sur `COMMITTED`               |

Un septième point n'est pas un conflit mais une duplication : `external_sources_domain_provider_uidx`
et la contrainte `..._uk` exprimaient le MÊME invariant sur deux objets. L'index part. **UN
CONTRÔLE, UN INVARIANT** : deux objets pour un invariant, ce sont deux messages d'erreur possibles
pour la même faute, et le smoke reçoit le refus du mauvais objet.

## 3. Les quatre findings Codex encore ouverts sur Portfolio

Migration pour le volet base : `20260903200000_portfolio_findings_no_silent_upsert`. Les trois
autres findings sont dans le lecteur XLSX et les routes HTTP.

### 3.1 Aucun `on conflict do update` silencieux sur `position_snapshots`

Une observation persistée est un FAIT. L'écraser parce qu'un second fichier porte la même date,
sans le dire et sans décision, remplace une quantité et une valeur de marché déjà lues par un
humain, sans laisser de trace. Le commentaire d'origine assumait « une observation à la même date
CORRIGE la précédente » : vrai du RÉSULTAT voulu, faux du CHEMIN.

Trois cas désormais, et trois seulement :

| Situation                      | Comportement                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Rien à cette date              | Écriture                                                                              |
| Même date, mêmes valeurs       | RIEN. Le rejeu du même fichier reste idempotent et n'est pas requalifié en correction |
| Même date, valeurs différentes | REFUS, sauf `correctRecordIds` désignant la ligne. Le message NOMME ce qui change     |

Corollaire de provenance : une observation corrigée a un HISTORIQUE de sessions, comme un
instantané financier reconstruit depuis un FEC. L'unicité du lien portait sur
`(propriétaire, observation)`, donc la session qui corrige perdait sa provenance en silence. Elle
porte maintenant sur `(propriétaire, session, observation)`, côté lien
(`import_record_links_snapshot_session_uk`) comme côté staging
(`import_normalized_records_snapshot_session_uidx`), avec un index de lecture non unique pour
retrouver les lectures qui ont écrit une observation donnée.

### 3.2 Budget global strict des octets XLSX décompressés

Le plafond PAR ENTRÉE ne suffisait pas : avec 4 096 entrées à 64 Mio, une archive de quelques
kilo-octets pouvait réclamer 256 Gio de mémoire, et le plafond par entrée ne le voyait jamais
passer. `MAX_TOTAL_INFLATED_BYTES` borne le TOTAL, entrées STOCKÉES comprises — une entrée non
compressée occupe la même mémoire qu'une entrée décompressée. Chaque entrée est inflatée avec pour
borne le RESTE du budget, jamais le plafond nominal.

Le dépassement REFUSE le classeur (`TOTAL_TOO_LARGE`), il ne le tronque pas : une lecture
partielle produirait des feuilles manquantes sans le dire, et un import muet d'une partie du
portefeuille est pire qu'un refus.

### 3.3 Relations XLSX limitées aux worksheets internes

`resolveWorksheetTarget` refuse quatre choses : `TargetMode="External"`, un type de relation qui
n'est pas `worksheet`, une cible portant un schéma d'URI, et une cible sortant de `worksheets/`
(segments `..` compris). Une relation refusée laisse la feuille DÉCLARÉE avec un chemin vide : la
feuille existe et son contenu est absent, ce qui est une information, là où omettre la feuille
ferait croire que le classeur ne la contient pas.

### 3.4 `Cache-Control: private, no-store` sur toutes les réponses API

`src/lib/http.ts` porte la valeur unique (`API_CACHE_CONTROL`, `API_HEADERS` avec `Vary: Cookie`).
Le proxy l'applique sur les trois sorties qui échappaient aux routes : la branche publique, la
branche 401 et le `next()` final. Un test structurel parcourt `src/app/api/**/route.ts` et échoue
sur toute valeur littérale divergente : c'est ce qui empêche la dérive d'une route future, là où
une revue ne la verrait pas.

## 4. Consolidations sans changement de schéma

**Un seul module SIREN.** `registry/siren.ts` dupliquait la validation de clé de Luhn. Le module
partagé reste `src/lib/acquisition/`, le doublon part avec ses tests, fusionnés.

**Un seul transport HTTP.** Deux implémentations coexistaient, et chacune savait quelque chose que
l'autre ignorait : le registre portait la classification d'échec riche et le limiteur de débit ; la
donnée publique portait la LECTURE PROTÉGÉE du corps de réponse. `src/lib/acquisition/transport.ts`
est la fusion des deux ; `registry/transport.ts` n'est plus qu'un jeu d'alias.

Un changement de comportement est ASSUMÉ et signalé : un corps vide sur un HTTP 200 produit
désormais `INVALID_RESPONSE` au lieu d'un `body: null`. Une source qui répond « tout va bien » sans
rien dire n'a pas répondu.

**Une seule interface Imports.** Sept onglets, un par verticale, dans l'ordre de ce que
l'utilisateur cherche et non dans celui des migrations : relevé bancaire, connexion bancaire,
comptabilité (FEC), liasse fiscale (PDF), portefeuille, registre d'entreprises, données publiques
(DVF, DPE). Les deux sources bancaires se suivent parce qu'elles alimentent le MÊME domaine
cible ; l'ordre chronologique du développement n'intéresse personne devant l'écran.

**Un seul gate de schéma.** Les registres de `scripts/verify-supabase-schema.ts` sont fusionnés
STRUCTURELLEMENT, pas par union de lignes : huit noms remplacés ont été RETIRÉS, sans quoi le gate
aurait exigé des contraintes que la réconciliation venait de renommer. Les deux gardes
`SECURITY DEFINER` (`import_session_freeze_state`, `bank_sync_freeze_state`) sont vérifiées par un
contrôle unique PARAMÉTRÉ, et un nouveau contrôle refuse toute fonction `SECURITY DEFINER` non
déclarée : la surface se déclare, elle ne se découvre pas.

**Un smoke transversal.** `scripts/smoke-acquisition-integration.ts` ne réexécute aucun smoke de
verticale : il prouve ce qu'aucun d'eux ne peut prouver seul — un fournisseur servant deux
domaines, un lien ne portant jamais deux faits, une identité relue plusieurs fois et écrite une
seule, le même identifiant légitime dans deux domaines cibles, exactement deux gardes
`SECURITY DEFINER`, et l'ensemble des tables d'audit en lecture seule sous le rôle `authenticated`.

## 5. Ce que l'intégration n'a PAS fait

- **aucune PR source fusionnée** : les cinq restent ouvertes, cette branche les intègre ;
- **aucun contact avec Supabase production** : le gate est intégralement local, sans credential ;
- **aucune migration appliquée en production** : neuf migrations attendent une autorisation
  explicite, et leur ordre d'application est celui de leurs noms ;
- **aucun adaptateur d'agrégateur bancaire réel** : sans contrat ni identifiants, l'écrire de
  mémoire produirait un faux support. Le fournisseur sandbox couvre la chaîne sans réseau. Statut :
  `BLOCKED_EXTERNAL` ;
- **aucune validation bancaire réelle revendiquée**.

## 6. Leçons portées dans `CLAUDE.md`

Trois règles y sont entrées parce qu'un défaut réel les a coûtées, pas parce qu'elles sonnent bien :

1. **Avant de remplacer une RPC existante, chercher sa DERNIÈRE version dans l'historique, jamais
   la première.** `lfo_record_business_financials` a été révisée trois fois ; la réécrire depuis sa
   version d'origine supprimait son upsert et quatre colonnes.
2. **Le nom d'une contrainte n'est pas un numéro de version libre.** Deux verticales ont choisi
   `_v3_ck` en même temps, chacune contre une base où l'autre n'existait pas.
3. **UN CONTRÔLE, UN INVARIANT.** Deux objets pour un invariant produisent deux refus possibles
   pour la même faute.

Le rang d'une verticale et le nombre de migrations du dépôt ont dérivé pour la même raison : chaque
auteur a compté contre la base qu'il avait sous les yeux. Les deux se lisent maintenant à leur
source, dans `CLAUDE.md` pour le rang et dans le gate local pour le nombre.
