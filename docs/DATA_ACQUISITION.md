# Data Acquisition Foundation

Comment un fait entre dans Léo Family Office autrement que par une saisie, et pourquoi
chaque étape refuse ce qu'elle n'a pas compris.

## 1. Le problème résolu

Avant cette couche, LFO possédait des moteurs financiers sérieux et un seul chemin
d'entrée : le formulaire. Le coffre `documents` stockait un fichier sans le lire, sans
provenance et sans lien avec un fait financier. Chaque intégration future — relevé
bancaire, FEC, avis d'opéré, données publiques — aurait donc réinventé son propre staging,
sa propre déduplication, son propre historique et ses propres erreurs.

Cette couche pose le tuyau commun, et l'éprouve sur un cas réel : le relevé bancaire CSV.

## 2. La chaîne

```text
FICHIER
   ↓  décodage, séparateur, découpage         src/lib/acquisition/csv.ts
RAW                                          public.import_raw_records (immuable)
   ↓  mapping des colonnes                   src/lib/acquisition/mapping.ts
   ↓  conventions de montant et de date      src/lib/acquisition/normalization.ts
NORMALIZED                                   public.import_normalized_records (staging)
   ↓  déduplication                          src/lib/acquisition/dedupe.ts
PREVIEW                                      aucune écriture canonique
   ↓  décision explicite de l'utilisateur
CANONICAL                                    public.transactions + import_record_links
   ↓
moteur Cash Flow existant, inchangé
```

Les modules de `src/lib/acquisition/` sont **purs** : aucun accès base, aucun React. Ils
sont donc testables sur des cas qu'aucune banque ne produit volontairement mais qui
arrivent quand même (voir `src/lib/acquisition/__tests__/`).

## 3. Ce que la couche ne fait jamais

- elle ne **classe** aucun flux. Une transaction importée naît sans catégorie, et le Cash
  Flow Engine la compte comme non classée. Deviner « AMAZON EU » = « Shopping » serait
  inventer une classification économique pour rendre l'import plus présentable ;
- elle ne **recalcule** aucun solde. `account_balances` reste la vérité observée du
  compte : une somme de lignes importées n'en est pas une seconde ;
- elle ne **rapproche** aucun transfert interne. `transfer_group_id` appartient au Cash
  Flow Engine, seul propriétaire de la nature économique d'un flux ;
- elle ne **déclare** aucune profondeur d'historique. La période OBSERVÉE d'un fichier ne
  certifie pas son exhaustivité : `profiles.ledger_coverage_start` reste une déclaration de
  l'utilisateur, dans Settings, et l'import n'y touche pas ;
- elle ne **corrige** aucun brut. Reclasser une dépense modifie le fait canonique, jamais
  ce que la banque a écrit. Un trigger de base refuse toute mise à jour d'un brut.

## 4. Ambiguïtés : déclarées, jamais tranchées

Deux ambiguïtés sont structurelles dans les exports bancaires, et les deux changent le
résultat financier :

| Cellule      | Lectures possibles | Décision                                                                            |
| ------------ | ------------------ | ----------------------------------------------------------------------------------- |
| `1,234`      | 1,234 ou 1 234     | résolue au niveau de la COLONNE si une autre cellule tranche, sinon lignes BLOQUÉES |
| `03/04/2026` | 3 avril ou 4 mars  | résolue au niveau de la COLONNE si une date y dépasse le 12, sinon lignes BLOQUÉES  |

La résolution est **par colonne** et non par cellule : une colonne qui contient au moins
une valeur non ambiguë renseigne toutes les autres. Une colonne où deux conventions
coexistent (`1 234,56` et `1,234.56`) reste ambiguë : il n'existe alors aucune lecture
sûre, et en choisir une fabriquerait des montants.

Les conventions retenues sont persistées sur la session. Un montant relu dans six mois est
donc confrontable à la règle qui l'a produit.

## 5. Déduplication : trois rangs

| Rang | Clé                                                                                                        | Verdict possible                                |
| ---- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1    | identifiant stable de la source, préfixé par la source                                                     | `EXACT_DUPLICATE` ou `NEW`, sans autre contrôle |
| 2    | empreinte `compte / date / montant / devise / libellé` + **rang d'occurrence**                             | `EXACT_DUPLICATE` ou passage au rang 3          |
| 3    | ressemblance : même montant et libellé à quelques jours, ou même date et montant sous un libellé différent | `PROBABLE_DUPLICATE`, `POSSIBLE_MATCH`          |

Le **rang d'occurrence** est ce qui distingue « deux fois la même ligne » de « deux
opérations réellement identiques ». Deux cafés à 3,20 € le même jour sont deux dépenses :
la première porte le rang 1, la seconde le rang 2. Un réimport retrouve les deux rangs déjà
écrits et n'en crée aucun.

L'empreinte est **lisible** et non hachée :

```text
v1|<compte>|2026-08-13|-54.280000|EUR|CARTE 1208 AMAZON EU|#1
```

Un utilisateur qui demande pourquoi une ligne est un doublon doit pouvoir lire la réponse.

Seul `EXACT_DUPLICATE` est écarté sans demander. Une ressemblance est **signalée** et
n'est écrite que si l'utilisateur l'inclut nommément : à égalité de doute, la couche
préfère ne pas écrire, parce qu'un double comptage fausse le patrimoine sans laisser de
trace visible, là où une opération manquante laisse un trou que l'utilisateur voit.

## 6. Idempotence : deux garanties, à deux niveaux

Le moteur classe, et la base refuse. Les deux sont nécessaires : le moteur peut être
contourné, la base ne connaît pas la sémantique d'un relevé.

| Garantie                                                                                                 | Portée                                                    |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `import_sessions_committed_file_uidx` sur `(user_id, source_id, file_hash)` où le statut est `COMMITTED` | un contenu de fichier ne se valide qu'une fois par source |
| `import_normalized_records_committed_fingerprint_uidx` sur `(user_id, account_id, dedupe_fingerprint)`   | une empreinte ne s'écrit qu'une fois                      |
| `import_normalized_records_committed_external_uidx` sur `(user_id, external_key)`                        | un identifiant stable de source ne s'écrit qu'une fois    |
| `lfo_commit_import_session` sur une session déjà validée                                                 | retourne l'identifiant sans rien réécrire                 |

Limites assumées :

- les index de base protègent l'import contre l'import. Une transaction saisie
  MANUELLEMENT ne porte pas d'empreinte ; c'est le moteur de déduplication, qui lit toutes
  les transactions du compte quelle que soit leur origine, qui la reconnaît et classe le
  candidat correspondant en doublon ;
- si une transaction issue d'un import était supprimée, son empreinte resterait marquée
  committée. Le produit n'offre aujourd'hui aucune suppression de transaction, donc le cas
  ne se présente pas ; le jour où il existera, la suppression devra libérer l'empreinte de
  la ligne normalisée correspondante, sans quoi le même relevé deviendrait irrémédiablement
  non réimportable.

## 7. Statuts d'une ligne

| Statut      | Sens                                                                                                                      | Committable               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `READY`     | lisible, complète, nouvelle                                                                                               | oui, par défaut           |
| `WARNING`   | lisible mais discutable (ressemblance, année sur deux chiffres, date future, devise déduite de la déclaration de session) | oui, si nommément incluse |
| `BLOCKED`   | illisible ou incohérente                                                                                                  | jamais                    |
| `DUPLICATE` | déjà présente à l'identique                                                                                               | jamais                    |
| `IGNORED`   | ligne vide, ligne de total ou de solde                                                                                    | jamais                    |

Chaque anomalie porte son code, son champ, la **valeur source telle quelle** et une
explication en français. `Error parsing line 74` ne dit ni ce qui a échoué, ni sur quelle
valeur, ni ce que l'utilisateur peut faire.

Le verdict de déduplication est `null` quand il n'a pas été ÉVALUÉ — ligne vide, hors
périmètre, ou trop incomplète pour avoir une identité. `null` n'est pas « nouvelle ».

## 8. Provenance

Une transaction importée se remonte jusqu'à sa cellule :

```text
transactions.id
  → import_record_links (un lien par transaction, unique dans les deux sens)
  → import_normalized_records (ce que le parseur a compris, avec ses anomalies)
  → import_raw_records (ce que la source a écrit, immuable)
  → import_sessions (fichier, empreinte, mapping appliqué, conventions retenues)
  → import_sources (provider, adaptateur, période réellement alimentée)
```

`import_record_links` porte une colonne cible **par domaine**, avec sa vraie clé
étrangère. Brancher Portfolio ou Real Estate demandera une colonne et une ligne de
contrainte : c'est le prix d'une intégrité réelle plutôt que d'un `target_id uuid` sans
contrainte.

## 9. Formats réellement supportés

Lus aujourd'hui :

- CSV, TSV, TXT délimité ; séparateurs `;`, `,`, tabulation, `|` reconnus par stabilité du
  nombre de colonnes ;
- encodages UTF-8, UTF-8 avec BOM, Windows-1252 (repli signalé) ;
- guillemets RFC 4180, guillemets doublés, séparateur protégé, champ multi-lignes ;
- dates `AAAA-MM-JJ`, `JJ/MM/AAAA`, `MM/JJ/AAAA`, séparateurs `/ . -`, heure accolée
  ignorée, année sur deux chiffres signalée ;
- montants à virgule ou à point décimal, séparateurs de milliers par espace (insécable
  compris), apostrophe ou point/virgule, parenthèses et signe suffixé comme négatifs ;
- montant signé, ou colonnes débit et crédit séparées portant des magnitudes ;
- devise par colonne, ou devise déclarée pour la session.

Plafonds : 8 Mo par fichier (limite du bucket privé), 20 000 lignes par session. Un
dépassement **échoue** : il ne tronque pas.

Pas encore lus, et volontairement hors de cette couche : XLSX, OFX/QFX, CAMT, FEC,
documents PDF, connecteurs bancaires. La fondation existe pour qu'ils s'y branchent sans
refonte — un adaptateur produit des `NormalizedBankRow` ou l'équivalent de son domaine, et
réutilise le staging, la déduplication, l'historique et l'audit.

## 10. Ce qui reste manuel

- le choix du compte alimenté ;
- la devise, quand la source n'en fournit aucune ;
- la confirmation d'un mapping ambigu, et la correction d'un mapping refusé ;
- la décision sur chaque ligne signalée ;
- la classification Cash Flow des transactions écrites ;
- la déclaration de la profondeur d'historique du ledger, dans Settings ;
- le rapprochement des transferts internes.
