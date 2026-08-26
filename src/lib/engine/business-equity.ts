import type {
  AggregateStatus,
  CanonicalBalanceSheetContribution,
  ValuationMethod,
} from "@/lib/engine/balance-sheet";
import type { CurrencyRate } from "@/lib/engine/fx";
import {
  blocker,
  dedupeBlockers,
  dedupeFlags,
  flag,
  known,
  latestAtOrBefore,
  mergeQuality,
  multiply,
  positiveRatio,
  subtract,
  sumAll,
  unknown,
  type BusinessAmount,
  type BusinessBlocker,
  type BusinessBridgeItem,
  type BusinessCapitalEvent,
  type BusinessDcfAssumptions,
  type BusinessEbitdaAdjustment,
  type BusinessEntity,
  type BusinessFinancialSnapshot,
  type BusinessFlag,
  type BusinessHoldingLink,
  type BusinessOwnership,
  type BusinessQuality,
  type BusinessValuationBasis,
} from "@/lib/engine/business-equity-facts";
import {
  buildBusinessFinancialHistory,
  type BusinessFinancialHistory,
} from "@/lib/engine/business-financials";
import {
  activeHoldingLinks,
  buildOwnershipView,
  lookThroughEconomicRate,
  type BusinessOwnershipView,
} from "@/lib/engine/business-ownership";
import {
  buildBusinessCapitalView,
  xirr,
  type BusinessCapitalView,
} from "@/lib/engine/business-capital";
import {
  valueBusiness,
  type BusinessValuationResult,
  type BusinessValueRange,
} from "@/lib/engine/business-valuation";

export * from "@/lib/engine/business-equity-facts";
export type {
  BusinessFinancialHistory,
  BusinessFinancialPeriodView,
} from "@/lib/engine/business-financials";
export type { BusinessOwnershipView } from "@/lib/engine/business-ownership";
export type { BusinessCapitalView, BusinessCapitalEventView } from "@/lib/engine/business-capital";
export type {
  BusinessBridgeStep,
  BusinessValuationResult,
  BusinessValueRange,
  SensitivityMatrix,
} from "@/lib/engine/business-valuation";

/**
 * BUSINESS EQUITY — LECTURE DU PORTEFEUILLE DE PARTICIPATIONS
 *
 * Ce module ORCHESTRE : il ne calcule ni valorisation, ni ratio financier, ni performance.
 * Chacune de ces vérités appartient à son moteur (`business-valuation`,
 * `business-financials`, `business-capital`, `business-ownership`) et est CONSOMMÉE ici.
 *
 * CE QU'IL DÉCIDE, LUI SEUL
 * -------------------------
 * 1. Quelle société pèse au patrimoine PERSONNEL : celles détenues DIRECTEMENT. Une
 *    filiale détenue au travers d'une holding entre au patrimoine par la holding et par
 *    elle seule — la compter aussi séparément doublerait le patrimoine.
 * 2. L'ordre de résolution des holdings, avec mémoïsation et détection de cycle : une
 *    boucle de détention ne produit pas une valeur infinie, elle produit un motif.
 * 3. La consolidation, et son honnêteté : une société suivie dont la détention est
 *    incomplète rend le total NON CALCULABLE. Elle ne disparaît pas du compte des sociétés
 *    et ne vaut pas zéro — c'était le défaut le plus grave de la version précédente.
 */

export interface BusinessSubsidiaryView {
  link: BusinessHoldingLink;
  business: BusinessEntity | null;
  /** Equity value de la filiale mise à la quote-part détenue par la mère. */
  attributed: BusinessAmount;
}

export interface BusinessParentView {
  link: BusinessHoldingLink;
  business: BusinessEntity | null;
}

export interface BusinessEquityPosition {
  business: BusinessEntity;
  ownership: BusinessOwnershipView;
  financials: BusinessFinancialHistory;
  valuation: BusinessValuationResult;
  capital: BusinessCapitalView;
  subsidiaries: BusinessSubsidiaryView[];
  parents: BusinessParentView[];
  /** Vrai quand une détention DIRECTE est déclarée : la société pèse alors au bilan. */
  isDirectHolding: boolean;
  /**
   * Détention économique effective, directe et indirecte. Grandeur de CONTRÔLE : elle sert
   * à détecter une exposition incohérente, jamais à attribuer de la valeur.
   */
  lookThroughEconomicRate: BusinessAmount;
  enterpriseValue: BusinessValueRange;
  equityValue: BusinessValueRange;
  attributableValue: BusinessValueRange;
  netDebt: BusinessAmount;
  quality: BusinessQuality;
}

export interface BusinessEquityPortfolio {
  asOfDate: string;
  reportingCurrency: string;
  positions: BusinessEquityPosition[];
  /** Sous-ensemble qui pèse au patrimoine personnel. */
  directPositions: BusinessEquityPosition[];
  /** Nombre de sociétés SUIVIES, détention déclarée ou non. */
  trackedCount: number;
  /** Nombre de sociétés dont la valeur personnelle est réellement calculable. */
  valuedCount: number;
  totalAttributableValue: BusinessValueRange;
  /**
   * Enterprise Value cumulée des seules participations dont la MÉTHODE en définit une.
   * Une valeur d'equity observée ou un tour de table n'en produisent pas ; les exclure
   * évite qu'une participation sans EV rende muette celle des autres. Une EV attendue mais
   * non calculable, elle, bloque bien le total.
   */
  totalEnterpriseValue: BusinessAmount;
  /** Nombre de participations réellement couvertes par le total d'Enterprise Value. */
  enterpriseValueCoverage: number;
  totalNetDebt: BusinessAmount;
  totalInvestedCapital: BusinessAmount;
  totalCashReturned: BusinessAmount;
  portfolioMoic: BusinessAmount;
  portfolioXirr: BusinessAmount;
  status: AggregateStatus;
  quality: BusinessQuality;
}

export interface BuildBusinessEquityInput {
  asOfDate: string;
  reportingCurrency: string;
  businesses: BusinessEntity[];
  ownership: BusinessOwnership[];
  financials: BusinessFinancialSnapshot[];
  valuations: BusinessValuationBasis[];
  capitalEvents: BusinessCapitalEvent[];
  holdings: BusinessHoldingLink[];
  ebitdaAdjustments?: BusinessEbitdaAdjustment[];
  bridgeItems?: BusinessBridgeItem[];
  dcfAssumptions?: BusinessDcfAssumptions[];
  currencyRates?: CurrencyRate[];
}

/** Somme dont un seul terme inconnu suffit à rendre le total non calculable. */
function total(parts: BusinessAmount[], onEmpty: BusinessAmount): BusinessAmount {
  return parts.length === 0 ? onEmpty : sumAll(parts);
}

export function buildBusinessEquityPortfolio(
  input: BuildBusinessEquityInput,
): BusinessEquityPortfolio {
  const rates = input.currencyRates ?? [];
  const adjustments = input.ebitdaAdjustments ?? [];
  const bridgeItems = input.bridgeItems ?? [];
  const dcf = input.dcfAssumptions ?? [];
  const businesses = input.businesses.filter((business) => !business.archived);
  const byId = new Map(businesses.map((business) => [business.id, business]));

  const ownershipViews = new Map<string, BusinessOwnershipView>(
    businesses.map((business) => [
      business.id,
      buildOwnershipView(business, input.ownership, input.asOfDate),
    ]),
  );

  // Equity value d'une société, mémoïsée. La récursion sert les holdings : une mère lit la
  // valeur de ses filles. Un cycle de détention est détecté et refusé plutôt que déroulé.
  const equityMemo = new Map<string, BusinessAmount>();
  const visiting = new Set<string>();
  const valuationMemo = new Map<string, BusinessValuationResult>();

  function valuationOf(businessId: string): BusinessValuationResult {
    const cached = valuationMemo.get(businessId);
    if (cached) return cached;
    const business = byId.get(businessId);
    if (!business) {
      throw new Error(`Business Equity : société ${businessId} absente du périmètre chargé`);
    }
    const links = activeHoldingLinks(input.holdings, businessId, input.asOfDate);
    const result = valueBusiness({
      business,
      asOfDate: input.asOfDate,
      reportingCurrency: input.reportingCurrency,
      bases: input.valuations,
      financials: input.financials,
      ebitdaAdjustments: adjustments,
      bridgeItems,
      dcf,
      currencyRates: rates,
      economicRate:
        ownershipViews.get(businessId)?.economicRate ??
        unknown([blocker("OWNERSHIP_MISSING", businessId)]),
      childEquityValue: (childId) => equityValueOf(childId),
      childLinks: links.map((link) => ({
        childBusinessId: link.childBusinessId,
        ownershipRate: link.ownershipRate,
      })),
    });
    valuationMemo.set(businessId, result);
    return result;
  }

  function equityValueOf(businessId: string): BusinessAmount {
    const cached = equityMemo.get(businessId);
    if (cached) return cached;
    if (visiting.has(businessId)) return unknown([blocker("HOLDING_CYCLE", businessId)]);
    if (!byId.has(businessId)) {
      return unknown([blocker("HOLDING_CHILD_NOT_COMPUTABLE", businessId)]);
    }
    visiting.add(businessId);
    const result = valuationOf(businessId).equityValue.central;
    visiting.delete(businessId);
    equityMemo.set(businessId, result);
    return result;
  }

  const directRateOf = (businessId: string): number | null =>
    ownershipViews.get(businessId)?.economicRate.value ?? null;

  const positions = businesses.map((business): BusinessEquityPosition => {
    const ownership = ownershipViews.get(business.id)!;
    const valuation = valuationOf(business.id);
    const financials = buildBusinessFinancialHistory(business, input.financials, input.asOfDate);
    const links = activeHoldingLinks(input.holdings, business.id, input.asOfDate);
    const parents = input.holdings
      .filter(
        (link) => link.childBusinessId === business.id && link.effectiveDate <= input.asOfDate,
      )
      .map((link) => ({ link, business: byId.get(link.parentBusinessId) ?? null }));

    const capital = buildBusinessCapitalView({
      business,
      events: input.capitalEvents,
      asOfDate: input.asOfDate,
      reportingCurrency: input.reportingCurrency,
      currencyRates: rates,
      economicRateAt: (date) => {
        const record = latestAtOrBefore(
          input.ownership.filter((row) => row.businessId === business.id),
          date,
          (row) => row.effectiveDate,
        );
        return record?.economicRate ?? null;
      },
      terminalValue: valuation.attributableValue.central,
    });

    const effectiveRate = lookThroughEconomicRate(
      business.id,
      directRateOf,
      input.holdings,
      input.asOfDate,
    );
    const positionFlags: BusinessFlag[] = [];
    if (ownership.record && parents.length > 0)
      positionFlags.push(flag("DIRECT_AND_INDIRECT_OWNERSHIP", business.id));
    if (effectiveRate !== null && effectiveRate > 1 + 1e-9)
      positionFlags.push(
        flag(
          "LOOK_THROUGH_OWNERSHIP_EXCEEDS_ONE",
          business.id,
          `${(effectiveRate * 100).toFixed(2)} %`,
        ),
      );

    return {
      business,
      ownership,
      financials,
      valuation,
      capital,
      subsidiaries: links.map((link) => ({
        link,
        business: byId.get(link.childBusinessId) ?? null,
        attributed: multiply(equityValueOf(link.childBusinessId), known(link.ownershipRate)),
      })),
      parents,
      isDirectHolding: ownership.record !== null,
      lookThroughEconomicRate:
        effectiveRate === null
          ? unknown([blocker("OWNERSHIP_MISSING", business.id)])
          : known(effectiveRate),
      enterpriseValue: valuation.enterpriseValue,
      equityValue: valuation.equityValue,
      attributableValue: valuation.attributableValue,
      netDebt: valuation.netDebt,
      quality: mergeQuality(
        valuation.quality,
        {
          blockers: [],
          flags: [...ownership.flags, ...financials.flags, ...capital.flags, ...positionFlags],
        },
        capital.investedCapital.value === null
          ? { blockers: capital.investedCapital.blockers, flags: [] }
          : { blockers: [], flags: [] },
      ),
    };
  });

  const ordered = [...positions].sort((left, right) => {
    const leftValue = left.attributableValue.central.value;
    const rightValue = right.attributableValue.central.value;
    if (leftValue === null && rightValue === null)
      return left.business.name.localeCompare(right.business.name);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return rightValue - leftValue;
  });
  const direct = ordered.filter((position) => position.isDirectHolding);

  // Aucune société suivie : le patrimoine business vaut réellement zéro. Des sociétés
  // suivies dont aucune n'a de détention déclarée : le total n'est PAS zéro, il est inconnu.
  const emptyTotal =
    businesses.length === 0
      ? known(0)
      : unknown(ordered.map((position) => blocker("OWNERSHIP_MISSING", position.business.id)));

  const totalAttributableValue: BusinessValueRange = {
    low: total(
      direct.map((position) => position.attributableValue.low),
      emptyTotal,
    ),
    central: total(
      direct.map((position) => position.attributableValue.central),
      emptyTotal,
    ),
    high: total(
      direct.map((position) => position.attributableValue.high),
      emptyTotal,
    ),
  };
  const withEnterpriseValue = direct.filter(
    (position) => position.valuation.hasEnterpriseValueConcept,
  );
  const totalEnterpriseValue = total(
    withEnterpriseValue.map((position) => position.enterpriseValue.central),
    businesses.length === 0
      ? known(0)
      : unknown([
          blocker(
            "VALUATION_BASIS_MISSING",
            undefined,
            "aucune participation n’est valorisée par une méthode qui définit une Enterprise Value",
          ),
        ]),
  );
  const totalNetDebt = total(
    direct.map((position) => position.netDebt),
    emptyTotal,
  );
  const totalInvestedCapital = total(
    direct.map((position) => position.capital.investedCapital),
    emptyTotal,
  );
  const totalCashReturned = total(
    direct.map((position) => position.capital.cashReturned),
    emptyTotal,
  );

  const portfolioMoic = positiveRatio(
    sumAll([totalAttributableValue.central, totalCashReturned]),
    totalInvestedCapital,
    blocker("INVESTED_CAPITAL_NOT_POSITIVE"),
  );
  const allFlows = direct.map((position) => position.capital.flows);
  const portfolioXirr = allFlows.some((flows) => flows === null)
    ? unknown([blocker("XIRR_INPUTS_INCOMPLETE")])
    : allFlows.length === 0
      ? unknown([blocker("XIRR_INPUTS_INCOMPLETE")])
      : xirr(allFlows.flatMap((flows) => flows ?? []));

  const blockers = dedupeBlockers([
    ...totalAttributableValue.central.blockers,
    ...ordered.flatMap((position) => position.quality.blockers),
  ]);
  const flags = dedupeFlags(ordered.flatMap((position) => position.quality.flags));
  const valuedCount = direct.filter(
    (position) => position.attributableValue.central.value !== null,
  ).length;
  const status: AggregateStatus =
    totalAttributableValue.central.value !== null
      ? "COMPLETE"
      : valuedCount > 0
        ? "PARTIAL"
        : "NOT_COMPUTABLE";

  return {
    asOfDate: input.asOfDate,
    reportingCurrency: input.reportingCurrency,
    positions: ordered,
    directPositions: direct,
    trackedCount: businesses.length,
    valuedCount,
    totalAttributableValue,
    totalEnterpriseValue,
    enterpriseValueCoverage: withEnterpriseValue.length,
    totalNetDebt,
    totalInvestedCapital,
    totalCashReturned,
    portfolioMoic,
    portfolioXirr,
    status,
    quality: { blockers, flags },
  };
}

// ─── Intégration au bilan canonique ─────────────────────────────────────────────────────

const BALANCE_SHEET_METHOD: Record<string, ValuationMethod> = {
  TRANSACTION: "EXTERNAL_VALUATION",
  EXTERNAL_APPRAISAL: "EXTERNAL_VALUATION",
  USER_ESTIMATE: "USER_ESTIMATE",
  EBITDA_MULTIPLE: "MODEL_ESTIMATE",
  REVENUE_MULTIPLE: "MODEL_ESTIMATE",
  DCF: "MODEL_ESTIMATE",
  FUNDING_ROUND: "EXTERNAL_VALUATION",
  LOOK_THROUGH: "MODEL_ESTIMATE",
};

/**
 * Lignes d'actif du bilan canonique.
 *
 * UNE SEULE LIGNE PAR DÉTENTION DIRECTE. Une filiale détenue via une holding n'en produit
 * aucune : sa valeur est déjà dans celle de la holding.
 *
 * UNE SOCIÉTÉ SUIVIE DONT LA VALEUR EST INCONNUE PRODUIT QUAND MÊME SA LIGNE, avec un
 * montant `null` et ses motifs. C'est ce qui rend le patrimoine PARTIEL au lieu de le
 * laisser croire complet en escamotant l'actif — le bilan doit savoir qu'il lui manque
 * quelque chose.
 *
 * AUCUNE LIGNE DE PASSIF N'EST ÉMISE. La dette d'une société détenue est corporate : elle
 * réduit l'Equity Value dans le pont, et n'entre jamais au passif personnel.
 */
export function businessEquityBalanceSheetContributions(
  portfolio: BusinessEquityPortfolio,
): CanonicalBalanceSheetContribution[] {
  return portfolio.directPositions.map((position) => {
    const value = position.attributableValue.central;
    const basis = position.valuation.basis;
    const provenance = basis?.provenance ?? position.business.provenance;
    return {
      id: `business-equity:${position.business.id}`,
      entityId: position.business.id,
      domain: "BUSINESS_EQUITY" as const,
      side: "ASSET" as const,
      category: position.business.type === "HOLDING" ? "HOLDING_EQUITY" : "PRIVATE_BUSINESS_EQUITY",
      nativeValue: value.value,
      valuationBlockers:
        value.value === null
          ? [...new Set(value.blockers.map((item) => item.code as string))]
          : undefined,
      currency: portfolio.reportingCurrency,
      valuationDate: position.valuation.valuationDate ?? portfolio.asOfDate,
      valuationMethod: BALANCE_SHEET_METHOD[position.valuation.method ?? ""] ?? "MODEL_ESTIMATE",
      valuationStatus:
        value.value === null
          ? ("MISSING" as const)
          : position.valuation.isStale
            ? ("STALE" as const)
            : ("CURRENT" as const),
      liquidity: "ILLIQUID" as const,
      provenance,
      confidence: provenance.confidence,
      source: provenance.source,
      reconciliationState: "NOT_APPLICABLE" as const,
      isAccountingPrimary: true,
      flags: [...new Set(position.quality.flags.map((item) => item.code as string))],
    };
  });
}

/** Écart entre la borne haute et la borne basse d'une fourchette, quand elle existe. */
export function rangeSpread(range: BusinessValueRange): BusinessAmount {
  return subtract(range.high, range.low);
}

/** Motifs consolidés d'une position, dédoublonnés, pour affichage ou export. */
export function positionBlockers(position: BusinessEquityPosition): BusinessBlocker[] {
  return dedupeBlockers(position.quality.blockers);
}
