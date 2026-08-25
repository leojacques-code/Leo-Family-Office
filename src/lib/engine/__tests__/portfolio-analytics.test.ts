import { describe, expect, it } from "vitest";

import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import { buildPortfolioAnalytics } from "@/lib/engine/portfolio-analytics";
import { buildPortfolioLedger } from "@/lib/engine/portfolio";
import type {
  AccountBalanceObservation,
  FinancialAccount,
  PortfolioEnvelopePolicy,
  PortfolioEvent,
  Position,
} from "@/lib/types";

const provenance = { kind: "ACTUAL", confidence: "HIGH" } as const;

const account: FinancialAccount = {
  id: "pea",
  institutionId: "bank",
  institution: "Banque",
  name: "PEA",
  type: "PEA",
  currency: "EUR",
  balance: 1815,
  balanceDate: "2026-01-01",
  liquidity: "LIQUID",
  provenance,
};

const declared: PortfolioEnvelopePolicy = {
  id: "policy",
  accountId: account.id,
  lotMatchingMethod: "FIFO",
  ledgerCoverageStart: "2025-01-01",
  ledgerCoverageSource: "MANUAL",
  notes: null,
  provenance,
};

function event(
  patch: Partial<PortfolioEvent> & Pick<PortfolioEvent, "id" | "type" | "eventDate">,
): PortfolioEvent {
  return {
    accountId: account.id,
    securityId: null,
    securityName: null,
    ticker: null,
    assetClass: null,
    settlementDate: null,
    quantity: null,
    unitPrice: null,
    grossAmount: null,
    feeAmount: null,
    taxAmount: null,
    envelopeCashAmount: null,
    currency: "EUR",
    counterpartyAccountId: null,
    transactionId: null,
    matchedAcquisitionEventId: null,
    externalReference: null,
    provenance,
    ...patch,
  };
}

function observation(date: string, balance: number): AccountBalanceObservation {
  return {
    id: `balance-${date}`,
    accountId: account.id,
    balance,
    balanceDate: date,
    createdAt: `${date}T18:00:00Z`,
    provenance,
  };
}

function analytics({
  events,
  balances,
  positions = [],
  policy = declared,
  currentAccount = account,
}: {
  events: PortfolioEvent[];
  balances: AccountBalanceObservation[];
  positions?: Position[];
  policy?: PortfolioEnvelopePolicy | null;
  currentAccount?: FinancialAccount;
}) {
  const policies = policy ? [policy] : [];
  const ledger = buildPortfolioLedger({
    asOfDate: "2026-01-01",
    accounts: [currentAccount],
    positions,
    events,
    policies,
  });
  const balanceSheet = buildCanonicalBalanceSheet({
    asOfDate: "2026-01-01",
    reportingCurrency: "EUR",
    accounts: [currentAccount],
    positions,
  });
  return buildPortfolioAnalytics({
    asOfDate: "2026-01-01",
    reportingCurrency: "EUR",
    accounts: [currentAccount],
    positions,
    events,
    balanceHistory: balances,
    ledger,
    balanceSheet,
  });
}

describe("Portfolio Analytics — performance et flux", () => {
  it("chaîne un TWR fin de journée sans confondre apport et performance", () => {
    const events = [
      event({
        id: "open",
        type: "OPENING_CASH",
        eventDate: "2025-01-01",
        envelopeCashAmount: 1000,
      }),
      event({
        id: "contribution",
        type: "CONTRIBUTION",
        eventDate: "2025-07-01",
        envelopeCashAmount: 500,
      }),
    ];
    const portfolio = analytics({
      events,
      balances: [
        observation("2025-01-01", 1000),
        observation("2025-07-01", 1600),
        observation("2026-01-01", 1760),
      ],
    });
    const result = portfolio.envelopes[0];

    expect(result.contributions.value).toBe(500);
    expect(result.withdrawals.value).toBe(0);
    expect(result.netExternalFlow.value).toBe(500);
    expect(result.economicGain.value).toBe(260);
    expect(result.twr.value).toBeCloseTo(0.21, 10);
    expect(result.twr.flags).toContain("TWR_END_OF_DAY_FLOW_CONVENTION");
    expect(result.xirr.value).not.toBeNull();
    expect(result.observedMaxDrawdown.value).toBe(0);
    expect(result.annualisedVolatility.blockers).toContain("RISK_HISTORY_TOO_SHORT");
    expect(portfolio.performance.twr.value).toBeCloseTo(0.21, 10);
    expect(portfolio.performance.economicGain.value).toBe(260);
  });

  it("refuse le TWR quand un apport n'a pas de valorisation le même jour", () => {
    const events = [
      event({
        id: "open",
        type: "OPENING_CASH",
        eventDate: "2025-01-01",
        envelopeCashAmount: 1000,
      }),
      event({
        id: "contribution",
        type: "CONTRIBUTION",
        eventDate: "2025-07-01",
        envelopeCashAmount: 500,
      }),
    ];
    const result = analytics({
      events,
      balances: [observation("2025-01-01", 1000), observation("2026-01-01", 1815)],
    }).envelopes[0];
    expect(result.twr.value).toBeNull();
    expect(result.twr.blockers).toContain("FLOW_DATE_VALUATION_MISSING");
    // XIRR ne dépend pas d'une valorisation intermédiaire et reste calculable.
    expect(result.xirr.value).not.toBeNull();
  });

  it("ne transforme jamais une couverture non déclarée en zéros", () => {
    const result = analytics({
      events: [],
      balances: [observation("2026-01-01", 1815)],
      policy: null,
    }).envelopes[0];
    expect(result.twr.value).toBeNull();
    expect(result.contributions.value).toBeNull();
    expect(result.realisedPnL.value).toBeNull();
    expect(result.income.value).toBeNull();
    expect(result.twr.blockers).toContain("LEDGER_COVERAGE_UNDECLARED");
  });

  it("refuse un XIRR ambigu lorsqu'il existe plusieurs racines économiques", () => {
    const longPolicy = { ...declared, ledgerCoverageStart: "2021-01-01" };
    const result = analytics({
      events: [
        event({
          id: "open",
          type: "OPENING_CASH",
          eventDate: "2021-01-01",
          envelopeCashAmount: 100,
        }),
        event({
          id: "withdrawal",
          type: "WITHDRAWAL",
          eventDate: "2022-01-01",
          envelopeCashAmount: -230,
        }),
        event({
          id: "contribution",
          type: "CONTRIBUTION",
          eventDate: "2023-01-01",
          envelopeCashAmount: 132,
        }),
      ],
      balances: [observation("2021-01-01", 100), observation("2026-01-01", 0)],
      policy: longPolicy,
      currentAccount: { ...account, balance: 0 },
    }).envelopes[0];
    expect(result.xirr.value).toBeNull();
    expect(result.xirr.blockers).toContain("XIRR_MULTIPLE_SOLUTIONS");
  });

  it("annualise la volatilité seulement après douze sous-périodes mensuelles", () => {
    const monthlyDates = [
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
      "2025-04-01",
      "2025-05-01",
      "2025-06-01",
      "2025-07-01",
      "2025-08-01",
      "2025-09-01",
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
    ];
    const balances = monthlyDates.map((date, index) => observation(date, 100 * 1.01 ** index));
    const result = analytics({
      events: [
        event({
          id: "open",
          type: "OPENING_CASH",
          eventDate: "2025-01-01",
          envelopeCashAmount: 100,
        }),
      ],
      balances,
      currentAccount: { ...account, balance: balances.at(-1)!.balance },
    }).envelopes[0];
    expect(result.twr.value).toBeCloseTo(1.01 ** 12 - 1, 10);
    expect(result.annualisedVolatility.status).toBe("COMPLETE");
    expect(result.annualisedVolatility.value).toBeCloseTo(0, 10);
    expect(result.observedMaxDrawdown.value).toBe(0);
  });
});

describe("Portfolio Analytics — PnL, attribution et exposition", () => {
  it("réconcilie une attribution depuis zéro quand les faits sont exhaustifs", () => {
    const position: Position = {
      id: "position-etf",
      accountId: account.id,
      securityId: "etf",
      securityName: "ETF Monde",
      ticker: "WORLD",
      assetClass: "Actions",
      quantity: 10,
      value: 1100,
      currency: "EUR",
      valuationDate: "2026-01-01",
      isCash: false,
      provenance,
    };
    const events = [
      event({ id: "open", type: "OPENING_CASH", eventDate: "2025-01-01", envelopeCashAmount: 0 }),
      event({
        id: "contribution",
        type: "CONTRIBUTION",
        eventDate: "2025-02-01",
        envelopeCashAmount: 1000,
      }),
      event({
        id: "buy",
        type: "BUY",
        eventDate: "2025-02-02",
        securityId: "etf",
        securityName: "ETF Monde",
        ticker: "WORLD",
        assetClass: "Actions",
        quantity: 10,
        unitPrice: 100,
        grossAmount: 1000,
        feeAmount: 0,
        taxAmount: 0,
        envelopeCashAmount: -1000,
      }),
    ];
    const currentAccount = { ...account, balance: 1100 };
    const result = analytics({
      events,
      balances: [observation("2025-01-01", 0), observation("2026-01-01", 1100)],
      positions: [position],
      currentAccount,
    });
    const envelope = result.envelopes[0];

    expect(envelope.realisedPnL.value).toBe(0);
    expect(envelope.unrealisedPnL.value).toBe(100);
    expect(envelope.income.value).toBe(0);
    expect(envelope.fees.value).toBe(0);
    expect(envelope.taxes.value).toBe(0);
    expect(envelope.attribution.status).toBe("COMPLETE");
    expect(envelope.attribution.explainedPerformance).toBe(100);
    expect(envelope.attribution.residual).toBeCloseTo(0, 10);
    expect(result.allocation.buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Actions", value: 1100, weight: 1 }),
      ]),
    );
    expect(result.concentration.top1Weight).toBe(1);
    expect(result.concentration.hhi).toBe(1);
    expect(result.concentration.effectivePositions).toBe(1);
    expect(result.drift.blockers).toEqual(["TARGET_ALLOCATION_MISSING"]);
  });

  it("rend l'allocation partielle et la concentration non calculable si l'exposition manque", () => {
    const result = analytics({
      events: [
        event({
          id: "open",
          type: "OPENING_CASH",
          eventDate: "2025-01-01",
          envelopeCashAmount: 1815,
        }),
      ],
      balances: [observation("2025-01-01", 1815), observation("2026-01-01", 1815)],
    });
    expect(result.allocation.status).toBe("PARTIAL");
    expect(result.allocation.buckets[0]).toMatchObject({
      kind: "UNEXPOSED",
      value: 1815,
      weight: 1,
    });
    expect(result.concentration.status).toBe("NOT_COMPUTABLE");
    expect(result.concentration.blockers).toContain("PORTFOLIO_EXPOSURE_INCOMPLETE");
  });

  it("agrège un même instrument détenu dans deux enveloppes avant de mesurer la concentration", () => {
    const cto: FinancialAccount = {
      ...account,
      id: "cto",
      name: "CTO",
      type: "CTO",
      balance: 550,
    };
    const peaAccount = { ...account, balance: 550 };
    const positions: Position[] = [peaAccount, cto].map((owner, index) => ({
      id: `position-${index}`,
      accountId: owner.id,
      securityId: "shared-etf",
      securityName: "ETF partagé",
      ticker: "SHARED",
      assetClass: "Actions",
      quantity: 5,
      value: 550,
      currency: "EUR",
      valuationDate: "2026-01-01",
      isCash: false,
      provenance,
    }));
    const events = [peaAccount, cto].flatMap((owner) => [
      event({
        id: `open-${owner.id}`,
        accountId: owner.id,
        type: "OPENING_CASH",
        eventDate: "2025-01-01",
        envelopeCashAmount: 0,
      }),
      event({
        id: `contribution-${owner.id}`,
        accountId: owner.id,
        type: "CONTRIBUTION",
        eventDate: "2025-02-01",
        envelopeCashAmount: 500,
      }),
      event({
        id: `buy-${owner.id}`,
        accountId: owner.id,
        type: "BUY",
        eventDate: "2025-02-02",
        securityId: "shared-etf",
        securityName: "ETF partagé",
        assetClass: "Actions",
        quantity: 5,
        unitPrice: 100,
        grossAmount: 500,
        feeAmount: 0,
        taxAmount: 0,
        envelopeCashAmount: -500,
      }),
    ]);
    const policies = [declared, { ...declared, id: "policy-cto", accountId: cto.id }];
    const accounts = [peaAccount, cto];
    const ledger = buildPortfolioLedger({
      asOfDate: "2026-01-01",
      accounts,
      positions,
      events,
      policies,
    });
    const balanceSheet = buildCanonicalBalanceSheet({
      asOfDate: "2026-01-01",
      reportingCurrency: "EUR",
      accounts,
      positions,
    });
    const balanceHistory = accounts.flatMap((owner) => [
      { ...observation("2025-01-01", 0), id: `start-${owner.id}`, accountId: owner.id },
      { ...observation("2026-01-01", 550), id: `end-${owner.id}`, accountId: owner.id },
    ]);
    const result = buildPortfolioAnalytics({
      asOfDate: "2026-01-01",
      reportingCurrency: "EUR",
      accounts,
      positions,
      events,
      balanceHistory,
      ledger,
      balanceSheet,
    });

    expect(result.concentration.holdings).toHaveLength(1);
    expect(result.concentration.holdings[0]).toMatchObject({
      securityId: "shared-etf",
      positionIds: ["position-0", "position-1"],
      accountIds: ["pea", "cto"],
      value: 1100,
      weight: 1,
    });
    expect(result.concentration.effectivePositions).toBe(1);
  });
});
