import { describe, expect, it } from "vitest";
import {
  REPORTING_TIMEZONE,
  buildFinancialDateContext,
  civilDateIn,
  currentTaxYear,
  operationalDateContext,
  operationalToday,
} from "@/lib/financial-date";

describe("civilDateIn", () => {
  it("rend la date CIVILE du fuseau, pas la date UTC", () => {
    // 21 h 30 UTC le 6 septembre est déjà le 6 septembre 23 h 30 à Paris : même jour.
    expect(civilDateIn(new Date("2026-09-06T21:30:00Z"), "Europe/Paris")).toBe("2026-09-06");
    // 23 h 30 UTC le 6 septembre est le 7 septembre 01 h 30 à Paris : jour SUIVANT.
    // C'est exactement le décalage qu'un `toISOString().slice(0, 10)` aurait manqué, et il
    // aurait fait basculer une échéance du 1er du mois la veille au soir.
    expect(civilDateIn(new Date("2026-09-06T23:30:00Z"), "Europe/Paris")).toBe("2026-09-07");
  });

  it("tient compte de l’heure d’hiver, où le décalage n’est plus le même", () => {
    // En janvier, Paris est à UTC+1 : 23 h 30 UTC est 00 h 30 le lendemain.
    expect(civilDateIn(new Date("2026-01-15T23:30:00Z"), "Europe/Paris")).toBe("2026-01-16");
    // En juillet, Paris est à UTC+2 : 22 h 30 UTC est déjà 00 h 30 le lendemain.
    expect(civilDateIn(new Date("2026-07-15T22:30:00Z"), "Europe/Paris")).toBe("2026-07-16");
  });

  it("refuse un instant non représentable au lieu d’en fabriquer un", () => {
    expect(() => civilDateIn(new Date("pas une date"), "Europe/Paris")).toThrow(
      /instant non représentable/,
    );
  });
});

describe("buildFinancialDateContext", () => {
  const now = new Date("2026-09-07T10:00:00Z");

  it("retient la clôture la PLUS RÉCENTE et le déclare", () => {
    const context = buildFinancialDateContext({
      // Ordre volontairement quelconque : la sélection ne dépend pas de l'ordre d'entrée.
      closeDates: ["2026-06-30", "2026-08-31", "2026-07-31"],
      now,
    });
    expect(context.asOfDate).toBe("2026-08-31");
    expect(context.asOfDateSource).toBe("MONTHLY_CLOSE");
    expect(context.today).toBe("2026-09-07");
  });

  it("distingue la date d’arrêté de la date opérationnelle", () => {
    const context = buildFinancialDateContext({ closeDates: ["2026-08-31"], now });
    // C'est TOUT l'objet du contexte : la constante confondait les deux, et l'écran
    // annonçait donc la date de clôture comme « aujourd'hui ».
    expect(context.asOfDate).not.toBe(context.today);
  });

  it("se replie sur le jour courant SANS clôture, et le déclare", () => {
    const context = buildFinancialDateContext({ closeDates: [], now });
    expect(context.asOfDate).toBe("2026-09-07");
    // La surface a le droit de savoir qu'aucun arrêté n'a eu lieu : un repli déclaré n'est
    // pas un repli silencieux.
    expect(context.asOfDateSource).toBe("TODAY");
  });

  it("ignore une clôture postérieure au jour courant", () => {
    const context = buildFinancialDateContext({
      closeDates: ["2026-08-31", "2026-12-31"],
      now,
    });
    // Une date d'arrêté dans le futur présenterait un patrimoine qui n'a pas été observé.
    expect(context.asOfDate).toBe("2026-08-31");
  });

  it("ignore une clôture postérieure même si elle est la SEULE", () => {
    const context = buildFinancialDateContext({ closeDates: ["2027-01-31"], now });
    expect(context.asOfDate).toBe("2026-09-07");
    expect(context.asOfDateSource).toBe("TODAY");
  });

  it("ignore une date mal formée au lieu de la comparer comme du texte", () => {
    const context = buildFinancialDateContext({
      closeDates: ["2026-8-31", "31/08/2026", "", "2026-07-31"],
      now,
    });
    // `"2026-8-31" > "2026-07-31"` est vrai en comparaison de chaînes : accepter la forme
    // non ISO aurait donc élu une date invalide comme arrêté.
    expect(context.asOfDate).toBe("2026-07-31");
  });

  it("borne la période de reporting sur le mois de la date d’arrêté", () => {
    const context = buildFinancialDateContext({ closeDates: ["2026-08-31"], now });
    expect(context.reportingPeriod).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
      month: "2026-08",
    });
  });

  it("borne correctement un mois de février bissextile", () => {
    const context = buildFinancialDateContext({
      closeDates: ["2028-02-29"],
      now: new Date("2028-03-10T10:00:00Z"),
    });
    expect(context.reportingPeriod.end).toBe("2028-02-29");
  });

  it("porte le fuseau de reporting du produit", () => {
    expect(buildFinancialDateContext({ closeDates: [], now }).timezone).toBe(REPORTING_TIMEZONE);
    expect(REPORTING_TIMEZONE).toBe("Europe/Paris");
  });
});

describe("operationalDateContext", () => {
  it("ne connaît aucune clôture et ne prétend donc à aucun arrêté", () => {
    const context = operationalDateContext(new Date("2026-09-07T10:00:00Z"));
    expect(context.asOfDate).toBe(context.today);
    expect(context.asOfDateSource).toBe("TODAY");
  });
});

describe("operationalToday", () => {
  it("suit le calendrier au lieu de figer le démarrage du module", () => {
    // Deux appels avec deux instants différents rendent deux dates différentes : c'est ce
    // qu'une constante ne pouvait pas faire, et c'est ce que les schémas de validation
    // attendent d'un prédicat évalué à la lecture.
    expect(operationalToday(new Date("2026-09-07T10:00:00Z"))).toBe("2026-09-07");
    expect(operationalToday(new Date("2027-03-01T10:00:00Z"))).toBe("2027-03-01");
  });

  it("sans argument, rend une date ISO du jour", () => {
    expect(operationalToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("currentTaxYear", () => {
  it("suit la date OPÉRATIONNELLE et non la date d’arrêté", () => {
    // Cas limite réel : en janvier, l'arrêté disponible est celui de décembre. L'année
    // fiscale en vigueur est pourtant la nouvelle, et les règles à appliquer sont les
    // siennes. Prendre l'année de l'arrêté ferait chercher un jeu de règles 2026 dans une
    // base qui n'en porte que pour 2027, et le produit afficherait « règles absentes ».
    const context = buildFinancialDateContext({
      closeDates: ["2026-12-31"],
      now: new Date("2027-01-12T10:00:00Z"),
    });
    expect(context.asOfDate).toBe("2026-12-31");
    expect(currentTaxYear(context)).toBe(2027);
  });
});
