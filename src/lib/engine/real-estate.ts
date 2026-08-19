import { irr, moic, npv } from "@/lib/engine/financial";

export interface RealEstateInputs {
  purchasePrice: number;
  acquisitionCosts: number;
  renovation: number;
  furniture: number;
  downPayment: number;
  loanAmount: number;
  annualRate: number;
  loanYears: number;
  monthlyRent: number;
  vacancyRate: number;
  annualOperatingCosts: number;
  annualPropertyGrowth: number;
  rentGrowth: number;
  holdingYears: number;
  sellingCostsRate: number;
  taxRate: number;
}

export interface RealEstateResult {
  totalProjectCost: number;
  monthlyPayment: number;
  grossYield: number;
  netYield: number;
  annualCashFlow: number;
  cashOnCash: number;
  ltv: number;
  dscr: number;
  irr: number | null;
  npv: number;
  moic: number;
  totalInterest: number;
  exitValue: number;
  cashFlows: number[];
}

export function underwriteRealEstate(input: RealEstateInputs, discountRate = 0.06): RealEstateResult {
  const totalProjectCost = input.purchasePrice + input.acquisitionCosts + input.renovation + input.furniture;
  const monthlyRate = input.annualRate / 12;
  const months = input.loanYears * 12;
  const monthlyPayment = input.loanAmount === 0 ? 0 : monthlyRate === 0
    ? input.loanAmount / months
    : (input.loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  const debtService = monthlyPayment * 12;
  const effectiveRent = input.monthlyRent * 12 * (1 - input.vacancyRate);
  const netOperatingIncome = effectiveRent - input.annualOperatingCosts;
  const annualCashFlow = netOperatingIncome - debtService;
  const investedEquity = input.downPayment + input.acquisitionCosts + input.renovation + input.furniture;
  const cashFlows = [-investedEquity];
  let outstanding = input.loanAmount;

  for (let year = 1; year <= input.holdingYears; year += 1) {
    const yearRent = effectiveRent * Math.pow(1 + input.rentGrowth, year - 1);
    const yearNoi = yearRent - input.annualOperatingCosts;
    let annualPrincipal = 0;
    for (let month = 0; month < 12 && outstanding > 0; month += 1) {
      const interest = outstanding * monthlyRate;
      const principal = Math.min(outstanding, Math.max(0, monthlyPayment - interest));
      outstanding -= principal;
      annualPrincipal += principal;
    }
    let equityCashFlow = (yearNoi - debtService) * (1 - input.taxRate);
    if (year === input.holdingYears) {
      const exitValue = input.purchasePrice * Math.pow(1 + input.annualPropertyGrowth, input.holdingYears);
      equityCashFlow += exitValue * (1 - input.sellingCostsRate) - outstanding;
    }
    cashFlows.push(equityCashFlow);
    void annualPrincipal;
  }

  const exitValue = input.purchasePrice * Math.pow(1 + input.annualPropertyGrowth, input.holdingYears);
  const totalPositiveFlows = cashFlows.slice(1).reduce((sum, value) => sum + Math.max(0, value), 0);
  const totalInterest = Math.max(0, monthlyPayment * months - input.loanAmount);
  return {
    totalProjectCost,
    monthlyPayment,
    grossYield: input.purchasePrice === 0 ? 0 : (input.monthlyRent * 12) / input.purchasePrice,
    netYield: input.purchasePrice === 0 ? 0 : netOperatingIncome / input.purchasePrice,
    annualCashFlow,
    cashOnCash: investedEquity === 0 ? 0 : annualCashFlow / investedEquity,
    ltv: input.purchasePrice === 0 ? 0 : input.loanAmount / input.purchasePrice,
    dscr: debtService === 0 ? Number.POSITIVE_INFINITY : netOperatingIncome / debtService,
    irr: irr(cashFlows),
    npv: npv(discountRate, cashFlows),
    moic: investedEquity === 0 ? 0 : moic(totalPositiveFlows, investedEquity),
    totalInterest,
    exitValue,
    cashFlows,
  };
}
