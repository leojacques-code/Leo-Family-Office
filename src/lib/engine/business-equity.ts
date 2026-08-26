import type { CanonicalBalanceSheetContribution } from '@/lib/engine/balance-sheet';
import { resolveFxRate, type CurrencyRate } from '@/lib/engine/fx';
import type { Provenance } from '@/lib/types';

/** Business Equity V2: facts in, derived economics out. No valuation, PnL or return is persisted. */
export const BUSINESS_TYPES = ['OPERATING', 'HOLDING', 'STARTUP', 'SPV', 'OTHER'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const BUSINESS_VALUATION_METHODS = [
  'EXTERNAL_APPRAISAL',
  'TRANSACTION',
  'EBITDA_MULTIPLE',
  'REVENUE_MULTIPLE',
  'DCF',
  'FUNDING_ROUND',
  'USER_ESTIMATE',
  'LOOK_THROUGH',
] as const;
export type BusinessValuationMethod = (typeof BUSINESS_VALUATION_METHODS)[number];
export const BUSINESS_CAPITAL_EVENT_TYPES = [
  'OPENING_COST_BASIS',
  'ACQUISITION',
  'CAPITAL_INJECTION',
  'SALE',
  'DIVIDEND',
  'DISTRIBUTION',
  'CAPITAL_RETURN',
] as const;
export type BusinessCapitalEventType = (typeof BUSINESS_CAPITAL_EVENT_TYPES)[number];

export interface BusinessEntity {
  id: string;
  name: string;
  legalForm: string | null;
  type: BusinessType | null;
  functionalCurrency: string | null;
  archived: boolean;
  notes: string | null;
  provenance: Provenance;
}
export interface BusinessOwnership {
  id: string;
  businessId: string;
  effectiveDate: string;
  legalRate: number;
  economicRate: number | null;
  votingRate: number | null;
  fullyDilutedRate: number | null;
  notes: string | null;
  provenance: Provenance;
}
export interface BusinessFinancialSnapshot {
  id: string;
  businessId: string;
  periodEnd: string;
  currency: string | null;
  revenue: number | null;
  grossMargin: number | null;
  ebitda: number | null;
  ebit: number | null;
  netIncome: number | null;
  cash: number | null;
  grossDebt: number | null;
  workingCapital: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  notes: string | null;
  provenance: Provenance;
}
export interface BusinessValuation {
  id: string;
  businessId: string;
  valuationDate: string;
  currency: string | null;
  method: BusinessValuationMethod;
  enterpriseValue: number | null;
  equityValue: number | null;
  valuationMultiple: number | null;
  notes: string | null;
  provenance: Provenance;
}
export interface BusinessCapitalEvent {
  id: string;
  businessId: string;
  type: BusinessCapitalEventType;
  eventDate: string;
  amount: number;
  currency: string;
  ownershipDelta: number | null;
  transactionId: string | null;
  notes: string | null;
  provenance: Provenance;
}
export interface BusinessHoldingLink {
  id: string;
  parentBusinessId: string;
  childBusinessId: string;
  effectiveDate: string;
  ownershipRate: number;
  notes: string | null;
  provenance: Provenance;
}

export type BusinessMetricStatus = 'COMPLETE' | 'NOT_COMPUTABLE';
export interface BusinessMetric {
  value: number | null;
  status: BusinessMetricStatus;
  blockers: string[];
  flags: string[];
}
const known = (value: number, flags: string[] = []): BusinessMetric => ({ value, status: 'COMPLETE', blockers: [], flags: [...new Set(flags)] });
const nc = (blockers: string[], flags: string[] = []): BusinessMetric => ({ value: null, status: 'NOT_COMPUTABLE', blockers: [...new Set(blockers)], flags: [...new Set(flags)] });

export interface BusinessEquityPosition {
  business: BusinessEntity;
  ownership: BusinessOwnership | null;
  latestFinancials: BusinessFinancialSnapshot | null;
  latestValuation: BusinessValuation | null;
  enterpriseValue: BusinessMetric;
  netDebt: BusinessMetric;
  wholeEquityValue: BusinessMetric;
  attributableValue: BusinessMetric;
  investedCapital: BusinessMetric;
  cashReturned: BusinessMetric;
  economicGain: BusinessMetric;
  moic: BusinessMetric;
  xirr: BusinessMetric;
  ebitdaMargin: BusinessMetric;
  netDebtToEbitda: BusinessMetric;
  quality: { blockers: string[]; flags: string[] };
}
export interface BusinessEquityPortfolio {
  asOfDate: string;
  reportingCurrency: string;
  positions: BusinessEquityPosition[];
  totalAttributableValue: BusinessMetric;
  quality: { blockers: string[]; flags: string[] };
}
export interface BuildBusinessEquityInput {
  asOfDate: string;
  reportingCurrency: string;
  businesses: BusinessEntity[];
  ownership: BusinessOwnership[];
  financials: BusinessFinancialSnapshot[];
  valuations: BusinessValuation[];
  capitalEvents: BusinessCapitalEvent[];
  holdings: BusinessHoldingLink[];
  currencyRates?: CurrencyRate[];
}

const latestAt = <T>(rows: T[], date: string, dateOf: (row: T) => string): T | null =>
  [...rows].filter((row) => dateOf(row) <= date).sort((a, b) => dateOf(b).localeCompare(dateOf(a)))[0] ?? null;

function convert(amount: number | null, currency: string | null, date: string, target: string, rates: CurrencyRate[], blocker: string): BusinessMetric {
  if (amount === null) return nc([blocker]);
  if (!currency) return nc([`${blocker}:CURRENCY_UNKNOWN`]);
  const fx = resolveFxRate(currency, target, date, rates);
  if (fx.rate === null) return nc(fx.flags.length ? fx.flags : [`FX_MISSING:${currency}/${target}@${date}`]);
  return known(amount * fx.rate, fx.flags);
}

function daysBetween(a: string, b: string) {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}
function xnpv(rate: number, flows: Array<{ date: string; amount: number }>) {
  const start = flows[0].date;
  return flows.reduce((sum, flow) => sum + flow.amount / (1 + rate) ** (daysBetween(start, flow.date) / 365), 0);
}
function xirrMetric(flows: Array<{ date: string; amount: number }>): BusinessMetric {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return nc(['XIRR_CASH_FLOW_SIGNS_INVALID']);
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const brackets: Array<[number, number]> = [];
  let py = -13.8;
  let pv = xnpv(Math.exp(py) - 1, sorted);
  for (let i = 1; i <= 1600; i++) {
    const y = -13.8 + (23.8 * i) / 1600;
    const v = xnpv(Math.exp(y) - 1, sorted);
    if (Number.isFinite(v) && Number.isFinite(pv) && Math.sign(v) !== Math.sign(pv)) brackets.push([py, y]);
    py = y; pv = v;
  }
  if (brackets.length === 0) return nc(['XIRR_NO_SOLUTION']);
  if (brackets.length > 1) return nc(['XIRR_MULTIPLE_SOLUTIONS']);
  let [lo, hi] = brackets[0];
  for (let i = 0; i < 160 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(xnpv(Math.exp(lo) - 1, sorted)) === Math.sign(xnpv(Math.exp(mid) - 1, sorted))) lo = mid; else hi = mid;
  }
  const value = Math.exp((lo + hi) / 2) - 1;
  return Number.isFinite(value) ? known(value) : nc(['XIRR_NUMERICAL_FAILURE']);
}

export function buildBusinessEquityPortfolio(input: BuildBusinessEquityInput): BusinessEquityPortfolio {
  const rates = input.currencyRates ?? [];
  const memo = new Map<string, BusinessMetric>();
  const visiting = new Set<string>();

  const wholeEquity = (businessId: string): BusinessMetric => {
    if (memo.has(businessId)) return memo.get(businessId)!;
    if (visiting.has(businessId)) return nc([`BUSINESS_HOLDING_CYCLE:${businessId}`]);
    visiting.add(businessId);
    const vals = input.valuations.filter((v) => v.businessId === businessId);
    const val = latestAt(vals, input.asOfDate, (v) => v.valuationDate);
    if (val?.equityValue !== null && val?.equityValue !== undefined) {
      const result = convert(val.equityValue, val.currency, val.valuationDate, input.reportingCurrency, rates, `EQUITY_VALUE_MISSING:${businessId}`);
      memo.set(businessId, result); visiting.delete(businessId); return result;
    }
    if (val?.enterpriseValue !== null && val?.enterpriseValue !== undefined) {
      const financial = latestAt(input.financials.filter((f) => f.businessId === businessId), val.valuationDate, (f) => f.periodEnd);
      if (!financial || financial.grossDebt === null || financial.cash === null) {
        const result = nc([`EV_TO_EQUITY_BRIDGE_MISSING:${businessId}`]);
        memo.set(businessId, result); visiting.delete(businessId); return result;
      }
      const ev = convert(val.enterpriseValue, val.currency, val.valuationDate, input.reportingCurrency, rates, `ENTERPRISE_VALUE_MISSING:${businessId}`);
      const debt = convert(financial.grossDebt, financial.currency, financial.periodEnd, input.reportingCurrency, rates, `GROSS_DEBT_MISSING:${businessId}`);
      const cash = convert(financial.cash, financial.currency, financial.periodEnd, input.reportingCurrency, rates, `CASH_MISSING:${businessId}`);
      if (ev.value === null || debt.value === null || cash.value === null) {
        const result = nc([...ev.blockers, ...debt.blockers, ...cash.blockers], [...ev.flags, ...debt.flags, ...cash.flags]);
        memo.set(businessId, result); visiting.delete(businessId); return result;
      }
      const result = known(ev.value - debt.value + cash.value, [...ev.flags, ...debt.flags, ...cash.flags]);
      memo.set(businessId, result); visiting.delete(businessId); return result;
    }

    const children = input.holdings
      .filter((link) => link.parentBusinessId === businessId && link.effectiveDate <= input.asOfDate)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
      .filter((link, index, all) => all.findIndex((x) => x.childBusinessId === link.childBusinessId) === index);
    if (children.length) {
      const financial = latestAt(input.financials.filter((f) => f.businessId === businessId), input.asOfDate, (f) => f.periodEnd);
      if (!financial || financial.grossDebt === null || financial.cash === null) {
        const result = nc([`HOLDING_STANDALONE_NET_DEBT_MISSING:${businessId}`]);
        memo.set(businessId, result); visiting.delete(businessId); return result;
      }
      let total = 0;
      const blockers: string[] = [];
      const flags = ['LOOK_THROUGH_VALUATION'];
      for (const link of children) {
        const child = wholeEquity(link.childBusinessId);
        if (child.value === null) blockers.push(...child.blockers); else total += child.value * link.ownershipRate;
        flags.push(...child.flags);
      }
      const debt = convert(financial.grossDebt, financial.currency, financial.periodEnd, input.reportingCurrency, rates, `HOLDING_DEBT_MISSING:${businessId}`);
      const cash = convert(financial.cash, financial.currency, financial.periodEnd, input.reportingCurrency, rates, `HOLDING_CASH_MISSING:${businessId}`);
      if (debt.value === null || cash.value === null) blockers.push(...debt.blockers, ...cash.blockers);
      if (blockers.length) {
        const result = nc(blockers, [...flags, ...debt.flags, ...cash.flags]); memo.set(businessId, result); visiting.delete(businessId); return result;
      }
      const result = known(total - debt.value! + cash.value!, [...flags, ...debt.flags, ...cash.flags]);
      memo.set(businessId, result); visiting.delete(businessId); return result;
    }
    const result = nc([`BUSINESS_VALUATION_MISSING:${businessId}`]);
    memo.set(businessId, result); visiting.delete(businessId); return result;
  };

  const positions = input.businesses.filter((b) => !b.archived).map((business): BusinessEquityPosition => {
    const ownership = latestAt(input.ownership.filter((o) => o.businessId === business.id), input.asOfDate, (o) => o.effectiveDate);
    const financial = latestAt(input.financials.filter((f) => f.businessId === business.id), input.asOfDate, (f) => f.periodEnd);
    const valuation = latestAt(input.valuations.filter((v) => v.businessId === business.id), input.asOfDate, (v) => v.valuationDate);
    const whole = wholeEquity(business.id);
    const ev = valuation?.enterpriseValue != null ? convert(valuation.enterpriseValue, valuation.currency, valuation.valuationDate, input.reportingCurrency, rates, `ENTERPRISE_VALUE_MISSING:${business.id}`) : nc([`ENTERPRISE_VALUE_NOT_DECLARED:${business.id}`]);
    let netDebt = nc([`NET_DEBT_MISSING:${business.id}`]);
    if (financial?.grossDebt != null && financial.cash != null) {
      const debt = convert(financial.grossDebt, financial.currency, financial.periodEnd, input.reportingCurrency, rates, `GROSS_DEBT_MISSING:${business.id}`);
      const cash = convert(financial.cash, financial.currency, financial.periodEnd, input.reportingCurrency, rates, `CASH_MISSING:${business.id}`);
      if (debt.value !== null && cash.value !== null) netDebt = known(debt.value - cash.value, [...debt.flags, ...cash.flags]);
    }
    const attributable = !ownership ? nc([`OWNERSHIP_MISSING:${business.id}`]) : ownership.economicRate === null ? nc([`ECONOMIC_OWNERSHIP_MISSING:${business.id}`]) : whole.value === null ? nc(whole.blockers, whole.flags) : known(whole.value * ownership.economicRate, whole.flags);

    const events = input.capitalEvents.filter((e) => e.businessId === business.id && e.eventDate <= input.asOfDate).sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    const investedEvents = events.filter((e) => ['OPENING_COST_BASIS', 'ACQUISITION', 'CAPITAL_INJECTION'].includes(e.type));
    const returnedEvents = events.filter((e) => ['SALE', 'DIVIDEND', 'DISTRIBUTION', 'CAPITAL_RETURN'].includes(e.type));
    const convertEvents = (rows: BusinessCapitalEvent[]) => rows.map((event) => convert(event.amount, event.currency, event.eventDate, input.reportingCurrency, rates, `CAPITAL_EVENT_AMOUNT_MISSING:${event.id}`));
    const sumMetrics = (items: BusinessMetric[], missing: string): BusinessMetric => {
      const blockers = items.flatMap((m) => m.blockers); const flags = items.flatMap((m) => m.flags);
      return blockers.length ? nc(blockers, flags) : items.length ? known(items.reduce((s, m) => s + m.value!, 0), flags) : nc([missing]);
    };
    const invested = sumMetrics(convertEvents(investedEvents), `COST_BASIS_HISTORY_MISSING:${business.id}`);
    const cashReturned = returnedEvents.length ? sumMetrics(convertEvents(returnedEvents), `CASH_RETURN_HISTORY_MISSING:${business.id}`) : known(0);
    const economicGain = invested.value === null || attributable.value === null ? nc([...(invested.blockers ?? []), ...(attributable.blockers ?? [])]) : known(attributable.value + cashReturned.value! - invested.value);
    const moic = invested.value === null || attributable.value === null || invested.value <= 0 ? nc([...(invested.blockers ?? []), ...(attributable.blockers ?? []), ...(invested.value === 0 ? ['ZERO_INVESTED_CAPITAL'] : [])]) : known((attributable.value + cashReturned.value!) / invested.value);

    const datedFlows: Array<{ date: string; amount: number }> = [];
    let flowBlocked = false;
    for (const event of events) {
      if (!['OPENING_COST_BASIS', 'ACQUISITION', 'CAPITAL_INJECTION', 'SALE', 'DIVIDEND', 'DISTRIBUTION', 'CAPITAL_RETURN'].includes(event.type)) continue;
      const converted = convert(event.amount, event.currency, event.eventDate, input.reportingCurrency, rates, `CAPITAL_EVENT_AMOUNT_MISSING:${event.id}`);
      if (converted.value === null) { flowBlocked = true; continue; }
      const negative = ['OPENING_COST_BASIS', 'ACQUISITION', 'CAPITAL_INJECTION'].includes(event.type);
      datedFlows.push({ date: event.eventDate, amount: negative ? -converted.value : converted.value });
    }
    if (attributable.value !== null) datedFlows.push({ date: input.asOfDate, amount: attributable.value }); else flowBlocked = true;
    const xirr = flowBlocked ? nc(['XIRR_INPUTS_INCOMPLETE']) : xirrMetric(datedFlows);
    const ebitdaMargin = financial?.revenue != null && financial.ebitda != null && financial.revenue !== 0 ? known(financial.ebitda / financial.revenue) : nc([`EBITDA_MARGIN_INPUTS_MISSING:${business.id}`]);
    const leverage = netDebt.value !== null && financial?.ebitda != null && financial.ebitda > 0 && financial.currency === input.reportingCurrency ? known(netDebt.value / financial.ebitda) : nc([`NET_DEBT_TO_EBITDA_INPUTS_MISSING:${business.id}`]);
    const flags = [...new Set([...(whole.flags ?? []), ...(valuation && daysBetween(valuation.valuationDate, input.asOfDate) > 365 ? ['VALUATION_STALE_GT_365D'] : [])])];
    const blockers = [...new Set([...(whole.blockers ?? []), ...(attributable.blockers ?? [])])];
    return { business, ownership, latestFinancials: financial, latestValuation: valuation, enterpriseValue: ev, netDebt, wholeEquityValue: whole, attributableValue: attributable, investedCapital: invested, cashReturned, economicGain, moic, xirr, ebitdaMargin, netDebtToEbitda: leverage, quality: { blockers, flags } };
  }).sort((a, b) => (b.attributableValue.value ?? -Infinity) - (a.attributableValue.value ?? -Infinity));

  const direct = positions.filter((p) => p.ownership && p.ownership.economicRate !== null);
  const blockers = direct.flatMap((p) => p.attributableValue.blockers);
  const total = blockers.length ? nc(blockers) : known(direct.reduce((sum, p) => sum + (p.attributableValue.value ?? 0), 0));
  return { asOfDate: input.asOfDate, reportingCurrency: input.reportingCurrency, positions, totalAttributableValue: total, quality: { blockers: [...new Set(blockers)], flags: [...new Set(positions.flatMap((p) => p.quality.flags))] } };
}

export function businessEquityBalanceSheetContributions(portfolio: BusinessEquityPortfolio): CanonicalBalanceSheetContribution[] {
  return portfolio.positions
    .filter((position) => position.ownership !== null && position.ownership.economicRate !== null)
    .map((position) => ({
      id: `business-equity:${position.business.id}`,
      entityId: position.business.id,
      domain: 'BUSINESS_EQUITY' as const,
      side: 'ASSET' as const,
      category: position.business.type === 'HOLDING' ? 'HOLDING_EQUITY' : 'PRIVATE_BUSINESS_EQUITY',
      nativeValue: position.attributableValue.value,
      valuationBlockers: position.attributableValue.value === null ? position.attributableValue.blockers : undefined,
      currency: portfolio.reportingCurrency,
      valuationDate: position.latestValuation?.valuationDate ?? portfolio.asOfDate,
      valuationMethod: position.latestValuation?.method === 'USER_ESTIMATE' ? 'USER_ESTIMATE' as const : position.latestValuation ? 'EXTERNAL_VALUATION' as const : 'MODEL_ESTIMATE' as const,
      valuationStatus: position.latestValuation && daysBetween(position.latestValuation.valuationDate, portfolio.asOfDate) > 365 ? 'STALE' as const : position.attributableValue.value === null ? 'MISSING' as const : 'CURRENT' as const,
      liquidity: 'ILLIQUID' as const,
      provenance: position.latestValuation?.provenance ?? position.business.provenance,
      confidence: position.latestValuation?.provenance.confidence ?? position.business.provenance.confidence,
      source: position.latestValuation?.provenance.source,
      reconciliationState: 'NOT_APPLICABLE' as const,
      isAccountingPrimary: true,
      flags: position.quality.flags,
    }));
}
