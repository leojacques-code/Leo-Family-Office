import { describe, expect, it } from "vitest";

import {
  classifyEventCandidates,
  classifyPositionCandidates,
  eventExternalKeyOf,
  type EventDedupeCandidate,
  type ExistingEventFact,
} from "@/lib/acquisition/portfolio/dedupe";
import {
  foldIsin,
  instrumentSourceKey,
  resolveInstruments,
} from "@/lib/acquisition/portfolio/instruments";
import { analyzePortfolioFile } from "@/lib/acquisition/portfolio/analyze";

import { csvBytes, KNOWN } from "./fixtures";

const ACCOUNT = "acc-pea";
const SOURCE = "GENERIC_PORTFOLIO_FILE";

function candidate(overrides: Partial<EventDedupeCandidate> = {}): EventDedupeCandidate {
  return {
    rowNumber: 2,
    accountId: ACCOUNT,
    securityId: "sec-air",
    eventType: "BUY",
    eventDate: "2026-03-15",
    quantity: 10,
    grossAmount: 1705,
    currency: "EUR",
    externalReference: null,
    ...overrides,
  };
}

function fact(overrides: Partial<ExistingEventFact> = {}): ExistingEventFact {
  return {
    eventId: "evt-1",
    accountId: ACCOUNT,
    securityId: "sec-air",
    eventType: "BUY",
    eventDate: "2026-03-15",
    quantity: 10,
    grossAmount: 1705,
    currency: "EUR",
    ...overrides,
  };
}

describe("déduplication d'événements", () => {
  it("déclare NEW une opération inconnue", () => {
    const [outcome] = classifyEventCandidates({
      candidates: [candidate()],
      existingFacts: [],
      existingIdentities: [],
      sourceKey: SOURCE,
      stableReferences: false,
    });
    expect(outcome.verdict).toBe("NEW");
    expect(outcome.externalKey).toBeNull();
  });

  it("signale une ressemblance avec un fait canonique SANS l'écarter d'office", () => {
    // Deux achats identiques le même jour peuvent être deux ordres réels : les écarter
    // supprimerait des titres détenus.
    const [outcome] = classifyEventCandidates({
      candidates: [candidate()],
      existingFacts: [fact()],
      existingIdentities: [],
      sourceKey: SOURCE,
      stableReferences: false,
    });
    expect(outcome.verdict).toBe("PROBABLE_DUPLICATE");
    expect(outcome.issues[0].message).toContain("ne PROUVE pas");
  });

  it("traite deux lignes identiques du même fichier comme un CONFLIT explicite", () => {
    const outcomes = classifyEventCandidates({
      candidates: [candidate({ rowNumber: 2 }), candidate({ rowNumber: 3 })],
      existingFacts: [],
      existingIdentities: [],
      sourceKey: SOURCE,
      stableReferences: false,
    });
    expect(outcomes[0].verdict).toBe("NEW");
    expect(outcomes[1].verdict).toBe("PROBABLE_DUPLICATE");
    // Les rangs d'occurrence distinguent les deux lignes sans prétendre les identifier.
    expect(outcomes[0].matchKey).not.toBe(outcomes[1].matchKey);
  });

  it("rejette automatiquement SEULEMENT sur une identité déclarée stable", () => {
    const externalKey = eventExternalKeyOf(SOURCE, "ORD-1");
    const [outcome] = classifyEventCandidates({
      candidates: [candidate({ externalReference: "ORD-1" })],
      existingFacts: [],
      existingIdentities: [{ externalKey, eventId: "evt-9" }],
      sourceKey: SOURCE,
      stableReferences: true,
    });
    expect(outcome.verdict).toBe("EXACT_DUPLICATE");
    expect(outcome.matchedEventId).toBe("evt-9");
  });

  it("ne se sert PAS d'une référence dont la stabilité n'est pas déclarée", () => {
    const externalKey = eventExternalKeyOf(SOURCE, "ORD-1");
    const [outcome] = classifyEventCandidates({
      candidates: [candidate({ externalReference: "ORD-1" })],
      existingFacts: [],
      existingIdentities: [{ externalKey, eventId: "evt-9" }],
      sourceKey: SOURCE,
      stableReferences: false,
    });
    expect(outcome.verdict).toBe("NEW");
    expect(outcome.issues.some((entry) => entry.code === "MATCH_WITHOUT_STABLE_ID")).toBe(true);
  });

  it("signale une opération proche dans la fenêtre, sans conclure", () => {
    const [outcome] = classifyEventCandidates({
      candidates: [candidate()],
      existingFacts: [fact({ eventDate: "2026-03-17" })],
      existingIdentities: [],
      sourceKey: SOURCE,
      stableReferences: false,
    });
    expect(outcome.verdict).toBe("POSSIBLE_MATCH");
  });

  it("ne rapproche pas deux opérations d'INSTRUMENTS différents", () => {
    const [outcome] = classifyEventCandidates({
      candidates: [candidate({ securityId: "sec-msft" })],
      existingFacts: [fact({ securityId: "sec-air" })],
      existingIdentities: [],
      sourceKey: SOURCE,
      stableReferences: false,
    });
    expect(outcome.verdict).toBe("NEW");
  });

  it("ne rapproche pas deux opérations de NATURES différentes", () => {
    const [outcome] = classifyEventCandidates({
      candidates: [candidate({ eventType: "SELL" })],
      existingFacts: [fact({ eventType: "BUY" })],
      existingIdentities: [],
      sourceKey: SOURCE,
      stableReferences: false,
    });
    expect(outcome.verdict).toBe("NEW");
  });
});

describe("déduplication de positions observées", () => {
  it("une observation déjà connue à cette date est un doublon EXACT", () => {
    // Une position est une observation datée : elle n'existe qu'une fois par date, donc
    // l'égalité du triplet PROUVE l'identité — seul cas du domaine.
    const [outcome] = classifyPositionCandidates({
      candidates: [
        { rowNumber: 2, accountId: ACCOUNT, securityId: "sec-air", asOfDate: "2026-06-30" },
      ],
      existing: [
        {
          snapshotId: "snap-1",
          accountId: ACCOUNT,
          securityId: "sec-air",
          asOfDate: "2026-06-30",
        },
      ],
    });
    expect(outcome.verdict).toBe("EXACT_DUPLICATE");
    expect(outcome.matchedEventId).toBe("snap-1");
  });

  it("refuse deux observations du même instrument à la même date dans un fichier", () => {
    const outcomes = classifyPositionCandidates({
      candidates: [
        { rowNumber: 2, accountId: ACCOUNT, securityId: "sec-air", asOfDate: "2026-06-30" },
        { rowNumber: 3, accountId: ACCOUNT, securityId: "sec-air", asOfDate: "2026-06-30" },
      ],
      existing: [],
    });
    expect(outcomes[1].verdict).toBe("EXACT_DUPLICATE");
    expect(outcomes[1].issues[0].severity).toBe("ERROR");
  });

  it("une observation à une NOUVELLE date est nouvelle : l'incrémental n'écrase rien", () => {
    const [outcome] = classifyPositionCandidates({
      candidates: [
        { rowNumber: 2, accountId: ACCOUNT, securityId: "sec-air", asOfDate: "2026-07-31" },
      ],
      existing: [
        {
          snapshotId: "snap-1",
          accountId: ACCOUNT,
          securityId: "sec-air",
          asOfDate: "2026-06-30",
        },
      ],
    });
    expect(outcome.verdict).toBe("NEW");
  });
});

describe("résolution d'instrument", () => {
  it("reconnaît un ISIN valide et refuse une chaîne qui n'en est pas un", () => {
    expect(foldIsin("FR0000120073")).toBe("FR0000120073");
    expect(foldIsin("fr0000120073")).toBe("FR0000120073");
    expect(foldIsin("PAS-UN-ISIN")).toBeNull();
    expect(foldIsin(null)).toBeNull();
  });

  it("privilégie l'ISIN, puis le ticker, puis le libellé", () => {
    expect(instrumentSourceKey({ isin: "FR0000120073", ticker: "AI", name: "Air" })).toBe(
      "ISIN:FR0000120073",
    );
    expect(instrumentSourceKey({ isin: null, ticker: "AI", name: "Air" })).toBe("TICKER:AI");
    expect(instrumentSourceKey({ isin: null, ticker: null, name: "Air Liquide" })).toBe(
      "NAME:AIR LIQUIDE",
    );
    expect(instrumentSourceKey({ isin: null, ticker: null, name: null })).toBeNull();
  });

  it("résout par ISIN sans réserve", () => {
    const [resolution] = resolveInstruments({
      keys: new Map([["ISIN:FR0000120073", { isin: "FR0000120073", ticker: null, name: null }]]),
      known: KNOWN,
    });
    expect(resolution.state).toBe("RESOLVED");
    expect(resolution.securityId).toBe("sec-air");
  });

  it("REFUSE de choisir quand deux instruments portent le même ticker", () => {
    const [resolution] = resolveInstruments({
      keys: new Map([["TICKER:ALP", { isin: null, ticker: "ALP", name: null }]]),
      known: KNOWN,
    });
    expect(resolution.state).toBe("AMBIGUOUS");
    expect(resolution.securityId).toBeNull();
    expect(resolution.candidates).toHaveLength(2);
  });

  it("signale qu'un rapprochement par ticker repose sur un identifiant faible", () => {
    const [resolution] = resolveInstruments({
      keys: new Map([["TICKER:AI", { isin: null, ticker: "AI", name: null }]]),
      known: KNOWN,
    });
    expect(resolution.state).toBe("RESOLVED");
    expect(resolution.issues.some((entry) => entry.message.includes("selon la place"))).toBe(true);
  });

  it("un ISIN inconnu reste NON RÉSOLU : il n'est pas créé d'office", () => {
    const [resolution] = resolveInstruments({
      keys: new Map([["ISIN:DE0007236101", { isin: "DE0007236101", ticker: null, name: null }]]),
      known: KNOWN,
    });
    expect(resolution.state).toBe("UNRESOLVED");
    expect(resolution.issues[0].message).toContain("PAS créé d'office");
  });

  it("une décision humaine l'emporte sur toute inférence", () => {
    const [resolution] = resolveInstruments({
      keys: new Map([["TICKER:ALP", { isin: null, ticker: "ALP", name: null }]]),
      known: KNOWN,
      decisions: new Map([["TICKER:ALP", "sec-dup-b"]]),
    });
    expect(resolution.state).toBe("RESOLVED");
    expect(resolution.securityId).toBe("sec-dup-b");
  });

  it("une décision d'écarter empêche l'écriture des lignes concernées", () => {
    const [resolution] = resolveInstruments({
      keys: new Map([["ISIN:FR0000120073", { isin: "FR0000120073", ticker: null, name: null }]]),
      known: KNOWN,
      decisions: new Map([["ISIN:FR0000120073", null]]),
    });
    expect(resolution.state).toBe("UNRESOLVED");
    expect(resolution.issues[0].severity).toBe("ERROR");
  });

  it("bloque la ligne dont l'instrument est ambigu, dans l'analyse complète", () => {
    const csv = [
      "Date;Type;Ticker;Quantité;Montant brut;Devise",
      "15/03/2026;Achat;ALP;10;1000,00;EUR",
    ].join("\n");
    const result = analyzePortfolioFile({
      bytes: csvBytes(csv),
      fileName: "ops.csv",
      kind: "PORTFOLIO_LEDGER",
      accountId: ACCOUNT,
      declaredCurrency: "EUR",
      known: KNOWN,
      sourceKey: SOURCE,
    });
    expect(result.ledgerRows[0].status).toBe("BLOCKED");
    expect(result.instruments[0].state).toBe("AMBIGUOUS");
  });

  it("bloque la ligne dont l'ISIN est inconnu du référentiel", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut;Devise",
      "15/03/2026;Achat;DE0007236101;10;1000,00;EUR",
    ].join("\n");
    const result = analyzePortfolioFile({
      bytes: csvBytes(csv),
      fileName: "ops.csv",
      kind: "PORTFOLIO_LEDGER",
      accountId: ACCOUNT,
      declaredCurrency: "EUR",
      known: KNOWN,
      sourceKey: SOURCE,
    });
    expect(result.ledgerRows[0].status).toBe("BLOCKED");
  });

  it("marque le doublon entre deux imports comme DUPLICATE dans l'analyse complète", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut;Devise",
      "15/03/2026;Achat;FR0000120073;10;1705,00;EUR",
    ].join("\n");
    const result = analyzePortfolioFile({
      bytes: csvBytes(csv),
      fileName: "ops.csv",
      kind: "PORTFOLIO_LEDGER",
      accountId: ACCOUNT,
      declaredCurrency: "EUR",
      known: KNOWN,
      sourceKey: SOURCE,
      existingEvents: [fact()],
    });
    expect(result.ledgerRows[0].status).toBe("DUPLICATE");
    expect(result.counts.duplicate).toBe(1);
  });

  it("un REJEU strictement identique ne produit aucune ligne à écrire", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut;Devise;Référence",
      "15/03/2026;Achat;FR0000120073;10;1705,00;EUR;ORD-1",
    ].join("\n");
    const result = analyzePortfolioFile({
      bytes: csvBytes(csv),
      fileName: "ops.csv",
      kind: "PORTFOLIO_LEDGER",
      accountId: ACCOUNT,
      declaredCurrency: "EUR",
      known: KNOWN,
      sourceKey: SOURCE,
      stableReferences: true,
      existingIdentities: [{ externalKey: eventExternalKeyOf(SOURCE, "ORD-1"), eventId: "evt-1" }],
    });
    expect(result.counts.ready).toBe(0);
    expect(result.counts.duplicate).toBe(1);
  });
});
