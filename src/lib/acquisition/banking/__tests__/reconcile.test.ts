import { describe, expect, it } from "vitest";

import {
  normalizeObservation,
  PROBABLE_DUPLICATE_DAY_WINDOW,
  reconcileObservations,
  SANDBOX_CAPABILITIES,
} from "..";
import type { KnownObservation, NormalizedObservation } from "..";
import type { ExistingIdentity, ExistingTransactionFact } from "../../types";
import { transaction } from "./fixtures/sandbox";

const BASE = {
  capabilities: SANDBOX_CAPABILITIES,
  providerId: "sandbox-ais",
  accountCurrency: "EUR",
  mappedAccountId: "acct-1",
  accountAmbiguous: false,
};

function observed(overrides: Parameters<typeof transaction>[0] = {}): NormalizedObservation {
  return normalizeObservation({ ...BASE, transaction: transaction(overrides) });
}

function reconcile(
  observations: readonly NormalizedObservation[],
  options: {
    known?: readonly KnownObservation[];
    identities?: readonly ExistingIdentity[];
    existing?: readonly ExistingTransactionFact[];
    stable?: boolean;
  } = {},
) {
  return reconcileObservations({
    observations,
    known: options.known ?? [],
    identities: options.identities ?? [],
    existing: options.existing ?? [],
    stableTransactionIds: options.stable ?? true,
  });
}

const KNOWN_BASE: KnownObservation = {
  id: "obs-1",
  externalKey: "sandbox-ais:tx-1",
  matchKey: null,
  providerTransactionId: "tx-1",
  providerAccountId: "pa-1",
  operationDate: "2026-08-19",
  amount: -51.84,
  currency: "EUR",
  state: "PENDING",
  decision: null,
  transactionId: null,
};

function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("identité démontrée", () => {
  it("déclare NOUVELLE une opération dont aucune identité n'existe", () => {
    const [outcome] = reconcile([observed()]);
    expect(outcome.verdict).toBe("NEW");
    expect(outcome.status).toBe("READY");
  });

  it("reconnaît une identité DÉJÀ écrite, sur TOUT l'historique et sans filtre de date", () => {
    const [outcome] = reconcile([observed()], {
      // Transaction canonique très ancienne : une identité stable ne se périme pas.
      identities: [{ externalKey: "sandbox-ais:tx-1", transactionId: "tx-canonique" }],
    });
    expect(outcome.verdict).toBe("EXACT_DUPLICATE");
    expect(outcome.status).toBe("DUPLICATE");
    expect(outcome.matchedTransactionId).toBe("tx-canonique");
  });

  it("reconnaît un identifiant RÉPÉTÉ dans la même lecture", () => {
    const outcomes = reconcile([observed(), observed()]);
    expect(outcomes[0].verdict).toBe("NEW");
    expect(outcomes[1].verdict).toBe("EXACT_DUPLICATE");
  });

  it("n'utilise AUCUNE identité quand l'adaptateur ne déclare pas ses identifiants stables", () => {
    const unstable = normalizeObservation({
      ...BASE,
      capabilities: { ...SANDBOX_CAPABILITIES, stableTransactionIds: false },
      transaction: transaction(),
    });
    const [outcome] = reconcile([unstable], {
      identities: [{ externalKey: "sandbox-ais:tx-1", transactionId: "tx-canonique" }],
      stable: false,
    });
    // L'identité n'est pas construite : le verdict retombe sur la ressemblance.
    expect(outcome.verdict).toBe("NEW");
  });
});

describe("ressemblance, jamais une preuve", () => {
  const existing: ExistingTransactionFact[] = [
    {
      id: "tx-connue",
      accountId: "acct-1",
      date: "2026-08-19",
      label: "CAFE DU COIN",
      amount: -51.84,
      currency: "EUR",
    },
  ];

  it("SIGNALE une ressemblance exacte sans la trancher", () => {
    const noIdentity = normalizeObservation({
      ...BASE,
      capabilities: { ...SANDBOX_CAPABILITIES, stableTransactionIds: false },
      transaction: transaction(),
    });
    const [outcome] = reconcile([noIdentity], { existing, stable: false });
    expect(outcome.verdict).toBe("PROBABLE_DUPLICATE");
    expect(outcome.status).toBe("WARNING");
    expect(outcome.matchedTransactionId).toBe("tx-connue");
    expect(codes(outcome.issues)).toContain("DUPLICATE_PROBABLE");
  });

  it("ne revendique une transaction connue QU'UNE fois", () => {
    const noIdentity = (id: string) =>
      normalizeObservation({
        ...BASE,
        capabilities: { ...SANDBOX_CAPABILITIES, stableTransactionIds: false },
        transaction: transaction({ providerTransactionId: id }),
      });
    // Trois cafés identiques face à UNE transaction connue : la première ressemble, les
    // deux autres sont NOUVELLES. Les écarter supprimerait deux dépenses réelles.
    const outcomes = reconcile([noIdentity("a"), noIdentity("b"), noIdentity("c")], {
      existing,
      stable: false,
    });
    expect(outcomes.map((outcome) => outcome.verdict)).toEqual([
      "PROBABLE_DUPLICATE",
      "NEW",
      "NEW",
    ]);
  });

  it("cherche la ressemblance dans une FENÊTRE, pas dans tout l'historique", () => {
    const near = normalizeObservation({
      ...BASE,
      capabilities: { ...SANDBOX_CAPABILITIES, stableTransactionIds: false },
      transaction: transaction({ operationDate: "2026-08-21" }),
    });
    const [inWindow] = reconcile([near], { existing, stable: false });
    expect(inWindow.verdict).toBe("PROBABLE_DUPLICATE");

    const far = normalizeObservation({
      ...BASE,
      capabilities: { ...SANDBOX_CAPABILITIES, stableTransactionIds: false },
      transaction: transaction({ operationDate: "2026-09-19" }),
    });
    const [outOfWindow] = reconcile([far], { existing, stable: false });
    expect(outOfWindow.verdict).toBe("NEW");
    expect(PROBABLE_DUPLICATE_DAY_WINDOW).toBe(3);
  });

  it("qualifie de RAPPROCHEMENT POSSIBLE une même date et un même montant sous un autre libellé", () => {
    const other = normalizeObservation({
      ...BASE,
      capabilities: { ...SANDBOX_CAPABILITIES, stableTransactionIds: false },
      transaction: transaction({ label: "AUTRE COMMERCANT" }),
    });
    const [outcome] = reconcile([other], { existing, stable: false });
    expect(outcome.verdict).toBe("POSSIBLE_MATCH");
    expect(codes(outcome.issues)).toContain("POSSIBLE_MATCH");
  });
});

describe("cycle de vie PENDING → BOOKED", () => {
  it("applique le remplacement DÉCLARÉ par le fournisseur", () => {
    const booked = observed({
      providerTransactionId: "tx-2",
      replacesProviderTransactionId: "tx-1",
    });
    const [outcome] = reconcile([booked], { known: [KNOWN_BASE] });
    expect(outcome.replacesObservationId).toBe("obs-1");
    expect(outcome.verdict).toBe("NEW");
  });

  it("SIGNALE sans appliquer un remplacement d'une opération inconnue", () => {
    const booked = observed({
      providerTransactionId: "tx-2",
      replacesProviderTransactionId: "tx-inconnue",
    });
    const [outcome] = reconcile([booked]);
    expect(outcome.replacesObservationId).toBeNull();
    expect(codes(outcome.issues)).toContain("BANK_PENDING_REPLACEMENT_UNPROVEN");
  });

  it("REFUSE d'appliquer un remplacement quand les identifiants ne sont pas déclarés stables", () => {
    const booked = normalizeObservation({
      ...BASE,
      capabilities: { ...SANDBOX_CAPABILITIES, stableTransactionIds: false },
      transaction: transaction({
        providerTransactionId: "tx-2",
        replacesProviderTransactionId: "tx-1",
      }),
    });
    const [outcome] = reconcile([booked], { known: [KNOWN_BASE], stable: false });
    expect(outcome.replacesObservationId).toBeNull();
    expect(codes(outcome.issues)).toContain("BANK_PENDING_REPLACEMENT_UNPROVEN");
  });

  it("traite comme une CORRECTION le remplacement d'une opération DÉJÀ écrite", () => {
    const booked = observed({
      providerTransactionId: "tx-2",
      replacesProviderTransactionId: "tx-1",
    });
    const [outcome] = reconcile([booked], {
      known: [{ ...KNOWN_BASE, transactionId: "tx-canonique" }],
    });
    // L'écrire à nouveau doublerait la dépense : la décision porte sur la correction.
    expect(outcome.verdict).toBe("POSSIBLE_MATCH");
    expect(outcome.status).toBe("WARNING");
    expect(outcome.matchedTransactionId).toBe("tx-canonique");
    expect(codes(outcome.issues)).toContain("BANK_TRANSACTION_CORRECTED");
  });

  it("laisse une opération EN ATTENTE non prête même déclarée nouvelle", () => {
    const pending = observed({ state: "PENDING", providerTransactionId: "tx-9" });
    const [outcome] = reconcile([pending]);
    expect(outcome.verdict).toBe("NEW");
    expect(outcome.status).toBe("WARNING");
  });
});

describe("décisions humaines durables", () => {
  it("ne repropose PAS une observation déjà écrite sur décision", () => {
    const [outcome] = reconcile([observed()], {
      known: [{ ...KNOWN_BASE, decision: "ACCEPT_NEW", transactionId: "tx-canonique" }],
    });
    expect(outcome.status).toBe("DUPLICATE");
    expect(outcome.appliedDecision).toBe("ACCEPT_NEW");
    expect(codes(outcome.issues)).toContain("BANK_RECONCILIATION_DECIDED");
  });

  it("ne repropose PAS une observation déjà REFUSÉE", () => {
    const [outcome] = reconcile([observed()], {
      known: [{ ...KNOWN_BASE, decision: "REFUSE" }],
    });
    expect(outcome.status).toBe("IGNORED");
    expect(outcome.appliedDecision).toBe("REFUSE");
  });

  it("réapplique un rattachement déjà décidé", () => {
    const [outcome] = reconcile([observed()], {
      known: [{ ...KNOWN_BASE, decision: "LINK_EXISTING", transactionId: "tx-existante" }],
    });
    expect(outcome.status).toBe("DUPLICATE");
    expect(outcome.matchedTransactionId).toBe("tx-existante");
  });
});

describe("observation illisible", () => {
  it("N'ÉVALUE PAS la déduplication : `null` ne veut pas dire « nouvelle »", () => {
    const blocked = normalizeObservation({
      ...BASE,
      transaction: transaction({ amount: null }),
    });
    const [outcome] = reconcile([blocked], {
      identities: [{ externalKey: "sandbox-ais:tx-1", transactionId: "tx-canonique" }],
    });
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.verdict).toBeNull();
    expect(outcome.matchedTransactionId).toBeNull();
  });
});
