# Passation LFO, session du 25 septembre 2026 (B17, relecture B16/B17)

Branche `claude/blissful-dirac-4ar700`, PR brouillon #52 vers `main`, jamais fusionnée.
Précédente passation : `PASSATION_2026-09-24_v2.md` (conservée). Matrice détaillée :
`MATRICE_CONFORMITE_DETTE_3B_2026-09-25.md`.

Rien n'a été écrit en production Supabase ni dans la configuration Vercel distante. Toutes les
recettes sont locales (pile Supabase auto-hébergée, build de production) : elles ne valident ni
le projet hébergé ni la preview, réservés à Astra.

## 1. Ce qui est livré

- B17, assurance emprunteur séparée : choix initial obligatoire à quatre valeurs, polices,
  assurés et quotités, périodes de prime à leur propre calendrier, dates de couverture, base
  assurée descriptive, compte débité facultatif. Un coût, une fois : incluse et séparée sont
  exclusives en base.
- Poste Dette (V10) : bandeau de composition des sorties sur douze mois (capital, intérêts,
  assurance, frais), inspecteur d'assurance, échéancier avec colonne Assurance, empilé sur écran
  étroit ; courbe de solde en escalier depuis l'encours observé, sans échantillonnage.
- Formulaire : plus aucun préremplissage de fait inconnu (fréquence de prime, date et montant de
  frais ponctuel) ; libellés accessibles des frais ponctuels et des boutons « Ajouter ».
- Métriques de dette à douze mois : PARTIAL avec bloqueur nommé quand une assurance ou des frais
  récurrents sont inconnus, au lieu d'un total complet qui comptait l'inconnu à zéro.
- Relecture indépendante : sept défauts reproduits et quatre plausibles, tous traités sauf deux
  (voir §5).
- Accessibilité : le composant `Modal` (partagé) donne enfin le focus au dialogue, le confine et
  le rend au déclencheur.

## 2. Décisions prises, et pourquoi

1. Assurance incluse de montant inconnu : aucune durée n'est déduite d'une mensualité (la part qui
   amortit est inconnue). Si la durée est déclarée, l'amortissement suit le contrat et la part
   restante de la mensualité est lue comme l'assurance incluse, SIGNALÉE (`INCLUDED_INSURANCE_UNKNOWN`).
   Alternative écartée : amortir avec la mensualité entière, qui comptait la prime comme du capital.
2. Base assurée descriptive seulement : le document 04 interdit de déduire un mécanisme d'une prime
   isolée. Une règle (taux sur capital, grille) se saisira par son échéancier (B20).
3. Fenêtre « douze prochains mois » = [date de lecture, + 12 mois[ : une borne incluse comptait
   treize échéances quand la lecture tombait un jour d'échéance.
4. Écritures directes retirées à `authenticated` sur les sept tables de dette : toutes les
   écritures applicatives passent par `service_role` (vérifié dans le repository).
5. Pas d'espace de brouillons persistant construit : le document 03 §8 le prévoit côté serveur ;
   c'est une décision de conception transversale (table, rétention, sécurité), pas un détail de B17.

## 3. Migrations ajoutées (aucune en production)

| Migration | Objet |
|---|---|
| `20260925090000_debt_insurance_policy_details` | couverture, base assurée, compte débité ; RPC reprise de sa dernière version |
| `20260925100000_debt_review_hardening` | droits d'écriture retirés, chevauchement de périodes refusé, choix d'assurance non effaçable |

Dépôt : 58 migrations ; production (dernier relevé connu, 9 septembre) : 45. Avant de pousser
`20260924170000` sur une base partagée, compter les lignes que ses deux contraintes refuseraient
(voir CLAUDE.md §5).

## 4. Preuves

| Preuve | Résultat |
|---|---|
| `npm run test` | 2 460 tests verts |
| `npm run lint`, `tsc --noEmit` | verts |
| `npm run gate:local` | 58 migrations depuis zéro, 112 tables, 467 contraintes, 119 RPC, 53 tables en lecture seule pour le client, smokes verts |
| Recette 3B (B16 + B17), `parcours-dette-3b.mjs` | 31/31, captures dans `preuves/dette-3b-b17-2026-09-25/` |
| Recette B14, `parcours-b14.mjs` | 41/41 |
| Recette A/B (authentification, isolation) | 35/35 |

## 5. Relecture indépendante : restes

- Dates futures dans `lfo_record_net_income` et `lfo_add_transaction` : non refusées. Une opération
  future peut être une prévision légitime ; à décider.
- Contraintes sans `NOT VALID` dans `20260924170000` : contrôle préalable à faire avant push.

## 6. Arbitrages demandés

1. Espace de brouillons persistant (document 03 §8) : le construire maintenant, transversalement,
   ou le rattacher à une phase ultérieure ?
2. Refus des dates futures pour un revenu observé et une opération saisie : à appliquer ?
3. `account_balances` garde l'écriture directe pour `authenticated` : même analyse que pour les
   dettes ; à retirer dans une prochaine migration additive ?

## 7. Constats consignés, non traités

- Le thème sombre n'est pas conservé au rechargement (préférence non persistée).
- Le rail de sources affiche « Échéancier / Échéancier » (titre et sous-titre identiques).
- Contraste et lecteur d'écran non vérifiés instrumentalement.
- Éditeurs avancés du contrat (révisions de taux, paliers, remboursements anticipés) : encore
  préremplis et sans libellés accessibles ; ils seront repris par B18 (événements versionnés).

## 8. Prochaine étape

B18 : événements et avenants de dette versionnés (remboursement, taux, report, solde conservés
dans l'historique). Dette 3B ne sera déclarée close qu'après B18 et la validation complète de ses
parcours manuels. Puis 3C (B19, B20, B21) dans l'ordre de leurs dépendances.
