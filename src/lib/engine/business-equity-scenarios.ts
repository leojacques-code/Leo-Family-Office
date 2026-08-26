export interface BusinessHoldScenarioInput { currentEquityValue: number; years: number; annualGrowthRate: number; annualDistributions: number; }
export interface BusinessSaleScenarioInput { currentEquityValue: number; economicOwnershipRate: number; saleFraction: number; transactionFeeRate: number; effectiveTaxRate: number | null; }
export interface BusinessRaiseScenarioInput { preMoneyEquityValue: number; primaryNewMoney: number; currentOwnershipRate: number; investorContribution: number; preferredRightsKnown: boolean; }
export const projectBusinessHold = (input: BusinessHoldScenarioInput) => ({
  terminalEquityValue: input.currentEquityValue * (1 + input.annualGrowthRate) ** input.years,
  cumulativeDistributions: input.annualDistributions * input.years,
  flags: ['MODEL_ASSUMPTION'],
});
export const projectBusinessSale = (input: BusinessSaleScenarioInput) => {
  const grossProceeds = input.currentEquityValue * input.economicOwnershipRate * input.saleFraction;
  const transactionFees = grossProceeds * input.transactionFeeRate;
  const preTaxNetProceeds = grossProceeds - transactionFees;
  return { grossProceeds, transactionFees, preTaxNetProceeds, afterTaxNetProceeds: input.effectiveTaxRate === null ? null : preTaxNetProceeds * (1 - input.effectiveTaxRate), flags: input.effectiveTaxRate === null ? ['TAX_RATE_NOT_DECLARED'] : [] };
};
export const projectBusinessRaise = (input: BusinessRaiseScenarioInput) => {
  const postMoney = input.preMoneyEquityValue + input.primaryNewMoney;
  const oldHolderValue = input.currentOwnershipRate * input.preMoneyEquityValue + input.investorContribution;
  const postOwnership = postMoney === 0 ? null : oldHolderValue / postMoney;
  return { postMoneyEquityValue: postMoney, postOwnershipRate: postOwnership, dilution: postOwnership === null ? null : input.currentOwnershipRate - postOwnership, flags: input.preferredRightsKnown ? [] : ['PREFERRED_RIGHTS_NOT_MODELLED'] };
};
