/** Préparation B13 : SQL local avec deux acteurs, sans preuve de sessions Auth réelles. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readFile } from "node:fs/promises";
const connectionString = process.env.LFO_LOCAL_DB_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname)
)
  throw new Error("LFO_LOCAL_DB_URL doit désigner une base locale de recette.");
const client = new pg.Client({ connectionString, ssl: false });
let checks = 0;
async function rejects(sql: string, params: unknown[], code: string, label: string) {
  await client.query("savepoint isolation_check");
  let observed: unknown;
  try {
    await client.query(sql, params);
  } catch (error) {
    observed = error;
  }
  await client.query("rollback to savepoint isolation_check");
  assert.equal((observed as { code?: string })?.code, code, label);
  checks++;
}
async function actor(userId: string) {
  await client.query("reset role");
  await client.query(
    "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
    [userId, JSON.stringify({ sub: userId, role: "authenticated" })],
  );
  await client.query("set local role authenticated");
}
await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '10s'");
  const a = randomUUID(),
    b = randomUUID();
  await client.query(
    "insert into auth.users(id,email) values ($1,'isolation-a@invalid'),($2,'isolation-b@invalid')",
    [a, b],
  );
  await client.query("set local role service_role");
  const add =
    "select public.lfo_add_account($1,'Banque recette',$2,'BANK',10,'EUR','2026-09-15') as id";
  const accountA = (await client.query(add, [a, "Compte A"])).rows[0].id;
  const accountB = (await client.query(add, [b, "Compte B"])).rows[0].id;
  for (const [owner, own, foreign] of [
    [a, accountA, accountB],
    [b, accountB, accountA],
  ]) {
    await actor(owner);
    assert.equal(
      (await client.query("select id from public.financial_accounts where id=$1", [own])).rowCount,
      1,
      "compte propre visible",
    );
    checks++;
    assert.equal(
      (await client.query("select id from public.financial_accounts where id=$1", [foreign]))
        .rowCount,
      0,
      "compte tiers invisible",
    );
    checks++;
    assert.equal(
      (
        await client.query("update public.financial_accounts set name='Intrusion' where id=$1", [
          foreign,
        ])
      ).rowCount,
      0,
      "compte tiers non modifiable",
    );
    checks++;
    assert.equal(
      (await client.query("delete from public.financial_accounts where id=$1", [foreign])).rowCount,
      0,
      "compte tiers non supprimable",
    );
    checks++;
    await rejects(
      "update public.financial_accounts set user_id=$1 where id=$2",
      [owner === a ? b : a, own],
      "42501",
      "propriétaire non transférable",
    );
    await rejects(
      add,
      [owner, "RPC navigateur interdite"],
      "42501",
      "RPC inaccessible au navigateur",
    );
    await rejects(
      "insert into public.account_balances(user_id,account_id,balance,balance_date,data_kind,confidence) values ($1,$2,999,'2026-09-15','ACTUAL','HIGH')",
      [owner, foreign],
      "23503",
      "solde interdit sur compte tiers",
    );
  }
  await client.query("reset role");
  await client.query("set local role service_role");
  await rejects(
    "select public.lfo_add_transaction($1,$2,null,'2026-09-15','Référence croisée',1,'EUR',false)",
    [a, accountB],
    "23503",
    "RPC serveur interdit la référence au compte tiers",
  );
  // MATCH SIMPLE : un mouvement sans catégorie reste possible dans son propre compte.
  await client.query(
    "select public.lfo_add_transaction($1,$2,null,'2026-09-15','Propre',1,'EUR',false)",
    [a, accountA],
  );
  checks++;
  const documentA = (
    await client.query(
      "insert into public.documents(user_id,name,category,storage_path,size_bytes,status) values ($1,'A.csv','other',$2,1,'INBOX') returning id",
      [a, `${a}/fixture.csv`],
    )
  ).rows[0].id;
  const documentB = (
    await client.query(
      "insert into public.documents(user_id,name,category,storage_path,size_bytes,status) values ($1,'B.csv','other',$2,1,'INBOX') returning id",
      [b, `${b}/fixture.csv`],
    )
  ).rows[0].id;
  await client.query(
    "insert into public.document_metadata(user_id,document_id,metadata_key) values ($1,$2,'own')",
    [a, documentA],
  );
  checks++;
  await rejects(
    "insert into public.document_metadata(user_id,document_id,metadata_key) values ($1,$2,'cross')",
    [a, documentB],
    "23503",
    "métadonnée sur document tiers refusée",
  );
  await actor(a);
  assert.equal(
    (await client.query("select id from public.documents where id=$1", [documentB])).rowCount,
    0,
  );
  checks++;
  await client.query("reset role");
  await client.query("set local role service_role");
  await client.query("delete from public.documents where id=$1", [documentA]);
  assert.equal(
    (
      await client.query("select id from public.document_metadata where document_id=$1", [
        documentA,
      ])
    ).rowCount,
    0,
    "cascade propre préservée",
  );
  checks++;
  assert.equal(
    (await client.query("select id from public.documents where id=$1", [documentB])).rowCount,
    1,
    "document B conservé",
  );
  checks++;
  const institution = (
    await client.query(
      "insert into public.institutions(user_id,name) values($1,'Institution temporaire') returning id",
      [a],
    )
  ).rows[0].id;
  const provider = (
    await client.query(
      "insert into public.bank_providers(user_id,adapter_id,adapter_version,label,auth_mode,capabilities) values($1,'fixture-isolation','1','Fixture','FIXTURE','{}') returning id",
      [a],
    )
  ).rows[0].id;
  const bank = (
    await client.query(
      "insert into public.bank_institutions(user_id,provider_id,provider_institution_id,name,institution_id) values($1,$2,'fixture','Fixture',$3) returning id",
      [a, provider, institution],
    )
  ).rows[0].id;
  await client.query("delete from public.institutions where id=$1", [institution]);
  const detached = (
    await client.query("select user_id,institution_id from public.bank_institutions where id=$1", [
      bank,
    ])
  ).rows[0];
  assert.deepEqual(
    detached,
    { user_id: a, institution_id: null },
    "SET NULL ne supprime pas user_id",
  );
  checks++;
  // Une ancienne incohérence doit bloquer la migration sans effacer le fait concerné.
  await client.query("reset role");
  await client.query(
    "alter table public.account_balances drop constraint account_balances_account_id_fkey, add constraint account_balances_account_id_fkey foreign key (account_id) references public.financial_accounts(id) on delete cascade",
  );
  const bad = (
    await client.query(
      "insert into public.account_balances(user_id,account_id,balance,balance_date,data_kind,confidence) values($1,$2,999,'2026-09-15','ACTUAL','HIGH') returning id",
      [a, accountB],
    )
  ).rows[0].id;
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260915064740_personal_reference_isolation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await rejects(migration, [], "P0001", "précontrôle historique bloque la migration");
  assert.equal(
    (await client.query("select id from public.account_balances where id=$1", [bad])).rowCount,
    1,
    "aucune suppression corrective silencieuse",
  );
  checks++;
  await client.query("reset role");
  await client.query("set local role anon");
  await rejects(
    "select id from public.financial_accounts",
    [],
    "42501",
    "lecture anonyme interdite",
  );
  console.log(
    `Isolation SQL locale : ${checks} contrôles réussis ; rollback. Auth, Storage HTTP, exports et rapports restent à vérifier en recette réelle.`,
  );
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
