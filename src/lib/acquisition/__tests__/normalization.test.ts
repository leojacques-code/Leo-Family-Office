import { describe, expect, it } from "vitest";

import {
  amountEvidenceOf,
  decodeSourceBytes,
  isCalendarDate,
  labelFingerprintForm,
  normalizeLabel,
  parseAmountWithConvention,
  parseCurrencyCell,
  parseDateWithConvention,
  resolveAmountConvention,
  resolveDateConvention,
} from "@/lib/acquisition/normalization";
import { utf8, utf8Bom, windows1252 } from "@/lib/acquisition/__tests__/fixtures/bank-csv";

describe("décodage", () => {
  it("lit l'UTF-8 nu", () => {
    const decoded = decodeSourceBytes(utf8("PRÉLÈVEMENT"));
    expect(decoded.encoding).toBe("UTF_8");
    expect(decoded.text).toBe("PRÉLÈVEMENT");
    expect(decoded.issues).toHaveLength(0);
  });

  it("retire le BOM sans le laisser dans le premier en-tête", () => {
    const decoded = decodeSourceBytes(utf8Bom("Date;Montant"));
    expect(decoded.encoding).toBe("UTF_8_BOM");
    expect(decoded.text.startsWith("Date")).toBe(true);
  });

  it("se replie sur Windows-1252 et le SIGNALE", () => {
    const decoded = decodeSourceBytes(windows1252("PRÉLÈVEMENT"));
    expect(decoded.encoding).toBe("WINDOWS_1252");
    expect(decoded.text).toBe("PRÉLÈVEMENT");
    expect(decoded.issues.map((entry) => entry.code)).toContain("ENCODING_FALLBACK");
  });
});

describe("convention décimale", () => {
  it("reconnaît la virgule décimale française", () => {
    expect(amountEvidenceOf("-54,28")).toBe("DECIMAL_COMMA");
    expect(amountEvidenceOf("1 234,56")).toBe("DECIMAL_COMMA");
    expect(amountEvidenceOf("1.234.567,89")).toBe("DECIMAL_COMMA");
    expect(resolveAmountConvention(["-54,28", "1 234,56"])).toBe("DECIMAL_COMMA");
  });

  it("reconnaît le point décimal international", () => {
    expect(amountEvidenceOf("-3.20")).toBe("DECIMAL_POINT");
    expect(amountEvidenceOf("1,234.56")).toBe("DECIMAL_POINT");
    expect(resolveAmountConvention(["-3.20", "1,234.56"])).toBe("DECIMAL_POINT");
  });

  it("refuse de trancher « 1,234 » seul", () => {
    expect(amountEvidenceOf("1,234")).toBe("AMBIGUOUS");
    expect(resolveAmountConvention(["1,234", "2,500"])).toBe("AMBIGUOUS");
  });

  it("une colonne mêlant deux conventions reste ambiguë", () => {
    expect(resolveAmountConvention(["1 234,56", "1,234.56"])).toBe("AMBIGUOUS");
  });

  it("une colonne sans séparateur est entière", () => {
    expect(resolveAmountConvention(["-54", "1200"])).toBe("INTEGER");
  });

  it("une preuve suffit à lever l'ambiguïté des autres cellules", () => {
    const convention = resolveAmountConvention(["1,234", "-54,28"]);
    expect(convention).toBe("DECIMAL_COMMA");
    expect(parseAmountWithConvention("1,234", convention).value).toBeCloseTo(1.234, 6);
  });
});

describe("lecture des montants", () => {
  it("lit un montant signé, espaces insécables compris", () => {
    expect(parseAmountWithConvention("3 214,57", "DECIMAL_COMMA").value).toBe(3214.57);
    expect(parseAmountWithConvention(" 1 234,56 €", "DECIMAL_COMMA").value).toBe(1234.56);
  });

  it("traite les parenthèses et le signe suffixé comme des négatifs", () => {
    expect(parseAmountWithConvention("(54,28)", "DECIMAL_COMMA").value).toBe(-54.28);
    expect(parseAmountWithConvention("54,28-", "DECIMAL_COMMA").value).toBe(-54.28);
  });

  it("distingue une cellule VIDE d'une cellule ILLISIBLE", () => {
    expect(parseAmountWithConvention("   ", "DECIMAL_COMMA")).toEqual({
      value: null,
      code: "EMPTY",
    });
    expect(parseAmountWithConvention("abc", "DECIMAL_COMMA")).toEqual({
      value: null,
      code: "UNPARSEABLE",
    });
  });

  it("ne lit aucun montant sous une convention ambiguë", () => {
    expect(parseAmountWithConvention("1,234", "AMBIGUOUS")).toEqual({
      value: null,
      code: "AMBIGUOUS",
    });
  });

  it("préserve un zéro réellement transmis", () => {
    expect(parseAmountWithConvention("0,00", "DECIMAL_COMMA").value).toBe(0);
  });
});

describe("convention de date", () => {
  it("un jour supérieur à 12 tranche la colonne entière", () => {
    expect(resolveDateConvention(["13/08/2026", "03/04/2026"])).toBe("DAY_FIRST");
    expect(resolveDateConvention(["08/13/2026", "04/03/2026"])).toBe("MONTH_FIRST");
  });

  it("une colonne entièrement sous 13 reste ambiguë", () => {
    expect(resolveDateConvention(["03/04/2026", "05/06/2026"])).toBe("AMBIGUOUS");
  });

  it("deux preuves contradictoires rendent la colonne ambiguë", () => {
    expect(resolveDateConvention(["13/08/2026", "08/13/2026"])).toBe("AMBIGUOUS");
  });

  it("une colonne ISO ne demande aucune convention", () => {
    expect(resolveDateConvention(["2026-08-13"])).toBe("ISO");
  });
});

describe("lecture des dates", () => {
  it("lit une date ISO et une date jour/mois", () => {
    expect(parseDateWithConvention("2026-08-13", "ISO").value).toBe("2026-08-13");
    expect(parseDateWithConvention("13/08/2026", "DAY_FIRST").value).toBe("2026-08-13");
    expect(parseDateWithConvention("08/13/2026", "MONTH_FIRST").value).toBe("2026-08-13");
  });

  it("refuse une date qui n'existe pas au calendrier", () => {
    expect(parseDateWithConvention("31/02/2026", "DAY_FIRST").code).toBe("NOT_A_CALENDAR_DATE");
    expect(isCalendarDate(2026, 2, 31)).toBe(false);
    expect(isCalendarDate(2024, 2, 29)).toBe(true);
  });

  it("ignore l'heure accolée à une date", () => {
    expect(parseDateWithConvention("13/08/2026 14:32", "DAY_FIRST").value).toBe("2026-08-13");
    expect(parseDateWithConvention("2026-08-13T09:00:00Z", "ISO").value).toBe("2026-08-13");
  });

  it("signale une année sur deux chiffres au lieu de la taire", () => {
    const parsed = parseDateWithConvention("13/08/26", "DAY_FIRST");
    expect(parsed.value).toBe("2026-08-13");
    expect(parsed.twoDigitYear).toBe(true);
  });

  it("ne lit aucune date sous une convention ambiguë", () => {
    expect(parseDateWithConvention("03/04/2026", "AMBIGUOUS").code).toBe("AMBIGUOUS");
  });
});

describe("libellés et devises", () => {
  it("normalise les espaces sans altérer le contenu", () => {
    expect(normalizeLabel("  CARTE   1208   AMAZON EU ")).toBe("CARTE 1208 AMAZON EU");
    expect(normalizeLabel("   ")).toBeNull();
  });

  it("l'empreinte de libellé ignore accents et ponctuation, pas les mots", () => {
    expect(labelFingerprintForm("Prélèvement N°42")).toBe("PRELEVEMENT N 42");
    expect(labelFingerprintForm("PRELEVEMENT N 42")).toBe(labelFingerprintForm("Prélèvement N°42"));
    expect(labelFingerprintForm("AMAZON")).not.toBe(labelFingerprintForm("APPLE"));
  });

  it("accepte un code ISO ou un symbole, refuse le reste", () => {
    expect(parseCurrencyCell("eur")).toEqual({ value: "EUR", code: "OK" });
    expect(parseCurrencyCell("€")).toEqual({ value: "EUR", code: "OK" });
    expect(parseCurrencyCell("EURO")).toEqual({ value: null, code: "UNKNOWN" });
    expect(parseCurrencyCell("")).toEqual({ value: null, code: "EMPTY" });
  });
});
