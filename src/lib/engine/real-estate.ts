import { amortizeLoan, irr, moic, npv } from "@/lib/engine/financial";

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
  /** Trésorerie réellement engagée : coût total du projet − montant emprunté (INV-E-01). */
  investedEquity: number;
  monthlyPayment: number;
  grossYield: number;
  netYield: number;
  annualCashFlow: number;
  cashOnCash: number;
  ltv: number;
  dscr: number;
  irr: number | null;
  npv: number;
  discountRate: number;
  moic: number;
  /** Σ des apports : equity initiale + tout flux périodique négatif (INV-E-02). */
  contributions: number;
  /** Σ des flux périodiques positifs encaissés. */
  distributions: number;
  residualValue: number;
  totalInterest: number;
  exitValue: number;
  outstandingAtExit: number;
  cashFlows: number[];
  flags: string[];
}

export function underwriteRealEstate(input: RealEstateInputs, discountRate = 0.06): RealEstateResult {
  const flags: string[] = [];
  const totalProjectCost = input.purchasePrice + input.acquisitionCosts + input.renovation + input.furniture;
  const months = Math.max(0, Math.round(input.loanYears * 12));

  // Un seul moteur d'amortissement pour tout LFO : celui de `financial.ts`.
  const schedule = input.loanAmount > 0 && months > 0 ? amortizeLoan(input.loanAmount, input.annualRate, months) : [];
  const monthlyPayment = schedule[0]?.payment ?? 0;
  const debtServiceForYear = (year: number) =>
    schedule
      .filter((row) => row.paymentNumber > (year - 1) * 12 && row.paymentNumber <= year * 12)
      .reduce((sum, row) => sum + row.payment, 0);

  const effectiveRent = input.monthlyRent * 12 * (1 - input.vacancyRate);
  const netOperatingIncome = effectiveRent - input.annualOperatingCosts;
  const firstYearDebtService = debtServiceForYear(1);
  const annualCashFlow = netOperatingIncome - firstYearDebtService;

  // L'equity investie est la trésorerie qui sort de la poche de l'investisseur : un coût
  // financé par le crédit n'est pas une contribution en fonds propres (INV-E-01).
  const investedEquity = Math.max(0, totalProjectCost - input.loanAmount);
  if (input.loanAmount > input.purchasePrice) {
    flags.push(
      `LTV de ${((input.loanAmount / Math.max(1, input.purchasePrice)) * 100).toFixed(1)} % du prix d’achat : le financement couvre aussi les frais, travaux ou mobilier.`,
    );
  }
  if (Math.abs(investedEquity - input.downPayment) > 0.01) {
    flags.push(
      `Apport saisi ${input.downPayment.toFixed(2)} € et equity dérivée ${investedEquity.toFixed(2)} € : l’écart correspond aux coûts financés par le crédit.`,
    );
  }

  const cashFlows = [-investedEquity];
  for (let year = 1; year <= input.holdingYears; year += 1) {
    const yearRent = effectiveRent * Math.pow(1 + input.rentGrowth, year - 1);
    const yearNoi = yearRent - input.annualOperatingCosts;
    // Après la maturité du crédit, aucune échéance n'est exigible : le debt service tombe à 0.
    const yearDebtService = debtServiceForYear(year);
    let equityCashFlow = (yearNoi - yearDebtService) * (1 - input.taxRate);
    if (year === input.holdingYears) {
      const exitGross = input.purchasePrice * Math.pow(1 + input.annualPropertyGrowth, input.holdingYears);
      const remaining = schedule.filter((row) => row.paymentNumber <= input.holdingYears * 12).at(-1)?.closingBalance
        ?? (schedule.length ? 0 : input.loanAmount);
      equityCashFlow += exitGross * (1 - input.sellingCostsRate) - remaining;
    }
    cashFlows.push(equityCashFlow);
  }
  if (input.holdingYears * 12 > months && input.loanAmount > 0) {
    flags.push(`Le crédit s’éteint à l’année ${input.loanYears} : aucun service de dette n’est retranché ensuite.`);
  }

  const exitValue = input.purchasePrice * Math.pow(1 + input.annualPropertyGrowth, input.holdingYears);
  const outstandingAtExit =
    schedule.filter((row) => row.paymentNumber <= input.holdingYears * 12).at(-1)?.closingBalance ??
    (schedule.length ? 0 : input.loanAmount);
  const periodic = cashFlows.slice(1);
  // Un flux périodique négatif est un apport complémentaire, pas une distribution
  // négative : il rejoint le dénominateur, il ne se retranche pas du numérateur.
  const distributions = periodic.reduce((sum, value) => sum + Math.max(0, value), 0);
  const additionalContributions = periodic.reduce((sum, value) => sum + Math.max(0, -value), 0);
  const contributions = investedEquity + additionalContributions;
  // Le projet est cédé à l'horizon : la valeur résiduelle après cession est nulle.
  const residualValue = 0;
  const totalInterest = schedule.reduce((sum, row) => sum + row.interest, 0);

  return {
    totalProjectCost,
    investedEquity,
    monthlyPayment,
    grossYield: input.purchasePrice === 0 ? 0 : (input.monthlyRent * 12) / input.purchasePrice,
    netYield: input.purchasePrice === 0 ? 0 : netOperatingIncome / input.purchasePrice,
    annualCashFlow,
    cashOnCash: investedEquity === 0 ? 0 : annualCashFlow / investedEquity,
    ltv: input.purchasePrice === 0 ? 0 : input.loanAmount / input.purchasePrice,
    dscr: firstYearDebtService === 0 ? Number.POSITIVE_INFINITY : netOperatingIncome / firstYearDebtService,
    irr: irr(cashFlows),
    npv: npv(discountRate, cashFlows),
    discountRate,
    moic: contributions <= 0 ? 0 : moic(distributions + residualValue, contributions),
    contributions,
    distributions,
    residualValue,
    totalInterest,
    exitValue,
    outstandingAtExit,
    cashFlows,
    flags,
  };
}
