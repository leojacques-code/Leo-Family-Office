// Recette des brouillons persistants du contrat de dette (document 03 §8 ; arbitrage du
// 25 septembre 2026). Pile locale de `services.sh`, build de production.
//
// Entrées : RECETTE_DIR, RECETTE_APP, RECETTE_OUT, RECETTE_PLAYWRIGHT, RECETTE_ADMIN_DB_URL,
// RECETTE_CHROMIUM (facultatif).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} requis`);
  return value;
};
const DIR = env("RECETTE_DIR");
const APP = env("RECETTE_APP");
const OUT = env("RECETTE_OUT");
const GATEWAY = process.env.RECETTE_GATEWAY ?? "http://127.0.0.1:55321";
for (const host of [
  new URL(APP).hostname,
  new URL(GATEWAY).hostname,
  new URL(env("RECETTE_ADMIN_DB_URL")).hostname,
])
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`Hôte non local refusé : ${host}`);
const { chromium } = createRequire(env("RECETTE_PLAYWRIGHT"))("playwright");
const pg = createRequire(import.meta.url)("pg");
const SERVICE = readFileSync(`${DIR}/service.key`, "utf8").trim();

mkdirSync(OUT, { recursive: true });
const checks = [];
function check(id, label, ok, detail = {}) {
  checks.push({ id, label, ok: Boolean(ok), ...detail });
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${id} ${label} ${JSON.stringify(detail)}`);
}
const sql = new pg.Client({ connectionString: env("RECETTE_ADMIN_DB_URL") });
await sql.connect();
const one = async (text, values = []) => (await sql.query(text, values)).rows[0];

async function createUser(prefix) {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const user = { email: `${prefix}-${stamp}@lfo.invalid`, password: `Brouillon-${stamp}-ok` };
  const created = await fetch(`${GATEWAY}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password, email_confirm: true }),
  });
  user.id = (await created.json()).id;
  return user;
}
async function login(page, user) {
  await page.goto(`${APP}/login`);
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe").fill(user.password);
  await page.getByRole("button", { name: "Entrer" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
}

const userA = await createUser("recette-brouillon-a");
const userB = await createUser("recette-brouillon-b");
const browser = await chromium.launch(
  process.env.RECETTE_CHROMIUM ? { executablePath: process.env.RECETTE_CHROMIUM } : {},
);
const errors = [];
const draftRows = (userId) =>
  sql.query(
    "select id::text, title, version, content #>> '{structure,mode}' as mode, content #>> '{contract,lender}' as lender from public.form_drafts where user_id = $1 order by updated_at",
    [userId],
  );
const canonicalCount = async (userId) =>
  (
    await one(
      `select (select count(*) from public.liabilities where user_id = $1)
            + (select count(*) from public.liability_balance_observations where user_id = $1) as n`,
      [userId],
    )
  ).n;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  await login(page, userA);

  // ---------- D1 : brouillon incomplet ----------
  await page.goto(`${APP}/debt`);
  await page.getByRole("button", { name: "Décrire le contrat" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mode de remboursement").selectOption("AMORTIZING");
  await dialog.getByLabel("Nom de la dette").fill("Prêt en préparation");
  await dialog.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  const status = dialog.getByRole("status");
  await status.waitFor();
  const statusText = (await status.innerText()).replace(/\s+/g, " ");
  let rows = (await draftRows(userA.id)).rows;
  check(
    "D1",
    "brouillon incomplet enregistré, sans aucune dette ni observation écrite",
    rows.length === 1 &&
      rows[0].mode === "AMORTIZING" &&
      rows[0].version === 1 &&
      (await canonicalCount(userA.id)) === "0" &&
      statusText.includes("n’alimente ni le patrimoine ni les calculs"),
    { statut: statusText, brouillons: rows.length },
  );
  await page.screenshot({ path: `${OUT}/01_brouillon_enregistre.png` });
  const stateA = await (await page.request.get(`${APP}/api/state`)).json();
  check(
    "D2",
    "bilan : aucun passif issu du brouillon",
    stateA.balanceSheet.totalLiabilities.value === 0 && (stateA.liabilities ?? []).length === 0,
    { passif: stateA.balanceSheet.totalLiabilities.value },
  );

  // ---------- D3 : rechargement puis reconnexion ----------
  await page.keyboard.press("Escape");
  await page.reload();
  const panel = page.getByRole("region", { name: "Brouillons" });
  await panel.waitFor();
  const afterReload = (await panel.innerText()).includes("Prêt en préparation");
  await page.getByRole("button", { name: "Déconnexion" }).first().click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await login(page, userA);
  await page.goto(`${APP}/debt`);
  await panel.waitFor();
  check(
    "D3",
    "brouillon retrouvé après rechargement puis après déconnexion et reconnexion",
    afterReload && (await panel.innerText()).includes("Prêt en préparation"),
  );
  await page.screenshot({ path: `${OUT}/02_liste_brouillons.png` });

  // ---------- D4 : reprise et modification ----------
  await panel.getByRole("button", { name: "Reprendre" }).click();
  dialog = page.getByRole("dialog");
  const resumed =
    (await dialog.getByLabel("Nom de la dette").inputValue()) === "Prêt en préparation" &&
    (await dialog.getByLabel("Mode de remboursement").inputValue()) === "AMORTIZING" &&
    (await dialog.getByLabel("Périodicité des échéances").inputValue()) === "";
  await dialog.getByLabel("Prêteur").fill("Banque recette");
  await dialog.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await page.waitForTimeout(600);
  rows = (await draftRows(userA.id)).rows;
  check(
    "D4",
    "reprise fidèle (aucun champ inconnu rempli), modification enregistrée en version 2",
    resumed && rows.length === 1 && rows[0].version === 2 && rows[0].lender === "Banque recette",
    { version: rows[0]?.version },
  );

  // ---------- D5 : conflit de version ----------
  // Une autre session enregistre le même brouillon (version 2 → 3).
  const other = await page.request.post(`${APP}/api/drafts`, {
    headers: { Origin: APP },
    data: {
      draftId: rows[0].id,
      expectedVersion: 2,
      kind: "DEBT_CONTRACT_NEW",
      subjectId: null,
      title: "Prêt en préparation",
      content: { contract: { name: "Prêt en préparation", lender: "Autre onglet" } },
      schemaVersion: 1,
    },
  });
  await dialog.getByLabel("Prêteur").fill("Ma saisie");
  await dialog.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  const alert = dialog.getByRole("alert");
  await alert.waitFor();
  rows = (await draftRows(userA.id)).rows;
  check(
    "D5",
    "conflit : refus révisable, saisie conservée à l'écran, brouillon de l'autre session intact",
    other.ok() &&
      (await alert.innerText()).includes("enregistré ailleurs") &&
      (await dialog.getByLabel("Prêteur").inputValue()) === "Ma saisie" &&
      rows[0].version === 3 &&
      rows[0].lender === "Autre onglet",
    { version: rows[0].version },
  );
  await page.screenshot({ path: `${OUT}/03_conflit.png` });
  await dialog.getByRole("button", { name: "Remplacer par ma saisie" }).click();
  await page.waitForTimeout(800);
  rows = (await draftRows(userA.id)).rows;
  check(
    "D5b",
    "après conflit, remplacement DÉCIDÉ : ma saisie écrite sur la version courante (4)",
    rows[0].version === 4 && rows[0].lender === "Ma saisie",
    { version: rows[0].version, preteur: rows[0].lender },
  );
  await page.keyboard.press("Escape");

  // ---------- D6 : isolation ----------
  const ctxB = await browser.newContext({ locale: "fr-FR" });
  const pageB = await ctxB.newPage();
  await login(pageB, userB);
  const debtB = await (await pageB.request.get(`${APP}/api/debt`)).json();
  const deleteByB = await pageB.request.delete(`${APP}/api/drafts`, {
    headers: { Origin: APP },
    data: { draftId: rows[0].id, expectedVersion: 4 },
  });
  const stillThere = (await draftRows(userA.id)).rows.length === 1;
  check(
    "D6",
    "isolation : B ne voit pas le brouillon de A et ne peut pas le supprimer",
    (debtB.drafts ?? []).length === 0 && !deleteByB.ok() && stillThere,
    { suppressionParB: deleteByB.status() },
  );
  await ctxB.close();

  // ---------- D7 : suppression en deux temps ----------
  await page.reload();
  await panel.getByRole("button", { name: /Supprimer le brouillon/ }).click();
  const confirmVisible = await panel.getByRole("button", { name: "Confirmer la suppression" }).isVisible();
  const notYet = (await draftRows(userA.id)).rows.length === 1;
  await panel.getByRole("button", { name: "Confirmer la suppression" }).click();
  await page.waitForTimeout(600);
  check(
    "D7",
    "suppression confirmée en deux temps ; rien n'est supprimé avant confirmation",
    confirmVisible && notYet && (await draftRows(userA.id)).rows.length === 0,
  );

  // ---------- D8 : validation qui consomme le brouillon ----------
  await page.getByRole("button", { name: "Décrire le contrat" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mode de remboursement").selectOption("AMORTIZING");
  await dialog.getByLabel("Nom de la dette").fill("Prêt validé");
  await dialog.getByLabel("Prêteur").fill("Banque");
  await dialog.getByLabel(/Capital initial emprunté/).fill("1 200");
  await dialog.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await dialog.getByRole("status").waitFor();
  await dialog.getByLabel(/Encours observé initial/).fill("1 200");
  await dialog.getByLabel("Date de l’encours initial").fill("2026-09-25");
  await dialog.getByLabel(/Taux annuel/).fill("0");
  await dialog.getByLabel("Type de taux").selectOption("FIXED");
  await dialog.getByLabel("Périodicité des échéances").selectOption("MONTHLY");
  await dialog.getByLabel("Convention d’intérêt").selectOption("PROPORTIONAL");
  await dialog.getByLabel("Première échéance").fill("2026-10-05");
  await dialog.getByLabel(/Paiement par échéance/).fill("100");
  await dialog.getByLabel("Absence d’assurance confirmée").check();
  await dialog.getByRole("button", { name: "Ajouter cette dette" }).click();
  await page.waitForTimeout(1200);
  const created = await one(
    "select count(*)::text as n from public.liabilities where user_id = $1 and name = 'Prêt validé'",
    [userA.id],
  );
  check(
    "D8",
    "validation : la dette est créée et le brouillon consommé est retiré",
    created.n === "1" && (await draftRows(userA.id)).rows.length === 0,
  );

  // ---------- D9 : brouillon d'une dette existante, repris à la réouverture ----------
  await page.reload();
  await page.getByRole("button", { name: "Corriger le contrat" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Prêteur").fill("Banque renégociée");
  await dialog.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await dialog.getByRole("status").waitFor();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "Corriger le contrat" }).click();
  dialog = page.getByRole("dialog");
  const reopened = await dialog.getByLabel("Prêteur").inputValue();
  const savedLender = await one(
    "select lender from public.liabilities where user_id = $1 and name = 'Prêt validé'",
    [userA.id],
  );
  check(
    "D9",
    "modification en brouillon : reprise à la réouverture, contrat enregistré inchangé",
    reopened === "Banque renégociée" && savedLender.lender === "Banque",
    { repris: reopened, enregistre: savedLender.lender },
  );
  await page.keyboard.press("Escape");

  // ---------- Mobile ----------
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: "fr-FR" });
  await mobile.addCookies(await ctx.cookies());
  const mpage = await mobile.newPage();
  await mpage.goto(`${APP}/debt`);
  await mpage.waitForLoadState("networkidle");
  const scroll = await mpage.evaluate(() => document.documentElement.scrollWidth);
  await mpage.screenshot({ path: `${OUT}/04_brouillons_mobile.png`, fullPage: true });
  check("M1", "Dettes et brouillons sur mobile sans débordement horizontal", scroll <= 390, { scrollWidth: scroll });
  await mobile.close();
  check("E1", "aucune erreur JavaScript", errors.length === 0, { errors: errors.slice(0, 3) });
} finally {
  await browser.close();
  writeFileSync(
    `${OUT}/recette-brouillons.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        app: APP,
        utilisateurs: [userA.email, userB.email],
        environnement: "pile Supabase auto-hébergée locale ; build de production",
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
