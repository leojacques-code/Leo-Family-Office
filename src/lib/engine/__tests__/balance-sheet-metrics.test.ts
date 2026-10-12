import { describe, expect, it } from "vitest";
import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import { deriveCanonicalBalanceSheetMetrics } from "@/lib/engine/balance-sheet-metrics";
import { UNDECLARED_LOAN_TERMS } from "@/lib/engine/debt";
import type {
  ExpenseCategory,
  FinancialAccount,
  Liability,
  NetWorthSnapshot,
  Provenance,
} from "@/lib/types";

const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH", effectiveDate: "2026-08-19" };
const cash: FinancialAccount = {
  id: "cash",
  institutionId: "i",
  institution: "Bank",
  name: "Cash",
  type: "BANK",
  currency: "EUR",
  balance: 12_000,
  balanceDate: "2026-08-19",
  liquidity: "IMMEDIATE",
  provenance,
};

function quarterlyDebt(): Liability {
  return {
    id: "quarterly",
    name: "Quarterly loan",
    lender: "Bank",
    principal: 4000,
    currentBalance: 4000,
    annualRate: 0,
    monthlyPayment: 1000,
    paymentCount: 4,
    firstPaymentDate: "2026-09-15",
    maturityDate: "2027-06-15",
    ...UNDECLARED_LOAN_TERMS,
    paymentFrequency: "QUARTERLY",
    provenance,
  };
}

function metrics(
  expenses: ExpenseCategory[] = [],
  liabilities: Liability[] = [],
  snapshots: NetWorthSnapshot[] = [],
) {
  const balanceSheet = buildCanonicalBalanceSheet({
    asOfDate: "2026-08-19",
    reportingCurrency: "EUR",
    accounts: [cash],
    liabilities,
  });
  return deriveCanonicalBalanceSheetMetrics({
    balanceSheet,
    liabilities,
    expenses,
    positions: [],
    snapshots,
  });
}

describe("canonical balance-sheet metrics", () => {
  it("does not annualise a quarterly debt as twelve monthly payments", () => {
    const result = metrics([], [quarterlyDebt()]);
    expect(result.debt.service30d.value).toBeCloseTo(1000, 8);
    expect(result.debt.service90d.value).toBeCloseTo(1000, 8);
    expect(result.debt.service12m.value).toBeCloseTo(4000, 8);
    expect(result.debt.principal12m.value).toBeCloseTo(4000, 8);
  });

  it("marks emergency coverage non-computable when an essential expense is missing", () => {
    const expenses = [
      {
        id: "rent",
        name: "Rent",
        groupName: "Home",
        cashFlowKind: "EXPENSE",
        essentiality: "ESSENTIAL",
        behavior: "FIXED",
        monthlyAmount: null,
        essential: true,
        archived: false,
        provenance,
      },
    ] satisfies ExpenseCategory[];
    const result = metrics(expenses);
    expect(result.liquidity.monthlyIncompressibleOutflows.status).toBe("PARTIAL");
    expect(result.liquidity.cashCoverageMonths).toMatchObject({
      value: null,
      status: "NOT_COMPUTABLE",
    });
  });

  it("distinguishes explicit zero obligations from zero coverage", () => {
    const expenses = [
      {
        id: "rent",
        name: "Rent",
        groupName: "Home",
        cashFlowKind: "EXPENSE",
        essentiality: "ESSENTIAL",
        behavior: "FIXED",
        monthlyAmount: 0,
        essential: true,
        archived: false,
        provenance,
      },
    ] satisfies ExpenseCategory[];
    expect(metrics(expenses).liquidity.cashCoverageMonths).toMatchObject({
      value: null,
      blockers: ["NO_SHORT_TERM_OBLIGATIONS"],
    });
  });

  it("returns null history without a usable reference and a real change with one", () => {
    expect(metrics().history.m12.amount.value).toBeNull();
    const result = metrics(
      [],
      [],
      [
        {
          id: "s",
          snapshotDate: "2025-08-19",
          version: 1,
          grossAssets: 10_000,
          totalLiabilities: 0,
          netWorth: 10_000,
          liquidAssets: 10_000,
          reportingCurrency: "EUR",
          completenessStatus: "COMPLETE",
          dataKind: "ACTUAL",
          createdAt: "2025-08-19T00:00:00Z",
        },
      ],
    );
    expect(result.history.m12.amount.value).toBe(2000);
    expect(result.history.m12.percent.value).toBeCloseTo(0.2, 8);
  });

  it("compare un mois en arrière à la fin du mois précédent, jamais à un jour du mois courant", () => {
    // Oracle indépendant : le mois qui précède le 31 mars se termine le 28 février 2026 (année
    // non bissextile). Une instantanée du 2 mars n'est donc PAS une référence « M-1 » : elle
    // tomberait dans le mois courant si l'on comptait 31 mars − 1 mois = 3 mars.
    const snapshot = (id: string, snapshotDate: string, netWorth: number): NetWorthSnapshot => ({
      id,
      snapshotDate,
      version: 1,
      grossAssets: netWorth,
      totalLiabilities: 0,
      netWorth,
      liquidAssets: netWorth,
      reportingCurrency: "EUR",
      completenessStatus: "COMPLETE",
      dataKind: "ACTUAL",
      createdAt: `${snapshotDate}T00:00:00Z`,
    });
    const at = (asOfDate: string, snapshots: NetWorthSnapshot[]) =>
      deriveCanonicalBalanceSheetMetrics({
        balanceSheet: buildCanonicalBalanceSheet({
          asOfDate,
          reportingCurrency: "EUR",
          accounts: [{ ...cash, balanceDate: asOfDate }],
          liabilities: [],
        }),
        liabilities: [],
        expenses: [],
        positions: [],
        snapshots,
      });
    const march = at("2026-03-31", [
      snapshot("feb", "2026-02-28", 10_000),
      snapshot("mar2", "2026-03-02", 11_000),
    ]);
    expect(march.history.m1.referenceDate).toBe("2026-02-28");
    expect(march.history.m1.amount.value).toBe(2000);
    // 31 mai − 1 mois = 30 avril (et non 1er mai) ; 31 mai − 3 mois = 28 février 2026.
    const may = at("2026-05-31", [
      snapshot("feb", "2026-02-28", 9_000),
      snapshot("apr", "2026-04-30", 10_000),
      snapshot("may1", "2026-05-01", 11_000),
    ]);
    expect(may.history.m1.referenceDate).toBe("2026-04-30");
    expect(may.history.m3.referenceDate).toBe("2026-02-28");
    // Année bissextile : le 29 février 2028 moins 12 mois est le 28 février 2027.
    const leap = at("2028-02-29", [
      snapshot("y", "2027-02-28", 10_000),
      snapshot("m", "2027-03-01", 11_000),
    ]);
    expect(leap.history.m12.referenceDate).toBe("2027-02-28");
  });

  it("handles no debt and no assets without Infinity", () => {
    const balanceSheet = buildCanonicalBalanceSheet({
      asOfDate: "2026-08-19",
      reportingCurrency: "EUR",
    });
    const result = deriveCanonicalBalanceSheetMetrics({
      balanceSheet,
      liabilities: [],
      expenses: [],
      positions: [],
    });
    expect(result.structure.totalLiabilities.value).toBe(0);
    expect(result.ratios.debtToAssets.value).toBe(0);
    expect(result.ratios.netWorthRatio.value).toBeNull();
  });
});
