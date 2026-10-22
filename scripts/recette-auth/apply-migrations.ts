/**
 * Recette Auth locale, étape 3 : applique `supabase/migrations/` à la base préparée par
 * `db-init.sh`, avec le rôle `postgres` NON superutilisateur, comme `supabase db push` sur un
 * projet hébergé. Différences volontaires avec `db-local-reset.ts` (gate de schéma) :
 *
 * - aucune doublure `shim.sql` : les schémas auth et storage sont ceux de GoTrue et de
 *   Storage, créés par leurs propres migrations ;
 * - aucun propriétaire fictif ni profil inséré : la recette part d'un espace VIDE, et chaque
 *   utilisateur naît par Supabase Auth.
 *
 * Écart connu, ÉMULÉ et borné : en production, `postgres` crée les politiques de
 * `storage.objects` grâce à `supautils.policy_grants` (extension de plateforme absente d'un
 * PostgreSQL nu). La recette accorde `supabase_storage_admin` à `postgres` le temps des seules
 * migrations, puis le retire : aucune requête applicative ne bénéficie de ce droit.
 *
 * Refuse toute cible non locale.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.RECETTE_DB_URL;
if (!connectionString) throw new Error("RECETTE_DB_URL requis");
const url = new URL(connectionString);
if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname))
  throw new Error(`Cible non locale refusée : ${url.hostname}`);

const migrationsDir = path.resolve(import.meta.dirname, "..", "..", "supabase", "migrations");
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

const adminUrl = process.env.RECETTE_ADMIN_DB_URL;
if (!adminUrl || !["127.0.0.1", "localhost", "::1"].includes(new URL(adminUrl).hostname))
  throw new Error("RECETTE_ADMIN_DB_URL local requis");
const admin = new pg.Client({ connectionString: adminUrl, ssl: false });
await admin.connect();
await admin.query("grant supabase_storage_admin to postgres");

const client = new pg.Client({ connectionString, ssl: false });
await client.connect();
try {
  const role = await client.query<{ rolsuper: boolean }>(
    "select rolsuper from pg_roles where rolname = current_user",
  );
  if (role.rows[0]?.rolsuper)
    throw new Error(
      "Rôle superutilisateur refusé : la production applique en `postgres` rétrogradé.",
    );
  await client.query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations
      (version text primary key, statements text[], name text)`);
  const done = new Set(
    (
      await client.query<{ version: string }>(
        "select version from supabase_migrations.schema_migrations",
      )
    ).rows.map((row) => row.version),
  );
  let applied = 0;
  for (const file of files) {
    const base = file.replace(/\.sql$/, "");
    const version = base.slice(0, base.indexOf("_"));
    if (done.has(version)) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
        [version, base.slice(base.indexOf("_") + 1)],
      );
      await client.query("commit");
      applied += 1;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw new Error(`Migration ${file} refusée : ${(error as Error).message}`);
    }
  }
  await client.query("notify pgrst, 'reload schema'");
  const count = await client.query<{ migrations: string; tables: string; profiles: string }>(
    `select (select count(*) from supabase_migrations.schema_migrations)::text as migrations,
            (select count(*) from information_schema.tables
              where table_schema = 'public' and table_type = 'BASE TABLE')::text as tables,
            (select count(*) from public.profiles)::text as profiles`,
  );
  const row = count.rows[0]!;
  console.log(
    `${applied} migration(s) appliquée(s) ; historique ${row.migrations}/${files.length}, ${row.tables} tables publiques, ${row.profiles} profil(s).`,
  );
} finally {
  await client.end();
  await admin.query("revoke supabase_storage_admin from postgres");
  await admin.end();
}
