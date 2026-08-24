import { describe, expect, it } from "vitest";
import { UNDECLARED_LOAN_TERMS } from "@/lib/engine/debt";
import {
  advanceMonth,
  buildDebtCalendar,
  buildOpeningBalanceSheet,
  monthlyReturnFromAnnual,
  runDeterministicModel,
  runMonthlyModel,
  scenarioAssumptions,
  toAnnualPoints,
  type MonthlyScenarioAssumptions,
  type OpeningBalanceSheet,
} from "@/lib/engine/monthly-financial-model";
import { FINANCING_COST_FLAG, FUNDING_GAP_FLAG } from "@/lib/engine/monthly-financial-model";
import { runMonteCarlo } from "@/lib/engine/monte-carlo";
import type { DashboardState, Liability, Provenance, Scenario } from "@/lib/types";

const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH" };

function opening(overrides: Partial<OpeningBalanceSheet> = {}): OpeningBalanceSheet {
  const base: OpeningBalanceSheet = {
    date: "2026-08-19",
    bankCash: 0,
    marketInvestedAssets: 0,
    investmentCash: 0,
    otherFinancialAssets: 0,
    grossFinancialAssets: 0,
    loanBalance: 0,
    fundingGap: 0,
    netWorth: 0,
    flags: [],
  };
  const merged = { ...base, ...overrides };
  merged.grossFinancialAssets =
    merged.bankCash +
    merged.marketInvestedAssets +
    merged.investmentCash +
    merged.otherFinancialAssets;
  merged.netWorth = merged.grossFinancialAssets - merged.loanBalance - merged.fundingGap;
  return merged;
}

function assumptions(
  overrides: Partial<MonthlyScenarioAssumptions> = {},
): MonthlyScenarioAssumptions {
  return {
    operatingSurplus: 0,
    investmentAllocationRate: 1,
    annualReturn: 0,
    shockYear: null,
    shockMagnitude: null,
    ...overrides,
  };
}

const noDebt = {
  interest: 0,
  capitalisedInterest: 0,
  capitalisedCharges: 0,
  principal: 0,
  insurance: 0,
  fees: 0,
  cashOut: 0,
};

/** Un seul mois isolé, pour tester une écriture précise. */
function oneMonth(
  start: OpeningBalanceSheet,
  debt: Partial<typeof noDebt>,
  assume: Partial<MonthlyScenarioAssumptions> = {},
  marketReturn = 0,
) {
  const model = runMonthlyModel({
    opening: start,
    liabilities: [],
    assumptions: assumptions(assume),
    months: 0,
    marketReturn: () => marketReturn,
  });
  return advanceMonth(
    model.states[0],
    1,
    "2026-09-30",
    { ...noDebt, ...debt },
    assumptions(assume),
    marketReturn,
  );
}

describe("CASE A — aucun flux", () => {
  it("laisse le patrimoine net identique mois après mois", () => {
    const result = runDeterministicModel(
      opening({ bankCash: 1000, marketInvestedAssets: 500 }),
      [],
      assumptions(),
      24,
    );
    for (const state of result.states) {
      expect(state.netWorth).toBeCloseTo(1500, 8);
      expect(state.attributionResidual).toBeCloseTo(0, 8);
    }
  });
});

describe("CASE B — épargne en cash", () => {
  it("accumule 1 200 € de cash sur douze mois sans rendement", () => {
    const result = runDeterministicModel(
      opening({ bankCash: 0 }),
      [],
      assumptions({ operatingSurplus: 100, investmentAllocationRate: 0 }),
      12,
    );
    const final = result.states[12];
    expect(final.bankCash).toBeCloseTo(1200, 8);
    expect(final.marketInvestedAssets).toBeCloseTo(0, 8);
    expect(final.netWorth).toBeCloseTo(1200, 8);
  });
});

describe("CASE C — épargne investie", () => {
  it("accumule 1 200 € d’actifs de marché et laisse le cash intact", () => {
    const result = runDeterministicModel(
      opening({ bankCash: 300 }),
      [],
      assumptions({ operatingSurplus: 100, investmentAllocationRate: 1 }),
      12,
    );
    const final = result.states[12];
    expect(final.bankCash).toBeCloseTo(300, 8);
    expect(final.marketInvestedAssets).toBeCloseTo(1200, 8);
    expect(final.netWorth).toBeCloseTo(1500, 8);
  });
});

describe("CASE D — timing des contributions", () => {
  it("ne fait produire du rendement à une contribution qu’à partir du mois suivant", () => {
    const monthly = monthlyReturnFromAnnual(0.12);
    const result = runDeterministicModel(
      opening({ marketInvestedAssets: 0 }),
      [],
      assumptions({ operatingSurplus: 100, investmentAllocationRate: 1, annualReturn: 0.12 }),
      3,
    );
    // Mois 1 : capital d'ouverture nul, donc aucun rendement, seulement la contribution.
    expect(result.states[1].marketPnL).toBeCloseTo(0, 8);
    expect(result.states[1].marketInvestedAssets).toBeCloseTo(100, 8);
    // Mois 2 : le rendement porte sur les 100 € d'ouverture, pas sur les 200 €.
    expect(result.states[2].marketPnL).toBeCloseTo(100 * monthly, 8);
    expect(result.states[2].marketInvestedAssets).toBeCloseTo(100 * (1 + monthly) + 100, 8);
  });
});

describe("CASE E — remboursement de principal seul", () => {
  it("laisse le patrimoine net strictement inchangé", () => {
    const start = opening({ bankCash: 1000, loanBalance: 5000 });
    const month = oneMonth(start, { principal: 250, cashOut: 250 });
    expect(month.bankCash).toBeCloseTo(750, 8);
    expect(month.loanBalance).toBeCloseTo(4750, 8);
    expect(month.netWorthChange).toBeCloseTo(0, 8);
    expect(month.attributionResidual).toBeCloseTo(0, 8);
  });
});

describe("CASE F — intérêt de dette", () => {
  it("ne fait baisser le patrimoine net que du coût économique", () => {
    const start = opening({ bankCash: 1000, loanBalance: 5000 });
    const month = oneMonth(start, { interest: 50, principal: 250, cashOut: 300 });
    expect(month.bankCash).toBeCloseTo(700, 8);
    expect(month.loanBalance).toBeCloseTo(4750, 8);
    expect(month.economicDebtCosts).toBeCloseTo(50, 8);
    expect(month.netWorthChange).toBeCloseTo(-50, 8);
  });
});

describe("CASE G — actifs sans exposition connue", () => {
  it("n’applique aucun rendement au cash d’enveloppe ni au solde non ventilé", () => {
    const result = runDeterministicModel(
      opening({ investmentCash: 6304.57, otherFinancialAssets: 0.56, marketInvestedAssets: 1000 }),
      [],
      assumptions({ annualReturn: 0.08 }),
      36,
    );
    const final = result.states[36];
    expect(final.investmentCash).toBeCloseTo(6304.57, 8);
    expect(final.otherFinancialAssets).toBeCloseTo(0.56, 8);
    expect(final.marketInvestedAssets).toBeGreaterThan(1000);
  });
});

describe("CASE H — réconciliation du bilan", () => {
  it("fait toujours la somme des quatre poches", () => {
    const result = runDeterministicModel(
      opening({
        bankCash: 354.08,
        marketInvestedAssets: 8912.28,
        investmentCash: 6304.57,
        otherFinancialAssets: 0.56,
      }),
      [],
      assumptions({ operatingSurplus: 250, investmentAllocationRate: 0.6, annualReturn: 0.055 }),
      60,
    );
    for (const state of result.states) {
      expect(
        state.bankCash +
          state.marketInvestedAssets +
          state.investmentCash +
          state.otherFinancialAssets,
      ).toBeCloseTo(state.grossFinancialAssets, 6);
    }
  });
});

describe("CASE I — patrimoine net", () => {
  it("vaut actifs financiers moins dette moins funding gap", () => {
    const result = runDeterministicModel(
      opening({ bankCash: 100, marketInvestedAssets: 900, loanBalance: 2000 }),
      [],
      assumptions({ operatingSurplus: 50 }),
      24,
    );
    for (const state of result.states) {
      expect(state.grossFinancialAssets - state.loanBalance - state.fundingGap).toBeCloseTo(
        state.netWorth,
        6,
      );
    }
  });
});

describe("CASE J — attribution mensuelle", () => {
  it("réconcilie chaque mois : ouverture + attribution = clôture", () => {
    const liability: Liability = {
      id: "l1",
      name: "Prêt",
      lender: "Banque",
      principal: 100000,
      currentBalance: 100000,
      annualRate: 0.03,
      monthlyPayment: 0,
      paymentCount: 240,
      firstPaymentDate: "2026-10-01",
      maturityDate: "2046-09-01",
      ...UNDECLARED_LOAN_TERMS,
      provenance,
    };
    const result = runDeterministicModel(
      opening({ bankCash: 5000, marketInvestedAssets: 20000, loanBalance: 100000 }),
      [liability],
      assumptions({ operatingSurplus: 1500, investmentAllocationRate: 0.7, annualReturn: 0.05 }),
      120,
    );
    for (const state of result.states) {
      const attribution = state.operatingSurplus - state.economicDebtCosts + state.marketPnL;
      expect(state.openingNetWorth + attribution).toBeCloseTo(state.netWorth, 6);
      expect(state.attributionResidual).toBeCloseTo(0, 6);
    }
  });
});

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "scn",
    name: "Test",
    description: "",
    version: 1,
    color: "#000",
    annualReturn: 0.055,
    annualVolatility: 0,
    annualInflation: 0.02,
    monthlySavings: 250,
    investmentAllocationRate: 1,
    salaryGrowth: 0,
    stressProbability: 0,
    shockYear: null,
    shockMagnitude: null,
    provenance: { kind: "MODEL_ASSUMPTION", confidence: "MEDIUM" },
    ...overrides,
  };
}

describe("CASE K — déterministe et Monte-Carlo décrivent la même réalité", () => {
  it("rend un P50 égal à la trajectoire déterministe quand le hasard est neutralisé", () => {
    const base = opening({
      bankCash: 354.08,
      marketInvestedAssets: 8912.28,
      investmentCash: 6304.57,
      loanBalance: 16745,
    });
    const liability: Liability = {
      id: "lia",
      name: "Prêt étudiant",
      lender: "Bpifrance",
      principal: 16745,
      currentBalance: 16745,
      annualRate: 0,
      monthlyPayment: 284.72,
      paymentCount: 60,
      firstPaymentDate: "2026-12-05",
      maturityDate: "2031-11-05",
      ...UNDECLARED_LOAN_TERMS,
      provenance,
    };
    const flat = scenario({
      annualVolatility: 0,
      stressProbability: 0,
      shockYear: null,
      shockMagnitude: null,
    });
    const deterministic = toAnnualPoints(
      runDeterministicModel(base, [liability], scenarioAssumptions(flat), 10 * 12),
    );
    const monteCarlo = runMonteCarlo({
      scenario: flat,
      opening: base,
      liabilities: [liability],
      years: 10,
      simulations: 200,
      seed: 19082026,
    });
    monteCarlo.points.forEach((point, year) => {
      expect(point.p50).toBeCloseTo(deterministic[year].netWorth, 6);
      expect(point.p10).toBeCloseTo(point.p90, 6);
    });
  });
});

describe("CASE L — choc de marché", () => {
  it("ne frappe que les actifs exposés au marché", () => {
    const base = opening({
      bankCash: 2000,
      marketInvestedAssets: 10000,
      investmentCash: 500,
      loanBalance: 3000,
    });
    const shocked = runDeterministicModel(
      base,
      [],
      assumptions({ annualReturn: 0, shockYear: 1, shockMagnitude: -0.35 }),
      24,
    );
    const shockMonth = shocked.states[12];
    expect(shockMonth.marketInvestedAssets).toBeCloseTo(10000 * 0.65, 6);
    expect(shockMonth.bankCash).toBeCloseTo(2000, 8);
    expect(shockMonth.investmentCash).toBeCloseTo(500, 8);
    expect(shockMonth.loanBalance).toBeCloseTo(3000, 8);
    expect(shockMonth.marketPnL).toBeCloseTo(-3500, 6);
  });
});

describe("CASE M — dette arrivée à maturité", () => {
  it("cesse tout cash-out après la dernière échéance", () => {
    const liability: Liability = {
      id: "l",
      name: "Prêt court",
      lender: "Banque",
      principal: 1200,
      currentBalance: 1200,
      annualRate: 0,
      monthlyPayment: 100,
      paymentCount: 12,
      firstPaymentDate: "2026-09-05",
      maturityDate: "2027-08-05",
      ...UNDECLARED_LOAN_TERMS,
      provenance,
    };
    const calendar = buildDebtCalendar([liability], "2026-08-19", 24);
    const paid = calendar.filter((month) => month.cashOut > 0);
    expect(paid).toHaveLength(12);
    expect(calendar.slice(13).every((month) => month.cashOut === 0)).toBe(true);
    const result = runDeterministicModel(
      opening({ bankCash: 5000, loanBalance: 1200 }),
      [liability],
      assumptions(),
      24,
    );
    expect(result.states[24].loanBalance).toBeCloseTo(0, 6);
    expect(result.states[24].bankCash).toBeCloseTo(3800, 6);
  });
});

describe("CASE N — plusieurs dettes", () => {
  it("additionne correctement principaux et cash-outs", () => {
    const first: Liability = {
      id: "a",
      name: "A",
      lender: "X",
      principal: 1200,
      currentBalance: 1200,
      annualRate: 0,
      monthlyPayment: 100,
      paymentCount: 12,
      firstPaymentDate: "2026-09-05",
      maturityDate: "2027-08-05",
      ...UNDECLARED_LOAN_TERMS,
      provenance,
    };
    const second: Liability = {
      id: "b",
      name: "B",
      lender: "Y",
      principal: 2400,
      currentBalance: 2400,
      annualRate: 0,
      monthlyPayment: 200,
      paymentCount: 12,
      firstPaymentDate: "2026-09-10",
      maturityDate: "2027-08-10",
      ...UNDECLARED_LOAN_TERMS,
      provenance,
    };
    const calendar = buildDebtCalendar([first, second], "2026-08-19", 12);
    expect(calendar[1].cashOut).toBeCloseTo(300, 6);
    expect(calendar[1].principal).toBeCloseTo(300, 6);
    const result = runDeterministicModel(
      opening({ bankCash: 10000, loanBalance: 3600 }),
      [first, second],
      assumptions(),
      12,
    );
    expect(result.states[12].loanBalance).toBeCloseTo(0, 6);
    expect(result.states[12].bankCash).toBeCloseTo(6400, 6);
    expect(result.states[12].netWorth).toBeCloseTo(6400, 6);
  });
});

describe("CASE O — surplus supérieur au service de dette", () => {
  it("n’investit que le surplus restant et crée 950 € de patrimoine", () => {
    const start = opening({ bankCash: 0, loanBalance: 10000 });
    const month = oneMonth(
      start,
      { interest: 50, principal: 250, cashOut: 300 },
      { operatingSurplus: 1000, investmentAllocationRate: 1 },
    );
    expect(month.postDebtSurplus).toBeCloseTo(700, 8);
    expect(month.investmentContribution).toBeCloseTo(700, 8);
    expect(month.cashContribution).toBeCloseTo(0, 8);
    expect(month.marketInvestedAssets).toBeCloseTo(700, 8);
    expect(month.loanBalance).toBeCloseTo(9750, 8);
    // 1 000 − 50 = 950. Ni 1 200, ni 700.
    expect(month.netWorthChange).toBeCloseTo(950, 8);
    expect(month.netWorthChange).not.toBeCloseTo(1200, 2);
    expect(month.netWorthChange).not.toBeCloseTo(700, 2);
  });
});

describe("CASE P — service de dette supérieur au surplus", () => {
  it("n’investit rien et ponctionne le cash du déficit", () => {
    const start = opening({ bankCash: 1000, loanBalance: 10000 });
    const month = oneMonth(
      start,
      { interest: 50, principal: 250, cashOut: 300 },
      { operatingSurplus: 250, investmentAllocationRate: 1 },
    );
    expect(month.postDebtSurplus).toBeCloseTo(-50, 8);
    expect(month.investmentContribution).toBe(0);
    expect(month.bankCash).toBeCloseTo(950, 8);
    expect(month.loanBalance).toBeCloseTo(9750, 8);
    expect(month.fundingGap).toBe(0);
    // 250 − 50 = 200.
    expect(month.netWorthChange).toBeCloseTo(200, 8);
  });

  it("ouvre un funding gap quand le cash ne couvre pas le déficit", () => {
    const start = opening({ bankCash: 20, loanBalance: 10000 });
    const month = oneMonth(
      start,
      { interest: 50, principal: 250, cashOut: 300 },
      { operatingSurplus: 250 },
    );
    expect(month.bankCash).toBe(0);
    expect(month.fundingGap).toBeCloseTo(30, 8);
    expect(month.flags).toContain("FUNDING_GAP / financing terms missing");
    expect(month.netWorthChange).toBeCloseTo(200, 8);
  });
});

describe("CASE Q — la dette n’est jamais absorbée par l’hypothèse de surplus", () => {
  it("fait varier cash, investissement et patrimoine quand la mensualité change", () => {
    const light: Liability = {
      id: "l",
      name: "Léger",
      lender: "X",
      principal: 18000,
      currentBalance: 18000,
      annualRate: 0,
      monthlyPayment: 300,
      paymentCount: 60,
      firstPaymentDate: "2026-09-05",
      maturityDate: "2031-08-05",
      ...UNDECLARED_LOAN_TERMS,
      provenance,
    };
    const heavy: Liability = {
      ...light,
      monthlyPayment: 700,
      paymentCount: 26,
      maturityDate: "2028-10-05",
      ...UNDECLARED_LOAN_TERMS,
    };
    const assume = assumptions({
      operatingSurplus: 1000,
      investmentAllocationRate: 1,
      annualReturn: 0.05,
    });
    const start = opening({ bankCash: 2000, marketInvestedAssets: 5000, loanBalance: 18000 });
    const withLight = runDeterministicModel(start, [light], assume, 24);
    const withHeavy = runDeterministicModel(start, [heavy], assume, 24);
    // Une mensualité plus lourde consomme davantage de surplus : moins investi chaque mois.
    expect(withHeavy.states[1].investmentContribution).toBeLessThan(
      withLight.states[1].investmentContribution,
    );
    // La dette s'éteint plus vite, donc l'encours projeté diffère.
    expect(withHeavy.states[24].loanBalance).toBeLessThan(withLight.states[24].loanBalance);
    // Les actifs de marché diffèrent : la dette agit réellement sur la capacité d'investir.
    expect(withHeavy.states[24].marketInvestedAssets).not.toBeCloseTo(
      withLight.states[24].marketInvestedAssets,
      2,
    );
  });
});

describe("bilan d’ouverture", () => {
  function stateFixture(): DashboardState {
    const accounts = [
      {
        id: "acc_bank",
        institutionId: "i",
        institution: "Boursobank",
        name: "Ultim",
        type: "BANK" as const,
        currency: "EUR",
        balance: 355.48,
        balanceDate: "2026-08-19",
        liquidity: "IMMEDIATE" as const,
        provenance,
      },
      {
        id: "acc_cic",
        institutionId: "i",
        institution: "CIC",
        name: "Mastercard",
        type: "BANK" as const,
        currency: "EUR",
        balance: -3.44,
        balanceDate: "2026-08-19",
        liquidity: "IMMEDIATE" as const,
        provenance,
      },
      {
        id: "acc_savings",
        institutionId: "i",
        institution: "Revolut",
        name: "Saving",
        type: "SAVINGS" as const,
        currency: "EUR",
        balance: 2.04,
        balanceDate: "2026-08-19",
        liquidity: "IMMEDIATE" as const,
        provenance,
      },
      {
        id: "acc_pea",
        institutionId: "i",
        institution: "Boursobank",
        name: "PEA",
        type: "PEA" as const,
        currency: "EUR",
        balance: 15003.13,
        balanceDate: "2026-08-19",
        liquidity: "LIQUID" as const,
        provenance,
      },
      {
        id: "acc_cto",
        institutionId: "i",
        institution: "Trade Republic",
        name: "CTO",
        type: "CTO" as const,
        currency: "EUR",
        balance: 214.28,
        balanceDate: "2026-08-19",
        liquidity: "LIQUID" as const,
        provenance,
      },
    ];
    const positions = [
      {
        id: "p1",
        accountId: "acc_pea",
        securityName: "ETF",
        assetClass: "Actions monde",
        value: 8698,
        currency: "EUR",
        isCash: false,
        provenance,
      },
      {
        id: "p2",
        accountId: "acc_pea",
        securityName: "Cash PEA",
        assetClass: "Cash",
        value: 6304.57,
        currency: "EUR",
        isCash: true,
        provenance,
      },
      {
        id: "p3",
        accountId: "acc_cto",
        securityName: "CTO à ventiler",
        assetClass: "Actions",
        value: 214.28,
        currency: "EUR",
        isCash: false,
        provenance,
      },
    ];
    const grossAssets = accounts.reduce((sum, account) => sum + account.balance, 0);
    return {
      asOfDate: "2026-08-19",
      reportingCurrency: "EUR",
      ledgerCoverageStart: null,
      ledgerCoverageSource: "MANUAL" as const,
      accounts,
      positions,
      liabilities: [
        {
          id: "lia",
          name: "Prêt étudiant",
          lender: "Bpifrance",
          principal: 16745,
          currentBalance: 16745,
          annualRate: 0,
          monthlyPayment: 284.72,
          paymentCount: 60,
          firstPaymentDate: "2026-12-05",
          maturityDate: "2031-11-05",
          ...UNDECLARED_LOAN_TERMS,
          provenance,
        },
      ],
      incomes: [],
      expenseCategories: [],
      transactions: [],
      recurringRules: [],
      cashFlowCloses: [],
      scenarios: [],
      goals: [],
      alerts: [],
      monthlyCloses: [],
      documents: [],
      assumptions: [],
      metrics: {
        grossAssets,
        debt: 16745,
        netWorth: grossAssets - 16745,
        bankCash: 354.08,
        liquidAssets: grossAssets,
        liquidNetWorth: grossAssets - 16745,
        investedAssets: 8912.28,
        productiveNetWorth: 0,
        monthlyIncome: 0,
        monthlyExpenses: 0,
        monthlyDebtService: 0,
        freeCashFlow: 0,
        savingsRate: null,
        investmentRate: null,
        emergencyCoverageMonths: 0,
        dataCompleteness: 0,
      },
    };
  }

  it("réconcilie les quatre poches avec les actifs bruts du cockpit", () => {
    const state = stateFixture();
    const sheet = buildOpeningBalanceSheet(state);
    expect(sheet.bankCash).toBeCloseTo(354.08, 6);
    expect(sheet.marketInvestedAssets).toBeCloseTo(8912.28, 6);
    expect(sheet.investmentCash).toBeCloseTo(6304.57, 6);
    expect(sheet.otherFinancialAssets).toBeCloseTo(0.56, 6);
    expect(sheet.grossFinancialAssets).toBeCloseTo(state.metrics.grossAssets, 6);
    expect(sheet.flags).toHaveLength(0);
  });

  it("fait du mois zéro le patrimoine net observé", () => {
    const state = stateFixture();
    const sheet = buildOpeningBalanceSheet(state);
    const result = runDeterministicModel(
      sheet,
      state.liabilities,
      assumptions({ operatingSurplus: 250 }),
      12,
    );
    expect(result.states[0].netWorth).toBeCloseTo(state.metrics.netWorth, 6);
    expect(result.states[0].monthIndex).toBe(0);
    expect(result.states[0].operatingSurplus).toBe(0);
  });
});

/**
 * Cycle de vie du besoin de financement. Un `fundingGap` n'est pas une ligne de crédit
 * gratuite : tant qu'il subsiste, aucun euro ne part en cash disponible ni en
 * investissement.
 */
describe("CASE R — surplus insuffisant pour solder le gap", () => {
  it("affecte tout le surplus au gap et n’investit rien", () => {
    const start = opening({ bankCash: 0, fundingGap: 100 });
    const month = oneMonth(start, {}, { operatingSurplus: 50, investmentAllocationRate: 1 });
    expect(month.gapRepayment).toBeCloseTo(50, 8);
    expect(month.fundingGap).toBeCloseTo(50, 8);
    expect(month.surplusAfterGap).toBeCloseTo(0, 8);
    expect(month.investmentContribution).toBe(0);
    expect(month.bankCash).toBeCloseTo(0, 8);
    // Résorber un besoin de financement est neutre : seul le surplus crée du patrimoine.
    expect(month.netWorthChange).toBeCloseTo(50, 8);
    expect(month.attributionResidual).toBeCloseTo(0, 8);
  });
});

describe("CASE S — surplus supérieur au gap, allocation 100 %", () => {
  it("solde le gap puis n’investit que le reliquat", () => {
    const start = opening({ bankCash: 0, fundingGap: 100 });
    const month = oneMonth(start, {}, { operatingSurplus: 150, investmentAllocationRate: 1 });
    expect(month.gapRepayment).toBeCloseTo(100, 8);
    expect(month.fundingGap).toBe(0);
    expect(month.surplusAfterGap).toBeCloseTo(50, 8);
    expect(month.investmentContribution).toBeCloseTo(50, 8);
    expect(month.bankCash).toBeCloseTo(0, 8);
    expect(month.netWorthChange).toBeCloseTo(150, 8);
  });
});

describe("CASE T — surplus supérieur au gap, allocation 40 %", () => {
  it("répartit le seul reliquat entre marché et cash", () => {
    const start = opening({ bankCash: 0, fundingGap: 100 });
    const month = oneMonth(start, {}, { operatingSurplus: 150, investmentAllocationRate: 0.4 });
    expect(month.gapRepayment).toBeCloseTo(100, 8);
    expect(month.surplusAfterGap).toBeCloseTo(50, 8);
    expect(month.investmentContribution).toBeCloseTo(20, 8);
    expect(month.cashContribution).toBeCloseTo(30, 8);
    expect(month.bankCash).toBeCloseTo(30, 8);
    expect(month.fundingGap).toBe(0);
  });
});

describe("invariants du besoin de financement", () => {
  const liability: Liability = {
    id: "lia",
    name: "Prêt étudiant",
    lender: "Bpifrance",
    principal: 16745,
    currentBalance: 16745,
    annualRate: 0,
    monthlyPayment: 284.72,
    paymentCount: 60,
    firstPaymentDate: "2026-12-05",
    maturityDate: "2031-11-05",
    ...UNDECLARED_LOAN_TERMS,
    provenance,
  };
  const central = assumptions({
    operatingSurplus: 250,
    investmentAllocationRate: 1,
    annualReturn: 0.055,
  });
  const start = opening({
    bankCash: 354.08,
    marketInvestedAssets: 8912.28,
    investmentCash: 6304.57,
    otherFinancialAssets: 0.56,
    loanBalance: 16745,
  });
  const result = runDeterministicModel(start, [liability], central, 30 * 12);

  it("ne laisse jamais le cash négatif ni le gap négatif", () => {
    for (const state of result.states) {
      expect(state.bankCash).toBeGreaterThanOrEqual(0);
      expect(state.fundingGap).toBeGreaterThanOrEqual(0);
    }
  });

  it("ne fait jamais coexister trésorerie et besoin de financement", () => {
    for (const state of result.states) {
      expect(state.bankCash > 0.005 && state.fundingGap > 0.005).toBe(false);
    }
  });

  it("n’investit jamais tant qu’un besoin de financement subsiste", () => {
    for (const state of result.states) {
      if (state.openingFundingGap > 0.005 && state.investmentContribution > 0) {
        // Seul le reliquat d'un surplus qui solde intégralement le gap peut être investi.
        expect(state.fundingGap).toBeCloseTo(0, 6);
      }
    }
  });

  it("réconcilie l’attribution malgré les mouvements de gap", () => {
    for (const state of result.states) {
      expect(state.attributionResidual).toBeCloseTo(0, 6);
    }
  });
});

describe("CASE U — scénario Central réel", () => {
  const liability: Liability = {
    id: "lia",
    name: "Prêt étudiant",
    lender: "Bpifrance",
    principal: 16745,
    currentBalance: 16745,
    annualRate: 0,
    monthlyPayment: 284.72,
    paymentCount: 60,
    firstPaymentDate: "2026-12-05",
    maturityDate: "2031-11-05",
    ...UNDECLARED_LOAN_TERMS,
    provenance,
  };
  const start = opening({
    bankCash: 354.08,
    marketInvestedAssets: 8912.28,
    investmentCash: 6304.57,
    otherFinancialAssets: 0.56,
    loanBalance: 16745,
  });
  const result = runDeterministicModel(
    start,
    [liability],
    assumptions({ operatingSurplus: 250, investmentAllocationRate: 1, annualReturn: 0.055 }),
    30 * 12,
  );

  it("laisse un besoin de financement apparaître pendant le remboursement", () => {
    const peak = Math.max(...result.states.map((state) => state.fundingGap));
    expect(peak).toBeGreaterThan(0);
    expect(result.states.some((state) => state.flags.includes(FUNDING_GAP_FLAG))).toBe(true);
  });

  it("le résorbe entièrement après l’extinction de la dette", () => {
    const afterDebt = result.states.filter(
      (state) => state.loanBalance <= 0.01 && state.monthIndex > 0,
    );
    expect(afterDebt.length).toBeGreaterThan(0);
    expect(afterDebt.at(-1)?.fundingGap).toBeCloseTo(0, 6);
    // La reprise des investissements suit la résorption, elle ne la précède pas.
    const firstReinvest = afterDebt.find((state) => state.investmentContribution > 0);
    const lastGap = afterDebt.filter((state) => state.fundingGap > 0.005).at(-1);
    if (firstReinvest && lastGap) {
      expect(firstReinvest.monthIndex).toBeGreaterThan(lastGap.monthIndex);
    }
  });

  it("marque la trajectoire comme partielle faute de coût de financement", () => {
    expect(result.states.at(-1)?.financingCostMissing).toBe(true);
    expect(result.states.at(-1)?.flags).toContain(FINANCING_COST_FLAG);
  });
});

function zeroRateLoan(monthlyPayment: number, paymentCount: number): Liability {
  return {
    id: `l-${monthlyPayment}`,
    name: "Prêt 0 %",
    lender: "X",
    principal: 12000,
    currentBalance: 12000,
    annualRate: 0,
    monthlyPayment,
    paymentCount,
    firstPaymentDate: "2026-09-05",
    maturityDate: "2036-08-05",
    ...UNDECLARED_LOAN_TERMS,
    provenance,
  };
}

describe("CASE V — dette à 0 %, rendement nul", () => {
  it("ne crée aucune richesse par le seul calendrier de remboursement", () => {
    const start = opening({ bankCash: 20000, loanBalance: 12000 });
    const assume = assumptions({
      operatingSurplus: 500,
      investmentAllocationRate: 1,
      annualReturn: 0,
    });
    const slow = runDeterministicModel(start, [zeroRateLoan(100, 120)], assume, 180);
    const fast = runDeterministicModel(start, [zeroRateLoan(500, 24)], assume, 180);
    // À rendement nul, la date de remboursement d'un principal à 0 % est sans effet.
    expect(fast.states[180].netWorth).toBeCloseTo(slow.states[180].netWorth, 6);
  });
});

describe("CASE W — dette à 0 %, rendement positif", () => {
  it("ne récompense jamais le remboursement accéléré par un financement gratuit", () => {
    const start = opening({ bankCash: 500, marketInvestedAssets: 5000, loanBalance: 12000 });
    const assume = assumptions({
      operatingSurplus: 300,
      investmentAllocationRate: 1,
      annualReturn: 0.055,
    });
    const slow = runDeterministicModel(start, [zeroRateLoan(100, 120)], assume, 180);
    const fast = runDeterministicModel(start, [zeroRateLoan(500, 24)], assume, 180);
    // Rembourser vite une dette à 0 % immobilise de la trésorerie qui aurait pu être
    // investie : le résultat doit être défavorable, jamais l'inverse.
    expect(fast.states[180].netWorth).toBeLessThan(slow.states[180].netWorth);
    // Et aucun euro n'a été investi pendant qu'un besoin de financement subsistait.
    for (const state of fast.states) {
      if (state.openingFundingGap > 0.005 && state.investmentContribution > 0) {
        expect(state.fundingGap).toBeCloseTo(0, 6);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// DEBT V2 — intégrité de l'interconnexion dette / bilan mensuel
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("CASE DM1 — différé total à intérêts capitalisés", () => {
  it("ne touche pas la trésorerie, alourdit la dette, fait baisser le net worth d’autant", () => {
    const start = opening({ bankCash: 50000, loanBalance: 100000 });
    const state = oneMonth(start, {
      interest: 0,
      capitalisedInterest: 300,
      principal: 0,
      insurance: 0,
      fees: 0,
      cashOut: 0,
    });

    // Aucun euro ne sort : la trésorerie est inchangée par la dette.
    expect(state.debtCashOut).toBeCloseTo(0, 9);
    expect(state.bankCash).toBeCloseTo(50000, 9);
    // La dette grossit de l'intérêt capitalisé.
    expect(state.loanBalance).toBeCloseTo(100300, 9);
    // Le patrimoine net baisse exactement de 300 €, ni plus ni moins.
    expect(state.netWorth).toBeCloseTo(start.netWorth - 300, 9);
    expect(state.netWorthChange).toBeCloseTo(-300, 9);
    expect(state.economicDebtCosts).toBeCloseTo(300, 9);
    // Aucun double comptage : l'attribution économique explique la totalité de la variation.
    expect(state.attributionResidual).toBeCloseTo(0, 9);
    expect(state.capitalisedInterestAccrued).toBeCloseTo(300, 9);
    // L'intérêt capitalisé n'est pas un intérêt payé.
    expect(state.interestPaid).toBeCloseTo(0, 9);
  });

  it("se distingue d’un intérêt de 300 € réellement payé", () => {
    const start = opening({ bankCash: 50000, loanBalance: 100000 });
    const paye = oneMonth(start, { interest: 300, cashOut: 300 });
    const capitalise = oneMonth(start, { capitalisedInterest: 300 });
    // Même coût économique, même baisse de patrimoine.
    expect(paye.economicDebtCosts).toBeCloseTo(capitalise.economicDebtCosts, 9);
    expect(paye.netWorthChange).toBeCloseTo(capitalise.netWorthChange, 9);
    // Mais l'un vide le compte et laisse la dette intacte, l'autre l'inverse.
    expect(paye.bankCash).toBeCloseTo(49700, 9);
    expect(paye.loanBalance).toBeCloseTo(100000, 9);
    expect(capitalise.bankCash).toBeCloseTo(50000, 9);
    expect(capitalise.loanBalance).toBeCloseTo(100300, 9);
  });
});

describe("CASE DM2 — remboursement anticipé et frais ponctuel", () => {
  it("un remboursement anticipé ne coûte que son indemnité en patrimoine", () => {
    const start = opening({ bankCash: 50000, loanBalance: 100000 });
    const state = oneMonth(start, { principal: 10000, fees: 200, cashOut: 10200 });

    expect(state.debtCashOut).toBeCloseTo(10200, 9);
    expect(state.loanBalance).toBeCloseTo(90000, 9);
    // Les 10 000 € de capital ne détruisent aucun patrimoine : ils passent d'un côté à
    // l'autre du bilan. Seule l'indemnité appauvrit.
    expect(state.economicDebtCosts).toBeCloseTo(200, 9);
    expect(state.netWorthChange).toBeCloseTo(-200, 9);
    expect(state.attributionResidual).toBeCloseTo(0, 9);
  });

  it("un frais ponctuel sort du compte et appauvrit sans toucher au capital", () => {
    const start = opening({ bankCash: 50000, loanBalance: 100000 });
    const state = oneMonth(start, { fees: 150, cashOut: 150 });

    expect(state.debtCashOut).toBeCloseTo(150, 9);
    expect(state.principalPaid).toBeCloseTo(0, 9);
    expect(state.loanBalance).toBeCloseTo(100000, 9);
    expect(state.economicDebtCosts).toBeCloseTo(150, 9);
    expect(state.netWorthChange).toBeCloseTo(-150, 9);
    expect(state.attributionResidual).toBeCloseTo(0, 9);
  });
});

describe("CASE DM3 — le calendrier de dette transporte l’intérêt capitalisé", () => {
  it("de l’échéancier forward jusqu’au bilan mensuel, sans perte", () => {
    const liability: Liability = {
      id: "lia_defer",
      name: "Prêt en différé total",
      lender: "Banque",
      principal: 100000,
      currentBalance: 100000,
      annualRate: 0.036,
      monthlyPayment: 600,
      paymentCount: 240,
      firstPaymentDate: "2026-09-05",
      maturityDate: "2046-08-05",
      ...UNDECLARED_LOAN_TERMS,
      deferral: { kind: "TOTAL", months: 6, interestTreatment: "CAPITALISED" },
      provenance,
    };
    const calendar = buildDebtCalendar([liability], "2026-08-19", 3);
    // Premier mois projeté : rien ne sort, 300 € courent.
    expect(calendar[1].cashOut).toBeCloseTo(0, 9);
    expect(calendar[1].capitalisedInterest).toBeCloseTo((100000 * 0.036) / 12, 6);

    const model = runMonthlyModel({
      opening: opening({ bankCash: 20000, loanBalance: 100000 }),
      liabilities: [liability],
      assumptions: assumptions({ operatingSurplus: 0 }),
      months: 3,
      marketReturn: () => 0,
    });
    const premier = model.states[1];
    expect(premier.debtCashOut).toBeCloseTo(0, 9);
    expect(premier.bankCash).toBeCloseTo(20000, 9);
    expect(premier.loanBalance).toBeGreaterThan(100000);
    expect(premier.netWorthChange).toBeCloseTo(-premier.economicDebtCosts, 9);
    // La dette continue de grossir mois après mois pendant le différé.
    expect(model.states[3].loanBalance).toBeGreaterThan(model.states[1].loanBalance);
    for (const state of model.states.slice(1)) {
      expect(state.attributionResidual).toBeCloseTo(0, 6);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// DEBT V2.1 — les nouveaux profils traversent toute la chaîne
// ═══════════════════════════════════════════════════════════════════════════════════════

function debtLoan(overrides: Partial<Liability>): Liability {
  return {
    id: "lia_v21",
    name: "Prêt",
    lender: "Banque",
    principal: 120000,
    currentBalance: 120000,
    annualRate: 0.036,
    monthlyPayment: 0,
    paymentCount: 24,
    firstPaymentDate: "2026-09-05",
    maturityDate: "2028-08-05",
    ...UNDECLARED_LOAN_TERMS,
    provenance,
    ...overrides,
  };
}

describe("CASE DM4 — in fine à travers le bilan mensuel", () => {
  it("laisse la dette intacte puis la solde d’un coup, sans détruire de patrimoine", () => {
    const liability = debtLoan({ amortisationProfile: "BULLET", paymentCount: 24 });
    const model = runMonthlyModel({
      opening: opening({ bankCash: 200000, loanBalance: 120000 }),
      liabilities: [liability],
      assumptions: assumptions({ operatingSurplus: 0 }),
      months: 24,
      marketReturn: () => 0,
    });
    // Pendant toute la vie du prêt, seul l'intérêt sort et la dette ne bouge pas.
    const courant = model.states[5];
    expect(courant.principalPaid).toBeCloseTo(0, 9);
    expect(courant.debtCashOut).toBeCloseTo(360, 6);
    expect(courant.loanBalance).toBeCloseTo(120000, 6);
    expect(courant.netWorthChange).toBeCloseTo(-360, 6);

    // À maturité, 120 360 € sortent et la dette s'éteint : seul l'intérêt appauvrit.
    const maturite = model.states[24];
    expect(maturite.debtCashOut).toBeCloseTo(120360, 6);
    expect(maturite.principalPaid).toBeCloseTo(120000, 6);
    expect(maturite.loanBalance).toBeCloseTo(0, 6);
    expect(maturite.economicDebtCosts).toBeCloseTo(360, 6);
    expect(maturite.netWorthChange).toBeCloseTo(-360, 6);
    for (const state of model.states.slice(1)) {
      expect(state.attributionResidual).toBeCloseTo(0, 6);
    }
  });
});

describe("CASE DM5 — dette trimestrielle à travers le bilan mensuel", () => {
  it("ne facture rien les mois sans échéance, sans lissage", () => {
    const liability = debtLoan({
      paymentFrequency: "QUARTERLY",
      paymentCount: 8,
      maturityDate: "2028-06-05",
    });
    const calendar = buildDebtCalendar([liability], "2026-08-19", 6);
    // Septembre porte l'échéance, octobre et novembre sont vides, décembre reprend.
    expect(calendar[1].cashOut).toBeGreaterThan(0);
    expect(calendar[2].cashOut).toBeCloseTo(0, 9);
    expect(calendar[3].cashOut).toBeCloseTo(0, 9);
    expect(calendar[4].cashOut).toBeGreaterThan(0);

    const model = runMonthlyModel({
      opening: opening({ bankCash: 100000, loanBalance: 120000 }),
      liabilities: [liability],
      assumptions: assumptions({ operatingSurplus: 0 }),
      months: 6,
      marketReturn: () => 0,
    });
    expect(model.states[2].debtCashOut).toBeCloseTo(0, 9);
    expect(model.states[2].loanBalance).toBeCloseTo(model.states[1].loanBalance, 9);
    expect(model.states[4].debtCashOut).toBeGreaterThan(0);
    for (const state of model.states.slice(1)) {
      expect(state.attributionResidual).toBeCloseTo(0, 6);
    }
  });
});

describe("CASE DM6 — frais financé à travers le bilan mensuel", () => {
  it("n’entame pas la trésorerie, alourdit la dette, appauvrit d’autant", () => {
    const liability = debtLoan({
      monthlyPayment: 0,
      amortisationProfile: "INTEREST_ONLY",
      oneOffCharges: [
        {
          id: "c",
          liabilityId: "lia_v21",
          date: "2026-09-20",
          amount: 900,
          label: "Frais financés",
          financed: true,
        },
      ],
    });
    const model = runMonthlyModel({
      opening: opening({ bankCash: 50000, loanBalance: 120000 }),
      liabilities: [liability],
      assumptions: assumptions({ operatingSurplus: 0 }),
      months: 2,
      marketReturn: () => 0,
    });
    const septembre = model.states[1];
    // Seul l'intérêt sort : les 900 € financés ne quittent pas le compte.
    expect(septembre.debtCashOut).toBeCloseTo(360, 6);
    // Mais la dette monte de 900 € malgré un capital remboursé nul.
    expect(septembre.principalPaid).toBeCloseTo(0, 9);
    expect(septembre.loanBalance).toBeCloseTo(120900, 6);
    expect(septembre.economicDebtCosts).toBeCloseTo(360 + 900, 6);
    expect(septembre.netWorthChange).toBeCloseTo(-(360 + 900), 6);
    expect(septembre.attributionResidual).toBeCloseTo(0, 6);
  });
});
