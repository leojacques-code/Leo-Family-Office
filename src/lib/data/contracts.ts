// Contrats de la couche données. Aucun import serveur : ce module est importable
// depuis un composant client (import type) sans tirer "server-only" dans le bundle.
import type {
  CashFlowKind,
  DocumentRecord,
  LotMatchingMethod,
  PortfolioEventType,
  Essentiality,
  ExpenseBehavior,
  FinancialAccount,
  AmortisationProfile,
  DatedTermKind,
  DeferredInterestTreatment,
  DeferralKind,
  EarlyRepaymentOutcome,
  InterestConvention,
  LedgerCoverageSource,
  PaymentFrequency,
  RateType,
  RecurrenceFrequency,
  Scenario,
} from "@/lib/types";

export interface DebtContractInput {
  liabilityId: string | null;
  name: string;
  lender: string;
  principal: number;
  /** Requis uniquement à la création. Une édition de contrat l'ignore toujours. */
  initialBalance: number | null;
  balanceDate: string | null;
  annualRate: number;
  paymentAmount: number;
  paymentCount: number;
  firstPaymentDate: string;
  maturityDate: string;
  amortisationProfile: AmortisationProfile;
  balloonAmount: number | null;
  paymentFrequency: PaymentFrequency;
  interestConvention: InterestConvention;
  rateType: RateType;
  insuranceAmount: number | null;
  recurringFees: number | null;
  paymentIncludesInsurance: boolean | null;
  deferral: {
    kind: Exclude<DeferralKind, "NONE">;
    months: number;
    interestTreatment: DeferredInterestTreatment;
  } | null;
  facilityId: string | null;
  notes: string | null;
  rateSchedule: Array<{ effectiveFrom: string; annualRate: number; kind: DatedTermKind }>;
  paymentSchedule: Array<{ effectiveFrom: string; amount: number; kind: DatedTermKind }>;
  earlyRepayments: Array<{
    id: string;
    date: string;
    amount: number;
    penalty: number | null;
    outcome: EarlyRepaymentOutcome;
  }>;
  charges: Array<{ id: string; date: string; amount: number; label: string; financed: boolean }>;
  providedSchedule: Array<{
    paymentNumber: number;
    dueDate: string;
    openingBalance: number;
    interest: number;
    principal: number;
    insurance: number;
    fees: number;
    closingBalance: number;
  }>;
}

/**
 * Saisie d'un événement de ledger portefeuille.
 *
 * `securityId` désigne un instrument déjà connu ; à défaut, `security` en décrit un que
 * la RPC résout par identifiant réel (ISIN, ticker, nom) avant d'en créer un. Aucun
 * champ monétaire ne porte de valeur par défaut : `null` signifie inconnu, et le moteur
 * refusera d'en dériver un coût de revient plutôt que de le supposer nul.
 */
export interface PortfolioEventInput {
  accountId: string;
  type: PortfolioEventType;
  eventDate: string;
  settlementDate: string | null;
  securityId: string | null;
  security: {
    name: string;
    ticker: string | null;
    isin: string | null;
    currency: string | null;
    /** Rattachée seulement si une classe du même nom existe déjà. Jamais créée. */
    assetClass: string | null;
  } | null;
  quantity: number | null;
  unitPrice: number | null;
  grossAmount: number | null;
  feeAmount: number | null;
  taxAmount: number | null;
  /** Effet signé sur le cash d'enveloppe ; niveau d'ancrage sur les types d'ouverture. */
  envelopeCashAmount: number | null;
  currency: string;
  counterpartyAccountId: string | null;
  transactionId: string | null;
  matchedAcquisitionEventId: string | null;
  externalReference: string | null;
  notes: string | null;
}

export interface PortfolioEnvelopePolicyInput {
  accountId: string;
  lotMatchingMethod: LotMatchingMethod | null;
  ledgerCoverageStart: string | null;
  ledgerCoverageSource: LedgerCoverageSource | null;
  notes: string | null;
}

export type Mutation =
  | { action: "save_debt_contract"; contract: DebtContractInput }
  | {
      action: "record_debt_balance";
      liabilityId: string;
      observedAt: string;
      balance: number;
      notes: string | null;
    }
  | { action: "archive_debt"; liabilityId: string }
  | { action: "update_account"; accountId: string; balance: number; balanceDate: string }
  | {
      action: "add_account";
      institution: string;
      name: string;
      accountType: FinancialAccount["type"];
      balance: number;
      currency: string;
    }
  | {
      action: "add_transaction";
      accountId: string;
      categoryId: string;
      date: string;
      label: string;
      amount: number;
      updateBalance: boolean;
    }
  | { action: "update_expense"; categoryId: string; monthlyAmount: number | null }
  | {
      action: "update_scenario";
      scenarioId: string;
      patch: Partial<
        Pick<
          Scenario,
          | "annualReturn"
          | "annualVolatility"
          | "annualInflation"
          | "monthlySavings"
          | "investmentAllocationRate"
          | "salaryGrowth"
          | "stressProbability"
          | "shockYear"
          | "shockMagnitude"
        >
      >;
    }
  | { action: "duplicate_scenario"; scenarioId: string }
  | { action: "create_monthly_close"; closeDate: string }
  | { action: "add_goal"; name: string; targetAmount: number; targetDate: string | null }
  | {
      action: "update_category";
      categoryId: string;
      patch: Partial<{
        name: string;
        groupName: string;
        cashFlowKind: CashFlowKind;
        essentiality: Essentiality;
        behavior: ExpenseBehavior;
        archived: boolean;
      }>;
    }
  | {
      action: "add_category";
      name: string;
      groupName: string;
      cashFlowKind: CashFlowKind;
      essentiality: Essentiality;
      behavior: ExpenseBehavior;
    }
  | {
      action: "classify_transaction";
      transactionId: string;
      categoryId?: string;
      kindOverride?: CashFlowKind | null;
      transferGroupId?: string | null;
      notes?: string | null;
    }
  | {
      action: "add_recurring_rule";
      name: string;
      cashFlowKind: CashFlowKind;
      categoryId: string;
      accountId: string | null;
      amount: number;
      frequency: RecurrenceFrequency;
      startDate: string;
      endDate: string | null;
      dayOfMonth: number | null;
    }
  | {
      action: "update_recurring_rule";
      ruleId: string;
      patch: Partial<{ amount: number; active: boolean; endDate: string | null }>;
    }
  | { action: "delete_recurring_rule"; ruleId: string }
  | { action: "close_cash_flow_month"; month: string }
  | { action: "record_portfolio_event"; event: PortfolioEventInput }
  | { action: "delete_portfolio_event"; eventId: string }
  | { action: "set_portfolio_envelope_policy"; policy: PortfolioEnvelopePolicyInput }
  | {
      /**
       * Déclare, corrige ou efface la profondeur d'historique du ledger LFO.
       * `startDate: null` remet la déclaration à l'état « non déclarée ».
       */
      action: "set_ledger_coverage";
      startDate: string | null;
      source: LedgerCoverageSource;
    };

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
