import type {
  AggregateStatus,
  CanonicalAggregate,
  CanonicalBalanceSheetContribution,
  ValuationMethod,
  ValuationStatus,
} from "@/lib/engine/balance-sheet";
import { computeObservedCashFlow, completeMonthsPeriod } from "@/lib/engine/cash-flow";
import type { ObservedCashFlow } from "@/lib/engine/cash-flow";
import {
  buildLoanTimeline,
  debtServiceBreakdownForPeriod,
  outstandingBalanceAt,
} from "@/lib/engine/debt";
import type { DebtServiceBreakdown, LoanScheduleFlag } from "@/lib/engine/debt";
import { convertWithFx, resolveFxRate } from "@/lib/engine/fx";
import type { CurrencyRate, FxResolution } from "@/lib/engine/fx";
import type {
  DataKind,
  ExpenseCategory,
  Liability,
  RealEstateAsset,
  RealEstateCapitalEvent,
  RealEstateFinancingLink,
  RealEstateOperatingTerms,
  RealEstateUsage,
  RealEstateValuation,
  RealEstateValuationMethod,
  Transaction,
} from "@/lib/types";

/**
 * REAL ESTATE ENGINE V2
 *
 * L'immobilier est ici une COUCHE DE LECTURE d'une vérité qu'il ne détient pas seul. Il
 * ne possède qu'une chose : le bien, ce qu'il vaut, ce qu'il a coûté et ce qu'il rapporte.
 * Tout le reste appartient à un autre domaine et est CONSOMMÉ, jamais recalculé.
 *
 * SIX RÈGLES FONDATRICES
 * ----------------------
 * RÈGLE 1 — Aucune seconde vérité de dette. Ce moteur n'amortit rien. Pas une ligne
 * d'échéancier n'est construite ici : chaque grandeur de financement vient de
 * `buildLoanTimeline` et de `debtImpactFromEntries`, les mêmes fonctions que le Debt
 * Engine sert au reste du produit. Un prêt immobilier n'est pas un objet immobilier :
 * c'est une `Liability`, à laquelle le bien est RATTACHÉ par une quote-part.
 *
 * RÈGLE 2 — Aucune dette comptée deux fois. Le rattachement n'ajoute aucun passif au
 * bilan : le passif y entre par `liabilities` et par lui seul. La quote-part sert
 * uniquement à ATTRIBUER une part d'un encours déjà porté par le bilan. Si les
 * quote-parts d'un même concours dépassent 1, le moteur le signale et refuse d'en dériver
 * l'equity plutôt que de surévaluer le patrimoine immobilier.
 *
 * RÈGLE 3 — Aucune seconde vérité de trésorerie. Les flux réels d'un bien sont les
 * transactions que l'utilisateur y a RATTACHÉES, classées par le Cash Flow Engine
 * lui-même : `computeObservedCashFlow` est appelé tel quel sur le sous-ensemble rattaché.
 * Le domaine immobilier ne reclasse rien et ne crée aucun flux.
 *
 * RÈGLE 4 — Une valorisation n'est pas un prix d'achat, et un prix d'achat n'est pas une
 * charge. VALEUR DE MARCHÉ ≠ COÛT DE REVIENT ≠ CHARGE D'EXPLOITATION : trois grandeurs,
 * trois emplacements, jamais additionnées entre elles.
 *
 * RÈGLE 5 — Un terme non déclaré n'est pas un terme nul. Un rendement net calculé en
 * traitant une charge inconnue comme nulle est un rendement faux et flatteur. Toute
 * grandeur qui dépend d'un terme manquant vaut `null` et dit lequel manque.
 *
 * RÈGLE 6 — Aucune fiscalité inventée. LFO ne porte aucune règle fiscale immobilière
 * fiable. Un résultat après impôt n'existe que si l'utilisateur a DÉCLARÉ un taux effectif,
 * et l'assiette à laquelle ce taux s'applique est nommée dans le résultat plutôt que
 * laissée implicite.
 *
 * DEVISES
 * -------
 * Chaque fait porte sa devise. Les analytiques d'un bien sont calculées en devise de
 * REPORTING : c'est le seul terrain commun entre un bien en CHF et un prêt en EUR, et
 * c'est celui du bilan. Chaque conversion passe par le FX Engine, à la date du fait
 * converti. Un taux absent rend la grandeur dépendante non calculable ; il ne vaut jamais 1.
 *
 * La ligne de bilan, elle, est émise en devise NATIVE : c'est le Canonical Balance Sheet
 * qui convertit, une seule fois, avec sa propre traçabilité. Aucune double conversion.
 */

/**
 * Âge au-delà duquel une valorisation immobilière est SIGNALÉE périmée. Convention de
 * signalement, jamais d'entrée de calcul : une valorisation ancienne reste utilisée telle
 * quelle, elle n'est ni indexée ni corrigée. Un an correspond au rythme usuel de
 * réestimation d'un bien ; la valeur est déclarée ici pour qu'elle soit discutable.
 */
export const REAL_ESTATE_VALUATION_STALE_AFTER_DAYS = 365;

/** Tolérance des contrôles de quote-part, en part d'unité. */
export const ALLOCATION_TOLERANCE = 1e-8;

const MONETARY_TOLERANCE = 0.01;

export type RealEstateFlagCode =
  | "VALUATION_MISSING"
  | "VALUATION_STALE"
  | "OWNERSHIP_SHARE_MISSING"
  | "ACQUISITION_PRICE_MISSING"
  | "ACQUISITION_COSTS_NOT_DECLARED"
  | "OPERATING_TERMS_MISSING"
  | "OPERATING_TERM_UNDECLARED"
  | "VACANCY_RATE_MISSING"
  | "RENT_DECLARED_ON_NON_RENTAL"
  | "USAGE_UNDECLARED"
  | "DEBT_OVER_ALLOCATED"
  | "DEBT_FREE_DECLARED"
  | "DEBT_DECLARED_NOT_LINKED"
  | "FINANCING_UNDECLARED"
  | "FINANCING_DECLARATION_CONTRADICTED"
  | "FINANCING_ORIGINATION_DATE_UNKNOWN"
  | "FINANCING_LINK_ORPHAN"
  | "CURRENCY_MIXED"
  | "FX_MISSING"
  | "FX_STALE"
  | "FX_PNL_NOT_ISOLATED"
  | "TAX_RATE_UNDECLARED"
  | "DISPOSED"
  | "EQUITY_ENGAGED_NOT_POSITIVE"
  | "OBSERVED_LEDGER_NOT_COVERED"
  | "OBSERVED_INCOME_NOT_RENT_QUALIFIED";

export interface RealEstateFlag {
  code: RealEstateFlagCode;
  detail: string;
}

/**
 * État du financement d'un bien. Trois situations, jamais deux.
 *
 * `DECLARED_NONE` est la SEULE qui autorise un zéro : l'utilisateur a déclaré que le bien
 * n'est financé par aucune dette. `UNKNOWN` couvre les deux cas où le moteur ne sait pas,
 * et il refuse alors de trancher : ni concours rattaché ni déclaration, ou bien une dette
 * déclarée mais pas encore rattachée.
 */
export type RealEstateFinancingState = "LINKED" | "DECLARED_NONE" | "UNKNOWN";

/**
 * Grandeur monétaire dérivée. `value === null` signifie « non calculable », et `blockers`
 * dit toujours pourquoi : un `null` sans motif serait indiscernable d'un oubli.
 */
export interface DerivedAmount {
  value: number | null;
  blockers: string[];
}

const known = (value: number): DerivedAmount => ({ value, blockers: [] });
const unknown = (...blockers: string[]): DerivedAmount => ({ value: null, blockers });

/** Somme qui ne devient un montant que si TOUS ses termes sont connus. */
function sumAll(parts: DerivedAmount[]): DerivedAmount {
  const blockers = [...new Set(parts.flatMap((part) => part.blockers))];
  if (parts.some((part) => part.value === null)) return { value: null, blockers };
  return { value: parts.reduce((total, part) => total + (part.value ?? 0), 0), blockers };
}

function subtract(left: DerivedAmount, right: DerivedAmount): DerivedAmount {
  const blockers = [...new Set([...left.blockers, ...right.blockers])];
  if (left.value === null || right.value === null) return { value: null, blockers };
  return { value: left.value - right.value, blockers };
}

/**
 * Ratio d'un numérateur sur un dénominateur, tous deux dérivés. Un dénominateur nul ou
 * négatif ne produit pas l'infini ni zéro : il produit `null`. Un rendement sur une base
 * nulle n'existe pas.
 */
function ratio(
  numerator: DerivedAmount,
  denominator: DerivedAmount,
  blocker: string,
): DerivedAmount {
  const blockers = [...new Set([...numerator.blockers, ...denominator.blockers])];
  if (numerator.value === null || denominator.value === null) return { value: null, blockers };
  if (denominator.value <= 0)
    return { value: null, blockers: [...new Set([...blockers, blocker])] };
  return { value: numerator.value / denominator.value, blockers };
}

/** Conversion d'un fait natif vers la devise de reporting, traçée. */
interface Converted {
  amount: DerivedAmount;
  fx: FxResolution;
}

function convert(
  nativeValue: number,
  currency: string,
  valueDate: string,
  reportingCurrency: string,
  rates: CurrencyRate[],
): Converted {
  const fx = resolveFxRate(currency, reportingCurrency, valueDate, rates);
  const converted = convertWithFx(nativeValue, fx);
  return {
    amount:
      converted === null
        ? unknown(`FX_MISSING:${currency}/${reportingCurrency}@${valueDate}`)
        : known(converted),
    fx,
  };
}

// ─── Sélection des faits datés ────────────────────────────────────────────────────────

/**
 * Le fait applicable à une date est le plus récent qui ne lui est pas POSTÉRIEUR. Une
 * valorisation saisie pour le mois prochain ne vaut rien aujourd'hui, et une déclaration
 * de termes à effet futur ne s'applique pas encore.
 */
function latestAtOrBefore<T>(items: T[], date: string, dateOf: (item: T) => string): T | null {
  return (
    items
      .filter((item) => dateOf(item) <= date)
      .sort((left, right) => dateOf(left).localeCompare(dateOf(right)))
      .at(-1) ?? null
  );
}

function daysBetween(earlier: string, later: string): number {
  return Math.floor(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000,
  );
}

const VALUATION_METHOD_MAP: Record<RealEstateValuationMethod, ValuationMethod> = {
  MARKET_APPRAISAL: "EXTERNAL_VALUATION",
  NOTARY_ESTIMATE: "EXTERNAL_VALUATION",
  AGENT_ESTIMATE: "EXTERNAL_VALUATION",
  INDEX_ADJUSTED: "MODEL_ESTIMATE",
  USER_ESTIMATE: "USER_ESTIMATE",
  PURCHASE_PRICE: "PURCHASE_PRICE",
};

/** Usages qui produisent un loyer. Un rendement locatif n'a de sens que sur ceux-là. */
const RENT_BEARING_USAGES = new Set<RealEstateUsage>(["RENTAL", "MIXED_USE"]);

// ─── Vue d'un bien ────────────────────────────────────────────────────────────────────

/** Valorisation retenue à la date de lecture, et ce qu'elle vaut vraiment. */
export interface RealEstateValuationView {
  /** L'observation retenue. `null` quand aucune n'existe à cette date ou avant. */
  observation: RealEstateValuation | null;
  status: ValuationStatus;
  ageDays: number | null;
  /** Valeur du bien ENTIER, devise native de l'observation. */
  grossNativeValue: number | null;
  nativeCurrency: string | null;
  /** Valeur du bien entier, devise de reporting. */
  grossValue: DerivedAmount;
  /** Part attribuable au patrimoine du dossier : valeur entière × quote-part détenue. */
  ownerValue: DerivedAmount;
  /** Idem, en devise native : c'est CE montant qui alimente la ligne de bilan. */
  ownerNativeValue: number | null;
  fx: FxResolution | null;
}

/**
 * Base de coût du bien. On y trouve ce qui a été PAYÉ pour l'acquérir et l'améliorer,
 * jamais ce qu'il coûte à exploiter. Toutes les grandeurs portent sur le bien ENTIER.
 */
export interface RealEstateCostBasisView {
  acquisitionPrice: DerivedAmount;
  /** Σ des frais d'acquisition DÉCLARÉS. Le compte d'événements dit s'il y en a. */
  acquisitionCosts: DerivedAmount;
  acquisitionCostEventCount: number;
  /** Σ des travaux capitalisés déclarés. L'entretien courant n'est pas ici. */
  capex: DerivedAmount;
  capexEventCount: number;
  /** Prix + frais + travaux. Le coût de revient économique du bien entier. */
  totalCostBasis: DerivedAmount;
  /** Part du coût de revient revenant au dossier : coût entier × quote-part. */
  ownerCostBasis: DerivedAmount;
  disposalPrice: DerivedAmount;
  disposalCosts: DerivedAmount;
}

/** Une dette rattachée, avec la part qui revient au bien. Aucun passif n'est créé ici. */
export interface RealEstateFinancingLineView {
  link: RealEstateFinancingLink;
  liability: Liability;
  allocationShare: number;
  /** Encours observé du concours ENTIER, devise de reporting. */
  outstandingWhole: DerivedAmount;
  /** Part de cet encours attribuée au bien. N'ajoute rien au bilan : elle en découpe. */
  attributedOutstanding: DerivedAmount;
  /** Capital emprunté à l'origine, part attribuée. Sert à mesurer l'apport réel. */
  attributedOriginalPrincipal: DerivedAmount;
  /** Conséquences canoniques du Debt Engine sur 12 mois, mises à la quote-part. */
  attributedDebtService12m: RealEstateDebtConsequences;
  debtFlags: LoanScheduleFlag[];
}

/**
 * Conséquences canoniques du financement, telles que le Debt Engine les produit, puis
 * mises à la quote-part du bien. Aucune de ces grandeurs n'est recalculée ici : elles
 * sortent de `debtServiceBreakdownForPeriod`.
 *
 * PRINCIPAL ≠ CHARGE : `principalPaid` est une sortie de trésorerie neutre sur le
 * patrimoine net, `economicCost` est le vrai coût du crédit. Les deux ne se confondent
 * jamais et ne s'additionnent jamais dans un « coût du financement ».
 */
export interface RealEstateDebtConsequences {
  cashDebtService: DerivedAmount;
  principalPaid: DerivedAmount;
  interestPaid: DerivedAmount;
  capitalisedInterest: DerivedAmount;
  insurancePaid: DerivedAmount;
  feesPaid: DerivedAmount;
  /** Intérêts + assurance + frais, décaissés ou capitalisés. Jamais le principal. */
  economicCost: DerivedAmount;
  dataKind: DataKind;
}

const EMPTY_DEBT_CONSEQUENCES: RealEstateDebtConsequences = {
  cashDebtService: known(0),
  principalPaid: known(0),
  interestPaid: known(0),
  capitalisedInterest: known(0),
  insurancePaid: known(0),
  feesPaid: known(0),
  economicCost: known(0),
  dataKind: "DERIVED",
};

/** Assiette conventionnelle à laquelle le taux DÉCLARÉ par l'utilisateur s'applique. */
export const REAL_ESTATE_TAX_BASE_CONVENTION = "NOI_ATTRIBUE_MOINS_INTERETS_ATTRIBUES" as const;

/**
 * Compte d'exploitation annuel du bien, dérivé des termes DÉCLARÉS.
 *
 * Toutes les grandeurs « whole » portent sur le bien entier, toutes les grandeurs
 * « attributed » sur la part du dossier. Le loyer et les charges d'un bien détenu à 50 %
 * ne sont pas ceux du propriétaire : les mélanger produirait un rendement faux.
 */
export interface RealEstateOperatingView {
  terms: RealEstateOperatingTerms | null;
  /** Loyer contractuel brut annuel, bien entier. */
  grossRent: DerivedAmount;
  /** Loyer après vacance déclarée. Une vacance non déclarée le rend non calculable. */
  effectiveRent: DerivedAmount;
  /** Σ des charges d'exploitation. Un terme non déclaré la rend non calculable. */
  operatingCosts: DerivedAmount;
  /** Détail par poste, pour dire précisément ce qui manque. */
  costBreakdown: Array<{ label: string; amount: DerivedAmount }>;
  /** Loyer effectif − charges. Résultat d'exploitation avant tout financement. */
  netOperatingIncome: DerivedAmount;
  /** NOI mis à la quote-part détenue. */
  attributedNetOperatingIncome: DerivedAmount;
  /** Termes déclarés mais qui n'ont pas de sens pour l'usage du bien. */
  undeclaredTerms: string[];
}

/** Rendements et rentabilités. Chaque dénominateur est NOMMÉ, jamais implicite. */
export interface RealEstateReturnsView {
  /** Loyer brut ÷ valeur de marché du bien entier. */
  grossYieldOnValue: DerivedAmount;
  /** Loyer brut ÷ coût de revient total du bien entier. */
  grossYieldOnCost: DerivedAmount;
  /** NOI ÷ valeur de marché du bien entier. */
  netYieldOnValue: DerivedAmount;
  /** NOI ÷ coût de revient total du bien entier. */
  netYieldOnCost: DerivedAmount;
  /**
   * Trésorerie du dossier sur 12 mois : NOI attribué − service de dette attribué. C'est un
   * FLUX, pas une création de patrimoine : il inclut du remboursement de principal, qui
   * est neutre sur le patrimoine net.
   */
  preTaxCashFlow: DerivedAmount;
  /**
   * Impôt dérivé du seul taux effectif DÉCLARÉ, appliqué à
   * `REAL_ESTATE_TAX_BASE_CONVENTION`. `null` tant qu'aucun taux n'est déclaré : LFO
   * n'invente aucune règle fiscale immobilière.
   */
  declaredTax: DerivedAmount;
  taxBase: DerivedAmount;
  taxBaseConvention: typeof REAL_ESTATE_TAX_BASE_CONVENTION;
  afterTaxCashFlow: DerivedAmount;
  /**
   * Trésorerie réellement sortie de la poche à l'acquisition : coût de revient attribué −
   * capital emprunté attribué. Un coût financé par le crédit n'est pas un apport.
   */
  equityEngaged: DerivedAmount;
  /** Cash flow avant impôt ÷ apport réel. Rendement de la trésorerie engagée. */
  cashOnCashOnEquityEngaged: DerivedAmount;
  /**
   * (NOI attribué − coût économique du financement) ÷ equity ACTUELLE dans le bien.
   * Rentabilité économique des fonds propres immobilisés aujourd'hui : ni le principal
   * remboursé ni la variation de valeur n'y entrent, car ce ne sont pas des rendements.
   */
  economicReturnOnCurrentEquity: DerivedAmount;
  /** NOI attribué ÷ service de dette attribué. `null` sans dette rattachée. */
  debtServiceCoverage: DerivedAmount;
  /** Encours attribué ÷ valeur attribuée du bien. */
  loanToValue: DerivedAmount;
}

/** Position patrimoniale du bien : ce qu'il pèse, ce qu'il doit, ce qu'il a gagné. */
export interface RealEstateEquityView {
  /** Valeur attribuée − encours attribué. Equity dans le bien, devise de reporting. */
  currentEquity: DerivedAmount;
  attributedOutstandingDebt: DerivedAmount;
  attributedOriginalPrincipal: DerivedAmount;
  /**
   * Valeur attribuée − coût de revient attribué. Plus-value LATENTE : elle n'a produit
   * aucune trésorerie et ne devient réalisée qu'à la cession.
   */
  unrealisedGain: DerivedAmount;
  /** (Prix de cession − frais de cession) attribué − coût de revient attribué. */
  realisedGain: DerivedAmount;
}

export interface RealEstateAssetView {
  asset: RealEstateAsset;
  usage: RealEstateUsage | null;
  /** Cédé ou archivé : il ne pèse plus au bilan, ses faits restent lisibles. */
  isOnBalanceSheet: boolean;
  disposedAt: string | null;
  /** Devise dans laquelle les faits du bien sont exprimés. `null` si elles divergent. */
  factCurrency: string | null;
  valuation: RealEstateValuationView;
  costBasis: RealEstateCostBasisView;
  financing: RealEstateFinancingLineView[];
  /** D'où vient — ou ne vient pas — la dette attribuée. Voir `RealEstateFinancingState`. */
  financingState: RealEstateFinancingState;
  debt: RealEstateDebtConsequences;
  operating: RealEstateOperatingView;
  returns: RealEstateReturnsView;
  equity: RealEstateEquityView;
  /** Flux RÉELS rattachés au bien, classés par le Cash Flow Engine lui-même. */
  observed: RealEstateObservedView;
  flags: RealEstateFlag[];
}

/**
 * Flux réels du bien. Ils ne remplacent pas les termes déclarés et ne les corrigent pas :
 * ils permettent de comparer ce qui était prévu à ce qui s'est passé. OBSERVED ≠
 * CONTRACTUAL, et le produit affiche les deux plutôt que d'en choisir un.
 */
export interface RealEstateObservedView {
  periodStart: string;
  periodEnd: string;
  /** Rendu tel quel par `computeObservedCashFlow`. Aucun agrégat recalculé ici. */
  cashFlow: ObservedCashFlow | null;
  transactionCount: number;
  /**
   * Σ des flux classés `INCOME` rattachés au bien sur la fenêtre.
   *
   * Ce n'est PAS « le loyer observé ». LFO ne porte aucune nature de revenu locatif : un
   * flux rattaché à un bien et classé en revenu peut être un loyer, mais aussi une
   * indemnité d'assurance, une régularisation de charges, une subvention ou un
   * remboursement. Le moteur additionne ce qu'il sait classer et refuse de le requalifier.
   */
  observedIncome: DerivedAmount;
  /**
   * Loyer effectif DÉCLARÉ − revenus OBSERVÉS rattachés.
   *
   * Écart entre deux grandeurs de NATURE DIFFÉRENTE, et c'est volontaire : il sert à
   * repérer un décrochage à examiner, pas à mesurer un manque de loyer. Un écart non nul
   * peut venir d'une vacance réelle, d'un impayé, d'un revenu non locatif encaissé, ou
   * d'un rattachement incomplet. Le drapeau `OBSERVED_INCOME_NOT_RENT_QUALIFIED` le
   * rappelle partout où cette valeur est lue.
   */
  declaredRentVsObservedIncome: DerivedAmount;
}

export interface RealEstatePortfolio {
  asOfDate: string;
  reportingCurrency: string;
  assets: RealEstateAssetView[];
  /** Valeur attribuée de l'ensemble des biens au bilan. */
  grossValue: CanonicalAggregate;
  attributedDebt: CanonicalAggregate;
  equity: CanonicalAggregate;
  unrealisedGain: CanonicalAggregate;
  annualNetOperatingIncome: CanonicalAggregate;
  annualPreTaxCashFlow: CanonicalAggregate;
  annualEconomicFinancingCost: CanonicalAggregate;
  /** Codes de qualité de l'ensemble du domaine, dédupliqués. */
  flags: RealEstateFlag[];
  quality: { status: AggregateStatus; blockers: string[] };
}

// ─── Construction ─────────────────────────────────────────────────────────────────────

export interface BuildRealEstateInput {
  asOfDate: string;
  reportingCurrency: string;
  assets: RealEstateAsset[];
  valuations: RealEstateValuation[];
  capitalEvents: RealEstateCapitalEvent[];
  operatingTerms: RealEstateOperatingTerms[];
  financingLinks: RealEstateFinancingLink[];
  /** Vérité unique de la dette. Le domaine immobilier la lit, il ne la reconstruit pas. */
  liabilities: Liability[];
  /** Vérité unique de la trésorerie. Seules les lignes rattachées sont lues. */
  transactions?: Transaction[];
  expenseCategories?: ExpenseCategory[];
  /** Profondeur déclarée du ledger bancaire. `null` = inconnue, jamais « depuis toujours ». */
  ledgerCoverageStart?: string | null;
  currencyRates?: CurrencyRate[];
}

/** Somme des quote-parts affectées à chaque concours, tous biens confondus. */
function allocationByLiability(links: RealEstateFinancingLink[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const link of links) {
    totals.set(link.liabilityId, (totals.get(link.liabilityId) ?? 0) + link.allocationShare);
  }
  return totals;
}

/** Met une conséquence de dette à la quote-part. Une part de 1 laisse tout inchangé. */
function scaleDebtConsequences(
  breakdown: DebtServiceBreakdown,
  share: number,
): RealEstateDebtConsequences {
  return {
    cashDebtService: known(breakdown.totalCashOut * share),
    principalPaid: known(breakdown.principal * share),
    interestPaid: known(breakdown.interest * share),
    capitalisedInterest: known(breakdown.capitalisedInterest * share),
    insurancePaid: known(breakdown.insurance * share),
    feesPaid: known((breakdown.fees + breakdown.capitalisedCharges) * share),
    economicCost: known(breakdown.economicCost * share),
    dataKind: breakdown.kind,
  };
}

function addDebtConsequences(parts: RealEstateDebtConsequences[]): RealEstateDebtConsequences {
  if (!parts.length) return EMPTY_DEBT_CONSEQUENCES;
  const kinds = parts.map((part) => part.dataKind);
  return {
    cashDebtService: sumAll(parts.map((part) => part.cashDebtService)),
    principalPaid: sumAll(parts.map((part) => part.principalPaid)),
    interestPaid: sumAll(parts.map((part) => part.interestPaid)),
    capitalisedInterest: sumAll(parts.map((part) => part.capitalisedInterest)),
    insurancePaid: sumAll(parts.map((part) => part.insurancePaid)),
    feesPaid: sumAll(parts.map((part) => part.feesPaid)),
    economicCost: sumAll(parts.map((part) => part.economicCost)),
    // La qualité retenue est la moins bonne : une projection modélisée contamine
    // l'ensemble de la période, elle ne se laisse pas diluer par des lignes ACTUAL.
    dataKind: kinds.includes("MISSING")
      ? "MISSING"
      : kinds.includes("MODEL_ASSUMPTION")
        ? "MODEL_ASSUMPTION"
        : kinds.includes("USER_ASSUMPTION")
          ? "USER_ASSUMPTION"
          : kinds.every((kind) => kind === "ACTUAL")
            ? "ACTUAL"
            : "DERIVED",
  };
}

/** Σ d'événements de capital d'un type, convertis chacun à SA date. */
function sumCapitalEvents(
  events: RealEstateCapitalEvent[],
  type: RealEstateCapitalEvent["type"],
  reportingCurrency: string,
  rates: CurrencyRate[],
): { amount: DerivedAmount; count: number } {
  const matching = events.filter((event) => event.type === type);
  if (!matching.length) return { amount: known(0), count: 0 };
  const parts = matching.map(
    (event) =>
      convert(event.amount, event.currency, event.eventDate, reportingCurrency, rates).amount,
  );
  return { amount: sumAll(parts), count: matching.length };
}

function aggregateOf(values: DerivedAmount[]): CanonicalAggregate {
  const knownParts = values.filter((value) => value.value !== null);
  const knownValue = knownParts.reduce((total, value) => total + (value.value ?? 0), 0);
  const blockers = [...new Set(values.flatMap((value) => value.blockers))];
  if (knownParts.length === values.length)
    return { value: knownValue, knownValue, status: "COMPLETE", coverage: 1, blockers: [] };
  if (knownParts.length === 0)
    return { value: null, knownValue: 0, status: "NOT_COMPUTABLE", coverage: 0, blockers };
  return {
    value: null,
    knownValue,
    status: "PARTIAL",
    coverage: knownParts.length / values.length,
    blockers,
  };
}

/**
 * Lecture complète du domaine immobilier à une date.
 *
 * Fonction PURE : aucun accès base, aucune date système, aucune écriture. Elle ne connaît
 * du financement que ce que le Debt Engine lui répond, et de la trésorerie que ce que le
 * Cash Flow Engine lui classe.
 */
export function buildRealEstatePortfolio(input: BuildRealEstateInput): RealEstatePortfolio {
  const rates = input.currencyRates ?? [];
  const transactions = input.transactions ?? [];
  const categories = input.expenseCategories ?? [];
  const liabilityIndex = new Map(input.liabilities.map((liability) => [liability.id, liability]));
  const allocated = allocationByLiability(input.financingLinks);
  const { start: observedStart, end: observedEnd } = completeMonthsPeriod(input.asOfDate, 12);

  const assets = input.assets.map((asset): RealEstateAssetView => {
    const flags: RealEstateFlag[] = [];
    const share = asset.ownershipShare;
    if (share === null) {
      flags.push({
        code: "OWNERSHIP_SHARE_MISSING",
        detail:
          "Quote-part détenue non déclarée : la valeur attribuable au patrimoine reste non calculable. Elle n'est jamais supposée entière.",
      });
    }
    if (asset.usage === null) {
      flags.push({
        code: "USAGE_UNDECLARED",
        detail:
          "Usage non déclaré : la lecture locative n'est ni appliquée ni écartée, aucun rendement n'est présumé.",
      });
    }

    const disposedAt =
      asset.disposalDate !== null && asset.disposalDate <= input.asOfDate
        ? asset.disposalDate
        : null;
    if (disposedAt !== null) {
      flags.push({
        code: "DISPOSED",
        detail: `Bien cédé le ${disposedAt} : il ne pèse plus au bilan, ses faits restent lisibles.`,
      });
    }
    const isOnBalanceSheet = !asset.archived && disposedAt === null;

    // ── Valorisation ────────────────────────────────────────────────────────────────
    const assetValuations = input.valuations.filter((item) => item.propertyId === asset.id);
    const observation = latestAtOrBefore(assetValuations, input.asOfDate, (item) => item.valuedAt);
    const ageDays = observation === null ? null : daysBetween(observation.valuedAt, input.asOfDate);
    const valuationStatus: ValuationStatus =
      observation === null
        ? "MISSING"
        : (ageDays ?? 0) > REAL_ESTATE_VALUATION_STALE_AFTER_DAYS
          ? "STALE"
          : "CURRENT";
    if (observation === null) {
      flags.push({
        code: "VALUATION_MISSING",
        detail:
          "Aucune valorisation à cette date ou avant : le bien est détenu, sa valeur est inconnue. Ce n'est pas une valeur nulle.",
      });
    } else if (valuationStatus === "STALE") {
      flags.push({
        code: "VALUATION_STALE",
        detail: `Valorisation du ${observation.valuedAt}, âgée de ${ageDays} jours. Utilisée telle quelle : le moteur ne l'indexe pas.`,
      });
    }
    const valuationConverted =
      observation === null
        ? null
        : convert(
            observation.value,
            observation.currency,
            observation.valuedAt,
            input.reportingCurrency,
            rates,
          );
    if (valuationConverted?.fx.status === "STALE") {
      flags.push({
        code: "FX_STALE",
        detail: `Taux ${observation?.currency}/${input.reportingCurrency} du ${valuationConverted.fx.rateDate} appliqué à la valorisation du ${observation?.valuedAt}.`,
      });
    }
    if (valuationConverted?.fx.status === "MISSING") {
      flags.push({
        code: "FX_MISSING",
        detail: `Aucun taux ${observation?.currency}/${input.reportingCurrency} au ${observation?.valuedAt} : la valeur en devise de reporting est non calculable.`,
      });
    }
    const grossValue = valuationConverted?.amount ?? unknown(`VALUATION_MISSING:${asset.id}`);
    const applyShare = (amount: DerivedAmount): DerivedAmount => {
      if (share === null)
        return {
          value: null,
          blockers: [...new Set([...amount.blockers, `OWNERSHIP_SHARE_MISSING:${asset.id}`])],
        };
      return amount.value === null
        ? amount
        : { value: amount.value * share, blockers: amount.blockers };
    };
    const valuation: RealEstateValuationView = {
      observation,
      status: valuationStatus,
      ageDays,
      grossNativeValue: observation?.value ?? null,
      nativeCurrency: observation?.currency ?? null,
      grossValue,
      ownerValue: applyShare(grossValue),
      ownerNativeValue: observation === null || share === null ? null : observation.value * share,
      fx: valuationConverted?.fx ?? null,
    };

    // ── Base de coût ────────────────────────────────────────────────────────────────
    const assetEvents = input.capitalEvents.filter((event) => event.propertyId === asset.id);
    const acquisitionPriceEvent = assetEvents.find((event) => event.type === "ACQUISITION_PRICE");
    const acquisitionPrice =
      acquisitionPriceEvent === undefined
        ? unknown(`ACQUISITION_PRICE_MISSING:${asset.id}`)
        : convert(
            acquisitionPriceEvent.amount,
            acquisitionPriceEvent.currency,
            acquisitionPriceEvent.eventDate,
            input.reportingCurrency,
            rates,
          ).amount;
    if (acquisitionPriceEvent === undefined) {
      flags.push({
        code: "ACQUISITION_PRICE_MISSING",
        detail:
          "Prix d'achat non enregistré : coût de revient, plus-value latente et apport réel restent non calculables.",
      });
    }
    const acquisitionCosts = sumCapitalEvents(
      assetEvents,
      "ACQUISITION_COST",
      input.reportingCurrency,
      rates,
    );
    if (acquisitionPriceEvent !== undefined && acquisitionCosts.count === 0) {
      flags.push({
        code: "ACQUISITION_COSTS_NOT_DECLARED",
        detail:
          "Aucun frais d'acquisition déclaré. Le coût de revient retenu est donc le seul prix d'achat, et il est probablement sous-estimé.",
      });
    }
    const capex = sumCapitalEvents(assetEvents, "CAPEX", input.reportingCurrency, rates);
    const disposalPriceEvent = assetEvents.find((event) => event.type === "DISPOSAL_PRICE");
    const disposalPrice =
      disposalPriceEvent === undefined
        ? unknown(`DISPOSAL_PRICE_MISSING:${asset.id}`)
        : convert(
            disposalPriceEvent.amount,
            disposalPriceEvent.currency,
            disposalPriceEvent.eventDate,
            input.reportingCurrency,
            rates,
          ).amount;
    const disposalCosts = sumCapitalEvents(
      assetEvents,
      "DISPOSAL_COST",
      input.reportingCurrency,
      rates,
    );
    const totalCostBasis = sumAll([acquisitionPrice, acquisitionCosts.amount, capex.amount]);
    const costBasis: RealEstateCostBasisView = {
      acquisitionPrice,
      acquisitionCosts: acquisitionCosts.amount,
      acquisitionCostEventCount: acquisitionCosts.count,
      capex: capex.amount,
      capexEventCount: capex.count,
      totalCostBasis,
      ownerCostBasis: applyShare(totalCostBasis),
      disposalPrice,
      disposalCosts: disposalCosts.amount,
    };

    // ── Devises des faits ───────────────────────────────────────────────────────────
    const factCurrencies = new Set(
      [observation?.currency, ...assetEvents.map((event) => event.currency)].filter(
        (currency): currency is string => typeof currency === "string",
      ),
    );
    const factCurrency = factCurrencies.size === 1 ? [...factCurrencies][0] : null;
    if (factCurrencies.size > 1) {
      flags.push({
        code: "CURRENCY_MIXED",
        detail: `Faits libellés en ${[...factCurrencies].join(", ")} : chacun est converti à sa date, aucun n'est additionné en devise native.`,
      });
    }
    if (
      factCurrency !== null &&
      factCurrency.toUpperCase() !== input.reportingCurrency.toUpperCase()
    ) {
      flags.push({
        code: "FX_PNL_NOT_ISOLATED",
        detail:
          "Valeur et coût de revient sont convertis chacun au taux de SA date : la plus-value qui en découle mêle effet immobilier et effet de change, sans les isoler.",
      });
    }

    // ── Financement : consommé du Debt Engine, jamais recalculé ─────────────────────
    const assetLinks = input.financingLinks.filter((link) => link.propertyId === asset.id);
    const financing = assetLinks
      .map((link): RealEstateFinancingLineView | null => {
        const liability = liabilityIndex.get(link.liabilityId);
        if (liability === undefined) {
          flags.push({
            code: "FINANCING_LINK_ORPHAN",
            detail: `Rattachement vers une dette absente de l'état (${link.liabilityId}) : aucune conséquence de financement n'en est dérivée.`,
          });
          return null;
        }
        const totalShare = allocated.get(link.liabilityId) ?? link.allocationShare;
        const overAllocated = totalShare > 1 + ALLOCATION_TOLERANCE;
        if (overAllocated) {
          flags.push({
            code: "DEBT_OVER_ALLOCATED",
            detail: `Quote-parts du concours « ${liability.name} » cumulées à ${(totalShare * 100).toFixed(2)} % : la même dette serait comptée deux fois. Aucune attribution n'est dérivée tant que l'incohérence subsiste.`,
          });
        }
        const currency = liability.currency ?? input.reportingCurrency;
        const balanceDate = liability.balanceDate ?? input.asOfDate;
        // L'encours vient du Debt Engine : `outstandingBalanceAt` à la date de lecture.
        // Aucun échéancier n'est reconstruit ici.
        const outstandingNative = outstandingBalanceAt(liability, input.asOfDate, input.asOfDate);
        const outstandingWhole = convert(
          outstandingNative,
          currency,
          balanceDate,
          input.reportingCurrency,
          rates,
        ).amount;
        // Le capital emprunté est un montant HISTORIQUE : sa contre-valeur dépend du taux
        // de change à la date du DÉCAISSEMENT, que le contrat de dette ne porte pas. La
        // première échéance n'est pas cette date : elle la suit, parfois de plusieurs mois
        // en cas de différé. L'utiliser comme approximation serait une hypothèse
        // silencieuse, invisible dans le résultat, qui fausserait l'apport réel puis le
        // rendement sur trésorerie engagée.
        //
        // En devise de reporting, aucune conversion n'est nécessaire et le montant est
        // exact. Dans toute autre devise, il reste NON CALCULABLE jusqu'à ce que le Debt
        // Engine porte une véritable date d'origination.
        const sameCurrency = currency.toUpperCase() === input.reportingCurrency.toUpperCase();
        const principalWhole = sameCurrency
          ? known(liability.principal)
          : unknown(`FINANCING_ORIGINATION_DATE_UNKNOWN:${liability.id}`);
        if (!sameCurrency) {
          flags.push({
            code: "FINANCING_ORIGINATION_DATE_UNKNOWN",
            detail: `Concours « ${liability.name} » libellé en ${currency} : le capital emprunté est un montant historique et sa date de décaissement n'est pas connue du contrat de dette. Sa contre-valeur en ${input.reportingCurrency} n'est donc pas calculable, ni l'apport réel qui en dépend. Aucune date approchée n'est substituée.`,
          });
        }
        const scale = (amount: DerivedAmount): DerivedAmount => {
          if (overAllocated)
            return {
              value: null,
              blockers: [...new Set([...amount.blockers, `DEBT_OVER_ALLOCATED:${liability.id}`])],
            };
          return amount.value === null
            ? amount
            : { value: amount.value * link.allocationShare, blockers: amount.blockers };
        };
        // Conséquences canoniques du Debt Engine sur les 12 mois qui suivent la date de
        // lecture. Une seule source d'échéancier pour tout LFO.
        const breakdown = debtServiceBreakdownForPeriod(
          [liability],
          input.asOfDate,
          input.asOfDate,
          addYear(input.asOfDate),
        );
        const timeline = buildLoanTimeline(liability, input.asOfDate);
        const scaled = scaleDebtConsequences(
          breakdown,
          overAllocated ? Number.NaN : link.allocationShare,
        );
        const guarded: RealEstateDebtConsequences = overAllocated
          ? {
              ...EMPTY_DEBT_CONSEQUENCES,
              cashDebtService: unknown(`DEBT_OVER_ALLOCATED:${liability.id}`),
              principalPaid: unknown(`DEBT_OVER_ALLOCATED:${liability.id}`),
              interestPaid: unknown(`DEBT_OVER_ALLOCATED:${liability.id}`),
              capitalisedInterest: unknown(`DEBT_OVER_ALLOCATED:${liability.id}`),
              insurancePaid: unknown(`DEBT_OVER_ALLOCATED:${liability.id}`),
              feesPaid: unknown(`DEBT_OVER_ALLOCATED:${liability.id}`),
              economicCost: unknown(`DEBT_OVER_ALLOCATED:${liability.id}`),
              dataKind: "MISSING",
            }
          : scaled;
        return {
          link,
          liability,
          allocationShare: link.allocationShare,
          outstandingWhole,
          attributedOutstanding: scale(outstandingWhole),
          attributedOriginalPrincipal: scale(principalWhole),
          attributedDebtService12m: guarded,
          debtFlags: timeline.flags,
        };
      })
      .filter((line): line is RealEstateFinancingLineView => line !== null);

    // ── État du financement : trois situations, jamais deux ─────────────────────────
    //
    // ABSENCE DE RATTACHEMENT ≠ ABSENCE DE DETTE. C'est la distinction la plus coûteuse du
    // domaine : traiter « je n'ai pas encore saisi le crédit » comme « j'ai acheté
    // comptant » donnerait une equity égale à la valeur du bien et surévaluerait le
    // patrimoine du montant entier de la dette. Le zéro n'est légitime que DÉCLARÉ.
    //
    //   LINKED       un concours est rattaché : les conséquences viennent du Debt Engine ;
    //   DECLARED_NONE l'utilisateur déclare le bien sans dette : zéro est une valeur ;
    //   UNKNOWN      rien n'est rattaché et rien n'est déclaré, ou une dette est déclarée
    //                sans être rattachée : la dette attribuée est INCONNUE.
    const financingState: RealEstateFinancingState =
      financing.length > 0
        ? "LINKED"
        : asset.isDebtFinanced === false
          ? "DECLARED_NONE"
          : "UNKNOWN";

    if (financingState === "LINKED" && asset.isDebtFinanced === false) {
      // Un rattachement est un FAIT qui pointe une dette réelle ; la déclaration n'est
      // qu'une affirmation. Le fait l'emporte, et la contradiction est signalée : ignorer
      // le concours rattaché sous-estimerait la dette du bien.
      flags.push({
        code: "FINANCING_DECLARATION_CONTRADICTED",
        detail:
          "Le bien est déclaré sans dette alors qu'un concours lui est rattaché. Le rattachement est retenu, car c'est un fait ; la déclaration est à corriger.",
      });
    }
    if (financingState === "DECLARED_NONE") {
      flags.push({
        code: "DEBT_FREE_DECLARED",
        detail:
          "Bien déclaré sans dette : l'absence de financement est une information, pas une lacune. L'equity du bien vaut sa valeur attribuable.",
      });
    }
    if (financingState === "UNKNOWN") {
      flags.push(
        asset.isDebtFinanced === true
          ? {
              code: "DEBT_DECLARED_NOT_LINKED",
              detail:
                "Une dette finance ce bien mais aucun concours ne lui est rattaché : la dette attribuée est inconnue, elle n'est pas nulle. Equity, apport réel et rendements sur fonds propres restent non calculables.",
            }
          : {
              code: "FINANCING_UNDECLARED",
              detail:
                "Financement non déclaré : ni concours rattaché, ni déclaration d'achat sans dette. Le moteur refuse de trancher entre les deux, et toute métrique dépendant du financement reste non calculable.",
            },
      );
    }

    /** `null` de financement inconnu, avec le motif qui dit laquelle des deux situations. */
    const financingUnknown = (): DerivedAmount =>
      unknown(
        asset.isDebtFinanced === true
          ? `DEBT_DECLARED_NOT_LINKED:${asset.id}`
          : `FINANCING_UNDECLARED:${asset.id}`,
      );

    const debt: RealEstateDebtConsequences =
      financingState === "LINKED"
        ? addDebtConsequences(financing.map((line) => line.attributedDebtService12m))
        : financingState === "DECLARED_NONE"
          ? EMPTY_DEBT_CONSEQUENCES
          : {
              cashDebtService: financingUnknown(),
              principalPaid: financingUnknown(),
              interestPaid: financingUnknown(),
              capitalisedInterest: financingUnknown(),
              insurancePaid: financingUnknown(),
              feesPaid: financingUnknown(),
              economicCost: financingUnknown(),
              dataKind: "MISSING",
            };
    const attributedOutstandingDebt =
      financingState === "LINKED"
        ? sumAll(financing.map((line) => line.attributedOutstanding))
        : financingState === "DECLARED_NONE"
          ? known(0)
          : financingUnknown();
    const attributedOriginalPrincipal =
      financingState === "LINKED"
        ? sumAll(financing.map((line) => line.attributedOriginalPrincipal))
        : financingState === "DECLARED_NONE"
          ? known(0)
          : financingUnknown();

    // ── Exploitation ────────────────────────────────────────────────────────────────
    const assetTerms = input.operatingTerms.filter((item) => item.propertyId === asset.id);
    const terms = latestAtOrBefore(assetTerms, input.asOfDate, (item) => item.effectiveFrom);
    if (terms === null) {
      flags.push({
        code: "OPERATING_TERMS_MISSING",
        detail:
          "Aucun terme d'exploitation déclaré à cette date : loyer, charges et rendements restent non calculables.",
      });
    }
    const termAmount = (value: number | null, slot: string): DerivedAmount => {
      if (terms === null) return unknown(`OPERATING_TERMS_MISSING:${asset.id}`);
      if (value === null) return unknown(`${slot}_UNDECLARED:${asset.id}`);
      return convert(value, terms.currency, terms.effectiveFrom, input.reportingCurrency, rates)
        .amount;
    };
    const grossRent = termAmount(terms?.annualGrossRent ?? null, "ANNUAL_GROSS_RENT");
    const vacancyRate = terms?.vacancyRate ?? null;
    if (terms !== null && terms.annualGrossRent !== null && vacancyRate === null) {
      flags.push({
        code: "VACANCY_RATE_MISSING",
        detail:
          "Loyer brut déclaré sans taux de vacance : le loyer effectif reste non calculable. Une vacance inconnue n'est pas une vacance nulle.",
      });
    }
    if (
      terms !== null &&
      terms.annualGrossRent !== null &&
      terms.annualGrossRent > 0 &&
      asset.usage !== null &&
      !RENT_BEARING_USAGES.has(asset.usage)
    ) {
      flags.push({
        code: "RENT_DECLARED_ON_NON_RENTAL",
        detail: `Loyer déclaré sur un bien d'usage ${asset.usage} : l'incohérence est signalée, le loyer n'est ni ignoré ni corrigé.`,
      });
    }
    const effectiveRent: DerivedAmount =
      vacancyRate === null
        ? {
            value: null,
            blockers: [...new Set([...grossRent.blockers, `VACANCY_RATE_MISSING:${asset.id}`])],
          }
        : grossRent.value === null
          ? grossRent
          : known(grossRent.value * (1 - vacancyRate));

    const managementFees: DerivedAmount = (() => {
      if (terms === null) return unknown(`OPERATING_TERMS_MISSING:${asset.id}`);
      if (terms.annualManagementFees !== null)
        return termAmount(terms.annualManagementFees, "ANNUAL_MANAGEMENT_FEES");
      if (terms.managementFeeRate !== null) {
        // Des frais exprimés en part du loyer ENCAISSÉ : ils dépendent donc du loyer
        // effectif, et héritent de son indétermination quand la vacance manque.
        return effectiveRent.value === null
          ? effectiveRent
          : known(effectiveRent.value * terms.managementFeeRate);
      }
      return unknown(`ANNUAL_MANAGEMENT_FEES_UNDECLARED:${asset.id}`);
    })();

    const costBreakdown = [
      {
        label: "Charges non récupérables",
        amount: termAmount(terms?.annualOperatingCharges ?? null, "ANNUAL_OPERATING_CHARGES"),
      },
      {
        label: "Taxe foncière",
        amount: termAmount(terms?.annualPropertyTax ?? null, "ANNUAL_PROPERTY_TAX"),
      },
      {
        label: "Assurance",
        amount: termAmount(terms?.annualInsurance ?? null, "ANNUAL_INSURANCE"),
      },
      {
        label: "Entretien",
        amount: termAmount(terms?.annualMaintenance ?? null, "ANNUAL_MAINTENANCE"),
      },
      { label: "Frais de gestion", amount: managementFees },
      {
        label: "Autres charges",
        amount: termAmount(terms?.annualOtherCosts ?? null, "ANNUAL_OTHER_COSTS"),
      },
    ];
    const undeclaredTerms = costBreakdown
      .filter((item) => item.amount.value === null)
      .map((item) => item.label);
    if (terms !== null && undeclaredTerms.length > 0) {
      flags.push({
        code: "OPERATING_TERM_UNDECLARED",
        detail: `Postes non déclarés : ${undeclaredTerms.join(", ")}. Ils ne sont pas traités comme nuls, et le rendement net qui en dépend reste non calculable. Déclarer 0 est une information ; ne rien déclarer n'en est pas une.`,
      });
    }
    const operatingCosts = sumAll(costBreakdown.map((item) => item.amount));
    const netOperatingIncome = subtract(effectiveRent, operatingCosts);
    const operating: RealEstateOperatingView = {
      terms,
      grossRent,
      effectiveRent,
      operatingCosts,
      costBreakdown,
      netOperatingIncome,
      attributedNetOperatingIncome: applyShare(netOperatingIncome),
      undeclaredTerms,
    };

    // ── Equity et plus-value ────────────────────────────────────────────────────────
    const currentEquity = subtract(valuation.ownerValue, attributedOutstandingDebt);
    const unrealisedGain = subtract(valuation.ownerValue, costBasis.ownerCostBasis);
    const netDisposalProceeds = subtract(costBasis.disposalPrice, costBasis.disposalCosts);
    const equity: RealEstateEquityView = {
      currentEquity,
      attributedOutstandingDebt,
      attributedOriginalPrincipal,
      unrealisedGain,
      realisedGain: subtract(applyShare(netDisposalProceeds), costBasis.ownerCostBasis),
    };

    // ── Rendements ──────────────────────────────────────────────────────────────────
    const attributedNoi = operating.attributedNetOperatingIncome;
    const preTaxCashFlow = subtract(attributedNoi, debt.cashDebtService);
    const taxBase = subtract(attributedNoi, debt.interestPaid);
    const taxRate = terms?.effectiveIncomeTaxRate ?? null;
    if (terms !== null && taxRate === null) {
      flags.push({
        code: "TAX_RATE_UNDECLARED",
        detail:
          "Aucun taux d'imposition effectif déclaré : aucun résultat après impôt n'est produit. LFO ne porte aucune règle fiscale immobilière fiable et n'en invente pas.",
      });
    }
    const declaredTax: DerivedAmount =
      taxRate === null
        ? unknown(`TAX_RATE_UNDECLARED:${asset.id}`)
        : taxBase.value === null
          ? taxBase
          : // Un résultat foncier négatif ne génère pas un crédit d'impôt : LFO ne connaît
            // ni le régime de déficit foncier, ni son plafond, ni son report.
            known(Math.max(0, taxBase.value) * taxRate);
    const equityEngaged = subtract(costBasis.ownerCostBasis, attributedOriginalPrincipal);
    if (equityEngaged.value !== null && equityEngaged.value <= MONETARY_TOLERANCE) {
      flags.push({
        code: "EQUITY_ENGAGED_NOT_POSITIVE",
        detail:
          "Apport réel nul ou négatif : le financement couvre la totalité du coût de revient. Aucun rendement sur trésorerie engagée n'est calculable sur une base nulle.",
      });
    }
    const economicIncome = subtract(attributedNoi, debt.economicCost);
    const returns: RealEstateReturnsView = {
      grossYieldOnValue: ratio(
        operating.grossRent,
        valuation.grossValue,
        `VALUE_NOT_POSITIVE:${asset.id}`,
      ),
      grossYieldOnCost: ratio(
        operating.grossRent,
        costBasis.totalCostBasis,
        `COST_BASIS_NOT_POSITIVE:${asset.id}`,
      ),
      netYieldOnValue: ratio(
        operating.netOperatingIncome,
        valuation.grossValue,
        `VALUE_NOT_POSITIVE:${asset.id}`,
      ),
      netYieldOnCost: ratio(
        operating.netOperatingIncome,
        costBasis.totalCostBasis,
        `COST_BASIS_NOT_POSITIVE:${asset.id}`,
      ),
      preTaxCashFlow,
      declaredTax,
      taxBase,
      taxBaseConvention: REAL_ESTATE_TAX_BASE_CONVENTION,
      afterTaxCashFlow: subtract(preTaxCashFlow, declaredTax),
      equityEngaged,
      cashOnCashOnEquityEngaged: ratio(
        preTaxCashFlow,
        equityEngaged,
        `EQUITY_ENGAGED_NOT_POSITIVE:${asset.id}`,
      ),
      economicReturnOnCurrentEquity: ratio(
        economicIncome,
        currentEquity,
        `CURRENT_EQUITY_NOT_POSITIVE:${asset.id}`,
      ),
      debtServiceCoverage: ratio(
        attributedNoi,
        debt.cashDebtService,
        `NO_ATTRIBUTED_DEBT_SERVICE:${asset.id}`,
      ),
      loanToValue: ratio(
        attributedOutstandingDebt,
        valuation.ownerValue,
        `VALUE_NOT_POSITIVE:${asset.id}`,
      ),
    };

    // ── Flux réels ──────────────────────────────────────────────────────────────────
    // Le Cash Flow Engine classe lui-même les lignes rattachées : aucune nature n'est
    // réinterprétée ici, aucun flux n'est créé.
    const attachedTransactions = transactions.filter(
      (transaction) => transaction.propertyId === asset.id,
    );
    const cashFlow =
      attachedTransactions.length === 0
        ? null
        : computeObservedCashFlow(attachedTransactions, categories, observedStart, observedEnd, {
            ledgerCoverageStart: input.ledgerCoverageStart ?? null,
            asOfDate: input.asOfDate,
          });
    if (cashFlow !== null && cashFlow.coverage.status !== "COMPLETE") {
      flags.push({
        code: "OBSERVED_LEDGER_NOT_COVERED",
        detail: `Fenêtre observée couverte sur ${cashFlow.coverage.completeCoveredMonths} des ${cashFlow.coverage.requestedMonths} mois : les flux réels sont incomplets et ne peuvent pas être comparés terme à terme aux termes déclarés.`,
      });
    }
    // Revenus OBSERVÉS, pas « loyer observé ». Sans nature de revenu locatif dans le
    // ledger, le moteur ne peut pas affirmer que ces encaissements sont des loyers : il
    // livre la somme qu'il sait classer et signale ce qu'elle ne prouve pas.
    const observedIncome =
      cashFlow === null || cashFlow.coverage.status !== "COMPLETE"
        ? unknown(`OBSERVED_LEDGER_NOT_COVERED:${asset.id}`)
        : known(cashFlow.income);
    if (observedIncome.value !== null) {
      flags.push({
        code: "OBSERVED_INCOME_NOT_RENT_QUALIFIED",
        detail:
          "Les revenus observés regroupent tous les flux rattachés au bien et classés en revenu : ce ne sont pas nécessairement des loyers. L'écart avec le loyer déclaré signale un point à examiner, il ne mesure pas un manque de loyer.",
      });
    }
    const observed: RealEstateObservedView = {
      periodStart: observedStart,
      periodEnd: observedEnd,
      cashFlow,
      transactionCount: attachedTransactions.length,
      observedIncome,
      declaredRentVsObservedIncome: subtract(effectiveRent, observedIncome),
    };

    return {
      asset,
      usage: asset.usage,
      isOnBalanceSheet,
      disposedAt,
      factCurrency,
      valuation,
      costBasis,
      financing,
      financingState,
      debt,
      operating,
      returns,
      equity,
      observed,
      flags,
    };
  });

  const onSheet = assets.filter((view) => view.isOnBalanceSheet);
  const emptyAggregate: CanonicalAggregate = {
    value: 0,
    knownValue: 0,
    status: "COMPLETE",
    coverage: 1,
    blockers: [],
  };
  const aggregateOnSheet = (pick: (view: RealEstateAssetView) => DerivedAmount) =>
    onSheet.length === 0 ? emptyAggregate : aggregateOf(onSheet.map(pick));

  const grossValue = aggregateOnSheet((view) => view.valuation.ownerValue);
  const attributedDebt = aggregateOnSheet((view) => view.equity.attributedOutstandingDebt);
  const flags = dedupeFlags(assets.flatMap((view) => view.flags));
  const blockers = [...new Set([...grossValue.blockers, ...attributedDebt.blockers])];

  return {
    asOfDate: input.asOfDate,
    reportingCurrency: input.reportingCurrency,
    assets,
    grossValue,
    attributedDebt,
    equity: aggregateOnSheet((view) => view.equity.currentEquity),
    unrealisedGain: aggregateOnSheet((view) => view.equity.unrealisedGain),
    annualNetOperatingIncome: aggregateOnSheet(
      (view) => view.operating.attributedNetOperatingIncome,
    ),
    annualPreTaxCashFlow: aggregateOnSheet((view) => view.returns.preTaxCashFlow),
    annualEconomicFinancingCost: aggregateOnSheet((view) => view.debt.economicCost),
    flags,
    quality: { status: grossValue.status, blockers },
  };
}

/** Dédoublonne les drapeaux sur le couple code + détail : un même motif ne se répète pas. */
function dedupeFlags(flags: RealEstateFlag[]): RealEstateFlag[] {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    const key = `${flag.code}::${flag.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Même jour, un an plus tard. Sert de borne haute aux fenêtres de 12 mois. */
function addYear(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${String(year + 1).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Contributions au bilan canonique ─────────────────────────────────────────────────

/**
 * Lignes de bilan produites par le domaine immobilier.
 *
 * UNE SEULE ligne par bien, du côté ACTIF. AUCUNE ligne de passif : la dette immobilière
 * est déjà portée par `liabilities` et le Canonical Balance Sheet l'y lit. En émettre une
 * ici la compterait deux fois.
 *
 * Le montant émis est la valeur ATTRIBUABLE en devise NATIVE. La conversion appartient au
 * bilan, qui la fait une fois et la trace. Un bien sans valorisation, ou dont la
 * quote-part n'est pas déclarée, émet une ligne de montant `null` portant ses motifs :
 * l'actif existe, son montant est inconnu, et le total devient PARTIAL au lieu d'être
 * silencieusement sous-évalué.
 */
export function realEstateBalanceSheetContributions(
  portfolio: RealEstatePortfolio,
): CanonicalBalanceSheetContribution[] {
  return portfolio.assets
    .filter((view) => view.isOnBalanceSheet)
    .map((view) => {
      const observation = view.valuation.observation;
      const blockers: string[] = [];
      if (observation === null) blockers.push(`REAL_ESTATE_VALUATION_MISSING:${view.asset.id}`);
      if (view.asset.ownershipShare === null)
        blockers.push(`REAL_ESTATE_OWNERSHIP_SHARE_MISSING:${view.asset.id}`);
      const nativeValue = view.valuation.ownerNativeValue;
      return {
        id: `real-estate:${view.asset.id}`,
        entityId: view.asset.id,
        domain: "REAL_ESTATE" as const,
        side: "ASSET" as const,
        category: "PROPERTY",
        subcategory: view.asset.usage ?? "USAGE_UNDECLARED",
        nativeValue,
        valuationBlockers: nativeValue === null ? blockers : undefined,
        currency: observation?.currency ?? portfolio.reportingCurrency,
        valuationDate: observation?.valuedAt ?? portfolio.asOfDate,
        valuationMethod:
          observation === null ? "USER_ESTIMATE" : VALUATION_METHOD_MAP[observation.method],
        valuationStatus: view.valuation.status,
        liquidity: "ILLIQUID" as const,
        provenance: observation?.provenance ?? view.asset.provenance,
        confidence: observation?.provenance.confidence ?? view.asset.provenance.confidence,
        source: observation?.provenance.source ?? view.asset.provenance.source,
        reconciliationState: "NOT_APPLICABLE" as const,
        isAccountingPrimary: true,
        flags: view.flags
          .filter((flag) => flag.code === "FX_PNL_NOT_ISOLATED" || flag.code === "VALUATION_STALE")
          .map((flag) => flag.code),
      };
    });
}
