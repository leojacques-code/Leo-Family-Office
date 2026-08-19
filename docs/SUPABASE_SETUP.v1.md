# Configuration Supabase

La V1 fonctionne sans Supabase. Pour la déployer sur Internet :

1. Créer un projet Supabase dans une région UE adaptée.
2. Installer la CLI et vérifier sa version avec `supabase --version` puis découvrir les commandes avec `supabase --help`.
3. Relier le dépôt au projet, appliquer la migration de `supabase/migrations` et lancer les database/security advisors.
4. Configurer `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Ne jamais exposer la secret key ou une clé service role au navigateur.
5. Activer une méthode d’authentification privée. L’email magic link ou passkey peut remplacer le code local.
6. Implémenter le repository Supabase, en conservant les corrections manuelles prioritaires sur les connecteurs.
7. Tester RLS avec deux utilisateurs : l’utilisateur A ne doit jamais voir ni modifier une ligne de B.
8. Tester les uploads : insert, select, update et delete dans le dossier `{auth.uid()}/...` du bucket privé.

La migration tient compte du changement Supabase 2026 : les tables créées en SQL ne sont plus nécessairement exposées automatiquement à la Data API. Les grants `authenticated` sont donc explicites et couplés à RLS ; `anon` ne reçoit aucun accès aux tables.
