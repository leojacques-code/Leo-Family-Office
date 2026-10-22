# Matrice de conformité Dette 3B, version 2 (B15 à B18, brouillons, arbitrages)

Version 2 du 25 septembre 2026, branche `claude/blissful-dirac-4ar700`, commit de référence
`a2d8d64`. Remplace la version 1 du même jour sans l'effacer
(`MATRICE_CONFORMITE_DETTE_3B_2026-09-25.md`). Sources : kit du 11 septembre 2026
(`03_PARCOURS_ET_DESIGN.md` §8, `04_SPECIFICATION_DETTES.md` §3 à §7, `08_RECETTE_ET_CAS.md`,
`backlog.csv`), `design_v10.md`, cadrage et arbitrages du 25 septembre.

Portée des preuves : pile Supabase auto-hébergée LOCALE et build de production. Rien n'est
validé sur le projet Supabase hébergé ni sur la preview Vercel (recette réservée à Astra).
Aucune migration citée n'est en production.

Statuts : TERMINÉ (exigence couverte, preuve exécutée) ; PARTIEL (couverte en partie, reste
nommé) ; AFFECTÉ (hors du ticket, rattaché à un ticket ou une décision ultérieurs).

## 1. Tickets

| Ticket | Critère de sortie | Statut | Preuve | Reste |
|---|---|---|---|---|
| B15 | Encours au bilan sans termes inventés | TERMINÉ | recette B14 41/41 | néant |
| B16 | Embranchements par structure, dates, contrôles de synthèse | TERMINÉ | recette 3B P1 à P8, B1 à B8 | variantes AFFECTÉES (§4) |
| B17 | Assurés, quotités, primes, calendrier indépendant sans doublon | TERMINÉ | recette 3B A1 à A9 | règle de prime par barème AFFECTÉE (B20, décision) ; rapprochement payé AFFECTÉ (B21) |
| B18 | Remboursement, taux, report et solde conservés dans l'historique | TERMINÉ, sous réserve de la relecture indépendante en cours | recette événements 16/16 ; smoke événements | événements hors ticket AFFECTÉS (§3) |
| Brouillons (document 03 §8) | Enregistrable incomplet, retrouvé, repris, supprimé, sans effet financier | TERMINÉ pour le contrat de dette | recette brouillons 12/12 ; smoke brouillons | formulaire d'événement : non applicable (§5) |
| Dates d'observation (arbitrage 2) | Aucun fait observé futur ; prévisions libres | TERMINÉ | smoke dates d'observation ; tests de validation | imports d'autres domaines : AFFECTÉ (§6) |
| `account_balances` (arbitrage 3) | Écritures directes retirées après audit | TERMINÉ | smoke dates d'observation (droits, isolation) | néant |

Dette 3B n'est PAS déclarée close tant que la relecture indépendante des lots B18, brouillons
et dates n'est pas traitée et la recette de tranche complète rejouée.

## 2. B18, exigence par exigence

| Exigence | Source | Réalisation | Preuve | Statut |
|---|---|---|---|---|
| Événement daté, avec source et impact | 04 §6 | Journal immuable `liability_events` : date d'effet, source obligatoire, nature, contenu fermé | smoke ; E3 | TERMINÉ |
| Distinguer observé, contractuel, simulation | cadrage §4 | Nature OBSERVÉ, CONTRACTUEL, PRÉVU contrainte par la base ; aperçu des conséquences jamais écrit | E2, E6 ; smoke | TERMINÉ |
| Révision de taux | 04 §6, cadrage | Événement RATE_CHANGE ; mensualité maintenue signalée si aucune n'est déclarée | tests moteur | TERMINÉ |
| Changement de mensualité, paliers | cadrage | PAYMENT_CHANGE à date d'effet | tests moteur | TERMINÉ |
| Report, différé en cours de vie | 04 §6 (report), cadrage | DEFERRAL : capital seul ou total, intérêts, effet DÉCLARÉ sur la durée (allongée, mensualité recalculée, inconnu signalé) | tests moteur | TERMINÉ |
| Avenant | 04 §6 | AMENDMENT : taux, mensualité et/ou nouvelle dernière échéance ; recalcul sans mensualité déclarée ; date hors calendrier signalée, jamais arrondie | E2 à E4 ; tests | TERMINÉ |
| Remboursement anticipé effectué | 04 §6, cadrage | Jamais daté après aujourd'hui ; encours constaté écrit atomiquement ; sans lui, bilan à l'encours observé et écart signalé | E5 ; tests | TERMINÉ |
| Remboursement prévu | cadrage (simulation distincte) | Daté dans le futur, intention dans la projection (nature USER_ASSUMPTION), aucun encours | E6 ; tests | TERMINÉ |
| Solde total | 04 §6 (« il faut le fait ») | FULL_REPAYMENT observé, encours nul constaté, archivage proposé | E11 | TERMINÉ |
| Annulation d'une erreur | 04 §6 | Trace motivée unique ; événement lisible et barré ; l'encours constaté reste une observation, dit à l'utilisateur | E7 | TERMINÉ |
| Versions contractuelles | cadrage §4 | `liability_contract_versions` à chaque enregistrement ; correction motivée | E8 | TERMINÉ |
| Événements non réabsorbés par le contrat | CLAUDE.md, cohérence | `eventId` filtré à la réédition | E9 | TERMINÉ |
| Cohérence Patrimoine et Flux | cadrage §4 | Bilan sur l'encours observé ; projection par le Debt Engine ; débits typés dans le calendrier d'événements | E5, E11 | PARTIEL : rapprochement dû, payé, prévu AFFECTÉ à B21 |
| Parcours naturel et accessible | cadrage §5 | Question d'usage, aucun préremplissage, aperçu, historique ; clavier, tablette 768 px, mobile 390 px | K1, M1, M2 | TERMINÉ (lecteur d'écran et contraste non mesurés) |

## 3. Événements du document 04 §6 hors du ticket B18

| Événement | Affectation | Raison |
|---|---|---|
| Déblocage, déblocages multiples | Décision ultérieure (variante B16) | Le moteur amortit un capital unique ; une liste de décaissements datés change le cœur d'amortissement |
| Paiement normal, impayé, paiement partiel | B21 | Faits de paiement : exigent le rapprochement avec les opérations |
| Changement d'assurance en cours de vie | Décision ultérieure | Les polices sont versionnées avec le contrat (versions), pas encore comme événement daté |
| Refinancement | Décision ultérieure, après B21 | Relie deux dettes, un remboursement et des frais : dépend du rapprochement |
| Changement de taux variable indexé | Décision ultérieure | Indice, marge, plafond non modélisés (limite B16) |

## 4. Variantes de B16 toujours affectées

Amortissement constant, taux indexé, ligne renouvelable, découvert, frais financé avec durée
déduite (écart signalé) : décision ultérieure, déjà nommées dans la version 1.

## 5. Brouillons persistants

| Exigence (arbitrage 1, document 03 §8) | Réalisation | Preuve |
|---|---|---|
| Enregistrable incomplet | Contenu opaque, aucune validation financière à l'enregistrement | D1 |
| Retrouvé après rechargement et reconnexion | Lu dans le modèle Dette | D3 |
| Modifié, repris, supprimé | Reprise fidèle, version incrémentée, suppression en deux temps | D4, D7 |
| Jamais dans le patrimoine ni les calculs | Table séparée, aucun moteur ne la lit | D1, D2 ; test de périmètre de lecture |
| Brouillon et validation distincts | Deux boutons, deux routes ; la validation consomme le brouillon | D8 |
| Isolation, conflits, saisie conservée | RLS, RPC sous version attendue, conflit avec deux issues décidées | D5, D5b, D6 |
| Extensible aux autres domaines | Colonne `domain` fermée, à étendre par migration additive | schéma |

Non applicable : le formulaire d'événement (un seul écran, sans état intermédiaire utile).

## 6. Dates d'observation

Couverts : opérations, revenus nets, soldes de compte, encours de dette, remboursements
effectués (trigger commun, validation, bornes de saisie). AFFECTÉ : valorisations
immobilières, instantanés de portefeuille et imports d'autres domaines, à auditer domaine par
domaine avant d'étendre la règle (le cadrage vise opérations et revenus).

## 7. Cas ouverts et affectation

| Cas | Affectation |
|---|---|
| Règle de prime d'assurance (capital initial, restant dû, grille) | Décision ultérieure ; un import d'échéancier (B20) ne couvre pas tous les calculs du document 04 |
| Rapprochement documentaire d'assurance et d'échéancier | B19, B20 |
| Écart « encours observé contre contrat pur » après un remboursement constaté | B21 |
| Dû, payé, prévu | B21 |
| Lecteur d'écran, contraste mesuré, préférence de thème non conservée | Décision ultérieure (transversal) |
