# Sauvegarde LFO — 23 septembre 2026

Cette branche est un snapshot du chantier. Les archives Git conservent l’historique et les identifiants originaux, distincts du commit du snapshot GitHub.

- Branche originale : `codex/lfo-consolidation-20260911`
- Dernier commit original : `49835c503df3cc1f7c92800fe45f7c7bf9fb88e2`
- Arbre source exact : `ba9e1453c788323bc247daa5362928f05cb91863`

## Archives à appliquer dans cet ordre

1. `LFO_historique_2026-09-15.bundle` — SHA-256 `56880f1b45f5b003dbd60026d2ad935f7d7f79cb6b2c0aa1e964bb87a5c9b9bc`.
2. `LFO_contexte_2026-09-22.bundle` — SHA-256 `28df955828c7b69a64e0b67f869a41bc20fd0f3792ef0ab350a74fca4daefc2c`.
3. `LFO_devises_dettes_2026-09-22.bundle` — SHA-256 `7ccd1a3757cf73cc28a4a92d4c3450a02d6363e9bc355187593aec17569c2c1a`.
4. `LFO_devises_objectifs_2026-09-23.bundle` — SHA-256 `44a0b9ec71ae355dd78129c1bf3e0a5fdd28759b9da14f966d78c9ed64f1effb`.

La première archive est complète jusqu’à b555092 ; les suivantes prolongent successivement le contexte personnel, les devises Dettes puis les devises Objectifs. Réunies, elles restaurent le chantier sans ancien dossier local, y compris les fusions locales des PR 50 et 51.

## Restaurer depuis un clone de cette branche

```sh
shasum -a 256 docs/consolidation/sauvegarde/*.bundle
git clone --branch codex/lfo-consolidation-20260911 docs/consolidation/sauvegarde/LFO_historique_2026-09-15.bundle ../LFO-restaure
git -C ../LFO-restaure bundle verify "$(pwd)/docs/consolidation/sauvegarde/LFO_contexte_2026-09-22.bundle"
git -C ../LFO-restaure fetch "$(pwd)/docs/consolidation/sauvegarde/LFO_contexte_2026-09-22.bundle" refs/heads/codex/lfo-consolidation-20260911
git -C ../LFO-restaure merge --ff-only FETCH_HEAD
git -C ../LFO-restaure bundle verify "$(pwd)/docs/consolidation/sauvegarde/LFO_devises_dettes_2026-09-22.bundle"
git -C ../LFO-restaure fetch "$(pwd)/docs/consolidation/sauvegarde/LFO_devises_dettes_2026-09-22.bundle" refs/heads/codex/lfo-consolidation-20260911
git -C ../LFO-restaure merge --ff-only FETCH_HEAD
git -C ../LFO-restaure bundle verify "$(pwd)/docs/consolidation/sauvegarde/LFO_devises_objectifs_2026-09-23.bundle"
git -C ../LFO-restaure fetch "$(pwd)/docs/consolidation/sauvegarde/LFO_devises_objectifs_2026-09-23.bundle" refs/heads/codex/lfo-consolidation-20260911
git -C ../LFO-restaure merge --ff-only FETCH_HEAD
git -C ../LFO-restaure rev-parse HEAD
git -C ../LFO-restaure rev-parse 'HEAD^{tree}'
git -C ../LFO-restaure fsck --full
```

Les identifiants doivent correspondre au commit et à l’arbre ci-dessus. Le source de cette branche est identique à cet arbre hors `docs/consolidation/sauvegarde`, ajouté pour les archives et ce guide.

## État du chantier

Lire `docs/consolidation/REPRISE.md` et les preuves associées. Dernière tranche : cible et observations Objectifs portent leur devise ; versionner un objectif conserve celle de sa cible. Une devise absente est refusée explicitement avant écriture. 17 tests ciblés sans calcul, revue indépendante, lint, build/TypeScript et recette SQL/navigateur isolée réussis. La base de recette a été supprimée après vérification de l’historique USD et du refus HTTP 400 sans nouvelle version.

Le choix global de devise reste fermé ; Decision Lab, Scénarios/Monte-Carlo, Immobilier et les autres consommateurs restent à reprendre. B14 demeure partiel. Auth/Storage à deux utilisateurs ne sont pas certifiés par les fixtures locales. Aucune migration distante, ressource payante ni publication Vercel. Les tests de calcul financier restent reportés à la demande de l’utilisateur. Les secrets et données de production ne sont pas inclus.
