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

Sources primaires effectivement consultées :

- arrêté du 29 juillet 2013 modifiant l'article A47 A-1 du Livre des procédures fiscales
  (texte Légifrance) ;
- Plan Comptable Général, règlement ANC, **version consolidée au 1er janvier 2026**.

Le mapping PCG de cette V1 correspond à la nomenclature de référence **actuelle**. Il n'est
pas universel dans le temps : les différences historiques de plan de comptes devront être
versionnées si un cas réel d'import ancien l'exige. Aucun moteur PCG historique n'est
construit ici.

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
| 12 | `Debit` | débit, **signé possible** |
| 13 | `Credit` | crédit, **signé possible** |
| 14 | `EcritureLet` | code de lettrage |
| 15 | `DateLet` | date de lettrage |
| 16 | `ValidDate` | date de validation |
| 17 | `Montantdevise` | montant en devise, **signé possible** |
| 18 | `Idevise` | code de la devise |

### Deux formes réglementaires pour les colonnes 12 et 13

Le texte prévoit que, lorsque le système comptable ne tient pas débit et crédit
séparément, les colonnes 12 et 13 soient remplacées par `Montant` et `Sens`.

```text
SCHÉMA A   … | EcritureLib | Debit   | Credit | EcritureLet | …
SCHÉMA B   … | EcritureLib | Montant | Sens   | EcritureLet | …
```

`Sens` vaut `D`, `C`, `+1` ou `-1` — quatre valeurs, et quatre seulement, le signe de `+1`
et `-1` étant présent sans espace. Un `1` nu n'est **pas** une valeur réglementaire : il est
lu, parce que son sens ne fait aucun doute et que refuser un exercice entier pour un signe
absent le rendrait inutilisable, mais il est **signalé** (`FEC_AMOUNT_SENS_NON_STANDARD`) et
n'est jamais présenté comme conforme. Même doctrine que le point-virgule et que les formats
de date hors norme.

Les deux schémas sont lus. Dans le schéma B, le montant est normalisé vers la représentation
interne débit/crédit — une **traduction**, pas une interprétation : le brut conserve la forme
d'origine, et c'est lui qui répond plus tard à « qu'est-ce que la comptabilité a écrit ? ».

Un `Sens` inconnu ou absent **bloque la ligne**. Le deviner inverserait un jour une charge
et un produit, sans laisser de trace.

Un en-tête portant les DEUX formes est lu en schéma A, et l'ambiguïté est signalée : lire
les deux additionnerait deux fois le même montant.

### Les valeurs numériques peuvent être SIGNÉES

Le texte l'autorise explicitement. Un débit de −1 200 est donc une **donnée valide** —
typiquement une contrepassation — et non une erreur de lecture.

En conséquence : aucune contrainte de signe en base, aucune valeur absolue nulle part, le
signe de la source conservé tel quel, et un contrôle de partie double qui fonctionne
naturellement sur des montants signés. Une vente et sa contrepassation s'annulent : le
chiffre d'affaires reconstruit est alors nul, et c'est la vérité.

### Séparateurs : conformes et tolérés

```text
CONFORMES pour un fichier à plat   tabulation, barre verticale
LUS mais SIGNALÉS                  point-virgule, virgule
```

Des exports d'éditeurs emploient le point-virgule, et refuser un fichier par ailleurs
exploitable serait un purisme coûteux. Mais l'écart est dit, sous
`FEC_NON_STANDARD_DELIMITER` :

```text
LISIBLE  ≠  CONFORME
```

L'utilisateur qui doit répondre à une demande de l'administration a besoin de connaître la
différence.

### Le reste

L'en-tête est résolu **par nom**, pas par position : un fichier dont les colonnes sont dans
un ordre inhabituel est lu, et l'écart à l'ordre réglementaire est signalé plutôt que
d'être une raison de refus. Le contrôle d'ordre porte sur le schéma **retenu**, avec
`Montant` en position 12 et `Sens` en 13 : un fichier conforme n'est donc pas signalé comme
désordonné, et un fichier où ces deux colonnes sont réellement ailleurs ne passe pas sans un
mot. À l'inverse, l'absence d'un champ **structurant** est une
**erreur** — sans journal, sans numéro d'écriture, sans date ou sans compte, il n'y a pas
d'écriture à lire, et il n'y a rien à deviner.

Sont également lus : les encodages UTF-8, UTF-8 avec BOM et Windows-1252 ; le format de date
réglementaire `AAAAMMJJ`, et les formats non réglementaires courants (`JJ/MM/AAAA`,
`AAAA-MM-JJ`) avec un signalement — un fichier produit par un logiciel qui s'écarte du texte
reste exploitable, mais l'écart se dit.

### Ce que cette lecture n'est pas

Elle ne **certifie pas** la conformité fiscale d'un fichier, et ne le fera pas. LFO est un
moteur d'acquisition et de contrôle : il dit ce qu'il a lu, ce qu'il n'a pas compris et où le
fichier s'écarte du texte. Une attestation de conformité relève de l'administration et du
conseil, pas d'un parseur.

## 2 bis. Écart de conformité ≠ montant non calculable

```text
ÉCART DE CONFORMITÉ RÉGLEMENTAIRE  ≠  MONTANT NON CALCULABLE
```

Le texte prévoit que certains champs soient laissés **à blanc** quand ils ne sont pas
employés : compte auxiliaire, lettrage, montant en devise. Leur absence est la forme
normale, et n'est pas signalée.

Les champs de **traçabilité** — `PieceRef`, `PieceDate`, `ValidDate` — sont différents : leur
blanc est un écart de conformité, et **rien de plus**. Une référence de pièce absente empêche
de remonter à un justificatif ; elle n'empêche en aucune façon de reconstruire un chiffre
d'affaires. Confondre les deux axes conduirait à refuser un exercice entier pour un défaut
d'archivage, ou à l'inverse à taire un défaut de piste d'audit sous prétexte que les totaux
tombent juste.

Ces manques sont donc signalés **au niveau du fichier**, en `INFO`, sous
`FEC_REGULATORY_FIELD_BLANK`, avec le nombre de lignes concernées — et jamais ligne à ligne :
un exercice n'a pas besoin de 150 000 anomalies identiques, coûteuses en mémoire et noyant
les vraies.

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
qu'une ligne aux deux côtés absents ne puisse exister qu'en statut `BLOCKED`.

Il n'y a en revanche **aucune contrainte de signe**, et c'est le texte primaire qui l'impose
(voir §2). Une contrainte `>= 0` rejetterait des FEC parfaitement conformes.

Une dernière contrainte ferme le reste : un montant en devise sans code devise est refusé —
le supposer égal à la devise de tenue serait un taux de change implicite égal à 1.

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
Intermédiaires de Gestion du Plan Comptable Général, et elle en respecte la
**décomposition**, pas seulement le résultat :

```text
Marge commerciale        = 707 − 607 − 6037
Production de l'exercice = production vendue (70 hors 707) + 71 + 72
Consommations de tiers   = 60 hors 607 et 6037, + 61 + 62
Valeur ajoutée           = Marge commerciale + Production − Consommations
EBE                      = VA + 74 − 63 − 64
```

« Production de l'exercice » n'inclut donc **pas** les ventes de marchandises : celles-ci
appartiennent à la marge commerciale. Les mélanger produirait un sous-total juste au total
et faux au libellé — le genre de chiffre qui passe inaperçu jusqu'au jour où quelqu'un
compare une société de négoce à une société de production.

Le **chiffre d'affaires**, lui, reste la classe 70 entière, marchandises incluses : c'est le
CA net.

L'EBE exclut 65 et 75, comme le veut sa définition. Ce n'est pas « l'EBITDA anglo-saxon » :
c'est une convention française nommée, dont l'utilisateur voit la construction poste par
poste.

La **marge commerciale** vaut `null` quand la société n'a aucun compte de marchandises. La
valeur ajoutée n'en tient pas lieu : ce sont deux soldes différents, et renommer l'un en
l'autre serait un chiffre mal nommé. C'est elle, et non la valeur ajoutée, qui alimente
`business_financials.gross_profit`.

### Participation des salariés ≠ impôt sur les bénéfices

Le Plan Comptable Général distingue, dans la classe 69 : **691** participation des salariés
aux résultats, **695** impôts sur les bénéfices, **696** suppléments d'impôt liés aux
distributions, **698** intégration fiscale, **699** produits du report en arrière des
déficits.

691 est donc isolé dans son propre groupe. Regrouper toute la classe 69 sous « impôt »
laisserait le résultat net exact tout en écrivant une charge de personnel sous une étiquette
fiscale : le taux d'imposition apparent d'une société distribuant de la participation en
serait faussé. 696, 698 et 699 restent dans l'impôt, 699 y jouant en diminution — ce sont
bien des composantes de la ligne « impôts sur les bénéfices ».

`business_financials.tax_expense` ne porte donc **jamais** 691. Le résultat net, lui,
soustrait les deux.

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

Déclarer une couverture **sans dire quel exercice** n'a aucun sens : la validation applicative
l'interdit, et `import_sessions_coverage_shape_ck` l'interdit aussi en base — un invariant qui
ne vit que dans une API se contourne par la première écriture directe.

### Aucune écriture d'une autre période dans un exercice déclaré complet

Une écriture hors des bornes déclarées était signalée ; elle est désormais **bloquante** dès
que la couverture est déclarée complète. Un exercice annoncé entier qui contient des écritures
d'une autre période ne produit le résultat d'**aucune** période réelle, et rien dans le fait
canonique écrit ne permettrait ensuite de s'en apercevoir. Le refus est porté deux fois : par
la reconstruction pure, et par `lfo_commit_fec_session`.

Sans déclaration de couverture, en revanche, l'écart reste une simple observation de ligne :
l'utilisateur n'a rien affirmé sur le périmètre du fichier.

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

### Conflit de sources : jamais d'arbitrage silencieux

```text
CONFLIT DE SOURCES  ≠  CHOIX SILENCIEUX D'UNE SOURCE
```

`lfo_record_business_financials` converge sur (société, date de clôture). Sans garde-fou,
importer le FEC 2025 **écraserait sans un mot** une période saisie à la main, des comptes
annuels vérifiés ou une autre source externe — et rien, dans la ligne écrite, ne permettrait
ensuite de s'en apercevoir.

`lfo_commit_fec_session` cherche donc, avant d'écrire, une période financière existante pour
(propriétaire, société, clôture) :

| Situation | Décision |
|---|---|
| aucune période existante | création normale |
| période portant déjà une provenance `BUSINESS_ACCOUNTING` | **correction FEC → FEC autorisée** |
| période sans provenance d'import comptable | **REFUS** `BUSINESS_FINANCIALS_SOURCE_CONFLICT` |

La preuve est la **provenance**, pas un libellé de source : un lien `BUSINESS_ACCOUNTING` vers
cette ligne. Son absence signifie une autre origine, et l'import s'arrête sans rien altérer —
ni la valeur, ni la source, ni la provenance existantes.

Ce n'est pas un moteur de fusion de sources, et ce n'en sera pas un ici : pour une V1, un
**refus sûr** vaut mieux qu'un arbitrage automatique. La résolution de précédence
multi-source est un chantier distinct, et il demandera une décision humaine. Le contrôle vit
dans la RPC : dans l'interface ou le repository, il se contournerait par le premier appel
direct.

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

## 10 bis. Le fichier ne traverse pas la fonction serveur

Une fonction serverless plafonne le corps de requête ENTRANT bien en dessous de la taille
d'un FEC d'exercice. Envoyer le fichier à la route d'API le condamnerait à être refusé par la
plateforme **avant que le code s'exécute** : la lecture à 150 000 lignes n'existerait pas en
production, quelle que soit la qualité du parseur, et les mesures de performance du §13
seraient trompeuses — le moteur saurait traiter un fichier qui ne peut pas l'atteindre.

Le chemin est donc :

```text
NAVIGATEUR  → POST /api/imports/fec?ticket=1   { fileName, byteSize, retainFile }
SERVEUR     → lfo_issue_import_upload_ticket   chemin CALCULÉ, URL signée, expiration
NAVIGATEUR  → PUT <url signée>                 le FICHIER, directement au stockage privé
NAVIGATEUR  → POST /api/imports/fec            { uploadTicketId, … }  ← quelques octets
SERVEUR     → consomme le billet, télécharge l'objet, calcule le SHA-256, analyse, stage
```

Aucun corps de requête de cette route ne porte de contenu de fichier. La validation non plus
ne le retransmet pas : quand la session a demandé la conservation, le serveur **reprend** le
contenu depuis l'objet de staging qu'il a lui-même écrit.

### Ce que le client ne décide pas

```text
CHEMIN DE STOCKAGE   calculé par la base : <propriétaire>/import-staging/<billet>
IDENTIFIANT          généré par la base
EMPREINTE SHA-256    calculée par le serveur sur le contenu RÉELLEMENT déposé
TAILLE               mesurée sur l'objet, et confrontée à la taille déclarée
```

Une API qui croit un chemin fourni par son appelant laisse lire — ou écraser — le fichier
d'un autre propriétaire. Le billet est donc **émis par le serveur**, **à usage unique** (sous
verrou de ligne, pour que deux analyses simultanées ne puissent pas conclure toutes les deux
qu'il est libre), **expirant**, et **cloisonné** : un billet d'un autre propriétaire est
introuvable, même en connaissant son UUID.

La taille déclarée à l'émission et la taille mesurée à la lecture doivent coïncider. Une
déclaration n'est pas une mesure, et c'est la seconde qui décide de ce qui est analysable et
de ce qui est archivable.

### Cycle de vie de l'objet de staging

```text
retainFile = false  →  supprimé dès que RAW + fec_entry_lines sont persistés
retainFile = true   →  conservé jusqu'à la validation, recopié au coffre content-addressed,
                       puis supprimé
abandon             →  supprimé avant l'abandon de la session
```

Aucun objet n'est jamais public. Un échec de suppression d'un objet résiduel n'est pas
remonté comme une erreur : le fait est écrit, et un objet oublié n'altère aucune vérité.

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

### La frontière de confiance, exactement

```text
CLIENT      → action, identifiant de session, fichier éventuel.  RIEN D'AUTRE.
SERVEUR     → reconstruit l'état depuis fec_entry_lines persistées (TypeScript).
RPC service_role → persiste le résultat atomiquement, et contrôle les invariants de la SOURCE.
```

PostgreSQL ne recalcule **pas** le chiffre d'affaires, l'EBE ni le BFR : ces formules restent
en TypeScript, et les dupliquer en SQL créerait deux vérités à garder synchrones. Ce que la
base contrôle, c'est l'**intégrité de la source comptable** — Σdébits = Σcrédits par écriture,
lignes illisibles, écritures hors période, couverture déclarée — du même ordre que « la somme
des quote-parts d'un concours ne dépasse pas 1 ».

Le schéma de commande est `.strict()` : `revenue`, `ebitda`, `cash`, `financials` et tout
autre montant financier envoyé par un client sont **refusés**, pas ignorés. Accepter en
silence une clé inconnue laisserait croire qu'elle a servi.

Les décomptes d'écritures et de déséquilibres ne sont **pas** repris de la charge d'appel :
`lfo_finalize_fec_session` les dérive des lignes, et `lfo_commit_fec_session` les re-dérive au
moment d'écrire. `import_sessions.unbalanced_entry_count` reste un fait d'audit utile à
l'affichage, mais il est modifiable — et un invariant qui repose sur une valeur modifiable
n'est pas un invariant.

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

### Analyser n'est pas archiver

```text
ANALYSE       24 Mo
CONSERVATION   8 Mo (capacité réelle du coffre privé)
```

Les deux plafonds diffèrent, et les confondre serait pire que les séparer. Un FEC de 15 Mo est
parfaitement analysable ; il n'est simplement pas archivable ici.

La demande de conservation est donc refusée **en amont**, à l'émission du billet : le refus
tombe avant que le moindre octet soit déposé, et a fortiori avant toute écriture canonique.
Il porte sur la conservation, jamais sur l'import — décocher la conservation suffit.

Et si un dépôt échoue malgré tout **après** l'écriture du fait, la validation ne se présente
pas comme un échec :

```text
commitStatus     COMMITTED     ← le fait, écrit et gelé, sans réserve
documentStatus   FAILED        ← la copie d'archive, et elle seule
warnings         [ … ]
```

Rendre un seul statut pour les deux ferait croire à un échec de validation là où un instantané
financier existe : l'utilisateur réimporterait, ou saisirait à la main, et croirait à un
doublon. Un retry ne crée d'ailleurs aucun second instantané —
`lfo_record_business_financials` converge sur (société, clôture), et une session déjà
committée retourne son identifiant sans rien réécrire.

## 14. Ce qui reste manuel

- le choix de la société concernée ;
- la devise de tenue de la comptabilité, quand la devise fonctionnelle de la société n'est
  pas connue — aucune n'est supposée ;
- les bornes de l'exercice, et la déclaration que le fichier le couvre entièrement ;
- toute décision de Quality of Earnings : retraitements d'EBITDA, qualification debt-like
  d'un compte courant d'associé, éléments du pont EV → Equity ;
- le rapprochement d'un emprunt comptable avec un contrat du Debt Engine ;
- la correction d'un fichier dont le séparateur ou le format de date s'écarte du texte : LFO
  le lit et le signale, il ne le réécrit pas.

## 14 bis. Limite de vérification restante

Le chemin de dépôt direct est **structurel** : la route d'API ne lit plus aucun fichier, et
ses trois corps de requête sont du JSON de quelques centaines d'octets. Cela se vérifie par
lecture du code, et les tests de schéma le verrouillent — un contenu, un chemin ou une
empreinte envoyés par un client sont refusés, pas ignorés.

En revanche, le **round-trip réel** vers le stockage privé n'est pas couvert par le gate
local : celui-ci ne monte que PostgreSQL, sans émulateur de Storage. Le cycle de vie du
billet est donc testé en base (émission, chemin calculé, usage unique, expiration,
cloisonnement), mais le dépôt d'un fichier de plus de 5 Mo par URL signée reste à valider sur
un environnement de preview. C'est une étape humaine, et elle n'est pas faite.

## 15. Ce qui n'est pas fait, et pourquoi

- **aucune trajectoire projetée** depuis un FEC : le domaine Business Equity n'entre pas
  dans le Personal Monthly Financial Model, faute de termes projetables. Cette verticale ne
  change pas cette frontière ;
- **aucune analyse de flux de trésorerie** reconstruite : elle exigerait deux bilans
  consécutifs et une convention de variation de BFR, donc au minimum deux exercices importés
  et déclarés complets. Le chantier est distinct ;
- **aucun rapprochement** entre la trésorerie comptable de la société et un compte bancaire
  personnel observé : ce sont deux entités économiques distinctes ;
- **aucune résolution de précédence multi-source** : un conflit est refusé, pas arbitré ;
- **aucune détection de doublon entre lignes** de FEC. La déduplication de la fondation
  s'applique au niveau du FICHIER (empreinte SHA-256) et non de la ligne, et c'est
  volontaire : deux écritures identiques dans une comptabilité sont un fait comptable
  courant — un même loyer, un même abonnement — et les écarter serait fabriquer un
  déséquilibre de partie double.
