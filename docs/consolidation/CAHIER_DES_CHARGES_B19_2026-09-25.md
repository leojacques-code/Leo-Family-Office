# Cahier des charges B19 : revue des candidats documentaires (version du 25 septembre 2026)

Remplace la proposition `CADRAGE_3C_B19_2026-09-25.md` (conservée) après les arbitrages
fondateur du 25 septembre (registre `docs/produit/DECISIONS_PRODUIT_UX_2026-09-25.md`, D-UX-08 à
D-UX-11). Sources : `backlog.csv` B19 (« Pièce, champ, unité, localisation, version et décision
consultables » ; dépend de B12 et B15, tous deux livrés), document 04 §4, document 05 §10,
document 06 (candidats), V10 §4 et §22, `CLAUDE.md` (Document Intelligence, §3 décisions et
pistes immuables).

## 1. Périmètre

Dans B19 : déposer un échéancier de prêt au format CSV ou XLSX depuis la fiche d'une dette ;
le lire en candidats persistés ; consulter la pièce et les candidats côte à côte ; corriger,
confirmer ou écarter un candidat avec un historique par champ ; voir les contrôles et conflits ;
valider la LECTURE ; retrouver la pièce et sa lecture depuis la dette. Le même historique par
champ s'applique aux liasses fiscales.

Hors B19 (affectés) : rattachement d'une lecture validée au prêt, remplacement d'un échéancier
existant, calendrier d'assurance importé (B20) ; statut dû, payé, prévu (B21) ; PDF natif d'
échéancier, scan et OCR (dépendances du programme, non promis à l'écran).

## 2. Réutilisation de Document Intelligence : incompatibilités et résolution

Le modèle existant (`document_extraction_runs`, `_fields`, `_checks`, contrôles calculés en base,
gel à la liaison) est retenu. Six incompatibilités structurelles ont été constatées dans
`20260831154500_document_intelligence_foundation.sql` ; toutes se résolvent par migration
additive, sans second modèle.

| # | Incompatibilité constatée | Résolution additive |
|---|---|---|
| 1 | `business_id` obligatoire : une lecture sans société est refusée | `business_id` devient facultatif, `liability_id` s'ajoute ; contrainte : liasse et comptes annuels exigent une société, un échéancier exige une dette, jamais les deux |
| 2 | `pdf_kind` obligatoire parmi quatre natures de PDF | colonne `source_format` (`PDF`, `CSV`, `XLSX`) ; nature `NOT_PDF` ajoutée par contrainte successeur ; un PDF garde l'une des quatre natures |
| 3 | `page_number` obligatoire et positif | facultatif ; une case porte une page OU une ligne source (`row_number`), jamais aucune |
| 4 | Pas de localisation tabulaire | `sheet_name`, `row_number`, `column_key` (colonne reconnue), `column_label` (en-tête imprimé), `cell_ref` (`C12`) |
| 5 | Unité `EUR` confondue avec la devise ; aucune date comme valeur | unités `MONEY` et `DATE` ajoutées ; devise portée par la lecture (`currency`), jamais supposée ; `normalized_date` et `user_date` à côté des valeurs numériques |
| 6 | Correction écrasée sur place, sans auteur ni historique, sans état attendu | journal immuable `document_field_decisions` et révision attendue par case (§5), commun à toutes les familles |

Clé de case d'un échéancier : `box_code = L{ligne}.{colonne}` (exemple `L12.principal`). Elle est
dérivée de la position LUE dans le fichier et de l'en-tête reconnu, jamais inventée : c'est ce
qui permet aux contrôles en base d'adresser une cellule précise.

## 3. Contrat d'acquisition (fonctions pures, `src/lib/acquisition/documents/schedule/`)

1. Entrée : octets du fichier, format déclaré par l'extension et vérifié par le contenu (un
   XLSX est une archive, un CSV un texte). Plafonds du lecteur XLSX existant ; CSV plafonné à
   2 Mo et 1 200 lignes de données ; un dépassement refuse, ne tronque pas.
2. XLSX : lecteur `src/lib/acquisition/xlsx` réutilisé tel quel. Aucune formule évaluée ; une
   cellule issue d'une formule est signalée (valeur en cache) ; classeur à macros refusé.
   Première feuille portant un en-tête reconnu ; plusieurs feuilles candidates : signalé.
3. En-tête : colonnes reconnues par un registre de libellés (date d'échéance, capital restant
   dû avant et après, amortissement, intérêts, assurance, frais, échéance totale). Une colonne
   non reconnue est conservée comme case sans rôle, jamais utilisée dans un calcul. Une colonne
   absente reste absente : aucune valeur n'est déduite. Sans colonne de date : lecture en échec
   nommé.
4. Nombres : convention décimale tranchée au niveau de la COLONNE (`resolveAmountConvention`) ;
   ambiguïté non tranchée : cases bloquées. Vide, invalide et zéro distincts. Montant négatif :
   case bloquée (un échéancier ne porte pas de montant signé).
5. Dates : convention jour/mois tranchée au niveau de la colonne (`resolveDateConvention`) ;
   date XLSX sérielle décodée et signalée ; date inexistante : bloquée.
6. Devise : lue si une colonne ou une mention la porte, sinon DÉCLARÉE à l'import (devise de la
   dette proposée et visible, modifiable) ; jamais supposée en silence.
7. Contrôles définis par l'extracteur, CALCULÉS en base : par ligne, ouverture − capital =
   clôture et total = capital + intérêts + assurance + frais (seulement si toutes les colonnes
   existent, sinon non calculable) ; entre lignes, clôture = ouverture suivante. Contrôles de
   forme faits à la lecture et portés par les cases : dates croissantes et uniques, lignes
   manquantes (trou de périodicité), extrait partiel (première ligne après le début du prêt,
   dernier solde positif), doublon d'échéance.
8. Extrait partiel : la lecture le DIT (`PARTIAL_EXTRACT`) et n'annonce jamais un coût total du
   prêt. Un échéancier n'est « complet » que si son premier solde d'ouverture égale le capital
   initial du contrat et son dernier solde de clôture vaut zéro.

## 4. Contrat de persistance

- Écritures par RPC `lfo_*` réservées à `service_role` ; lecture seule pour `authenticated`
  sous RLS ; toute clé d'acteur dans une charge est refusée.
- Ouverture d'un échéancier : dette existante, non archivée, du même propriétaire, verrouillée.
  Même fichier (empreinte) déjà lu pour la même dette : la lecture ouverte est remplacée et
  l'ancienne reste consultable ; déjà validé : signalé comme doublon, aucune seconde lecture
  silencieuse.
- La pièce est conservée au coffre privé (famille dette : toujours), la lecture pointe vers elle.
- Aucune ligne de `loan_schedules` ni d'aucune table canonique n'est écrite en B19.

## 5. Historique des décisions par case (commun, liasse comprise)

- Table `document_field_decisions` : case, lecture, rang de décision, action (`REVIEW`,
  `CORRECT`, `REJECT`), statut et valeurs AVANT, statut et valeurs APRÈS, motif, acteur établi
  côté serveur (= propriétaire), rôle PostgreSQL constaté, date. Immuable (mise à jour refusée ;
  suppression refusée tant que la lecture existe).
- Chaque case porte `decision_revision`. Une décision transmet la révision qu'elle a lue ; le
  verrou est pris AVANT la comparaison ; une révision périmée échoue en conflit révisable
  (`LF409`) au lieu d'écraser une décision prise ailleurs.
- `lfo_correct_document_extraction_field` est reprise de sa DERNIÈRE version (unique, dans
  `20260831154500`) et étendue : révision attendue obligatoire, correction de date, journal.
  Le client liasse transmet désormais la révision.

## 6. Contrat d'interface

Parcours (D-UX-11) : fiche Dette → « Importer un échéancier » → dépôt CSV/XLSX (formats annoncés
avant dépôt, PDF non proposé) → revue.

- Revue côte à côte sur ordinateur : à gauche la PIÈCE (grille des cellules telles que lues,
  numéros de lignes et lettres de colonnes, cellule sélectionnée surlignée), à droite les
  candidats par ligne d'échéance, avec valeur imprimée, valeur retenue, unité et devise, statut
  et historique. Sélectionner d'un côté sélectionne de l'autre.
- Tablette : une seule surface latérale ; mobile : pièce et candidats en vues alternées qui
  conservent la sélection.
- Bandeau de lecture compact : fichier, format, version de lecture, devise, période couverte,
  lignes, état (complet, partiel), contrôles en échec et non calculables, doublon éventuel.
- Conflits visibles : contrôles en échec, cases bloquées, extrait partiel, échéancier déjà
  présent sur la dette pour les mêmes dates (le remplacement est une décision de B20).
- Correction en place, motif demandé, historique consultable par case ; confirmer, écarter.
- Validation nommée par son effet : « Valider cette lecture ». Synthèse avant validation :
  période, nombre d'échéances, totaux par composant sur l'extrait, et la mention que rien n'est
  encore appliqué au prêt tant que le rattachement (B20) n'est pas fait.
- Retour à la dette : section « Documents » compacte (D-UX-03) listant ses lectures, leur état
  et l'accès à la pièce.
- Aide « ? » (D-UX-02) sur les termes qui en ont besoin (extrait partiel, contrôle non
  calculable), via un composant partagé.

## 7. Critères d'acceptation

1. Un CSV et un XLSX d'échéancier déposés créent chacun une lecture consultable après
   rechargement ; aucune écriture canonique.
2. Chaque candidat affiche valeur imprimée, valeur retenue, unité, devise, localisation (ligne,
   colonne, cellule), version de lecture et statut ; une colonne absente reste absente.
3. Correction, confirmation et rejet laissent une trace immuable ; une décision sur une révision
   périmée échoue en conflit ; la liasse bénéficie du même historique.
4. Contrôles calculés en base ; extrait partiel dit, sans coût total annoncé ; trous et doublons
   signalés ; formules XLSX signalées ; classeur à macros refusé.
5. Même fichier redéposé : pas de seconde lecture silencieuse.
6. Isolation par propriétaire ; clés d'acteur refusées ; lecture seule pour le client.
7. Tests d'acquisition (CSV, XLSX, conventions, colonnes absentes, partiel), tests composant,
   smoke SQL transactionnel, gate local, recette navigateur locale (ordinateur, tablette,
   mobile, clavier), relecture indépendante.

## 8. Ce qui reste explicitement non livré après B19

Rattachement au prêt et effets financiers (B20) ; assurance importée (B20) ; dû, payé, prévu
(B21) ; PDF, scan, OCR ; boîte de réception Sources unifiée (B46).
