/** Contrôle SQL transactionnel local ; ne valide pas le service Supabase Auth. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.LFO_LOCAL_DB_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname)
)
  throw new Error("LFO_LOCAL_DB_URL doit désigner une base locale de recette.");
const client = new pg.Client({ connectionString, ssl: false });
await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '10s'");
  const userA = randomUUID(),
    userB = randomUUID(),
    sessionA = randomUUID(),
    sessionB = randomUUID();
  await client.query(
    "insert into auth.users(id, email) values ($1, 'session-a@invalid'), ($2, 'session-b@invalid')",
    [userA, userB],
  );
  await client.query("insert into auth.sessions(id, user_id) values ($1, $2), ($3, $4)", [
    sessionA,
    userA,
    sessionB,
    userB,
  ]);
  async function verify(user: string, session: string, expected: boolean, label: string) {
    await client.query("set local role service_role");
    try {
      const result = await client.query("select public.lfo_verify_session($1, $2) as valid", [
        user,
        session,
      ]);
      assert.equal(result.rows[0].valid, expected, label);
    } finally {
      await client.query("reset role");
    }
  }
  await verify(userA, sessionA, true, "session A active");
  await verify(userB, sessionB, true, "session B active");
  await verify(userB, sessionA, false, "session A ne devient pas B");
  await verify(userA, sessionB, false, "session B ne devient pas A");
  await client.query(
    "update auth.sessions set not_after = now() - interval '1 second' where id = $1",
    [sessionA],
  );
  await verify(userA, sessionA, false, "session expirée");
  await client.query(
    "update auth.sessions set not_after = now() + interval '1 hour' where id = $1",
    [sessionA],
  );
  await verify(userA, sessionA, true, "session non expirée");
  await client.query(
    "update auth.users set banned_until = now() + interval '1 hour' where id = $1",
    [userA],
  );
  await verify(userA, sessionA, false, "utilisateur suspendu");
  await client.query(
    "update auth.users set banned_until = null, deleted_at = now() where id = $1",
    [userA],
  );
  await verify(userA, sessionA, false, "utilisateur supprimé");
  await client.query("update auth.users set deleted_at = null where id = $1", [userA]);
  await client.query("delete from auth.sessions where id = $1", [sessionA]);
  await verify(userA, sessionA, false, "session révoquée");
  await verify(userB, sessionB, true, "révocation A indépendante de B");
  for (const role of ["anon", "authenticated"]) {
    for (const name of ["public.lfo_verify_session", "lfo_private.verify_session"]) {
      await client.query("savepoint privilege_check");
      await client.query(`set local role ${role}`);
      await assert.rejects(client.query(`select ${name}($1, $2)`, [userB, sessionB]), {
        code: "42501",
      });
      await client.query("rollback to savepoint privilege_check");
    }
  }
  console.log(
    "SQL local : 10 états/identités et 4 refus de privilèges vérifiés ; aucune preuve de connexion Auth réelle.",
  );
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
