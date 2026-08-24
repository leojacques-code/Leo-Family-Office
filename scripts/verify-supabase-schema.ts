/** Vérification read-only de la chaîne de migrations Supabase requise par le runtime. */
import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

const db = createClient(required("SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const requirements: Record<string, string[]> = {
  profiles: ["user_id", "ledger_coverage_start", "ledger_coverage_source"],
  scenarios: [
    "id",
    "investment_allocation_rate",
    "annual_return",
    "annual_volatility",
    "monthly_savings",
  ],
  expense_categories: ["id", "cash_flow_kind", "essentiality", "expense_behavior", "archived"],
  liabilities: [
    "id",
    "monthly_insurance",
    "recurring_fees",
    "payment_includes_insurance",
    "deferral_kind",
    "deferral_months",
    "deferral_interest_treatment",
    "amortisation_profile",
    "balloon_amount",
    "payment_frequency",
    "interest_convention",
    "rate_type",
    "facility_id",
  ],
  loan_schedules: ["id", "insurance", "fees"],
  loan_early_repayments: ["id", "liability_id", "amount", "penalty", "outcome"],
  loan_charges: ["id", "liability_id", "amount", "financed"],
  loan_rate_changes: ["id", "liability_id", "annual_rate", "term_kind"],
  loan_payment_changes: ["id", "liability_id", "amount", "term_kind"],
  recurring_cash_flow_rules: ["id", "cash_flow_kind", "frequency"],
  cash_flow_monthly_closes: ["id", "month", "version", "post_debt_surplus"],
  simulation_runs: ["id", "scenario_id", "seed", "simulations", "years", "methodology"],
  simulation_results: ["id", "run_id", "year", "p10", "p25", "p50", "p75", "p90"],
};

const failures: string[] = [];
for (const [table, columns] of Object.entries(requirements)) {
  const result = await db.from(table).select(columns.join(",")).limit(1);
  if (result.error) failures.push(`${table} (${columns.join(", ")}) : ${result.error.message}`);
}

if (failures.length > 0) {
  throw new Error(
    `Schéma Supabase incomplet (${failures.length} contrôle(s) en échec) :\n- ${failures.join("\n- ")}`,
  );
}

console.log(
  `Schéma Supabase vérifié en lecture seule : ${Object.keys(requirements).length} tables conformes.`,
);
