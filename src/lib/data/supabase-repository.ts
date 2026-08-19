import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, ownerId, supabaseAdmin } from "@/lib/data/supabase-client";
import {
  ACCOUNT_TYPE_ORDER,
  ALERT_SEVERITY_ORDER,
  AS_OF_DATE,
  REPORTING_CURRENCY,
  SCENARIO_NAME_ORDER,
  deriveMetrics,
} from "@/lib/data/shared";
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
  MonthlyClose,
  Position,
  Provenance,
  Scenario,
  Transaction,
} from "@/lib/types";

type Row = Record<string, unknown>;

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, context: string): T {
  if (result.error) throw new Error(`Supabase ${context} : ${result.error.message}`);
  if (result.data === null) throw new Error(`Supabase ${context} : réponse vide`);
  return result.data;
}

const str = (value: unknown): string => String(value ?? "");
const optional = (value: unknown): string | undefined => (value === null || value === undefined ? undefined : String(value));
const num = (value: unknown): number => Number(value ?? 0);
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const bool = (value: unknown): boolean => value === true || value === 1 || value === "true";

function provenance(row: Row): Provenance {
  return {
    kind: str(row.data_kind) as Provenance["kind"],
    confidence: str(row.confidence) as Provenance["confidence"],
    source: optional(row.source),
    effectiveDate: optional(row.effective_date),
    updatedAt: optional(row.updated_at),
    notes: optional(row.notes),
  };
}

/** Dernière ligne d'un historique, par date puis created_at décroissants. */
function latestBy<T extends Row>(rows: T[], key: string, dateField: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = str(row[key]);
    const current = map.get(id);
    if (!current) {
      map.set(id, row);
      continue;
    }
    const newer = str(row[dateField]) > str(current[dateField])
      || (str(row[dateField]) === str(current[dateField]) && str(row.created_at) > str(current.created_at));
    if (newer) map.set(id, row);
  }
  return map;
}

const SCENARIO_COLUMNS: Record<string, string> = {
  annualReturn: "annual_return",
  annualVolatility: "annual_volatility",
  annualInflation: "annual_inflation",
  monthlySavings: "monthly_savings",
  salaryGrowth: "salary_growth",
  stressProbability: "stress_probability",
  shockYear: "shock_year",
  shockMagnitude: "shock_magnitude",
};

function mapScenario(row: Row): Scenario {
  return {
    id: str(row.id), name: str(row.name), description: str(row.description), version: num(row.current_version), color: str(row.color),
    annualReturn: num(row.annual_return), annualVolatility: num(row.annual_volatility), annualInflation: num(row.annual_inflation),
    monthlySavings: num(row.monthly_savings), salaryGrowth: num(row.salary_growth), stressProbability: num(row.stress_probability),
    shockYear: numOrNull(row.shock_year), shockMagnitude: numOrNull(row.shock_magnitude), provenance: provenance(row),
  };
}

export function createSupabaseRepository(): FamilyOfficeRepository {
  const db = supabaseAdmin();
  const user = ownerId();
  const mine = (table: string) => db.from(table).select("*").eq("user_id", user);

  async function getDashboardState(): Promise<DashboardState> {
    const [
      institutionRows, accountRows, balanceRows, assetClassRows, securityRows, positionRows, snapshotRows,
      liabilityRows, incomeRows, categoryRows, budgetRows, transactionRows, scenarioRows, goalRows,
      alertRows, closeRows, documentRows, assumptionRows,
    ] = await Promise.all([
      mine("institutions"), mine("financial_accounts"), mine("account_balances"), mine("asset_classes"),
      mine("securities"), mine("positions"), mine("position_snapshots"), mine("liabilities"),
      mine("income_sources"), mine("expense_categories"), mine("budgets"),
      db.from("transactions").select("*").eq("user_id", user).order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      mine("scenarios"), mine("goals"),
      db.from("alerts").select("*").eq("user_id", user).eq("status", "OPEN"),
      mine("monthly_closes"), mine("documents"), mine("economic_assumptions"),
    ]).then((results) => results.map((result, index) => unwrap(result, `lecture #${index}`) as Row[]));

    const institutionNames = new Map(institutionRows.map((row) => [str(row.id), str(row.name)]));
    const latestBalances = latestBy(balanceRows, "account_id", "balance_date");
    const accounts: FinancialAccount[] = accountRows
      .filter((row) => str(row.status) === "ACTIVE")
      .map((row) => {
        const balance = latestBalances.get(str(row.id));
        return {
          id: str(row.id), institutionId: str(row.institution_id), institution: institutionNames.get(str(row.institution_id)) ?? "",
          name: str(row.name), type: str(row.account_type) as FinancialAccount["type"], currency: str(row.currency),
          balance: num(balance?.balance), balanceDate: balance ? str(balance.balance_date) : AS_OF_DATE,
          liquidity: str(row.liquidity) as FinancialAccount["liquidity"], provenance: provenance(row),
        };
      })
      .sort((a, b) => (ACCOUNT_TYPE_ORDER[a.type] ?? 4) - (ACCOUNT_TYPE_ORDER[b.type] ?? 4) || a.name.localeCompare(b.name));

    const assetClassNames = new Map(assetClassRows.map((row) => [str(row.id), str(row.name)]));
    const securities = new Map(securityRows.map((row) => [str(row.id), row]));
    const latestSnapshots = latestBy(snapshotRows, "position_id", "snapshot_date");
    const positions: Position[] = positionRows
      .map((row) => {
        const security = securities.get(str(row.security_id));
        const snapshot = latestSnapshots.get(str(row.id));
        return {
          id: str(row.id), accountId: str(row.account_id), securityName: security ? str(security.name) : "",
          ticker: security ? optional(security.ticker) : undefined,
          assetClass: security ? assetClassNames.get(str(security.asset_class_id)) ?? "" : "",
          quantity: snapshot ? numOrNull(snapshot.quantity) ?? undefined : undefined,
          costBasis: snapshot ? numOrNull(snapshot.cost_basis) ?? undefined : undefined,
          value: num(snapshot?.market_value), currency: snapshot ? str(snapshot.currency) : REPORTING_CURRENCY,
          isCash: bool(row.is_cash), provenance: provenance(row),
        };
      })
      .sort((a, b) => b.value - a.value);

    const liabilities: Liability[] = liabilityRows.map((row) => ({
      id: str(row.id), name: str(row.name), lender: str(row.lender), principal: num(row.principal), currentBalance: num(row.current_balance),
      annualRate: num(row.annual_rate), monthlyPayment: num(row.monthly_payment), paymentCount: num(row.payment_count),
      firstPaymentDate: str(row.first_payment_date), maturityDate: str(row.maturity_date), provenance: provenance(row),
    }));

    const incomes: IncomeSource[] = incomeRows
      .map((row) => ({
        id: str(row.id), name: str(row.name), monthlyNet: numOrNull(row.monthly_net), active: bool(row.active),
        startDate: row.start_date === null || row.start_date === undefined ? null : str(row.start_date), provenance: provenance(row),
      }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

    const budgets = new Map(budgetRows.filter((row) => str(row.lifestyle) === "COMFORTABLE").map((row) => [str(row.category_id), row]));
    const expenseCategories: ExpenseCategory[] = categoryRows
      .filter((row) => budgets.has(str(row.id)))
      .map((row) => {
        const budget = budgets.get(str(row.id)) as Row;
        return {
          id: str(row.id), name: str(row.name), groupName: str(row.group_name),
          monthlyAmount: numOrNull(budget.monthly_amount), essential: bool(row.essential), provenance: provenance(budget),
        };
      })
      .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));

    const accountNames = new Map(accountRows.map((row) => [str(row.id), str(row.name)]));
    const categoryNames = new Map(categoryRows.map((row) => [str(row.id), str(row.name)]));
    const transactions: Transaction[] = transactionRows.map((row) => ({
      id: str(row.id), accountId: str(row.account_id), accountName: accountNames.get(str(row.account_id)) ?? "",
      date: str(row.transaction_date), label: str(row.label), categoryId: str(row.category_id),
      categoryName: categoryNames.get(str(row.category_id)) ?? "", amount: num(row.amount), currency: str(row.currency),
      provenance: provenance(row),
    }));

    const scenarios: Scenario[] = scenarioRows
      .map(mapScenario)
      .sort((a, b) => (SCENARIO_NAME_ORDER[a.name] ?? 5) - (SCENARIO_NAME_ORDER[b.name] ?? 5));

    const goals: Goal[] = goalRows
      .map((row) => ({
        id: str(row.id), name: str(row.name), targetAmount: num(row.target_amount),
        targetDate: row.target_date === null || row.target_date === undefined ? null : str(row.target_date),
        priority: num(row.priority), status: str(row.status) as Goal["status"],
      }))
      .sort((a, b) => a.priority - b.priority);

    const alerts: Alert[] = alertRows
      .map((row) => ({
        id: str(row.id), severity: str(row.severity) as Alert["severity"], title: str(row.title), detail: str(row.detail),
        status: str(row.status) as Alert["status"], createdAt: str(row.created_at),
      }))
      .sort((a, b) => (ALERT_SEVERITY_ORDER[a.severity] ?? 3) - (ALERT_SEVERITY_ORDER[b.severity] ?? 3));

    const monthlyCloses: MonthlyClose[] = closeRows
      .map((row) => ({
        id: str(row.id), closeDate: str(row.close_date), grossAssets: num(row.gross_assets), debt: num(row.debt),
        netWorth: num(row.net_worth), forecastNetWorth: numOrNull(row.forecast_net_worth), variance: numOrNull(row.variance),
        createdAt: str(row.created_at),
      }))
      .sort((a, b) => b.closeDate.localeCompare(a.closeDate));

    const documents: DocumentRecord[] = documentRows
      .map((row) => ({
        id: str(row.id), name: str(row.name), category: str(row.category), size: num(row.size_bytes),
        uploadedAt: str(row.uploaded_at), status: str(row.status) as DocumentRecord["status"],
      }))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

    const assumptions = assumptionRows
      .map((row) => {
        const raw = row.value;
        const value: number | string | null = raw === null || raw === undefined ? null : typeof raw === "number" ? raw : String(raw);
        return { id: str(row.id), name: str(row.name), value, unit: str(row.unit), provenance: provenance(row) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      asOfDate: AS_OF_DATE, reportingCurrency: REPORTING_CURRENCY, accounts, positions, liabilities, incomes,
      expenseCategories, transactions, scenarios, goals, alerts, monthlyCloses, documents,
      metrics: deriveMetrics(accounts, liabilities, incomes, expenseCategories, positions), assumptions,
    };
  }

  async function mutateState(mutation: Mutation): Promise<DashboardState> {
    const now = new Date().toISOString();
    switch (mutation.action) {
      case "update_account": {
        unwrap(await db.from("account_balances").insert({
          user_id: user, account_id: mutation.accountId, balance: mutation.balance, balance_date: mutation.balanceDate,
          data_kind: "ACTUAL", confidence: "HIGH", source: "Saisie manuelle",
        }).select("id"), "insertion de solde");
        break;
      }
      case "add_account": {
        const institution = unwrap(await db.from("institutions")
          .upsert({ user_id: user, name: mutation.institution, country_code: "FR" }, { onConflict: "user_id,name" })
          .select("id").single(), "création d'établissement") as Row;
        const account = unwrap(await db.from("financial_accounts").insert({
          user_id: user, institution_id: institution.id, name: mutation.name, account_type: mutation.accountType,
          currency: mutation.currency, liquidity: mutation.accountType === "BANK" || mutation.accountType === "SAVINGS" ? "IMMEDIATE" : "LIQUID",
          status: "ACTIVE", data_kind: "ACTUAL", confidence: "HIGH", source: "Saisie manuelle", effective_date: AS_OF_DATE,
        }).select("id").single(), "création de compte") as Row;
        unwrap(await db.from("account_balances").insert({
          user_id: user, account_id: account.id, balance: mutation.balance, balance_date: AS_OF_DATE,
          data_kind: "ACTUAL", confidence: "HIGH", source: "Saisie manuelle",
        }).select("id"), "solde initial");
        break;
      }
      case "add_transaction": {
        unwrap(await db.from("transactions").insert({
          user_id: user, account_id: mutation.accountId, category_id: mutation.categoryId, transaction_date: mutation.date,
          label: mutation.label, amount: mutation.amount, currency: REPORTING_CURRENCY,
          data_kind: "ACTUAL", confidence: "HIGH", source: "Saisie manuelle",
        }).select("id"), "insertion de transaction");
        if (mutation.updateBalance) {
          const latest = unwrap(await db.from("account_balances").select("balance")
            .eq("user_id", user).eq("account_id", mutation.accountId)
            .order("balance_date", { ascending: false }).order("created_at", { ascending: false })
            .limit(1), "lecture du dernier solde") as Row[];
          if (latest.length === 0) throw new Error("Aucun solde connu pour ce compte");
          unwrap(await db.from("account_balances").insert({
            user_id: user, account_id: mutation.accountId, balance: num(latest[0].balance) + mutation.amount,
            balance_date: mutation.date, data_kind: "DERIVED", confidence: "HIGH", source: "Transaction saisie",
          }).select("id"), "solde dérivé");
        }
        break;
      }
      case "update_expense": {
        unwrap(await db.from("budgets").update({
          monthly_amount: mutation.monthlyAmount, data_kind: "USER_ASSUMPTION", confidence: "HIGH",
          source: "Saisie manuelle", effective_date: AS_OF_DATE,
        }).eq("user_id", user).eq("category_id", mutation.categoryId).eq("lifestyle", "COMFORTABLE").select("id"), "mise à jour de budget");
        break;
      }
      case "update_scenario": {
        const existing = unwrap(await db.from("scenarios").select("*").eq("user_id", user).eq("id", mutation.scenarioId).maybeSingle(), "lecture de scénario") as Row | null;
        if (!existing) throw new Error("Scenario not found");
        const patch: Row = {};
        for (const [key, column] of Object.entries(SCENARIO_COLUMNS)) {
          const value = (mutation.patch as Record<string, unknown>)[key];
          if (value !== undefined) patch[column] = value;
        }
        if (Object.keys(patch).length === 0) break;
        const version = num(existing.current_version) + 1;
        const updated = unwrap(await db.from("scenarios").update({
          ...patch, current_version: version, data_kind: "USER_ASSUMPTION", confidence: "HIGH", updated_at: now,
        }).eq("id", mutation.scenarioId).eq("user_id", user).select("*").single(), "mise à jour de scénario") as Row;
        unwrap(await db.from("scenario_versions").insert({
          user_id: user, scenario_id: mutation.scenarioId, version, payload: updated,
        }).select("id"), "versionnage de scénario");
        break;
      }
      case "duplicate_scenario": {
        const source = unwrap(await db.from("scenarios").select("*").eq("user_id", user).eq("id", mutation.scenarioId).maybeSingle(), "lecture de scénario") as Row | null;
        if (!source) throw new Error("Scenario not found");
        const copy = unwrap(await db.from("scenarios").insert({
          user_id: user, name: `${str(source.name)} — copie`, description: source.description, color: source.color, current_version: 1,
          annual_return: source.annual_return, annual_volatility: source.annual_volatility, annual_inflation: source.annual_inflation,
          monthly_savings: source.monthly_savings, salary_growth: source.salary_growth, stress_probability: source.stress_probability,
          shock_year: source.shock_year, shock_magnitude: source.shock_magnitude,
          data_kind: "USER_ASSUMPTION", confidence: "HIGH", created_at: now, updated_at: now,
        }).select("*").single(), "duplication de scénario") as Row;
        unwrap(await db.from("scenario_versions").insert({
          user_id: user, scenario_id: copy.id, version: 1, payload: copy,
        }).select("id"), "versionnage de la copie");
        break;
      }
      case "create_monthly_close": {
        const state = await getDashboardState();
        const prior = state.monthlyCloses[0];
        const forecast = prior?.netWorth ?? null;
        const variance = forecast === null ? null : state.metrics.netWorth - forecast;
        unwrap(await db.from("monthly_closes").upsert({
          user_id: user, close_date: mutation.closeDate, gross_assets: state.metrics.grossAssets, debt: state.metrics.debt,
          net_worth: state.metrics.netWorth, forecast_net_worth: forecast, variance,
        }, { onConflict: "user_id,close_date" }).select("id"), "clôture mensuelle");
        unwrap(await db.from("net_worth_snapshots").upsert({
          user_id: user, snapshot_date: mutation.closeDate, gross_assets: state.metrics.grossAssets,
          debt: state.metrics.debt, net_worth: state.metrics.netWorth, data_kind: "ACTUAL",
        }, { onConflict: "user_id,snapshot_date" }).select("id"), "photo de patrimoine");
        break;
      }
      case "add_goal": {
        unwrap(await db.from("goals").insert({
          user_id: user, name: mutation.name, target_amount: mutation.targetAmount, target_date: mutation.targetDate,
          priority: 99, status: "ACTIVE",
        }).select("id"), "création d'objectif");
        break;
      }
    }
    return getDashboardState();
  }

  async function storeDocument(upload: DocumentUpload): Promise<DocumentRecord> {
    const extension = upload.name.includes(".") ? `.${upload.name.split(".").pop()!.replace(/[^a-zA-Z0-9]/g, "").slice(0, 7)}` : "";
    const storagePath = `${user}/${crypto.randomUUID()}${extension}`;
    const uploaded = await db.storage.from(DOCUMENTS_BUCKET).upload(storagePath, upload.bytes, {
      contentType: upload.contentType, upsert: false,
    });
    if (uploaded.error) throw new Error(`Supabase stockage : ${uploaded.error.message}`);
    const row = unwrap(await db.from("documents").insert({
      user_id: user, name: upload.name, category: upload.category, storage_path: storagePath,
      size_bytes: upload.size, status: "INBOX",
    }).select("*").single(), "enregistrement de document") as Row;
    return {
      id: str(row.id), name: str(row.name), category: str(row.category), size: num(row.size_bytes),
      uploadedAt: str(row.uploaded_at), status: str(row.status) as DocumentRecord["status"],
    };
  }

  async function saveSimulation(run: SimulationRun): Promise<string> {
    const created = unwrap(await db.from("simulation_runs").insert({
      user_id: user, scenario_id: run.scenarioId, seed: run.seed, simulations: run.simulations,
      years: run.years, methodology: run.methodology,
    }).select("id").single(), "enregistrement de simulation") as Row;
    const runId = str(created.id);
    unwrap(await db.from("simulation_results").insert(run.points.map((point) => ({
      user_id: user, run_id: runId, year: point.year, p10: point.p10, p25: point.p25, p50: point.p50, p75: point.p75, p90: point.p90,
    }))).select("id"), "résultats de simulation");
    return runId;
  }

  return { adapter: "supabase", getDashboardState, mutateState, storeDocument, saveSimulation };
}
