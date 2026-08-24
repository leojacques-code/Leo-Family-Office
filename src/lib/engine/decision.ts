import { compoundReturn, realValue } from "@/lib/engine/financial";

export interface DebtVsInvestInput {
  /** Trésorerie réellement mobilisable. Le capital arbitré est borné par cette valeur. */
  availableCash: number;
  debtBalance: number;
  /** Taux annuel de la dette considérée. Jamais supposé nul. */
  debtRate: number;
  investmentReturn: number;
  volatility: number;
  /** Inflation du scénario sélectionné, jamais une constante d'écran. */
  inflation: number;
  years: number;
  /** MODEL_HEURISTIC / EXPERIMENTAL. Ne produit aucune conclusion à lui seul. */
  liquidityWeight?: number;
}

export interface DebtVsInvestResult {
  /** Capital effectivement arbitrable = min(cash disponible, encours de dette). */
  capital: number;
  /** Vrai si le cash disponible, et non la dette, limite l'arbitrage. */
  cappedByCash: boolean;
  horizonYears: number;
  repay: {
    interestAvoided: number;
    remainingCash: number;
    remainingDebt: number;
    /** Trésorerie mobilisable à l'horizon sous cette option. */
    endingLiquidity: number;
    nominalPosition: number;
    realPosition: number;
  };
  invest: {
    expectedEndingValue: number;
    expectedGain: number;
    interestStillDue: number;
    remainingCash: number;
    remainingDebt: number;
    endingLiquidity: number;
    nominalPosition: number;
    realPosition: number;
  };
  /** Écart objectif entre les deux options, sans pondération de risque ni de liquidité. */
  nominalSpread: number;
  /**
   * Heuristiques conservées à titre expérimental. Aucun de ces nombres n'est sourcé,
   * aucun ne doit produire seul une recommandation. Statut : MODEL_HEURISTIC.
   */
  experimental: {
    riskHaircut: number;
    liquidityValue: number;
    opportunityAdvantage: number;
  };
}

/**
 * Compare deux emplois du même euro : rembourser de la dette ou investir.
 *
 * La fonction COMPARE, elle ne RECOMMANDE pas. Aucune conclusion textuelle n'est
 * produite : les heuristiques disponibles (décote de risque, valorisation de la
 * liquidité) ne sont ni sourcées ni testées, et une recommandation patrimoniale ne peut
 * pas reposer sur des coefficients invisibles.
 */
export function compareDebtVsInvest(input: DebtVsInvestInput): DebtVsInvestResult {
  const availableCash = Math.max(0, input.availableCash);
  const debtBalance = Math.max(0, input.debtBalance);
  const capital = Math.min(availableCash, debtBalance);
  const years = Math.max(0, input.years);
  const interestOnCapital = compoundReturn(capital, input.debtRate, years) - capital;
  const investmentEndingValue = compoundReturn(capital, input.investmentReturn, years);
  const investmentGain = investmentEndingValue - capital;
  const liquidityWeight = input.liquidityWeight ?? 0;
  const riskHaircut = capital * input.volatility * Math.sqrt(years) * 0.25;
  const liquidityValue = capital * liquidityWeight;

  // Position nominale à l'horizon : actifs portés moins dette restante capitalisée.
  const repayNominal = -compoundReturn(debtBalance - capital, input.debtRate, years);
  const investNominal = investmentEndingValue - compoundReturn(debtBalance, input.debtRate, years);

  return {
    capital,
    cappedByCash: availableCash < debtBalance,
    horizonYears: years,
    repay: {
      interestAvoided: interestOnCapital,
      remainingCash: availableCash - capital,
      remainingDebt: debtBalance - capital,
      endingLiquidity: availableCash - capital,
      nominalPosition: repayNominal,
      realPosition: realValue(repayNominal, input.inflation, years),
    },
    invest: {
      expectedEndingValue: investmentEndingValue,
      expectedGain: investmentGain,
      interestStillDue: interestOnCapital,
      remainingCash: availableCash - capital,
      remainingDebt: debtBalance,
      endingLiquidity: availableCash - capital + investmentEndingValue,
      nominalPosition: investNominal,
      realPosition: realValue(investNominal, input.inflation, years),
    },
    nominalSpread: investmentGain - interestOnCapital,
    experimental: {
      riskHaircut,
      liquidityValue,
      opportunityAdvantage: investmentGain - interestOnCapital - riskHaircut + liquidityValue,
    },
  };
}
