/**
 * Reconstruit une base locale jetable à partir des seules migrations du repo, puis y
 * inscrit l'historique de migrations correspondant. Objectif : prouver, sans aucun
 * credential de production, que `supabase/migrations/` reproduit bien le schéma canonique
 * depuis zéro. `npm run db:verify:local` compare ensuite ce résultat au contrat du code.
 *
 * Ce script DÉTRUIT le contenu de sa base cible. Il refuse donc tout hôte non local, et
 * ne lit jamais `SUPABASE_DB_URL` : pointer accidentellement la production est impossible.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { diffExactInventory } from "./schema-diff.ts";

const { Client } = pg;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const MANAGED_SCHEMAS = ["public", "auth", "storage", "supabase_migrations"];
/** UUID fixe : les smokes ont besoin d'un propriétaire stable, jamais d'une donnée métier. */
const LOCAL_OWNER_ID = "00000000-0000-4000-8000-000000000001";

const repoRoot = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const shimPath = path.join(repoRoot, "supabase", "local", "shim.sql");

const connectionString =
  process.env.LFO_LOCAL_DB_URL ??
  `postgres://${process.env.LFO_LOCAL_DB_USER ?? "postgres"}:${
    process.env.LFO_LOCAL_DB_PASSWORD ?? "lfo_local"
  }@127.0.0.1:5432/${process.env.LFO_LOCAL_DB_NAME ?? "lfo_local"}?sslmode=disable`;

const url = new URL(connectionString);
if (!LOCAL_HOSTS.has(url.hostname)) {
  throw new Error(
    `Cible non locale refusée : ${url.hostname}. Ce script détruit sa base ; il n'accepte que ${[...LOCAL_HOSTS].join(", ")}.`,
  );
}

/** Le nom de fichier est la source de la version : `<version>_<nom>.sql`. */
function parseMigration(fileName: string): { version: string; name: string } {
  const base = fileName.replace(/\.sql$/, "");
  const separator = base.indexOf("_");
  if (separator <= 0) throw new Error(`Nom de migration non conforme : ${fileName}`);
  return { version: base.slice(0, separator), name: base.slice(separator + 1) };
}

const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
if (files.length === 0) throw new Error(`Aucune migration trouvée dans ${migrationsDir}`);

const client = new Client({ connectionString, ssl: false });
await client.connect();
try {
  for (const schema of MANAGED_SCHEMAS) {
    await client.query(`drop schema if exists ${schema} cascade`);
  }
  await client.query("create schema public");

  await client.query(await readFile(shimPath, "utf8"));

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw new Error(
        `Migration ${file} inapplicable sur une base neuve : ${(error as Error).message}`,
      );
    }
  }

  for (const file of files) {
    const { version, name } = parseMigration(file);
    await client.query(
      "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
      [version, name],
    );
  }

  // Propriétaire local minimal : les smokes transactionnels lisent auth.users et
  // public.profiles. Aucune donnée financière n'est créée ici.
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    LOCAL_OWNER_ID,
    "local-gate@invalid",
  ]);
  await client.query(
    "insert into public.profiles (user_id, display_name, reporting_currency) values ($1, $2, 'EUR')",
    [LOCAL_OWNER_ID, "LOCAL GATE OWNER"],
  );

  const applied = await client.query<{ version: string }>(
    "select version from supabase_migrations.schema_migrations order by version",
  );
  const drift = diffExactInventory(
    "Migration(s) locale(s)",
    files.map((file) => parseMigration(file).version),
    applied.rows.map((row) => row.version),
  );
  if (drift.length > 0) throw new Error(`Historique local incohérent :\n- ${drift.join("\n- ")}`);

  const tables = await client.query<{ count: string }>(
    "select count(*)::text as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
  );
  console.log(
    `Base locale reconstruite depuis zéro : ${files.length} migrations appliquées, ${tables.rows[0]?.count} tables publiques, propriétaire local ${LOCAL_OWNER_ID}.`,
  );
  console.log("Étape suivante : npm run db:verify:local");
} finally {
  await client.end();
}
