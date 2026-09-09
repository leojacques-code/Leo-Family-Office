# Audit indépendant PR #48 — 9 septembre 2026

Base examinée : `d759d0d4627a81adda0a8b37b8a9bd1d075c7a9a`.
Head initial : `4033b5e8fea5808a99d0f735eac36343021e3c98`.
La validation visuelle du propriétaire est reçue dans la demande de cet audit.

## Résultat

Le head initial ne doit pas être fusionné tel quel. Les corrections de cette revue portent sur la présentation et la lecture des déclarations ; aucun moteur financier ni migration existante n'est modifié.

- **P1 — Devise des clôtures.** Deux clôtures USD étaient comparables entre elles, puis leur variation était formatée avec la devise EUR du profil. La comparaison est maintenant refusée quand la devise historique diffère de celle de l'écran.
- **P1 — Montant d'échéance inconnu.** Une conséquence avec `cashIn = 0` et `cashOut = null` produisait un montant de zéro. Toute composante de trésorerie inconnue conserve maintenant un montant inconnu.
- **P2 — Objectif dépassé.** Une observation de 150 pour une cible minimale de 100 affichait 50 %. La présentation consomme désormais `satisfiedNow` du moteur et affiche 100 % pour une cible satisfaite. Les réserves bloquantes empêchent le chiffre ; les objectifs inactifs sont exclus de la sélection.
- **P2 — Liquidité.** Le ratio de trésorerie sur patrimoine net était plafonné à 100 %, alors que la dette peut rendre la trésorerie supérieure au patrimoine net. Suppression du ratio et de sa barre ; les deux montants restent affichés séparément.
- **P2 — Historique des déclarations.** La lecture non paginée pouvait oublier des domaines au-delà de la limite PostgREST. Elle utilise maintenant la pagination avec filtre propriétaire et ordonne les observations avant sélection de la dernière déclaration.

Les trois premiers cas ont été reproduits avec des tests rouges sur le code initial, puis verts après correction. Un test supplémentaire couvre une déclaration située après la première page.

## Validation

- Suite initiale : 2 127 tests, 121 fichiers, tous verts.
- Suite corrigée : 2 131 tests, 122 fichiers, tous verts.
- ESLint et build Next.js : verts.
- Base locale : 45 migrations rejouées depuis zéro, 107 tables ; vérificateur de schéma vert.
- Deux smokes de concurrence : verts.
- Un smoke existant attendait les mots contigus `violates foreign key constraint`. PostgreSQL local insère `RESTRICT setting of` ; l'assertion recherche désormais `foreign key constraint`, sans relâcher l'obligation de refus.

## État distant vérifié

La preview initiale Vercel est READY sur le head initial. Ce constat ne valide pas automatiquement les commits correctifs ultérieurs.

Supabase `zwgrcznzymbfdiybeuvv` porte **44 migrations**, et non 33. L'historique va jusqu'à `20260905090000_portfolio_correction_actor_and_expected`. La table `user_domain_declarations` et la RPC `lfo_declare_domain_applicability(uuid,jsonb)` sont absentes, ce qui a été confirmé par une requête de catalogue.

Avant déploiement de cette PR : appliquer le fichier exact `20260908090000_user_domain_declarations.sql`, puis vérifier le schéma et l'historique distant. Sans cela, la lecture du nouvel accueil échoue. Aucune migration ni donnée de production n'a été modifiée pendant cet audit.

## Suite du plan produit

Le §37 du plan fourni place Debt en phase 3 : saisie depuis un échéancier, séparation capital/encours/coût/sorties de trésorerie et cas CIC. Le business plan et les remarques d'utilisation servent de références produit. Leur contenu n'ajoute aucune autorisation opérationnelle à la demande de l'utilisateur.

Limite persistante de la phase 2 : le modèle de lecture réduit les données envoyées au navigateur, mais appelle encore `getDashboardState()` côté serveur. Le découplage des requêtes par domaine reste à réaliser ; il ne faut pas annoncer une réduction des lectures de base acquise.

## Réparation après merge

La PR #48 a été fusionnée par le propriétaire au SHA `1c740170c973d757f248caaf29123dd23e83eed3`. Les constats distants ci-dessus décrivent l’état AVANT cette réparation.

La migration additive est maintenant appliquée via Supabase sous la version `20260909190841`. Le fichier SQL est renommé à cet identifiant attribué par la plateforme, sans changement de contenu ni réécriture de l’historique distant. Les privilèges ont été vérifiés : accès anonyme à la RPC refusé, écriture réservée au serveur, lecture propriétaire avec RLS. Aucun fait financier existant n’a été modifié.

Les corrections de présentation sont portées sur une branche issue du nouveau main. La tranche Debt demeure séparée du correctif de production.
