import { describe, expect, it } from "vitest";
import {
  cashRunwayDays,
  compareBudgets,
  compareSurplusToScenario,
  computeObservedCashFlow,
  effectiveCashFlowKind,
  categoryIndex,
  expandRecurringRule,
  forecastCashFlow,
  monthPeriod,
  trailingPeriod,
} from "@/lib/engine/cash-flow";
import type {
  CashFlowKind,
  Essentiality,
  ExpenseBehavior,
  ExpenseCategory,
  Liability,
  Provenance,
  RecurringCashFlowRule,
  Transaction,
} from "@/lib/types";

const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH" };
const AS_OF = "2026-08-19";
const MONTH = monthPeriod(AS_OF);

function category(
  id: string,
  name: string,
  cashFlowKind: CashFlowKind,
  essentiality: Essentiality = "UNKNOWN",
  behavior: ExpenseBehavior = "UNKNOWN",
  monthlyAmount: number | null = null,
): ExpenseCategory {
  return {
    id,
    name,
    // Le groupe porte un libellé arbitraire : le moteur ne doit jamais le lire.
    groupName: "Libellé sans rôle de calcul",
    cashFlowKind,
    essentiality,
    behavior,
    monthlyAmount,
    essential: essentiality === "ESSENTIAL",
    archived: false,
    provenance,
  };
}

const categories: ExpenseCategory[] = [
  category("c_salary", "Salaire", "INCOME"),
  category("c_rent", "Loyer", "EXPENSE", "ESSENTIAL", "FIXED", 1100),
  category("c_resto", "Restaurants", "EXPENSE", "NON_ESSENTIAL", "DISCRETIONARY", 200),
  category("c_groceries", "Courses", "EXPENSE", "ESSENTIAL", "VARIABLE", 400),
  category("c_transfer", "Transfert interne", "INTERNAL_TRANSFER"),
  category("c_invest", "Investissement", "INVESTMENT"),
  category("c_debt", "Service de dette", "DEBT_SERVICE"),
  category("c_tax", "Impôts", "TAX"),
  category("c_refund", "Remboursement", "REFUND"),
  category("c_unknown", "À classer", "UNCLASSIFIED"),
];

let sequence = 0;
function tx(
  categoryId: string,
  amount: number,
  date = "2026-08-05",
  extra: Partial<Transaction> = {},
): Transaction {
  sequence += 1;
  return {
    id: `t${sequence}`,
    accountId: "acc",
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
    ...extra,
  };
}

const observe = (transactions: Transaction[]) =>
  computeObservedCashFlow(transactions, categories, MONTH.start, MONTH.end);

describe("CASE A — revenu et dépense", () => {
  it("sépare le revenu de la dépense de consommation", () => {
    const result = observe([tx("c_salary", 3000), tx("c_rent", -1100)]);
    expect(result.income).toBeCloseTo(3000, 6);
    expect(result.consumerExpenses).toBeCloseTo(1100, 6);
  });
});

describe("CASE B — transfert interne", () => {
  it("n’est ni un revenu ni une dépense", () => {
    const result = observe([tx("c_transfer", -500)]);
    expect(result.consumerExpenses).toBe(0);
    expect(result.income).toBe(0);
    expect(result.internalTransferVolume).toBeCloseTo(500, 6);
  });
});

describe("CASE C — achat de titres dans l’enveloppe", () => {
  it("n’est pas une dépense de consommation et ne crée aucune richesse", () => {
    const result = observe([tx("c_invest", -500)]);
    expect(result.consumerExpenses).toBe(0);
    expect(result.investmentFlows).toBeCloseTo(500, 6);
    expect(result.operatingCashFlowBeforeDebt).toBe(0);
  });
});

describe("CASE D — service de dette", () => {
  it("est isolé de la consommation", () => {
    const result = observe([tx("c_debt", -284.72)]);
    expect(result.debtServicePaid).toBeCloseTo(284.72, 6);
    expect(result.consumerExpenses).toBe(0);
  });
});

describe("CASE E — dépense essentielle et fixe", () => {
  it("alimente les deux axes de classification", () => {
    const result = observe([tx("c_rent", -1100)]);
    expect(result.essentialExpenses).toBeCloseTo(1100, 6);
    expect(result.fixedExpenses).toBeCloseTo(1100, 6);
    expect(result.discretionaryExpenses).toBe(0);
  });
});

describe("CASE F — dépense discrétionnaire", () => {
  it("est agrégée séparément des essentielles", () => {
    const result = observe([tx("c_rent", -1100), tx("c_resto", -80)]);
    expect(result.discretionaryExpenses).toBeCloseTo(80, 6);
    expect(result.breakdown.nonEssential).toBeCloseTo(80, 6);
    expect(result.essentialExpenses).toBeCloseTo(1100, 6);
  });
});

describe("CASE G — remboursement reçu", () => {
  it("n’est pas compté comme un salaire", () => {
    const result = observe([tx("c_refund", 200)]);
    expect(result.income).toBe(0);
    expect(result.refunds).toBeCloseTo(200, 6);
  });
});

describe("CASE H — transaction non classifiée", () => {
  it("dégrade la qualité des données", () => {
    const result = observe([tx("c_salary", 3000), tx("c_unknown", -50)]);
    expect(result.dataQuality.unclassifiedTransactionCount).toBe(1);
    expect(result.dataQuality.status).toBe("PARTIAL");
    expect(result.dataQuality.reasons.join(" ")).toContain("non classifiée");
  });
});

describe("CASE I — aucun revenu observé", () => {
  it("laisse le taux d’épargne non calculable", () => {
    const result = observe([tx("c_rent", -1100)]);
    expect(result.observedSavingsRate).toBeNull();
    expect(result.observedInvestmentRate).toBeNull();
    expect(result.dataQuality.status).toBe("INCOMPLETE");
  });
});

describe("CASE J — transfert à deux jambes", () => {
  it("a une somme économique nette nulle", () => {
    const result = observe([
      tx("c_transfer", -500, "2026-08-05", { transferGroupId: "g1" }),
      tx("c_transfer", 500, "2026-08-05", { transferGroupId: "g1" }),
    ]);
    expect(result.internalTransfers).toBeCloseTo(0, 6);
    expect(result.internalTransferVolume).toBeCloseTo(500, 6);
    expect(result.dataQuality.unmatchedTransferCount).toBe(0);
    expect(result.operatingCashFlowBeforeDebt).toBe(0);
  });

  it("signale une jambe orpheline", () => {
    const result = observe([tx("c_transfer", -500)]);
    expect(result.dataQuality.unmatchedTransferCount).toBe(1);
  });
});

describe("CASE R et S — définition du surplus", () => {
  const transactions = [
    tx("c_salary", 3000),
    tx("c_rent", -1100),
    tx("c_groceries", -400),
    tx("c_tax", -150),
    tx("c_debt", -284.72),
    tx("c_invest", -500),
    tx("c_transfer", -800),
  ];

  it("CASE R : surplus avant dette = revenu − consommation − impôts", () => {
    const result = observe(transactions);
    expect(result.operatingCashFlowBeforeDebt).toBeCloseTo(3000 - 1500 - 150, 6);
  });

  it("CASE S : surplus après dette = surplus avant dette − service de dette", () => {
    const result = observe(transactions);
    expect(result.cashFlowAfterDebt).toBeCloseTo(
      result.operatingCashFlowBeforeDebt - result.debtServicePaid,
      6,
    );
    expect(result.cashFlowAfterDebt).toBeCloseTo(1350 - 284.72, 6);
  });

  it("CASE T : le transfert interne n’affecte ni l’un ni l’autre", () => {
    const withoutTransfer = observe(
      transactions.filter((item) => item.categoryId !== "c_transfer"),
    );
    const withTransfer = observe(transactions);
    expect(withTransfer.operatingCashFlowBeforeDebt).toBeCloseTo(
      withoutTransfer.operatingCashFlowBeforeDebt,
      6,
    );
    expect(withTransfer.cashFlowAfterDebt).toBeCloseTo(withoutTransfer.cashFlowAfterDebt, 6);
  });

  it("CASE U : l’investissement n’entre pas dans les dépenses de consommation", () => {
    const result = observe(transactions);
    expect(result.consumerExpenses).toBeCloseTo(1500, 6);
    expect(result.investmentFlows).toBeCloseTo(500, 6);
  });
});

describe("override de nature", () => {
  it("prime sur la catégorie et sort la ligne des dépenses", () => {
    const index = categoryIndex(categories);
    const overridden = tx("c_rent", -500, "2026-08-05", { kindOverride: "INTERNAL_TRANSFER" });
    expect(effectiveCashFlowKind(overridden, index)).toBe("INTERNAL_TRANSFER");
    const result = observe([overridden]);
    expect(result.consumerExpenses).toBe(0);
    expect(result.internalTransferVolume).toBeCloseTo(500, 6);
  });
});

describe("un remboursement sur une catégorie de dépense", () => {
  it("réduit la dépense au lieu de devenir un revenu", () => {
    const result = observe([tx("c_rent", -1100), tx("c_rent", 200)]);
    expect(result.income).toBe(0);
    expect(result.consumerExpenses).toBeCloseTo(900, 6);
  });
});

/* ------------------------------------------------------------------ */

const rentRule: RecurringCashFlowRule = {
  id: "r_rent",
  name: "Loyer",
  cashFlowKind: "EXPENSE",
  categoryId: "c_rent",
  categoryName: "Loyer",
  accountId: null,
  amount: -1100,
  frequency: "MONTHLY",
  startDate: "2026-09-05",
  endDate: null,
  dayOfMonth: 5,
  active: true,
  provenance,
};

const studentLoan: Liability = {
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

describe("CASE M — règle mensuelle et horizon 90 jours", () => {
  it("produit exactement les échéances attendues", () => {
    const occurrences = expandRecurringRule(rentRule, AS_OF, "2026-11-17");
    expect(occurrences.map((item) => item.date)).toEqual([
      "2026-09-05",
      "2026-10-05",
      "2026-11-05",
    ]);
    const forecast = forecastCashFlow({
      asOfDate: AS_OF,
      horizonDays: 90,
      openingCash: 1000,
      rules: [rentRule],
      liabilities: [],
    });
    expect(forecast.forecastConsumerExpenses).toBeCloseTo(3300, 6);
    expect(forecast.forecastEndingCash).toBeCloseTo(1000 - 3300, 6);
  });

  it("respecte la date de fin et l’état inactif", () => {
    expect(
      expandRecurringRule({ ...rentRule, endDate: "2026-10-01" }, AS_OF, "2026-12-31"),
    ).toHaveLength(1);
    expect(expandRecurringRule({ ...rentRule, active: false }, AS_OF, "2026-12-31")).toHaveLength(
      0,
    );
  });
});

describe("CASE N — la dette future vient du Debt Engine", () => {
  it("consomme l’échéancier forward sans recalculer d’amortissement", () => {
    const forecast = forecastCashFlow({
      asOfDate: AS_OF,
      horizonDays: 365,
      openingCash: 5000,
      rules: [],
      liabilities: [studentLoan],
    });
    const debtOccurrences = forecast.occurrences.filter((item) => item.source === "DEBT_SCHEDULE");
    // Première échéance le 2026-12-05, puis une par mois dans l'horizon.
    expect(debtOccurrences[0].date).toBe("2026-12-05");
    expect(debtOccurrences).toHaveLength(9);
    expect(forecast.forecastDebtService).toBeCloseTo(284.72 * 9, 4);
  });
});

describe("CASE O — dépense variable non récurrente", () => {
  it("n’est jamais extrapolée dans la prévision", () => {
    const forecast = forecastCashFlow({
      asOfDate: AS_OF,
      horizonDays: 365,
      openingCash: 1000,
      rules: [],
      liabilities: [],
    });
    // Le ledger contient des courses passées, mais aucune règle ne les déclare.
    expect(forecast.forecastConsumerExpenses).toBe(0);
    expect(forecast.occurrences).toHaveLength(0);
    expect(forecast.forecastEndingCash).toBeCloseTo(1000, 6);
  });
});

describe("runway de trésorerie", () => {
  it("date le passage sous zéro et reste nul quand il n’a pas lieu", () => {
    const short = forecastCashFlow({
      asOfDate: AS_OF,
      horizonDays: 365,
      openingCash: 1500,
      rules: [rentRule],
      liabilities: [],
    });
    expect(cashRunwayDays(short)).toBe(47); // 2026-10-05
    const comfortable = forecastCashFlow({
      asOfDate: AS_OF,
      horizonDays: 365,
      openingCash: 100000,
      rules: [rentRule],
      liabilities: [],
    });
    expect(cashRunwayDays(comfortable)).toBeNull();
  });
});

describe("CASE P — budget contre réalisé", () => {
  it("identifie le dépassement", () => {
    const lines = compareBudgets(
      [category("c_resto", "Restaurants", "EXPENSE", "NON_ESSENTIAL", "DISCRETIONARY", 500)],
      [tx("c_resto", -650)],
      MONTH.start,
      MONTH.end,
    );
    expect(lines[0].budget).toBe(500);
    expect(lines[0].actual).toBeCloseTo(650, 6);
    expect(lines[0].variance).toBeCloseTo(150, 6);
    expect(lines[0].overBudget).toBe(true);
  });

  it("laisse l’écart non calculable sans budget défini", () => {
    const lines = compareBudgets(
      [category("c_resto", "Restaurants", "EXPENSE", "NON_ESSENTIAL", "DISCRETIONARY", null)],
      [tx("c_resto", -650)],
      MONTH.start,
      MONTH.end,
    );
    expect(lines[0].variance).toBeNull();
    expect(lines[0].overBudget).toBe(false);
  });
});

describe("CASE V — périodes glissantes", () => {
  it("borne exactement T3M et T12M autour de la date d’observation", () => {
    expect(trailingPeriod(AS_OF, 3)).toEqual({ start: "2026-06-01", end: "2026-08-31" });
    expect(trailingPeriod(AS_OF, 12)).toEqual({ start: "2025-09-01", end: "2026-08-31" });
    expect(monthPeriod(AS_OF)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("exclut les flux hors période", () => {
    const result = observe([
      tx("c_salary", 3000, "2026-07-31"),
      tx("c_salary", 1000, "2026-08-02"),
    ]);
    expect(result.income).toBeCloseTo(1000, 6);
  });
});

describe("comparaison au scénario", () => {
  it("confronte l’hypothèse au surplus observé sans jamais la remplacer", () => {
    const transactions = [tx("c_salary", 3000), tx("c_rent", -1100), tx("c_tax", -150)];
    const comparison = compareSurplusToScenario(transactions, categories, AS_OF, 250);
    expect(comparison.scenarioAssumption).toBe(250);
    expect(comparison.observedMonth).toBeCloseTo(1750, 6);
    // Un seul mois observé sur trois : la moyenne T3M dilue mécaniquement.
    expect(comparison.observedT3M).toBeCloseTo(1750 / 3, 6);
    expect(comparison.differenceT3M).toBeCloseTo(1750 / 3 - 250, 6);
  });
});
