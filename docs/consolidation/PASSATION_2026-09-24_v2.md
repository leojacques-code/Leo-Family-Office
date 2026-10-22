# Passation LFO, session du 24 septembre 2026, tranche 2 (limites B14 et B16)

Suite de `PASSATION_2026-09-24.md`, qui reste la référence pour l'Auth, la recette locale et
les premiers faits B14. Ce document ne décrit que la seconde tranche : la fermeture des limites
de B14, demandée après la PR #52, puis le début de Dette 3B. Il se lit après `CLAUDE.md`.

Aucune écriture, migration ni configuration n'a touché Supabase production ou Vercel. Tout ce
qui suit est prouvé sur la pile locale (gate à doublure et pile Supabase auto-hébergée) :
**rien n'est validé sur l'environnement hébergé ni sur une preview.**

## 1. Ce qui est livré

| Sujet | Livraison | Commits |
|---|---|---|
| Correction d'un revenu observé | Correction NON DESTRUCTIVE d'un revenu net saisi : valeur corrigée en place sous verrou, état attendu complet transporté en texte, conflit 409 sur état périmé, piste immuable `transaction_corrections` (avant, après, motif, champs, acteur vérifié = propriétaire, rôle constaté, `RESTRICT`). Aucune opération de régularisation. | `e31385c`, `5b7fc50`, `b33922d` |
| Formulaire d'opération exigeant une catégorie | Catégorie facultative (opération « non classée »), défaut de démonstration `exp_groceries` supprimé, devise lue sur le compte, date future et montant nul refusés | `cf1f876` |
| Montants mal formatés | Deux décimales dès qu'un montant porte des centimes (« 1 500,50 € ») | `cf1f876` |
| Zéros pour une donnée inconnue | Tuile Dépenses, « Structure des dépenses » et budgets : « Non observé » / « Aucune dépense observée » au lieu de 0 € | `cf1f876`, `d804845`, `b33922d` |
| Addition silencieuse de devises | Moteur Flux : opération d'une autre devise exclue, comptée, nommée ; seuls les agrégats qui dépendent de SA nature deviennent non calculables (`aggregateBlocked`) ; budgets par catégorie ; clôture refusée (422) ; Aujourd'hui et Career → Tax → Cash Flow alignés | `cf1f876`, `b33922d` |
| Encadré qualité de Flux illisible (défaut antérieur) | Les raisons du moteur, qui s'affichaient « N points non identifiés », sont lisibles | `d804845` |
| **B16** : encours seul → contrat | La même ligne `liabilities` passe à `CONTRACT` par décision explicite (`promote_outstanding: true`), sans second passif, devise, encours courant et historique conservés ; trace immuable `liability_terms_transitions` ; action « Décrire le contrat » | `f66c67b` |
| Mobile, page Dettes avec un contrat | Les actions de l'en-tête passaient hors écran (débordement de 33 px) ; elles passent à la ligne | `b33922d` |

## 2. Décisions prises, et pourquoi

1. **Mécanisme de correction** (principe validé : non destructif, historique et provenance
   conservés, aucune transaction fictive). Retenu : le modèle des corrections d'observation de
   portefeuille (`20260904093000`, `20260905090000`). Écartés : une écriture de régularisation
   (flux économique qui n'a pas eu lieu, agrégats faussés si la date change) et une supersession
   (tous les lecteurs du ledger devraient filtrer les lignes remplacées : second modèle de lecture).
2. **Périmètre de la correction** : seuls les revenus écrits par `lfo_record_net_income`. Une
   opération importée se corrige par sa chaîne d'acquisition. Compte et devise non corrigeables.
3. **Mois clôturé** : une correction ne réécrit pas une clôture ; le tiroir le dit, pour le mois
   d'origine comme pour le mois de destination.
4. **Devises** : exclusion nommée, pas de conversion (réservée à la phase Flux). Le tiroir de revenu
   et le formulaire d'opération refusent un compte dans une autre devise que la lecture ; une
   opération déjà présente (import, API) est exclue et nommée. Le blocage est limité aux agrégats
   qui en dépendent : une dépense en CHF rend la consommation incalculable, pas le revenu en euros.
5. **B16** : `lfo_save_debt_contract` est ÉTENDUE (sa seule et dernière version, vérifiée identique
   en base) plutôt que doublée : une seconde porte d'écriture sur `liabilities` serait une seconde
   vérité. La promotion réutilise le formulaire de contrat EXISTANT, donc exige les termes complets
   d'aujourd'hui (voir §6, arbitrage 2).

## 3. Migrations ajoutées (non appliquées en production)

| Migration | Objet |
|---|---|
| `20260924120000_net_income_correction.sql` | `transaction_corrections`, `lfo_correct_net_income` |
| `20260924150000_debt_outstanding_to_contract.sql` | `liability_terms_transitions`, extension de `lfo_save_debt_contract` |

Le dépôt porte 53 migrations ; **huit** ne sont pas en production (liste dans `CLAUDE.md` §5).
`20260924081000` et `20260924091000` (PR #52) n'ont pas été modifiées.

## 4. Preuves

| Contrôle | Résultat |
|---|---|
| `npm run lint`, `tsc --noEmit` | propres |
| `vitest` | 2 417 tests / 167 fichiers verts |
| `npm run gate:local` | vert : 53 migrations, 109 tables, 454 contraintes relevées, 119 RPC, 20 triggers ; smokes dont `smoke-net-income-correction`, `smoke-debt-promotion`, et en concurrence `smoke-net-income-correction-concurrency` |
| Vérificateur sur la pile Supabase locale | conforme (note `search_path` du README de recette) |
| `parcours-b14.mjs`, build `O46wI2XVG9zxiGMS35yC8` | **41/41**, `preuves/b14-correction-2026-09-24/` |
| `parcours-dette-3b.mjs`, même build | **10/10**, `preuves/dette-3b-promotion-2026-09-24/` |
| `parcours-ab.mjs`, même build | **35/35** (Auth, isolation A/B, sessions) |

La recette B14 part d'un compte neuf et enchaîne dette par son seul encours, bilan, Patrimoine,
Aujourd'hui, correction d'encours, compte, revenu net, correction du revenu (tiroir, rechargement,
une seule transaction en base, piste complète, conflit 409 sans écrasement, historique dans le
tiroir, propagation), opération non classée, devises (opération CHF non classée : aucun total
bloqué ; classée en dépense : consommation et surplus non calculables, revenu intact ; raison
nommée ; clôture refusée ; formulaire qui refuse), bureau et mobile. La recette 3B promeut une
dette encours seul en contrat : même ligne, une seule dette, historique à une observation, trace,
bilan (passif compté une fois, désormais contractuel), Patrimoine, Aujourd'hui, Flux, mobile.

Le document 08 n'est pas dans le dépôt : sa numérotation est reprise de la première passation.
Les étapes documentaires (7 et 8) attendent Dette 3C : **B14 n'est pas déclaré terminé**.

## 5. Relecture indépendante

Une relecture adversariale du lot B14 a relevé 1 constat bloquant, 6 importants et 13 mineurs,
plusieurs démontrés en base. Traités dans `b33922d` : B1, I1, I3, I4 (y compris le smoke
préexistant des déclarations de domaine, dont l'assertion d'isolation était vraie par
construction), I5, I6, M3, M6, M7, M8, M9, M11, M12, M13. **Non traités, en attente d'arbitrage**
(voir §6, arbitrage 1) : I2, M1, M2, M4, M5, M10.

## 6. Arbitrages demandés

1. **Durcissements de base sur la correction de revenu** (constats I2, M1, M2, M4, M5, M10). Ils
   exigent de modifier `20260924120000` (publiée sur GitHub, appliquée à aucun environnement
   partagé) ou d'ajouter une migration, et de retirer à `authenticated` les droits d'écriture
   directe sur `transactions`. L'outil a refusé la réécriture de la migration publiée, à juste
   titre : c'est une décision à prendre. Contenu proposé :
   - I2 (important) : `revoke insert, update, delete on public.transactions from authenticated`.
     Aujourd'hui un client authentifié peut réécrire un revenu déjà corrigé sans trace (démontré),
     ou poser la source « Saisie revenu net observé » sur une opération importée. Toutes les
     écritures de l'application passent déjà par `service_role` ;
   - M1 : messages de refus sans valeur persistée et SQLSTATE dédiés (`LF409`, `LF422`, `LF403`) ;
     le repository sait déjà router sur ces codes ;
   - M2 : comparer les dates en `date` et sérialiser avec `to_char(…, 'YYYY-MM-DD')` (sous un
     autre `DateStyle`, conflit perpétuel démontré) ;
   - M4 : refuser une date corrigée future et retirer les blancs Unicode de bord (motif « » accepté) ;
   - M5 : même échelle `numeric(20,6)` des deux côtés de la piste ;
   - M10 : `lfo_add_transaction` lit la devise du compte elle-même (aujourd'hui, le serveur la lit
     dans une requête séparée et la RPC accepte encore la devise de l'appelant).
   Recommandation : une migration additive `20260924160000` pour tout le lot, plutôt que de
   réécrire `20260924120000`, afin de garder la règle « un fichier publié ne change plus ».
2. **B16, contrat minimal suffisant** : la promotion exige aujourd'hui les termes complets du
   formulaire existant (capital, taux, échéance, nombre, dates, profil, convention). La mission
   parle d'un « contrat suffisant pour un échéancier calculable » et de caractéristiques
   manquantes. Quel ensemble minimal autoriser (par exemple encours, taux, échéance : durée
   déduite) et comment le Debt Engine doit le traiter est une décision financière structurante,
   et le document 04 qui la décrit n'est ni dans le dépôt ni dans les annexes.
3. **Dette 3B, suite (B17 à B21)** : assurance et frais distincts du capital, contractuel distinct
   de l'observé et avenants existent en partie dans le moteur (`monthly_insurance`,
   `payment_includes_insurance`, rapprochement contractuel/observé, changements de taux et de
   mensualité). Sans le document 04, je ne peux pas délimiter ce qui manque sans l'inventer.

## 7. Constats consignés, non traités

- Surplus du mois quand seules des entrées sont saisies : il vaut le revenu, signalé « Incomplet ».
  Cohérent avec « observé », mais la lecture peut tromper (décision produit).
- Environ 60 usages de `formatEur` ou `<Currency>` sans devise hors Flux affichent encore l'euro
  par défaut (lot « devise de lecture » transversal).
- Création d'un contrat de dette : la RPC n'écrit pas de devise, la colonne prend `EUR` par défaut ;
  le formulaire le dit, mais une devise de lecture différente n'est pas proposée. Le report de
  différé vaut `NONE` par défaut dans la RPC quand il n'est pas déclaré (valeur par défaut à la
  place d'une donnée manquante, préexistant).
- Les autres tables d'observation (`account_balances`, `liability_balance_observations`) laissent
  aussi l'écriture directe à `authenticated` : même analyse que I2, à décider ensemble.
- Constats de la première passation toujours ouverts : `lfo_set_real_estate_financing_link` et
  dette encours seul, `.panel-note` à 9 px, mobile Aujourd'hui, 500 générique sur refus de clé
  étrangère composite, journal `console.error(fallback, error)` qui reprend le message du
  fournisseur, export CSV daté de l'arrêté.

## 8. Prochaine étape

Selon les arbitrages : migration de durcissement (arbitrage 1), puis contrat minimal B16 et suite
de Dette 3B (arbitrages 2 et 3). Dette 3C documentaire ne commence qu'après validation de 3B.
