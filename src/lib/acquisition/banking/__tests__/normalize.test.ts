import { describe, expect, it } from "vitest";

import {
  foldLabel,
  normalizeBalance,
  normalizeObservation,
  readCurrency,
  readProviderDate,
  SANDBOX_CAPABILITIES,
} from "..";
import { ACCOUNT, transaction } from "./fixtures/sandbox";

const BASE = {
  capabilities: SANDBOX_CAPABILITIES,
  providerId: "sandbox-ais",
  accountCurrency: "EUR",
  mappedAccountId: "acct-1",
  accountAmbiguous: false,
};

function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("lecture d'une date fournisseur", () => {
  it("n'accepte que l'ISO", () => {
    expect(readProviderDate("2026-08-19")).toBe("2026-08-19");
    expect(readProviderDate("19/08/2026")).toBeNull();
    expect(readProviderDate("2026-8-9")).toBeNull();
    expect(readProviderDate(null)).toBeNull();
  });

  it("refuse une date syntaxiquement correcte qui n'existe pas au calendrier", () => {
    // Laisser passer le 30 février produirait une opération à une date inexistante.
    expect(readProviderDate("2026-02-30")).toBeNull();
    expect(readProviderDate("2026-13-01")).toBeNull();
    expect(readProviderDate("2024-02-29")).toBe("2024-02-29");
  });
});

describe("lecture d'une devise", () => {
  it("n'accepte qu'un code ISO 4217 sur trois lettres", () => {
    expect(readCurrency("eur")).toBe("EUR");
    expect(readCurrency(" USD ")).toBe("USD");
    expect(readCurrency("€")).toBeNull();
    expect(readCurrency("EURO")).toBeNull();
    expect(readCurrency(null)).toBeNull();
  });
});

describe("empreinte de libellé", () => {
  it("neutralise casse, accents et ponctuation, sans rien prouver", () => {
    expect(foldLabel("CAFÉ  du-Coin !")).toBe("cafe du coin");
    expect(foldLabel(null)).toBe("");
  });
});

describe("normalisation d'une opération observée", () => {
  it("lit une opération complète sans anomalie bloquante", () => {
    const observation = normalizeObservation({ ...BASE, transaction: transaction() });
    expect(observation.status).toBe("READY");
    expect(observation.operationDate).toBe("2026-08-19");
    expect(observation.valueDate).toBe("2026-08-20");
    expect(observation.bookingDate).toBe("2026-08-20");
    expect(observation.amount).toBe(-51.84);
    expect(observation.currency).toBe("EUR");
    expect(observation.externalKey).toBe("sandbox-ais:tx-1");
  });

  it("conserve les trois dates SÉPARÉMENT et date le fait par l'opération", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({
        operationDate: "2026-07-31",
        valueDate: "2026-08-01",
        bookingDate: "2026-08-02",
      }),
    });
    // Retenir la date de comptabilisation aurait déplacé la dépense d'un mois.
    expect(observation.operationDate).toBe("2026-07-31");
    expect(observation.valueDate).toBe("2026-08-01");
    expect(observation.bookingDate).toBe("2026-08-02");
  });

  it("BLOQUE une opération sans date d'opération, sans se replier sur une autre date", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({ operationDate: null }),
    });
    expect(observation.status).toBe("BLOCKED");
    expect(codes(observation.issues)).toContain("BANK_OPERATION_DATE_MISSING");
    expect(observation.operationDate).toBeNull();
  });

  it("BLOQUE un montant absent sans le remplacer par zéro", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({ amount: null }),
    });
    expect(observation.status).toBe("BLOCKED");
    expect(observation.amount).toBeNull();
    expect(codes(observation.issues)).toContain("BANK_AMOUNT_MISSING");
  });

  it("distingue un zéro EXPLICITE d'un montant absent", () => {
    const explicit = normalizeObservation({
      ...BASE,
      transaction: transaction({ amount: 0 }),
    });
    expect(explicit.amount).toBe(0);
    expect(explicit.status).toBe("WARNING");
    expect(codes(explicit.issues)).toContain("AMOUNT_ZERO");
  });

  it("BLOQUE un libellé absent", () => {
    const blank = normalizeObservation({
      ...BASE,
      transaction: transaction({ label: "   " }),
    });
    expect(blank.status).toBe("BLOCKED");
    expect(codes(blank.issues)).toContain("BANK_LABEL_MISSING");
  });

  it("BLOQUE une devise absente sans reprendre celle du compte", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({ currency: null }),
    });
    expect(observation.status).toBe("BLOCKED");
    expect(observation.currency).toBeNull();
    expect(codes(observation.issues)).toContain("BANK_CURRENCY_MISSING");
  });

  it("SIGNALE une devise différente du compte sans convertir", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({ currency: "USD", amount: -9.9 }),
    });
    expect(observation.status).toBe("WARNING");
    expect(observation.currency).toBe("USD");
    expect(observation.amount).toBe(-9.9);
    expect(codes(observation.issues)).toContain("BANK_CURRENCY_MISMATCH");
  });

  it("n'infère AUCUN taux du rapport entre montant converti et montant d'origine", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({
        amount: -9.2,
        currency: "EUR",
        originalAmount: -9.9,
        originalCurrency: "USD",
      }),
    });
    expect(observation.originalAmount).toBe(-9.9);
    expect(observation.originalCurrency).toBe("USD");
    expect(codes(observation.issues)).toContain("BANK_ORIGINAL_CURRENCY_WITHOUT_RATE");
    // Aucun champ de taux n'existe : il n'y a rien où un taux inventé pourrait se glisser.
    expect(observation).not.toHaveProperty("fxRate");
  });

  it("BLOQUE une opération dont le compte fournisseur n'est pas rattaché", () => {
    const observation = normalizeObservation({
      ...BASE,
      mappedAccountId: null,
      transaction: transaction(),
    });
    expect(observation.status).toBe("BLOCKED");
    expect(codes(observation.issues)).toContain("BANK_ACCOUNT_NOT_MAPPED");
  });

  it("BLOQUE un rattachement AMBIGU sans en choisir un", () => {
    const observation = normalizeObservation({
      ...BASE,
      accountAmbiguous: true,
      transaction: transaction(),
    });
    expect(observation.status).toBe("BLOCKED");
    expect(codes(observation.issues)).toContain("BANK_ACCOUNT_AMBIGUOUS");
  });

  it("laisse une opération EN ATTENTE lisible mais jamais prête d'office", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({ state: "PENDING" }),
    });
    expect(observation.status).toBe("WARNING");
    expect(codes(observation.issues)).toContain("BANK_PENDING_OBSERVATION");
  });

  it("BLOQUE une opération ANNULÉE par la banque", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({ state: "CANCELLED" }),
    });
    expect(observation.status).toBe("BLOCKED");
    expect(codes(observation.issues)).toContain("BANK_TRANSACTION_CANCELLED");
  });

  it("SIGNALE une opération corrigée par la banque", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({ state: "CORRECTED" }),
    });
    expect(observation.status).toBe("WARNING");
    expect(codes(observation.issues)).toContain("BANK_TRANSACTION_CORRECTED");
  });

  it("ne construit AUCUNE identité quand l'adaptateur ne déclare pas ses identifiants stables", () => {
    const observation = normalizeObservation({
      ...BASE,
      capabilities: { ...SANDBOX_CAPABILITIES, stableTransactionIds: false },
      transaction: transaction(),
    });
    expect(observation.externalKey).toBeNull();
    expect(observation.providerTransactionId).toBe("tx-1");
    expect(codes(observation.issues)).toContain("BANK_TRANSACTION_ID_UNSTABLE");
  });

  it("signale un identifiant absent sans le fabriquer", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({ providerTransactionId: null }),
    });
    expect(observation.externalKey).toBeNull();
    expect(codes(observation.issues)).toContain("BANK_TRANSACTION_ID_MISSING");
  });

  it("dit qu'une date NON SERVIE est non servie, et non égale à une autre", () => {
    const observation = normalizeObservation({
      ...BASE,
      capabilities: { ...SANDBOX_CAPABILITIES, valueDate: false, bookingDate: false },
      transaction: transaction({ valueDate: null, bookingDate: null }),
    });
    expect(observation.valueDate).toBeNull();
    expect(observation.bookingDate).toBeNull();
    expect(codes(observation.issues)).toContain("BANK_VALUE_DATE_NOT_SERVED");
    expect(codes(observation.issues)).toContain("BANK_BOOKING_DATE_NOT_SERVED");
  });

  it("ne construit AUCUNE clé de ressemblance quand une composante manque", () => {
    const observation = normalizeObservation({
      ...BASE,
      transaction: transaction({ amount: null }),
    });
    expect(observation.matchKey).toBeNull();
  });
});

describe("normalisation d'un solde observé", () => {
  it("laisse un solde NON SERVI absent", () => {
    const balance = normalizeBalance(
      {
        providerAccountId: ACCOUNT.providerAccountId,
        balanceType: "AVAILABLE",
        amount: null,
        currency: "EUR",
        observedAt: "2026-08-19",
      },
      SANDBOX_CAPABILITIES,
    );
    expect(balance.amount).toBeNull();
    expect(codes(balance.issues)).toContain("BANK_BALANCE_NOT_SERVED");
  });

  it("conserve une nature de solde hors des natures déclarées, sans la requalifier", () => {
    const balance = normalizeBalance(
      {
        providerAccountId: ACCOUNT.providerAccountId,
        balanceType: "EXPECTED",
        amount: 10,
        currency: "EUR",
        observedAt: "2026-08-19",
      },
      SANDBOX_CAPABILITIES,
    );
    expect(balance.balanceType).toBe("EXPECTED");
    expect(codes(balance.issues)).toContain("BANK_BALANCE_TYPE_NOT_SERVED");
  });
});
