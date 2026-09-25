// Recette Dette 3B, B16 : une dette connue par son SEUL encours devient contractuelle, dans le
// navigateur, sans seconde dette ni perte d'historique. B17 : assurance séparée sur son propre
// calendrier (oracle O03 du document 08). Pile locale de `services.sh`.
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
  // B16 : le mode de remboursement vient d'abord, et aucun fait inconnu n'est prérempli.
  check(
    "B1",
    "formulaire adaptatif : mode à choisir, aucune date ni convention préremplie",
    (await modal.getByLabel("Mode de remboursement").inputValue()) === "" &&
      (await modal.getByLabel(/Taux annuel/).count()) === 0,
  );
  await modal.getByLabel("Mode de remboursement").selectOption("AMORTIZING");
  check(
    "B2",
    "après choix du mode : première échéance, maturité, durée et convention vides",
    (await modal.getByLabel("Première échéance").inputValue()) === "" &&
      (await modal.getByLabel("Maturité contractuelle").inputValue()) === "" &&
      (await modal.getByLabel(/Nombre d’échéances/).inputValue()) === "" &&
      (await modal.getByLabel("Convention d’intérêt").inputValue()) === "",
  );
  await modal.getByLabel("Prêteur").fill("Famille");
  await modal.getByLabel(/Capital initial emprunté/).fill("2 000");
  await modal.getByLabel(/Taux annuel/).fill("1");
  await modal.getByLabel("Type de taux").selectOption("FIXED");
  await modal.getByLabel("Périodicité des échéances").selectOption("MONTHLY");
  await modal.getByLabel("Convention d’intérêt").selectOption("PROPORTIONAL");
  await modal.getByLabel("Première échéance").fill("2026-02-05");
  // Contrat MINIMAL : la seule mensualité, sans durée ni maturité.
  await modal.getByLabel(/Paiement par échéance/).fill("100");
  await modal.getByLabel(/Paiement par échéance/).blur();
  // B17 : le traitement de l'assurance est une déclaration obligatoire (document 04, étape D).
  await modal.getByLabel("Inconnue (coût incomplet)").check();
  const synthesis = (
    await modal.getByRole("region", { name: "Synthèse du contrat" }).innerText()
  ).replace(/\s+/g, " ");
  check(
    "B3",
    "synthèse avant enregistrement : durée déduite de la mensualité, assurance et frais inconnus",
    synthesis.includes("durée déduite de la mensualité") &&
      synthesis.includes("maturité déduite de la durée") &&
      synthesis.includes("Inconnue") &&
      synthesis.includes("hors assurance et frais récurrents"),
    { synthese: synthesis.slice(0, 400) },
  );
  await page.screenshot({ path: `${OUT}/01_decrire_contrat_bureau.png` });
  await modal.getByRole("button", { name: "Enregistrer le contrat" }).click();
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
  check(
    "B4",
    "page Dettes : la dernière échéance et la durée sont présentées comme calculées",
    debtText.includes("Dernière échéance calculée") && debtText.includes("durée"),
    { extrait: debtText.slice(0, 300) },
  );
  await page.screenshot({ path: `${OUT}/02_dette_contractuelle_bureau.png` });

  const after = await one(
    `select id::text as id, terms_status, current_balance::text as balance, currency,
            payment_count::text as payment_count, maturity_date::text as maturity_date,
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
    "base : même ligne passée à CONTRACT, une seule dette, encours et historique intacts, décision tracée, durée et maturité non persistées",
    after.id === before.id &&
      after.terms_status === "CONTRACT" &&
      after.debts === "1" &&
      Number(after.balance) === 1500.5 &&
      after.currency === "EUR" &&
      after.observations === "1" &&
      after.transitions === "1" &&
      after.payment_count === null &&
      after.maturity_date === null,
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

  // ---------- Embranchement : in fine connu par sa seule maturité ----------
  await page.goto(`${APP}/debt`);
  await page.getByRole("button", { name: "Nouvelle dette" }).click();
  const bullet = page.getByRole("dialog");
  await bullet.getByLabel("Mode de remboursement").selectOption("BULLET");
  check(
    "B5",
    "in fine : aucune mensualité demandée (l'échéance est l'intérêt calculé)",
    (await bullet.getByLabel(/Paiement par échéance/).count()) === 0,
  );
  await bullet.getByLabel("Nom de la dette").fill("Prêt in fine");
  await bullet.getByLabel("Prêteur").fill("Banque");
  await bullet.getByLabel(/Capital initial emprunté/).fill("10 000");
  await bullet.getByLabel(/Encours observé initial/).fill("10 000");
  await bullet.getByLabel("Date de l’encours initial").fill("2026-09-01");
  await bullet.getByLabel(/Taux annuel/).fill("2");
  await bullet.getByLabel("Type de taux").selectOption("FIXED");
  await bullet.getByLabel("Périodicité des échéances").selectOption("ANNUAL");
  await bullet.getByLabel("Convention d’intérêt").selectOption("PROPORTIONAL");
  await bullet.getByLabel("Première échéance").fill("2027-09-01");
  await bullet.getByLabel("Maturité contractuelle").fill("2029-09-01");
  await bullet.getByLabel("Absence d’assurance confirmée").check();
  const bulletSynthesis = (
    await bullet.getByRole("region", { name: "Synthèse du contrat" }).innerText()
  ).replace(/\s+/g, " ");
  check(
    "B6",
    "synthèse in fine : trois échéances, un seul amortissement de capital, à la maturité",
    bulletSynthesis.includes("3, dont 1 amortissant du capital") &&
      /Premier remboursement de capital ?1 septembre 2029/.test(bulletSynthesis) &&
      bulletSynthesis.includes("durée déduite de la maturité"),
    { synthese: bulletSynthesis.slice(0, 400) },
  );
  await page.screenshot({ path: `${OUT}/04_in_fine_synthese_bureau.png` });
  await bullet.getByRole("button", { name: "Ajouter cette dette" }).click();
  await page.waitForTimeout(1000);
  const bulletRow = await one(
    `select terms_status, amortisation_profile, payment_count::text as payment_count,
            maturity_date::text as maturity_date, monthly_payment::text as monthly_payment
       from public.liabilities where user_id = $1 and name = 'Prêt in fine'`,
    [user.id],
  );
  check(
    "B7",
    "base : in fine CONTRACT, maturité déclarée, durée et mensualité non persistées",
    bulletRow?.terms_status === "CONTRACT" &&
      bulletRow?.amortisation_profile === "BULLET" &&
      bulletRow?.maturity_date === "2029-09-01" &&
      bulletRow?.payment_count === null &&
      bulletRow?.monthly_payment === null,
    bulletRow ?? {},
  );
  const stateTwo = await (await page.request.get(`${APP}/api/state`)).json();
  check(
    "B8",
    "bilan : deux dettes contractuelles comptées une fois chacune (1 500,50 + 10 000)",
    stateTwo.balanceSheet.contractualDebt.value === 11500.5 &&
      stateTwo.balanceSheet.totalLiabilities.value === 11500.5,
    { contractuel: stateTwo.balanceSheet.contractualDebt.value },
  );

  // ---------- B17 : assurance séparée, oracle O03 à dates futures ----------
  // O03 (document 08) : principal 1 200 €, 12 × 100 €, assurance séparée 5 €/mois, frais
  // comptants 20 €, intérêt nul confirmé → assurance 60 €, débits 105 €, sorties 1 280 €.
  await page.goto(`${APP}/debt`);
  await page.getByRole("button", { name: "Nouvelle dette" }).click();
  const o03 = page.getByRole("dialog");
  await o03.getByLabel("Mode de remboursement").selectOption("AMORTIZING");
  await o03.getByLabel("Nom de la dette").fill("Prêt assuré");
  await o03.getByLabel("Prêteur").fill("Banque");
  await o03.getByLabel(/Capital initial emprunté/).fill("1 200");
  await o03.getByLabel(/Encours observé initial/).fill("1 200");
  await o03.getByLabel("Date de l’encours initial").fill("2026-09-25");
  await o03.getByLabel(/Taux annuel/).fill("0");
  await o03.getByLabel("Type de taux").selectOption("FIXED");
  await o03.getByLabel("Périodicité des échéances").selectOption("MONTHLY");
  await o03.getByLabel("Convention d’intérêt").selectOption("PROPORTIONAL");
  await o03.getByLabel("Première échéance").fill("2026-10-05");
  await o03.getByLabel(/Paiement par échéance/).fill("100");
  await o03.getByLabel("Prélevée séparément").check();
  check(
    "A1",
    "assurance séparée : aucune fréquence de débit ni date préremplie",
    (await o03.getByLabel("Fréquence des débits").inputValue()) === "" &&
      (await o03.getByLabel("Premier débit").inputValue()) === "",
  );
  await o03.getByLabel("Assureur (facultatif)").fill("Assureur recette");
  await o03.getByRole("button", { name: /Ajouter un assuré/ }).click();
  await o03.getByLabel("Nom de l’assuré 1").fill("Emprunteur");
  await o03.getByLabel("Quotité de l’assuré 1, en pourcentage").fill("100");
  await o03.getByLabel("Premier débit").fill("2026-10-05");
  await o03.getByLabel("Fréquence des débits").selectOption("MONTHLY");
  await o03.getByLabel(/Prime par débit/).fill("5");
  await o03.getByLabel(/Prime par débit/).blur();
  await o03.getByText("Conditions avancées et événements").click();
  await o03.getByLabel("Frais récurrents (vide = inconnus)").fill("0");
  await o03.getByRole("button", { name: "Ajouter une ligne : Frais ponctuels" }).click();
  check(
    "A2",
    "frais ponctuel : ni date ni montant supposés",
    (await o03.getByLabel("Date du frais 1").inputValue()) === "" &&
      (await o03.getByLabel("Montant du frais 1, en EUR").inputValue()) === "",
  );
  await o03.getByLabel("Date du frais 1").fill("2026-10-05");
  await o03.getByLabel("Libellé du frais 1").fill("Frais de dossier");
  await o03.getByLabel("Montant du frais 1, en EUR").fill("20");
  const o03Synthesis = (
    await o03.getByRole("region", { name: "Synthèse du contrat" }).innerText()
  ).replace(/\s+/g, " ");
  check(
    "A3",
    "synthèse avant enregistrement : assurance future 60 €, capital futur 1 200 €, intérêts nuls",
    /Assurance future ?60(,00)? €/.test(o03Synthesis) &&
      /Frais futurs ?20(,00)? €/.test(o03Synthesis) &&
      /Capital futur remboursé ?1 200(,00)? €/.test(o03Synthesis) &&
      /Intérêts futurs ?0(,00)? €/.test(o03Synthesis),
    { synthese: o03Synthesis.slice(0, 600) },
  );
  await page.screenshot({ path: `${OUT}/05_assurance_separee_synthese_bureau.png` });
  await o03.getByRole("button", { name: "Ajouter cette dette" }).click();
  await page.waitForTimeout(1000);
  const o03Row = await one(
    `select l.id::text as id, l.insurance_mode, l.monthly_insurance::text as monthly_insurance,
            l.payment_includes_insurance,
            (select count(*) from public.loan_insurance_policies p where p.liability_id = l.id)::text as policies,
            (select string_agg(i.insured_name || ':' || i.coverage_share::text, ',') from public.loan_insurance_insured i
               join public.loan_insurance_policies p on p.id = i.policy_id where p.liability_id = l.id) as insured,
            (select string_agg(pr.first_debit_date::text || '|' || coalesce(pr.last_debit_date::text, 'null')
                               || '|' || pr.frequency || '|' || pr.premium_amount::text, ',')
               from public.loan_insurance_periods pr
               join public.loan_insurance_policies p on p.id = pr.policy_id where p.liability_id = l.id) as periods
       from public.liabilities l where l.user_id = $1 and l.name = 'Prêt assuré'`,
    [user.id],
  );
  check(
    "A4",
    "base : mode SEPARATE, aucune prime par échéance, une police, un assuré à 100 %, une période ouverte",
    o03Row?.insurance_mode === "SEPARATE" &&
      o03Row?.monthly_insurance === null &&
      o03Row?.policies === "1" &&
      /^Emprunteur:1(\.0+)?$/.test(o03Row?.insured ?? "") &&
      /^2026-10-05\|null\|MONTHLY\|5(\.0+)?$/.test(o03Row?.periods ?? ""),
    o03Row ?? {},
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("region", { name: "Dettes suivies" })
    .getByRole("button", { name: /Prêt assuré/ })
    .click();
  await page.waitForTimeout(300);
  const composition = page.getByRole("figure", { name: "Composition des sorties sur 12 mois" });
  const compositionText = (await composition.count())
    ? (await composition.innerText()).replace(/\s+/g, " ")
    : "";
  check(
    "A5",
    "poste Dette après rechargement : sorties 12 mois 1 280 € = capital 1 200 + assurance 60 + frais 20",
    /1 280(,00)? €/.test(compositionText) &&
      /Capital ?1 200(,00)? €/.test(compositionText) &&
      /60(,00)? €/.test(compositionText) &&
      /Frais ?20(,00)? €/.test(compositionText),
    { composition: compositionText },
  );
  const insuranceFacts = page.getByRole("region", { name: "Assurance emprunteur" });
  const insuranceText = (await insuranceFacts.count())
    ? (await insuranceFacts.innerText()).replace(/\s+/g, " ")
    : "";
  check(
    "A6",
    "inspecteur : assurance prélevée séparément, prochain débit 5 € le 5 octobre 2026, assuré et quotité",
    insuranceText.includes("Prélevée séparément") &&
      /5(,00)? € le 5 octobre 2026/.test(insuranceText) &&
      insuranceText.includes("Emprunteur (100 %)") &&
      insuranceText.includes("à la dernière échéance du prêt"),
    { inspecteur: insuranceText.slice(0, 400) },
  );
  const scheduleTable = page.getByRole("table", { name: "Prochaines échéances" });
  const scheduleText = (await scheduleTable.count())
    ? (await scheduleTable.innerText()).replace(/\s+/g, " ")
    : "";
  check(
    "A7",
    "échéancier : ligne d'assurance distincte, frais distinct, 12 échéances calculées (hors assurance et frais)",
    scheduleText.includes("Assurance (prélèvement séparé)") &&
      /12 échéances restantes sur 12 calculées/.test(
        (await page.locator("main").innerText()).replace(/\s+/g, " "),
      ) &&
      scheduleText.includes("Échéance n° 1") &&
      scheduleText.includes("Frais"),
    { echeancier: scheduleText.slice(0, 400) },
  );
  await page.screenshot({ path: `${OUT}/06_assurance_separee_poste_bureau.png`, fullPage: true });
  const stateThree = await (await page.request.get(`${APP}/api/state`)).json();
  check(
    "A8",
    "bilan : l'assurance n'ajoute aucun passif (1 500,50 + 10 000 + 1 200)",
    stateThree.balanceSheet.totalLiabilities.value === 12700.5,
    { passif: stateThree.balanceSheet.totalLiabilities.value },
  );

  // ---------- Zoom 200 % (viewport CSS 640 px) et thème sombre ----------
  const zoom = await browser.newContext({
    viewport: { width: 640, height: 450 },
    deviceScaleFactor: 2,
    locale: "fr-FR",
    colorScheme: "dark",
  });
  await zoom.addCookies(await ctx.cookies());
  const zpage = await zoom.newPage();
  await zpage.goto(`${APP}/debt`);
  await zpage.waitForLoadState("networkidle");
  const zscroll = await zpage.evaluate(() => document.documentElement.scrollWidth);
  // Débordement INTERNE : un tableau qui défile dans son cadre tronque la lecture sans que la
  // page ne déborde ; le contrôle porte donc aussi sur l'échéancier lui-même.
  const zinner = await zpage
    .getByRole("table", { name: "Prochaines échéances" })
    .evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  check(
    "Z1",
    "zoom 200 % équivalent (640 px CSS) : ni la page ni l'échéancier ne débordent",
    zscroll <= 640 && zinner.scroll <= zinner.client,
    { scrollWidth: zscroll, echeancier: zinner },
  );
  // Le thème sombre est un choix de l'application (bouton), pas la préférence système.
  await zpage.getByRole("button", { name: "Changer de thème" }).click();
  const theme = await zpage.evaluate(() => ({
    attr: document.documentElement.dataset.theme ?? null,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  check("T1", "thème sombre appliqué par le bouton de l'application", theme.attr === "dark", theme);
  await zpage.screenshot({ path: `${OUT}/07_dette_zoom200_sombre.png`, fullPage: true });
  await zoom.close();

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
