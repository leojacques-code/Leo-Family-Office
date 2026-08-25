import { describe, expect, it } from "vitest";

import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import {
  PORTFOLIO_FLOW_DIRECTION,
  buildPortfolioLedger,
  envelopeLedgerOf,
} from "@/lib/engine/portfolio";
import type {
  ExpenseCategory,
  FinancialAccount,
  PortfolioEnvelopePolicy,
  PortfolioEvent,
  Position,
  Transaction,
} from "@/lib/types";

const provenance = { kind: "ACTUAL", confidence: "HIGH" } as const;

const pea: FinancialAccount = {
  id: "acc_pea",
  institutionId: "inst",
  institution: "Banque",
  name: "PEA",
  type: "PEA",
  currency: "EUR",
  balance: 15000,
  balanceDate: "2026-08-19",
  liquidity: "LIQUID",
  provenance,
};

const bank: FinancialAccount = {
  ...pea,
  id: "acc_bank",
  name: "Compte courant",
  type: "BANK",
  balance: 4000,
};

/** État observé du cas essentiel : PEA 15 000 € = ETF 8 700 € + cash 6 300 €. */
const observedPositions: Position[] = [
  {
    id: "pos_etf",
    accountId: "acc_pea",
    securityId: "sec_etf",
    securityName: "ETF Monde",
    assetClass: "Actions",
    value: 8700,
    currency: "EUR",
    valuationDate: "2026-08-19",
    isCash: false,
    provenance,
  },
  {
    id: "pos_cash",
    accountId: "acc_pea",
    securityId: "sec_cash",
    securityName: "Liquidités PEA",
    assetClass: "Cash",
    value: 6300,
    currency: "EUR",
    valuationDate: "2026-08-19",
    isCash: true,
    provenance,
  },
];

function event(
  patch: Partial<PortfolioEvent> & Pick<PortfolioEvent, "id" | "type">,
): PortfolioEvent {
  return {
    accountId: "acc_pea",
    securityId: null,
    securityName: null,
    ticker: null,
    assetClass: null,
    eventDate: "2026-01-01",
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

const declaredPolicy: PortfolioEnvelopePolicy = {
  id: "pol",
  accountId: "acc_pea",
  lotMatchingMethod: "FIFO",
  ledgerCoverageStart: "2026-01-01",
  ledgerCoverageSource: "MANUAL",
  notes: null,
  provenance,
};

function build(
  events: PortfolioEvent[],
  policies: PortfolioEnvelopePolicy[] = [],
  extra: {
    positions?: Position[];
    transactions?: Transaction[];
    expenseCategories?: ExpenseCategory[];
    accounts?: FinancialAccount[];
    asOfDate?: string;
  } = {},
) {
  return buildPortfolioLedger({
    asOfDate: extra.asOfDate ?? "2026-08-19",
    accounts: extra.accounts ?? [pea, bank],
    positions: extra.positions ?? observedPositions,
    events,
    policies,
    transactions: extra.transactions,
    expenseCategories: extra.expenseCategories,
  });
}

describe("Portfolio ledger — observation sans historique", () => {
  it("conserve l’état observé et déclare l’historique inconnu, sans inventer d’achat", () => {
    const ledger = build([]);
    const envelope = envelopeLedgerOf(ledger, "acc_pea");
    expect(envelope).not.toBeNull();
    expect(envelope!.eventCount).toBe(0);
    expect(envelope!.coverageStatus).toBe("UNDECLARED");
    // Rien n'est dérivé : ni cash, ni coût de revient, ni lot.
    expect(envelope!.ledgerCash).toBeNull();
    expect(envelope!.openCostBasis).toBeNull();
    expect(envelope!.costBasisStatus).toBe("NOT_COMPUTABLE");
    expect(envelope!.holdings).toHaveLength(0);
    expect(envelope!.disposals).toHaveLength(0);
    // L'observation reste intacte : le cash d'enveloppe observé vaut toujours 6 300 €.
    expect(envelope!.observedCash).toBe(6300);
    expect(envelope!.cashState).toBe("MISSING");
    expect(ledger.quality.status).toBe("NOT_COMPUTABLE");
  });

  it("laisse le bilan canonique strictement identique, avec ou sans ledger", () => {
    const withoutLedger = buildCanonicalBalanceSheet({
      asOfDate: "2026-08-19",
      reportingCurrency: "EUR",
      accounts: [pea, bank],
      positions: observedPositions,
    });
    // Le ledger est une lecture dérivée : il n'entre dans aucun agrégat patrimonial.
    const ledger = build([
      event({ id: "e1", type: "OPENING_CASH", envelopeCashAmount: 1000 }),
      event({ id: "e2", type: "CONTRIBUTION", envelopeCashAmount: 5000 }),
    ]);
    expect(ledger.envelopes).toHaveLength(1);
    const again = buildCanonicalBalanceSheet({
      asOfDate: "2026-08-19",
      reportingCurrency: "EUR",
      accounts: [pea, bank],
      positions: observedPositions,
    });
    expect(again.grossAssets).toEqual(withoutLedger.grossAssets);
    expect(again.investmentEnvelopeCash).toEqual(withoutLedger.investmentEnvelopeCash);
    expect(again.netWorth.value).toBe(withoutLedger.netWorth.value);
    // Le PEA vaut 15 000 €, pas 15 000 + 8 700 + 6 300 : les positions expliquent, elles
    // ne s'ajoutent pas.
    expect(withoutLedger.grossAssets.value).toBe(19000);
  });
});

describe("Portfolio ledger — histoire renseignée", () => {
  const history = [
    event({
      id: "e_open_cash",
      type: "OPENING_CASH",
      eventDate: "2026-01-01",
      envelopeCashAmount: 1300,
    }),
    event({
      id: "e_contrib",
      type: "CONTRIBUTION",
      eventDate: "2026-02-01",
      envelopeCashAmount: 5000,
      transactionId: "tx_contrib",
      counterpartyAccountId: "acc_bank",
    }),
    event({
      id: "e_buy",
      type: "BUY",
      eventDate: "2026-02-05",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      quantity: 20,
      unitPrice: 100,
      grossAmount: 2000,
      feeAmount: 5,
      taxAmount: 0,
      envelopeCashAmount: -2005,
    }),
    event({
      id: "e_div",
      type: "DIVIDEND",
      eventDate: "2026-03-10",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      envelopeCashAmount: 47,
    }),
    event({
      id: "e_buy2",
      type: "BUY",
      eventDate: "2026-04-05",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      quantity: 10,
      unitPrice: 110,
      grossAmount: 1100,
      feeAmount: 5,
      taxAmount: 0,
      envelopeCashAmount: -1105,
    }),
    event({
      id: "e_sell",
      type: "SELL",
      eventDate: "2026-05-05",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      quantity: 12,
      unitPrice: 120,
      grossAmount: 1440,
      feeAmount: 4,
      taxAmount: 0,
      envelopeCashAmount: 1436,
    }),
  ];

  it("explique la position et le cash correspondants", () => {
    const ledger = build(history, [declaredPolicy]);
    const envelope = envelopeLedgerOf(ledger, "acc_pea")!;
    expect(envelope.coverageStatus).toBe("DECLARED");
    // 1 300 + 5 000 − 2 005 + 47 − 1 105 + 1 436 = 4 673
    expect(envelope.ledgerCash).toBeCloseTo(4673, 6);
    const holding = envelope.holdings.find((item) => item.securityId === "sec_etf")!;
    expect(holding.ledgerQuantity).toBeCloseTo(18, 6);
    // FIFO : 12 titres cédés viennent du premier lot à 100,25 € (2 005 / 20).
    // Reste 8 × 100,25 + 10 × 110,50 = 802 + 1 105 = 1 907.
    expect(holding.ledgerCostBasis).toBeCloseTo(1907, 6);
    expect(holding.costBasisStatus).toBe("COMPLETE");
    const sale = envelope.disposals[0];
    expect(sale.matchedCost).toBeCloseTo(1203, 6);
    expect(sale.netProceeds).toBeCloseTo(1436, 6);
    expect(sale.realisedPnL).toBeCloseTo(233, 6);
  });

  it("sépare l’argent neuf du rendement encaissé", () => {
    const envelope = envelopeLedgerOf(build(history, [declaredPolicy]), "acc_pea")!;
    // Une contribution est un apport ; un dividende ne l'est pas.
    expect(envelope.flows.externalIn).toBeCloseTo(5000, 6);
    expect(envelope.flows.income).toBeCloseTo(47, 6);
    expect(PORTFOLIO_FLOW_DIRECTION.DIVIDEND).toBe("INTERNAL");
    expect(PORTFOLIO_FLOW_DIRECTION.CONTRIBUTION).toBe("EXTERNAL_IN");
    // Une ouverture n'est ni un apport ni une opération interne.
    expect(PORTFOLIO_FLOW_DIRECTION.OPENING_CASH).toBe("OPENING");
    expect(PORTFOLIO_FLOW_DIRECTION.OPENING_POSITION).toBe("OPENING");
  });

  it("réconcilie le cash dérivé avec le cash observé et chiffre l’écart", () => {
    const positions: Position[] = [observedPositions[0], { ...observedPositions[1], value: 4673 }];
    const envelope = envelopeLedgerOf(build(history, [declaredPolicy], { positions }), "acc_pea")!;
    expect(envelope.cashState).toBe("RECONCILED");
    expect(envelope.cashGap).toBeCloseTo(0, 6);

    const drifted = envelopeLedgerOf(build(history, [declaredPolicy]), "acc_pea")!;
    expect(drifted.cashState).toBe("UNDER_EXPLAINED");
    expect(drifted.cashGap).toBeCloseTo(6300 - 4673, 6);
  });

  it("réconcilie les quantités par instrument, jamais par libellé quand l’identifiant existe", () => {
    const positions: Position[] = [
      { ...observedPositions[0], securityName: "ETF Monde renommé", quantity: 18, costBasis: 1907 },
      observedPositions[1],
    ];
    const envelope = envelopeLedgerOf(build(history, [declaredPolicy], { positions }), "acc_pea")!;
    const holding = envelope.holdings[0];
    expect(holding.observedQuantity).toBe(18);
    expect(holding.quantityState).toBe("RECONCILED");
    expect(holding.observedCostBasis).toBe(1907);
    expect(holding.costBasisGap).toBeCloseTo(0, 6);
  });
});

describe("Portfolio ledger — convention d’appariement", () => {
  const twoLots = [
    event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 10000 }),
    event({
      id: "a1",
      type: "BUY",
      eventDate: "2026-02-01",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      quantity: 10,
      grossAmount: 1000,
      feeAmount: 0,
      taxAmount: 0,
      envelopeCashAmount: -1000,
    }),
    event({
      id: "a2",
      type: "BUY",
      eventDate: "2026-03-01",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      quantity: 10,
      grossAmount: 1500,
      feeAmount: 0,
      taxAmount: 0,
      envelopeCashAmount: -1500,
    }),
    event({
      id: "s1",
      type: "SELL",
      eventDate: "2026-04-01",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      quantity: 10,
      grossAmount: 1800,
      feeAmount: 0,
      taxAmount: 0,
      envelopeCashAmount: 1800,
    }),
  ];

  it("refuse d’apparier sans convention déclarée dès qu’il existe plusieurs lots", () => {
    const undeclared: PortfolioEnvelopePolicy = {
      ...declaredPolicy,
      lotMatchingMethod: null,
    };
    const envelope = envelopeLedgerOf(build(twoLots, [undeclared]), "acc_pea")!;
    const sale = envelope.disposals[0];
    expect(sale.matchedCost).toBeNull();
    expect(sale.realisedPnL).toBeNull();
    expect(envelope.flags).toContain("LOT_MATCHING_UNDECLARED:s1");
    expect(envelope.flags).toContain("LOT_MATCHING_METHOD_UNDECLARED:acc_pea");
    // La quantité, elle, ne dépend d'aucune convention.
    expect(envelope.holdings[0].ledgerQuantity).toBeCloseTo(10, 6);
  });

  it("apparie sans convention quand un seul lot est ouvert : le choix est mécanique", () => {
    const single = twoLots.filter((item) => item.id !== "a2");
    const envelope = envelopeLedgerOf(
      build(single, [{ ...declaredPolicy, lotMatchingMethod: null }]),
      "acc_pea",
    )!;
    expect(envelope.disposals[0].matchedCost).toBeCloseTo(1000, 6);
    expect(envelope.disposals[0].realisedPnL).toBeCloseTo(800, 6);
  });

  it("produit des coûts différents selon FIFO, LIFO et coût moyen pondéré", () => {
    const cost = (method: PortfolioEnvelopePolicy["lotMatchingMethod"]) =>
      envelopeLedgerOf(
        build(twoLots, [{ ...declaredPolicy, lotMatchingMethod: method }]),
        "acc_pea",
      )!.disposals[0].matchedCost;
    expect(cost("FIFO")).toBeCloseTo(1000, 6);
    expect(cost("LIFO")).toBeCloseTo(1500, 6);
    expect(cost("WEIGHTED_AVERAGE")).toBeCloseTo(1250, 6);
  });

  it("exige la désignation du lot en convention SPECIFIC_LOT", () => {
    const specific: PortfolioEnvelopePolicy = {
      ...declaredPolicy,
      lotMatchingMethod: "SPECIFIC_LOT",
    };
    const envelope = envelopeLedgerOf(build(twoLots, [specific]), "acc_pea")!;
    expect(envelope.flags).toContain("SPECIFIC_LOT_REFERENCE_MISSING:s1");

    const designated = twoLots.map((item) =>
      item.id === "s1" ? { ...item, matchedAcquisitionEventId: "a2" } : item,
    );
    const matched = envelopeLedgerOf(build(designated, [specific]), "acc_pea")!;
    expect(matched.disposals[0].matchedCost).toBeCloseTo(1500, 6);
  });

  it("gère les ventes partielles successives sur plusieurs lots", () => {
    const partial = [
      ...twoLots,
      event({
        id: "s2",
        type: "SELL",
        eventDate: "2026-05-01",
        securityId: "sec_etf",
        securityName: "ETF Monde",
        quantity: 5,
        grossAmount: 1000,
        feeAmount: 0,
        taxAmount: 0,
        envelopeCashAmount: 1000,
      }),
    ];
    const envelope = envelopeLedgerOf(build(partial, [declaredPolicy]), "acc_pea")!;
    expect(envelope.holdings[0].ledgerQuantity).toBeCloseTo(5, 6);
    // Le second lot à 150 € l'unité prend le relais une fois le premier épuisé.
    expect(envelope.disposals[1].matchedCost).toBeCloseTo(750, 6);
    expect(envelope.holdings[0].ledgerCostBasis).toBeCloseTo(750, 6);
    expect(envelope.realisedPnL).toBeCloseTo(800 + 250, 6);
  });
});

describe("Portfolio ledger — ce qui n’est pas connu le reste", () => {
  it("des frais inconnus rendent le coût de revient non calculable", () => {
    const events = [
      event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 5000 }),
      event({
        id: "b",
        type: "BUY",
        eventDate: "2026-02-01",
        securityId: "sec_etf",
        securityName: "ETF Monde",
        quantity: 10,
        grossAmount: 1000,
        feeAmount: null,
        taxAmount: null,
        envelopeCashAmount: null,
      }),
    ];
    const envelope = envelopeLedgerOf(build(events, [declaredPolicy]), "acc_pea")!;
    expect(envelope.holdings[0].ledgerCostBasis).toBeNull();
    expect(envelope.holdings[0].costBasisStatus).toBe("NOT_COMPUTABLE");
    expect(envelope.flags).toContain("ACQUISITION_FEES_UNKNOWN:b");
    // Un effet de cash inconnu n'est pas un effet nul : la série de cash s'interrompt.
    expect(envelope.ledgerCash).toBeNull();
    expect(envelope.flags).toContain("LEDGER_CASH_INCOMPLETE:acc_pea");
  });

  it("un transfert de titres entrant n’invente aucun prix de revient", () => {
    const events = [
      event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 0 }),
      event({
        id: "t",
        type: "TRANSFER_IN",
        eventDate: "2026-02-01",
        securityId: "sec_etf",
        securityName: "ETF Monde",
        quantity: 10,
        envelopeCashAmount: 0,
      }),
    ];
    const envelope = envelopeLedgerOf(build(events, [declaredPolicy]), "acc_pea")!;
    expect(envelope.holdings[0].ledgerQuantity).toBeCloseTo(10, 6);
    expect(envelope.holdings[0].ledgerCostBasis).toBeNull();
    expect(envelope.flags).toContain("TRANSFER_IN_COST_UNKNOWN:t");
  });

  it("signale une couverture déclarée sans ancrage de cash", () => {
    const envelope = envelopeLedgerOf(
      build([event({ id: "c", type: "CONTRIBUTION", envelopeCashAmount: 500 })], [declaredPolicy]),
      "acc_pea",
    )!;
    expect(envelope.coverageStatus).toBe("DECLARED_WITHOUT_CASH_ANCHOR");
    expect(envelope.ledgerCash).toBeNull();
    expect(envelope.flags).toContain("LEDGER_CASH_ANCHOR_MISSING:acc_pea");
  });

  it("signale un événement antérieur à la couverture déclarée", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 100 }),
          event({
            id: "c",
            type: "CONTRIBUTION",
            eventDate: "2025-11-01",
            envelopeCashAmount: 500,
          }),
        ],
        [declaredPolicy],
      ),
      "acc_pea",
    )!;
    expect(envelope.coverageStatus).toBe("PARTIAL");
    expect(envelope.flags).toContain("LEDGER_EVENTS_BEFORE_COVERAGE:acc_pea");
  });

  it("refuse de dériver un cash mélangeant deux devises", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 100 }),
          event({ id: "c", type: "CONTRIBUTION", envelopeCashAmount: 500, currency: "USD" }),
        ],
        [declaredPolicy],
      ),
      "acc_pea",
    )!;
    expect(envelope.ledgerCash).toBeNull();
    expect(envelope.flags).toContain("LEDGER_MULTI_CURRENCY:acc_pea");
  });

  it("signale une vente supérieure au stock connu sans jamais ramener la quantité à zéro", () => {
    const events = [
      event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 0 }),
      event({
        id: "b",
        type: "BUY",
        eventDate: "2026-02-01",
        securityId: "sec_etf",
        securityName: "ETF Monde",
        quantity: 5,
        grossAmount: 500,
        feeAmount: 0,
        taxAmount: 0,
        envelopeCashAmount: -500,
      }),
      event({
        id: "s",
        type: "SELL",
        eventDate: "2026-03-01",
        securityId: "sec_etf",
        securityName: "ETF Monde",
        quantity: 8,
        grossAmount: 900,
        feeAmount: 0,
        taxAmount: 0,
        envelopeCashAmount: 900,
      }),
    ];
    const envelope = envelopeLedgerOf(build(events, [declaredPolicy]), "acc_pea")!;
    expect(envelope.flags).toContain("LEDGER_OVERSOLD:sec_etf");
    expect(envelope.holdings[0].ledgerQuantity).toBeCloseTo(-3, 6);
    expect(envelope.disposals[0].matchedCost).toBeNull();
  });
});

describe("Portfolio ledger — la lecture est datée", () => {
  const timeline = [
    event({ id: "o", type: "OPENING_CASH", eventDate: "2026-01-01", envelopeCashAmount: 1000 }),
    event({
      id: "b",
      type: "BUY",
      eventDate: "2026-02-01",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      quantity: 10,
      grossAmount: 500,
      feeAmount: 0,
      taxAmount: 0,
      envelopeCashAmount: -500,
    }),
    event({
      id: "later",
      type: "BUY",
      eventDate: "2026-06-01",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      quantity: 20,
      grossAmount: 900,
      feeAmount: 0,
      taxAmount: 0,
      envelopeCashAmount: -900,
    }),
  ];

  it("ignore un événement postérieur à la date d’analyse", () => {
    const envelope = envelopeLedgerOf(
      build(timeline, [declaredPolicy], { asOfDate: "2026-03-01" }),
      "acc_pea",
    )!;
    // Un achat de juin ne détient rien en mars, et n'a rien débité.
    expect(envelope.ledgerCash).toBeCloseTo(500, 6);
    expect(envelope.holdings[0].ledgerQuantity).toBeCloseTo(10, 6);
    expect(envelope.holdings[0].ledgerCostBasis).toBeCloseTo(500, 6);
    expect(envelope.eventCount).toBe(2);
    expect(envelope.futureEventCount).toBe(1);
    expect(envelope.flags).toContain("LEDGER_EVENT_AFTER_AS_OF:later");
    expect(envelope.lastEventDate).toBe("2026-02-01");
  });

  it("intègre le même événement une fois la date d’analyse atteinte", () => {
    const envelope = envelopeLedgerOf(
      build(timeline, [declaredPolicy], { asOfDate: "2026-08-19" }),
      "acc_pea",
    )!;
    expect(envelope.ledgerCash).toBeCloseTo(-400, 6);
    expect(envelope.holdings[0].ledgerQuantity).toBeCloseTo(30, 6);
    expect(envelope.futureEventCount).toBe(0);
  });

  it("retient un événement daté du jour même de l’analyse", () => {
    const envelope = envelopeLedgerOf(
      build(timeline, [declaredPolicy], { asOfDate: "2026-06-01" }),
      "acc_pea",
    )!;
    expect(envelope.futureEventCount).toBe(0);
    expect(envelope.holdings[0].ledgerQuantity).toBeCloseTo(30, 6);
  });

  it("ne laisse pas une cession future annuler un PnL réalisé passé", () => {
    const withSale = [
      ...timeline.slice(0, 2),
      event({
        id: "s",
        type: "SELL",
        eventDate: "2026-07-01",
        securityId: "sec_etf",
        securityName: "ETF Monde",
        quantity: 10,
        grossAmount: 800,
        feeAmount: 0,
        taxAmount: 0,
        envelopeCashAmount: 800,
      }),
    ];
    const before = envelopeLedgerOf(
      build(withSale, [declaredPolicy], { asOfDate: "2026-03-01" }),
      "acc_pea",
    )!;
    expect(before.disposals).toHaveLength(0);
    expect(before.realisedPnL).toBeNull();
    const after = envelopeLedgerOf(
      build(withSale, [declaredPolicy], { asOfDate: "2026-08-19" }),
      "acc_pea",
    )!;
    expect(after.realisedPnL).toBeCloseTo(300, 6);
  });
});

describe("Portfolio ledger — sémantique des ancrages", () => {
  it("un ancrage de cash absorbe ce qui le précède au lieu de s’y ajouter", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({
            id: "old",
            type: "CONTRIBUTION",
            eventDate: "2025-06-01",
            envelopeCashAmount: 900,
          }),
          event({
            id: "o",
            type: "OPENING_CASH",
            eventDate: "2026-01-01",
            envelopeCashAmount: 1000,
          }),
          event({
            id: "c",
            type: "CONTRIBUTION",
            eventDate: "2026-02-01",
            envelopeCashAmount: 200,
          }),
        ],
        [{ ...declaredPolicy, ledgerCoverageStart: "2026-01-01" }],
      ),
      "acc_pea",
    )!;
    // 1 000 + 200, et surtout pas 1 000 + 900 + 200 : l'ancrage contient déjà les 900 €.
    expect(envelope.ledgerCash).toBeCloseTo(1200, 6);
    expect(envelope.supersededEventCount).toBe(1);
    expect(envelope.flags).toContain("LEDGER_EVENT_BEFORE_ANCHOR:old");
  });

  it("un ancrage de position est un point de départ, pas une acquisition de plus", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({
            id: "oldbuy",
            type: "BUY",
            eventDate: "2025-09-01",
            securityId: "sec_etf",
            securityName: "ETF Monde",
            quantity: 30,
            grossAmount: 3000,
            feeAmount: 0,
            taxAmount: 0,
            envelopeCashAmount: -3000,
          }),
          event({ id: "oc", type: "OPENING_CASH", eventDate: "2026-01-01", envelopeCashAmount: 0 }),
          event({
            id: "op",
            type: "OPENING_POSITION",
            eventDate: "2026-01-01",
            securityId: "sec_etf",
            securityName: "ETF Monde",
            quantity: 30,
            grossAmount: 3000,
            feeAmount: 0,
            taxAmount: 0,
            envelopeCashAmount: -3000,
          }),
        ],
        [{ ...declaredPolicy, ledgerCoverageStart: "2026-01-01" }],
      ),
      "acc_pea",
    )!;
    // 30 titres au départ, pas 60 : l'achat antérieur EST le contenu de l'ancrage.
    expect(envelope.holdings[0].ledgerQuantity).toBeCloseTo(30, 6);
    expect(envelope.holdings[0].lots).toHaveLength(1);
    expect(envelope.holdings[0].ledgerCostBasis).toBeCloseTo(3000, 6);
    expect(envelope.flags).toContain("LEDGER_EVENT_BEFORE_ANCHOR:oldbuy");
  });

  it("refuse de dériver quand l’ancrage précède la couverture déclarée", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({
            id: "o",
            type: "OPENING_CASH",
            eventDate: "2025-12-01",
            envelopeCashAmount: 500,
          }),
          event({
            id: "c",
            type: "CONTRIBUTION",
            eventDate: "2026-02-01",
            envelopeCashAmount: 100,
          }),
        ],
        [{ ...declaredPolicy, ledgerCoverageStart: "2026-01-01" }],
      ),
      "acc_pea",
    )!;
    // Entre l'ancrage et le début de couverture, rien ne garantit l'exhaustivité : la
    // série ne peut pas traverser cette zone.
    expect(envelope.ledgerCash).toBeNull();
    expect(envelope.flags).toContain("LEDGER_ANCHOR_BEFORE_COVERAGE:acc_pea");
  });

  it("rend la quantité non calculable quand un instrument sans ancrage précède la couverture", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({ id: "o", type: "OPENING_CASH", eventDate: "2026-01-01", envelopeCashAmount: 0 }),
          event({
            id: "pre",
            type: "BUY",
            eventDate: "2025-11-01",
            securityId: "sec_etf",
            securityName: "ETF Monde",
            quantity: 10,
            grossAmount: 1000,
            feeAmount: 0,
            taxAmount: 0,
            envelopeCashAmount: -1000,
          }),
        ],
        [{ ...declaredPolicy, ledgerCoverageStart: "2026-01-01" }],
      ),
      "acc_pea",
    )!;
    // Sans ancrage de position, le stock de départ est inconnu : ni l'écarter ni
    // l'additionner ne dirait la vérité.
    expect(envelope.holdings[0].ledgerQuantity).toBeNull();
    expect(envelope.holdings[0].ledgerCostBasis).toBeNull();
    expect(envelope.flags).toContain("LEDGER_QUANTITY_NOT_ANCHORED:sec_etf");
  });

  it("garde l’ordre : sur une même date, l’ancrage précède les opérations", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({
            id: "c",
            type: "CONTRIBUTION",
            eventDate: "2026-01-01",
            envelopeCashAmount: 300,
          }),
          event({
            id: "o",
            type: "OPENING_CASH",
            eventDate: "2026-01-01",
            envelopeCashAmount: 100,
          }),
        ],
        [{ ...declaredPolicy, ledgerCoverageStart: "2026-01-01" }],
      ),
      "acc_pea",
    )!;
    // L'ancrage est le niveau au début du jour : l'apport du même jour s'y ajoute.
    expect(envelope.ledgerCash).toBeCloseTo(400, 6);
    expect(envelope.supersededEventCount).toBe(0);
  });
});

describe("Portfolio ledger — totaux de flux", () => {
  it("rend les apports inconnus quand un transfert entrant est en nature", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 0 }),
          event({ id: "c", type: "CONTRIBUTION", envelopeCashAmount: 1000 }),
          event({
            id: "t",
            type: "TRANSFER_IN",
            eventDate: "2026-03-01",
            securityId: "sec_etf",
            securityName: "ETF Monde",
            quantity: 10,
            envelopeCashAmount: 0,
          }),
        ],
        [declaredPolicy],
      ),
      "acc_pea",
    )!;
    // 1 000 € de cash plus dix titres d'une valeur inconnue ne font pas 1 000 € d'apport.
    expect(envelope.flows.externalIn).toBeNull();
    expect(envelope.flags).toContain("EXTERNAL_TRANSFER_IN_KIND:t");
  });

  it("agrège les frais des opérations et les frais dédiés", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 5000 }),
          event({
            id: "b",
            type: "BUY",
            eventDate: "2026-02-01",
            securityId: "sec_etf",
            securityName: "ETF Monde",
            quantity: 10,
            grossAmount: 1000,
            feeAmount: 5,
            taxAmount: 1,
            envelopeCashAmount: -1006,
          }),
          event({
            id: "f",
            type: "FEE",
            eventDate: "2026-03-01",
            grossAmount: 12,
            envelopeCashAmount: -12,
          }),
        ],
        [declaredPolicy],
      ),
      "acc_pea",
    )!;
    expect(envelope.flows.fees).toBeCloseTo(17, 6);
    expect(envelope.flows.taxes).toBeCloseTo(1, 6);
  });

  it("rend les frais inconnus dès qu’une opération ne les porte pas", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 5000 }),
          event({
            id: "b",
            type: "BUY",
            eventDate: "2026-02-01",
            securityId: "sec_etf",
            securityName: "ETF Monde",
            quantity: 10,
            grossAmount: 1000,
            feeAmount: null,
            taxAmount: 0,
            envelopeCashAmount: -1000,
          }),
        ],
        [declaredPolicy],
      ),
      "acc_pea",
    )!;
    expect(envelope.flows.fees).toBeNull();
  });

  it("ne réclame aucune jambe bancaire à un transfert de titres", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({
            id: "t",
            type: "TRANSFER_IN",
            securityId: "sec_etf",
            securityName: "ETF Monde",
            quantity: 5,
            envelopeCashAmount: 0,
          }),
        ],
        [declaredPolicy],
      ),
      "acc_pea",
    )!;
    expect(envelope.flags).not.toContain("EXTERNAL_FLOW_UNLINKED:t");
  });

  it("ne prête aucun produit de cession à un transfert sortant", () => {
    const envelope = envelopeLedgerOf(
      build(
        [
          event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 0 }),
          event({
            id: "in",
            type: "BUY",
            eventDate: "2026-02-01",
            securityId: "sec_etf",
            securityName: "ETF Monde",
            quantity: 10,
            grossAmount: 1000,
            feeAmount: 0,
            taxAmount: 0,
            envelopeCashAmount: -1000,
          }),
          event({
            id: "out",
            type: "TRANSFER_OUT",
            eventDate: "2026-03-01",
            securityId: "sec_etf",
            securityName: "ETF Monde",
            quantity: 4,
            envelopeCashAmount: 0,
          }),
        ],
        [declaredPolicy],
      ),
      "acc_pea",
    )!;
    const transfer = envelope.disposals[0];
    expect(transfer.netProceeds).toBeNull();
    expect(transfer.realisedPnL).toBeNull();
    expect(transfer.flags).toContain("TRANSFER_OUT_NO_PROCEEDS:out");
    // Les titres sortent quand même du stock, avec leur coût de revient.
    expect(envelope.holdings[0].ledgerQuantity).toBeCloseTo(6, 6);
    expect(envelope.holdings[0].ledgerCostBasis).toBeCloseTo(600, 6);
  });
});

describe("Portfolio ledger — frontière avec le Cash Flow", () => {
  const categories: ExpenseCategory[] = [
    {
      id: "cat_invest",
      name: "Versement PEA",
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
      id: "cat_expense",
      name: "Dépense",
      groupName: "Vie courante",
      cashFlowKind: "EXPENSE",
      essentiality: "UNKNOWN",
      behavior: "UNKNOWN",
      monthlyAmount: null,
      essential: false,
      archived: false,
      provenance,
    },
  ];
  const transaction = (categoryId: string, amount: number): Transaction => ({
    id: "tx",
    accountId: "acc_bank",
    accountName: "Compte courant",
    date: "2026-02-01",
    label: "Virement PEA",
    categoryId,
    categoryName: "",
    amount,
    currency: "EUR",
    kindOverride: null,
    transferGroupId: null,
    notes: null,
    provenance,
  });

  const contribution = event({
    id: "c",
    type: "CONTRIBUTION",
    eventDate: "2026-02-01",
    envelopeCashAmount: 5000,
    transactionId: "tx",
    counterpartyAccountId: "acc_bank",
  });

  it("accepte un virement banque → PEA classé INVESTMENT sans rien reclasser", () => {
    const ledger = build([contribution], [declaredPolicy], {
      transactions: [transaction("cat_invest", -5000)],
      expenseCategories: categories,
    });
    const envelope = envelopeLedgerOf(ledger, "acc_pea")!;
    expect(envelope.flags).not.toContain("EXTERNAL_FLOW_CLASSIFIED_AS_EXPENSE:c");
    expect(envelope.flags).not.toContain("EXTERNAL_FLOW_AMOUNT_MISMATCH:c");
  });

  it("signale un virement vers l’enveloppe classé comme dépense patrimoniale", () => {
    const ledger = build([contribution], [declaredPolicy], {
      transactions: [transaction("cat_expense", -5000)],
      expenseCategories: categories,
    });
    expect(envelopeLedgerOf(ledger, "acc_pea")!.flags).toContain(
      "EXTERNAL_FLOW_CLASSIFIED_AS_EXPENSE:c",
    );
  });

  it("signale un écart de montant entre l’événement et sa jambe bancaire", () => {
    const ledger = build([contribution], [declaredPolicy], {
      transactions: [transaction("cat_invest", -4000)],
      expenseCategories: categories,
    });
    expect(envelopeLedgerOf(ledger, "acc_pea")!.flags).toContain("EXTERNAL_FLOW_AMOUNT_MISMATCH:c");
  });

  it("refuse qu’une opération interne pointe une transaction bancaire", () => {
    const internal = event({
      id: "b",
      type: "BUY",
      eventDate: "2026-02-05",
      securityId: "sec_etf",
      securityName: "ETF Monde",
      quantity: 1,
      grossAmount: 100,
      feeAmount: 0,
      taxAmount: 0,
      envelopeCashAmount: -100,
      transactionId: "tx",
    });
    const ledger = build([internal], [declaredPolicy], {
      transactions: [transaction("cat_invest", -100)],
      expenseCategories: categories,
    });
    expect(envelopeLedgerOf(ledger, "acc_pea")!.flags).toContain("INTERNAL_EVENT_LINKED_TO_BANK:b");
  });

  it("signale un flux externe sans jambe bancaire rattachée", () => {
    const ledger = build(
      [event({ id: "c2", type: "CONTRIBUTION", envelopeCashAmount: 100 })],
      [declaredPolicy],
    );
    expect(envelopeLedgerOf(ledger, "acc_pea")!.flags).toContain("EXTERNAL_FLOW_UNLINKED:c2");
  });
});

describe("Portfolio ledger — périmètre des enveloppes", () => {
  it("n’ouvre aucun ledger sur un compte bancaire et signale l’événement orphelin", () => {
    const ledger = build([event({ id: "x", type: "CONTRIBUTION", accountId: "acc_bank" })]);
    expect(ledger.envelopes.map((envelope) => envelope.accountId)).toEqual(["acc_pea"]);
    expect(ledger.orphanEventIds).toEqual(["x"]);
    expect(ledger.quality.flags).toContain("PORTFOLIO_EVENT_ORPHAN:x");
  });

  it("garde le ledger d’une enveloppe momentanément à découvert", () => {
    const overdrawn: FinancialAccount = { ...pea, balance: -50 };
    const ledger = build([event({ id: "o", type: "OPENING_CASH", envelopeCashAmount: 10 })], [], {
      accounts: [overdrawn],
    });
    expect(envelopeLedgerOf(ledger, "acc_pea")!.eventCount).toBe(1);
  });

  it("une enveloppe incohérente n’efface pas la qualité d’une autre", () => {
    const cto: FinancialAccount = { ...pea, id: "acc_cto", name: "CTO", type: "CTO" };
    const events = [
      event({ id: "o1", type: "OPENING_CASH", envelopeCashAmount: 6300 }),
      event({ id: "o2", type: "OPENING_CASH", accountId: "acc_cto", envelopeCashAmount: null }),
    ];
    const ledger = buildPortfolioLedger({
      asOfDate: "2026-08-19",
      accounts: [pea, cto, bank],
      positions: observedPositions,
      events,
      policies: [declaredPolicy, { ...declaredPolicy, id: "p2", accountId: "acc_cto" }],
    });
    expect(envelopeLedgerOf(ledger, "acc_pea")!.ledgerCash).toBe(6300);
    expect(envelopeLedgerOf(ledger, "acc_pea")!.cashState).toBe("RECONCILED");
    expect(envelopeLedgerOf(ledger, "acc_cto")!.ledgerCash).toBeNull();
  });
});
