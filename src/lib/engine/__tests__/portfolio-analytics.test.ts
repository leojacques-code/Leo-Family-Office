import { describe, expect, it } from "vitest";

import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import type { CurrencyRate } from "@/lib/engine/fx";
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
  rates = [],
}: {
  events: PortfolioEvent[];
  balances: AccountBalanceObservation[];
  positions?: Position[];
  policy?: PortfolioEnvelopePolicy | null;
  currentAccount?: FinancialAccount;
  rates?: CurrencyRate[];
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
    currencyRates: rates,
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
    currencyRates: rates,
  });
}

function usdEurRate(rateDate: string, rate: number): CurrencyRate {
  return {
    id: `usd-eur-${rateDate}`,
    baseCurrency: "USD",
    quoteCurrency: "EUR",
    rate,
    rateDate,
    provenance,
  };
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

describe("Portfolio Analytics — vérité multi-devise", () => {
  it("conserve exactement les métriques d'une enveloppe et d'événements EUR", () => {
    const result = analytics({
      events: [
        event({
          id: "open-eur",
          type: "OPENING_CASH",
          eventDate: "2025-01-01",
          envelopeCashAmount: 1000,
        }),
        event({
          id: "contribution-eur",
          type: "CONTRIBUTION",
          eventDate: "2025-07-01",
          envelopeCashAmount: 100,
        }),
      ],
      balances: [
        observation("2025-01-01", 1000),
        observation("2025-07-01", 1100),
        observation("2026-01-01", 1210),
      ],
      currentAccount: { ...account, balance: 1210 },
    }).envelopes[0];

    expect(result.contributions.value).toBe(100);
    expect(result.twr.value).toBeCloseTo(0.1, 10);
    expect(result.xirr.value).not.toBeNull();
  });

  it("convertit achat, vente et coût ouvert USD aux dates économiques correctes", () => {
    const positions: Position[] = [
      {
        id: "position-usd",
        accountId: account.id,
        securityId: "usd-security",
        securityName: "Titre USD",
        assetClass: "Actions",
        quantity: 6,
        value: 720,
        currency: "USD",
        valuationDate: "2026-01-01",
        isCash: false,
        provenance,
      },
      {
        id: "cash-eur",
        accountId: account.id,
        securityId: "cash-eur",
        securityName: "Cash EUR",
        assetClass: "Cash",
        value: 456,
        currency: "EUR",
        valuationDate: "2026-01-01",
        isCash: true,
        provenance,
      },
    ];
    const events = [
      event({
        id: "open-fx",
        type: "OPENING_CASH",
        eventDate: "2025-01-01",
        envelopeCashAmount: 0,
      }),
      event({
        id: "contribution-fx",
        type: "CONTRIBUTION",
        eventDate: "2025-02-01",
        envelopeCashAmount: 900,
      }),
      event({
        id: "buy-usd",
        type: "BUY",
        eventDate: "2025-02-02",
        securityId: "usd-security",
        securityName: "Titre USD",
        assetClass: "Actions",
        quantity: 10,
        unitPrice: 100,
        grossAmount: 1000,
        feeAmount: 0,
        taxAmount: 0,
        envelopeCashAmount: -1000,
        currency: "USD",
      }),
      event({
        id: "sell-usd",
        type: "SELL",
        eventDate: "2025-06-01",
        securityId: "usd-security",
        securityName: "Titre USD",
        assetClass: "Actions",
        quantity: 4,
        unitPrice: 120,
        grossAmount: 480,
        feeAmount: 0,
        taxAmount: 0,
        envelopeCashAmount: 480,
        currency: "USD",
      }),
    ];
    const result = analytics({
      events,
      balances: [observation("2025-01-01", 0), observation("2026-01-01", 1176)],
      positions,
      currentAccount: { ...account, balance: 1176 },
      rates: [
        usdEurRate("2025-02-02", 0.9),
        usdEurRate("2025-06-01", 0.95),
        usdEurRate("2026-01-01", 1),
      ],
    }).envelopes[0];

    // Produit : 480 USD × 0,95. Coût cédé : 400 USD × 0,90.
    expect(result.realisedPnL.value).toBeCloseTo(96, 10);
    expect(result.realisedPnL.flags).toContain("FX_PNL_INCLUDES_CURRENCY_EFFECT");
    // Valeur : 720 USD × 1,00. Coût ouvert : 600 USD × 0,90.
    expect(result.unrealisedPnL.value).toBeCloseTo(180, 10);
    expect(result.unrealisedPnL.flags).toContain("FX_PNL_INCLUDES_CURRENCY_EFFECT");
    expect(result.attribution.status).toBe("COMPLETE");
    expect(result.attribution.explainedPerformance).toBeCloseTo(276, 10);
  });

  it("convertit dividende, frais et taxe USD sans les additionner comme des EUR", () => {
    const dividend = analytics({
      events: [
        event({
          id: "open-dividend",
          type: "OPENING_CASH",
          eventDate: "2025-01-01",
          envelopeCashAmount: 0,
        }),
        event({
          id: "dividend-usd",
          type: "DIVIDEND",
          eventDate: "2025-05-01",
          envelopeCashAmount: 100,
          currency: "USD",
        }),
      ],
      balances: [observation("2025-01-01", 0), observation("2026-01-01", 90)],
      currentAccount: { ...account, balance: 90 },
      rates: [usdEurRate("2025-05-01", 0.9)],
    }).envelopes[0];
    expect(dividend.income.value).toBeCloseTo(90, 10);
    expect(dividend.attribution.status).toBe("COMPLETE");
    expect(dividend.attribution.explainedPerformance).toBeCloseTo(90, 10);

    const charges = analytics({
      events: [
        event({
          id: "open-charges",
          type: "OPENING_CASH",
          eventDate: "2025-01-01",
          envelopeCashAmount: 0,
        }),
        event({
          id: "fee-usd",
          type: "FEE",
          eventDate: "2025-05-01",
          grossAmount: 10,
          envelopeCashAmount: -10,
          currency: "USD",
        }),
        event({
          id: "tax-usd",
          type: "TAX",
          eventDate: "2025-05-01",
          grossAmount: 5,
          envelopeCashAmount: -5,
          currency: "USD",
        }),
      ],
      balances: [observation("2025-01-01", 0), observation("2026-01-01", -13.5)],
      currentAccount: { ...account, balance: -13.5 },
      rates: [usdEurRate("2025-05-01", 0.9)],
    }).envelopes[0];
    expect(charges.fees.value).toBeCloseTo(9, 10);
    expect(charges.taxes.value).toBeCloseTo(4.5, 10);
    expect(charges.attribution.status).toBe("COMPLETE");
    expect(charges.attribution.explainedPerformance).toBeCloseTo(-13.5, 10);
  });

  it("bloque chaque métrique concernée quand le FX historique manque", () => {
    const result = analytics({
      events: [
        event({
          id: "open-missing-fx",
          type: "OPENING_CASH",
          eventDate: "2025-01-01",
          envelopeCashAmount: 1000,
        }),
        event({
          id: "contribution-usd",
          type: "CONTRIBUTION",
          eventDate: "2025-07-01",
          envelopeCashAmount: 100,
          currency: "USD",
        }),
        event({
          id: "dividend-missing-fx",
          type: "DIVIDEND",
          eventDate: "2025-08-01",
          envelopeCashAmount: 20,
          currency: "USD",
        }),
      ],
      balances: [
        observation("2025-01-01", 1000),
        observation("2025-07-01", 1090),
        observation("2026-01-01", 1110),
      ],
      currentAccount: { ...account, balance: 1110 },
    }).envelopes[0];

    expect(result.contributions.value).toBeNull();
    expect(result.income.value).toBeNull();
    expect(result.twr.value).toBeNull();
    expect(result.xirr.value).toBeNull();
    expect(result.contributions.blockers).toContain("FX_MISSING:USD/EUR@2025-07-01");
    expect(result.income.blockers).toContain("FX_MISSING:USD/EUR@2025-08-01");
  });

  it("ne publie aucun PnL quand le FX d'acquisition, de cession ou de valorisation manque", () => {
    const positions: Position[] = [
      {
        id: "position-pnl-no-fx",
        accountId: account.id,
        securityId: "usd-no-fx",
        securityName: "Titre USD sans FX",
        assetClass: "Actions",
        quantity: 5,
        value: 600,
        currency: "USD",
        valuationDate: "2026-01-01",
        isCash: false,
        provenance,
      },
    ];
    const result = analytics({
      events: [
        event({
          id: "open-pnl-no-fx",
          type: "OPENING_CASH",
          eventDate: "2025-01-01",
          envelopeCashAmount: 0,
        }),
        event({
          id: "buy-pnl-no-fx",
          type: "BUY",
          eventDate: "2025-02-01",
          securityId: "usd-no-fx",
          securityName: "Titre USD sans FX",
          assetClass: "Actions",
          quantity: 10,
          unitPrice: 100,
          grossAmount: 1000,
          feeAmount: 0,
          taxAmount: 0,
          envelopeCashAmount: -1000,
          currency: "USD",
        }),
        event({
          id: "sell-pnl-no-fx",
          type: "SELL",
          eventDate: "2025-06-01",
          securityId: "usd-no-fx",
          securityName: "Titre USD sans FX",
          assetClass: "Actions",
          quantity: 5,
          unitPrice: 120,
          grossAmount: 600,
          feeAmount: 0,
          taxAmount: 0,
          envelopeCashAmount: 600,
          currency: "USD",
        }),
      ],
      balances: [observation("2025-01-01", 0), observation("2026-01-01", 600)],
      positions,
      currentAccount: { ...account, balance: 600 },
    }).envelopes[0];

    expect(result.realisedPnL.value).toBeNull();
    expect(result.realisedPnL.blockers).toContain("FX_MISSING:USD/EUR@2025-06-01");
    expect(result.realisedPnL.blockers).toContain("FX_MISSING:USD/EUR@2025-02-01");
    expect(result.unrealisedPnL.value).toBeNull();
    expect(result.unrealisedPnL.blockers).toContain("FX_MISSING:USD/EUR@2026-01-01");
    expect(result.unrealisedPnL.blockers).toContain("FX_MISSING:USD/EUR@2025-02-01");
    expect(result.attribution.status).toBe("NOT_COMPUTABLE");
  });

  it("bloque le coût moyen multi-devise après cession au lieu de convertir un pool natif", () => {
    const result = analytics({
      policy: { ...declared, lotMatchingMethod: "WEIGHTED_AVERAGE" },
      events: [
        event({
          id: "open-weighted-fx",
          type: "OPENING_CASH",
          eventDate: "2025-01-01",
          envelopeCashAmount: 0,
        }),
        event({
          id: "buy-weighted-fx-1",
          type: "BUY",
          eventDate: "2025-02-01",
          securityId: "weighted-fx",
          securityName: "Pool USD",
          quantity: 10,
          grossAmount: 1000,
          feeAmount: 0,
          taxAmount: 0,
          envelopeCashAmount: -1000,
          currency: "USD",
        }),
        event({
          id: "buy-weighted-fx-2",
          type: "BUY",
          eventDate: "2025-03-01",
          securityId: "weighted-fx",
          securityName: "Pool USD",
          quantity: 10,
          grossAmount: 1500,
          feeAmount: 0,
          taxAmount: 0,
          envelopeCashAmount: -1500,
          currency: "USD",
        }),
        event({
          id: "sell-weighted-fx",
          type: "SELL",
          eventDate: "2025-06-01",
          securityId: "weighted-fx",
          securityName: "Pool USD",
          quantity: 10,
          grossAmount: 1800,
          feeAmount: 0,
          taxAmount: 0,
          envelopeCashAmount: 1800,
          currency: "USD",
        }),
      ],
      balances: [observation("2025-01-01", 0), observation("2026-01-01", 0)],
      rates: [
        usdEurRate("2025-02-01", 0.9),
        usdEurRate("2025-03-01", 0.8),
        usdEurRate("2025-06-01", 0.95),
      ],
      currentAccount: { ...account, balance: 0 },
    }).envelopes[0];

    expect(result.realisedPnL).toMatchObject({
      value: null,
      status: "NOT_COMPUTABLE",
      blockers: ["FX_WEIGHTED_AVERAGE_LOTS_NOT_NORMALISED"],
    });
    expect(result.unrealisedPnL.blockers).toContain("FX_WEIGHTED_AVERAGE_LOTS_NOT_NORMALISED");
  });

  it("convertit un apport USD avant TWR et XIRR sans régresser le cas mono-devise", () => {
    const result = analytics({
      events: [
        event({
          id: "open-flow-fx",
          type: "OPENING_CASH",
          eventDate: "2025-01-01",
          envelopeCashAmount: 1000,
        }),
        event({
          id: "contribution-flow-usd",
          type: "CONTRIBUTION",
          eventDate: "2025-07-01",
          envelopeCashAmount: 100,
          currency: "USD",
        }),
      ],
      balances: [
        observation("2025-01-01", 1000),
        observation("2025-07-01", 1090),
        observation("2026-01-01", 1199),
      ],
      currentAccount: { ...account, balance: 1199 },
      rates: [usdEurRate("2025-07-01", 0.9)],
    }).envelopes[0];

    expect(result.contributions.value).toBeCloseTo(90, 10);
    expect(result.twr.value).toBeCloseTo(0.1, 10);
    expect(result.xirr.value).not.toBeNull();
  });
});
