/** Direct hosted Auth/PostgREST/Storage isolation checks on synthetic Free staging only. */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const pub = read("/workspace/scratch/lfo-staging-public-config.json");
const server = read("/workspace/scratch/lfo-staging-server-config.json");
const users = read("/workspace/scratch/lfo-staging-test-users.json").accounts;
const ref = "bjxhnwvomoznorijauyl";
if (
  pub.project_ref !== ref ||
  server.project_ref !== ref ||
  users.length !== 2 ||
  users[0].id === users[1].id
)
  throw Error("Staging guard");
const url = `https://${ref}.supabase.co`;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, server.secret_key, options);
const A = createClient(url, pub.publishable_key, options),
  B = createClient(url, pub.publishable_key, options),
  anon = createClient(url, pub.publishable_key, options);
const report = {
  staging_ref: ref,
  synthetic_only: true,
  method: "Real Supabase Auth, PostgREST/RLS, RPC and Storage HTTP",
  started_at: new Date().toISOString(),
  steps: [],
};
const path = "docs/consolidation/preuves/integration-b19-2026-10-15/hosted-security.json";
function assert(ok, label) {
  if (!ok) throw Error(label);
}
async function step(name, fn) {
  try {
    const detail = await fn();
    report.steps.push({ name, ...detail, status: "PASS" });
  } catch (e) {
    report.steps.push({ name, status: "FAIL", reason: e.message });
  }
  fs.writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.steps.at(-1)));
}
await step("Distinct A/B credentials establish separate real hosted sessions", async () => {
  for (const [i, c] of [A, B].entries()) {
    const r = await c.auth.signInWithPassword({
      email: users[i].email,
      password: users[i].password,
    });
    assert(!r.error && r.data.user.id === users[i].id, "Synthetic login failed");
  }
  return { users: 2 };
});
await step("PostgREST financial account RLS restricts A/B/anonymous", async () => {
  const a = await A.from("financial_accounts").select("id,user_id");
  assert(
    !a.error && a.data.length > 0 && a.data.every((r) => r.user_id === users[0].id),
    "A account read invalid",
  );
  for (const c of [B, anon]) {
    const r = await c.from("financial_accounts").select("id,user_id");
    assert(r.error || r.data.length === 0, "Foreign account visible");
  }
  return { a_own_rows: a.data.length, foreign_rows: 0 };
});
await step("Sensitive document/draft/debt-event tables do not leak via client API", async () => {
  for (const table of [
    "document_extraction_runs",
    "document_extraction_fields",
    "document_field_decisions",
    "form_drafts",
    "liability_events",
    "liability_contract_versions",
  ])
    for (const c of [B, anon]) {
      const r = await c.from(table).select("id").limit(5);
      assert(r.error || r.data.length === 0, `${table} foreign rows visible`);
    }
  return { table_checks: 12 };
});
await step("Server-only debt RPC cannot be executed by A/B/anonymous", async () => {
  for (const c of [A, B, anon]) {
    const r = await c.rpc("lfo_record_outstanding_debt", {
      p_user_id: users[0].id,
      p_payload: {
        name: "RPC access must be refused",
        balance: "1",
        currency: "EUR",
        observed_at: "2026-10-15",
        lender: null,
        notes: null,
      },
    });
    assert(r.error, "Server RPC executable from client");
  }
  return { denied_callers: 3 };
});
await step(
  "Storage owner can download, B and anonymous cannot; foreign-prefix upload denied",
  async () => {
    const d = await admin
      .from("documents")
      .select("storage_path")
      .eq("user_id", users[0].id)
      .limit(1)
      .single();
    assert(!d.error && d.data.storage_path, "Retained synthetic document missing");
    const bucket = "family-office-documents";
    const own = await A.storage.from(bucket).download(d.data.storage_path);
    assert(!own.error && own.data.size > 0, "Owner Storage read denied");
    for (const c of [B, anon]) {
      const r = await c.storage.from(bucket).download(d.data.storage_path);
      assert(r.error, "Foreign Storage read accepted");
    }
    const forged = await B.storage
      .from(bucket)
      .upload(
        `${users[0].id}/foreign-prefix-must-be-refused.csv`,
        new Blob(["test"], { type: "text/csv" }),
      );
    assert(forged.error, "Foreign Storage write accepted");
    return { owner_read: true, foreign_reads_denied: 2, foreign_write_denied: true };
  },
);
await step("Real Auth token refresh succeeds and keeps A identity", async () => {
  const r = await A.auth.refreshSession();
  assert(!r.error && r.data.user.id === users[0].id, "Auth refresh failed");
  return { refreshed: true };
});
report.completed_at = new Date().toISOString();
process.exitCode = report.steps.some((step) => step.status === "FAIL") ? 1 : 0;
fs.writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    passed: report.steps.filter((x) => x.status === "PASS").length,
    failed: report.steps.filter((x) => x.status === "FAIL").length,
  }),
);
