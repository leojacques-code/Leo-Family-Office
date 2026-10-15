/** Hosted acceptance on the explicitly authorised synthetic-only Free staging. No browser certification. */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildWorkbook } from "../src/lib/acquisition/xlsx/__tests__/fixtures/xlsx-builder.ts";

const ref = "bjxhnwvomoznorijauyl";
const origin = process.env.LFO_RECETTE_ORIGIN ?? "https://leo-family-office-2nu9s8gm3-lech1.vercel.app";
const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const publicConfig = read("/workspace/scratch/lfo-staging-public-config.json");
const serverConfig = read("/workspace/scratch/lfo-staging-server-config.json");
const accounts = read("/workspace/scratch/lfo-staging-test-users.json").accounts;
const access = read("/workspace/scratch/lfo-preview-access.json");
if (
  publicConfig.project_ref !== ref ||
  serverConfig.project_ref !== ref ||
  new URL(access.url).origin !== origin ||
  accounts.length !== 2 ||
  accounts[0].id === accounts[1].id
)
  throw Error("Staging guard");
const admin = createClient(`https://${ref}.supabase.co`, serverConfig.secret_key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const reportPath = "docs/consolidation/preuves/integration-b19-2026-10-15/hosted-acceptance.json";
const report = {
  staging_ref: ref,
  preview_origin: origin,
  deployment_sha: process.env.LFO_RECETTE_SHA ?? "9cb4f4b11adaf3f2eb9259c4f86cb36bd6438014",
  method:
    "Real hosted application HTTP, Supabase Auth, PostgreSQL/PostgREST and Storage; NOT a browser UI acceptance",
  started_at: new Date().toISOString(),
  synthetic_only: true,
  steps: [],
};
class Session {
  cookies = new Map();
  async request(path, options = {}) {
    const url = new URL(path, origin);
    if (url.origin !== origin) throw Error("Origin guard");
    const headers = new Headers(options.headers);
    headers.set("Origin", origin);
    headers.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    let body = options.body;
    if (body && !(body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }
    const res = await fetch(url, {
      ...options,
      body,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    for (const c of res.headers.getSetCookie()) {
      const p = c.split(";")[0],
        i = p.indexOf("=");
      this.cookies.set(p.slice(0, i), p.slice(i + 1));
    }
    const data = res.headers.get("content-type")?.includes("application/json")
      ? await res.json()
      : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  async protect() {
    let path = access.url;
    for (let i = 0; i < 6; i++) {
      const r = await this.request(path);
      if (r.status < 300 || r.status >= 400) return r;
      path = new URL(r.headers.get("location"), origin).href;
    }
    throw Error("Protection redirect limit");
  }
  async login(account) {
    const r = await this.request("/api/auth", {
      method: "POST",
      body: { email: account.email, password: account.password, intent: "sign-in" },
    });
    assert(r.status === 200 && r.data.ok, "Real application login failed");
  }
}
function assert(value, message) {
  if (!value) throw Error(message);
}
async function step(name, fn) {
  try {
    const detail = await fn();
    report.steps.push({ name, status: "PASS", ...detail });
    console.log(JSON.stringify({ name, status: "PASS", ...detail }));
  } catch (e) {
    report.steps.push({ name, status: "FAIL", reason: e.message });
    console.log(JSON.stringify({ name, status: "FAIL", reason: e.message }));
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    throw e;
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
}
async function ok(session, path, body, status = 200, method = "POST") {
  const r = await session.request(path, { method, body });
  assert(
    r.status === status,
    `${path}: expected ${status}, received ${r.status}: ${typeof r.data === "object" ? JSON.stringify(r.data) : "non-JSON response"}`,
  );
  return r.data;
}
const A = new Session(),
  B = new Session();
await A.protect();
await B.protect();
await A.login(accounts[0]);
await B.login(accounts[1]);
const state = async (session) => (await session.request("/api/state")).data;
const debts = async (session) => (await session.request("/api/debt")).data;
const review = async (runId) =>
  (await A.request(`/api/debt/schedule-documents?runId=${runId}`)).data;
const command = (body) => ok(A, "/api/debt/schedule-documents", body, 200, "PATCH");
const today = "2026-10-15";
let accountId, liabilityId, csvRunId, xlsxRunId;
await step("First account and first observed income through deployed API", async () => {
  let s = await state(A);
  let account = s.accounts.find((a) => a.name === "B19 recette hébergée");
  if (!account) {
    await ok(A, "/api/state", {
      action: "add_account",
      institution: "Banque synthétique",
      name: "B19 recette hébergée",
      accountType: "BANK",
      balance: 3000,
      balanceDate: today,
      currency: "EUR",
    });
    s = await state(A);
    account = s.accounts.find((a) => a.name === "B19 recette hébergée");
  }
  assert(account, "Account not persisted");
  accountId = account.id;
  if (!s.transactions.some((t) => t.label === "Revenu synthétique B19"))
    await ok(A, "/api/state", {
      action: "record_net_income",
      accountId,
      receivedOn: today,
      amount: 2500,
      label: "Revenu synthétique B19",
      notes: "Synthetic hosted acceptance",
    });
  s = await state(A);
  assert(
    s.transactions.some((t) => t.amount === 2500),
    "Observed income not persisted",
  );
  assert(
    s.accounts.find((a) => a.id === accountId).balance === 3000,
    "Observed income silently changed observed balance",
  );
  return { observed_balance_unchanged: true };
});
await step(
  "A/B account isolation on deployed API and foreign account mutation rejection",
  async () => {
    const s = await state(B);
    assert(s.accounts.length === 0 && s.transactions.length === 0, "B sees A data");
    const r = await B.request("/api/state", {
      method: "POST",
      body: {
        action: "record_net_income",
        accountId,
        receivedOn: today,
        amount: 1,
        label: "Foreign account refused",
        notes: null,
      },
    });
    assert(r.status === 422, "Foreign account mutation not refused");
    return { foreign_mutation_status: r.status };
  },
);
const contract = {
  liabilityId: null,
  name: "Prêt B19 synthétique",
  lender: "Banque synthétique",
  principal: 2000,
  initialBalance: 2000,
  balanceDate: today,
  annualRate: 0,
  paymentAmount: 1000,
  paymentCount: null,
  firstPaymentDate: "2026-11-05",
  maturityDate: null,
  amortisationProfile: "AMORTIZING",
  balloonAmount: null,
  paymentFrequency: "MONTHLY",
  interestConvention: "PROPORTIONAL",
  rateType: "FIXED",
  insuranceAmount: null,
  recurringFees: 0,
  paymentIncludesInsurance: false,
  insuranceMode: "SEPARATE",
  insurancePolicies: [
    {
      insurer: "Assureur synthétique",
      contractReference: "B19-TEST",
      effectiveDate: today,
      endDate: null,
      insuredBase: "INITIAL_CAPITAL",
      debitAccountId: null,
      insured: [{ name: "Personne synthétique A", coverageShare: 1 }],
      periods: [
        {
          firstDebitDate: "2026-11-05",
          lastDebitDate: "2026-12-05",
          frequency: "MONTHLY",
          premiumAmount: 5,
        },
      ],
    },
  ],
  deferral: null,
  facilityId: null,
  notes: "Synthetic hosted acceptance",
  rateSchedule: [],
  paymentSchedule: [],
  earlyRepayments: [],
  charges: [],
  providedSchedule: [],
};
await step("Adaptive debt contract with payment only and separate insurance persists", async () => {
  let s = await state(A);
  let l = s.liabilities.find((x) => x.name === contract.name);
  if (!l) {
    await ok(A, "/api/debt", { action: "save_debt_contract", contract });
    s = await state(A);
    l = s.liabilities.find((x) => x.name === contract.name);
  }
  assert(l, "Debt not persisted");
  liabilityId = l.id;
  assert(l.principal === 2000, "Principal changed");
  return { debt_persisted: true };
});
await step("Persistent draft stays outside canonical debt and rejects stale writes", async () => {
  const d = await ok(A, "/api/drafts", {
    draftId: null,
    expectedVersion: null,
    kind: "DEBT_CONTRACT_NEW",
    subjectId: null,
    title: "B19 brouillon synthétique",
    content: { name: "Dette non validée", principal: "incomplet" },
    schemaVersion: 1,
  });
  const saved = d.saved;
  assert(saved.id && saved.version, "Draft not returned");
  const r = await A.request("/api/drafts", {
    method: "POST",
    body: {
      draftId: saved.id,
      expectedVersion: saved.version + 5,
      kind: "DEBT_CONTRACT_NEW",
      subjectId: null,
      title: "Stale",
      content: {},
      schemaVersion: 1,
    },
  });
  assert(r.status === 409, "Stale draft not refused");
  const s = await state(A);
  assert(
    !s.liabilities.some((x) => x.name === "Dette non validée"),
    "Draft affected canonical debt",
  );
  return { stale_status: r.status };
});
const csv = [
  "date;ouverture;principal;interet;assurance;frais;cloture;total",
  "2026-11-05;2000;1000;0;5;0;1000;1005",
  "2026-12-05;1000;1000;0;5;0;0;1005",
].join("\n");
async function upload(session, name, bytes, id = liabilityId) {
  const body = new FormData();
  body.set(
    "file",
    new File([bytes], name, {
      type: name.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv",
    }),
  );
  body.set("options", JSON.stringify({ liabilityId: id, declaredCurrency: "EUR" }));
  return session.request("/api/debt/schedule-documents", { method: "POST", body });
}
await step("Real CSV upload, private storage and all sixteen cells retained", async () => {
  const r = await upload(A, "B19-echéancier-complet.csv", csv);
  assert(r.status === 201, `CSV upload failed (${r.status}): ${JSON.stringify(r.data)}`);
  const v = r.data;
  csvRunId = v.run.runId;
  assert(v.fields.length === 16 && v.run.completeness === "COMPLETE", "CSV incomplete");
  assert(v.fields.find((f) => f.cellRef === "E2").rawValue === "5", "Raw cell missing");
  return { http_status: r.status, cells: v.fields.length, completeness: v.run.completeness };
});
await step("Original CSV downloadable through one-minute signed Storage URL", async () => {
  const r = await A.request(`/api/debt/schedule-documents?piece=${csvRunId}`);
  assert(r.status === 200, "Piece URL refused");
  const u = new URL(r.data.url);
  assert(u.hostname === `${ref}.supabase.co`, "Wrong Storage host");
  const f = await fetch(u);
  assert(f.status === 200 && (await f.text()) === csv, "Retained file differs");
  return { download_status: f.status, bytes_match: true };
});
await step(
  "Foreign user cannot read review or original document or upload against A debt",
  async () => {
    for (const query of [`runId=${csvRunId}`, `piece=${csvRunId}`]) {
      const r = await B.request(`/api/debt/schedule-documents?${query}`);
      assert([404, 422].includes(r.status), `Foreign read not refused (${r.status})`);
    }
    const r = await upload(B, "foreign.csv", csv);
    assert(r.status === 422, "Foreign upload not refused");
    return { foreign_upload_status: r.status };
  },
);
await step("Motivated correction, stale decision and immutable history", async () => {
  let v = await review(csvRunId);
  const field = v.fields.find((f) => f.cellRef === "E2");
  const missing = await A.request("/api/debt/schedule-documents", {
    method: "PATCH",
    body: {
      action: "correct",
      fieldId: field.fieldId,
      expectedRevision: field.decisionRevision,
      userValue: "5",
    },
  });
  assert(missing.status === 422, "Correction without reason accepted");
  v = await command({
    action: "correct",
    fieldId: field.fieldId,
    expectedRevision: field.decisionRevision,
    userValue: "5",
    reason: "Relecture de la cellule synthétique E2",
  });
  const stale = await A.request("/api/debt/schedule-documents", {
    method: "PATCH",
    body: { action: "review", fieldId: field.fieldId, expectedRevision: field.decisionRevision },
  });
  assert(stale.status === 409, "Stale decision not refused");
  assert(
    v.decisions.some((d) => d.action === "CORRECT") &&
      v.fields.find((f) => f.fieldId === field.fieldId).rawValue === "5",
    "Decision/raw history missing",
  );
  return { missing_reason_status: missing.status, stale_status: stale.status };
});
await step("In-review redeposit refused without losing previous decisions", async () => {
  const before = await review(csvRunId);
  const r = await upload(A, "B19-redépôt.csv", csv);
  assert(r.status === 422, "In-review redeposit accepted");
  const after = await review(csvRunId);
  assert(after.decisions.length === before.decisions.length, "Prior decisions lost");
  return { http_status: r.status, decisions_preserved: true };
});
await step(
  "CSV validation persists, all checks pass, canonical schedule untouched (B20 deferred)",
  async () => {
    let v = await review(csvRunId);
    for (const f of v.fields.filter((f) => f.validationStatus === "EXTRACTED"))
      v = await command({
        action: "review",
        fieldId: f.fieldId,
        expectedRevision: f.decisionRevision,
      });
    v = await command({ action: "validate", runId: csvRunId });
    assert(v.run.status === "VALIDATED", "CSV not validated");
    assert(
      v.checks.every((c) => c.status === "PASSED"),
      "Checks did not pass",
    );
    const q = await admin
      .from("loan_schedules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", accounts[0].id);
    assert(!q.error && q.count === 0, "B19 wrote canonical schedules");
    return { status: v.run.status, checks: v.checks.length, canonical_schedule_rows: q.count };
  },
);
const rows = csv
  .split("\n")
  .map((line, r) =>
    line
      .split(";")
      .map((value, c) => ({
        ref: `${String.fromCharCode(65 + c)}${r + 1}`,
        value,
        type: r === 0 || c === 0 ? "inlineStr" : "n",
      })),
  );
const xlsx = buildWorkbook({ sheetName: "Échéancier synthétique", rows });
await step("Real XLSX ZIP upload and cell source coordinates preserved", async () => {
  const r = await upload(A, "B19-echeancier-complet.xlsx", xlsx);
  assert(r.status === 201, `XLSX failed (${r.status}): ${JSON.stringify(r.data)}`);
  const v = r.data;
  xlsxRunId = v.run.runId;
  assert(
    v.run.sourceFormat === "XLSX" && v.run.completeness === "COMPLETE" && v.fields.length === 16,
    "XLSX cells/completeness wrong",
  );
  assert(
    v.fields.every((f) => f.sheetName === "Échéancier synthétique"),
    "Sheet provenance lost",
  );
  return { cells: v.fields.length, source_format: v.run.sourceFormat };
});
await step("XLSX explicit exclusion and reconsideration keep decision history", async () => {
  let v = await review(xlsxRunId);
  let f = v.fields.find((f) => f.cellRef === "E2");
  v = await command({
    action: "reject",
    fieldId: f.fieldId,
    expectedRevision: f.decisionRevision,
    reason: "Exclusion synthétique pour vérifier la piste",
  });
  assert(
    v.fields.find((x) => x.fieldId === f.fieldId).validationStatus === "REJECTED",
    "Exclusion not retained",
  );
  f = v.fields.find((x) => x.fieldId === f.fieldId);
  v = await command({
    action: "review",
    fieldId: f.fieldId,
    expectedRevision: f.decisionRevision,
    reason: "Réintégration après contrôle du document synthétique",
  });
  assert(v.decisions.length === 2, "Decision history overwritten");
  return { decisions: v.decisions.length };
});
await step("XLSX final validation", async () => {
  let v = await review(xlsxRunId);
  for (const f of v.fields.filter((f) => f.validationStatus === "EXTRACTED"))
    v = await command({
      action: "review",
      fieldId: f.fieldId,
      expectedRevision: f.decisionRevision,
    });
  v = await command({ action: "validate", runId: xlsxRunId });
  assert(v.run.status === "VALIDATED", "XLSX not validated");
  return { status: v.run.status };
});
await step(
  "Logout invalidates replayed cookies and new login preserves reviews/drafts",
  async () => {
    const old = new Session();
    old.cookies = new Map(A.cookies);
    await ok(A, "/api/auth", undefined, 200, "DELETE");
    const replay = await old.request("/api/state");
    assert(replay.status === 401, "Revoked session accepted");
    await A.login(accounts[0]);
    const v = await review(xlsxRunId);
    assert(v.run.status === "VALIDATED", "Review lost after login");
    const d = await debts(A);
    assert(
      d.drafts.some((d) => d.title === "B19 brouillon synthétique"),
      "Draft lost after login",
    );
    return { replayed_cookie_status: replay.status, reviews_persist: true, drafts_persist: true };
  },
);
report.completed_at = new Date().toISOString();
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(
  "/workspace/scratch/lfo-b19-acceptance-ids.json",
  JSON.stringify({ ref, accountId, liabilityId, csvRunId, xlsxRunId }),
  { mode: 0o600 },
);
console.log(JSON.stringify({ passed: report.steps.length, report: reportPath }));
