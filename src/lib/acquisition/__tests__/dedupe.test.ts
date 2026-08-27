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
    label: "COFFEE SHOP",
    amount: -3.2,
    currency: "EUR",
    externalTransactionId: null,
    ...partial,
  };
}

function existing(
  partial: Partial<ExistingTransactionFact> & { id: string },
): ExistingTransactionFact {
  return {
    accountId: ACCOUNT,
    date: "2026-08-13",
    label: "COFFEE SHOP",
    amount: -3.2,
    currency: "EUR",
    externalKey: null,
    ...partial,
  };
}

function verdicts(
  candidates: DedupeCandidate[],
  existingFacts: ExistingTransactionFact[] = [],
  stableIdentifiers = false,
): string[] {
  return classifyCandidates({
    candidates,
    existing: existingFacts,
    sourceKey: SOURCE,
    stableIdentifiers,
  }).map((outcome) => outcome.verdict);
}

describe("une égalité de tuple ne démontre pas une identité", () => {
  it("A — un relevé partiel contenant un troisième achat identique n'est PAS un doublon exact", () => {
    // Deux cafés réels déjà connus. Le fichier partiel n'en contient qu'un : rien ne dit
    // s'il s'agit d'un des deux ou d'un troisième. Le supprimer serait perdre une dépense.
    const outcomes = classifyCandidates({
      candidates: [candidate({ rowNumber: 2 })],
      existing: [existing({ id: "t1" }), existing({ id: "t2" })],
      sourceKey: SOURCE,
      stableIdentifiers: false,
    });
    expect(outcomes[0].verdict).toBe("PROBABLE_DUPLICATE");
    expect(outcomes[0].verdict).not.toBe("EXACT_DUPLICATE");
    expect(outcomes[0].issues.map((entry) => entry.code)).toContain("MATCH_WITHOUT_STABLE_ID");
    // Signalée, donc écrivable sur décision : la ligne n'est jamais perdue en silence.
    expect(outcomes[0].issues.every((entry) => entry.severity === "WARNING")).toBe(true);
  });

  it("C — un recouvrement rapproche les lignes communes sans éliminer d'occurrence supplémentaire", () => {
    // Trois lignes identiques face à deux opérations connues : les deux premières se
    // rapprochent, la troisième reste nouvelle car aucune opération connue ne l'explique.
    expect(
      verdicts(
        [candidate({ rowNumber: 2 }), candidate({ rowNumber: 3 }), candidate({ rowNumber: 4 })],
        [existing({ id: "t1" }), existing({ id: "t2" })],
      ),
    ).toEqual(["PROBABLE_DUPLICATE", "PROBABLE_DUPLICATE", "NEW"]);
  });

  it("D — trois paiements identiques le même jour restent trois transactions possibles", () => {
    expect(
      verdicts([
        candidate({ rowNumber: 2 }),
        candidate({ rowNumber: 3 }),
        candidate({ rowNumber: 4 }),
      ]),
    ).toEqual(["NEW", "NEW", "NEW"]);
  });

  it("E — une saisie manuelle identique devient un rapprochement conservateur, pas une disparition", () => {
    const manual = existing({ id: "manuelle", externalKey: null });
    const outcomes = classifyCandidates({
      candidates: [candidate({ rowNumber: 2 })],
      existing: [manual],
      sourceKey: SOURCE,
      stableIdentifiers: false,
    });
    expect(outcomes[0].verdict).toBe("PROBABLE_DUPLICATE");
    expect(outcomes[0].matchedTransactionId).toBe("manuelle");
  });

  it("chaque opération connue n'est revendiquée qu'une fois", () => {
    expect(
      verdicts(
        [candidate({ rowNumber: 2 }), candidate({ rowNumber: 3 })],
        [existing({ id: "t1" })],
      ),
    ).toEqual(["PROBABLE_DUPLICATE", "NEW"]);
  });

  it("un compte ou une devise différents ne sont jamais le même flux", () => {
    expect(
      verdicts([candidate({ rowNumber: 2, accountId: OTHER_ACCOUNT })], [existing({ id: "t1" })]),
    ).toEqual(["NEW"]);
    expect(
      verdicts([candidate({ rowNumber: 2, currency: "USD" })], [existing({ id: "t1" })]),
    ).toEqual(["NEW"]);
  });

  it("la clé de rapprochement est lisible et ne prétend pas être une identité", () => {
    const outcomes = classifyCandidates({
      candidates: [candidate({ rowNumber: 2 }), candidate({ rowNumber: 3 })],
      existing: [],
      sourceKey: SOURCE,
      stableIdentifiers: false,
    });
    expect(outcomes[0].matchKey).toContain("COFFEE SHOP");
    expect(outcomes[0].matchKey).not.toBe(outcomes[1].matchKey);
    // Aucune identité n'est produite sans identifiant stable déclaré.
    expect(outcomes.every((outcome) => outcome.externalKey === null)).toBe(true);
  });
});

describe("identifiant stable — seulement quand la stabilité est déclarée", () => {
  it("sans déclaration, une référence ne décide JAMAIS d'une identité", () => {
    const already = existing({ id: "t1", externalKey: externalKeyOf(SOURCE, "REF-42") });
    const outcomes = classifyCandidates({
      candidates: [candidate({ rowNumber: 2, externalTransactionId: "REF-42", amount: -19.99 })],
      existing: [already],
      sourceKey: SOURCE,
      stableIdentifiers: false,
    });
    expect(outcomes[0].verdict).toBe("NEW");
    expect(outcomes[0].externalKey).toBeNull();
  });

  it("avec déclaration, un identifiant déjà vu écarte la ligne", () => {
    const already = existing({ id: "t1", externalKey: externalKeyOf(SOURCE, "TX-0001") });
    const outcomes = classifyCandidates({
      candidates: [candidate({ rowNumber: 2, externalTransactionId: "TX-0001" })],
      existing: [already],
      sourceKey: SOURCE,
      stableIdentifiers: true,
    });
    expect(outcomes[0].verdict).toBe("EXACT_DUPLICATE");
    expect(outcomes[0].matchedTransactionId).toBe("t1");
  });

  it("avec déclaration, deux identifiants distincts restent deux opérations", () => {
    expect(
      verdicts(
        [
          candidate({ rowNumber: 2, externalTransactionId: "TX-0001" }),
          candidate({ rowNumber: 3, externalTransactionId: "TX-0002" }),
        ],
        [],
        true,
      ),
    ).toEqual(["NEW", "NEW"]);
  });

  it("un identifiant stable répété dans le même fichier ne peut pas désigner deux opérations", () => {
    const outcomes = classifyCandidates({
      candidates: [
        candidate({ rowNumber: 2, externalTransactionId: "TX-0001" }),
        candidate({ rowNumber: 3, externalTransactionId: "TX-0001", amount: -12 }),
      ],
      existing: [],
      sourceKey: SOURCE,
      stableIdentifiers: true,
    });
    expect(outcomes.map((outcome) => outcome.verdict)).toEqual(["NEW", "EXACT_DUPLICATE"]);
  });

  it("la même chaîne d'identifiant dans deux sources distinctes n'entre pas en collision", () => {
    const already = existing({ id: "t1", externalKey: externalKeyOf("autre-source", "TX-0001") });
    expect(
      verdicts([candidate({ rowNumber: 2, externalTransactionId: "TX-0001" })], [already], true),
    ).toEqual(["NEW"]);
  });

  it("une référence descriptive répétée chaque mois reste plusieurs opérations valides", () => {
    // Sans déclaration de stabilité, le motif « LOYER » revient tous les mois sans jamais
    // faire disparaître une échéance.
    const monthly = [
      candidate({
        rowNumber: 2,
        date: "2026-06-05",
        label: "LOYER",
        amount: -950,
        externalTransactionId: "LOYER",
      }),
      candidate({
        rowNumber: 3,
        date: "2026-07-05",
        label: "LOYER",
        amount: -950,
        externalTransactionId: "LOYER",
      }),
      candidate({
        rowNumber: 4,
        date: "2026-08-05",
        label: "LOYER",
        amount: -950,
        externalTransactionId: "LOYER",
      }),
    ];
    expect(verdicts(monthly)).toEqual(["NEW", "NEW", "NEW"]);
  });
});

describe("ressemblances de second ordre", () => {
  it("même montant et même libellé à deux jours d'écart : doublon PROBABLE", () => {
    const outcomes = classifyCandidates({
      candidates: [candidate({ rowNumber: 2, date: "2026-08-15" })],
      existing: [existing({ id: "t1", date: "2026-08-13" })],
      sourceKey: SOURCE,
      stableIdentifiers: false,
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

  it("même date et même montant sous un libellé différent : rapprochement possible", () => {
    expect(
      verdicts([candidate({ rowNumber: 2, label: "LIBRAIRIE" })], [existing({ id: "t1" })]),
    ).toEqual(["POSSIBLE_MATCH"]);
  });

  it("l'accent et la ponctuation du libellé ne créent pas un faux nouveau flux", () => {
    expect(
      verdicts(
        [candidate({ rowNumber: 2, label: "Prélèvement N°42" })],
        [existing({ id: "t1", label: "PRELEVEMENT N 42" })],
      ),
    ).toEqual(["PROBABLE_DUPLICATE"]);
  });
});
