import type {
  CanonicalEvent,
  CanonicalMonthlyConsequence,
  CanonicalEventType,
  EconomicEffectKind,
  EventDomain,
} from "@/lib/engine/event-contracts";
import type { OpeningBalanceSheet } from "@/lib/engine/monthly-financial-model";

export const SCENARIO_AS_OF = "2026-08-28";

export const scenarioOpening: OpeningBalanceSheet = {
  date: SCENARIO_AS_OF,
  bankCash: 100_000,
  marketInvestedAssets: 50_000,
  investmentCash: 10_000,
  otherFinancialAssets: 5_000,
  grossFinancialAssets: 165_000,
  nonFinancialAssets: 200_000,
  loanBalance: 30_000,
  otherLiabilityBalance: 5_000,
  fundingGap: 0,
  netWorth: 330_000,
  flags: [],
};

interface EventFactoryInput {
  id: string;
  date: string;
  domain?: EventDomain;
  type?: CanonicalEventType;
  effectKind?: EconomicEffectKind;
  cashIn?: number | null;
  cashOut?: number | null;
  income?: number | null;
  expense?: number | null;
  taxCash?: number | null;
  debtPrincipal?: number | null;
  debtInterest?: number | null;
  fees?: number | null;
  assetDelta?: number | null;
  liabilityDelta?: number | null;
  economicCost?: number | null;
  currency?: string;
  dataKind?: CanonicalEvent["dataKind"];
  recognition?: CanonicalMonthlyConsequence["recognition"];
  reconciliationKey?: string | null;
  blockers?: string[];
  status?: CanonicalMonthlyConsequence["status"];
  shape?: CanonicalEvent["shape"];
  sequence?: number;
}

export function scenarioEvent(input: EventFactoryInput): CanonicalEvent {
  const domain = input.domain ?? "CASH_FLOW";
  const type = input.type ?? "CUSTOM_EVENT";
  const blockers = input.blockers ?? [];
  const consequence: CanonicalMonthlyConsequence = {
    id: `${input.id}:consequence`,
    month: input.date.slice(0, 7),
    economicDate: input.date,
    sourceDomain: domain,
    sourceEntityId: input.id,
    sourceEventId: input.id,
    eventType: type,
    effectKind: input.effectKind ?? "OPERATING",
    currency: input.currency ?? "EUR",
    cashIn: input.cashIn ?? 0,
    cashOut: input.cashOut ?? 0,
    income: input.income ?? 0,
    expense: input.expense ?? 0,
    taxLiability: 0,
    taxCash: input.taxCash ?? 0,
    debtPrincipal: input.debtPrincipal ?? 0,
    debtInterest: input.debtInterest ?? 0,
    fees: input.fees ?? 0,
    assetDelta: input.assetDelta ?? 0,
    liabilityDelta: input.liabilityDelta ?? 0,
    economicCost: input.economicCost ?? 0,
    dataKind: input.dataKind ?? "USER_ASSUMPTION",
    confidence: "HIGH",
    provenance: {
      source: "Scenarios V2 fixture",
      sourceRecordId: input.id,
      engine: `${domain} fixture adapter`,
      formulaReference: null,
      assumptions: [],
    },
    blockers,
    status: input.status ?? (blockers.length ? "NOT_COMPUTABLE" : "AFTER_TAX_VERIFIED"),
    reconciliationKey: input.reconciliationKey ?? null,
    recognition: input.recognition ?? "EXPECTED",
    included: true,
    flags: [],
  };
  return {
    id: input.id,
    domain,
    type,
    effectiveDate: input.date,
    eventDate: input.date,
    createdAt: `${SCENARIO_AS_OF}T08:00:00.000Z`,
    dataKind: input.dataKind ?? "USER_ASSUMPTION",
    confidence: "HIGH",
    source: "Scenarios V2 fixture",
    provenance: consequence.provenance,
    target: { entityType: domain, entityId: input.id },
    status: "PLANNED",
    shape: input.shape ?? "ONE_OFF",
    effectiveConvention: "MONTH_BOUNDARY",
    sequence: input.sequence ?? 10,
    supersededBy: null,
    scenarioId: null,
    blockers,
    consequences: [consequence],
  };
}
