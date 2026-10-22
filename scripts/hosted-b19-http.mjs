/** Real hosted HTTP acceptance. Credentials stay outside Git and never enter the report. */
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ref = "bjxhnwvomoznorijauyl";
const origin = "https://leo-family-office-2nu9s8gm3-lech1.vercel.app";
const publicConfig = JSON.parse(
  fs.readFileSync("/workspace/scratch/lfo-staging-public-config.json", "utf8"),
);
const serverConfig = JSON.parse(
  fs.readFileSync("/workspace/scratch/lfo-staging-server-config.json", "utf8"),
);
const access = JSON.parse(fs.readFileSync("/workspace/scratch/lfo-preview-access.json", "utf8"));
if (
  publicConfig.project_ref !== ref ||
  serverConfig.project_ref !== ref ||
  new URL(access.url).origin !== origin
)
  throw Error("Target guard");
const admin = createClient(`https://${ref}.supabase.co`, serverConfig.secret_key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const credentialPath = "/workspace/scratch/lfo-staging-test-users.json";
const reportPath = "docs/consolidation/preuves/integration-b19-2026-10-15/hosted-http.json";
const report = {
  staging_ref: ref,
  preview_origin: origin,
  deployment_sha: "9cb4f4b11adaf3f2eb9259c4f86cb36bd6438014",
  method: "Real HTTP to deployed application and hosted Supabase; no browser UI certification",
  email_signup_confirmed: false,
  steps: [],
};

class Session {
  cookies = new Map();
  async request(path, options = {}) {
    const url = new URL(path, origin);
    if (url.origin !== origin) throw Error("HTTP origin guard");
    const headers = new Headers(options.headers);
    headers.set("Origin", origin);
    headers.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    let body = options.body;
    if (body && !(body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }
    const res = await fetch(url, { ...options, body, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0];
      const index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("application/json") ? await res.json() : await res.text();
    return { status: res.status, headers: res.headers, data };
  }
  async protection() {
    let path = access.url;
    for (let i = 0; i < 6; i++) {
      const r = await this.request(path);
      if (r.status < 300 || r.status >= 400) return r;
      const location = r.headers.get("location");
      if (!location) throw Error("Redirect missing");
      path = new URL(location, origin).href;
    }
    throw Error("Redirect limit");
  }
}
function expect(condition, label) {
  if (!condition) throw Error(label);
}
async function step(name, fn) {
  try {
    const detail = await fn();
    report.steps.push({ name, status: "PASS", ...detail });
    console.log(JSON.stringify({ name, status: "PASS", ...detail }));
  } catch (e) {
    const detail = {
      name,
      status: "FAIL",
      reason: e instanceof Error ? e.message : "Unknown failure",
    };
    report.steps.push(detail);
    console.log(JSON.stringify(detail));
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
}

const A = new Session(),
  B = new Session();
await step("Vercel protection access", async () => {
  const r = await A.protection();
  expect(r.status === 200, "Protected preview unavailable");
  expect(
    typeof r.data === "string" && r.data.includes("Accéder au Family Office"),
    "Wrong application",
  );
  return { http_status: r.status };
});
await B.protection();
await step("Unauthenticated app state refused", async () => {
  const r = await A.request("/api/state");
  expect(r.status === 401, "Unauthenticated state not refused");
  return { http_status: r.status };
});

let accounts;
if (fs.existsSync(credentialPath))
  accounts = JSON.parse(fs.readFileSync(credentialPath, "utf8")).accounts;
else {
  accounts = [];
  for (const label of ["A", "B"]) {
    const email = `lfo-b19-${label.toLowerCase()}-20261015@example.test`;
    const password = crypto.randomBytes(24).toString("base64url");
    const result = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { test_purpose: "LFO B19 hosted acceptance" },
    });
    if (result.error)
      throw Error(
        `Test user ${label} provisioning failed (${result.error.code ?? result.error.status})`,
      );
    accounts.push({ label, email, password, id: result.data.user.id });
    fs.writeFileSync(credentialPath, JSON.stringify({ staging_ref: ref, accounts }), {
      mode: 0o600,
    });
  }
}
expect(
  accounts.length === 2 && accounts[0].id !== accounts[1].id,
  "Distinct test accounts required",
);
report.account_provisioning =
  "Synthetic accounts created with Supabase Auth Admin, confirmed administratively; not a signup/email confirmation test";

for (const [i, session] of [A, B].entries()) {
  const account = accounts[i];
  await step(`Auth ${account.label} real application login`, async () => {
    const r = await session.request("/api/auth", {
      method: "POST",
      body: { email: account.email, password: account.password, intent: "sign-in" },
    });
    expect(r.status === 200 && r.data.ok === true, `Login refused (${r.status})`);
    return { http_status: r.status };
  });
  await step(`Auth ${account.label} empty initial state`, async () => {
    const r = await session.request("/api/state");
    expect(r.status === 200, `State unavailable (${r.status})`);
    expect(Array.isArray(r.data.accounts) && r.data.accounts.length === 0, "New account not empty");
    return {
      http_status: r.status,
      top_level_keys: Object.keys(r.data),
      accounts: r.data.accounts.length,
    };
  });
}
fs.writeFileSync(
  "/workspace/scratch/lfo-hosted-http-sessions.json",
  JSON.stringify({ origin, A: [...A.cookies], B: [...B.cookies] }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    report: reportPath,
    passed: report.steps.filter((s) => s.status === "PASS").length,
    failed: report.steps.filter((s) => s.status === "FAIL").length,
  }),
);
