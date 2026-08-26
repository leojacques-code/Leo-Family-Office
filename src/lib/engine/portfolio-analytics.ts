import type { AggregateStatus, CanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import { resolveFxRate, type CurrencyRate } from "@/lib/engine/fx";
import {
  PORTFOLIO_FLOW_DIRECTION,
  PORTFOLIO_TOLERANCE,
  envelopeLedgerOf,
  type PortfolioEnvelopeLedger,
  type PortfolioHolding,
  type PortfolioLedger,
} from "@/lib/engine/portfolio";
import type {
  AccountBalanceObservation,
  FinancialAccount,
  PortfolioEvent,
  Position,
} from "@/lib/types";

/**
 * PORTFOLIO ANALYTICS
 *
 * Cette couche ne possède aucun fait. Les valeurs datées viennent des soldes comptables,
 * les flux et coûts du ledger, les valeurs courantes du Balance Sheet et chaque conversion
 * du FX Engine. Une donnée absente produit `null` et un blocage explicite, jamais zéro.
 */

export interface AnalyticsMetric {
  value: number | null;
  status: AggregateStatus;
  blockers: string[];
  flags: string[];
}

export interface PerformancePoint {
  date: string;
  value: number;
  externalFlow: number;
  periodReturn: number | null;
  wealthIndex: number;
}

export interface AllocationBucket {
  key: string;
  label: string;
  value: number;
  weight: number;
  kind: "ASSET_CLASS" | "CASH" | "UNEXPOSED";
}

export interface ConcentrationHolding {
  securityId: string | null;
  positionIds: string[];
  accountIds: string[];
  label: string;
  value: number;
  weight: number;
}

export interface PortfolioAttributionComponent {
  key: string;
  label: string;
  value: number;
  kind: "SECURITY" | "INCOME" | "CHARGE";
}

export interface PortfolioAttribution {
  status: AggregateStatus;
  explainedPerformance: number | null;
  residual: number | null;
  components: PortfolioAttributionComponent[];
  blockers: string[];
  flags: string[];
}

export interface PortfolioEnvelopeAnalytics {
  accountId: string;
  accountName: string;
  currency: string;
  coverageStart: string | null;
  openingValue: AnalyticsMetric;
  endingValue: AnalyticsMetric;
  contributions: AnalyticsMetric;
  withdrawals: AnalyticsMetric;
  netExternalFlow: AnalyticsMetric;
  economicGain: AnalyticsMetric;
  twr: AnalyticsMetric;
  xirr: AnalyticsMetric;
  realisedPnL: AnalyticsMetric;
  unrealisedPnL: AnalyticsMetric;
  income: AnalyticsMetric;
  fees: AnalyticsMetric;
  taxes: AnalyticsMetric;
  observedMaxDrawdown: AnalyticsMetric;
  annualisedVolatility: AnalyticsMetric;
  performanceSeries: PerformancePoint[];
  attribution: PortfolioAttribution;
  flags: string[];
}

export interface PortfolioPerformanceAnalytics {
  currency: string;
  coverageStart: string | null;
  openingValue: AnalyticsMetric;
  endingValue: AnalyticsMetric;
  contributions: AnalyticsMetric;
  withdrawals: AnalyticsMetric;
  netExternalFlow: AnalyticsMetric;
  economicGain: AnalyticsMetric;
  twr: AnalyticsMetric;
  xirr: AnalyticsMetric;
  observedMaxDrawdown: AnalyticsMetric;
  annualisedVolatility: AnalyticsMetric;
  performanceSeries: PerformancePoint[];
  flags: string[];
}

export interface PortfolioAllocation {
  status: AggregateStatus;
  totalValue: number | null;
  buckets: AllocationBucket[];
  blockers: string[];
  flags: string[];
}

export interface PortfolioConcentration {
  status: AggregateStatus;
  top1Weight: number | null;
  top5Weight: number | null;
  hhi: number | null;
  effectivePositions: number | null;
  holdings: ConcentrationHolding[];
  blockers: string[];
  flags: string[];
}

export interface PortfolioAnalytics {
  asOfDate: string;
  reportingCurrency: string;
  /** Performance consolidée, uniquement sur une fenêtre commune à toutes les enveloppes. */
  performance: PortfolioPerformanceAnalytics;
  envelopes: PortfolioEnvelopeAnalytics[];
  allocation: PortfolioAllocation;
  concentration: PortfolioConcentration;
  /** `null` tant qu'aucune allocation cible datée n'existe dans le modèle. */
  drift: AnalyticsMetric;
  quality: { status: AggregateStatus; blockers: string[]; flags: string[] };
}

export interface BuildPortfolioAnalyticsInput {
  asOfDate: string;
  reportingCurrency: string;
  accounts: FinancialAccount[];
  positions: Position[];
  events: PortfolioEvent[];
  balanceHistory: AccountBalanceObservation[];
  ledger: PortfolioLedger;
  balanceSheet: CanonicalBalanceSheet;
  currencyRates?: CurrencyRate[];
}

const complete = (value: number, flags: string[] = []): AnalyticsMetric => ({
  value,
  status: "COMPLETE",
  blockers: [],
  flags,
});

const unavailable = (blockers: string[], flags: string[] = []): AnalyticsMetric => ({
  value: null,
  status: "NOT_COMPUTABLE",
  blockers: [...new Set(blockers)],
  flags: [...new Set(flags)],
});

function daysBetween(left: string, right: string): number {
  return (Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000;
}

function latestDailyObservations(
  accountId: string,
  observations: AccountBalanceObservation[],
  start: string,
  end: string,
): AccountBalanceObservation[] {
  const daily = new Map<string, AccountBalanceObservation>();
  for (const item of observations) {
    if (item.accountId !== accountId || item.balanceDate < start || item.balanceDate > end)
      continue;
    const current = daily.get(item.balanceDate);
    if (!current || item.createdAt > current.createdAt) daily.set(item.balanceDate, item);
  }
  return [...daily.values()].sort((a, b) => a.balanceDate.localeCompare(b.balanceDate));
}

function windowEvents(
  accountId: string,
  events: PortfolioEvent[],
  start: string,
  end: string,
): PortfolioEvent[] {
  return events.filter(
    (event) => event.accountId === accountId && event.eventDate >= start && event.eventDate <= end,
  );
}

function externalCashFlow(event: PortfolioEvent): number | null {
  const direction = PORTFOLIO_FLOW_DIRECTION[event.type];
  if (direction !== "EXTERNAL_IN" && direction !== "EXTERNAL_OUT") return 0;
  if (event.securityId !== null) return null;
  if (event.envelopeCashAmount === null) return null;
  // Signe du point de vue de l'investisseur : apport négatif, retrait positif.
  return direction === "EXTERNAL_IN"
    ? -Math.abs(event.envelopeCashAmount)
    : Math.abs(event.envelopeCashAmount);
}

interface ConvertedAmount {
  value: number | null;
  blockers: string[];
  flags: string[];
}

function convertHistoricalAmount(
  amount: number | null,
  sourceCurrency: string,
  targetCurrency: string,
  valueDate: string,
  rates: CurrencyRate[],
  missingAmountBlocker: string,
): ConvertedAmount {
  if (amount === null) return { value: null, blockers: [missingAmountBlocker], flags: [] };
  const fx = resolveFxRate(sourceCurrency, targetCurrency, valueDate, rates);
  if (fx.rate === null) {
    return {
      value: null,
      blockers:
        fx.flags.length > 0
          ? fx.flags
          : [`FX_MISSING:${sourceCurrency}/${targetCurrency}@${valueDate}`],
      flags: fx.flags,
    };
  }
  return { value: amount * fx.rate, blockers: [], flags: fx.flags };
}

function strictConvertedSum(amounts: ConvertedAmount[]): AnalyticsMetric {
  const blockers = amounts.flatMap((item) => item.blockers);
  const flags = amounts.flatMap((item) => item.flags);
  if (blockers.length > 0) return unavailable(blockers, flags);
  return complete(
    amounts.reduce((sum, item) => sum + (item.value as number), 0),
    [...new Set(flags)],
  );
}

function sumExternal(
  selected: PortfolioEvent[],
  direction: "EXTERNAL_IN" | "EXTERNAL_OUT",
  targetCurrency: string,
  rates: CurrencyRate[],
): AnalyticsMetric {
  const matching = selected.filter((event) => PORTFOLIO_FLOW_DIRECTION[event.type] === direction);
  if (matching.some((event) => event.securityId !== null)) {
    return unavailable(["EXTERNAL_TRANSFER_IN_KIND"]);
  }
  return strictConvertedSum(
    matching.map((event) =>
      convertHistoricalAmount(
        event.envelopeCashAmount === null ? null : Math.abs(event.envelopeCashAmount),
        event.currency,
        targetCurrency,
        event.eventDate,
        rates,
        `EXTERNAL_FLOW_AMOUNT_MISSING:${event.id}`,
      ),
    ),
  );
}

function sumEventCash(
  selected: PortfolioEvent[],
  types: PortfolioEvent["type"][],
  targetCurrency: string,
  rates: CurrencyRate[],
): AnalyticsMetric {
  const matching = selected.filter((event) => types.includes(event.type));
  return strictConvertedSum(
    matching.map((event) =>
      convertHistoricalAmount(
        event.envelopeCashAmount === null && event.grossAmount === null
          ? null
          : Math.abs(event.envelopeCashAmount ?? (event.grossAmount as number)),
        event.currency,
        targetCurrency,
        event.eventDate,
        rates,
        `EVENT_AMOUNT_MISSING:${event.id}`,
      ),
    ),
  );
}

function sumCharges(
  selected: PortfolioEvent[],
  dedicatedType: "FEE" | "TAX",
  targetCurrency: string,
  rates: CurrencyRate[],
): AnalyticsMetric {
  const bearing = selected.filter(
    (event) =>
      event.type === dedicatedType ||
      ["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT"].includes(event.type),
  );
  return strictConvertedSum(
    bearing.map((event) => {
      const amount =
        event.type === dedicatedType
          ? (event.grossAmount ??
            (event.envelopeCashAmount === null ? null : Math.abs(event.envelopeCashAmount)))
          : dedicatedType === "FEE"
            ? event.feeAmount
            : event.taxAmount;
      return convertHistoricalAmount(
        amount,
        event.currency,
        targetCurrency,
        event.eventDate,
        rates,
        `${dedicatedType}_AMOUNT_MISSING:${event.id}`,
      );
    }),
  );
}

interface NormalisedExternalEvents {
  events: PortfolioEvent[] | null;
  blockers: string[];
  flags: string[];
}

function normaliseExternalEvents(
  events: PortfolioEvent[],
  targetCurrency: string,
  rates: CurrencyRate[],
): NormalisedExternalEvents {
  const normalised: PortfolioEvent[] = [];
  const blockers: string[] = [];
  const flags: string[] = [];
  for (const event of events.filter((item) =>
    PORTFOLIO_FLOW_DIRECTION[item.type].startsWith("EXTERNAL"),
  )) {
    if (event.securityId !== null) {
      blockers.push(`EXTERNAL_TRANSFER_IN_KIND:${event.id}`);
      continue;
    }
    const converted = convertHistoricalAmount(
      event.envelopeCashAmount,
      event.currency,
      targetCurrency,
      event.eventDate,
      rates,
      `EXTERNAL_FLOW_AMOUNT_MISSING:${event.id}`,
    );
    blockers.push(...converted.blockers);
    flags.push(...converted.flags);
    if (converted.value !== null) {
      normalised.push({
        ...event,
        currency: targetCurrency,
        envelopeCashAmount: converted.value,
      });
    }
  }
  return {
    events: blockers.length === 0 ? normalised : null,
    blockers: [...new Set(blockers)],
    flags: [...new Set(flags)],
  };
}

interface TwrResult {
  metric: AnalyticsMetric;
  series: PerformancePoint[];
  returns: number[];
  gaps: number[];
}

function calculateTwr(
  observations: AccountBalanceObservation[],
  events: PortfolioEvent[],
  start: string,
  end: string,
): TwrResult {
  const empty = (blockers: string[]): TwrResult => ({
    metric: unavailable(blockers),
    series: [],
    returns: [],
    gaps: [],
  });
  if (start >= end) return empty(["PERFORMANCE_WINDOW_EMPTY"]);
  if (observations[0]?.balanceDate !== start) return empty(["OPENING_VALUATION_MISSING"]);
  if (observations.at(-1)?.balanceDate !== end) return empty(["ENDING_VALUATION_MISSING"]);
  if (observations.length < 2) return empty(["VALUATION_HISTORY_TOO_SHORT"]);

  const external = events.filter((event) =>
    PORTFOLIO_FLOW_DIRECTION[event.type].startsWith("EXTERNAL"),
  );
  if (external.some((event) => externalCashFlow(event) === null)) {
    return empty(["EXTERNAL_FLOW_NOT_VALUED"]);
  }
  if (external.some((event) => event.eventDate === start)) {
    return empty(["OPENING_DATE_FLOW_TIMING_AMBIGUOUS"]);
  }
  const observationDates = new Set(observations.map((item) => item.balanceDate));
  if (external.some((event) => !observationDates.has(event.eventDate))) {
    return empty(["FLOW_DATE_VALUATION_MISSING"]);
  }

  const flowByDate = new Map<string, number>();
  for (const event of external) {
    // Valeur dans l'enveloppe : apport positif, retrait négatif.
    const investorFlow = externalCashFlow(event) as number;
    flowByDate.set(event.eventDate, (flowByDate.get(event.eventDate) ?? 0) - investorFlow);
  }

  const returns: number[] = [];
  const gaps: number[] = [];
  const series: PerformancePoint[] = [
    {
      date: observations[0].balanceDate,
      value: observations[0].balance,
      externalFlow: 0,
      periodReturn: null,
      wealthIndex: 1,
    },
  ];
  let wealthIndex = 1;
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    if (previous.balance <= 0) return empty(["NON_POSITIVE_RETURN_DENOMINATOR"]);
    const flow = flowByDate.get(current.balanceDate) ?? 0;
    const periodReturn = (current.balance - flow) / previous.balance - 1;
    if (!Number.isFinite(periodReturn) || periodReturn <= -1) {
      return empty(["INVALID_SUBPERIOD_RETURN"]);
    }
    wealthIndex *= 1 + periodReturn;
    returns.push(periodReturn);
    gaps.push(daysBetween(previous.balanceDate, current.balanceDate));
    series.push({
      date: current.balanceDate,
      value: current.balance,
      externalFlow: flow,
      periodReturn,
      wealthIndex,
    });
  }
  return {
    metric: complete(
      wealthIndex - 1,
      external.length > 0 ? ["TWR_END_OF_DAY_FLOW_CONVENTION"] : [],
    ),
    series,
    returns,
    gaps,
  };
}

interface DatedCashFlow {
  date: string;
  amount: number;
}

function xnpv(rate: number, flows: DatedCashFlow[]): number {
  const start = flows[0].date;
  return flows.reduce(
    (sum, flow) => sum + flow.amount / (1 + rate) ** (daysBetween(start, flow.date) / 365),
    0,
  );
}

function calculateXirr(flows: DatedCashFlow[]): AnalyticsMetric {
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) {
    return unavailable(["XIRR_CASH_FLOW_SIGNS_INVALID"]);
  }
  // Recherche en y = ln(1+r), donc r reste strictement supérieur à -100 %.
  const brackets: Array<[number, number]> = [];
  const steps = 1600;
  let previousY = -13.8;
  let previousValue = xnpv(Math.exp(previousY) - 1, flows);
  for (let step = 1; step <= steps; step += 1) {
    const y = -13.8 + (23.8 * step) / steps;
    const value = xnpv(Math.exp(y) - 1, flows);
    if (Number.isFinite(value) && Number.isFinite(previousValue)) {
      if (value === 0) brackets.push([y, y]);
      else if (Math.sign(value) !== Math.sign(previousValue)) brackets.push([previousY, y]);
    }
    previousY = y;
    previousValue = value;
  }
  if (brackets.length === 0) return unavailable(["XIRR_NO_SOLUTION"]);
  if (brackets.length > 1) return unavailable(["XIRR_MULTIPLE_SOLUTIONS"]);
  let [low, high] = brackets[0];
  for (let iteration = 0; iteration < 160 && high - low > 1e-12; iteration += 1) {
    const middle = (low + high) / 2;
    const lowValue = xnpv(Math.exp(low) - 1, flows);
    const middleValue = xnpv(Math.exp(middle) - 1, flows);
    if (Math.sign(lowValue) === Math.sign(middleValue)) low = middle;
    else high = middle;
  }
  const rate = Math.exp((low + high) / 2) - 1;
  return Number.isFinite(rate) ? complete(rate) : unavailable(["XIRR_NUMERICAL_FAILURE"]);
}

function weightedAverageFxUnsafe(
  ledger: PortfolioEnvelopeLedger,
  events: PortfolioEvent[],
  targetCurrency: string,
  securityId?: string,
): boolean {
  const hasRelevantDisposal = ledger.disposals.some(
    (disposal) => securityId === undefined || disposal.securityId === securityId,
  );
  return (
    ledger.lotMatchingMethod === "WEIGHTED_AVERAGE" &&
    hasRelevantDisposal &&
    events.some(
      (event) =>
        event.accountId === ledger.accountId &&
        event.securityId !== null &&
        (securityId === undefined || event.securityId === securityId) &&
        event.currency.toUpperCase() !== targetCurrency.toUpperCase(),
    )
  );
}

function realisedMetric(
  ledger: PortfolioEnvelopeLedger,
  events: PortfolioEvent[],
  targetCurrency: string,
  rates: CurrencyRate[],
  securityId?: string,
): AnalyticsMetric {
  const disposals = ledger.disposals.filter(
    (disposal) => securityId === undefined || disposal.securityId === securityId,
  );
  if (disposals.length === 0) return complete(0);
  if (weightedAverageFxUnsafe(ledger, events, targetCurrency, securityId)) {
    return unavailable(["FX_WEIGHTED_AVERAGE_LOTS_NOT_NORMALISED"]);
  }

  const convertedPnls: ConvertedAmount[] = [];
  const disposalFlags: string[] = [];
  for (const disposal of disposals) {
    disposalFlags.push(...disposal.flags);
    if (disposal.netProceeds === null || disposal.matchedCost === null) {
      return unavailable(
        [`DISPOSAL_COST_OR_PROCEEDS_UNKNOWN:${disposal.eventId}`],
        [...ledger.flags, ...disposalFlags],
      );
    }
    const disposalEvent = events.find((event) => event.id === disposal.eventId);
    if (!disposalEvent) {
      return unavailable([`DISPOSAL_EVENT_MISSING:${disposal.eventId}`], disposalFlags);
    }
    const proceeds = convertHistoricalAmount(
      disposal.netProceeds,
      disposalEvent.currency,
      targetCurrency,
      disposalEvent.eventDate,
      rates,
      `DISPOSAL_PROCEEDS_MISSING:${disposal.eventId}`,
    );
    const costs = disposal.matches.map((match) => {
      const acquisition = events.find((event) => event.id === match.lotEventId);
      if (!acquisition) {
        return {
          value: null,
          blockers: [`ACQUISITION_EVENT_MISSING:${match.lotEventId}`],
          flags: [],
        };
      }
      return convertHistoricalAmount(
        match.cost,
        acquisition.currency,
        targetCurrency,
        acquisition.eventDate,
        rates,
        `MATCHED_COST_MISSING:${match.lotEventId}`,
      );
    });
    const convertedCost = strictConvertedSum(costs);
    if (proceeds.value === null || convertedCost.value === null) {
      return unavailable(
        [...proceeds.blockers, ...convertedCost.blockers],
        [...disposalFlags, ...proceeds.flags, ...convertedCost.flags],
      );
    }
    const hasFx =
      disposalEvent.currency.toUpperCase() !== targetCurrency.toUpperCase() ||
      disposal.matches.some((match) => {
        const acquisition = events.find((event) => event.id === match.lotEventId);
        return (
          acquisition !== undefined &&
          acquisition.currency.toUpperCase() !== targetCurrency.toUpperCase()
        );
      });
    convertedPnls.push({
      value: proceeds.value - convertedCost.value,
      blockers: [],
      flags: [
        ...proceeds.flags,
        ...convertedCost.flags,
        ...(hasFx ? ["FX_PNL_INCLUDES_CURRENCY_EFFECT"] : []),
      ],
    });
  }
  const result = strictConvertedSum(convertedPnls);
  return {
    ...result,
    flags: [...new Set([...result.flags, ...disposalFlags])],
  };
}

function holdingUnrealisedMetric(
  holding: PortfolioHolding,
  ledger: PortfolioEnvelopeLedger,
  positions: Position[],
  events: PortfolioEvent[],
  targetCurrency: string,
  rates: CurrencyRate[],
): AnalyticsMetric {
  if (weightedAverageFxUnsafe(ledger, events, targetCurrency, holding.securityId)) {
    return unavailable(["FX_WEIGHTED_AVERAGE_LOTS_NOT_NORMALISED"]);
  }
  const securityPositions = positions.filter(
    (position) =>
      position.accountId === ledger.accountId &&
      position.securityId === holding.securityId &&
      !position.isCash,
  );
  if (holding.quantityState !== "RECONCILED") {
    return unavailable([`POSITION_LEDGER_RECONCILIATION_INCOMPLETE:${holding.securityId}`]);
  }
  const marketValue = strictConvertedSum(
    securityPositions.map((position) => {
      if (!position.valuationDate) {
        return {
          value: null,
          blockers: [`POSITION_VALUATION_DATE_MISSING:${position.id}`],
          flags: [],
        };
      }
      return convertHistoricalAmount(
        position.value,
        position.currency,
        targetCurrency,
        position.valuationDate,
        rates,
        `POSITION_VALUE_MISSING:${position.id}`,
      );
    }),
  );
  const openLots = holding.lots.filter((lot) => lot.openQuantity > PORTFOLIO_TOLERANCE);
  if ((holding.ledgerQuantity ?? 0) > PORTFOLIO_TOLERANCE && openLots.length === 0) {
    return unavailable([`OPEN_LOTS_MISSING:${holding.securityId}`], marketValue.flags);
  }
  const openCost = strictConvertedSum(
    openLots.map((lot) =>
      convertHistoricalAmount(
        lot.openCost,
        lot.currency,
        targetCurrency,
        lot.acquiredAt,
        rates,
        `OPEN_COST_BASIS_MISSING:${lot.eventId}`,
      ),
    ),
  );
  if (marketValue.value === null || openCost.value === null) {
    return unavailable(
      [...marketValue.blockers, ...openCost.blockers],
      [...marketValue.flags, ...openCost.flags],
    );
  }
  const hasFx =
    securityPositions.some(
      (position) => position.currency.toUpperCase() !== targetCurrency.toUpperCase(),
    ) || openLots.some((lot) => lot.currency.toUpperCase() !== targetCurrency.toUpperCase());
  return complete(marketValue.value - openCost.value, [
    ...new Set([
      ...marketValue.flags,
      ...openCost.flags,
      ...(hasFx ? ["FX_PNL_INCLUDES_CURRENCY_EFFECT"] : []),
    ]),
  ]);
}

function unrealisedMetric(
  ledger: PortfolioEnvelopeLedger,
  positions: Position[],
  events: PortfolioEvent[],
  targetCurrency: string,
  rates: CurrencyRate[],
): AnalyticsMetric {
  const accountPositions = positions.filter(
    (position) => position.accountId === ledger.accountId && !position.isCash,
  );
  if (accountPositions.some((position) => !position.securityId)) {
    return unavailable(["POSITION_SECURITY_ID_MISSING"]);
  }
  const orphanPosition = accountPositions.find(
    (position) => !ledger.holdings.some((holding) => holding.securityId === position.securityId),
  );
  if (orphanPosition) {
    return unavailable([`POSITION_LEDGER_RECONCILIATION_INCOMPLETE:${orphanPosition.id}`]);
  }
  const holdings = ledger.holdings.map((holding) =>
    holdingUnrealisedMetric(holding, ledger, positions, events, targetCurrency, rates),
  );
  const blockers = holdings.flatMap((metric) => metric.blockers);
  const flags = holdings.flatMap((metric) => metric.flags);
  if (blockers.length > 0) return unavailable(blockers, flags);
  return complete(
    holdings.reduce((sum, metric) => sum + (metric.value as number), 0),
    [...new Set(flags)],
  );
}

function riskMetrics(twr: TwrResult): {
  drawdown: AnalyticsMetric;
  volatility: AnalyticsMetric;
} {
  if (twr.metric.value === null) {
    return {
      drawdown: unavailable(twr.metric.blockers),
      volatility: unavailable(twr.metric.blockers),
    };
  }
  let peak = 1;
  let maximumDrawdown = 0;
  for (const point of twr.series) {
    peak = Math.max(peak, point.wealthIndex);
    maximumDrawdown = Math.min(maximumDrawdown, point.wealthIndex / peak - 1);
  }
  const sparse = twr.gaps.some((gap) => gap > 35) ? ["SPARSE_VALUATION_HISTORY"] : [];
  const drawdown = complete(maximumDrawdown, sparse);
  if (twr.returns.length < 12) {
    return { drawdown, volatility: unavailable(["RISK_HISTORY_TOO_SHORT"], sparse) };
  }
  if (twr.gaps.some((gap) => gap < 25 || gap > 35)) {
    return { drawdown, volatility: unavailable(["RISK_INTERVALS_NOT_MONTHLY"], sparse) };
  }
  const mean = twr.returns.reduce((sum, value) => sum + value, 0) / twr.returns.length;
  const variance =
    twr.returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (twr.returns.length - 1);
  return { drawdown, volatility: complete(Math.sqrt(variance) * Math.sqrt(12)) };
}

function buildAttribution(
  ledger: PortfolioEnvelopeLedger,
  events: PortfolioEvent[],
  positions: Position[],
  rates: CurrencyRate[],
  realised: AnalyticsMetric,
  unrealised: AnalyticsMetric,
  income: AnalyticsMetric,
  fees: AnalyticsMetric,
  taxes: AnalyticsMetric,
  economicGain: AnalyticsMetric,
  openingValue: AnalyticsMetric,
): PortfolioAttribution {
  const blockers: string[] = [];
  if (openingValue.value === null || Math.abs(openingValue.value) > PORTFOLIO_TOLERANCE) {
    blockers.push("OPENING_SECURITY_VALUATIONS_MISSING");
  }
  for (const metric of [realised, unrealised, income, fees, taxes, economicGain]) {
    blockers.push(...metric.blockers);
  }
  if (blockers.length > 0) {
    return {
      status: "NOT_COMPUTABLE",
      explainedPerformance: null,
      residual: null,
      components: [],
      blockers: [...new Set(blockers)],
      flags: [],
    };
  }

  const components: PortfolioAttributionComponent[] = [];
  for (const holding of ledger.holdings) {
    const matchingPositions = events.filter(
      (event) =>
        event.securityId === holding.securityId &&
        (event.type === "DIVIDEND" || event.type === "INTEREST"),
    );
    const securityRealised = realisedMetric(
      ledger,
      events,
      ledger.currency,
      rates,
      holding.securityId,
    );
    const securityIncome = sumEventCash(
      matchingPositions,
      ["DIVIDEND", "INTEREST"],
      ledger.currency,
      rates,
    );
    const securityUnrealised = holdingUnrealisedMetric(
      holding,
      ledger,
      positions,
      events,
      ledger.currency,
      rates,
    );
    const securityBlockers = [
      ...securityRealised.blockers,
      ...securityIncome.blockers,
      ...securityUnrealised.blockers,
    ];
    if (securityBlockers.length > 0) {
      return {
        status: "NOT_COMPUTABLE",
        explainedPerformance: null,
        residual: null,
        components: [],
        blockers: [...new Set(securityBlockers)],
        flags: [
          ...new Set([
            ...securityRealised.flags,
            ...securityIncome.flags,
            ...securityUnrealised.flags,
          ]),
        ],
      };
    }
    components.push({
      key: holding.securityId,
      label: holding.securityName,
      value:
        (securityRealised.value as number) +
        (securityUnrealised.value as number) +
        (securityIncome.value as number),
      kind: "SECURITY",
    });
  }
  const unassignedIncome = sumEventCash(
    events.filter(
      (event) =>
        event.securityId === null && (event.type === "DIVIDEND" || event.type === "INTEREST"),
    ),
    ["DIVIDEND", "INTEREST"],
    ledger.currency,
    rates,
  );
  if (unassignedIncome.value === null) {
    return {
      status: "NOT_COMPUTABLE",
      explainedPerformance: null,
      residual: null,
      components: [],
      blockers: unassignedIncome.blockers,
      flags: unassignedIncome.flags,
    };
  }
  if (unassignedIncome.value !== 0) {
    components.push({
      key: "income",
      label: "Revenus non affectés",
      value: unassignedIncome.value,
      kind: "INCOME",
    });
  }
  const dedicatedCharges = sumEventCash(events, ["FEE", "TAX"], ledger.currency, rates);
  if (dedicatedCharges.value === null) {
    return {
      status: "NOT_COMPUTABLE",
      explainedPerformance: null,
      residual: null,
      components: [],
      blockers: dedicatedCharges.blockers,
      flags: dedicatedCharges.flags,
    };
  }
  if (dedicatedCharges.value !== 0) {
    components.push({
      key: "charges",
      label: "Frais et taxes dédiés",
      value: -dedicatedCharges.value,
      kind: "CHARGE",
    });
  }
  const explainedPerformance = components.reduce((sum, item) => sum + item.value, 0);
  const residual = (economicGain.value as number) - explainedPerformance;
  if (Math.abs(residual) > PORTFOLIO_TOLERANCE) {
    return {
      status: "NOT_COMPUTABLE",
      explainedPerformance: null,
      residual,
      components,
      blockers: ["ATTRIBUTION_DOES_NOT_RECONCILE"],
      flags: [],
    };
  }
  return {
    status: "COMPLETE",
    explainedPerformance,
    residual,
    components,
    blockers: [],
    flags: ["TRANSACTION_CHARGES_ALREADY_EMBEDDED_IN_PNL"],
  };
}

function envelopeAnalytics(
  input: BuildPortfolioAnalyticsInput,
  account: FinancialAccount,
  ledger: PortfolioEnvelopeLedger,
): PortfolioEnvelopeAnalytics {
  const coverageBlocker = `LEDGER_COVERAGE_${ledger.coverageStatus}`;
  if (ledger.coverageStatus !== "DECLARED" || ledger.coverageStart === null) {
    const metric = unavailable([coverageBlocker]);
    const attribution: PortfolioAttribution = {
      status: "NOT_COMPUTABLE",
      explainedPerformance: null,
      residual: null,
      components: [],
      blockers: [coverageBlocker],
      flags: [],
    };
    return {
      accountId: account.id,
      accountName: account.name,
      currency: account.currency,
      coverageStart: ledger.coverageStart,
      openingValue: metric,
      endingValue: metric,
      contributions: metric,
      withdrawals: metric,
      netExternalFlow: metric,
      economicGain: metric,
      twr: metric,
      xirr: metric,
      realisedPnL: metric,
      unrealisedPnL: metric,
      income: metric,
      fees: metric,
      taxes: metric,
      observedMaxDrawdown: metric,
      annualisedVolatility: metric,
      performanceSeries: [],
      attribution,
      flags: ledger.flags,
    };
  }

  const start = ledger.coverageStart;
  const observations = latestDailyObservations(
    account.id,
    input.balanceHistory,
    start,
    input.asOfDate,
  );
  const selectedEvents = windowEvents(account.id, input.events, start, input.asOfDate);
  const rates = input.currencyRates ?? [];
  const opening = observations.find((item) => item.balanceDate === start);
  const ending = observations.find((item) => item.balanceDate === input.asOfDate);
  const openingValue = opening
    ? complete(opening.balance)
    : unavailable(["OPENING_VALUATION_MISSING"]);
  const endingValue = ending ? complete(ending.balance) : unavailable(["ENDING_VALUATION_MISSING"]);
  const contributions = sumExternal(selectedEvents, "EXTERNAL_IN", account.currency, rates);
  const withdrawals = sumExternal(selectedEvents, "EXTERNAL_OUT", account.currency, rates);
  const netExternalFlow =
    contributions.value === null || withdrawals.value === null
      ? unavailable([...contributions.blockers, ...withdrawals.blockers])
      : complete(contributions.value - withdrawals.value);
  const economicGain =
    openingValue.value === null || endingValue.value === null || netExternalFlow.value === null
      ? unavailable([
          ...openingValue.blockers,
          ...endingValue.blockers,
          ...netExternalFlow.blockers,
        ])
      : complete(endingValue.value - openingValue.value - netExternalFlow.value);
  const income = sumEventCash(selectedEvents, ["DIVIDEND", "INTEREST"], account.currency, rates);
  const fees = sumCharges(selectedEvents, "FEE", account.currency, rates);
  const taxes = sumCharges(selectedEvents, "TAX", account.currency, rates);
  const realised = realisedMetric(ledger, selectedEvents, account.currency, rates);
  const unrealised = unrealisedMetric(
    ledger,
    input.positions,
    selectedEvents,
    account.currency,
    rates,
  );
  const normalisedExternal = normaliseExternalEvents(selectedEvents, account.currency, rates);
  const twr: TwrResult = normalisedExternal.events
    ? calculateTwr(observations, normalisedExternal.events, start, input.asOfDate)
    : {
        metric: unavailable(normalisedExternal.blockers, normalisedExternal.flags),
        series: [],
        returns: [],
        gaps: [],
      };
  const risk = riskMetrics(twr);
  let xirr: AnalyticsMetric;
  if (openingValue.value === null || endingValue.value === null) {
    xirr = unavailable([...openingValue.blockers, ...endingValue.blockers]);
  } else if (normalisedExternal.events === null) {
    xirr = unavailable(normalisedExternal.blockers, normalisedExternal.flags);
  } else {
    const flows: DatedCashFlow[] = [
      { date: start, amount: -openingValue.value },
      ...normalisedExternal.events.map((event) => ({
        date: event.eventDate,
        amount: externalCashFlow(event) as number,
      })),
      { date: input.asOfDate, amount: endingValue.value },
    ].sort((a, b) => a.date.localeCompare(b.date));
    xirr = calculateXirr(flows);
  }
  const attribution = buildAttribution(
    ledger,
    selectedEvents,
    input.positions,
    rates,
    realised,
    unrealised,
    income,
    fees,
    taxes,
    economicGain,
    openingValue,
  );
  return {
    accountId: account.id,
    accountName: account.name,
    currency: account.currency,
    coverageStart: start,
    openingValue,
    endingValue,
    contributions,
    withdrawals,
    netExternalFlow,
    economicGain,
    twr: twr.metric,
    xirr,
    realisedPnL: realised,
    unrealisedPnL: unrealised,
    income,
    fees,
    taxes,
    observedMaxDrawdown: risk.drawdown,
    annualisedVolatility: risk.volatility,
    performanceSeries: twr.series,
    attribution,
    flags: [...new Set(ledger.flags)],
  };
}

function investmentAccountIds(accounts: FinancialAccount[]): Set<string> {
  return new Set(
    accounts
      .filter((account) => account.type !== "BANK" && account.type !== "SAVINGS")
      .map((account) => account.id),
  );
}

function unavailablePerformance(
  currency: string,
  blockers: string[],
  coverageStart: string | null = null,
  flags: string[] = [],
): PortfolioPerformanceAnalytics {
  const metric = unavailable(blockers, flags);
  return {
    currency,
    coverageStart,
    openingValue: metric,
    endingValue: metric,
    contributions: metric,
    withdrawals: metric,
    netExternalFlow: metric,
    economicGain: metric,
    twr: metric,
    xirr: metric,
    observedMaxDrawdown: metric,
    annualisedVolatility: metric,
    performanceSeries: [],
    flags,
  };
}

function buildAggregatePerformance(
  input: BuildPortfolioAnalyticsInput,
  accounts: FinancialAccount[],
  ledgers: PortfolioEnvelopeLedger[],
): PortfolioPerformanceAnalytics {
  if (accounts.length === 0) {
    return unavailablePerformance(input.reportingCurrency, ["NO_INVESTMENT_ENVELOPE"]);
  }
  const invalidCoverage = ledgers.filter(
    (ledger) => ledger.coverageStatus !== "DECLARED" || ledger.coverageStart === null,
  );
  if (invalidCoverage.length > 0) {
    return unavailablePerformance(
      input.reportingCurrency,
      invalidCoverage.map(
        (ledger) => `LEDGER_COVERAGE_${ledger.coverageStatus}:${ledger.accountId}`,
      ),
    );
  }
  const starts = [...new Set(ledgers.map((ledger) => ledger.coverageStart as string))];
  if (starts.length !== 1) {
    return unavailablePerformance(input.reportingCurrency, ["COVERAGE_WINDOWS_NOT_ALIGNED"]);
  }
  const start = starts[0];
  const dailyByAccount = new Map(
    accounts.map((account) => [
      account.id,
      latestDailyObservations(account.id, input.balanceHistory, start, input.asOfDate),
    ]),
  );
  const dateSets = accounts.map(
    (account) => new Set((dailyByAccount.get(account.id) ?? []).map((item) => item.balanceDate)),
  );
  const commonDates = dateSets
    .slice(1)
    .reduce<Set<string>>(
      (common, dates) => new Set([...common].filter((date) => dates.has(date))),
      new Set(dateSets[0]),
    );
  if (!commonDates.has(start)) {
    return unavailablePerformance(input.reportingCurrency, ["OPENING_VALUATION_MISSING"], start);
  }
  if (!commonDates.has(input.asOfDate)) {
    return unavailablePerformance(input.reportingCurrency, ["ENDING_VALUATION_MISSING"], start);
  }

  const flags: string[] = [];
  const syntheticObservations: AccountBalanceObservation[] = [];
  for (const date of [...commonDates].sort()) {
    let balance = 0;
    for (const account of accounts) {
      const observation = (dailyByAccount.get(account.id) ?? []).find(
        (item) => item.balanceDate === date,
      );
      if (!observation) continue;
      const fx = resolveFxRate(
        account.currency,
        input.reportingCurrency,
        date,
        input.currencyRates ?? [],
      );
      flags.push(...fx.flags);
      if (fx.rate === null) {
        return unavailablePerformance(
          input.reportingCurrency,
          fx.flags.length > 0
            ? fx.flags
            : [`FX_MISSING:${account.currency}/${input.reportingCurrency}@${date}`],
          start,
          flags,
        );
      }
      balance += observation.balance * fx.rate;
    }
    syntheticObservations.push({
      id: `portfolio:${date}`,
      accountId: "PORTFOLIO",
      balance,
      balanceDate: date,
      createdAt: `${date}T23:59:59Z`,
      provenance: {
        kind: "DERIVED",
        confidence: "HIGH",
        effectiveDate: date,
        source: "account_balances + FX Engine",
      },
    });
  }

  const syntheticEvents: PortfolioEvent[] = [];
  for (const event of input.events.filter(
    (item) =>
      accounts.some((account) => account.id === item.accountId) &&
      item.eventDate >= start &&
      item.eventDate <= input.asOfDate &&
      PORTFOLIO_FLOW_DIRECTION[item.type].startsWith("EXTERNAL"),
  )) {
    let convertedAmount = event.envelopeCashAmount;
    if (convertedAmount !== null) {
      const fx = resolveFxRate(
        event.currency,
        input.reportingCurrency,
        event.eventDate,
        input.currencyRates ?? [],
      );
      flags.push(...fx.flags);
      if (fx.rate === null) {
        return unavailablePerformance(
          input.reportingCurrency,
          fx.flags.length > 0
            ? fx.flags
            : [`FX_MISSING:${event.currency}/${input.reportingCurrency}@${event.eventDate}`],
          start,
          flags,
        );
      }
      convertedAmount *= fx.rate;
    }
    syntheticEvents.push({
      ...event,
      accountId: "PORTFOLIO",
      currency: input.reportingCurrency,
      envelopeCashAmount: convertedAmount,
    });
  }

  const opening = syntheticObservations.find((item) => item.balanceDate === start)!;
  const ending = syntheticObservations.find((item) => item.balanceDate === input.asOfDate)!;
  const openingValue = complete(opening.balance, flags);
  const endingValue = complete(ending.balance, flags);
  const contributions = sumExternal(
    syntheticEvents,
    "EXTERNAL_IN",
    input.reportingCurrency,
    input.currencyRates ?? [],
  );
  const withdrawals = sumExternal(
    syntheticEvents,
    "EXTERNAL_OUT",
    input.reportingCurrency,
    input.currencyRates ?? [],
  );
  const netExternalFlow =
    contributions.value === null || withdrawals.value === null
      ? unavailable([...contributions.blockers, ...withdrawals.blockers], flags)
      : complete(contributions.value - withdrawals.value, flags);
  const economicGain =
    netExternalFlow.value === null
      ? unavailable(netExternalFlow.blockers, flags)
      : complete(ending.balance - opening.balance - netExternalFlow.value, flags);
  const twr = calculateTwr(syntheticObservations, syntheticEvents, start, input.asOfDate);
  const risk = riskMetrics(twr);
  const xirr = syntheticEvents.some((event) => externalCashFlow(event) === null)
    ? unavailable(["EXTERNAL_FLOW_NOT_VALUED"], flags)
    : calculateXirr(
        [
          { date: start, amount: -opening.balance },
          ...syntheticEvents.map((event) => ({
            date: event.eventDate,
            amount: externalCashFlow(event) as number,
          })),
          { date: input.asOfDate, amount: ending.balance },
        ].sort((a, b) => a.date.localeCompare(b.date)),
      );
  return {
    currency: input.reportingCurrency,
    coverageStart: start,
    openingValue,
    endingValue,
    contributions,
    withdrawals,
    netExternalFlow,
    economicGain,
    twr: { ...twr.metric, flags: [...new Set([...twr.metric.flags, ...flags])] },
    xirr: { ...xirr, flags: [...new Set([...xirr.flags, ...flags])] },
    observedMaxDrawdown: risk.drawdown,
    annualisedVolatility: risk.volatility,
    performanceSeries: twr.series,
    flags: [...new Set(flags)],
  };
}

function buildAllocation(input: BuildPortfolioAnalyticsInput): PortfolioAllocation {
  const accountIds = investmentAccountIds(input.accounts);
  const exposures = input.balanceSheet.envelopeExposures.filter((item) =>
    accountIds.has(item.accountId),
  );
  if (exposures.length === 0) {
    return {
      status: "NOT_COMPUTABLE",
      totalValue: null,
      buckets: [],
      blockers: ["NO_INVESTMENT_ENVELOPE"],
      flags: [],
    };
  }
  if (exposures.some((item) => item.accountValue.value === null)) {
    return {
      status: "NOT_COMPUTABLE",
      totalValue: null,
      buckets: [],
      blockers: ["ENVELOPE_VALUE_MISSING"],
      flags: [],
    };
  }
  const totalValue = exposures.reduce((sum, item) => sum + (item.accountValue.value as number), 0);
  if (totalValue <= 0) {
    return {
      status: "NOT_COMPUTABLE",
      totalValue: null,
      buckets: [],
      blockers: ["NON_POSITIVE_PORTFOLIO_VALUE"],
      flags: [],
    };
  }
  const amounts = new Map<
    string,
    { label: string; value: number; kind: AllocationBucket["kind"] }
  >();
  const add = (key: string, label: string, value: number, kind: AllocationBucket["kind"]) => {
    const current = amounts.get(key);
    amounts.set(key, { label, value: (current?.value ?? 0) + value, kind });
  };
  for (const exposure of exposures) {
    if (!exposure.exposureKnown) {
      add(
        "unexposed",
        "Exposition non documentée",
        exposure.accountValue.value as number,
        "UNEXPOSED",
      );
      continue;
    }
    const lines = input.balanceSheet.contributions.filter(
      (line) => line.envelopeAccountId === exposure.accountId && line.reportingValue !== null,
    );
    for (const line of lines.filter((item) => item.category === "MARKET_POSITION")) {
      const label = line.subcategory || "Classe non renseignée";
      add(`asset:${label}`, label, line.reportingValue as number, "ASSET_CLASS");
    }
    if ((exposure.cashExposure.value ?? 0) !== 0) {
      add("cash", "Cash d’enveloppe", exposure.cashExposure.value as number, "CASH");
    }
    if ((exposure.unexposedValue.value ?? 0) > PORTFOLIO_TOLERANCE) {
      add(
        "unexposed",
        "Exposition non documentée",
        exposure.unexposedValue.value as number,
        "UNEXPOSED",
      );
    }
  }
  const buckets = [...amounts.entries()]
    .map(([key, item]) => ({ key, ...item, weight: item.value / totalValue }))
    .sort((a, b) => b.value - a.value);
  const hasUnexposed = buckets.some(
    (item) => item.kind === "UNEXPOSED" && item.value > PORTFOLIO_TOLERANCE,
  );
  return {
    status: hasUnexposed ? "PARTIAL" : "COMPLETE",
    totalValue,
    buckets,
    blockers: hasUnexposed ? ["UNEXPOSED_ENVELOPE_VALUE"] : [],
    flags: [],
  };
}

function buildConcentration(input: BuildPortfolioAnalyticsInput): PortfolioConcentration {
  const accountIds = investmentAccountIds(input.accounts);
  const exposures = input.balanceSheet.envelopeExposures.filter((item) =>
    accountIds.has(item.accountId),
  );
  if (
    exposures.some(
      (item) => !item.exposureKnown || (item.unexposedValue.value ?? 0) > PORTFOLIO_TOLERANCE,
    )
  ) {
    return {
      status: "NOT_COMPUTABLE",
      top1Weight: null,
      top5Weight: null,
      hhi: null,
      effectivePositions: null,
      holdings: [],
      blockers: ["PORTFOLIO_EXPOSURE_INCOMPLETE"],
      flags: [],
    };
  }
  const lines = input.balanceSheet.contributions.filter(
    (line) =>
      line.category === "MARKET_POSITION" &&
      line.envelopeAccountId !== undefined &&
      accountIds.has(line.envelopeAccountId) &&
      line.reportingValue !== null,
  );
  const total = lines.reduce((sum, line) => sum + (line.reportingValue as number), 0);
  if (total <= 0 || lines.length === 0) {
    return {
      status: "NOT_COMPUTABLE",
      top1Weight: null,
      top5Weight: null,
      hhi: null,
      effectivePositions: null,
      holdings: [],
      blockers: ["NO_MARKET_EXPOSURE"],
      flags: [],
    };
  }
  if (lines.some((line) => (line.reportingValue as number) <= 0)) {
    return {
      status: "NOT_COMPUTABLE",
      top1Weight: null,
      top5Weight: null,
      hhi: null,
      effectivePositions: null,
      holdings: [],
      blockers: ["NON_POSITIVE_MARKET_POSITION"],
      flags: [],
    };
  }
  const grouped = new Map<string, Omit<ConcentrationHolding, "weight"> & { value: number }>();
  for (const line of lines) {
    const position = input.positions.find((item) => item.id === line.entityId);
    const key = position?.securityId
      ? `security:${position.securityId}`
      : `position:${line.entityId}`;
    const current = grouped.get(key);
    grouped.set(key, {
      securityId: position?.securityId ?? null,
      positionIds: [...(current?.positionIds ?? []), line.entityId],
      accountIds: [...new Set([...(current?.accountIds ?? []), line.envelopeAccountId as string])],
      label: current?.label ?? position?.securityName ?? line.subcategory ?? line.entityId,
      value: (current?.value ?? 0) + (line.reportingValue as number),
    });
  }
  const holdings = [...grouped.values()]
    .map((holding) => ({ ...holding, weight: holding.value / total }))
    .sort((a, b) => b.value - a.value);
  const hhi = holdings.reduce((sum, item) => sum + item.weight ** 2, 0);
  return {
    status: "COMPLETE",
    top1Weight: holdings[0].weight,
    top5Weight: holdings.slice(0, 5).reduce((sum, item) => sum + item.weight, 0),
    hhi,
    effectivePositions: 1 / hhi,
    holdings,
    blockers: [],
    flags: ["CONCENTRATION_EXCLUDES_ENVELOPE_CASH"],
  };
}

export function buildPortfolioAnalytics(input: BuildPortfolioAnalyticsInput): PortfolioAnalytics {
  const accountIds = investmentAccountIds(input.accounts);
  const investmentAccounts = input.accounts.filter((account) => accountIds.has(account.id));
  const envelopeLedgers = investmentAccounts.map((account) => {
    const ledger = envelopeLedgerOf(input.ledger, account.id);
    if (!ledger) throw new Error(`Ledger portefeuille absent pour ${account.id}`);
    return ledger;
  });
  const envelopes = investmentAccounts.map((account) => {
    const ledger = envelopeLedgerOf(input.ledger, account.id);
    if (!ledger) throw new Error(`Ledger portefeuille absent pour ${account.id}`);
    return envelopeAnalytics(input, account, ledger);
  });
  const performance = buildAggregatePerformance(input, investmentAccounts, envelopeLedgers);
  const allocation = buildAllocation(input);
  const concentration = buildConcentration(input);
  const blockers = [
    ...envelopes.flatMap((item) => [
      ...item.twr.blockers,
      ...item.xirr.blockers,
      ...item.economicGain.blockers,
    ]),
    ...allocation.blockers,
    ...concentration.blockers,
    ...performance.twr.blockers,
    ...performance.xirr.blockers,
  ];
  return {
    asOfDate: input.asOfDate,
    reportingCurrency: input.reportingCurrency,
    performance,
    envelopes,
    allocation,
    concentration,
    drift: unavailable(["TARGET_ALLOCATION_MISSING"]),
    quality: {
      status:
        blockers.length === 0
          ? "COMPLETE"
          : envelopes.some((item) => item.twr.value !== null) || allocation.totalValue !== null
            ? "PARTIAL"
            : "NOT_COMPUTABLE",
      blockers: [...new Set(blockers)],
      flags: [],
    },
  };
}
