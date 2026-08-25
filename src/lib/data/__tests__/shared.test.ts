import { describe, expect, it } from "vitest";
import { UNDECLARED_LOAN_TERMS } from "@/lib/engine/debt";
import {
  composeDashboardMetrics,
  computeFlowRates,
  deriveFlowMetrics,
  ledgerWindowStart,
  shouldDeriveBalance,
} from "@/lib/data/shared";
import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import { deriveCanonicalBalanceSheetMetrics } from "@/lib/engine/balance-sheet-metrics";
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

describe("deriveFlowMetrics", () => {
  const metrics = deriveFlowMetrics(liabilities, incomes, expenses, [], AS_OF);

  it("exclut les revenus inactifs et les dépenses inconnues", () => {
    expect(metrics.monthlyIncome).toBeCloseTo(2000, 2);
    expect(metrics.monthlyExpenses).toBeCloseTo(800, 2);
  });

  it("n'expose aucune grandeur de bilan : elles appartiennent au bilan canonique", () => {
    // Aucune somme de soldes natifs ne subsiste dans cette dérivation : c'est la seule
    // garantie qu'il ne reste pas une seconde vérité patrimoniale à côté du bilan.
    expect(Object.keys(metrics).sort()).toEqual([
      "dataCompleteness",
      "freeCashFlow",
      "investmentRate",
      "monthlyDebtService",
      "monthlyExpenses",
      "monthlyIncome",
      "savingsRate",
    ]);
  });

  it("n'exige aucun service de dette avant la première échéance", () => {
    // Première échéance après la date d'observation : aucune ligne exigible.
    expect(metrics.monthlyDebtService).toBe(0);
    expect(metrics.freeCashFlow).toBeCloseTo(1200, 2);
  });

  it("exige la mensualité pendant la période de remboursement", () => {
    const active = deriveFlowMetrics(liabilities, incomes, expenses, [], "2030-05-15");
    expect(active.monthlyDebtService).toBeCloseTo(100, 2);
    expect(active.freeCashFlow).toBeCloseTo(1100, 2);
  });

  it("n'exige plus rien après la dernière échéance", () => {
    const after = deriveFlowMetrics(liabilities, incomes, expenses, [], "2035-01-15");
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
    const both = deriveFlowMetrics([liabilities[0], second], incomes, expenses, [], "2030-05-15");
    expect(both.monthlyDebtService).toBeCloseTo(150, 2);
  });

  it("laisse les taux de flux non calculables sans ledger", () => {
    expect(metrics.savingsRate).toBeNull();
    expect(metrics.investmentRate).toBeNull();
  });

  it("mesure la complétude des données de budget", () => {
    expect(metrics.dataCompleteness).toBeCloseTo(0.5, 6);
  });

  it("ne divise pas par zéro sans revenu ni dépense essentielle", () => {
    const empty = deriveFlowMetrics([], [], [], [], AS_OF);
    expect(empty.monthlyDebtService).toBe(0);
    expect(empty.savingsRate).toBeNull();
    expect(empty.dataCompleteness).toBe(0);
  });
});

/**
 * Composition des métriques du cockpit. Le point à garder est qu'aucune valeur de bilan
 * n'est recalculée ici : elles sont recopiées du bilan canonique, `null` compris.
 */
describe("composeDashboardMetrics", () => {
  const rate = (rateDate: string, value: number) => ({
    baseCurrency: "USD",
    quoteCurrency: "EUR",
    rate: value,
    rateDate,
    provenance,
  });

  function compose(input: {
    accounts: FinancialAccount[];
    positions?: Position[];
    liabilities?: Liability[];
    expenses?: ExpenseCategory[];
    currencyRates?: Array<ReturnType<typeof rate>>;
  }) {
    const balanceSheet = buildCanonicalBalanceSheet({
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      accounts: input.accounts,
      positions: input.positions ?? [],
      liabilities: input.liabilities ?? [],
      currencyRates: input.currencyRates ?? [],
    });
    const balanceSheetMetrics = deriveCanonicalBalanceSheetMetrics({
      balanceSheet,
      liabilities: input.liabilities ?? [],
      expenses: input.expenses ?? [],
      positions: input.positions ?? [],
    });
    return composeDashboardMetrics({
      balanceSheet,
      balanceSheetMetrics,
      flow: deriveFlowMetrics(input.liabilities ?? [], incomes, input.expenses ?? [], [], AS_OF),
    });
  }

  it("reprend la structure canonique sans la recalculer", () => {
    const metrics = compose({ accounts, positions, liabilities });
    expect(metrics.grossAssets).toBeCloseTo(10_000, 6);
    expect(metrics.debt).toBeCloseTo(4000, 6);
    expect(metrics.netWorth).toBeCloseTo(6000, 6);
    expect(metrics.bankCash).toBeCloseTo(1000, 6);
    expect(metrics.investedAssets).toBeCloseTo(6000, 6);
    // Métrique V2 explicitement non calculable tant que les passifs ne sont pas attribués.
    expect(metrics.productiveNetWorth).toBeNull();
  });

  it("convertit un compte en devise étrangère au taux daté", () => {
    const foreign: FinancialAccount = {
      ...accounts[0],
      id: "usd",
      name: "Compte USD test",
      currency: "USD",
      balance: 2000,
    };
    const metrics = compose({
      accounts: [accounts[0], foreign],
      currencyRates: [rate("2030-01-15", 0.9)],
    });
    expect(metrics.grossAssets).toBeCloseTo(1000 + 1800, 6);
    expect(metrics.bankCash).toBeCloseTo(1000 + 1800, 6);
  });

  it("laisse le patrimoine non calculable quand un taux manque au lieu de compter zéro", () => {
    const foreign: FinancialAccount = {
      ...accounts[0],
      id: "usd",
      name: "Compte USD test",
      currency: "USD",
      balance: 2000,
    };
    const metrics = compose({ accounts: [accounts[0], foreign] });
    expect(metrics.grossAssets).toBeNull();
    expect(metrics.netWorth).toBeNull();
    expect(metrics.bankCash).toBeNull();
  });

  it("dérive la couverture de liquidité du cash immédiat canonique", () => {
    const known = expenses.filter((expense) => expense.monthlyAmount !== null);
    const metrics = compose({ accounts, positions, liabilities, expenses: known });
    // 1 000 € de cash immédiat pour 800 € de dépenses essentielles connues, sans échéance
    // exigible dans les 30 jours suivant la date d'observation.
    expect(metrics.monthlyDebtService).toBe(0);
    expect(metrics.emergencyCoverageMonths).toBeCloseTo(1000 / 800, 6);
  });

  it("intègre le service de dette exigible au dénominateur de la couverture", () => {
    const known = expenses.filter((expense) => expense.monthlyAmount !== null);
    const due: Liability = { ...liabilities[0], firstPaymentDate: "2030-02-05" };
    const balanceSheet = buildCanonicalBalanceSheet({
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      accounts,
      positions,
      liabilities: [due],
    });
    const balanceSheetMetrics = deriveCanonicalBalanceSheetMetrics({
      balanceSheet,
      liabilities: [due],
      expenses: known,
      positions,
    });
    const metrics = composeDashboardMetrics({
      balanceSheet,
      balanceSheetMetrics,
      flow: deriveFlowMetrics([due], incomes, known, [], AS_OF),
    });
    expect(metrics.emergencyCoverageMonths).toBeCloseTo(1000 / (800 + 100), 6);
  });

  it("rend la couverture non calculable quand une dépense essentielle manque", () => {
    const metrics = compose({ accounts, positions, liabilities, expenses });
    expect(metrics.emergencyCoverageMonths).toBeNull();
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
