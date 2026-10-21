# B19 — préparation de la fusion, reprise du 21 octobre 2026

**B19 ouvert. B20 non commencé. Aucune fusion dans main.**
Cette reprise continue la recette du même compte et de la même dette synthétique. Elle ne
recommence ni l'inscription, ni l'onboarding, ni les décisions documentaires déjà vérifiées.
Toutes les actions métier concernent le staging `bjxhnwvomoznorijauyl`. Aucune dépense et
aucune migration ou modification de configuration de production.

## Version à tester

- PR en brouillon : https://github.com/leojacques-code/Leo-Family-Office/pull/54
- SHA exact du code : `ae8ba7c69245c7e116e05958ca753ab5a89ff4bc`.
- Preview immuable : https://leo-family-office-8iwkvk3sp-lech1.vercel.app
- Alias authentifié conservé : https://leo-family-office-git-codex-astra-b19-hosted-integ-ce3b7b-lech1.vercel.app/
- Déploiement Preview : `dpl_8wzevV142z8oU4o4uGrUmQwui4Su`, READY, cible non-production.

Le commit documentaire suivant ajoute les preuves ; il ne change pas le code servi.
Les trois corrections fonctionnelles ont d'abord été relues sur le code
`eca591474e63cd60e49c40909f9a89990cc03d76`, puis un dernier correctif CSS ajoute les
dimensions des zones de clic des formulaires. Le thème est ensuite rendu persistant.
Aucun changement de dépendance.

## Corrections de cette reprise

| Réserve précédente | Résultat |
| --- | --- |
| R2 — alertes de calendrier | Le lecteur nomme désormais les rangs d'**échéances**, distincts des lignes du fichier. Les alertes anciennes sont présentées avec le même vocabulaire, sans réécrire le document ou ses décisions. Les autres messages de localisation restent inchangés. |
| R3 — formulaires trop petits | Les éditeurs partagés (tiroir et fenêtre modale) passent les libellés, aides et boutons à 12 px au minimum, les champs à 14 px. Mesure initiale du tiroir : libellés 9 px, aides 7,5 px, champs 11 px. |
| R4 — Sources incohérentes entre Dette et Aujourd'hui | Les deux pages consomment la même preuve documentaire, lue de façon ciblée et paginée sous le propriétaire. Une pièce d'une dette visible donne « Document présent » sans devenir un échéancier appliqué. Une lecture refusée, échouée, sans pièce ou d'une autre dette ne le prouve pas. Les faits canoniques restent prioritaires. |
| Date des Sources | Un instant de lecture documentaire est présenté au jour de Paris, sans exposer un horodatage technique et sans confondre la dernière échéance du prêt avec la date de lecture. |
| R5 — historique de migration | La dernière migration avait été créée localement sous `20261021153408`, puis inscrite par le connecteur sous `20261021153711`. Le fichier est renommé vers la version réellement appliquée. Son blob SQL reste `43642ed9ac8a66bc769591e193cc11c67c54c053` ; aucune réécriture de l'historique distant. Les 66 noms et versions concordent exactement. |
| R6 — thème perdu au rechargement | Le contrôle réel a montré le retour au clair après rechargement. La préférence minimale `light`/`dark` est désormais conservée sous une clé versionnée locale, restaurée avant l'affichage et synchronisée entre onglets. Le stockage indisponible ne bloque pas le changement courant. |

La frontière financière est conservée : les pièces alimentent la provenance, pas les montants.
Le test d'Aujourd'hui compare explicitement patrimoine net, liquidité, flux et événements avant
et après ajout d'une preuve documentaire : ces valeurs ne changent pas.

Le bouton de déclaration de devise mesurait encore 17 px de haut après la première correction
typographique ; les actions des deux éditeurs ont donc une zone minimale de 40 × 40 px sur
desktop. La règle pour un pointeur tactile prévoit 44 × 44 px, conformément à V10. Sa présence
dans le CSS ne vaut pas une validation sur appareil tactile.

## Vérification automatisée

| Contrôle | Résultat et preuve |
| --- | --- |
| Suite complète finale | **2 630 tests / 188 fichiers réussis**, 32,04 s ; `tests-complets-theme-bootstrap.log`. La première passe complète de cette reprise portait 2 624 tests. |
| Lint final | Réussi ; `lint-theme-bootstrap.log`. |
| Build final | Réussi ; `build-theme-bootstrap.log`. |
| État métier final | Lecture SQL seule : encours 2 000 €, contrat conservé, 3 lectures VALIDATED, 2 REJECTED, 0 ligne canonique de l'échéancier ; `etat-staging-final.json`. |
| Historique staging | Comparaison exacte des 66 versions/noms locaux avec `migrations-staging.json`. |
| Simulation de fusion | `main` ancêtre, aucun conflit ; `verification-fusion.json`. |
| Marqueurs de conflit | Réussi : 821 fichiers balayés, 114 ignorés. |
| Espaces du diff | Vérifiés hors journaux bruts : les sorties Next/Vitest conservent leurs retours chariot et lignes terminales. |

Les échecs intermédiaires sont conservés : fixture mock d'Aujourd'hui complétée après l'ajout
de la lecture documentaire, type de code d'alerte corrigé, attente de date mise au format
calendaire. Le dernier build a d'abord rencontré un cache Turbopack illisible (« invalid digit
found in string ») ; le cache généré a été déplacé, puis le build sur cache neuf a réussi.
La suite complète n'a pas été répétée pour le seul ajustement des dimensions CSS ; elle a
ensuite été relancée après l'ajout de la persistance du thème. Le premier lancement des tests
de thème utilisait par erreur l'environnement Node : l'annotation jsdom manquante a été
ajoutée, puis les tests ciblés et la suite complète ont réussi.

La relecture selon `vercel:react-best-practices` a conduit à une préférence locale minimale
et versionnée, à la restauration avant peinture et à un abonnement stable avec nettoyage.
Le snapshot serveur reste déterministe ; aucune donnée personnelle ou financière n'entre
dans le stockage de thème. Cette relecture faite par l'auteur n'est pas une revue indépendante.

## Relecture hébergée

- Le tiroir réel affiche les libellés/aides/boutons à 12 px et les champs à 14 px.
- Après le correctif CSS final, les boutons du tiroir et de la fenêtre « Nouvel encours »
  mesurent 40 px de haut au minimum ; la fermeture mesure 40 × 40 px. Les mesures DOM sont
  conservées dans les deux fichiers `mesures-*-final.json`.
- La date future est à nouveau bloquée dans la fenêtre agrandie ; encours et date restent
  dans le formulaire. La fenêtre est annulée. Tab atteint le contrôle de fichier du tiroir,
  Échap ferme le tiroir et restitue le focus au bouton d'import.
- La copie XLSX contenant du VBA est de nouveau refusée par le serveur dans ce formulaire.
- La lecture de dates déjà refusée indique « échéances 2 et 3 » et « échéances 4 et 5 » ;
  la grille conserve les lignes 2 à 6 du fichier. Aucun historique n'a été réécrit.
- Sur Aujourd'hui, Échéancier indique « Document présent », daté « Au 21 oct. 2026 » dans
  le détail des Sources. Dette donne le même statut. Patrimoine net −2 000 €, liquidité et
  solde libre restent à compléter : la pièce n'est pas transformée en fait bancaire.
- Sur le SHA final, le thème sombre choisi reste actif après rechargement : attribut DOM
  `data-theme=dark`, fond `rgb(13, 21, 19)` et capture réelle. La synchronisation entre onglets
  et le stockage indisponible sont testés automatiquement ; ils ne sont pas revendiqués comme
  deux nouveaux essais manuels. Le thème clair est ensuite restauré pour la remise.
- La session personnelle survit à la reprise et aux rechargements, sans nouvelle connexion.
  Des délais techniques de lecture AX sont survenus après rechargement ; la capture directe
  puis la lecture DOM ont permis de vérifier le résultat. Aucun contournement d'accès.

### Captures supplémentaires

Toutes les images ci-dessous sont les JPEG bruts de **1348 × 926** issus de la fenêtre
1363 × 936. Le manifeste conserve dimensions, SHA-256 et version observée.

| Capture dans `preuves/visual-b19-2026-10-21/preparation-fusion/` | Preuve |
| --- | --- |
| [aujourdhui-sources-detail-final.jpg](preuves/visual-b19-2026-10-21/preparation-fusion/aujourdhui-sources-detail-final.jpg) | Sources détaillées sur le SHA final, liquidité inconnue conservée. |
| [theme-sombre-persistant-apres-rechargement.jpg](preuves/visual-b19-2026-10-21/preparation-fusion/theme-sombre-persistant-apres-rechargement.jpg) | Thème sombre réellement conservé après rechargement sur le SHA final. |
| [formulaire-import-sombre-cibles-v10.jpg](preuves/visual-b19-2026-10-21/preparation-fusion/formulaire-import-sombre-cibles-v10.jpg) | Lisibilité en thème sombre et zones de clic agrandies. |
| [observation-future-clavier-final.jpg](preuves/visual-b19-2026-10-21/preparation-fusion/observation-future-clavier-final.jpg) | Date future refusée dans la fenêtre agrandie ; saisie conservée. |
| [import-lisible-macros-refusees.jpg](preuves/visual-b19-2026-10-21/preparation-fusion/import-lisible-macros-refusees.jpg) | Véritable contenu VBA refusé dans le tiroir lisible. |
| [calendrier-echeances-distinctes.jpg](preuves/visual-b19-2026-10-21/preparation-fusion/calendrier-echeances-distinctes.jpg) | Alertes en rangs d'échéances et lignes de fichier distinctes. |
| [observation-future-refusee.jpg](preuves/visual-b19-2026-10-21/preparation-fusion/observation-future-refusee.jpg) | Première passe avec bulle native de refus visible. |

Ces contrôles complètent les scénarios réels et les captures du
`RECETTE_VISUELLE_B19_2026-10-21.md`, qui restent la preuve des imports et décisions antérieurs.

## Essais réels ajoutés

### Observation future

Dans « Nouvel encours », la navigation au clavier sur le contrôle natif passe du 21 octobre
au 21 novembre 2026. La limite déclarée vaut le 21 octobre. La soumission réelle est bloquée
par la validation native (`rangeOverflow=true`), et l'encours saisi de 2 000 € est conservé.
La bulle de validation du navigateur est capturée. Il s'agit du refus de formulaire, pas d'une
nouvelle preuve de refus serveur. La fenêtre est ensuite annulée.

### Véritables macros

Fixture publique de XlsxWriter, révision figée
`5d4606d89a955226d2d0825a0f44309043ae7251`, fichier
`xlsxwriter/test/comparison/xlsx_files/macro01.xlsm` : 11 463 octets. L'archive contient
`xl/vbaProject.bin` (13 312 octets décompressés, en-tête de conteneur OLE) et un type de
classeur `macroEnabled`. La licence BSD et la provenance sont conservées avec la fixture.

Deux dépôts par le sélecteur réel :

1. Extension XLSM d'origine : refus explicite des formats autres que CSV/XLSX.
2. Copie **strictement identique en octets** nommée XLSX : le contrôle du contenu refuse
   « Classeur porteur de macros : il est refusé, pas lu partiellement. » La devise EUR a été
   explicitement déclarée pour ne pas confondre les motifs de refus.

Aucune macro n'a été exécutée. Le second essai prouve la détection du contenu, au-delà de
l'extension. La pièce n'est pas utilisée pour produire de faits financiers.

## Préparation technique de la fusion

`main` observée : `bd1782cae6b5f7141c3cc2765bd30c6a11a325fe` (PR #49).
Elle est un ancêtre de la branche B19. La simulation `git merge-tree --write-tree` ne signale
aucun conflit et ne modifie ni la branche de travail ni main. Le clone était superficiel ;
l'historique a été complété avant de conclure sur l'ascendance.

La différence contient l'ensemble du cockpit V10, du parcours personnel et de Dette 3B/B19,
pas uniquement les correctifs de cette reprise. Le périmètre de la PR doit le refléter.
Le dépôt sur main porte 45 migrations, la branche 66. Cela ne constitue pas une observation
de l'état actuel de la base de production. La stratégie de compatibilité et de déploiement
doit être arrêtée avant une fusion qui déclencherait la production ; aucun SQL de production
n'est exécuté dans cette recette.

## Gates et limites

Les journaux se trouvent dans `preuves/visual-b19-2026-10-21/preparation-fusion/`.

Le démarrage du gate SQL local a été tenté. PostgreSQL est absent ; le bootstrap échoue sur
`sudo`, puis l'installation directe et la mise à jour des paquets échouent sur `setgroups` /
`seteuid` interdits par l'environnement. Aucun contournement de ces protections n'a été tenté.
**Le gate SQL complet depuis zéro reste non vérifié ici.** Les tests SQL transactionnels
déjà exécutés en staging ne sont pas présentés comme un substitut à ce gate.

Le navigateur disponible conserve une fenêtre de 1363 × 936 et n'expose aucune capacité de
redimensionnement ou d'émulation tactile. Les vrais 1440 × 900, tablette 900 px, mobile 390 px
et les gestes tactiles restent non vérifiés. Les captures ne sont pas redimensionnées pour
simuler ces formats. Une relecture indépendante de l'ensemble de la PR reste à obtenir.
La revue transversale des aides et formulaires hors des écrans déjà parcourus reste ouverte ;
les vérifications Dette/Aujourd'hui ne constituent pas une certification de toutes les pages.

**La PR doit rester en brouillon tant que les contrôles ouverts n'ont pas leur preuve.**
La Preview sert déjà à tester la nouvelle version. B20 attend la clôture réelle de B19,
conformément au programme.
