import {
  buildForwardSchedule,
  addMonths,
  debtImpactFromEntries,
  monthBounds,
} from "@/lib/engine/debt";
import type { DebtConsequences, DebtServiceBreakdown } from "@/lib/engine/debt";
import type {
  AnnualBalanceSheetPoint,
  DashboardState,
  Liability,
  LoanScheduleEntry,
} from "@/lib/types";
import {
  canonicalBalanceSheetOf,
  knownEnvelopeCash,
  knownMarketExposure,
} from "@/lib/engine/balance-sheet-view";

/**
 * PERSONAL MONTHLY FINANCIAL MODEL
 *
 * Moteur central des projections de Léo Family Office. Il fait évoluer un BILAN mois par
 * mois — trésorerie, actifs exposés au marché, actifs financiers non exposés, dette — au
 * lieu de capitaliser un scalaire. Projection déterministe et Monte-Carlo partagent
 * exactement cette transition : seule la fonction de rendement mensuel change.
 *
 * PÉRIMÈTRE DE CE SPRINT : actifs financiers uniquement. Ni immobilier patrimonial, ni
 * business equity, ni fiscalité future, ni revenus de carrière.
 *
 * CONVENTION DE SURPLUS, arrêtée pour ce sprint
 * ---------------------------------------------
 * `scenario.monthlySavings` est interprété comme un
 *
 *     MONTHLY OPERATING SURPLUS BEFORE DEBT SERVICE
 *
 * c'est-à-dire le surplus disponible après revenus, fiscalité et dépenses de vie, mais
 * AVANT intérêts, principal, assurance et frais de prêt. Le service de dette est
 * retranché explicitement par le moteur.
 *
 * Motif : si le service de dette était déjà absorbé dans cette hypothèse, passer une
 * mensualité de 300 € à 700 € changerait l'encours sans changer la liquidité disponible,
 * ce qui romprait l'interconnexion que le produit cherche précisément à établir. Aucune
 * dette ne doit être implicitement absorbée dans une hypothèse exogène.
 *
 * Ce n'est pas encore un résultat de Career → Tax → Cash Flow. La colonne persistée
 * garde son nom `monthly_savings` pour éviter une migration inutile.
 *
 * CONVENTIONS COMPTABLES
 * ----------------------
 * - Le remboursement du principal est NEUTRE sur le patrimoine net : la trésorerie et le
 *   passif diminuent du même montant. Aucune écriture de compensation artificielle.
 * - Seuls intérêts, assurance et frais sont des coûts économiques.
 * - La performance de marché s'applique au capital d'OUVERTURE ; la contribution du mois
 *   est créditée en fin de mois et ne produit de rendement qu'à partir du mois suivant.
 * - Un actif financier dont l'exposition n'est pas connue ne reçoit aucun rendement.
 * - Le cash ne devient jamais négatif : le déficit non couvert devient un `fundingGap`,
 *   sans taux d'intérêt inventé.
 * - Le `fundingGap` est un besoin de financement, pas une ligne de crédit gratuite : tant
 *   qu'il subsiste, tout surplus disponible le résorbe AVANT la moindre contribution en
 *   cash ou en investissement. Son remboursement est neutre sur le patrimoine net, au même
 *   titre que le remboursement d'un principal.
 */

/** Bilan financier d'ouverture, dérivé de l'état du dossier à la date d'observation. */
export interface OpeningBalanceSheet {
  date: string;
  /** Cash bancaire positif disponible immédiatement. Un découvert est un passif séparé. */
  bankCash: number;
  /** Positions non-cash logées dans les enveloppes d'investissement. */
  marketInvestedAssets: number;
  /** Positions `isCash` internes aux enveloppes. Aucune exposition de marché. */
  investmentCash: number;
  /** Solde d'enveloppe non expliqué par des positions. Aucune exposition connue. */
  otherFinancialAssets: number;
  grossFinancialAssets: number;
  /**
   * Actifs NON financiers au bilan canonique : immobilier, et demain business equity. Ils
   * sont portés CONSTANTS sur toute la projection, faute de termes projetables — même
   * traitement que `otherLiabilityBalance`, et pour la même raison. Les faire disparaître
   * au mois 1 reviendrait à traiter un inconnu comme un zéro ; leur appliquer une
   * croissance reviendrait à inventer un rendement immobilier. La part non calculable
   * (valorisation ou quote-part manquante) est exclue et signalée.
   */
  nonFinancialAssets: number;
  loanBalance: number;
  /** Découverts et autres passifs sans échéancier ; constants faute de termes projetables. */
  otherLiabilityBalance: number;
  fundingGap: number;
  netWorth: number;
  flags: string[];
}

export interface MonthlyScenarioAssumptions {
  /** `scenario.monthlySavings`, lu comme surplus AVANT service de dette. */
  operatingSurplus: number;
  /** Part du surplus post-dette dirigée vers les actifs de marché, entre 0 et 1. */
  investmentAllocationRate: number;
  annualReturn: number;
  /** Année du choc daté, 1 = première année projetée. */
  shockYear: number | null;
  shockMagnitude: number | null;
}

/** Rendement mensuel de marché. Déterministe ou tiré au sort : le reste est identique. */
export type MarketReturnFn = (monthIndex: number) => number;

export interface MonthlyFinancialState {
  /** 0 = bilan d'ouverture observé, sans mouvement. */
  monthIndex: number;
  /** Dernier jour du mois représenté. */
  date: string;

  openingBankCash: number;
  openingMarketInvestedAssets: number;
  openingInvestmentCash: number;
  openingOtherFinancialAssets: number;
  openingGrossFinancialAssets: number;
  openingLoanBalance: number;
  openingOtherLiabilityBalance: number;
  openingFundingGap: number;
  openingNetWorth: number;

  operatingSurplus: number;
  interestPaid: number;
  /** Intérêt couru non décaissé sur le mois : hors trésorerie, mais bien un coût. */
  capitalisedInterestAccrued: number;
  /** Frais incorporés au financement sur le mois : hors trésorerie, mais bien un coût. */
  capitalisedChargesAccrued: number;
  principalPaid: number;
  insurancePaid: number;
  feesPaid: number;
  debtCashOut: number;
  postDebtSurplus: number;
  investmentContribution: number;
  cashContribution: number;
  /** Résorption du besoin de financement. Neutre sur le patrimoine net. */
  gapRepayment: number;
  /** Surplus réellement allouable, après résorption du besoin de financement. */
  surplusAfterGap: number;
  marketReturnRate: number;
  marketPnL: number;
  marketShockPnL: number;
  fundingGapChange: number;

  bankCash: number;
  marketInvestedAssets: number;
  investmentCash: number;
  otherFinancialAssets: number;
  grossFinancialAssets: number;
  /**
   * Actifs non financiers, portés constants depuis l'ouverture. Ils entrent dans le
   * patrimoine net projeté mais ne reçoivent aucun rendement : leur trajectoire n'est pas
   * modélisée, et LFO ne lui en invente pas une.
   */
  nonFinancialAssets: number;
  loanBalance: number;
  otherLiabilityBalance: number;
  fundingGap: number;
  netWorth: number;

  /** Intérêts + assurance + frais. Seule composante économiquement coûteuse de la dette. */
  economicDebtCosts: number;
  netWorthChange: number;
  /** Écart entre variation constatée et attribution. Doit rester nul à l'arrondi près. */
  attributionResidual: number;
  /**
   * Sticky dès qu'un besoin de financement est apparu : la trajectoire reste calculable
   * mais partielle tant qu'aucun coût de financement n'est défini.
   */
  financingCostMissing: boolean;
  flags: string[];
}

export const FUNDING_GAP_FLAG = "FUNDING_GAP / financing terms missing";
export const FINANCING_COST_FLAG = "FINANCING_COST_MISSING";

export interface MonthlyModelInput {
  opening: OpeningBalanceSheet;
  liabilities: Liability[];
  assumptions: MonthlyScenarioAssumptions;
  months: number;
  marketReturn: MarketReturnFn;
}

export interface MonthlyModelResult {
  opening: OpeningBalanceSheet;
  /** `states[0]` est le bilan d'ouverture ; `states[m]` la clôture du mois m. */
  states: MonthlyFinancialState[];
}

const TOLERANCE = 0.01;

/**
 * Bilan d'ouverture. La convention de non-double-comptage du produit est conservée :
 * le solde des comptes est la source de vérité du bilan, les positions servent seulement
 * à répartir l'exposition de ce solde.
 *
 * Par construction bankCash + marketInvestedAssets + investmentCash + otherFinancialAssets
 * = Σ soldes de comptes = grossAssets. Les positions ne créent jamais de valeur.
 *
 * La qualité de composition est lue ENVELOPPE PAR ENVELOPPE : une enveloppe incohérente
 * verse sa valeur comptable dans `otherFinancialAssets` sans exposition, les enveloppes
 * réconciliées conservent la leur. Aucun portefeuille n'est ramené à zéro parce qu'une
 * seule enveloppe est en défaut.
 */
export function buildOpeningBalanceSheet(state: DashboardState): OpeningBalanceSheet {
  const canonical = canonicalBalanceSheetOf(state);
  // La projection a besoin des actifs FINANCIERS et du passif : ce sont les seules
  // grandeurs qu'elle fait évoluer. Un actif non financier non valorisable n'empêche pas
  // de projeter la trajectoire financière : il en est exclu et signalé, il ne la bloque pas.
  if (canonical.financialAssets.value === null || canonical.totalLiabilities.value === null) {
    throw new Error(
      `Projection impossible : bilan canonique ${canonical.netWorth.status} (${canonical.netWorth.blockers.join(", ")})`,
    );
  }
  const flags = [...canonical.quality.flags];
  const bankCash = canonical.immediateCash.value ?? 0;
  // L'exposition est retenue ENVELOPPE PAR ENVELOPPE. Une enveloppe dont la composition
  // dépasse la valeur comptable, ou dont une conversion manque, n'est pas projetée au
  // prorata — ce serait inventer une exposition — mais elle n'annule pas pour autant
  // l'exposition connue des autres : sa valeur comptable reste entière dans la poche non
  // exposée, et le portefeuille projeté conserve tout ce qui est réellement réconcilié.
  const marketInvestedAssets = knownMarketExposure(canonical).knownValue;
  const investmentCash = knownEnvelopeCash(canonical).knownValue;
  const grossFinancialAssets = canonical.financialAssets.value;
  const otherFinancialAssets =
    grossFinancialAssets - bankCash - marketInvestedAssets - investmentCash;
  const loanBalance = canonical.contractualDebt.value ?? 0;
  const otherLiabilityBalance = canonical.totalLiabilities.value - loanBalance;
  if (otherLiabilityBalance > TOLERANCE) flags.push("LIABILITY_PROJECTION_TERMS_MISSING");

  // Part non financière du bilan : actifs bruts − actifs financiers. Seule la part
  // CONNUE est retenue ; un bien dont la valeur n'est pas calculable n'entre pas dans le
  // patrimoine projeté, et le drapeau dit qu'il en manque une.
  const nonFinancialAssets =
    canonical.grossAssets.knownValue - canonical.financialAssets.knownValue;
  if (canonical.grossAssets.status !== "COMPLETE") {
    flags.push("NON_FINANCIAL_ASSET_VALUE_PARTIAL");
  }
  if (Math.abs(nonFinancialAssets) > TOLERANCE) {
    flags.push("NON_FINANCIAL_ASSET_PROJECTION_TERMS_MISSING");
  }
  // Le patrimoine net d'ouverture est reconstruit avec les mêmes termes que ceux des mois
  // suivants. Reprendre `canonical.netWorth` ferait apparaître, entre le mois 0 et le mois
  // 1, une variation qui n'est qu'un changement de périmètre.
  const netWorth = grossFinancialAssets + nonFinancialAssets - loanBalance - otherLiabilityBalance;

  return {
    date: state.asOfDate,
    bankCash,
    marketInvestedAssets,
    investmentCash,
    otherFinancialAssets,
    grossFinancialAssets,
    nonFinancialAssets,
    loanBalance,
    otherLiabilityBalance,
    fundingGap: 0,
    netWorth,
    flags,
  };
}

/** Bornes du mois projeté `monthIndex`. Le mois 1 absorbe la fin du mois d'observation. */
export function projectedMonthWindow(asOfDate: string, monthIndex: number) {
  const anchor = addMonths(asOfDate, monthIndex);
  const { start, end } = monthBounds(anchor);
  return { start: monthIndex <= 1 ? nextDay(asOfDate) : start, end };
}

function nextDay(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export type MonthlyDebtImpact = DebtConsequences &
  Partial<
    Pick<
      DebtServiceBreakdown,
      "principal" | "interest" | "capitalisedInterest" | "capitalisedCharges" | "insurance" | "fees"
    >
  >;

const NO_DEBT = debtImpactFromEntries([]);

/**
 * Échéances exigibles par mois projeté, issues du SEUL échéancier forward : le capital
 * déjà remboursé n'est jamais rejoué contre l'encours observé.
 */
export function buildDebtCalendar(
  liabilities: Liability[],
  asOfDate: string,
  months: number,
): DebtServiceBreakdown[] {
  const schedules = liabilities.map((liability) => ({
    liability,
    schedule: buildForwardSchedule(liability, asOfDate),
  }));
  const entries: LoanScheduleEntry[] = schedules.flatMap(({ schedule }) => schedule.entries);
  const metadata = {
    sourceLiabilityIds: liabilities.map((liability) => liability.id),
    flags: schedules.flatMap(({ schedule }) => schedule.flags),
    dataKinds: schedules.map(({ schedule }) => schedule.kind),
  };
  const calendar: DebtServiceBreakdown[] = [debtImpactFromEntries([], metadata)];
  for (let monthIndex = 1; monthIndex <= months; monthIndex += 1) {
    const { start, end } = projectedMonthWindow(asOfDate, monthIndex);
    const due = entries.filter((entry) => entry.dueDate >= start && entry.dueDate <= end);
    calendar.push(debtImpactFromEntries(due, metadata));
  }
  return calendar;
}

export function monthlyReturnFromAnnual(annualReturn: number): number {
  return Math.pow(1 + annualReturn, 1 / 12) - 1;
}

function openingState(opening: OpeningBalanceSheet): MonthlyFinancialState {
  return {
    monthIndex: 0,
    date: opening.date,
    openingBankCash: opening.bankCash,
    openingMarketInvestedAssets: opening.marketInvestedAssets,
    openingInvestmentCash: opening.investmentCash,
    openingOtherFinancialAssets: opening.otherFinancialAssets,
    openingGrossFinancialAssets: opening.grossFinancialAssets,
    openingLoanBalance: opening.loanBalance,
    openingOtherLiabilityBalance: opening.otherLiabilityBalance,
    openingFundingGap: opening.fundingGap,
    openingNetWorth: opening.netWorth,
    operatingSurplus: 0,
    interestPaid: 0,
    capitalisedInterestAccrued: 0,
    capitalisedChargesAccrued: 0,
    principalPaid: 0,
    insurancePaid: 0,
    feesPaid: 0,
    debtCashOut: 0,
    postDebtSurplus: 0,
    investmentContribution: 0,
    cashContribution: 0,
    gapRepayment: 0,
    surplusAfterGap: 0,
    marketReturnRate: 0,
    marketPnL: 0,
    marketShockPnL: 0,
    fundingGapChange: 0,
    bankCash: opening.bankCash,
    marketInvestedAssets: opening.marketInvestedAssets,
    investmentCash: opening.investmentCash,
    otherFinancialAssets: opening.otherFinancialAssets,
    grossFinancialAssets: opening.grossFinancialAssets,
    nonFinancialAssets: opening.nonFinancialAssets,
    loanBalance: opening.loanBalance,
    otherLiabilityBalance: opening.otherLiabilityBalance,
    fundingGap: opening.fundingGap,
    netWorth: opening.netWorth,
    economicDebtCosts: 0,
    netWorthChange: 0,
    attributionResidual: 0,
    financingCostMissing: opening.fundingGap > 0,
    flags: opening.flags,
  };
}

/**
 * Transition d'un mois. Ordre imposé :
 * ouverture → surplus → service de dette → surplus post-dette → allocation →
 * performance de marché → clôture.
 */
export function advanceMonth(
  previous: MonthlyFinancialState,
  monthIndex: number,
  date: string,
  debt: MonthlyDebtImpact,
  assumptions: MonthlyScenarioAssumptions,
  marketReturnRate: number,
): MonthlyFinancialState {
  const flags: string[] = [];
  const openingBankCash = previous.bankCash;
  const openingMarket = previous.marketInvestedAssets;
  const openingInvestmentCash = previous.investmentCash;
  const openingOther = previous.otherFinancialAssets;
  const openingLoan = previous.loanBalance;
  const openingOtherLiability = previous.otherLiabilityBalance;
  const openingFundingGap = previous.fundingGap;
  const openingNetWorth = previous.netWorth;

  const operatingSurplus = assumptions.operatingSurplus;
  // Le service de dette est retranché explicitement : il n'est jamais absorbé par
  // l'hypothèse de surplus.
  const debtCashOut = Math.max(0, -debt.cashImpact);
  const postDebtSurplus = operatingSurplus + debt.cashImpact;

  const rate = Math.min(1, Math.max(0, assumptions.investmentAllocationRate));
  let bankCash = openingBankCash;
  let fundingGap = openingFundingGap;
  let gapRepayment = 0;
  let fundingGapChange = 0;
  let investmentContribution = 0;
  let cashContribution = 0;
  let surplusAfterGap = 0;

  // Cas défensif : trésorerie et besoin de financement ne peuvent pas coexister. La
  // transition maintient l'invariant, donc cet état ne peut venir que d'un bilan
  // d'ouverture incohérent. On le résorbe et on le signale plutôt que de le laisser vivre.
  if (fundingGap > 0 && bankCash > 0) {
    const settled = Math.min(fundingGap, bankCash);
    fundingGap -= settled;
    bankCash -= settled;
    gapRepayment += settled;
    flags.push("INCONSISTENT_OPENING / cash et besoin de financement simultanés");
  }

  if (postDebtSurplus < 0) {
    // Déficit : la trésorerie encaisse d'abord, le reliquat devient un besoin de
    // financement. Aucun investissement n'est effectué ce mois-ci.
    const covered = Math.min(bankCash, -postDebtSurplus);
    bankCash -= covered;
    cashContribution = -covered;
    const uncovered = -postDebtSurplus - covered;
    if (uncovered > 0) {
      fundingGap += uncovered;
      fundingGapChange = uncovered;
      flags.push(FUNDING_GAP_FLAG);
    }
  } else {
    // Surplus : le besoin de financement passe AVANT toute allocation. On n'investit pas
    // un euro tant qu'un engagement reste non financé, et on n'emprunte jamais
    // implicitement à taux nul pour investir à un taux positif.
    const repaid = Math.min(fundingGap, postDebtSurplus);
    fundingGap -= repaid;
    gapRepayment += repaid;
    surplusAfterGap = postDebtSurplus - repaid;
    investmentContribution = surplusAfterGap * rate;
    cashContribution = surplusAfterGap - investmentContribution;
    bankCash += cashContribution;
  }

  // Performance appliquée au capital d'ouverture : la contribution du mois ne produit de
  // rendement qu'à partir du mois suivant.
  const returnPnL = openingMarket * marketReturnRate;
  const marketBeforeShock = Math.max(0, openingMarket + returnPnL + investmentContribution);
  const shockApplies =
    assumptions.shockYear !== null &&
    assumptions.shockMagnitude !== null &&
    monthIndex === assumptions.shockYear * 12;
  const marketShockPnL = shockApplies ? marketBeforeShock * (assumptions.shockMagnitude ?? 0) : 0;
  const marketInvestedAssets = Math.max(0, marketBeforeShock + marketShockPnL);
  const marketPnL = marketInvestedAssets - openingMarket - investmentContribution;

  const financingCostMissing =
    previous.financingCostMissing || fundingGap > 0 || fundingGapChange > 0;
  if (financingCostMissing) flags.push(FINANCING_COST_FLAG);

  // Le Debt Engine fournit la variation canonique du passif. Cette transition ignore
  // volontairement le produit ou l'événement qui l'a produite.
  const loanBalance = Math.max(0, openingLoan + debt.liabilityDelta);
  const grossFinancialAssets =
    bankCash + marketInvestedAssets + openingInvestmentCash + openingOther;
  // Les actifs non financiers restent au bilan projeté, à leur valeur d'ouverture. Ils ne
  // sont ni capitalisés ni effacés : leur trajectoire n'est pas modélisée, et le dire est
  // plus honnête que de la simuler.
  const netWorth =
    grossFinancialAssets +
    previous.nonFinancialAssets -
    loanBalance -
    openingOtherLiability -
    fundingGap;

  const economicDebtCosts = debt.economicCost;
  const netWorthChange = netWorth - openingNetWorth;
  // Attribution économique : le principal n'y figure pas, sa double jambe s'annule.
  const attribution = operatingSurplus - economicDebtCosts + marketPnL;

  return {
    monthIndex,
    date,
    openingBankCash,
    openingMarketInvestedAssets: openingMarket,
    openingInvestmentCash,
    openingOtherFinancialAssets: openingOther,
    openingGrossFinancialAssets: previous.grossFinancialAssets,
    openingLoanBalance: openingLoan,
    openingOtherLiabilityBalance: openingOtherLiability,
    openingFundingGap,
    openingNetWorth,
    operatingSurplus,
    interestPaid: debt.interest ?? 0,
    capitalisedInterestAccrued: debt.capitalisedInterest ?? 0,
    capitalisedChargesAccrued: debt.capitalisedCharges ?? 0,
    principalPaid: Math.max(0, -debt.principalMovement),
    insurancePaid: debt.insurance ?? 0,
    feesPaid: debt.fees ?? 0,
    debtCashOut,
    postDebtSurplus,
    investmentContribution,
    cashContribution,
    gapRepayment,
    surplusAfterGap,
    marketReturnRate,
    marketPnL,
    marketShockPnL,
    fundingGapChange,
    bankCash,
    marketInvestedAssets,
    investmentCash: openingInvestmentCash,
    otherFinancialAssets: openingOther,
    grossFinancialAssets,
    nonFinancialAssets: previous.nonFinancialAssets,
    loanBalance,
    otherLiabilityBalance: openingOtherLiability,
    fundingGap,
    netWorth,
    economicDebtCosts,
    netWorthChange,
    attributionResidual: netWorthChange - attribution,
    financingCostMissing,
    flags,
  };
}

/** Déroule le bilan mois par mois. Unique transition consommée par tous les modes. */
export function runMonthlyModel(input: MonthlyModelInput): MonthlyModelResult {
  const calendar = buildDebtCalendar(input.liabilities, input.opening.date, input.months);
  const states: MonthlyFinancialState[] = [openingState(input.opening)];
  for (let monthIndex = 1; monthIndex <= input.months; monthIndex += 1) {
    const { end } = projectedMonthWindow(input.opening.date, monthIndex);
    states.push(
      advanceMonth(
        states[monthIndex - 1],
        monthIndex,
        end,
        calendar[monthIndex] ?? NO_DEBT,
        input.assumptions,
        input.marketReturn(monthIndex),
      ),
    );
  }
  return { opening: input.opening, states };
}

export type { AnnualBalanceSheetPoint } from "@/lib/types";

/** Réduction annuelle du déroulé mensuel, cumuls inclus. Aucun calcul parallèle. */
export function toAnnualPoints(result: MonthlyModelResult): AnnualBalanceSheetPoint[] {
  const baseYear = Number(result.opening.date.slice(0, 4));
  const points: AnnualBalanceSheetPoint[] = [];
  let cumulativeOperatingSurplus = 0;
  let cumulativeMarketPnL = 0;
  let cumulativeCashInterestPaid = 0;
  let cumulativeCapitalisedInterest = 0;
  let cumulativeInsurancePaid = 0;
  let cumulativeCashFeesPaid = 0;
  let cumulativeCapitalisedCharges = 0;
  let cumulativeEconomicDebtCosts = 0;
  let cumulativePrincipalPaid = 0;
  for (const state of result.states) {
    cumulativeOperatingSurplus += state.operatingSurplus;
    cumulativeMarketPnL += state.marketPnL;
    cumulativeCashInterestPaid += state.interestPaid;
    cumulativeCapitalisedInterest += state.capitalisedInterestAccrued;
    cumulativeInsurancePaid += state.insurancePaid;
    cumulativeCashFeesPaid += state.feesPaid;
    cumulativeCapitalisedCharges += state.capitalisedChargesAccrued;
    cumulativeEconomicDebtCosts += state.economicDebtCosts;
    cumulativePrincipalPaid += state.principalPaid;
    if (state.monthIndex % 12 !== 0) continue;
    points.push({
      year: baseYear + state.monthIndex / 12,
      monthIndex: state.monthIndex,
      grossFinancialAssets: state.grossFinancialAssets,
      debt: state.loanBalance + state.otherLiabilityBalance,
      fundingGap: state.fundingGap,
      netWorth: state.netWorth,
      bankCash: state.bankCash,
      marketInvestedAssets: state.marketInvestedAssets,
      cumulativeOperatingSurplus,
      cumulativeMarketPnL,
      cumulativeCashInterestPaid,
      cumulativeCapitalisedInterest,
      cumulativeInsurancePaid,
      cumulativeCashFeesPaid,
      cumulativeCapitalisedCharges,
      cumulativeEconomicDebtCosts,
      cumulativePrincipalPaid,
      financingCostMissing: state.financingCostMissing,
    });
  }
  return points;
}

export function scenarioAssumptions(scenario: {
  monthlySavings: number;
  investmentAllocationRate: number;
  annualReturn: number;
  shockYear: number | null;
  shockMagnitude: number | null;
}): MonthlyScenarioAssumptions {
  return {
    operatingSurplus: scenario.monthlySavings,
    investmentAllocationRate: scenario.investmentAllocationRate,
    annualReturn: scenario.annualReturn,
    shockYear: scenario.shockYear,
    shockMagnitude: scenario.shockMagnitude,
  };
}

/** Projection déterministe : rendement mensuel composé constant. */
export function runDeterministicModel(
  opening: OpeningBalanceSheet,
  liabilities: Liability[],
  assumptions: MonthlyScenarioAssumptions,
  months: number,
): MonthlyModelResult {
  const monthlyReturn = monthlyReturnFromAnnual(assumptions.annualReturn);
  return runMonthlyModel({
    opening,
    liabilities,
    assumptions,
    months,
    marketReturn: () => monthlyReturn,
  });
}
