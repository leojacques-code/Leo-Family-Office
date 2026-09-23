# Annexes du chantier local — 23 septembre 2026

À la demande du propriétaire, ces 67 fichiers de travail voisins du dépôt complètent la sauvegarde du code : scripts ponctuels de préparation/recette, captures intermédiaires, rapports, patches et preuves de restauration. L’inventaire donne les chemins d’origine, tailles et SHA-256. L’archive conserve les octets exacts de chaque fichier.

Ces éléments sont historiques : les scripts d’édition et de recette ne sont pas un programme d’installation, ne doivent pas être rejoués automatiquement et certains contiennent des chemins locaux ou ciblent des bases de fixtures depuis supprimées. Les captures intermédiaires ne remplacent pas les preuves finales de `../preuves`. Les clés et identités mentionnées dans les lanceurs sont des fixtures locales explicitement identifiées ; aucun credential de production n’est inclus.

Le code courant et les migrations restent à la racine du dépôt. Son historique Git complet se restaure selon `../sauvegarde/RESTAURATION.md` sur la branche GitHub de sauvegarde. Les documents source fournis ne sont pas du travail produit par l’agent ; leurs références et empreintes sont dans `../REPRISE.md`. Les dépendances, caches, bases temporaires et secrets ne sont pas des livrables à publier.

Vérification : ouvrir l’archive ZIP, comparer chaque contenu au SHA-256 de l’inventaire. Aucune extraction ni exécution automatique n’est nécessaire.
