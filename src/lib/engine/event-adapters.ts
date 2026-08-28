import { categoryIndex, effectiveCashFlowKind } from "@/lib/engine/cash-flow";
import {
  buildContractualSchedule,
  buildForwardSchedule,
  debtImpactFromEntries,
} from "@/lib/engine/debt";
import type {
  CanonicalDataKind,
  CanonicalEvent,
  CanonicalEventStatus,
  CanonicalEventType,
  CanonicalMonthlyConsequence,
  EconomicEffectKind,
  EventDomain,
  EventProvenance,
} from "@/lib/engine/event-contracts";
import { buildCanonicalTimeline } from "@/lib/engine/event-engine";
import type { CanonicalTimeline } from "@/lib/engine/event-contracts";
import type { BusinessCapitalEvent } from "@/lib/engine/business-equity";
import type {
  CashFlowKind,
  Confidence,
  DashboardState,
  DataKind,
  PortfolioEvent,
  Provenance,
  RealEstateCapitalEvent,
  Transaction,
  RecurringCashFlowRule,
} from "@/lib/types";

const CAREER_TYPE: Record<string, CanonicalEventType> = {
  JOB_START: "EMPLOYMENT_START",
  JOB_END: "EMPLOYMENT_END",
  PROMOTION: "PROMOTION",
  SALARY_CHANGE: "COMPENSATION_CHANGE",
  BONUS_TARGET_CHANGE: "COMPENSATION_CHANGE",
  BONUS_EARNED: "BONUS_EARNED",
  BONUS_PAID: "BONUS_PAID",
  FREELANCE_START: "FREELANCE_START",
  FREELANCE_END: "FREELANCE_END",
  EQUITY_GRANT: "EQUITY_GRANT",
  EQUITY_VEST: "EQUITY_VEST",
};

const PORTFOLIO_TYPE: Record<PortfolioEvent["type"], CanonicalEventType> = {
  OPENING_POSITION: "VALUATION_OBSERVATION",
  OPENING_CASH: "VALUATION_OBSERVATION",
  CONTRIBUTION: "CONTRIBUTION",
  WITHDRAWAL: "WITHDRAWAL",
  BUY: "BUY",
  SELL: "SELL",
  DIVIDEND: "DIVIDEND",
  INTEREST: "INTEREST",
  FEE: "FEE",
  TAX: "PORTFOLIO_TAX",
  TRANSFER_IN: "TRANSFER",
  TRANSFER_OUT: "TRANSFER",
};

const BUSINESS_TYPE: Record<BusinessCapitalEvent["type"], CanonicalEventType> = {
  OPENING_COST_BASIS: "VALUATION_OBSERVATION",
  ACQUISITION: "ACQUISITION",
  CAPITAL_INJECTION: "CAPITAL_CALL",
  SALE: "DISPOSAL",
  BUYBACK: "DISPOSAL",
  DIVIDEND: "DIVIDEND",
  DISTRIBUTION: "DISTRIBUTION",
  CAPITAL_RETURN: "DISTRIBUTION",
};

const REAL_ESTATE_TYPE: Record<RealEstateCapitalEvent["type"], CanonicalEventType> = {
  ACQUISITION_PRICE: "ACQUISITION",
  ACQUISITION_COST: "ACQUISITION",
  CAPEX: "CAPEX",
  DISPOSAL_PRICE: "DISPOSAL",
  DISPOSAL_COST: "DISPOSAL",
};

function monthEnd(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

function addMonths(month: string, count: number): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

function monthsBetween(startDate: string, endDate: string): string[] {
  const start = startDate.slice(0, 7);
  const end = endDate.slice(0, 7);
  const result: string[] = [];
  for (let month = start, index = 0; month <= end && index < 600; month = addMonths(start, ++index))
    result.push(month);
  return result;
}

function recurringOccurrences(
  rule: RecurringCashFlowRule,
  startDate: string,
  endDate: string,
): Array<{ date: string; amount: number }> {
  if (!rule.active) return [];
  const step = rule.frequency === "MONTHLY" ? 1 : rule.frequency === "QUARTERLY" ? 3 : 12;
  const result: Array<{ date: string; amount: number }> = [];
  const startMonth = rule.startDate.slice(0, 7);
  for (let index = 0; index < 600; index += 1) {
    const month = addMonths(startMonth, index * step);
    const [year, number] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const declaredDay = rule.dayOfMonth ?? Number(rule.startDate.slice(8, 10));
    const date = `${month}-${String(Math.min(lastDay, Math.max(1, declaredDay))).padStart(2, "0")}`;
    if (date > endDate || (rule.endDate && date > rule.endDate)) break;
    if (date >= startDate) result.push({ date, amount: rule.amount });
  }
  return result;
}

function canonicalDataKind(kind: DataKind | string | null | undefined): CanonicalDataKind {
  if (kind === "ACTUAL" || kind === "EXTERNAL_DATA" || kind === "OBSERVED_TAX") return "OBSERVED";
  if (kind === "CONTRACTUAL" || kind === "DECLARED_TAX_RULE") return "CONTRACTUAL";
  if (kind === "USER_ASSUMPTION") return "USER_ASSUMPTION";
  if (kind === "MODEL_ASSUMPTION" || kind === "MISSING") return "MODEL_ASSUMPTION";
  return "PROJECTED";
}

function statusAt(
  date: string,
  asOfDate: string,
  shape: CanonicalEvent["shape"],
): CanonicalEventStatus {
  if (date > asOfDate) return "PLANNED";
  return shape === "STATE_CHANGE" || shape === "RECURRING_RULE" ? "ACTIVE" : "COMPLETED";
}

function provenanceOf(input: {
  source: string | null;
  sourceRecordId: string | null;
  engine: string;
  formulaReference?: string | null;
  assumptions?: string[];
}): EventProvenance {
  return {
    source: input.source,
    sourceRecordId: input.sourceRecordId,
    engine: input.engine,
    formulaReference: input.formulaReference ?? null,
    assumptions: input.assumptions ?? [],
  };
}

function event(
  input: Omit<CanonicalEvent, "createdAt" | "supersededBy" | "scenarioId">,
): CanonicalEvent {
  return { ...input, createdAt: null, supersededBy: null, scenarioId: null };
}

function consequence(
  input: Omit<CanonicalMonthlyConsequence, "id" | "month" | "included" | "flags" | "status"> & {
    id: string;
    status?: CanonicalMonthlyConsequence["status"];
    flags?: string[];
  },
): CanonicalMonthlyConsequence {
  return {
    ...input,
    month: input.economicDate.slice(0, 7),
    included: true,
    flags: input.flags ?? [],
    status: input.status ?? (input.blockers.length ? "NOT_COMPUTABLE" : "PRE_TAX"),
  };
}

function emptyAmounts() {
  return {
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
  };
}

function sourceOf(value: { source?: string | null; provenance?: Provenance }): string | null {
  return value.source ?? value.provenance?.source ?? null;
}

function confidenceOf(value: { confidence?: Confidence; provenance?: Provenance }): Confidence {
  return value.confidence ?? value.provenance?.confidence ?? "UNKNOWN";
}

function dataKindOf(value: { dataKind?: string; provenance?: Provenance }): CanonicalDataKind {
  return canonicalDataKind(value.dataKind ?? value.provenance?.kind);
}

function recognitionOf(kind: CanonicalDataKind): "ACTUAL" | "EXPECTED" {
  return kind === "OBSERVED" ? "ACTUAL" : "EXPECTED";
}

function stateEvent(input: {
  id: string;
  domain: EventDomain;
  type: CanonicalEventType;
  date: string;
  asOfDate: string;
  targetType: string;
  targetId: string | null;
  dataKind: CanonicalDataKind;
  confidence: Confidence;
  source: string | null;
  engine: string;
  blockers?: string[];
  sequence?: number;
}): CanonicalEvent {
  const provenance = provenanceOf({
    source: input.source,
    sourceRecordId: input.id,
    engine: input.engine,
  });
  return event({
    id: `${input.domain.toLowerCase()}:${input.id}:${input.type.toLowerCase()}`,
    domain: input.domain,
    type: input.type,
    effectiveDate: input.date,
    eventDate: input.date,
    dataKind: input.dataKind,
    confidence: input.confidence,
    source: input.source,
    provenance,
    target: { entityType: input.targetType, entityId: input.targetId },
    status: statusAt(input.date, input.asOfDate, "STATE_CHANGE"),
    shape: "STATE_CHANGE",
    effectiveConvention: "IMMEDIATE",
    sequence: input.sequence ?? 0,
    blockers: input.blockers ?? [],
    consequences: [],
  });
}

function careerEvents(state: DashboardState, startDate: string, endDate: string): CanonicalEvent[] {
  const result: CanonicalEvent[] = [];
  for (const role of state.careerRoles ?? []) {
    const kind = dataKindOf(role);
    result.push(
      stateEvent({
        id: role.id,
        domain: "CAREER",
        type: role.employmentType === "FREELANCE" ? "FREELANCE_START" : "EMPLOYMENT_START",
        date: role.startDate,
        asOfDate: state.asOfDate,
        targetType: "career_role",
        targetId: role.id,
        dataKind: kind,
        confidence: role.confidence,
        source: role.source,
        engine: "career",
      }),
    );
    if (role.endDate)
      result.push(
        stateEvent({
          id: `${role.id}:end`,
          domain: "CAREER",
          type: role.employmentType === "FREELANCE" ? "FREELANCE_END" : "EMPLOYMENT_END",
          date: role.endDate,
          asOfDate: state.asOfDate,
          targetType: "career_role",
          targetId: role.id,
          dataKind: kind,
          confidence: role.confidence,
          source: role.source,
          engine: "career",
        }),
      );
  }
  for (const term of state.careerCompensationTerms ?? []) {
    result.push(
      stateEvent({
        id: term.id,
        domain: "CAREER",
        type: "COMPENSATION_CHANGE",
        date: term.effectiveFrom,
        asOfDate: state.asOfDate,
        targetType: "career_role",
        targetId: term.roleId,
        dataKind: dataKindOf(term),
        confidence: term.confidence,
        source: term.source,
        engine: "career",
      }),
    );
  }
  for (const item of state.careerEvents ?? []) {
    result.push(
      stateEvent({
        id: item.id,
        domain: "CAREER",
        type: CAREER_TYPE[item.type] ?? "CUSTOM_EVENT",
        date: item.eventDate,
        asOfDate: state.asOfDate,
        targetType: "career_role",
        targetId: item.roleId,
        dataKind: dataKindOf(item),
        confidence: item.confidence,
        source: item.source,
        engine: "career",
      }),
    );
  }
  for (const grant of state.careerEquityGrants ?? []) {
    result.push(
      stateEvent({
        id: grant.id,
        domain: "CAREER",
        type: "EQUITY_GRANT",
        date: grant.grantDate,
        asOfDate: state.asOfDate,
        targetType: "career_equity_grant",
        targetId: grant.id,
        dataKind: dataKindOf(grant),
        confidence: grant.confidence,
        source: grant.source,
        engine: "career",
      }),
    );
  }
  for (const month of state.careerTaxMonthly ?? []) {
    const date = monthEnd(month.month);
    if (date < startDate || date > endDate) continue;
    const kind = canonicalDataKind(month.provenance.dataKind);
    const provenance = provenanceOf({
      source: month.provenance.source.join(", ") || null,
      sourceRecordId: `career-tax:${month.month}`,
      engine: "career-tax-cash-flow",
      formulaReference: "Career gross → Tax → net cash; bank actual wins",
      assumptions: month.assumptions,
    });
    const monthly = consequence({
      id: `career-tax:${month.month}:consequence`,
      economicDate: date,
      sourceDomain: "CAREER",
      sourceEntityId: null,
      sourceEventId: `career-tax:${month.month}`,
      eventType: "COMPENSATION_CHANGE",
      effectKind: "OPERATING",
      currency: state.reportingCurrency,
      ...emptyAmounts(),
      cashIn: month.cashFlowAmount,
      income: month.grossIncome,
      expense: month.payrollContributions,
      taxLiability: month.taxLiability,
      taxCash: month.taxCashPaid,
      dataKind: kind,
      confidence: month.provenance.confidence,
      provenance,
      blockers: month.blockers,
      status: month.status,
      reconciliationKey: `salary:${month.month}`,
      recognition: month.cashFlowStatus === "ACTUAL" ? "ACTUAL" : "EXPECTED",
      flags: month.flags,
    });
    result.push(
      event({
        id: `career-tax:${month.month}`,
        domain: "CAREER",
        type: "COMPENSATION_CHANGE",
        effectiveDate: date,
        eventDate: date,
        dataKind: kind,
        confidence: month.provenance.confidence,
        source: provenance.source,
        provenance,
        target: { entityType: "career_month", entityId: month.month },
        status: statusAt(date, state.asOfDate, "SCHEDULE_CONSEQUENCE"),
        shape: "SCHEDULE_CONSEQUENCE",
        effectiveConvention: "DOMAIN_PRORATION",
        sequence: 100,
        blockers: month.blockers,
        consequences: [monthly],
      }),
    );
  }
  return result;
}

function taxEvents(state: DashboardState): CanonicalEvent[] {
  const result: CanonicalEvent[] = [];
  for (const profile of state.taxProfiles ?? [])
    result.push(
      stateEvent({
        id: profile.id,
        domain: "TAX",
        type: "TAX_PROFILE_CHANGE",
        date: profile.effectiveFrom,
        asOfDate: state.asOfDate,
        targetType: "tax_profile",
        targetId: profile.id,
        dataKind: "CONTRACTUAL",
        confidence: profile.confidence,
        source: profile.source,
        engine: "tax",
      }),
    );
  for (const ruleSet of state.taxRuleSets ?? [])
    result.push(
      stateEvent({
        id: ruleSet.id,
        domain: "TAX",
        type: "TAX_RULE_CHANGE",
        date: ruleSet.effectiveFrom,
        asOfDate: state.asOfDate,
        targetType: "tax_rule_set",
        targetId: ruleSet.id,
        dataKind: ruleSet.status === "VERIFIED" ? "OBSERVED" : "CONTRACTUAL",
        confidence: ruleSet.confidence,
        source: ruleSet.source,
        engine: "tax",
      }),
    );
  for (const observation of state.taxObservations ?? []) {
    const type: CanonicalEventType =
      observation.type === "REFUND"
        ? "TAX_REFUND"
        : observation.type === "LIABILITY" || observation.type === "BALANCE_DUE"
          ? "TAX_ASSESSMENT"
          : "TAX_PAYMENT";
    const provenance = provenanceOf({
      source: observation.source,
      sourceRecordId: observation.id,
      engine: "tax",
    });
    const isRefund = observation.type === "REFUND";
    const isLiability = observation.type === "LIABILITY" || observation.type === "BALANCE_DUE";
    const cashConsumedByCareerTax = (state.careerTaxMonthly ?? []).some(
      (month) => month.month === observation.observedDate.slice(0, 7),
    );
    const monthly = consequence({
      id: `tax:${observation.id}:consequence`,
      economicDate: observation.observedDate,
      sourceDomain: "TAX",
      sourceEntityId: observation.id,
      sourceEventId: `tax:${observation.id}`,
      eventType: type,
      effectKind: "TAX",
      currency: observation.currency,
      ...emptyAmounts(),
      cashIn: isRefund && !cashConsumedByCareerTax ? observation.amount : 0,
      cashOut: isLiability || isRefund || cashConsumedByCareerTax ? 0 : observation.amount,
      taxLiability: isLiability ? observation.amount : 0,
      taxCash: isLiability ? 0 : isRefund ? -observation.amount : observation.amount,
      dataKind: "OBSERVED",
      confidence: observation.confidence,
      provenance,
      blockers: [],
      status: "AFTER_TAX_VERIFIED",
      reconciliationKey: observation.transactionId
        ? `transaction:${observation.transactionId}`
        : `tax:${observation.taxYear}:${observation.type}`,
      recognition: "ACTUAL",
      flags: cashConsumedByCareerTax ? ["CASH_INCLUDED_IN_CAREER_TAX_MONTH"] : [],
    });
    result.push(
      event({
        id: `tax:${observation.id}`,
        domain: "TAX",
        type,
        effectiveDate: observation.observedDate,
        eventDate: observation.observedDate,
        dataKind: "OBSERVED",
        confidence: observation.confidence,
        source: observation.source,
        provenance,
        target: { entityType: "tax_observation", entityId: observation.id },
        status: "COMPLETED",
        shape: "ONE_OFF",
        effectiveConvention: "IMMEDIATE",
        sequence: 0,
        blockers: [],
        consequences: [monthly],
      }),
    );
  }
  return result;
}

function debtEvents(state: DashboardState, startDate: string, endDate: string): CanonicalEvent[] {
  const result: CanonicalEvent[] = [];
  for (const liability of state.liabilities) {
    const source = sourceOf(liability);
    const confidence = confidenceOf(liability);
    result.push(
      stateEvent({
        id: `${liability.id}:start`,
        domain: "DEBT",
        type: "LOAN_START",
        date: liability.firstPaymentDate,
        asOfDate: state.asOfDate,
        targetType: "liability",
        targetId: liability.id,
        dataKind: dataKindOf(liability),
        confidence,
        source,
        engine: "debt",
      }),
      stateEvent({
        id: `${liability.id}:end`,
        domain: "DEBT",
        type: "LOAN_END",
        date: liability.maturityDate,
        asOfDate: state.asOfDate,
        targetType: "liability",
        targetId: liability.id,
        dataKind: dataKindOf(liability),
        confidence,
        source,
        engine: "debt",
      }),
    );
    for (const [index, rate] of liability.rateSchedule.entries())
      result.push(
        stateEvent({
          id: `${liability.id}:rate:${index}`,
          domain: "DEBT",
          type: "RATE_CHANGE",
          date: rate.effectiveFrom,
          asOfDate: state.asOfDate,
          targetType: "liability",
          targetId: liability.id,
          dataKind: rate.kind === "CONTRACTUAL" ? "CONTRACTUAL" : "USER_ASSUMPTION",
          confidence,
          source,
          engine: "debt",
          sequence: index,
        }),
      );
    for (const [index, payment] of liability.paymentSchedule.entries())
      result.push(
        stateEvent({
          id: `${liability.id}:payment:${index}`,
          domain: "DEBT",
          type: "PAYMENT_CHANGE",
          date: payment.effectiveFrom,
          asOfDate: state.asOfDate,
          targetType: "liability",
          targetId: liability.id,
          dataKind: payment.kind === "CONTRACTUAL" ? "CONTRACTUAL" : "USER_ASSUMPTION",
          confidence,
          source,
          engine: "debt",
          sequence: index,
        }),
      );
    const historical = buildContractualSchedule(liability).entries.filter(
      (entry) => entry.dueDate <= state.asOfDate,
    );
    const forward = buildForwardSchedule(liability, state.asOfDate).entries.filter(
      (entry) => entry.dueDate > state.asOfDate,
    );
    for (const entry of [...historical, ...forward].filter(
      (row) => row.dueDate >= startDate && row.dueDate <= endDate,
    )) {
      const impact = debtImpactFromEntries([entry]);
      const kind = canonicalDataKind(entry.kind);
      const type = entry.entryKind === "EARLY_REPAYMENT" ? "EARLY_REPAYMENT" : "LOAN_PAYMENT";
      const id = `debt:${liability.id}:${entry.entryKind}:${entry.paymentNumber}:${entry.dueDate}`;
      const provenance = provenanceOf({
        source,
        sourceRecordId: liability.id,
        engine: "debt",
        formulaReference: "Debt Engine schedule entry",
      });
      const monthly = consequence({
        id: `${id}:consequence`,
        economicDate: entry.dueDate,
        sourceDomain: "DEBT",
        sourceEntityId: liability.id,
        sourceEventId: id,
        eventType: type,
        effectKind: "DEBT_SERVICE",
        currency: liability.currency ?? state.reportingCurrency,
        ...emptyAmounts(),
        cashOut: impact.totalCashOut,
        expense: impact.interest + impact.insurance + impact.fees,
        debtPrincipal: impact.principal,
        debtInterest: impact.interest + impact.capitalisedInterest,
        fees: impact.fees + impact.capitalisedCharges,
        liabilityDelta: impact.liabilityDelta,
        economicCost: impact.economicCost,
        dataKind: kind,
        confidence,
        provenance,
        blockers: impact.flags.map((flag) => flag.code),
        reconciliationKey: `debt:${entry.dueDate.slice(0, 7)}`,
        recognition: recognitionOf(kind),
      });
      result.push(
        event({
          id,
          domain: "DEBT",
          type,
          effectiveDate: entry.dueDate,
          eventDate: entry.dueDate,
          dataKind: kind,
          confidence,
          source,
          provenance,
          target: { entityType: "liability", entityId: liability.id },
          status: statusAt(entry.dueDate, state.asOfDate, "SCHEDULE_CONSEQUENCE"),
          shape: "SCHEDULE_CONSEQUENCE",
          effectiveConvention: "IMMEDIATE",
          sequence: entry.paymentNumber,
          blockers: impact.flags.map((flag) => flag.code),
          consequences: [monthly],
        }),
      );
    }
  }
  return result;
}

function portfolioAmounts(item: PortfolioEvent) {
  const amount = item.envelopeCashAmount;
  const linked = item.transactionId !== null;
  const externalIn = item.type === "CONTRIBUTION";
  const externalOut = item.type === "WITHDRAWAL";
  const income = item.type === "DIVIDEND" || item.type === "INTEREST";
  const charge = item.type === "FEE" || item.type === "TAX";
  const assetDelta =
    amount === null
      ? externalIn || externalOut || income || charge
        ? null
        : 0
      : externalIn
        ? Math.abs(amount)
        : externalOut
          ? -Math.abs(amount)
          : income
            ? Math.abs(amount)
            : charge
              ? -Math.abs(amount)
              : 0;
  return {
    cashIn: linked || !externalOut || amount === null ? 0 : Math.abs(amount),
    cashOut: linked || !externalIn || amount === null ? 0 : Math.abs(amount),
    income: income ? (item.grossAmount ?? (amount === null ? null : Math.abs(amount))) : 0,
    expense:
      item.type === "FEE" ? (item.feeAmount ?? (amount === null ? null : Math.abs(amount))) : 0,
    taxCash:
      item.type === "TAX" ? (item.taxAmount ?? (amount === null ? null : Math.abs(amount))) : 0,
    fees: item.feeAmount ?? (item.type === "FEE" ? null : 0),
    assetDelta,
  };
}

function portfolioEvents(state: DashboardState): CanonicalEvent[] {
  return state.portfolioEvents.map((item) => {
    const kind = dataKindOf(item);
    const provenance = provenanceOf({
      source: sourceOf(item),
      sourceRecordId: item.id,
      engine: "portfolio",
      formulaReference: "Portfolio ledger event; lots and PnL stay in Portfolio",
    });
    const amounts = portfolioAmounts(item);
    const blockers = Object.values(amounts).some((value) => value === null)
      ? ["PORTFOLIO_EVENT_AMOUNT_MISSING"]
      : [];
    const type = PORTFOLIO_TYPE[item.type];
    const monthly = consequence({
      id: `portfolio:${item.id}:consequence`,
      economicDate: item.settlementDate ?? item.eventDate,
      sourceDomain: "PORTFOLIO",
      sourceEntityId: item.accountId,
      sourceEventId: `portfolio:${item.id}`,
      eventType: type,
      effectKind:
        item.type === "DIVIDEND" || item.type === "INTEREST" || item.type === "FEE"
          ? "OPERATING"
          : item.type === "TAX"
            ? "TAX"
            : "CAPITAL_MOVEMENT",
      currency: item.currency,
      ...emptyAmounts(),
      ...amounts,
      dataKind: kind,
      confidence: confidenceOf(item),
      provenance,
      blockers,
      reconciliationKey: item.transactionId
        ? `transaction:${item.transactionId}`
        : `portfolio:${item.id}`,
      recognition: recognitionOf(kind),
    });
    return event({
      id: `portfolio:${item.id}`,
      domain: "PORTFOLIO",
      type,
      effectiveDate: item.eventDate,
      eventDate: item.eventDate,
      dataKind: kind,
      confidence: confidenceOf(item),
      source: sourceOf(item),
      provenance,
      target: { entityType: "portfolio_account", entityId: item.accountId },
      status: statusAt(item.eventDate, state.asOfDate, "ONE_OFF"),
      shape: "ONE_OFF",
      effectiveConvention: "IMMEDIATE",
      sequence: 0,
      blockers,
      consequences: [monthly],
    });
  });
}

function realEstateEvents(
  state: DashboardState,
  startDate: string,
  endDate: string,
): CanonicalEvent[] {
  const result: CanonicalEvent[] = [];
  const assets = new Map(state.realEstateAssets.map((asset) => [asset.id, asset]));
  for (const asset of state.realEstateAssets) {
    if (asset.acquisitionDate)
      result.push(
        stateEvent({
          id: `${asset.id}:acquisition`,
          domain: "REAL_ESTATE",
          type: "ACQUISITION",
          date: asset.acquisitionDate,
          asOfDate: state.asOfDate,
          targetType: "property",
          targetId: asset.id,
          dataKind: dataKindOf(asset),
          confidence: confidenceOf(asset),
          source: sourceOf(asset),
          engine: "real-estate",
        }),
      );
    if (asset.disposalDate)
      result.push(
        stateEvent({
          id: `${asset.id}:disposal`,
          domain: "REAL_ESTATE",
          type: "DISPOSAL",
          date: asset.disposalDate,
          asOfDate: state.asOfDate,
          targetType: "property",
          targetId: asset.id,
          dataKind: dataKindOf(asset),
          confidence: confidenceOf(asset),
          source: sourceOf(asset),
          engine: "real-estate",
        }),
      );
  }
  for (const item of state.realEstateCapitalEvents) {
    const asset = assets.get(item.propertyId);
    const share = asset?.ownershipShare ?? null;
    const amount = share === null ? null : item.amount * share;
    const kind = dataKindOf(item);
    const isInflow = item.type === "DISPOSAL_PRICE";
    const isCost = item.type === "ACQUISITION_COST" || item.type === "DISPOSAL_COST";
    const linked = item.transactionId !== null;
    const blockers = amount === null ? ["REAL_ESTATE_OWNERSHIP_SHARE_MISSING"] : [];
    const fundingUnknown =
      item.type === "ACQUISITION_PRICE" && !linked && asset?.isDebtFinanced !== false;
    if (fundingUnknown) blockers.push("ACQUISITION_FUNDING_MISSING");
    const provenance = provenanceOf({
      source: sourceOf(item),
      sourceRecordId: item.id,
      engine: "real-estate",
      formulaReference: "Attributed domain capital event; financing remains in Debt",
    });
    const monthly = consequence({
      id: `real-estate:${item.id}:consequence`,
      economicDate: item.eventDate,
      sourceDomain: "REAL_ESTATE",
      sourceEntityId: item.propertyId,
      sourceEventId: `real-estate:${item.id}`,
      eventType: REAL_ESTATE_TYPE[item.type],
      effectKind: "CAPITAL_MOVEMENT",
      currency: item.currency,
      ...emptyAmounts(),
      cashIn: linked || !isInflow ? 0 : amount,
      cashOut: linked || isInflow ? 0 : fundingUnknown ? null : amount,
      expense: isCost ? amount : 0,
      fees: isCost ? amount : 0,
      assetDelta:
        item.type === "DISPOSAL_PRICE" || item.type === "DISPOSAL_COST"
          ? amount === null
            ? null
            : -amount
          : amount,
      economicCost: isCost ? amount : 0,
      dataKind: kind,
      confidence: confidenceOf(item),
      provenance,
      blockers,
      reconciliationKey: item.transactionId
        ? `transaction:${item.transactionId}`
        : `property-capital:${item.id}`,
      recognition: recognitionOf(kind),
    });
    result.push(
      event({
        id: `real-estate:${item.id}`,
        domain: "REAL_ESTATE",
        type: REAL_ESTATE_TYPE[item.type],
        effectiveDate: item.eventDate,
        eventDate: item.eventDate,
        dataKind: kind,
        confidence: confidenceOf(item),
        source: sourceOf(item),
        provenance,
        target: { entityType: "property", entityId: item.propertyId },
        status: statusAt(item.eventDate, state.asOfDate, "ONE_OFF"),
        shape: "ONE_OFF",
        effectiveConvention: "IMMEDIATE",
        sequence: 0,
        blockers,
        consequences: [monthly],
      }),
    );
  }
  const orderedTerms = [...state.realEstateOperatingTerms].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  for (const terms of orderedTerms) {
    const asset = assets.get(terms.propertyId);
    result.push(
      stateEvent({
        id: terms.id,
        domain: "REAL_ESTATE",
        type: "RENT_CHANGE",
        date: terms.effectiveFrom,
        asOfDate: state.asOfDate,
        targetType: "property",
        targetId: terms.propertyId,
        dataKind: dataKindOf(terms),
        confidence: confidenceOf(terms),
        source: sourceOf(terms),
        engine: "real-estate",
      }),
    );
    if (asset?.usage !== "RENTAL" && asset?.usage !== "MIXED_USE") continue;
    const next = orderedTerms.find(
      (candidate) =>
        candidate.propertyId === terms.propertyId && candidate.effectiveFrom > terms.effectiveFrom,
    );
    const termEnd = next ? next.effectiveFrom : endDate;
    const share = asset.ownershipShare;
    for (const month of monthsBetween(
      terms.effectiveFrom > startDate ? terms.effectiveFrom : startDate,
      termEnd < endDate ? termEnd : endDate,
    )) {
      const date = monthEnd(month);
      if (date < terms.effectiveFrom || date >= (next?.effectiveFrom ?? "9999-12-31")) continue;
      const blockers: string[] = [];
      if (share === null) blockers.push("REAL_ESTATE_OWNERSHIP_SHARE_MISSING");
      if (terms.annualGrossRent === null) blockers.push("REAL_ESTATE_RENT_MISSING");
      if (terms.vacancyRate === null) blockers.push("REAL_ESTATE_VACANCY_MISSING");
      const rent =
        share === null || terms.annualGrossRent === null || terms.vacancyRate === null
          ? null
          : (terms.annualGrossRent * (1 - terms.vacancyRate) * share) / 12;
      const costs = [
        terms.annualOperatingCharges,
        terms.annualPropertyTax,
        terms.annualInsurance,
        terms.annualMaintenance,
        terms.annualManagementFees,
        terms.annualOtherCosts,
      ];
      if (costs.some((value) => value === null))
        blockers.push("REAL_ESTATE_OPERATING_COSTS_MISSING");
      const cost =
        share === null || costs.some((value) => value === null)
          ? null
          : (costs.reduce<number>((sum, value) => sum + (value ?? 0), 0) * share) / 12;
      const provenance = provenanceOf({
        source: sourceOf(terms),
        sourceRecordId: terms.id,
        engine: "real-estate",
        formulaReference: "Declared annual operating terms / 12 at month boundary",
      });
      const id = `real-estate-rent:${terms.id}:${month}`;
      const common = {
        economicDate: date,
        sourceDomain: "REAL_ESTATE",
        sourceEntityId: terms.propertyId,
        sourceEventId: id,
        eventType: "RENT_RECEIPT",
        effectKind: "OPERATING",
        currency: terms.currency,
        dataKind: dataKindOf(terms),
        confidence: confidenceOf(terms),
        provenance,
        blockers,
        recognition: recognitionOf(dataKindOf(terms)),
      } as const;
      const rentConsequence = consequence({
        ...common,
        id: `${id}:rent`,
        ...emptyAmounts(),
        cashIn: rent,
        income: rent,
        reconciliationKey: `property:${terms.propertyId}:${month}:income`,
      });
      const costConsequence = consequence({
        ...common,
        id: `${id}:costs`,
        ...emptyAmounts(),
        cashOut: cost,
        expense: cost,
        economicCost: cost,
        reconciliationKey: `property:${terms.propertyId}:${month}:expense`,
      });
      result.push(
        event({
          id,
          domain: "REAL_ESTATE",
          type: "RENT_RECEIPT",
          effectiveDate: date,
          eventDate: date,
          dataKind: dataKindOf(terms),
          confidence: confidenceOf(terms),
          source: sourceOf(terms),
          provenance,
          target: { entityType: "property", entityId: terms.propertyId },
          status: statusAt(date, state.asOfDate, "SCHEDULE_CONSEQUENCE"),
          shape: "SCHEDULE_CONSEQUENCE",
          effectiveConvention: "MONTH_BOUNDARY",
          sequence: 0,
          blockers,
          consequences: [rentConsequence, costConsequence],
        }),
      );
    }
  }
  return result;
}

function businessEvents(state: DashboardState): CanonicalEvent[] {
  const result: CanonicalEvent[] = [];
  const capitalViews = new Map(
    (state.businessEquity?.positions ?? []).flatMap((position) =>
      position.capital.events.map((view) => [view.event.id, view] as const),
    ),
  );
  for (const ownership of state.businessOwnership ?? [])
    result.push(
      stateEvent({
        id: ownership.id,
        domain: "BUSINESS",
        type: "OWNERSHIP_CHANGE",
        date: ownership.effectiveDate,
        asOfDate: state.asOfDate,
        targetType: "business",
        targetId: ownership.businessId,
        dataKind: dataKindOf(ownership),
        confidence: confidenceOf(ownership),
        source: sourceOf(ownership),
        engine: "business-equity",
      }),
    );
  for (const valuation of state.businessValuations ?? [])
    result.push(
      stateEvent({
        id: valuation.id,
        domain: "BUSINESS",
        type: "VALUATION_OBSERVATION",
        date: valuation.valuationDate,
        asOfDate: state.asOfDate,
        targetType: "business",
        targetId: valuation.businessId,
        dataKind: dataKindOf(valuation),
        confidence: confidenceOf(valuation),
        source: sourceOf(valuation),
        engine: "business-equity",
      }),
    );
  for (const item of state.businessCapitalEvents ?? []) {
    const view = capitalViews.get(item.id);
    const amount = view?.userCash.value ?? (item.amountScope === "USER_CASH" ? item.amount : null);
    const investing = ["OPENING_COST_BASIS", "ACQUISITION", "CAPITAL_INJECTION"].includes(
      item.type,
    );
    const returning = !investing;
    const linked = item.transactionId !== null;
    const blockers =
      view?.userCash.blockers.map((blocker) => blocker.code) ??
      (amount === null ? ["BUSINESS_PERSONAL_CASH_MISSING"] : []);
    const kind = dataKindOf(item);
    const type = BUSINESS_TYPE[item.type];
    const provenance = provenanceOf({
      source: sourceOf(item),
      sourceRecordId: item.id,
      engine: "business-equity",
      formulaReference: "Business capital view personal cash; valuation stays in Business",
    });
    const monthly = consequence({
      id: `business:${item.id}:consequence`,
      economicDate: item.eventDate,
      sourceDomain: "BUSINESS",
      sourceEntityId: item.businessId,
      sourceEventId: `business:${item.id}`,
      eventType: type,
      effectKind:
        item.type === "DIVIDEND" || item.type === "DISTRIBUTION" ? "OPERATING" : "CAPITAL_MOVEMENT",
      currency: item.currency,
      ...emptyAmounts(),
      cashIn: linked || !returning ? 0 : amount,
      cashOut: linked || !investing ? 0 : amount,
      income: item.type === "DIVIDEND" || item.type === "DISTRIBUTION" ? amount : 0,
      fees: item.fees,
      expense: item.fees,
      assetDelta:
        amount === null
          ? null
          : investing
            ? amount
            : item.type === "SALE" || item.type === "BUYBACK"
              ? -amount
              : 0,
      economicCost: item.fees,
      dataKind: kind,
      confidence: confidenceOf(item),
      provenance,
      blockers,
      reconciliationKey: item.transactionId
        ? `transaction:${item.transactionId}`
        : `business:${item.id}`,
      recognition: recognitionOf(kind),
    });
    result.push(
      event({
        id: `business:${item.id}`,
        domain: "BUSINESS",
        type,
        effectiveDate: item.eventDate,
        eventDate: item.eventDate,
        dataKind: kind,
        confidence: confidenceOf(item),
        source: sourceOf(item),
        provenance,
        target: { entityType: "business", entityId: item.businessId },
        status: statusAt(item.eventDate, state.asOfDate, "ONE_OFF"),
        shape: "ONE_OFF",
        effectiveConvention: "IMMEDIATE",
        sequence: 0,
        blockers,
        consequences: [monthly],
      }),
    );
  }
  return result;
}

function effectKindOf(kind: CashFlowKind): EconomicEffectKind {
  if (kind === "DEBT_SERVICE") return "DEBT_SERVICE";
  if (kind === "TAX" || kind === "REFUND") return "TAX";
  if (kind === "INVESTMENT" || kind === "SAVING" || kind === "INTERNAL_TRANSFER")
    return "CAPITAL_MOVEMENT";
  return "OPERATING";
}

function actualTransactionEvent(
  state: DashboardState,
  item: Transaction,
  kind: CashFlowKind,
): CanonicalEvent {
  const propertyLinked = item.propertyId !== null;
  const domain: EventDomain = propertyLinked
    ? "REAL_ESTATE"
    : kind === "DEBT_SERVICE"
      ? "DEBT"
      : kind === "TAX" || kind === "REFUND"
        ? "TAX"
        : "CASH_FLOW";
  const inflow = item.amount >= 0;
  const amount = Math.abs(item.amount);
  const provenance = provenanceOf({
    source: sourceOf(item),
    sourceRecordId: item.id,
    engine: "cash-flow",
    formulaReference: "Observed bank transaction; nature from canonical cash-flow kind",
  });
  const propertyLeg =
    kind === "INCOME" || kind === "OTHER_INFLOW" || kind === "REFUND" ? "income" : "expense";
  const reconciliationKey =
    kind === "DEBT_SERVICE"
      ? `debt:${item.date.slice(0, 7)}`
      : propertyLinked
        ? `property:${item.propertyId}:${item.date.slice(0, 7)}:${propertyLeg}`
        : `transaction:${item.id}`;
  const monthly = consequence({
    id: `transaction:${item.id}:consequence`,
    economicDate: item.date,
    sourceDomain: domain,
    sourceEntityId: item.propertyId ?? item.accountId,
    sourceEventId: `transaction:${item.id}`,
    eventType: "OBSERVED_TRANSACTION",
    effectKind: effectKindOf(kind),
    currency: item.currency,
    ...emptyAmounts(),
    cashIn: inflow ? amount : 0,
    cashOut: inflow ? 0 : amount,
    income: kind === "INCOME" || kind === "OTHER_INFLOW" ? amount : 0,
    expense: kind === "EXPENSE" || kind === "OTHER_OUTFLOW" ? amount : 0,
    taxCash: kind === "TAX" ? amount : kind === "REFUND" ? -amount : 0,
    dataKind: "OBSERVED",
    confidence: confidenceOf(item),
    provenance,
    blockers: [],
    status: kind === "TAX" || kind === "REFUND" ? "AFTER_TAX_VERIFIED" : "PRE_TAX",
    reconciliationKey,
    recognition: "ACTUAL",
  });
  return event({
    id: `transaction:${item.id}`,
    domain,
    type: "OBSERVED_TRANSACTION",
    effectiveDate: item.date,
    eventDate: item.date,
    dataKind: "OBSERVED",
    confidence: confidenceOf(item),
    source: sourceOf(item),
    provenance,
    target: {
      entityType: propertyLinked ? "property" : "financial_account",
      entityId: item.propertyId ?? item.accountId,
    },
    status: "COMPLETED",
    shape: "ONE_OFF",
    effectiveConvention: "IMMEDIATE",
    sequence: 1000,
    blockers: [],
    consequences: [monthly],
  });
}

function cashFlowEvents(
  state: DashboardState,
  startDate: string,
  endDate: string,
): CanonicalEvent[] {
  const result: CanonicalEvent[] = [];
  const categories = categoryIndex(state.expenseCategories);
  const careerObserved = new Set(
    (state.careerTaxMonthly ?? []).flatMap((month) => month.observedTransactionIds),
  );
  const cashAlreadyCarriedByObservedFact = new Set([
    ...(state.taxObservations ?? []).flatMap((item) =>
      item.transactionId ? [item.transactionId] : [],
    ),
  ]);
  for (const item of state.transactions) {
    if (item.date < startDate || item.date > endDate || careerObserved.has(item.id)) continue;
    // La jambe liée est déjà la provenance du fait de domaine. Elle reste lisible dans le
    // ledger bancaire, mais l'ajouter ici compterait le même cash deux fois.
    if (cashAlreadyCarriedByObservedFact.has(item.id)) continue;
    result.push(actualTransactionEvent(state, item, effectiveCashFlowKind(item, categories)));
  }
  for (const rule of state.recurringRules) {
    for (const occurrence of recurringOccurrences(rule, startDate, endDate)) {
      const kind = dataKindOf(rule);
      const provenance = provenanceOf({
        source: sourceOf(rule),
        sourceRecordId: rule.id,
        engine: "cash-flow",
        formulaReference: "Declared recurring rule occurrence",
      });
      const inflow = occurrence.amount >= 0;
      const amount = Math.abs(occurrence.amount);
      const id = `cash-flow-rule:${rule.id}:${occurrence.date}`;
      const monthly = consequence({
        id: `${id}:consequence`,
        economicDate: occurrence.date,
        sourceDomain: "CASH_FLOW",
        sourceEntityId: rule.id,
        sourceEventId: id,
        eventType: "RECURRING_CASH_FLOW",
        effectKind: effectKindOf(rule.cashFlowKind),
        currency: state.reportingCurrency,
        ...emptyAmounts(),
        cashIn: inflow ? amount : 0,
        cashOut: inflow ? 0 : amount,
        income: rule.cashFlowKind === "INCOME" ? amount : 0,
        expense: rule.cashFlowKind === "EXPENSE" ? amount : 0,
        taxCash: rule.cashFlowKind === "TAX" ? amount : 0,
        dataKind: kind,
        confidence: confidenceOf(rule),
        provenance,
        blockers: [],
        reconciliationKey: `recurring-rule:${rule.id}:${occurrence.date.slice(0, 7)}`,
        recognition: recognitionOf(kind),
      });
      result.push(
        event({
          id,
          domain: "CASH_FLOW",
          type: "RECURRING_CASH_FLOW",
          effectiveDate: occurrence.date,
          eventDate: occurrence.date,
          dataKind: kind,
          confidence: confidenceOf(rule),
          source: sourceOf(rule),
          provenance,
          target: { entityType: "recurring_cash_flow_rule", entityId: rule.id },
          status: statusAt(occurrence.date, state.asOfDate, "SCHEDULE_CONSEQUENCE"),
          shape: "SCHEDULE_CONSEQUENCE",
          effectiveConvention: "MONTH_BOUNDARY",
          sequence: 0,
          blockers: [],
          consequences: [monthly],
        }),
      );
    }
  }
  return result;
}

/** Projection unifiée : aucune ligne n'est persistée et aucun moteur n'est recalculé ici. */
export function buildDashboardEventTimeline(input: {
  state: DashboardState;
  startDate: string;
  endDate: string;
}): CanonicalTimeline {
  const { state, startDate, endDate } = input;
  const events = [
    ...careerEvents(state, startDate, endDate),
    ...taxEvents(state),
    ...debtEvents(state, startDate, endDate),
    ...portfolioEvents(state),
    ...realEstateEvents(state, startDate, endDate),
    ...businessEvents(state),
    ...cashFlowEvents(state, startDate, endDate),
  ];
  return buildCanonicalTimeline({ events, startDate, endDate });
}
