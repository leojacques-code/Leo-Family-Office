// Recette transversale « premier utilisateur » sur la pile locale de `services.sh` (cadrage du
// 25 septembre 2026) : création d'espace → accueil (identité, contexte, intention) → Aujourd'hui
// (installation, domaines) → premier compte → première dette → premier revenu → Aujourd'hui →
// Patrimoine → Flux → correction → rechargement.
//
// Ce qu'elle PROUVE : un espace neuf ne contient aucune donnée fictive ; chaque étape de
// l'accueil servie par l'application est quittable et reprenable ; les trois premiers faits
// s'enregistrent par l'interface et se relisent en base ; une correction de revenu laisse sa
// piste ; rien ne se perd au rechargement.
//
// Ce qu'elle NE prouve PAS : l'inscription et la confirmation d'adresse (éprouvées par
// `parcours-ab.mjs`), ni quoi que ce soit sur Supabase hébergé ou sur une preview Vercel.
// L'utilisateur naît par l'API d'administration de GoTrue LOCAL (adresse confirmée).
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
const observations = [];
function check(id, label, ok, detail = {}) {
  checks.push({ id, label, ok: Boolean(ok), ...detail });
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${id} ${label} ${JSON.stringify(detail)}`);
}
/** Constat sans verdict : un écart au document 03 à documenter, pas un échec de recette. */
function observe(id, label, detail = {}) {
  observations.push({ id, label, ...detail });
  console.log(`NOTE ${id} ${label} ${JSON.stringify(detail)}`);
}
/**
 * Montant affiché, borné à gauche : « 2 500 € » ne doit pas être trouvé dans « 12 500 € »
 * ni « 999,50 € » dans « −999,50 € ». Le texte est normalisé (espaces fines comprises).
 */
const shows = (text, amount) =>
  new RegExp(`(?<![0-9,+−-])${amount.replace(/ /g, "\\s")}\\s€`).test(text);
const sql = new pg.Client({ connectionString: env("RECETTE_ADMIN_DB_URL") });
await sql.connect();
const one = async (text, values = []) => (await sql.query(text, values)).rows[0];
const today = (await one("select (now() at time zone 'Europe/Paris')::date::text as d")).d;
const daysAgo = async (days) =>
  (await one("select ((now() at time zone 'Europe/Paris')::date - $1::int)::text as d", [days])).d;

const stamp = Date.now();
const user = {
  email: `recette-premier-${stamp}@lfo.invalid`,
  password: `Premier-recette-${stamp}-ok`,
};
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

const counts = async () =>
  one(
    `select
       (select count(*) from public.financial_accounts where user_id = $1)::int as accounts,
       (select count(*) from public.liabilities where user_id = $1)::int as liabilities,
       (select count(*) from public.transactions where user_id = $1)::int as transactions,
       (select count(*) from public.properties where user_id = $1)::int as properties,
       (select count(*) from public.businesses where user_id = $1)::int as businesses`,
    [user.id],
  );

const browser = await chromium.launch(
  process.env.RECETTE_CHROMIUM ? { executablePath: process.env.RECETTE_CHROMIUM } : {},
);
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));

  // ---------- Identité : session personnelle, espace vierge ----------
  await page.goto(`${APP}/login`);
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe").fill(user.password);
  await page.getByRole("button", { name: "Entrer" }).click();
  await page.waitForURL(/\/setup/);
  const empty = await counts();
  check(
    "U1",
    "compte neuf : accueil personnel, aucun objet financier préexistant (aucun seed)",
    /\/setup/.test(page.url()) && Object.values(empty).every((value) => value === 0),
    empty,
  );
  await page.screenshot({ path: `${OUT}/01_accueil_vierge.png`, fullPage: true });

  // Quittable : quitter sans rien enregistrer ramène à Aujourd'hui, sans rien écrire.
  await page.getByRole("link", { name: "Revenir à Aujourd’hui" }).click();
  await page.waitForLoadState("networkidle");
  const leftTo = new URL(page.url()).pathname;
  const profileAfterLeave = await one(
    "select display_name, first_intent, residence_country, context_date from public.profiles where user_id = $1",
    [user.id],
  );
  check(
    "U2",
    "accueil quittable : retour à Aujourd'hui, ni contexte ni intention enregistrés",
    leftTo === "/" &&
      profileAfterLeave?.first_intent === null &&
      profileAfterLeave?.residence_country === null &&
      profileAfterLeave?.context_date === null,
    { leftTo, profil: profileAfterLeave },
  );

  // Reprenable : l'accueil se rouvre et reprend là où il en était.
  await page.goto(`${APP}/setup?edit=1`);
  await page.getByLabel("Nom de votre espace").fill("Espace recette");
  await page.getByLabel("Pays de résidence déclaré (facultatif)").fill("France");
  await page.getByLabel("Date de référence du contexte (facultative)").fill(today);
  await page.getByLabel("Par quoi souhaitez-vous commencer ?").selectOption({
    label: "Comprendre mon patrimoine",
  });
  const currencyHint = await page.locator(".personal-context").innerText();
  await page.getByRole("button", { name: "Enregistrer mes choix" }).click();
  await page.getByRole("status").waitFor();
  await page.reload();
  await page.goto(`${APP}/setup?edit=1`);
  const resumed = {
    name: await page.getByLabel("Nom de votre espace").inputValue(),
    country: await page.getByLabel("Pays de résidence déclaré (facultatif)").inputValue(),
    date: await page.getByLabel("Date de référence du contexte (facultative)").inputValue(),
    intent: await page
      .getByLabel("Par quoi souhaitez-vous commencer ?")
      .evaluate((node) => node.options[node.selectedIndex]?.text ?? ""),
  };
  check(
    "U3",
    "identité, contexte et intention enregistrés puis repris après rechargement",
    resumed.name === "Espace recette" &&
      resumed.country === "France" &&
      resumed.date === today &&
      resumed.intent === "Comprendre mon patrimoine",
    resumed,
  );
  observe(
    "N1",
    "contexte : la devise de lecture est affichée mais ne se choisit pas à l'accueil (document 03 §3 la demande)",
    { texte: currencyHint.replace(/\s+/g, " ").slice(0, 160) },
  );
  await page.screenshot({ path: `${OUT}/02_accueil_rempli.png`, fullPage: true });

  // ---------- Aujourd'hui : installation et domaines ----------
  await page.goto(`${APP}/`);
  await page.waitForLoadState("networkidle");
  const installation = page.getByRole("region", { name: "Installation" });
  await installation.waitFor();
  const installationBefore = (await installation.innerText()).replace(/\s+/g, " ");
  const steps = await installation.locator(".installation-step").count();
  check("T1", "Aujourd'hui présente l'installation et ses étapes", steps > 0, {
    etapes: steps,
    progression: installationBefore.match(/\d+ sur \d+[^A-Z]*/)?.[0] ?? null,
  });
  await page.screenshot({ path: `${OUT}/03_aujourdhui_installation.png`, fullPage: true });

  const domainRows = installation.locator(".installation-domains li");
  const domainCount = await domainRows.count();
  let declared = [];
  if (domainCount >= 2) {
    const first = (
      await domainRows.nth(0).locator(".installation-domain-label").innerText()
    ).trim();
    await domainRows.nth(0).getByRole("button", { name: "Je ne sais pas encore" }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    const rows = page
      .getByRole("region", { name: "Installation" })
      .locator(".installation-domains li");
    const second = (await rows.nth(0).locator(".installation-domain-label").innerText()).trim();
    await rows.nth(0).getByRole("button", { name: "Non" }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    declared = [first, second];
  }
  await page.reload();
  await page.waitForLoadState("networkidle");
  const answers = page
    .getByRole("region", { name: "Installation" })
    .locator(".installation-declared");
  const answersText = (await answers.count())
    ? (
        await answers.evaluate((node) => {
          node.open = true;
          return node.innerText;
        })
      ).replace(/\s+/g, " ")
    : "";
  const declarations = (
    await sql.query(
      "select applicability from public.user_domain_declarations where user_id = $1 order by created_at, revision",
      [user.id],
    )
  ).rows.map((row) => row.applicability);
  check(
    "T2",
    "domaines : « je ne sais pas encore » (UNDECIDED) et « non » (DECLARED_NONE) enregistrés, relus et modifiables après rechargement",
    declared.length === 2 &&
      declarations.length === 2 &&
      declarations[0] === "UNDECIDED" &&
      declarations[1] === "DECLARED_NONE" &&
      answersText.includes(declared[0]) &&
      answersText.includes(declared[1]) &&
      answersText.includes("Changer"),
    { declares: declared, enBase: declarations },
  );

  // ---------- Premier compte ----------
  await page.goto(`${APP}/net-worth`);
  await page
    .getByRole("button", { name: /Ajouter un compte/ })
    .first()
    .click();
  let drawer = page.getByRole("dialog");
  await drawer.getByLabel("Établissement").fill("Banque recette");
  await drawer.getByLabel("Nom du compte").fill("Compte courant");
  const accountCurrency = await drawer.getByLabel("Devise").inputValue();
  await drawer.getByLabel(/Solde observé/).fill("2 500");
  const balanceDate = await daysAgo(2);
  await drawer.getByLabel(/Date du solde/).fill(balanceDate);
  await drawer.getByRole("button", { name: "Enregistrer le compte" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const account = await one(
    `select a.id, a.currency, b.balance::text as balance, b.balance_date::text as balance_date
       from public.financial_accounts a join public.account_balances b on b.account_id = a.id
      where a.user_id = $1`,
    [user.id],
  );
  check(
    "F1",
    "premier compte : solde observé et date enregistrés, devise visible",
    account && Number(account.balance) === 2500 && account.balance_date === balanceDate,
    { devise: accountCurrency, compte: account ?? null },
  );

  // ---------- Première dette (par son seul encours) ----------
  await page.goto(`${APP}/debt`);
  await page.getByRole("button", { name: /Je connais l’encours/ }).click();
  drawer = page.getByRole("dialog");
  await drawer.getByLabel("Nom de la dette").fill("Prêt personnel");
  await drawer.getByLabel(/Encours restant dû/).fill("1 500,50");
  await drawer.getByLabel(/Date de l’encours/).fill(balanceDate);
  await drawer.getByRole("button", { name: "Enregistrer la dette" }).click();
  await page.getByRole("region", { name: "Encours déclarés sans contrat" }).waitFor();
  const debt = await one(
    "select terms_status, current_balance::text as balance, principal, annual_rate from public.liabilities where user_id = $1",
    [user.id],
  );
  check(
    "F2",
    "première dette par son encours : aucun terme inventé",
    debt?.terms_status === "OUTSTANDING_ONLY" &&
      Number(debt.balance) === 1500.5 &&
      debt.principal === null &&
      debt.annual_rate === null,
    { dette: debt ?? null },
  );

  // ---------- Premier revenu net ----------
  await page.goto(`${APP}/cash-flow`);
  await page.getByRole("button", { name: /Revenu net/ }).click();
  drawer = page.getByRole("dialog");
  await drawer.getByLabel("Libellé").fill("Salaire recette");
  await drawer.getByLabel("Compte crédité").selectOption({ index: 1 });
  await drawer.getByLabel(/Montant net versé/).fill("3 100");
  const incomeDate = await daysAgo(1);
  await drawer.getByLabel(/Date de versement/).fill(incomeDate);
  await drawer.getByRole("button", { name: "Enregistrer le revenu" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const income = await one(
    "select id, account_id, amount::text as amount, transaction_date::text as date, label from public.transactions where user_id = $1",
    [user.id],
  );
  check(
    "F3",
    "premier revenu net observé : montant, date et compte enregistrés",
    income &&
      Number(income.amount) === 3100 &&
      income.date === incomeDate &&
      income.account_id === account?.id,
    { revenu: income ?? null },
  );

  // Un revenu observé daté après aujourd'hui est refusé (arbitrage 2), sans rien écrire.
  const future = await page.request.post(`${APP}/api/state`, {
    headers: { Origin: APP },
    data: {
      action: "record_net_income",
      accountId: account?.id,
      receivedOn: "2999-01-01",
      amount: 10,
      label: "Revenu futur",
      notes: null,
    },
  });
  const futureBody = await future.json().catch(() => ({}));
  const afterFuture = await counts();
  observe("N2", "revenu observé daté dans le futur par l'API", {
    statut: future.status(),
    transactions: afterFuture.transactions,
  });
  check(
    "F4",
    "revenu observé daté dans le futur : refusé pour sa date, aucune écriture",
    future.status() === 400 &&
      JSON.stringify(futureBody).includes("un fait futur n’est pas un fait") &&
      afterFuture.transactions === 1,
    { statut: future.status() },
  );

  // ---------- Aujourd'hui, Patrimoine, Flux ----------
  await page.goto(`${APP}/`);
  await page.waitForLoadState("networkidle");
  const installationAfter = (
    await page.getByRole("region", { name: "Installation" }).innerText()
  ).replace(/\s+/g, " ");
  await page.screenshot({ path: `${OUT}/04_aujourdhui_apres_faits.png`, fullPage: true });
  const todayText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "T4",
    "Aujourd'hui lit le même patrimoine net que Patrimoine, centimes compris (999,50 €)",
    shows(todayText, "999,50"),
  );
  check(
    "T3",
    "Aujourd'hui : l'installation progresse après les premiers faits",
    (installationBefore.match(/\d+ sur \d+/)?.[0] ?? null) !== null &&
      (installationAfter.match(/\d+ sur \d+/)?.[0] ?? null) !== null &&
      installationBefore.match(/\d+ sur \d+/)?.[0] !==
        installationAfter.match(/\d+ sur \d+/)?.[0] &&
      Number(installationAfter.match(/(\d+) sur/)?.[1]) >
        Number(installationBefore.match(/(\d+) sur/)?.[1]),
    {
      avant: installationBefore.match(/\d+ sur \d+/)?.[0] ?? null,
      apres: installationAfter.match(/\d+ sur \d+/)?.[0] ?? null,
    },
  );

  await page.goto(`${APP}/net-worth`);
  await page.waitForLoadState("networkidle");
  const worth = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: `${OUT}/05_patrimoine.png`, fullPage: true });
  check(
    "P1",
    "Patrimoine : actifs, dette et patrimoine net issus des faits saisis (2 500 − 1 500,50)",
    shows(worth, "2 500") && shows(worth, "1 500,50") && shows(worth, "999,50"),
  );

  await page.goto(`${APP}/cash-flow`);
  await page.waitForLoadState("networkidle");
  const flows = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "P2",
    "Flux : le revenu saisi y figure",
    flows.includes("Salaire recette") && shows(flows, "3 100"),
  );
  await page.screenshot({ path: `${OUT}/06_flux.png`, fullPage: true });

  // ---------- Correction du revenu ----------
  await page
    .getByRole("button", { name: new RegExp(`Corriger Salaire recette`) })
    .first()
    .click();
  drawer = page.getByRole("dialog");
  await drawer.getByLabel(/Montant net versé/).fill("3 150");
  await drawer.getByLabel("Motif de la correction").fill("Prime oubliée à la saisie");
  await drawer.getByRole("button", { name: "Enregistrer la correction" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const corrected = await one(
    `select t.amount::text as amount,
            (select count(*) from public.transaction_corrections c where c.transaction_id = t.id)::int as corrections
       from public.transactions t where t.user_id = $1`,
    [user.id],
  );
  check(
    "C1",
    "correction du revenu : montant corrigé en place, piste de correction écrite",
    corrected && Number(corrected.amount) === 3150 && corrected.corrections === 1,
    { corrige: corrected ?? null },
  );

  // ---------- Rechargement : tout est relu ----------
  const pages = ["/", "/net-worth", "/debt", "/cash-flow"];
  const reloaded = {};
  for (const path of pages) {
    await page.goto(`${APP}${path}`);
    await page.waitForLoadState("networkidle");
    reloaded[path] = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  }
  check(
    "R1",
    "après rechargement : compte, dette et revenu corrigé relus",
    shows(reloaded["/net-worth"], "2 500") &&
      reloaded["/debt"].includes("Prêt personnel") &&
      shows(reloaded["/cash-flow"], "3 150"),
  );

  // ---------- Mobile et clavier ----------
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    locale: "fr-FR",
  });
  await mobile.addCookies(await ctx.cookies());
  const mpage = await mobile.newPage();
  const widths = {};
  for (const path of ["/setup?edit=1", ...pages]) {
    await mpage.goto(`${APP}${path}`);
    await mpage.waitForLoadState("networkidle");
    widths[path] = await mpage.evaluate(() => document.documentElement.scrollWidth);
  }
  await mpage.screenshot({ path: `${OUT}/07_mobile_flux.png`, fullPage: true });
  await mobile.close();
  check(
    "M1",
    "accueil, Aujourd'hui, Patrimoine, Dette et Flux sans débordement horizontal à 390 px",
    Object.values(widths).every((width) => width <= 390),
    widths,
  );

  await page.goto(`${APP}/setup?edit=1`);
  await page.keyboard.press("Tab");
  let reached = false;
  for (let index = 0; index < 40 && !reached; index += 1) {
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    if (focused.startsWith("Enregistrer mes choix")) reached = true;
    else await page.keyboard.press("Tab");
  }
  check("K1", "accueil utilisable au clavier jusqu'à l'enregistrement", reached);

  check("E1", "aucune erreur JavaScript", errors.length === 0, { errors: errors.slice(0, 3) });
} finally {
  await browser.close();
  await sql.end();
}

const passed = checks.filter((entry) => entry.ok).length;
writeFileSync(
  `${OUT}/resultats.json`,
  JSON.stringify({ date: today, checks, observations }, null, 2),
);
console.log(`${passed}/${checks.length} contrôles réussis`);
process.exit(passed === checks.length ? 0 : 1);
