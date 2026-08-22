import type { FinancialAccount, Liability, Scenario } from "@/lib/types";

export interface AmortizationRow {
  paymentNumber: number;
  openingBalance: number;
  payment: number;
  interest: number;
  principal: number;
  closingBalance: number;
}

export function compoundReturn(principal: number, annualRate: number, years: number, periodsPerYear = 1): number {
  if (periodsPerYear <= 0) throw new Error("periodsPerYear must be positive");
  return principal * Math.pow(1 + annualRate / periodsPerYear, periodsPerYear * years);
}

export function realValue(nominalValue: number, annualInflation: number, years: number): number {
  return nominalValue / Math.pow(1 + annualInflation, years);
}

export function fxConvert(amount: number, eurPerUnit: number): number {
  if (eurPerUnit <= 0) throw new Error("FX rate must be positive");
  return amount * eurPerUnit;
}

export function amortizeLoan(principal: number, annualRate: number, payments: number, contractualPayment?: number): AmortizationRow[] {
  if (principal < 0 || annualRate < 0 || payments <= 0) throw new Error("Invalid loan inputs");
  const monthlyRate = annualRate / 12;
  const calculatedPayment = monthlyRate === 0
    ? principal / payments
    : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -payments));
  const payment = contractualPayment ?? calculatedPayment;
  const rows: AmortizationRow[] = [];
  let balance = principal;

  for (let index = 1; index <= payments; index += 1) {
    const interest = balance * monthlyRate;
    const scheduledPrincipal = Math.max(0, payment - interest);
    const principalPaid = Math.min(balance, scheduledPrincipal);
    const actualPayment = principalPaid + interest;
    const closingBalance = Math.max(0, balance - principalPaid);
    rows.push({
      paymentNumber: index,
      openingBalance: balance,
      payment: actualPayment,
      interest,
      principal: principalPaid,
      closingBalance,
    });
    balance = closingBalance;
  }
  return rows;
}

export function npv(discountRate: number, cashFlows: number[]): number {
  if (discountRate <= -1) throw new Error("Discount rate must exceed -100%");
  return cashFlows.reduce((sum, cashFlow, period) => sum + cashFlow / Math.pow(1 + discountRate, period), 0);
}

export function irr(cashFlows: number[], guess = 0.1): number | null {
  if (cashFlows.length < 2 || !cashFlows.some((value) => value < 0) || !cashFlows.some((value) => value > 0)) return null;
  let low = -0.9999;
  let high = Math.max(guess, 1);
  let lowNpv = npv(low, cashFlows);
  let highNpv = npv(high, cashFlows);
  let expansions = 0;
  while (lowNpv * highNpv > 0 && expansions < 60) {
    high *= 2;
    highNpv = npv(high, cashFlows);
    expansions += 1;
  }
  if (lowNpv * highNpv > 0) return null;
  for (let iteration = 0; iteration < 160; iteration += 1) {
    const mid = (low + high) / 2;
    const value = npv(mid, cashFlows);
    if (Math.abs(value) < 1e-8) return mid;
    if (lowNpv * value <= 0) {
      high = mid;
      highNpv = value;
    } else {
      low = mid;
      lowNpv = value;
    }
  }
  return (low + high) / 2;
}

export function moic(totalDistributions: number, investedCapital: number): number {
  if (investedCapital <= 0) throw new Error("Invested capital must be positive");
  return totalDistributions / investedCapital;
}

export function calculateNetWorth(accounts: Pick<FinancialAccount, "balance">[], liabilities: Pick<Liability, "currentBalance">[]) {
  const grossAssets = Number(accounts.reduce((sum, account) => sum + account.balance, 0).toFixed(2));
  const debt = Number(liabilities.reduce((sum, liability) => sum + liability.currentBalance, 0).toFixed(2));
  const netWorth = Number((grossAssets - debt).toFixed(2));
  return { grossAssets, debt, netWorth };
}

export function applyScenarioOverrides<T extends Record<string, unknown>>(base: T, overrides: Partial<T>): T {
  return { ...base, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) } as T;
}

export function deterministicProjection(
  initialAssets: number,
  years: number,
  scenario: Pick<Scenario, "annualReturn" | "monthlySavings" | "annualInflation" | "shockYear" | "shockMagnitude">,
) {
  const points = [{ year: 0, nominal: initialAssets, real: initialAssets }];
  let assets = initialAssets;
  for (let year = 1; year <= years; year += 1) {
    assets = assets * (1 + scenario.annualReturn) + scenario.monthlySavings * 12;
    if (scenario.shockYear === year && scenario.shockMagnitude !== null) assets *= 1 + scenario.shockMagnitude;
    points.push({ year, nominal: assets, real: realValue(assets, scenario.annualInflation, year) });
  }
  return points;
}
