# B19 — recette réelle du 21 octobre 2026

**B19 ouvert. B20 non commencé.** Un défaut de traçabilité reste à corriger ; les formats
demandés et le toucher restent à certifier.
Toutes les manipulations concernent le staging et des montants synthétiques. Aucune dépense,
migration, action de production ou fusion dans main.

## Session et référence

La connexion manuelle du propriétaire a réellement ouvert son espace dans le navigateur de
recette. Le même compte, son encours, son contrat, son assurance et son événement annulé du
15 octobre sont retrouvés. Aucun nouveau compte ni nouvelle dette n'a été créé pour reprendre.

Alias utilisé, conservant la session entre les déploiements :
https://leo-family-office-git-codex-astra-b19-hosted-integ-ce3b7b-lech1.vercel.app/debt.
Le parcours initial a été exécuté sur `0b80663f171e35bd9bfd0b3aae1b9b9c93ab228d`, Preview
https://leo-family-office-29ktzapkm-lech1.vercel.app, READY avant les essais.
Branche : `codex/astra-b19-hosted-integration-20261015`.

Dernier code publié et testé : **`c62e039245866a6c9d86b91183bf78746f138c1f`**.
Preview READY : https://leo-family-office-ag8xq6w6c-lech1.vercel.app.
Déploiement : `dpl_5SfSXbaVUtjZpcZBLd1SSTZSyuvR`, cible Preview, aucune promotion production.
Le lot de preuves publié ensuite ne modifie pas le code applicatif.

## Résultats réellement observés

| Scénario | Résultat |
| --- | --- |
| Compte vierge et onboarding | État vierge réellement observé le 15 octobre : aucun actif ni passif, aucune dette. Contexte EUR/France relu. Inscription et e-mail effectués manuellement par le propriétaire ; aucune nouvelle inscription rejouée. |
| Reconnexion et reprise | Connexion manuelle réussie le 21 octobre ; le même objet de dette et ses décisions du 15 sont présents. La session survit aux navigations, au second onglet et aux rechargements. |
| Dette 3B | Encours 2 000 €, taux explicitement 0 %, mensualité 1 000 €, première échéance 5 novembre. Deux échéances et maturité 5 décembre affichées comme déduites. Assurance séparée 5 € × 2. Brouillon incomplet enregistré/repris puis consommé lors de la promotion le 15. |
| Événement annulé | L'avenant à 1 % et son motif d'annulation sont lisibles dans l'historique. Le taux courant reste 0 %, l'encours reste 2 000 €. |
| Import CSV | Véritable fichier de 134 octets envoyé par le sélecteur de fichiers du tiroir réel. Devise EUR déclarée par une action explicite. Deux échéances reconnues. |
| Import XLSX | Véritable classeur OOXML de 5 009 octets envoyé de la même façon. Feuille « Échéancier synthétique », deux échéances, devise EUR déclarée. |
| Sélection bidirectionnelle | Clic source D2 puis flèche droite : E2 sélectionnée dans la pièce et les candidats. Clic candidat C3 : C3 sélectionnée dans la pièce. Valeur imprimée, retenue, unité/devise, localisation et version visibles. |
| Saisie invalide | Une correction vide est refusée par le champ obligatoire sans décision enregistrée. La saisie française « 1 000,00 » est correctement retenue à 1 000 €. |
| Correction et refus serveur | Capital C3 volontairement corrigé de 1 000 à 999. Deux contrôles échouent ; la validation finale est réellement refusée par le serveur. Valeur, motif et historique restent présents après le refus. |
| Historique immuable | Retour à 1 000 avec un second motif : les deux décisions 1 000 → 999 → 1 000 sont visibles ; la valeur imprimée n'a pas changé. Zéro contrôle en échec après rétablissement. |
| Conflit réel de révision | Deux onglets lisent le même XLSX à la révision 0. Le premier corrige les intérêts D2 de 0 à 1 ; le second tente une confirmation avec la révision 0. Refus « révision 0 attendue, 1 courante », puis revue rechargée avec 1 € et la décision déjà enregistrée. Aucun écrasement. Retour motivé à 0 €, historique conservé. |
| Validation documentaire | CSV et XLSX passent chacun à « Lecture validée » après synthèse 2 000 € de capital, 0 € d'intérêts, 10 € d'assurance, 0 € de frais, total 2 010 €. L'interface annonce explicitement l'attente du rattachement. |
| Persistance | Rechargement complet de Dette : les deux lectures sont encore validées. Assurance, taux, encours et annulation persistent. |
| Redépôt identique | Le même XLSX validé est redéposé dans le tiroir réel. Refus explicite : « Ce fichier a déjà été lu et validé pour cette dette : il n'est pas relu en silence ». |
| Pièces d'origine | Téléchargement des deux pièces depuis les boutons de l'interface. Le SHA-256 de chaque téléchargement correspond exactement à sa fixture. |
| Extrait partiel XLSX réel | Une seule échéance du 5 décembre, ouverture 1 000 € contre un capital contractuel de 2 000 €. L'interface annonce « Extrait partiel ». Synthèse bornée à l'extrait : capital 1 000 €, assurance 5 €, total 1 005 €, sans prétendre au coût du prêt. Lecture validée sans rattachement. |
| Dates contradictoires XLSX réelles | Cinq échéances avec un doublon au 5 décembre et un trou en février. Les deux alertes sont visibles. La validation finale est réellement soumise et refusée par le serveur pour doublon. Lecture ensuite refusée avec un motif explicite de fin du test. |
| Formules XLSX réelles | H2 et H3 contiennent une formule SUM et sa valeur en cache 1 005. La sélection H2 montre explicitement « la valeur en cache qui est lue, la formule n'est pas évaluée ». Lecture ensuite refusée avec motif de fin du test ; pièce conservée. |
| Écartement et reprise | D2 du XLSX complet écartée avec motif : « Aucune — case écartée » dans l'inspecteur, valeur imprimée 0 conservée, un contrôle non calculable. Confirmation de la lecture imprimée : valeur retenue 0 €, zéro contrôle en échec ou non calculable, puis validation documentaire réussie. Les quatre décisions sont conservées, mais la dernière transition affichée est fausse : voir R1. |
| Persistance finale des cinq lectures | Après rechargement, trois lectures validées (CSV, XLSX complet, XLSX partiel), deux refusées (dates et formules). Aucun nouveau compte ni nouvelle dette. Le délai technique du premier appel de rechargement n'a pas perdu l'état : l'observation suivante montre les cinq lectures. |
| Aides, clavier, thèmes | Aide Patrimoine net ouverte par Entrée, fermée par Échap. Le montant reste visible sous l'aide. Thèmes clair et sombre réellement affichés. Navigation fléchée et sélection synchronisée testées dans la grille. |

Les fichiers sont dans `preuves/integration-b19-2026-10-15/fixtures/`.

| Pièce | SHA-256 original = téléchargé |
| --- | --- |
| CSV | `954743e4f9b34a5b4d186150d2ea4811ecf3b2d48940c002bc0da300c748a10f` |
| XLSX | `3ec4930ac3db481128de285e2f3221e6a568da1b433b3d2451ca386481674fd1` |

Lecture SQL complémentaire du seul staging après les validations finales :
`loan_schedules` de cette dette = **0 ligne**, `current_balance` = **2 000,000000** ;
CSV `53d2d98f-f4be-40c1-a8d2-b479a7677b91` et XLSX
`0cead24b-2922-4148-9782-29dfea7b059a` = **VALIDATED**. L'extrait partiel
`0f5bb898-4217-4410-b506-6f3a71705c52` est **VALIDATED** ; dates
`f1bbd914-83ac-4fb4-bd29-3943458536f3` et formules
`806b9173-4cf0-4ba8-b52c-8345ed59577d` sont **REJECTED**.
Résultat brut structuré conservé dans `preuves/visual-b19-2026-10-21/etat-staging-final.json`.
Cette vérification technique
confirme l'absence d'effet canonique ; elle ne remplace aucun des essais UI ci-dessus.

## Défauts constatés et corrections

1. Une lecture sans anomalie ouvrait le filtre « À examiner (0) » et cachait tous les candidats.
   La revue ouvre désormais toutes les lignes dans ce cas. Une sélection hors du filtre
   révèle aussi sa ligne de l'autre côté.
2. La sélection faisait défiler toute la page, faisant disparaître la pièce. Le défilement
   reste désormais dans les panneaux ; le focus clavier utilise `preventScroll`. Sur
   ordinateur, le poste de revue est borné à la hauteur disponible avec deux panneaux défilants.
3. Le refus de validation affirmait à tort une entrée dans le patrimoine. Le message UI
   décrit le désaccord avec la pièce ; le garde SQL et ses données restent inchangés.
4. Les contrôles utilisaient « Ligne 2 » pour la deuxième échéance située en ligne 3 du
   fichier. Ils nomment désormais l'**échéance**, distincte de la localisation source.
5. Sources Dette annonçait « À fournir » malgré deux pièces déposées. Une lecture liée
   explicitement à une dette visible prouve maintenant **Document présent**, sans prétendre
   qu'elle est rattachée au prêt. Une lecture refusée ou d'une autre dette ne le prouve pas.
6. Aujourd'hui affichait 0 € de liquidité sans compte bancaire ni déclaration d'absence.
   La frontière de lecture rend désormais cette valeur inconnue. Une observation réelle à
   zéro ou une déclaration explicite d'absence de banque conserve son sens propre.
7. Écarter une case gardait sa valeur imprimée sous « Valeur retenue » dans l'inspecteur.
   Celui-ci affiche désormais « Aucune — case écartée ». Le candidat reste écarté et la
   pièce conserve sa valeur imprimée. Cette correction a été relue sur la Preview.
8. Un nouveau fichier XLSX valide exporté avec des balises OOXML `x:sheet` et `x:c` était
   refusé à tort : « Le classeur ne déclare aucune feuille ». Le lecteur reconnaît maintenant
   les préfixes déclarés pour SpreadsheetML et les relations OOXML. Les attributs, les liens
   externes et les préfixes étrangers ne sont pas réinterprétés. Trois vrais classeurs sont
   conservés comme régressions, avec un test de refus d'un espace XML étranger.

Les corrections ne créent aucune formule financière dans les composants et ne changent pas
le schéma. Le premier lot est publié dans `902f7e587dff7140fc680f3fd800c392e88be957`,
Preview READY https://leo-family-office-ffi04oxua-lech1.vercel.app. La relecture y confirme
« Document présent » et la valeur absente d'une case écartée. Elle a aussi fait ajuster le
défilement : l'inspecteur et les candidats doivent défiler dans leurs propres surfaces, pour
que révéler un candidat ne fasse plus disparaître le haut de l'inspecteur.

Le second lot `c62e039245866a6c9d86b91183bf78746f138c1f` publie ce réglage et la lecture
des préfixes OOXML. Le même fichier partiel initialement refusé est alors réellement importé.
À la sélection H2, le défilement de page reste à **331 px avant et après** ; pièce et inspecteur
ont tous deux un bord supérieur à **434,625 px**, et le bas du panneau droit reste à
**833,625 px** dans la fenêtre de hauteur 936 px. L'inspecteur reste visible pendant la sélection.
Ces mesures concernent cette fenêtre uniquement.

## Confrontation à V10 et aux décisions fondateur

- D-UX-01 : noms financiers réellement visibles : Patrimoine net, Liquidité immédiate,
  Solde libre du mois, Progression de l'objectif. Les questions restent dans l'aide ; une
  progression actuelle n'est pas appelée projection. Un seul h1 de domaine.
- D-UX-02 : l'aide répond au clavier, reste près du titre et ne masque plus le chiffre.
  Le toucher n'est pas certifié ; les aides d'autres pages restent une revue transversale.
- D-UX-03 : Sources occupe une bande repliable avec états et accès aux détails. La pièce
  reste centrale pendant la revue documentaire. Le statut documentaire est distingué des
  données canoniques appliquées.
- D-UX-04 : observation seule, contrat adaptatif, assurance séparée et brouillon ont été
  parcourus. Le tiroir d'import repart vide, sans devise implicite ; la synthèse de validation
  précise son effet. La petite typographie de certains textes du tiroir reste un défaut visuel.
- D-UX-11 : chemin complet Dette → fichier réel → pièce/candidats → correction → contrôle
  bloquant → historique → conflit réel → validation → retour Dette et pièce d'origine.
- V10 : la revue côte à côte est testée à la taille disponible. La conformité de la
  composition à 1440 × 900 et les variantes 900/390 ne peuvent pas être déduites de cette taille.

## Vérifications et captures

| Vérification du code c62e039 | Résultat | Journal |
| --- | --- | --- |
| Suite complète `npm test -- --maxWorkers=4 --testTimeout=60000` | **2 607 tests / 187 fichiers réussis**, 182,39 s | `tests-livraison.log` |
| `npm run lint` | Réussi | `lint-final.log` |
| `npm run build` | Réussi, compilation, TypeScript et génération des pages | `build-livraison.log` |
| Régressions de lecture et trois vrais XLSX | 54 tests / 2 fichiers réussis | `xlsx-fixtures-reprise.log` |

Les premiers essais complets ne sont pas déclarés verts : deux exécutions interrompues
sur délais, une exécution à 2 601/2 602 avec délai Monte-Carlo (reprise isolée 6/6 réussie),
puis une exécution à 2 606/2 607 avec une assertion de fixture à corriger. Cette assertion
cherchait le signal de formule au niveau de la lecture au lieu de la case. La suite finale
ci-dessus passe intégralement. Leurs journaux sont conservés.

Deux reprises de build ont rencontré des caches `.next` invalides (`ENOTEMPTY`, persistance
Turbopack) ; une autre a détecté le type readonly d'une assertion, corrigé avant le build
final. Les caches ont été déplacés hors du dépôt ; le build final repart avec un cache propre.
Le `tsc` manuel interrompu ne constitue pas un contrôle réussi supplémentaire.

Captures authentiques dans `preuves/visual-b19-2026-10-21/` : état de connexion initial,
défilement fautif avant correction, validation CSV refusée, conflit de révision XLSX,
deux lectures validées après rechargement, aide sans recouvrement, thème sombre et doublon refusé.
Les captures pleine page sont signalées par leur contenu et leurs dimensions ; aucune n'est
redimensionnée pour simuler un format demandé.

| Capture | Dimensions | Ce qu'elle prouve |
| --- | --- | --- |
| `cinq-lectures-etats-persistants.jpg` | 1348 × 926 | Trois lectures validées et deux refusées après rechargement |
| `xlsx-partiel-selection-sans-saut.jpg` | 1348 × 926 | Pièce et inspecteur visibles, sélection H2 synchronisée |
| `xlsx-selection-clavier-finale.jpg` | 1348 × 926 | Après rétablissement et validation, flèche droite D2 → E2 sélectionne source et candidat assurance |
| `xlsx-partiel-synthese-bornee.jpg` | 1348 × 926 | Synthèse d'extrait, sans coût complet du prêt |
| `xlsx-dates-doublon-trou.jpg` | 1348 × 926 | Doublon et trou de calendrier signalés |
| `xlsx-dates-validation-refusee.jpg` | 1348 × 926 | Refus réel du serveur après soumission finale |
| `xlsx-formule-cache-signalee.jpg` | 1348 × 926 | Formule signalée et valeur en cache non recalculée |
| `historique-confirmation-defaut-residuel.jpg` | 1348 × 926 | Confirmation affichée « 0 € → aucune » malgré valeur retenue 0 € |
| `csv-validation-refusee.jpg` | 1348 × 926 | Correction contradictoire bloquée |
| `xlsx-conflit-revision-fullpage.jpg` | 1348 × 1746 | Refus de la révision périmée et absence d'écrasement |
| `deux-lectures-validees-persistantes.jpg` | 1348 × 2167 | Première vérification de persistance des deux pièces complètes |
| `aujourdhui-aide-sans-recouvrement.jpg` et `aujourdhui-theme-sombre.jpg` | 1348 × 926 | Aide au clavier et thème sombre réels |

Les trois nouveaux XLSX sont dans `preuves/visual-b19-2026-10-21/fixtures/`, avec leur
générateur et un rendu de feuille PNG. Ces PNG sont des aperçus de fichiers, pas des captures
de l'application. Le manifeste `captures-manifeste.json` conserve taille et SHA-256 des images.

## Défauts résiduels

| Référence | Constat vérifié | Suite nécessaire |
| --- | --- | --- |
| **R1 — bloquant** | Après Écarter puis Confirmer D2, l'inspecteur et le candidat retiennent bien 0 €, mais l'historique affiche « Confirmée : 0 € → aucune ». La lecture SQL ciblée confirme `action=REVIEW`, `after_status=REVIEWED`, `after_value=null`, `normalized_value=0`. La trace n'exprime donc pas fidèlement la valeur effective restaurée. | Corriger le contrat d'audit des décisions et sa présentation, vérifier confirmation monétaire et date après rejet/correction. Préserver les traces anciennes ; aucune réécriture d'historique n'a été tentée ici. La validation documentaire n'atteste pas la conformité de cette trace. |
| R2 | Les messages de doublon et de trou parlent encore de « lignes » selon les numéros d'échéance normalisés, décalés d'une ligne par rapport au fichier avec en-tête. Les libellés des contrôles ont été corrigés, pas ces deux messages. | Employer « échéances » ou les véritables lignes source dans ces alertes, puis relire la fixture anormale. |
| R3 | Certains petits textes et libellés du tiroir d'import restent sous le minimum typographique V10. | Ajuster la typographie des formulaires et relire aux trois formats demandés. |
| R4 | Sources Dette sait dire « Document présent » ; Sources Aujourd'hui peut encore dire « À fournir » en ne consommant que les faits canoniques appliqués. | Harmoniser la provenance documentaire interpages, sans confondre document déposé et échéancier appliqué. |

## Porte restante

**La capacité navigateur disponible ne propose ni redimensionnement du viewport ni émulation
tactile.** La taille observée est 1363 × 936 ; les images sans barre de défilement rendue peuvent
mesurer 1348 × 926. Les vrais 1440 × 900, tablette 900 px, mobile 390 px et gestes tactiles
restent non vérifiés. Les tests de composants mobiles ne constituent pas cette preuve.

Restent à certifier dans la vraie interface le refus d'un véritable classeur à macros, la
saisie d'une date d'observation future et la revue transversale des aides et formulaires.
Un fichier XLSX renommé en XLSM ne constituerait pas une preuve de présence de macros.
La déconnexion/reconnexion du propriétaire est établie par la reprise manuelle ; aucune
nouvelle déconnexion n'a été provoquée à la fin pour préserver la session de travail.
Les tests de composants, d'acquisition et les essais SQL antérieurs constituent des preuves
distinctes, pas des substituts aux vérifications d'interface manquantes.

**B19 ne peut donc pas être déclaré clôturé et B20 ne démarre pas.** La session est conservée
pour la suite ; les scénarios ci-dessus n'ont pas à être recommencés.
