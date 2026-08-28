import type { Confidence } from "@/lib/types";

/** Domaines propriétaires. L'Event Engine orchestre ces domaines, il ne les remplace pas. */
export const EVENT_DOMAINS = [
  "CAREER",
  "TAX",
  "DEBT",
  "CASH_FLOW",
  "PORTFOLIO",
  "REAL_ESTATE",
  "BUSINESS",
  "PERSONAL",
] as const;
export type EventDomain = (typeof EVENT_DOMAINS)[number];

/**
 * Taxonomie métier du registre canonique. Les domaines peuvent conserver un vocabulaire
 * plus fin ; leurs adaptateurs traduisent seulement les concepts utiles à la timeline.
 */
export const CANONICAL_EVENT_TYPES = [
  "EMPLOYMENT_START",
  "EMPLOYMENT_END",
  "COMPENSATION_CHANGE",
  "BONUS_EARNED",
  "BONUS_PAID",
  "PROMOTION",
  "EQUITY_GRANT",
  "EQUITY_VEST",
  "EQUITY_EXERCISE",
  "FREELANCE_START",
  "FREELANCE_END",
  "TAX_RULE_CHANGE",
  "TAX_PROFILE_CHANGE",
  "TAX_PAYMENT",
  "TAX_REFUND",
  "TAX_ASSESSMENT",
  "WITHHOLDING_CHANGE",
  "LOAN_START",
  "RATE_CHANGE",
  "PAYMENT_CHANGE",
  "DEFERRAL_START",
  "DEFERRAL_END",
  "EARLY_REPAYMENT",
  "REFINANCE",
  "LOAN_PAYMENT",
  "LOAN_END",
  "CONTRIBUTION",
  "WITHDRAWAL",
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "PORTFOLIO_TAX",
  "TRANSFER",
  "CAPITAL_CALL",
  "DISTRIBUTION",
  "ACQUISITION",
  "DISPOSAL",
  "LEASE_START",
  "LEASE_END",
  "RENT_CHANGE",
  "RENT_RECEIPT",
  "WORKS_START",
  "WORKS_PAYMENT",
  "VACANCY_START",
  "VACANCY_END",
  "PROPERTY_TAX",
  "INSURANCE_CHANGE",
  "FUNDING_ROUND",
  "SHAREHOLDER_LOAN",
  "OWNERSHIP_CHANGE",
  "VALUATION_OBSERVATION",
  "CAPEX",
  "RECURRING_CASH_FLOW",
  "OBSERVED_TRANSACTION",
  "GIFT",
  "DONATION",
  "INHERITANCE",
  "LARGE_PURCHASE",
  "CUSTOM_EVENT",
] as const;
export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

export type CanonicalDataKind =
  "OBSERVED" | "CONTRACTUAL" | "PROJECTED" | "USER_ASSUMPTION" | "MODEL_ASSUMPTION";
export type CanonicalEventStatus = "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "SUPERSEDED";
export type EventShape = "ONE_OFF" | "STATE_CHANGE" | "RECURRING_RULE" | "SCHEDULE_CONSEQUENCE";
export type EffectiveConvention =
  "IMMEDIATE" | "MONTH_BOUNDARY" | "DOMAIN_PRORATION" | "NOT_APPLICABLE";
export type EconomicEffectKind =
  "OPERATING" | "TAX" | "DEBT_SERVICE" | "CAPITAL_MOVEMENT" | "VALUATION" | "STATE_ONLY";
export type ConsequenceStatus =
  "PRE_TAX" | "AFTER_TAX_ESTIMATED" | "AFTER_TAX_VERIFIED" | "NOT_COMPUTABLE";

export interface EventTarget {
  entityType: string;
  entityId: string | null;
}

export interface EventProvenance {
  source: string | null;
  sourceRecordId: string | null;
  engine: string;
  formulaReference: string | null;
  assumptions: string[];
}

/** Identité stable et enveloppe temporelle d'un fait de domaine projeté dans la timeline. */
export interface CanonicalEvent {
  id: string;
  domain: EventDomain;
  type: CanonicalEventType;
  effectiveDate: string;
  eventDate: string;
  createdAt: string | null;
  dataKind: CanonicalDataKind;
  confidence: Confidence;
  source: string | null;
  provenance: EventProvenance;
  target: EventTarget;
  status: CanonicalEventStatus;
  shape: EventShape;
  effectiveConvention: EffectiveConvention;
  /** Ordre métier explicite au sein d'une phase. Jamais l'UUID. */
  sequence: number;
  supersededBy: string | null;
  scenarioId: string | null;
  blockers: string[];
  consequences: CanonicalMonthlyConsequence[];
}

/**
 * Conséquence économique mensuelle canonique.
 *
 * Tous les montants sont dans `currency`, sans conversion implicite. Un champ à `null`
 * signifie qu'il devrait être connu pour cette conséquence mais ne l'est pas ; zéro dit
 * explicitement que la grandeur ne s'applique pas.
 */
export interface CanonicalMonthlyConsequence {
  id: string;
  month: string;
  economicDate: string;
  sourceDomain: EventDomain;
  sourceEntityId: string | null;
  sourceEventId: string;
  eventType: CanonicalEventType;
  effectKind: EconomicEffectKind;
  currency: string;
  cashIn: number | null;
  cashOut: number | null;
  income: number | null;
  expense: number | null;
  taxLiability: number | null;
  taxCash: number | null;
  debtPrincipal: number | null;
  debtInterest: number | null;
  fees: number | null;
  assetDelta: number | null;
  liabilityDelta: number | null;
  economicCost: number | null;
  dataKind: CanonicalDataKind;
  confidence: Confidence;
  provenance: EventProvenance;
  blockers: string[];
  status: ConsequenceStatus;
  /** Clé métier de rapprochement, jamais date + montant seuls. */
  reconciliationKey: string | null;
  recognition: "ACTUAL" | "EXPECTED";
  included: boolean;
  flags: string[];
}

export interface ConsequenceReconciliation {
  key: string;
  month: string;
  currency: string;
  expectedConsequenceIds: string[];
  actualConsequenceIds: string[];
  expectedCash: number | null;
  actualCash: number | null;
  variance: number | null;
}

export interface EventConflict {
  key: string;
  eventIds: string[];
  reason: "SAME_DAY_STATE_CHANGE" | "SUPERSESSION_CYCLE" | "MISSING_SUPERSEDED_EVENT";
}

export type ScenarioEventOverride =
  | { operation: "ADD"; scenarioId: string; event: CanonicalEvent }
  | { operation: "REPLACE"; scenarioId: string; baselineEventId: string; event: CanonicalEvent }
  | { operation: "CANCEL"; scenarioId: string; baselineEventId: string };

export interface CanonicalTimeline {
  startDate: string;
  endDate: string;
  events: CanonicalEvent[];
  rawConsequences: CanonicalMonthlyConsequence[];
  monthlyConsequences: CanonicalMonthlyConsequence[];
  reconciliations: ConsequenceReconciliation[];
  conflicts: EventConflict[];
}

export const zeroConsequenceAmounts = () => ({
  cashIn: 0,
  cashOut: 0,
  income: 0,
  expense: 0,
  taxLiability: 0,
  taxCash: 0,
  debtPrincipal: 0,
  debtInterest: 0,
  fees: 0,
  assetDelta: 0,
  liabilityDelta: 0,
  economicCost: 0,
});
