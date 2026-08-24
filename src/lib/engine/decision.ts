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
    /**
     * Intérêts réellement évités par le remboursement anticipé. `null` quand la
     * convention de remboursement anticipé du prêt n'est pas connue : aucun montant
     * n'est alors inventé.
     */
    interestAvoided: number | null;
    remainingCash: number;
    remainingDebt: number;
    /** Trésorerie mobilisable à l'horizon sous cette option. */
    endingLiquidity: number;
    nominalPosition: number | null;
    realPosition: number | null;
  };
  invest: {
    expectedEndingValue: number;
    expectedGain: number;
    /** Coût d'intérêt conservé faute de remboursement. `null` pour la même raison. */
    interestStillDue: number | null;
    remainingCash: number;
    remainingDebt: number;
    endingLiquidity: number;
    nominalPosition: number | null;
    realPosition: number | null;
  };
  /** Écart objectif entre les deux options. `null` si les intérêts évités sont inconnus. */
  nominalSpread: number | null;
  /** Pourquoi les intérêts évités ne sont pas calculables, quand ils ne le sont pas. */
  interestAvoidedBlocker: string | null;
  /**
   * Heuristiques conservées à titre expérimental. Aucun de ces nombres n'est sourcé,
   * aucun ne doit produire seul une recommandation. Statut : MODEL_HEURISTIC.
   */
  experimental: {
    riskHaircut: number;
    liquidityValue: number;
    opportunityAdvantage: number | null;
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

  /*
   * Intérêts évités par un remboursement anticipé.
   *
   * À 0 %, la réponse est exacte : zéro, quelle que soit la convention.
   *
   * Au-dessus de 0 %, elle dépend de ce que la banque fait du remboursement partiel :
   * réduction de la durée, réduction de la mensualité, indemnité de remboursement
   * anticipé, montant minimum imposé. Ces conventions produisent des économies
   * différentes sur le même prêt. Le modèle ne les porte pas encore, donc la grandeur
   * est NOT_COMPUTABLE. Capitaliser le capital au taux du prêt, comme le faisait
   * `compoundReturn(capital, debtRate, years)`, reviendrait à supposer une dette qui
   * ne s'amortit jamais : c'est faux pour tout crédit amortissable, et l'erreur croît
   * avec le taux et la durée.
   */
  const zeroRate = input.debtRate === 0;
  const interestAvoided = zeroRate ? 0 : null;
  const interestAvoidedBlocker = zeroRate
    ? null
    : "Convention de remboursement anticipé inconnue : réduction de durée, réduction de mensualité et indemnités produisent des économies différentes sur le même prêt.";

  const investmentEndingValue = compoundReturn(capital, input.investmentReturn, years);
  const investmentGain = investmentEndingValue - capital;
  const liquidityWeight = input.liquidityWeight ?? 0;
  const riskHaircut = capital * input.volatility * Math.sqrt(years) * 0.25;
  const liquidityValue = capital * liquidityWeight;

  // Position nominale à l'horizon : actifs portés moins dette restante. À 0 % la dette
  // ne grossit pas, donc l'encours résiduel suffit. À taux non nul, la trajectoire de
  // l'encours dépend de la même convention manquante : la position n'est pas chiffrable.
  const repayNominal = zeroRate ? -(debtBalance - capital) : null;
  const investNominal = zeroRate ? investmentEndingValue - debtBalance : null;

  return {
    capital,
    cappedByCash: availableCash < debtBalance,
    horizonYears: years,
    repay: {
      interestAvoided,
      remainingCash: availableCash - capital,
      remainingDebt: debtBalance - capital,
      endingLiquidity: availableCash - capital,
      nominalPosition: repayNominal,
      realPosition: repayNominal === null ? null : realValue(repayNominal, input.inflation, years),
    },
    invest: {
      expectedEndingValue: investmentEndingValue,
      expectedGain: investmentGain,
      interestStillDue: interestAvoided,
      remainingCash: availableCash - capital,
      remainingDebt: debtBalance,
      endingLiquidity: availableCash - capital + investmentEndingValue,
      nominalPosition: investNominal,
      realPosition:
        investNominal === null ? null : realValue(investNominal, input.inflation, years),
    },
    nominalSpread: interestAvoided === null ? null : investmentGain - interestAvoided,
    interestAvoidedBlocker,
    experimental: {
      riskHaircut,
      liquidityValue,
      opportunityAdvantage:
        interestAvoided === null
          ? null
          : investmentGain - interestAvoided - riskHaircut + liquidityValue,
    },
  };
}
