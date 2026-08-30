import {
  BALANCE_SHEET_TOLERANCE,
  buildCanonicalBalanceSheet,
  type AggregateStatus,
  type CanonicalAggregate,
  type CanonicalBalanceSheet,
  type ConvertedBalanceSheetLine,
  type EnvelopeExposure,
} from "@/lib/engine/balance-sheet";
import {
  deriveCanonicalBalanceSheetMetrics,
  type CanonicalBalanceSheetMetrics,
} from "@/lib/engine/balance-sheet-metrics";
import {
  buildBusinessEquityPortfolio,
  businessEquityBalanceSheetContributions,
  type BusinessEquityPortfolio,
} from "@/lib/engine/business-equity";
import {
  buildRealEstatePortfolio,
  realEstateBalanceSheetContributions,
  type RealEstatePortfolio,
} from "@/lib/engine/real-estate";
import type { DashboardState } from "@/lib/types";

/**
 * VUES DE LECTURE DU BILAN CANONIQUE
 *
 * Ce module ne calcule aucune vérité financière : il ne fait que sélectionner, grouper et
 * soustraire des montants DÉJÀ convertis par le Canonical Balance Sheet. Aucun taux de
 * change n'y est résolu, aucun solde natif n'y est resommé. Il existe pour que les écrans
 * cessent de reconstruire localement une allocation ou un total multi-devise : un écran qui
 * additionne des soldes natifs compare des devises différentes sans le dire.
 */

/** Le bilan canonique de l'état, reconstruit à l'identique s'il n'a pas été fourni. */
export function canonicalBalanceSheetOf(state: DashboardState): CanonicalBalanceSheet {
  return (
    state.balanceSheet ??
    buildCanonicalBalanceSheet({
      asOfDate: state.asOfDate,
      reportingCurrency: state.reportingCurrency,
      accounts: state.accounts,
      positions: state.positions,
      liabilities: state.liabilities,
      contributions: [
        ...realEstateBalanceSheetContributions(realEstateOf(state)),
        ...businessEquityBalanceSheetContributions(businessEquityOf(state)),
      ],
      currencyRates: state.currencyRates ?? [],
    })
  );
}

/** Les métriques canoniques de l'état, redérivées à l'identique si elles sont absentes. */
export function canonicalMetricsOf(state: DashboardState): CanonicalBalanceSheetMetrics {
  return (
    state.balanceSheetMetrics ??
    deriveCanonicalBalanceSheetMetrics({
      balanceSheet: canonicalBalanceSheetOf(state),
      liabilities: state.liabilities,
      expenses: state.expenseCategories,
      positions: state.positions,
      snapshots: state.netWorthSnapshots ?? [],
    })
  );
}

/**
 * Le domaine immobilier de l'état, reconstruit à l'identique s'il n'a pas été fourni.
 *
 * Reconstruction stricte : mêmes entrées, mêmes conventions, donc mêmes lignes de bilan.
 * Un écran qui appelle cette fonction obtient exactement ce que le repository a calculé.
 */
export function realEstateOf(state: DashboardState): RealEstatePortfolio {
  return (
    state.realEstate ??
    buildRealEstatePortfolio({
      asOfDate: state.asOfDate,
      reportingCurrency: state.reportingCurrency,
      assets: state.realEstateAssets ?? [],
      valuations: state.realEstateValuations ?? [],
      capitalEvents: state.realEstateCapitalEvents ?? [],
      operatingTerms: state.realEstateOperatingTerms ?? [],
      financingLinks: state.realEstateFinancingLinks ?? [],
      liabilities: state.liabilities,
      transactions: state.transactions,
      expenseCategories: state.expenseCategories,
      ledgerCoverageStart: state.ledgerCoverageStart,
      currencyRates: state.currencyRates ?? [],
    })
  );
}

/** Le domaine Business Equity, reconstruit avec les mêmes entrées que le repository. */
export function businessEquityOf(state: DashboardState): BusinessEquityPortfolio {
  return (
    state.businessEquity ??
    buildBusinessEquityPortfolio({
      asOfDate: state.asOfDate,
      reportingCurrency: state.reportingCurrency,
      businesses: state.businesses ?? [],
      ownership: state.businessOwnership ?? [],
      financials: state.businessFinancials ?? [],
      valuations: state.businessValuations ?? [],
      capitalEvents: state.businessCapitalEvents ?? [],
      holdings: state.businessHoldings ?? [],
      ebitdaAdjustments: state.businessEbitdaAdjustments ?? [],
      bridgeItems: state.businessBridgeItems ?? [],
      bridgeDeclarations: state.businessBridgeDeclarations ?? [],
      dcfAssumptions: state.businessDcfAssumptions ?? [],
      currencyRates: state.currencyRates ?? [],
    })
  );
}

/** Lignes d'actif immobilier du bilan canonique. Aucun montant n'y est recalculé. */
export function realEstateAssetLines(sheet: CanonicalBalanceSheet): ConvertedBalanceSheetLine[] {
  return sheet.contributions.filter(
    (line) => line.domain === "REAL_ESTATE" && line.side === "ASSET" && line.isAccountingPrimary,
  );
}

function combine(parts: CanonicalAggregate[]): CanonicalAggregate {
  const knownValue = parts.reduce((sum, part) => sum + part.knownValue, 0);
  const blockers = [...new Set(parts.flatMap((part) => part.blockers))];
  const missing = parts.filter((part) => part.value === null);
  if (missing.length === 0)
    return { value: knownValue, knownValue, status: "COMPLETE", coverage: 1, blockers: [] };
  const known = parts.length - missing.length;
  return {
    value: null,
    knownValue,
    status: known === 0 ? "NOT_COMPUTABLE" : "PARTIAL",
    coverage: parts.length === 0 ? 1 : known / parts.length,
    blockers,
  };
}

/** Lignes comptables d'actif d'un compte financier, converties. */
export function accountAssetLines(sheet: CanonicalBalanceSheet): ConvertedBalanceSheetLine[] {
  return sheet.contributions.filter(
    (line) =>
      line.domain === "FINANCIAL_ACCOUNT" && line.side === "ASSET" && line.isAccountingPrimary,
  );
}

/**
 * La ligne comptable d'un compte, quel que soit son côté. Un compte à découvert porte une
 * ligne de PASSIF : ce n'est pas un actif négatif.
 */
export function accountLine(
  sheet: CanonicalBalanceSheet,
  accountId: string,
): ConvertedBalanceSheetLine | null {
  return (
    sheet.contributions.find(
      (line) =>
        line.domain === "FINANCIAL_ACCOUNT" &&
        line.isAccountingPrimary &&
        line.entityId === accountId,
    ) ?? null
  );
}

/** La ligne d'actif d'un compte donné, ou `null` si le compte est en découvert. */
export function accountAssetLine(
  sheet: CanonicalBalanceSheet,
  accountId: string,
): ConvertedBalanceSheetLine | null {
  return accountAssetLines(sheet).find((line) => line.entityId === accountId) ?? null;
}

/**
 * Total d'ACTIF d'un groupe de comptes, en devise de reporting. Un compte à découvert n'y
 * est pas netté : il pèse au passif, comme dans `grossAssets`. Un compte dont la conversion
 * manque rend le total non calculable, il n'est jamais compté pour zéro ni comparé un pour
 * un.
 */
export function accountGroupTotal(
  sheet: CanonicalBalanceSheet,
  accountIds: string[],
): CanonicalAggregate {
  const ids = new Set(accountIds);
  return combine(
    accountAssetLines(sheet)
      .filter((line) => ids.has(line.entityId))
      .map((line) => ({
        value: line.reportingValue,
        knownValue: line.reportingValue ?? 0,
        status: (line.reportingValue === null ? "NOT_COMPUTABLE" : "COMPLETE") as AggregateStatus,
        coverage: line.reportingValue === null ? 0 : 1,
        blockers: line.reportingValue === null ? line.fx.flags : [],
      })),
  );
}

export function envelopeExposureOf(
  sheet: CanonicalBalanceSheet,
  accountId: string,
): EnvelopeExposure | null {
  return sheet.envelopeExposures.find((exposure) => exposure.accountId === accountId) ?? null;
}

/** Positions non-cash d'une enveloppe, converties. */
export function envelopeMarketLines(
  sheet: CanonicalBalanceSheet,
  accountId: string,
): ConvertedBalanceSheetLine[] {
  return sheet.contributions.filter(
    (line) => line.category === "MARKET_POSITION" && line.envelopeAccountId === accountId,
  );
}

export function marketPositionLines(sheet: CanonicalBalanceSheet): ConvertedBalanceSheetLine[] {
  return sheet.contributions.filter((line) => line.category === "MARKET_POSITION");
}

export type AllocationSliceKind = "MARKET" | "ENVELOPE_CASH" | "BANK_CASH" | "UNEXPOSED_ENVELOPE";

export interface CanonicalAllocationSlice {
  /** Classe d'actif pour une tranche de marché, clé réservée sinon. */
  key: string;
  kind: AllocationSliceKind;
  value: number;
  /** Enveloppes qui alimentent la tranche, pour tracer l'origine du montant. */
  accountIds: string[];
  /** `true` quand la tranche regroupe une valeur comptable sans exposition fiable. */
  unreliable: boolean;
}

export interface CanonicalAllocation {
  reportingCurrency: string;
  slices: CanonicalAllocationSlice[];
  /** Σ des tranches connues, en devise de reporting. */
  knownValue: number;
  /** Référence comptable : actifs financiers canoniques. La ventilation doit y boucler. */
  financialAssets: CanonicalAggregate;
  /** Écart entre les tranches et la référence comptable. Doit rester nul. */
  residual: number;
  /** Complétude de la VENTILATION, distincte de la complétude du total. */
  compositionStatus: AggregateStatus;
  blockers: string[];
  flags: string[];
}

const MARKET_UNEXPOSED_KEY = "UNEXPOSED_ENVELOPE";
const ENVELOPE_CASH_KEY = "ENVELOPE_CASH";
const BANK_CASH_KEY = "BANK_CASH";

/**
 * Ventilation canonique des actifs financiers.
 *
 * Règle de bouclage : la somme des tranches vaut exactement les actifs financiers du bilan.
 * Les positions expliquent une enveloppe, elles ne s'y ajoutent jamais. Une enveloppe dont
 * l'exposition n'est pas connue apporte sa valeur comptable dans une tranche non exposée et
 * marquée non fiable : elle n'est ni ventilée par classe d'actif, ni ramenée à zéro, ni
 * capable d'annuler la ventilation des autres enveloppes.
 */
export function buildCanonicalAllocation(sheet: CanonicalBalanceSheet): CanonicalAllocation {
  const slices = new Map<string, CanonicalAllocationSlice>();
  const blockers: string[] = [];
  const flags: string[] = [];
  let unexposedParts = 0;

  const add = (
    key: string,
    kind: AllocationSliceKind,
    value: number,
    accountId: string | null,
    unreliable = false,
  ) => {
    if (Math.abs(value) < 1e-9) return;
    const existing = slices.get(key);
    if (existing) {
      existing.value += value;
      if (accountId && !existing.accountIds.includes(accountId))
        existing.accountIds.push(accountId);
      existing.unreliable = existing.unreliable || unreliable;
      return;
    }
    slices.set(key, {
      key,
      kind,
      value,
      accountIds: accountId ? [accountId] : [],
      unreliable,
    });
  };

  for (const line of accountAssetLines(sheet)) {
    if (line.reportingValue === null) {
      // Conversion manquante : le compte n'entre ni pour zéro ni à un pour un.
      blockers.push(...line.fx.flags);
      flags.push(`ALLOCATION_ACCOUNT_NOT_CONVERTED:${line.entityId}`);
      continue;
    }
    if (line.category === "CASH_ACCOUNT") {
      add(BANK_CASH_KEY, "BANK_CASH", line.reportingValue, line.entityId);
      continue;
    }
    const exposure = envelopeExposureOf(sheet, line.entityId);
    if (!exposure || !exposure.exposureKnown) {
      unexposedParts += 1;
      blockers.push(...(exposure?.flags ?? [`ENVELOPE_EXPOSURE_UNKNOWN:${line.entityId}`]));
      add(MARKET_UNEXPOSED_KEY, "UNEXPOSED_ENVELOPE", line.reportingValue, line.entityId, true);
      continue;
    }
    for (const position of envelopeMarketLines(sheet, line.entityId)) {
      if (position.reportingValue === null) continue;
      add(
        position.subcategory ?? "MARKET_POSITION",
        "MARKET",
        position.reportingValue,
        line.entityId,
      );
    }
    const envelopeCash = exposure.cashExposure.value ?? 0;
    add(ENVELOPE_CASH_KEY, "ENVELOPE_CASH", envelopeCash, line.entityId);
    const unexposed = exposure.unexposedValue.value ?? 0;
    if (unexposed > BALANCE_SHEET_TOLERANCE)
      add(MARKET_UNEXPOSED_KEY, "UNEXPOSED_ENVELOPE", unexposed, line.entityId);
  }

  const ordered = [...slices.values()].sort((left, right) => right.value - left.value);
  const knownValue = ordered.reduce((sum, slice) => sum + slice.value, 0);
  // Le total peut être complet alors que la ventilation ne l'est pas : une enveloppe
  // over-explained garde sa valeur comptable exacte sans exposition connue.
  const compositionStatus: AggregateStatus =
    unexposedParts === 0 && flags.length === 0
      ? "COMPLETE"
      : ordered.length === 0
        ? "NOT_COMPUTABLE"
        : "PARTIAL";
  return {
    reportingCurrency: sheet.reportingCurrency,
    slices: ordered,
    knownValue,
    financialAssets: sheet.financialAssets,
    residual: knownValue - sheet.financialAssets.knownValue,
    compositionStatus,
    blockers: [...new Set(blockers)],
    flags: [...new Set(flags)],
  };
}

/** Exposition de marché réellement connue, enveloppe par enveloppe. */
export function knownMarketExposure(sheet: CanonicalBalanceSheet): CanonicalAggregate {
  return combine(
    sheet.envelopeExposures
      .filter((exposure) => exposure.exposureKnown)
      .map((exposure) => exposure.marketExposure),
  );
}

/** Cash d'enveloppe réellement connu, enveloppe par enveloppe. */
export function knownEnvelopeCash(sheet: CanonicalBalanceSheet): CanonicalAggregate {
  return combine(
    sheet.envelopeExposures
      .filter((exposure) => exposure.exposureKnown)
      .map((exposure) => exposure.cashExposure),
  );
}

export interface EnvelopePnL {
  value: CanonicalAggregate;
  costBasis: CanonicalAggregate;
  /** Plus-value latente en devise de reporting. `null` dès qu'un coût manque. */
  unrealised: number | null;
  /** `true` quand au moins une position n'est pas libellée en devise de reporting. */
  fxEffectNotIsolated: boolean;
  blockers: string[];
}

/**
 * Plus-value latente d'un ensemble de positions, en devise de reporting.
 *
 * Un seul coût d'acquisition manquant rend la grandeur non calculable : une plus-value
 * partielle n'est pas une plus-value. Valeur et coût sont convertis au MÊME taux, donc
 * l'effet de change sur le capital investi n'est pas isolé ; le drapeau le dit.
 */
export function unrealisedPnL(lines: ConvertedBalanceSheetLine[]): EnvelopePnL {
  const value = combine(
    lines.map((line) => ({
      value: line.reportingValue,
      knownValue: line.reportingValue ?? 0,
      status: (line.reportingValue === null ? "NOT_COMPUTABLE" : "COMPLETE") as AggregateStatus,
      coverage: line.reportingValue === null ? 0 : 1,
      blockers: line.reportingValue === null ? line.fx.flags : [],
    })),
  );
  const costBasis = combine(
    lines.map((line) => {
      const cost = line.reportingCostBasis ?? null;
      return {
        value: cost,
        knownValue: cost ?? 0,
        status: (cost === null ? "NOT_COMPUTABLE" : "COMPLETE") as AggregateStatus,
        coverage: cost === null ? 0 : 1,
        blockers:
          cost === null
            ? line.nativeCostBasis === null
              ? [`COST_BASIS_MISSING:${line.entityId}`]
              : line.fx.flags
            : [],
      };
    }),
  );
  const computable = lines.length > 0 && value.value !== null && costBasis.value !== null;
  return {
    value,
    costBasis,
    unrealised: computable ? (value.value ?? 0) - (costBasis.value ?? 0) : null,
    fxEffectNotIsolated: lines.some((line) => line.flags.includes("FX_PNL_NOT_ISOLATED")),
    blockers: [...new Set([...value.blockers, ...costBasis.blockers])],
  };
}
