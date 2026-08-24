export type DataKind =
  "ACTUAL" | "USER_ASSUMPTION" | "MODEL_ASSUMPTION" | "EXTERNAL_DATA" | "DERIVED" | "MISSING";
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

/**
 * Nature économique canonique d'un flux. C'est ce champ, jamais le signe du montant ni le
 * libellé français de la catégorie, qui détermine comment un mouvement est agrégé.
 */
export type CashFlowKind =
  | "INCOME"
  | "EXPENSE"
  | "INTERNAL_TRANSFER"
  | "INVESTMENT"
  | "SAVING"
  | "DEBT_SERVICE"
  | "TAX"
  | "REFUND"
  | "OTHER_INFLOW"
  | "OTHER_OUTFLOW"
  | "UNCLASSIFIED";

export const CASH_FLOW_KINDS: CashFlowKind[] = [
  "INCOME",
  "EXPENSE",
  "INTERNAL_TRANSFER",
  "INVESTMENT",
  "SAVING",
  "DEBT_SERVICE",
  "TAX",
  "REFUND",
  "OTHER_INFLOW",
  "OTHER_OUTFLOW",
  "UNCLASSIFIED",
];

export type Essentiality = "ESSENTIAL" | "NON_ESSENTIAL" | "UNKNOWN";
export type ExpenseBehavior = "FIXED" | "VARIABLE" | "DISCRETIONARY" | "UNKNOWN";

export interface ExpenseCategory {
  id: string;
  name: string;
  groupName: string;
  /** Nature canonique des flux portés par cette catégorie. */
  cashFlowKind: CashFlowKind;
  essentiality: Essentiality;
  behavior: ExpenseBehavior;
  monthlyAmount: number | null;
  /** Dérivé de `essentiality`. Conservé pour les consommateurs existants, jamais stocké. */
  essential: boolean;
  archived: boolean;
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
  /** Montant signé : négatif pour une sortie. Le signe ne détermine jamais la nature. */
  amount: number;
  currency: string;
  /**
   * Nature imposée à cette transaction seule, prioritaire sur celle de sa catégorie.
   * Sert notamment à marquer un mouvement comme transfert interne.
   */
  kindOverride: CashFlowKind | null;
  /** Rapproche les deux jambes d'un même transfert interne. */
  transferGroupId: string | null;
  notes: string | null;
  provenance: Provenance;
}

export type RecurrenceFrequency = "MONTHLY" | "QUARTERLY" | "ANNUAL";

/**
 * Règle de flux récurrent, persistée et traçable. Aucune récurrence n'est jamais déduite
 * en silence d'un historique : elle est créée explicitement et porte sa provenance.
 */
export interface RecurringCashFlowRule {
  id: string;
  name: string;
  cashFlowKind: CashFlowKind;
  categoryId: string;
  categoryName: string;
  accountId: string | null;
  /** Montant signé d'une occurrence. */
  amount: number;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string | null;
  /** Jour d'exigibilité. À défaut, le jour de `startDate`. */
  dayOfMonth: number | null;
  active: boolean;
  provenance: Provenance;
}

/** Clôture mensuelle du périmètre Cash Flow. Versionnée, jamais écrasée en silence. */
export interface CashFlowMonthlyClose {
  id: string;
  /** Mois clôturé, au format AAAA-MM. */
  month: string;
  version: number;
  income: number;
  consumerExpenses: number;
  essentialExpenses: number;
  taxesPaid: number;
  debtServicePaid: number;
  investmentFlows: number;
  internalTransfers: number;
  operatingSurplusBeforeDebt: number;
  postDebtSurplus: number;
  unclassifiedTransactionCount: number;
  closedAt: string;
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
  /**
   * Surplus mensuel AVANT service de dette : après revenus, fiscalité et dépenses de vie,
   * mais avant intérêts, principal, assurance et frais de prêt. La colonne persistée garde
   * son nom historique `monthly_savings`.
   */
  monthlySavings: number;
  /** Part du surplus post-dette dirigée vers les actifs de marché, entre 0 et 1. */
  investmentAllocationRate: number;
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
  recurringRules: RecurringCashFlowRule[];
  cashFlowCloses: CashFlowMonthlyClose[];
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
  /** Percentiles du PATRIMOINE NET financier, année par année. */
  points: ProjectionPoint[];
  methodology: string;
}

/** Point annuel réduit depuis le déroulé mensuel. Aucun calcul annuel parallèle. */
export interface AnnualBalanceSheetPoint {
  year: number;
  monthIndex: number;
  grossFinancialAssets: number;
  debt: number;
  fundingGap: number;
  netWorth: number;
  bankCash: number;
  marketInvestedAssets: number;
  cumulativeOperatingSurplus: number;
  cumulativeMarketPnL: number;
  cumulativeInterestPaid: number;
  cumulativePrincipalPaid: number;
  /** Vrai dès qu'un besoin de financement est apparu : la trajectoire est partielle. */
  financingCostMissing: boolean;
}

export interface ProjectionEnvelope extends ProjectionResult {
  /** Trajectoire déterministe issue de la même transition mensuelle. */
  deterministic: AnnualBalanceSheetPoint[];
  openingNetWorth: number;
  assumptions: {
    operatingSurplusBeforeDebt: number;
    investmentAllocationRate: number;
    annualReturn: number;
  };
}
