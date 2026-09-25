# Matrice de conformité Dette 3B (B15 à B18) et dépendances 3C

Version du 25 septembre 2026, branche `claude/blissful-dirac-4ar700`, commit de référence
`02515c2`. Sources d'exigence : kit de codage du 11 septembre 2026
(`04_SPECIFICATION_DETTES.md`, `03_PARCOURS_ET_DESIGN.md`, `08_RECETTE_ET_CAS.md`,
`backlog.csv`), `design_v10.md` (§12 poste Dette, §22 échéancier absent), complément de cadrage
du 25 septembre (dix exigences UX, validation UX et accessibilité).

Portée des preuves : toutes les recettes citées ont été exécutées sur la pile Supabase
auto-hébergée LOCALE (GoTrue, PostgREST, Storage, Kong officiels, PostgreSQL 16) avec le build
de production de l'application. Elles ne valident NI le projet Supabase hébergé NI la preview
Vercel, qui restent à recetter par Astra. Aucune migration de ce document n'est en production.

## 1. État des tickets

| Ticket | Critère de sortie (backlog) | Statut | Preuve principale | Reste ouvert |
|---|---|---|---|---|
| B15 | Encours au bilan sans taux, paiement ou durée inventés (A05, O04) | Livré (tranche B14) | recette B14 41/41 ; `smoke-debt-outstanding` | Aucun point bloquant connu |
| B16 | Embranchements par structure, dates et contrôles de synthèse | Livré | recette 3B contrôles P1 à P8, B1 à B8 | Variantes non prises en charge (voir §3) |
| B17 | Assurés, quotités, primes et calendrier indépendant sans doublon | Livré, sous réserve de la recette hébergée | recette 3B A1 à A9 ; oracle O03 | Règle de prime par barème (B20) ; rapprochement payé (B21) |
| B18 | Remboursement, taux, report et solde conservés dans l'historique | Non commencé | néant | Tout le ticket |
| B19 | Pièce, champ, unité, localisation, version et décision consultables | Non commencé (dépend de B12, B15) | néant | Tout le ticket |
| B20 | Deux pièces contrôlées puis validées, correction et doublon traités | Bloqué par B17, B18, B19 | néant | Tout le ticket |
| B21 | Dû, payé et prévu séparés après rechargement | Bloqué par B20 | néant | Tout le ticket |
| B14 (volet documentaire) | Premier compte, dette et revenu sans seed, reprise et relecture | Ouvert | néant pour le volet documentaire | Tout le volet documentaire |

Dette 3B n'est PAS déclarée terminée : B18 n'est pas commencé.

## 2. B17 : assurance emprunteur séparée, exigence par exigence

| Exigence exacte | Source | Réalisation | Fichiers | Cas de recette et preuve | Limite |
|---|---|---|---|---|---|
| Choix initial obligatoire : incluse, séparée, absence confirmée, inconnue | 04 §3 étape D | Quatre boutons radio, aucun présélectionné ; refus avant envoi ; enum zod ; contrainte `liabilities_insurance_mode_ck` | `debt-contract-form.tsx`, `mutations.ts`, migration `20260924180000` | test « exige un choix d'assurance avant l'enregistrement » ; smoke « choix hors liste » | Contrats antérieurs à B17 : mode NULL, lus avec leurs anciennes colonnes |
| « Inconnue » permet de continuer avec coût incomplet | 04 étape D ; 04 §4 « Frais ou assurance inconnus » | Synthèse « Assurance future : Inconnue » ; métriques 12 mois PARTIAL avec bloqueur nommé | `debt.ts`, `balance-sheet-metrics.ts` | recette B3 ; A9 (`insurance12m` 60 €, PARTIAL) ; tests métriques | Aucune |
| Un coût, une fois : incluse et séparée exclusives | 04 étape D (« ne pas additionner à nouveau ») | Contrainte `liabilities_insurance_consistency_ck` ; polices refusées hors mode SEPARATE | migration `20260924180000`, RPC | smoke (prime par échéance en mode séparé refusée) ; A8 (aucun passif ajouté) | Rapprochement d'un second document : B20 |
| Assureur, contrat | 04 étape D | Champs facultatifs, vides par défaut | form, `loan_insurance_policies` | test B17 ; A4 | Aucune |
| Emprunteurs assurés, quotités, plusieurs assurés | 04 étape D | Liste d'assurés, quotité en pourcentage (quatre décimales), 0 < quotité ≤ 100 % | form, `loan_insurance_insured` | test quotité hors bornes ; smoke `share_ck` ; A4 (Emprunteur 100 %) | Une police sans assuré est acceptée (assurés inconnus) |
| Une quotité ne définit pas la part du passif | 04 étape D | Quotité jamais lue par un calcul de passif | `debt.ts` (aucun usage) | A8 | Aucune |
| Dates d'effet et de fin | 04 étape D | Couverture facultative, ordonnée, distincte des dates de débit | migration `20260925090000` | test « couverture qui finit avant de commencer » ; smoke | La couverture ne borne pas les débits : seules les périodes de prime le font |
| Fréquence | 04 étape D ; 03 §8 (« valeur par défaut d'un fait inconnu : vide ») | Sélecteur vide par défaut, obligatoire | form | A1 ; test « fréquence non choisie » | Aucune |
| Montant fixe | 04 étape D | Prime par débit, par période | `loan_insurance_periods` | O03 (5 € mensuels) | Aucune |
| Règle de calcul (capital initial, restant dû, grille) | 04 étape D | NON prise en charge comme règle ; « base assurée » purement descriptive ; aucune prime déduite d'une prime isolée | migration `20260925090000` | smoke base assurée hors liste | Règle saisie par son échéancier : B20 |
| Variations, plusieurs périodes | 04 étape D | Périodes multiples ; chevauchement refusé (moteur, zod, formulaire, RPC) | `insurancePeriodsOverlap`, RPC `20260925100000` | tests chevauchement ; smoke « périodes chevauchantes » | Aucune |
| Échéancier propre, dates de débit conservées | 04 étape D et §4 « calendrier d'assurance indépendant » | Le Debt Engine produit les débits à leurs dates ; bornes du prêt calculées hors débits | `debt.ts` (`withSeparateInsurance`, `summarise`) | A6, A7 ; test « dernière échéance du prêt » | Affichage dans Flux non recetté (B21) |
| Compte débité si connu | 04 étape D | Liste des comptes de cash ; référence au compte du même propriétaire ; « non renseigné » par défaut | migration `20260925090000`, `DebtReadModel.debitAccounts` | test transmission ; smoke compte d'un autre propriétaire refusé | Ne prouve aucun paiement : rapprochement B21 |
| Coût fourni par échéancier conservé sans taux équivalent | 04 étape D | Hors périmètre de la saisie | néant | néant | B20 |
| Dates de débit différentes conservées dans le cash-flow | 04 §4 | Événements `LOAN_INSURANCE_DEBIT` distincts, identifiants uniques | `event-adapters.ts` | test « deux polices le même jour » | Vue Flux : B21 |
| Oracle O03 : principal 1 200, assurance 60, coût 80, débits 105, sorties 1 280 | 08 §3 | Reproduit par le moteur et dans le navigateur | `debt-separate-insurance.test.ts` | A3 (synthèse), A5 (bandeau 1 280 €) | Aucune |
| Assurance séparée identifiable, sans double comptage, dates de débit accessibles | V10 §12, cadrage §6 | Bandeau de composition « Assurance séparée », inspecteur (police, assurés, périodes, prochain débit, compte), lignes d'échéancier dédiées | `page.tsx` | A5, A6, A7 ; captures 05, 06 | Aucune |
| Pas de fausse courbe | V10 §22 | Tracé en escalier depuis l'encours observé, sans échantillonnage | `balance-path.ts` | tests `balance-path` ; captures 06, 07 | Aucune |

## 3. B16 : écarts connus au document 04 étape C

| Variante | Statut |
|---|---|
| Amortissable à échéance constante, in fine, ballon, intérêts seuls | Pris en charge |
| Montant ou durée selon la donnée connue, sans supposer les deux vrais | Pris en charge (durée ou maturité déduite, signalée) |
| Assurance incluse de montant inconnu | Durée non déduite ; durée déclarée : amortissement contractuel, part restante signalée |
| Amortissement constant (échéance totale non constante) | Non pris en charge, annoncé comme non disponible |
| Taux variable indexé (indice, marge, plafond) | Révisions datées seulement ; indexation non prise en charge |
| Ligne renouvelable, découvert | Non pris en charge |
| Déblocages multiples | Non pris en charge |
| Frais financé et durée déduite | La durée est déduite sans le frais : écart signalé ensuite (`RECONCILIATION_REQUIRED`) ; à traiter avec les événements (B18) |

## 4. Dix exigences UX du cadrage, appliquées aux parcours Dette

| Exigence | État | Preuve |
|---|---|---|
| Comprendre à quoi sert l'écran | Question d'usage en tête de page, sources à gauche | captures 02, 06 |
| Commencer avec les informations disponibles | Encours seul, puis contrat minimal (mensualité seule) | P1, B3 |
| Aucun fait inconnu prérempli | Mode, dates, convention, fréquence de prime, frais ponctuels vides | B1, B2, A1, A2 |
| Champs avancés seulement si pertinents | Bloc « Conditions avancées » replié ; blocs d'assurance selon le choix | captures 01, 05 |
| Revenir sans perdre le brouillon | Valeurs conservées tant que le formulaire est ouvert ; PAS d'espace de brouillons persistant | Écart : le document 03 §8 prévoit un espace de brouillons, non construit (décision de conception et migration nécessaires) |
| Synthèse avant validation | Synthèse moteur (capital, sorties, coûts, inconnues) | B3, B6, A3 |
| Confirmation claire | Retour à la page, dette sélectionnable | P3, A5 |
| Retrouver le résultat | Après rechargement : poste Dette, Patrimoine, Flux, Aujourd'hui | P3 à P8, A5 à A7 |
| Provenance, dates, réserves visibles | Badges de nature, « calculé » ou « annoncé », points à réconcilier | B4, A7 |
| Modifier sans perdre l'historique | Promotion d'encours tracée ; listes du contrat encore remplacées en bloc | P4 ; versionnement : B18 |

## 5. Validation UX et accessibilité réellement effectuée

| Contrôle | Méthode | Résultat |
|---|---|---|
| Bureau 1 280 px | Playwright, build de production | 31/31 |
| Tablette 768 px | Largeur de défilement | Aucun débordement (M2) |
| Mobile 390 px | Largeur de défilement | Aucun débordement (M1) |
| Zoom 200 % | Fenêtre CSS de 640 px, page et échéancier | Aucun débordement, échéancier empilé (Z1) |
| Clavier | Tab jusqu'à « Nouvelle dette », Entrée, focus dans le dialogue, Échap | Conforme après correction du composant Modal (K1) |
| Thème sombre | Bouton de l'application | Appliqué (T1), capture 07 |
| Noms accessibles | Tous les champs recettés trouvés par leur libellé | Conforme sur les champs parcourus |
| Lecteur d'écran | Non exécuté | Non vérifié |
| Contraste mesuré | Non exécuté | Non vérifié |
| Préférence de thème conservée au rechargement | Non conservée | Écart constaté, hors Dette |

## 6. Constats de la relecture indépendante (25 septembre)

| Constat | Gravité | Traitement |
|---|---|---|
| Durée déduite en comptant une assurance incluse inconnue comme du capital | Important | Corrigé (`1bf76d9`) |
| Faux écart « assurance ou frais cachés » sur une durée déduite | Important | Corrigé |
| Dernière échéance déplacée par un débit d'assurance | Important | Corrigé |
| Périodes de prime chevauchantes comptées deux fois | Important | Corrigé, refus en base |
| Identifiants d'événements en collision | Important | Corrigé |
| Validation serveur ignorant différé et paliers | Mineur | Corrigé |
| Treize échéances sur « douze mois » | Mineur | Corrigé |
| Écritures directes ouvertes à `authenticated` sur les tables de dette | Important | Corrigé, migration `20260925100000` |
| Contraintes de `20260924170000` sans `NOT VALID` | Mineur | Contrôle préalable documenté dans CLAUDE.md, à faire par Astra avant push |
| Choix d'assurance effacé par une clé absente | Mineur | Corrigé |
| Quotité arrondie en silence | Mineur | Corrigé |
| Absence de refus des dates futures dans `lfo_record_net_income` et `lfo_add_transaction` | Mineur | Ouvert : une opération future peut être légitime (prévision) ; décision à prendre |
| Plafond de prime supérieur à la colonne | Signalé | Non reproduit : 14 chiffres entiers des deux côtés |

## 7. B18 à B21 : dépendances et état de départ

| Ticket | Dépend de | État de départ constaté | Premier travail |
|---|---|---|---|
| B18 | B16 | Révisions de taux, paliers, remboursements anticipés et frais remplacés en bloc à chaque enregistrement ; éditeurs avancés encore préremplis (date du jour, 0) et sans libellés accessibles, sauf les frais ponctuels corrigés | Journal d'événements datés et versionnés, avenants, correction ≠ nouvel événement |
| B19 | B12, B15 | Document Intelligence existe pour la liasse fiscale ; aucune revue de candidats de dette | Revue pièce, champ, unité, localisation |
| B20 | B17, B18, B19 | Import d'échéancier existant dans le formulaire (`schedule-import`) ; aucun import d'assurance | Deux pièces rapprochées, doublon par empreinte |
| B21 | B20 | Compte débité de police disponible ; aucun rapprochement dû / payé | Séparer dû, payé et prévu |
