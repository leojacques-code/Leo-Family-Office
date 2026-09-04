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

### Un septième conflit, hors du schéma : `package.json`

La même dérive existe un étage plus haut, et elle a échappé au gate. `pdfjs-dist` s'est retrouvé
déclaré DEUX FOIS : en `dependencies` à la version qu'une verticale avait lue, en
`devDependencies` à celle que `main` portait déjà. Un seul arbre est installé, donc **une seule
des deux versions gagne** — et ce n'était pas celle contre laquelle le code compilait.

Le gate local ne l'a pas vu, pour une raison qui vaut d'être écrite : `npm run build` construisait
sur un `node_modules` DÉJÀ EN PLACE, portant encore l'ancienne version. **Un gate qui construit sur
un arbre existant ne prouve pas ce qu'une installation propre produira.** La préview a échoué au
premier `npm ci`, sur un champ retiré par la version majeure suivante.

Résolution : une seule déclaration, en `dependencies` puisque le code l'importe à l'exécution, à la
version de `main` — la plus récente et celle contre laquelle ses propres tests tournaient déjà. Le
code appelant est adapté, et l'option de sécurité qu'il posait a été VÉRIFIÉE plutôt que supprimée :
`isEvalSupported: false` n'existe plus parce que la CAPACITÉ n'existe plus, les builds installés ne
contenant ni `eval(` ni `new Function(`. Une option retirée n'est pas une garantie perdue, mais
c'est à démontrer, pas à supposer.

Un contrôle en porte la leçon : `src/lib/__tests__/dependency-declarations.test.ts` refuse un paquet
déclaré des deux côtés, et une plage de version ajoutée hors des exceptions nommées.

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

## 6. Reprise après revue : trois findings corrigés

La revue de l'intégration a rendu un verdict bloquant sur trois points. Ils sont corrigés sur
cette même branche, et voici ce que chacun a réellement coûté.

### 6.1 Marqueurs de conflit dans `.env.example`

La résolution manuelle de six conflits partagés en a laissé un derrière elle. Il ne cassait ni le
build ni les tests — `.env.example` n'est lu par aucun module — et il se serait donc propagé
jusqu'au poste du lecteur suivant, qui aurait copié une variable inexistante ou perdu celle que
l'autre branche déclarait. La résolution est **cumulative** : `INPI_RNE_TOKEN`,
`DVF_API_BASE_URL` et `DPE_API_BASE_URL` coexistent, chacune une seule fois.

Un garde-fou est ajouté, parce que la relecture humaine a déjà échoué une fois :
`npm run check:conflict-markers` balaie **l'arbre suivi** par git, et non un diff. `git diff
--check` couvre le même besoin mais seulement pour ce qu'un diff donné modifie : un marqueur
introduit par un commit antérieur à la fenêtre examinée lui échappe. Le contrôle est aussi un test
de la suite, donc il tourne dans `npm run test` sans qu'on ait à y penser.

MARQUEUR NON AMBIGU ≠ SÉPARATEUR AMBIGU : `<<<<<<<`, `|||||||` et `>>>>>>>` sont refusés partout ;
`=======` seul est aussi un soulignement Markdown, et n'est retenu que dans un fichier portant déjà
un marqueur non ambigu. Un garde-fou qui crie à tort finit désactivé.

### 6.2 Audit immuable des corrections de portefeuille

Traité dans `docs/PORTFOLIO_IMPORT.md`, section « Corriger une observation déjà persistée ». En
résumé : un tableau d'identifiants n'est pas une décision, c'est un consentement anonyme. Il ne
disait ni pourquoi, ni par qui, ni sur la foi de quel état courant, et la mutation effaçait
définitivement la valeur remplacée. La migration corrective `20260904093000` ajoute une piste
immuable, et la décision porte désormais son motif et l'état qu'elle croit corriger — ce qui rend
deux corrections concurrentes détectables au lieu de silencieuses.

### 6.3 Durcissement du transport HTTP commun

`src/lib/acquisition/transport.ts` lisait le corps d'une réponse **sans borne**, parsait n'importe
quel type de contenu, n'acceptait aucun signal d'appelant, et recopiait `error.message` dans un
diagnostic **persisté**. Aucun second transport n'a été créé : le module unique est durci.

| Point                                | Avant                         | Après                                                                                          |
| ------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Taille de réponse                    | illimitée (`response.text()`) | plafond déclaré (`maxResponseBytes`, 4 Mio par défaut), surchargeable par connexion            |
| `Content-Length` au-delà             | ignoré                        | refus **avant lecture**, aucun octet accumulé                                                  |
| `Content-Length` absent ou mensonger | aucune protection             | lecture **incrémentale**, interrompue au premier octet au-delà, reader annulé                  |
| `Content-Type`                       | non contrôlé                  | `application/json` et `application/*+json` seuls, paramètres (`charset`) autorisés             |
| Signal de l'appelant                 | inexistant                    | `AbortSignal` accepté et **composé** avec le délai interne, écouteur retiré à chaque tentative |
| Abandon vs délai                     | confondus en `TIMEOUT`        | `CANCELLED` distinct, et non réessayable                                                       |
| Diagnostic                           | `error.message` verbatim      | message **construit**, aucun `error.message`, URL, chaîne de requête, en-tête ni corps         |

Le dernier point est le plus concret : `fetch` de Node cite l'URL demandée dans le texte de son
exception, cette URL porte les jetons passés en paramètre, et ce message était persisté dans
l'instantané d'échec puis affiché. Un test vérifie qu'une exception contenant
`https://…?token=secret` ne laisse apparaître ni l'URL ni le secret dans le résultat.

`RESPONSE_TOO_LARGE` est un code distinct d'`INVALID_RESPONSE` : la source n'a rien fait de mal,
c'est **notre** plafond qui a tranché. Les confondre ferait chercher une malformation là où il n'y
a qu'un volume, et masquerait le seul cas où relever le plafond est la bonne réponse.

Le signal descend des routes Next jusqu'au transport : `/api/registry` et
`/api/real-estate/public-data` transmettent `request.signal`, et un appelant déjà parti n'engendre
**aucun appel réseau** — donc aucune consommation de quota fournisseur pour une réponse que plus
personne ne lira.

### 6.4 Findings non bloquants

**Prettier global.** Il n'existe **aucune CI GitHub** dans ce dépôt : le répertoire `.github/` est
absent, `npm run format:check` n'est donc exécuté par aucun automate. Vingt-deux fichiers de `main`
ne sont pas conformes ; **aucun** n'est touché par cette intégration. Cette dette est
**préexistante** et documentée ici plutôt que masquée : la reformater dans cette PR noierait le
diff de la correction sous des dizaines de fichiers sans rapport. Tous les fichiers touchés par
cette branche sont, eux, conformes.

**Paquets optionnels ou surnuméraires.** Sur installation propre (`npm ci`), `npm ls --all` ne
signale ni `extraneous`, ni `invalid`, ni `missing`. Le lockfile n'est pas modifié.

## 7. Second tour de revue : quatre blockers, trois améliorations

La revue suivante a reproduit les gates puis rendu quatre blockers. Ils sont corrigés sur cette
même branche, par la migration additive `20260905090000` et par le durcissement du transport.

### 7.1 Représentation exacte de l'état attendu

`nullif(btrim(coalesce(expected ->> 'quantity', '')), '')::numeric` rendait le même `NULL` SQL pour
une clé **absente**, un JSON `null` et une chaîne **vide**. Un client qui omettait `market_value`
obtenait donc l'interprétation d'un client qui déclarait la valeur absente : son état attendu se
trouvait « d'accord » avec une observation dont il ne savait rien, le conflit de concurrence ne se
déclenchait pas, et un fait était remplacé sur la foi d'un oubli. Les cinq clés sont maintenant
exigées, chaque forme a un traitement, et le contrôle est appliqué au schéma TypeScript, à la
route/repository et à la RPC **avant toute écriture**. Détail dans `docs/PORTFOLIO_IMPORT.md`.

### 7.2 Auteur vérifié de la décision

`decided_by` était une chaîne **libre** fournie par le navigateur. Une piste d'audit dont le champ
« qui » est déclaratif ne répond pas à « qui a décidé » : elle répond à « qui l'appelant a bien
voulu nommer ». La colonne est supprimée ; `actor_user_id` la remplace, `NOT NULL`, référencé sur
`auth.users`, contraint à `= user_id` pour cette version, et posé par la RPC depuis `p_user_id` —
l'identité que le serveur établit. Toute clé d'acteur présente dans la charge est **refusée**, pas
ignorée. `executed_by` reste une colonne distincte : ACTEUR HUMAIN ≠ RÔLE TECHNIQUE.

Aucune délégation n'est construite : ce produit n'a pas d'utilisateurs multiples, et un mécanisme
de délégation sans utilisateur serait un mécanisme sans emploi. La contrainte d'égalité est le
point où une future délégation devra être décidée, bruyamment.

### 7.3 Limite HTTP incontournable

Le plafond de taille de réponse était « déclaré » par connexion, donc un adaptateur pouvait
déclarer `Infinity` : le plafond devenait ce que l'appelant voulait bien s'accorder, et une limite
qu'un appelant peut relever ne protège de rien. `MAX_TRANSPORT_RESPONSE_BYTES` (4 Mio) est
désormais un **maximum absolu** ; une connexion peut seulement resserrer. `Infinity`, `NaN`, un non
entier, zéro, un négatif ou une valeur au-delà du maximum font refuser l'appel **avant tout
réseau**, avec le code neutralisé `CONFIG_INVALID` — un code qui n'accuse ni la source ni le
réseau, puisque aucune requête n'a été émise. Aucun jeton de quota n'est consommé.

### 7.4 Inventaire exact des tables

Le gate annonçait « 105 tables » en publiant la longueur d'une **liste déclarative** comme si
c'était une mesure, alors que la base en reconstruisait 106. `bank_sync_events` manquait à
`userOwnedTables`, et sa RLS comme sa policy propriétaire n'étaient donc vérifiées par personne —
elles existaient, mais rien ne le prouvait. La table est ajoutée, et un **contrôle d'inventaire
exact** compare désormais l'inventaire déclaré aux tables de base réellement présentes, en
échouant dans les deux sens. Le résumé annonce le nombre attendu **et** le nombre constaté.

### 7.5 Les trois améliorations fermées

**Suppression d'un utilisateur.** `ON DELETE CASCADE` cohabitait avec un trigger refusant tout
`DELETE` : la cascade demandait ce que le trigger refusait. Les deux clés vers `auth.users` passent
en `ON DELETE RESTRICT`. La suppression destructive d'un utilisateur portant une piste financière
est interdite ; une procédure de désactivation ou d'anonymisation reste à concevoir et n'est pas
construite ici.

**MIME.** Le contrôle de `Content-Type` avait lieu **après** la lecture bornée : une page HTML
rendue en HTTP 200 était intégralement téléchargée — jusqu'à 4 Mio — pour être ensuite refusée. Il
passe avant, le corps est explicitement annulé, le statut est conservé, et aucun contenu
fournisseur n'est restitué. Sur un statut d'erreur, le corps reste lu : il sert le diagnostic.

**Attente de quota.** Le signal de l'appelant n'était contrôlé qu'à l'entrée de boucle, donc avant
l'attente. Il est revérifié **après** l'attente et avant `limiter.record()` comme avant
`fetchImpl` : une annulation pendant l'attente n'émet aucune requête, ne consomme aucun jeton, et
ne déclenche aucun réessai.

### 7.6 Migration

Aucune commande de création de migration n'existe dans ce dépôt : la convention est un fichier
horodaté dans `supabase/migrations/`, et c'est `db:local:reset` puis `db:verify` qui l'éprouvent.
`20260905090000_portfolio_correction_actor_and_expected.sql` suit cette convention. Aucune des 43
migrations présentes au head audité n'est modifiée. **Nouveau total : 44 migrations**, 106 tables
publiques.

## 8. Leçons portées dans `CLAUDE.md`

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
