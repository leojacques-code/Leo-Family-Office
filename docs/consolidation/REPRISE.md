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
