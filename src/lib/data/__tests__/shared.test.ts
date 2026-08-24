import { describe, expect, it } from "vitest";
import {
  computeFlowRates,
  deriveMetrics,
  ledgerWindowStart,
  shouldDeriveBalance,
} from "@/lib/data/shared";
import type {
  ExpenseCategory,
  FinancialAccount,
  IncomeSource,
  Liability,
  Position,
  Provenance,
  Transaction,
} from "@/lib/types";

const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH" };

const accounts: FinancialAccount[] = [
  {
    id: "a",
    institutionId: "i",
    institution: "Boursobank",
    name: "Ultim",
    type: "BANK",
    currency: "EUR",
    balance: 355.48,
    balanceDate: "2026-08-19",
    liquidity: "IMMEDIATE",
    provenance,
  },
  {
    id: "b",
    institutionId: "i",
    institution: "Boursobank",
    name: "PEA",
    type: "PEA",
    currency: "EUR",
    balance: 15003.13,
    balanceDate: "2026-08-19",
    liquidity: "LIQUID",
    provenance,
  },
];
const liabilities: Liability[] = [
  {
    id: "l",
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
];
const incomes: IncomeSource[] = [
  {
    id: "i1",
    name: "Revenu net",
    monthlyNet: 1282,
    active: true,
    startDate: "2026-08-19",
    provenance,
  },
  { id: "i2", name: "Tennis", monthlyNet: 130, active: false, startDate: null, provenance },
];
const expenses: ExpenseCategory[] = [
  {
    id: "e1",
    name: "Loyer",
    groupName: "Logement",
    cashFlowKind: "EXPENSE",
    essentiality: "ESSENTIAL",
    behavior: "FIXED",
    monthlyAmount: 1140,
    essential: true,
    archived: false,
    provenance,
  },
  {
    id: "e2",
    name: "Électricité",
    groupName: "Logement",
    cashFlowKind: "EXPENSE",
    essentiality: "ESSENTIAL",
    behavior: "VARIABLE",
    monthlyAmount: null,
    essential: true,
    archived: false,
    provenance,
  },
];
const positions: Position[] = [
  {
    id: "p1",
    accountId: "b",
    securityName: "ETF World",
    assetClass: "Actions monde",
    value: 8698,
    currency: "EUR",
    isCash: false,
    provenance,
  },
  {
    id: "p2",
    accountId: "b",
    securityName: "Cash PEA",
    assetClass: "Cash",
    value: 6304.57,
    currency: "EUR",
    isCash: true,
    provenance,
  },
];

const AS_OF = "2026-08-19";

describe("deriveMetrics", () => {
  const metrics = deriveMetrics(accounts, liabilities, incomes, expenses, positions, [], AS_OF);

  it("additionne les soldes de comptes sans double compter les positions", () => {
    expect(metrics.grossAssets).toBeCloseTo(15358.61, 2);
    expect(metrics.investedAssets).toBeCloseTo(8698, 2);
  });

  it("calcule le patrimoine net et la dette", () => {
    expect(metrics.debt).toBeCloseTo(16745, 2);
    expect(metrics.netWorth).toBeCloseTo(-1386.39, 2);
  });

  it("exclut les revenus inactifs et les dépenses inconnues", () => {
    expect(metrics.monthlyIncome).toBeCloseTo(1282, 2);
    expect(metrics.monthlyExpenses).toBeCloseTo(1140, 2);
  });

  it("n'exige aucun service de dette avant la première échéance", () => {
    // Première échéance au 2026-12-05, observation au 2026-08-19 : aucune ligne exigible.
    expect(metrics.monthlyDebtService).toBe(0);
    expect(metrics.freeCashFlow).toBeCloseTo(142, 2);
  });

  it("exige la mensualité pendant la période de remboursement", () => {
    const active = deriveMetrics(
      accounts,
      liabilities,
      incomes,
      expenses,
      positions,
      [],
      "2026-12-19",
    );
    expect(active.monthlyDebtService).toBeCloseTo(284.72, 2);
    expect(active.freeCashFlow).toBeCloseTo(-142.72, 2);
  });

  it("n'exige plus rien après la dernière échéance", () => {
    const after = deriveMetrics(
      accounts,
      liabilities,
      incomes,
      expenses,
      positions,
      [],
      "2032-01-15",
    );
    expect(after.monthlyDebtService).toBe(0);
  });

  it("additionne le service de deux dettes exigibles le même mois", () => {
    const second: Liability = {
      ...liabilities[0],
      id: "l2",
      name: "Prêt auto",
      annualRate: 0.03,
      monthlyPayment: 200,
      principal: 10000,
      currentBalance: 10000,
      paymentCount: 60,
      firstPaymentDate: "2026-01-05",
      maturityDate: "2030-12-05",
    };
    const both = deriveMetrics(
      accounts,
      [liabilities[0], second],
      incomes,
      expenses,
      positions,
      [],
      "2026-12-19",
    );
    expect(both.monthlyDebtService).toBeCloseTo(484.72, 2);
  });

  it("ne compte comme liquide que ce que le champ liquidity qualifie", () => {
    const blocked: FinancialAccount = {
      ...accounts[0],
      id: "c",
      name: "Livret bloqué",
      liquidity: "ILLIQUID",
      balance: 5000,
    };
    const withBlocked = deriveMetrics(
      [...accounts, blocked],
      liabilities,
      incomes,
      expenses,
      positions,
      [],
      AS_OF,
    );
    expect(withBlocked.liquidAssets).toBeCloseTo(15358.61, 2);
    expect(withBlocked.grossAssets).toBeCloseTo(20358.61, 2);
    expect(withBlocked.liquidNetWorth).toBeCloseTo(15358.61 - 16745, 2);
  });

  it("laisse les taux de flux non calculables sans ledger", () => {
    expect(metrics.savingsRate).toBeNull();
    expect(metrics.investmentRate).toBeNull();
  });

  it("mesure la complétude des données de budget", () => {
    expect(metrics.dataCompleteness).toBeCloseTo(0.5, 6);
  });

  it("ne divise pas par zéro sans revenu ni dépense essentielle", () => {
    const empty = deriveMetrics([], [], [], [], [], [], AS_OF);
    expect(empty.monthlyDebtService).toBe(0);
    expect(empty.savingsRate).toBeNull();
    expect(empty.emergencyCoverageMonths).toBe(0);
    expect(empty.dataCompleteness).toBe(0);
  });
});

describe("computeFlowRates", () => {
  const categories: ExpenseCategory[] = [
    {
      id: "exp_income",
      name: "Revenu",
      groupName: "Revenus",
      cashFlowKind: "INCOME",
      essentiality: "UNKNOWN",
      behavior: "UNKNOWN",
      monthlyAmount: null,
      essential: false,
      archived: false,
      provenance,
    },
    {
      id: "exp_investment",
      name: "Investissement",
      groupName: "Épargne",
      cashFlowKind: "INVESTMENT",
      essentiality: "UNKNOWN",
      behavior: "UNKNOWN",
      monthlyAmount: null,
      essential: false,
      archived: false,
      provenance,
    },
    {
      id: "exp_rent",
      name: "Loyer",
      groupName: "Logement",
      cashFlowKind: "EXPENSE",
      essentiality: "ESSENTIAL",
      behavior: "FIXED",
      monthlyAmount: 1140,
      essential: true,
      archived: false,
      provenance,
    },
  ];
  const transaction = (categoryId: string, amount: number, date = "2026-08-05"): Transaction => ({
    id: `${categoryId}-${amount}`,
    accountId: "a",
    accountName: "Ultim",
    date,
    label: categoryId,
    categoryId,
    categoryName: categoryId,
    amount,
    currency: "EUR",
    kindOverride: null,
    transferGroupId: null,
    notes: null,
    provenance,
  });

  it("reste non calculable sans revenu encaissé observé", () => {
    const rates = computeFlowRates(
      [transaction("exp_rent", -1140)],
      categories,
      "2026-08-01",
      "2026-08-31",
    );
    expect(rates.savingsRate).toBeNull();
    expect(rates.investmentRate).toBeNull();
  });

  it("lit l’épargne et l’investissement constatés, jamais le free cash flow", () => {
    const rates = computeFlowRates(
      [
        transaction("exp_income", 3000),
        transaction("exp_rent", -1600),
        transaction("exp_investment", -500),
      ],
      categories,
      "2026-08-01",
      "2026-08-31",
    );
    // FCF de 900 € mais 500 € réellement épargnés : le taux constaté est 16,7 %, pas 30 %.
    expect(rates.savingsRate).toBeCloseTo(500 / 3000, 6);
    expect(rates.investmentRate).toBeCloseTo(500 / 3000, 6);
  });

  it("ignore les flux hors période", () => {
    const rates = computeFlowRates(
      [transaction("exp_income", 3000), transaction("exp_investment", -500, "2026-07-05")],
      categories,
      "2026-08-01",
      "2026-08-31",
    );
    expect(rates.savingsRate).toBe(0);
  });
});

describe("emergencyCoverageMonths", () => {
  it("ignore le service de dette quand aucune échéance n’est exigible", () => {
    const metrics = deriveMetrics(
      accounts,
      liabilities,
      incomes,
      expenses,
      positions,
      [],
      "2026-08-19",
    );
    expect(metrics.monthlyDebtService).toBe(0);
    expect(metrics.emergencyCoverageMonths).toBeCloseTo(355.48 / 1140, 6);
  });

  it("intègre le service de dette dans les dépenses incompressibles", () => {
    const metrics = deriveMetrics(
      accounts,
      liabilities,
      incomes,
      expenses,
      positions,
      [],
      "2026-12-19",
    );
    expect(metrics.monthlyDebtService).toBeCloseTo(284.72, 2);
    // La réserve doit couvrir loyer ET échéance : le dénominateur est 1 140 + 284,72.
    expect(metrics.emergencyCoverageMonths).toBeCloseTo(355.48 / (1140 + 284.72), 6);
  });
});

describe("shouldDeriveBalance", () => {
  it("répercute une transaction postérieure au dernier relevé", () => {
    expect(shouldDeriveBalance("2026-08-20", "2026-08-19")).toBe(true);
  });

  it("ne touche pas au solde pour une transaction antérieure ou du même jour", () => {
    // Un relevé du 19/08 contient déjà le mouvement du 10/08 : le répercuter le
    // compterait deux fois.
    expect(shouldDeriveBalance("2026-08-10", "2026-08-19")).toBe(false);
    expect(shouldDeriveBalance("2026-08-19", "2026-08-19")).toBe(false);
  });
});

describe("ledgerWindowStart", () => {
  it("ouvre la fenêtre au premier jour du sixième mois glissant", () => {
    expect(ledgerWindowStart("2026-08-19")).toBe("2026-03-01");
    expect(ledgerWindowStart("2027-01-05")).toBe("2026-08-01");
  });
});
