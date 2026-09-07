import { describe, expect, it } from "vitest";
import {
  formatNumberForInput,
  formatPercentForInput,
  isRealCalendarDate,
  parseDateInput,
  parseNumberInput,
  parsePercentInput,
} from "@/lib/presentation/input-parse";

describe("parseNumberInput : le vide n’est jamais zéro", () => {
  it("rend EMPTY sur une chaîne vide, et surtout PAS zéro", () => {
    // C'est LE défaut que la phase 0 corrige. `Number("")` valait `0`, donc effacer un
    // montant le déclarait à zéro.
    expect(parseNumberInput("")).toEqual({ state: "EMPTY", value: null });
    expect(parseNumberInput("   ")).toEqual({ state: "EMPTY", value: null });
  });

  it("rend un zéro DÉCLARÉ quand l’utilisateur écrit zéro", () => {
    // ZÉRO DÉCLARÉ ≠ VIDE. Une charge d'exploitation déclarée à zéro est une information ;
    // une charge non déclarée n'en est pas une. Le type permet de les distinguer.
    expect(parseNumberInput("0")).toEqual({ state: "VALID", value: 0 });
    expect(parseNumberInput("0,00")).toEqual({ state: "VALID", value: 0 });
  });
});

describe("parseNumberInput : lectures acceptées", () => {
  it("lit la virgule décimale française", () => {
    expect(parseNumberInput("16745,25")).toEqual({ state: "VALID", value: 16745.25 });
  });

  it("lit le point décimal", () => {
    expect(parseNumberInput("16745.25")).toEqual({ state: "VALID", value: 16745.25 });
  });

  it("lit les séparateurs de milliers, y compris insécables", () => {
    // `Number("16 745,25")` rendait `NaN` : un montant collé depuis un relevé était illisible.
    expect(parseNumberInput("16 745,25")).toEqual({ state: "VALID", value: 16745.25 });
    expect(parseNumberInput("16 745,25")).toEqual({ state: "VALID", value: 16745.25 });
    expect(parseNumberInput("16 745,25")).toEqual({ state: "VALID", value: 16745.25 });
    expect(parseNumberInput("16'745,25")).toEqual({ state: "VALID", value: 16745.25 });
  });

  it("lit un séparateur décimal FINAL comme la partie entière déjà déclarée", () => {
    // L'utilisateur a tapé « 1, » et n'a pas encore tapé la décimale. Il a déclaré 1, et le
    // lire ainsi n'invente aucun chiffre. Le refuser ferait clignoter le champ en erreur à
    // chaque frappe de virgule.
    expect(parseNumberInput("1,")).toEqual({ state: "VALID", value: 1 });
    expect(parseNumberInput("1.")).toEqual({ state: "VALID", value: 1 });
  });

  it("lit un séparateur décimal INITIAL", () => {
    expect(parseNumberInput(",5")).toEqual({ state: "VALID", value: 0.5 });
  });

  it("lit les deux formes du signe moins", () => {
    expect(parseNumberInput("-1234,5")).toEqual({ state: "VALID", value: -1234.5 });
    // Signe moins typographique U+2212, celui que produit un copier-coller de document.
    expect(parseNumberInput("−1234,5")).toEqual({ state: "VALID", value: -1234.5 });
  });

  it("ne produit jamais de zéro négatif", () => {
    // `-0` rendrait « −0 € » à l'affichage, ce qui n'est pas un montant.
    const draft = parseNumberInput("-0");
    expect(draft).toEqual({ state: "VALID", value: 0 });
    expect(Object.is(draft.value, -0)).toBe(false);
  });
});

describe("parseNumberInput : refus explicites", () => {
  it("refuse une saisie sans aucun chiffre", () => {
    expect(parseNumberInput("-")).toEqual({
      state: "INVALID",
      value: null,
      reason: "NO_DIGIT",
    });
    expect(parseNumberInput(",")).toEqual({
      state: "INVALID",
      value: null,
      reason: "NO_DIGIT",
    });
  });

  it("refuse deux séparateurs décimaux", () => {
    // Cas réel d'une convention ambiguë : « 1,5,3 » ne se tranche pas, il se refuse.
    expect(parseNumberInput("1,5,3").state).toBe("INVALID");
    expect(parseNumberInput("1,5,3")).toEqual({
      state: "INVALID",
      value: null,
      reason: "MULTIPLE_DECIMAL_SEPARATORS",
    });
  });

  it("refuse la notation exponentielle", () => {
    // `Number("1e5")` vaut 100000. Un montant ne s'écrit pas ainsi, et l'accepter ferait
    // passer une frappe accidentelle pour une déclaration de cent mille euros.
    expect(parseNumberInput("1e5")).toEqual({
      state: "INVALID",
      value: null,
      reason: "EXPONENT_NOTATION",
    });
  });

  it("refuse un signe mal placé", () => {
    expect(parseNumberInput("1-2")).toEqual({
      state: "INVALID",
      value: null,
      reason: "MISPLACED_SIGN",
    });
    expect(parseNumberInput("--1")).toEqual({
      state: "INVALID",
      value: null,
      reason: "MISPLACED_SIGN",
    });
    // Le plus unaire n'est pas une écriture de montant non plus.
    expect(parseNumberInput("+1")).toEqual({
      state: "INVALID",
      value: null,
      reason: "MISPLACED_SIGN",
    });
  });

  it("refuse tout autre caractère, symbole de devise compris", () => {
    // La devise est portée par le CHAMP, pas par la chaîne : la saisir dedans est une
    // ambiguïté, et « 100 USD » dans un champ en euros ne se devine pas.
    expect(parseNumberInput("100 €")).toEqual({
      state: "INVALID",
      value: null,
      reason: "UNEXPECTED_CHARACTER",
    });
    expect(parseNumberInput("0x1f").state).toBe("INVALID");
    expect(parseNumberInput("Infinity").state).toBe("INVALID");
    expect(parseNumberInput("NaN").state).toBe("INVALID");
  });
});

describe("parsePercentInput", () => {
  it("lit un pourcentage et rend un TAUX décimal", () => {
    // POURCENTAGE AFFICHÉ ≠ TAUX STOCKÉ : la base persiste 0,035, l'utilisateur écrit 3,5.
    expect(parsePercentInput("3,5")).toEqual({ state: "VALID", value: 0.035 });
    expect(parsePercentInput("100")).toEqual({ state: "VALID", value: 1 });
  });

  it("propage un taux nul déclaré, qui est une information", () => {
    // Un prêt à taux zéro existe : le cas CIC du plan en est un.
    expect(parsePercentInput("0")).toEqual({ state: "VALID", value: 0 });
  });

  it("propage le vide et le refus sans les convertir", () => {
    expect(parsePercentInput("")).toEqual({ state: "EMPTY", value: null });
    expect(parsePercentInput("-").state).toBe("INVALID");
  });

  it("fait l’aller-retour saisie → taux → saisie sans dériver", () => {
    for (const typed of ["0", "3,5", "7", "0,15", "100", "-2,25"]) {
      const draft = parsePercentInput(typed);
      expect(draft.state).toBe("VALID");
      expect(formatPercentForInput(draft.value)).toBe(typed);
    }
  });
});

describe("formatage vers la saisie", () => {
  it("rend une chaîne VIDE pour null, jamais « 0 »", () => {
    expect(formatNumberForInput(null)).toBe("");
    expect(formatPercentForInput(null)).toBe("");
  });

  it("rend la virgule décimale française", () => {
    expect(formatNumberForInput(16745.25)).toBe("16745,25");
    expect(formatNumberForInput(0)).toBe("0");
  });

  it("efface les artefacts du binaire sur un taux", () => {
    // 0,07 × 100 vaut 7,000000000000001 en flottant double. Sans arrondi, le champ afficherait
    // ce nombre à l'utilisateur.
    expect(formatPercentForInput(0.07)).toBe("7");
    expect(formatPercentForInput(0.0325)).toBe("3,25");
  });
});

describe("parseDateInput", () => {
  it("laisse un champ vide VIDE, sans le forcer à une date", () => {
    // Section 18.3 : « les dates ne sont jamais forcées à la date financière ».
    expect(parseDateInput("")).toEqual({ state: "EMPTY", value: null });
  });

  it("accepte une date ISO réelle", () => {
    expect(parseDateInput("2026-09-07")).toEqual({ state: "VALID", value: "2026-09-07" });
  });

  it("refuse une date qui n’existe pas au calendrier", () => {
    // `new Date("2026-02-31")` ne lève pas : il rend le 3 mars.
    expect(parseDateInput("2026-02-31")).toEqual({
      state: "INVALID",
      value: null,
      reason: "NOT_A_CALENDAR_DATE",
    });
    // 2026 n'est pas bissextile : le 29 février n'y existe pas.
    const notLeap = parseDateInput("2026-02-29");
    expect(notLeap.state === "INVALID" && notLeap.reason).toBe("NOT_A_CALENDAR_DATE");
    // 2028 est bissextile : le 29 février y existe.
    expect(parseDateInput("2028-02-29")).toEqual({ state: "VALID", value: "2028-02-29" });
  });

  it("refuse une forme non ISO", () => {
    expect(parseDateInput("07/09/2026")).toEqual({
      state: "INVALID",
      value: null,
      reason: "NOT_ISO",
    });
    const unpadded = parseDateInput("2026-9-7");
    expect(unpadded.state === "INVALID" && unpadded.reason).toBe("NOT_ISO");
  });
});

describe("isRealCalendarDate", () => {
  it("garde le comportement de la définition qu’elle remplace", () => {
    expect(isRealCalendarDate("2026-02-31")).toBe(false);
    expect(isRealCalendarDate("2026-05-01")).toBe(true);
  });
});
