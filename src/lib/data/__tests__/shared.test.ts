import { describe, expect, it } from "vitest";
import { UNDECLARED_LOAN_TERMS } from "@/lib/engine/debt";
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

// Fixtures entièrement synthétiques : elles testent les invariants sans recopier de données utilisateur.
const accounts: FinancialAccount[] = [
  {
    id: "a",
    institutionId: "i",
    institution: "Banque Test",
    name: "Compte courant test",
    type: "BANK",
    currency: "EUR",
    balance: 1000,
    balanceDate: "2030-01-15",
    liquidity: "IMMEDIATE",
    provenance,
  },
  {
    id: "b",
    institutionId: "i",
    institution: "Courtier Test",
    name: "Compte investissement test",
    type: "CTO",
    currency: "EUR",
    balance: 9000,
    balanceDate: "2030-01-15",
    liquidity: "LIQUID",
    provenance,
  },
];
const liabilities: Liability[] = [
  {
    id: "l",
    name: "Dette test",
    lender: "Prêteur Test",
    principal: 4000,
    currentBalance: 4000,
    annualRate: 0,
    monthlyPayment: 100,
    paymentCount: 48,
    firstPaymentDate: "2030-05-05",
    maturityDate: "2034-04-05",
    ...UNDECLARED_LOAN_TERMS,
    provenance,
  },
];
const incomes: IncomeSource[] = [
  {
    id: "i1",
    name: "Revenu net",
    monthlyNet: 2000,
    active: true,
    startDate: "2030-01-15",
    provenance,
  },
  {
    id: "i2",
    name: "Revenu inactif test",
    monthlyNet: 500,
    active: false,
    startDate: null,
    provenance,
  },
];
const expenses: ExpenseCategory[] = [
  {
    id: "e1",
    name: "Loyer",
    groupName: "Logement",
    cashFlowKind: "EXPENSE",
    essentiality: "ESSENTIAL",
    behavior: "FIXED",
    monthlyAmount: 800,
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
    securityName: "Position test",
    assetClass: "Actif test",
    value: 6000,
    currency: "EUR",
    isCash: false,
    provenance,
  },
  {
    id: "p2",
    accountId: "b",
    securityName: "Cash interne test",
    assetClass: "Cash",
    value: 3000,
    currency: "EUR",
    isCash: true,
    provenance,
  },
];

const AS_OF = "2030-01-15";

describe("deriveMetrics", () => {
  const metrics = deriveMetrics(accounts, liabilities, incomes, expenses, positions, [], AS_OF);

  it("additionne les soldes de comptes sans double compter les positions", () => {
    expect(metrics.grossAssets).toBeCloseTo(10000, 2);
    expect(metrics.investedAssets).toBeCloseTo(6000, 2);
  });

  it("calcule le patrimoine net et la dette", () => {
    expect(metrics.debt).toBeCloseTo(4000, 2);
    expect(metrics.netWorth).toBeCloseTo(6000, 2);
  });

  it("exclut les revenus inactifs et les dépenses inconnues", () => {
    expect(metrics.monthlyIncome).toBeCloseTo(2000, 2);
    expect(metrics.monthlyExpenses).toBeCloseTo(800, 2);
  });

  it("n'exige aucun service de dette avant la première échéance", () => {
    // Première échéance après la date d'observation : aucune ligne exigible.
    expect(metrics.monthlyDebtService).toBe(0);
    expect(metrics.freeCashFlow).toBeCloseTo(1200, 2);
  });

  it("exige la mensualité pendant la période de remboursement", () => {
    const active = deriveMetrics(
      accounts,
      liabilities,
      incomes,
      expenses,
      positions,
      [],
      "2030-05-15",
    );
    expect(active.monthlyDebtService).toBeCloseTo(100, 2);
    expect(active.freeCashFlow).toBeCloseTo(1100, 2);
  });

  it("n'exige plus rien après la dernière échéance", () => {
    const after = deriveMetrics(
      accounts,
      liabilities,
      incomes,
      expenses,
      positions,
      [],
      "2035-01-15",
    );
    expect(after.monthlyDebtService).toBe(0);
  });

  it("additionne le service de deux dettes exigibles le même mois", () => {
    const second: Liability = {
      ...liabilities[0],
      id: "l2",
      name: "Seconde dette test",
      annualRate: 0.03,
      monthlyPayment: 50,
      principal: 2000,
      currentBalance: 2000,
      paymentCount: 60,
      firstPaymentDate: "2030-01-05",
      maturityDate: "2034-12-05",
      ...UNDECLARED_LOAN_TERMS,
    };
    const both = deriveMetrics(
      accounts,
      [liabilities[0], second],
      incomes,
      expenses,
      positions,
      [],
      "2030-05-15",
    );
    expect(both.monthlyDebtService).toBeCloseTo(150, 2);
  });

  it("ne compte comme liquide que ce que le champ liquidity qualifie", () => {
    const blocked: FinancialAccount = {
      ...accounts[0],
      id: "c",
      name: "Livret bloqué",
      liquidity: "ILLIQUID",
      balance: 3000,
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
    expect(withBlocked.liquidAssets).toBeCloseTo(10000, 2);
    expect(withBlocked.grossAssets).toBeCloseTo(13000, 2);
    expect(withBlocked.liquidNetWorth).toBeCloseTo(6000, 2);
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
    expect(empty.emergencyCoverageMonths).toBeNull();
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
      monthlyAmount: 800,
      essential: true,
      archived: false,
      provenance,
    },
  ];
  const transaction = (categoryId: string, amount: number, date = "2026-08-05"): Transaction => ({
    id: `${categoryId}-${amount}`,
    accountId: "a",
    accountName: "Compte test",
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
      [transaction("exp_rent", -800)],
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
      expenses.filter((expense) => expense.monthlyAmount !== null),
      positions,
      [],
      "2030-01-15",
    );
    expect(metrics.monthlyDebtService).toBe(0);
    expect(metrics.emergencyCoverageMonths).toBeCloseTo(1000 / 800, 6);
  });

  it("intègre le service de dette dans les dépenses incompressibles", () => {
    const metrics = deriveMetrics(
      accounts,
      liabilities,
      incomes,
      expenses.filter((expense) => expense.monthlyAmount !== null),
      positions,
      [],
      "2030-05-15",
    );
    expect(metrics.monthlyDebtService).toBeCloseTo(100, 2);
    expect(metrics.emergencyCoverageMonths).toBeCloseTo(1000 / (800 + 100), 6);
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
