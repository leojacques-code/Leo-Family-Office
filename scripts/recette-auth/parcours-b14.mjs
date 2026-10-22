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
  // Un montant qui porte des centimes les affiche tous : « 1 500,50 € ».
  check(
    "D2",
    "dette affichée avec son encours, sa devise et sa date",
    /1\s500,50\s€/.test(panelText) &&
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
    /1\s500,50\s€/.test(netWorthText) && /[−-]\s?1\s500,50\s€/.test(netWorthText),
  );
  check(
    "D9",
    "Patrimoine range la dette dans « Dettes sans contrat détaillé », pas parmi les contrats",
    netWorthText.includes("Dettes sans contrat détaillé") &&
      !netWorthText.includes("Dettes contractuelles"),
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
  const fluxText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "R0",
    "prévision Flux : service de dette et point bas « Non calculable » avec la raison",
    fluxText.includes("Une dette sans échéancier : ses sorties sont inconnues") &&
      !/Service de dette prévu\s*0\s€/.test(fluxText),
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
  check(
    "R2",
    "après rechargement : revenus 2 450,35 €, dépenses « Non observé » (aucune saisie), pas « 0 € »",
    /2\s450,35\s€/.test(tilesAfter) && /Dépenses de consommation Non observé/.test(tilesAfter),
    { tuiles: tilesAfter.slice(0, 140) },
  );
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

  // ---------- Correction NON DESTRUCTIVE du revenu saisi ----------
  await page.goto(`${APP}/cash-flow`);
  await page.waitForLoadState("networkidle");
  const incomeRow = page.locator(".cash-ledger-table .table-row", { hasText: "Salaire septembre" });
  await incomeRow.getByRole("button", { name: "Corriger" }).click();
  const fixIncome = page.getByRole("dialog");
  const prefilled = (await fixIncome.getByLabel(/Montant net versé/).inputValue()).replace(/\s/g, "");
  check("K1", "le tiroir de correction reprend le montant enregistré", prefilled === "2450,35", {
    prefilled,
  });
  await fixIncome.getByLabel(/Montant net versé/).fill("2 405,35");
  await fixIncome.getByLabel(/Motif de la correction/).fill("Montant saisi avant retenue à la source");
  await page.screenshot({ path: `${OUT}/09_correction_revenu_saisie_bureau.png` });
  await fixIncome.getByRole("button", { name: "Enregistrer la correction" }).click();
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const tilesCorrected = (await page.locator(".metrics-grid").first().innerText()).replace(
    /\s+/g,
    " ",
  );
  const ledgerText = (await page.locator(".cash-ledger-table").innerText()).replace(/\s+/g, " ");
  check(
    "K2",
    "après rechargement : revenus 2 405,35 €, ligne marquée corrigée",
    /2\s405,35\s€/.test(tilesCorrected) && ledgerText.includes("corrigé"),
    { tuiles: tilesCorrected.slice(0, 120) },
  );
  await page.screenshot({ path: `${OUT}/10_flux_apres_correction_bureau.png` });
  const txAfterFix = await sql.query(
    "select id, amount::text, transaction_date::text from public.transactions where user_id = $1",
    [user.id],
  );
  const trail = await sql.query(
    `select actor_user_id::text, executed_by, reason, before_values, after_values, changed_fields
       from public.transaction_corrections where user_id = $1`,
    [user.id],
  );
  check(
    "K3",
    "base : une seule transaction corrigée en place, aucune régularisation fabriquée",
    txAfterFix.rows.length === 1 && Number(txAfterFix.rows[0].amount) === 2405.35,
    { transactions: txAfterFix.rows.length },
  );
  check(
    "K4",
    "piste : avant, après, motif, champ modifié, acteur = propriétaire, rôle constaté",
    trail.rows.length === 1 &&
      Number(trail.rows[0].before_values.amount) === 2450.35 &&
      Number(trail.rows[0].after_values.amount) === 2405.35 &&
      trail.rows[0].reason === "Montant saisi avant retenue à la source" &&
      trail.rows[0].changed_fields.join() === "amount" &&
      trail.rows[0].actor_user_id === user.id &&
      trail.rows[0].executed_by === "service_role",
    { piste: trail.rows[0] ?? null },
  );
  const stale = await page.request.post(`${APP}/api/state`, {
    headers: { Origin: APP },
    data: {
      action: "correct_net_income",
      transactionId: txAfterFix.rows[0].id,
      reason: "Seconde décision sur un état périmé",
      // Montant attendu en TEXTE, comme l'envoie le tiroir (état lu en base).
      expected: { amount: "2450.350000", receivedOn: "2026-09-23", label: "Salaire septembre" },
      corrected: { amount: 2400 },
    },
  });
  const staleBody = await stale.json();
  const unchanged = await one("select amount::text from public.transactions where id = $1", [
    txAfterFix.rows[0].id,
  ]);
  check(
    "K5",
    "seconde décision sur état périmé : 409, message fixe, rien d'écrasé",
    stale.status() === 409 &&
      staleBody.code === "CONFLICT" &&
      !JSON.stringify(staleBody).includes("2405") &&
      Number(unchanged.amount) === 2405.35,
    { status: stale.status(), body: staleBody },
  );
  await incomeRow.getByRole("button", { name: "Corriger" }).click();
  const reopened = (await page.getByRole("dialog").innerText()).replace(/\s+/g, " ");
  check(
    "K6",
    "l'historique de correction est lisible dans le tiroir",
    reopened.includes("Corrections précédentes") &&
      reopened.includes("Montant saisi avant retenue à la source") &&
      /2\s450,35\s€\s→\s2\s405,35\s€/.test(reopened),
    { extrait: reopened.slice(-200) },
  );
  await page.screenshot({ path: `${OUT}/11_correction_historique_bureau.png` });
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  const todayFixed = await (await page.request.get(`${APP}/api/today`)).json();
  const flowJson = JSON.stringify(todayFixed.monthFlow ?? {});
  const stateFixed = await (await page.request.get(`${APP}/api/state`)).json();
  check(
    "K7",
    "propagation : Aujourd'hui porte 2405.35 (plus 2450.35), patrimoine net inchangé à 1 600 €",
    flowJson.includes("2405.35") &&
      !flowJson.includes("2450.35") &&
      stateFixed.balanceSheet.netWorth.value === 1600,
    { monthFlow: todayFixed.monthFlow },
  );

  // ---------- Opération sans catégorie ----------
  await page.getByRole("button", { name: "Ajouter une opération" }).click();
  const opModal = page.getByRole("dialog");
  const categoryDefault = await opModal.getByLabel("Catégorie").inputValue();
  await opModal.getByLabel("Libellé").fill("Courses marché");
  await opModal.getByLabel(/Montant signé/).fill("-45.2");
  await opModal.getByLabel("Date").fill("2026-09-22");
  await page.screenshot({ path: `${OUT}/12_operation_sans_categorie_bureau.png` });
  await opModal.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const ledgerOp = (
    await page.locator(".cash-ledger-table .table-row", { hasText: "Courses marché" }).innerText()
  ).replace(/\s+/g, " ");
  const op = await one(
    "select category_id, currency, amount::text from public.transactions where user_id = $1 and label = 'Courses marché'",
    [user.id],
  );
  check(
    "T1",
    "opération enregistrée NON CLASSÉE (aucune catégorie supposée), en EUR, affichée −45,20 €",
    categoryDefault === "" &&
      op?.category_id === null &&
      op?.currency === "EUR" &&
      Number(op?.amount) === -45.2 &&
      ledgerOp.includes("Sans catégorie") &&
      ledgerOp.includes("À classer") &&
      /[−-]45,20\s€/.test(ledgerOp),
    { ligne: ledgerOp, base: op ?? null },
  );
  const structure = (
    await page.locator("article", { hasText: "Structure des dépenses" }).innerText()
  ).replace(/\s+/g, " ");
  check(
    "T2",
    "structure des dépenses : « aucune dépense observée », jamais une grille de 0 €",
    structure.includes("Aucune dépense de consommation observée") && !/0\s€/.test(structure),
    { structure },
  );

  // ---------- Garde-fou de devises ----------
  const chf = await page.request.post(`${APP}/api/state`, {
    headers: { Origin: APP },
    data: {
      action: "add_account",
      institution: "Banque recette",
      name: "Compte CHF",
      accountType: "BANK",
      balance: 500,
      balanceDate: "2026-09-24",
      currency: "CHF",
    },
  });
  const chfState = await chf.json();
  const chfAccount = chfState.accounts.find((item) => item.name === "Compte CHF");
  const chfOp = await page.request.post(`${APP}/api/state`, {
    headers: { Origin: APP },
    data: {
      action: "add_transaction",
      accountId: chfAccount.id,
      categoryId: null,
      date: "2026-09-21",
      label: "Achat en francs",
      amount: -30,
      updateBalance: false,
    },
  });
  const chfRow = await one(
    "select currency from public.transactions where user_id = $1 and label = 'Achat en francs'",
    [user.id],
  );
  check(
    "X1",
    "opération sur un compte CHF : devise du compte (CHF), pas la devise de lecture",
    chfOp.ok() && chfRow?.currency === "CHF",
    { devise: chfRow?.currency ?? null },
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  const tilesUnclassified = (await page.locator(".metrics-grid").first().innerText()).replace(
    /\s+/g,
    " ",
  );
  const fluxUnclassified = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "X2",
    "opération CHF NON CLASSÉE : nommée et exclue, mais aucun total n'en dépend (revenu intact)",
    /Revenus observés 2\s405,35\s€/.test(tilesUnclassified) &&
      fluxUnclassified.includes("autre devise que EUR") &&
      /[−-]30\sCHF/.test(fluxUnclassified),
    { tuiles: tilesUnclassified.slice(0, 160) },
  );
  // Classée en DÉPENSE, la même opération rend la consommation et les surplus incalculables,
  // sans effacer le revenu en euros, qui reste certain (§4).
  const chfTx = await one(
    "select id::text as id from public.transactions where user_id = $1 and label = 'Achat en francs'",
    [user.id],
  );
  await page.request.post(`${APP}/api/state`, {
    headers: { Origin: APP },
    data: { action: "classify_transaction", transactionId: chfTx.id, kindOverride: "EXPENSE" },
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const tilesFx = (await page.locator(".metrics-grid").first().innerText()).replace(/\s+/g, " ");
  const fluxFx = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "X6",
    "opération CHF classée en dépense : consommation et surplus « Non calculable », revenu 2 405,35 € conservé",
    /Revenus observés 2\s405,35\s€/.test(tilesFx) &&
      /Dépenses de consommation Non calculable/.test(tilesFx) &&
      /Surplus avant service de dette Non calculable/.test(tilesFx) &&
      /Surplus après service de dette Non calculable/.test(tilesFx),
    { tuiles: tilesFx.slice(0, 200) },
  );
  const callout = (
    await page.locator(".callout, [role=note]", { hasText: "Qualité des données" }).first().innerText()
  ).replace(/\s+/g, " ");
  check(
    "X5",
    "l'encadré qualité NOMME la devise non convertie, et la série touchée n'a pas de barre",
    callout.includes("dans une autre devise que EUR") &&
      !callout.includes("non identifié") &&
      fluxFx.includes("mois sans barre"),
    { encadre: callout },
  );
  await page.screenshot({ path: `${OUT}/13_flux_devise_etrangere_bureau.png` });
  const close = await page.request.post(`${APP}/api/state`, {
    headers: { Origin: APP },
    data: { action: "close_cash_flow_month", month: "2026-09" },
  });
  const closes = await one(
    "select count(*)::text as count from public.cash_flow_monthly_closes where user_id = $1",
    [user.id],
  );
  check(
    "X3",
    "clôture d'un mois avec opération non convertie refusée (422), aucune clôture écrite",
    close.status() === 422 && closes.count === "0",
    { status: close.status(), body: await close.json() },
  );
  await page.getByRole("button", { name: "Ajouter une opération" }).click();
  const fxModal = page.getByRole("dialog");
  // Le libellé accessible du select inclut ses options : on vise le premier select du modal.
  await fxModal.locator("select").first().selectOption({ label: "Compte CHF · CHF" });
  await fxModal.getByLabel("Libellé").fill("Autre achat");
  await fxModal.getByLabel(/Montant signé/).fill("-10");
  await fxModal.getByRole("button", { name: "Enregistrer" }).click();
  const fxError = (await fxModal.getByRole("alert").innerText()).replace(/\s+/g, " ");
  check(
    "X4",
    "formulaire : une opération sur compte CHF est refusée avec la raison, sans écriture",
    fxError.includes("les flux dans plusieurs devises ne sont pas encore convertis"),
    { message: fxError },
  );
  await fxModal.getByRole("button", { name: "Annuler" }).click();

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
  await mpage
    .locator(".cash-ledger-table .table-row", { hasText: "Salaire septembre" })
    .getByRole("button", { name: "Corriger" })
    .click();
  await mpage.screenshot({ path: `${OUT}/14_correction_revenu_mobile.png` });
  const drawerBox = await mpage.getByRole("dialog").boundingBox();
  check(
    "M3",
    "tiroir de correction utilisable sur mobile (dans la largeur de l'écran)",
    drawerBox !== null && drawerBox.x >= 0 && drawerBox.x + drawerBox.width <= 391,
    { box: drawerBox },
  );
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
