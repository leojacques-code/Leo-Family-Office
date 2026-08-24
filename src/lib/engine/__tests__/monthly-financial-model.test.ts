import { describe, expect, it } from "vitest";
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

const noDebt = { interest: 0, principal: 0, insurance: 0, fees: 0, cashOut: 0 };

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
      provenance,
    };
    const heavy: Liability = {
      ...light,
      monthlyPayment: 700,
      paymentCount: 26,
      maturityDate: "2028-10-05",
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
          provenance,
        },
      ],
      incomes: [],
      expenseCategories: [],
      transactions: [],
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
