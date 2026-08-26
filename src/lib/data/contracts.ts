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
  RealEstateCapitalEventType,
  RealEstateUsage,
  RealEstateValuationMethod,
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

/**
 * Identité d'un bien. Ne porte AUCUN montant : prix, valeur et loyers sont des faits
 * datés, saisis par leurs propres mutations. `propertyId` absent = création.
 */
export interface RealEstateAssetInput {
  propertyId: string | null;
  name: string;
  location: string | null;
  surfaceSqm: number | null;
  /** `null` = usage non déclaré. Jamais « OTHER » par défaut. */
  usage: RealEstateUsage | null;
  /** Dans ]0,1]. `null` = non déclarée : la valeur attribuable devient non calculable. */
  ownershipShare: number | null;
  /**
   * Le bien est-il financé par une dette ? `false` = déclaré sans dette, `true` = financé,
   * `null` = non déclaré. Absence de rattachement n'est PAS absence de dette : sans
   * déclaration, aucune métrique dépendant du financement n'est calculable.
   */
  isDebtFinanced: boolean | null;
  acquisitionDate: string | null;
  disposalDate: string | null;
  notes: string | null;
}

export interface RealEstateValuationInput {
  propertyId: string;
  valuedAt: string;
  /** Valeur du bien ENTIER, en devise native. La quote-part est appliquée par le moteur. */
  value: number;
  currency: string;
  method: RealEstateValuationMethod;
  notes: string | null;
}

export interface RealEstateCapitalEventInput {
  propertyId: string;
  type: RealEstateCapitalEventType;
  eventDate: string;
  /** Toujours positif : la direction économique vient du type. */
  amount: number;
  currency: string;
  label: string | null;
  /** Jambe de trésorerie déjà existante. Aucun flux n'est créé. */
  transactionId: string | null;
  notes: string | null;
}

/**
 * Termes d'exploitation à une date d'effet. Chaque `null` est écrit tel quel : « non
 * déclaré » est une information que la persistance ne doit pas convertir en zéro.
 */
export interface RealEstateOperatingTermsInput {
  propertyId: string;
  effectiveFrom: string;
  currency: string;
  annualGrossRent: number | null;
  vacancyRate: number | null;
  annualOperatingCharges: number | null;
  annualPropertyTax: number | null;
  annualInsurance: number | null;
  annualMaintenance: number | null;
  annualManagementFees: number | null;
  managementFeeRate: number | null;
  annualOtherCosts: number | null;
  /** Taux effectif DÉCLARÉ. `null` = aucun résultat après impôt ne sera produit. */
  effectiveIncomeTaxRate: number | null;
  notes: string | null;
}

/** Rattachement à une dette EXISTANTE. Ne crée aucun passif. */
export interface RealEstateFinancingLinkInput {
  propertyId: string;
  liabilityId: string;
  /** Dans ]0,1]. La somme des parts d'un même concours ne dépasse jamais 1. */
  allocationShare: number;
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
  | { action: "save_real_estate_asset"; asset: RealEstateAssetInput }
  | { action: "archive_real_estate_asset"; propertyId: string }
  | { action: "record_real_estate_valuation"; valuation: RealEstateValuationInput }
  | { action: "record_real_estate_capital_event"; event: RealEstateCapitalEventInput }
  | { action: "delete_real_estate_capital_event"; eventId: string }
  | { action: "set_real_estate_operating_terms"; terms: RealEstateOperatingTermsInput }
  | { action: "set_real_estate_financing_link"; link: RealEstateFinancingLinkInput }
  | { action: "delete_real_estate_financing_link"; linkId: string }
  | {
      /**
       * Rattache un flux réel à un bien, ou l'en détache avec `propertyId: null`. Aucune
       * nature canonique n'est modifiée : le domaine immobilier ne reclasse aucun flux.
       */
      action: "attribute_transaction_to_property";
      transactionId: string;
      propertyId: string | null;
    }
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
