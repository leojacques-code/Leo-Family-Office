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

## 5. Déduplication : l'identité se démontre, elle ne se présume pas

`EXACT_DUPLICATE` signifie **identité démontrée**, et rien d'autre. Deux choses seulement la
démontrent :

| Preuve | Portée |
| ------ | ------ |
| l'empreinte SHA-256 du **fichier**, au niveau session | un contenu déjà validé pour cette source est refusé avant même d'arriver à la déduplication |
| un identifiant de transaction dont la **stabilité est déclarée** | la ligne est reconnue comme déjà écrite |

Tout le reste est une **ressemblance**, signalée et non écrite par défaut.

### Pourquoi une égalité de tuple ne suffit pas

Historique canonique :

```text
13/08  COFFEE SHOP  -3,20 €
13/08  COFFEE SHOP  -3,20 €
```

Deux opérations réelles. Plus tard, un relevé partiel contient une seule ligne identique.
S'agit-il d'une des deux déjà connues, ou d'un **troisième** café réel ? Rien dans le
fichier ne permet de le savoir, et un rang d'occurrence calculé sur le fichier candidat ne
le dit pas non plus : il compte les lignes de ce fichier, pas les opérations du compte.

Conclure `EXACT_DUPLICATE` supprimerait une dépense réelle en silence. Cette égalité produit
donc `PROBABLE_DUPLICATE` : visible, exclue par défaut, écrivable sur décision explicite.

### Ce que le moteur produit

| Situation | Verdict | Écrite par défaut |
| --------- | ------- | ----------------- |
| identifiant stable **déclaré** déjà connu, ou répété dans le fichier | `EXACT_DUPLICATE` | non, et non incluable |
| tuple identique à une opération connue non encore revendiquée | `PROBABLE_DUPLICATE` | non, incluable |
| même montant et libellé à quelques jours d'écart | `PROBABLE_DUPLICATE` | non, incluable |
| même date et montant sous un libellé différent | `POSSIBLE_MATCH` | non, incluable |
| rien de connu | `NEW` | oui |
| ligne vide, hors périmètre ou trop incomplète | `null` (non évalué) | non |

Chaque opération connue n'est revendiquée qu'une fois : trois lignes identiques face à deux
opérations connues rapprochent les deux premières et laissent la troisième **nouvelle**,
parce qu'aucune opération connue ne peut plus l'expliquer.

### Clé de rapprochement, pas empreinte d'identité

```text
v2|<compte>|2026-08-13|-3.200000|EUR|COFFEE SHOP|~1
```

Elle est **lisible** pour que l'utilisateur puisse lire la raison d'un rapprochement, et
elle ne porte **aucune unicité en base** : le rang `~1` est local à l'analyse. Une contrainte
d'unicité sur ce tuple supprimerait exactement les faits réels que la section précédente
protège.

## 6. Référence ≠ identifiant stable

Deux champs cibles distincts, et une déclaration qui décide de leur rôle :

| Champ | Alimenté par | Peut décider d'une identité |
| ----- | ------------ | --------------------------- |
| `externalTransactionId` | « Transaction ID », « Identifiant unique », « Unique reference » | uniquement si la stabilité est **déclarée** pour la session |
| `reference` | « Référence », « Référence bancaire », « Numéro d'opération », « Motif », « End to end » | jamais |

Une banque peut répéter une référence, la partager entre les lignes d'un lot, ou réutiliser
le même motif chaque mois. Le nom d'un en-tête ne prouve donc rien : même une colonne
nommée « Transaction ID » n'est qu'une **prétention** tant que l'utilisateur n'a pas
déclaré, pour ce format, que cette colonne porte un identifiant unique par opération.

La case correspondante est **décochée par défaut**, et c'est le bon défaut : sans
déclaration, un prélèvement mensuel portant toujours la référence « LOYER » reste douze
échéances distinctes.

Une identité est toujours préfixée par sa source (`<provider>:<compte>#<id>`) : deux banques
peuvent utiliser la même chaîne sans entrer en collision.

## 6 bis. Date d'observation de l'import ≠ date d'arrêté du reporting

Le cockpit arrête ses comptes à `AS_OF_DATE`. L'acquisition, elle, travaille à la date à
laquelle l'import est **réellement effectué**.

```text
AS_OF_DATE du reporting  = 19/08/2026
import effectué le        = 27/08/2026
opération bookée le       = 26/08/2026   →  fait réel, ingéré normalement
```

Une opération bancaire bookée hier est un fait, même si le reporting est arrêté le mois
précédent. La qualifier de « future » demanderait une intervention humaine sur une donnée
parfaitement valide. C'est aux moteurs aval de décider qu'elle n'existait pas au 19/08 et de
l'écarter d'une lecture à cette date : l'acquisition ingère, elle n'arbitre pas.

Seule une date postérieure au **jour de l'import** est signalée. La date d'observation est
persistée sur la session, et injectée dans le moteur en paramètre — les fonctions pures ne
lisent jamais l'horloge.

## 7. Idempotence : deux garanties, aux deux seuls endroits démontrables

| Garantie | Portée |
| -------- | ------ |
| `import_sessions_committed_file_uidx` sur `(user_id, source_id, file_hash)` où le statut est `COMMITTED` | un contenu de fichier ne se valide qu'une fois par source ; le repository refuse en plus **avant** tout dépôt au coffre |
| `import_normalized_records_committed_external_uidx` sur `(user_id, external_key)` | une identité démontrée ne s'écrit qu'une fois |
| `lfo_commit_import_session` sur une session déjà validée | retourne l'identifiant sans rien réécrire |

Il n'existe **délibérément aucune** contrainte d'unicité sur la clé de rapprochement. Ce
n'est pas un manque : une unicité sur `(compte, date, montant, devise, libellé)` refuserait
un troisième café réel, et le refus viendrait de la base — donc avec un message opaque et
aucune possibilité de décision.

Le réimport d'un même relevé reste sans effet, mais par un autre chemin : l'empreinte du
fichier le refuse, et même en forçant la relecture, **aucune ligne n'est prête** — les trois
sont reconnues comme probablement déjà présentes et attendent une décision.

Limite assumée : une transaction saisie **manuellement** ne porte pas d'identité. C'est le
moteur de déduplication, qui lit toutes les transactions du compte quelle que soit leur
origine, qui la reconnaît et signale le candidat correspondant.

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

### La piste d'audit est en lecture seule

`authenticated` n'a que le `SELECT` sur les six tables d'acquisition ; toutes les écritures
passent par les RPC réservées à `service_role`. Une piste d'audit sur laquelle le client
peut écrire n'est pas une piste d'audit : un `DELETE` direct sur un enregistrement brut
cascaderait vers la ligne normalisée et son lien, et laisserait survivre une transaction
étiquetée « importée » dont l'origine aurait disparu. Le gate de schéma refuse une base où
ces tables auraient reçu `INSERT`, `UPDATE` ou `DELETE`.

Quatre invariants complètent les privilèges, portés par la base :

- un enregistrement brut ne se **modifie** jamais ;
- un enregistrement brut ne se **supprime** que par l'abandon d'une session encore
  analysée, qui n'a produit aucun fait ;
- une ligne normalisée **committée** est gelée. Seule exception, explicite : le jumeau
  désigné (`matched_transaction_id`) peut être détaché s'il disparaît — il décrit
  l'opération à laquelle la ligne ressemblait, pas le fait qu'elle a produit ;
- un lien de provenance est **immuable**, et la clé étrangère vers `transactions` est en
  `restrict` : une transaction importée ne peut pas être supprimée en laissant sa
  provenance orpheline.

## 9. Formats réellement supportés

Lus aujourd'hui :

- CSV, TSV, TXT délimité ; séparateurs `;`, `,`, tabulation, `|` reconnus par stabilité du
  nombre de colonnes ;
- encodages UTF-8, UTF-8 avec BOM, Windows-1252 (repli signalé) ;
- guillemets RFC 4180, guillemets doublés, séparateur protégé, champ multi-lignes ;
- dates `AAAA-MM-JJ`, `JJ/MM/AAAA`, `MM/JJ/AAAA`, séparateurs `/ . -`, heure accolée
  ignorée, année sur deux chiffres signalée ;
- champs facultatifs (date de valeur, solde après opération) : une cellule **vide** reste
  `null` sans anomalie, une cellule **renseignée mais illisible** est signalée. ABSENT ≠
  PRÉSENT MAIS ILLISIBLE, même quand aucun calcul ne consomme le champ ;
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
- la confirmation d'un mapping ambigu, et la correction d'un mapping refusé — une colonne
  source ne peut alimenter qu'un seul champ, un mapping qui en réutilise une est refusé ;
- la déclaration éventuelle de stabilité de l'identifiant de transaction ;
- la décision sur chaque ligne signalée ;
- la classification Cash Flow des transactions écrites ;
- la déclaration de la profondeur d'historique du ledger, dans Settings ;
- le rapprochement des transferts internes.
