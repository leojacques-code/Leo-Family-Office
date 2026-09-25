# Matrice de conformité Dette 3B, version 3 (clôture de tranche)

Version 3 du 25 septembre 2026, branche `claude/blissful-dirac-4ar700`. Remplace la version 2
du même jour sans l'effacer (`MATRICE_CONFORMITE_DETTE_3B_2026-09-25_v2.md`). Sources : kit du
11 septembre 2026 (`03_PARCOURS_ET_DESIGN.md` §3, §8, §10 ; `04_SPECIFICATION_DETTES.md` §3 à
§7 ; `08_RECETTE_ET_CAS.md` ; `backlog.csv`), `design_v10.md`, cadrage et arbitrages du
25 septembre.

Portée des preuves : pile Supabase auto-hébergée LOCALE (GoTrue, PostgREST, Storage, Kong) et
build de production local. Rien n'est validé sur le projet Supabase hébergé ni sur la preview
Vercel : cette recette est réservée à Astra. Aucune migration citée n'est en production
(production : 45 migrations au dernier relevé connu du 9 septembre ; dépôt : 62).

Statuts : TERMINÉ (exigence couverte, preuve exécutée) ; PARTIEL (couverte en partie, reste
nommé) ; AFFECTÉ (hors du ticket, rattaché à un ticket ou une décision ultérieurs).

## 1. Tickets de la tranche

| Ticket | Critère de sortie (backlog) | Statut | Preuve locale | Reste |
|---|---|---|---|---|
| B15 | Encours au bilan sans taux, paiement ou durée inventés | TERMINÉ | recette B14 41/41 ; premier utilisateur F2 | néant |
| B16 | Embranchements par structure, dates, contrôles de synthèse | TERMINÉ | recette 3B 31/31 | variantes AFFECTÉES (§4) |
| B17 | Assurés, quotités, primes, calendrier indépendant sans doublon | TERMINÉ | recette 3B A1 à A9 | règle de prime par barème et rapprochement payé AFFECTÉS (§7) |
| B18 | Remboursement, taux, report et solde conservés dans l'historique | TERMINÉ | recette événements 18/18 ; smoke événements ; tests moteur | événements hors ticket AFFECTÉS (§3) |
| Brouillons (document 03 §8, arbitrage 1) | Enregistrable incomplet, retrouvé, repris, supprimé, sans effet financier | TERMINÉ pour le contrat de dette | recette brouillons 13/13 ; smoke brouillons | formulaire d'événement non applicable (§5) |
| Dates d'observation (arbitrage 2) | Aucun fait observé futur ; prévisions libres | TERMINÉ | smoke dates ; recette premier utilisateur F4 ; tests CSV et Open Banking | autres domaines AFFECTÉS (§6) |
| `account_balances` (arbitrage 3) | Écritures directes retirées après audit | TERMINÉ | smoke dates (droits, isolation) | néant |
| Recette de tranche (arbitrage 6) | Parcours complets rejoués après correctifs | TERMINÉ en local | six recettes, 156 contrôles (§8) | recette hébergée : Astra |

## 2. B18 : exigence par exigence

| Exigence | Source | Réalisation | Preuve | Statut |
|---|---|---|---|---|
| Événement daté, avec source et impact | 04 §6 | Journal immuable `liability_events` : date d'effet, source obligatoire, nature, contenu fermé | smoke ; E3 | TERMINÉ |
| Observé, contractuel, simulation distincts | cadrage §4 | Nature OBSERVÉ, CONTRACTUEL, PRÉVU contrainte en base ; aperçu jamais écrit | E2, E6 ; smoke | TERMINÉ |
| Révision de taux | 04 §6 | RATE_CHANGE ; mensualité maintenue signalée si aucune n'est déclarée | tests moteur | TERMINÉ |
| Changement de mensualité, paliers | cadrage | PAYMENT_CHANGE à date d'effet ; palier appliqué une seule fois, hérité au début de projection ; ordre chronologique à un même rang ; palier du contrat postérieur à un avenant signalé | tests moteur (relectures 3, 3 bis, 2-M2) | TERMINÉ |
| Report, différé | 04 §6 | DEFERRAL : capital seul ou total, intérêts, effet déclaré sur la durée ; changements de durée chronologiques | tests moteur (relecture 2) | TERMINÉ |
| Avenant | 04 §6 | AMENDMENT : taux, mensualité, nouvelle dernière échéance ; date hors calendrier signalée ; terme échu avec capital restant signalé | E2 à E4 ; tests (relecture 2-M3) | TERMINÉ |
| Remboursement anticipé effectué | 04 §6, cadrage | Jamais futur ; encours constaté atomique ; non déduit une seconde fois s'il précède l'encours observé ; sa convention « mensualité réduite » reste en vigueur | E5 ; tests moteur (relectures 1 et 2-I1) | TERMINÉ |
| Remboursement prévu | cadrage | Futur, au plus tôt demain dans l'interface ; intention ; jamais « dans » l'encours ; signalé s'il est dépassé sans constat | E6, E13 ; tests (relecture 2-M1) | TERMINÉ |
| Solde total | 04 §6 | FULL_REPAYMENT, encours nul constaté | E11 | TERMINÉ |
| Annulation d'une erreur | 04 §6 | Trace motivée unique ; l'encours constaté reste une observation, dit à l'utilisateur (choix §7) | E7 | TERMINÉ |
| Versions contractuelles | cadrage §4 | Version à chaque enregistrement ; version BASELINE avant la première correction d'un contrat antérieur au journal | E8 ; smoke (20260925140000) | TERMINÉ |
| Événements non réabsorbés par le contrat | cohérence | `eventId` filtré ; les remboursements ne se saisissent plus dans le contrat | E9, E14 | TERMINÉ |
| Échéancier bancaire fourni | cohérence | Il prime ; les événements restent à l'historique, écart signalé | tests (relecture 4) | TERMINÉ |
| Cohérence Patrimoine et Flux | cadrage §4 | Bilan à l'encours observé ; projection depuis cet encours, sans rejouer une échéance qu'il contient (lecture à une clôture antérieure) ; Aujourd'hui et Patrimoine au même montant, centimes compris | E5, E11 ; premier utilisateur T4 ; tests (relecture 2-I2) | PARTIEL : dû, payé, prévu AFFECTÉS à B21 |
| Parcours naturel et accessible | cadrage §5 | Question d'usage, aucun préremplissage (événements et clauses du contrat), aperçu, historique ; clavier, 768 px, 390 px | K1, M1, M2, E14 | TERMINÉ (lecteur d'écran et contraste non mesurés) |

## 3. Événements du document 04 §6 hors du ticket B18

| Événement | Affectation | Raison |
|---|---|---|
| Déblocage, déblocages multiples | Décision ultérieure (variante B16) | Le moteur amortit un capital unique |
| Paiement normal, impayé, paiement partiel | B21 | Faits de paiement : rapprochement avec les opérations |
| Changement d'assurance en cours de vie | Décision ultérieure | Polices versionnées avec le contrat, pas encore comme événement daté |
| Refinancement | Décision ultérieure, après B21 | Relie deux dettes, un remboursement et des frais |
| Taux variable indexé | Décision ultérieure | Indice, marge, plafond non modélisés |

## 4. Variantes de B16 toujours affectées

Amortissement constant, taux indexé, ligne renouvelable, découvert, frais financé avec durée
déduite (écart signalé) : décision ultérieure.

## 5. Brouillons persistants

| Exigence | Réalisation | Preuve |
|---|---|---|
| Enregistrable incomplet | Contenu opaque, aucune validation financière | D1 |
| Retrouvé après rechargement et reconnexion | Lu dans le modèle Dette | D3 |
| Modifié, repris, supprimé | Version incrémentée, suppression en deux temps ; le premier enregistrement ne remonte plus le formulaire ; motif de correction conservé | D4, D7, D10 |
| Jamais dans le patrimoine ni les calculs | Table séparée, aucun moteur ne la lit | D1, D2 |
| Brouillon et validation distincts | Deux boutons, deux routes ; la validation consomme le brouillon | D8 |
| Isolation, conflits, saisie conservée | RLS, version attendue ; remplacement décidé retrouvé par nature et dette même sans identifiant | D5, D5b, D6 |
| Extensible | Colonne `domain` fermée, extension par migration additive | schéma |

Non applicable : le formulaire d'événement (un seul écran, sans état intermédiaire utile).

## 6. Dates d'observation

Couverts : opérations saisies, revenus nets, soldes de compte, encours de dette, remboursements
effectués (trigger commun `LF425`), et désormais à la LECTURE des imports : relevé CSV
(`DATE_IN_FUTURE` bloquant) et Open Banking (`BANK_OPERATION_DATE_IN_FUTURE`). AFFECTÉ :
valorisations immobilières, instantanés de portefeuille, autres imports, à auditer domaine par
domaine avant d'étendre la règle.

## 7. Cas ouverts et affectation

| Cas | Affectation |
|---|---|
| Règle de prime d'assurance (capital initial, restant dû, grille) | Décision ultérieure. Un import d'échéancier (B20) lit des primes, il ne couvre pas tous les calculs du document 04 |
| Rapprochement documentaire d'assurance et d'échéancier | B19 (revue), B20 (rattachement) |
| Écart encours observé contre contrat pur après un remboursement constaté | B21 |
| Dû, payé, prévu ; « Service de dette 0 € » d'Aujourd'hui = payé observé du mois | B21 |
| Annulation d'un remboursement : l'encours constaté écrit avec lui reste (choix de conception : une observation ne s'efface pas, elle se remplace par une nouvelle) | Décidé, affiché à l'utilisateur |
| Deux actions d'Aujourd'hui pour une même dette sans termes (réserves du bilan et du modèle mensuel) | Transversal : regroupement des réserves par objet, décision de conception |
| Rail de sources au titre répété (« Échéancier / Échéancier ») | Transversal UX |
| Devise de lecture non choisissable à l'accueil (document 03 §3) | Décision : dépend de la conversion des flux (phase Flux) |
| Domaine « Revenus » encore questionné après un premier revenu | Transversal (Aujourd'hui) |
| Préférence de thème non conservée ; lecteur d'écran et contraste non mesurés | B57 |

## 8. Recette de tranche (locale)

| Recette | Contrôles | Ce qu'elle couvre |
|---|---|---|
| `parcours-premier-utilisateur.mjs` | 18/18 | Espace vierge, accueil quittable et reprenable, domaines, premier compte, dette, revenu, revenu futur refusé, Aujourd'hui, Patrimoine, Flux, correction, rechargement, 390 px, clavier |
| `parcours-evenements.mjs` | 18/18 | B18 de bout en bout, bornes de dates, clauses du contrat sans préremplissage |
| `parcours-brouillons.mjs` | 13/13 | Brouillons, conflits, isolation, motif conservé |
| `parcours-dette-3b.mjs` | 31/31 | B16, B17, clavier, tablette, thème sombre |
| `parcours-b14.mjs` | 41/41 | Dette par son encours, bilan, Aujourd'hui, correction |
| `parcours-ab.mjs` | 35/35 | Inscription, confirmation, connexion, isolation entre comptes |

Gate local : 62 migrations depuis zéro, 116 tables, 478 contraintes, 123 RPC, smokes verts ;
2 506 tests unitaires et composants.

## 8 bis. Relectures indépendantes

| Relecture | Périmètre | Constats | Suite |
|---|---|---|---|
| 1 | B18, brouillons, dates (`a2d8d64`, `b068af1`) | 11 | 10 corrigés (`30085be`), 1 décidé (annulation et encours constaté, §7) |
| 2 | correctifs et recette premier utilisateur (`30085be`, `7e14171`) | 0 bloquant, 3 importants, 7 mineurs | I1, I2, I3, M1, M2, M3, M5 corrigés et M4 en partie (`5121b46`) ; reste ci-dessous |

Restes de la relecture 2, consignés : « Remplacer » un brouillon relit la version courante au
clic et peut écraser une troisième version non vue (enjeu faible : un brouillon n'est pas
canonique) ; un brouillon PROMOTION résiduel occupe l'unique brouillon de la ligne (issue :
le supprimer depuis la liste) ; les recettes navigateur laissent leurs utilisateurs dans la
base LOCALE jetable (pratique commune aux six recettes, jamais sur une base partagée) ;
l'import de portefeuille n'a pas de garde de date future et `LF425` ne couvre ni
`portfolio_events` ni `position_snapshots` (§6, AFFECTÉ).

## 9. Accueil du document 03 §3 : six étapes

| Étape | Servie par | Quittable | Reprenable | Statut |
|---|---|---|---|---|
| Identité | `/setup` (nom d'espace) ; session par Supabase Auth | U2 | U3 | TERMINÉ (partage avec un proche : hors périmètre) |
| Contexte | `/setup` (pays déclaré, date de référence) | U2 | U3 | PARTIEL : devise de lecture affichée, non choisissable |
| Intention | `/setup` (quatre intentions) | U2 | U3 | TERMINÉ |
| Premier fait | Aujourd'hui (installation) puis pages de domaine | oui | oui | TERMINÉ pour compte, encours, revenu ; dépôt de document : B19 |
| Domaines | Aujourd'hui, « Êtes-vous concerné ? » | oui | T2 (réversible) | TERMINÉ |
| Revue | Aujourd'hui (installation, trois actions au plus) | oui | oui | PARTIEL : trois actions de même poids, pas une action dominante unique ; doublon d'actions (§7) |

Les six étapes ne sont pas un assistant linéaire : trois sont sur `/setup`, trois sur
Aujourd'hui. C'est un choix de l'existant, conforme à « quittable et reprenable », consigné ici
plutôt que corrigé.
