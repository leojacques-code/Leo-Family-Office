export type DataKind = "ACTUAL" | "USER_ASSUMPTION" | "MODEL_ASSUMPTION" | "EXTERNAL_DATA" | "DERIVED" | "MISSING";
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface Provenance {
  kind: DataKind;
  source?: string;
  effectiveDate?: string;
  updatedAt?: string;
  confidence: Confidence;
  notes?: string;
}

export interface FinancialAccount {
  id: string;
  institutionId: string;
  institution: string;
  name: string;
  type: "BANK" | "PEA" | "CTO" | "SAVINGS" | "OTHER";
  currency: string;
  balance: number;
  balanceDate: string;
  liquidity: "IMMEDIATE" | "LIQUID" | "ILLIQUID";
  provenance: Provenance;
}

export interface Position {
  id: string;
  accountId: string;
  securityName: string;
  ticker?: string;
  assetClass: string;
  quantity?: number;
  costBasis?: number;
  value: number;
  currency: string;
  isCash: boolean;
  provenance: Provenance;
}

export interface Liability {
  id: string;
  name: string;
  lender: string;
  principal: number;
  currentBalance: number;
  annualRate: number;
  monthlyPayment: number;
  paymentCount: number;
  firstPaymentDate: string;
  maturityDate: string;
  provenance: Provenance;
}

export interface LoanScheduleEntry {
  liabilityId: string;
  paymentNumber: number;
  /** Date d'exigibilité réelle de l'échéance. */
  dueDate: string;
  openingBalance: number;
  interest: number;
  principal: number;
  insurance: number;
  fees: number;
  /** Ce qui sort réellement du compte : interest + principal + insurance + fees. */
  totalCashOut: number;
  closingBalance: number;
  kind: DataKind;
}

export interface IncomeSource {
  id: string;
  name: string;
  monthlyNet: number | null;
  active: boolean;
  startDate: string | null;
  provenance: Provenance;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  groupName: string;
  monthlyAmount: number | null;
  essential: boolean;
  provenance: Provenance;
}

export interface Transaction {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  label: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  currency: string;
  provenance: Provenance;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  version: number;
  color: string;
  annualReturn: number;
  annualVolatility: number;
  annualInflation: number;
  monthlySavings: number;
  salaryGrowth: number;
  stressProbability: number;
  shockYear: number | null;
  shockMagnitude: number | null;
  provenance: Provenance;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  priority: number;
  status: "ACTIVE" | "ACHIEVED" | "PAUSED";
}

export interface Alert {
  id: string;
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  detail: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
}

export interface MonthlyClose {
  id: string;
  closeDate: string;
  grossAssets: number;
  debt: number;
  netWorth: number;
  forecastNetWorth: number | null;
  variance: number | null;
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  name: string;
  category: string;
  size: number;
  uploadedAt: string;
  status: "INBOX" | "CLASSIFIED";
}

export interface DashboardMetrics {
  grossAssets: number;
  debt: number;
  netWorth: number;
  bankCash: number;
  /** Actifs mobilisables : comptes dont la liquidité n'est pas ILLIQUID. */
  liquidAssets: number;
  /** LiquidAssets − dettes. Peut être négatif sans que le patrimoine net le soit. */
  liquidNetWorth: number;
  investedAssets: number;
  productiveNetWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyDebtService: number;
  freeCashFlow: number;
  /** Flux constatés au ledger. `null` = non calculable faute de flux observés. */
  savingsRate: number | null;
  investmentRate: number | null;
  emergencyCoverageMonths: number;
  dataCompleteness: number;
}

export interface DashboardState {
  asOfDate: string;
  reportingCurrency: string;
  accounts: FinancialAccount[];
  positions: Position[];
  liabilities: Liability[];
  incomes: IncomeSource[];
  expenseCategories: ExpenseCategory[];
  transactions: Transaction[];
  scenarios: Scenario[];
  goals: Goal[];
  alerts: Alert[];
  monthlyCloses: MonthlyClose[];
  documents: DocumentRecord[];
  metrics: DashboardMetrics;
  assumptions: Array<{
    id: string;
    name: string;
    value: number | string | null;
    unit: string;
    provenance: Provenance;
  }>;
}

export interface ProjectionPoint {
  year: number;
  age: number;
  deterministic?: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface ProjectionResult {
  scenarioId: string;
  seed: number;
  simulations: number;
  points: ProjectionPoint[];
  methodology: string;
}
