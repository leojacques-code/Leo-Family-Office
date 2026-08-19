# Démarrer ici

Le dépôt est prêt à installer avec Node.js 22+ et pnpm :

```bash
pnpm install
pnpm test
pnpm dev
```

Puis ouvrir `http://localhost:3000` et utiliser le code local `leo-local-2026`.

Le fichier `README.md` mentionne `--frozen-lockfile`, mais le lockfile n’a pas pu être généré dans cette session car la politique Windows bloque toute exécution de `node.exe`. Utiliser donc `pnpm install` au premier démarrage ; pnpm créera le lockfile. Il faudra ensuite le conserver dans le versioning.

Avant une exposition Internet, configurer `SESSION_SECRET`, `LOCAL_ACCESS_CODE` et basculer vers Supabase Auth + RLS conformément à `docs/SUPABASE_SETUP.md`.

## Statut de vérification

- structure et fichiers JSON : vérifiés statiquement ;
- équations de réconciliation : recalculées indépendamment ;
- tests unitaires : écrits mais non exécutés dans cette session ;
- lint, build et vérification navigateur : non exécutés, `node.exe` étant bloqué par une stratégie de groupe Windows, y compris après installation officielle via WinGet.

Ne pas considérer le build comme certifié avant d’avoir exécuté `pnpm check` dans un terminal autorisant Node.
