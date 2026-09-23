# Restaurer le chantier LFO

Branche originale : `codex/lfo-consolidation-20260911`

Dernier commit original : `52542b9073f4774a4443f0229a862d65dd7e5497`

Arbre source exact : `ce14571534ad42d8449d537d4f97fc772c86f0fd`

## Archives ordonnées

- `LFO_historique_2026-09-15.bundle` : SHA-256 `56880f1b45f5b003dbd60026d2ad935f7d7f79cb6b2c0aa1e964bb87a5c9b9bc`
- `LFO_contexte_2026-09-22.bundle` : SHA-256 `28df955828c7b69a64e0b67f869a41bc20fd0f3792ef0ab350a74fca4daefc2c`
- `LFO_devises_dettes_2026-09-22.bundle` : SHA-256 `7ccd1a3757cf73cc28a4a92d4c3450a02d6363e9bc355187593aec17569c2c1a`
- `LFO_devises_objectifs_2026-09-23.bundle` : SHA-256 `44a0b9ec71ae355dd78129c1bf3e0a5fdd28759b9da14f966d78c9ed64f1effb`
- `LFO_devises_decisions_2026-09-23.bundle` : SHA-256 `14e6bae746edb9e8364475c22f822a2daa5b6da3e4d18b86f25b0bf14e179130`
- `LFO_annexes_locales_2026-09-23.bundle` : SHA-256 `d0ac51580037437a203f5c3e779f8f5bf68330b4067d540cbd8d157d83a1f1f0`

## Restauration depuis un clone de cette branche

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
git -C ../LFO-restaure bundle verify "$(pwd)/docs/consolidation/sauvegarde/LFO_annexes_locales_2026-09-23.bundle"
git -C ../LFO-restaure fetch "$(pwd)/docs/consolidation/sauvegarde/LFO_annexes_locales_2026-09-23.bundle" refs/heads/codex/lfo-consolidation-20260911
git -C ../LFO-restaure merge --ff-only FETCH_HEAD
git -C ../LFO-restaure rev-parse HEAD
git -C ../LFO-restaure rev-parse 'HEAD^{tree}'
git -C ../LFO-restaure fsck --full
```

Les identifiants obtenus doivent correspondre au commit et à l’arbre ci-dessus. Le snapshot GitHub expose le même source, auquel seul `docs/consolidation/sauvegarde` est ajouté. Les archives conservent tous les commits et fusions originaux. Les annexes du dossier local voisin sont sauvegardées dans `docs/consolidation/annexes-locales`, avec inventaire SHA-256.

Lire `docs/consolidation/REPRISE.md` pour les étapes réalisées, tests et limites. Les rapports et scripts annexés sont historiques, pas des instructions à exécuter. Les secrets, caches, dépendances et bases temporaires sont exclus. Aucun déploiement Vercel ni mutation Supabase distante. Les tests de calcul financier restent reportés à la demande de l’utilisateur.
