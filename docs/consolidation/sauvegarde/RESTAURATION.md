# Sauvegarde LFO — mise à jour du 22 septembre 2026

Cette branche contient le code et les preuves de la consolidation locale jusqu’à la correction des devises du parcours Dettes, dépendance de B14. Le commit GitHub est un instantané distinct ; les archives ci-dessous préservent les identifiants originaux.

- Branche de travail originale : `codex/lfo-consolidation-20260911`
- Dernier commit original : `94bb175f5a8ee3da516773bd689823d16d6001ef`
- Arbre exact du code original : `ba42b98b771b43c2037e13e9a0182c63585d2f9e`
- Base conservée dans l'archive complète du 15 septembre : `b55509230940da170f5257fb1282e2673cc56f17`

## Archives conservées

1. `LFO_historique_2026-09-15.bundle` : historique complet jusqu'à la base, SHA-256 `56880f1b45f5b003dbd60026d2ad935f7d7f79cb6b2c0aa1e964bb87a5c9b9bc`.
2. `LFO_contexte_2026-09-22.bundle` : complément contenant le nouveau commit et ses objets, SHA-256 `28df955828c7b69a64e0b67f869a41bc20fd0f3792ef0ab350a74fca4daefc2c`. Cette archive incrémentale s'applique après restauration de la première.

3. `LFO_devises_dettes_2026-09-22.bundle` : complément Dettes après le commit `c345fa679764b94e403ee769b9a6c1809d9af23c`, SHA-256 `96949f6f1207f197d1a3e7645b7b8a265f6d2ff59f9580f5d8274b3f920c0e5f`.

Les trois archives réunies permettent de restaurer tous les commits du chantier local, y compris les fusions locales des PR 50 et 51. Aucun ancien dossier local n'est nécessaire.

## Restaurer

Depuis la racine d'un clone de cette branche GitHub :

```sh
shasum -a 256 docs/consolidation/sauvegarde/*.bundle
git bundle verify docs/consolidation/sauvegarde/LFO_historique_2026-09-15.bundle
git clone --branch codex/lfo-consolidation-20260911 docs/consolidation/sauvegarde/LFO_historique_2026-09-15.bundle ../LFO-restaure
git -C ../LFO-restaure bundle verify "$(pwd)/docs/consolidation/sauvegarde/LFO_contexte_2026-09-22.bundle"
git -C ../LFO-restaure fetch "$(pwd)/docs/consolidation/sauvegarde/LFO_contexte_2026-09-22.bundle" refs/heads/codex/lfo-consolidation-20260911
git -C ../LFO-restaure merge --ff-only FETCH_HEAD
git -C ../LFO-restaure bundle verify "$(pwd)/docs/consolidation/sauvegarde/LFO_devises_dettes_2026-09-22.bundle"
git -C ../LFO-restaure fetch "$(pwd)/docs/consolidation/sauvegarde/LFO_devises_dettes_2026-09-22.bundle" refs/heads/codex/lfo-consolidation-20260911
git -C ../LFO-restaure merge --ff-only FETCH_HEAD
git -C ../LFO-restaure rev-parse HEAD
git -C ../LFO-restaure rev-parse 'HEAD^{tree}'
git -C ../LFO-restaure fsck --full
```

Les identifiants obtenus doivent correspondre au dernier commit et à l'arbre ci-dessus. Le code de cette branche de sauvegarde est identique à cet arbre, à l'exception du répertoire `docs/consolidation/sauvegarde` qui contient ces archives et ce guide.

## État du chantier

Lire `docs/consolidation/REPRISE.md` et `docs/consolidation/preuves/LFO_contexte_recette.json`.

Le pays de résidence déclaré et la date de contexte sont enregistrables, facultatifs et repris après rechargement ; ils ne modifient ni les dates des faits ni la fiscalité. Le profil affiché remplace les mentions fixes France/LC. La devise existante est lue et préservée ; son changement reste indisponible tant que les consommateurs à formatage EUR fixe ne sont pas repris.

Validation : 48 tests ciblés dans 5 fichiers, revue indépendante favorable, lint, TypeScript, build, schéma SQL local (49 migrations), recette navigateur avec relecture SQL et captures bureau/mobile. Le contexte complet B14, les premiers faits minimaux restants et la recette Supabase Auth réelle avec deux utilisateurs ne sont pas déclarés terminés. Les nouveaux contrôles des calculs financiers restent reportés à la demande de l'utilisateur.

La base de recette est locale et son authentification est fictive. Aucune migration de production ni aucun déploiement Vercel n'a été effectué pour cette tranche. La branche Supabase payante n'a pas été créée. Les fichiers d'environnement privés et les données de production ne sont pas inclus.

Dernière tranche : les Dettes utilisent leur devise native dans les montants, messages, formulaire, aperçu CSV et graphique. Devise inconnue explicitée ; création actuellement EUR conformément à la RPC. 12 tests d’affichage avec moteurs simulés, revue indépendante, lint, TypeScript, build et recette bureau/mobile réussis. Aucune formule modifiée ni validation de calcul relancée. Les autres consommateurs restent à reprendre avant ouverture du choix global de devise. Voir `LFO_devises_dettes_recette.json` et REPRISE.md.
