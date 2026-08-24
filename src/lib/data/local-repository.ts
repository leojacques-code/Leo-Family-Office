import "server-only";

import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { amortizeLoan } from "@/lib/engine/financial";
import { AS_OF_DATE, REPORTING_CURRENCY, deriveMetrics, ledgerWindowStart, shouldDeriveBalance } from "@/lib/data/shared";
import type { FamilyOfficeRepository } from "@/lib/data/repository";
import type { DocumentUpload, Mutation, SimulationRun } from "@/lib/data/contracts";
import type {
  Alert,
  DashboardState,
  DocumentRecord,
  ExpenseCategory,
  FinancialAccount,
  Goal,
  IncomeSource,
  Liability,
  Position,
  Scenario,
  Transaction,
} from "@/lib/types";

const USER_ID = "usr_leo";
let database: DatabaseSync | undefined;

type SqlRow = Record<string, string | number | null>;

/**
 * Adapter local/dev uniquement. node:sqlite est expérimental sous Node 22 et le filesystem
 * de Vercel est en lecture seule. Ce module n'est chargé que par import dynamique depuis
 * repository.ts quand DATA_ADAPTER=local : il n'est jamais évalué en production.
 */
function db() {
  if (database) return database;
  const dataDirectory = path.join(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true });
  database = new DatabaseSync(path.join(dataDirectory, "family-office.db"));
  database.exec(readFileSync(path.join(process.cwd(), "src", "lib", "data", "schema.sql"), "utf8"));
  seed(database);
  return database;
}

function provenance(row: SqlRow) {
  return {
    kind: String(row.kind) as FinancialAccount["provenance"]["kind"],
    confidence: String(row.confidence) as FinancialAccount["provenance"]["confidence"],
    source: row.source ? String(row.source) : undefined,
    effectiveDate: row.effective_date ? String(row.effective_date) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
  };
}

function seed(databaseInstance: DatabaseSync) {
  const count = databaseInstance.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (count.count > 0) return;
  const now = `${AS_OF_DATE}T12:00:00.000Z`;
  databaseInstance.exec("BEGIN IMMEDIATE");
  try {
    databaseInstance.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(USER_ID, "Léo", "EUR", now);
    const institutions = [
      ["ins_boursobank", "Boursobank", "FR"], ["ins_revolut", "Revolut", "LT"],
      ["ins_cic", "CIC", "FR"], ["ins_trade_republic", "Trade Republic", "DE"], ["ins_bpifrance", "Bpifrance", "FR"],
    ];
    const insertInstitution = databaseInstance.prepare("INSERT INTO institutions(id, name, country_code) VALUES (?, ?, ?)");
    institutions.forEach((entry) => insertInstitution.run(...entry));

    const assetClasses = [
      ["ac_cash", "Cash", null, 0], ["ac_world_equity", "Actions monde", null, 1],
      ["ac_gold", "Or", null, 1], ["ac_other_equity", "Actions individuelles", null, 1],
    ];
    const insertAssetClass = databaseInstance.prepare("INSERT INTO asset_classes VALUES (?, ?, ?, ?)");
    assetClasses.forEach((entry) => insertAssetClass.run(...entry));

    const accounts = [
      ["acc_boursobank", "ins_boursobank", "Compte courant Ultim", "BANK", "EUR", "IMMEDIATE", 355.48],
      ["acc_revolut", "ins_revolut", "Compte courant personnel", "BANK", "EUR", "IMMEDIATE", 0.53],
      ["acc_revolut_saving", "ins_revolut", "Saving / arrondis", "SAVINGS", "EUR", "IMMEDIATE", 1.51],
      ["acc_cic", "ins_cic", "Compte courant Mastercard", "BANK", "EUR", "IMMEDIATE", -3.44],
      ["acc_pea", "ins_boursobank", "PEA", "PEA", "EUR", "LIQUID", 15003.13],
      ["acc_cto", "ins_trade_republic", "CTO", "CTO", "EUR", "LIQUID", 214.28],
    ];
    const insertAccount = databaseInstance.prepare(`INSERT INTO financial_accounts
      (id,user_id,institution_id,name,account_type,currency,liquidity,status,kind,confidence,source,effective_date,notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'ACTUAL', 'HIGH', 'Données communiquées par Léo', ?, ?)`);
    const insertBalance = databaseInstance.prepare(`INSERT INTO account_balances
      (id,account_id,balance,balance_date,kind,confidence,source,created_at) VALUES (?, ?, ?, ?, 'ACTUAL', 'HIGH', 'Données communiquées par Léo', ?)`);
    accounts.forEach(([id, institution, name, type, currency, liquidity, balance]) => {
      insertAccount.run(id, USER_ID, institution, name, type, currency, liquidity, AS_OF_DATE, type === "PEA" ? "Le total déclaré est la source de vérité comptable; les positions ont un écart ouvert." : null);
      insertBalance.run(`bal_${id}`, id, balance, AS_OF_DATE, now);
    });

    const securities = [
      ["sec_world", "iShares MSCI World Swap PEA UCITS ETF EUR Acc", null, null, "EUR", "ac_world_equity"],
      ["sec_pea_cash", "Cash PEA", null, null, "EUR", "ac_cash"],
      ["sec_cto_unallocated", "Positions CTO à ventiler", null, null, "EUR", "ac_other_equity"],
    ];
    const insertSecurity = databaseInstance.prepare("INSERT INTO securities VALUES (?, ?, ?, ?, ?, ?)");
    securities.forEach((entry) => insertSecurity.run(...entry));
    const positions = [
      ["pos_world", "acc_pea", "sec_world", 0, 8698, 7994.88, "Inclut 703,12 € de plus-value annoncée."],
      ["pos_pea_cash", "acc_pea", "sec_pea_cash", 1, 6304.57, 6304.57, "Cash interne au PEA; exclu du cash bancaire."],
      ["pos_cto_unallocated", "acc_cto", "sec_cto_unallocated", 0, 214.28, null, "Corcept Therapeutics, AMD et Physical Gold USD mentionnés; ventilation de valeur manquante."],
    ];
    const insertPosition = databaseInstance.prepare("INSERT INTO positions VALUES (?, ?, ?, ?, 'ACTUAL', 'HIGH', 'Données communiquées par Léo', ?)");
    const insertPositionSnapshot = databaseInstance.prepare(`INSERT INTO position_snapshots
      (id,position_id,snapshot_date,quantity,cost_basis,market_value,currency,kind,confidence,source,created_at)
      VALUES (?, ?, ?, NULL, ?, ?, 'EUR', 'ACTUAL', 'HIGH', 'Données communiquées par Léo', ?)`);
    positions.forEach(([id, accountId, securityId, isCash, value, costBasis, notes]) => {
      insertPosition.run(id, accountId, securityId, isCash, notes);
      insertPositionSnapshot.run(`snap_${id}`, id, AS_OF_DATE, costBasis, value, now);
    });

    databaseInstance.prepare(`INSERT INTO liabilities
      (id,user_id,lender,name,principal,current_balance,annual_rate,monthly_payment,payment_count,first_payment_date,maturity_date,rate_type,kind,confidence,source,notes)
      VALUES ('lia_student', ?, 'Bpifrance', 'Prêt étudiant', 16745, 16745, 0, 284.72, 60, '2026-12-05', '2031-11-05', 'FIXED', 'ACTUAL', 'HIGH', 'Données communiquées par Léo', 'Échéancier bancaire réel à importer; écart de réconciliation ouvert.')`).run(USER_ID);
    const schedule = amortizeLoan(16745, 0, 60, 284.72);
    const insertSchedule = databaseInstance.prepare(`INSERT INTO loan_schedules
      (id,liability_id,payment_number,due_date,opening_balance,payment,interest,principal,closing_balance,kind)
      VALUES (?, 'lia_student', ?, ?, ?, ?, ?, ?, ?, 'DERIVED')`);
    schedule.forEach((row) => {
      const date = new Date(Date.UTC(2026, 11 + row.paymentNumber - 1, 5)).toISOString().slice(0, 10);
      insertSchedule.run(`loan_row_${row.paymentNumber}`, row.paymentNumber, date, row.openingBalance, row.payment, row.interest, row.principal, row.closingBalance);
    });

    const incomes = [
      ["inc_current", "Revenu net mensuel actuel", 1282, 1, AS_OF_DATE, "ACTUAL", "HIGH", "Données communiquées par Léo", null],
      ["inc_tennis", "Professeur de tennis", 130, 0, null, "USER_ASSUMPTION", "MEDIUM", "15 € × 2 h/semaine annualisé", "Date de début requise avant activation."],
      ["inc_caf", "CAF", null, 0, null, "MISSING", "UNKNOWN", "Demande prévue", "Montant et date inconnus."],
    ];
    const insertIncome = databaseInstance.prepare(`INSERT INTO income_sources
      (id,user_id,name,monthly_net,active,start_date,kind,confidence,source,effective_date,notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    incomes.forEach(([id, name, amount, active, startDate, kind, confidence, source, notes]) => insertIncome.run(id, USER_ID, name, amount, active, startDate, kind, confidence, source, startDate, notes));

    const categories = [
      ["exp_rent", "Loyer charges comprises", "Logement", 1, 1140, "ACTUAL"],
      ["exp_electricity", "Électricité", "Logement", 1, null, "MISSING"], ["exp_internet", "Internet", "Logement", 1, null, "MISSING"],
      ["exp_phone", "Téléphone", "Vie courante", 1, null, "MISSING"], ["exp_insurance", "Assurance", "Vie courante", 1, null, "MISSING"],
      ["exp_transport", "Transport", "Vie courante", 1, null, "MISSING"], ["exp_groceries", "Courses", "Vie courante", 1, null, "MISSING"],
      ["exp_restaurants", "Restaurants", "Lifestyle", 0, null, "MISSING"], ["exp_bars", "Bars", "Lifestyle", 0, null, "MISSING"],
      ["exp_clothing", "Habillement", "Lifestyle", 0, null, "MISSING"], ["exp_fragrance", "Parfums", "Lifestyle", 0, null, "MISSING"],
      ["exp_decor", "Décoration", "Lifestyle", 0, null, "MISSING"], ["exp_holidays", "Vacances", "Lifestyle", 0, null, "MISSING"],
      ["exp_gifts", "Cadeaux", "Lifestyle", 0, null, "MISSING"], ["exp_sport", "Sport", "Lifestyle", 0, null, "MISSING"],
      ["exp_subscriptions", "Abonnements", "Lifestyle", 0, null, "MISSING"], ["exp_health", "Santé", "Vie courante", 1, null, "MISSING"],
      ["exp_other", "Autres", "Autres", 0, null, "MISSING"], ["exp_income", "Revenu", "Revenus", 0, null, "MISSING"],
      ["exp_investment", "Investissement", "Épargne", 0, null, "MISSING"],
    ];
    const insertCategory = databaseInstance.prepare("INSERT INTO expense_categories VALUES (?, ?, ?, ?, ?)");
    const insertBudget = databaseInstance.prepare(`INSERT INTO budgets
      (id,user_id,category_id,lifestyle,monthly_amount,kind,confidence,source,effective_date)
      VALUES (?, ?, ?, 'COMFORTABLE', ?, ?, ?, ?, ?)`);
    categories.forEach(([id, name, groupName, essential, amount, kind]) => {
      insertCategory.run(id, USER_ID, name, groupName, essential);
      insertBudget.run(`bud_${id}`, USER_ID, id, amount, kind, kind === "ACTUAL" ? "HIGH" : "UNKNOWN", kind === "ACTUAL" ? "Données communiquées par Léo" : "À renseigner", AS_OF_DATE);
    });

    const scenarios = [
      ["scn_prudent", "Prudent", "Rendement modéré et épargne progressive", "#5b7c74", 0.035, 0.10, 0.025, 150, 0.02, 0.02, null, null],
      ["scn_central", "Central", "Trajectoire de référence modifiable", "#31676f", 0.055, 0.15, 0.02, 250, 0.035, 0.025, null, null],
      ["scn_ambitious", "Ambitieux", "Progression de carrière et épargne soutenues", "#3157a4", 0.07, 0.18, 0.02, 500, 0.055, 0.025, null, null],
      ["scn_stress", "Stress", "Chômage et choc de marché en année 2", "#a84f45", 0.025, 0.24, 0.035, 0, 0.01, 0.05, 2, -0.35],
      ["scn_favorable", "Très favorable", "Forte progression sans être traitée comme certitude", "#80643a", 0.085, 0.20, 0.018, 750, 0.07, 0.02, null, null],
    ];
    const insertScenario = databaseInstance.prepare(`INSERT INTO scenarios
      (id,user_id,name,description,color,current_version,annual_return,annual_volatility,annual_inflation,monthly_savings,salary_growth,stress_probability,shock_year,shock_magnitude,kind,confidence,created_at,updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'MODEL_ASSUMPTION', 'MEDIUM', ?, ?)`);
    scenarios.forEach((entry) => insertScenario.run(entry[0], USER_ID, ...entry.slice(1), now, now));
    const scenarioRows = databaseInstance.prepare("SELECT * FROM scenarios").all() as SqlRow[];
    const insertVersion = databaseInstance.prepare("INSERT INTO scenario_versions VALUES (?, ?, 1, ?, ?)");
    scenarioRows.forEach((row) => insertVersion.run(`ver_${row.id}_1`, row.id, JSON.stringify(row), now));

    const assumptions = [
      ["asm_variable", "Variable annuel central premier CDI", null, 9000, "EUR/an", "MODEL_ASSUMPTION", "LOW", "Milieu de la fourchette 3–15 k€", "À remplacer par une offre réelle."],
      ["asm_salary", "Fixe annuel brut central premier CDI", null, 42000, "EUR/an", "USER_ASSUMPTION", "MEDIUM", "Brief utilisateur", null],
      ["asm_emergency", "Réserve cible", null, 4.5, "mois essentiels", "MODEL_ASSUMPTION", "LOW", "Score de stabilité initial", "Recalculable après historique de dépenses."],
      ["asm_risk", "Comportement en baisse de 35 %", "Conserver et continuer à investir", null, "texte", "USER_ASSUMPTION", "HIGH", "Déclaration utilisateur", null],
      ["asm_tax", "Fiscalité française", "Architecture prête, règles 2026 à vérifier", null, "texte", "MODEL_ASSUMPTION", "LOW", "Aucune règle fiscale non vérifiée appliquée", "Ne constitue pas un conseil fiscal."],
    ];
    const insertAssumption = databaseInstance.prepare(`INSERT INTO economic_assumptions
      (id,user_id,name,value_text,value_number,unit,kind,confidence,source,effective_date,updated_at,notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    assumptions.forEach((entry) => insertAssumption.run(entry[0], USER_ID, entry[1], entry[2], entry[3], entry[4], entry[5], entry[6], entry[7], AS_OF_DATE, now, entry[8]));

    databaseInstance.prepare("INSERT INTO tax_profiles VALUES ('tax_leo', ?, 'FR', 'INDIVIDUAL', ?)").run(USER_ID, AS_OF_DATE);
    databaseInstance.prepare(`INSERT INTO tax_rules VALUES
      ('tax_rule_placeholder','FR','Barème IR à confirmer avant calcul',2026,NULL,'paramétrique','https://www.impots.gouv.fr',NULL,'MISSING','UNKNOWN')` ).run();

    const alerts = [
      ["alert_loan", "HIGH", "Écart sur le prêt étudiant", "60 × 284,72 € = 17 083,20 €, soit 338,20 € au-dessus du capital annoncé. Échéancier bancaire requis."],
      ["alert_pea", "MEDIUM", "Écart de composition du PEA", "ETF 8 698,00 € + cash 6 304,57 € = 15 002,57 €, soit 0,56 € sous le total annoncé."],
      ["alert_expenses", "MEDIUM", "Cash flow incomplet", "Seul le loyer est renseigné. Les taux d’épargne et la réserve cible sont provisoires."],
      ["alert_liquidity", "HIGH", "Liquidité bancaire très faible", "354,08 € couvrent environ 0,31 mois du seul loyer observé."],
    ];
    const insertAlert = databaseInstance.prepare("INSERT INTO alerts VALUES (?, ?, ?, ?, ?, 'OPEN', ?)");
    alerts.forEach((entry) => insertAlert.run(entry[0], USER_ID, entry[1], entry[2], entry[3], now));
    const goals = [["goal_100k", "Premier palier patrimonial", 100000, "2032-12-31", 1, "ACTIVE"], ["goal_fund", "Réserve de sécurité cible", 5130, null, 2, "ACTIVE"]];
    const insertGoal = databaseInstance.prepare("INSERT INTO goals VALUES (?, ?, ?, ?, ?, ?, ?)");
    goals.forEach((entry) => insertGoal.run(entry[0], USER_ID, entry[1], entry[2], entry[3], entry[4], entry[5]));
    databaseInstance.exec("COMMIT");
  } catch (error) {
    databaseInstance.exec("ROLLBACK");
    throw error;
  }
}

function getAccounts(): FinancialAccount[] {
  const rows = db().prepare(`SELECT a.*, i.name AS institution, b.balance, b.balance_date
    FROM financial_accounts a JOIN institutions i ON i.id=a.institution_id
    JOIN account_balances b ON b.id=(SELECT id FROM account_balances WHERE account_id=a.id ORDER BY balance_date DESC, created_at DESC LIMIT 1)
    WHERE a.user_id=? AND a.status='ACTIVE' ORDER BY CASE a.account_type WHEN 'BANK' THEN 1 WHEN 'SAVINGS' THEN 2 WHEN 'PEA' THEN 3 ELSE 4 END, a.name`).all(USER_ID) as SqlRow[];
  return rows.map((row) => ({
    id: String(row.id), institutionId: String(row.institution_id), institution: String(row.institution), name: String(row.name),
    type: String(row.account_type) as FinancialAccount["type"], currency: String(row.currency), balance: Number(row.balance), balanceDate: String(row.balance_date),
    liquidity: String(row.liquidity) as FinancialAccount["liquidity"], provenance: provenance(row),
  }));
}

function getPositions(): Position[] {
  const rows = db().prepare(`SELECT p.*, s.name security_name,s.ticker,s.currency,ac.name asset_class,ps.quantity,ps.cost_basis,ps.market_value
    FROM positions p JOIN securities s ON s.id=p.security_id JOIN asset_classes ac ON ac.id=s.asset_class_id
    JOIN position_snapshots ps ON ps.id=(SELECT id FROM position_snapshots WHERE position_id=p.id ORDER BY snapshot_date DESC, created_at DESC LIMIT 1)
    JOIN financial_accounts a ON a.id=p.account_id WHERE a.user_id=? ORDER BY ps.market_value DESC`).all(USER_ID) as SqlRow[];
  return rows.map((row) => ({
    id: String(row.id), accountId: String(row.account_id), securityName: String(row.security_name), ticker: row.ticker ? String(row.ticker) : undefined,
    assetClass: String(row.asset_class), quantity: row.quantity === null ? undefined : Number(row.quantity), costBasis: row.cost_basis === null ? undefined : Number(row.cost_basis),
    value: Number(row.market_value), currency: String(row.currency), isCash: Boolean(row.is_cash), provenance: provenance(row),
  }));
}

function getLiabilities(): Liability[] {
  return (db().prepare("SELECT * FROM liabilities WHERE user_id=?").all(USER_ID) as SqlRow[]).map((row) => ({
    id: String(row.id), name: String(row.name), lender: String(row.lender), principal: Number(row.principal), currentBalance: Number(row.current_balance), annualRate: Number(row.annual_rate),
    monthlyPayment: Number(row.monthly_payment), paymentCount: Number(row.payment_count), firstPaymentDate: String(row.first_payment_date), maturityDate: String(row.maturity_date), provenance: provenance(row),
  }));
}

function getIncomes(): IncomeSource[] {
  return (db().prepare("SELECT * FROM income_sources WHERE user_id=? ORDER BY active DESC, name").all(USER_ID) as SqlRow[]).map((row) => ({
    id: String(row.id), name: String(row.name), monthlyNet: row.monthly_net === null ? null : Number(row.monthly_net), active: Boolean(row.active), startDate: row.start_date ? String(row.start_date) : null, provenance: provenance(row),
  }));
}

function getExpenses(): ExpenseCategory[] {
  return (db().prepare(`SELECT c.*,b.monthly_amount,b.kind,b.confidence,b.source,b.effective_date FROM expense_categories c
    JOIN budgets b ON b.category_id=c.id AND b.user_id=c.user_id AND b.lifestyle='COMFORTABLE' WHERE c.user_id=? ORDER BY c.group_name,c.name`).all(USER_ID) as SqlRow[]).map((row) => ({
      id: String(row.id), name: String(row.name), groupName: String(row.group_name), monthlyAmount: row.monthly_amount === null ? null : Number(row.monthly_amount), essential: Boolean(row.essential), provenance: provenance(row),
    }));
}

function getTransactions(): Transaction[] {
  // Bornage par date et non par nombre de lignes : la fenêtre affichée et calculée doit
  // être lue en entier, sinon le graphique 6 mois et les taux de flux deviennent faux
  // sans aucun avertissement.
  return (db().prepare(`SELECT t.*,a.name account_name,c.name category_name FROM transactions t JOIN financial_accounts a ON a.id=t.account_id
    JOIN expense_categories c ON c.id=t.category_id WHERE t.user_id=? AND t.transaction_date>=? ORDER BY t.transaction_date DESC,t.created_at DESC`).all(USER_ID, ledgerWindowStart(AS_OF_DATE)) as SqlRow[]).map((row) => ({
      id: String(row.id), accountId: String(row.account_id), accountName: String(row.account_name), date: String(row.transaction_date), label: String(row.label), categoryId: String(row.category_id), categoryName: String(row.category_name), amount: Number(row.amount), currency: String(row.currency), provenance: provenance(row),
    }));
}

function getScenarios(): Scenario[] {
  return (db().prepare("SELECT * FROM scenarios WHERE user_id=? ORDER BY CASE name WHEN 'Prudent' THEN 1 WHEN 'Central' THEN 2 WHEN 'Ambitieux' THEN 3 WHEN 'Stress' THEN 4 ELSE 5 END").all(USER_ID) as SqlRow[]).map((row) => ({
    id: String(row.id), name: String(row.name), description: String(row.description), version: Number(row.current_version), color: String(row.color), annualReturn: Number(row.annual_return), annualVolatility: Number(row.annual_volatility), annualInflation: Number(row.annual_inflation), monthlySavings: Number(row.monthly_savings), salaryGrowth: Number(row.salary_growth), stressProbability: Number(row.stress_probability), shockYear: row.shock_year === null ? null : Number(row.shock_year), shockMagnitude: row.shock_magnitude === null ? null : Number(row.shock_magnitude), provenance: provenance(row),
  }));
}

function readDashboardState(): DashboardState {
  const accounts = getAccounts();
  const positions = getPositions();
  const liabilities = getLiabilities();
  const incomes = getIncomes();
  const expenseCategories = getExpenses();
  const scenarios = getScenarios();
  const transactions = getTransactions();
  const goals = (db().prepare("SELECT * FROM goals WHERE user_id=? ORDER BY priority").all(USER_ID) as SqlRow[]).map((row) => ({ id: String(row.id), name: String(row.name), targetAmount: Number(row.target_amount), targetDate: row.target_date ? String(row.target_date) : null, priority: Number(row.priority), status: String(row.status) as Goal["status"] }));
  const alerts = (db().prepare("SELECT * FROM alerts WHERE user_id=? AND status='OPEN' ORDER BY CASE severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END").all(USER_ID) as SqlRow[]).map((row) => ({ id: String(row.id), severity: String(row.severity) as Alert["severity"], title: String(row.title), detail: String(row.detail), status: String(row.status) as Alert["status"], createdAt: String(row.created_at) }));
  const monthlyCloses = (db().prepare("SELECT * FROM monthly_closes WHERE user_id=? ORDER BY close_date DESC").all(USER_ID) as SqlRow[]).map((row) => ({ id: String(row.id), closeDate: String(row.close_date), grossAssets: Number(row.gross_assets), debt: Number(row.debt), netWorth: Number(row.net_worth), forecastNetWorth: row.forecast_net_worth === null ? null : Number(row.forecast_net_worth), variance: row.variance === null ? null : Number(row.variance), createdAt: String(row.created_at) }));
  const documents = (db().prepare("SELECT * FROM documents WHERE user_id=? ORDER BY uploaded_at DESC").all(USER_ID) as SqlRow[]).map((row) => ({ id: String(row.id), name: String(row.name), category: String(row.category), size: Number(row.size_bytes), uploadedAt: String(row.uploaded_at), status: String(row.status) as DocumentRecord["status"] }));
  const assumptions = (db().prepare("SELECT * FROM economic_assumptions WHERE user_id=? ORDER BY name").all(USER_ID) as SqlRow[]).map((row) => ({ id: String(row.id), name: String(row.name), value: row.value_number === null ? row.value_text === null ? null : String(row.value_text) : Number(row.value_number), unit: String(row.unit), provenance: provenance(row) }));
  return { asOfDate: AS_OF_DATE, reportingCurrency: REPORTING_CURRENCY, accounts, positions, liabilities, incomes, expenseCategories, transactions, scenarios, goals, alerts, monthlyCloses, documents, metrics: deriveMetrics(accounts, liabilities, incomes, expenseCategories, positions, transactions, AS_OF_DATE), assumptions };
}

function applyMutation(mutation: Mutation) {
  const databaseInstance = db();
  const now = new Date().toISOString();
  databaseInstance.exec("BEGIN IMMEDIATE");
  try {
    switch (mutation.action) {
      case "update_account":
        databaseInstance.prepare("INSERT INTO account_balances VALUES (?, ?, ?, ?, 'ACTUAL', 'HIGH', 'Saisie manuelle', ?)").run(randomUUID(), mutation.accountId, mutation.balance, mutation.balanceDate, now);
        break;
      case "add_account": { 
        const institutionId = `ins_${randomUUID()}`;
        const accountId = `acc_${randomUUID()}`;
        databaseInstance.prepare("INSERT INTO institutions(id,name,country_code) VALUES (?,?,'FR')").run(institutionId, mutation.institution);
        databaseInstance.prepare(`INSERT INTO financial_accounts (id,user_id,institution_id,name,account_type,currency,liquidity,status,kind,confidence,source,effective_date)
          VALUES (?,?,?,?,?,?,?,'ACTIVE','ACTUAL','HIGH','Saisie manuelle',?)`).run(accountId, USER_ID, institutionId, mutation.name, mutation.accountType, mutation.currency, mutation.accountType === "BANK" || mutation.accountType === "SAVINGS" ? "IMMEDIATE" : "LIQUID", AS_OF_DATE);
        databaseInstance.prepare("INSERT INTO account_balances VALUES (?, ?, ?, ?, 'ACTUAL', 'HIGH', 'Saisie manuelle', ?)").run(randomUUID(), accountId, mutation.balance, AS_OF_DATE, now);
        break;
      }
      case "add_transaction": {
        databaseInstance.prepare(`INSERT INTO transactions (id,user_id,account_id,category_id,transaction_date,label,amount,currency,kind,confidence,source,created_at)
          VALUES (?,?,?,?,?,?,?,'EUR','ACTUAL','HIGH','Saisie manuelle',?)`).run(`txn_${randomUUID()}`, USER_ID, mutation.accountId, mutation.categoryId, mutation.date, mutation.label, mutation.amount, now);
        if (mutation.updateBalance) {
          const latest = databaseInstance.prepare("SELECT balance, balance_date FROM account_balances WHERE account_id=? ORDER BY balance_date DESC,created_at DESC LIMIT 1").get(mutation.accountId) as { balance: number; balance_date: string } | undefined;
          if (!latest) throw new Error("Aucun solde connu pour ce compte");
          // Un snapshot de solde daté est la vérité du compte à cette date : il contient
          // déjà les mouvements antérieurs. Une transaction plus ancienne enrichit donc le
          // ledger sans toucher au solde observé, sinon elle serait comptée deux fois.
          if (shouldDeriveBalance(mutation.date, latest.balance_date)) {
            databaseInstance.prepare("INSERT INTO account_balances VALUES (?, ?, ?, ?, 'DERIVED', 'HIGH', 'Transaction saisie', ?)").run(randomUUID(), mutation.accountId, latest.balance + mutation.amount, mutation.date, now);
          }
        }
        break;
      }
      case "update_expense":
        databaseInstance.prepare("UPDATE budgets SET monthly_amount=?,kind='USER_ASSUMPTION',confidence='HIGH',source='Saisie manuelle',effective_date=? WHERE user_id=? AND category_id=? AND lifestyle='COMFORTABLE'").run(mutation.monthlyAmount, AS_OF_DATE, USER_ID, mutation.categoryId);
        break;
      case "update_scenario": {
        const existing = databaseInstance.prepare("SELECT * FROM scenarios WHERE id=? AND user_id=?").get(mutation.scenarioId, USER_ID) as SqlRow | undefined;
        if (!existing) throw new Error("Scenario not found");
        const allowed = ["annualReturn", "annualVolatility", "annualInflation", "monthlySavings", "salaryGrowth", "stressProbability", "shockYear", "shockMagnitude"] as const;
        const columns: Record<(typeof allowed)[number], string> = { annualReturn: "annual_return", annualVolatility: "annual_volatility", annualInflation: "annual_inflation", monthlySavings: "monthly_savings", salaryGrowth: "salary_growth", stressProbability: "stress_probability", shockYear: "shock_year", shockMagnitude: "shock_magnitude" };
        const entries = allowed.filter((key) => mutation.patch[key] !== undefined);
        if (entries.length) {
          const version = Number(existing.current_version) + 1;
          const params = entries.map((key) => mutation.patch[key] as number | null);
          databaseInstance.prepare(`UPDATE scenarios SET ${entries.map((key) => `${columns[key]}=?`).join(",")},current_version=?,kind='USER_ASSUMPTION',confidence='HIGH',updated_at=? WHERE id=?`).run(...params, version, now, mutation.scenarioId);
          const updated = databaseInstance.prepare("SELECT * FROM scenarios WHERE id=?").get(mutation.scenarioId);
          databaseInstance.prepare("INSERT INTO scenario_versions VALUES (?,?,?,?,?)").run(randomUUID(), mutation.scenarioId, version, JSON.stringify(updated), now);
        }
        break;
      }
      case "duplicate_scenario": {
        const source = databaseInstance.prepare("SELECT * FROM scenarios WHERE id=? AND user_id=?").get(mutation.scenarioId, USER_ID) as SqlRow | undefined;
        if (!source) throw new Error("Scenario not found");
        const id = `scn_${randomUUID()}`;
        databaseInstance.prepare(`INSERT INTO scenarios (id,user_id,name,description,color,current_version,annual_return,annual_volatility,annual_inflation,monthly_savings,salary_growth,stress_probability,shock_year,shock_magnitude,kind,confidence,created_at,updated_at)
          VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?, 'USER_ASSUMPTION','HIGH',?,?)`).run(id, USER_ID, `${source.name} — copie`, source.description, source.color, source.annual_return, source.annual_volatility, source.annual_inflation, source.monthly_savings, source.salary_growth, source.stress_probability, source.shock_year, source.shock_magnitude, now, now);
        const copied = databaseInstance.prepare("SELECT * FROM scenarios WHERE id=?").get(id);
        databaseInstance.prepare("INSERT INTO scenario_versions VALUES (?,?,?,?,?)").run(randomUUID(), id, 1, JSON.stringify(copied), now);
        break;
      }
      case "create_monthly_close": {
        const state = readDashboardState();
        const prior = state.monthlyCloses[0];
        const forecast = prior?.netWorth ?? null;
        const variance = forecast === null ? null : state.metrics.netWorth - forecast;
        databaseInstance.prepare(`INSERT OR REPLACE INTO monthly_closes VALUES (?,?,?,?,?,?,?,?,?)`).run(`close_${mutation.closeDate}`, USER_ID, mutation.closeDate, state.metrics.grossAssets, state.metrics.debt, state.metrics.netWorth, forecast, variance, now);
        databaseInstance.prepare("INSERT INTO net_worth_snapshots VALUES (?, ?, ?, ?, ?, ?, 'ACTUAL', ?)").run(randomUUID(), USER_ID, mutation.closeDate, state.metrics.grossAssets, state.metrics.debt, state.metrics.netWorth, now);
        break;
      }
      case "add_goal":
        databaseInstance.prepare("INSERT INTO goals VALUES (?, ?, ?, ?, ?, 99, 'ACTIVE')").run(`goal_${randomUUID()}`, USER_ID, mutation.name, mutation.targetAmount, mutation.targetDate);
        break;
    }
    databaseInstance.exec("COMMIT");
  } catch (error) {
    databaseInstance.exec("ROLLBACK");
    throw error;
  }
  return readDashboardState();
}

function addDocument(record: { name: string; category: string; storagePath: string; size: number }): DocumentRecord {
  const id = `doc_${randomUUID()}`;
  const uploadedAt = new Date().toISOString();
  db().prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, 'INBOX', ?)").run(id, USER_ID, record.name, record.category, record.storagePath, record.size, uploadedAt);
  return { id, name: record.name, category: record.category, size: record.size, uploadedAt, status: "INBOX" };
}

function persistSimulation(run: SimulationRun) {
  const databaseInstance = db();
  const runId = `sim_${randomUUID()}`;
  const now = new Date().toISOString();
  databaseInstance.exec("BEGIN IMMEDIATE");
  try {
    databaseInstance.prepare("INSERT INTO simulation_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(runId, USER_ID, run.scenarioId, run.seed, run.simulations, run.years, run.methodology, now);
    const insert = databaseInstance.prepare("INSERT INTO simulation_results VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    run.points.forEach((point) => insert.run(randomUUID(), runId, point.year, point.p10, point.p25, point.p50, point.p75, point.p90));
    databaseInstance.exec("COMMIT");
  } catch (error) {
    databaseInstance.exec("ROLLBACK");
    throw error;
  }
  return runId;
}

const UPLOAD_DIRECTORY = path.join(process.cwd(), "data", "uploads");

export function createLocalRepository(): FamilyOfficeRepository {
  return {
    adapter: "local",
    async getDashboardState() {
      return readDashboardState();
    },
    async mutateState(mutation: Mutation) {
      return applyMutation(mutation);
    },
    async storeDocument(upload: DocumentUpload) {
      await mkdir(UPLOAD_DIRECTORY, { recursive: true });
      const extension = path.extname(upload.name).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 8);
      const storageName = `${randomUUID()}${extension}`;
      await writeFile(path.join(UPLOAD_DIRECTORY, storageName), upload.bytes, { flag: "wx" });
      return addDocument({ name: upload.name, category: upload.category, storagePath: storageName, size: upload.size });
    },
    async saveSimulation(run: SimulationRun) {
      return persistSimulation(run);
    },
  };
}
