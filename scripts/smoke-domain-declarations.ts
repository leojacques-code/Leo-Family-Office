/**
 * Smoke transactionnel des déclarations d'applicabilité de domaine. Toutes les écritures
 * sont annulées : aucune donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve :
 *
 *   * une déclaration s'écrit par la RPC, et l'application y lit la déclaration COURANTE
 *     comme la plus récente du domaine, jamais comme une ligne unique ;
 *   * ABSENCE DE LIGNE ≠ UNDECIDED : les deux se lisent différemment, et « je ne sais pas
 *     encore » n'est pas l'absence de réponse ;
 *   * un changement d'avis AJOUTE une observation datée : l'ancienne réponse reste lisible,
 *     et « depuis quand ce domaine est-il masqué ? » garde une réponse ;
 *   * HORODATAGE ≠ ORDRE : deux déclarations de la même date économique portent des RANGS
 *     distincts, parce que `now()` est le timestamp de la transaction et que les ordonner par
 *     lui ne donnerait aucun ordre du tout ;
 *   * rejouer la MÊME réponse n'écrit rien et le dit en rendant `null` : rouvrir
 *     l'onboarding n'empile pas huit lignes identiques ;
 *   * un motif seul qui change EST un changement : la seule phrase écrite par l'utilisateur
 *     ne se perd pas au motif que la réponse est la même ;
 *   * une déclaration sans domaine, sans réponse ou sans date économique est REFUSÉE : la
 *     date de déclaration ne se replie pas sur `now()`, sans quoi la réponse ne dirait pas
 *     depuis quand elle vaut ;
 *   * un domaine hors des huit du §19.1 et une réponse hors des trois du §18.1 sont refusés
 *     par la BASE, pas par l'application ;
 *   * la table est immuable en UPDATE et en DELETE direct : corriger une déclaration se fait
 *     en en ajoutant une nouvelle ;
 *   * la table n'est accessible à `authenticated` qu'en LECTURE ;
 *   * les déclarations d'un autre propriétaire restent inaccessibles, même en connaissant
 *     son UUID.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL manquante");

const connectionUrl = new URL(connectionString);
const localHost = ["localhost", "127.0.0.1", "::1"].includes(connectionUrl.hostname);
const client = new Client({ connectionString, ssl: localHost ? false : true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Vérifie qu'une écriture est refusée, et par le BON contrôle. */
async function rejects(
  sql: string,
  params: unknown[],
  message: string,
  expected?: string,
): Promise<void> {
  await client.query("savepoint smoke_guard");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint smoke_guard");
    throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    await client.query("rollback to savepoint smoke_guard");
    const reason = error instanceof Error ? error.message : String(error);
    if (expected && !reason.includes(expected)) {
      throw new Error(`${message} : refus obtenu pour une autre raison (${reason})`);
    }
  }
}

let userId = "";

/** `null` quand la RPC n'a rien écrit, ce qui est une information et non un échec. */
async function declare(payload: unknown): Promise<string | null> {
  const result = await client.query<{ value: string | null }>(
    "select public.lfo_declare_domain_applicability($1::uuid, $2::jsonb)::text as value",
    [userId, JSON.stringify(payload)],
  );
  return result.rows[0].value;
}

/** La déclaration COURANTE d'un domaine, telle que l'application la lit. */
async function current(
  domain: string,
): Promise<{ applicability: string; note: string | null } | null> {
  const result = await client.query<{ applicability: string; note: string | null }>(
    `select applicability, note
       from public.user_domain_declarations
      where user_id = $1 and domain = $2
      order by declared_on desc, revision desc
      limit 1`,
    [userId, domain],
  );
  return result.rows[0] ?? null;
}

async function rowCount(domain: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    "select count(*)::text as count from public.user_domain_declarations where user_id = $1 and domain = $2",
    [userId, domain],
  );
  return Number(result.rows[0].count);
}

async function totalRows(): Promise<string> {
  const result = await client.query<{ count: string }>(
    "select count(*)::text as count from public.user_domain_declarations",
  );
  return result.rows[0].count;
}

let succeeded = false;

await client.connect();
const before = await totalRows();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");

  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
  userId = owner.rows[0].id;

  // Propriétaire voisin : il sert à prouver le cloisonnement. Créé AVANT le passage en
  // `service_role`, qui n'écrit pas dans le schéma `auth`.
  const otherUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    otherUser,
    `smoke-declarations-${otherUser}@invalid`,
  ]);

  await client.query("set local role service_role");

  // ── 1. ABSENCE DE LIGNE ≠ UNDECIDED ────────────────────────────────────────────────
  assert(
    (await current("IMMOBILIER")) === null,
    "Un domaine jamais déclaré ne doit porter aucune déclaration courante",
  );

  const undecided = await declare({
    domain: "IMMOBILIER",
    applicability: "UNDECIDED",
    declared_on: "2026-09-08",
  });
  assert(undecided !== null, "Une première déclaration doit écrire une ligne");
  assert(
    (await current("IMMOBILIER"))?.applicability === "UNDECIDED",
    "« Je ne sais pas encore » doit se lire comme une réponse, pas comme une absence",
  );

  // ── 2. Rejouer la même réponse n'écrit rien ────────────────────────────────────────
  const replayed = await declare({
    domain: "IMMOBILIER",
    applicability: "UNDECIDED",
    declared_on: "2026-09-08",
  });
  assert(
    replayed === null,
    "Rejouer la même réponse doit rendre null : un identifiant laisserait croire à une écriture",
  );
  assert(
    (await rowCount("IMMOBILIER")) === 1,
    "Rejouer la même réponse ne doit ajouter aucune ligne",
  );

  // ── 3. Un motif seul qui change EST un changement ──────────────────────────────────
  const withNote = await declare({
    domain: "IMMOBILIER",
    applicability: "UNDECIDED",
    declared_on: "2026-09-08",
    note: "Compromis signé, acte en septembre",
  });
  assert(withNote !== null, "Un motif ajouté à la même réponse doit être conservé");
  assert(
    (await current("IMMOBILIER"))?.note === "Compromis signé, acte en septembre",
    "Le motif courant doit être celui de la dernière déclaration",
  );

  // Le rang donne un ordre TOTAL même à date économique égale : les deux déclarations
  // ci-dessus portent la même date et le même `created_at` de transaction.
  const sameDate = await client.query<{ revision: number }>(
    `select revision from public.user_domain_declarations
      where user_id = $1 and domain = 'IMMOBILIER'
      order by revision asc`,
    [userId],
  );
  assert(
    sameDate.rows.length === 2 &&
      sameDate.rows[0].revision === 1 &&
      sameDate.rows[1].revision === 2,
    "Deux déclarations de la même date doivent porter des rangs 1 et 2 : un horodatage de transaction les confondrait",
  );

  // ── 4. Un changement d'avis AJOUTE une observation, il n'écrase rien ───────────────
  await declare({
    domain: "ENTREPRISE",
    applicability: "DECLARED_NONE",
    declared_on: "2026-09-08",
  });
  await declare({
    domain: "ENTREPRISE",
    applicability: "APPLICABLE",
    declared_on: "2026-09-09",
  });
  assert(
    (await current("ENTREPRISE"))?.applicability === "APPLICABLE",
    "La déclaration courante doit être la plus récente",
  );
  assert(
    (await rowCount("ENTREPRISE")) === 2,
    "Un changement d'avis doit laisser les deux observations lisibles",
  );
  const history = await client.query<{ applicability: string }>(
    `select applicability from public.user_domain_declarations
      where user_id = $1 and domain = 'ENTREPRISE'
      order by declared_on asc`,
    [userId],
  );
  assert(
    history.rows[0].applicability === "DECLARED_NONE",
    "L'ancienne réponse doit rester lisible : « depuis quand » n'a pas d'autre source",
  );

  // ── 5. Refus de ce qui ne se devine pas ────────────────────────────────────────────
  await rejects(
    "select public.lfo_declare_domain_applicability($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ applicability: "APPLICABLE", declared_on: "2026-09-08" })],
    "Une déclaration sans domaine doit être refusée",
    "sans domaine",
  );
  await rejects(
    "select public.lfo_declare_domain_applicability($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ domain: "BANQUE", declared_on: "2026-09-08" })],
    "Une déclaration sans réponse doit être refusée",
    "sans domaine ou sans réponse",
  );
  await rejects(
    "select public.lfo_declare_domain_applicability($1::uuid, $2::jsonb)",
    [userId, JSON.stringify({ domain: "BANQUE", applicability: "APPLICABLE" })],
    "Une déclaration sans date économique doit être refusée, jamais repliée sur now()",
    "sans date économique",
  );

  // ── 6. Listes closes, tenues par la BASE ───────────────────────────────────────────
  await rejects(
    `insert into public.user_domain_declarations (user_id, domain, applicability, declared_on, revision)
     values ($1, 'CRYPTOMONNAIE', 'APPLICABLE', '2026-09-08', 1)`,
    [userId],
    "Un domaine hors des huit du §19.1 doit être refusé par la base",
    "user_domain_declarations_domain_check",
  );
  await rejects(
    `insert into public.user_domain_declarations (user_id, domain, applicability, declared_on, revision)
     values ($1, 'BANQUE', 'PEUT_ETRE', '2026-09-08', 1)`,
    [userId],
    "Une réponse hors des trois du §18.1 doit être refusée par la base",
    "user_domain_declarations_applicability_check",
  );

  // ── 7. Immuabilité ─────────────────────────────────────────────────────────────────
  await rejects(
    "update public.user_domain_declarations set applicability = 'APPLICABLE' where user_id = $1",
    [userId],
    "Une déclaration ne doit pas se modifier",
    "ne se modifie pas",
  );
  await rejects(
    "delete from public.user_domain_declarations where user_id = $1",
    [userId],
    "Une déclaration ne doit pas se supprimer",
    "ne se supprime pas",
  );

  // ── 8. Lecture seule pour `authenticated`, et cloisonnement ────────────────────────
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: otherUser, role: "authenticated" }),
  ]);
  const foreign = await client.query<{ count: string }>(
    "select count(*)::text as count from public.user_domain_declarations where user_id = $1",
    [userId],
  );
  assert(
    foreign.rows[0].count === "0",
    "Les déclarations d'un autre propriétaire doivent rester invisibles",
  );
  await rejects(
    `insert into public.user_domain_declarations (user_id, domain, applicability, declared_on, revision)
     values ($1, 'BANQUE', 'APPLICABLE', '2026-09-08', 1)`,
    [otherUser],
    "`authenticated` ne doit pas pouvoir écrire une déclaration en direct",
    "permission denied",
  );
  await client.query("set local role service_role");

  await client.query("rollback");
  succeeded = true;
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    /* connexion possiblement interrompue avant BEGIN */
  }
  throw error;
} finally {
  const after = await totalRows().catch(() => null);
  await client.end();
  if (after !== null && after !== before) {
    throw new Error(
      `Le smoke a laissé des données persistées : user_domain_declarations ${before} → ${after}`,
    );
  }
  if (succeeded) {
    console.log(
      "Smoke Déclarations de domaine : absence ≠ « je ne sais pas encore », rejeu sans écriture, motif conservé, changement d'avis append-only, ordre total par rang, date économique obligatoire, listes closes en base, immuabilité UPDATE/DELETE, lecture seule pour authenticated, cloisonnement. Aucune donnée persistée.",
    );
  }
}
