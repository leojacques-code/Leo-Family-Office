# Brouillon conservé, non intégré

Archive du workspace antérieur à la reprise depuis GitHub : 11 fichiers modifiés ou non suivis, copies exactes, patch Git et manifeste SHA-256. Base : `52542b9073f4774a4443f0229a862d65dd7e5497`.

Archive SHA-256 : `f7436fbdd77ba495dde2ac32b0d298ee9edd0f09f448869cc58fe8e02e905d52`.

Ce lot sur la devise des projections n'est pas validé de bout en bout. Les 17 tests ciblés du 23 septembre utilisaient des moteurs mockés ; aucune recette réelle de simulation/persistance n'a abouti. Les vérifications de calcul restent différées par l'utilisateur. `next-env.d.ts` conserve uniquement un état généré de développement.

Pour examiner : extraire dans un répertoire temporaire, lire `manifest.json`. `workspace/` contient chaque fichier original ; `tracked.patch` s'applique à la base indiquée (les fichiers non suivis viennent de `workspace/`). Ne jamais recopier les gros fichiers entiers sur la consolidation récente : comparer et reporter seulement les changements retenus après réconciliation Supabase.

La branche de reprise part du HEAD GitHub `749ac119b4679d06b6f94caa711b0cad39528c3e`. L'archive est une sauvegarde, pas du code applicatif actif.
