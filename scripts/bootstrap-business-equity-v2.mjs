import fs from 'node:fs';

const write = (path, content) => {
  fs.mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  fs.writeFileSync(path, content);
};
const patch = (path, needle, replacement) => {
  const current = fs.readFileSync(path, 'utf8');
  if (!current.includes(needle)) throw new Error(`Patch anchor missing in ${path}: ${needle.slice(0, 120)}`);
  fs.writeFileSync(path, current.replace(needle, replacement));
};

write('src/lib/engine/business-equity.ts', String.raw`import type { CanonicalBalanceSheetContribution } from '@/lib/engine/balance-sheet';
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
  unrealisedPnL: BusinessMetric;
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
    const unrealisedPnL = invested.value === null || attributable.value === null ? nc([...(invested.blockers ?? []), ...(attributable.blockers ?? [])]) : known(attributable.value + cashReturned.value! - invested.value);
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
    return { business, ownership, latestFinancials: financial, latestValuation: valuation, enterpriseValue: ev, netDebt, wholeEquityValue: whole, attributableValue: attributable, investedCapital: invested, cashReturned, unrealisedPnL, moic, xirr, ebitdaMargin, netDebtToEbitda: leverage, quality: { blockers, flags } };
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
`);

write('src/lib/engine/business-equity-scenarios.ts', String.raw`export interface BusinessHoldScenarioInput { currentEquityValue: number; years: number; annualGrowthRate: number; annualDistributions: number; }
export interface BusinessSaleScenarioInput { currentEquityValue: number; economicOwnershipRate: number; saleFraction: number; transactionFeeRate: number; effectiveTaxRate: number | null; }
export interface BusinessRaiseScenarioInput { preMoneyEquityValue: number; primaryNewMoney: number; currentOwnershipRate: number; investorContribution: number; preferredRightsKnown: boolean; }
export const projectBusinessHold = (input: BusinessHoldScenarioInput) => ({
  terminalEquityValue: input.currentEquityValue * (1 + input.annualGrowthRate) ** input.years,
  cumulativeDistributions: input.annualDistributions * input.years,
  flags: ['MODEL_ASSUMPTION'],
});
export const projectBusinessSale = (input: BusinessSaleScenarioInput) => {
  const grossProceeds = input.currentEquityValue * input.economicOwnershipRate * input.saleFraction;
  const transactionFees = grossProceeds * input.transactionFeeRate;
  const preTaxNetProceeds = grossProceeds - transactionFees;
  return { grossProceeds, transactionFees, preTaxNetProceeds, afterTaxNetProceeds: input.effectiveTaxRate === null ? null : preTaxNetProceeds * (1 - input.effectiveTaxRate), flags: input.effectiveTaxRate === null ? ['TAX_RATE_NOT_DECLARED'] : [] };
};
export const projectBusinessRaise = (input: BusinessRaiseScenarioInput) => {
  const postMoney = input.preMoneyEquityValue + input.primaryNewMoney;
  const oldHolderValue = input.currentOwnershipRate * input.preMoneyEquityValue + input.investorContribution;
  const postOwnership = postMoney === 0 ? null : oldHolderValue / postMoney;
  return { postMoneyEquityValue: postMoney, postOwnershipRate: postOwnership, dilution: postOwnership === null ? null : input.currentOwnershipRate - postOwnership, flags: input.preferredRightsKnown ? [] : ['PREFERRED_RIGHTS_NOT_MODELLED'] };
};
`);

write('src/lib/engine/__tests__/business-equity.test.ts', String.raw`import { describe, expect, it } from 'vitest';
import { buildBusinessEquityPortfolio } from '@/lib/engine/business-equity';
const p = { kind: 'ACTUAL' as const, confidence: 'HIGH' as const };
const base = { asOfDate: '2026-08-26', reportingCurrency: 'EUR', holdings: [], currencyRates: [] };
describe('Business Equity V2', () => {
  it('bridges EV to equity and never makes corporate debt personal', () => {
    const result = buildBusinessEquityPortfolio({ ...base, businesses: [{ id:'b', name:'PME', legalForm:'SAS', type:'OPERATING', functionalCurrency:'EUR', archived:false, notes:null, provenance:p }], ownership:[{ id:'o', businessId:'b', effectiveDate:'2025-01-01', legalRate:.7, economicRate:.7, votingRate:.7, fullyDilutedRate:.7, notes:null, provenance:p }], financials:[{ id:'f', businessId:'b', periodEnd:'2026-06-30', currency:'EUR', revenue:4_800_000, grossMargin:null, ebitda:650_000, ebit:null, netIncome:null, cash:300_000, grossDebt:1_100_000, workingCapital:null, capex:null, freeCashFlow:null, notes:null, provenance:p }], valuations:[{ id:'v', businessId:'b', valuationDate:'2026-06-30', currency:'EUR', method:'EBITDA_MULTIPLE', enterpriseValue:3_900_000, equityValue:null, valuationMultiple:6, notes:null, provenance:p }], capitalEvents:[{ id:'c', businessId:'b', type:'OPENING_COST_BASIS', eventDate:'2020-01-01', amount:500_000, currency:'EUR', ownershipDelta:.7, transactionId:null, notes:null, provenance:p }] });
    expect(result.positions[0].netDebt.value).toBe(800_000);
    expect(result.positions[0].wholeEquityValue.value).toBe(3_100_000);
    expect(result.positions[0].attributableValue.value).toBe(2_170_000);
  });
  it('refuses EV × ownership when net debt is unknown', () => {
    const result = buildBusinessEquityPortfolio({ ...base, businesses:[{ id:'b', name:'Target', legalForm:null, type:'OPERATING', functionalCurrency:'EUR', archived:false, notes:null, provenance:p }], ownership:[{ id:'o', businessId:'b', effectiveDate:'2025-01-01', legalRate:.3, economicRate:.3, votingRate:null, fullyDilutedRate:null, notes:null, provenance:p }], financials:[], valuations:[{ id:'v', businessId:'b', valuationDate:'2026-01-01', currency:'EUR', method:'EXTERNAL_APPRAISAL', enterpriseValue:12_000_000, equityValue:null, valuationMultiple:null, notes:null, provenance:p }], capitalEvents:[] });
    expect(result.positions[0].wholeEquityValue.value).toBeNull();
    expect(result.positions[0].wholeEquityValue.blockers).toContain('EV_TO_EQUITY_BRIDGE_MISSING:b');
  });
  it('does not invent zero cost basis when acquisition history is absent', () => {
    const result = buildBusinessEquityPortfolio({ ...base, businesses:[{ id:'b', name:'Startup', legalForm:null, type:'STARTUP', functionalCurrency:'EUR', archived:false, notes:null, provenance:p }], ownership:[{ id:'o', businessId:'b', effectiveDate:'2025-01-01', legalRate:.2, economicRate:.2, votingRate:null, fullyDilutedRate:.2, notes:null, provenance:p }], financials:[], valuations:[{ id:'v', businessId:'b', valuationDate:'2026-01-01', currency:'EUR', method:'FUNDING_ROUND', enterpriseValue:null, equityValue:10_000_000, valuationMultiple:null, notes:null, provenance:p }], capitalEvents:[] });
    expect(result.positions[0].attributableValue.value).toBe(2_000_000);
    expect(result.positions[0].investedCapital.value).toBeNull();
    expect(result.positions[0].unrealisedPnL.value).toBeNull();
    expect(result.positions[0].moic.value).toBeNull();
  });
  it('derives a holding look-through without double-counting the child as a personal asset', () => {
    const businesses = [
      { id:'h', name:'HoldCo', legalForm:'SAS', type:'HOLDING' as const, functionalCurrency:'EUR', archived:false, notes:null, provenance:p },
      { id:'c', name:'OpCo', legalForm:'SAS', type:'OPERATING' as const, functionalCurrency:'EUR', archived:false, notes:null, provenance:p },
    ];
    const result = buildBusinessEquityPortfolio({ ...base, businesses, ownership:[{ id:'o', businessId:'h', effectiveDate:'2025-01-01', legalRate:.8, economicRate:.8, votingRate:.8, fullyDilutedRate:.8, notes:null, provenance:p }], financials:[{ id:'fh', businessId:'h', periodEnd:'2026-06-30', currency:'EUR', revenue:null, grossMargin:null, ebitda:null, ebit:null, netIncome:null, cash:200_000, grossDebt:400_000, workingCapital:null, capex:null, freeCashFlow:null, notes:null, provenance:p }], valuations:[{ id:'vc', businessId:'c', valuationDate:'2026-06-30', currency:'EUR', method:'EXTERNAL_APPRAISAL', enterpriseValue:null, equityValue:5_000_000, valuationMultiple:null, notes:null, provenance:p }], capitalEvents:[{ id:'cb', businessId:'h', type:'OPENING_COST_BASIS', eventDate:'2020-01-01', amount:100_000, currency:'EUR', ownershipDelta:.8, transactionId:null, notes:null, provenance:p }], holdings:[{ id:'l', parentBusinessId:'h', childBusinessId:'c', effectiveDate:'2025-01-01', ownershipRate:.6, notes:null, provenance:p }] });
    expect(result.positions.find((x)=>x.business.id==='h')?.wholeEquityValue.value).toBe(2_800_000);
    expect(result.positions.find((x)=>x.business.id==='h')?.attributableValue.value).toBe(2_240_000);
    expect(result.totalAttributableValue.value).toBe(2_240_000);
  });
});
`);

write('supabase/migrations/20260826140000_business_equity_v2.sql', String.raw`-- Business Equity V2 — facts only; valuation/performance remain derived in TypeScript.
alter table public.businesses
  add column if not exists business_type text,
  add column if not exists functional_currency char(3),
  add column if not exists archived boolean not null default false,
  add column if not exists data_kind text not null default 'USER_ASSUMPTION',
  add column if not exists confidence text not null default 'HIGH',
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.business_ownership
  add column if not exists economic_rate numeric(12,8),
  add column if not exists voting_rate numeric(12,8),
  add column if not exists fully_diluted_rate numeric(12,8),
  add column if not exists data_kind text not null default 'USER_ASSUMPTION',
  add column if not exists confidence text not null default 'HIGH',
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

alter table public.business_financials
  add column if not exists currency char(3),
  add column if not exists ebit numeric(20,6),
  add column if not exists net_income numeric(20,6),
  add column if not exists capex numeric(20,6),
  add column if not exists free_cash_flow numeric(20,6),
  add column if not exists confidence text not null default 'MEDIUM',
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

alter table public.business_valuations
  alter column enterprise_value drop not null,
  alter column equity_value drop not null,
  add column if not exists currency char(3),
  add column if not exists valuation_multiple numeric(20,8),
  add column if not exists confidence text not null default 'MEDIUM',
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists businesses_id_user_uidx on public.businesses(id, user_id);
create unique index if not exists transactions_id_user_uidx on public.transactions(id, user_id);

alter table public.business_ownership drop constraint if exists business_ownership_business_id_fkey;
alter table public.business_financials drop constraint if exists business_financials_business_id_fkey;
alter table public.business_valuations drop constraint if exists business_valuations_business_id_fkey;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='business_ownership_business_fk') then
    alter table public.business_ownership add constraint business_ownership_business_fk foreign key (business_id,user_id) references public.businesses(id,user_id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='business_financials_business_fk') then
    alter table public.business_financials add constraint business_financials_business_fk foreign key (business_id,user_id) references public.businesses(id,user_id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='business_valuations_business_fk') then
    alter table public.business_valuations add constraint business_valuations_business_fk foreign key (business_id,user_id) references public.businesses(id,user_id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='business_ownership_rates_ck') then
    alter table public.business_ownership add constraint business_ownership_rates_ck check (
      ownership_rate > 0 and ownership_rate <= 1 and
      (economic_rate is null or (economic_rate > 0 and economic_rate <= 1)) and
      (voting_rate is null or (voting_rate >= 0 and voting_rate <= 1)) and
      (fully_diluted_rate is null or (fully_diluted_rate > 0 and fully_diluted_rate <= 1))
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='business_valuations_value_ck') then
    alter table public.business_valuations add constraint business_valuations_value_ck check (enterprise_value is not null or equity_value is not null);
  end if;
end $$;

create unique index if not exists business_ownership_effective_uk on public.business_ownership(user_id,business_id,effective_date);
create index if not exists business_ownership_business_owner_idx on public.business_ownership(business_id,user_id);
create index if not exists business_financials_business_owner_idx on public.business_financials(business_id,user_id);
create index if not exists business_valuations_business_owner_idx on public.business_valuations(business_id,user_id);

create table if not exists public.business_capital_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null,
  event_type text not null,
  event_date date not null,
  amount numeric(20,6) not null,
  currency char(3) not null,
  ownership_delta numeric(12,8),
  transaction_id uuid,
  data_kind text not null default 'ACTUAL',
  confidence text not null default 'HIGH',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint business_capital_events_business_fk foreign key (business_id,user_id) references public.businesses(id,user_id) on delete cascade,
  constraint business_capital_events_transaction_fk foreign key (transaction_id,user_id) references public.transactions(id,user_id) on delete set null (transaction_id),
  constraint business_capital_events_amount_ck check (amount >= 0),
  constraint business_capital_events_type_ck check (event_type in ('OPENING_COST_BASIS','ACQUISITION','CAPITAL_INJECTION','SALE','DIVIDEND','DISTRIBUTION','CAPITAL_RETURN')),
  constraint business_capital_events_ownership_delta_ck check (ownership_delta is null or (ownership_delta >= -1 and ownership_delta <= 1))
);
create index if not exists business_capital_events_business_owner_idx on public.business_capital_events(business_id,user_id);
create index if not exists business_capital_events_transaction_owner_idx on public.business_capital_events(transaction_id,user_id) where transaction_id is not null;

create table if not exists public.business_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_business_id uuid not null,
  child_business_id uuid not null,
  effective_date date not null,
  ownership_rate numeric(12,8) not null,
  data_kind text not null default 'USER_ASSUMPTION',
  confidence text not null default 'HIGH',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint business_holdings_parent_fk foreign key (parent_business_id,user_id) references public.businesses(id,user_id) on delete cascade,
  constraint business_holdings_child_fk foreign key (child_business_id,user_id) references public.businesses(id,user_id) on delete cascade,
  constraint business_holdings_no_self_ck check (parent_business_id <> child_business_id),
  constraint business_holdings_rate_ck check (ownership_rate > 0 and ownership_rate <= 1),
  constraint business_holdings_effective_uk unique(user_id,parent_business_id,child_business_id,effective_date)
);
create index if not exists business_holdings_parent_owner_idx on public.business_holdings(parent_business_id,user_id);
create index if not exists business_holdings_child_owner_idx on public.business_holdings(child_business_id,user_id);

alter table public.business_capital_events enable row level security;
alter table public.business_holdings enable row level security;
drop policy if exists owner_all on public.business_capital_events;
create policy owner_all on public.business_capital_events for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists owner_all on public.business_holdings;
create policy owner_all on public.business_holdings for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.business_capital_events, public.business_holdings from anon;
grant select,insert,update,delete on public.business_capital_events, public.business_holdings to authenticated;

create or replace function public.lfo_save_business(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid := nullif(p_payload->>'business_id','')::uuid;
begin
  if nullif(p_payload->>'name','') is null then raise exception 'Nom de société requis'; end if;
  if v_id is null then
    v_id:=gen_random_uuid();
    insert into public.businesses(id,user_id,name,legal_form,status,business_type,functional_currency,archived,data_kind,confidence,source,notes,updated_at)
    values(v_id,p_user_id,p_payload->>'name',nullif(p_payload->>'legal_form',''),'ACTIVE',nullif(p_payload->>'business_type',''),upper(nullif(p_payload->>'functional_currency','')),false,'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now());
  else
    update public.businesses set name=p_payload->>'name',legal_form=nullif(p_payload->>'legal_form',''),business_type=nullif(p_payload->>'business_type',''),functional_currency=upper(nullif(p_payload->>'functional_currency','')),notes=nullif(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_user_id;
    if not found then raise exception 'Société introuvable'; end if;
  end if; return v_id;
end $$;

create or replace function public.lfo_archive_business(p_user_id uuid,p_business_id uuid) returns uuid language plpgsql security invoker set search_path='' as $$ begin update public.businesses set archived=true,status='ARCHIVED',updated_at=now() where id=p_business_id and user_id=p_user_id; if not found then raise exception 'Société introuvable'; end if; return p_business_id; end $$;

create or replace function public.lfo_record_business_ownership(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid; begin
  insert into public.business_ownership(user_id,business_id,ownership_rate,economic_rate,voting_rate,fully_diluted_rate,effective_date,data_kind,confidence,source,notes)
  values(p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'legal_rate')::numeric,nullif(p_payload->>'economic_rate','')::numeric,nullif(p_payload->>'voting_rate','')::numeric,nullif(p_payload->>'fully_diluted_rate','')::numeric,(p_payload->>'effective_date')::date,'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''))
  on conflict(user_id,business_id,effective_date) do update set ownership_rate=excluded.ownership_rate,economic_rate=excluded.economic_rate,voting_rate=excluded.voting_rate,fully_diluted_rate=excluded.fully_diluted_rate,source=excluded.source,notes=excluded.notes returning id into v_id; return v_id; end $$;

create or replace function public.lfo_record_business_financials(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid:=gen_random_uuid(); begin
  insert into public.business_financials(id,user_id,business_id,period_end,revenue,gross_margin,ebitda,ebit,net_income,cash,debt,working_capital,capex,free_cash_flow,currency,data_kind,confidence,source,notes)
  values(v_id,p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'period_end')::date,nullif(p_payload->>'revenue','')::numeric,nullif(p_payload->>'gross_margin','')::numeric,nullif(p_payload->>'ebitda','')::numeric,nullif(p_payload->>'ebit','')::numeric,nullif(p_payload->>'net_income','')::numeric,nullif(p_payload->>'cash','')::numeric,nullif(p_payload->>'gross_debt','')::numeric,nullif(p_payload->>'working_capital','')::numeric,nullif(p_payload->>'capex','')::numeric,nullif(p_payload->>'free_cash_flow','')::numeric,upper(nullif(p_payload->>'currency','')),coalesce(nullif(p_payload->>'data_kind',''),'ACTUAL'),coalesce(nullif(p_payload->>'confidence',''),'HIGH'),nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')); return v_id; end $$;

create or replace function public.lfo_record_business_valuation(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid:=gen_random_uuid(); begin
  insert into public.business_valuations(id,user_id,business_id,valuation_date,method,enterprise_value,equity_value,assumptions,data_kind,currency,valuation_multiple,confidence,source,notes)
  values(v_id,p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'valuation_date')::date,p_payload->>'method',nullif(p_payload->>'enterprise_value','')::numeric,nullif(p_payload->>'equity_value','')::numeric,coalesce(p_payload->'assumptions','{}'::jsonb),coalesce(nullif(p_payload->>'data_kind',''),'USER_ASSUMPTION'),upper(nullif(p_payload->>'currency','')),nullif(p_payload->>'valuation_multiple','')::numeric,coalesce(nullif(p_payload->>'confidence',''),'MEDIUM'),nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')); return v_id; end $$;

create or replace function public.lfo_record_business_capital_event(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid:=gen_random_uuid(); begin
  insert into public.business_capital_events(id,user_id,business_id,event_type,event_date,amount,currency,ownership_delta,transaction_id,data_kind,confidence,source,notes)
  values(v_id,p_user_id,(p_payload->>'business_id')::uuid,p_payload->>'event_type',(p_payload->>'event_date')::date,(p_payload->>'amount')::numeric,upper(p_payload->>'currency'),nullif(p_payload->>'ownership_delta','')::numeric,nullif(p_payload->>'transaction_id','')::uuid,coalesce(nullif(p_payload->>'data_kind',''),'ACTUAL'),coalesce(nullif(p_payload->>'confidence',''),'HIGH'),nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')); return v_id; end $$;

create or replace function public.lfo_set_business_holding(p_user_id uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid; begin
  insert into public.business_holdings(user_id,parent_business_id,child_business_id,effective_date,ownership_rate,data_kind,confidence,source,notes)
  values(p_user_id,(p_payload->>'parent_business_id')::uuid,(p_payload->>'child_business_id')::uuid,(p_payload->>'effective_date')::date,(p_payload->>'ownership_rate')::numeric,'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''))
  on conflict(user_id,parent_business_id,child_business_id,effective_date) do update set ownership_rate=excluded.ownership_rate,source=excluded.source,notes=excluded.notes returning id into v_id; return v_id; end $$;

revoke all on function public.lfo_save_business(uuid,jsonb), public.lfo_archive_business(uuid,uuid), public.lfo_record_business_ownership(uuid,jsonb), public.lfo_record_business_financials(uuid,jsonb), public.lfo_record_business_valuation(uuid,jsonb), public.lfo_record_business_capital_event(uuid,jsonb), public.lfo_set_business_holding(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.lfo_save_business(uuid,jsonb), public.lfo_archive_business(uuid,uuid), public.lfo_record_business_ownership(uuid,jsonb), public.lfo_record_business_financials(uuid,jsonb), public.lfo_record_business_valuation(uuid,jsonb), public.lfo_record_business_capital_event(uuid,jsonb), public.lfo_set_business_holding(uuid,jsonb) to service_role;
`);

patch('src/lib/types.ts',
`  /** Rattachements bien ↔ dette. Ne portent aucun passif. */\n  realEstateFinancingLinks: RealEstateFinancingLink[];\n  liabilities: Liability[];`,
`  /** Rattachements bien ↔ dette. Ne portent aucun passif. */\n  realEstateFinancingLinks: RealEstateFinancingLink[];\n  /** Business Equity V2 — faits canoniques, puis lecture dérivée. */\n  businesses: import("@/lib/engine/business-equity").BusinessEntity[];\n  businessOwnership: import("@/lib/engine/business-equity").BusinessOwnership[];\n  businessFinancials: import("@/lib/engine/business-equity").BusinessFinancialSnapshot[];\n  businessValuations: import("@/lib/engine/business-equity").BusinessValuation[];\n  businessCapitalEvents: import("@/lib/engine/business-equity").BusinessCapitalEvent[];\n  businessHoldings: import("@/lib/engine/business-equity").BusinessHoldingLink[];\n  liabilities: Liability[];`);
patch('src/lib/types.ts',
`  /** Lecture dérivée du domaine immobilier ; absente seulement dans d'anciens fixtures. */\n  realEstate?: import("@/lib/engine/real-estate").RealEstatePortfolio;`,
`  /** Lecture dérivée du domaine immobilier ; absente seulement dans d'anciens fixtures. */\n  realEstate?: import("@/lib/engine/real-estate").RealEstatePortfolio;\n  /** Business Equity dérivé, jamais une seconde source de faits. */\n  businessEquity?: import("@/lib/engine/business-equity").BusinessEquityPortfolio;`);

patch('src/lib/data/contracts.ts',
`import type {\n  CashFlowKind,`,
`import type { BusinessCapitalEventType, BusinessType, BusinessValuationMethod } from "@/lib/engine/business-equity";\nimport type {\n  CashFlowKind,`);
patch('src/lib/data/contracts.ts',
`export type Mutation =`,
String.raw`export interface BusinessInput { businessId: string | null; name: string; legalForm: string | null; type: BusinessType | null; functionalCurrency: string | null; notes: string | null; }
export interface BusinessOwnershipInput { businessId: string; effectiveDate: string; legalRate: number; economicRate: number | null; votingRate: number | null; fullyDilutedRate: number | null; notes: string | null; }
export interface BusinessFinancialInput { businessId: string; periodEnd: string; currency: string | null; revenue: number | null; grossMargin: number | null; ebitda: number | null; ebit: number | null; netIncome: number | null; cash: number | null; grossDebt: number | null; workingCapital: number | null; capex: number | null; freeCashFlow: number | null; notes: string | null; }
export interface BusinessValuationInput { businessId: string; valuationDate: string; currency: string | null; method: BusinessValuationMethod; enterpriseValue: number | null; equityValue: number | null; valuationMultiple: number | null; notes: string | null; }
export interface BusinessCapitalEventInput { businessId: string; type: BusinessCapitalEventType; eventDate: string; amount: number; currency: string; ownershipDelta: number | null; transactionId: string | null; notes: string | null; }
export interface BusinessHoldingInput { parentBusinessId: string; childBusinessId: string; effectiveDate: string; ownershipRate: number; notes: string | null; }

export type Mutation =`);
patch('src/lib/data/contracts.ts',
`  | { action: "save_real_estate_asset"; asset: RealEstateAssetInput }`,
`  | { action: "save_business"; business: BusinessInput }\n  | { action: "archive_business"; businessId: string }\n  | { action: "record_business_ownership"; ownership: BusinessOwnershipInput }\n  | { action: "record_business_financials"; financials: BusinessFinancialInput }\n  | { action: "record_business_valuation"; valuation: BusinessValuationInput }\n  | { action: "record_business_capital_event"; event: BusinessCapitalEventInput }\n  | { action: "set_business_holding"; holding: BusinessHoldingInput }\n  | { action: "save_real_estate_asset"; asset: RealEstateAssetInput }`);

patch('src/lib/validation/mutations.ts',
`import { z } from "zod";`,
`import { z } from "zod";\nimport { BUSINESS_CAPITAL_EVENT_TYPES, BUSINESS_TYPES, BUSINESS_VALUATION_METHODS } from "@/lib/engine/business-equity";`);
patch('src/lib/validation/mutations.ts',
`export const mutationSchema = z.discriminatedUnion("action", [`,
String.raw`const businessSchema = z.object({ businessId:z.uuid().nullable(), name:z.string().trim().min(1).max(160), legalForm:z.string().trim().max(80).nullable(), type:z.enum(BUSINESS_TYPES).nullable(), functionalCurrency:z.string().trim().length(3).nullable(), notes:z.string().trim().max(1000).nullable() }).strict();
const businessOwnershipSchema = z.object({ businessId:z.uuid(), effectiveDate:realDate, legalRate:finite.gt(0).max(1), economicRate:finite.gt(0).max(1).nullable(), votingRate:finite.min(0).max(1).nullable(), fullyDilutedRate:finite.gt(0).max(1).nullable(), notes:z.string().trim().max(1000).nullable() }).strict();
const businessFinancialSchema = z.object({ businessId:z.uuid(), periodEnd:realDate, currency:z.string().trim().length(3).nullable(), revenue:finite.nullable(), grossMargin:finite.nullable(), ebitda:finite.nullable(), ebit:finite.nullable(), netIncome:finite.nullable(), cash:finite.nonnegative().nullable(), grossDebt:finite.nonnegative().nullable(), workingCapital:finite.nullable(), capex:finite.nonnegative().nullable(), freeCashFlow:finite.nullable(), notes:z.string().trim().max(1000).nullable() }).strict();
const businessValuationSchema = z.object({ businessId:z.uuid(), valuationDate:realDate, currency:z.string().trim().length(3).nullable(), method:z.enum(BUSINESS_VALUATION_METHODS), enterpriseValue:finite.nullable(), equityValue:finite.nullable(), valuationMultiple:finite.nullable(), notes:z.string().trim().max(1000).nullable() }).strict().superRefine((v,ctx)=>{ if(v.enterpriseValue===null && v.equityValue===null) ctx.addIssue({code:'custom',message:'EV ou Equity Value requise',path:['equityValue']}); });
const businessCapitalEventSchema = z.object({ businessId:z.uuid(), type:z.enum(BUSINESS_CAPITAL_EVENT_TYPES), eventDate:realDate, amount:finite.nonnegative(), currency:z.string().trim().length(3), ownershipDelta:finite.min(-1).max(1).nullable(), transactionId:z.uuid().nullable(), notes:z.string().trim().max(1000).nullable() }).strict();
const businessHoldingSchema = z.object({ parentBusinessId:z.uuid(), childBusinessId:z.uuid(), effectiveDate:realDate, ownershipRate:finite.gt(0).max(1), notes:z.string().trim().max(1000).nullable() }).strict().superRefine((v,ctx)=>{ if(v.parentBusinessId===v.childBusinessId) ctx.addIssue({code:'custom',message:'Une société ne peut pas se détenir elle-même',path:['childBusinessId']}); });

export const mutationSchema = z.discriminatedUnion("action", [`);
patch('src/lib/validation/mutations.ts',
`  // Les mutations immobilières sont STRICTES de bout en bout`,
`  z.object({ action:z.literal("save_business"), business:businessSchema }).strict(),\n  z.object({ action:z.literal("archive_business"), businessId:z.uuid() }).strict(),\n  z.object({ action:z.literal("record_business_ownership"), ownership:businessOwnershipSchema }).strict(),\n  z.object({ action:z.literal("record_business_financials"), financials:businessFinancialSchema }).strict(),\n  z.object({ action:z.literal("record_business_valuation"), valuation:businessValuationSchema }).strict(),\n  z.object({ action:z.literal("record_business_capital_event"), event:businessCapitalEventSchema }).strict(),\n  z.object({ action:z.literal("set_business_holding"), holding:businessHoldingSchema }).strict(),\n  // Les mutations immobilières sont STRICTES de bout en bout`);

patch('src/lib/data/supabase-repository.ts',
`import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";`,
`import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";\nimport { buildBusinessEquityPortfolio, businessEquityBalanceSheetContributions, BUSINESS_CAPITAL_EVENT_TYPES, BUSINESS_TYPES, BUSINESS_VALUATION_METHODS, type BusinessEntity, type BusinessOwnership, type BusinessFinancialSnapshot, type BusinessValuation, type BusinessCapitalEvent, type BusinessHoldingLink } from "@/lib/engine/business-equity";`);
patch('src/lib/data/supabase-repository.ts',
`      realEstateFinancingLinkRows,\n    ] = await Promise.all([`,
`      realEstateFinancingLinkRows,\n      businessRows,\n      businessOwnershipRows,\n      businessFinancialRows,\n      businessValuationRows,\n      businessCapitalEventRows,\n      businessHoldingRows,\n    ] = await Promise.all([`);
patch('src/lib/data/supabase-repository.ts',
`      mine("real_estate_financing_links"),\n    ]).then`,
`      mine("real_estate_financing_links"),\n      mine("businesses"),\n      fetchAllPages("business_ownership", "effective_date"),\n      fetchAllPages("business_financials", "period_end"),\n      fetchAllPages("business_valuations", "valuation_date"),\n      fetchAllPages("business_capital_events", "event_date"),\n      fetchAllPages("business_holdings", "effective_date"),\n    ]).then`);

patch('src/lib/data/supabase-repository.ts',
`    const latestLiabilityObservations = latestBy(`,
String.raw`    // ── Business Equity V2 ───────────────────────────────────────────────────────────
    const businesses: BusinessEntity[] = businessRows.filter((r)=>r.archived!==true).map((row)=>({ id:str(row.id), name:str(row.name), legalForm:row.legal_form?str(row.legal_form):null, type:row.business_type ? enumValue(str(row.business_type), BUSINESS_TYPES, `businesses[id=${str(row.id)}].business_type`) : null, functionalCurrency:row.functional_currency?str(row.functional_currency).toUpperCase():null, archived:bool(row.archived), notes:row.notes?str(row.notes):null, provenance:provenance(row) })).sort((a,b)=>a.name.localeCompare(b.name));
    const liveBusinessIds = new Set(businesses.map((b)=>b.id));
    const businessOwnership: BusinessOwnership[] = businessOwnershipRows.filter((r)=>liveBusinessIds.has(str(r.business_id))).map((row)=>({ id:str(row.id), businessId:str(row.business_id), effectiveDate:str(row.effective_date), legalRate:finiteNumber(row.ownership_rate,`business_ownership[id=${str(row.id)}].ownership_rate`), economicRate:nullableFiniteNumber(row.economic_rate,`business_ownership[id=${str(row.id)}].economic_rate`), votingRate:nullableFiniteNumber(row.voting_rate,`business_ownership[id=${str(row.id)}].voting_rate`), fullyDilutedRate:nullableFiniteNumber(row.fully_diluted_rate,`business_ownership[id=${str(row.id)}].fully_diluted_rate`), notes:row.notes?str(row.notes):null, provenance:provenance(row) }));
    const businessFinancials: BusinessFinancialSnapshot[] = businessFinancialRows.filter((r)=>liveBusinessIds.has(str(r.business_id))).map((row)=>({ id:str(row.id), businessId:str(row.business_id), periodEnd:str(row.period_end), currency:row.currency?str(row.currency).toUpperCase():null, revenue:nullableFiniteNumber(row.revenue,`business_financials[id=${str(row.id)}].revenue`), grossMargin:nullableFiniteNumber(row.gross_margin,`business_financials[id=${str(row.id)}].gross_margin`), ebitda:nullableFiniteNumber(row.ebitda,`business_financials[id=${str(row.id)}].ebitda`), ebit:nullableFiniteNumber(row.ebit,`business_financials[id=${str(row.id)}].ebit`), netIncome:nullableFiniteNumber(row.net_income,`business_financials[id=${str(row.id)}].net_income`), cash:nullableFiniteNumber(row.cash,`business_financials[id=${str(row.id)}].cash`), grossDebt:nullableFiniteNumber(row.debt,`business_financials[id=${str(row.id)}].debt`), workingCapital:nullableFiniteNumber(row.working_capital,`business_financials[id=${str(row.id)}].working_capital`), capex:nullableFiniteNumber(row.capex,`business_financials[id=${str(row.id)}].capex`), freeCashFlow:nullableFiniteNumber(row.free_cash_flow,`business_financials[id=${str(row.id)}].free_cash_flow`), notes:row.notes?str(row.notes):null, provenance:provenance(row) }));
    const businessValuations: BusinessValuation[] = businessValuationRows.filter((r)=>liveBusinessIds.has(str(r.business_id))).map((row)=>({ id:str(row.id), businessId:str(row.business_id), valuationDate:str(row.valuation_date), currency:row.currency?str(row.currency).toUpperCase():null, method:enumValue(str(row.method), BUSINESS_VALUATION_METHODS,`business_valuations[id=${str(row.id)}].method`), enterpriseValue:nullableFiniteNumber(row.enterprise_value,`business_valuations[id=${str(row.id)}].enterprise_value`), equityValue:nullableFiniteNumber(row.equity_value,`business_valuations[id=${str(row.id)}].equity_value`), valuationMultiple:nullableFiniteNumber(row.valuation_multiple,`business_valuations[id=${str(row.id)}].valuation_multiple`), notes:row.notes?str(row.notes):null, provenance:provenance(row) }));
    const businessCapitalEvents: BusinessCapitalEvent[] = businessCapitalEventRows.filter((r)=>liveBusinessIds.has(str(r.business_id))).map((row)=>({ id:str(row.id), businessId:str(row.business_id), type:enumValue(str(row.event_type),BUSINESS_CAPITAL_EVENT_TYPES,`business_capital_events[id=${str(row.id)}].event_type`), eventDate:str(row.event_date), amount:finiteNumber(row.amount,`business_capital_events[id=${str(row.id)}].amount`), currency:str(row.currency).toUpperCase(), ownershipDelta:nullableFiniteNumber(row.ownership_delta,`business_capital_events[id=${str(row.id)}].ownership_delta`), transactionId:row.transaction_id?str(row.transaction_id):null, notes:row.notes?str(row.notes):null, provenance:provenance(row) }));
    const businessHoldings: BusinessHoldingLink[] = businessHoldingRows.filter((r)=>liveBusinessIds.has(str(r.parent_business_id))&&liveBusinessIds.has(str(r.child_business_id))).map((row)=>({ id:str(row.id), parentBusinessId:str(row.parent_business_id), childBusinessId:str(row.child_business_id), effectiveDate:str(row.effective_date), ownershipRate:finiteNumber(row.ownership_rate,`business_holdings[id=${str(row.id)}].ownership_rate`), notes:row.notes?str(row.notes):null, provenance:provenance(row) }));

    const latestLiabilityObservations = latestBy(`);

patch('src/lib/data/supabase-repository.ts',
`    const balanceSheet = buildCanonicalBalanceSheet({\n      asOfDate: AS_OF_DATE,\n      reportingCurrency,\n      accounts,\n      positions,\n      liabilities,\n      contributions: realEstateBalanceSheetContributions(realEstate),\n      currencyRates,\n    });`,
`    const businessEquity = buildBusinessEquityPortfolio({ asOfDate:AS_OF_DATE, reportingCurrency, businesses, ownership:businessOwnership, financials:businessFinancials, valuations:businessValuations, capitalEvents:businessCapitalEvents, holdings:businessHoldings, currencyRates });\n    const balanceSheet = buildCanonicalBalanceSheet({\n      asOfDate: AS_OF_DATE,\n      reportingCurrency,\n      accounts,\n      positions,\n      liabilities,\n      contributions: [...realEstateBalanceSheetContributions(realEstate), ...businessEquityBalanceSheetContributions(businessEquity)],\n      currencyRates,\n    });`);
patch('src/lib/data/supabase-repository.ts',
`      realEstateFinancingLinks,\n      liabilities,`,
`      realEstateFinancingLinks,\n      businesses,\n      businessOwnership,\n      businessFinancials,\n      businessValuations,\n      businessCapitalEvents,\n      businessHoldings,\n      liabilities,`);
patch('src/lib/data/supabase-repository.ts',
`      realEstate,\n      metrics: composeDashboardMetrics`,
`      realEstate,\n      businessEquity,\n      metrics: composeDashboardMetrics`);

patch('src/lib/data/supabase-repository.ts',
`      case "save_real_estate_asset": {`,
String.raw`      case "save_business": {
        unwrap(await db.rpc("lfo_save_business", { p_user_id:user, p_payload:{ business_id:mutation.business.businessId, name:mutation.business.name, legal_form:mutation.business.legalForm, business_type:mutation.business.type, functional_currency:mutation.business.functionalCurrency, notes:mutation.business.notes, source:"Saisie Business Equity" } }), "enregistrement société"); break;
      }
      case "archive_business": { unwrap(await db.rpc("lfo_archive_business", { p_user_id:user, p_business_id:mutation.businessId }), "archivage société"); break; }
      case "record_business_ownership": { const o=mutation.ownership; unwrap(await db.rpc("lfo_record_business_ownership", { p_user_id:user, p_payload:{ business_id:o.businessId,effective_date:o.effectiveDate,legal_rate:o.legalRate,economic_rate:o.economicRate,voting_rate:o.votingRate,fully_diluted_rate:o.fullyDilutedRate,notes:o.notes,source:"Saisie Business Equity" } }), "enregistrement détention"); break; }
      case "record_business_financials": { const f=mutation.financials; unwrap(await db.rpc("lfo_record_business_financials", { p_user_id:user, p_payload:{ business_id:f.businessId,period_end:f.periodEnd,currency:f.currency,revenue:f.revenue,gross_margin:f.grossMargin,ebitda:f.ebitda,ebit:f.ebit,net_income:f.netIncome,cash:f.cash,gross_debt:f.grossDebt,working_capital:f.workingCapital,capex:f.capex,free_cash_flow:f.freeCashFlow,notes:f.notes,source:"Saisie Business Equity",data_kind:"ACTUAL",confidence:"HIGH" } }), "enregistrement financiers business"); break; }
      case "record_business_valuation": { const v=mutation.valuation; unwrap(await db.rpc("lfo_record_business_valuation", { p_user_id:user, p_payload:{ business_id:v.businessId,valuation_date:v.valuationDate,currency:v.currency,method:v.method,enterprise_value:v.enterpriseValue,equity_value:v.equityValue,valuation_multiple:v.valuationMultiple,notes:v.notes,source:"Saisie Business Equity",data_kind:v.method==="USER_ESTIMATE"?"USER_ASSUMPTION":"EXTERNAL_DATA",confidence:v.method==="USER_ESTIMATE"?"LOW":"MEDIUM",assumptions:{} } }), "enregistrement valorisation business"); break; }
      case "record_business_capital_event": { const e=mutation.event; unwrap(await db.rpc("lfo_record_business_capital_event", { p_user_id:user, p_payload:{ business_id:e.businessId,event_type:e.type,event_date:e.eventDate,amount:e.amount,currency:e.currency,ownership_delta:e.ownershipDelta,transaction_id:e.transactionId,notes:e.notes,source:"Saisie Business Equity",data_kind:"ACTUAL",confidence:"HIGH" } }), "enregistrement événement business"); break; }
      case "set_business_holding": { const h=mutation.holding; unwrap(await db.rpc("lfo_set_business_holding", { p_user_id:user, p_payload:{ parent_business_id:h.parentBusinessId,child_business_id:h.childBusinessId,effective_date:h.effectiveDate,ownership_rate:h.ownershipRate,notes:h.notes,source:"Saisie Business Equity" } }), "rattachement holding"); break; }
      case "save_real_estate_asset": {`);

write('src/components/pages/business-equity/business-forms.tsx', String.raw`"use client";
import { useState } from 'react';
import type { Mutate } from '@/components/pages/shared';
import type { BusinessEntity } from '@/lib/engine/business-equity';
const n=(s:string)=>s.trim()===''?null:Number(s.replace(',','.'));
export function BusinessForms({ businesses, mutate, busy }:{ businesses:BusinessEntity[]; mutate:Mutate; busy:boolean }) {
  const [name,setName]=useState(''); const [legal,setLegal]=useState('SAS'); const [type,setType]=useState<'OPERATING'|'HOLDING'|'STARTUP'|'SPV'|'OTHER'>('OPERATING'); const [currency,setCurrency]=useState('EUR');
  const [selected,setSelected]=useState(''); const [date,setDate]=useState('2026-08-26'); const [legalRate,setLegalRate]=useState('100'); const [economic,setEconomic]=useState('100');
  const [revenue,setRevenue]=useState(''); const [ebitda,setEbitda]=useState(''); const [cash,setCash]=useState('0'); const [debt,setDebt]=useState('0');
  const [ev,setEv]=useState(''); const [equity,setEquity]=useState(''); const [method,setMethod]=useState<'EXTERNAL_APPRAISAL'|'TRANSACTION'|'EBITDA_MULTIPLE'|'REVENUE_MULTIPLE'|'DCF'|'FUNDING_ROUND'|'USER_ESTIMATE'|'LOOK_THROUGH'>('USER_ESTIMATE');
  const [eventAmount,setEventAmount]=useState(''); const [eventType,setEventType]=useState<'OPENING_COST_BASIS'|'ACQUISITION'|'CAPITAL_INJECTION'|'SALE'|'DIVIDEND'|'DISTRIBUTION'|'CAPITAL_RETURN'>('OPENING_COST_BASIS');
  const submit=async(e:React.FormEvent,fn:()=>Promise<boolean>)=>{e.preventDefault(); await fn();};
  return <div className="results-stack">
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'save_business',business:{businessId:null,name,legalForm:legal||null,type,functionalCurrency:currency||null,notes:null}}))}><div className="panel-header"><div><span className="eyebrow">Identité</span><h2>Ajouter une société</h2></div></div><div className="mini-form-grid business-form"><label>Nom<input value={name} onChange={e=>setName(e.target.value)} required /></label><label>Forme<input value={legal} onChange={e=>setLegal(e.target.value)} /></label><label>Type<select value={type} onChange={e=>setType(e.target.value as typeof type)}><option>OPERATING</option><option>HOLDING</option><option>STARTUP</option><option>SPV</option><option>OTHER</option></select></label><label>Devise<input value={currency} maxLength={3} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label></div><button className="button primary" disabled={busy||!name}>Créer</button></form>
    {businesses.length>0 && <><div className="panel"><label>Société<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choisir…</option>{businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'record_business_ownership',ownership:{businessId:selected,effectiveDate:date,legalRate:Number(legalRate)/100,economicRate:n(economic)===null?null:Number(economic)/100,votingRate:null,fullyDilutedRate:null,notes:null}}))}><h2>Détention</h2><div className="mini-form-grid"><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Détention juridique %<input value={legalRate} onChange={e=>setLegalRate(e.target.value)}/></label><label>Droits économiques %<input value={economic} onChange={e=>setEconomic(e.target.value)}/></label></div><button className="button secondary" disabled={!selected||busy}>Enregistrer</button></form>
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'record_business_financials',financials:{businessId:selected,periodEnd:date,currency,revenue:n(revenue),grossMargin:null,ebitda:n(ebitda),ebit:null,netIncome:null,cash:n(cash),grossDebt:n(debt),workingCapital:null,capex:null,freeCashFlow:null,notes:null}}))}><h2>Financiers observés</h2><div className="mini-form-grid"><label>CA<input value={revenue} onChange={e=>setRevenue(e.target.value)}/></label><label>EBITDA<input value={ebitda} onChange={e=>setEbitda(e.target.value)}/></label><label>Cash<input value={cash} onChange={e=>setCash(e.target.value)}/></label><label>Dette brute<input value={debt} onChange={e=>setDebt(e.target.value)}/></label></div><button className="button secondary" disabled={!selected||busy}>Enregistrer</button></form>
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'record_business_valuation',valuation:{businessId:selected,valuationDate:date,currency,method,enterpriseValue:n(ev),equityValue:n(equity),valuationMultiple:null,notes:null}}))}><h2>Valorisation</h2><div className="mini-form-grid"><label>Méthode<select value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option>USER_ESTIMATE</option><option>EXTERNAL_APPRAISAL</option><option>TRANSACTION</option><option>EBITDA_MULTIPLE</option><option>REVENUE_MULTIPLE</option><option>DCF</option><option>FUNDING_ROUND</option></select></label><label>Enterprise Value<input value={ev} onChange={e=>setEv(e.target.value)}/></label><label>Equity Value<input value={equity} onChange={e=>setEquity(e.target.value)}/></label></div><p className="muted">Si seule l'EV est connue, cash et dette brute doivent être renseignés. Le moteur refuse EV × % sans bridge EV → Equity.</p><button className="button secondary" disabled={!selected||busy||(n(ev)===null&&n(equity)===null)}>Enregistrer</button></form>
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'record_business_capital_event',event:{businessId:selected,type:eventType,eventDate:date,amount:Number(eventAmount),currency,ownershipDelta:null,transactionId:null,notes:null}}))}><h2>Capital & distributions</h2><div className="mini-form-grid"><label>Nature<select value={eventType} onChange={e=>setEventType(e.target.value as typeof eventType)}><option>OPENING_COST_BASIS</option><option>ACQUISITION</option><option>CAPITAL_INJECTION</option><option>SALE</option><option>DIVIDEND</option><option>DISTRIBUTION</option><option>CAPITAL_RETURN</option></select></label><label>Montant<input value={eventAmount} onChange={e=>setEventAmount(e.target.value)}/></label></div><button className="button secondary" disabled={!selected||busy||!eventAmount}>Enregistrer</button></form></>}
  </div>;
}
`);

write('src/components/pages/business-equity/page.tsx', String.raw`"use client";
import { Callout, Currency, MetricCard, Percent, SectionHeader } from '@/components/ui';
import { BusinessForms } from './business-forms';
import type { SectionProps } from '@/components/pages/shared';
const Metric=({value,percent=false}:{value:number|null;percent?:boolean})=>value===null?<span className="warning-text">Non calculable</span>:percent?<Percent value={value}/>:<Currency value={value}/>;
export default function BusinessPage({ state, mutate, busy }:SectionProps) {
  const portfolio=state.businessEquity;
  return <div className="page-stack"><SectionHeader eyebrow="Private assets" title="Business Equity" description="Participations privées : valeur, bridge EV → Equity, détention, capital investi et performance — sans confondre dette corporate et dette personnelle." />
  {!portfolio || state.businesses.length===0 ? <Callout title="Aucune participation déclarée">Ajoute une société puis renseigne sa détention. Une dette corporate à 0 doit être saisie comme 0 si elle est réellement nulle ; une dette inconnue reste vide.</Callout> : <>
    <section className="metrics-grid four"><MetricCard label="Valeur attribuable" value={<Metric value={portfolio.totalAttributableValue.value}/>} tone="positive"/><MetricCard label="Sociétés" value={portfolio.positions.filter(p=>p.ownership).length}/><MetricCard label="Qualité" value={portfolio.quality.blockers.length===0?'Calculable':'Partielle'}/></section>
    <div className="results-stack">{portfolio.positions.map(p=><article className="panel" key={p.business.id}><div className="panel-header"><div><span className="eyebrow">{p.business.type??'TYPE NON DÉCLARÉ'}</span><h2>{p.business.name}</h2></div></div><section className="metrics-grid four"><MetricCard label="Equity Value" value={<Metric value={p.wholeEquityValue.value}/>}/><MetricCard label="Valeur personnelle" value={<Metric value={p.attributableValue.value}/>}/><MetricCard label="Dette nette corporate" value={<Metric value={p.netDebt.value}/>}/><MetricCard label="Détention économique" value={<Metric value={p.ownership?.economicRate??null} percent/>}/><MetricCard label="Capital investi" value={<Metric value={p.investedCapital.value}/>}/><MetricCard label="Cash retourné" value={<Metric value={p.cashReturned.value}/>}/><MetricCard label="MOIC" value={p.moic.value===null?'Non calculable':`${p.moic.value.toFixed(2)}×`}/><MetricCard label="XIRR" value={<Metric value={p.xirr.value} percent/>}/></section>{p.quality.blockers.length>0&&<p className="warning-text">Bloquants : {p.quality.blockers.join(' · ')}</p>}{p.quality.flags.length>0&&<p className="muted">{p.quality.flags.join(' · ')}</p>}</article>)}</div>
  </>}
  <BusinessForms businesses={state.businesses} mutate={mutate} busy={busy}/></div>;
}
`);

// Verifier: local canonical migration version is provisional until the remote gate applies it.
patch('scripts/verify-supabase-schema.ts',
`  "20260826090347",\n] as const;`,
`  "20260826090347",\n  "20260826140000",\n] as const;`);
patch('scripts/verify-supabase-schema.ts',
`  real_estate_financing_links: [\n    "id",\n    "property_id",\n    "liability_id",\n    "allocation_share",\n    "data_kind",\n    "confidence",\n  ],\n};`,
`  real_estate_financing_links: [\n    "id",\n    "property_id",\n    "liability_id",\n    "allocation_share",\n    "data_kind",\n    "confidence",\n  ],\n  businesses: ["id","business_type","functional_currency","archived","data_kind","confidence"],\n  business_ownership: ["id","business_id","ownership_rate","economic_rate","voting_rate","fully_diluted_rate","effective_date","data_kind","confidence"],\n  business_financials: ["id","business_id","period_end","currency","revenue","ebitda","cash","debt","ebit","net_income","capex","free_cash_flow","data_kind","confidence"],\n  business_valuations: ["id","business_id","valuation_date","method","currency","enterprise_value","equity_value","valuation_multiple","data_kind","confidence"],\n  business_capital_events: ["id","business_id","event_type","event_date","amount","currency","ownership_delta","transaction_id","data_kind","confidence"],\n  business_holdings: ["id","parent_business_id","child_business_id","effective_date","ownership_rate","data_kind","confidence"],\n};`);
patch('scripts/verify-supabase-schema.ts',
`  "real_estate_financing_links",\n] as const;`,
`  "real_estate_financing_links",\n  "business_capital_events",\n  "business_holdings",\n] as const;`);
patch('scripts/verify-supabase-schema.ts',
`  "real_estate_operating_terms_property_owner_idx",\n] as const;`,
`  "real_estate_operating_terms_property_owner_idx",\n  "businesses_id_user_uidx",\n  "business_ownership_effective_uk",\n  "business_ownership_business_owner_idx",\n  "business_financials_business_owner_idx",\n  "business_valuations_business_owner_idx",\n  "business_capital_events_business_owner_idx",\n  "business_holdings_parent_owner_idx",\n  "business_holdings_child_owner_idx",\n] as const;`);
patch('scripts/verify-supabase-schema.ts',
`  "transactions_property_fk",\n] as const;`,
`  "transactions_property_fk",\n  "business_ownership_business_fk",\n  "business_financials_business_fk",\n  "business_valuations_business_fk",\n  "business_ownership_rates_ck",\n  "business_valuations_value_ck",\n  "business_capital_events_business_fk",\n  "business_capital_events_transaction_fk",\n  "business_capital_events_amount_ck",\n  "business_capital_events_type_ck",\n  "business_capital_events_ownership_delta_ck",\n  "business_holdings_parent_fk",\n  "business_holdings_child_fk",\n  "business_holdings_no_self_ck",\n  "business_holdings_rate_ck",\n  "business_holdings_effective_uk",\n] as const;`);
patch('scripts/verify-supabase-schema.ts',
`  lfo_attribute_transaction_to_property:\n    "p_user_id uuid, p_transaction_id uuid, p_property_id uuid",\n};`,
`  lfo_attribute_transaction_to_property:\n    "p_user_id uuid, p_transaction_id uuid, p_property_id uuid",\n  lfo_save_business: "p_user_id uuid, p_payload jsonb",\n  lfo_archive_business: "p_user_id uuid, p_business_id uuid",\n  lfo_record_business_ownership: "p_user_id uuid, p_payload jsonb",\n  lfo_record_business_financials: "p_user_id uuid, p_payload jsonb",\n  lfo_record_business_valuation: "p_user_id uuid, p_payload jsonb",\n  lfo_record_business_capital_event: "p_user_id uuid, p_payload jsonb",\n  lfo_set_business_holding: "p_user_id uuid, p_payload jsonb",\n};`);

console.log('Business Equity V2 bootstrap complete');
