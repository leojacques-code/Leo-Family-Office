export interface TaxBracket {
  threshold: number;
  rate: number;
}

export interface DatedTaxRule {
  jurisdiction: string;
  taxYear: number;
  brackets: TaxBracket[];
  socialContributionsRate: number;
  source: string;
  verifiedAt: string;
}

export function progressiveTax(taxableIncome: number, rule: DatedTaxRule) {
  if (taxableIncome <= 0) return 0;
  const brackets = [...rule.brackets].sort((a, b) => a.threshold - b.threshold);
  let tax = 0;
  for (let index = 0; index < brackets.length; index += 1) {
    const current = brackets[index];
    const next = brackets[index + 1];
    const taxableInBracket = Math.max(0, Math.min(taxableIncome, next?.threshold ?? taxableIncome) - current.threshold);
    tax += taxableInBracket * current.rate;
    if (taxableIncome <= (next?.threshold ?? Number.POSITIVE_INFINITY)) break;
  }
  return tax;
}

export function employmentCompensation(input: {
  grossFixed: number;
  grossVariable: number;
  employeeContributionRate: number;
  deductibleAllowanceRate: number;
  taxRule: DatedTaxRule;
}) {
  const gross = input.grossFixed + input.grossVariable;
  const contributions = gross * input.employeeContributionRate;
  const netBeforeTax = gross - contributions;
  const taxableIncome = netBeforeTax * (1 - input.deductibleAllowanceRate);
  const incomeTax = progressiveTax(taxableIncome, input.taxRule);
  return { gross, contributions, netBeforeTax, taxableIncome, incomeTax, netAfterTax: netBeforeTax - incomeTax };
}
