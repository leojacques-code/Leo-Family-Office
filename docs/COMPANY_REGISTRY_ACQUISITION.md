# Acquisition du registre d'entreprises

Troisième verticale de la fondation d'acquisition, après le relevé bancaire CSV et le FEC.
Elle fait entrer dans LFO l'IDENTITÉ LÉGALE d'une société détenue, et rien d'autre : ni
valorisation, ni comptabilité, ni finance.

## 1. Pourquoi elle ne réutilise PAS les tables d'import

L'audit préalable a conclu à `REUSE` de la doctrine et `KEEP` des tables. La raison est
d'unité :

`import_sessions`, `import_raw_records` et `import_normalized_records` décrivent un FICHIER
LU LIGNE PAR LIGNE : numéro de ligne, séparateur, mapping de colonnes, verdict de doublon par
ligne. Un FEC est un fichier de lignes, l'extension était donc légitime. Une réponse de
registre ne l'est pas : son unité est un INSTANTANÉ D'ENTITÉ. L'y forcer imposerait
`row_number = 1`, `raw_line = <json>`, `delimiter = null`, `parser = null` — la piste d'audit
mentirait sur ce qui s'est passé.

Ce qui EST réutilisé, et qui compte davantage :

- la chaîne `source → brut immuable → normalisé → validation → lien → fait canonique` ;
- le vocabulaire de provenance : `data_kind`, `confidence`, `source`, dates d'observation ;
- les clés étrangères composites `(id, user_id)`, qui empêchent une ligne d'un propriétaire de
  désigner l'objet d'un autre ;
- la discipline « `authenticated` LIT, les RPC `lfo_*` réservées à `service_role` ÉCRIVENT » ;
- le trigger d'immuabilité du brut ;
- `businesses(id, user_id)` comme unique porte d'entrée du domaine Business Equity.

`external_sources` existait depuis la migration initiale, sans un seul usage applicatif. Elle
est ADOPTÉE comme registre des connexions externes plutôt que doublée par une table parallèle.

## 2. Ce que la migration ajoute

Migration : `supabase/migrations/20260831101500_company_registry_acquisition.sql`.

| Objet                             | Rôle                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `external_sources` (étendue)      | connexion à un fournisseur : domaine, adaptateur, capacités SERVIES, mode d'authentification, NOM de la variable d'environnement du secret, quota, fraîcheur déclarée, état |
| `company_registry_snapshots`      | ce que le fournisseur a RÉELLEMENT répondu. Immuable. Un échec est un instantané daté                                                                                       |
| `company_registry_profiles`       | lecture normalisée d'un instantané d'entité. Staging                                                                                                                        |
| `company_registry_officers`       | dirigeants publiés, en minimisation stricte                                                                                                                                 |
| `company_registry_establishments` | établissements publiés                                                                                                                                                      |
| `company_registry_documents`      | actes et comptes annuels DISPONIBLES chez le fournisseur. Métadonnée, pas fichier                                                                                           |
| `business_registry_links`         | rattachement explicite société ↔ identité légale                                                                                                                            |
| `business_enrichment_decisions`   | machine à états CHAMP PAR CHAMP                                                                                                                                             |

Deux colonnes ajoutées à `businesses` : `siren` et `naf_code`. Deux seulement. Un registre
publie une identité, pas une finance : capital social, effectifs et catégorie d'entreprise
restent des OBSERVATIONS dans la couche registre et n'entrent pas dans `businesses`.

Six RPC, toutes `security invoker`, `search_path` verrouillé, réservées à `service_role` :
`lfo_upsert_external_source`, `lfo_record_registry_snapshot`, `lfo_link_business_registry`,
`lfo_unlink_business_registry`, `lfo_propose_business_enrichment`,
`lfo_decide_business_enrichment`.

## 3. Invariants tenus par la base

- **SNAPSHOT ≠ VÉRITÉ CANONIQUE.** Écrire un instantané ne change rien au patrimoine. Le
  smoke le vérifie explicitement en relisant la société après l'écriture.
- **CAPACITÉ NON SERVIE ≠ DONNÉE ABSENTE ≠ ZÉRO.** Un fournisseur qui ne publie pas le capital
  social ne dit rien du capital. La capacité est DÉCLARÉE par la connexion, et l'écran écrit
  « non servi par ce fournisseur ».
- **ACCEPTER UN VIDE N'EST PAS UN ENRICHISSEMENT.** Une décision `ACCEPTED` sans valeur est
  refusée par `business_enrichment_decisions_accept_shape_ck` ET par la RPC. Sans cela, un
  « accepter tout » effacerait une saisie utilisateur au motif que la source est muette.
- **PROVENANCE PAR CHAMP ≠ PROVENANCE DE LIGNE.** `businesses.data_kind` et
  `businesses.confidence` ne sont volontairement PAS modifiés par un enrichissement : ils
  qualifient la LIGNE, et les basculer en `EXTERNAL_DATA` parce qu'un champ vient du registre
  mentirait sur tous les autres. La provenance par champ vit dans
  `business_enrichment_decisions`.
- **UN SIREN, UNE SOCIÉTÉ.** `businesses_siren_uidx` et `business_registry_links_siren_uk`
  interdisent qu'un même SIREN se rattache à deux sociétés du patrimoine : ce serait la même
  participation comptée deux fois, une erreur que le bilan canonique ne peut pas détecter.
- **CONCURRENCE OPTIMISTE SUR LA VALEUR CANONIQUE.** Accepter une proposition dont la valeur
  canonique a changé depuis la comparaison est refusé. Sans ce contrôle, une observation
  ancienne écraserait en silence une saisie plus récente.
- **UNE SEULE PROPOSITION OUVERTE PAR CHAMP.** Index partiel
  `business_enrichment_decisions_open_uidx`. Deux propositions concurrentes sur le même champ
  mettraient l'utilisateur devant deux vérités externes sans arbitre.
- **UN ÉCHEC EST UN FAIT.** `company_registry_snapshots_outcome_ck` exige une réponse OU un
  code d'erreur. « Le registre n'a pas répondu le 31 août » est une information ; la perdre
  ferait croire que l'entreprise n'existe pas.
- **LA PROVENANCE D'UN FAIT DÉCIDÉ EST GELÉE.** Un instantané est immuable en `UPDATE`, et sa
  suppression est refusée dès qu'une décision s'y appuie.
- **UN NOM DE VARIABLE, JAMAIS UN SECRET.** `external_sources_credential_shape_ck` impose le
  format `^[A-Z][A-Z0-9_]{2,63}$` : un jeton collé par erreur est refusé mécaniquement, parce
  qu'un jeton porte des minuscules, des points ou des `=`.
- **OBSERVATION PÉRIMÉE ≠ OBSERVATION FAUSSE.** `stale_after` est dérivé de la fraîcheur
  DÉCLARÉE par la connexion, en base, à l'écriture. Un instantané dépassé reste lisible et
  signalé, jamais corrigé, jamais supprimé.

Le cinquième état d'un champ, `STALE`, est **DÉRIVÉ à la lecture** et volontairement non
persisté : un état qui dépend de l'heure qu'il est pourrit en silence dès qu'il est figé en
base. Les quatre états persistés sont `CANDIDATE`, `CONFLICT`, `ACCEPTED`, `REJECTED`.

## 4. Couche TypeScript

`src/lib/acquisition/registry/` — pur, sans React, sans accès base, sans état global.

| Fichier                    | Rôle                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| `types.ts`                 | contrat de fournisseur, capacités, codes d'erreur et d'anomalie, états de champ |
| `siren.ts`                 | forme et clé de contrôle d'un SIREN / SIRET                                     |
| `normalize.ts`             | lecteurs DÉFENSIFS et contrôles de cohérence                                    |
| `transport.ts`             | délais, réessais bornés, quota, classement d'erreurs                            |
| `diff.ts`                  | comparaison canonique ↔ registre, champ par champ                               |
| `recherche-entreprises.ts` | annuaire ouvert                                                                 |
| `inpi-rne.ts`              | INPI / RNE                                                                      |
| `fixture-provider.ts`      | fournisseur hors ligne, pour les tests et le mode sans accès                    |

`src/lib/data/registry-repository.ts` est la SEULE frontière entre un fournisseur et la base.

### Le mode de défaillance est choisi

Tous les lecteurs de `normalize.ts` rendent `null` PLUS une anomalie nommée dès qu'une valeur
n'a pas la forme attendue. Aucune coercition : `"n/a"` n'est pas une date, un objet reçu là où
une chaîne est attendue n'est pas `"[object Object]"`, `"1,5"` n'est pas 1,5 sur une réponse
JSON.

Conséquence directe et voulue : si le contrat d'un fournisseur change, la lecture rend
« inconnu et signalé ». Elle ne rend jamais une valeur fausse.

### Le cache est la base, pas la mémoire

Un instantané dont la péremption déclarée n'est pas atteinte est RÉUTILISÉ au lieu d'un nouvel
appel. Un instantané SANS péremption déclarée n'est jamais réutilisé : sans fraîcheur
déclarée, rien ne permet d'affirmer qu'il est frais. Aucun cache de processus n'est implémenté
— il serait vide à chaque exécution serverless et donnerait un taux de succès imaginaire.

## 5. Parcours utilisateur

`Imports → Registre d'entreprises`.

1. Les fournisseurs déclarent, AVANT tout appel, ce qu'ils servent et ce qu'ils ne servent pas.
2. Recherche par raison sociale, SIREN ou dirigeant. L'instantané est persisté, succès comme
   échec.
3. Ouverture d'une fiche. Réutilisation d'un instantané frais, ou appel neuf sur demande.
4. Rattachement explicite à une société du patrimoine.
5. Comparaison champ par champ : conflits, remplissages, et la liste des champs NON proposés
   avec leur raison.
6. Décision par champ, avec motif, conservée dans la piste d'audit.

## 6. Ce que chaque fournisseur sert réellement

| Champ enrichissable       | Annuaire ouvert                   | INPI / RNE            |
| ------------------------- | --------------------------------- | --------------------- |
| Dénomination              | oui                               | oui                   |
| Forme juridique (libellé) | **non** : seul le CODE est publié | oui                   |
| Secteur (libellé NAF)     | **non**                           | non                   |
| Code NAF                  | oui                               | oui                   |
| Pays                      | **non**                           | oui                   |
| Date de création          | oui                               | oui (immatriculation) |

Le cas de la forme juridique est instructif. L'annuaire ouvert publie un code de catégorie
juridique (« 5710 ») sans son libellé. Écrire ce code dans `businesses.legal_form`, là où
l'utilisateur a saisi « SAS », dégraderait une information lisible. Et traduire le code
demanderait la nomenclature officielle des catégories juridiques, absente de ce dépôt : la
reconstituer de mémoire serait une convention inventée. Le code est donc conservé comme
OBSERVATION et n'alimente aucune proposition.

Ne pas confondre l'**API Recherche d'Entreprises** (annuaire ouvert, sans authentification)
avec l'**API Entreprise**, dont l'accès est réservé aux administrations et organismes
habilités. Cet adaptateur n'appelle que la première.

## 7. Points BLOQUÉS par un accès externe

Ces points sont `BLOCKED_EXTERNAL`. Le code est écrit, testé sur fixtures et exécutable ; la
validation en conditions réelles est empêchée par un accès, pas par un manque de travail.

### 7.1 Sortie réseau refusée pour les hôtes de données publiques françaises

La politique d'egress de l'organisation refuse le CONNECT vers
`recherche-entreprises.api.gouv.fr`, `api.gouv.fr`, `www.impots.gouv.fr` et
`files.data.gouv.fr` (403 côté passerelle, vérifié). Aucun contournement n'a été tenté.

Conséquences :

1. La correspondance des champs de l'annuaire ouvert est écrite d'après le contrat PUBLIÉ.
   Elle n'a pas été confrontée à une réponse réelle. **Ce que cette incertitude ne peut pas
   produire, par construction : une valeur fausse** — un nom de champ erroné rend `null` avec
   son anomalie.
2. Le quota réel et le comportement en 429 n'ont pas été observés. Le limiteur est testé sur
   horloge pilotée.

**Attendu pour lever le blocage** : autoriser en sortie `recherche-entreprises.api.gouv.fr`,
puis exécuter une recherche et une fiche sur un SIREN réel et comparer les champs lus au
profil normalisé.

### 7.2 INPI / RNE — jeton absent et poignée de main non implémentée

Deux limites, assumées et distinctes :

- **Le jeton n'est pas disponible.** L'adaptateur le lit dans `INPI_RNE_TOKEN` côté serveur.
  Sans lui, il rend `CREDENTIALS_MISSING` **sans aucun appel réseau** : une connexion sans
  secret n'a rien à demander. C'est vérifié par un test.
- **L'échange identifiants → jeton n'est PAS implémenté**, et c'est `DEFERRED` volontaire. Le
  RNE délivre un jeton contre des identifiants par un appel dont le contrat exact ne peut pas
  être vérifié ici. Implémenter à l'aveugle une poignée de main d'authentification produirait
  du code qui a l'air fini et qui échouerait au premier appel réel — exactement la fausse
  impression de complétude que la doctrine interdit.

**Attendu pour lever le blocage** : un compte RNE, la décision d'implémenter l'échange ou de
fournir un jeton de longue durée, et l'autorisation de sortie vers
`registre-national-entreprises.inpi.fr`.

### 7.3 Téléchargement des actes et comptes annuels

`company_registry_documents` porte la MÉTADONNÉE d'un dépôt disponible, jamais le fichier.
Le téléchargement — et le remplissage de `document_id` vers le coffre privé — est hors
périmètre de cette PR : il dépend du point 7.2, et un dépôt disponible n'est de toute façon
pas un état financier lu. `FEC ≠ COMPTES ANNUELS` reste vrai ici.

## 8. Gates exécutés

| Gate                                | Résultat                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `npm run lint`                      | vert                                                                   |
| `npx tsc --noEmit`                  | vert                                                                   |
| `npm run test`                      | vert                                                                   |
| `npm run build`                     | vert                                                                   |
| `npm run db:local:reset`            | 34 migrations reconstruites depuis une base vide                       |
| `npm run db:verify:local`           | 87 tables, 329 contraintes, 80 RPC, 19 tables d'audit en lecture seule |
| `scripts/smoke-company-registry.ts` | vert, intégralement rollbacké                                          |
| `npm run gate:local`                | vert, tous smokes compris                                              |

`npm run db:verify` distant n'a PAS été exécuté : aucun credential de production n'est présent
dans cet environnement, et la migration n'est PAS appliquée en production.

**Aucune migration n'a été appliquée à Supabase production.** Le dépôt et la production
divergent déjà de deux migrations avant cette PR — `20260830154315_decision_lab_v2.sql` est au
dépôt et pas en production. Cette PR ajoute la troisième divergence. L'ordre d'application
devra être décidé avec le propriétaire du schéma : appliquer celle-ci sans Decision Lab V2 est
techniquement possible (aucune dépendance entre les deux), mais le verifier distant exigera
alors une liste de migrations qui ne correspond ni à l'une ni à l'autre situation.

## 9. Configuration

`.env.local`, côté serveur uniquement :

```bash
# Optionnel. Absent, le fournisseur INPI/RNE rend CREDENTIALS_MISSING sans appel réseau.
INPI_RNE_TOKEN=
```

Aucune variable `NEXT_PUBLIC_` n'est ajoutée. Aucun secret ne traverse le navigateur : le
navigateur appelle `/api/registry`, et c'est le serveur qui interroge le registre.
