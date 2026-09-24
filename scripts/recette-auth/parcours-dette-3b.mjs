// Recette Dette 3B, B16 : une dette connue par son SEUL encours devient contractuelle, dans le
// navigateur, sans seconde dette ni perte d'historique. Pile locale de `services.sh`.
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
  if (!["localhost", "127.0.0.1"].includes(host))
    throw new Error(`Hôte non local refusé : ${host}`);
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

const stamp = Date.now();
const user = { email: `recette-3b-${stamp}@lfo.invalid`, password: `Dette3B-${stamp}-ok` };
const created = await fetch(`${GATEWAY}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: user.email, password: user.password, email_confirm: true }),
});
user.id = (await created.json()).id;

const browser = await chromium.launch(
  process.env.RECETTE_CHROMIUM ? { executablePath: process.env.RECETTE_CHROMIUM } : {},
);
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${APP}/login`);
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe").fill(user.password);
  await page.getByRole("button", { name: "Entrer" }).click();
  await page.waitForURL(/\/setup/);

  // ---------- Encours seul, puis compte ----------
  await page.goto(`${APP}/debt`);
  await page.getByRole("button", { name: /Je connais l’encours/ }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Nom de la dette").fill("Prêt familial");
  await drawer.getByLabel(/Encours restant dû/).fill("1 500,50");
  await drawer.getByLabel(/Date de l’encours/).fill("2026-09-20");
  await drawer.getByRole("button", { name: "Enregistrer la dette" }).click();
  const panel = page.getByRole("region", { name: "Encours déclarés sans contrat" });
  await panel.waitFor();
  await page.request.post(`${APP}/api/state`, {
    headers: { Origin: APP },
    data: {
      action: "add_account",
      institution: "Banque recette",
      name: "Compte courant",
      accountType: "BANK",
      balance: 3000,
      balanceDate: "2026-09-24",
      currency: "EUR",
    },
  });
  const before = await one(
    "select id::text as id, terms_status from public.liabilities where user_id = $1",
    [user.id],
  );
  check("P1", "point de départ : une dette OUTSTANDING_ONLY", before?.terms_status === "OUTSTANDING_ONLY");

  // ---------- Décrire le contrat ----------
  await page.reload();
  await panel.getByRole("button", { name: "Décrire le contrat" }).click();
  const modal = page.getByRole("dialog");
  const modalText = (await modal.innerText()).replace(/\s+/g, " ");
  check(
    "P2",
    "le formulaire garde la dette (nom), ne redemande pas l'encours et dit que l'historique reste",
    (await modal.getByLabel("Nom de la dette").inputValue()) === "Prêt familial" &&
      (await modal.getByLabel(/Encours observé initial/).count()) === 0 &&
      modalText.includes("Aucune seconde dette n’est créée") &&
      /1\s500,50\s€/.test(modalText),
    { extrait: modalText.slice(0, 200) },
  );
  await modal.getByLabel("Prêteur").fill("Famille");
  await modal.getByLabel(/Capital initial emprunté/).fill("2 000");
  await modal.getByLabel(/Taux annuel/).fill("1");
  await modal.getByLabel(/Paiement par échéance/).fill("100");
  await modal.getByLabel(/Nombre d’échéances/).fill("21");
  await modal.getByLabel("Première échéance du calendrier reconstruit").fill("2026-02-05");
  await modal.getByLabel("Maturité contractuelle").fill("2027-10-05");
  await page.screenshot({ path: `${OUT}/01_decrire_contrat_bureau.png` });
  await modal.getByRole("button", { name: "Enregistrer la dette" }).click();
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const debtText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "P3",
    "après rechargement : plus d'encours « sans contrat », la dette apparaît comme contrat",
    (await page.getByRole("region", { name: "Encours déclarés sans contrat" }).count()) === 0 &&
      debtText.includes("Prêt familial"),
    { extrait: debtText.slice(0, 200) },
  );
  await page.screenshot({ path: `${OUT}/02_dette_contractuelle_bureau.png` });

  const after = await one(
    `select id::text as id, terms_status, current_balance::text as balance, currency,
            (select count(*) from public.liabilities where user_id = $1)::text as debts,
            (select count(*) from public.liability_balance_observations o
              where o.liability_id = l.id)::text as observations,
            (select count(*) from public.liability_terms_transitions t
              where t.liability_id = l.id)::text as transitions
       from public.liabilities l where user_id = $1`,
    [user.id],
  );
  check(
    "P4",
    "base : même ligne passée à CONTRACT, une seule dette, encours et historique intacts, décision tracée",
    after.id === before.id &&
      after.terms_status === "CONTRACT" &&
      after.debts === "1" &&
      Number(after.balance) === 1500.5 &&
      after.currency === "EUR" &&
      after.observations === "1" &&
      after.transitions === "1",
    after,
  );
  const state = await (await page.request.get(`${APP}/api/state`)).json();
  check(
    "P5",
    "bilan : passif 1 500,50 compté une fois, désormais contractuel ; patrimoine net 1 499,50",
    state.balanceSheet.totalLiabilities.value === 1500.5 &&
      state.balanceSheet.contractualDebt.value === 1500.5 &&
      state.balanceSheet.netWorth.value === 1499.5 &&
      (state.outstandingDebts ?? []).length === 0,
    {
      passif: state.balanceSheet.totalLiabilities.value,
      contractuel: state.balanceSheet.contractualDebt.value,
      net: state.balanceSheet.netWorth.value,
    },
  );
  await page.goto(`${APP}/net-worth`);
  await page.waitForLoadState("networkidle");
  const netWorthText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "P6",
    "Patrimoine : la dette n'est plus « sans contrat détaillé »",
    !netWorthText.includes("Dettes sans contrat détaillé") && /1\s499,50\s€/.test(netWorthText),
  );
  const today = await (await page.request.get(`${APP}/api/today`)).json();
  const debtDomain = (today.domains ?? []).find((item) => item.domain === "DETTE");
  check("P7", "Aujourd'hui : le domaine Dettes reste renseigné", debtDomain?.hasFacts === true);
  await page.goto(`${APP}/cash-flow`);
  await page.waitForLoadState("networkidle");
  const fluxText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "P8",
    "Flux : plus de « dette sans échéancier », la prévision lit le contrat",
    !fluxText.includes("Une dette sans échéancier : ses sorties sont inconnues"),
  );

  // ---------- Mobile ----------
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    locale: "fr-FR",
  });
  await mobile.addCookies(await ctx.cookies());
  const mpage = await mobile.newPage();
  await mpage.goto(`${APP}/debt`);
  await mpage.waitForLoadState("networkidle");
  await mpage.screenshot({ path: `${OUT}/03_dette_contractuelle_mobile.png`, fullPage: false });
  const scroll = await mpage.evaluate(() => document.documentElement.scrollWidth);
  check("M1", "Dettes sur mobile sans débordement horizontal", scroll <= 390, { scrollWidth: scroll });
  await mobile.close();
  check("E1", "aucune erreur JavaScript", errors.length === 0, { errors: errors.slice(0, 3) });
} finally {
  await browser.close();
  writeFileSync(
    `${OUT}/recette-dette-3b-promotion.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        app: APP,
        utilisateur: user.email,
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
