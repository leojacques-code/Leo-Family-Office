// Recette B18 : événements et avenants de dette versionnés (document 04 §6). Parcours :
// ouvrir la dette → consulter contrat et historique → ajouter un événement ou un avenant →
// vérifier les conséquences → enregistrer → retrouver le calendrier et l'historique.
// Pile locale de `services.sh`, build de production.
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
for (const host of [new URL(APP).hostname, new URL(GATEWAY).hostname, new URL(env("RECETTE_ADMIN_DB_URL")).hostname])
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
const today = (await one("select (now() at time zone 'Europe/Paris')::date::text as d")).d;
const inDays = async (days) =>
  (await one("select ((now() at time zone 'Europe/Paris')::date + $1::int)::text as d", [days])).d;

async function createUser(prefix) {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const user = { email: `${prefix}-${stamp}@lfo.invalid`, password: `Evenement-${stamp}-ok` };
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
const text = async (locator) => ((await locator.count()) ? (await locator.innerText()).replace(/\s+/g, " ") : "");

const userA = await createUser("recette-evenement-a");
const userB = await createUser("recette-evenement-b");
const browser = await chromium.launch(process.env.RECETTE_CHROMIUM ? { executablePath: process.env.RECETTE_CHROMIUM } : {});
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  await login(page, userA);

  // Contrat de départ : 1 200 € à taux nul, 12 × 100 € à partir d'octobre 2026 + 1 mois.
  const first = await inDays(10);
  const created = await page.request.post(`${APP}/api/debt`, {
    headers: { Origin: APP },
    data: {
      action: "save_debt_contract",
      contract: {
        liabilityId: null, name: "Prêt événements", lender: "Banque", principal: 1200,
        initialBalance: 1200, balanceDate: today, annualRate: 0, paymentAmount: 100,
        paymentCount: 12, firstPaymentDate: first, maturityDate: null,
        amortisationProfile: "AMORTIZING", balloonAmount: null, paymentFrequency: "MONTHLY",
        interestConvention: "PROPORTIONAL", rateType: "FIXED", insuranceAmount: null,
        recurringFees: 0, paymentIncludesInsurance: false, insuranceMode: "NONE",
        insurancePolicies: [], deferral: null, facilityId: null, notes: null, rateSchedule: [],
        paymentSchedule: [], earlyRepayments: [], charges: [], providedSchedule: [],
      },
    },
  });
  const debt = await one("select id::text from public.liabilities where user_id = $1", [userA.id]);
  check("E0", "contrat de départ enregistré", created.ok() && Boolean(debt));

  // ---------- Ouvrir la dette, consulter l'historique ----------
  await page.goto(`${APP}/debt`);
  await page.waitForLoadState("networkidle");
  const history = page.getByRole("region", { name: "Historique du contrat" });
  check(
    "E1",
    "historique visible : aucun événement, version 1 de création",
    (await text(history)).includes("Aucun événement enregistré") && (await text(history)).includes("Versions du contrat (1)"),
  );

  // ---------- Avenant : conséquences puis enregistrement ----------
  const effect = (await one("select (($1::date) + interval '3 months')::date::text as d", [first])).d;
  const lastAfter = (await one("select (($1::date) + interval '20 months')::date::text as d", [first])).d;
  await page.getByRole("button", { name: "Événement ou avenant" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(/J’ai signé un avenant/).check();
  await dialog.getByLabel("Date d’effet").fill(effect);
  await dialog.getByLabel("Source").fill("Avenant n° 1 signé");
  await dialog.getByLabel(/Nouvelle mensualité/).fill("50");
  await dialog.getByLabel(/Nouvelle mensualité/).blur();
  await dialog.getByLabel("Nouvelle dernière échéance (facultative)").fill(lastAfter);
  const consequences = dialog.getByRole("region", { name: "Conséquences" });
  const consequenceText = await text(consequences);
  check(
    "E2",
    "conséquences avant enregistrement : avant et après, dernière échéance repoussée, aucun solde résiduel",
    consequenceText.includes("Aujourd’hui") && consequenceText.includes("Avec l’événement") && !consequenceText.includes("subsisteraient"),
    { apercu: consequenceText.slice(0, 300) },
  );
  await page.screenshot({ path: `${OUT}/01_avenant_consequences.png` });
  await dialog.getByRole("button", { name: /Enregistrer l’événement/ }).click();
  await page.waitForTimeout(1000);
  const amendment = await one(
    "select id::text, nature, payload ->> 'payment_amount' as payment, payload ->> 'maturity_date' as maturity from public.liability_events where user_id = $1 and event_kind = 'AMENDMENT'",
    [userA.id],
  );
  check("E3", "base : avenant CONTRACTUEL, mensualité en texte, nouvelle fin", amendment?.nature === "CONTRACTUAL" && amendment?.payment === "50" && amendment?.maturity === lastAfter, amendment ?? {});

  // ---------- Retrouver calendrier et historique après rechargement ----------
  await page.reload();
  await page.waitForLoadState("networkidle");
  const facts = await text(page.locator(".loan-facts"));
  const schedule = await text(page.getByRole("table", { name: "Prochaines échéances" }));
  const historyText = await text(history);
  check(
    "E4",
    "après rechargement : nouvelle dernière échéance, échéances à 50 € après l'effet, avenant dans l'historique avec sa source",
    historyText.includes("Avenant") && historyText.includes("Avenant n° 1 signé") && schedule.includes("50 €") && facts.length > 0,
    { historique: historyText.slice(0, 200) },
  );
  await page.screenshot({ path: `${OUT}/02_historique_apres_avenant.png`, fullPage: true });

  // ---------- Remboursement effectué avec encours constaté ----------
  await page.getByRole("button", { name: "Événement ou avenant" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(/J’ai remboursé une partie du capital/).check();
  await dialog.getByLabel("Date du remboursement").fill(today);
  await dialog.getByLabel("Source").fill("Relevé de la banque");
  await dialog.getByLabel(/Capital remboursé/).fill("200");
  await dialog.getByLabel("Indemnité de remboursement anticipé").selectOption("KNOWN");
  await dialog.getByLabel(/Montant de l’indemnité/).fill("0");
  await dialog.getByLabel("Effet sur le prêt").selectOption("SHORTEN_TERM");
  await dialog.getByLabel(/Capital restant dû indiqué par le prêteur/).fill("1 000");
  await dialog.getByLabel(/Capital restant dû indiqué par le prêteur/).blur();
  await dialog.getByRole("button", { name: /Enregistrer l’événement/ }).click();
  await page.waitForTimeout(1000);
  const observed = await one(
    `select o.data_kind, o.balance::text as balance, o.source from public.liability_events e
       join public.liability_balance_observations o on o.id = e.observation_id
      where e.user_id = $1 and e.event_kind = 'EARLY_REPAYMENT'`,
    [userA.id],
  );
  const stateA = await (await page.request.get(`${APP}/api/state`)).json();
  check(
    "E5",
    "remboursement effectué : encours constaté ACTUAL écrit, patrimoine au nouvel encours (1 000 €)",
    observed?.data_kind === "ACTUAL" && Number(observed?.balance) === 1000 && stateA.balanceSheet.totalLiabilities.value === 1000,
    { observation: observed, passif: stateA.balanceSheet.totalLiabilities.value },
  );

  // ---------- Remboursement prévu : intention, aucun encours ----------
  const plannedDate = await inDays(40);
  const plannedResponse = await page.request.post(`${APP}/api/debt`, {
    headers: { Origin: APP },
    data: { action: "record_debt_event", liabilityId: debt.id, nature: "PLANNED", effectiveDate: plannedDate, source: "Annonce au prêteur", content: { kind: "EARLY_REPAYMENT", amount: 100, penalty: null, outcome: "UNKNOWN", balanceAfter: null } },
  });
  const observations = await one("select count(*)::text as n from public.liability_balance_observations where user_id = $1", [userA.id]);
  const futureObserved = await page.request.post(`${APP}/api/debt`, {
    headers: { Origin: APP },
    data: { action: "record_debt_event", liabilityId: debt.id, nature: "OBSERVED", effectiveDate: plannedDate, source: "x", content: { kind: "EARLY_REPAYMENT", amount: 100, penalty: null, outcome: "UNKNOWN", balanceAfter: null } },
  });
  check(
    "E6",
    "prévu accepté sans écrire d'encours ; « effectué » daté dans le futur refusé",
    plannedResponse.ok() && observations.n === "2" && futureObserved.status() === 400,
    { statutFutur: futureObserved.status() },
  );

  // ---------- Annuler l'avenant : historique conservé, calendrier rétabli ----------
  await page.reload();
  await page.waitForLoadState("networkidle");
  const effectLabel = new Date(`${effect}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  await history.getByRole("button", { name: `Annuler l’événement du ${effectLabel}` }).click();
  await history.getByRole("button", { name: "Confirmer l’annulation" }).click();
  const missingReason = await text(history.getByRole("alert"));
  await history.getByLabel("Motif de l’annulation").fill("Avenant saisi sur le mauvais prêt");
  await history.getByRole("button", { name: "Confirmer l’annulation" }).click();
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const afterCancel = await text(history);
  const cancellation = await one(
    "select c.reason, (select count(*) from public.liability_events where user_id = $1)::text as events from public.liability_event_cancellations c where c.user_id = $1",
    [userA.id],
  );
  check(
    "E7",
    "annulation : motif exigé, trace motivée, avenant toujours lisible et barré",
    missingReason.includes("motif") && afterCancel.includes("Annulé le") && afterCancel.includes("mauvais prêt") && cancellation?.events === "3",
    { annulation: cancellation },
  );
  await page.screenshot({ path: `${OUT}/03_avenant_annule.png`, fullPage: true });

  // ---------- Correction de saisie : nouvelle version motivée ----------
  await page.getByRole("button", { name: "Corriger le contrat" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Prêteur").fill("Banque Recette");
  await dialog.getByLabel("Motif de la correction (facultatif)").fill("Nom du prêteur incomplet");
  await dialog.getByRole("button", { name: "Enregistrer le contrat" }).click();
  await page.waitForTimeout(1000);
  const versions = await sql.query(
    "select version_no, change_kind, change_reason from public.liability_contract_versions where user_id = $1 order by version_no",
    [userA.id],
  );
  const eventsKept = await one("select count(*)::text as n from public.liability_events where user_id = $1", [userA.id]);
  check(
    "E8",
    "correction : version 2 motivée, événements du journal intacts (non réabsorbés par le contrat)",
    versions.rows.length === 2 && versions.rows[1].change_kind === "CORRECTION" && versions.rows[1].change_reason === "Nom du prêteur incomplet" && eventsKept.n === "3",
    { versions: versions.rows },
  );
  const earlyLegacy = await one("select count(*)::text as n from public.loan_early_repayments where user_id = $1", [userA.id]);
  check("E9", "aucun événement recopié dans les listes du contrat", earlyLegacy.n === "0", earlyLegacy);

  // ---------- Isolation ----------
  const ctxB = await browser.newContext({ locale: "fr-FR" });
  const pageB = await ctxB.newPage();
  await login(pageB, userB);
  const debtB = await (await pageB.request.get(`${APP}/api/debt`)).json();
  const intrusion = await pageB.request.post(`${APP}/api/debt`, {
    headers: { Origin: APP },
    data: { action: "record_debt_event", liabilityId: debt.id, nature: "CONTRACTUAL", effectiveDate: effect, source: "Intrus", content: { kind: "RATE_CHANGE", annualRate: 0.05 } },
  });
  const count = await one("select count(*)::text as n from public.liability_events where liability_id = $1", [debt.id]);
  check("E10", "isolation : B ne voit rien et ne peut rien ajouter à la dette de A", (debtB.liabilities ?? []).length === 0 && !intrusion.ok() && count.n === "3", { statut: intrusion.status() });
  await ctxB.close();

  // ---------- Solde total ----------
  await page.reload();
  await page.getByRole("button", { name: "Événement ou avenant" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(/J’ai soldé le prêt/).check();
  await dialog.getByLabel("Date du remboursement").fill(today);
  await dialog.getByLabel("Source").fill("Attestation de fin de prêt");
  await dialog.getByLabel(/Montant remboursé pour solder/).fill("1 000");
  await dialog.getByLabel("Indemnité de remboursement anticipé").selectOption("UNKNOWN");
  await dialog.getByRole("button", { name: /Enregistrer l’événement/ }).click();
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const stateEnd = await (await page.request.get(`${APP}/api/state`)).json();
  check(
    "E11",
    "solde total : encours constaté nul, archivage proposé",
    stateEnd.balanceSheet.totalLiabilities.value === 0 && (await page.getByRole("button", { name: /Archiver cette dette éteinte/ }).count()) === 1,
  );

  // ---------- Clavier, tablette, mobile ----------
  const eventButton = page.getByRole("button", { name: "Événement ou avenant" });
  await eventButton.focus();
  await page.keyboard.press("Enter");
  const focusInside = await page.getByRole("dialog").evaluate((node) => node.contains(document.activeElement));
  await page.keyboard.press("Escape");
  check("K1", "clavier : le formulaire d'événement s'ouvre à l'Entrée avec le focus dedans", focusInside);
  for (const [id, width] of [["M1", 390], ["M2", 768]]) {
    const small = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500, locale: "fr-FR" });
    await small.addCookies(await ctx.cookies());
    const spage = await small.newPage();
    await spage.goto(`${APP}/debt`);
    await spage.waitForLoadState("networkidle");
    const scroll = await spage.evaluate(() => document.documentElement.scrollWidth);
    await spage.screenshot({ path: `${OUT}/0${id === "M1" ? 4 : 5}_historique_${width}.png`, fullPage: true });
    check(id, `Dettes et historique à ${width} px sans débordement horizontal`, scroll <= width, { scrollWidth: scroll });
    await small.close();
  }
  check("E12", "aucune erreur JavaScript", errors.length === 0, { errors: errors.slice(0, 3) });
} finally {
  await browser.close();
  writeFileSync(
    `${OUT}/recette-evenements.json`,
    JSON.stringify({ date: new Date().toISOString(), app: APP, utilisateurs: [userA.email, userB.email], environnement: "pile Supabase auto-hébergée locale ; build de production", checks }, null, 2),
  );
  await sql.end();
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} contrôles réussis`);
  process.exitCode = failed ? 1 : 0;
}
