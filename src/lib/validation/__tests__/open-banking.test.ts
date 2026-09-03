import { describe, expect, it } from "vitest";

import { openBankingCommandSchema } from "../open-banking";

/**
 * Ces tests portent sur la SURFACE de la route, pas sur son comportement métier. Deux
 * propriétés doivent tenir structurellement :
 *
 *   * aucune action d'initiation de paiement n'existe ;
 *   * aucun champ ne peut accueillir un secret, et un champ inconnu est REFUSÉ plutôt
 *     qu'ignoré — accepté en silence, il laisserait croire qu'il a servi.
 */

function actions(): string[] {
  const union = openBankingCommandSchema.options;
  return union
    .map((option) => {
      const shape = "shape" in option ? option.shape : undefined;
      const literal = shape?.action;
      return literal && "value" in literal ? String(literal.value) : "";
    })
    .filter((value) => value.length > 0);
}

describe("surface de la route Open Banking", () => {
  it("n'expose que des actions de LECTURE et de DÉCISION", () => {
    expect(actions().sort()).toEqual([
      "commit",
      "decide",
      "discover-accounts",
      "map-account",
      "open-consent",
      "record-event",
      "register-sandbox",
      "revoke-consent",
      "synchronize",
    ]);
  });

  it("n'expose AUCUNE action d'initiation de paiement", () => {
    const forbidden = /payment|payout|transfer|virement|mandate|mandat|beneficiar|prelevement/i;
    expect(actions().filter((action) => forbidden.test(action))).toEqual([]);
  });

  it("REFUSE un champ inconnu, y compris un champ de secret", () => {
    for (const secret of ["token", "accessToken", "clientSecret", "webhookSecret", "apiKey"]) {
      const parsed = openBankingCommandSchema.safeParse({
        action: "register-sandbox",
        [secret]: "valeur-en-clair",
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("REFUSE une opération décrite par le client : seul un NOM de scénario est accepté", () => {
    const withScenarioName = openBankingCommandSchema.safeParse({
      action: "synchronize",
      providerAccountId: "11111111-1111-4111-8111-111111111111",
      trigger: "MANUAL",
      scenario: "NOMINAL",
    });
    expect(withScenarioName.success).toBe(true);

    const withInjectedTransactions = openBankingCommandSchema.safeParse({
      action: "synchronize",
      providerAccountId: "11111111-1111-4111-8111-111111111111",
      trigger: "MANUAL",
      scenario: { transactionPages: [[{ amount: -1000, label: "injection" }]] },
    });
    expect(withInjectedTransactions.success).toBe(false);
  });
});

describe("formes de décision", () => {
  const base = {
    action: "decide" as const,
    observationId: "11111111-1111-4111-8111-111111111111",
    sessionId: null,
  };

  it("exige une transaction DÉSIGNÉE pour un rattachement", () => {
    expect(
      openBankingCommandSchema.safeParse({
        ...base,
        decision: "LINK_EXISTING",
        linkedTransactionId: null,
        reason: null,
      }).success,
    ).toBe(false);
    expect(
      openBankingCommandSchema.safeParse({
        ...base,
        decision: "LINK_EXISTING",
        linkedTransactionId: "22222222-2222-4222-8222-222222222222",
        reason: null,
      }).success,
    ).toBe(true);
  });

  it("exige un MOTIF pour un refus", () => {
    expect(
      openBankingCommandSchema.safeParse({
        ...base,
        decision: "REFUSE",
        linkedTransactionId: null,
        reason: null,
      }).success,
    ).toBe(false);
    expect(
      openBankingCommandSchema.safeParse({
        ...base,
        decision: "REFUSE",
        linkedTransactionId: null,
        reason: "Déjà saisie manuellement",
      }).success,
    ).toBe(true);
  });

  it("refuse qu'une acceptation désigne une transaction existante", () => {
    expect(
      openBankingCommandSchema.safeParse({
        ...base,
        decision: "ACCEPT_NEW",
        linkedTransactionId: "22222222-2222-4222-8222-222222222222",
        reason: null,
      }).success,
    ).toBe(false);
  });
});

describe("consentement", () => {
  it("accepte une expiration NULLE, qui signifie « non déclarée »", () => {
    const parsed = openBankingCommandSchema.safeParse({
      action: "open-consent",
      providerId: "11111111-1111-4111-8111-111111111111",
      consentReference: "consent-1",
      scopes: ["TRANSACTIONS"],
      expiresAt: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuse un consentement sans portée", () => {
    const parsed = openBankingCommandSchema.safeParse({
      action: "open-consent",
      providerId: "11111111-1111-4111-8111-111111111111",
      consentReference: "consent-1",
      scopes: [],
      expiresAt: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("refuse une portée d'initiation de paiement", () => {
    const parsed = openBankingCommandSchema.safeParse({
      action: "open-consent",
      providerId: "11111111-1111-4111-8111-111111111111",
      consentReference: "consent-1",
      scopes: ["PAYMENT_INITIATION"],
      expiresAt: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("exige un motif de révocation", () => {
    expect(
      openBankingCommandSchema.safeParse({
        action: "revoke-consent",
        consentId: "11111111-1111-4111-8111-111111111111",
        reason: "",
      }).success,
    ).toBe(false);
  });
});
