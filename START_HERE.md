# Démarrer ici

Le runtime exige Node.js 22+ et Supabase. Utiliser un projet de développement dédié ou Supabase CLI local ; ne jamais pointer le poste de développement vers la production par défaut.

```bash
npm ci
cp .env.example .env.local
```

Renseigner `SESSION_SECRET`, `LOCAL_ACCESS_CODE`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, `OWNER_USER_ID` et `SUPABASE_DOCUMENTS_BUCKET`.

Avant toute mise à jour du schéma :

```bash
supabase --version
supabase migration list
supabase db reset # cible locale uniquement
supabase db push --dry-run
supabase db push
npm run db:verify
```

Sur une base de développement entièrement vide seulement :

```bash
npm run seed:supabase
```

Le seed est one-shot et refuse une base contenant déjà des données. Il n’efface rien et n’accepte pas `--force`.

Enfin :

```bash
npm run check
npm run dev
```

Ouvrir `http://localhost:3000`. L’accès reste protégé par la session locale actuelle ; Supabase Auth n’est pas inclus dans cette migration.
