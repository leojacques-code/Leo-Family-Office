# Passation LFO, session du 25 septembre 2026, version 2 (B18, brouillons, dates, clôture 3B)

Branche `claude/blissful-dirac-4ar700`, PR brouillon #52 vers `main`, jamais fusionnée.
Précédente passation : `PASSATION_2026-09-25.md` (conservée). Matrice de clôture :
`MATRICE_CONFORMITE_DETTE_3B_2026-09-25_v3.md`.

Rien n'a été écrit en production Supabase ni dans la configuration Vercel distante. Toutes les
recettes sont locales (pile Supabase auto-hébergée, build de production) : elles ne valident ni
le projet hébergé ni la preview, réservés à Astra.

## 1. Ce qui est livré depuis la version 1

| Commit | Objet |
|---|---|
| `b068af1` | Brouillons persistants du contrat de dette (document 03 §8) |
| `a2d8d64` | B18 : événements et avenants de dette versionnés |
| `8a65ee4` | CLAUDE.md et matrice v2 |
| `30085be` | Correctifs de la relecture indépendante de B18, brouillons et dates |
| `7e14171` | Recette « premier utilisateur » ; Aujourd'hui affiche les centimes |
| `86e1cd7` | Clauses du contrat sans préremplissage ; remboursements par le journal |
| `5121b46` | Relecture 2 : projection depuis l'encours observé, brouillons, horloge, recette durcie |

## 2. Décisions prises, et pourquoi

1. Arbitrage 1, brouillons : table `form_drafts` limitée au domaine Dette, extensible par
   migration additive ; contenu opaque, version attendue, aucun moteur ne la lit.
2. Arbitrage 2, dates : un fait observé n'est jamais daté après aujourd'hui (Europe/Paris),
   refus `LF425` en base ; aux imports, la ligne est BLOQUÉE dès la lecture plutôt que refusée à
   la décision.
3. Arbitrage 3, `account_balances` : écritures directes retirées à `authenticated` après audit
   de tous les chemins d'écriture (tous passent par `service_role`).
4. B18 : un changement réel du prêt est un événement daté immuable ; corriger une saisie crée
   une version de contrat ; une simulation n'est jamais écrite. Les remboursements ne se
   saisissent plus dans le contrat, pour qu'un même remboursement ne soit jamais compté deux
   fois.
5. Contrat antérieur au journal : sa première correction fige d'abord ses termes dans une
   version `BASELINE`, nommée « termes antérieurs au versionnement » et non « création »,
   parce que l'état de création n'est pas connu.
6. Annuler un remboursement ne retire pas l'encours constaté écrit avec lui : une observation
   se remplace par une nouvelle observation, elle ne s'efface pas. L'interface le dit.
7. Aujourd'hui passe par le formateur de montants partagé : « 1 000 € » contre « 999,50 € »
   pour un même bilan n'était pas une convention, c'était une incohérence.
8. Une projection de dette part de l'encours observé, à la plus tardive de la date de lecture
   et de la date de cet encours. Un encours daté d'un jour d'échéance est lu après ce
   prélèvement, comme la date de lecture : une seule convention. Alternative écartée : lire
   « avant prélèvement » pour l'encours seulement, qui donnait deux projections différentes du
   même encours selon la date de lecture. Le formulaire le dit, et le prêt simulé de
   l'immobilier date son capital la veille de la première échéance.

## 3. Migrations ajoutées (aucune en production)

| Migration | Objet |
|---|---|
| `20260925110000_observation_dates_and_balance_rights` | trigger `LF425` sur les tables d'observation ; droits d'écriture retirés sur `account_balances` |
| `20260925120000_form_drafts` | brouillons persistants |
| `20260925130000_debt_events` | journal d'événements, annulations, versions de contrat |
| `20260925140000_debt_review_versions_and_guards` | version `BASELINE` ; gardes de forme séquentielles ; contrainte de nature remplacée par `_v2_ck` |

Dépôt : 62 migrations ; production (dernier relevé connu, 9 septembre) : 45. Avant de pousser
`20260924170000` sur une base partagée, compter les lignes que ses deux contraintes refuseraient
(CLAUDE.md §5). `20260925140000` supprime puis recrée une contrainte de nature sur
`liability_contract_versions`, table créée par `20260925130000` : aucune donnée existante
hors de ces deux migrations.

## 4. Preuves (locales)

| Preuve | Résultat |
|---|---|
| `npm run test` | 2 506 tests verts |
| `npm run lint`, `tsc --noEmit` | verts |
| `npm run gate:local` | 62 migrations depuis zéro, 116 tables, 478 contraintes, 123 RPC, smokes verts |
| Recettes navigateur | premier utilisateur 18/18, événements 18/18, brouillons 13/13, 3B 31/31, B14 41/41, A/B 35/35 |

## 5. Relectures indépendantes

- Relecture 1 (B18, brouillons, dates) : onze constats ; dix corrigés dans `30085be`, un
  (annulation et encours constaté) tranché comme choix de conception (§2, point 6).
- Relecture 2 (correctifs et recette premier utilisateur) : aucun bloquant, trois importants
  (convention « mensualité réduite » perdue, échéance rejouée après une clôture, contrôles de
  recette trop larges) et sept mineurs ; traités dans `5121b46` sauf les restes listés dans la
  matrice v3 §8 bis.

## 6. Constats consignés, non traités

Voir la matrice v3 §7 : dû, payé, prévu (B21) ; actions dupliquées d'Aujourd'hui ; rail de
sources au titre répété ; devise de lecture non choisissable à l'accueil ; domaine Revenus
questionné après un revenu ; thème, lecteur d'écran, contraste (B57).

## 7. Prochaine étape

3C dans l'ordre de ses dépendances : B19 (revue des candidats documentaires), B20 (échéancier et
assurance importés), B21 (dû, payé, prévu). La partie documentaire de B14 reste ouverte.

## 8. Clôture de Dette 3B

Dette 3B est close EN LOCAL : B15 à B18, brouillons applicables et recette de tranche
satisfaits, deux relectures indépendantes traitées. Elle ne l'est PAS sur l'environnement
hébergé : la recette Supabase et Vercel reste réservée à Astra, et aucune des dix-sept
migrations locales n'est en production.
