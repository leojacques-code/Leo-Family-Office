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

## Identité personnelle — préparation B12, 14–15 septembre

Baseline : `2b9bacf51d8abf846c1d12566e92bf898e34d7cb`, reprises locales PR 50 puis PR 51 conservées. B12 est préparé dans le code, **pas clôturé** : les preuves Supabase Auth réelles et B13/B14 restent requises avant toute donnée personnelle.

Réutiliser : Supabase SSR installé, client serveur privilégié, RPC réservées à service_role, validations DTO et repositories métier. Remplacer : session par code partagé et propriétaire fixe en production, ainsi que le cache global des repositories. Chaque factory publique exige désormais un acteur vérifié pour la requête ; aucun identifiant du formulaire ne choisit cet acteur. Le client Auth publiable est distinct du client de données service_role.

Connexion e-mail/mot de passe et création depuis /login. La création attend la confirmation d’adresse selon la configuration du fournisseur et n’initialise qu’un profil vide, sans faits financiers. Cookies HttpOnly, SameSite=Lax, Secure en production ; le proxy transporte aussi leurs renouvellements/suppressions dans les réponses de refus et redirections. getUser vérifie l’utilisateur auprès d’Auth ; le JWT fourni par getSession sert seulement à relier sub/session_id à cet utilisateur. Le lecteur SQL privé vérifie la session, not_after, la suspension et la suppression de l’utilisateur. Une panne du contrôle refuse l’accès.

Migration nouvelle créée avec Supabase CLI : `20260914191901_verified_personal_session.sql`. Wrapper public SECURITY INVOKER et lecteur lfo_private SECURITY DEFINER à search_path vide ; seuls les appels service_role sont autorisés. Aucun changement appliqué au projet distant. Le code d’accès historique reste utilisable seulement hors production, avec LFO_AUTH_MODE=local-fixture et une URL Supabase HTTP loopback ; OWNER_USER_ID n’est utilisé que dans ce mode fictif explicite.

Déconnexion : un refus Auth ou une panne réseau affiche « Déconnexion non confirmée » et conserve l’écran ; la navigation vers /login ne se fait qu’après acquittement. Tests du refus et du réessai ajoutés. Un formulaire personnel refuse les champs d’acteur injectés et le code local historique. Les erreurs du fournisseur ne sont pas publiées.

Vérifications : `npm run check` réussi, **2 274 tests / 143 fichiers**, marqueurs de conflit, lint, TypeScript et build Next.js. Relecture indépendante initiale 47 tests, puis complément 33 tests / 7 fichiers ; ces nombres se recouvrent, ils ne s’additionnent pas au total. Aucun défaut matériel restant démontré ; avis favorable pour le code préparé, sans certification Auth réelle. La dernière notification finale du relecteur a rencontré sa limite d’usage après transmission de son verdict et des résultats.

SQL : base native distincte `lfo_auth_gate` sur loopback 55439, reconstruite depuis zéro avec **46 migrations / 107 tables**. Vérification read-only : **436 contraintes, 116 RPC**, 18 triggers, 40 tables d’audit, RLS/grants, Storage et historique conformes. `scripts/smoke-personal-session.ts` refuse les hôtes distants ; transaction rollbackée après 10 contrôles d’identité/expiration/suspension/suppression/révocation et 4 refus effectifs sous anon/authenticated. Les shims auth.sessions/auth.users ne simulent pas le fournisseur Auth. Cette preuve SQL n’est pas B13.

Navigateur, build production servi uniquement sur localhost:3108 : connexion personnelle visible malgré le mode local-fixture du fichier de recette (refusé en production), bascule vers création fonctionnelle, mot de passe de création minimum 12 caractères. Bureau et mobile 390×844 inspectés ; scrollWidth=390, formulaire=360, aucune erreur navigateur relevée. Aucun compte créé par ce contrôle visuel ; pas de preuve de cookies réels ou d’envoi d’e-mail.

Suite bloquante à fournir : environnement Supabase Auth de recette distinct. Le projet LFO n’avait que sa branche main au contrôle distant du 14 septembre. Le connecteur get_cost impose de demander l’organisation avant de chiffrer une branche, puis d’en faire confirmer le coût avant création. L’organisation actuelle proposée est `wniscyevfmnmtzbmjwlx` ; réponse utilisateur encore attendue. Aucun contournement via des écritures de test dans la production.

À exécuter sur la recette confirmée : configurer Auth/URL de confirmation et variables, appliquer les migrations, créer A/B dans deux contextes navigateur séparés, vérifier espace vierge puis premier compte daté/rechargement, interdire lectures/mutations/références et objets Storage croisés, provoquer renouvellement/expiration/révocation puis contrôler l’ancien cookie. L’absence d’accès doit être constatée côté API et données, pas seulement dans l’interface. B12/B13/B14, F04, B57 et les cent situations restent ouverts. La récupération du mot de passe et les paramètres d’envoi Auth ne sont pas validés.

Publication inchangée : commits locaux seulement. Le push GitHub public demeure suspendu après refus antérieur du contrôle automatique ; propriété du dépôt ensuite vérifiée, demande précise de publication toujours à résoudre. Aucun déploiement Vercel ni migration de production effectué dans ce lot.

## Isolation des références — préparation B13, 15 septembre

Baseline locale : `a7c2de1dbe2b2adc23b808e10698d70cdb0cc9cc`. Nouvelle instruction utilisateur : ne pas lancer de nouvelles vérifications des calculs financiers ; poursuivre le chantier. Les contrôles de confidentialité suivants ne vérifient aucun résultat de moteur financier.

Défaut prouvé en SQL local avant correction : authenticated A pouvait créer account_balances(user_id=A, account_id=compte B). Le compte B lui restait invisible, mais la FK simple ne contrôlait pas son propriétaire. Le DELETE CASCADE pouvait ensuite supprimer cette ligne de A lors de la suppression du compte B. Le nouveau smoke échouait sur ce cas avant migration.

Inventaire : 24 FK simples entre tables publiques par propriétaire n’étaient pas couvertes par un lien composite. Migration `20260915064740_personal_reference_isolation.sql`, créée via CLI Supabase : remplacement sous les mêmes noms par (référence,user_id), conservation de MATCH SIMPLE et des actions NO ACTION/CASCADE/SET NULL. Pour bank_institutions, SET NULL porte seulement sur institution_id. Quatre index uniques parent et dix-neuf index enfant manquants ajoutés ; onze index redondants retirés après relecture. Aucun deuxième lien relationnel ambigu introduit.

Précontrôle : chaque référence historique croisée bloque la migration avec un message de table/champ, sans identifiant ni suppression/réaffectation automatique. Une migration avec données incohérentes n’est pas forcée. Les deux liens de versions scenarios/decision restent inchangés : leur propriété est déjà imposée transitivement par le parent commun et les FK composites existantes. Le nouveau garde du verifier couvre les FK simples ; il ne certifie pas toutes les futures constructions composites.

Vérification locale finale : reconstruction de **47 migrations / 107 tables** ; verifier complet **436 contraintes / 116 RPC**, RLS/grants, historique et Storage SQL conforme. `scripts/smoke-personal-isolation.ts` : **25 contrôles** réussis, transaction rollbackée, accès propres et refus croisés A/B, refus d’appel RPC navigateur, refus de référence croisée via RPC serveur, documents/métadonnées, cascade propre, SET NULL conservant user_id, référence facultative et blocage d’une incohérence historique sans effacer son fait. Lint et TypeScript passent. Aucun test de calcul relancé. Relecture indépendante favorable sur le code et les logs ; ces scripts ont été exécutés par l’agent principal, pas par le relecteur.

Supabase distant : autorisation d’utiliser l’organisation LFO reçue. get_cost annonce 0,01344 USD/heure pour une branche ; prix communiqué avec besoin de confirmation imposé par le connecteur. Le message suivant demande de passer les vérifications de calcul, sans confirmer explicitement la ressource payante : aucune branche créée. Cela ne vaut pas validation Auth réelle, Storage HTTP, export ou rapport à deux sessions. B12/B13/B14 restent ouverts sur ces preuves ; leur implémentation indépendante peut progresser. Aucune migration distante, publication GitHub ou production modifiée.

## Accueil personnel reprenable — première tranche B14, 15 septembre

Baseline : `ba72da311f96870f5122be04f63cffb898578faf`. Conserver : profiles, identité B12, routes des six domaines, espace vierge. Étendre uniquement : nom de l’espace et première intention facultative. `/setup` enregistre les choix via `/api/profile/setup`, les reprend à la lecture serveur et propose la page liée à l’intention. « Je choisirai plus tard » persiste null ; aucun objectif, portefeuille cible ou hypothèse financière n’en est déduit. « Mon espace » permet la modification ultérieure. Une erreur conserve le brouillon sans annoncer de succès ; une lecture échouée ne remplace pas les préférences par un profil neuf.

Migration `20260915180426_personal_first_intent.sql` créée par Supabase CLI : une colonne nullable et une contrainte des quatre intentions, sans défaut implicite ni backfill. Repository construit avec requireActor ; seules display_name et first_intent sont écrites. La devise et les faits restent intacts. Schéma/API stricts, acteur ou champ financier injecté refusé.

Relecture : premier accès via /login?next=/ contournait l’accueil ; corrigé par passage systématique via /setup avec destination interne conservée. Un profil configuré rejoint cette destination, tandis que le formulaire neuf la conserve comme accès facultatif. Origines externes, caractères de contrôle et boucles login/setup refusés. Recette locale : l’ancienne comparaison origin à l’URL interne Next refusait l’hôte navigateur 127.0.0.1 ; le contrôle commun compare désormais l’Origin au Host reçu et au protocole direct/transmis, avec tests positifs et négatifs.

Validation : **41 tests ciblés / 8 fichiers**, uniquement accueil, sessions, origine, confidentialité et reprise ; lint, TypeScript et build réussis. Les tests financiers complets n’ont pas été relancés, conformément à la demande utilisateur. Reconstruction SQL locale avec **48 migrations / 107 tables**, verifier **437 contraintes / 116 RPC** réussi.

Preuve navigateur sur la base locale distincte lfo_auth_gate (PostgREST 55446, passerelle 55447, Next 3109) : racine → login?next=/ → accueil ; nom fictif « Famille recette B14 » et intention PROJECT saisis puis enregistrés. Rechargement /setup?edit=1 retrouve ces valeurs et le lien Ouvrir mes objectifs. SQL confirme nom/intention, devise EUR conservée, zéro compte, dette, revenu, société, objectif et document. Rendus 1280×900 et 390×844 inspectés ; scrollWidth=390 en mobile, aucune erreur navigateur. Le code de recette local reste une fixture : ce parcours ne valide pas Supabase Auth réel.

Périmètre non achevé de B14 : contexte de résidence/devise/date, premier fait minimal de chaque domaine, reprise documentaire et recette Auth/Storage à deux utilisateurs. Les seules étapes nom/intention sont livrées ici ; aucune clôture globale B12/B13/B14 ni du projet.

Publication : le 15 septembre, l’utilisateur demande explicitement de soumettre tout le travail à GitHub après cette étape afin de disposer d’une sauvegarde distante. La propriété et les droits push du dépôt public leojacques-code/Leo-Family-Office sont de nouveau confirmés. Cette autorisation permet de reprendre le push précédemment suspendu ; elle n’autorise pas à prétendre la recette distante validée ni à effectuer une migration de production.

Relecture indépendante finale B14 : 37 tests ciblés / 7 fichiers réellement exécutés, sans calcul financier ; défaut de routage levé, contrôle d’origine relu, verdict favorable pour cette tranche partielle.


## Sauvegarde distante — 16 septembre

La branche `codex/lfo-backup-20260916` a été publiée au commit `f7ca2fc91160256b89a674efae82a8010c001876`. Son arbre source correspond exactement à la consolidation locale `b55509230940da170f5257fb1282e2673cc56f17`. Une archive Git autonome conserve les identifiants et tout l’historique original. Récupération depuis GitHub, comparaison du code, clone neuf depuis l’archive et `git fsck --full` réussis. Cette publication autorisée lève le blocage GitHub cité dans les notes historiques précédentes.

## Contexte personnel reprenable — deuxième tranche B14, 22 septembre

Baseline locale : `b55509230940da170f5257fb1282e2673cc56f17`. Références : document 03 §3, document 07 §4, ticket B14. Conserver le profil, l’identité B12 et les modèles financiers. Réutiliser DateInput, validation calendaire et operationalToday. Étendre le formulaire/API/repository aux seuls pays déclaré et date de référence du contexte, tous deux facultatifs et sans valeur par défaut. Remplacer le nom fixe, les initiales LC et « EUR · France » du shell par le profil de l’acteur, lu séparément du modèle financier. Une absence est explicitement affichée.

La date décrit le contexte déclaré ; elle ne change aucune date de fait, date de valorisation ou règle fiscale. Le pays reste un texte déclaré, pas une résidence fiscale certifiée. Ce profil modifiable ne constitue pas un historique des résidences fiscales. Un contexte partiel peut être enregistré et repris ; aucune donnée financière n’est créée. Les anciennes valeurs pays/date demeurent null après migration. La devise est uniquement lue : l’API stricte refuse toute tentative de la modifier. La relecture a repéré le formatage EUR fixe de Currency dans src/components/ui.tsx ; ouvrir le choix de devise avant de reprendre ces consommateurs produirait de faux libellés. Le choix multidevise reste donc ouvert et n’est pas présenté comme livré.

Migration additive `20260917071520_personal_context.sql`, créée par CLI Supabase : deux colonnes nullable et contraintes de forme/calendrier. Application à la base locale lfo_auth_gate avec comparaison avant/après des champs préexistants : identiques. Vérificateur SQL : 49 migrations, 107 tables, 439 contraintes, 116 RPC, RLS/grants et Storage SQL conformes. Aucun schéma distant modifié.

Corrections de revue : suppression du refresh immédiat qui masquait l’acquittement en déclenchant la redirection de /setup ; navigation sortante native pour relire le profil après sauvegarde. Jour opérationnel Europe/Paris partagé entre page et API, avec test à 00 h 30. Profil absent : devise null plutôt qu’EUR inventé. Relecture indépendante finale favorable, 48 tests ciblés/5 fichiers exécutés par l’auteur puis séparément par le relecteur ; lint, TypeScript, build et diff --check réussis. Aucun test de calcul financier relancé.

Recette réelle locale : premier enregistrement complet depuis /setup?next=/, résidence fictive Suisse au 01/09/2026, intention PROJECT préexistante. Acquittement visible sans redirection ; réouverture /setup?edit=1 retrouve pays/date ; retour Aujourd’hui affiche le contexte dans le profil. La lecture SQL confirme la persistance, EUR préservé et zéro compte, observation de solde, dette, revenu, société, objectif ou document. Captures bureau 1280×900 et mobile 390×844 inspectées, aucune erreur navigateur ni débordement horizontal (390/390). Preuves dans docs/consolidation/preuves/LFO_contexte_*. Le champ date natif a été rempli par frappes individuelles au clavier ; fill et frappe groupée de l’année n’ont pas donné de preuve.

Incident de recette : PostgREST local conservait une ancienne description du schéma (PGRST204 sur context_date). NOTIFY puis SIGUSR1 n’ont pas levé ce cache ; remplacement du processus local après arrêt gracieux sans effet, puis enregistrement navigateur réussi. Le formulaire avait conservé ses saisies et n’avait annoncé aucun succès pendant le refus. Aucun changement de code métier requis pour cette panne.

Limites : B14 demeure partiel (choix de devise, premier encours/revenu minimal et parcours documentaire), ainsi que les preuves Supabase Auth réelles et Storage HTTP à deux utilisateurs de B12/B13. L’authentification utilisée ici est une fixture. La branche de recette Supabase payante attend toujours confirmation explicite ; la production n’est pas un environnement de test. Prochaine tranche : résoudre les consommateurs de devise avant son activation et poursuivre le premier fait minimal selon la séquence du kit, sans confondre dépendance documentaire B14/B15 et achèvement global.


## Sauvegarde du contexte — 22 septembre

La branche `codex/lfo-backup-20260916` a été mise à jour au snapshot `53a2130a0469539ddb8e28953c75d17db0d22762`. Le source correspond exactement au commit local `c345fa679764b94e403ee769b9a6c1809d9af23c`, arbre `47ad5fe838e5f3608d9f27b4bc1a57a696617889`. L’archive complète précédente et le complément `LFO_contexte_2026-09-22.bundle` conservent les commits originaux. Récupération GitHub, restauration dans un dépôt neuf, comparaison SHA/arbre et git fsck réussis. Main demeure inchangée.

## Devises des Dettes — dépendance B14, 22 septembre

Baseline : `c345fa679764b94e403ee769b9a6c1809d9af23c`. Conserver les faits, les commandes et les calculs. Étendre Currency et OptionalCurrency à une devise explicite ; leur défaut EUR historique reste réservé aux écrans non migrés. Réutiliser la devise native de Liability pour les cartes, échéances, explications, coûts, axes et infobulle. Une devise absente est explicitement inconnue, jamais remplacée par EUR. Le cash bancaire conserve la devise de lecture ; la comparaison reste fermée lorsque les devises diffèrent. Aucun taux de change ou conversion ajouté.

Le formatage pur partagé rend aussi les cinq messages monétaires de debt.ts dans la devise native. Seules leurs chaînes explicatives changent : aucune formule, branche de calcul ou résultat numérique modifié. L’axe réserve une largeur de 88 px aux libellés monétaires. L’aperçu CSV affiche la devise du contrat dans sa synthèse et ses lignes, sans convertir ni enregistrer automatiquement. Les montants du formulaire avancé sont couverts par l’annonce commune de devise ; l’encours observé l’annonce dans sa fenêtre.

Audit de persistance : lfo_save_debt_contract omet currency à l’INSERT (défaut SQL EUR) et ne la modifie pas à l’UPDATE. Le formulaire de création annonce donc désormais EUR, y compris si le profil lit CHF ; une édition garde la devise native existante. Cela ne livre pas la création de dettes multidevises. Aucun changement d’API ni migration.

Validation : 12 tests d’affichage / 2 fichiers, résultats financiers figés et moteurs simulés ; mêmes 12 tests exécutés séparément par le relecteur indépendant prévu au document 07 §4. Lint, TypeScript, build Next.js et git diff --check passent. Après ajustement visuel de la largeur de l’axe, TypeScript repasse. Les tests financiers ne sont pas relancés, conformément à l’instruction utilisateur. Le test existant de l’import est adapté à son nouveau paramètre et libellé, relu mais non exécuté dans cette tranche.

Recette navigateur locale réelle : profil EUR, dette USD fictive ajoutée uniquement dans lfo_auth_gate. Cartes, échéancier, graphique, messages de réserve et formulaire USD ; aucun symbole euro dans le contenu Dettes. CSV prévisualisé en USD sans sauvegarde. Captures finales bureau 1280×900 et mobile 390×844 inspectées ; largeur du document égale au viewport, aucune erreur navigateur. Le menu mobile est fermé et les captures attendent les boutons métier actifs. Preuves LFO_devises_dettes_* dans docs/consolidation/preuves. La dette de recette a ensuite été supprimée par son identifiant/source propres ; zéro dette restante. Les calculs se sont exécutés pour afficher l’écran, leurs résultats n’ont pas été vérifiés.

Relecture indépendante favorable : unités natives, cash, garde de comparaison, absences, formulaire et contrat SQL. Les messages moteurs et l’import ont été relus statiquement ; l’import a ensuite été observé au navigateur. Aucune certification de calcul ni d’Auth réelle.

Cartographie restante avant activation du choix de devise : Objectifs porte target.currency et observation.currency mais son édition réattribue reportingCurrency ; Decision Lab calcule avec le contexte mais n’en conserve pas la devise dans son DTO ; Immobilier porte portfolio/view.reportingCurrency avec quelques formatages EUR résiduels ; Scénarios V2 reçoit reportingCurrency mais les hypothèses historiques et événements restent EUR ou insuffisamment typés. Blocage particulier : /api/projection n’envoie pas reportingCurrency à Monte-Carlo, qui applique son défaut EUR, et ProjectionEnvelope ne porte pas de devise. Ne pas simplement réétiqueter ces percentiles dans la devise du profil. Les autres consommateurs Currency/OptionalCurrency restent à migrer selon leur contrat de données.

Suite : continuer ces consommateurs et les contrats de création/édition avant d’ouvrir le choix global ; puis reprendre le premier fait minimal de dette/revenu et le parcours documentaire. B14 demeure partiel ; Auth réelle et Storage HTTP A/B restent en attente de l’environnement de recette déjà décrit. Aucun déploiement Vercel ni modification distante Supabase effectué.


Complément visuel du même lot : la relecture des premières captures a révélé un tracé absent après l’animation d’entrée. Deux propriétés de rendu corrigées : axe de 88 px et animation d’entrée désactivée. Captures remplacées après attente du réseau et stabilisation ; courbe entière visible sur bureau et mobile, inspectée par l’auteur. Relecture indépendante statique favorable des deux propriétés ; les captures ne sont pas présentées comme inspectées par le relecteur. Lint ciblé et build avec TypeScript repassés. Fixture à nouveau nettoyée : zéro dette. Premier snapshot GitHub `74045fd2fa48ccd7b863fdd29756397cca3bae2c` restauré avec succès ; ce complément est sauvegardé à sa suite.
