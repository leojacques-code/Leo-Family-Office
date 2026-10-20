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
| Annulation                   | Motif saisi et confirmation déclenchée ; trace et motif confirmés par lecture SQL le 19 octobre ; relecture finale dans l’interface encore attendue après interruption de session.                                                                                  |

## Anomalies constatées et corrections

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

Ces premières corrections sont publiées au commit
`6ca3b20891cde8a8fe30b9f1f29c970c8b29c10a`, Preview READY
https://leo-family-office-6vybukxyd-lech1.vercel.app. La suite complète correspondante passe :
**2 593 tests dans 186 fichiers**, journal conservé dans
`preuves/visual-b19-2026-10-15/unit-regressions.log`.

La reprise ajoute les corrections D-UX-01/02/03 :

- Sources sous forme de bande compacte, sans colonne réservée ; les entrées, leur sélection,
  les actions Fournir et l'état À actualiser restent disponibles. Un bouton déplie dates et
  états détaillés. Les noms identiques aux catégories ne sont plus répétés.
- Aujourd'hui affiche les noms financiers du registre et l'aide partagée « ? » pour la
  question, la définition et les données nécessaires. Le solde libre ne devient pas une
  capacité d'épargne ; la liquidité immédiate ne change pas de périmètre.
- L'objectif est nommé Progression de l'objectif : sa mesure actuelle n'est plus annoncée
  comme une projection future.

Vérification locale : **2 595 tests dans 187 fichiers**, lint et contrôle des marqueurs
réussis. Le premier build a échoué à l'ouverture du cache de persistance Turbopack ; ce
cache local a été conservé hors dépôt et un nouveau build a réussi. Les deux journaux
`ux-regressions-2026-10-19.log` et `ux-build-retry-2026-10-19.log` conservent cet échec et sa
reprise. Aucune base distante n'a été modifiée pour cette reprise.
Ces résultats locaux ne certifient pas le comportement de la session privée sur la nouvelle Preview.

## Confrontation V10 et décisions fondateur

- Sources : D-UX-03 corrigé dans le code et testé au niveau composant ; relecture finale
  dans l'espace authentifié encore attendue.
- Dette : formulaire adaptatif et options avancées accessibles, distinction entre déclaré
  et déduit, brouillon et synthèse avant enregistrement réellement parcourus.
- Aujourd'hui : D-UX-01/D-UX-02 corrigés dans le code ; ouverture par Entrée, fermeture
  par Échap et maintien du focus testés. Toucher et thèmes restent à certifier sur l'interface.
- Revue B19, aide contextuelle, sélection synchronisée, conflits, imports et validation :
  recette dans l'interface encore à effectuer, distincte des 19 étapes HTTP déjà prouvées.

## Captures conservées et limites

Les captures [initiales](preuves/visual-b19-2026-10-15/) proviennent du navigateur réel,
au format mesuré **1363 × 936**, sauf la capture du mauvais aiguillage qui mesure **1348 × 926**. Elles ne sont ni recadrées ni redimensionnées pour prétendre
à 1440 × 900. Les formats 1440 × 900, tablette 900 px, mobile 390 px et les gestes tactiles
restent non certifiés. L'API de navigateur disponible ne propose pas de redimensionnement
ou d'émulation tactile ; la recherche de capacités complémentaires n'en a pas fourni.

Au 19 octobre, les fichiers et captures sont conservés mais l'ancienne session navigateur
n'est plus disponible. L'alias de branche a été ouvert, l'accès Vercel renouvelé sans
désactiver sa protection. Le formulaire sécurisé de reconnexion a été interrompu ; la
navigation canonique suivante a montré l'écran de connexion, sans signal de session ouverte.
La capture `login-state-2026-10-19.jpg` (1363 × 936) conserve cet état. Aucune erreur de
mot de passe n'a été affichée ou déduite. Les imports ne sont donc toujours pas comptés
comme testés dans l'interface. Aucune injection de cookies ni contournement de connexion
n'a été utilisé comme preuve visuelle.

## Porte de sortie B19

| Priorité                    | Verdict actuel                                        | Condition restante                                                                 |
| --------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Onboarding et espace vierge | Parcours de l'espace réellement observé le 15 octobre | Inscription et confirmation déclarées manuelles ; reprise de connexion à certifier |
| Encours seul                | Vérifié dans l'interface                              | Relecture du même objet après reconnexion                                          |
| Dette 3B                    | Contrat, assurance, brouillon et avenant parcourus    | Relecture UI de l'annulation et des corrections publiées                           |
| CSV et XLSX                 | Fichiers réels préparés, essais HTTP réalisés         | Déposer les deux fichiers depuis le vrai tiroir                                    |
| Revue documentaire          | Non certifiée dans l'interface                        | Sélection, correction, historique, conflits et validation                          |
| Persistance et erreurs      | Rechargement du brouillon vérifié                     | Reconnexion et reprises du parcours documentaire                                   |
| Formats, toucher et thèmes  | Non certifiés aux dimensions demandées                | 1440 × 900, tablette 900 px, mobile 390 px, clavier et gestes réels                |
| Corrections et tests        | Régressions locales réussies                          | Recette finale hébergée sur le SHA publié                                          |

**B19 reste ouvert. B20 ne doit pas démarrer.**

## Reprise du 20 octobre — contrôle hébergé des correctifs UX

L'environnement est revenu. Les changements locaux ont été rapprochés octet pour octet de
l'arbre Git publié `ca88a08cdec000678e618e0b2147f35a02dc9b22` ; ce déploiement est READY.
L'alias de branche ouvre toujours l'écran de connexion : aucune session privée n'est présumée.

La démonstration hébergée en lecture seule a réellement été ouverte depuis son lien public.
Ces essais portent uniquement sur cette démonstration et ne valident pas les imports privés :

- Les six entrées Sources occupent une bande compacte, sans colonne réservée. Entrée déplie
  les dates et états détaillés. La répétition Échéancier / Échéancier a disparu.
- Patrimoine net, Liquidité immédiate, Solde libre du mois et Progression de l'objectif
  sont effectivement affichés ; aucune promesse de projection ne remplace la progression.
- L'aide Patrimoine net s'ouvre par Entrée et se ferme par Échap ; le focus reste sur son bouton.
- Un défaut visuel a été constaté : l'aide ouverte recouvre le montant du patrimoine et la
  liquidité. La correction CSS place désormais l'aide dans le flux, sans superposition.
  Son contrôle hébergé après publication reste nécessaire.
- Les captures `preuves/visual-b19-2026-10-20/demo-overview.jpg` et
  `demo-help-overlap-before.jpg` conservent le rendu initial et le défaut. Le viewport mesuré
  est 1363 × 936 ; la largeur du document est 1348 px, sans débordement horizontal observé.
  Le raccourci d'outils navigateur n'a pas modifié ce viewport. Aucun format 1440/900/390
  ni geste tactile n'est déclaré vérifié par ces captures.

La correction de placement passe les **15 tests ciblés** Aujourd'hui/Sources et le build.
Les journaux `ux-targeted-tests.log` et `ux-build.log` sont conservés avec ces preuves.
La suite complète de 2 595 tests du commit précédent reste une preuve distincte.

## Limites de périmètre

Uniquement le staging synthétique. Aucun changement de production, aucune migration,
aucune dépense et aucune fusion dans main. Staging laissé actif pour la suite des essais.
