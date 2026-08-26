import type { CurrencyRate } from "@/lib/engine/fx";
import type { DataKind } from "@/lib/types";
import { metricOfPeriod } from "@/lib/engine/business-financials";
import {
  BUSINESS_VALUATION_STALE_AFTER_DAYS,
  DERIVED_VALUATION_METHODS,
  OBSERVED_VALUATION_METHODS,
  blocker,
  convertFact,
  daysBetween,
  dedupeBlockers,
  dedupeFlags,
  flag,
  known,
  latestAtOrBefore,
  mergeQuality,
  multiply,
  sumAll,
  unknown,
  valuationsAtOrBefore,
  type BusinessAmount,
  type BusinessBlocker,
  type BusinessBridgeItem,
  type BusinessDcfAssumptions,
  type BusinessEbitdaAdjustment,
  type BusinessEntity,
  type BusinessFinancialSnapshot,
  type BusinessFlag,
  type BusinessMetricBasis,
  type BusinessQuality,
  type BusinessValuationBasis,
  type BusinessValuationMethod,
} from "@/lib/engine/business-equity-facts";

/**
 * VALUATION ENGINE
 *
 * Ce module est la réponse à la faiblesse centrale de Business Equity V2 : la valorisation
 * y était SAISIE, et la méthode n'était qu'une étiquette. Ici, l'utilisateur fournit des
 * faits et des hypothèses, et le moteur DÉRIVE — étape par étape, chaque étape restant
 * lisible et attribuable à sa source.
 *
 * MÉTHODES RÉELLEMENT IMPLÉMENTÉES
 * --------------------------------
 *   EBITDA_MULTIPLE     EBITDA observé + ajustements → EBITDA ajusté × multiple → EV → Equity
 *   REVENUE_MULTIPLE    CA observé × multiple → EV → Equity (utilisable sur EBITDA négatif)
 *   DCF                 FCF projetés déclarés, actualisés au WACC, valeur terminale, → EV → Equity
 *   FUNDING_ROUND       pre-money + primaire → post-money, sous réserve des préférences
 *   EXTERNAL_APPRAISAL  EV ou Equity réellement observée hors du modèle
 *   TRANSACTION         idem, prix réellement traité
 *   USER_ESTIMATE       montant déclaré, assumé comme saisie et jamais présenté comme dérivé
 *   LOOK_THROUGH        holding : somme des quote-parts de filiales ± bilan propre
 *
 * LE PONT EST LE PRODUIT. `bridge` n'est pas une trace de debug : c'est la sortie
 * principale. Un utilisateur doit pouvoir lire d'où vient chaque euro, de l'EBITDA observé
 * jusqu'à sa valeur personnelle, sans jamais avoir à refaire le calcul.
 *
 * UNE FOURCHETTE, PAS UN CHIFFRE. Une valorisation privée honnête est un intervalle. Le
 * multiple bas et le multiple haut, quand ils sont déclarés, produisent une EV et une
 * Equity basses et hautes. Seul le CENTRAL alimente le bilan.
 */

export type BusinessBridgeStepKind =
  "METRIC" | "ADJUSTMENT" | "SUBTOTAL" | "MULTIPLIER" | "ADD" | "SUBTRACT" | "RESULT";

/** Nature de l'unité portée par une étape : un montant, un multiple, ou un taux. */
export type BusinessBridgeUnit = "CURRENCY" | "MULTIPLE" | "RATE";

export interface BusinessBridgeStep {
  /** Code stable : l'interface le traduit, elle ne l'affiche jamais tel quel. */
  key: string;
  kind: BusinessBridgeStepKind;
  /** Libellé porté par la donnée utilisateur (nom d'ajustement, d'élément de bridge). */
  label: string | null;
  amount: BusinessAmount;
  unit: BusinessBridgeUnit;
  dataKind: DataKind;
  date: string | null;
}

export interface BusinessValueRange {
  low: BusinessAmount;
  central: BusinessAmount;
  high: BusinessAmount;
}

export interface BusinessMultipleRange {
  low: number | null;
  central: number | null;
  high: number | null;
}

export interface BusinessValuationResult {
  basis: BusinessValuationBasis | null;
  method: BusinessValuationMethod | null;
  valuationDate: string | null;
  /** Vrai quand le résultat est DÉRIVÉ par le moteur, faux quand il est saisi ou observé. */
  isDerivedByEngine: boolean;
  /** Vrai quand l'entrée est un fait observé hors modèle (expertise, transaction). */
  isObservedFact: boolean;
  /**
   * Vrai quand la méthode DÉFINIT une Enterprise Value.
   *
   * Un tour de table valorise l'equity, pas l'actif économique ; une Equity Value observée
   * n'en implique aucune ; une holding valorisée par transparence non plus. Distinguer
   * « pas d'EV parce que la méthode n'en produit pas » de « EV non calculable faute d'un
   * terme » évite qu'une seule participation rende un total d'EV définitivement muet.
   */
  hasEnterpriseValueConcept: boolean;
  bridge: BusinessBridgeStep[];
  metricBasis: BusinessMetricBasis | null;
  metricPeriodEnd: string | null;
  observedMetric: BusinessAmount | null;
  adjustedMetric: BusinessAmount | null;
  multiple: BusinessMultipleRange | null;
  enterpriseValue: BusinessValueRange;
  equityValue: BusinessValueRange;
  attributableValue: BusinessValueRange;
  grossDebt: BusinessAmount;
  cash: BusinessAmount;
  netDebt: BusinessAmount;
  bridgeItemsTotal: BusinessAmount;
  /** Période de bilan qui a servi au pont EV → Equity. */
  balanceSheetPeriodEnd: string | null;
  ageDays: number | null;
  isStale: boolean;
  /** Autres valorisations portant la même date : le conflit est exposé, jamais fusionné. */
  alternatives: BusinessValuationBasis[];
  quality: BusinessQuality;
}

export interface ValueBusinessInput {
  business: BusinessEntity;
  asOfDate: string;
  reportingCurrency: string;
  bases: BusinessValuationBasis[];
  financials: BusinessFinancialSnapshot[];
  ebitdaAdjustments: BusinessEbitdaAdjustment[];
  bridgeItems: BusinessBridgeItem[];
  dcf: BusinessDcfAssumptions[];
  currencyRates: CurrencyRate[];
  /** Droits économiques applicables. Ferme le pont jusqu'à la valeur personnelle. */
  economicRate: BusinessAmount;
  /**
   * Equity value d'une filiale, fournie par le portefeuille qui gère mémoïsation et
   * cycles. Absente pour une société sans participation.
   */
  childEquityValue?: (childBusinessId: string) => BusinessAmount;
  /** Rattachements actifs de cette société vers ses filiales, à la date de lecture. */
  childLinks?: Array<{ childBusinessId: string; ownershipRate: number }>;
}

const NO_RANGE = (item: BusinessAmount): BusinessValueRange => ({
  low: item,
  central: item,
  high: item,
});

const step = (
  key: string,
  kind: BusinessBridgeStepKind,
  amount: BusinessAmount,
  options: {
    label?: string | null;
    unit?: BusinessBridgeUnit;
    dataKind?: DataKind;
    date?: string | null;
  } = {},
): BusinessBridgeStep => ({
  key,
  kind,
  label: options.label ?? null,
  amount,
  unit: options.unit ?? "CURRENCY",
  dataKind: options.dataKind ?? "DERIVED",
  date: options.date ?? null,
});

function rangeQuality(range: BusinessValueRange): BusinessQuality {
  return mergeQuality(range.low, range.central, range.high);
}

/**
 * Pont EV → Equity, hors cash et dette : minoritaires, provisions, earn-out, comptes
 * courants d'associés, actifs hors exploitation. Absents = NON DÉCLARÉS, donc la somme
 * d'une liste vide vaut zéro déclaré : ne rien déclarer signifie ici « pas d'autre terme »,
 * ce qui est une position par défaut légitime car ces termes sont l'exception. Cash et
 * dette brute, eux, ne bénéficient jamais de cette tolérance.
 */
function sumBridgeItems(
  items: BusinessBridgeItem[],
  business: BusinessEntity,
  asOfDate: string,
  reportingCurrency: string,
  rates: CurrencyRate[],
): { total: BusinessAmount; steps: BusinessBridgeStep[] } {
  const applicable = items
    .filter((item) => item.businessId === business.id && item.effectiveDate <= asOfDate)
    .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  const converted = applicable.map((item) => ({
    item,
    amount: convertFact(
      item.amount,
      item.currency,
      item.effectiveDate,
      reportingCurrency,
      rates,
      blocker("CURRENCY_MISSING", business.id, item.label),
      business.id,
    ).amount,
  }));
  return {
    total: converted.length === 0 ? known(0) : sumAll(converted.map((row) => row.amount)),
    steps: converted.map((row) =>
      step(
        `BRIDGE_ITEM:${row.item.category}`,
        row.amount.value !== null && row.amount.value < 0 ? "SUBTRACT" : "ADD",
        row.amount,
        { label: row.item.label, dataKind: row.item.provenance.kind, date: row.item.effectiveDate },
      ),
    ),
  };
}

interface BridgeContext {
  grossDebt: BusinessAmount;
  cash: BusinessAmount;
  netDebt: BusinessAmount;
  bridgeItemsTotal: BusinessAmount;
  bridgeSteps: BusinessBridgeStep[];
  balanceSheetPeriodEnd: string | null;
}

/**
 * Termes du pont, lus sur le bilan le plus récent connu à la date de valorisation.
 *
 * Le bilan retenu peut être postérieur à la période du multiple : c'est la pratique — on
 * valorise sur un agrégat d'exploitation annuel et on ponte avec la dernière situation de
 * trésorerie connue. La période retenue est donc EXPOSÉE, pas implicite.
 *
 * ABSENCE DE DETTE ≠ DETTE NULLE. Une période sans dette brute renseignée ne permet pas de
 * dériver une Equity Value : ce serait surévaluer le patrimoine du montant entier du passif.
 */
function bridgeContext(
  business: BusinessEntity,
  valuationDate: string,
  financials: BusinessFinancialSnapshot[],
  bridgeItems: BusinessBridgeItem[],
  reportingCurrency: string,
  rates: CurrencyRate[],
): BridgeContext {
  const snapshot = latestAtOrBefore(
    financials.filter((row) => row.businessId === business.id),
    valuationDate,
    (row) => row.periodEnd,
  );
  const items = sumBridgeItems(bridgeItems, business, valuationDate, reportingCurrency, rates);
  if (!snapshot) {
    const missing = unknown([
      blocker("EV_TO_EQUITY_GROSS_DEBT_MISSING", business.id),
      blocker("EV_TO_EQUITY_CASH_MISSING", business.id),
    ]);
    return {
      grossDebt: missing,
      cash: missing,
      netDebt: missing,
      bridgeItemsTotal: items.total,
      bridgeSteps: items.steps,
      balanceSheetPeriodEnd: null,
    };
  }
  const currency = snapshot.currency ?? business.functionalCurrency ?? null;
  const grossDebt = convertFact(
    snapshot.grossDebt,
    currency,
    snapshot.periodEnd,
    reportingCurrency,
    rates,
    blocker("EV_TO_EQUITY_GROSS_DEBT_MISSING", business.id),
    business.id,
  ).amount;
  const cash = convertFact(
    snapshot.cash,
    currency,
    snapshot.periodEnd,
    reportingCurrency,
    rates,
    blocker("EV_TO_EQUITY_CASH_MISSING", business.id),
    business.id,
  ).amount;
  return {
    grossDebt,
    cash,
    netDebt: sumAll([
      grossDebt,
      {
        value: cash.value === null ? null : -cash.value,
        blockers: cash.blockers,
        flags: cash.flags,
      },
    ]),
    bridgeItemsTotal: items.total,
    bridgeSteps: items.steps,
    balanceSheetPeriodEnd: snapshot.periodEnd,
  };
}

/** EV → Equity : − dette brute + cash ± éléments déclarés. Jamais EV × détention. */
function equityFromEnterprise(enterprise: BusinessAmount, context: BridgeContext): BusinessAmount {
  return sumAll([
    enterprise,
    {
      value: context.grossDebt.value === null ? null : -context.grossDebt.value,
      blockers: context.grossDebt.blockers,
      flags: context.grossDebt.flags,
    },
    context.cash,
    context.bridgeItemsTotal,
  ]);
}

function bridgeStepsForEquity(context: BridgeContext): BusinessBridgeStep[] {
  return [
    step("GROSS_DEBT", "SUBTRACT", context.grossDebt, {
      date: context.balanceSheetPeriodEnd,
      dataKind: "ACTUAL",
    }),
    step("CASH", "ADD", context.cash, { date: context.balanceSheetPeriodEnd, dataKind: "ACTUAL" }),
    ...context.bridgeSteps,
  ];
}

// ─── EBITDA ajusté ──────────────────────────────────────────────────────────────────────

export interface AdjustedMetricResult {
  observed: BusinessAmount;
  adjusted: BusinessAmount;
  steps: BusinessBridgeStep[];
  periodEnd: string | null;
  flags: BusinessFlag[];
}

/**
 * Agrégat retenu, ajusté des seuls retraitements DÉCLARÉS.
 *
 * Le moteur n'invente aucun ajustement : il ne « normalise » pas une rémunération de
 * dirigeant qu'on ne lui a pas donnée, et n'extrait aucun exceptionnel de lui-même. Chaque
 * ligne d'ajustement est datée, catégorisée et attribuée. Un pro forma déclaré est signalé :
 * ce n'est plus un résultat constaté.
 */
export function adjustedMetric(
  business: BusinessEntity,
  basis: BusinessValuationBasis,
  financials: BusinessFinancialSnapshot[],
  adjustments: BusinessEbitdaAdjustment[],
  reportingCurrency: string,
  rates: CurrencyRate[],
): AdjustedMetricResult {
  const metricBasis: BusinessMetricBasis =
    basis.metricBasis ?? (basis.method === "REVENUE_MULTIPLE" ? "REVENUE" : "EBITDA");
  const candidates = financials
    .filter((row) => row.businessId === business.id && row.periodEnd <= basis.valuationDate)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));
  const snapshot = basis.metricPeriodEnd
    ? (candidates.find((row) => row.periodEnd === basis.metricPeriodEnd) ?? null)
    : (candidates.filter((row) => row.periodKind !== "INTERIM").at(-1) ?? null);

  if (!snapshot) {
    const missing = unknown([blocker("VALUATION_FINANCIAL_PERIOD_MISSING", business.id)]);
    return { observed: missing, adjusted: missing, steps: [], periodEnd: null, flags: [] };
  }

  const currency = snapshot.currency ?? business.functionalCurrency ?? null;
  const rawMetric = metricOfPeriod(snapshot, metricBasis);
  const observed = convertFact(
    rawMetric,
    currency,
    snapshot.periodEnd,
    reportingCurrency,
    rates,
    blocker("VALUATION_METRIC_MISSING", business.id, metricBasis),
    business.id,
  ).amount;

  // Les retraitements ne portent que sur des agrégats de résultat. Un « ajustement de
  // chiffre d'affaires » n'existe pas dans ce modèle : il serait un retraitement d'EBITDA.
  const applicable =
    metricBasis === "REVENUE"
      ? []
      : adjustments
          .filter((row) => row.businessId === business.id && row.periodEnd === snapshot.periodEnd)
          .sort((left, right) => left.label.localeCompare(right.label));
  const convertedAdjustments = applicable.map((row) => ({
    row,
    amount: convertFact(
      row.amount,
      row.currency,
      row.periodEnd,
      reportingCurrency,
      rates,
      blocker("CURRENCY_MISSING", business.id, row.label),
      business.id,
    ).amount,
  }));

  const flags: BusinessFlag[] = [];
  if (convertedAdjustments.length > 0) flags.push(flag("EBITDA_ADJUSTED", business.id));
  if (applicable.some((row) => row.category === "PRO_FORMA"))
    flags.push(flag("PRO_FORMA_ADJUSTMENT_INCLUDED", business.id));
  if (rawMetric !== null && metricBasis === "EBITDA" && rawMetric < 0)
    flags.push(flag("EBITDA_NEGATIVE", business.id));

  const adjusted = sumAll([observed, ...convertedAdjustments.map((row) => row.amount)]);
  return {
    observed,
    adjusted: { ...adjusted, flags: dedupeFlags([...adjusted.flags, ...flags]) },
    steps: [
      step(`METRIC_OBSERVED:${metricBasis}`, "METRIC", observed, {
        dataKind: snapshot.provenance.kind,
        date: snapshot.periodEnd,
        label: snapshot.periodLabel,
      }),
      ...convertedAdjustments.map((row) =>
        step(`METRIC_ADJUSTMENT:${row.row.category}`, "ADJUSTMENT", row.amount, {
          label: row.row.label,
          dataKind: row.row.provenance.kind,
          date: row.row.periodEnd,
        }),
      ),
      ...(convertedAdjustments.length > 0
        ? [
            step(`METRIC_ADJUSTED:${metricBasis}`, "SUBTOTAL", adjusted, {
              date: snapshot.periodEnd,
            }),
          ]
        : []),
    ],
    periodEnd: snapshot.periodEnd,
    flags,
  };
}

// ─── DCF ────────────────────────────────────────────────────────────────────────────────

export interface DcfPeriodResult {
  yearIndex: number;
  ebit: BusinessAmount;
  nopat: BusinessAmount;
  freeCashFlow: BusinessAmount;
  discountFactor: number;
  presentValue: BusinessAmount;
}

export interface DcfResult {
  periods: DcfPeriodResult[];
  terminalValue: BusinessAmount;
  discountedTerminalValue: BusinessAmount;
  discountedExplicitValue: BusinessAmount;
  enterpriseValue: BusinessAmount;
  /** Part de l'EV portée par la valeur terminale. Au-delà de 75 %, le DCF dit peu. */
  terminalValueShare: BusinessAmount;
  assumptions: BusinessDcfAssumptions | null;
}

/**
 * DCF sur des projections DÉCLARÉES.
 *
 * LFO ne fournit ni croissance, ni marge, ni WACC, ni croissance terminale : ces valeurs
 * n'existent que si l'utilisateur les a saisies. Le moteur ne fait qu'appliquer la
 * mécanique — et refuse de la faire tourner sur un déroulé incomplet.
 *
 * FCF = EBIT × (1 − taux d'impôt) + D&A − capex − variation de BFR.
 * EBIT est repris s'il est déclaré, sinon dérivé d'EBITDA − D&A. Sans D&A, il n'est pas
 * dérivable : traiter un amortissement inconnu comme nul gonflerait le NOPAT.
 *
 * La valeur terminale est actualisée à la FIN de l'année N même en convention mi-année :
 * elle représente une valeur de revente à cette date, pas un flux étalé dans l'année.
 */
export function computeDcf(
  business: BusinessEntity,
  assumptions: BusinessDcfAssumptions | null,
  reportingCurrency: string,
  rates: CurrencyRate[],
): DcfResult {
  const blank = unknown([blocker("DCF_ASSUMPTIONS_MISSING", business.id)]);
  if (!assumptions) {
    return {
      periods: [],
      terminalValue: blank,
      discountedTerminalValue: blank,
      discountedExplicitValue: blank,
      enterpriseValue: blank,
      terminalValueShare: blank,
      assumptions: null,
    };
  }
  const ordered = [...assumptions.periods].sort((left, right) => left.yearIndex - right.yearIndex);
  if (ordered.length === 0) {
    const missing = unknown([blocker("DCF_PERIODS_MISSING", business.id)]);
    return {
      periods: [],
      terminalValue: missing,
      discountedTerminalValue: missing,
      discountedExplicitValue: missing,
      enterpriseValue: missing,
      terminalValueShare: missing,
      assumptions,
    };
  }

  const convert = (value: number | null, label: string): BusinessAmount =>
    convertFact(
      value,
      assumptions.currency,
      assumptions.valuationDate,
      reportingCurrency,
      rates,
      blocker("DCF_PERIOD_INPUTS_MISSING", business.id, label),
      business.id,
    ).amount;

  const midYear = assumptions.discountConvention === "MID_YEAR";
  const periods = ordered.map((period): DcfPeriodResult => {
    const da = convert(period.depreciationAmortisation, "D&A");
    const ebit =
      period.ebit !== null
        ? convert(period.ebit, "EBIT")
        : period.ebitda !== null
          ? sumAll([
              convert(period.ebitda, "EBITDA"),
              {
                value: da.value === null ? null : -da.value,
                blockers: da.blockers,
                flags: da.flags,
              },
            ])
          : unknown([
              blocker("DCF_PERIOD_INPUTS_MISSING", business.id, `année ${period.yearIndex} : EBIT`),
            ]);
    const nopat = multiply(ebit, known(1 - assumptions.taxRate));
    const capex = convert(period.capex, `année ${period.yearIndex} : capex`);
    const workingCapitalChange = convert(
      period.workingCapitalChange,
      `année ${period.yearIndex} : variation de BFR`,
    );
    const freeCashFlow = sumAll([
      nopat,
      da,
      {
        value: capex.value === null ? null : -capex.value,
        blockers: capex.blockers,
        flags: capex.flags,
      },
      {
        value: workingCapitalChange.value === null ? null : -workingCapitalChange.value,
        blockers: workingCapitalChange.blockers,
        flags: workingCapitalChange.flags,
      },
    ]);
    const exponent = midYear ? period.yearIndex - 0.5 : period.yearIndex;
    const discountFactor = (1 + assumptions.wacc) ** exponent;
    return {
      yearIndex: period.yearIndex,
      ebit,
      nopat,
      freeCashFlow,
      discountFactor,
      presentValue: multiply(freeCashFlow, known(1 / discountFactor)),
    };
  });

  const lastPeriod = ordered[ordered.length - 1];
  const lastResult = periods[periods.length - 1];
  let terminalValue: BusinessAmount;
  if (assumptions.terminalMethod === "PERPETUAL_GROWTH") {
    const growthRate = assumptions.terminalGrowth;
    if (growthRate === null || growthRate >= assumptions.wacc) {
      terminalValue = unknown([blocker("DCF_TERMINAL_INVALID", business.id)]);
    } else {
      terminalValue = multiply(
        lastResult.freeCashFlow,
        known((1 + growthRate) / (assumptions.wacc - growthRate)),
      );
    }
  } else {
    const metric =
      assumptions.terminalExitMetric === "EBIT"
        ? lastResult.ebit
        : convert(lastPeriod.ebitda, `année ${lastPeriod.yearIndex} : EBITDA de sortie`);
    terminalValue =
      assumptions.terminalExitMultiple === null
        ? unknown([blocker("DCF_TERMINAL_INVALID", business.id)])
        : multiply(metric, known(assumptions.terminalExitMultiple));
  }

  const terminalDiscount = (1 + assumptions.wacc) ** lastPeriod.yearIndex;
  const discountedTerminalValue = multiply(terminalValue, known(1 / terminalDiscount));
  const discountedExplicitValue = sumAll(periods.map((period) => period.presentValue));
  const enterpriseValue = sumAll([discountedExplicitValue, discountedTerminalValue]);
  const terminalValueShare =
    enterpriseValue.value === null ||
    discountedTerminalValue.value === null ||
    enterpriseValue.value <= 0
      ? unknown(dedupeBlockers([...enterpriseValue.blockers, ...discountedTerminalValue.blockers]))
      : known(discountedTerminalValue.value / enterpriseValue.value);

  return {
    periods,
    terminalValue,
    discountedTerminalValue,
    discountedExplicitValue,
    enterpriseValue,
    terminalValueShare,
    assumptions,
  };
}

// ─── Valorisation d'une société ─────────────────────────────────────────────────────────

const EMPTY_RANGE = (blockers: BusinessBlocker[]): BusinessValueRange =>
  NO_RANGE(unknown(blockers));

export function valueBusiness(input: ValueBusinessInput): BusinessValuationResult {
  const { business, asOfDate, reportingCurrency, currencyRates: rates } = input;
  const applicable = valuationsAtOrBefore(
    input.bases.filter((row) => row.businessId === business.id),
    asOfDate,
  );
  const basis = applicable[0] ?? null;
  const alternatives = applicable.slice(1);
  const links = input.childLinks ?? [];

  // Aucune base déclarée : une holding tire sa valeur de ses participations, une société
  // opérationnelle ne tire la sienne de rien.
  if (!basis) {
    if (links.length > 0 && input.childEquityValue) {
      return lookThroughValuation(input, links, null);
    }
    const missing = EMPTY_RANGE([blocker("VALUATION_BASIS_MISSING", business.id)]);
    return emptyResult(business, missing, input.economicRate, null);
  }

  if (basis.method === "LOOK_THROUGH" && input.childEquityValue) {
    return lookThroughValuation(input, links, basis);
  }

  const context = bridgeContext(
    business,
    basis.valuationDate,
    input.financials,
    input.bridgeItems,
    reportingCurrency,
    rates,
  );
  const valuationCurrency = basis.currency ?? business.functionalCurrency ?? null;
  const ageDays = daysBetween(basis.valuationDate, asOfDate);
  const stale = ageDays > BUSINESS_VALUATION_STALE_AFTER_DAYS;
  const baseFlags: BusinessFlag[] = [];
  if (stale) baseFlags.push(flag("VALUATION_STALE", business.id, `${ageDays} jours`));
  if (alternatives.length > 0)
    baseFlags.push(
      flag("CONFLICTING_VALUATIONS", business.id, alternatives.map((row) => row.method).join(", ")),
    );
  if (basis.method === "USER_ESTIMATE")
    baseFlags.push(flag("VALUATION_IS_USER_INPUT", business.id));

  let enterpriseValue: BusinessValueRange;
  let equityValue: BusinessValueRange;
  let bridge: BusinessBridgeStep[] = [];
  let metricResult: AdjustedMetricResult | null = null;
  let multipleRange: BusinessMultipleRange | null = null;
  let hasEnterpriseValueConcept = true;

  if (basis.method === "EBITDA_MULTIPLE" || basis.method === "REVENUE_MULTIPLE") {
    metricResult = adjustedMetric(
      business,
      basis,
      input.financials,
      input.ebitdaAdjustments,
      reportingCurrency,
      rates,
    );
    const central = basis.multiple;
    multipleRange = {
      low: basis.multipleLow ?? central,
      central,
      high: basis.multipleHigh ?? central,
    };
    if (basis.multipleLow !== null || basis.multipleHigh !== null)
      baseFlags.push(flag("MULTIPLE_RANGE_DECLARED", business.id));
    const applyMultiple = (multiple: number | null): BusinessAmount =>
      multiple === null
        ? unknown([blocker("VALUATION_MULTIPLE_MISSING", business.id)])
        : multiply(metricResult!.adjusted, known(multiple));
    enterpriseValue = {
      low: applyMultiple(multipleRange.low),
      central: applyMultiple(multipleRange.central),
      high: applyMultiple(multipleRange.high),
    };
    equityValue = {
      low: equityFromEnterprise(enterpriseValue.low, context),
      central: equityFromEnterprise(enterpriseValue.central, context),
      high: equityFromEnterprise(enterpriseValue.high, context),
    };
    bridge = [
      ...metricResult.steps,
      step(
        "MULTIPLE",
        "MULTIPLIER",
        central === null
          ? unknown([blocker("VALUATION_MULTIPLE_MISSING", business.id)])
          : known(central),
        {
          unit: "MULTIPLE",
          dataKind: basis.provenance.kind,
          date: basis.valuationDate,
        },
      ),
      step("ENTERPRISE_VALUE", "SUBTOTAL", enterpriseValue.central, { date: basis.valuationDate }),
      ...bridgeStepsForEquity(context),
      step("EQUITY_VALUE", "SUBTOTAL", equityValue.central, { date: basis.valuationDate }),
    ];
  } else if (basis.method === "DCF") {
    const assumptions =
      latestAtOrBefore(
        input.dcf.filter((row) => row.businessId === business.id),
        basis.valuationDate,
        (row) => row.valuationDate,
      ) ?? null;
    const dcf = computeDcf(business, assumptions, reportingCurrency, rates);
    enterpriseValue = NO_RANGE(dcf.enterpriseValue);
    equityValue = NO_RANGE(equityFromEnterprise(dcf.enterpriseValue, context));
    bridge = [
      step("DCF_EXPLICIT_PV", "SUBTOTAL", dcf.discountedExplicitValue, {
        date: basis.valuationDate,
      }),
      step("DCF_TERMINAL_PV", "ADD", dcf.discountedTerminalValue, { date: basis.valuationDate }),
      step("ENTERPRISE_VALUE", "SUBTOTAL", enterpriseValue.central, { date: basis.valuationDate }),
      ...bridgeStepsForEquity(context),
      step("EQUITY_VALUE", "SUBTOTAL", equityValue.central, { date: basis.valuationDate }),
    ];
  } else if (basis.method === "FUNDING_ROUND") {
    const preMoney = convertFact(
      basis.preMoneyEquityValue,
      valuationCurrency,
      basis.valuationDate,
      reportingCurrency,
      rates,
      blocker("FUNDING_ROUND_TERMS_MISSING", business.id, "pre-money"),
      business.id,
    ).amount;
    const primary = convertFact(
      basis.primaryNewMoney,
      valuationCurrency,
      basis.valuationDate,
      reportingCurrency,
      rates,
      blocker("FUNDING_ROUND_TERMS_MISSING", business.id, "argent frais primaire"),
      business.id,
    ).amount;
    const postMoney = sumAll([preMoney, primary]);
    if (basis.preferredRightsKnown !== true)
      baseFlags.push(flag("PREFERRED_RIGHTS_UNKNOWN", business.id));
    // Un tour de table négocie une valeur d'EQUITY. En déduire une Enterprise Value
    // supposerait de connaître la dette nette à la date du tour, que le tour ne dit pas.
    hasEnterpriseValueConcept = false;
    enterpriseValue = EMPTY_RANGE([
      blocker(
        "VALUATION_BASIS_MISSING",
        business.id,
        "un tour de table ne définit pas d’Enterprise Value",
      ),
    ]);
    equityValue = NO_RANGE(postMoney);
    bridge = [
      step("PRE_MONEY", "METRIC", preMoney, {
        dataKind: basis.provenance.kind,
        date: basis.valuationDate,
      }),
      step("PRIMARY_NEW_MONEY", "ADD", primary, {
        dataKind: basis.provenance.kind,
        date: basis.valuationDate,
      }),
      step("POST_MONEY", "SUBTOTAL", postMoney, { date: basis.valuationDate }),
      step("EQUITY_VALUE", "SUBTOTAL", postMoney, { date: basis.valuationDate }),
    ];
  } else {
    // Chemins OBSERVÉS et saisie libre : le montant est un fait d'entrée, pas un résultat.
    const observedEquity = convertFact(
      basis.equityValue,
      valuationCurrency,
      basis.valuationDate,
      reportingCurrency,
      rates,
      blocker("EQUITY_VALUE_NOT_COMPUTABLE", business.id),
      business.id,
    ).amount;
    const observedEnterprise = convertFact(
      basis.enterpriseValue,
      valuationCurrency,
      basis.valuationDate,
      reportingCurrency,
      rates,
      blocker("VALUATION_BASIS_MISSING", business.id),
      business.id,
    ).amount;
    if (basis.equityValue !== null) {
      hasEnterpriseValueConcept = basis.enterpriseValue !== null;
      enterpriseValue =
        basis.enterpriseValue !== null
          ? NO_RANGE(observedEnterprise)
          : EMPTY_RANGE([
              blocker("VALUATION_BASIS_MISSING", business.id, "Enterprise Value non déclarée"),
            ]);
      equityValue = NO_RANGE(observedEquity);
      bridge = [
        step("EQUITY_VALUE_OBSERVED", "METRIC", observedEquity, {
          dataKind: basis.provenance.kind,
          date: basis.valuationDate,
        }),
      ];
    } else {
      enterpriseValue = NO_RANGE(observedEnterprise);
      const derived = equityFromEnterprise(observedEnterprise, context);
      equityValue = NO_RANGE(derived);
      bridge = [
        step("ENTERPRISE_VALUE_OBSERVED", "METRIC", observedEnterprise, {
          dataKind: basis.provenance.kind,
          date: basis.valuationDate,
        }),
        ...bridgeStepsForEquity(context),
        step("EQUITY_VALUE", "SUBTOTAL", derived, { date: basis.valuationDate }),
      ];
    }
  }

  const attributable: BusinessValueRange = {
    low: multiply(equityValue.low, input.economicRate),
    central: multiply(equityValue.central, input.economicRate),
    high: multiply(equityValue.high, input.economicRate),
  };
  bridge = [
    ...bridge,
    step("ECONOMIC_OWNERSHIP", "MULTIPLIER", input.economicRate, { unit: "RATE", date: asOfDate }),
    step("ATTRIBUTABLE_VALUE", "RESULT", attributable.central, { date: asOfDate }),
  ];

  const quality = mergeQuality(rangeQuality(equityValue), attributable.central, {
    blockers: [],
    flags: baseFlags,
  });

  return {
    basis,
    method: basis.method,
    valuationDate: basis.valuationDate,
    isDerivedByEngine: DERIVED_VALUATION_METHODS.includes(basis.method),
    isObservedFact: OBSERVED_VALUATION_METHODS.includes(basis.method),
    hasEnterpriseValueConcept,
    bridge: bridge.map((item) => ({
      ...item,
      amount: { ...item.amount, flags: dedupeFlags([...item.amount.flags]) },
    })),
    metricBasis: metricResult
      ? (basis.metricBasis ?? (basis.method === "REVENUE_MULTIPLE" ? "REVENUE" : "EBITDA"))
      : null,
    metricPeriodEnd: metricResult?.periodEnd ?? null,
    observedMetric: metricResult?.observed ?? null,
    adjustedMetric: metricResult?.adjusted ?? null,
    multiple: multipleRange,
    enterpriseValue,
    equityValue,
    attributableValue: attributable,
    grossDebt: context.grossDebt,
    cash: context.cash,
    netDebt: context.netDebt,
    bridgeItemsTotal: context.bridgeItemsTotal,
    balanceSheetPeriodEnd: context.balanceSheetPeriodEnd,
    ageDays,
    isStale: stale,
    alternatives,
    quality,
  };
}

/**
 * Valorisation look-through d'une holding.
 *
 * Valeur de la holding = Σ (equity value de chaque filiale × quote-part détenue)
 *                        − dette brute propre à la holding + trésorerie propre.
 *
 * La filiale n'entre PAS séparément au patrimoine personnel : elle y entre par la holding.
 * Le bilan propre de la holding est indispensable — une holding endettée dont on ignore la
 * dette vaut moins que la somme de ses filiales, et l'ignorer surévalue le patrimoine.
 */
function lookThroughValuation(
  input: ValueBusinessInput,
  links: Array<{ childBusinessId: string; ownershipRate: number }>,
  basis: BusinessValuationBasis | null,
): BusinessValuationResult {
  const { business, asOfDate, reportingCurrency, currencyRates: rates } = input;
  const context = bridgeContext(
    business,
    asOfDate,
    input.financials,
    input.bridgeItems,
    reportingCurrency,
    rates,
  );
  const childAmounts = links.map((link) => {
    const child = input.childEquityValue!(link.childBusinessId);
    return {
      link,
      amount: multiply(child, known(link.ownershipRate)),
    };
  });
  const participations =
    childAmounts.length === 0 ? known(0) : sumAll(childAmounts.map((row) => row.amount));
  const equity = sumAll([
    participations,
    {
      value: context.grossDebt.value === null ? null : -context.grossDebt.value,
      blockers: context.grossDebt.blockers,
      flags: context.grossDebt.flags,
    },
    context.cash,
    context.bridgeItemsTotal,
  ]);
  const equityWithFlag = {
    ...equity,
    flags: dedupeFlags([...equity.flags, flag("LOOK_THROUGH_VALUATION", business.id)]),
  };
  const attributable: BusinessValueRange = NO_RANGE(multiply(equityWithFlag, input.economicRate));
  const bridge: BusinessBridgeStep[] = [
    ...childAmounts.map((row) =>
      step("LOOK_THROUGH_PARTICIPATION", "ADD", row.amount, {
        label: row.link.childBusinessId,
        date: asOfDate,
      }),
    ),
    step("LOOK_THROUGH_PARTICIPATIONS", "SUBTOTAL", participations, { date: asOfDate }),
    ...bridgeStepsForEquity(context),
    step("EQUITY_VALUE", "SUBTOTAL", equityWithFlag, { date: asOfDate }),
    step("ECONOMIC_OWNERSHIP", "MULTIPLIER", input.economicRate, { unit: "RATE", date: asOfDate }),
    step("ATTRIBUTABLE_VALUE", "RESULT", attributable.central, { date: asOfDate }),
  ];
  return {
    basis,
    method: "LOOK_THROUGH",
    valuationDate: asOfDate,
    isDerivedByEngine: true,
    isObservedFact: false,
    hasEnterpriseValueConcept: false,
    bridge,
    metricBasis: null,
    metricPeriodEnd: null,
    observedMetric: null,
    adjustedMetric: null,
    multiple: null,
    enterpriseValue: EMPTY_RANGE([
      blocker(
        "VALUATION_BASIS_MISSING",
        business.id,
        "une holding valorisée par transparence n’a pas d’Enterprise Value propre",
      ),
    ]),
    equityValue: NO_RANGE(equityWithFlag),
    attributableValue: attributable,
    grossDebt: context.grossDebt,
    cash: context.cash,
    netDebt: context.netDebt,
    bridgeItemsTotal: context.bridgeItemsTotal,
    balanceSheetPeriodEnd: context.balanceSheetPeriodEnd,
    ageDays: null,
    isStale: false,
    alternatives: [],
    quality: mergeQuality(equityWithFlag, attributable.central),
  };
}

function emptyResult(
  business: BusinessEntity,
  range: BusinessValueRange,
  economicRate: BusinessAmount,
  basis: BusinessValuationBasis | null,
): BusinessValuationResult {
  const attributable = NO_RANGE(multiply(range.central, economicRate));
  return {
    basis,
    method: null,
    valuationDate: null,
    isDerivedByEngine: false,
    isObservedFact: false,
    hasEnterpriseValueConcept: false,
    bridge: [],
    metricBasis: null,
    metricPeriodEnd: null,
    observedMetric: null,
    adjustedMetric: null,
    multiple: null,
    enterpriseValue: range,
    equityValue: range,
    attributableValue: attributable,
    grossDebt: unknown([blocker("VALUATION_BASIS_MISSING", business.id)]),
    cash: unknown([blocker("VALUATION_BASIS_MISSING", business.id)]),
    netDebt: unknown([blocker("VALUATION_BASIS_MISSING", business.id)]),
    bridgeItemsTotal: known(0),
    balanceSheetPeriodEnd: null,
    ageDays: null,
    isStale: false,
    alternatives: [],
    quality: mergeQuality(range.central, attributable.central),
  };
}

// ─── Sensibilités ───────────────────────────────────────────────────────────────────────

export interface SensitivityCell {
  rowValue: number;
  columnValue: number;
  amount: BusinessAmount;
}

export interface SensitivityMatrix {
  rowKey: string;
  columnKey: string;
  rows: number[];
  columns: number[];
  cells: SensitivityCell[][];
  /** Grandeur mesurée dans chaque case. */
  output: "ENTERPRISE_VALUE" | "EQUITY_VALUE" | "ATTRIBUTABLE_VALUE";
}

/**
 * Matrice multiple × agrégat, la sensibilité de référence d'une valorisation par multiple.
 *
 * Elle ne balaye pas un intervalle inventé : les multiples sont ceux déclarés (bas, central,
 * haut) et les variations d'agrégat sont celles demandées par l'appelant. Une case dont un
 * terme manque reste non calculable — la matrice ne se remplit pas de zéros.
 */
export function multipleSensitivity(input: {
  adjustedMetric: BusinessAmount;
  multiples: number[];
  metricShocks: number[];
  toEquity: (enterpriseValue: BusinessAmount) => BusinessAmount;
  economicRate?: BusinessAmount;
  output?: SensitivityMatrix["output"];
}): SensitivityMatrix {
  const output = input.output ?? "EQUITY_VALUE";
  const cells = input.metricShocks.map((shock) =>
    input.multiples.map((multipleValue): SensitivityCell => {
      const shocked = multiply(input.adjustedMetric, known(1 + shock));
      const enterprise = multiply(shocked, known(multipleValue));
      const equity = input.toEquity(enterprise);
      const amount =
        output === "ENTERPRISE_VALUE"
          ? enterprise
          : output === "EQUITY_VALUE"
            ? equity
            : multiply(equity, input.economicRate ?? known(1));
      return { rowValue: shock, columnValue: multipleValue, amount };
    }),
  );
  return {
    rowKey: "METRIC_SHOCK",
    columnKey: "MULTIPLE",
    rows: input.metricShocks,
    columns: input.multiples,
    cells,
    output,
  };
}

/**
 * Matrice WACC × croissance terminale (ou × multiple de sortie) d'un DCF.
 *
 * Une combinaison où la croissance terminale atteint ou dépasse le WACC ne produit pas un
 * très grand nombre : elle ne produit RIEN. La formule de Gordon y perd son sens.
 */
export function dcfSensitivity(input: {
  business: BusinessEntity;
  assumptions: BusinessDcfAssumptions;
  waccValues: number[];
  terminalValues: number[];
  reportingCurrency: string;
  currencyRates: CurrencyRate[];
  toEquity?: (enterpriseValue: BusinessAmount) => BusinessAmount;
  output?: SensitivityMatrix["output"];
}): SensitivityMatrix {
  const output = input.output ?? "ENTERPRISE_VALUE";
  const cells = input.waccValues.map((wacc) =>
    input.terminalValues.map((terminal): SensitivityCell => {
      const variant: BusinessDcfAssumptions = {
        ...input.assumptions,
        wacc,
        terminalGrowth:
          input.assumptions.terminalMethod === "PERPETUAL_GROWTH"
            ? terminal
            : input.assumptions.terminalGrowth,
        terminalExitMultiple:
          input.assumptions.terminalMethod === "EXIT_MULTIPLE"
            ? terminal
            : input.assumptions.terminalExitMultiple,
      };
      const result = computeDcf(
        input.business,
        variant,
        input.reportingCurrency,
        input.currencyRates,
      );
      const amount =
        output === "ENTERPRISE_VALUE" || !input.toEquity
          ? result.enterpriseValue
          : input.toEquity(result.enterpriseValue);
      return { rowValue: wacc, columnValue: terminal, amount };
    }),
  );
  return {
    rowKey: "WACC",
    columnKey:
      input.assumptions.terminalMethod === "PERPETUAL_GROWTH" ? "TERMINAL_GROWTH" : "EXIT_MULTIPLE",
    rows: input.waccValues,
    columns: input.terminalValues,
    cells,
    output,
  };
}
