import { resolveFxRate, type CurrencyRate, type FxResolution } from "@/lib/engine/fx";
import type { Confidence, DataKind, Provenance } from "@/lib/types";

/**
 * BUSINESS EQUITY — VOCABULAIRE ET FAITS CANONIQUES
 *
 * Ce module ne calcule aucune valorisation. Il définit ce qu'est un FAIT dans le domaine
 * des participations privées, et l'algèbre minimale qui permet de dériver sans mentir.
 *
 * TROIS RÈGLES QUI GOUVERNENT TOUT LE DOMAINE
 * -------------------------------------------
 * RÈGLE 1 — Une valorisation dérivée n'est jamais un fait. L'utilisateur déclare un
 * multiple, une base financière, des ajustements ; le moteur en dérive une Enterprise
 * Value. L'inverse — saisir l'EV et l'appeler « méthode EBITDA » — est un mensonge de
 * nomenclature, et la base de données l'interdit désormais.
 *
 * RÈGLE 2 — EV ≠ EQUITY VALUE, et le pont entre les deux n'est jamais supposé. Une
 * Enterprise Value connue sans dette brute ni trésorerie datées ne produit AUCUNE Equity
 * Value : elle produit un motif de non-calcul. Multiplier une EV par un taux de détention
 * revient à attribuer à l'actionnaire la valeur qui revient aux créanciers.
 *
 * RÈGLE 3 — L'absence n'est pas un zéro. Aucun historique de capital, aucune distribution
 * déclarée, aucune charge : ce sont des inconnues. Seule une DÉCLARATION explicite de
 * couverture autorise à lire une absence d'événement comme un zéro.
 *
 * DETTE CORPORATE ≠ DETTE PERSONNELLE. La dette d'une société détenue n'entre jamais au
 * passif personnel : elle réduit l'Equity Value de la société, et c'est tout. Le seul
 * chemin inverse serait une garantie personnelle déclenchée, qui n'est pas modélisée ici.
 */

export const BUSINESS_TYPES = ["OPERATING", "HOLDING", "STARTUP", "SPV", "OTHER"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/**
 * Méthodes réellement portées par le moteur. Le libellé n'est pas décoratif : chacune
 * correspond à un chemin de dérivation implémenté et testé.
 *
 * `USER_ESTIMATE` n'est PAS une méthode de valorisation : c'est un montant déclaré, assumé
 * comme tel, qui ne prétend rien dériver. `LOOK_THROUGH` n'est jamais saisie : elle est
 * produite par le moteur quand une holding tire sa valeur de ses participations.
 */
export const BUSINESS_VALUATION_METHODS = [
  "EBITDA_MULTIPLE",
  "REVENUE_MULTIPLE",
  "DCF",
  "FUNDING_ROUND",
  "EXTERNAL_APPRAISAL",
  "TRANSACTION",
  "USER_ESTIMATE",
  "LOOK_THROUGH",
] as const;
export type BusinessValuationMethod = (typeof BUSINESS_VALUATION_METHODS)[number];

/** Méthodes dont le RÉSULTAT est dérivé et n'est donc jamais persisté. */
export const DERIVED_VALUATION_METHODS: readonly BusinessValuationMethod[] = [
  "EBITDA_MULTIPLE",
  "REVENUE_MULTIPLE",
  "DCF",
  "FUNDING_ROUND",
  "LOOK_THROUGH",
];

/** Méthodes dont l'entrée est une valeur réellement OBSERVÉE hors du modèle. */
export const OBSERVED_VALUATION_METHODS: readonly BusinessValuationMethod[] = [
  "EXTERNAL_APPRAISAL",
  "TRANSACTION",
];

/**
 * Ordre de préséance quand plusieurs valorisations coexistent à la même date.
 *
 * Convention DOCUMENTÉE, pas une vérité : un prix de transaction réellement payé prime sur
 * une expertise, qui prime sur un modèle, qui prime sur une saisie libre. Le moteur ne
 * fusionne jamais deux valorisations divergentes — il en retient une, signale le conflit et
 * expose l'écart pour que l'utilisateur tranche.
 */
const METHOD_PRECEDENCE: Record<BusinessValuationMethod, number> = {
  TRANSACTION: 1,
  EXTERNAL_APPRAISAL: 2,
  FUNDING_ROUND: 3,
  EBITDA_MULTIPLE: 4,
  REVENUE_MULTIPLE: 5,
  DCF: 6,
  LOOK_THROUGH: 7,
  USER_ESTIMATE: 8,
};

export const BUSINESS_METRIC_BASES = ["EBITDA", "REVENUE", "EBIT"] as const;
export type BusinessMetricBasis = (typeof BUSINESS_METRIC_BASES)[number];

export const BUSINESS_PERIOD_KINDS = ["ANNUAL", "LTM", "INTERIM"] as const;
export type BusinessPeriodKind = (typeof BUSINESS_PERIOD_KINDS)[number];

export const BUSINESS_EBITDA_ADJUSTMENT_CATEGORIES = [
  "OWNER_COMPENSATION",
  "EXCEPTIONAL",
  "NON_RECURRING",
  "PRO_FORMA",
  "OTHER",
] as const;
export type BusinessEbitdaAdjustmentCategory =
  (typeof BUSINESS_EBITDA_ADJUSTMENT_CATEGORIES)[number];

export const BUSINESS_BRIDGE_ITEM_CATEGORIES = [
  "MINORITY_INTERESTS",
  "PENSION_PROVISION",
  "EARN_OUT",
  "SHAREHOLDER_LOAN",
  "SURPLUS_ASSET",
  "TRANSACTION_COST",
  "OTHER",
] as const;
export type BusinessBridgeItemCategory = (typeof BUSINESS_BRIDGE_ITEM_CATEGORIES)[number];

/**
 * Complétude DÉCLARÉE du pont EV → Equity hors dette brute et trésorerie.
 *
 * Une liste vide n'a aucun sens sans cette déclaration : elle peut vouloir dire « aucun
 * autre ajustement » comme « pas encore renseigné ». La date permet de ne jamais appliquer
 * rétroactivement une déclaration faite pour une valorisation ultérieure.
 */
export const BUSINESS_BRIDGE_STATUSES = [
  "UNKNOWN",
  "DECLARED_NONE",
  "PARTIAL",
  "COMPLETE",
] as const;
export type BusinessBridgeStatus = (typeof BUSINESS_BRIDGE_STATUSES)[number];

export const BUSINESS_CAPITAL_EVENT_TYPES = [
  "OPENING_COST_BASIS",
  "ACQUISITION",
  "CAPITAL_INJECTION",
  "SALE",
  "BUYBACK",
  "DIVIDEND",
  "DISTRIBUTION",
  "CAPITAL_RETURN",
] as const;
export type BusinessCapitalEventType = (typeof BUSINESS_CAPITAL_EVENT_TYPES)[number];

/** Événements qui SORTENT du patrimoine liquide vers la participation. */
export const BUSINESS_INVESTING_EVENT_TYPES: readonly BusinessCapitalEventType[] = [
  "OPENING_COST_BASIS",
  "ACQUISITION",
  "CAPITAL_INJECTION",
];
/** Événements qui RENTRENT de la participation vers le patrimoine liquide. */
export const BUSINESS_RETURNING_EVENT_TYPES: readonly BusinessCapitalEventType[] = [
  "SALE",
  "BUYBACK",
  "DIVIDEND",
  "DISTRIBUTION",
  "CAPITAL_RETURN",
];
/** Sous-ensemble qui réduit la détention : seuls ceux-là libèrent du coût de revient. */
export const BUSINESS_DISPOSAL_EVENT_TYPES: readonly BusinessCapitalEventType[] = [
  "SALE",
  "BUYBACK",
];

/**
 * Périmètre du montant saisi sur un événement.
 *
 * DISTRIBUTION TOTALE DE LA SOCIÉTÉ ≠ CASH REÇU PAR L'UTILISATEUR. Un dividende de 100 k€
 * voté par une société détenue à 30 % n'apporte pas 100 k€. `COMPANY_TOTAL` autorise la
 * saisie du montant social ; la part personnelle en est alors DÉRIVÉE au prorata des droits
 * économiques à la date de l'événement, et signalée comme dérivée.
 */
export const BUSINESS_AMOUNT_SCOPES = ["USER_CASH", "COMPANY_TOTAL"] as const;
export type BusinessAmountScope = (typeof BUSINESS_AMOUNT_SCOPES)[number];

/**
 * Couverture DÉCLARÉE de l'historique de capital d'une participation.
 *
 * Même logique que la couverture du ledger portefeuille : sans déclaration, une absence
 * d'événement n'est pas un zéro. Seul `DECLARED_COMPLETE` autorise MOIC, XIRR et plus-value
 * à exister — un multiple sur un capital investi incomplet est un multiple faux et flatteur.
 */
export const BUSINESS_CAPITAL_HISTORY_SOURCES = [
  "DECLARED_COMPLETE",
  "PARTIAL",
  "UNKNOWN",
] as const;
export type BusinessCapitalHistorySource = (typeof BUSINESS_CAPITAL_HISTORY_SOURCES)[number];

export const BUSINESS_DCF_TERMINAL_METHODS = ["PERPETUAL_GROWTH", "EXIT_MULTIPLE"] as const;
export type BusinessDcfTerminalMethod = (typeof BUSINESS_DCF_TERMINAL_METHODS)[number];

export const BUSINESS_DISCOUNT_CONVENTIONS = ["YEAR_END", "MID_YEAR"] as const;
export type BusinessDiscountConvention = (typeof BUSINESS_DISCOUNT_CONVENTIONS)[number];

/**
 * Convention de libération du coût de revient lors d'une cession partielle. Le coût moyen
 * pondéré est la seule convention applicable sans lots identifiés, et elle est NOMMÉE
 * plutôt que laissée implicite : une PnL réalisée dépend entièrement d'elle.
 */
export const BUSINESS_COST_BASIS_CONVENTION = "WEIGHTED_AVERAGE" as const;

/** Âge au-delà duquel une valorisation est SIGNALÉE périmée. Jamais corrigée ni indexée. */
export const BUSINESS_VALUATION_STALE_AFTER_DAYS = 365;

// ─── Motifs de non-calcul et signalements ───────────────────────────────────────────────

/**
 * Motifs pour lesquels une grandeur reste non calculable.
 *
 * Ce sont des CODES structurés, pas des chaînes concaténées avec un identifiant technique.
 * L'utilisateur ne doit jamais lire `BUSINESS_VALUATION_MISSING:2d4c-…` : il doit lire une
 * phrase française qui nomme la société et ce qui manque. Le code porte le motif, le
 * contexte porte l'entité, et la mise en français est faite une fois, ailleurs.
 */
export type BusinessBlockerCode =
  | "VALUATION_BASIS_MISSING"
  | "VALUATION_METRIC_MISSING"
  | "VALUATION_METRIC_NOT_POSITIVE"
  | "VALUATION_MULTIPLE_MISSING"
  | "VALUATION_FINANCIAL_PERIOD_MISSING"
  | "EV_TO_EQUITY_GROSS_DEBT_MISSING"
  | "EV_TO_EQUITY_CASH_MISSING"
  | "EV_TO_EQUITY_BRIDGE_STATUS_MISSING"
  | "EV_TO_EQUITY_BRIDGE_INCOMPLETE"
  | "EQUITY_VALUE_NOT_COMPUTABLE"
  | "OWNERSHIP_MISSING"
  | "ECONOMIC_OWNERSHIP_MISSING"
  | "CURRENCY_MISSING"
  | "FX_RATE_MISSING"
  | "COST_BASIS_HISTORY_MISSING"
  | "DISTRIBUTION_HISTORY_MISSING"
  | "CAPITAL_HISTORY_NOT_DECLARED"
  | "OWNERSHIP_DELTA_MISSING"
  | "INVESTED_CAPITAL_NOT_POSITIVE"
  | "HOLDING_CYCLE"
  | "HOLDING_CHILD_NOT_COMPUTABLE"
  | "HOLDING_STANDALONE_BALANCE_MISSING"
  | "FUNDING_ROUND_TERMS_MISSING"
  | "DCF_ASSUMPTIONS_MISSING"
  | "DCF_PERIODS_MISSING"
  | "DCF_PERIOD_INPUTS_MISSING"
  | "DCF_TERMINAL_INVALID"
  | "REVENUE_MISSING"
  | "EBITDA_MISSING"
  | "EBITDA_NOT_POSITIVE"
  | "PRIOR_PERIOD_MISSING"
  | "PERIOD_KIND_NOT_COMPARABLE"
  | "XIRR_SIGNS_INVALID"
  | "XIRR_NO_SOLUTION"
  | "XIRR_MULTIPLE_SOLUTIONS"
  | "XIRR_INPUTS_INCOMPLETE"
  | "SCENARIO_INPUT_MISSING"
  | "TAX_RATE_NOT_DECLARED";

/** Signalements : la grandeur EXISTE, mais elle doit être lue avec cette réserve. */
export type BusinessFlagCode =
  | "VALUATION_STALE"
  | "VALUATION_IS_USER_INPUT"
  | "CONFLICTING_VALUATIONS"
  | "MULTIPLE_RANGE_DECLARED"
  | "EBITDA_ADJUSTED"
  | "EBITDA_NEGATIVE"
  | "PRO_FORMA_ADJUSTMENT_INCLUDED"
  | "LOOK_THROUGH_VALUATION"
  | "PREFERRED_RIGHTS_UNKNOWN"
  | "FULLY_DILUTED_UNKNOWN"
  | "SHARE_COUNTS_INCONSISTENT"
  | "CAPITAL_HISTORY_PARTIAL"
  | "DISTRIBUTION_DERIVED_PRO_RATA"
  | "DIRECT_AND_INDIRECT_OWNERSHIP"
  | "LOOK_THROUGH_OWNERSHIP_EXCEEDS_ONE"
  | "FX_STALE"
  | "FX_PNL_NOT_ISOLATED"
  | "PERIOD_KIND_MIXED"
  | "FREE_CASH_FLOW_DERIVED"
  | "TAX_RATE_NOT_DECLARED"
  | "OWNERSHIP_FULLY_EXITED";

export interface BusinessBlocker {
  code: BusinessBlockerCode;
  /** Société concernée. L'interface la résout en NOM ; elle n'affiche jamais l'identifiant. */
  businessId?: string;
  /** Précision libre déjà lisible (une date, un libellé d'ajustement, une devise). */
  detail?: string;
}

export interface BusinessFlag {
  code: BusinessFlagCode;
  businessId?: string;
  detail?: string;
}

/**
 * Grandeur dérivée. `value === null` signifie « non calculable », et `blockers` dit
 * toujours pourquoi. Un `null` sans motif serait indiscernable d'un oubli d'implémentation.
 */
export interface BusinessAmount {
  value: number | null;
  blockers: BusinessBlocker[];
  flags: BusinessFlag[];
}

const blockerKey = (item: BusinessBlocker) =>
  `${item.code}|${item.businessId ?? ""}|${item.detail ?? ""}`;
const flagKey = (item: BusinessFlag) =>
  `${item.code}|${item.businessId ?? ""}|${item.detail ?? ""}`;

export function dedupeBlockers(items: BusinessBlocker[]): BusinessBlocker[] {
  const seen = new Map<string, BusinessBlocker>();
  for (const item of items) if (!seen.has(blockerKey(item))) seen.set(blockerKey(item), item);
  return [...seen.values()];
}

export function dedupeFlags(items: BusinessFlag[]): BusinessFlag[] {
  const seen = new Map<string, BusinessFlag>();
  for (const item of items) if (!seen.has(flagKey(item))) seen.set(flagKey(item), item);
  return [...seen.values()];
}

export const known = (value: number, flags: BusinessFlag[] = []): BusinessAmount => ({
  value,
  blockers: [],
  flags: dedupeFlags(flags),
});

export const unknown = (
  blockers: BusinessBlocker[],
  flags: BusinessFlag[] = [],
): BusinessAmount => ({
  value: null,
  blockers: dedupeBlockers(blockers),
  flags: dedupeFlags(flags),
});

export const blocker = (
  code: BusinessBlockerCode,
  businessId?: string,
  detail?: string,
): BusinessBlocker => ({ code, businessId, detail });

export const flag = (
  code: BusinessFlagCode,
  businessId?: string,
  detail?: string,
): BusinessFlag => ({ code, businessId, detail });

/** Somme qui ne devient un montant que si TOUS ses termes sont connus. */
export function sumAll(parts: BusinessAmount[]): BusinessAmount {
  const blockers = dedupeBlockers(parts.flatMap((part) => part.blockers));
  const flags = dedupeFlags(parts.flatMap((part) => part.flags));
  if (parts.some((part) => part.value === null)) return { value: null, blockers, flags };
  return { value: parts.reduce((total, part) => total + (part.value ?? 0), 0), blockers, flags };
}

export function subtract(left: BusinessAmount, right: BusinessAmount): BusinessAmount {
  return sumAll([left, negate(right)]);
}

export function negate(item: BusinessAmount): BusinessAmount {
  return {
    value: item.value === null ? null : -item.value,
    blockers: item.blockers,
    flags: item.flags,
  };
}

/**
 * Produit de deux grandeurs dérivées.
 *
 * UN ZÉRO CONNU ANNULE UNE INCONNUE. Ne rien détenir d'un actif dont la valeur est inconnue
 * vaut zéro, pas « non calculable » : après une cession totale, la participation ne pèse
 * plus rien, même si plus personne ne sait ce que vaut la société. C'est la seule
 * exception à la propagation des motifs de non-calcul, et elle est arithmétique.
 */
export function multiply(left: BusinessAmount, right: BusinessAmount): BusinessAmount {
  const blockers = dedupeBlockers([...left.blockers, ...right.blockers]);
  const flags = dedupeFlags([...left.flags, ...right.flags]);
  if (left.value === 0 || right.value === 0) return { value: 0, blockers: [], flags };
  if (left.value === null || right.value === null) return { value: null, blockers, flags };
  return { value: left.value * right.value, blockers, flags };
}

/**
 * Ratio dérivé. Un dénominateur nul ou négatif ne produit ni l'infini ni zéro : il produit
 * `null`. Une marge sur un chiffre d'affaires nul, un levier sur un EBITDA négatif ou un
 * MOIC sur un capital investi nul n'existent pas.
 */
export function positiveRatio(
  numerator: BusinessAmount,
  denominator: BusinessAmount,
  onNonPositive: BusinessBlocker,
): BusinessAmount {
  const blockers = dedupeBlockers([...numerator.blockers, ...denominator.blockers]);
  const flags = dedupeFlags([...numerator.flags, ...denominator.flags]);
  if (numerator.value === null || denominator.value === null)
    return { value: null, blockers, flags };
  if (denominator.value <= 0)
    return { value: null, blockers: dedupeBlockers([...blockers, onNonPositive]), flags };
  return { value: numerator.value / denominator.value, blockers, flags };
}

export function withFlags(item: BusinessAmount, extra: BusinessFlag[]): BusinessAmount {
  return { ...item, flags: dedupeFlags([...item.flags, ...extra]) };
}

// ─── Faits canoniques ───────────────────────────────────────────────────────────────────

export interface BusinessEntity {
  id: string;
  name: string;
  legalForm: string | null;
  type: BusinessType | null;
  functionalCurrency: string | null;
  sector: string | null;
  country: string | null;
  foundedOn: string | null;
  /** Date à partir de laquelle l'historique de capital est déclaré exhaustif. */
  capitalHistoryStart: string | null;
  capitalHistorySource: BusinessCapitalHistorySource;
  archived: boolean;
  notes: string | null;
  provenance: Provenance;
}

export interface BusinessOwnership {
  id: string;
  businessId: string;
  effectiveDate: string;
  /** Détention juridique. Peut valoir 0 après une sortie totale : c'est un fait. */
  legalRate: number;
  economicRate: number | null;
  votingRate: number | null;
  fullyDilutedRate: number | null;
  sharesHeld: number | null;
  sharesOutstanding: number | null;
  fullyDilutedShares: number | null;
  shareClass: string | null;
  /** Événement de capital dont cette détention découle, quand elle en découle. */
  originEventId: string | null;
  notes: string | null;
  provenance: Provenance;
}

export interface BusinessFinancialSnapshot {
  id: string;
  businessId: string;
  periodEnd: string;
  periodStart: string | null;
  periodKind: BusinessPeriodKind;
  periodLabel: string | null;
  currency: string | null;
  revenue: number | null;
  grossProfit: number | null;
  ebitda: number | null;
  ebit: number | null;
  netIncome: number | null;
  cash: number | null;
  grossDebt: number | null;
  workingCapital: number | null;
  capex: number | null;
  depreciationAmortisation: number | null;
  interestExpense: number | null;
  taxExpense: number | null;
  freeCashFlow: number | null;
  notes: string | null;
  provenance: Provenance;
}

/**
 * Base de valorisation DÉCLARÉE. Ce n'est pas un résultat : c'est le choix de méthode et
 * les hypothèses qui l'accompagnent. `enterpriseValue` et `equityValue` ne sont renseignées
 * que sur les chemins réellement observés ou assumés comme saisie libre.
 */
export interface BusinessValuationBasis {
  id: string;
  businessId: string;
  valuationDate: string;
  currency: string | null;
  method: BusinessValuationMethod;
  enterpriseValue: number | null;
  equityValue: number | null;
  multiple: number | null;
  multipleLow: number | null;
  multipleHigh: number | null;
  metricBasis: BusinessMetricBasis | null;
  /** Période financière retenue comme base. `null` = la plus récente disponible. */
  metricPeriodEnd: string | null;
  preMoneyEquityValue: number | null;
  primaryNewMoney: number | null;
  secondaryAmount: number | null;
  investorContribution: number | null;
  preferredRightsKnown: boolean | null;
  notes: string | null;
  provenance: Provenance;
}

export interface BusinessEbitdaAdjustment {
  id: string;
  businessId: string;
  periodEnd: string;
  category: BusinessEbitdaAdjustmentCategory;
  label: string;
  /** Signé : positif augmente l'EBITDA retenu, négatif le réduit. */
  amount: number;
  currency: string;
  recurring: boolean;
  notes: string | null;
  provenance: Provenance;
}

export interface BusinessBridgeItem {
  id: string;
  businessId: string;
  effectiveDate: string;
  category: BusinessBridgeItemCategory;
  label: string;
  /** Signé : positif ajoute à l'Equity Value, négatif la réduit. */
  amount: number;
  currency: string;
  notes: string | null;
  provenance: Provenance;
}

/** Déclaration datée de la complétude des ajustements du pont EV → Equity. */
export interface BusinessBridgeDeclaration {
  id: string;
  businessId: string;
  effectiveDate: string;
  status: BusinessBridgeStatus;
  notes: string | null;
  provenance: Provenance;
}

export interface BusinessDcfPeriod {
  id: string;
  dcfId: string;
  yearIndex: number;
  revenue: number | null;
  ebitda: number | null;
  ebit: number | null;
  depreciationAmortisation: number | null;
  capex: number | null;
  workingCapitalChange: number | null;
  notes: string | null;
}

export interface BusinessDcfAssumptions {
  id: string;
  businessId: string;
  valuationDate: string;
  currency: string;
  wacc: number;
  taxRate: number;
  terminalMethod: BusinessDcfTerminalMethod;
  terminalGrowth: number | null;
  terminalExitMultiple: number | null;
  terminalExitMetric: "EBITDA" | "EBIT" | null;
  discountConvention: BusinessDiscountConvention;
  periods: BusinessDcfPeriod[];
  notes: string | null;
  provenance: Provenance;
}

export interface BusinessCapitalEvent {
  id: string;
  businessId: string;
  type: BusinessCapitalEventType;
  eventDate: string;
  /** Magnitude positive. Le SENS vient du type, jamais du signe. */
  amount: number;
  amountScope: BusinessAmountScope;
  fees: number | null;
  currency: string;
  /** Variation de détention portée par l'événement, signée. */
  ownershipDelta: number | null;
  ownershipRateAfter: number | null;
  sharesDelta: number | null;
  pricePerShare: number | null;
  label: string | null;
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

// ─── Sélection datée et conversion ──────────────────────────────────────────────────────

/**
 * Le fait applicable à une date est le plus récent qui ne lui est pas POSTÉRIEUR. Une
 * valorisation saisie pour le mois prochain ne vaut rien aujourd'hui.
 */
export function latestAtOrBefore<T>(
  items: T[],
  date: string,
  dateOf: (item: T) => string,
): T | null {
  return (
    items
      .filter((item) => dateOf(item) <= date)
      .sort((left, right) => dateOf(left).localeCompare(dateOf(right)))
      .at(-1) ?? null
  );
}

/**
 * Valorisations applicables à une date : celles portant la date la plus récente connue.
 * Plusieurs peuvent coexister — un appraisal et une transaction, par exemple. Elles sont
 * rendues par ordre de préséance documenté ; le conflit n'est pas masqué, il est signalé.
 */
export function valuationsAtOrBefore(
  bases: BusinessValuationBasis[],
  date: string,
): BusinessValuationBasis[] {
  const eligible = bases.filter((item) => item.valuationDate <= date);
  if (eligible.length === 0) return [];
  const latestDate = eligible
    .map((item) => item.valuationDate)
    .sort((left, right) => left.localeCompare(right))
    .at(-1)!;
  return eligible
    .filter((item) => item.valuationDate === latestDate)
    .sort((left, right) => METHOD_PRECEDENCE[left.method] - METHOD_PRECEDENCE[right.method]);
}

export function daysBetween(earlier: string, later: string): number {
  return Math.floor(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000,
  );
}

export interface BusinessConversion {
  amount: BusinessAmount;
  fx: FxResolution | null;
}

/**
 * Conversion d'un montant natif vers la devise de reporting, à la date du fait converti.
 *
 * FX ABSENT ≠ FX ÉGAL À 1. Un taux introuvable rend la grandeur non calculable ; un taux
 * ancien reste utilisable mais signalé. La devise elle-même peut manquer : un montant sans
 * devise n'est pas convertible, et ne vaut pas « des euros par défaut ».
 */
export function convertFact(
  nativeValue: number | null,
  currency: string | null,
  valueDate: string,
  reportingCurrency: string,
  rates: CurrencyRate[],
  missing: BusinessBlocker,
  businessId?: string,
): BusinessConversion {
  if (nativeValue === null) return { amount: unknown([missing]), fx: null };
  if (!currency) return { amount: unknown([blocker("CURRENCY_MISSING", businessId)]), fx: null };
  const fx = resolveFxRate(currency, reportingCurrency, valueDate, rates);
  if (fx.rate === null)
    return {
      amount: unknown([
        blocker("FX_RATE_MISSING", businessId, `${currency}→${reportingCurrency} au ${valueDate}`),
      ]),
      fx,
    };
  const flags =
    fx.status === "STALE"
      ? [
          flag(
            "FX_STALE",
            businessId,
            `${currency}→${reportingCurrency} au ${fx.rateDate ?? valueDate}`,
          ),
        ]
      : [];
  return { amount: known(nativeValue * fx.rate, flags), fx };
}

/** Devise applicable à un fait : la sienne, sinon la devise fonctionnelle de la société. */
export function factCurrency(
  rowCurrency: string | null,
  business: Pick<BusinessEntity, "functionalCurrency">,
): string | null {
  return rowCurrency ?? business.functionalCurrency ?? null;
}

export interface BusinessQuality {
  blockers: BusinessBlocker[];
  flags: BusinessFlag[];
}

export function mergeQuality(...parts: Array<BusinessQuality | BusinessAmount>): BusinessQuality {
  return {
    blockers: dedupeBlockers(parts.flatMap((part) => part.blockers)),
    flags: dedupeFlags(parts.flatMap((part) => part.flags)),
  };
}

/** Provenance dérivée standard du domaine, pour une grandeur produite par le moteur. */
export function derivedProvenance(effectiveDate: string, confidence: Confidence): Provenance {
  return {
    kind: "DERIVED" as DataKind,
    confidence,
    effectiveDate,
    source: "Business Equity Engine",
  };
}
