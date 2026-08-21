# Démarrer ici

Le dépôt s'installe avec **Node.js 22 ou 24**. npm est fourni avec Node : il n'y a aucun autre
gestionnaire de paquets à installer.

```bash
npm ci
npm test
npm run dev
```

Puis ouvrir `http://localhost:3000` et utiliser le code local `leo-local-2026`.

`npm ci` installe exactement les versions de `package-lock.json`. Au premier démarrage, si le
lockfile est absent ou désynchronisé, utiliser `npm install` une fois, puis versionner le
lockfile mis à jour.

Avant une exposition Internet, configurer `SESSION_SECRET`, `LOCAL_ACCESS_CODE` et basculer vers
Supabase Auth + RLS conformément à `docs/SUPABASE_SETUP.md`.

## Statut de vérification

Vérifié le 20 août 2026, sous Node 24 et npm 11 :

- `npx tsc --noEmit` : aucune erreur de typage ;
- `npm run build` : build de production réussi, 10 routes générées ;
- `npm test` : **27 tests passent** ;
- `npm run lint` : **9 erreurs**, 12 avertissements — toutes dans `src/components/pages.tsx`
  (`<a>` au lieu de `<Link>` pour la navigation interne, imports inutilisés).

Les erreurs de lint restantes sont connues et traitées dans la phase de nettoyage. Le reste de
la chaîne (install, typage, tests, build) est confirmé fonctionnel.
