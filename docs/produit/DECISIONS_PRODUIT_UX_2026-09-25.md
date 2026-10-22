# Registre des décisions produit : UX et UI (version du 25 septembre 2026)

Premier registre de décisions produit du dépôt, prévu par le kit du 11 septembre 2026
(`00_LIRE_EN_PREMIER.md`, « un registre de décisions produit »). Il consigne les arbitrages
fondateur du 25 septembre 2026 sur l'expérience et le design, et les confronte aux exigences
déjà en vigueur. Une nouvelle version s'ajoute sous un nouveau nom daté ; celle-ci n'est jamais
réécrite.

## 1. Hiérarchie d'autorité

Dans l'ordre : décisions déjà actées et arbitrages datés du fondateur ; kit de codage du
11 septembre 2026 et dossier consolidé (le kit dit lui-même qu'une remarque personnelle prime
sur une lecture rigide de V10, arbitrage A02) ; programme et `backlog.csv` ; spécification
active V10 (les annexes V9 et antérieures ne sont pas une seconde spécification) ; constitution
technique `CLAUDE.md` pour tout ce qui touche aux conventions financières, aux migrations et à
la sécurité.

Une décision de ce registre COMPLÈTE ces sources ; elle n'en retire rien. Elle ne modifie
aucune convention financière et ne supprime aucune capacité avancée déjà livrée. En cas de
contradiction apparente, elle est signalée ici au lieu d'être tranchée en silence.

Légende de la colonne Origine : KIT (kit ou dossier consolidé), V10 (spécification active),
FONDATEUR (arbitrage du 25 septembre 2026).

## 2. Décisions

### D-UX-01. Intitulés des métriques

| Origine | Règle |
|---|---|
| V10 §3 | Budget de texte : question financière du domaine limitée à 14 à 16 mots ; aucun paragraphe explicatif sous l'en-tête ; l'explication détaillée va dans les infobulles et tiroirs |
| KIT 03 §11 | Texte utilisateur sans jargon technique |
| FONDATEUR | Titres courts, précis, professionnels. Une phrase interrogative ou pédagogique ne remplace plus le NOM d'une métrique. Appellations usuelles quand elles correspondent EXACTEMENT au calcul : Patrimoine net, Trésorerie disponible, Service de la dette, Capacité d'épargne, Coût restant, Performance annualisée. Aucun identifiant interne ni jargon d'implémentation |

Compatibilité : l'en-tête de domaine garde au plus une question courte (V10) ; ce sont les
TUILES et libellés de métriques qui prennent le nom financier. La question devient le premier
élément de l'aide contextuelle (D-UX-02).

Garde-fou : un nom usuel ne s'applique qu'à la métrique dont la définition et le périmètre lui
correspondent. Exemples à ne pas confondre : « Trésorerie disponible » n'est pas « liquidité
immédiate » si le périmètre des comptes diffère ; « Service de la dette » payé, exigible et prévu
sont trois mesures (document 04 §5) et gardent trois noms ; « Capacité d'épargne » n'est pas le
« Solde libre » du mois observé tant que sa définition n'est pas arrêtée. Le nom se lit dans le
registre de métriques (`src/lib/presentation/registry/kpis.ts`) avant d'être affiché.

### D-UX-02. Aide contextuelle « ? »

| Origine | Règle |
|---|---|
| V10 §3, §4.4 | L'explication apparaît à l'interaction ; l'Inspecteur porte définition, nature, source, date, confiance, formule |
| FONDATEUR | Icône « ? » discrète près du titre. Au survol, au clic, au clavier et au toucher, elle donne : définition, utilité, périmètre, période et convention, données et hypothèses utilisées si pertinent, limites ou réserves importantes. Elle complète le chiffre sans le masquer et ne remplace pas l'accès au calcul, aux sources et à l'historique dans l'Inspecteur |

Mise en œuvre : UN composant partagé (`MetricHelp`), alimenté par le registre de métriques quand
la métrique y figure, accessible (bouton focalisable, `aria-expanded`, fermeture par Échap et au
clic extérieur, ouverture au toucher sans survol requis). Il existe aujourd'hui un bouton
`onExplain` dans `MetricCard` (`src/components/ui.tsx`) et un `Tooltip` de graphique : le nouveau
composant les unifie au fil des écrans touchés, sans réécriture générale.

### D-UX-03. Emprise des Sources

| Origine | Règle |
|---|---|
| V10 §4.2, §6 | Rail compact et persistant, carte d'entrée opérationnelle et non tutoriel ; titre de deux mots, indice de quatre mots, icône d'état ; source manquante en simple « + » |
| KIT 03 §10 | Sources et inspecteur entourent le canevas seulement quand leur contenu est utile |
| FONDATEUR | Réduire nettement l'emprise des Sources dans les pages de pilotage, en conservant toute la profondeur documentaire : indicateur compact de provenance, panneau repliable, accès Inspecteur, lien vers la pièce, accès au domaine Sources. Le canevas financier et les données principales dominent |

Toujours visibles malgré cette discrétion : réserves financières matérielles, données anciennes,
conflits documentaires, informations manquantes qui changent le résultat.

Exception : la REVUE DOCUMENTAIRE (import, extraction, correction, validation). La pièce y est
centrale et peut occuper une large place, côte à côte avec les données extraites (document 04 §4).

Compatibilité : conforme à V10, qui voulait déjà un rail compact ; l'écart est dans l'existant
(rail en cartes hautes, titre répété « Échéancier / Échéancier »), pas dans la règle.

### D-UX-04. Formulaires et options

| Origine | Règle |
|---|---|
| KIT 02 A05, 03 §8 ; V9 §6.1 conservé par V10 §7 | Trois niveaux : observation, fonctionnement, décision ; tiroirs et éditeurs, pas de méga-formulaire ; embranchements ; vide, invalide et zéro distincts ; brouillon ; synthèse avant validation ; bouton nommé selon l'effet |
| FONDATEUR | Progression lisible entre observation simple, description détaillée et analyse avancée, sans trois écrans obligatoires : commencer avec ce que l'on sait ET accéder directement à l'avancé. Options compréhensibles, organisées, visibles. Révéler selon la pertinence ; ne jamais préremplir un fait financier inconnu ; distinguer déclaré et déduit ; conserver les saisies au retour ; brouillons quand le parcours le prévoit ; synthèse et conséquences financières avant validation ; corriger ou enrichir sans effacer l'historique |

Compatibilité : identique au kit sur le fond ; la décision ajoute l'exigence de VISIBILITÉ des
options avancées (elles ne doivent pas être enfouies). La simplicité ne s'obtient jamais en
retirant une capacité du moteur.

### D-UX-05. Direction générale

| Origine | Règle |
|---|---|
| V10 §1, §4, §29 | Le cockpit n'est pas un dashboard ; canevas unique par domaine ; test de validation par domaine |
| FONDATEUR | Interface élégante, professionnelle, dense quand c'est utile, sans surcharge permanente ; ni formulaire administratif, ni application grand public simplifiée. Architecture V10 conservée (Sources contextuelles, canevas dominant propre au domaine, Inspecteur, profondeur à la demande). Pas de modèle unique de cartes KPI généralisé. Cohérence clair et sombre, ordinateur, tablette, mobile ; clavier et toucher |

Critère de recette ajouté : une page n'est pas conforme à V10 parce qu'elle contient un graphique,
un rail et un Inspecteur. La recette juge leur hiérarchie, leur utilité et leur usage réel.

### D-UX-06. Objectifs : refonte en phase 9

| Origine | Exigence |
|---|---|
| KIT 05 §8 | Nom, intention, mesure, cible, unité, horizon, priorité, rigidité, bénéficiaire, ressources éligibles et affectation ; mesure conforme à l'intention (réserve sur liquidités, apport sur ressources mobilisables à l'échéance) ; avancement, ressources affectées, manque, effort requis ; un euro ne finance pas deux objectifs sans que la concurrence soit montrée ; atteint aujourd'hui mais menacé à l'échéance |
| KIT backlog | B43 (affecter les ressources, disponibilité à échéance), B44 (scénarios versionnés) |
| V10 §20 | Canevas « capital actuel + financement mensuel + contribution d'investissement → cible » ; trajectoire en visuel principal, anneau de progression secondaire ; liens Flux, liquidité, placements, contraintes de dette |
| FONDATEUR | Page actuelle trop sommaire, non référence. Doivent apparaître : ressources affectées, échéances et horizons, besoins de financement, trajectoires, objectifs concurrents, scénarios et conséquences. Métriques définies, hypothèses accessibles. Ressources disponibles et affectées distinguées des valorisations patrimoniales et des montants projetés |

Écarts constatés dans le code au 25 septembre (`src/components/pages/goals/page.tsx`) : en-tête
intitulé « Goals » (anglais) ; titres techniques (« La définition est persistée ; les évaluations
restent dérivées. ») ; aucune vue des objectifs concurrents ni de l'affectation d'un même euro.

Application : phase 9 (B43, B44). Pas de reconstruction avant cette phase.

### D-UX-07. Décisions (Decision Lab) : refonte en phase 9

| Origine | Exigence |
|---|---|
| KIT 05 §9 | Question d'usage ; options, périmètre, contraintes ; option « ne rien changer » quand elle a un sens ; date, ressources, horizon, devise et conventions communs ; patrimoine final, liquidité minimale, revenus disponibles, engagements, risque, coût fiscal estimé, réversibilité, dépendances ; hypothèses qui font changer le résultat ; aucun score gagnant fabriqué ; option retenue avec motif, limites, date de revue, tâches, déclencheurs ; comparaison versionnée, ancienne comparaison consultable et signalée à actualiser |
| KIT backlog | B45 (comparaison puis suivi de décision) |
| V10 §19 | Studio de comparaison : option A, axe, option B ; patrimoine net, liquidité, flux mensuel, risque, faisabilité des objectifs ; « Arbitrage » et non « Meilleur choix » sans fonction objectif déclarée |
| FONDATEUR | Page actuelle trop sommaire, non référence UX. Profondeur exigée : alternatives, hypothèses, conséquences financières, sensibilités, scénarios, conservation, historique et suivi. Base de référence commune quand le modèle l'exige. Une simulation ne devient jamais un fait |

Écarts constatés (`src/components/pages/decision-lab/page.tsx`) : en-tête « Decision Lab »
(anglais) ; jargon d'implémentation visible (« Conflits HARD / SOFT », « blockers », « Run
enregistré », « Empreinte de référence », « Mode d'exécution ») ; pas de géométrie A / axe / B ;
sensibilités absentes.

Application : phase 9 (B45). Pas de reconstruction avant cette phase.

### D-UX-08. Modèle documentaire commun (Dette 3C)

| Origine | Règle |
|---|---|
| KIT 04 §4, 06 | Chaque fait extrait : valeur brute, normalisée, unité, localisation, méthode, statut de revue ; « un candidat conserve valeur originale, valeur normalisée, unité, devise, période, localisation, version du parseur et décision » |
| FONDATEUR | Réutiliser Document Intelligence et son modèle de candidats si ses contrats conviennent à la Dette ; pas de second modèle concurrent. Infrastructure commune : document et version, champ et valeur brute, valeur normalisée et retenue, devise et unité, localisation, méthode, statut de revue, décision humaine et historique, provenance et propagation. Contrôles financiers PROPRES à chaque domaine. Toute incompatibilité structurelle est documentée avant de proposer une autre architecture |

### D-UX-09. Historique des décisions documentaires

FONDATEUR : historique par champ (auteur, date, valeur précédente, valeur retenue, motif), aussi
applicable à la liasse fiscale, par une infrastructure commune et sans refonte générale de
Business Equity. Aucune correction n'écrase silencieusement une décision précédente. Schéma
additif, testé en migration et non-régression sur la base locale isolée. Cohérent avec
`CLAUDE.md` §3 (« DÉCISION ≠ CONSENTEMENT », piste immuable, verrou avant comparaison).

### D-UX-10. Formats documentaires de B19

FONDATEUR : CSV et XLSX dès B19, le lecteur XLSX existant réutilisé s'il ne compromet pas la
fiabilité. Contrôles de colonnes, dates, devises, unités, lignes manquantes, extraits partiels,
doublons et écarts financiers. Une extraction partielle n'est jamais présentée comme un
échéancier complet. PDF natif, scan et OCR suivent les dépendances du programme : le périmètre
final de 3C n'est pas réduit en silence, et aucun format non livré n'est promis à l'écran.

### D-UX-11. Parcours documentaire

KIT 04 §4 et 05 §10, complétés par le FONDATEUR : importer → consulter la pièce → examiner les
candidats → corriger → identifier les conflits → valider → consulter les conséquences. Côte à
côte sur ordinateur ; sur mobile, la sélection est conservée quand on alterne pièce et données.
Chaque candidat renvoie à sa source, sa localisation et son statut. Une extraction ne modifie
jamais un fait canonique en silence. Après validation, retour au dossier Dette concerné et à ses
effets réellement applicables ; la pièce reste consultable ensuite.

## 3. Points UX ouverts, conservés

| Point | Origine | Affectation |
|---|---|---|
| Devise de lecture affichée, non choisissable à l'accueil | recette du 25 septembre | Décision liée à la conversion des flux (phase Flux) |
| Revue d'onboarding sans action principale dominante | recette du 25 septembre | Revue UX transversale de clôture 3C |
| Deux actions pour une même dette incomplète | recette du 25 septembre | Revue UX transversale (regroupement des réserves par objet) |
| Titre répété dans le rail Sources | recette du 25 septembre | Revue UX transversale ; corrigé plus tôt si un composant 3C le touche |
| Service de la dette payé, exigible et prévu | document 04 §5 | B21 |
| Onboarding et volet documentaire de B14 | matrice 3B v3 | B19 (dépôt de document comme premier fait), puis revue transversale |

Règle de traitement : un défaut qui touche un composant modifié pendant Dette 3C est corrigé dans
le lot ; les autres restent dans la matrice avec leur phase ou leur ticket, sans disparaître.

## 4. Revue UX transversale prévue à la clôture de Dette 3C

Comparer les écrans existants à V10 et à ce registre ; lister titres à raccourcir et aides
manquantes, rails Sources trop présents, formulaires et options mal organisés, interactions peu
visibles, états vides ou partiels peu compréhensibles, ruptures de navigation entre domaines,
écarts de hiérarchie et de densité, limites d'accessibilité et de responsive. Corriger le faible
risque ; affecter les refontes structurelles à leur phase ; pas de refonte générale incontrôlée.
