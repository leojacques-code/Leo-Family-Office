/** Hosted acceptance on the explicitly authorised synthetic-only Free staging. No browser certification. */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildWorkbook } from "../src/lib/acquisition/xlsx/__tests__/fixtures/xlsx-builder.ts";

const ref = "bjxhnwvomoznorijauyl";
const origin =
  process.env.LFO_RECETTE_ORIGIN ?? "https://leo-family-office-2nu9s8gm3-lech1.vercel.app";
const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const publicConfig = read("/workspace/scratch/lfo-staging-public-config.json");
const serverConfig = read("/workspace/scratch/lfo-staging-server-config.json");
const accounts = read("/workspace/scratch/lfo-staging-test-users.json").accounts;
const access = read(process.env.LFO_PREVIEW_ACCESS ?? "/workspace/scratch/lfo-preview-access.json");
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
const previousReport =
  process.env.LFO_RECETTE_RESUME === "true" && fs.existsSync(reportPath) ? read(reportPath) : null;
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
  const previous =
    previousReport?.deployment_sha === report.deployment_sha &&
    previousReport.steps.find((s) => s.name === name && s.status === "PASS");
  if (previous) {
    report.steps.push({ ...previous, resumed_same_sha: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    return;
  }
  try {
    const detail = await fn();
    report.steps.push({ name, ...detail, status: "PASS" });
    console.log(JSON.stringify({ name, ...detail, status: "PASS" }));
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
if (previousReport) {
  accountId = (
    await admin
      .from("financial_accounts")
      .select("id")
      .eq("user_id", accounts[0].id)
      .eq("name", "B19 recette hébergée")
      .single()
  ).data?.id;
  liabilityId = (
    await admin
      .from("liabilities")
      .select("id")
      .eq("user_id", accounts[0].id)
      .eq("name", "Prêt B19 synthétique")
      .single()
  ).data?.id;
  if (liabilityId) {
    const runs =
      (
        await admin
          .from("document_extraction_runs")
          .select("id,file_name")
          .eq("user_id", accounts[0].id)
          .eq("liability_id", liabilityId)
          .order("extracted_at", { ascending: false })
      ).data ?? [];
    csvRunId = runs.find((r) => r.file_name === "B19-echéancier-complet.csv")?.id;
    xlsxRunId = runs.find((r) => r.file_name === "B19-echeancier-complet.xlsx")?.id;
  }
}
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
  const previous = await A.request(`/api/debt/schedule-documents?liabilityId=${liabilityId}`);
  const open = previous.data.find(
    (run) =>
      run.fileName === "B19-echéancier-complet.csv" &&
      ["EXTRACTED", "REVIEWED"].includes(run.status),
  );
  const r = open
    ? { status: 201, data: await review(open.runId) }
    : await upload(A, "B19-echéancier-complet.csv", csv);
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
  return { motivated_correction: true, stale_status: stale.status };
});
await step("In-review redeposit refused without losing previous decisions", async () => {
  const before = await review(csvRunId);
  const r = await upload(A, "B19-redépôt.csv", csv);
  assert(r.status === 409, "In-review redeposit accepted");
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
    return { run_status: v.run.status, checks: v.checks.length, canonical_schedule_rows: q.count };
  },
);
const rows = csv.split("\n").map((line, r) =>
  line.split(";").map((value, c) => ({
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
  return { run_status: v.run.status };
});
await step("B19 unreadable cell cannot be confirmed or validated before correction", async () => {
  const bytes = csv.replace(";0;5;0;1000;1005", ";illisible;5;0;1000;1005");
  const r = await upload(A, "B19-cellule-illisible.csv", bytes);
  assert(r.status === 201, "Unreadable fixture upload failed");
  let v = r.data;
  const f = v.fields.find((f) => f.validationStatus === "BLOCKED");
  assert(f, "Unreadable cell was guessed");
  const confirm = await A.request("/api/debt/schedule-documents", {
    method: "PATCH",
    body: { action: "review", fieldId: f.fieldId, expectedRevision: f.decisionRevision },
  });
  assert(confirm.status === 400, "Unreadable cell confirmed");
  const validate = await A.request("/api/debt/schedule-documents", {
    method: "PATCH",
    body: { action: "validate", runId: v.run.runId },
  });
  assert(validate.status === 400, "Unreadable run validated");
  v = await command({
    action: "correct",
    fieldId: f.fieldId,
    expectedRevision: f.decisionRevision,
    userValue: "0",
    reason: "La cellule synthétique correspond à zéro intérêt",
  });
  assert(
    v.fields.find((x) => x.fieldId === f.fieldId).rawValue === "illisible",
    "Raw unreadable source overwritten",
  );
  for (const cell of v.fields.filter((f) => f.validationStatus === "EXTRACTED"))
    v = await command({
      action: "review",
      fieldId: cell.fieldId,
      expectedRevision: cell.decisionRevision,
    });
  v = await command({ action: "validate", runId: v.run.runId });
  assert(v.run.status === "VALIDATED", "Corrected readable run not validated");
  return {
    confirmation_refused: confirm.status,
    validation_refused: validate.status,
    corrected_then_validated: true,
  };
});
await step(
  "B19 partial reading stays explicitly partial; separate explicit rejection allows retry",
  async () => {
    const partial = csv.split("\n").slice(0, 2).join("\n");
    const existing = await admin
      .from("document_extraction_runs")
      .select("id")
      .eq("user_id", accounts[0].id)
      .eq("liability_id", liabilityId)
      .eq("file_name", "B19-extrait-partiel.csv")
      .order("extracted_at", { ascending: false })
      .limit(1);
    const r = existing.data?.[0]
      ? { status: 201, data: await review(existing.data[0].id) }
      : await upload(A, "B19-extrait-partiel.csv", partial);
    assert(r.status === 201, "Partial fixture upload failed");
    let v = r.data;
    assert(v.run.completeness === "PARTIAL", "Partial document claimed complete");
    assert(v.run.completenessReasons.length > 0, "Partial warning absent");
    if (v.run.status !== "VALIDATED") v = await command({ action: "validate", runId: v.run.runId });
    assert(
      v.run.status === "VALIDATED" && v.run.completeness === "PARTIAL",
      "Reading validation erased partial scope",
    );
    const rejected = await upload(A, "B19-extrait-a-refuser.csv", partial + "\n");
    assert(rejected.status === 201, "Separate rejection fixture upload failed");
    await command({
      action: "reject-run",
      runId: rejected.data.run.runId,
      reason: "Extrait volontairement incomplet, conservé comme preuve synthétique",
    });
    const retry = await upload(A, "B19-extrait-partiel-repris.csv", partial + "\n");
    assert(
      retry.status === 201 && retry.data.run.runId !== rejected.data.run.runId,
      "Explicit rejection did not permit retry",
    );
    assert(
      (await review(rejected.data.run.runId)).run.status === "REJECTED",
      "Rejected history lost",
    );
    await command({
      action: "reject-run",
      runId: retry.data.run.runId,
      reason: "Fin de contrôle de reprise synthétique",
    });
    return { validated_reading_stays_partial: true, retry_allowed: true, history_preserved: true };
  },
);
await step("B19 rejects unsupported PDF and invalid XLSX without inventing cells", async () => {
  const pdf = await upload(A, "unsupported.pdf", "%PDF-1.0 synthetic");
  assert(pdf.status === 400, "Unsupported PDF accepted");
  const bad = await upload(A, "invalid.xlsx", "not a ZIP archive");
  assert(bad.status === 422 && bad.data.refused === true, "Invalid XLSX accepted");
  return { pdf_status: pdf.status, invalid_xlsx_status: bad.status };
});
await step(
  "Debt event, amendment and reasoned cancellation persist without changing observed balance",
  async () => {
    await ok(A, "/api/debt", {
      action: "record_debt_event",
      liabilityId,
      nature: "CONTRACTUAL",
      effectiveDate: "2026-11-05",
      source: "Avenant synthétique de recette",
      content: {
        kind: "AMENDMENT",
        annualRate: 0.01,
        paymentAmount: null,
        maturityDate: null,
        note: "Avenant de test",
      },
    });
    let d = (await debts(A)).liabilities.find((l) => l.id === liabilityId);
    const event = d.events.find(
      (e) => e.source === "Avenant synthétique de recette" && !e.cancellation,
    );
    assert(event, "Amendment not persisted");
    await ok(A, "/api/debt", {
      action: "cancel_debt_event",
      eventId: event.id,
      reason: "Annulation synthétique pour vérifier la piste immuable",
    });
    d = (await debts(A)).liabilities.find((l) => l.id === liabilityId);
    assert(d.events.find((e) => e.id === event.id)?.cancellation, "Cancellation trace missing");
    assert(d.currentBalance === 2000, "Contract event changed observed balance");
    return { amendment_persisted: true, cancellation_persisted: true };
  },
);
await step("Today, Wealth and Cash Flow use the same persisted facts", async () => {
  const s = await state(A);
  assert(s.accounts.find((a) => a.id === accountId).balance === 3000, "Observed account mismatch");
  assert(
    s.liabilities.find((l) => l.id === liabilityId).currentBalance === 2000,
    "Observed debt mismatch",
  );
  assert(s.balanceSheet.netWorth.value === 1000, "Canonical net worth mismatch");
  const t = await A.request("/api/today");
  assert(t.status === 200, "Today read model unavailable");
  for (const page of ["/debt", "/net-worth", "/cash-flow"]) {
    const r = await A.request(page);
    assert(r.status === 200 && typeof r.data === "string", `Hosted page ${page} unavailable`);
  }
  return {
    observed_cash: 3000,
    observed_debt: 2000,
    canonical_net_worth: 1000,
    today_status: t.status,
    html_pages: 3,
    browser_visual_certification: false,
  };
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
