/**
 * Amorçage de la base Supabase de production.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/seed-supabase.ts
 *   node --env-file=.env.local --experimental-strip-types scripts/seed-supabase.ts --force
 *
 * Exécution manuelle, une seule fois. Volontairement pas de seed paresseux au premier
 * appel HTTP : en serverless, deux requêtes froides concurrentes dupliqueraient les données.
 *
 * Reprend à l'identique les données du seed SQLite (src/lib/data/local-repository.ts).
 * Aucune formule financière n'est recalculée ici : l'échéancier du prêt réutilise
 * amortizeLoan du moteur.
 */

import { createClient } from "@supabase/supabase-js";
import { amortizeLoan } from "../src/lib/engine/financial.ts";

const AS_OF_DATE = "2026-08-19";
const NOW = `${AS_OF_DATE}T12:00:00.000Z`;
const FORCE = process.argv.includes("--force");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

const url = process.env.SUPABASE_URL ?? required("NEXT_PUBLIC_SUPABASE_URL");
const db = createClient(url, required("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
const USER = required("OWNER_USER_ID");

type Row = Record<string, unknown>;

async function insert(table: string, rows: Row[]): Promise<Row[]> {
  if (rows.length === 0) return [];
  const { data, error } = await db.from(table).insert(rows.map((row) => ({ user_id: USER, ...row }))).select("*");
  if (error) throw new Error(`insert ${table} : ${error.message}`);
  return (data ?? []) as Row[];
}

function byName(rows: Row[]): Map<string, string> {
  return new Map(rows.map((row) => [String(row.name), String(row.id)]));
}

async function main() {
  const existing = await db.from("financial_accounts").select("id").eq("user_id", USER).limit(1);
  if (existing.error) throw new Error(`vérification : ${existing.error.message}`);
  if ((existing.data ?? []).length > 0 && !FORCE) {
    console.log("Base déjà amorcée pour cet utilisateur. Relancer avec --force pour ajouter malgré tout.");
    return;
  }

  const profile = await db.from("profiles").upsert({ user_id: USER, display_name: "Léo", reporting_currency: "EUR" }).select("user_id");
  if (profile.error) throw new Error(`profiles : ${profile.error.message}`);

  const institutions = byName(await insert("institutions", [
    { name: "Boursobank", country_code: "FR" },
    { name: "Revolut", country_code: "LT" },
    { name: "CIC", country_code: "FR" },
    { name: "Trade Republic", country_code: "DE" },
    { name: "Bpifrance", country_code: "FR" },
  ]));

  const assetClasses = byName(await insert("asset_classes", [
    { name: "Cash", productive: false },
    { name: "Actions monde", productive: true },
    { name: "Or", productive: true },
    { name: "Actions individuelles", productive: true },
  ]));

  const accountSeed: Array<[string, string, string, string, string, number, string | null]> = [
    ["Boursobank", "Compte courant Ultim", "BANK", "EUR", "IMMEDIATE", 355.48, null],
    ["Revolut", "Compte courant personnel", "BANK", "EUR", "IMMEDIATE", 0.53, null],
    ["Revolut", "Saving / arrondis", "SAVINGS", "EUR", "IMMEDIATE", 1.51, null],
    ["CIC", "Compte courant Mastercard", "BANK", "EUR", "IMMEDIATE", -3.44, null],
    ["Boursobank", "PEA", "PEA", "EUR", "LIQUID", 15003.13, "Le total déclaré est la source de vérité comptable; les positions ont un écart ouvert."],
    ["Trade Republic", "CTO", "CTO", "EUR", "LIQUID", 214.28, null],
  ] as Array<[string, string, string, string, string, number, string | null]>;

  const accounts = await insert("financial_accounts", accountSeed.map(([institution, name, type, currency, liquidity, , notes]) => ({
    institution_id: institutions.get(institution), name, account_type: type, currency, liquidity, status: "ACTIVE",
    data_kind: "ACTUAL", confidence: "HIGH", source: "Données communiquées par Léo", effective_date: AS_OF_DATE, notes,
  })));
  const accountIds = byName(accounts);

  await insert("account_balances", accountSeed.map(([, name, , , , balance]) => ({
    account_id: accountIds.get(name), balance, balance_date: AS_OF_DATE,
    data_kind: "ACTUAL", confidence: "HIGH", source: "Données communiquées par Léo",
  })));

  const securities = byName(await insert("securities", [
    { name: "iShares MSCI World Swap PEA UCITS ETF EUR Acc", currency: "EUR", asset_class_id: assetClasses.get("Actions monde") },
    { name: "Cash PEA", currency: "EUR", asset_class_id: assetClasses.get("Cash") },
    { name: "Positions CTO à ventiler", currency: "EUR", asset_class_id: assetClasses.get("Actions individuelles") },
  ]));

  const positionSeed: Array<[string, string, boolean, number, number | null, string]> = [
    ["PEA", "iShares MSCI World Swap PEA UCITS ETF EUR Acc", false, 8698, 7994.88, "Inclut 703,12 € de plus-value annoncée."],
    ["PEA", "Cash PEA", true, 6304.57, 6304.57, "Cash interne au PEA; exclu du cash bancaire."],
    ["CTO", "Positions CTO à ventiler", false, 214.28, null, "Corcept Therapeutics, AMD et Physical Gold USD mentionnés; ventilation de valeur manquante."],
  ];

  // Insertion séquentielle : l'appariement position/snapshot ne doit pas dépendre
  // de l'ordre de retour de PostgREST.
  const positions: Row[] = [];
  for (const [account, security, isCash, marketValue, costBasis, notes] of positionSeed) {
    const [position] = await insert("positions", [{
      account_id: accountIds.get(account), security_id: securities.get(security), is_cash: isCash,
      data_kind: "ACTUAL", confidence: "HIGH", source: "Données communiquées par Léo", notes,
    }]);
    positions.push(position);
    await insert("position_snapshots", [{
      position_id: position.id, snapshot_date: AS_OF_DATE, quantity: null, cost_basis: costBasis,
      market_value: marketValue, currency: "EUR", data_kind: "ACTUAL", confidence: "HIGH",
      source: "Données communiquées par Léo",
    }]);
  }

  const [liability] = await insert("liabilities", [{
    lender: "Bpifrance", name: "Prêt étudiant", principal: 16745, current_balance: 16745, annual_rate: 0,
    monthly_payment: 284.72, payment_count: 60, first_payment_date: "2026-12-05", maturity_date: "2031-11-05",
    rate_type: "FIXED", data_kind: "ACTUAL", confidence: "HIGH", source: "Données communiquées par Léo",
    notes: "Échéancier bancaire réel à importer; écart de réconciliation ouvert.",
  }]);

  await insert("loan_schedules", amortizeLoan(16745, 0, 60, 284.72).map((row) => ({
    liability_id: liability.id, payment_number: row.paymentNumber,
    due_date: new Date(Date.UTC(2026, 11 + row.paymentNumber - 1, 5)).toISOString().slice(0, 10),
    opening_balance: row.openingBalance, payment: row.payment, interest: row.interest,
    principal: row.principal, closing_balance: row.closingBalance, data_kind: "DERIVED",
  })));

  await insert("income_sources", [
    { name: "Revenu net mensuel actuel", monthly_net: 1282, active: true, start_date: AS_OF_DATE, data_kind: "ACTUAL", confidence: "HIGH", source: "Données communiquées par Léo", effective_date: AS_OF_DATE, notes: null },
    { name: "Professeur de tennis", monthly_net: 130, active: false, start_date: null, data_kind: "USER_ASSUMPTION", confidence: "MEDIUM", source: "15 € × 2 h/semaine annualisé", effective_date: null, notes: "Date de début requise avant activation." },
    { name: "CAF", monthly_net: null, active: false, start_date: null, data_kind: "MISSING", confidence: "UNKNOWN", source: "Demande prévue", effective_date: null, notes: "Montant et date inconnus." },
  ]);

  const categorySeed: Array<[string, string, boolean, number | null, string]> = [
    ["Loyer charges comprises", "Logement", true, 1140, "ACTUAL"],
    ["Électricité", "Logement", true, null, "MISSING"],
    ["Internet", "Logement", true, null, "MISSING"],
    ["Téléphone", "Vie courante", true, null, "MISSING"],
    ["Assurance", "Vie courante", true, null, "MISSING"],
    ["Transport", "Vie courante", true, null, "MISSING"],
    ["Courses", "Vie courante", true, null, "MISSING"],
    ["Restaurants", "Lifestyle", false, null, "MISSING"],
    ["Bars", "Lifestyle", false, null, "MISSING"],
    ["Habillement", "Lifestyle", false, null, "MISSING"],
    ["Parfums", "Lifestyle", false, null, "MISSING"],
    ["Décoration", "Lifestyle", false, null, "MISSING"],
    ["Vacances", "Lifestyle", false, null, "MISSING"],
    ["Cadeaux", "Lifestyle", false, null, "MISSING"],
    ["Sport", "Lifestyle", false, null, "MISSING"],
    ["Abonnements", "Lifestyle", false, null, "MISSING"],
    ["Santé", "Vie courante", true, null, "MISSING"],
    ["Autres", "Autres", false, null, "MISSING"],
    ["Revenu", "Revenus", false, null, "MISSING"],
    ["Investissement", "Épargne", false, null, "MISSING"],
  ];

  const categories = byName(await insert("expense_categories", categorySeed.map(([name, groupName, essential]) => ({
    name, group_name: groupName, essential,
  }))));

  await insert("budgets", categorySeed.map(([name, , , amount, kind]) => ({
    category_id: categories.get(name), lifestyle: "COMFORTABLE", monthly_amount: amount, data_kind: kind,
    confidence: kind === "ACTUAL" ? "HIGH" : "UNKNOWN",
    source: kind === "ACTUAL" ? "Données communiquées par Léo" : "À renseigner", effective_date: AS_OF_DATE,
  })));

  const scenarioSeed: Array<[string, string, string, number, number, number, number, number, number, number | null, number | null]> = [
    ["Prudent", "Rendement modéré et épargne progressive", "#5b7c74", 0.035, 0.10, 0.025, 150, 0.02, 0.02, null, null],
    ["Central", "Trajectoire de référence modifiable", "#31676f", 0.055, 0.15, 0.02, 250, 0.035, 0.025, null, null],
    ["Ambitieux", "Progression de carrière et épargne soutenues", "#3157a4", 0.07, 0.18, 0.02, 500, 0.055, 0.025, null, null],
    ["Stress", "Chômage et choc de marché en année 2", "#a84f45", 0.025, 0.24, 0.035, 0, 0.01, 0.05, 2, -0.35],
    ["Très favorable", "Forte progression sans être traitée comme certitude", "#80643a", 0.085, 0.20, 0.018, 750, 0.07, 0.02, null, null],
  ];

  const scenarios = await insert("scenarios", scenarioSeed.map(([name, description, color, annualReturn, volatility, inflation, savings, salaryGrowth, stress, shockYear, shockMagnitude]) => ({
    name, description, color, current_version: 1, annual_return: annualReturn, annual_volatility: volatility,
    annual_inflation: inflation, monthly_savings: savings, salary_growth: salaryGrowth, stress_probability: stress,
    shock_year: shockYear, shock_magnitude: shockMagnitude, data_kind: "MODEL_ASSUMPTION", confidence: "MEDIUM",
    created_at: NOW, updated_at: NOW,
  })));

  await insert("scenario_versions", scenarios.map((scenario) => ({
    scenario_id: scenario.id, version: 1, payload: scenario, created_at: NOW,
  })));

  await insert("economic_assumptions", [
    { name: "Variable annuel central premier CDI", value: 9000, unit: "EUR/an", data_kind: "MODEL_ASSUMPTION", confidence: "LOW", source: "Milieu de la fourchette 3–15 k€", effective_date: AS_OF_DATE, updated_at: NOW, notes: "À remplacer par une offre réelle." },
    { name: "Fixe annuel brut central premier CDI", value: 42000, unit: "EUR/an", data_kind: "USER_ASSUMPTION", confidence: "MEDIUM", source: "Brief utilisateur", effective_date: AS_OF_DATE, updated_at: NOW, notes: null },
    { name: "Réserve cible", value: 4.5, unit: "mois essentiels", data_kind: "MODEL_ASSUMPTION", confidence: "LOW", source: "Score de stabilité initial", effective_date: AS_OF_DATE, updated_at: NOW, notes: "Recalculable après historique de dépenses." },
    { name: "Comportement en baisse de 35 %", value: "Conserver et continuer à investir", unit: "texte", data_kind: "USER_ASSUMPTION", confidence: "HIGH", source: "Déclaration utilisateur", effective_date: AS_OF_DATE, updated_at: NOW, notes: null },
    { name: "Fiscalité française", value: "Architecture prête, règles 2026 à vérifier", unit: "texte", data_kind: "MODEL_ASSUMPTION", confidence: "LOW", source: "Aucune règle fiscale non vérifiée appliquée", effective_date: AS_OF_DATE, updated_at: NOW, notes: "Ne constitue pas un conseil fiscal." },
  ]);

  await insert("tax_profiles", [{ residency_country: "FR", household_status: "INDIVIDUAL", effective_from: AS_OF_DATE }]);
  await insert("tax_rules", [{
    jurisdiction: "FR", name: "Barème IR à confirmer avant calcul", tax_year: 2026,
    rule: { status: "MISSING", note: "Aucune règle fiscale non vérifiée n'est appliquée." },
    source: "https://www.impots.gouv.fr", verified_at: null, data_kind: "MISSING", confidence: "UNKNOWN",
  }]);

  await insert("alerts", [
    { severity: "HIGH", title: "Écart sur le prêt étudiant", detail: "60 × 284,72 € = 17 083,20 €, soit 338,20 € au-dessus du capital annoncé. Échéancier bancaire requis.", status: "OPEN", created_at: NOW },
    { severity: "MEDIUM", title: "Écart de composition du PEA", detail: "ETF 8 698,00 € + cash 6 304,57 € = 15 002,57 €, soit 0,56 € sous le total annoncé.", status: "OPEN", created_at: NOW },
    { severity: "MEDIUM", title: "Cash flow incomplet", detail: "Seul le loyer est renseigné. Les taux d'épargne et la réserve cible sont provisoires.", status: "OPEN", created_at: NOW },
    { severity: "HIGH", title: "Liquidité bancaire très faible", detail: "354,08 € couvrent environ 0,31 mois du seul loyer observé.", status: "OPEN", created_at: NOW },
  ]);

  await insert("goals", [
    { name: "Premier palier patrimonial", target_amount: 100000, target_date: "2032-12-31", priority: 1, status: "ACTIVE" },
    { name: "Réserve de sécurité cible", target_amount: 5130, target_date: null, priority: 2, status: "ACTIVE" },
  ]);

  console.log(`Seed terminé pour ${USER} : ${accounts.length} comptes, ${positions.length} positions, ${scenarios.length} scénarios.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
