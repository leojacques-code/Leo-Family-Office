import { describe, expect, it } from "vitest";

import {
  detectDateConvention,
  detectNumberConvention,
  isConventionSensitive,
  looksNumeric,
  readAmount,
  readFrenchDate,
} from "@/lib/acquisition/documents/numbers";

describe("forme d'un montant", () => {
  it("distingue un montant d'un libellé", () => {
    expect(looksNumeric("1 234")).toBe(true);
    expect(looksNumeric("(1 234)")).toBe(true);
    expect(looksNumeric("1 234-")).toBe(true);
    expect(looksNumeric("AB")).toBe(false);
    expect(looksNumeric("2050-SD")).toBe(false);
    expect(looksNumeric("31/12/2025")).toBe(false);
    expect(looksNumeric("")).toBe(false);
    expect(looksNumeric("néant")).toBe(false);
  });
});

describe("détection de la convention décimale", () => {
  it("tranche sur une virgule décimale", () => {
    expect(detectNumberConvention(["1 234,56"])).toBe("FRENCH");
  });

  it("tranche sur un point décimal", () => {
    expect(detectNumberConvention(["1,234.56"])).toBe("ENGLISH");
    expect(detectNumberConvention(["2 345.67"])).toBe("ENGLISH");
  });

  it("reste indécise quand rien ne tranche", () => {
    // « 1 234 » vaut la même chose dans les deux conventions : il ne tranche rien.
    expect(detectNumberConvention(["1 234", "5 000"])).toBe("UNDECIDED");
    // « 1,234 » est précisément le cas dangereux : il ne tranche rien non plus.
    expect(detectNumberConvention(["1,234"])).toBe("UNDECIDED");
  });

  it("déclare l'ambiguïté quand deux valeurs se contredisent", () => {
    expect(detectNumberConvention(["1 234,56", "2 345.67"])).toBe("AMBIGUOUS");
  });
});

describe("sensibilité d'une valeur à la convention", () => {
  it("ne l'est pas quand l'espace sépare les milliers", () => {
    expect(isConventionSensitive("1 234")).toBe(false);
    expect(isConventionSensitive("470 000")).toBe(false);
  });

  it("l'est dès qu'un séparateur peut être lu deux fois", () => {
    expect(isConventionSensitive("1,234")).toBe(true);
    expect(isConventionSensitive("1.234")).toBe(true);
  });
});

describe("lecture d'un montant", () => {
  it("lit les séparateurs français, insécables comprises", () => {
    expect(readAmount("1 234,56", "FRENCH").value).toBeCloseTo(1234.56, 6);
    expect(readAmount("1 234 567", "FRENCH").value).toBe(1234567);
  });

  it("reconnaît les trois écritures d'un montant négatif", () => {
    expect(readAmount("(1 234)", "FRENCH").value).toBe(-1234);
    expect(readAmount("-1 234", "FRENCH").value).toBe(-1234);
    // Le tiret suffixé existe sur des états financiers réels : l'ignorer transformerait une
    // perte en gain.
    expect(readAmount("1 234-", "FRENCH").value).toBe(-1234);
  });

  it("BLOQUE une valeur ambiguë sous convention contradictoire, sans arbitrer", () => {
    const reading = readAmount("3,456", "AMBIGUOUS");
    expect(reading.value).toBeNull();
    expect(reading.conventionSensitive).toBe(true);
    expect(reading.raw).toBe("3,456");
  });

  it("lit une valeur NON ambiguë malgré une convention contradictoire", () => {
    expect(readAmount("5 000", "AMBIGUOUS").value).toBe(5000);
  });

  it("distingue zéro d'une absence", () => {
    expect(readAmount("0", "FRENCH").value).toBe(0);
    expect(readAmount("", "FRENCH").value).toBeNull();
    expect(readAmount("néant", "FRENCH").value).toBeNull();
  });

  it("retient la convention française quand rien ne tranche", () => {
    // Le formulaire est français : c'est une DÉCLARATION, signalée par l'appelant.
    expect(readAmount("1 234,56", "UNDECIDED").value).toBeCloseTo(1234.56, 6);
  });
});

describe("détection de l'ordre jour/mois", () => {
  it("tranche dès qu'un nombre dépasse douze", () => {
    expect(detectDateConvention(["31/12/2025"])).toBe("DAY_FIRST");
    expect(detectDateConvention(["12/31/2025"])).toBe("MONTH_FIRST");
  });

  it("reste indécise sur des dates toutes ambiguës", () => {
    expect(detectDateConvention(["03/04/2025"])).toBe("UNDECIDED");
  });

  it("déclare l'ambiguïté quand le document se contredit", () => {
    expect(detectDateConvention(["31/12/2025", "12/31/2025"])).toBe("AMBIGUOUS");
  });
});

describe("lecture d'une date", () => {
  it("lit une date française", () => {
    expect(readFrenchDate("31/12/2025", "DAY_FIRST").iso).toBe("2025-12-31");
  });

  it("refuse une date qui n'existe pas au calendrier", () => {
    expect(readFrenchDate("31/02/2025", "DAY_FIRST").iso).toBeNull();
  });

  it("ne retient AUCUNE date ambiguë sous convention contradictoire", () => {
    const reading = readFrenchDate("03/04/2025", "AMBIGUOUS");
    expect(reading.iso).toBeNull();
    expect(reading.ambiguous).toBe(true);
  });

  it("lit une date non ambiguë même sous convention contradictoire", () => {
    expect(readFrenchDate("31/12/2025", "AMBIGUOUS").iso).toBe("2025-12-31");
  });

  it("refuse une paire de nombres qui n'est une date sous aucune convention", () => {
    expect(readFrenchDate("45/46/2025", "DAY_FIRST").iso).toBeNull();
  });
});
