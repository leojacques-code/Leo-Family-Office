import { describe, expect, it } from "vitest";

import { mutationSchema } from "@/lib/validation/mutations";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const SECURITY = "22222222-2222-4222-8222-222222222222";
const TRANSACTION = "33333333-3333-4333-8333-333333333333";
const LOT = "44444444-4444-4444-8444-444444444444";

const event = {
  accountId: ACCOUNT,
  type: "BUY" as const,
  eventDate: "2026-02-05",
  settlementDate: null,
  securityId: SECURITY,
  security: null,
  quantity: 20,
  unitPrice: 100,
  grossAmount: 2000,
  feeAmount: 5,
  taxAmount: 0,
  envelopeCashAmount: -2005,
  currency: "EUR",
  counterpartyAccountId: null,
  transactionId: null,
  matchedAcquisitionEventId: null,
  externalReference: null,
  notes: null,
};

function parse(payload: unknown) {
  return mutationSchema.safeParse(payload);
}

describe("mutations Portfolio Data Foundation", () => {
  it("préserve la différence entre frais nuls et frais inconnus", () => {
    const known = parse({ action: "record_portfolio_event", event });
    expect(known.success).toBe(true);
    if (!known.success || known.data.action !== "record_portfolio_event") return;
    expect(known.data.event.taxAmount).toBe(0);

    const unknown = parse({
      action: "record_portfolio_event",
      event: { ...event, feeAmount: null, taxAmount: null, envelopeCashAmount: null },
    });
    expect(unknown.success).toBe(true);
    if (!unknown.success || unknown.data.action !== "record_portfolio_event") return;
    expect(unknown.data.event.feeAmount).toBeNull();
    expect(unknown.data.event.envelopeCashAmount).toBeNull();
  });

  it("refuse un achat sans instrument et un apport qui en porte un", () => {
    expect(
      parse({
        action: "record_portfolio_event",
        event: { ...event, securityId: null, security: null },
      }).success,
    ).toBe(false);
    expect(
      parse({
        action: "record_portfolio_event",
        event: { ...event, type: "CONTRIBUTION", quantity: null, envelopeCashAmount: 5000 },
      }).success,
    ).toBe(false);
  });

  it("refuse un mouvement d’instrument sans quantité", () => {
    expect(
      parse({ action: "record_portfolio_event", event: { ...event, quantity: null } }).success,
    ).toBe(false);
  });

  it("refuse qu’une opération interne pointe une transaction bancaire", () => {
    // Un achat réglé avec le cash déjà logé dans l'enveloppe ne traverse aucun compte
    // bancaire : le rattacher ferait compter le même euro deux fois dans le Cash Flow.
    expect(
      parse({
        action: "record_portfolio_event",
        event: { ...event, transactionId: TRANSACTION },
      }).success,
    ).toBe(false);
    expect(
      parse({
        action: "record_portfolio_event",
        event: {
          ...event,
          type: "CONTRIBUTION",
          securityId: null,
          quantity: null,
          envelopeCashAmount: 5000,
          transactionId: TRANSACTION,
          counterpartyAccountId: ACCOUNT,
        },
      }).success,
    ).toBe(true);
  });

  it("n’accepte la désignation d’un lot qu’à la cession", () => {
    expect(
      parse({
        action: "record_portfolio_event",
        event: { ...event, matchedAcquisitionEventId: LOT },
      }).success,
    ).toBe(false);
    expect(
      parse({
        action: "record_portfolio_event",
        event: {
          ...event,
          type: "SELL",
          envelopeCashAmount: 1436,
          matchedAcquisitionEventId: LOT,
        },
      }).success,
    ).toBe(true);
  });

  it("refuse un règlement antérieur à l’opération", () => {
    expect(
      parse({
        action: "record_portfolio_event",
        event: { ...event, settlementDate: "2026-02-01" },
      }).success,
    ).toBe(false);
  });

  it("accepte une convention et une profondeur non déclarées", () => {
    const result = parse({
      action: "set_portfolio_envelope_policy",
      policy: {
        accountId: ACCOUNT,
        lotMatchingMethod: null,
        ledgerCoverageStart: null,
        ledgerCoverageSource: null,
        notes: null,
      },
    });
    expect(result.success).toBe(true);
    if (!result.success || result.data.action !== "set_portfolio_envelope_policy") return;
    expect(result.data.policy.lotMatchingMethod).toBeNull();
  });

  it("refuse une profondeur d’historique sans origine, et l’inverse", () => {
    const base = {
      accountId: ACCOUNT,
      lotMatchingMethod: "FIFO" as const,
      notes: null,
    };
    expect(
      parse({
        action: "set_portfolio_envelope_policy",
        policy: { ...base, ledgerCoverageStart: "2026-01-01", ledgerCoverageSource: null },
      }).success,
    ).toBe(false);
    expect(
      parse({
        action: "set_portfolio_envelope_policy",
        policy: { ...base, ledgerCoverageStart: null, ledgerCoverageSource: "MANUAL" },
      }).success,
    ).toBe(false);
    expect(
      parse({
        action: "set_portfolio_envelope_policy",
        policy: { ...base, ledgerCoverageStart: "2026-01-01", ledgerCoverageSource: "MANUAL" },
      }).success,
    ).toBe(true);
  });

  it("refuse une date de couverture inexistante au calendrier", () => {
    expect(
      parse({
        action: "set_portfolio_envelope_policy",
        policy: {
          accountId: ACCOUNT,
          lotMatchingMethod: null,
          ledgerCoverageStart: "2026-02-31",
          ledgerCoverageSource: "MANUAL",
          notes: null,
        },
      }).success,
    ).toBe(false);
  });
});
