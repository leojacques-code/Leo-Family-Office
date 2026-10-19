# B19 — reprise de la recette visuelle hébergée

**En cours. B19 non clôturé ; B20 non commencé.**

## État observé le 15 octobre

Preview de référence : https://leo-family-office-379zofqnf-lech1.vercel.app/debt,
code `c0331a20588428b1a03cd8aad61f9793b7d3cff2`, staging distinct
`bjxhnwvomoznorijauyl`. L'inscription et la confirmation e-mail sont déclarées effectuées
par le propriétaire. Une connexion sécurisée a ensuite effectivement ouvert son espace
dans le navigateur de recette. Aucun mot de passe n'a été lu ou recopié dans les preuves.

| Parcours réellement effectué | Résultat                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contexte personnel           | Nom, devise EUR, pays et date relus dans Mon espace ; aucun fait financier présumé.                                                                                                                                                                                 |
| Compte vierge                | Patrimoine : « Aucun actif ni passif déclaré ». Dette : « Aucune dette enregistrée ». Aucun objet A/B des essais techniques visible.                                                                                                                                |
| Encours seul                 | Dette synthétique de 2 000 €, constatée le 15 octobre ; aucun taux, coût, calendrier ou échéance inventé.                                                                                                                                                           |
| Erreur de saisie et reprise  | Date initialement vide : refus natif puis message explicite, nom, montant et note conservés ; date saisie au clavier, puis enregistrement réussi. Le refus de date future n'a pas été certifié par cet essai : la commande de saisie n'avait pas renseigné de date. |
| Brouillon                    | Contrat incomplet enregistré, page rechargée, brouillon et encours retrouvés ; reprise du mode et du capital saisis.                                                                                                                                                |
| Contrat adaptatif            | Mensualité seule de 1 000 €, taux explicitement 0 %, première échéance 5 novembre ; durée de deux échéances et maturité au 5 décembre indiquées comme déduites.                                                                                                     |
| Assurance séparée            | Assureur et assuré synthétiques, quotité 100 %, primes mensuelles 5 € du 5 novembre au 5 décembre ; assurance future 10 € dans le modèle relu. Frais et absence de différé déclarés explicitement.                                                                  |
| Promotion                    | La dette devient contractuelle ; encours 2 000 € conservé et brouillon consommé, sans second passif visible.                                                                                                                                                        |
| Avenant                      | Taux synthétique de 1 % au 5 novembre, source et objet enregistrés ; avertissements sur les hypothèses et le solde résiduel visibles ; encours observé inchangé.                                                                                                    |
| Annulation                   | Motif saisi et confirmation déclenchée ; trace et motif confirmés par lecture SQL le 19 octobre ; relecture finale dans l’interface encore attendue après interruption de session.                                                                                                                                                        |

## Anomalies constatées et corrections préparées

1. L'action principale « Importer un échéancier » ouvrait **Corriger le contrat**.
   Elle pilote désormais le même tiroir CSV/XLSX que Documents et disparaît quand aucun
   contrat ne permet de servir cette action. Test de régression avec le gestionnaire
   effectivement enregistré dans l'en-tête.
2. Le rail signalait l'encours absent après promotion, malgré l'observation conservée.
   Les observations datées des contrats alimentent désormais la source Encours.
3. Choisir une assurance séparée encore incomplète affichait 0 € dans la synthèse.
   Le brouillon transmet maintenant au moteur un état d'assurance inconnue jusqu'à la
   description complète des primes ; aucune formule financière ajoutée à l'interface.
4. Deux h1 et une question de domaine trop longue. Dette utilise un h2 interne sans
   paragraphe introductif, la question du manifeste est raccourcie. Le texte utilisateur
   « forward / DERIVED » devient « Échéancier projeté ».

Les quatre fichiers ciblés passent **47 tests**. Lint et build ont réussi sur ces mêmes
modifications avant interruption. La suite unitaire complète passe à la reprise : **2 593 tests dans 186 fichiers**, journal conservé dans `preuves/visual-b19-2026-10-15/unit-regressions.log`.
Ces résultats locaux ne certifient pas leur comportement sur la prochaine Preview.

## Confrontation V10 et décisions fondateur

- Sources : cartes encore hautes, répétitions de noms et panneau non repliable ; D-UX-03
  reste à corriger et à revoir sur l'écran final.
- Dette : formulaire adaptatif et options avancées accessibles, distinction entre déclaré
  et déduit, brouillon et synthèse avant enregistrement réellement parcourus.
- Aujourd'hui : plusieurs métriques gardent une question pédagogique comme libellé ;
  D-UX-01/D-UX-02 restent à vérifier et corriger sans rebaptiser abusivement les calculs.
- Revue B19, aide contextuelle, sélection synchronisée, conflits, imports et validation :
  recette dans l'interface encore à effectuer, distincte des 19 étapes HTTP déjà prouvées.

## Captures conservées et limites

Les captures [initiales](preuves/visual-b19-2026-10-15/) proviennent du navigateur réel,
au format mesuré **1363 × 936**, sauf la capture du mauvais aiguillage qui mesure **1348 × 926**. Elles ne sont ni recadrées ni redimensionnées pour prétendre
à 1440 × 900. Les formats 1440 × 900, tablette 900 px, mobile 390 px et les gestes tactiles
restent non certifiés. L'API de navigateur disponible ne propose pas de redimensionnement
ou d'émulation tactile ; la recherche de capacités complémentaires n'en a pas fourni.

Au 19 octobre, les fichiers et captures sont conservés mais l'ancienne session navigateur
n'est plus disponible. La protection Vercel reste active ; l'accès temporaire doit être
renouvelé avant reprise, puis une session applicative vérifiée est nécessaire. Aucune
injection de cookies ni contournement de connexion ne sera utilisé comme preuve visuelle.

## Limites de périmètre

Uniquement le staging synthétique. Aucun changement de production, aucune migration,
aucune dépense et aucune fusion dans main. Staging laissé actif pour la suite des essais.
