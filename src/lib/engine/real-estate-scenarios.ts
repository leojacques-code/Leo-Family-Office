import {
  UNDECLARED_LOAN_TERMS,
  addMonths,
  buildLoanTimeline,
  debtServiceBreakdownForPeriod,
  monthBounds,
  outstandingBalanceAt,
} from "@/lib/engine/debt";
import { irr, npv } from "@/lib/engine/financial";
import type { DerivedAmount, RealEstateAssetView } from "@/lib/engine/real-estate";
import type { Liability, Provenance } from "@/lib/types";

/**
 * SCÉNARIOS IMMOBILIERS
 *
 * Couche de PROJECTION, strictement séparée de la couche de faits. Rien ici n'est
 * persisté, et rien ici ne redéfinit une vérité : les scénarios partent d'une
 * `RealEstateAssetView` déjà dérivée des faits, et de HYPOTHÈSES explicitement déclarées
 * par l'appelant.
 *
 * TROIS RÈGLES
 * ------------
 * 1. Aucun amortissement local. Tout échéancier, y compris celui d'un crédit qui n'existe
 *    pas encore, est construit par le Debt Engine à partir d'une `Liability` synthétique.
 *    Il n'y a qu'un seul moteur d'amortissement dans LFO.
 *
 * 2. Aucune hypothèse implicite. Une croissance de valeur ou de loyer non fournie n'est pas
 *    remplacée par zéro ni par une moyenne historique : la grandeur qui en dépend devient
 *    non calculable et le dit. Un scénario sans hypothèse déclarée n'est pas un scénario à
 *    croissance nulle.
 *
 * 3. Aucune fiscalité inventée. Ni impôt sur la plus-value, ni régime de déficit foncier,
 *    ni abattement pour durée de détention : LFO ne porte aucune de ces règles. Un scénario
 *    de cession restitue un produit AVANT impôt et le déclare comme tel.
 */

/** Hypothèses d'un scénario. Chaque `null` rend explicitement non calculable ce qui en dépend. */
export interface RealEstateScenarioAssumptions {
  horizonYears: number;
  /** Croissance annuelle de la valeur du bien. `null` = non déclarée. */
  annualValueGrowth: number | null;
  /** Croissance annuelle du loyer. `null` = non déclarée. */
  annualRentGrowth: number | null;
  /** Frais de cession en part du prix, dans [0,1]. `null` = non déclarés. */
  sellingCostsRate: number | null;
  /** Taux d'actualisation de la VAN. Déclaré par l'appelant, jamais deviné. */
  discountRate: number;
}

export type RealEstateScenarioKind = "HOLD" | "SELL" | "REFINANCE" | "WORKS";

export interface RealEstateScenarioYear {
  year: number;
  periodStart: string;
  periodEnd: string;
  /** Loyer effectif attribué de l'année, hypothèse de croissance appliquée. */
  attributedNetOperatingIncome: DerivedAmount;
  /** Décaissement de dette de l'année, produit par le Debt Engine. */
  attributedCashDebtService: DerivedAmount;
  /** Intérêts, assurance et frais : le coût économique, jamais le principal. */
  attributedEconomicFinancingCost: DerivedAmount;
  /** Remboursement de capital : neutre sur le patrimoine net. */
  attributedPrincipalRepaid: DerivedAmount;
  /** NOI attribué − service de dette attribué. Un FLUX, pas une création de patrimoine. */
  equityCashFlow: DerivedAmount;
  /** Valeur attribuée en fin d'année, hypothèse de croissance appliquée. */
  attributedValue: DerivedAmount;
  /** Encours attribué en fin d'année, projeté par le Debt Engine. */
  attributedOutstanding: DerivedAmount;
  /** Valeur − encours. Equity patrimoniale à la fin de l'année. */
  attributedEquity: DerivedAmount;
}

export interface RealEstateScenarioResult {
  kind: RealEstateScenarioKind;
  label: string;
  assetId: string;
  horizonYears: number;
  years: RealEstateScenarioYear[];
  /** Trésorerie initiale du scénario : négative pour un investissement. */
  initialCashFlow: DerivedAmount;
  /** Trésorerie terminale hors flux d'exploitation de la dernière année. */
  terminalCashFlow: DerivedAmount;
  /** Σ des coûts économiques du financement sur l'horizon. */
  economicFinancingCost: DerivedAmount;
  /** Σ du capital remboursé sur l'horizon. Neutre sur le patrimoine net. */
  principalRepaid: DerivedAmount;
  /** TRI de la série de trésorerie d'equity. `null` si la série est incalculable. */
  equityIrr: number | null;
  /** VAN au taux d'actualisation déclaré. */
  equityNpv: DerivedAmount;
  discountRate: number;
  /** Ce qui empêche le scénario d'être complet, jamais comblé par une hypothèse. */
  blockers: string[];
  notes: string[];
}

const known = (value: number): DerivedAmount => ({ value, blockers: [] });
const unknown = (...blockers: string[]): DerivedAmount => ({ value: null, blockers });

function combine(parts: DerivedAmount[], reduce: (values: number[]) => number): DerivedAmount {
  const blockers = [...new Set(parts.flatMap((part) => part.blockers))];
  if (parts.some((part) => part.value === null)) return { value: null, blockers };
  return { value: reduce(parts.map((part) => part.value as number)), blockers };
}

const add = (...parts: DerivedAmount[]) =>
  combine(parts, (values) => values.reduce((total, value) => total + value, 0));
const minus = (left: DerivedAmount, right: DerivedAmount) =>
  combine([left, right], ([a, b]) => a - b);
const times = (amount: DerivedAmount, factor: number) =>
  amount.value === null
    ? amount
    : {
        value: Object.is(amount.value * factor, -0) ? 0 : amount.value * factor,
        blockers: amount.blockers,
      };

/** Série de trésorerie exploitable seulement si TOUS ses termes sont connus. */
function cashFlowSeries(parts: DerivedAmount[]): number[] | null {
  return parts.some((part) => part.value === null)
    ? null
    : parts.map((part) => part.value as number);
}

/** Lendemain d'une date ISO. */
function nextDay(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/** Veille d'une date ISO. */
function previousDay(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Fenêtre de l'année `year` d'un scénario, à partir d'une date d'ancrage.
 *
 * La première année commence le LENDEMAIN de l'ancrage quand celui-ci est une date
 * d'OBSERVATION : une échéance déjà exigible au jour de l'observation appartient au passé,
 * elle est déjà absorbée par l'encours observé, et la compter à nouveau ferait payer deux
 * fois le même capital. Cette convention est exactement celle du Personal Monthly
 * Financial Model, pour que les deux moteurs découpent le temps de la même façon.
 *
 * Sur un projet qui n'existe pas encore, l'ancrage n'est pas une observation mais un
 * DÉPART : la première échéance doit alors être comptée, et l'appelant passe
 * `anchorIsObservation: false`.
 */
function scenarioYearWindow(anchor: string, year: number, anchorIsObservation = true) {
  const monthStart = monthBounds(addMonths(anchor, (year - 1) * 12)).start;
  const start = year === 1 && anchorIsObservation ? nextDay(anchor) : monthStart;
  const end = monthBounds(addMonths(anchor, year * 12 - 1)).end;
  return { start, end };
}

/**
 * `null` de financement inconnu, avec son motif. Un scénario ne remplace jamais un
 * financement non déclaré par zéro : il refuse de produire les grandeurs qui en dépendent.
 */
function financingUnknown(view: RealEstateAssetView): DerivedAmount {
  return unknown(
    view.asset.isDebtFinanced === true
      ? `DEBT_DECLARED_NOT_LINKED:${view.asset.id}`
      : `FINANCING_UNDECLARED:${view.asset.id}`,
  );
}

function futureFxUnknown(view: RealEstateAssetView, liability: Liability): DerivedAmount | null {
  const currency = liability.currency ?? view.reportingCurrency;
  return currency.toUpperCase() === view.reportingCurrency.toUpperCase()
    ? null
    : unknown(`FUTURE_FX_UNAVAILABLE:${currency}/${view.reportingCurrency}:${liability.id}`);
}

/**
 * Conséquences canoniques d'un ensemble de dettes sur une fenêtre, mises à la quote-part
 * de chaque rattachement. Le Debt Engine est appelé UNE FOIS PAR DETTE, avec sa propre
 * quote-part : agréger d'abord puis répartir ensuite mélangerait des parts différentes.
 *
 * Sans rattachement, la réponse dépend de ce que l'utilisateur a DÉCLARÉ. Un bien déclaré
 * sans dette a bien un service de dette nul ; un bien dont le financement n'est pas
 * déclaré a un service de dette INCONNU, et le scénario le dit au lieu de le supposer nul.
 */
function attributedDebtOverWindow(
  view: RealEstateAssetView,
  asOfDate: string,
  start: string,
  end: string,
) {
  if (view.financing.length === 0) {
    if (view.asset.isDebtFinanced === false) {
      return { cashOut: known(0), economicCost: known(0), principal: known(0) };
    }
    const missing = financingUnknown(view);
    return { cashOut: missing, economicCost: missing, principal: missing };
  }
  const parts = view.financing.map((line) => {
    const fxMissing = futureFxUnknown(view, line.liability);
    if (fxMissing !== null) {
      return { cashOut: fxMissing, economicCost: fxMissing, principal: fxMissing };
    }
    const breakdown = debtServiceBreakdownForPeriod([line.liability], asOfDate, start, end);
    return {
      cashOut: known(breakdown.totalCashOut * line.allocationShare),
      economicCost: known(breakdown.economicCost * line.allocationShare),
      principal: known(breakdown.principal * line.allocationShare),
    };
  });
  return {
    cashOut: add(...parts.map((part) => part.cashOut)),
    economicCost: add(...parts.map((part) => part.economicCost)),
    principal: add(...parts.map((part) => part.principal)),
  };
}

/** Encours attribué projeté à une date, par le seul Debt Engine. */
function attributedOutstandingAt(
  view: RealEstateAssetView,
  asOfDate: string,
  targetDate: string,
): DerivedAmount {
  if (view.financing.length === 0) {
    return view.asset.isDebtFinanced === false ? known(0) : financingUnknown(view);
  }
  return add(
    ...view.financing.map(
      (line) =>
        futureFxUnknown(view, line.liability) ??
        known(outstandingBalanceAt(line.liability, asOfDate, targetDate) * line.allocationShare),
    ),
  );
}

/**
 * Déroulé annuel commun à tous les scénarios de conservation.
 *
 * `extraLiabilities` permet à un scénario de refinancement de substituer un concours à un
 * autre : les dettes y sont traitées exactement comme les dettes réelles, par le même
 * moteur.
 */
function projectYears(
  view: RealEstateAssetView,
  assumptions: RealEstateScenarioAssumptions,
  anchor: string,
  override?: {
    financing: RealEstateAssetView["financing"];
    noiAdjustment?: DerivedAmount;
  },
): RealEstateScenarioYear[] {
  const working: RealEstateAssetView =
    override === undefined ? view : { ...view, financing: override.financing };
  const baseNoi = view.operating.attributedNetOperatingIncome;
  const adjustedBaseNoi =
    override?.noiAdjustment === undefined ? baseNoi : add(baseNoi, override.noiAdjustment);
  const baseValue = view.valuation.ownerValue;

  return Array.from({ length: assumptions.horizonYears }, (_, index) => {
    const year = index + 1;
    const { start, end } = scenarioYearWindow(anchor, year);
    const debt = attributedDebtOverWindow(working, anchor, start, end);
    const noi =
      assumptions.annualRentGrowth === null
        ? unknown(`RENT_GROWTH_UNDECLARED:${view.asset.id}`)
        : times(adjustedBaseNoi, Math.pow(1 + assumptions.annualRentGrowth, year - 1));
    const value =
      assumptions.annualValueGrowth === null
        ? unknown(`VALUE_GROWTH_UNDECLARED:${view.asset.id}`)
        : times(baseValue, Math.pow(1 + assumptions.annualValueGrowth, year));
    const outstanding = attributedOutstandingAt(working, anchor, end);
    return {
      year,
      periodStart: start,
      periodEnd: end,
      attributedNetOperatingIncome: noi,
      attributedCashDebtService: debt.cashOut,
      attributedEconomicFinancingCost: debt.economicCost,
      attributedPrincipalRepaid: debt.principal,
      equityCashFlow: minus(noi, debt.cashOut),
      attributedValue: value,
      attributedOutstanding: outstanding,
      attributedEquity: minus(value, outstanding),
    };
  });
}

function finalise(
  base: Omit<RealEstateScenarioResult, "equityIrr" | "equityNpv" | "blockers">,
  extraBlockers: string[] = [],
): RealEstateScenarioResult {
  const periodic = base.years.map((year) => year.equityCashFlow);
  const lastIndex = periodic.length - 1;
  const withTerminal = periodic.map((flow, index) =>
    index === lastIndex ? add(flow, base.terminalCashFlow) : flow,
  );
  const series = cashFlowSeries([base.initialCashFlow, ...withTerminal]);
  const blockers = [
    ...new Set([
      ...extraBlockers,
      ...base.initialCashFlow.blockers,
      ...base.terminalCashFlow.blockers,
      ...periodic.flatMap((flow) => flow.blockers),
    ]),
  ];
  return {
    ...base,
    equityIrr: series === null ? null : irr(series),
    equityNpv: series === null ? { value: null, blockers } : known(npv(base.discountRate, series)),
    blockers,
  };
}

// ─── Scénario 1 : conservation ────────────────────────────────────────────────────────

/**
 * Conserver le bien sur l'horizon, puis constater l'equity terminale.
 *
 * Le flux terminal n'est PAS un produit de cession : le bien n'est pas vendu. C'est
 * l'equity patrimoniale résiduelle, isolée du TRI de trésorerie pour que VALORISATION ≠
 * CASH reste lisible : `equityIrr` inclut cette equity terminale comme valeur de sortie
 * théorique, ce qui est signalé dans les notes.
 */
export function holdScenario(
  view: RealEstateAssetView,
  assumptions: RealEstateScenarioAssumptions,
  asOfDate: string,
): RealEstateScenarioResult {
  const years = projectYears(view, assumptions, asOfDate);
  const terminalEquity = years.at(-1)?.attributedEquity ?? view.equity.currentEquity;
  return finalise({
    kind: "HOLD",
    label: "Conserver",
    assetId: view.asset.id,
    horizonYears: assumptions.horizonYears,
    years,
    // Conserver n'engage aucune trésorerie nouvelle : le capital est déjà immobilisé.
    initialCashFlow: known(0),
    terminalCashFlow: terminalEquity,
    economicFinancingCost: add(...years.map((year) => year.attributedEconomicFinancingCost)),
    principalRepaid: add(...years.map((year) => year.attributedPrincipalRepaid)),
    discountRate: assumptions.discountRate,
    notes: [
      "L'equity terminale n'est pas encaissée : elle est comptée comme valeur de sortie théorique. Le TRI mesure donc une rentabilité patrimoniale, pas une trésorerie disponible.",
      "Aucune fiscalité de sortie n'est appliquée : ni impôt sur la plus-value, ni abattement pour durée de détention.",
    ],
  });
}

// ─── Scénario 2 : cession ─────────────────────────────────────────────────────────────

export interface SellScenarioInput {
  /** Frais de cession en part du prix. `null` = non déclarés, le net devient inconnu. */
  sellingCostsRate: number | null;
  /**
   * Indemnité de remboursement anticipé effectivement due. `null` = inconnue : le produit
   * net de cession est alors non calculable plutôt que minoré d'un montant supposé nul.
   */
  prepaymentPenalty: number | null;
  /** Prix de cession retenu. `null` = la valorisation courante fait office de prix. */
  salePrice: number | null;
}

export interface SellScenarioResult {
  kind: "SELL";
  label: string;
  assetId: string;
  /** Prix retenu, part attribuée. */
  attributedSalePrice: DerivedAmount;
  sellingCosts: DerivedAmount;
  /** Encours attribué à solder à la cession, lu sur le Debt Engine. */
  debtPayoff: DerivedAmount;
  prepaymentPenalty: DerivedAmount;
  /** Prix − frais − dette soldée − indemnité. AVANT toute fiscalité. */
  netProceedsBeforeTax: DerivedAmount;
  /**
   * Produit net − coût de revient attribué. Plus-value économique RÉALISÉE, avant impôt.
   * Elle diffère de la plus-value latente du bilan par les frais de cession.
   */
  realisedGainBeforeTax: DerivedAmount;
  blockers: string[];
  notes: string[];
}

/**
 * Céder le bien à la date de lecture.
 *
 * Le remboursement du capital restant dû n'est pas une charge : il éteint un passif que le
 * bilan portait déjà. Il réduit le produit encaissé sans réduire le patrimoine net d'un
 * euro. C'est pour cela que `netProceedsBeforeTax` et `realisedGainBeforeTax` sont deux
 * grandeurs distinctes et jamais confondues.
 */
export function sellScenario(
  view: RealEstateAssetView,
  input: SellScenarioInput,
): SellScenarioResult {
  const notes = [
    "Produit AVANT impôt : LFO ne porte aucune règle d'imposition des plus-values immobilières et n'en applique aucune.",
    "Le remboursement du capital restant dû réduit le produit encaissé, pas le patrimoine net : le passif éteint était déjà au bilan.",
  ];
  const grossPrice = input.salePrice !== null ? known(input.salePrice) : view.valuation.grossValue;
  const share = view.asset.ownershipShare;
  const attributedSalePrice =
    share === null ? unknown(`OWNERSHIP_SHARE_MISSING:${view.asset.id}`) : times(grossPrice, share);
  const sellingCosts =
    input.sellingCostsRate === null
      ? unknown(`SELLING_COSTS_UNDECLARED:${view.asset.id}`)
      : times(attributedSalePrice, input.sellingCostsRate);
  const debtPayoff = view.equity.attributedOutstandingDebt;
  const prepaymentPenalty =
    view.financingState === "DECLARED_NONE"
      ? known(0)
      : input.prepaymentPenalty === null
        ? unknown(`PREPAYMENT_PENALTY_UNKNOWN:${view.asset.id}`)
        : known(input.prepaymentPenalty);
  if (input.prepaymentPenalty === null && view.financing.length > 0) {
    notes.push(
      "Indemnité de remboursement anticipé inconnue : le produit net reste non calculable. Elle n'est pas supposée nulle.",
    );
  }
  const netProceedsBeforeTax = minus(
    minus(attributedSalePrice, sellingCosts),
    add(debtPayoff, prepaymentPenalty),
  );
  const realisedGainBeforeTax = minus(
    minus(attributedSalePrice, sellingCosts),
    view.costBasis.ownerCostBasis,
  );
  return {
    kind: "SELL",
    label: "Vendre",
    assetId: view.asset.id,
    attributedSalePrice,
    sellingCosts,
    debtPayoff,
    prepaymentPenalty,
    netProceedsBeforeTax,
    realisedGainBeforeTax,
    blockers: [...new Set([...netProceedsBeforeTax.blockers, ...realisedGainBeforeTax.blockers])],
    notes,
  };
}

// ─── Prêt synthétique : le SEUL point d'entrée d'un crédit hypothétique ───────────────

export interface SyntheticLoanTerms {
  principal: number;
  annualRate: number;
  termMonths: number;
  firstPaymentDate: string;
  currency: string;
  /** Assurance par échéance. `null` = non déclarée, jamais supposée nulle. */
  monthlyInsurance: number | null;
  /** `null` = convention inconnue ; le Debt Engine applique l'hypothèse la moins déformante. */
  paymentIncludesInsurance: boolean | null;
}

const SYNTHETIC_PROVENANCE: Provenance = {
  kind: "USER_ASSUMPTION",
  confidence: "MEDIUM",
  source: "Scénario immobilier",
};

/**
 * Construit une `Liability` à partir de termes hypothétiques, pour la donner au Debt
 * Engine. C'est la seule façon dont un crédit non encore contracté entre dans LFO : le
 * moteur d'amortissement reste unique, et un prêt simulé passe par exactement les mêmes
 * conventions qu'un prêt réel (assurance, capitalisation, périodicité, profil).
 *
 * `monthlyPayment: 0` est volontaire : le Debt Engine dérive alors la mensualité théorique
 * du contrat. Écrire ici une PMT recalculée localement rétablirait un second moteur.
 */
export function syntheticLoan(terms: SyntheticLoanTerms, id = "scenario-loan"): Liability {
  const maturity = addMonths(terms.firstPaymentDate, Math.max(0, terms.termMonths - 1));
  return {
    ...UNDECLARED_LOAN_TERMS,
    id,
    name: "Financement simulé",
    lender: "Scénario",
    principal: terms.principal,
    currentBalance: terms.principal,
    currency: terms.currency,
    balanceDate: terms.firstPaymentDate,
    annualRate: terms.annualRate,
    monthlyPayment: 0,
    paymentCount: Math.max(0, terms.termMonths),
    firstPaymentDate: terms.firstPaymentDate,
    maturityDate: maturity,
    monthlyInsurance: terms.monthlyInsurance,
    paymentIncludesInsurance: terms.paymentIncludesInsurance,
    provenance: SYNTHETIC_PROVENANCE,
  };
}

// ─── Scénario 3 : refinancement ───────────────────────────────────────────────────────

export interface RefinanceScenarioInput {
  /** Termes du nouveau concours. Il passe par le Debt Engine comme n'importe quel prêt. */
  newLoan: SyntheticLoanTerms;
  /** Indemnité de remboursement anticipé du concours existant. `null` = inconnue. */
  prepaymentPenalty: number | null;
  /** Frais de dossier et de garantie du nouveau concours. `null` = inconnus. */
  arrangementFees: number | null;
}

export interface RefinanceScenarioResult extends RealEstateScenarioResult {
  kind: "REFINANCE";
  /** Coût économique du financement ACTUEL sur le même horizon, pour comparaison. */
  currentEconomicFinancingCost: DerivedAmount;
  /** Économie économique attendue : coût actuel − coût refinancé − frais − indemnité. */
  economicSaving: DerivedAmount;
  /** Encours soldé par l'opération, lu sur le Debt Engine. */
  refinancedOutstanding: DerivedAmount;
  /** Nouveau capital − encours soldé. Positif = trésorerie reçue, négatif = apport requis. */
  netFinancingProceeds: DerivedAmount;
}

/**
 * Remplacer les concours rattachés au bien par un nouveau concours.
 *
 * La comparaison se fait sur le COÛT ÉCONOMIQUE, jamais sur la mensualité : allonger la
 * durée réduit la mensualité tout en augmentant le coût du crédit, et comparer des
 * mensualités ferait passer cette dégradation pour un gain. Le capital remboursé est
 * exclu des deux côtés : ce n'est pas une charge.
 */
export function refinanceScenario(
  view: RealEstateAssetView,
  input: RefinanceScenarioInput,
  assumptions: RealEstateScenarioAssumptions,
  asOfDate: string,
): RefinanceScenarioResult {
  const notes = [
    "Comparaison sur le coût économique du crédit (intérêts, assurance, frais), jamais sur la mensualité : une durée allongée réduit la mensualité et augmente le coût.",
    "Le capital remboursé est exclu des deux côtés de la comparaison : PRINCIPAL ≠ CHARGE.",
  ];
  const loan = syntheticLoan(input.newLoan, `refinance:${view.asset.id}`);
  // Le nouveau concours finance intégralement le bien : la quote-part est celle du bien
  // lui-même, et non une répartition entre plusieurs biens.
  const replacementFinancing: RealEstateAssetView["financing"] = [
    {
      link: {
        id: `refinance-link:${view.asset.id}`,
        propertyId: view.asset.id,
        liabilityId: loan.id,
        allocationShare: 1,
        notes: null,
        provenance: SYNTHETIC_PROVENANCE,
      },
      liability: loan,
      allocationShare: 1,
      outstandingWhole: known(loan.currentBalance),
      attributedOutstanding: known(loan.currentBalance),
      attributedOriginalPrincipal: known(loan.principal),
      attributedDebtService12m: view.debt,
      debtFlags: buildLoanTimeline(loan, asOfDate).flags,
    },
  ];
  const years = projectYears(view, assumptions, asOfDate, {
    financing: replacementFinancing,
  });
  const horizonEnd = years.at(-1)?.periodEnd ?? asOfDate;
  const currentCost = add(
    ...Array.from({ length: assumptions.horizonYears }, (_, index) => {
      const { start, end } = scenarioYearWindow(asOfDate, index + 1);
      return attributedDebtOverWindow(view, asOfDate, start, end).economicCost;
    }),
  );
  const refinancedCost = add(...years.map((year) => year.attributedEconomicFinancingCost));
  const penalty =
    input.prepaymentPenalty === null
      ? unknown(`PREPAYMENT_PENALTY_UNKNOWN:${view.asset.id}`)
      : known(input.prepaymentPenalty);
  const fees =
    input.arrangementFees === null
      ? unknown(`ARRANGEMENT_FEES_UNKNOWN:${view.asset.id}`)
      : known(input.arrangementFees);
  const refinancedOutstanding = view.equity.attributedOutstandingDebt;
  const newLoanCurrency = loan.currency ?? view.reportingCurrency;
  const newPrincipal =
    newLoanCurrency.toUpperCase() === view.reportingCurrency.toUpperCase()
      ? known(loan.principal)
      : unknown(`FUTURE_FX_UNAVAILABLE:${newLoanCurrency}/${view.reportingCurrency}:${loan.id}`);
  const netFinancingProceeds = minus(newPrincipal, refinancedOutstanding);
  const terminalEquity =
    years.at(-1)?.attributedEquity ?? unknown(`HORIZON_EMPTY:${view.asset.id}`);
  const base = finalise({
    kind: "REFINANCE",
    label: "Refinancer",
    assetId: view.asset.id,
    horizonYears: assumptions.horizonYears,
    years,
    // Le nouveau concours peut être supérieur ou inférieur à l'encours soldé. La différence
    // est un flux de trésorerie, jamais une économie économique du financement.
    initialCashFlow: minus(netFinancingProceeds, add(penalty, fees)),
    terminalCashFlow: terminalEquity,
    economicFinancingCost: refinancedCost,
    principalRepaid: add(...years.map((year) => year.attributedPrincipalRepaid)),
    discountRate: assumptions.discountRate,
    notes: [...notes, `Horizon comparé jusqu'au ${horizonEnd}.`],
  });
  return {
    ...base,
    kind: "REFINANCE",
    currentEconomicFinancingCost: currentCost,
    economicSaving: minus(currentCost, add(refinancedCost, penalty, fees)),
    refinancedOutstanding,
    netFinancingProceeds,
  };
}

// ─── Scénario 4 : travaux ─────────────────────────────────────────────────────────────

export interface WorksScenarioInput {
  /** Montant des travaux, décaissé à l'ouverture du scénario. */
  capexAmount: number;
  /** Hausse annuelle du loyer attendue. `null` = non déclarée : le scénario reste vide. */
  annualRentUplift: number | null;
  /** Hausse de valeur attendue. `null` = non déclarée. */
  valueUplift: number | null;
  /** Financement éventuel des travaux. `null` = travaux payés sur trésorerie propre. */
  financing: SyntheticLoanTerms | null;
}

export interface WorksScenarioResult extends RealEstateScenarioResult {
  kind: "WORKS";
  capexAmount: number;
  /**
   * Hausse de NOI ÷ montant des travaux. Rendement MARGINAL des travaux, distinct du
   * rendement du bien : les deux ne se comparent pas.
   */
  marginalYieldOnCapex: DerivedAmount;
  /** Hausse de valeur − montant des travaux. Positive = les travaux créent de la valeur. */
  valueCreation: DerivedAmount;
}

/**
 * Réaliser des travaux capitalisés.
 *
 * Les travaux ne sont pas une charge d'exploitation : ils augmentent la base de coût du
 * bien. Ils ne sont pas non plus une création de patrimoine automatique : un euro de
 * travaux ne vaut un euro de valeur que si le marché le reconnaît, et cette reconnaissance
 * est une hypothèse DÉCLARÉE, jamais un postulat du moteur.
 */
export function worksScenario(
  view: RealEstateAssetView,
  input: WorksScenarioInput,
  assumptions: RealEstateScenarioAssumptions,
  asOfDate: string,
): WorksScenarioResult {
  const share = view.asset.ownershipShare;
  const uplift =
    input.annualRentUplift === null
      ? unknown(`RENT_UPLIFT_UNDECLARED:${view.asset.id}`)
      : share === null
        ? unknown(`OWNERSHIP_SHARE_MISSING:${view.asset.id}`)
        : known(input.annualRentUplift * share);
  const worksFinancing: RealEstateAssetView["financing"] =
    input.financing === null
      ? view.financing
      : [
          ...view.financing,
          (() => {
            const loan = syntheticLoan(input.financing, `works:${view.asset.id}`);
            return {
              link: {
                id: `works-link:${view.asset.id}`,
                propertyId: view.asset.id,
                liabilityId: loan.id,
                allocationShare: 1,
                notes: null,
                provenance: SYNTHETIC_PROVENANCE,
              },
              liability: loan,
              allocationShare: 1,
              outstandingWhole: known(loan.currentBalance),
              attributedOutstanding: known(loan.currentBalance),
              attributedOriginalPrincipal: known(loan.principal),
              attributedDebtService12m: view.debt,
              debtFlags: buildLoanTimeline(loan, asOfDate).flags,
            };
          })(),
        ];
  const years = projectYears(view, assumptions, asOfDate, {
    financing: worksFinancing,
    noiAdjustment: uplift,
  });
  const financedAmount = input.financing?.principal ?? 0;
  const financingCurrency = input.financing?.currency ?? view.reportingCurrency;
  const cashOutlay: DerivedAmount =
    financingCurrency.toUpperCase() !== view.reportingCurrency.toUpperCase()
      ? unknown(
          `FUTURE_FX_UNAVAILABLE:${financingCurrency}/${view.reportingCurrency}:works:${view.asset.id}`,
        )
      : financedAmount > input.capexAmount + 0.01
        ? unknown(`WORKS_FINANCING_EXCEEDS_CAPEX:${view.asset.id}`)
        : known(Math.max(0, input.capexAmount - financedAmount));
  const terminalEquity =
    years.at(-1)?.attributedEquity ?? unknown(`HORIZON_EMPTY:${view.asset.id}`);
  const base = finalise({
    kind: "WORKS",
    label: "Réaliser les travaux",
    assetId: view.asset.id,
    horizonYears: assumptions.horizonYears,
    years,
    initialCashFlow: times(cashOutlay, -1),
    terminalCashFlow: terminalEquity,
    economicFinancingCost: add(...years.map((year) => year.attributedEconomicFinancingCost)),
    principalRepaid: add(...years.map((year) => year.attributedPrincipalRepaid)),
    discountRate: assumptions.discountRate,
    notes: [
      "Les travaux augmentent la base de coût du bien : ce n'est pas une charge d'exploitation.",
      "Un euro de travaux ne vaut pas automatiquement un euro de valeur : la hausse de valeur est une hypothèse déclarée, pas un résultat du moteur.",
      ...(financedAmount > 0 && cashOutlay.value !== null
        ? [
            "Part financée par le crédit exclue de l'apport : un coût financé n'est pas une contribution en fonds propres.",
          ]
        : []),
    ],
  });
  return {
    ...base,
    kind: "WORKS",
    capexAmount: input.capexAmount,
    marginalYieldOnCapex:
      input.capexAmount <= 0
        ? unknown(`CAPEX_NOT_POSITIVE:${view.asset.id}`)
        : uplift.value === null
          ? uplift
          : known(uplift.value / input.capexAmount),
    valueCreation:
      input.valueUplift === null
        ? unknown(`VALUE_UPLIFT_UNDECLARED:${view.asset.id}`)
        : known(input.valueUplift - input.capexAmount),
  };
}

// ─── Underwriting d'un projet non détenu ──────────────────────────────────────────────

/**
 * Étude d'un bien que l'on ne détient PAS encore.
 *
 * Ce n'est pas une vue patrimoniale : rien ici n'entre au bilan, aucun euro n'est ajouté
 * au patrimoine net, et le résultat porte la provenance `USER_ASSUMPTION` de bout en bout.
 * C'est la contrepartie prospective du moteur de faits, et elle utilise le MÊME moteur
 * d'amortissement : le crédit envisagé passe par `syntheticLoan` puis par le Debt Engine.
 *
 * Tous les termes sont fournis par l'appelant. Aucun n'a de valeur par défaut : un terme
 * absent rend non calculable ce qui en dépend.
 */
export interface ProspectiveRealEstateInput {
  /** Date d'ancrage du projet. Sert de première échéance et d'origine des périodes. */
  startDate: string;
  currency: string;
  purchasePrice: number;
  acquisitionCosts: number;
  works: number;
  /** Crédit envisagé. `null` = achat comptant. */
  loan: SyntheticLoanTerms | null;
  /** Loyer brut annuel attendu. `null` = non déclaré. */
  annualGrossRent: number | null;
  /** Vacance attendue, dans [0,1]. `null` = non déclarée. */
  vacancyRate: number | null;
  /** Σ des charges annuelles attendues. `null` = non déclarées. */
  annualOperatingCosts: number | null;
  assumptions: RealEstateScenarioAssumptions;
}

export interface ProspectiveRealEstateResult {
  /** Prix + frais + travaux. Coût de revient du projet. */
  totalProjectCost: number;
  /**
   * Trésorerie réellement engagée : coût total − capital emprunté. Un coût financé par le
   * crédit n'est pas un apport en fonds propres.
   */
  equityEngaged: DerivedAmount;
  /** Mensualité totale du crédit envisagé, produite par le Debt Engine. */
  monthlyPayment: DerivedAmount;
  /** Loyer effectif annuel après vacance déclarée. */
  effectiveRent: DerivedAmount;
  netOperatingIncome: DerivedAmount;
  grossYieldOnCost: DerivedAmount;
  netYieldOnCost: DerivedAmount;
  years: RealEstateScenarioYear[];
  /** Σ du coût économique du crédit sur l'horizon. Jamais le total des mensualités. */
  economicFinancingCost: DerivedAmount;
  principalRepaid: DerivedAmount;
  /**
   * Coût économique du crédit s'il était CONSERVÉ jusqu'à son terme. Distinct du précédent :
   * un projet cédé à l'horizon ne paie pas les intérêts des années suivantes.
   */
  fullTermEconomicFinancingCost: DerivedAmount;
  /** Encours restant à l'horizon, projeté par le Debt Engine. */
  outstandingAtHorizon: DerivedAmount;
  /** Valeur du bien à l'horizon, sous l'hypothèse de croissance déclarée. */
  valueAtHorizon: DerivedAmount;
  /** Produit net de cession à l'horizon, avant toute fiscalité. */
  exitProceedsBeforeTax: DerivedAmount;
  equityIrr: number | null;
  equityNpv: DerivedAmount;
  discountRate: number;
  debtServiceCoverage: DerivedAmount;
  loanToCost: DerivedAmount;
  blockers: string[];
  notes: string[];
}

export function underwriteProspectiveRealEstate(
  input: ProspectiveRealEstateInput,
): ProspectiveRealEstateResult {
  const notes = [
    "Étude prospective : aucun euro n'entre au patrimoine tant que l'acquisition n'est pas enregistrée comme fait.",
    "Aucune fiscalité n'est appliquée : ni revenus fonciers, ni plus-value de cession.",
    "Le crédit envisagé passe par le Debt Engine : le moteur d'amortissement est le même que celui des prêts réels.",
  ];
  const totalProjectCost = input.purchasePrice + input.acquisitionCosts + input.works;
  const loan = input.loan === null ? null : syntheticLoan(input.loan, "prospective-loan");
  const borrowed = loan?.principal ?? 0;
  const loanCurrency = loan?.currency ?? input.currency;
  const currenciesMatch = loanCurrency.toUpperCase() === input.currency.toUpperCase();
  const prospectiveFxBlocker = `FUTURE_FX_UNAVAILABLE:${loanCurrency}/${input.currency}:prospective-loan`;
  const financingExceedsProject = borrowed > totalProjectCost + 0.01;
  const equityEngaged = currenciesMatch
    ? financingExceedsProject
      ? unknown("FINANCING_EXCEEDS_PROJECT_COST")
      : known(Math.max(0, totalProjectCost - borrowed))
    : unknown(prospectiveFxBlocker);
  if (!currenciesMatch) {
    notes.push(
      `Projet en ${input.currency} et crédit en ${loanCurrency} : aucune courbe de change future fiable n'est déclarée. Apport, service de dette, equity et rentabilité restent non calculables.`,
    );
  } else if (financingExceedsProject) {
    notes.push(
      "Le financement dépasse le coût total du projet : l'excédent n'est pas attribuable sans destination déclarée. Apport et rentabilité restent non calculables.",
    );
  } else if (borrowed > input.purchasePrice) {
    notes.push(
      "Le financement dépasse le prix d'achat : il couvre aussi les frais ou les travaux, ce qui réduit l'apport réel sans réduire le coût de revient.",
    );
  }

  const anchor = input.startDate;
  // Date d'observation du Debt Engine : la VEILLE du départ. Au moment de l'acquisition,
  // aucune échéance n'a encore été payée, donc toutes sont à venir. Prendre le départ
  // lui-même ferait passer la première échéance pour déjà exigible, et l'exclurait de la
  // projection d'encours tout en la comptant dans le service de dette.
  const observation = previousDay(anchor);
  const monthlyPayment =
    loan === null
      ? known(0)
      : !currenciesMatch
        ? unknown(prospectiveFxBlocker)
        : (() => {
            const { start, end } = monthBounds(loan.firstPaymentDate);
            const first = debtServiceBreakdownForPeriod([loan], observation, start, end);
            return known(first.totalCashOut);
          })();

  const effectiveRent: DerivedAmount =
    input.annualGrossRent === null
      ? unknown("ANNUAL_GROSS_RENT_UNDECLARED")
      : input.vacancyRate === null
        ? unknown("VACANCY_RATE_UNDECLARED")
        : known(input.annualGrossRent * (1 - input.vacancyRate));
  const operatingCosts =
    input.annualOperatingCosts === null
      ? unknown("ANNUAL_OPERATING_COSTS_UNDECLARED")
      : known(input.annualOperatingCosts);
  const netOperatingIncome = minus(effectiveRent, operatingCosts);

  const debtOverWindow = (start: string, end: string) => {
    if (loan === null) return { cashOut: known(0), economicCost: known(0), principal: known(0) };
    if (!currenciesMatch) {
      const missing = unknown(prospectiveFxBlocker);
      return { cashOut: missing, economicCost: missing, principal: missing };
    }
    const breakdown = debtServiceBreakdownForPeriod([loan], observation, start, end);
    return {
      cashOut: known(breakdown.totalCashOut),
      economicCost: known(breakdown.economicCost),
      principal: known(breakdown.principal),
    };
  };

  const years: RealEstateScenarioYear[] = Array.from(
    { length: input.assumptions.horizonYears },
    (_, index) => {
      const year = index + 1;
      const { start, end } = scenarioYearWindow(anchor, year, false);
      const debt = debtOverWindow(start, end);
      const noi =
        input.assumptions.annualRentGrowth === null
          ? unknown("RENT_GROWTH_UNDECLARED")
          : times(netOperatingIncome, Math.pow(1 + input.assumptions.annualRentGrowth, year - 1));
      const value =
        input.assumptions.annualValueGrowth === null
          ? unknown("VALUE_GROWTH_UNDECLARED")
          : known(input.purchasePrice * Math.pow(1 + input.assumptions.annualValueGrowth, year));
      const outstanding =
        loan === null
          ? known(0)
          : !currenciesMatch
            ? unknown(prospectiveFxBlocker)
            : known(outstandingBalanceAt(loan, observation, end));
      return {
        year,
        periodStart: start,
        periodEnd: end,
        attributedNetOperatingIncome: noi,
        attributedCashDebtService: debt.cashOut,
        attributedEconomicFinancingCost: debt.economicCost,
        attributedPrincipalRepaid: debt.principal,
        equityCashFlow: minus(noi, debt.cashOut),
        attributedValue: value,
        attributedOutstanding: outstanding,
        attributedEquity: minus(value, outstanding),
      };
    },
  );

  const horizonEnd = years.at(-1)?.periodEnd ?? anchor;
  const outstandingAtHorizon =
    loan === null
      ? known(0)
      : !currenciesMatch
        ? unknown(prospectiveFxBlocker)
        : known(outstandingBalanceAt(loan, observation, horizonEnd));
  const valueAtHorizon = years.at(-1)?.attributedValue ?? unknown("HORIZON_EMPTY");
  const sellingCosts =
    input.assumptions.sellingCostsRate === null
      ? unknown("SELLING_COSTS_UNDECLARED")
      : times(valueAtHorizon, input.assumptions.sellingCostsRate);
  const exitProceedsBeforeTax = minus(minus(valueAtHorizon, sellingCosts), outstandingAtHorizon);
  const fullTermEconomicFinancingCost =
    loan === null
      ? known(0)
      : !currenciesMatch
        ? unknown(prospectiveFxBlocker)
        : known(
            debtServiceBreakdownForPeriod([loan], observation, anchor, loan.maturityDate)
              .economicCost,
          );
  if (loan !== null && horizonEnd < loan.maturityDate) {
    notes.push(
      "Horizon antérieur à la maturité du crédit : les intérêts postérieurs à la sortie ne sont pas payés. Le coût sur l'horizon et le coût à terme sont deux montants distincts.",
    );
  }

  const periodic = years.map((year) => year.equityCashFlow);
  const lastIndex = periodic.length - 1;
  const withExit = periodic.map((flow, index) =>
    index === lastIndex ? add(flow, exitProceedsBeforeTax) : flow,
  );
  const series = cashFlowSeries([times(equityEngaged, -1), ...withExit]);
  const firstYearDebtService = years[0]?.attributedCashDebtService ?? known(0);
  const blockers = [
    ...new Set([
      ...netOperatingIncome.blockers,
      ...equityEngaged.blockers,
      ...exitProceedsBeforeTax.blockers,
      ...periodic.flatMap((flow) => flow.blockers),
    ]),
  ];

  return {
    totalProjectCost,
    equityEngaged,
    monthlyPayment,
    effectiveRent,
    netOperatingIncome,
    grossYieldOnCost:
      totalProjectCost <= 0
        ? unknown("PROJECT_COST_NOT_POSITIVE")
        : input.annualGrossRent === null
          ? unknown("ANNUAL_GROSS_RENT_UNDECLARED")
          : known(input.annualGrossRent / totalProjectCost),
    netYieldOnCost:
      totalProjectCost <= 0
        ? unknown("PROJECT_COST_NOT_POSITIVE")
        : netOperatingIncome.value === null
          ? netOperatingIncome
          : known(netOperatingIncome.value / totalProjectCost),
    years,
    economicFinancingCost: add(...years.map((year) => year.attributedEconomicFinancingCost)),
    principalRepaid: add(...years.map((year) => year.attributedPrincipalRepaid)),
    fullTermEconomicFinancingCost,
    outstandingAtHorizon,
    valueAtHorizon,
    exitProceedsBeforeTax,
    equityIrr: series === null ? null : irr(series),
    equityNpv:
      series === null
        ? { value: null, blockers }
        : known(npv(input.assumptions.discountRate, series)),
    discountRate: input.assumptions.discountRate,
    debtServiceCoverage:
      firstYearDebtService.value === null || firstYearDebtService.value <= 0
        ? unknown("NO_DEBT_SERVICE")
        : netOperatingIncome.value === null
          ? netOperatingIncome
          : known(netOperatingIncome.value / firstYearDebtService.value),
    loanToCost:
      totalProjectCost <= 0
        ? unknown("PROJECT_COST_NOT_POSITIVE")
        : !currenciesMatch
          ? unknown(prospectiveFxBlocker)
          : known(borrowed / totalProjectCost),
    blockers,
    notes,
  };
}
