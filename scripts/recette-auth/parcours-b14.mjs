// Recette B14 « premier fait » sur la pile locale de `services.sh` : une dette connue par son
// SEUL encours, saisie dans le navigateur, puis retrouvée au bilan, dans Aujourd'hui, corrigée,
// rechargée, et relue en base avec son historique.
//
// L'utilisateur est créé par l'API d'administration de GoTrue (adresse confirmée) : le parcours
// d'inscription et de confirmation est éprouvé par `parcours-ab.mjs`, pas ici.
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
const user = { email: `recette-b14-${stamp}@lfo.invalid`, password: `B14-recette-${stamp}-ok` };
const created = await fetch(`${GATEWAY}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
  },
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
  check("P1", "connexion d'un compte neuf : accueil personnel", /\/setup/.test(page.url()));

  // ---------- Saisie de la dette par son seul encours ----------
  await page.goto(`${APP}/debt`);
  await page.getByRole("button", { name: /Je connais l’encours/ }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Nom de la dette").fill("Prêt familial");
  const currency = await drawer.getByLabel("Devise").inputValue();
  check(
    "D1",
    "la devise proposée est visible et modifiable, jamais implicite",
    currency === "EUR",
    {
      currency,
    },
  );
  await drawer.getByLabel(/Encours restant dû/).fill("1 500,50");
  await drawer.getByLabel(/Date de l’encours/).fill("2026-09-20");
  await page.screenshot({ path: `${OUT}/01_dette_encours_saisie_bureau.png` });
  await drawer.getByRole("button", { name: "Enregistrer la dette" }).click();
  const panel = page.getByRole("region", { name: "Encours déclarés sans contrat" });
  await panel.waitFor();
  const panelText = await panel.innerText();
  // Format du Currency partagé : zéros décimaux finaux retirés (« 1 500,5 € »).
  check(
    "D2",
    "dette affichée avec son encours, sa devise et sa date",
    /1\s500,5\s€/.test(panelText) &&
      panelText.includes("Au 20 septembre 2026") &&
      panelText.includes("Créancier non renseigné"),
    {
      panelText: panelText.replace(/\s+/g, " ").slice(-120),
    },
  );
  await page.screenshot({ path: `${OUT}/02_dette_encours_affichee_bureau.png` });

  const row = await one(
    `select id, terms_status, current_balance::text, currency, principal, annual_rate,
            monthly_payment, payment_count, first_payment_date, maturity_date, rate_type,
            payment_frequency, amortisation_profile
       from public.liabilities where user_id = $1`,
    [user.id],
  );
  const termsNull = [
    "principal",
    "annual_rate",
    "monthly_payment",
    "payment_count",
    "first_payment_date",
    "maturity_date",
    "rate_type",
    "payment_frequency",
    "amortisation_profile",
  ].every((column) => row[column] === null);
  check(
    "D3",
    "persistée en base : OUTSTANDING_ONLY, 1 500,50 EUR, tous les termes NULL",
    row.terms_status === "OUTSTANDING_ONLY" &&
      Number(row.current_balance) === 1500.5 &&
      row.currency === "EUR" &&
      termsNull,
    { terms_status: row.terms_status, balance: row.current_balance },
  );

  // ---------- Propagation : bilan, Aujourd'hui, métriques ----------
  const state = await (await page.request.get(`${APP}/api/state`)).json();
  const sheet = state.balanceSheet;
  check(
    "D4",
    "bilan canonique : passif 1 500,50, patrimoine net −1 500,50, hors encours contractuel",
    sheet.totalLiabilities.value === 1500.5 &&
      sheet.netWorth.value === -1500.5 &&
      sheet.contractualDebt.value === 0 &&
      sheet.otherLiabilities.value === 1500.5,
    { netWorth: sheet.netWorth.value },
  );
  const service = state.balanceSheetMetrics.debt.service30d;
  check(
    "D5",
    "service de dette à 30 jours partiel, jamais nul",
    service.value === null &&
      service.status === "PARTIAL" &&
      service.blockers.includes("DEBT_TERMS_UNDECLARED"),
    service,
  );
  check(
    "D6",
    "cash-flow libre inconnu (service de la dette inconnu)",
    state.metrics.freeCashFlow === null,
  );
  await page.goto(`${APP}/net-worth`);
  await page.waitForLoadState("networkidle");
  const netWorthText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "D7",
    "Patrimoine affiche le passif et le patrimoine net négatif",
    /1\s500,5\s€/.test(netWorthText) && /[−-]\s?1\s500,5\s€/.test(netWorthText),
  );
  await page.screenshot({ path: `${OUT}/03_patrimoine_apres_dette_bureau.png` });
  const today = await (await page.request.get(`${APP}/api/today`)).json();
  const debtDomain = (today.domains ?? []).find((item) => item.domain === "DETTE");
  check(
    "D8",
    "Aujourd'hui : le domaine Dettes est reconnu comme renseigné",
    debtDomain?.hasFacts === true,
    { domaine: debtDomain ?? null },
  );

  // ---------- Correction, rechargement, historique ----------
  await page.goto(`${APP}/debt`);
  await page.getByRole("button", { name: /Corriger l’encours/ }).click();
  const fix = page.getByRole("dialog");
  check(
    "C1",
    "la correction reprend l'encours et la date enregistrés",
    (await fix.getByLabel(/Encours restant dû/).inputValue()).replace(/\s/g, "") === "1500,5" ||
      (await fix.getByLabel(/Encours restant dû/).inputValue()).replace(/\s/g, "") === "1500.5",
    { valeur: await fix.getByLabel(/Encours restant dû/).inputValue() },
  );
  await fix.getByLabel(/Encours restant dû/).fill("1 400");
  await fix.getByLabel(/Date de l’encours/).fill("2026-09-24");
  await fix.getByRole("button", { name: "Enregistrer le nouvel encours" }).click();
  await page.waitForTimeout(500);
  await page.reload();
  const reloaded = (
    await page.getByRole("region", { name: "Encours déclarés sans contrat" }).innerText()
  ).replace(/\s+/g, " ");
  check(
    "C2",
    "après rechargement : 1 400 € au 24 septembre 2026",
    /1\s400\s€/.test(reloaded) && reloaded.includes("Au 24 septembre 2026"),
    { reloaded: reloaded.slice(-90) },
  );
  const history = await sql.query(
    `select o.balance::text, o.observed_at::text from public.liability_balance_observations o
      where o.user_id = $1 order by o.observed_at`,
    [user.id],
  );
  check(
    "C3",
    "historique conservé : deux observations, aucune écrasée",
    history.rows.length === 2 &&
      Number(history.rows[0].balance) === 1500.5 &&
      Number(history.rows[1].balance) === 1400,
    { history: history.rows },
  );
  const still = await one(
    "select terms_status, annual_rate from public.liabilities where id = $1",
    [row.id],
  );
  check(
    "C4",
    "la correction ne fabrique aucun terme",
    still.terms_status === "OUTSTANDING_ONLY" && still.annual_rate === null,
  );

  // ---------- Un compte s'ajoute : le patrimoine suit ----------
  const addAccount = await page.request.post(`${APP}/api/state`, {
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
  const after = await (await page.request.get(`${APP}/api/state`)).json();
  // 3 000 € d'actifs − 1 400 € de dette = 1 600 €.
  check(
    "C5",
    "compte de 3 000 € ajouté : patrimoine net 1 600 €",
    addAccount.ok() && after.balanceSheet.netWorth.value === 1600,
    { netWorth: after.balanceSheet.netWorth.value },
  );

  // ---------- Premier revenu net observé ----------
  await page.goto(`${APP}/cash-flow`);
  await page.waitForLoadState("networkidle");
  const tilesBefore = (await page.locator(".metrics-grid").first().innerText()).replace(
    /\s+/g,
    " ",
  );
  check(
    "R1",
    "Flux sans opération : « Non observé », jamais « 0 € »",
    tilesBefore.includes("Non observé") && !/Revenus observés\s*0\s€/.test(tilesBefore),
    { tuiles: tilesBefore.slice(0, 140) },
  );
  await page.screenshot({ path: `${OUT}/05_flux_vierge_bureau.png` });
  await page.getByRole("button", { name: "Revenu net" }).click();
  const incomeDrawer = page.getByRole("dialog");
  await incomeDrawer.getByLabel("Libellé").fill("Salaire septembre");
  await incomeDrawer.getByLabel(/Montant net versé/).fill("2 450,35");
  await incomeDrawer.getByLabel(/Date de versement/).fill("2026-09-23");
  await page.screenshot({ path: `${OUT}/06_revenu_net_saisie_bureau.png` });
  await incomeDrawer.getByRole("button", { name: "Enregistrer le revenu" }).click();
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const tilesAfter = (await page.locator(".metrics-grid").first().innerText()).replace(/\s+/g, " ");
  check("R2", "après rechargement : revenus observés 2 450,35 €", /2\s450,35\s€/.test(tilesAfter), {
    tuiles: tilesAfter.slice(0, 140),
  });
  await page.screenshot({ path: `${OUT}/07_flux_apres_revenu_bureau.png` });
  const tx = await sql.query(
    `select amount::text, currency, category_id, kind_override, data_kind, transaction_date::text
       from public.transactions where user_id = $1`,
    [user.id],
  );
  const balances = await one(
    `select count(*)::text as count from public.account_balances b
       join public.financial_accounts a on a.id = b.account_id where a.user_id = $1`,
    [user.id],
  );
  check(
    "R3",
    "persistance : une transaction ACTUAL INCOME en EUR, sans catégorie ni solde dérivé",
    tx.rows.length === 1 &&
      Number(tx.rows[0].amount) === 2450.35 &&
      tx.rows[0].currency === "EUR" &&
      tx.rows[0].category_id === null &&
      tx.rows[0].kind_override === "INCOME" &&
      balances.count === "1",
    { transaction: tx.rows[0], soldes: balances.count },
  );
  const afterIncome = await (await page.request.get(`${APP}/api/state`)).json();
  check(
    "R4",
    "aucun double comptage : le patrimoine net reste 1 600 €",
    afterIncome.balanceSheet.netWorth.value === 1600,
    { netWorth: afterIncome.balanceSheet.netWorth.value },
  );
  const todayAfter = await (await page.request.get(`${APP}/api/today`)).json();
  const monthFlow = todayAfter.monthFlow;
  check(
    "R5",
    "Aujourd'hui : le flux du mois porte ce revenu observé",
    JSON.stringify(monthFlow ?? {}).includes("2450.35"),
    { monthFlow },
  );
  check(
    "R6",
    "aucun brut, impôt ni rôle de carrière fabriqué",
    Number(
      (await one("select count(*) from public.career_roles where user_id = $1", [user.id])).count,
    ) === 0 &&
      Number(
        (await one("select count(*) from public.tax_income_items where user_id = $1", [user.id]))
          .count,
      ) === 0,
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
  await mpage.getByRole("region", { name: "Encours déclarés sans contrat" }).waitFor();
  const scroll = await mpage.evaluate(() => document.documentElement.scrollWidth);
  await mpage
    .getByRole("region", { name: "Encours déclarés sans contrat" })
    .scrollIntoViewIfNeeded();
  await mpage.screenshot({ path: `${OUT}/04_dette_encours_mobile.png` });
  await mpage.goto(`${APP}/cash-flow`);
  await mpage.waitForLoadState("networkidle");
  await mpage.screenshot({ path: `${OUT}/08_flux_revenu_mobile.png` });
  const scrollFlux = await mpage.evaluate(() => document.documentElement.scrollWidth);
  check("M2", "Flux sur mobile sans débordement horizontal", scrollFlux <= 390, {
    scrollWidth: scrollFlux,
  });
  check("M1", "Dettes sur mobile sans débordement horizontal", scroll <= 390, {
    scrollWidth: scroll,
  });
  await mobile.close();
  check("E1", "aucune erreur JavaScript", errors.length === 0, { errors: errors.slice(0, 3) });
} finally {
  await browser.close();
  writeFileSync(
    `${OUT}/recette-b14-premiers-faits.json`,
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
