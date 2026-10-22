// Recette Auth à deux utilisateurs sur la pile locale de `services.sh`.
//
// Ce que ce script PROUVE : le parcours réel de l'application (build de production) contre
// les serveurs Supabase officiels auto-hébergés (GoTrue, PostgREST, Storage, Kong) : création,
// confirmation par le VRAI lien émis par Auth, sessions, renouvellement, révocation, isolation
// API/PostgREST/SQL/Storage entre A et B, absence de données de démonstration.
// Ce qu'il NE prouve PAS : la configuration du projet Supabase HÉBERGÉ (Site URL, liste de
// redirections, envoi de mails, clés), ni la preview Vercel. Ces preuves restent à faire sur
// l'environnement de recette hébergé.
//
// Entrées : RECETTE_DIR (clés, mails), RECETTE_APP (URL de l'app), RECETTE_OUT (preuves),
// RECETTE_PLAYWRIGHT (chemin du module playwright), RECETTE_ADMIN_DB_URL (lecture SQL).
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} requis`);
  return value;
};
const DIR = env("RECETTE_DIR");
const APP = env("RECETTE_APP");
const OUT = env("RECETTE_OUT");
const require = createRequire(env("RECETTE_PLAYWRIGHT"));
const { chromium } = require("playwright");
const pg = createRequire(import.meta.url)("pg");
const GATEWAY = process.env.RECETTE_GATEWAY ?? "http://127.0.0.1:55321";
const ANON = readFileSync(`${DIR}/anon.key`, "utf8").trim();
const SKIP_RENEWAL = process.env.RECETTE_SKIP_RENEWAL === "1";
for (const host of [
  new URL(APP).hostname,
  new URL(GATEWAY).hostname,
  new URL(env("RECETTE_ADMIN_DB_URL")).hostname,
])
  if (!["localhost", "127.0.0.1"].includes(host))
    throw new Error(`Hôte non local refusé : ${host}`);

mkdirSync(OUT, { recursive: true });
const checks = [];
function check(id, label, ok, detail = {}) {
  checks.push({ id, label, ok: Boolean(ok), ...detail });
  console.log(
    `${ok ? "OK  " : "ÉCHEC"} ${id} ${label}${Object.keys(detail).length ? " " + JSON.stringify(detail) : ""}`,
  );
}
const sql = new pg.Client({ connectionString: env("RECETTE_ADMIN_DB_URL") });
await sql.connect();
const one = async (text, values = []) => (await sql.query(text, values)).rows[0];

const stamp = Date.now();
const users = {
  A: { email: `recette-a-${stamp}@lfo.invalid`, password: `A-recette-${stamp}-ok` },
  B: { email: `recette-b-${stamp}@lfo.invalid`, password: `B-recette-${stamp}-ok` },
};

function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
async function confirmationLink(email) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const files = readdirSync(`${DIR}/mails`).sort().reverse();
    for (const file of files) {
      const raw = decodeQuotedPrintable(readFileSync(`${DIR}/mails/${file}`, "utf8"));
      if (!raw.includes(email)) continue;
      const match = raw.match(/https?:\/\/[^\s"'<>]+\/verify\?[^\s"'<>]+/);
      if (match) return match[0].replaceAll("&amp;", "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Aucun mail de confirmation pour ${email}`);
}
/** Jeton d'accès lu dans le cookie @supabase/ssr (éventuellement découpé en morceaux). */
async function accessToken(context) {
  const cookies = (await context.cookies()).filter((c) =>
    /^sb-.+-auth-token(\.\d+)?$/.test(c.name),
  );
  const joined = cookies
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map((c) => c.value)
    .join("");
  const json = joined.startsWith("base64-")
    ? Buffer.from(joined.slice(7), "base64url").toString("utf8")
    : decodeURIComponent(joined);
  return JSON.parse(json).access_token;
}
const claims = (token) =>
  JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
async function rest(path, token, init = {}) {
  const response = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* corps non JSON conservé tel quel */
  }
  return { status: response.status, body };
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

const browser = await chromium.launch(
  process.env.RECETTE_CHROMIUM ? { executablePath: process.env.RECETTE_CHROMIUM } : {},
);
const contexts = {};
try {
  // ---------- A : création, confirmation, espace vierge ----------
  const ctxA = (contexts.A = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "fr-FR",
  }));
  const pageA = await ctxA.newPage();
  const browserErrors = [];
  pageA.on("pageerror", (error) => browserErrors.push(String(error)));
  await pageA.goto(`${APP}/login`);
  await pageA.getByRole("button", { name: "Créer un espace personnel" }).click();
  await pageA.getByLabel("Adresse e-mail").fill(users.A.email);
  await pageA.getByLabel("Mot de passe").fill(users.A.password);
  await pageA.getByRole("button", { name: "Créer mon espace" }).click();
  await pageA.getByRole("status").waitFor();
  const statusText = await pageA.getByRole("status").innerText();
  check(
    "A1",
    "création A : confirmation d'adresse demandée",
    /Confirmez votre adresse/.test(statusText),
  );
  await shot(pageA, "01_A_creation_confirmation_demandee_bureau");
  const pendingA = await one("select id, email_confirmed_at from auth.users where email = $1", [
    users.A.email,
  ]);
  users.A.id = pendingA?.id;
  check(
    "A2",
    "A existe dans auth.users, adresse non confirmée, aucun profil",
    pendingA &&
      pendingA.email_confirmed_at === null &&
      Number(
        (await one("select count(*) from public.profiles where user_id = $1", [pendingA.id])).count,
      ) === 0,
  );
  const early = await pageA.request.post(`${APP}/api/auth`, {
    data: { email: users.A.email, password: users.A.password, intent: "sign-in" },
    headers: { Origin: APP },
  });
  check("A3", "connexion refusée avant confirmation", early.status() === 401, {
    status: early.status(),
  });

  const linkA = await confirmationLink(users.A.email);
  check(
    "A4",
    "lien de confirmation émis par Auth vers /auth/confirm",
    decodeURIComponent(linkA).includes(`${APP}/auth/confirm`),
  );
  await pageA.goto(linkA);
  await pageA.waitForURL(/\/setup/, { timeout: 15000 });
  check("A5", "lien suivi : session ouverte et accueil personnel", /\/setup/.test(pageA.url()), {
    url: new URL(pageA.url()).pathname,
  });
  await shot(pageA, "02_A_accueil_espace_vierge_bureau");
  const profileA = await one(
    "select display_name, reporting_currency from public.profiles where user_id = $1",
    [users.A.id],
  );
  check(
    "A6",
    "profil vide unique créé à la confirmation",
    profileA?.display_name === "Espace personnel",
    profileA ?? {},
  );

  await pageA.getByLabel("Nom de votre espace").fill("Espace A recette");
  await pageA.getByRole("button", { name: "Enregistrer mes choix" }).click();
  await pageA.getByText("Vos choix sont enregistrés").waitFor();
  await pageA.reload();
  check(
    "A7",
    "nom de l'espace enregistré puis relu après rechargement",
    (await pageA.getByLabel("Nom de votre espace").inputValue()) === "Espace A recette",
  );

  // Données de A écrites par l'application (compte + document) pour éprouver l'isolation.
  const addA = await pageA.request.post(`${APP}/api/state`, {
    headers: { Origin: APP },
    data: {
      action: "add_account",
      institution: "Banque recette A",
      name: "Compte A",
      accountType: "BANK",
      balance: 1234.56,
      balanceDate: "2026-09-20",
      currency: "EUR",
    },
  });
  const accountA = await one("select id from public.financial_accounts where user_id = $1", [
    users.A.id,
  ]);
  check("A8", "A crée un compte par l'API applicative", addA.ok() && accountA, {
    status: addA.status(),
  });
  const docA = await pageA.request.post(`${APP}/api/documents`, {
    headers: { Origin: APP },
    multipart: {
      category: "bank",
      file: {
        name: "releve-a.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n% recette A\n"),
      },
    },
  });
  const documentA = await one("select id, storage_path from public.documents where user_id = $1", [
    users.A.id,
  ]);
  check("A9", "A dépose un document au coffre privé", docA.status() === 201 && documentA, {
    status: docA.status(),
  });

  // ---------- Sessions : persistance, renouvellement ----------
  const tokenA1 = await accessToken(ctxA);
  const sessionA = claims(tokenA1).session_id;
  const pageA2 = await ctxA.newPage();
  await pageA2.goto(`${APP}/`);
  check("S1", "session conservée dans un nouvel onglet", !pageA2.url().includes("/login"));
  await pageA2.close();
  if (!SKIP_RENEWAL) {
    const wait = Math.max(0, claims(tokenA1).exp * 1000 - Date.now()) + 5000;
    console.log(`… attente de l'expiration du JWT (${Math.round(wait / 1000)} s)`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    const state = await pageA.request.get(`${APP}/api/state`);
    const tokenA2 = await accessToken(ctxA);
    check(
      "S2",
      "JWT expiré : session renouvelée sans reconnexion, même session",
      state.ok() &&
        tokenA2 !== tokenA1 &&
        claims(tokenA2).session_id === sessionA &&
        claims(tokenA2).exp > claims(tokenA1).exp,
      { status: state.status() },
    );
  }

  // ---------- B : espace vierge et isolation ----------
  const ctxB = (contexts.B = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    locale: "fr-FR",
  }));
  const pageB = await ctxB.newPage();
  await pageB.goto(`${APP}/login`);
  await pageB.getByRole("button", { name: "Créer un espace personnel" }).click();
  await pageB.getByLabel("Adresse e-mail").fill(users.B.email);
  await pageB.getByLabel("Mot de passe").fill(users.B.password);
  await pageB.getByRole("button", { name: "Créer mon espace" }).click();
  await pageB.getByRole("status").waitFor();
  await shot(pageB, "03_B_creation_mobile");
  await pageB.goto(await confirmationLink(users.B.email));
  await pageB.waitForURL(/\/setup/, { timeout: 15000 });
  users.B.id = (await one("select id from auth.users where email = $1", [users.B.email])).id;
  check("B1", "B confirmé, accueil personnel", /\/setup/.test(pageB.url()));
  await shot(pageB, "04_B_accueil_espace_vierge_mobile");
  const scroll = await pageB.evaluate(() => document.documentElement.scrollWidth);
  check("B2", "accueil mobile sans débordement horizontal", scroll <= 390, { scrollWidth: scroll });

  const stateB = await (await pageB.request.get(`${APP}/api/state`)).text();
  check(
    "B3",
    "B : aucun objet de A dans l'état applicatif",
    !stateB.includes("Compte A") && !stateB.includes(accountA.id) && !stateB.includes("releve-a"),
  );
  const rowsB = await one(
    `select (select count(*) from public.financial_accounts where user_id = $1)
          + (select count(*) from public.liabilities where user_id = $1)
          + (select count(*) from public.documents where user_id = $1)
          + (select count(*) from public.goals where user_id = $1) as total`,
    [users.B.id],
  );
  check(
    "B4",
    "B : espace vierge en base (aucun compte, dette, document, objectif)",
    Number(rowsB.total) === 0,
    rowsB,
  );

  const tokenB = await accessToken(ctxB);
  const readA = await rest(
    `/rest/v1/financial_accounts?select=id,name&id=eq.${accountA.id}`,
    tokenB,
  );
  check(
    "B5",
    "PostgREST sous le JWT de B : compte de A invisible (RLS)",
    readA.status === 200 && Array.isArray(readA.body) && readA.body.length === 0,
    { status: readA.status },
  );
  const ownA = await rest(`/rest/v1/financial_accounts?select=id`, await accessToken(ctxA));
  check(
    "B6",
    "contrôle positif : A lit bien son compte sous son JWT",
    Array.isArray(ownA.body) && ownA.body.length === 1,
  );
  // Ligne complète et valide : seul le propriétaire est faux, le refus doit venir de la RLS (42501).
  const forgeB = await rest(`/rest/v1/financial_accounts`, tokenB, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: users.A.id,
      name: "Intrus",
      account_type: "BANK",
      currency: "EUR",
      liquidity: "IMMEDIATE",
      data_kind: "ACTUAL",
      confidence: "HIGH",
    }),
  });
  check(
    "B7",
    "PostgREST : B ne peut pas écrire une ligne au nom de A (RLS)",
    forgeB.status === 403 && forgeB.body?.code === "42501",
    { status: forgeB.status, code: forgeB.body?.code },
  );
  const updateB = await rest(`/rest/v1/financial_accounts?id=eq.${accountA.id}`, tokenB, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ name: "Modifié par B" }),
  });
  const nameAfter = (
    await one("select name from public.financial_accounts where id = $1", [accountA.id])
  ).name;
  check("B8", "PostgREST : B ne peut pas modifier le compte de A", nameAfter === "Compte A", {
    status: updateB.status,
  });
  const rpcB = await rest(`/rest/v1/rpc/lfo_verify_session`, tokenB, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_user_id: users.A.id, p_session_id: sessionA }),
  });
  // 401/403 = refus de droit ; un 404 (RPC absente) ne prouverait rien.
  check(
    "B9",
    "RPC de session réservée au serveur : refusée sous le JWT de B",
    [401, 403].includes(rpcB.status),
    { status: rpcB.status, code: rpcB.body?.code },
  );

  // Charge VALIDE en tout point sauf la propriété du compte : le refus ne peut venir que de là.
  const balancesBefore = Number(
    (await one("select count(*) from public.account_balances where account_id = $1", [accountA.id]))
      .count,
  );
  const crossUpdate = await pageB.request.post(`${APP}/api/state`, {
    headers: { Origin: APP },
    data: {
      action: "update_account",
      accountId: accountA.id,
      balance: 1,
      balanceDate: "2026-09-21",
    },
  });
  const balancesAfter = Number(
    (await one("select count(*) from public.account_balances where account_id = $1", [accountA.id]))
      .count,
  );
  check(
    "B10",
    "API applicative : B ne peut pas corriger le solde du compte de A",
    !crossUpdate.ok() && balancesAfter === balancesBefore,
    {
      status: crossUpdate.status(),
      observationsAvant: balancesBefore,
      observationsApres: balancesAfter,
    },
  );

  const objectB = await rest(
    `/storage/v1/object/authenticated/family-office-documents/${documentA.storage_path}`,
    tokenB,
  );
  check("B11", "Storage : B ne peut pas télécharger le document de A", objectB.status >= 400, {
    status: objectB.status,
    motif: objectB.body?.message,
  });
  const objectA = await rest(
    `/storage/v1/object/authenticated/family-office-documents/${documentA.storage_path}`,
    await accessToken(ctxA),
  );
  check("B12", "contrôle positif Storage : A télécharge son document", objectA.status === 200, {
    status: objectA.status,
  });
  const signB = await rest(
    `/storage/v1/object/sign/family-office-documents/${documentA.storage_path}`,
    tokenB,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    },
  );
  check("B13", "Storage : B ne peut pas signer d'URL sur l'objet de A", signB.status >= 400, {
    status: signB.status,
    motif: signB.body?.message,
  });
  const uploadB = await rest(
    `/storage/v1/object/family-office-documents/${users.A.id}/intrus.pdf`,
    tokenB,
    {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: "%PDF-1.4 intrus",
    },
  );
  check(
    "B14",
    "Storage : B ne peut pas déposer dans le dossier de A",
    uploadB.status >= 400 && /row-level security/i.test(uploadB.body?.message ?? ""),
    { status: uploadB.status, motif: uploadB.body?.message },
  );
  const listB = await rest(`/storage/v1/object/list/family-office-documents`, tokenB, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: users.A.id }),
  });
  const listA = await rest(
    `/storage/v1/object/list/family-office-documents`,
    await accessToken(ctxA),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: users.A.id }),
    },
  );
  check(
    "B15",
    "Storage : B ne liste aucun objet du dossier de A, que A liste bien",
    Array.isArray(listA.body) &&
      listA.body.length === 1 &&
      (listB.status >= 400 || (Array.isArray(listB.body) && listB.body.length === 0)),
    { statusB: listB.status, objetsVusParA: Array.isArray(listA.body) ? listA.body.length : null },
  );

  // ---------- Déconnexion et révocation ----------
  const oldCookiesA = await ctxA.cookies();
  await pageA.goto(`${APP}/`);
  await pageA.getByRole("button", { name: "Déconnexion" }).first().click();
  await pageA.waitForURL(/\/login/, { timeout: 15000 });
  check("R1", "déconnexion de A : retour à la connexion", /\/login/.test(pageA.url()));
  const sessionRow = Number(
    (await one("select count(*) from auth.sessions where id = $1", [sessionA])).count,
  );
  check("R2", "session de A supprimée côté Auth", sessionRow === 0);
  const replay = await browser.newContext();
  await replay.addCookies(oldCookiesA);
  const replayState = await replay.request.get(`${APP}/api/state`);
  check(
    "R3",
    "rejeu des anciens cookies de A après déconnexion : refusé",
    replayState.status() === 401,
    { status: replayState.status() },
  );
  await replay.close();

  const ctxA3 = await browser.newContext();
  const loginA = await ctxA3.request.post(`${APP}/api/auth`, {
    headers: { Origin: APP },
    data: { email: users.A.email, password: users.A.password, intent: "sign-in" },
  });
  check("R4", "reconnexion de A par mot de passe", loginA.ok(), { status: loginA.status() });
  const sessionA3 = claims(await accessToken(ctxA3)).session_id;
  await sql.query("delete from auth.sessions where id = $1", [sessionA3]); // révocation par l'administrateur
  const revoked = await ctxA3.request.get(`${APP}/api/state`);
  check(
    "R5",
    "session révoquée côté Auth : JWT encore valide mais accès refusé",
    revoked.status() === 401,
    { status: revoked.status() },
  );
  await ctxA3.close();
  // Révocation propre à l'application : une session dont `not_after` est passé reste acceptée
  // par GoTrue tant que son JWT vit ; seul `lfo_verify_session` la refuse. Ce contrôle prouve
  // donc la garde de l'application, et non celle d'Auth.
  const ctxA4 = await browser.newContext();
  const loginA4 = await ctxA4.request.post(`${APP}/api/auth`, {
    headers: { Origin: APP },
    data: { email: users.A.email, password: users.A.password, intent: "sign-in" },
  });
  const tokenA4 = await accessToken(ctxA4);
  const sessionA4 = claims(tokenA4).session_id;
  const service = readFileSync(`${DIR}/service.key`, "utf8").trim();
  const verify = async () =>
    (
      await fetch(`${GATEWAY}/rest/v1/rpc/lfo_verify_session`, {
        method: "POST",
        headers: {
          apikey: service,
          Authorization: `Bearer ${service}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_user_id: users.A.id, p_session_id: sessionA4 }),
      })
    ).json();
  const liveBefore = await verify();
  await sql.query(
    "update auth.sessions set not_after = now() - interval '1 minute' where id = $1",
    [sessionA4],
  );
  const verifyAfter = await verify();
  const gotrueUser = await fetch(`${GATEWAY}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${tokenA4}` },
  });
  const appAfter = await ctxA4.request.get(`${APP}/api/state`);
  check(
    "R6",
    "session expirée par not_after : lfo_verify_session la refuse sur le vrai schéma Auth",
    loginA4.ok() && liveBefore === true && verifyAfter === false,
    { avant: liveBefore, apres: verifyAfter },
  );
  check(
    "R7",
    "l'application refuse la session expirée même si GoTrue l'accepte encore",
    appAfter.status() === 401,
    { app: appAfter.status(), gotrueUser: gotrueUser.status },
  );
  await ctxA4.close();
  const demoRows = await one(
    `select count(*) as total from public.financial_accounts where name ilike '%démo%' or name ilike '%demo%'`,
  );
  check("D1", "aucune donnée de démonstration en base de recette", Number(demoRows.total) === 0);
  check("E1", "aucune erreur JavaScript dans la page de A", browserErrors.length === 0, {
    errors: browserErrors.slice(0, 3),
  });
} finally {
  await browser.close();
  const version = await one(
    "select count(*) as migrations from supabase_migrations.schema_migrations",
  );
  writeFileSync(
    `${OUT}/recette-auth-ab.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        app: APP,
        migrations: Number(version.migrations),
        environnement:
          "pile Supabase auto-hébergée locale (GoTrue v2.196.0, PostgREST v14.17, Storage v1.74.0, Kong 3.9.3, PostgreSQL 16)",
        nonProuve: ["projet Supabase hébergé", "preview Vercel", "envoi réel de mails"],
        utilisateurs: { A: users.A.email, B: users.B.email },
        checks,
      },
      null,
      2,
    ),
  );
  await sql.end();
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} contrôles réussis`);
  process.exitCode = failed ? 1 : 0;
}
