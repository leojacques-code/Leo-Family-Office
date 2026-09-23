# Sauvegarde LFO — 23 septembre 2026

Snapshot du chantier, distinct de l’historique original conservé dans les archives Git.

- Branche originale : `codex/lfo-consolidation-20260911`
- Dernier commit original : `2e55013bf17d2a778ec7e995ba4e0ab7f1b01da7`
- Arbre source exact : `4b9501316d5837c30772b842c65cf62f1cf57051`

## Archives à appliquer dans cet ordre

1. `LFO_historique_2026-09-15.bundle` — SHA-256 `56880f1b45f5b003dbd60026d2ad935f7d7f79cb6b2c0aa1e964bb87a5c9b9bc`.
2. `LFO_contexte_2026-09-22.bundle` — SHA-256 `28df955828c7b69a64e0b67f869a41bc20fd0f3792ef0ab350a74fca4daefc2c`.
3. `LFO_devises_dettes_2026-09-22.bundle` — SHA-256 `7ccd1a3757cf73cc28a4a92d4c3450a02d6363e9bc355187593aec17569c2c1a`.
4. `LFO_devises_objectifs_2026-09-23.bundle` — SHA-256 `44a0b9ec71ae355dd78129c1bf3e0a5fdd28759b9da14f966d78c9ed64f1effb`.
5. `LFO_devises_decisions_2026-09-23.bundle` — SHA-256 `14e6bae746edb9e8364475c22f822a2daa5b6da3e4d18b86f25b0bf14e179130`.

La première archive est complète ; les quatre suivantes conservent les commits successifs du contexte, des devises Dettes, Objectifs puis Décisions. Réunies, elles restaurent le chantier et ses fusions locales sans ancien dossier local.

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
git -C ../LFO-restaure bundle verify "$(pwd)/docs/consolidation/sauvegarde/LFO_devises_decisions_2026-09-23.bundle"
git -C ../LFO-restaure fetch "$(pwd)/docs/consolidation/sauvegarde/LFO_devises_decisions_2026-09-23.bundle" refs/heads/codex/lfo-consolidation-20260911
git -C ../LFO-restaure merge --ff-only FETCH_HEAD
git -C ../LFO-restaure rev-parse HEAD
git -C ../LFO-restaure rev-parse 'HEAD^{tree}'
git -C ../LFO-restaure fsck --full
```

Comparer les identifiants au commit et à l’arbre ci-dessus. Le source du snapshot est identique hors docs/consolidation/sauvegarde, ajouté pour ces archives et ce guide.

## État du chantier

Lire docs/consolidation/REPRISE.md et ses preuves. Dernière tranche : Decision Lab conserve la devise de ses résultats jusqu’au snapshot/API et les affiche avec cette unité. Une devise historique absente reste inconnue ; les objectifs gardent celle de leur observation. 14 tests ciblés sans calcul, revue indépendante, lint, build/TypeScript et recette SQL/navigateur locale réussis. Changement de contexte après sauvegarde et refus HTTP 400 vérifiés ; base jetable nettoyée. L’écran ne propose pas encore la sélection d’un cas sauvegardé.

Le choix global de devise reste fermé ; Scénarios/Monte-Carlo, Immobilier et les autres consommateurs restent à reprendre. B14 demeure partiel. Auth/Storage réels à deux utilisateurs ne sont pas certifiés par les fixtures. Aucune migration distante, ressource payante ni publication Vercel. Tests de calcul financier reportés à la demande de l’utilisateur. Les archives ne contiennent ni secrets ni données de production.
