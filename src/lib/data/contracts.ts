// Contrats de la couche données. Aucun import serveur : ce module est importable
// depuis un composant client (import type) sans tirer "server-only" dans le bundle.
import type {
  BusinessAmountScope,
  BusinessBridgeItemCategory,
  BusinessBridgeStatus,
  BusinessCapitalEventType,
  BusinessCapitalHistorySource,
  BusinessDcfTerminalMethod,
  BusinessDiscountConvention,
  BusinessEbitdaAdjustmentCategory,
  BusinessMetricBasis,
  BusinessPeriodKind,
  BusinessType,
  BusinessValuationMethod,
} from "@/lib/engine/business-equity";
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
import type {
  ScenarioBaselineReference,
  ScenarioRunMode,
  ScenarioVersionDefinition,
} from "@/lib/engine/scenario-contracts";

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

export interface BusinessInput {
  businessId: string | null;
  name: string;
  legalForm: string | null;
  type: BusinessType | null;
  functionalCurrency: string | null;
  sector: string | null;
  country: string | null;
  foundedOn: string | null;
  /**
   * Couverture DÉCLARÉE de l'historique de capital. Seul `DECLARED_COMPLETE` autorise le
   * moteur à lire une absence d'événement comme un zéro, et donc à produire un MOIC.
   */
  capitalHistoryStart: string | null;
  capitalHistorySource: BusinessCapitalHistorySource;
  notes: string | null;
}

export interface BusinessOwnershipInput {
  businessId: string;
  effectiveDate: string;
  /** Dans [0,1]. Zéro est un fait : c'est une sortie totale, pas une absence. */
  legalRate: number;
  economicRate: number | null;
  votingRate: number | null;
  fullyDilutedRate: number | null;
  sharesHeld: number | null;
  sharesOutstanding: number | null;
  fullyDilutedShares: number | null;
  shareClass: string | null;
  notes: string | null;
}

export interface BusinessFinancialInput {
  businessId: string;
  periodEnd: string;
  periodStart: string | null;
  periodKind: BusinessPeriodKind;
  periodLabel: string | null;
  currency: string | null;
  revenue: number | null;
  grossProfit: number | null;
  ebitda: number | null;
  ebit: number | null;
  netIncome: number | null;
  cash: number | null;
  grossDebt: number | null;
  workingCapital: number | null;
  capex: number | null;
  depreciationAmortisation: number | null;
  interestExpense: number | null;
  taxExpense: number | null;
  freeCashFlow: number | null;
  notes: string | null;
}

/**
 * Base de valorisation. Sur une méthode DÉRIVÉE, `enterpriseValue` et `equityValue` doivent
 * rester nulles : le moteur les produit, la base ne les porte pas. La validation le refuse,
 * et la base de données aussi.
 */
export interface BusinessValuationInput {
  businessId: string;
  valuationDate: string;
  currency: string | null;
  method: BusinessValuationMethod;
  enterpriseValue: number | null;
  equityValue: number | null;
  multiple: number | null;
  multipleLow: number | null;
  multipleHigh: number | null;
  metricBasis: BusinessMetricBasis | null;
  metricPeriodEnd: string | null;
  preMoneyEquityValue: number | null;
  primaryNewMoney: number | null;
  secondaryAmount: number | null;
  investorContribution: number | null;
  preferredRightsKnown: boolean | null;
  bridgeStatus: BusinessBridgeStatus;
  source: string | null;
  notes: string | null;
}

export interface BusinessEbitdaAdjustmentInput {
  businessId: string;
  periodEnd: string;
  category: BusinessEbitdaAdjustmentCategory;
  label: string;
  /** Signé : positif augmente l'EBITDA retenu, négatif le réduit. */
  amount: number;
  currency: string;
  recurring: boolean;
  source: string | null;
  notes: string | null;
}

export interface BusinessBridgeItemInput {
  businessId: string;
  effectiveDate: string;
  category: BusinessBridgeItemCategory;
  label: string;
  /** Signé : positif ajoute à l'Equity Value, négatif la réduit. */
  amount: number;
  currency: string;
  source: string | null;
  notes: string | null;
}

export interface BusinessDcfInput {
  businessId: string;
  valuationDate: string;
  currency: string;
  wacc: number;
  taxRate: number;
  terminalMethod: BusinessDcfTerminalMethod;
  terminalGrowth: number | null;
  terminalExitMultiple: number | null;
  terminalExitMetric: "EBITDA" | "EBIT" | null;
  discountConvention: BusinessDiscountConvention;
  periods: Array<{
    yearIndex: number;
    revenue: number | null;
    ebitda: number | null;
    ebit: number | null;
    depreciationAmortisation: number | null;
    capex: number | null;
    workingCapitalChange: number | null;
  }>;
  notes: string | null;
}

export interface BusinessCapitalEventInput {
  businessId: string;
  type: BusinessCapitalEventType;
  eventDate: string;
  /** Magnitude positive. Le sens vient du type, jamais du signe. */
  amount: number;
  /** Ce que `amount` désigne : le cash personnel, ou le montant distribué par la société. */
  amountScope: BusinessAmountScope;
  fees: number | null;
  currency: string;
  ownershipDelta: number | null;
  ownershipRateAfter: number | null;
  sharesDelta: number | null;
  pricePerShare: number | null;
  label: string | null;
  transactionId: string | null;
  notes: string | null;
}

/**
 * Démarrage rapide : les faits minimaux qui suffisent au moteur pour produire une
 * valorisation complète. L'utilisateur ne saisit NI Enterprise Value NI Equity Value.
 */
export interface BusinessQuickStartInput {
  name: string;
  legalForm: string | null;
  type: BusinessType | null;
  currency: string;
  sector: string | null;
  country: string | null;
  periodEnd: string;
  periodKind: BusinessPeriodKind;
  periodLabel: string | null;
  revenue: number | null;
  ebitda: number | null;
  cash: number | null;
  grossDebt: number | null;
  legalRate: number;
  economicRate: number;
  valuationDate: string;
  method: "EBITDA_MULTIPLE" | "REVENUE_MULTIPLE";
  multiple: number;
  multipleLow: number | null;
  multipleHigh: number | null;
  /** Confirmation explicite qu'aucun autre ajustement EV → Equity n'existe. */
  bridgeStatus: "DECLARED_NONE";
  capitalHistoryStart: string | null;
  capitalHistorySource: BusinessCapitalHistorySource;
  notes: string | null;
}

export interface BusinessHoldingInput {
  parentBusinessId: string;
  childBusinessId: string;
  effectiveDate: string;
  ownershipRate: number;
  notes: string | null;
}

/**
 * Application d'un tour de table. UNE saisie, TROIS conséquences persistées ensemble : les
 * termes du tour, la souscription éventuelle, et la détention qui en résulte — dont le taux
 * est DÉRIVÉ ici et jamais ressaisi par l'utilisateur.
 */
export interface BusinessFundingRoundInput {
  businessId: string;
  roundDate: string;
  currency: string;
  preMoneyEquityValue: number;
  primaryNewMoney: number;
  secondaryAmount: number | null;
  investorContribution: number;
  ownershipBefore: number;
  preferredRightsKnown: boolean;
  source: string | null;
  notes: string | null;
}

export interface CareerPackageInput {
  roleId: string | null;
  employer: string | null;
  jobTitle: string | null;
  employmentType:
    | "EMPLOYEE"
    | "INTERN"
    | "FREELANCE"
    | "CONTRACTOR"
    | "ENTREPRENEUR"
    | "CORPORATE_OFFICER"
    | "UNEMPLOYED"
    | "OTHER";
  industry: string | null;
  country: string | null;
  currency: string;
  startDate: string;
  endDate: string | null;
  status: "ACTIVE" | "ENDED" | "FUTURE";
  dataKind: "ACTUAL" | "CONTRACTUAL" | "USER_ASSUMPTION" | "PROJECTED";
  confidence: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  source: string | null;
  notes: string | null;
  compensation: {
    baseSalary: number | null;
    frequency: "MONTHLY" | "ANNUAL" | "DAILY" | "HOURLY";
    guaranteedBonus: number | null;
    targetBonus: number | null;
    targetBonusRate: number | null;
    discretionaryBonus: number | null;
    commissions: number | null;
    profitSharing: number | null;
    participation: number | null;
    employerBenefits: number | null;
    allowances: number | null;
    otherTaxableCompensation: number | null;
    otherNonTaxableCompensation: number | null;
    workingTime: number | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    dataKind: CareerPackageInput["dataKind"];
    confidence: CareerPackageInput["confidence"];
    source: string | null;
    notes: string | null;
  } | null;
}

export interface CareerEventInput {
  roleId: string | null;
  type:
    | "JOB_START"
    | "JOB_END"
    | "PROMOTION"
    | "SALARY_CHANGE"
    | "BONUS_TARGET_CHANGE"
    | "BONUS_EARNED"
    | "BONUS_PAID"
    | "COMMISSION"
    | "UNEMPLOYMENT"
    | "SABBATICAL"
    | "FREELANCE_START"
    | "FREELANCE_END"
    | "EQUITY_GRANT"
    | "EQUITY_VEST"
    | "OTHER";
  eventDate: string;
  amount: number | null;
  currency: string | null;
  variableState: "TARGET" | "CONTRACTUAL" | "EARNED" | "PAID" | "PROJECTED" | null;
  paidDate: string | null;
  label: string | null;
  dataKind: CareerPackageInput["dataKind"];
  confidence: CareerPackageInput["confidence"];
  source: string | null;
  notes: string | null;
}

export interface TaxProfileInput {
  id: string | null;
  residencyCountry: string;
  householdStatus: string;
  jurisdiction: string | null;
  maritalStatus: string | null;
  dependants: number | null;
  taxShares: number | null;
  withholdingSettings: Record<string, unknown>;
  socialContributionRegime: string | null;
  professionalStatus: string | null;
  specialRegime: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
  confidence: CareerPackageInput["confidence"];
  notes: string | null;
}

export interface TaxRuleSetInput {
  id: string | null;
  jurisdiction: string;
  taxYear: number;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
  sourceDate: string;
  confidence: CareerPackageInput["confidence"];
  status: "DRAFT" | "DECLARED" | "VERIFIED" | "STALE";
  legalReference: string | null;
  notes: string | null;
  rules: Array<{
    name: string;
    taxType:
      "PAYROLL_CONTRIBUTION" | "TAXABLE_DEDUCTION" | "INCOME_TAX_BRACKETS" | "WITHHOLDING_RATE";
    incomeCategory: "EMPLOYMENT" | "PROFESSIONAL" | "OTHER";
    parameters: Record<string, unknown>;
    effectiveFrom: string;
    effectiveTo: string | null;
    verifiedAt: string | null;
    confidence: CareerPackageInput["confidence"];
    legalNote: string | null;
    notes: string | null;
  }>;
}

export interface TaxObservationInput {
  type: "LIABILITY" | "WITHHELD" | "PAID" | "REFUND" | "BALANCE_DUE";
  observedDate: string;
  taxYear: number;
  amount: number;
  currency: string;
  transactionId: string | null;
  documentId: string | null;
  confidence: CareerPackageInput["confidence"];
  source: string | null;
  notes: string | null;
}

export type Mutation =
  | { action: "save_career_package"; career: CareerPackageInput }
  | { action: "record_career_event"; event: CareerEventInput }
  | { action: "set_tax_profile"; profile: TaxProfileInput }
  | { action: "save_tax_rule_set"; ruleSet: TaxRuleSetInput }
  | { action: "record_tax_observation"; observation: TaxObservationInput }
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
  | {
      action: "create_scenario_v2";
      name: string;
      description: string;
      color: string;
      definition: ScenarioVersionDefinition;
    }
  | {
      action: "save_scenario_version_v2";
      scenarioId: string;
      expectedVersion: number;
      definition: ScenarioVersionDefinition;
    }
  | { action: "archive_scenario_v2"; scenarioId: string }
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
  | { action: "create_business_quick_start"; quickStart: BusinessQuickStartInput }
  | { action: "save_business"; business: BusinessInput }
  | { action: "archive_business"; businessId: string }
  | { action: "record_business_ownership"; ownership: BusinessOwnershipInput }
  | { action: "delete_business_ownership"; ownershipId: string }
  | { action: "record_business_financials"; financials: BusinessFinancialInput }
  | { action: "delete_business_financials"; financialsId: string }
  | { action: "record_business_valuation"; valuation: BusinessValuationInput }
  | { action: "delete_business_valuation"; valuationId: string }
  | { action: "record_business_ebitda_adjustment"; adjustment: BusinessEbitdaAdjustmentInput }
  | { action: "delete_business_ebitda_adjustment"; adjustmentId: string }
  | { action: "record_business_bridge_item"; item: BusinessBridgeItemInput }
  | { action: "delete_business_bridge_item"; itemId: string }
  | { action: "set_business_dcf"; dcf: BusinessDcfInput }
  | { action: "delete_business_dcf"; dcfId: string }
  | { action: "record_business_capital_event"; event: BusinessCapitalEventInput }
  | { action: "delete_business_capital_event"; eventId: string }
  | { action: "set_business_holding"; holding: BusinessHoldingInput }
  | { action: "delete_business_holding"; holdingId: string }
  | { action: "apply_business_funding_round"; round: BusinessFundingRoundInput }
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
  scenarioVersion?: number;
  asOfDate?: string;
  baselineReference?: ScenarioBaselineReference;
  eventSetVersion?: string;
  assumptionsSnapshot?: ScenarioVersionDefinition["assumptions"];
  runMode?: ScenarioRunMode;
  horizonMonths?: number;
  methodologyVersion?: string;
  definitionSnapshot?: ScenarioVersionDefinition;
}

export type StoredDocument = DocumentRecord;
