# B19 — plan de déploiement à examiner avant fusion

**Plan préparé, aucune opération de production exécutée.** La PR #54 reste en brouillon.
Les autorisations actuelles couvrent le staging, les corrections et leur publication sur la
branche ; elles excluent les migrations de production, les dépenses et la fusion dans main.

## Références et preuve de compatibilité

`main` observée : `bd1782cae6b5f7141c3cc2765bd30c6a11a325fe`, 45 fichiers de migration.
La branche B19 en porte 66, soit 21 fichiers supplémentaires ; leurs chemins et SHA-256 sont
dans `preuves/reprise-b19-2026-10-22/inventaire-migrations-delta.json`.
Ce delta Git n'est pas l'inventaire courant d'une base de production. Le relevé distant
historique du 15 octobre reste une preuve datée, pas une nouvelle observation.

Une incompatibilité précise impose de coordonner le code et le schéma :

| Contrat | Code de main | Branche et schéma B19 | Conséquence |
| --- | --- | --- | --- |
| Correction d'une case de liasse | `document-repository.ts` transmet champ, action, valeur et motif sans révision attendue. | La RPC `lfo_correct_document_extraction_field` exige `expected_revision` ; le nouveau client la transmet et ne joint une valeur que pour une correction. | Une ancienne instance peut recevoir LF422 après migration. Une migration « en avance » avec les anciennes écritures encore actives n'est pas une bascule transparente. |
| Session et installation personnelle | Le schéma de main ne porte pas les nouvelles migrations de session/contexte. | Le code utilise vérification de session, intention et contexte personnels. | Le nouveau code ne doit pas être lancé sur un schéma resté au contrat antérieur. |
| Audit documentaire | Pas de journal B19 par case dans le delta initial. | Journal immuable, révision attendue et valeurs effectives, sans réécriture des traces anciennes. | Le retour arrière ne consiste pas à supprimer le journal ou à rétablir une RPC qui ignore les décisions nouvelles. |

La première ligne a été vérifiée dans `origin/main:src/lib/data/document-repository.ts`,
dans sa version de branche et dans `20261012140000_document_schedule_review.sql`.
La dernière migration `20261021153711` conserve ce contrat et corrige les valeurs consignées.

## Séquence proposée après levée des contrôles et autorisation distincte

1. **Figer la version et terminer B19.** Gate PostgreSQL local depuis zéro, smokes de
   concurrence, recette hébergée aux formats demandés, clavier/toucher et revue indépendante.
   Conserver le SHA, les journaux, l'inventaire SQL et les preuves d'isolation.
2. **Inventorier la cible réelle en lecture seule.** L'opérateur autorisé compare versions,
   noms et SQL déjà inscrits, schéma et précontrôles du dépôt. Le fichier
   `PRECONTROLES_MIGRATIONS_2026-10-12.sql` traite notamment les 24 références de propriétaire,
   les contraintes remplacées, les conventions historiques et les collisions de noms.
   Une version déjà appliquée avec un autre SQL arrête la procédure : migration additive
   à préparer, jamais remplacement de l'historique.
3. **Préparer une fenêtre coordonnée.** Valider sauvegarde restaurable, opérateur et procédure
   d'intervention ; empêcher les anciennes écritures documentaires pendant la bascule.
   Le mécanisme d'interruption/lecture seule doit être choisi et éprouvé avant intervention :
   aucune fonctionnalité de maintenance nouvelle n'est prétendue livrée ici.
4. **Appliquer le seul delta réellement absent**, dans l'ordre des versions, puis contrôler
   les contrats du schéma, signatures, RLS et droits RPC. Ne pas appliquer aveuglément « les
   21 fichiers » à une cible dont l'historique n'aurait pas été comparé. Une incohérence de
   propriétaire bloque la migration ; aucune correction métier automatique.
5. **Construire le code figé avec la configuration de la cible validée.** Vérifier identité
   du projet et de la base avant activation. Les variables de la Preview sont celles du
   staging ; ce déploiement de recette ne constitue pas le déploiement de production.
   Vérifier le déclenchement automatique éventuel sur main avant toute fusion.
6. **Contrôler la bascule avant réouverture.** Session vérifiée, lectures et pièces privées,
   domaines sans données et historique documentaire existant ; comparaison de schéma avec
   le vérificateur du dépôt. Toute action réelle en production demande une autorisation
   distincte ; aucune donnée synthétique de cette recette n'y est transférée.

Le plan retient une bascule coordonnée plutôt que d'affirmer une compatibilité continue que
le contrat de correction ne garantit pas. Une bascule sans interruption demanderait un lot
de compatibilité supplémentaire, spécifié et testé séparément.

## Retour arrière et arrêt

- Tant que seules les corrections de focus/CSS sont en cause, la Preview précédente est une
  référence de code ; aucun schéma n'a changé dans cette reprise.
- Le simple retour de l'application vers main après les migrations B19 n'est **pas qualifié**
  comme retour arrière : l'ancien client ne sait pas transmettre la révision obligatoire.
- Si la bascule échoue, maintenir les écritures concernées suspendues et décider entre
  correction compatible et restauration contrôlée. La sauvegarde, les écritures intervenues
  et les traces immuables doivent être pris en compte avant toute restauration.
- Aucun `DROP`, effacement d'audit, réécriture de version de migration ou rattachement
  automatique de lecture à un prêt n'est un mécanisme de retour arrière acceptable.

## Reproduction du gate sur une machine disposant de PostgreSQL

Le dépôt fournit déjà les commandes suivantes ; elles ne sont pas réexécutées ici contre
les protections de l'environnement qui ont bloqué le provisionnement :

```bash
# Base exclusivement locale et jetable, sans credential de production.
export LFO_LOCAL_DB_NAME=lfo_b19_gate
npm run db:local:up
npm run gate:local
```

Le reset refuse les hôtes non locaux. Le gate reconstruit les migrations, vérifie le schéma,
puis lance les smokes métier et trois smokes de concurrence. Sa réussite ne prouverait pas
l'état de la production ; les deux vérifications sont distinctes.

La préparation de ce plan lève le manque de procédure écrite. La compatibilité effective de
la cible, la disponibilité de la sauvegarde, le mode d'interruption, la revue et l'autorisation
de production restent à valider avant fusion. Aucun passage payant ou nouveau projet n'est requis
par ce document ni engagé par cette reprise.
