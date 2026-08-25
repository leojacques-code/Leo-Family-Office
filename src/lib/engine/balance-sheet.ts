import {
  convertWithFx,
  resolveFxRate,
  type CurrencyRate,
  type FxResolution,
} from "@/lib/engine/fx";
import type { Confidence, FinancialAccount, Liability, Position, Provenance } from "@/lib/types";

export type BalanceSheetDomain =
  | "FINANCIAL_ACCOUNT"
  | "PORTFOLIO"
  | "REAL_ESTATE"
  | "BUSINESS_EQUITY"
  | "OTHER_ASSET"
  | "DEBT"
  | "OTHER_LIABILITY";
export type BalanceSheetSide = "ASSET" | "LIABILITY";
export type ValuationMethod =
  | "OBSERVED_BALANCE"
  | "MARKET_VALUE"
  | "EXTERNAL_VALUATION"
  | "USER_ESTIMATE"
  | "MODEL_ESTIMATE"
  | "PURCHASE_PRICE"
  | "COST_BASIS";
export type ValuationStatus = "CURRENT" | "STALE" | "MISSING" | "UNRECONCILED";
export type ReconciliationState =
  "RECONCILED" | "UNDER_EXPLAINED" | "OVER_EXPLAINED" | "MISSING" | "NOT_APPLICABLE";
export type AggregateStatus = "COMPLETE" | "PARTIAL" | "NOT_COMPUTABLE";

export interface CanonicalBalanceSheetContribution {
  id: string;
  entityId: string;
  domain: BalanceSheetDomain;
  side: BalanceSheetSide;
  category: string;
  subcategory?: string;
  nativeValue: number;
  currency: string;
  valuationDate: string;
  valuationMethod: ValuationMethod;
  valuationStatus: ValuationStatus;
  liquidity: "IMMEDIATE" | "LIQUID" | "ILLIQUID";
  provenance: Provenance;
  confidence: Confidence;
  source?: string;
  reconciliationState: ReconciliationState;
  isAccountingPrimary: boolean;
  flags: string[];
}

export interface ConvertedBalanceSheetLine extends CanonicalBalanceSheetContribution {
  reportingValue: number | null;
  reportingCurrency: string;
  fx: FxResolution;
}

export interface CanonicalAggregate {
  value: number | null;
  knownValue: number;
  status: AggregateStatus;
  coverage: number;
  blockers: string[];
}

export interface PositionReconciliation {
  accountId: string;
  accountNativeValue: number;
  explainedNativeValue: number;
  gapNativeValue: number;
  state: ReconciliationState;
}

export interface CanonicalBalanceSheet {
  asOfDate: string;
  reportingCurrency: string;
  contributions: ConvertedBalanceSheetLine[];
  positionReconciliations: PositionReconciliation[];
  financialAssets: CanonicalAggregate;
  grossAssets: CanonicalAggregate;
  immediateCash: CanonicalAggregate;
  cashLikeAssets: CanonicalAggregate;
  liquidAssets: CanonicalAggregate;
  illiquidAssets: CanonicalAggregate;
  marketInvestedAssets: CanonicalAggregate;
  investmentEnvelopeCash: CanonicalAggregate;
  accountOverdraftLiabilities: CanonicalAggregate;
  contractualDebt: CanonicalAggregate;
  otherLiabilities: CanonicalAggregate;
  totalLiabilities: CanonicalAggregate;
  netWorth: CanonicalAggregate;
  liquidNetWorth: CanonicalAggregate;
  netFinancialDebt: CanonicalAggregate;
  productiveAssets: CanonicalAggregate;
  productiveNetWorth: CanonicalAggregate;
  quality: { status: AggregateStatus; blockers: string[]; flags: string[] };
}

export interface BuildCanonicalBalanceSheetInput {
  asOfDate: string;
  reportingCurrency: string;
  accounts?: FinancialAccount[];
  positions?: Position[];
  liabilities?: Liability[];
  contributions?: CanonicalBalanceSheetContribution[];
  currencyRates?: CurrencyRate[];
}

const sumNative = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

function aggregate(lines: ConvertedBalanceSheetLine[]): CanonicalAggregate {
  const known = lines.filter((line) => line.reportingValue !== null);
  const knownValue = known.reduce((sum, line) => sum + (line.reportingValue ?? 0), 0);
  const missing = lines.filter((line) => line.reportingValue === null);
  if (missing.length === 0)
    return { value: knownValue, knownValue, status: "COMPLETE", coverage: 1, blockers: [] };
  const blockers = [...new Set(missing.flatMap((line) => line.fx.flags))];
  if (known.length === 0)
    return { value: null, knownValue: 0, status: "NOT_COMPUTABLE", coverage: 0, blockers };
  return {
    value: null,
    knownValue,
    status: "PARTIAL",
    coverage: known.length / lines.length,
    blockers,
  };
}

function difference(left: CanonicalAggregate, right: CanonicalAggregate): CanonicalAggregate {
  const knownValue = left.knownValue - right.knownValue;
  const blockers = [...new Set([...left.blockers, ...right.blockers])];
  if (left.value !== null && right.value !== null) {
    return {
      value: left.value - right.value,
      knownValue,
      status: "COMPLETE",
      coverage: 1,
      blockers: [],
    };
  }
  const status =
    left.status === "NOT_COMPUTABLE" || right.status === "NOT_COMPUTABLE"
      ? "NOT_COMPUTABLE"
      : "PARTIAL";
  return {
    value: null,
    knownValue,
    status,
    coverage: Math.min(left.coverage, right.coverage),
    blockers,
  };
}

function accountContributions(accounts: FinancialAccount[]): CanonicalBalanceSheetContribution[] {
  return accounts.flatMap((account): CanonicalBalanceSheetContribution[] => {
    const common = {
      entityId: account.id,
      domain: "FINANCIAL_ACCOUNT" as const,
      currency: account.currency,
      valuationDate: account.balanceDate,
      valuationMethod: "OBSERVED_BALANCE" as const,
      valuationStatus: "CURRENT" as const,
      liquidity: account.liquidity,
      provenance: account.provenance,
      confidence: account.provenance.confidence,
      source: account.provenance.source,
      reconciliationState: "NOT_APPLICABLE" as const,
      isAccountingPrimary: true,
    };
    if (account.balance < 0) {
      return [
        {
          ...common,
          id: `account-overdraft:${account.id}`,
          side: "LIABILITY" as const,
          category: "ACCOUNT_OVERDRAFT",
          nativeValue: -account.balance,
          flags: ["LIABILITY_PROJECTION_TERMS_MISSING"],
        },
      ];
    }
    return [
      {
        ...common,
        id: `account-asset:${account.id}`,
        side: "ASSET" as const,
        category:
          account.type === "BANK" || account.type === "SAVINGS"
            ? "CASH_ACCOUNT"
            : "INVESTMENT_ENVELOPE",
        nativeValue: account.balance,
        flags: [],
      },
    ];
  });
}

function debtContributions(
  liabilities: Liability[],
  asOfDate: string,
  reportingCurrency: string,
): CanonicalBalanceSheetContribution[] {
  return liabilities
    .filter((liability) => liability.currentBalance > 0)
    .map((liability) => ({
      id: `debt:${liability.id}`,
      entityId: liability.id,
      domain: "DEBT" as const,
      side: "LIABILITY" as const,
      category: "CONTRACTUAL_DEBT",
      nativeValue: liability.currentBalance,
      currency: liability.currency ?? reportingCurrency,
      valuationDate: liability.balanceDate ?? liability.provenance.effectiveDate ?? asOfDate,
      valuationMethod: "OBSERVED_BALANCE" as const,
      valuationStatus: "CURRENT" as const,
      liquidity: "ILLIQUID" as const,
      provenance: liability.provenance,
      confidence: liability.provenance.confidence,
      source: liability.provenance.source,
      reconciliationState: "NOT_APPLICABLE" as const,
      isAccountingPrimary: true,
      flags: [],
    }));
}

function reconcilePositions(
  accounts: FinancialAccount[],
  positions: Position[],
  rates: CurrencyRate[],
): PositionReconciliation[] {
  return accounts
    .filter(
      (account) => account.type !== "BANK" && account.type !== "SAVINGS" && account.balance >= 0,
    )
    .map((account) => {
      const resolved = positions
        .filter((position) => position.accountId === account.id)
        .map((position) => {
          const fx = resolveFxRate(
            position.currency,
            account.currency,
            position.valuationDate ?? position.provenance.effectiveDate ?? account.balanceDate,
            rates,
          );
          return convertWithFx(position.value, fx);
        });
      const explainedNativeValue = sumNative(
        resolved.filter((value): value is number => value !== null),
      );
      const gapNativeValue = account.balance - explainedNativeValue;
      const state: ReconciliationState = resolved.some((value) => value === null)
        ? "MISSING"
        : Math.abs(gapNativeValue) <= 0.01
          ? "RECONCILED"
          : gapNativeValue > 0
            ? "UNDER_EXPLAINED"
            : "OVER_EXPLAINED";
      return {
        accountId: account.id,
        accountNativeValue: account.balance,
        explainedNativeValue,
        gapNativeValue,
        state,
      };
    });
}

/** Le moteur agrège des valeurs canoniques ; il ne calcule aucune dette ou valorisation de domaine. */
export function buildCanonicalBalanceSheet(
  input: BuildCanonicalBalanceSheetInput,
): CanonicalBalanceSheet {
  const accounts = input.accounts ?? [];
  const positions = input.positions ?? [];
  const rates = input.currencyRates ?? [];
  const native = [
    ...accountContributions(accounts),
    ...debtContributions(input.liabilities ?? [], input.asOfDate, input.reportingCurrency),
    ...(input.contributions ?? []),
  ];
  for (const line of native) {
    if (!Number.isFinite(line.nativeValue) || line.nativeValue < 0)
      throw new Error(
        `Canonical contribution ${line.id}: nativeValue must be finite and non-negative`,
      );
  }
  const primaryContributions = native.map((line): ConvertedBalanceSheetLine => {
    const fx = resolveFxRate(line.currency, input.reportingCurrency, line.valuationDate, rates);
    return {
      ...line,
      reportingCurrency: input.reportingCurrency,
      reportingValue: convertWithFx(line.nativeValue, fx),
      fx,
    };
  });
  const assets = primaryContributions.filter(
    (line) => line.side === "ASSET" && line.isAccountingPrimary,
  );
  const liabilities = primaryContributions.filter(
    (line) => line.side === "LIABILITY" && line.isAccountingPrimary,
  );
  const financialAssetLines = assets.filter(
    (line) => line.domain === "FINANCIAL_ACCOUNT" || line.domain === "PORTFOLIO",
  );
  const grossAssets = aggregate(assets);
  const totalLiabilities = aggregate(liabilities);
  const immediate = financialAssetLines.filter(
    (line) => line.category === "CASH_ACCOUNT" && line.liquidity === "IMMEDIATE",
  );
  const liquid = assets.filter((line) => line.liquidity !== "ILLIQUID");
  const overdrafts = liabilities.filter((line) => line.category === "ACCOUNT_OVERDRAFT");
  const contractual = liabilities.filter((line) => line.category === "CONTRACTUAL_DEBT");
  const other = liabilities.filter(
    (line) => line.category !== "ACCOUNT_OVERDRAFT" && line.category !== "CONTRACTUAL_DEBT",
  );
  const marketPositionLines: ConvertedBalanceSheetLine[] = positions
    .filter((position) => !position.isCash)
    .map((position) => {
      const fx = resolveFxRate(
        position.currency,
        input.reportingCurrency,
        position.valuationDate ?? position.provenance.effectiveDate ?? input.asOfDate,
        rates,
      );
      return {
        id: `position:${position.id}`,
        entityId: position.id,
        domain: "PORTFOLIO",
        side: "ASSET",
        category: "MARKET_POSITION",
        nativeValue: position.value,
        currency: position.currency,
        reportingValue: convertWithFx(position.value, fx),
        reportingCurrency: input.reportingCurrency,
        valuationDate:
          position.valuationDate ?? position.provenance.effectiveDate ?? input.asOfDate,
        valuationMethod: "MARKET_VALUE",
        valuationStatus: "CURRENT",
        liquidity: "LIQUID",
        provenance: position.provenance,
        confidence: position.provenance.confidence,
        source: position.provenance.source,
        reconciliationState: "NOT_APPLICABLE",
        isAccountingPrimary: false,
        flags: [],
        fx,
      };
    });
  const investmentCashLines: ConvertedBalanceSheetLine[] = positions
    .filter((position) => position.isCash)
    .map((position) => {
      const valuationDate =
        position.valuationDate ?? position.provenance.effectiveDate ?? input.asOfDate;
      const fx = resolveFxRate(position.currency, input.reportingCurrency, valuationDate, rates);
      return {
        id: `position:${position.id}`,
        entityId: position.id,
        domain: "PORTFOLIO",
        side: "ASSET",
        category: "INVESTMENT_ENVELOPE_CASH",
        nativeValue: position.value,
        currency: position.currency,
        reportingValue: convertWithFx(position.value, fx),
        reportingCurrency: input.reportingCurrency,
        valuationDate,
        valuationMethod: "MARKET_VALUE",
        valuationStatus: "CURRENT",
        liquidity: "LIQUID",
        provenance: position.provenance,
        confidence: position.provenance.confidence,
        source: position.provenance.source,
        reconciliationState: "NOT_APPLICABLE",
        isAccountingPrimary: false,
        flags: [],
        fx,
      };
    });
  const immediateCash = aggregate(immediate);
  const investmentEnvelopeCash = aggregate(investmentCashLines);
  const cashLikeAssets = (() => {
    if (immediateCash.value !== null && investmentEnvelopeCash.value !== null)
      return {
        value: immediateCash.value + investmentEnvelopeCash.value,
        knownValue: immediateCash.knownValue + investmentEnvelopeCash.knownValue,
        status: "COMPLETE" as const,
        coverage: 1,
        blockers: [],
      };
    return {
      value: null,
      knownValue: immediateCash.knownValue + investmentEnvelopeCash.knownValue,
      status: "PARTIAL" as const,
      coverage: Math.min(immediateCash.coverage, investmentEnvelopeCash.coverage),
      blockers: [...new Set([...immediateCash.blockers, ...investmentEnvelopeCash.blockers])],
    };
  })();
  const financialAssets = aggregate(financialAssetLines);
  const liquidAssets = aggregate(liquid);
  const illiquidAssets = aggregate(assets.filter((line) => line.liquidity === "ILLIQUID"));
  const accountOverdraftLiabilities = aggregate(overdrafts);
  const contractualDebt = aggregate(contractual);
  const otherLiabilities = aggregate(other);
  const netWorth = difference(grossAssets, totalLiabilities);
  const liquidNetWorth = difference(liquidAssets, totalLiabilities);
  const netFinancialDebt = difference(totalLiabilities, immediateCash);
  const marketInvestedAssets = aggregate(marketPositionLines);
  const productiveAssets = marketInvestedAssets;
  const productiveNetWorth: CanonicalAggregate = {
    value: null,
    knownValue: productiveAssets.knownValue,
    status: "NOT_COMPUTABLE",
    coverage: 0,
    blockers: ["LIABILITY_ATTRIBUTION_MISSING"],
  };
  const contributions = [...primaryContributions, ...marketPositionLines, ...investmentCashLines];
  const positionReconciliations = reconcilePositions(accounts, positions, rates);
  const accountIds = new Set(accounts.map((account) => account.id));
  const flags = [
    ...new Set([
      ...contributions.flatMap((line) => [...line.flags, ...line.fx.flags]),
      ...positionReconciliations
        .filter((item) => item.state !== "RECONCILED")
        .map((item) => `POSITION_${item.state}:${item.accountId}`),
      ...positions
        .filter((position) => !accountIds.has(position.accountId))
        .map((position) => `POSITION_ORPHAN:${position.id}`),
    ]),
  ];
  const blockers = [...new Set([...grossAssets.blockers, ...totalLiabilities.blockers])];
  return {
    asOfDate: input.asOfDate,
    reportingCurrency: input.reportingCurrency,
    contributions,
    positionReconciliations,
    financialAssets,
    grossAssets,
    immediateCash,
    cashLikeAssets,
    liquidAssets,
    illiquidAssets,
    marketInvestedAssets,
    investmentEnvelopeCash,
    accountOverdraftLiabilities,
    contractualDebt,
    otherLiabilities,
    totalLiabilities,
    netWorth,
    liquidNetWorth,
    netFinancialDebt,
    productiveAssets,
    productiveNetWorth,
    quality: { status: netWorth.status, blockers, flags },
  };
}
