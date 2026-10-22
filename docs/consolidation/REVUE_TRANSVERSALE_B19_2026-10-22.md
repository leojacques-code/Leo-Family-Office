# B19 — reprise et revue transversale du 22 octobre 2026

> **Suite du 22 octobre :** accès Vercel rétabli, nouveaux défauts corrigés et vrais écrans
> relus. La [recette après authentification](RECETTE_REPRISE_B19_2026-10-22.md) porte le point
> courant, code `8d7ce426173d2be94d5c925da512ee2da84bb49c`, 2 646 tests. Le blocage d’origine
> décrit plus bas est historique ; B19 reste ouvert pour les critères encore non prouvés.

**B19 ouvert ; B20 non commencé ; PR #54 en brouillon.** Cette reprise prolonge les preuves
du 21 octobre sans recréer le compte, les dettes ou les lectures documentaires.
Elle concerne le staging `bjxhnwvomoznorijauyl`. Aucune dépense, migration distante,
modification de configuration de production ou fusion dans main.

## Résultat de la revue du code

Les décisions D-UX-01 à D-UX-05 et D-UX-08 à D-UX-11 ont été confrontées aux composants
partagés et aux pages du dépôt, avec V10 fourni. Ce relevé est une **revue statique** et des
tests de composants ; il ne certifie pas de nouveaux écrans dans le navigateur hébergé.
Les captures et parcours réellement vérifiés restent dans les rapports du 21 octobre.

### Corrections du clavier

La réouverture de l'effet de focus à chaque changement d'identité de `onClose` déplaçait
le focus vers « Fermer » pendant une saisie contrôlée. Le scénario de test « 2000 » ne
conservait que le premier caractère. La référence de fermeture est désormais actualisée
sans redémarrer le cycle de focus. Échap utilise la dernière fonction reçue et rend le focus
au véritable déclencheur.

Le cycle comptait aussi les champs d'un `<details>` fermé et les contrôles natifs avec un
`tabindex` négatif. Maj+Tab pouvait donc sélectionner un champ replié ou une action retirée
de la tabulation. Les sections repliées sont maintenant parcourues par leur premier résumé,
leurs champs entrant dans le cycle à l'ouverture. Les valeurs négatives explicites sont
exclues, y compris sur les boutons et champs natifs.

Le même filtre est utilisé par les fenêtres `Modal` et les tiroirs `FinancialDrawer`.
L'ouverture d'une fenêtre garde son comportement existant : premier champ ; le tiroir commence
sur sa fermeture. Aucun champ financier, calcul, défaut de saisie ou contrat RPC n'a changé.

Cinq tests nouveaux échouaient sur l'ancien code : quatre pour le tiroir et un pour la
fenêtre modale. Ils passent après correction, avec les tests des éditeurs Patrimoine et Flux.
Les journaux avant/après sont conservés dans `preuves/reprise-b19-2026-10-22/`.

### Cible des aides

Le bouton partagé `MetricHelp` garde son « ? » visible de petite taille. Une surface
transparente étend sa cible à au moins 40 px, puis 44 px pour un pointeur tactile, sans
agrandir le titre ni déplacer le chiffre. Il s'agit de la surface du pseudo-élément, pas
d'une nouvelle mesure de la boîte DOM du bouton. Le clic aux bords de cette cible et les
gestes sur appareil tactile restent à vérifier dans le navigateur autorisé.

## Matrice de confrontation aux décisions fondateur

| Surface examinée | Constat dans le dépôt | Suite et limite |
| --- | --- | --- |
| Aujourd'hui | Noms financiers courts, `MetricHelp`, distinction inconnu/zéro, Sources documentaires datées. | Preuves réelles du 21 conservées ; nouvelle cible d'aide à relire. |
| Patrimoine | Canevas de bilan et modèle `buildNetWorthView`, sans nouveau calcul dans le composant ; éditeur par tiroir. | Tests de l'éditeur inclus dans la régression de focus ; pas de nouvelle recette hébergée. |
| Dette et revue de pièce | Contrat progressif, options avancées repliables, brouillons, assurance séparée ; pièce et candidats synchronisés, historique distinct des faits canoniques. | Correctifs de focus et aides concernent ce parcours ; reprendre le contrôle réel après restauration de l'accès. |
| Flux | Observations et corrections par tiroirs ; états inconnus conservés ; termes avant/après service de dette distincts. | Deux familles de tiroirs couvertes par les tests ; composition complète affectée à sa phase métier. |
| Placements | Analyse et éditeurs encore portés par la page métier historique, avec explications via l'Inspecteur. | Refonte du canevas et de la profondeur à la demande à sa phase ; pas de réécriture dans B19. |
| Immobilier | Éditeurs en fenêtres modales ; vues patrimoniales et simulations séparées. | Filtre de focus commun corrigé ; densité, titres techniques et aides à revoir à la phase métier. |
| Entreprises | Infrastructure de lecture documentaire et historique communs ; éditeurs métier conservés. | B19 ne refond pas Business Equity. La révision attendue est nécessaire aussi pour les corrections de liasse. |
| Carrière | États sans faits et métriques annualisées ; chaînes historiques de vocabulaire technique encore présentes. | Revue des intitulés et du canevas à la phase propriétaire, sans renommer un calcul en une autre métrique. |
| Fiscalité | Dette fiscale, décaissements et absence de règle sourcée restent des notions distinctes dans le calcul. Des codes et anglicismes existent dans la page. | Localisation et aide à traiter à sa phase ; aucune règle fiscale ou convention inventée dans B19. |
| Objectifs | Page et formulaire historiques ; la profondeur demandée dépasse une retouche de titre. | D-UX-06 : phase 9, B43/B44. Ne pas présenter cette refonte comme livrée. |
| Décisions | Comparaisons versionnées, mais vocabulaire et présentation historiques. | D-UX-07 : B45. Géométrie A/axe/B et sensibilités restent à cette phase. |
| Scénarios | Hypothèses et résultats séparés ; formulaire métier conservé. | Réorganisation du canevas et localisation à sa phase ; une simulation ne devient pas un fait. |
| Sources et Documents | Coffre et acquisitions distincts ; B19 conserve le fichier et ses candidats depuis la dette. | Boîte unifiée et profondeur documentaire générale : B46. Ne pas généraliser la certification Dette à tous les imports. |
| Rapports, contexte et réglages | Shell et manifestes communs ; pages métier et réglages conservent leur périmètre propre. | Contrôle réel des aides, erreurs et reprise de navigation encore nécessaire. |

Des chaînes trouvées dans un ancien composant ne constituent pas une observation de son
affichage actuel : le shell et les états conditionnels peuvent en changer la visibilité.
Les quatorze manifestes définissent déjà leurs titres français et questions de domaine.
Les intitulés de métriques restent confrontés au registre KPI avant toute modification.

Les corrections de faible risque des composants partagés sont livrées dans cette reprise.
Les refontes structurelles restent affectées à leurs phases, conformément au registre
fondateur ; cette affectation n'efface aucun écart ni ne prétend livrer les phases suivantes.

## Blocage hébergé constaté

L'ouverture de l'alias Preview autorisé a déclenché un contrôle d'accès vers `vercel.com`.
Le contrôle automatique d'autorisation a refusé l'observation de cette origine : risque
d'exposer le compte ou le tableau de bord privé en dehors de la recette staging.
Le projet confirme une protection SSO active ; le déploiement précédemment testé reste READY.

Aucun secret d'accès, lien de partage authentifié ou autre chemin n'a été utilisé pour
contourner ce refus. Aucune nouvelle connexion, capture ou recette visuelle n'est déclarée
réussie le 22 octobre. L'autorisation d'ouvrir Vercel pour accéder à cette Preview doit être
clarifiée avant de reprendre cette partie. Le refus est consigné dans la preuve dédiée.

## Contrôles et remise

Code publié : `6164219b962eb5730a987c9e5072e50509c7d1b6` sur la branche
`codex/astra-b19-hosted-integration-20261015`, dans la [PR #54](https://github.com/leojacques-code/Leo-Family-Office/pull/54).

Preview correspondante : https://leo-family-office-9i7dri2z0-lech1.vercel.app ; déploiement
`dpl_7Z34wXh67tBGYz1fdTafhKcSR2ZE`, READY, cible non-production. L'alias de branche conservé
est https://leo-family-office-git-codex-astra-b19-hosted-integ-ce3b7b-lech1.vercel.app/.
Ce résultat est vérifié par le connecteur de déploiement ; l'accès visuel reste bloqué par
le refus d'autorisation expliqué ci-dessus. Le commit de preuves suivant ne change pas le code.

| Contrôle | Résultat et journal dans `preuves/reprise-b19-2026-10-22/` |
| --- | --- |
| Régressions avant correctif | 4 échecs tiroir et 1 échec modale ; `focus-avant-correction-complet.log`, `modale-avant-correction.log`. |
| Cible après correction | 37 tests / 5 fichiers réussis ; `focus-final.log`. |
| Suite complète | **2 635 tests / 188 fichiers réussis**, 54,01 s ; `tests-complets.log`. |
| Lint | Réussi ; `lint.log`. |
| Build final | Réussi, compilation/TypeScript/pages ; `build-final.log`. |
| Format du code modifié | Prettier réussi sur les cinq fichiers. |
| Diff du code | `git diff --check` réussi. Les journaux bruts conservent leurs espaces et fins de sortie. |

Le second build a rencontré le même cache Turbopack illisible que la veille. Son journal
`build-cibles-aide.log` est conservé ; le cache généré a été déplacé, puis le build final sur
cache neuf a réussi. La suite complète a été exécutée après les modifications TypeScript ;
seule l'extension CSS de cible d'aide a suivi, avec format et build vérifiés ensuite.

Les lectures SQL du staging confirment
66 migrations, dernière version `20261021153711`, encours synthétique de 2 000 €, trois
lectures validées, deux refusées et zéro ligne canonique d'échéancier pour cette dette.

Le gate local depuis zéro reste bloqué par l'absence de PostgreSQL et les refus de
provisionnement déjà documentés ; ils ne sont pas contournés. Les vrais formats 1440×900,
900 px et 390 px, les gestes tactiles et la relecture indépendante restent ouverts.
La revue par l'auteur et les tests de composants ne remplacent pas ces preuves.

Le [plan de déploiement](PLAN_DEPLOIEMENT_B19_2026-10-22.md) est préparé pour revue, sans
exécution en production. B19 reste ouvert et B20 attend sa clôture.
