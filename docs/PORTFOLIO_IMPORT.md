# Import de portefeuille : CSV et XLSX

Quatrième verticale de la fondation d'acquisition. Elle fait entrer dans LFO les opérations et
les positions d'un compte-titres, d'un PEA ou d'une assurance-vie, depuis un export générique
CSV ou XLSX.

Elle **n'ajoute aucun ledger** : le ledger portefeuille existe depuis
`portfolio_data_foundation`, avec ses douze natures d'événement et sa RPC d'écriture. Cette
verticale l'alimente.

## 1. La distinction qui structure tout

```text
POSITION OBSERVÉE  ≠  TRANSACTION DU LEDGER
```

Un relevé de positions dit « au 30 juin, je détenais 12 parts valant 4 500 € ». Il ne dit
**pas** quand ni à quel prix elles ont été achetées.

Reconstruire un achat depuis une position inventerait une date, un prix et des frais, et le
coût de revient qui en découlerait serait faux **tout en paraissant calculé**. Les deux
natures sont donc deux domaines cibles distincts, écrits dans deux tables distinctes, et
jamais convertis l'un dans l'autre :

| Domaine              | Écrit dans                                           | Ce que ça dit                                                                                                      |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PORTFOLIO_LEDGER`   | `portfolio_events`, via `lfo_record_portfolio_event` | un mouvement daté : achat, vente, dividende, intérêt, frais, taxe, apport, retrait, transfert, ancrage d'ouverture |
| `PORTFOLIO_POSITION` | `positions` + `position_snapshots`                   | une observation datée : quantité, valeur de marché, coût de revient éventuel                                       |

Un import de positions ne produit **aucun** événement. Un import d'opérations ne produit
**aucune** observation. Le smoke le vérifie explicitement.

## 2. Audit préalable

| Existant                                                                                            | Décision                                    | Motif                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `csv.ts` (`detectDelimiter`, `parseDelimited`, `formatSignature`)                                   | **REUSE inchangé**                          | Découpage neutre au domaine                                                                                                                      |
| `normalization.ts` (décodage, conventions de montant et de date, devises, empreinte de libellé)     | **REUSE inchangé**                          | La convention décimale d'un export de courtier est le même problème que celle d'un relevé bancaire                                               |
| `mapping.ts` `normalizeHeader`                                                                      | **REUSE**                                   | Le repli d'en-tête est commun ; l'inférence bancaire reste bancaire                                                                              |
| `types.ts` (`ImportIssue`, `ImportRowStatus`, `ImportDedupeVerdict`, `SourceConventions`, `RawRow`) | **REUSE**                                   | Même vocabulaire d'anomalie et de verdict                                                                                                        |
| `dedupe.ts`                                                                                         | **REUSE du contrat, clé propre au domaine** | L'identité d'un événement de portefeuille porte l'instrument, la nature et la quantité : ce ne sont pas les composantes d'une opération bancaire |
| `import_sources`, `import_sessions`, `import_raw_records`, `import_column_mappings`                 | **REUSE**, tables inchangées                | Un import de portefeuille est un import de fichier lu ligne par ligne                                                                            |
| `import_upload_tickets` + zone de staging                                                           | **REUSE**                                   | Un classeur dépasse la taille de corps qu'une fonction serverless accepte                                                                        |
| `import_normalized_records`                                                                         | **EXTEND**                                  | Colonnes de portefeuille ajoutées, forme committable arbitrée par domaine                                                                        |
| `import_record_links`                                                                               | **EXTEND**                                  | Deux colonnes cibles de plus, exactement ce que son propre commentaire prévoyait                                                                 |
| `lfo_record_portfolio_event`                                                                        | **REUSE strict**                            | Unique porte d'écriture du ledger                                                                                                                |
| `positions` / `position_snapshots`                                                                  | **REUSE**, avec les unicités qui manquaient | Voir §4                                                                                                                                          |
| `portfolio.ts` (moteur)                                                                             | **KEEP non modifié**                        | L'acquisition alimente, elle ne calcule pas                                                                                                      |
| Beyonder, Today, Timeline, Goals, Scenarios, Decision Lab                                           | **NON TOUCHÉS**                             | Hors périmètre                                                                                                                                   |

### Pourquoi étendre la table de staging plutôt qu'en créer une seconde

`import_normalized_records` porte **déjà** des colonnes propres à un domaine : `balance_after`
n'a de sens que pour un relevé bancaire. C'est par construction une table à colonnes par
domaine, dont la forme committable est arbitrée par un `case target_domain` — pattern déjà
utilisé par `import_sources_domain_shape_ck` et `import_record_links_target_ck`.

Ouvrir une table parallèle aurait dupliqué session, brut, statut, verdict et discipline de
commit, soit une **seconde vérité de staging pour le même objet**.

## 3. Lecture d'un classeur XLSX

Aucune dépendance ajoutée. Un XLSX est une archive ZIP de documents XML :
`src/lib/acquisition/xlsx/zip.ts` l'ouvre (inflate seul, plafonds de taille et de nombre
d'entrées), `workbook.ts` en lit les feuilles.

Ce choix n'est pas de la fierté mal placée : les bibliothèques de tableur généralistes
évaluent les formules, suivent les liens externes et acceptent les classeurs à macros. Ce
dépôt a besoin de l'inverse.

| Situation                                     | Comportement                                                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cellule de formule **avec** valeur en cache   | La valeur est lue, et la cellule est **nommée** dans `formulaCells`. `VALEUR EN CACHE ≠ VALEUR SAISIE` : elle peut être périmée si le classeur a été modifié sans recalcul |
| Cellule de formule **sans** valeur en cache   | Rien n'est produit, et c'est une **erreur**. L'évaluer reviendrait à écrire un moteur de tableur, donc à inventer un chiffre                                               |
| Classeur porteur de macros (`vbaProject.bin`) | **REFUSÉ**, pas lu partiellement. Une lecture partielle laisserait croire que le contenu a été validé                                                                      |
| Classeur chiffré                              | **REFUSÉ**                                                                                                                                                                 |
| Lien externe vers un autre classeur           | **SIGNALÉ**, jamais suivi                                                                                                                                                  |
| Cellule en erreur (`#REF!`, `#DIV/0!`)        | Aucune valeur n'en est tirée                                                                                                                                               |
| Index de chaîne partagée hors bornes          | Cellule vide **et** anomalie, jamais une chaîne devinée                                                                                                                    |
| Colonne manquante au milieu d'une ligne       | Comblée par une chaîne **vide** — jamais par un zéro                                                                                                                       |
| Cellule datée                                 | Numéro de série décodé selon l'époque **déclarée par le classeur** (1900 ou 1904), bug du 29 février 1900 compris, et le décodage est signalé                              |
| Entité XML externe                            | Non résolue : le parseur ne connaît que les cinq entités prédéfinies et les références numériques                                                                          |

Plafonds explicites, tous refusant plutôt que tronquant : 16 Mio, 64 feuilles, 50 000 lignes,
256 colonnes, 20 s d'analyse, 64 Mio par entrée décompressée.

## 4. Les unicités qui manquaient

Trois index d'unicité sont ajoutés à des tables existantes. Ce ne sont pas des optimisations :

- **`positions_envelope_instrument_uidx`** — deux lignes `positions` pour le même couple
  enveloppe + instrument scinderaient la même détention en deux, et le bilan compterait deux
  fois ou une fois sur deux selon laquelle est lue. Sans cette unicité, rejouer un fichier
  créerait une seconde ligne au lieu de retrouver la première, et **l'idempotence serait
  impossible** ;
- **`position_snapshots_observation_uidx`** — une observation par instrument et par date. Une
  position est une observation datée : deux observations du même jour sont la même
  observation, et la seconde **corrige** la première. C'est ce qui rend l'import incrémental
  sûr et le rejeu idempotent ;
- **`portfolio_events_id_user_uidx`** — cible de la FK de provenance. `portfolio_events`
  portait bien une unicité composite, mais elle inclut l'enveloppe, l'instrument et le fait
  d'ouvrir un lot : elle sert la FK du lot désigné et ne pouvait pas servir ici.

**Risque à connaître** : si la base porte déjà des doublons de détention, la migration
**échoue**. C'est le bon comportement — ces doublons faussent déjà les lectures. Requête de
diagnostic à passer avant application :

```sql
select user_id, account_id, security_id, count(*)
  from public.positions group by 1,2,3 having count(*) > 1;
```

## 5. Résolution d'instrument

```text
INSTRUMENT NON RÉSOLU  ≠  INSTRUMENT NOUVEAU
```

Un ISIN qui ne correspond à rien peut être un titre absent du référentiel **ou** une faute de
frappe. Le créer d'office peuplerait le référentiel de doublons, et les mêmes titres se
répartiraient entre deux instruments.

La décision porte sur la **clé de source** (`ISIN:…`, `TICKER:…`, `NAME:…`), pas sur la ligne :
toutes les lignes qui citent le même titre se résolvent ensemble. Elle est persistée dans
`import_instrument_resolutions`, avec sa base nommée et ses candidats.

| Cas                                | État                        | Effet                                                          |
| ---------------------------------- | --------------------------- | -------------------------------------------------------------- |
| ISIN valide, un seul instrument    | `RESOLVED`                  | Rattachement, sans réserve                                     |
| ISIN valide, plusieurs instruments | `AMBIGUOUS`                 | **Aucun** retenu, les deux montrés                             |
| ISIN valide, inconnu               | `UNRESOLVED`                | Lignes bloquées jusqu'à décision                               |
| Chaîne présente mais pas un ISIN   | signalé                     | Repli sur les identifiants plus faibles, dit en clair          |
| Ticker seul, un instrument         | `RESOLVED` **avec réserve** | Un même ticker désigne des sociétés différentes selon la place |
| Libellé seul, un instrument        | `RESOLVED` **avec réserve** | Un libellé n'est pas un identifiant                            |
| Décision humaine                   | l'emporte                   | Une réanalyse ne l'écrase pas                                  |

Le point le plus important de cette verticale se trouve dans
`lfo_commit_portfolio_session` : l'instrument est transmis à la RPC du ledger sous sa **seule
forme résolue**, `security: { id }`. `lfo_record_portfolio_event` accepte aussi un instrument
décrit par son ISIN, son ticker ou son **nom**, et dans ce cas elle le **crée** s'il est
introuvable. Ce chemin est légitime pour une saisie manuelle ; il est interdit pour un import.
Ne transmettre que l'identifiant déjà tranché ferme cette porte.

## 6. Déduplication

Même doctrine que l'acquisition bancaire : `L'IDENTITÉ SE DÉMONTRE`.

Deux achats de 10 parts du même ETF le même jour au même prix peuvent parfaitement être deux
ordres réels passés à dix minutes d'intervalle. Les écarter d'office supprimerait des titres
détenus, et le patrimoine serait **sous-évalué sans qu'aucune trace ne le dise**.

Deux preuves seulement autorisent un rejet automatique :

1. l'empreinte du **fichier** déjà validé — la base refuse de réouvrir une session
   `COMMITTED` avec le même `file_hash` ;
2. une référence d'opération dont la **stabilité est DÉCLARÉE** pour la session — cherchée
   alors dans **tout** l'historique, sans fenêtre de date.

La déclaration est **décochée par défaut**, et ce défaut est le bon.

Tout le reste est une ressemblance signalée, **exclue par défaut** et écrite sur décision.
Aucune contrainte d'unicité ne s'appuie sur `match_key`.

Les positions font exception, et pour une raison de fond : une observation n'existe qu'une
fois par date, donc l'égalité du triplet enveloppe + instrument + date **prouve** l'identité.
C'est le seul endroit du domaine où c'est vrai.

## 7. `NULL ≠ ZERO`, ligne par ligne

| Terme                           | Absent signifie                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fee_amount`, `tax_amount`      | frais **inconnus**. Le coût de revient qui en dépend reste non calculable plutôt que flatteur                                                     |
| `cost_basis`                    | coût de revient non fourni. La plus-value latente reste non calculable                                                                            |
| `envelope_cash_amount`          | effet sur le cash **inconnu**, jamais nul                                                                                                         |
| `quantity` sur un dividende     | pas de quantité, ce qui est normal                                                                                                                |
| `market_value` sur une position | **BLOQUANT** : `position_snapshots.market_value` est NOT NULL, et une position sans valeur observée n'est pas une observation de valeur           |
| devise                          | ligne **refusée**, sauf repli sur la devise déclarée de l'enveloppe — et ce repli est signalé à chaque ligne, parce que `FX ABSENT ≠ FX ÉGAL À 1` |

Un **zéro explicite** est une information et se distingue d'une cellule vide. Le test le
vérifie sur la même colonne, ligne à ligne.

## 8. Ce que l'acquisition ne fait pas

- elle ne **classe** aucun flux : un frais reste un frais parce que la source le dit, et une
  nature non reconnue **bloque** la ligne plutôt que d'être devinée. « Rachat » ne devient pas
  « achat » par correspondance de préfixe ;
- elle ne **recalcule** aucun solde d'enveloppe ;
- elle ne **rapproche** aucun transfert interne ;
- elle ne **déclare** aucune profondeur d'historique : un fichier qui commence en mars ne dit
  pas que janvier et février étaient vides ;
- elle ne **déduit** pas une quantité d'un montant divisé par un prix : les frais s'y mêlent ;
- elle n'**additionne** aucune devise. Les lignes conservent leur devise native.

## 9. Ordre des colonnes et formats de courtier

**L'ordre des colonnes n'a aucune importance** : rien n'est déduit d'une position. Un export
dont les colonnes sont permutées se lit à l'identique, et le test le prouve en comparant les
deux lectures terme à terme.

**Aucun adaptateur de courtier n'est fourni**, et c'est un refus explicite : aucune fixture
fiable et non personnelle ne permettait de valider la structure réelle d'un export
Interactive Brokers, Trade Republic, Boursorama ou Fortuneo. Les écrire de mémoire aurait
produit un faux support — un mapping qui échoue sur le premier vrai fichier, ou pire, qui lit
la mauvaise colonne. Statut : `DEFERRED`.

Le format générique couvre ces exports par le mapping manuel : les colonnes se désignent à la
main, le mapping se mémorise pour une **signature de format identique**, et « presque le même
fichier » n'est pas le même.

## 10. Correction et provenance

Une correction écrit la ligne **normalisée**. Le brut n'est jamais touché :
`import_raw_records` porte son trigger de gel, et corriger une lecture ne récrit pas ce que la
source a écrit.

Chaque fait accepté conserve :

| Élément                      | Où                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| import et fichier sources    | `import_sessions.file_name`, `file_hash`, `staging_storage_path`                                             |
| numéro de ligne              | `import_raw_records.row_number`                                                                              |
| champ source et valeur brute | `import_raw_records.cells`, `raw_line`                                                                       |
| valeur normalisée            | colonnes de `import_normalized_records`                                                                      |
| correction éventuelle        | `field_corrections` (valeur d'origine **et** valeur retenue, par champ), `corrected_at`, `correction_reason` |
| adaptateur et version        | `import_sessions.parser`, `parser_version`, `import_sources.adapter_version`                                 |
| date d'import                | `import_sessions.observation_date`, distincte de la date d'arrêté du reporting                               |
| lien vers le fait canonique  | `import_normalized_records.portfolio_event_id` / `position_snapshot_id`, et `import_record_links`            |

Un fait importé n'est **pas supprimable** en laissant sa provenance orpheline : la FK est
`restrict`.

## 11. Gel du brut : correction du garde-fou

Le trigger `import_raw_record_immutable` du socle d'acquisition refuse toute **modification**
sans condition. Pour la **suppression**, il lisait le statut de la session :

```sql
select status into v_status from public.import_sessions
 where id = old.session_id and user_id = old.user_id;
if v_status is null then return old; end if;   -- « cascade légitime »
```

### Ce que le constat initial disait de faux

La première rédaction de cette section affirmait que, sous `service_role`, la RLS rendait
`import_sessions` invisible et que la suppression du brut d'une session committée passait donc.
**C'est inexact.** Vérification sur base locale reconstruite depuis zéro :
`service_role` porte l'attribut `bypassrls`, ici comme sur Supabase. Le garde lisait donc le
bon statut, et le refus se produisait bien :

| statut de la session | suppression du brut, avant correction |
| -------------------- | ------------------------------------- |
| `RECEIVING`          | autorisée                             |
| `ANALYZED`           | autorisée                             |
| `COMMITTED`          | **refusée**                           |
| `DISCARDED`          | **refusée**                           |
| `FAILED`             | **refusée**                           |

Le smoke du socle vérifiait déjà le refus sur `COMMITTED`, et il passait pour la bonne raison.

### Le défaut réel

Le garde était correct **par accident d'un attribut de rôle**, pas par construction. Sous un
appelant qui ne contourne pas la RLS, `import_sessions` rend zéro ligne, `v_status` vaut `null`,
et le garde conclut « session déjà supprimée » : il **autorise**. Sonde reproduite en
transaction annulée, avec un rôle voyant le brut mais pas les sessions :

```text
sous_role       | sessions_visibles | brut_visible
lfo_probe_norls |                 0 |            1
DELETE 1                                    -- brut d'une session COMMITTED, aucun refus
```

Aucun chemin applicatif ne l'atteignait : `authenticated` n'a que le `select` sur
`import_raw_records`, donc la permission tombe avant le trigger. Mais forcer la RLS sur la
table, retirer `bypassrls`, ou ouvrir un jour un chemin de suppression à un rôle applicatif
aurait inversé le garde en silence, dans le sens le plus coûteux : celui qui autorise.

**SESSION ABSENTE ≠ SESSION INVISIBLE.** Cette distinction ne peut pas être posée par une
lecture `security invoker` : elle exige une lecture qui ne dépend pas de ce que l'appelant a le
droit de voir.

### La correction

`supabase/migrations/20260903090000_import_raw_freeze_hardening.sql`, additive.

`public.import_session_freeze_state(p_session_id uuid, p_user_id uuid) returns text` rend
`ABSENT`, `FACTS_WRITTEN`, ou le statut de la session. `SECURITY DEFINER` y est **nécessaire**,
pas commode : la question posée est « cette session existe-t-elle ? », et une réponse filtrée
par la RLS de l'appelant répond à une autre question. Surface minimale, chaque condition
vérifiée par le gate :

- `stable`, aucune écriture ;
- `search_path` verrouillé à vide, tous les objets qualifiés par leur schéma ;
- elle rend un état de gel, aucune donnée d'affaire ;
- **pas** nommée `lfo_*` : ce n'est pas une RPC d'écriture, et le contrat « aucune RPC `lfo_*`
  en `SECURITY DEFINER` » reste entier ;
- aucun `execute` pour `public`, `anon` ni `authenticated` ; `service_role` seul l'obtient. Un
  futur rôle applicatif recevant un `delete` sur le brut sans ce privilège échoue sur
  `permission denied for function` : le défaut est **fermé**.

Deux invariants s'ajoutent du même mouvement.

**Un fait écrit gèle tout le brut de sa session.** L'autorisation ne s'appuie plus sur le statut
affiché mais d'abord sur la **preuve** qu'un fait canonique existe : un lien de provenance, une
ligne normalisée committée, une écriture comptable committée. Remettre `status` en arrière ne
rouvre donc rien.

**Supprimer le brut d'une session vivante n'est pas un abandon.** Le socle autorisait la
suppression sur toute session `RECEIVING` ou `ANALYZED`, parce que c'était l'état dans lequel
`lfo_discard_import_session` travaillait — la RPC libérait les lignes _puis_ marquait la session,
en notant que l'inverse aurait fait refuser sa propre suppression. L'ordre s'inverse : la RPC
marque `DISCARDED` d'abord, et le garde n'autorise plus que cet état. Une suppression de brut
laisse désormais une trace dans la piste d'audit, ou elle est refusée. Les gels des lignes de
staging et des écritures comptables portent sur leur propre `commit_state`, jamais sur le statut
de la session : l'inversion ne les touche pas, et une session abandonnable n'a par définition
aucune ligne committée.

| statut de la session                 | suppression du brut, après correction |
| ------------------------------------ | ------------------------------------- |
| session réellement absente (cascade) | autorisée                             |
| un fait canonique existe             | **refusée**                           |
| `RECEIVING`                          | **refusée**                           |
| `ANALYZED`                           | **refusée**                           |
| `COMMITTED`                          | **refusée**                           |
| `FAILED`                             | **refusée**                           |
| `DISCARDED`                          | autorisée (abandon déclaré)           |

La modification reste refusée sans condition, avant comme après validation.

### Ce qui le vérifie

`scripts/smoke-import-acquisition.ts` § 11 bis : les cinq statuts, sous `service_role` ; le
retrait réservé à l'abandon déclaré ; un statut remis en arrière qui ne rouvre rien ; la cascade
légitime d'une session sans fait, ouverte ; la cascade d'une session à faits, barrée ; sous
`authenticated`, la lecture d'invariant, le `delete` et l'`update` tous refusés par les
privilèges. `scripts/verify-supabase-schema.ts` vérifie `SECURITY DEFINER`, la signature, le
type de retour, la volatilité, le `search_path` verrouillé et l'absence d'`execute` pour
`public`, `anon` et `authenticated`.

## 12. Fichiers

| Rôle                        | Chemin                                                                |
| --------------------------- | --------------------------------------------------------------------- |
| Schéma                      | `supabase/migrations/20260902093000_portfolio_import_acquisition.sql` |
| Lecteur ZIP                 | `src/lib/acquisition/xlsx/zip.ts`                                     |
| Lecteur de classeur         | `src/lib/acquisition/xlsx/workbook.ts`                                |
| Contrats du domaine         | `src/lib/acquisition/portfolio/types.ts`                              |
| Mapping des colonnes        | `src/lib/acquisition/portfolio/mapping.ts`                            |
| Résolution d'instrument     | `src/lib/acquisition/portfolio/instruments.ts`                        |
| Déduplication               | `src/lib/acquisition/portfolio/dedupe.ts`                             |
| Analyse unifiée CSV/XLSX    | `src/lib/acquisition/portfolio/analyze.ts`                            |
| Repository                  | `src/lib/data/portfolio-import-repository.ts`                         |
| Validation                  | `src/lib/validation/portfolio-imports.ts`                             |
| Route                       | `src/app/api/imports/portfolio/route.ts`                              |
| Écran                       | `src/components/pages/imports/portfolio-section.tsx`                  |
| Smoke                       | `scripts/smoke-portfolio-import.ts`                                   |
| Durcissement du gel du brut | `supabase/migrations/20260903090000_import_raw_freeze_hardening.sql`  |
