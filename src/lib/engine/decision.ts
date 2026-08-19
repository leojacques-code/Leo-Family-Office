import { compoundReturn, realValue } from "@/lib/engine/financial";

export interface DebtVsInvestInput {
  availableCash: number;
  debtBalance: number;
  debtRate: number;
  investmentReturn: number;
  volatility: number;
  inflation: number;
  years: number;
  liquidityWeight: number;
}

export function compareDebtVsInvest(input: DebtVsInvestInput) {
  const capital = Math.min(input.availableCash, input.debtBalance);
  const debtInterestAvoided = compoundReturn(capital, input.debtRate, input.years) - capital;
  const investmentEndingValue = compoundReturn(capital, input.investmentReturn, input.years);
  const investmentGain = investmentEndingValue - capital;
  const riskHaircut = capital * input.volatility * Math.sqrt(input.years) * 0.25;
  const liquidityValue = capital * input.liquidityWeight;
  return {
    repay: {
      nominalBenefit: capital + debtInterestAvoided,
      realBenefit: realValue(capital + debtInterestAvoided, input.inflation, input.years),
      liquidity: 0,
      risk: "Faible",
    },
    invest: {
      nominalBenefit: investmentEndingValue,
      realBenefit: realValue(investmentEndingValue, input.inflation, input.years),
      liquidity: liquidityValue,
      risk: input.volatility > 0.15 ? "Élevé" : "Modéré",
    },
    opportunityAdvantage: investmentGain - debtInterestAvoided - riskHaircut + liquidityValue,
    conclusion: input.debtRate === 0
      ? "À 0 %, conserver la liquidité et investir progressivement domine financièrement sous les hypothèses, sans rendre le résultat certain."
      : investmentGain - riskHaircut > debtInterestAvoided
        ? "L’investissement présente l’espérance ajustée du risque la plus élevée."
        : "Le remboursement présente le bénéfice certain le plus élevé.",
  };
}
