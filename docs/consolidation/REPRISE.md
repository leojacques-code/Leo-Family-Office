# Reprise du programme LFO — 12 septembre 2026

## Autorité et baseline (B01/B02)

La demande du propriétaire dans la tâche des 11–12 septembre 2026 autorise l'exécution du dossier et du kit dans leur ordre, à la lettre. Empreintes SHA-256 : dossier `5326d684b2773f92fc80aac902941711cb08e31ce56a0ec30638a760c930d714` ; kit `cb36e41c7479955b4d2e1eda22aa34e65bdff156e9d1f59d8bf77e9a27c2a1a9`. Le dossier consolidé et le kit datés du 11 septembre 2026 sont conservés dans le répertoire de travail voisin `../source/LFO_Programme`. Leur contenu d'audit décrit des observations historiques, pas des tests exécutés pendant cette reprise.

Ordre unique : `07_PROGRAMME_ET_TRAVAIL_IA.md` §2 ; tickets et dépendances : `backlog.csv`. Les décisions A01–A15 du document 02 sont la référence adoptée par la demande d'exécution ; chaque lot doit citer celles qu'il met en œuvre et signaler tout amendement nécessaire. Aucun délai fiable ni achèvement des 60 tickets n'est annoncé.

Baseline vérifiée le 11 septembre : `main` = `bd1782cae6b5f7141c3cc2765bd30c6a11a325fe` ; PR 50 ouverte en brouillon = `8d22b08d95e322bb50832ae8ab079b7657cedf03` (`codex/debt-phase-3`) ; PR 51 ouverte en brouillon = `916cfe7754c8d80824ea725072c8ba4f2725a131` (`claude/compassionate-galileo-muge41`). Leurs apports ne sont pas réécrits dans le lot de confiance et seront repris aux étapes 3A/4A.

Vercel : projet `prj_4YJeECIQaqDOEE8KodN6PotWaQfd`, production `dpl_5MEwEwRAtizQYCq8gXd4Q7B9kPj3`, SHA identique à main, READY, région iad1. Supabase : `zwgrcznzymbfdiybeuvv`, eu-west-1, ACTIVE_HEALTHY, 45 migrations listées. Ce relevé ne prouve pas l'identité byte à byte des schémas ni l'isolation des previews.

## Lot en cours : confiance (B03–B06)

Conserver : moteurs, bilan canonique, versions d'objectifs, RPC existantes, adaptateurs de registres.
Étendre : définition d'objectif avec un type explicite, contrôles de commande et d'évaluation, diagnostic de lecture.
Remplacer : sélecteur global sans contexte, lecture du catalogue qui provisionnait les connexions, reprise d'erreur sans rafraîchissement serveur.

- B03 / A07 : retrait du mode global et des promesses d'isolation sur les pages concernées. Les simulations propres aux moteurs ne sont pas modifiées. Le rétablissement du mode attend le contexte complet jusqu'au stockage et la promotion explicite.
- B04 / A13 : choix explicite réserve / patrimoine / autre. Une réserve utilise uniquement `IMMEDIATE_CASH >= cible`. Une ancienne définition sans type reste conservée mais son atteinte est indéterminée jusqu'à confirmation. Pas d'inférence depuis le nom libre. Les affectations et disponibilités détaillées restent B43 et sont annoncées dans l'interface.
- B05 : diagnostic JWT expurgé, horodaté, sans message fournisseur ; frontière de page avec `retry` (Next 16.3.3 : rafraîchit puis réinitialise la frontière) et retour Aujourd'hui. L'incident F04 reste ouvert ; ceci ne clôt pas B09 (lectures ciblées).
- B06 : un SELECT filtré par utilisateur/domaine décrit les connexions ; l'absence devient « Non configuré ». Le provisionnement reste dans les opérations POST explicites search/lookup. GET n'appelle plus de RPC.

La recette a révélé que le maximum de hauteur de l'en-tête masquait l'action primaire à 1280 px. La hauteur suit désormais le contenu et le titre partage l'espace avec les commandes. Le comportement de création est aussi réinitialisé après une édition abandonnée.

## Vérifications déjà exécutées

Le 12 septembre, après les corrections de recette : `npm run check` réussi (marqueurs de conflit, ESLint, **2 152 tests / 125 fichiers**, build Next.js avec vérification TypeScript).

Relecture indépendante selon document 07 §4/§7 : contournement via `add_goal` sans type confirmé trouvé puis corrigé ; aucun autre défaut de code démontré sur les quatre chemins. Verdict du relecteur : pas de clôture avant preuve de persistance et rechargement.

Recette locale : PostgreSQL natif 18.4 jetable sur 127.0.0.1:55439, PostgREST 14.16 sur 55440, passerelle locale sur 55441 et Next sur 3107. 45 migrations et 107 tables reconstruites. Les schémas auth/storage sont des shims de gate : cette recette n'est PAS une preuve de Supabase Auth ou Storage (B12/B13).

Création via navigateur d'un compte fictif de 1 794,41 €, puis d'une réserve de 5 130 €. Rechargement et lecture SQL confirment la définition `SAFETY_RESERVE/IMMEDIATE_CASH`. Un actif illiquide fictif ajouté en base porte le patrimoine net à 8 722 666,82 € ; la réserve affiche toujours 1 794,41 € et un manque de 3 335,59 €. Correction de description par nouvelle version effectuée dans le navigateur ; SQL confirme v1 intacte et v2 courante, même type, métrique et cible. Rechargement v2 vérifié.

Le catalogue local retourne trois adaptateurs « Non configuré » avec HTTP 200 ; SQL confirme zéro ligne dans external_sources après le GET, comme avant.

## Incident F04 / B05 (ouvert)

Production : ancien incident du 10 septembre décrit dans le kit ; aucun log d'erreur trouvé par la requête des dernières 24 heures le 11 septembre. Ce résultat ne prouve pas une résolution.

Recette le 12 septembre : première lecture après longue interruption a renvoyé JWT issued at future ; une lecture directe ultérieure a réussi. À 18:47:25 UTC, Node, clock_timestamp PostgreSQL et Date HTTP concordent. Les horloges n'ont pas été capturées au moment précis du premier refus : aucune cause démontrée. Le bouton Réessayer a ensuite rechargé le cockpit avec HTTP 200. Injection déterministe locale sur GET profiles : frontière de page visible, message fournisseur absent de l'interface ; après retrait de l'injection, le bouton Réessayer recharge les données v2. Le serveur journalise DATABASE_JWT_FUTURE, le contexte et son horodatage, sans jeton.

## Étape suivante obligatoire

Finir les preuves du lot courant, relire les derniers ajustements, figer le SHA et la note de limites avant fusion. Puis suivre les étapes 3, 4, 5 du programme (achèvement ciblé phases 1/2, reprise PR50, reprise PR51), puis identité 11A avant toute donnée personnelle. Ne pas déclarer les fixtures des cent situations exécutées. Ne jamais exécuter de test d'écriture en production.

## Achèvement ciblé champs et sources — 13 septembre (B07/B08)

Baseline : commit de confiance `63820c1ce29b3a9c48c0971204daeff2d9fe8a15` conservé localement. Le dépôt GitHub a été confirmé public et appartenant au compte connecté `leojacques-code` le 13 septembre. Le push reste suspendu après refus du contrôle automatique ; une demande précise de publication du correctif a été présentée au propriétaire. Aucune fusion ni publication en production effectuée.

Conserver/réutiliser : `MoneyInput`, `DateInput`, parseurs discriminés, RPC atomique `lfo_add_account`, historique des observations et registre des sources. Étendre : DTO de création avec `balanceDate` explicite et validation calendaire en création/correction. Remplacer : montant HTML numérique et date du jour silencieusement imposée à la création. Une requête ancienne sans date est refusée (400), jamais complétée par une date inventée ; client et serveur doivent être publiés ensemble.

B07 : création de compte avec montant/date vides, devise visible, virgule et espaces acceptés ; vide/invalide bloquent, zéro explicite accepté. L'édition reprend la date enregistrée. B08 : « Données présentes » n'annonce ni pièce détenue ni fraîcheur vérifiée. « Document présent » exige une ligne du catalogue documentaire ; aucune liaison pièce/objet n'est inférée depuis une catégorie ou un agrégat. Les liens documentaires par objet, leur contrôle et leur couverture restent à construire dans le socle documentaire.

Vérifications : `npm run check` réussi, **2 161 tests / 127 fichiers**, lint et build/TypeScript. Relecture indépendante : 30 tests ciblés sur 4 fichiers exécutés avec succès ; une date d'explication financière effacée accidentellement a été restaurée, correction relue. Aucun autre défaut matériel trouvé dans ce périmètre.

Recette locale, même base jetable : saisie navigateur au clavier du compte fictif « Compte daté B07 », solde `1 794,41`, date `2026-08-31`. Création puis rechargement réussis. Édition : date historique reprise, correction explicite à zéro puis nouveau rechargement affichant zéro. Lecture SQL confirme deux observations à la même date, `1794.410000` puis `0.000000`, source Saisie manuelle, dates de création distinctes ; aucune observation écrasée. Le rail affiche « Données présentes ». Captures des formulaires bureau 1440×900 et mobile 390×844 ; boîte mobile 342 px dans un viewport de 390 px sans débordement. L'automatisation `fill` sur le champ date natif n'a pas rempli la valeur ; la saisie segmentée au clavier a été vérifiée. Le clic automatisé sur le calendrier n'est pas une preuve acquise ; la recette calendrier reste à achever.

F04 reste ouvert : un refus JWT_FUTURE transitoire a de nouveau été reçu au premier chargement local après interruption nocturne ; lecture ultérieure réussie. Ni expiration ni décalage précis d'horloge n'ont été démontrés comme cause. Aucune conclusion de résolution en production.

Suite obligatoire : B09, puis reprise PR50 (B10) et PR51 (B11), avant identité personnelle. B07 est prouvé sur le parcours compte de cette tranche, pas sur tous les formulaires historiques ; les champs de dette de PR50 sont repris à l'étape suivante. B57 global et les cent situations restent ouverts.

## Lecture ciblée Dettes — B09, 13 septembre

Baseline : `f2ad138f68a3dabe1f90b0984b58d0da44cd28f6`. Conserver : moteurs canoniques, mappings stricts, RPC de dette, compatibilité des autres pages. Réutiliser : pagination exhaustive, contexte de date, manifeste de sources et frontière d'erreur. Étendre : modèle Dettes, métadonnées de présence pour le rail, acquittement d'écriture séparé du rafraîchissement. Remplacer pour /debt : lecture/réponse globales par getDebtReadModel et /api/debt. Aucune migration SQL.

Le modèle lit les prêts et leurs tables liées, scénarios, FX, profil, cash bancaire actif BANK/SAVINGS IMMEDIATE, observations de ces seuls comptes, dernière clôture non future et dernière date de transaction pour la preuve du rail. Les historiques sont paginés jusqu'à épuisement ; le garde de troncature refuse une lecture incomplète. Le résultat ne sérialise aucun faux bilan global ni tableau de domaine omis. Le cash vient de l'agrégat immediateCash existant ; sa présence déclarée est distincte de la somme nulle d'un périmètre vide. Comparaison indisponible sans observation de cash, FX, scénario ou devise compatible.

Écriture : /api/debt accepte uniquement contrat/observation/archivage après authentification et validation DTO. L'exécution réutilise les mutations existantes sans relecture globale. Un acquittement réussi suivi d'un GET échoué conserve l'ancien modèle avec avertissement permanent ; aucune nouvelle mutation ni ouverture de formulaire n'est possible avant rafraîchissement réussi. Les autres routes conservent mutateState et leur réponse historique. L'identité reste le mécanisme existant du propriétaire ; ce lot ne clôt pas B12/B13.

Relecture : trois dépendances corrigées (preuve de transactions, clôture future devant la clôture valide, compte de placement invalide sans lien avec le cash), garde de cash absent et ouverture d'un formulaire pendant rafraîchissement. 123 tests ciblés/7 fichiers exécutés par le relecteur, verts ; tests supplémentaires de reprise ciblés exécutés ensuite. Contrôle complet avant le dernier garde : 2 179 tests/131 fichiers, lint, TypeScript, build réussis ; résultat final consigné dans le rapport de livraison.

Recette locale : dette fictive « Dette recette B09 » créée à 12 000 par POST /api/debt, acquittement 200 puis lecture dans le navigateur. Observation corrigée à 11 000 par formulaire. Panne GET loan_schedules injectée : POST réussi, affichage ancien 12 000 explicitement signalé, SQL confirme seulement deux observations 12 000 puis 11 000 au 13 septembre, sans duplication. Après retrait de panne et Actualiser, modèle relu à 11 000. Panne tax_observations injectée : GET /api/debt reste 200, GET /api/state renvoie 500. Toutes les injections ont été retirées. Réponse ciblée mesurée sur ce fixture : 1 554 octets, 15 requêtes PostgREST, 40,5 ms en développement local (pas une mesure de production ni un engagement de performance).

Limites : pagination réseau complète mais pas encore navigation page par page des dossiers à l'écran ; détails de tous les prêts du périmètre encore chargés. Les formulaires contractuels, l'import CSV et leurs limites restent B10, observation minimale et assurance séparée B15–B18. Le vocabulaire ancien de la page n'est pas entièrement repris ici. F04 reste ouvert : JWT_FUTURE local transitoire après longue interruption, reprise par Réessayer observée, cause non prouvée. Aucune écriture ni test en production.

Finalisation B09, 14 septembre : contrôle complet final réussi, 2 180 tests / 131 fichiers, ESLint, TypeScript et build. Relecture indépendante du dernier garde : 6 tests / 2 fichiers exécutés, aucun défaut matériel restant sur la reprise d’écriture. Dernier ajustement CSS : statut des sources sous leur nom pour préserver la lisibilité du rail étroit ; rendu inspecté à 1280 px. Après renouvellement du jeton de recette expiré (expiration constatée, distincte de F04), rechargement HTTP 200 : dette 11 000, cash 1 794,41, réponse 1 554 octets. Aucune modification de production. B09 est livré pour le domaine Dettes avec les limites ci-dessus ; les autres lectures et F04 restent ouverts.

## Reprise PR 50 — B10, 14 septembre

Baseline locale B09 : `bccb97df4beea84cab8a0412bd91dc2bcc60e4a8`. GitHub relu : PR 50 toujours ouverte, source `8d22b08d95e322bb50832ae8ab079b7657cedf03`. Fusion locale conservant son historique ; aucun changement de schéma. Réutiliser : parseur CSV explicite, aperçu et cinq champs financiers vides de PR 50, moteurs/RPC. Étendre seulement l’intégration de l’action primaire (retirée tant que la lecture B09 doit être reprise) et la conservation distincte des notes contractuelles.

Relecture indépendante : 29 tests / 6 fichiers puis 40 tests / 7 fichiers réellement exécutés. Deux défauts corrigés : le coût de toutes les lignes, même historiques, est nommé « Coût des lignes fournies » ; `contractNotes` conserve la référence CSV indépendamment de la provenance de la dernière observation, évitant son effacement lors d’une réédition. Contrôle final complet réussi : **2 196 tests / 134 fichiers**, lint, TypeScript, build.

Recette sur la dette fictive B09 : aperçu de deux lignes octobre/novembre (12 000 → 11 000 → 10 000, capital 2 000, coûts explicitement nuls). GET vérifié avant puis après « Utiliser ces lignes » : aucune ligne en base à ces deux étapes. Après Enregistrer, deux lignes persistées, principal contractuel 12 000 et encours observé 11 000 inchangés. Réédition sans réimport puis rechargement : deux lignes et référence CSV conservées. SQL local confirme deux échéances et toujours deux observations d’encours. Rendu bureau et formulaire mobile inspectés. Pas de test d’écriture en production.

Limites inchangées : CSV au format imposé uniquement ; aucun PDF original conservé ni reconnu, pas de mapping libre ni validation du dossier CIC complet. Le formulaire exige encore les termes contractuels : observation seule et champs avancés sont B15–B18 après identité. Les dates préremplies et conventions du formulaire historique ne constituent pas la saisie adaptative finale. B10 qualifie la première tranche de PR 50 ; la phase 3 complète reste ouverte. Prochaine étape : PR 51/B11, puis B12–B14 identité personnelle.

## Reprise PR 51 — B11, 14 septembre

Baseline : `fcba26920300e7b5bf4571e6f8fca543f0bb20ee`. Source PR 51 relue sur GitHub : `916cfe7754c8d80824ea725072c8ba4f2725a131`, ouverte. Fusion locale avec résolution du conflit de Patrimoine : canvas, modèle de présentation, inspecteurs et tiroir de PR 51 conservés ; exigences B07 reportées dans le tiroir. A12 résolue à court terme : l’action disponible porte exactement « Ajouter un compte », dans le manifeste, l’en-tête et le formulaire. Les actifs/passifs génériques restent B55.

Réutiliser : bilan canonique, partition de PR 51, agrégation des lignes déjà converties, clôtures et RPC, MoneyInput/DateInput. Étendre : date de création transportée jusqu’à la mutation et reprise de la date/du solde existants pour une correction ; démontage du tiroir fermé pour éviter de conserver le brouillon d’une autre ouverture. Cette reprise explicite l’arbitrage avec le tiroir original de PR 51 qui proposait une nouvelle observation vide : une correction conserve les faits précédemment enregistrés ; une création reste vide.

Défauts de relecture corrigés :
- La date maximale du formulaire vient de `dates.today` calculé par le serveur, pas de l’ancienne clôture. Une observation actuelle après une clôture passée est acceptée.
- Le bouton de nouvelle clôture propose aujourd’hui. Le repository recalcule les contributions/FX au contexte courant (`TODAY`) avant persistance et refuse d’antidater les observations courantes. La même commande de Chronologie utilise ce jour. La reconstruction historique n’est pas disponible et n’est pas simulée.
- La surface mesurée d’une famille vaut exactement son poids × 340 px, sans minimum visuel. Les libellés occupent un espace neutre séparé ; zéro n’a pas de surface mesurée. Une famille partielle n’a pas de hauteur mesurée, conserve son montant connu textuel et affiche sa réserve. La hauteur de la zone inconnue suit le contenu pour éviter la coupure.
- Le bouclage neutralise seulement les écarts binaires sous une tolérance relative, plafonnée à 0,001 unité. Le cas 1 794,41 + 333,33 + 0,30 ne produit plus une fausse alerte ; un écart réel de 0,01 reste détecté.
- La variation de deux clôtures indique les deux dates, sans l’attribuer au patrimoine courant.

Contrôle de livraison : **2 251 tests / 139 fichiers**, ESLint, TypeScript et build réussis. Dernier changement CSS de hauteur inconnue vérifié séparément. Relecture indépendante finale : 67 tests / 8 fichiers exécutés, aucun défaut matériel restant démontré, verdict code favorable. Sa tentative de preuve SQL indépendante a été bloquée par son sandbox ; les preuves SQL suivantes ont été exécutées par l’agent principal et ne sont pas attribuées au relecteur.

Recette locale : création au clavier depuis le tiroir de « Compte recette B11 », 123,45 EUR au 14 septembre. Rechargement réussi. Correction explicite à zéro depuis Analyse détaillée ; date conservée ; nouveau rechargement et SQL confirment deux observations 123,45 puis 0 au 14 septembre, sans écrasement. Dette B09 retrouvée au passif à 11 000 ; total net suit actifs moins passifs.

Clôture : fixture antérieure du 31 août créée directement dans la base locale à 100, distincte du test applicatif. Le bouton Patrimoine propose le 14 septembre ; après clic, SQL confirme une nouvelle clôture du 14 septembre, version 1, net 8 711 790,27 (avant correction du compte à zéro), avec composition courante. L’ancienne clôture demeure version 1 / 100. POST de clôture datée du 31 août ensuite refusé (500, message public générique), SQL confirme toujours exactement ces deux clôtures. L’ancienne fixture sans composition n’est pas déclarée comparable à la nouvelle.

Limites : aucune publication distante, aucune écriture de production, Auth et isolation multi-utilisateur non validées. La vue Patrimoine consomme encore le modèle global ; B09 n’a extrait que Dettes. Les comptes financiers sans quote-part entrent en totalité avec avertissement, aucun droit de détention inventé. La reconstruction des arrêtés historiques n’est pas livrée. B57 global et les cent situations restent ouverts. Étape suivante obligatoire : B12/B13/B14, session personnelle et espace vierge, avant toute donnée personnelle.
