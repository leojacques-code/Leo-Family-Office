# FEC / Corporate Data Acquisition

Comment une comptabilité de société entre dans Léo Family Office, et pourquoi la chaîne
s'arrête à des **candidats**.

Cette verticale est la deuxième de la Data Acquisition Foundation. Elle ne crée pas un
second pipeline : elle prouve que le premier était universel. Registre de sources,
sessions, brut immuable, piste d'audit en lecture seule et liens de provenance sont ceux de
`docs/DATA_ACQUISITION.md`, étendus à un nouveau domaine.

## 1. Ce qu'un FEC est, et ce qu'il n'est pas

Un Fichier des Écritures Comptables est une **source comptable détaillée** : l'intégralité
des écritures d'un exercice, validées, dans un fichier texte à plat, dont le format est
imposé par l'arrêté du 29 juillet 2013 pris pour l'application de l'article A47 A-1 du
Livre des procédures fiscales.

```text
FEC  ≠  COMPTES ANNUELS         il ne porte ni liasse, ni annexe, ni retraitement
FEC  ≠  VALORISATION            il ne dit rien d'un multiple ni d'une equity value
FEC  ≠  DUE DILIGENCE           il ne prouve pas qu'une écriture est économiquement normale
```

Ce que l'on en reconstruit est donc un **candidat** de compte de résultat et de bilan, et
son intégration au domaine Business Equity exige une déclaration de couverture.

## 2. Le format réellement supporté

Les dix-huit champs réglementaires, dans leur ordre réglementaire :

| # | Champ | Lu comme |
|---|---|---|
| 1 | `JournalCode` | code du journal, **structurant** |
| 2 | `JournalLib` | libellé du journal |
| 3 | `EcritureNum` | numéro d'écriture, **structurant** |
| 4 | `EcritureDate` | date de l'écriture, **structurante** |
| 5 | `CompteNum` | numéro de compte, **structurant** |
| 6 | `CompteLib` | libellé du compte |
| 7 | `CompAuxNum` | compte auxiliaire |
| 8 | `CompAuxLib` | libellé du compte auxiliaire |
| 9 | `PieceRef` | référence de la pièce |
| 10 | `PieceDate` | date de la pièce |
| 11 | `EcritureLib` | libellé de l'écriture |
| 12 | `Debit` | débit, **non signé** |
| 13 | `Credit` | crédit, **non signé** |
| 14 | `EcritureLet` | code de lettrage |
| 15 | `DateLet` | date de lettrage |
| 16 | `ValidDate` | date de validation |
| 17 | `Montantdevise` | montant en devise |
| 18 | `Idevise` | code de la devise |

L'en-tête est résolu **par nom**, pas par position : un fichier dont les colonnes sont dans
un ordre inhabituel est lu, et l'écart à l'ordre réglementaire est signalé plutôt que
d'être une raison de refus. À l'inverse, l'absence d'un champ structurant est une **erreur**
— sans journal, sans numéro d'écriture, sans date ou sans compte, il n'y a pas d'écriture à
lire, et il n'y a rien à deviner.

Sont également lus : les séparateurs `|`, tabulation, `;` et `,` ; les encodages UTF-8,
UTF-8 avec BOM et Windows-1252 ; le format de date réglementaire `AAAAMMJJ`, et les formats
non réglementaires courants (`JJ/MM/AAAA`, `AAAA-MM-JJ`) avec un signalement — un fichier
produit par un logiciel qui s'écarte du texte reste exploitable, mais l'écart se dit.

**Limite de vérification assumée** : le texte réglementaire primaire (Légifrance, BOFiP)
n'était pas joignable depuis l'environnement d'exécution, dont le proxy sortant a refusé
ces domaines. La liste des champs et l'ordre ci-dessus ont donc été établis à partir des
résultats de recherche concordants et de la spécification fournie avec la mission, non
d'une lecture directe du texte. Une relecture humaine du texte primaire reste à faire avant
de considérer ce point comme clos.

## 3. La partie double n'est pas une décoration

```text
ÉCRITURE COMPTABLE  →  N LIGNES
```

Une ligne de FEC **n'est pas** une transaction économique indépendante. Une vente de
1 200 € TTC produit trois lignes : un débit client de 1 200, un crédit produit de 1 000 et
un crédit TVA de 200. Compter chaque ligne comme un flux produirait trois fois la même
opération.

Les lignes sont donc regroupées par `(JournalCode, EcritureNum)`, et Σdébits est comparé à
Σcrédits avec une tolérance de 0,005. Un déséquilibre est signalé **sur chacune des lignes
de l'écriture** : l'utilisateur ne corrige pas une écriture en regardant une ligne isolée.

Une comptabilité déséquilibrée n'est pas fiable, et la validation la refuse — le refus est
porté par la RPC, pas par une vérification applicative.

## 4. ABSENT ≠ ZÉRO, jusque dans la base

Le format autorise explicitement un champ de montant vide : une ligne au débit laisse le
crédit vide. La réglementation fait donc elle-même la distinction que le produit défend
partout.

```text
côté ABSENT face à un côté renseigné   →  zéro par la CONVENTION du format
zéro EXPLICITEMENT transmis            →  une VALEUR
les DEUX côtés absents                 →  aucun montant : la ligne est BLOQUÉE
```

`fec_entry_lines.debit` et `.credit` sont donc nullables, et une contrainte de base impose
qu'une ligne aux deux côtés absents ne puisse exister qu'en statut `BLOCKED`. Deux autres
contraintes ferment le reste : les montants sont **non signés** (le sens est porté par la
colonne, un négatif signale une lecture fautive), et un montant en devise sans code devise
est refusé — le supposer égal à la devise de tenue serait un taux de change implicite égal
à 1.

## 5. Classification comptable ≠ jugement économique

Le numéro de compte porte une information réelle et vérifiable : la classe et le groupe
disent où une écriture se range. `src/lib/acquisition/fec/pcg.ts` s'arrête **exactement**
là.

```text
CLASSIFICATION COMPTABLE  ≠  JUGEMENT ÉCONOMIQUE / QoE
```

Un compte 625 est un poste « déplacements, missions et réceptions ». Ce n'est **pas** une
« dépense personnelle du dirigeant » : la même nature comptable couvre un déplacement
client parfaitement normal et un abus. Le retraitement appartient au ledger de Quality of
Earnings de Business Equity, sur décision humaine documentée — jamais à un préfixe.

Aucune fonction de ce module ne produit donc de retraitement, de normalisation, ni de
qualification `DEBT_LIKE`.

Les règles de préfixe sont triées par longueur décroissante : la plus spécifique gagne
toujours, quel que soit l'ordre d'écriture de la liste. 455 avant 45, 519 avant 51, 607
avant 60, 661 avant 66, 6037 avant 603.

## 6. Chaque montant porte le nom de sa convention

« EBITDA » ne veut rien dire tant qu'on n'a pas dit lequel. Chaque poste reconstruit porte
donc la convention qui l'a produit, affichée à l'écran à côté de la valeur.

La convention retenue pour l'excédent brut d'exploitation est celle des Soldes
Intermédiaires de Gestion du Plan Comptable Général :

```text
Production de l'exercice = 70 + 71 + 72
Consommations de tiers   = 60 + 61 + 62
Valeur ajoutée           = Production − Consommations
EBE                      = VA + 74 − 63 − 64
```

Elle exclut 65 et 75, comme le veut la définition de l'EBE. Ce n'est pas « l'EBITDA
anglo-saxon » : c'est une convention française nommée, dont l'utilisateur voit la
construction poste par poste.

La **marge commerciale** est calculée sur les marchandises seules (707 − 607 − 6037) et
vaut `null` quand la société n'a aucun compte de marchandises. La valeur ajoutée n'en tient
pas lieu : ce sont deux soldes différents, et renommer l'un en l'autre serait un chiffre
mal nommé. C'est elle, et non la valeur ajoutée, qui alimente `business_financials.gross_profit`.

**Aucun EBITDA normatif n'est produit.** Le FEC ne peut pas déterminer seul un salaire
normatif de dirigeant, une dépense personnelle, une charge non récurrente, un coût de
remplacement ni une synergie.

## 7. Trois isolements qui comptent pour l'aval

```text
TRÉSORERIE COMPTABLE ≠ TRÉSORERIE PERSONNELLE
DETTE CORPORATE      ≠ DETTE PERSONNELLE
DETTE COMPTABLE      ≠ CONTRAT DE PRÊT DU DEBT ENGINE
D&A                  ≠ CAPEX CASH
```

- la **trésorerie** agrège 51 hors 519, 53 et 54. Les concours bancaires courants (519) en
  sont exclus : un solde de banque négatif est un **découvert**, pas une trésorerie — même
  doctrine que le compte bancaire personnel dans le bilan canonique. Les valeurs mobilières
  de placement (50) en sont exclues aussi : leur caractère « cash-like » est une convention
  de deal ;
- les **comptes courants d'associés** (455 et 108) sont isolés et **jamais qualifiés**. Le
  caractère debt-like est une convention de deal, pas une propriété du compte ;
- la **dette financière comptable** (16 et 17) est nommée comme telle. Elle réduit
  l'equity value de la société et n'entre **jamais** au passif personnel ; elle ne remplace
  pas non plus un contrat du Debt Engine, qui reste propriétaire des échéanciers ;
- les **amortissements** cumulés (28, 29) et les dotations de l'exercice (68) sont deux
  postes distincts, et **aucun des deux n'est un capex de trésorerie**. `capex` et
  `free_cash_flow` restent donc `null` dans le candidat Business : le FEC dit ce qui a été
  immobilisé et amorti, pas ce qui a été décaissé.

Le **BFR d'exploitation** est exposé avec ses composantes (stocks, clients, autres créances
d'exploitation, fournisseurs, dettes fiscales et sociales, autres dettes d'exploitation).
Ce n'est **pas** le NWC contractuel d'un SPA, et il exclut trésorerie, dette financière et
comptes courants d'associés.

## 8. Période observée ≠ couverture déclarée

```text
dates minimale et maximale du fichier   →  une OBSERVATION
« ce fichier couvre l'exercice entier » →  une DÉCLARATION
```

La déclaration n'est jamais déduite de l'observation. Sans elle, les totaux restent exacts
pour les lignes fournies mais ne constituent pas un compte de résultat annuel, la
reconstruction n'est pas `CALCULABLE`, et le contrat d'intégration Business refuse de les
écrire. Le refus est porté par la RPC : `lfo_commit_fec_session` échoue tant que
`coverage_declared` est faux.

Un fichier réduit à son en-tête, ou dont l'en-tête est inexploitable, est
`NOT_COMPUTABLE` — jamais un exercice à zéro. Des postes à zéro y traduiraient l'absence de
lecture, pas une comptabilité nulle.

## 9. Contrat d'intégration Business

`toBusinessFinancialCandidate()` produit un `BusinessFinancialImportCandidate` dont les
champs reprennent **exactement** ceux de `BusinessFinancialInput` : aucun second modèle de
période financière n'est créé, le contrat canonique existant est réutilisé tel quel. Le
fait est écrit par `lfo_record_business_financials`, et par elle seule — un second chemin
d'écriture sur `business_financials` serait une seconde vérité sur la même table.

Trois refus de transmission, tous structurels :

- une reconstruction non `CALCULABLE` ne produit aucun candidat intégrable ;
- une **trésorerie comptable négative** n'est pas transmise comme `cash`. C'est un
  découvert, le fait canonique interdit un cash négatif, et l'y écrire échouerait en base au
  lieu d'être expliqué ;
- un solde de **sens inattendu** sur la dette brute, les dotations ou les intérêts n'est pas
  transmis : un négatif y est une anomalie de lecture ou d'imputation, pas un montant.

Les postes que `business_financials` ne modélise pas — stocks, clients, fournisseurs, dettes
fiscales, comptes courants d'associés — ne sont volontairement **pas** ajoutés au modèle
canonique. Ils restent dérivables à tout moment des écritures conservées, qui en sont la
source ; les persister deux fois créerait une seconde vérité que rien ne garderait
synchrone.

Business Equity n'est pas modifié : aucune valorisation, aucun multiple, aucun retraitement
n'est produit par cette couche.

## 10. Ce que la base porte

```text
FICHIER
   ↓  décodage, séparateur, découpage        src/lib/acquisition/csv.ts
RAW                                         public.import_raw_records (immuable)
   ↓  en-tête réglementaire, conventions     src/lib/acquisition/fec/{spec,parse}.ts
   ↓  classification comptable               src/lib/acquisition/fec/pcg.ts
ÉCRITURES LUES                              public.fec_entry_lines (staging + détail conservé)
   ↓  partie double, reconstruction          src/lib/acquisition/fec/statements.ts
PREVIEW                                     aucun fait Business écrit
   ↓  décision explicite de l'utilisateur
CANONICAL                                   public.business_financials + import_record_links
   ↓
moteur Business Equity existant, inchangé
```

`fec_entry_lines` conserve les dix-huit champs **tels quels**, y compris ceux qu'aucun
calcul n'utilise aujourd'hui : `PieceRef`, `EcritureLet` et `ValidDate` sont ce que la
comptabilité a écrit, et une relecture dans six ans en aura besoin.

**Aucun état financier reconstruit n'est persisté.** Compte de résultat, bilan, EBE, marge
commerciale et BFR sont dérivés à la lecture des écritures conservées. PostgreSQL persiste,
TypeScript calcule.

Une écriture committée est **gelée** : ni modifiable, ni supprimable, même sous
`service_role`. `fec_entry_lines` rejoint la piste d'audit en lecture seule — `authenticated`
n'y a que le `SELECT`, et le gate de schéma refuse toute réouverture de ce privilège.

## 11. Réception par lots

Un FEC d'exercice complet ne passe pas dans un appel RPC unique. Le flux est donc :

```text
lfo_open_fec_session      →  source, session en RECEIVING, empreinte du fichier
lfo_append_fec_lines      →  un lot de brut + écritures lues, en UNE instruction
   (répété)
lfo_finalize_fec_session  →  décomptes RELUS en base, période observée, statut ANALYZED
lfo_commit_fec_session    →  instantané financier + gel + provenance, en une transaction
```

`RECEIVING` dit la vérité de cette phase : une session qui reçoit encore ses lignes n'est
pas une session analysée, et ses décomptes ne veulent encore rien dire. Les décomptes finaux
sont **relus en base** plutôt que crus sur parole — ce que la base contient est la seule
mesure de ce qui a été reçu.

L'état écrit au commit est **reconstruit depuis les écritures persistées**, pas repris du
candidat calculé à l'analyse. Sans cela, une requête forgée pourrait écrire un chiffre
d'affaires qu'aucune écriture ne porte.

## 12. Idempotence et provenance d'un agrégat

Deux garanties, aux deux seuls endroits démontrables, exactement comme pour l'import
bancaire : l'empreinte SHA-256 du fichier ne peut être **committée** qu'une fois par source,
et une session encore en réception ou analysée portant la même empreinte est **remplacée** —
reprendre un import interrompu ou réanalyser après correction est légitime, et n'a produit
aucun fait.

La provenance d'un **agrégat** diffère de celle d'une transaction, et le schéma le dit :

- une transaction importée a **une** origine, d'où `import_record_links_transaction_uk` ;
- un instantané financier annuel est l'agrégat d'une session entière, et
  `lfo_record_business_financials` converge sur `(société, date de clôture)` : un FEC
  réimporté après correction met à jour la **même** ligne. La provenance en est donc un
  **historique** de sessions, et l'unicité porte sur `(propriétaire, session, instantané)`.

Ce que chaque session a réellement lu reste reconstituable depuis ses écritures conservées.

## 13. Plafonds, et pourquoi ceux-là

150 000 lignes par fichier, 24 Mo. Le plafond de lignes est **mesuré**, pas choisi par
symétrie avec le plafond bancaire de 20 000 lignes : une PME produit couramment plusieurs
dizaines de milliers d'écritures par exercice, et appliquer mécaniquement la limite du CSV
bancaire rendrait la fonctionnalité inutilisable sur des fichiers normaux.

Coût de la lecture pure, sur fichier synthétique :

| Lignes | Durée | Mémoire résidente |
|---|---|---|
| 50 000 | 0,7 s | 211 Mo |
| 100 000 | 2,0 s | 378 Mo |
| 150 000 | 3,3 s | 640 Mo |
| 200 000 | 4,7 s | 828 Mo |

Le brut, les écritures lues et leurs anomalies coexistent en mémoire le temps de l'analyse :
le coût croît donc plus vite que linéairement. 150 000 lignes garde une marge réelle sous un
budget d'un gigaoctet, là où 200 000 n'en garde presque aucune.

Un dépassement **échoue** : il ne tronque pas. Un exercice amputé produirait des états
financiers faux et d'apparence complète — le pire résultat possible.

## 14. Ce qui reste manuel

- le choix de la société concernée ;
- la devise de tenue de la comptabilité, quand la devise fonctionnelle de la société n'est
  pas connue — aucune n'est supposée ;
- les bornes de l'exercice, et la déclaration que le fichier le couvre entièrement ;
- toute décision de Quality of Earnings : retraitements d'EBITDA, qualification debt-like
  d'un compte courant d'associé, éléments du pont EV → Equity ;
- le rapprochement d'un emprunt comptable avec un contrat du Debt Engine.

## 15. Ce qui n'est pas fait, et pourquoi

- **aucune trajectoire projetée** depuis un FEC : le domaine Business Equity n'entre pas
  dans le Personal Monthly Financial Model, faute de termes projetables. Cette verticale ne
  change pas cette frontière ;
- **aucune analyse de flux de trésorerie** reconstruite : elle exigerait deux bilans
  consécutifs et une convention de variation de BFR, donc au minimum deux exercices importés
  et déclarés complets. Le chantier est distinct ;
- **aucun rapprochement** entre la trésorerie comptable de la société et un compte bancaire
  personnel observé : ce sont deux entités économiques distinctes ;
- **aucune détection de doublon entre lignes** de FEC. La déduplication de la fondation
  s'applique au niveau du FICHIER (empreinte SHA-256) et non de la ligne, et c'est
  volontaire : deux écritures identiques dans une comptabilité sont un fait comptable
  courant — un même loyer, un même abonnement — et les écarter serait fabriquer un
  déséquilibre de partie double.
