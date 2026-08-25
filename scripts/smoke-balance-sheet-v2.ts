/** Smoke transactionnel du contrat de snapshot V2. Toutes les écritures sont rollbackées. */
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL manquant");
// Même règle que le verifier : une cible locale n'a pas de TLS, une cible distante l'exige.
const connectionUrl = new URL(connectionString);
const localHost = ["localhost", "127.0.0.1", "::1"].includes(connectionUrl.hostname);
const client = new Client({ connectionString, ssl: localHost ? false : true });

type Counts = { closes: string; snapshots: string; items: string };

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.monthly_closes)::text as closes,
      (select count(*) from public.net_worth_snapshots)::text as snapshots,
      (select count(*) from public.net_worth_snapshot_items)::text as items
  `);
  return result.rows[0];
}

try {
  await client.connect();
  const before = await counts();
  await client.query("begin");
  await client.query("set local statement_timeout = '15s'");
  const owner = await client.query<{ user_id: string }>(
    "select user_id from public.profiles order by created_at limit 1",
  );
  if (!owner.rows[0]) throw new Error("Profil propriétaire absent");
  const userId = owner.rows[0].user_id;
  const snapshot = {
    gross_assets: 100,
    financial_assets: 100,
    liquid_assets: 100,
    account_overdrafts: 0,
    contractual_debt: 25,
    other_liabilities: 0,
    total_liabilities: 25,
    net_worth: 75,
    reporting_currency: "EUR",
    completeness_status: "COMPLETE",
    data_completeness: 1,
    data_kind: "ACTUAL",
    composition: { smoke: true },
    provenance: { engine: "CANONICAL_BALANCE_SHEET_V2_SMOKE" },
  };
  const item = {
    domain: "OTHER_ASSET",
    entity_id: "rollback-only",
    side: "ASSET",
    category: "SMOKE",
    native_amount: 100,
    currency: "EUR",
    fx_rate: 1,
    fx_rate_date: "2099-12-31",
    reporting_amount: 100,
    valuation_date: "2099-12-31",
    valuation_method: "USER_ESTIMATE",
    valuation_status: "CURRENT",
    data_kind: "USER_ASSUMPTION",
    confidence: "HIGH",
    quality_status: "RECONCILED",
    source: "rollback smoke",
    flags: [],
  };
  for (const items of [[item], []]) {
    await client.query(
      "select public.lfo_create_monthly_close_v2($1,$2,$3::jsonb,$4::jsonb,$5,$6)",
      [userId, "2099-12-31", JSON.stringify(snapshot), JSON.stringify(items), null, null],
    );
  }
  const versions = await client.query<{ versions: number[] }>(
    `
    select array_agg(version order by version) as versions
      from public.net_worth_snapshots
     where user_id = $1 and snapshot_date = date '2099-12-31'
  `,
    [userId],
  );
  if (JSON.stringify(versions.rows[0]?.versions) !== JSON.stringify([1, 2])) {
    throw new Error(
      `Versionnement snapshot invalide : ${JSON.stringify(versions.rows[0]?.versions)}`,
    );
  }
  const itemCount = await client.query<{ count: string }>(
    `
    select count(*)::text as count
      from public.net_worth_snapshot_items item
      join public.net_worth_snapshots snapshot on snapshot.id = item.snapshot_id
     where snapshot.user_id = $1 and snapshot.snapshot_date = date '2099-12-31'
  `,
    [userId],
  );
  if (itemCount.rows[0]?.count !== "1") throw new Error("Items de snapshot non atomiques");
  await client.query("rollback");
  const after = await counts();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      `Le smoke a persisté des lignes : before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    );
  }
  console.log(
    "Smoke Balance Sheet V2 OK : RPC atomique, versions [1,2], item lié, rollback intégral, zéro fixture persistante.",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
