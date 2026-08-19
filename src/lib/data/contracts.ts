// Contrats de la couche données. Aucun import serveur : ce module est importable
// depuis un composant client (import type) sans tirer "server-only" dans le bundle.
import type { DocumentRecord, FinancialAccount, Scenario } from "@/lib/types";

export type Mutation =
  | { action: "update_account"; accountId: string; balance: number; balanceDate: string }
  | { action: "add_account"; institution: string; name: string; accountType: FinancialAccount["type"]; balance: number; currency: string }
  | { action: "add_transaction"; accountId: string; categoryId: string; date: string; label: string; amount: number; updateBalance: boolean }
  | { action: "update_expense"; categoryId: string; monthlyAmount: number | null }
  | { action: "update_scenario"; scenarioId: string; patch: Partial<Pick<Scenario, "annualReturn" | "annualVolatility" | "annualInflation" | "monthlySavings" | "salaryGrowth" | "stressProbability" | "shockYear" | "shockMagnitude">> }
  | { action: "duplicate_scenario"; scenarioId: string }
  | { action: "create_monthly_close"; closeDate: string }
  | { action: "add_goal"; name: string; targetAmount: number; targetDate: string | null };

export interface DocumentUpload {
  name: string;
  category: string;
  contentType: string;
  size: number;
  bytes: Uint8Array;
}

export interface SimulationRun {
  scenarioId: string;
  seed: number;
  simulations: number;
  years: number;
  methodology: string;
  points: Array<{ year: number; p10: number; p25: number; p50: number; p75: number; p90: number }>;
}

export type StoredDocument = DocumentRecord;
