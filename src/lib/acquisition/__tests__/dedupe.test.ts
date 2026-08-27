import { describe, expect, it } from "vitest";

import { classifyCandidates, externalKeyOf, type DedupeCandidate } from "@/lib/acquisition/dedupe";
import type { ExistingTransactionFact } from "@/lib/acquisition/types";

const ACCOUNT = "account-1";
const OTHER_ACCOUNT = "account-2";
const SOURCE = "source-1";

function candidate(partial: Partial<DedupeCandidate> & { rowNumber: number }): DedupeCandidate {
  return {
    accountId: ACCOUNT,
    date: "2026-08-13",
    label: "CARTE 1208 AMAZON EU",
    amount: -54.28,
    currency: "EUR",
    externalReference: null,
    ...partial,
  };
}

function existing(
  partial: Partial<ExistingTransactionFact> & { id: string },
): ExistingTransactionFact {
  return {
    accountId: ACCOUNT,
    date: "2026-08-13",
    label: "CARTE 1208 AMAZON EU",
    amount: -54.28,
    currency: "EUR",
    externalKey: null,
    ...partial,
  };
}

function verdicts(
  candidates: DedupeCandidate[],
  existingFacts: ExistingTransactionFact[] = [],
): string[] {
  return classifyCandidates({
    candidates,
    existing: existingFacts,
    sourceKey: SOURCE,
  }).map((outcome) => outcome.verdict);
}

describe("identifiant stable de la source", () => {
  it("tranche seul, dans les deux sens", () => {
    const already = existing({ id: "t1", externalKey: externalKeyOf(SOURCE, "TX-0001") });
    const outcomes = classifyCandidates({
      candidates: [
        candidate({ rowNumber: 2, externalReference: "TX-0001" }),
        candidate({ rowNumber: 3, externalReference: "TX-0002", amount: -3.2 }),
      ],
      existing: [already],
      sourceKey: SOURCE,
    });
    expect(outcomes[0].verdict).toBe("EXACT_DUPLICATE");
    expect(outcomes[0].matchedTransactionId).toBe("t1");
    expect(outcomes[1].verdict).toBe("NEW");
  });

  it("qualifie la clé externe par sa source : deux banques peuvent partager une référence", () => {
    const already = existing({ id: "t1", externalKey: externalKeyOf("autre-source", "TX-0001") });
    expect(
      verdicts([candidate({ rowNumber: 2, externalReference: "TX-0001" })], [already]),
    ).toEqual(["NEW"]);
  });
});

describe("empreinte déterministe et rang d'occurrence", () => {
  it("un doublon strict est reconnu", () => {
    expect(verdicts([candidate({ rowNumber: 2 })], [existing({ id: "t1" })])).toEqual([
      "EXACT_DUPLICATE",
    ]);
  });

  it("deux opérations réellement identiques ne se réduisent pas à une", () => {
    expect(verdicts([candidate({ rowNumber: 2 }), candidate({ rowNumber: 3 })])).toEqual([
      "NEW",
      "NEW",
    ]);
  });

  it("recouvrement partiel : la ligne déjà écrite est un doublon, la seconde est nouvelle", () => {
    expect(
      verdicts(
        [candidate({ rowNumber: 2 }), candidate({ rowNumber: 3 })],
        [existing({ id: "t1" })],
      ),
    ).toEqual(["EXACT_DUPLICATE", "NEW"]);
  });

  it("un réimport complet ne produit plus aucune nouveauté", () => {
    expect(
      verdicts(
        [candidate({ rowNumber: 2 }), candidate({ rowNumber: 3 })],
        [existing({ id: "t1" }), existing({ id: "t2" })],
      ),
    ).toEqual(["EXACT_DUPLICATE", "EXACT_DUPLICATE"]);
  });

  it("les rangs d'occurrence sont distincts et lisibles", () => {
    const outcomes = classifyCandidates({
      candidates: [candidate({ rowNumber: 2 }), candidate({ rowNumber: 3 })],
      existing: [],
      sourceKey: SOURCE,
    });
    expect(outcomes[0].fingerprint).toContain("|#1");
    expect(outcomes[1].fingerprint).toContain("|#2");
    expect(outcomes[0].fingerprint).not.toBe(outcomes[1].fingerprint);
  });

  it("même date et même montant sous un libellé différent : deux opérations distinctes", () => {
    expect(
      verdicts(
        [candidate({ rowNumber: 2, label: "CARTE 1208 LIBRAIRIE" })],
        [existing({ id: "t1" })],
      ),
    ).toEqual(["POSSIBLE_MATCH"]);
  });

  it("un compte différent n'est jamais le même flux", () => {
    expect(
      verdicts([candidate({ rowNumber: 2, accountId: OTHER_ACCOUNT })], [existing({ id: "t1" })]),
    ).toEqual(["NEW"]);
  });

  it("une devise différente n'est jamais le même flux", () => {
    expect(
      verdicts([candidate({ rowNumber: 2, currency: "USD" })], [existing({ id: "t1" })]),
    ).toEqual(["NEW"]);
  });
});

describe("ressemblances", () => {
  it("même montant et même libellé à deux jours d'écart : doublon PROBABLE, pas certain", () => {
    const outcomes = classifyCandidates({
      candidates: [candidate({ rowNumber: 2, date: "2026-08-15" })],
      existing: [existing({ id: "t1", date: "2026-08-13" })],
      sourceKey: SOURCE,
    });
    expect(outcomes[0].verdict).toBe("PROBABLE_DUPLICATE");
    expect(outcomes[0].issues.map((entry) => entry.code)).toContain("DUPLICATE_PROBABLE");
  });

  it("au-delà de la fenêtre, c'est une opération nouvelle", () => {
    expect(
      verdicts(
        [candidate({ rowNumber: 2, date: "2026-09-13" })],
        [existing({ id: "t1", date: "2026-08-13" })],
      ),
    ).toEqual(["NEW"]);
  });

  it("une même transaction existante n'est revendiquée qu'une fois", () => {
    const outcomes = verdicts(
      [
        candidate({ rowNumber: 2, date: "2026-08-14" }),
        candidate({ rowNumber: 3, date: "2026-08-15" }),
      ],
      [existing({ id: "t1", date: "2026-08-13" })],
    );
    expect(outcomes).toEqual(["PROBABLE_DUPLICATE", "NEW"]);
  });

  it("l'empreinte ignore accents et ponctuation du libellé", () => {
    expect(
      verdicts(
        [candidate({ rowNumber: 2, label: "Prélèvement N°42" })],
        [existing({ id: "t1", label: "PRELEVEMENT N 42" })],
      ),
    ).toEqual(["EXACT_DUPLICATE"]);
  });
});
