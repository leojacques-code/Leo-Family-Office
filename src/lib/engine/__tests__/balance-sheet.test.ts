import { describe, expect, it } from "vitest";
import {
  buildCanonicalBalanceSheet,
  type CanonicalBalanceSheetContribution,
} from "@/lib/engine/balance-sheet";
import { resolveFxRate } from "@/lib/engine/fx";
import { attributeNetWorthChange } from "@/lib/engine/net-worth-attribution";
import type { FinancialAccount, Liability, Position, Provenance } from "@/lib/types";
import { UNDECLARED_LOAN_TERMS } from "@/lib/engine/debt";

const actual: Provenance = { kind: "ACTUAL", confidence: "HIGH", effectiveDate: "2026-08-23" };
const external: Provenance = {
  kind: "EXTERNAL_DATA",
  confidence: "HIGH",
  effectiveDate: "2026-08-21",
};

function account(
  id: string,
  balance: number,
  type: FinancialAccount["type"] = "BANK",
  currency = "EUR",
): FinancialAccount {
  return {
    id,
    institutionId: "i",
    institution: "Bank",
    name: id,
    type,
    currency,
    balance,
    balanceDate: "2026-08-23",
    liquidity: "IMMEDIATE",
    provenance: actual,
  };
}

function liability(balance: number): Liability {
  return {
    id: "loan",
    name: "Loan",
    lender: "Bank",
    principal: balance,
    currentBalance: balance,
    annualRate: 0,
    monthlyPayment: 0,
    paymentCount: 1,
    firstPaymentDate: "2026-09-01",
    maturityDate: "2026-09-01",
    ...UNDECLARED_LOAN_TERMS,
    provenance: actual,
  };
}

function sheet(overrides: Partial<Parameters<typeof buildCanonicalBalanceSheet>[0]> = {}) {
  return buildCanonicalBalanceSheet({
    asOfDate: "2026-08-23",
    reportingCurrency: "EUR",
    ...overrides,
  });
}

describe("canonical balance sheet invariants", () => {
  it("separates positive assets, overdrafts and contractual debt", () => {
    const result = sheet({
      accounts: [account("cash", -1000), account("pea", 10_000, "PEA")],
      liabilities: [liability(5000)],
    });
    expect(result.grossAssets.value).toBe(10_000);
    expect(result.accountOverdraftLiabilities.value).toBe(1000);
    expect(result.contractualDebt.value).toBe(5000);
    expect(result.totalLiabilities.value).toBe(6000);
    expect(result.netWorth.value).toBe(4000);
    expect(result.immediateCash.value).toBe(0);
  });

  it("never nets a negative account into gross assets", () => {
    const result = sheet({ accounts: [account("a", 4000), account("b", -1000)] });
    expect(result.grossAssets.value).toBe(4000);
    expect(result.totalLiabilities.value).toBe(1000);
    expect(result.netWorth.value).toBe(3000);
  });

  it("uses positions only to explain an envelope and exposes reconciliation gaps", () => {
    const positions: Position[] = [
      {
        id: "etf",
        accountId: "pea",
        securityName: "ETF",
        assetClass: "EQUITY",
        value: 15_000,
        currency: "EUR",
        isCash: false,
        provenance: actual,
      },
      {
        id: "cash",
        accountId: "pea",
        securityName: "Cash",
        assetClass: "CASH",
        value: 5000,
        currency: "EUR",
        isCash: true,
        provenance: actual,
      },
    ];
    const exact = sheet({ accounts: [account("pea", 20_000, "PEA")], positions });
    expect(exact.grossAssets.value).toBe(20_000);
    expect(exact.marketInvestedAssets.value).toBe(15_000);
    expect(exact.investmentEnvelopeCash.value).toBe(5000);
    expect(exact.positionReconciliations[0].state).toBe("RECONCILED");
    const under = sheet({
      accounts: [account("pea", 20_000, "PEA")],
      positions: positions.slice(0, 1),
    });
    expect(under.grossAssets.value).toBe(20_000);
    expect(under.positionReconciliations[0]).toMatchObject({
      state: "UNDER_EXPLAINED",
      gapNativeValue: 5000,
    });
    const over = sheet({ accounts: [account("pea", 10_000, "PEA")], positions });
    expect(over.grossAssets.value).toBe(10_000);
    expect(over.positionReconciliations[0].state).toBe("OVER_EXPLAINED");
  });

  it("reconciles a foreign position in the account native currency", () => {
    const positions: Position[] = [
      {
        id: "usd-etf",
        accountId: "cto",
        securityName: "USD ETF",
        assetClass: "EQUITY",
        value: 100,
        currency: "USD",
        isCash: false,
        valuationDate: "2026-08-23",
        provenance: actual,
      },
    ];
    const result = sheet({
      accounts: [account("cto", 90, "CTO")],
      positions,
      currencyRates: [
        {
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: 0.9,
          rateDate: "2026-08-23",
          provenance: external,
        },
      ],
    });
    expect(result.positionReconciliations[0]).toMatchObject({
      state: "RECONCILED",
      explainedNativeValue: 90,
      gapNativeValue: 0,
    });
    expect(result.grossAssets.value).toBe(90);
  });

  it("converts direct and inverse FX without using a future rate", () => {
    const direct = resolveFxRate("USD", "EUR", "2026-08-23", [
      {
        baseCurrency: "USD",
        quoteCurrency: "EUR",
        rate: 0.9,
        rateDate: "2026-08-21",
        provenance: external,
      },
    ]);
    expect(direct.rate).toBe(0.9);
    expect(direct.inverted).toBe(false);
    const inverse = resolveFxRate("USD", "EUR", "2026-08-23", [
      {
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: 1.25,
        rateDate: "2026-08-21",
        provenance: external,
      },
    ]);
    expect(inverse.rate).toBeCloseTo(0.8, 12);
    expect(inverse.inverted).toBe(true);
    const futureOnly = resolveFxRate("USD", "EUR", "2026-08-23", [
      {
        baseCurrency: "USD",
        quoteCurrency: "EUR",
        rate: 0.9,
        rateDate: "2026-08-24",
        provenance: external,
      },
    ]);
    expect(futureOnly.status).toBe("MISSING");
    const identity = resolveFxRate("EUR", "EUR", "2026-08-23", []);
    expect(identity).toMatchObject({
      rate: 1,
      status: "IDENTITY",
      provenance: { kind: "DERIVED" },
    });
  });

  it("converts a contractual debt in its native currency", () => {
    const usdDebt = { ...liability(100), currency: "USD" };
    const result = sheet({
      liabilities: [usdDebt],
      currencyRates: [
        {
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: 0.9,
          rateDate: "2026-08-21",
          provenance: external,
        },
      ],
    });
    expect(result.contractualDebt.value).toBeCloseTo(90, 12);
    expect(result.totalLiabilities.value).toBeCloseTo(90, 12);
  });

  it("marks FX older than three calendar days stale but remains calculable", () => {
    const result = sheet({
      accounts: [account("usd", 100, "BANK", "USD")],
      currencyRates: [
        {
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: 0.91,
          rateDate: "2026-08-19",
          provenance: external,
        },
      ],
    });
    expect(result.grossAssets.value).toBeCloseTo(91, 12);
    expect(result.contributions[0].fx.status).toBe("STALE");
    expect(result.quality.flags).toContain("STALE_FX:USD/EUR:4d");
  });

  it("never claims a complete total when FX is missing", () => {
    const result = sheet({
      accounts: [account("eur", 10_000), account("usd", 5000, "BANK", "USD")],
      liabilities: [liability(2000)],
    });
    expect(result.grossAssets).toMatchObject({
      value: null,
      knownValue: 10_000,
      status: "PARTIAL",
      coverage: 0.5,
    });
    expect(result.netWorth).toMatchObject({ value: null, knownValue: 8000, status: "PARTIAL" });
  });

  it("keeps full internal precision", () => {
    const result = sheet({
      accounts: [account("usd", 1 / 3, "BANK", "USD")],
      currencyRates: [
        {
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: 0.9123456789,
          rateDate: "2026-08-23",
          provenance: external,
        },
      ],
    });
    expect(result.grossAssets.value).toBe((1 / 3) * 0.9123456789);
  });

  it("accepts future property and business-equity values without importing domain formulas", () => {
    const contributions: CanonicalBalanceSheetContribution[] = [
      {
        id: "property",
        entityId: "home",
        domain: "REAL_ESTATE",
        side: "ASSET",
        category: "PROPERTY",
        nativeValue: 400_000,
        currency: "EUR",
        valuationDate: "2026-08-23",
        valuationMethod: "EXTERNAL_VALUATION",
        valuationStatus: "CURRENT",
        liquidity: "ILLIQUID",
        provenance: external,
        confidence: "HIGH",
        reconciliationState: "NOT_APPLICABLE",
        isAccountingPrimary: true,
        flags: [],
      },
      {
        id: "mortgage",
        entityId: "mortgage",
        domain: "DEBT",
        side: "LIABILITY",
        category: "CONTRACTUAL_DEBT",
        nativeValue: 250_000,
        currency: "EUR",
        valuationDate: "2026-08-23",
        valuationMethod: "OBSERVED_BALANCE",
        valuationStatus: "CURRENT",
        liquidity: "ILLIQUID",
        provenance: actual,
        confidence: "HIGH",
        reconciliationState: "NOT_APPLICABLE",
        isAccountingPrimary: true,
        flags: [],
      },
      {
        id: "business",
        entityId: "company",
        domain: "BUSINESS_EQUITY",
        side: "ASSET",
        category: "EQUITY_VALUE",
        nativeValue: 200_000,
        currency: "EUR",
        valuationDate: "2026-08-23",
        valuationMethod: "EXTERNAL_VALUATION",
        valuationStatus: "CURRENT",
        liquidity: "ILLIQUID",
        provenance: external,
        confidence: "HIGH",
        reconciliationState: "NOT_APPLICABLE",
        isAccountingPrimary: true,
        flags: ["BUSINESS_DEBT_NETTED_IN_EQUITY_VALUE"],
      },
    ];
    const result = sheet({ contributions });
    expect(result.grossAssets.value).toBe(600_000);
    expect(result.totalLiabilities.value).toBe(250_000);
    expect(result.netWorth.value).toBe(350_000);
  });

  it("does not treat purchase price or cost basis as current value by accident", () => {
    expect(() =>
      sheet({
        contributions: [
          {
            id: "bad",
            entityId: "x",
            domain: "OTHER_ASSET",
            side: "ASSET",
            category: "ASSET",
            nativeValue: -1,
            currency: "EUR",
            valuationDate: "2026-08-23",
            valuationMethod: "PURCHASE_PRICE",
            valuationStatus: "CURRENT",
            liquidity: "ILLIQUID",
            provenance: actual,
            confidence: "HIGH",
            reconciliationState: "NOT_APPLICABLE",
            isAccountingPrimary: true,
            flags: [],
          },
        ],
      }),
    ).toThrow(/non-negative/);
  });
});

describe("lignes de position canoniques", () => {
  function position(overrides: Partial<Position> = {}): Position {
    return {
      id: "p1",
      accountId: "pea",
      securityName: "Titre test",
      assetClass: "Actions",
      value: 1000,
      currency: "EUR",
      isCash: false,
      provenance: actual,
      ...overrides,
    };
  }

  it("porte la classe d’actif et l’enveloppe qui l’explique", () => {
    const result = sheet({
      accounts: [account("pea", 1000, "PEA")],
      positions: [position()],
    });
    const line = result.contributions.find((item) => item.id === "position:p1");
    expect(line?.subcategory).toBe("Actions");
    expect(line?.envelopeAccountId).toBe("pea");
    expect(line?.isAccountingPrimary).toBe(false);
  });

  it("convertit le coût d’acquisition au même taux que la valeur", () => {
    const result = sheet({
      accounts: [account("cto", 900, "CTO")],
      positions: [position({ currency: "USD", costBasis: 800 })],
      currencyRates: [
        {
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: 0.9,
          rateDate: "2026-08-23",
          provenance: external,
        },
      ],
    });
    const line = result.contributions.find((item) => item.id === "position:p1");
    expect(line?.nativeCostBasis).toBe(800);
    expect(line?.reportingCostBasis).toBeCloseTo(720, 6);
    expect(line?.flags).toContain("FX_PNL_NOT_ISOLATED");
  });

  it("laisse le coût d’acquisition inconnu à null plutôt qu’à zéro", () => {
    const result = sheet({ accounts: [account("pea", 1000, "PEA")], positions: [position()] });
    const line = result.contributions.find((item) => item.id === "position:p1");
    expect(line?.nativeCostBasis).toBeNull();
    expect(line?.reportingCostBasis).toBeNull();
  });

  it("signale une position logée hors enveloppe d’investissement", () => {
    const result = sheet({
      accounts: [account("bank", 1000, "BANK")],
      positions: [position({ accountId: "bank" })],
    });
    expect(result.quality.flags).toContain("POSITION_OUTSIDE_ENVELOPE:p1");
    // Aucune enveloppe, donc aucune exposition projetable revendiquée sur ce compte.
    expect(result.envelopeExposures).toHaveLength(0);
  });
});

describe("net-worth attribution", () => {
  it("keeps an unexplained residual instead of inventing market PnL", () => {
    expect(
      attributeNetWorthChange(100_000, 110_000, [
        { category: "OPERATING_SURPLUS", amount: 4000 },
        { category: "DEBT_ECONOMIC_COST", amount: -300 },
      ]),
    ).toMatchObject({ change: 10_000, explained: 3700, unexplained: 6300, coverage: 0.37 });
  });

  it("keeps transfers and principal neutral while economic costs reduce net worth", () => {
    expect(attributeNetWorthChange(10_000, 10_000, [])).toMatchObject({
      change: 0,
      unexplained: 0,
    });
    expect(
      attributeNetWorthChange(10_000, 9950, [{ category: "DEBT_ECONOMIC_COST", amount: -50 }]),
    ).toMatchObject({ explained: -50, unexplained: 0 });
  });
});
