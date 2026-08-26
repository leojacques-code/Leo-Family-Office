import {
  buildBusinessEquityPortfolio,
  type BuildBusinessEquityInput,
  type BusinessBridgeItem,
  type BusinessBridgeDeclaration,
  type BusinessCapitalEvent,
  type BusinessDcfAssumptions,
  type BusinessEbitdaAdjustment,
  type BusinessEntity,
  type BusinessEquityPortfolio,
  type BusinessFinancialSnapshot,
  type BusinessHoldingLink,
  type BusinessOwnership,
  type BusinessValuationBasis,
} from "@/lib/engine/business-equity";
import type { CurrencyRate } from "@/lib/engine/fx";
import type { Provenance as ProvenanceType } from "@/lib/types";

/**
 * Fabriques de faits pour les tests Business Equity.
 *
 * Les défauts sont volontairement NEUTRES : tout champ non fourni par un cas de test vaut
 * `null`, c'est-à-dire INCONNU. Un défaut à zéro rendrait les tests complices de l'erreur
 * qu'ils sont censés interdire — un cas qui oublie de déclarer la dette doit échouer, pas
 * passer avec une dette nulle silencieuse.
 */

export const ACTUAL: ProvenanceType = { kind: "ACTUAL", confidence: "HIGH" };
export const DECLARED: ProvenanceType = { kind: "USER_ASSUMPTION", confidence: "MEDIUM" };
export const EXTERNAL: ProvenanceType = { kind: "EXTERNAL_DATA", confidence: "HIGH" };

export const AS_OF = "2026-08-19";

export function business(
  overrides: Partial<BusinessEntity> & { id: string; name: string },
): BusinessEntity {
  return {
    legalForm: "SAS",
    type: "OPERATING",
    functionalCurrency: "EUR",
    sector: null,
    country: "FR",
    foundedOn: null,
    capitalHistoryStart: null,
    capitalHistorySource: "UNKNOWN",
    archived: false,
    notes: null,
    provenance: ACTUAL,
    ...overrides,
  };
}

export function ownership(
  overrides: Partial<BusinessOwnership> & {
    id: string;
    businessId: string;
    effectiveDate: string;
    legalRate: number;
  },
): BusinessOwnership {
  return {
    economicRate: overrides.legalRate,
    votingRate: null,
    fullyDilutedRate: null,
    sharesHeld: null,
    sharesOutstanding: null,
    fullyDilutedShares: null,
    shareClass: null,
    originEventId: null,
    notes: null,
    provenance: ACTUAL,
    ...overrides,
  };
}

export function financials(
  overrides: Partial<BusinessFinancialSnapshot> & {
    id: string;
    businessId: string;
    periodEnd: string;
  },
): BusinessFinancialSnapshot {
  return {
    periodStart: null,
    periodKind: "ANNUAL",
    periodLabel: null,
    currency: "EUR",
    revenue: null,
    grossProfit: null,
    ebitda: null,
    ebit: null,
    netIncome: null,
    cash: null,
    grossDebt: null,
    workingCapital: null,
    capex: null,
    depreciationAmortisation: null,
    interestExpense: null,
    taxExpense: null,
    freeCashFlow: null,
    notes: null,
    provenance: ACTUAL,
    ...overrides,
  };
}

export function valuation(
  overrides: Partial<BusinessValuationBasis> & {
    id: string;
    businessId: string;
    valuationDate: string;
    method: BusinessValuationBasis["method"];
  },
): BusinessValuationBasis {
  return {
    currency: "EUR",
    enterpriseValue: null,
    equityValue: null,
    multiple: null,
    multipleLow: null,
    multipleHigh: null,
    metricBasis: null,
    metricPeriodEnd: null,
    preMoneyEquityValue: null,
    primaryNewMoney: null,
    secondaryAmount: null,
    investorContribution: null,
    preferredRightsKnown: null,
    notes: null,
    provenance: DECLARED,
    ...overrides,
  };
}

export function adjustment(
  overrides: Partial<BusinessEbitdaAdjustment> & {
    id: string;
    businessId: string;
    periodEnd: string;
    label: string;
    amount: number;
  },
): BusinessEbitdaAdjustment {
  return {
    category: "OTHER",
    currency: "EUR",
    recurring: false,
    notes: null,
    provenance: DECLARED,
    ...overrides,
  };
}

export function bridgeItem(
  overrides: Partial<BusinessBridgeItem> & {
    id: string;
    businessId: string;
    effectiveDate: string;
    label: string;
    amount: number;
  },
): BusinessBridgeItem {
  return {
    category: "OTHER",
    currency: "EUR",
    notes: null,
    provenance: DECLARED,
    ...overrides,
  };
}

export function bridgeDeclaration(
  overrides: Partial<BusinessBridgeDeclaration> & {
    id: string;
    businessId: string;
    effectiveDate: string;
  },
): BusinessBridgeDeclaration {
  return {
    status: "DECLARED_NONE",
    notes: null,
    provenance: DECLARED,
    ...overrides,
  };
}

export function capitalEvent(
  overrides: Partial<BusinessCapitalEvent> & {
    id: string;
    businessId: string;
    type: BusinessCapitalEvent["type"];
    eventDate: string;
    amount: number;
  },
): BusinessCapitalEvent {
  return {
    amountScope: "USER_CASH",
    fees: null,
    currency: "EUR",
    ownershipDelta: null,
    ownershipRateAfter: null,
    sharesDelta: null,
    pricePerShare: null,
    label: null,
    transactionId: null,
    notes: null,
    provenance: ACTUAL,
    ...overrides,
  };
}

export function holding(
  overrides: Partial<BusinessHoldingLink> & {
    id: string;
    parentBusinessId: string;
    childBusinessId: string;
    effectiveDate: string;
    ownershipRate: number;
  },
): BusinessHoldingLink {
  return { notes: null, provenance: ACTUAL, ...overrides };
}

export function dcf(
  overrides: Partial<BusinessDcfAssumptions> & {
    id: string;
    businessId: string;
    valuationDate: string;
    wacc: number;
    taxRate: number;
    periods: BusinessDcfAssumptions["periods"];
  },
): BusinessDcfAssumptions {
  return {
    currency: "EUR",
    terminalMethod: "PERPETUAL_GROWTH",
    terminalGrowth: null,
    terminalExitMultiple: null,
    terminalExitMetric: null,
    discountConvention: "YEAR_END",
    notes: null,
    provenance: DECLARED,
    ...overrides,
  };
}

export function dcfPeriod(
  overrides: Partial<BusinessDcfAssumptions["periods"][number]> & { yearIndex: number },
): BusinessDcfAssumptions["periods"][number] {
  return {
    id: `dcf-period-${overrides.yearIndex}`,
    dcfId: "dcf",
    revenue: null,
    ebitda: null,
    ebit: null,
    depreciationAmortisation: null,
    capex: null,
    workingCapitalChange: null,
    notes: null,
    ...overrides,
  };
}

export function rate(
  baseCurrency: string,
  quoteCurrency: string,
  value: number,
  rateDate: string,
): CurrencyRate {
  return {
    baseCurrency,
    quoteCurrency,
    rate: value,
    rateDate,
    provenance: EXTERNAL,
  };
}

export function portfolio(input: Partial<BuildBusinessEquityInput>): BusinessEquityPortfolio {
  const businesses = input.businesses ?? [];
  return buildBusinessEquityPortfolio({
    asOfDate: AS_OF,
    reportingCurrency: "EUR",
    businesses,
    ownership: [],
    financials: [],
    valuations: [],
    capitalEvents: [],
    holdings: [],
    ebitdaAdjustments: [],
    bridgeItems: [],
    bridgeDeclarations: businesses.map((item) =>
      bridgeDeclaration({
        id: `bridge-declaration-${item.id}`,
        businessId: item.id,
        effectiveDate: "1900-01-01",
      }),
    ),
    dcfAssumptions: [],
    currencyRates: [],
    ...input,
  });
}

/** Position d'une société par son identifiant, pour lire un cas sans dépendre du tri. */
export function positionOf(result: BusinessEquityPortfolio, businessId: string) {
  const position = result.positions.find((item) => item.business.id === businessId);
  if (!position) throw new Error(`Position ${businessId} absente du résultat`);
  return position;
}

/** Codes de motifs d'une grandeur, pour assertion lisible. */
export function blockerCodes(item: { blockers: Array<{ code: string }> }): string[] {
  return [...new Set(item.blockers.map((blocker) => blocker.code))];
}

export function flagCodes(item: { flags: Array<{ code: string }> }): string[] {
  return [...new Set(item.flags.map((flag) => flag.code))];
}
