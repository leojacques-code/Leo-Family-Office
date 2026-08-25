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
  /**
   * Enveloppe comptable qui porte cette ligne quand elle n'est pas elle-même comptable :
   * une position explique le solde d'un compte d'investissement et n'existe pas hors de
   * lui. C'est ce lien qui permet de raisonner enveloppe par enveloppe plutôt que sur un
   * portefeuille global indifférencié.
   */
  envelopeAccountId?: string;
  flags: string[];
}

export interface ConvertedBalanceSheetLine extends CanonicalBalanceSheetContribution {
  reportingValue: number | null;
  reportingCurrency: string;
  /** Coût d'acquisition en devise native. `null` quand il n'est pas renseigné. */
  nativeCostBasis?: number | null;
  /**
   * Coût d'acquisition converti AU MÊME taux que la valeur de marché de la ligne. La
   * plus-value qui en découle est donc une plus-value en devise native convertie au taux
   * du jour : elle n'isole pas l'effet de change sur le capital investi, et le moteur le
   * signale (`FX_PNL_NOT_ISOLATED`) plutôt que de laisser croire le contraire.
   */
  reportingCostBasis?: number | null;
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

/**
 * Exposition d'UNE enveloppe d'investissement, en devise de reporting.
 *
 * Le portefeuille n'est pas une masse indifférenciée : chaque enveloppe porte sa propre
 * qualité de réconciliation. Une enveloppe incohérente ne dit rien des autres, et ne doit
 * donc jamais neutraliser leur exposition connue. À l'inverse, une enveloppe dont la
 * composition dépasse la valeur comptable ne se voit attribuer AUCUNE exposition : sa
 * valeur comptable reste entière dans la poche sans exposition connue, ce qui n'invente
 * ni ne supprime un euro.
 */
export interface EnvelopeExposure {
  accountId: string;
  /** Devise native de l'enveloppe, conservée pour tracer la conversion appliquée. */
  currency: string;
  /** Valeur comptable de l'enveloppe : la seule vérité de montant du bilan. */
  accountValue: CanonicalAggregate;
  /** Positions non-cash logées dans l'enveloppe, converties. */
  marketExposure: CanonicalAggregate;
  /** Positions `isCash` logées dans l'enveloppe, converties. */
  cashExposure: CanonicalAggregate;
  /**
   * Part de la valeur comptable sans exposition connue. Elle vaut le reliquat non expliqué
   * quand la composition est exploitable, et la valeur comptable ENTIÈRE quand elle ne
   * l'est pas.
   */
  unexposedValue: CanonicalAggregate;
  state: ReconciliationState;
  /** Écart comptable en devise native. `null` si l'enveloppe n'est pas réconciliable. */
  gapNativeValue: number | null;
  /**
   * `true` quand la composition explique l'enveloppe sans la dépasser et sans conversion
   * manquante : l'exposition est alors utilisable pour projeter et pour ventiler.
   */
  exposureKnown: boolean;
  flags: string[];
}

export interface CanonicalBalanceSheet {
  asOfDate: string;
  reportingCurrency: string;
  contributions: ConvertedBalanceSheetLine[];
  positionReconciliations: PositionReconciliation[];
  /** Une entrée par enveloppe d'investissement, indépendante des autres. */
  envelopeExposures: EnvelopeExposure[];
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

/** Tolérance comptable unique du bilan, en devise de reporting. */
export const BALANCE_SHEET_TOLERANCE = 0.01;

function scalarAggregate(value: number | null, blockers: string[] = []): CanonicalAggregate {
  if (value === null)
    return { value: null, knownValue: 0, status: "NOT_COMPUTABLE", coverage: 0, blockers };
  return { value, knownValue: value, status: "COMPLETE", coverage: 1, blockers: [] };
}

/** Prédicat unique de l'enveloppe d'investissement : une seule définition dans le moteur. */
function isInvestmentEnvelope(account: FinancialAccount): boolean {
  return account.type !== "BANK" && account.type !== "SAVINGS" && account.balance >= 0;
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
  return accounts.filter(isInvestmentEnvelope).map((account) => {
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

/**
 * Exposition enveloppe par enveloppe. Aucune agrégation globale n'intervient ici : la
 * qualité de réconciliation du CTO ne touche pas au PEA, et réciproquement.
 */
function buildEnvelopeExposures(
  envelopeLines: ConvertedBalanceSheetLine[],
  marketLines: ConvertedBalanceSheetLine[],
  cashLines: ConvertedBalanceSheetLine[],
  reconciliations: PositionReconciliation[],
): EnvelopeExposure[] {
  return envelopeLines.map((line): EnvelopeExposure => {
    const accountId = line.entityId;
    const marketExposure = aggregate(marketLines.filter((l) => l.envelopeAccountId === accountId));
    const cashExposure = aggregate(cashLines.filter((l) => l.envelopeAccountId === accountId));
    const reconciliation = reconciliations.find((item) => item.accountId === accountId) ?? null;
    const state: ReconciliationState = reconciliation?.state ?? "MISSING";
    const accountValue = line.reportingValue;
    const flags: string[] = [];
    // Une composition qui dépasse son enveloppe, ou dont une conversion manque, ne dit rien
    // de l'exposition réelle : elle n'est pas répartie au prorata, ce serait l'inventer.
    const composable = marketExposure.status === "COMPLETE" && cashExposure.status === "COMPLETE";
    const structurallyExplained = state === "RECONCILED" || state === "UNDER_EXPLAINED";
    const residual =
      accountValue === null
        ? null
        : accountValue - (marketExposure.knownValue + cashExposure.knownValue);
    let exposureKnown = composable && structurallyExplained && accountValue !== null;
    if (exposureKnown && residual !== null && residual < -BALANCE_SHEET_TOLERANCE) {
      // Réconciliation native satisfaite mais reliquat négatif après conversion : le
      // triangle de change ne boucle pas. On refuse de projeter cette exposition.
      exposureKnown = false;
      flags.push(`ENVELOPE_FX_RESIDUAL_NEGATIVE:${accountId}`);
    }
    if (!exposureKnown) flags.push(`ENVELOPE_EXPOSURE_UNKNOWN:${accountId}`);
    return {
      accountId,
      currency: line.currency,
      accountValue: aggregate([line]),
      marketExposure,
      cashExposure,
      unexposedValue: exposureKnown
        ? scalarAggregate(Math.max(0, residual ?? 0))
        : scalarAggregate(accountValue, line.fx.flags),
      state,
      gapNativeValue: reconciliation?.gapNativeValue ?? null,
      exposureKnown,
      flags,
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
  const positionLine = (position: Position): ConvertedBalanceSheetLine => {
    const valuationDate =
      position.valuationDate ?? position.provenance.effectiveDate ?? input.asOfDate;
    const fx = resolveFxRate(position.currency, input.reportingCurrency, valuationDate, rates);
    const nativeCostBasis = position.costBasis ?? null;
    return {
      id: `position:${position.id}`,
      entityId: position.id,
      domain: "PORTFOLIO",
      side: "ASSET",
      category: position.isCash ? "INVESTMENT_ENVELOPE_CASH" : "MARKET_POSITION",
      // La classe d'actif est portée par la ligne canonique : aucune ventilation n'a plus
      // besoin de retourner lire les positions natives.
      subcategory: position.assetClass,
      nativeValue: position.value,
      currency: position.currency,
      reportingValue: convertWithFx(position.value, fx),
      reportingCurrency: input.reportingCurrency,
      nativeCostBasis,
      reportingCostBasis: nativeCostBasis === null ? null : convertWithFx(nativeCostBasis, fx),
      valuationDate,
      valuationMethod: "MARKET_VALUE",
      valuationStatus: "CURRENT",
      liquidity: "LIQUID",
      provenance: position.provenance,
      confidence: position.provenance.confidence,
      source: position.provenance.source,
      reconciliationState: "NOT_APPLICABLE",
      isAccountingPrimary: false,
      envelopeAccountId: position.accountId,
      flags:
        !position.isCash &&
        nativeCostBasis !== null &&
        position.currency.toUpperCase() !== input.reportingCurrency.toUpperCase()
          ? ["FX_PNL_NOT_ISOLATED"]
          : [],
      fx,
    };
  };
  const marketPositionLines = positions.filter((position) => !position.isCash).map(positionLine);
  const investmentCashLines = positions.filter((position) => position.isCash).map(positionLine);
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
  const envelopeExposures = buildEnvelopeExposures(
    assets.filter((line) => line.category === "INVESTMENT_ENVELOPE"),
    marketPositionLines,
    investmentCashLines,
    positionReconciliations,
  );
  const accountIds = new Set(accounts.map((account) => account.id));
  const envelopeIds = new Set(accounts.filter(isInvestmentEnvelope).map((account) => account.id));
  const flags = [
    ...new Set([
      ...contributions.flatMap((line) => [...line.flags, ...line.fx.flags]),
      ...positionReconciliations
        .filter((item) => item.state !== "RECONCILED")
        .map((item) => `POSITION_${item.state}:${item.accountId}`),
      ...envelopeExposures.flatMap((exposure) => exposure.flags),
      ...positions
        .filter((position) => !accountIds.has(position.accountId))
        .map((position) => `POSITION_ORPHAN:${position.id}`),
      // Une position logée hors enveloppe d'investissement (compte bancaire, compte à
      // découvert) n'est réconciliée par rien : elle serait un double comptage silencieux
      // si on la traitait comme une exposition connue.
      ...positions
        .filter(
          (position) => accountIds.has(position.accountId) && !envelopeIds.has(position.accountId),
        )
        .map((position) => `POSITION_OUTSIDE_ENVELOPE:${position.id}`),
    ]),
  ];
  const blockers = [...new Set([...grossAssets.blockers, ...totalLiabilities.blockers])];
  return {
    asOfDate: input.asOfDate,
    reportingCurrency: input.reportingCurrency,
    contributions,
    positionReconciliations,
    envelopeExposures,
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
