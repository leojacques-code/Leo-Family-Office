# Données publiques immobilières : DVF et DPE

Cinquième verticale de la fondation d'acquisition. Elle fait entrer dans LFO deux jeux de
données **publiques** rattachables à un bien détenu : les mutations foncières (DVF) et les
diagnostics de performance énergétique (DPE).

Ce document dit ce que la verticale fait, ce qu'elle refuse de faire, et pourquoi chacun de
ces refus est une décision et non une limite technique.

## 1. Le problème que cette verticale ne résout pas

Un jeu de comparables DVF **n'est pas la valeur d'un bien**. Ce sont les ventes de quelqu'un
d'autre. Un DPE trouvé à une adresse **n'est pas le DPE d'un lot** : un immeuble en porte
autant qu'il a d'appartements. Un résultat vide **n'est pas une absence de marché** : il peut
signifier « zone non publiée ».

Toute la conception découle de ces trois phrases.

| Ce qu'on pourrait croire                        | Ce que la verticale fait                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| DVF valorise mon bien                           | DVF produit des faits sur d'autres transactions. Une valeur n'apparaît qu'après une décision humaine, sous une convention nommée |
| Une adresse identique prouve l'identité du bien | Elle produit une ressemblance forte, plafonnée à une confiance MOYENNE, à trancher par un humain avec un motif écrit             |
| Zéro résultat = aucune vente                    | Zéro résultat + couverture déclarée = information. Zéro résultat + couverture inconnue = silence                                 |
| Un DPE ancien est périmé                        | La fin de validité est **lue**. Absente, elle reste inconnue : elle n'est jamais déduite d'une règle absente du dépôt            |
| Une consommation donne une étiquette            | Non : la conversion suppose une grille et une zone climatique. `ÉTIQUETTE ABSENTE ≠ ÉTIQUETTE G`                                 |

## 2. Chaîne

```text
ADAPTATEUR (external_sources)
  → LECTURE BORNÉE (timeout, tentatives, limite de débit)
  → INSTANTANÉ IMMUABLE (real_estate_data_snapshots) — écrit MÊME EN ÉCHEC
  → LIGNES LUES (real_estate_comparable_sales | real_estate_energy_certificates)
  → PROPOSITION DE RAPPROCHEMENT (property_public_data_matches, état CANDIDATE)
  → DÉCISION HUMAINE (ACCEPTED avec motif | REJECTED)
  → ESTIMATION DÉRIVÉE À LA LECTURE (moteur pur, jamais persistée)
  → PROMOTION EXPLICITE → real_estate_valuations (méthode COMPARABLE_SALES)
```

Aucune flèche n'est automatique après la troisième. C'est le point.

## 3. Ce que la base garantit

| Invariant                                                                       | Porté par                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Un adaptateur de domaine a un provider, une version et une fraîcheur déclarée   | `external_sources_shape_v2_ck`                         |
| Un seul adaptateur par domaine, provider et propriétaire                        | `external_sources_domain_provider_uk`                  |
| Un échec porte son code et zéro ligne ; un vide n'en porte pas                  | `real_estate_data_snapshots_failure_shape_ck`          |
| `RÉSULTAT VIDE ≠ RÉSULTAT OBTENU`                                               | `real_estate_data_snapshots_empty_shape_ck`            |
| Une fraîcheur nulle ou inversée est refusée                                     | `real_estate_data_snapshots_stale_ck`                  |
| Le contenu lu est immuable et l'instantané non supprimable                      | trigger `real_estate_snapshot_frozen`                  |
| Une ligne lue ne se supprime pas isolément, son brut ne se récrit pas           | trigger `real_estate_public_row_frozen`                |
| `SURFACE ABSENTE ≠ SURFACE NULLE`                                               | `real_estate_comparable_sales_built_area_ck`           |
| `VALEUR SANS UNITÉ = NON INTERPRÉTABLE`                                         | `..._energy_unit_ck`, `..._ghg_unit_ck`                |
| `ÉTIQUETTE ABSENTE ≠ ÉTIQUETTE G`                                               | `..._energy_label_ck`, `..._ghg_label_ck`              |
| Une validité antérieure à l'établissement est refusée, jamais corrigée          | `..._validity_ck`                                      |
| Un rapprochement accepté porte une base nommée et une date                      | `property_public_data_matches_accept_shape_ck`         |
| Accepter un rapprochement FAIBLE exige un motif écrit                           | `property_public_data_matches_weak_accept_ck`          |
| Un seul rapprochement ouvert, et un seul accepté courant, par cible et par bien | index partiels `..._open_*_uidx`, `..._current_*_uidx` |
| Un chiffre dérivé porte sa convention, sa preuve et son décompte                | `real_estate_valuations_comparable_shape_ck`           |
| Un instantané public ne peut pas justifier une expertise notariale              | `real_estate_valuations_snapshot_method_ck`            |

`record_count` est **dérivé** des lignes réellement persistées, jamais repris d'un décompte
fourni par l'appelant. Même doctrine que Σdébits = Σcrédits par écriture du FEC.

## 4. Où le calcul se fait, et pourquoi ce partage

La médiane d'un prix au mètre carré multipliée par une surface est une **formule
financière**. La constitution la place en TypeScript, dans `src/lib/engine/real-estate-market.ts`,
moteur pur et testé. Elle n'est donc **pas** en SQL.

Mais un nombre reçu du client ne doit pas pouvoir être arbitraire. La RPC de promotion
**vérifie sans recalculer** :

1. le rapprochement est `ACCEPTED` et **courant** (non remplacé) ;
2. l'instantané n'est pas périmé — relire est gratuit, écrire un chiffre périmé ne l'est pas ;
3. la surface du bien est **déclarée** ;
4. au moins une mutation est exploitable (surface bâtie, prix positif, lot unique) ;
5. la valeur est **dans l'intervalle** des prix unitaires réellement persistés, multiplié par
   la surface.

Le point 5 est un **contrôle d'intégrité**, pas une valorisation : un encadrement ne calcule
rien, il refuse ce qui ne peut pas venir de cet instantané. Le serveur recalcule par ailleurs
la valeur depuis les mutations persistées, et le chiffre affiché au client n'entre jamais dans
la décision — même doctrine que le fait canonique d'une liasse, reconstruit depuis les cases
persistées.

## 5. Ce que le moteur refuse de calculer

`estimateMarketValue` rend `NOT_COMPUTABLE` — et **aucune valeur à côté** — dès que l'un des
trois manque : une surface déclarée, `MIN_USABLE_COMPARABLES` mutations exploitables, une
devise unique.

Un chiffre affiché avec un avertissement finit par être lu sans l'avertissement. C'est
pourquoi il n'y a pas de « estimation à confiance basse » sous le seuil : il n'y a pas
d'estimation.

Sont exclues du calcul unitaire, chacune avec son motif compté et nommé :

- les mutations **multi-lots** : un prix global divisé par la surface d'un lot ne veut rien
  dire ;
- les mutations **sans surface bâtie** : le prix unitaire n'existe pas ;
- les mutations à **prix nul** (donation, échange) : ce ne sont pas des ventes comparables ;
- les mutations dans une **autre devise** que la majoritaire : le FX Engine n'a pas sa place
  ici, parce que convertir des prix de marché historiques suppose une courbe.

La confiance rendue n'est **jamais** `HIGH`. Une estimation par comparables reste un modèle,
quelle que soit la qualité de l'échantillon, et elle est écrite avec
`data_kind = MODEL_ASSUMPTION` — pas `EXTERNAL_DATA` : les mutations sont des faits externes,
l'estimation qui s'en déduit ne l'est pas.

## 6. Rapprochement : pourquoi le plafond est structurel

`src/lib/acquisition/address.ts` décompose une adresse et la compare **critère par critère
nommé** : code postal, commune, type de voie, nom de voie, numéro, indice de répétition. Le
score porte sur les critères **connus** seulement, et vaut `null` — jamais zéro — quand aucun
ne l'est : zéro dirait « ça ne correspond pas », la vérité est « on ne sait pas ».

Un `BIS` n'est pas un détail de graphie : c'est une autre entrée, et il produit un désaccord
franc.

Un rapprochement de DPE est plafonné à une confiance `MEDIUM`, même sur une adresse
strictement identique et une surface concordante. Ce n'est pas de la prudence décorative :
sans référence de lot ni étage, deux appartements du même palier sont indiscernables.

## 7. Ce que l'environnement n'a pas permis de valider

La sortie réseau vers les hôtes de données publiques est **refusée par la politique de
l'environnement** (`CONNECT … 403` par le proxy, vérifié). Conséquences, énoncées plutôt que
masquées :

- **aucune lecture réelle de DVF ou de DPE n'a été effectuée.** La forme des paramètres et des
  réponses est donc _configurable_ et non codée en dur : `DVF_API_BASE_URL` et
  `DPE_API_BASE_URL` sont vides par défaut, et un adaptateur non configuré rend
  `NOT_SERVED` — une **capacité non servie**, jamais une absence de donnée ;
- les noms de champ sont tentés dans l'ordre parmi plusieurs graphies documentées, et un
  échec de toutes produit `null` **et** une anomalie nommée. Le mode d'échec est « inconnu et
  signalé », jamais « valeur plausible » ;
- `DVF_EXCLUDED_DEPARTMENTS` est une **déclaration de couverture à confronter au publieur**
  avant mise en production. Elle n'entre dans aucun calcul : son seul effet est le statut de
  couverture d'un instantané, donc l'interprétation d'un vide. Une liste erronée rend un vide
  plus prudent qu'il n'aurait dû, jamais un chiffre faux ;
- les unités DPE (`kWh/m2/an`, `kgCO2/m2/an`) sont **déclarées par l'adaptateur**, parce que la
  source les documente hors du corps de réponse. Les inférer d'un intitulé de colonne les
  rendrait dépendantes d'une graphie.

Un fournisseur de **fixture locale** existe (`FIXTURE_DVF`, `FIXTURE_DPE`) pour parcourir le
chemin complet sans réseau. Il porte son propre nom de provider, persisté avec chaque
instantané : une donnée de fixture rattachée à un bien reste identifiable comme telle pour
toujours, et ne peut jamais passer pour une lecture de source publique.

## 8. Ce qui n'est pas fait, et l'est délibérément

- **aucun géocodage.** Comparer deux écritures d'adresse est fait ; convertir une adresse en
  coordonnées demanderait un service externe, et un rayon en mètres autour d'un point n'est
  pas plus honnête qu'un code postal tant que le lot n'est pas identifié ;
- **aucune estimation dans le bilan canonique ni dans le Personal Monthly Financial Model.**
  Une estimation promue devient une valorisation datée ordinaire et suit le chemin existant de
  Real Estate V2 : une ligne d'actif signalée si elle vieillit, jamais indexée ;
- **aucune correction de l'existant.** Une valorisation antérieure n'est pas écrasée :
  l'historique de `real_estate_valuations` est conservé, et le moteur retient la plus récente
  non postérieure à la date de lecture ;
- **aucune indexation de prix.** Un instantané périmé décrit un marché passé, et il est
  signalé tel quel. Le vieillir par un indice reviendrait à inventer une trajectoire.

## 9. Règle héritée de la verticale précédente, appliquée ici

`lfo_record_real_estate_valuation` est **étendue**, pas réécrite depuis une version périmée :
deux clés optionnelles de charge s'ajoutent (`snapshot_id`, `derivation`), et la définition
reprise est celle en vigueur dans `20260826090117_real_estate_v2.sql`, vérifiée comme n'ayant
jamais été redéfinie depuis.

L'extension plutôt qu'un second chemin d'écriture n'est pas un choix de style : la contrainte
de forme exige la preuve **au moment de l'insertion**, et PostgreSQL ne connaît pas de
contrainte `CHECK` différable. Insérer depuis la nouvelle RPC aurait créé une seconde vérité
d'écriture sur `real_estate_valuations`.

## 10. Fichiers

| Rôle                 | Chemin                                                           |
| -------------------- | ---------------------------------------------------------------- |
| Schéma               | `supabase/migrations/20260831171500_real_estate_public_data.sql` |
| Transport borné      | `src/lib/acquisition/transport.ts`                               |
| Adresses             | `src/lib/acquisition/address.ts`                                 |
| Contrat d'adaptateur | `src/lib/acquisition/realestate/types.ts`                        |
| Lecteurs défensifs   | `src/lib/acquisition/realestate/read.ts`                         |
| Adaptateurs          | `src/lib/acquisition/realestate/{dvf,dpe,fixture-provider}.ts`   |
| Rapprochement        | `src/lib/acquisition/realestate/match.ts`                        |
| Moteur d'estimation  | `src/lib/engine/real-estate-market.ts`                           |
| Repository           | `src/lib/data/public-data-repository.ts`                         |
| Route                | `src/app/api/real-estate/public-data/route.ts`                   |
| Écran                | `src/components/pages/imports/public-data-section.tsx`           |
| Smoke                | `scripts/smoke-real-estate-public-data.ts`                       |
