import { buildForwardSchedule, addMonths, monthBounds } from "@/lib/engine/debt";
import type {
  AnnualBalanceSheetPoint,
  DashboardState,
  Liability,
  LoanScheduleEntry,
} from "@/lib/types";

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
  /** Comptes bancaires et livrets. Peut être négatif si un compte est à découvert. */
  bankCash: number;
  /** Positions non-cash logées dans les enveloppes d'investissement. */
  marketInvestedAssets: number;
  /** Positions `isCash` internes aux enveloppes. Aucune exposition de marché. */
  investmentCash: number;
  /** Solde d'enveloppe non expliqué par des positions. Aucune exposition connue. */
  otherFinancialAssets: number;
  grossFinancialAssets: number;
  loanBalance: number;
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
  loanBalance: number;
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
 */
export function buildOpeningBalanceSheet(state: DashboardState): OpeningBalanceSheet {
  const flags: string[] = [];
  const isBankLike = (type: string) => type === "BANK" || type === "SAVINGS";
  const bankAccounts = state.accounts.filter((account) => isBankLike(account.type));
  const envelopeAccounts = state.accounts.filter((account) => !isBankLike(account.type));
  const envelopeIds = new Set(envelopeAccounts.map((account) => account.id));

  const bankCash = bankAccounts.reduce((sum, account) => sum + account.balance, 0);
  const envelopeTotal = envelopeAccounts.reduce((sum, account) => sum + account.balance, 0);

  const envelopePositions = state.positions.filter((position) =>
    envelopeIds.has(position.accountId),
  );
  const marketInvestedAssets = envelopePositions
    .filter((position) => !position.isCash)
    .reduce((sum, position) => sum + position.value, 0);
  const investmentCash = envelopePositions
    .filter((position) => position.isCash)
    .reduce((sum, position) => sum + position.value, 0);
  // Reliquat du solde d'enveloppe que les positions n'expliquent pas. Aucune exposition
  // de marché ne lui est prêtée : il reste constant nominalement.
  const otherFinancialAssets = envelopeTotal - marketInvestedAssets - investmentCash;

  const orphanPositions = state.positions.filter(
    (position) => !envelopeIds.has(position.accountId),
  );
  if (orphanPositions.length) {
    flags.push(
      `${orphanPositions.length} position(s) rattachée(s) à un compte non-enveloppe : exposition non répartie.`,
    );
  }
  if (otherFinancialAssets < -TOLERANCE) {
    flags.push(
      `Les positions dépassent le solde déclaré des enveloppes de ${Math.abs(otherFinancialAssets).toFixed(2)} € : réconciliation ouverte.`,
    );
  }

  const grossFinancialAssets =
    bankCash + marketInvestedAssets + investmentCash + otherFinancialAssets;
  const loanBalance = state.liabilities.reduce(
    (sum, liability) => sum + liability.currentBalance,
    0,
  );
  const difference = grossFinancialAssets - state.metrics.grossAssets;
  if (Math.abs(difference) > TOLERANCE) {
    flags.push(
      `Réconciliation du bilan d'ouverture : ${difference.toFixed(2)} € d'écart avec les actifs bruts du cockpit.`,
    );
  }

  return {
    date: state.asOfDate,
    bankCash,
    marketInvestedAssets,
    investmentCash,
    otherFinancialAssets,
    grossFinancialAssets,
    loanBalance,
    fundingGap: 0,
    netWorth: grossFinancialAssets - loanBalance,
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

interface DebtMonth {
  interest: number;
  /**
   * Intérêt couru non décaissé, ajouté au capital restant dû. Il ne touche pas la
   * trésorerie mais alourdit la dette : l'ignorer ferait stagner l'encours pendant un
   * différé total et laisserait le patrimoine net inchangé alors qu'il baisse.
   */
  capitalisedInterest: number;
  /**
   * Frais incorporés au financement : aucun décaissement, mais l'encours augmente. Même
   * mécanique que l'intérêt capitalisé, et même piège s'il n'atteint pas le bilan.
   */
  capitalisedCharges: number;
  principal: number;
  insurance: number;
  fees: number;
  cashOut: number;
}

const NO_DEBT: DebtMonth = {
  interest: 0,
  capitalisedInterest: 0,
  capitalisedCharges: 0,
  principal: 0,
  insurance: 0,
  fees: 0,
  cashOut: 0,
};

/**
 * Échéances exigibles par mois projeté, issues du SEUL échéancier forward : le capital
 * déjà remboursé n'est jamais rejoué contre l'encours observé.
 */
export function buildDebtCalendar(
  liabilities: Liability[],
  asOfDate: string,
  months: number,
): DebtMonth[] {
  const entries: LoanScheduleEntry[] = liabilities.flatMap(
    (liability) => buildForwardSchedule(liability, asOfDate).entries,
  );
  const calendar: DebtMonth[] = [{ ...NO_DEBT }];
  for (let monthIndex = 1; monthIndex <= months; monthIndex += 1) {
    const { start, end } = projectedMonthWindow(asOfDate, monthIndex);
    const due = entries.filter((entry) => entry.dueDate >= start && entry.dueDate <= end);
    const month: DebtMonth = { ...NO_DEBT };
    for (const entry of due) {
      month.interest += entry.interest;
      month.capitalisedInterest += entry.capitalisedInterest;
      month.capitalisedCharges += entry.capitalisedCharges;
      month.principal += entry.principal;
      month.insurance += entry.insurance;
      month.fees += entry.fees;
      month.cashOut += entry.totalCashOut;
    }
    calendar.push(month);
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
    loanBalance: opening.loanBalance,
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
  debt: DebtMonth,
  assumptions: MonthlyScenarioAssumptions,
  marketReturnRate: number,
): MonthlyFinancialState {
  const flags: string[] = [];
  const openingBankCash = previous.bankCash;
  const openingMarket = previous.marketInvestedAssets;
  const openingInvestmentCash = previous.investmentCash;
  const openingOther = previous.otherFinancialAssets;
  const openingLoan = previous.loanBalance;
  const openingFundingGap = previous.fundingGap;
  const openingNetWorth = previous.netWorth;

  const operatingSurplus = assumptions.operatingSurplus;
  // Le service de dette est retranché explicitement : il n'est jamais absorbé par
  // l'hypothèse de surplus.
  const debtCashOut = debt.cashOut;
  const postDebtSurplus = operatingSurplus - debtCashOut;

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

  // ClosingDebt = OpeningDebt − PrincipalPaid + CapitalisedInterest + CapitalisedCharges.
  // Le capital remboursé éteint le passif ; l'intérêt capitalisé et les frais financés
  // l'augmentent sans qu'aucun euro ne sorte du compte.
  const loanBalance = Math.max(
    0,
    openingLoan - debt.principal + debt.capitalisedInterest + debt.capitalisedCharges,
  );
  const grossFinancialAssets =
    bankCash + marketInvestedAssets + openingInvestmentCash + openingOther;
  const netWorth = grossFinancialAssets - loanBalance - fundingGap;

  // Tout ce qui appauvrit : intérêt décaissé, intérêt capitalisé, frais financés, frais
  // décaissés, assurance. Le principal n'y figure jamais, il éteint un passif.
  const economicDebtCosts =
    debt.interest + debt.capitalisedInterest + debt.capitalisedCharges + debt.insurance + debt.fees;
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
    openingFundingGap,
    openingNetWorth,
    operatingSurplus,
    interestPaid: debt.interest,
    capitalisedInterestAccrued: debt.capitalisedInterest,
    capitalisedChargesAccrued: debt.capitalisedCharges,
    principalPaid: debt.principal,
    insurancePaid: debt.insurance,
    feesPaid: debt.fees,
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
    loanBalance,
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
  let cumulativeInterestPaid = 0;
  let cumulativePrincipalPaid = 0;
  for (const state of result.states) {
    cumulativeOperatingSurplus += state.operatingSurplus;
    cumulativeMarketPnL += state.marketPnL;
    cumulativeInterestPaid +=
      state.interestPaid + state.capitalisedInterestAccrued + state.insurancePaid + state.feesPaid;
    cumulativePrincipalPaid += state.principalPaid;
    if (state.monthIndex % 12 !== 0) continue;
    points.push({
      year: baseYear + state.monthIndex / 12,
      monthIndex: state.monthIndex,
      grossFinancialAssets: state.grossFinancialAssets,
      debt: state.loanBalance,
      fundingGap: state.fundingGap,
      netWorth: state.netWorth,
      bankCash: state.bankCash,
      marketInvestedAssets: state.marketInvestedAssets,
      cumulativeOperatingSurplus,
      cumulativeMarketPnL,
      cumulativeInterestPaid,
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
