# Document Intelligence, et première verticale : la liasse fiscale

Quatrième verticale de la fondation d'acquisition. Elle comble ce qui manquait entre le coffre
documentaire — un fichier stocké, jamais lu — et les moteurs de domaine : une LECTURE de
document, case par case, avec sa provenance géométrique, ses contrôles, ses corrections
humaines et son rattachement à un fait canonique.

La liasse fiscale est le parcours entrepreneur standard. Le FEC reste le parcours avancé, et
les deux coexistent sans se recouvrir.

## 1. Ce que la migration ajoute et ce qu'elle réutilise

Migration : `supabase/migrations/20260831154500_document_intelligence_foundation.sql`.

| Objet                                                           | Verdict d'audit         | Rôle                                                                                                                  |
| --------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `document_extraction_runs`                                      | AJOUT                   | un acte d'extraction : fichier, formulaire détecté avec sa preuve, nature du PDF, extracteur, décomptes, cycle de vie |
| `document_extraction_fields`                                    | AJOUT                   | une case lue : page, code imprimé, libellé, cadre, valeur brute, valeur normalisée, correction                        |
| `document_extraction_checks`                                    | AJOUT                   | le verdict d'un contrôle, avec ses opérandes réels                                                                    |
| `import_upload_tickets`                                         | EXTEND                  | le chemin « navigateur → stockage privé » du FEC est REPRIS tel quel. Une colonne de cible en plus                    |
| `import_record_links`                                           | EXTEND                  | troisième forme, `TAX_RETURN_FINANCIALS`. Un seul pont de provenance, pas deux                                        |
| `lfo_record_business_financials`                                | REUSE SANS MODIFICATION | chemin d'écriture existant et unique de `business_financials`                                                         |
| bucket `family-office-import-staging`                           | EXTEND                  | `application/pdf` ajouté à la liste MIME, additivement                                                                |
| Business Equity, FEC, Cash Flow, Scenarios, Goals, Decision Lab | NON TOUCHÉS             | aucun fichier de ces domaines dans le diff                                                                            |

Huit RPC, toutes `security invoker`, `search_path` verrouillé, réservées à `service_role` :
`lfo_open_document_extraction`, `lfo_append_document_extraction_fields`,
`lfo_evaluate_document_extraction_checks`, `lfo_correct_document_extraction_field`,
`lfo_validate_document_extraction`, `lfo_link_document_extraction_financials`,
`lfo_reject_document_extraction`, `lfo_record_document_staging_cleanup`.

### Une régression évitée, consignée dans la migration

Une première version de cette migration réécrivait `lfo_record_business_financials` pour lui
faire accepter les bornes de l'exercice. C'était une régression : la fonction a été révisée
trois fois depuis sa création, et la version la plus ancienne est celle qu'on trouve en premier
dans l'historique. La réécrire à partir de celle-là supprimait son `on conflict do update` —
donc toute correction d'une période déjà renseignée — et quatre colonnes ajoutées depuis.

La version en vigueur accepte DÉJÀ `period_start`, `period_kind` et `period_label` : il n'y
avait rien à changer. Le smoke FEC l'a détecté ; le smoke de cette verticale, seul, ne l'aurait
pas vu. La règle qui en découle est écrite dans la migration : avant de remplacer une RPC
existante, chercher sa DERNIÈRE version dans l'historique, jamais la première.

## 2. Invariants portés par la base

- **DOCUMENT ≠ LECTURE ≠ FAIT CANONIQUE.** Trois actes explicites. Déposer un PDF n'écrit rien ;
  le lire n'écrit rien de canonique ; seule la liaison écrit un fait. Le smoke vérifie qu'après
  une lecture complète, `business_financials` est toujours vide.
- **VALIDER ≠ RATTACHER.** Deux décisions distinctes, deux statuts (`VALIDATED`, `LINKED`). Les
  confondre priverait l'utilisateur du droit de juger une lecture juste sans en tirer un chiffre.
- **CASE VIDE ≠ CASE À ZÉRO.** Une case de liasse laissée blanche ne déclare rien. Son code est
  imprimé, sa valeur non. La contrainte `document_extraction_fields_raw_shape_ck` autorise la
  ligne sans valeur, et refuse l'inverse : une valeur normalisée sans valeur brute qui l'explique.
- **CONTRÔLE NON CALCULABLE ≠ CONTRÔLE PASSÉ.** Un contrôle dont un opérande n'a pas été trouvé
  rend `NOT_COMPUTABLE`. Un opérande AMBIGU — deux cases pour le même code — le rend
  `NOT_COMPUTABLE` aussi : sommer les deux inventerait un total que le document ne porte pas.
- **L'ARITHMÉTIQUE DES CONTRÔLES EST FAITE EN BASE.** L'extracteur dit QUELLES cases comparer ;
  il ne dit pas si elles s'équilibrent. Une charge de requête forgée ne peut donc pas déclarer un
  bilan équilibré. Même doctrine que la partie double du FEC.
- **VALEUR BRUTE ≠ VALEUR NORMALISÉE ≠ VALEUR CORRIGÉE.** Trois colonnes. Corriger une lecture
  n'efface jamais ce que le document imprimait, et un trigger refuse toute réécriture du code,
  de la page, du cadre, de la valeur brute et de la méthode d'extraction.
- **OCR_REQUIRED ≠ ÉCHEC ≠ VALEUR SUPPOSÉE.** Un PDF sans couche texte est un fait technique
  nommé. `document_extraction_runs_ocr_shape_ck` interdit à une telle lecture de porter des cases.
- **UNE CORRECTION RÉ-ÉVALUE LES CONTRÔLES DANS LA MÊME TRANSACTION.** Sans cela l'utilisateur
  verrait une case corrigée à côté d'un contrôle calculé sur l'ancienne valeur, et validerait un
  état qui n'a jamais existé.
- **LE FAIT ÉCRIT EST RECONSTRUIT DEPUIS LA BASE.** Jamais repris du preview reçu par le client.
- **LIASSE ≠ COMPTE DE RÉSULTAT NORMALISÉ.** `ebitda`, `ebit`, `capex`, `free_cash_flow`,
  `working_capital` et `gross_margin` sont REFUSÉS par la RPC de liaison, avec un message qui dit
  pourquoi. Les ignorer silencieusement laisserait croire qu'ils ont été pris en compte.
- **CONFLIT DE SOURCES ≠ CHOIX SILENCIEUX.** Une période déjà renseignée par une autre origine
  n'est jamais écrasée. La preuve est la provenance, pas un libellé.
- **UNE LECTURE RATTACHÉE EST GELÉE.** Cases non modifiables, contrôles non ré-évaluables,
  lecture non rejetable, provenance non supprimable. Un fait écrit doit rester explicable par ce
  qui l'a produit.
- **IDEMPOTENCE.** Le même contenu de fichier ne produit qu'un fait canonique par société
  (`document_extraction_runs_linked_file_uidx`). Une lecture encore ouverte du même fichier est
  REMPLACÉE, et l'ancienne reste lisible.

## 3. Le choix qui structure toute la verticale : aucun code de case en dur

`src/lib/acquisition/documents/liasse/spec.ts` ne contient **aucune table de numéros de case**.
Pas une seule. Ce n'est pas un manque : c'est la conséquence d'une contrainte assumée.

La nomenclature officielle des cases des formulaires 2033-A à G et 2050 à 2059-G n'est pas dans
ce dépôt, et l'environnement de développement ne peut pas la télécharger — la politique de sortie
réseau de l'organisation refuse `impots.gouv.fr`. Écrire ici trois cents codes de mémoire
produirait exactement ce que la doctrine interdit : des chiffres sans source rattachable, faux là
où la mémoire se trompe, et impossibles à auditer.

L'extraction est donc **conçue pour lire les codes dans le document**. Une ligne de liasse
s'imprime ainsi :

```text
Immobilisations incorporelles        AB      120 000      20 000      100 000
└──────────── libellé ─────────┘     └code┘  └─ brut ──┘  └ amort ─┘  └── net ──┘
```

Le code est à côté de sa valeur, et c'est de là qu'il vient. Deux conséquences heureuses : un
formulaire dont le millésime change de numérotation reste lu, et un formulaire jamais rencontré
l'est aussi.

Ce que le fichier contient à la place, ce sont des **ancres** :

1. des ancres de DÉTECTION : les chaînes qu'un formulaire imprime pour se nommer (`2050-SD`) ;
2. des ancres de LIGNE : les libellés comptables imprimés en clair (`TOTAL GÉNÉRAL`,
   `RÉSULTAT DE L'EXERCICE`), qui servent à retrouver DANS le document le code de la case portant
   un total — et donc à construire les contrôles.

Ces libellés sont des ancres déclarées, à confronter aux formulaires officiels. **Leur incertitude
est sans danger, et c'est le point important** : une ancre qui ne s'apparie pas rend le contrôle
`NOT_COMPUTABLE`, jamais `PASSED`. Le mode de défaillance est « je ne sais pas », jamais « c'est
bon ».

### Ce qui empêche de lire un mot comme un code

Le motif d'un code du régime normal — deux ou trois capitales — apparie aussi « ET » ou « TVA »
dans un libellé. C'est la COLONNE qui tranche : les codes d'un formulaire sont alignés
verticalement, par dizaines, et un jeton n'est retenu que si son abscisse appartient à une colonne
portant au moins trois candidats sur la page. Ce critère est celui de la mise en page, pas du
vocabulaire.

Un second piège a été trouvé par un test, et corrigé : un code du régime simplifié est fait de
trois chiffres, et une colonne de petits montants — « 100 », « 200 », « 300 » — a la même forme.
Les deux numérotations sont donc essayées L'UNE APRÈS L'AUTRE, les lettres d'abord, et une colonne
de codes numériques n'est retenue que si ses jetons ont, la plupart du temps, un montant à leur
droite.

### La colonne d'une case n'est jamais supposée

Les en-têtes « Brut », « Amortissements », « Net » sont cherchés dans le tiers supérieur de la
page. Sans eux, la colonne reste `null` et les contrôles qui en dépendent deviennent
`NOT_COMPUTABLE`. Supposer que la troisième case est le net serait probablement vrai — et c'est
précisément pourquoi il ne faut pas le supposer : la supposition serait invisible le jour où elle
est fausse.

## 4. Conventions de lecture des nombres et des dates

La doctrine de l'import tabulaire est transposée du niveau COLONNE au niveau DOCUMENT — un
formulaire administratif n'a pas deux conventions selon la page :

1. la convention se DÉDUIT du document quand une valeur la tranche (`1 234,56` tranche pour la
   virgule décimale ; `1,234` ne tranche rien) ;
2. quand rien ne la tranche, la convention réglementaire française est retenue et **déclarée**
   par une anomalie `INFO` ;
3. quand deux valeurs se contredisent, seules les valeurs RÉELLEMENT ambiguës sont bloquées.
   `1 234` donne le même nombre dans les deux lectures et reste lu ; `3,456` est bloqué, avec sa
   valeur imprimée conservée.

Le point 3 compte le plus : bloquer tout le document parce qu'une case est ambiguë ferait perdre
trois cents cases lisibles.

Même règle pour l'ordre jour/mois. Une clôture ambiguë n'est pas retenue : un exercice clos le
3 avril n'est pas un exercice clos le 4 mars. Et une date d'ouverture absente n'est **pas**
reconstituée en retirant un an — un exercice de dix-huit mois existe.

## 5. Ce qui est écrit dans Business Equity, et ce qui ne l'est pas

Deux postes seulement : **chiffre d'affaires** et **résultat de l'exercice**. Ce sont les seuls que
le formulaire imprime en clair, et les lire n'exige aucun jugement.

Ne sont PAS écrits, et l'écran dit pourquoi poste par poste :

| Poste             | Raison                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ebitda`          | une convention : quelles charges retraiter, quelles reprises neutraliser. Appartient au ledger de Quality of Earnings, sur décision humaine |
| `ebit`            | même raison                                                                                                                                 |
| `capex`           | une liasse imprime des dotations aux amortissements, pas des investissements décaissés. D&A ≠ CAPEX CASH                                    |
| `free_cash_flow`  | dérivé d'un EBITDA et d'un capex, donc de deux conventions                                                                                  |
| `working_capital` | son périmètre est une convention d'analyse                                                                                                  |
| `gross_margin`    | la marge dépend de la convention retenue ; le formulaire n'en imprime aucune                                                                |

Ce ne sont pas des postes qu'on a échoué à lire. Ce sont des postes qu'une liasse ne contient pas.

## 6. Parcours utilisateur

`Imports → Liasse fiscale (PDF)`.

1. dépôt : société, PDF, conservation au coffre optionnelle. Le fichier va du navigateur au
   stockage privé, par billet à chemin calculé en base, à usage unique et expirant ;
2. identification : formulaires reconnus avec la page et la chaîne trouvée, régime, exercice lu,
   SIREN lu, nature du PDF ;
3. contrôles : verdict, opérandes réels, écart et tolérance. `NOT_COMPUTABLE` est expliqué ;
4. cases : filtre « à regarder » par défaut, valeur imprimée à côté de la valeur retenue,
   formulaire, colonne, page, anomalies ;
5. corrections case par case, avec motif. Les contrôles sont ré-évalués immédiatement ;
6. validation de la lecture ;
7. écriture de l'instantané financier, devise DÉCLARÉE ;
8. la lecture est alors gelée.

## 7. Ce qui est BLOQUÉ ou DIFFÉRÉ

### 7.1 `BLOCKED_EXTERNAL` — formulaires officiels inaccessibles

La politique d'egress de l'organisation refuse `www.impots.gouv.fr` (403 au CONNECT, constaté).
Conséquences :

1. **aucun formulaire officiel n'a pu être lu**. Les fixtures sont des mises en page synthétiques,
   réalistes mais inventées. Elles prouvent que la chaîne fonctionne — octets d'un PDF réel →
   couche texte → détection → cases → contrôles — mais **pas** que la mise en page réelle des
   formulaires DGFiP est celle-ci ;
2. les ancres de libellé n'ont pas été confrontées aux libellés réels. Leur échec est sans
   danger : il produit `NOT_COMPUTABLE`.

**Attendu pour lever le blocage** : une liasse réelle, ou les formulaires vierges officiels.
Contrôle à exécuter : déposer la liasse, vérifier que les formulaires sont reconnus, que
`TOTAL GÉNÉRAL` s'apparie de part et d'autre, et que `BALANCE_SHEET_EQUALITY` passe.

Le jour où cette confrontation a lieu, la seule chose à ajuster est le contenu de
`ROW_ANCHORS` et `COLUMN_ANCHORS` — de la donnée déclarative, sans changement de moteur.

### 7.2 `DEFERRED` — reconnaissance de caractères

Aucun OCR n'est implémenté, et c'est volontaire. Un PDF scanné rend `OCR_REQUIRED` : la lecture
est persistée, ses anomalies sont nommées, et **aucune valeur n'est déduite**. Livrer un OCR non
validé produirait des chiffres d'apparence normale dont personne ne pourrait dire s'ils sont
justes — exactement l'inverse de ce que cette fondation existe pour garantir.

La fondation est prête à l'accueillir : `extraction_method = 'OCR'` est déjà une valeur permise,
et `confidence_score` attend un score par case.

### 7.3 `DEFERRED` — autres familles de documents

`document_family` déclare déjà `ANNUAL_ACCOUNTS`, `BANK_STATEMENT`, `CONTRACT`,
`AMORTIZATION_SCHEDULE`, `WEALTH_DOCUMENT`. Aucune n'est implémentée. Le prompt de mission
demandait explicitement de ne pas les survoler : une fondation commune robuste et une verticale
réellement fonctionnelle valent mieux que cinq extracteurs à moitié faits.

## 8. Gates exécutés

| Gate                                     | Résultat                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `npm run lint`                           | vert                                                                   |
| `npx tsc --noEmit`                       | vert                                                                   |
| `npm run test`                           | 1 298 tests, 66 fichiers, verts (+55)                                  |
| `npm run build`                          | vert                                                                   |
| `npm run db:local:reset`                 | 34 migrations reconstruites depuis une base vide                       |
| `npm run db:verify:local`                | 82 tables, 302 contraintes, 82 RPC, 14 tables d'audit en lecture seule |
| `npm run gate:local`                     | vert, tous smokes compris                                              |
| `scripts/smoke-document-intelligence.ts` | vert, intégralement rollbacké                                          |

`npm run db:verify` distant n'a PAS été exécuté : aucun credential de production n'est présent
dans cet environnement, et la migration n'est PAS appliquée en production.

## 9. Dépendance ajoutée

`pdfjs-dist` en version épinglée, employée par un SEUL fichier : `pdf-extract.ts`. Aucun rendu,
aucun canvas, aucune police système, aucune évaluation de code embarqué — seule la couche texte
est lue, et un PDF déposé par un tiers ne peut rien exécuter dans le processus serveur.

Cette frontière est ce qui rend la verticale testable : tout ce qui LIT un formulaire travaille
sur une structure que les tests fabriquent à la main, et l'adaptateur est éprouvé séparément sur
de vrais PDF construits par le générateur de fixtures.
