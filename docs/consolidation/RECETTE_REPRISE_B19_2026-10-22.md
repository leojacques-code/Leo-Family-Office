# B19 — reprise hébergée après authentification Vercel, 22 octobre 2026

**B19 ouvert ; B20 non commencé ; PR #54 en brouillon.** L’accès navigateur a été rétabli
avec l’autorisation explicite du propriétaire d’ouvrir Vercel pour cette Preview. La connexion
GitHub proposée par le formulaire sécurisé a ramené au compte LFO déjà connecté. Aucun compte,
contrat ou document de test n’a été recréé. Le refus d’origine décrit dans la première revue
du 22 octobre est donc levé ; ses preuves historiques restent conservées.

Code final publié : `8d7ce426173d2be94d5c925da512ee2da84bb49c`.
Preview : https://leo-family-office-git-codex-astra-b19-hosted-integ-ce3b7b-lech1.vercel.app/debt.
Déploiement correspondant : `dpl_BvcggrTeCoPASgz3crvDtcBZRPmo`, READY, cible `null` (Preview),
URL immuable fournie par Vercel : https://leo-family-office-gcsu38rzc-lech1.vercel.app.
La recette utilise l’alias de branche pour conserver la session du compte ; l’URL immuable
n’a pas été ouverte comme nouvelle session applicative. Le commit de preuves suivant ne
modifie que la documentation et les fichiers de recette.

Staging uniquement, `bjxhnwvomoznorijauyl`. Aucune dépense, migration distante, modification
de production ou fusion. Aucun nouveau fait financier ni nouvelle décision documentaire
n’a été enregistré pendant cette reprise : les formulaires ouverts pour le clavier ont été
annulés. Le thème a été changé pour sa recette, puis remis en clair.

## Corrections trouvées dans la vraie interface

### Scénarios sur un compte sans scénario

La navigation depuis Projets plantait avec `Cannot read properties of undefined (reading 'id')`.
Le bouton « Réessayer » retrouvait la même erreur : ce n’était pas une panne intermittente.
La sélection initiale supposait l’existence de `state.scenarios[0]` ; les calculs et l’affichage
l’utilisaient ensuite sans garde. La capture avant correction et le journal de console limité
à cette erreur applicative sont conservés.

Le composant affiche désormais « Aucun scénario enregistré », laisse la création accessible
et désactive la duplication sans sélection. Aucun scénario ou chiffre n’est inventé. Quand
la première version arrive, duplication et projection visent son véritable identifiant ;
si la liste redevient vide, l’écran revient au vide. Les formules existantes sont conservées.
Les intitulés du composant touché sont français, sans réécriture du studio de scénarios.

Deux tests reproduisaient le plantage avant correction. Trois tests passent ensuite : compte
vide, fermeture/reprise de saisie et arrivée/disparition d’une première version. Le correctif
`9348c0d9ee509ebb6a2b2e97f901db24bd8826aa` a été testé dans la Preview, puis revérifié dans
le code final `8d7ce42`. « Essai B19 » a été saisi au clavier sans sauvegarde ; Échap rend le
focus au bouton ; la réouverture retrouve le texte. Après rechargement, le thème sombre reste
actif. La capture finale montre l’état vide dans le dernier déploiement.

### Auteur de l’historique documentaire et liasse

La revue du CSV montrait bien `1 000 → 999 → 1 000`, les dates et les motifs, mais pas l’auteur.
Le journal serveur conservait cet auteur. Le DTO et l’affichage commun le rendent maintenant
comme « par vous » uniquement quand `actor_user_id` correspond à l’acteur authentifié. Aucun
UUID d’auteur n’est envoyé au navigateur. Auteur différent ou absent ne devient jamais « vous ».
L’instant est affiché avec les secondes et le fuseau Paris ; les valeurs historiques ne sont
pas réécrites.

La lecture paginée de `document_field_decisions`, son contrat et le composant d’historique
sont communs aux échéanciers et aux liasses. La liasse disposait du journal en base mais ne
l’exposait pas dans son écran de cases : cet accès est ajouté sans refonte de Business Equity.
Un ancien transport sans journal affiche « Historique indisponible », pas « aucune décision ».
Une erreur de lecture n’est pas convertie en liste vide. L’index des décisions par case évite
de parcourir tout le journal pour chacune des centaines de cases d’une liasse.

La vraie revue du CSV, rechargée depuis `8d7ce42`, montre les deux corrections **par vous**,
le 21 octobre à **11:32:15** et **11:34:51**, heure de Paris, avec leurs valeurs et motifs
inchangés. La capture finale expose les deux traces après défilement interne du panneau.
L’extension liasse est vérifiée par composants et lecture simulée ; aucun nouveau PDF de
liasse n’a été déposé dans l’interface hébergée pendant cette reprise. Cette limite reste ouverte.

Le pluriel « 1 échéances » de la liste des pièces a également été corrigé. Le vrai extrait
partiel affiche maintenant « 1 échéance », avec son statut et son avertissement de partiel.

## Recette réelle des corrections partagées

| Parcours | Observation réelle |
| --- | --- |
| Tiroir encours | Saisie séquentielle de `2000` : valeur entière et focus conservés ; Échap ferme et rend le focus à « Encours seul ». Revérifié sur le SHA final, sans soumission. |
| Contrat | Tab depuis « Conditions avancées et événements » replié atteint le motif. Entrée ouvre la section ; Tab atteint les frais récurrents. Échap rend le focus à « Corriger le contrat ». Aucune nouvelle version créée. |
| Aide Patrimoine net | Clic, Échap et clic à 6 px hors de l’icône fonctionnent. Boîte du bouton 24×24 ; pseudo-élément mesuré 40×40 ; le montant reste visible. Ce clic souris ne prouve pas un geste tactile. |
| Revue XLSX partielle | Réouverture de la lecture validée, avertissement d’extrait conservé ; D2 puis Flèche droite sélectionne E2 et le candidat Assurance ; clic sur Capital amorti sélectionne C2 côté pièce. |
| Revue CSV | Lecture toujours validée ; C3 reste corrigée à 1 000 €, deux traces immuables visibles ; auteur et heure vérifiés après le déploiement final. |
| Persistance | Connexion LFO conservée après l’accès Vercel et les rechargements ; cinq pièces retrouvées au coffre et depuis la dette ; thème sombre persistant après rechargement. |

Les vrais dépôts CSV et XLSX, contrôles financiers, conflit à deux onglets, refus des macros,
formules en cache, validation et retour au dossier ont déjà leurs preuves dans
[la recette du 21 octobre](RECETTE_VISUELLE_B19_2026-10-21.md). Ils n’ont pas tous été rejoués
ici : aucune modification d’extracteur, de contrôle SQL ou de mutation n’a été apportée dans
cette reprise. L’assurance reste séparée, l’encours reste 2 000 € et les lectures ne sont pas
présentées comme rattachées au prêt. Le rattachement reste B20.

## Écrans réellement confrontés à V10 et aux décisions fondateur

Cette lecture porte sur les états sans données ou avec la seule dette synthétique. Elle
ne certifie pas toutes les opérations métier de chacun des domaines.

| Surface | Constat visible et suite |
| --- | --- |
| Aujourd’hui | Titres financiers courts, inconnu distinct du zéro, rail compact ; aide et cible étendue vérifiées. |
| Patrimoine | Bilan limité aux lignes déclarées explicité ; pourtant « Liquidité immédiate : 0 € » sans banque renseignée contredit l’état inconnu d’Aujourd’hui. Écart financier à corriger, pas conformité acquise. |
| Dette | Déclaré/déduit, assurance séparée, contrat, événements annulés et pièces lisibles. Corrections clavier et historique vérifiées ; vrais formats responsive encore ouverts. |
| Flux | Revenus et dépenses sans opérations correctement « Non observé ». La prévision part cependant de 0 € sans banque déclarée et annonce une trésorerie négative : périmètre de liquidité à corriger avant certification de cette surface. |
| Placements | État sans enveloppe explicite ; titres « Investments », « Portfolio analytics », aide « Explain calculation » et code `NOT_COMPUTABLE` encore visibles. Refonte et localisation dans sa phase. |
| Immobilier | Absence de bien distincte de zéro ; étude prospective séparée. Titre « Real Estate », jargon moteur et hypothèses numériques préremplies encore visibles : restent à reprendre dans sa phase. |
| Entreprises | Absence de participation explicite ; titre « Business Equity » et texte technique. Pas de refonte structurelle dans B19 ; historique liasse commun ajouté et testé séparément. |
| Carrière | État sans fait explicite ; « Career », « Career Engine », « fait canonique » visibles. D-UX-01/05 non entièrement livrées sur cette ancienne page. |
| Fiscalité | Absence de règle et impôt dû non calculable explicités. Anglicismes/codes et plusieurs montants cash à zéro sans observations restent à qualifier et corriger ; aucune convention fiscale inventée. |
| Objectifs | Page historique « Goals », scénario absent et trajectoire indisponible. D-UX-06 réserve la reconstruction à B43/B44 ; elle n’est pas présentée comme réalisée. |
| Décisions | Absence de deux scénarios traitée sans plantage ; « Decision Lab » et vocabulaire V2 visibles. D-UX-07 réserve le studio à B45. |
| Scénarios | Plantage corrigé ; création accessible depuis l’état vide ; aucune projection fabriquée. Studio avancé conservé pour sa phase. |
| Sources / Documents | Cinq pièces persistantes. Coffre encore nommé « local », catégories anglaises et sélecteur de catégorie sans libellé accessible : écarts réels, boîte unifiée B46 non livrée. |
| Rapports / contexte | Rapport signalé partiel, mais titres/codes techniques et « 3 points non identifiés » restent visibles. Contexte du 15 octobre conservé. Réglages et export PDF non recettés ici. |

Les montants de liquidité non renseignée et les formulations historiques sont des défauts
résiduels du produit, pas des écarts effacés par la réussite des tests. La correction d’un
périmètre financier doit rester dans son modèle de lecture et respecter les déclarations
d’applicabilité ; elle ne consiste pas à masquer tous les zéros ou à renommer une formule.

## Contrôles, captures et critères encore ouverts

Preuves : `preuves/reprise-b19-2026-10-22/`. Le manifeste `visuel/manifest.json` donne pour
chaque capture son empreinte, sa taille réelle et la version connue. Deux captures de
transition ont été écartées ; aucune capture n’a été redimensionnée ou fabriquée.

| Contrôle | Résultat |
| --- | --- |
| Suite complète après historique commun | **2 646 tests / 192 fichiers réussis**, `tests-historique-commun.log`. |
| Contrôles ciblés finaux | **25 tests / 4 fichiers réussis**, après corrections de typage et dépendance React, `historique-cible-final.log`. |
| Lint final | Réussi, `lint-historique-final.log`. |
| Build final | Réussi, compilation, TypeScript et pages, `build-historique-final.log`. |
| Format et diff du code | Prettier et `git diff --check` réussis. |
| Dernière lecture SQL staging | 66 migrations ; dernière `20261021153711` ; encours 2 000 € ; 3 lectures validées, 2 refusées ; 8 décisions, aucune sans auteur ; 0 ligne canonique d’échéancier. `staging-final-lecture-seule.json`. |
| Revue de PR indépendante | Aucune nouvelle revue trouvée : seul le commentaire de déploiement Vercel est présent. La relecture de l’auteur n’est pas indépendante. |

Les premiers builds de cette reprise ont révélé des erreurs de typage dans les nouveaux
tests ; le lint a relevé une dépendance de mémoïsation. Ils ont été corrigés sans désactiver
les contrôles. Les journaux intermédiaires et les succès finaux sont conservés. Le test de
liasse utilise une soumission de formulaire simulée, car JSDOM maintient `valueMissing` sur
son champ fichier malgré un FileList renseigné ; il ne prétend pas prouver le dépôt PDF réel.

Le viewport observé est **1363×936 CSS px**. Les JPEG bruts rendus par le navigateur font
1348×926 ou 1363×936, selon la capture ; le manifeste conserve la mesure de chaque fichier.
Les capacités exposées ne permettent ni redimensionnement du viewport ni émulation tactile.
**1440×900, tablette 900 px, mobile 390 px et toucher restent donc non vérifiés.**

Le gate PostgreSQL depuis zéro reste inexécuté dans cet environnement sans PostgreSQL ;
les refus de provisionnement antérieurs ne sont pas contournés. La recette hébergée de
l’historique liasse, la revue indépendante et les corrections financières/transversales
identifiées ci-dessus restent également à terminer. Le [plan de déploiement préparé](PLAN_DEPLOIEMENT_B19_2026-10-22.md)
demeure une préparation sans exécution en production.

La session navigateur est conservée sur la dette. Reprendre ces critères et les défauts
résiduels ; ne pas refaire l’inscription ni les cinq dépôts. **Aucune clôture B19, aucun
démarrage B20 et aucune fusion dans main n’est déclaré par cette reprise.**
