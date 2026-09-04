/**
 * VALIDATION DE LA DÉCISION DE CORRECTION D'UNE OBSERVATION DE POSITION
 *
 * Ces cas viennent d'un finding de revue. Le contrat précédent n'exigeait qu'un tableau
 * d'identifiants pour autoriser le remplacement d'une observation persistée : un
 * CONSENTEMENT ANONYME, qui ne disait ni pourquoi, ni par qui, ni sur la foi de quel état
 * courant — et qui ne conservait rien de la valeur remplacée.
 *
 * La base est l'autorité, et le smoke PostgreSQL l'éprouve. Ce fichier vérifie que la porte
 * HTTP refuse AVANT d'atteindre la base : un motif blanc n'a pas besoin d'un aller-retour
 * réseau pour être reconnu comme vide.
 */
import { describe, expect, it } from "vitest";

import { portfolioImportCommandSchema } from "@/lib/validation/portfolio-imports";

const SESSION = "11111111-1111-4111-8111-111111111111";
const RECORD = "22222222-2222-4222-8222-222222222222";
const OTHER_RECORD = "33333333-3333-4333-8333-333333333333";
const SNAPSHOT = "44444444-4444-4444-8444-444444444444";

function expected(overrides: Record<string, unknown> = {}) {
  return {
    snapshotId: SNAPSHOT,
    quantity: "10.0000000000",
    costBasis: null,
    marketValue: "1810.000000",
    currency: "EUR",
    ...overrides,
  };
}

function commit(corrections: unknown) {
  return portfolioImportCommandSchema.safeParse({
    action: "commit",
    sessionId: SESSION,
    recordIds: [RECORD],
    corrections,
  });
}

describe("validation d'un commit de portefeuille", () => {
  it("accepte un commit SANS décision : c'est le défaut, et il refuse tout remplacement", () => {
    const parsed = portfolioImportCommandSchema.safeParse({
      action: "commit",
      sessionId: SESSION,
      recordIds: [RECORD],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.action === "commit") {
      expect(parsed.data.corrections).toEqual([]);
    }
  });

  it("accepte une décision complète, et conserve le motif tel quel après trim", () => {
    const parsed = commit([
      { recordId: RECORD, reason: "  Relevé provisoire  ", expected: expected() },
    ]);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.action === "commit") {
      expect(parsed.data.corrections[0].reason).toBe("Relevé provisoire");
      // L'état attendu repart VERBATIM : le reformater fabriquerait un conflit, ou en
      // masquerait un.
      expect(parsed.data.corrections[0].expected.marketValue).toBe("1810.000000");
      expect(parsed.data.corrections[0].expected.costBasis).toBeNull();
    }
  });
});

describe("motif d'une correction", () => {
  it("REFUSE un motif blanc, quelle que soit la forme du blanc", () => {
    // C'est le cas qui a fait tomber la première version de la contrainte SQL : le `btrim`
    // de PostgreSQL ne retire par défaut que les ESPACES, et une tabulation seule passait.
    for (const reason of ["", " ", "   ", "\t", "\n", "\t\n ", " "]) {
      const parsed = commit([{ recordId: RECORD, reason, expected: expected() }]);
      expect(parsed.success, `motif ${JSON.stringify(reason)} accepté`).toBe(false);
    }
  });

  it("REFUSE un motif absent", () => {
    expect(commit([{ recordId: RECORD, expected: expected() }]).success).toBe(false);
  });

  it("borne la longueur du motif : un roman n'est pas un motif", () => {
    expect(
      commit([{ recordId: RECORD, reason: "x".repeat(2_001), expected: expected() }]).success,
    ).toBe(false);
  });
});

describe("état attendu", () => {
  it("est OBLIGATOIRE : sans lui, une seconde décision écraserait la première", () => {
    expect(commit([{ recordId: RECORD, reason: "motif" }]).success).toBe(false);
  });

  it("exige l'observation VISÉE, et pas seulement des valeurs", () => {
    expect(
      commit([
        {
          recordId: RECORD,
          reason: "motif",
          expected: { quantity: "10", costBasis: null, marketValue: "1810", currency: "EUR" },
        },
      ]).success,
    ).toBe(false);
  });

  it("accepte un montant ABSENT comme `null`, jamais comme chaîne vide", () => {
    // NULL ≠ ZERO, et NULL ≠ « ». Une quantité absente est une information ; une chaîne vide
    // est une valeur illisible que la base casterait en erreur.
    expect(
      commit([{ recordId: RECORD, reason: "m", expected: expected({ quantity: null }) }]).success,
    ).toBe(true);
    expect(
      commit([{ recordId: RECORD, reason: "m", expected: expected({ quantity: undefined }) }])
        .success,
    ).toBe(false);
  });

  it("exige une devise de TROIS caractères : une devise absente rend le total non calculable", () => {
    for (const currency of ["", "EU", "EURO"]) {
      expect(
        commit([{ recordId: RECORD, reason: "m", expected: expected({ currency }) }]).success,
        `devise ${JSON.stringify(currency)} acceptée`,
      ).toBe(false);
    }
  });

  it("borne la longueur d'un montant : un `numeric(30,10)` tient dans 60 caractères", () => {
    expect(
      commit([{ recordId: RECORD, reason: "m", expected: expected({ quantity: "1".repeat(61) }) }])
        .success,
    ).toBe(false);
  });
});

describe("forme de la décision", () => {
  it("REFUSE l'ancien contrat : un tableau nu d'identifiants n'est pas une décision", () => {
    expect(commit([RECORD]).success).toBe(false);
  });

  it("REFUSE deux décisions pour la même ligne : le motif conservé serait indéterminé", () => {
    const parsed = commit([
      { recordId: RECORD, reason: "premier motif", expected: expected() },
      { recordId: RECORD, reason: "second motif", expected: expected() },
    ]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain("indéterminé");
    }
  });

  it("accepte deux décisions sur DEUX lignes distinctes", () => {
    expect(
      commit([
        { recordId: RECORD, reason: "motif A", expected: expected() },
        { recordId: OTHER_RECORD, reason: "motif B", expected: expected() },
      ]).success,
    ).toBe(true);
  });

  it("accepte une identité déclarée, et s'en passe : « on ne sait pas qui » est une information", () => {
    const withIdentity = commit([
      { recordId: RECORD, reason: "m", decidedBy: "willy", expected: expected() },
    ]);
    expect(withIdentity.success).toBe(true);
    if (withIdentity.success && withIdentity.data.action === "commit") {
      expect(withIdentity.data.corrections[0].decidedBy).toBe("willy");
    }
    const withoutIdentity = commit([{ recordId: RECORD, reason: "m", expected: expected() }]);
    expect(withoutIdentity.success).toBe(true);
    if (withoutIdentity.success && withoutIdentity.data.action === "commit") {
      expect(withoutIdentity.data.corrections[0].decidedBy).toBeUndefined();
    }
  });

  it("REFUSE une identité déclarée BLANCHE : la déclarer vide n'est pas ne pas la déclarer", () => {
    expect(
      commit([{ recordId: RECORD, reason: "m", decidedBy: "   ", expected: expected() }]).success,
    ).toBe(false);
  });

  it("REFUSE un identifiant de ligne qui n'est pas un UUID", () => {
    expect(commit([{ recordId: "ligne-3", reason: "m", expected: expected() }]).success).toBe(
      false,
    );
  });
});
