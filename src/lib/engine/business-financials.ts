import {
  blocker,
  dedupeFlags,
  flag,
  known,
  positiveRatio,
  subtract,
  sumAll,
  unknown,
  type BusinessAmount,
  type BusinessEntity,
  type BusinessFinancialSnapshot,
  type BusinessFlag,
  type BusinessMetricBasis,
} from "@/lib/engine/business-equity-facts";

/**
 * HISTORIQUE FINANCIER — lecture dérivée de périodes datées.
 *
 * Une société n'est pas un couple (CA, EBITDA). C'est une SÉRIE de périodes qualifiées, et
 * les grandeurs qui font la valeur — croissance, marge, conversion en cash, levier — n'ont
 * de sens que par comparaison entre périodes COMPARABLES.
 *
 * UN EXERCICE N'EST PAS UN LTM. Comparer un cumul glissant de douze mois à un exercice
 * clos produit une croissance qui n'existe pas. Le moteur ne compare donc que des périodes
 * de même nature, et signale la série qui en mélange plusieurs.
 *
 * AUCUN TERME MANQUANT N'EST NUL. Un FCF dérivé d'un capex inconnu vaut `null` et non
 * l'EBITDA lui-même ; une marge sur un chiffre d'affaires absent n'existe pas.
 */

export interface BusinessFinancialPeriodView {
  snapshot: BusinessFinancialSnapshot;
  /** Devise du fait, résolue depuis la période ou la devise fonctionnelle de la société. */
  currency: string | null;
  /** Toutes les grandeurs ci-dessous sont exprimées en devise NATIVE de la période. */
  netDebt: BusinessAmount;
  grossMarginRate: BusinessAmount;
  ebitdaMargin: BusinessAmount;
  ebitMargin: BusinessAmount;
  netMargin: BusinessAmount;
  /** FCF déclaré, sinon dérivé de l'exploitation quand TOUS ses termes sont connus. */
  freeCashFlow: BusinessAmount;
  freeCashFlowIsDerived: boolean;
  /** FCF ÷ EBITDA. Mesure la capacité de l'EBITDA à devenir de la trésorerie. */
  ebitdaToFcfConversion: BusinessAmount;
  /** Dette nette ÷ EBITDA. Non calculable sur un EBITDA nul ou négatif. */
  leverage: BusinessAmount;
  /** Croissance vs période précédente de MÊME nature. */
  revenueGrowth: BusinessAmount;
  ebitdaGrowth: BusinessAmount;
}

export interface BusinessFinancialHistory {
  periods: BusinessFinancialPeriodView[];
  /** Période la plus récente, quelle que soit sa nature. */
  latest: BusinessFinancialPeriodView | null;
  /** Période la plus récente utilisable comme base de valorisation annuelle ou LTM. */
  latestValuationBase: BusinessFinancialPeriodView | null;
  revenueCagr: BusinessAmount;
  ebitdaCagr: BusinessAmount;
  cagrYears: number | null;
  flags: BusinessFlag[];
}

const EMPTY_HISTORY: BusinessFinancialHistory = {
  periods: [],
  latest: null,
  latestValuationBase: null,
  revenueCagr: unknown([blocker("VALUATION_FINANCIAL_PERIOD_MISSING")]),
  ebitdaCagr: unknown([blocker("VALUATION_FINANCIAL_PERIOD_MISSING")]),
  cagrYears: null,
  flags: [],
};

const optional = (value: number | null, missing: ReturnType<typeof blocker>): BusinessAmount =>
  value === null ? unknown([missing]) : known(value);

function yearsBetween(earlier: string, later: string): number {
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 31_557_600_000;
}

/**
 * Croissance entre deux périodes. Une base nulle ou négative ne produit pas un pourcentage :
 * la croissance d'un chiffre d'affaires parti de zéro n'a pas de valeur informative.
 */
function growth(
  current: BusinessAmount,
  previous: BusinessAmount | null,
  businessId: string,
): BusinessAmount {
  if (previous === null) return unknown([blocker("PRIOR_PERIOD_MISSING", businessId)]);
  return positiveRatio(
    subtract(current, previous),
    previous,
    blocker("VALUATION_METRIC_NOT_POSITIVE", businessId),
  );
}

/**
 * Taux de croissance annuel composé entre la première et la dernière période comparables.
 * Exige une base strictement positive et un intervalle non nul : sinon, `null`.
 */
function cagr(
  first: number | null,
  last: number | null,
  years: number | null,
  businessId: string,
): BusinessAmount {
  if (first === null || last === null)
    return unknown([blocker("PRIOR_PERIOD_MISSING", businessId)]);
  if (years === null || years <= 0)
    return unknown([blocker("PERIOD_KIND_NOT_COMPARABLE", businessId)]);
  if (first <= 0 || last <= 0)
    return unknown([blocker("VALUATION_METRIC_NOT_POSITIVE", businessId)]);
  return known((last / first) ** (1 / years) - 1);
}

export function buildBusinessFinancialHistory(
  business: BusinessEntity,
  snapshots: BusinessFinancialSnapshot[],
  asOfDate: string,
): BusinessFinancialHistory {
  const ordered = snapshots
    .filter((row) => row.businessId === business.id && row.periodEnd <= asOfDate)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));
  if (ordered.length === 0) return EMPTY_HISTORY;

  const flags: BusinessFlag[] = [];
  if (new Set(ordered.map((row) => row.periodKind)).size > 1) {
    flags.push(flag("PERIOD_KIND_MIXED", business.id));
  }

  const periods = ordered.map((snapshot, index): BusinessFinancialPeriodView => {
    const currency = snapshot.currency ?? business.functionalCurrency ?? null;
    const revenue = optional(snapshot.revenue, blocker("REVENUE_MISSING", business.id));
    const ebitda = optional(snapshot.ebitda, blocker("EBITDA_MISSING", business.id));
    const ebit = optional(snapshot.ebit, blocker("VALUATION_METRIC_MISSING", business.id, "EBIT"));
    const netIncome = optional(
      snapshot.netIncome,
      blocker("VALUATION_METRIC_MISSING", business.id, "résultat net"),
    );
    const grossProfit = optional(
      snapshot.grossProfit,
      blocker("VALUATION_METRIC_MISSING", business.id, "marge brute"),
    );
    const cash = optional(snapshot.cash, blocker("EV_TO_EQUITY_CASH_MISSING", business.id));
    const grossDebt = optional(
      snapshot.grossDebt,
      blocker("EV_TO_EQUITY_GROSS_DEBT_MISSING", business.id),
    );

    // Une période antérieure n'est comparable que si elle couvre la même NATURE de période.
    const previous =
      [...ordered.slice(0, index)]
        .reverse()
        .find((row) => row.periodKind === snapshot.periodKind) ?? null;

    // FCF déclaré d'abord. À défaut : EBITDA − impôt − capex − variation de BFR, et
    // uniquement si les quatre termes existent. Un capex inconnu ne vaut pas zéro.
    const declaredFcf = snapshot.freeCashFlow;
    const workingCapitalChange =
      previous && previous.workingCapital !== null && snapshot.workingCapital !== null
        ? known(snapshot.workingCapital - previous.workingCapital)
        : unknown([blocker("VALUATION_METRIC_MISSING", business.id, "variation de BFR")]);
    const derivedFcf = sumAll([
      ebitda,
      {
        value: snapshot.taxExpense === null ? null : -snapshot.taxExpense,
        blockers:
          snapshot.taxExpense === null
            ? [blocker("VALUATION_METRIC_MISSING", business.id, "impôt")]
            : [],
        flags: [],
      },
      {
        value: snapshot.capex === null ? null : -snapshot.capex,
        blockers:
          snapshot.capex === null
            ? [blocker("VALUATION_METRIC_MISSING", business.id, "capex")]
            : [],
        flags: [],
      },
      {
        value: workingCapitalChange.value === null ? null : -workingCapitalChange.value,
        blockers: workingCapitalChange.blockers,
        flags: [],
      },
    ]);
    const freeCashFlow =
      declaredFcf !== null
        ? known(declaredFcf)
        : {
            ...derivedFcf,
            flags: dedupeFlags([...derivedFcf.flags, flag("FREE_CASH_FLOW_DERIVED", business.id)]),
          };

    return {
      snapshot,
      currency,
      netDebt: subtract(grossDebt, cash),
      grossMarginRate: positiveRatio(grossProfit, revenue, blocker("REVENUE_MISSING", business.id)),
      ebitdaMargin: positiveRatio(ebitda, revenue, blocker("REVENUE_MISSING", business.id)),
      ebitMargin: positiveRatio(ebit, revenue, blocker("REVENUE_MISSING", business.id)),
      netMargin: positiveRatio(netIncome, revenue, blocker("REVENUE_MISSING", business.id)),
      freeCashFlow,
      freeCashFlowIsDerived: declaredFcf === null,
      ebitdaToFcfConversion: positiveRatio(
        freeCashFlow,
        ebitda,
        blocker("EBITDA_NOT_POSITIVE", business.id),
      ),
      leverage: positiveRatio(
        subtract(grossDebt, cash),
        ebitda,
        blocker("EBITDA_NOT_POSITIVE", business.id),
      ),
      revenueGrowth: growth(
        revenue,
        previous ? optional(previous.revenue, blocker("REVENUE_MISSING", business.id)) : null,
        business.id,
      ),
      ebitdaGrowth: growth(
        ebitda,
        previous ? optional(previous.ebitda, blocker("EBITDA_MISSING", business.id)) : null,
        business.id,
      ),
    };
  });

  const annual = ordered.filter((row) => row.periodKind === "ANNUAL");
  const cagrYears =
    annual.length >= 2
      ? yearsBetween(annual[0].periodEnd, annual[annual.length - 1].periodEnd)
      : null;

  return {
    periods,
    latest: periods[periods.length - 1] ?? null,
    latestValuationBase:
      [...periods].reverse().find((view) => view.snapshot.periodKind !== "INTERIM") ?? null,
    revenueCagr:
      annual.length >= 2
        ? cagr(annual[0].revenue, annual[annual.length - 1].revenue, cagrYears, business.id)
        : unknown([blocker("PRIOR_PERIOD_MISSING", business.id)]),
    ebitdaCagr:
      annual.length >= 2
        ? cagr(annual[0].ebitda, annual[annual.length - 1].ebitda, cagrYears, business.id)
        : unknown([blocker("PRIOR_PERIOD_MISSING", business.id)]),
    cagrYears,
    flags,
  };
}

/** Grandeur retenue comme base d'un multiple, en devise native de la période. */
export function metricOfPeriod(
  snapshot: BusinessFinancialSnapshot,
  basis: BusinessMetricBasis,
): number | null {
  return basis === "EBITDA"
    ? snapshot.ebitda
    : basis === "REVENUE"
      ? snapshot.revenue
      : snapshot.ebit;
}
