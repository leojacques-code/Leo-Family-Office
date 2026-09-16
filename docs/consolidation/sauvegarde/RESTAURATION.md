# Sauvegarde LFO du 16 septembre 2026

Cette branche conserve le code, les migrations, les documents de reprise et les cinq preuves visuelles après l'étape B14 partielle (nom de l'espace personnel et première intention). Elle contient également l'historique Git local complet, dans une archive Git autonome.

## Identifiants à préserver

- Branche locale d'origine : `codex/lfo-consolidation-20260911`
- Dernier commit local : `b55509230940da170f5257fb1282e2673cc56f17`
- Arbre exact du code local : `d2a24fab5bf7006591a8e49fdad42a501a80bda0`
- Base main lors de la consolidation : `bd1782cae6b5f7141c3cc2765bd30c6a11a325fe`
- Archive : `LFO_historique_2026-09-15.bundle`
- SHA-256 de l'archive : `56880f1b45f5b003dbd60026d2ad935f7d7f79cb6b2c0aa1e964bb87a5c9b9bc`

Le commit de cette branche est un instantané publié par le connecteur GitHub. Il a son propre identifiant. L'archive préserve les identifiants des commits d'origine et le graphe des fusions locales des PR 50 et 51. Le code de l'instantané correspond exactement à l'arbre local ci-dessus ; seuls ce document et l'archive ont été ajoutés pour la sauvegarde.

## Restaurer le chantier et son historique

Après clonage de cette branche de sauvegarde, depuis la racine du dépôt :

```sh
shasum -a 256 docs/consolidation/sauvegarde/LFO_historique_2026-09-15.bundle
git bundle verify docs/consolidation/sauvegarde/LFO_historique_2026-09-15.bundle
git clone --branch codex/lfo-consolidation-20260911 docs/consolidation/sauvegarde/LFO_historique_2026-09-15.bundle ../LFO-restaure
git -C ../LFO-restaure rev-parse HEAD
git -C ../LFO-restaure rev-parse 'HEAD^{tree}'
```

Les deux dernières commandes doivent rendre le commit et l'arbre exacts indiqués ci-dessus. L'archive contient un historique complet : aucun ancien dépôt local n'est requis.

## État de la reprise

Lire `docs/consolidation/REPRISE.md` pour le détail, les preuves et les limites.

- B12 : sessions personnelles vérifiées et parcours d'authentification implémentés ; recette avec le véritable fournisseur Supabase Auth et deux utilisateurs encore à réaliser.
- B13 : isolation de 24 références entre propriétaires, migration et 25 contrôles de sécurité vérifiés en base locale.
- B14 partiel : accueil avec nom de l'espace et première intention optionnelle ; persistance, retour à l'édition, redirections et contrôle d'origine vérifiés localement.
- Validation de la dernière étape : 41 tests ciblés dans 8 fichiers, lint, vérification TypeScript et build ; parcours navigateur bureau et mobile, lecture SQL de la persistance. La recette utilise une authentification locale de test.
- Les nouveaux contrôles des calculs financiers restent reportés conformément à la demande de l'utilisateur.
- Le contexte complet de B14 et les étapes suivantes ne sont pas terminés. Aucune migration de production ni aucun déploiement Vercel n'a été effectué pour cette sauvegarde.
- Les fichiers d'environnement privés et les données réelles de production ne font pas partie de cette sauvegarde. Reconfigurer les secrets localement à partir de `.env.example` si nécessaire.

La branche payante de recette Supabase n'a pas été créée : sa facturation attend une confirmation explicite.
