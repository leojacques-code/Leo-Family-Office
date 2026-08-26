import { describe, expect, it } from "vitest";

import {
  BUSINESS_METHOD_LABELS,
  describeBlocker,
  describeBridgeStep,
  describeFlag,
  explainNotComputable,
  summariseQuality,
} from "@/lib/engine/business-equity-explain";
import { BUSINESS_VALUATION_METHODS, blocker, flag } from "@/lib/engine/business-equity-facts";
import {
  business,
  financials,
  ownership,
  portfolio,
  positionOf,
  valuation,
} from "@/lib/engine/__tests__/fixtures/business";

const UUID = "2d4c7f61-9a3b-4c2e-8f10-6d5b4a3c2e10";
const context = {
  nameOf: (id: string) => (id === UUID ? "Atelier Vernier" : `Société ${id}`),
  asOfDate: "2026-08-19",
};

describe("Aucun identifiant technique n'atteint l'utilisateur", () => {
  it("remplace le code et l'UUID par une phrase française qui nomme la société", () => {
    const phrase = describeBlocker(blocker("VALUATION_BASIS_MISSING", UUID), context);
    expect(phrase).toBe(
      "Atelier Vernier : aucune valorisation ni méthode de valorisation n’est disponible au 19 août 2026",
    );
    expect(phrase).not.toContain(UUID);
    expect(phrase).not.toContain("VALUATION_BASIS_MISSING");
  });

  it("produit la phrase d'échec complète attendue à l'écran", () => {
    expect(explainNotComputable([blocker("VALUATION_BASIS_MISSING", UUID)], context)).toBe(
      "Impossible de calculer la valeur : Atelier Vernier : aucune valorisation ni méthode de valorisation n’est disponible au 19 août 2026.",
    );
  });

  it("traduit chaque motif du vocabulaire sans en laisser un seul brut", () => {
    const codes = [
      "EV_TO_EQUITY_GROSS_DEBT_MISSING",
      "ECONOMIC_OWNERSHIP_MISSING",
      "CAPITAL_HISTORY_NOT_DECLARED",
      "HOLDING_CYCLE",
      "DCF_TERMINAL_INVALID",
      "FX_RATE_MISSING",
      "XIRR_MULTIPLE_SOLUTIONS",
    ] as const;
    for (const code of codes) {
      const phrase = describeBlocker(blocker(code, UUID), context);
      expect(phrase).not.toContain(code);
      expect(phrase).not.toContain(UUID);
      expect(phrase.length).toBeGreaterThan(30);
    }
  });

  it("traduit les réserves sans exposer leur code", () => {
    const phrase = describeFlag(flag("PREFERRED_RIGHTS_UNKNOWN", UUID), context);
    expect(phrase).toContain("Atelier Vernier");
    expect(phrase).toContain("BORNE HAUTE");
    expect(phrase).not.toContain("PREFERRED_RIGHTS_UNKNOWN");
  });

  it("nomme chaque méthode réellement exposée", () => {
    for (const method of BUSINESS_VALUATION_METHODS) {
      expect(BUSINESS_METHOD_LABELS[method]).toBeTruthy();
      expect(BUSINESS_METHOD_LABELS[method]).not.toBe(method);
    }
  });
});

describe("Le pont se lit sans connaître le schéma", () => {
  const result = portfolio({
    businesses: [business({ id: "b", name: "Atelier Vernier" })],
    ownership: [
      ownership({ id: "o", businessId: "b", effectiveDate: "2020-01-01", legalRate: 0.7 }),
    ],
    financials: [
      financials({
        id: "f",
        businessId: "b",
        periodEnd: "2025-12-31",
        ebitda: 650_000,
        cash: 300_000,
        grossDebt: 1_100_000,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "b",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
      }),
    ],
  });

  it("donne un libellé français à chaque étape", () => {
    const labels = positionOf(result, "b").valuation.bridge.map((step) =>
      describeBridgeStep(step, { nameOf: () => "Atelier Vernier", asOfDate: "2026-08-19" }),
    );
    expect(labels).toEqual([
      "EBITDA observé",
      "Multiple appliqué",
      "Enterprise Value",
      "Dette brute corporate",
      "Trésorerie",
      "Equity Value",
      "Droits économiques",
      "Valeur personnelle",
    ]);
  });
});

describe("Le résumé de qualité ne ment jamais", () => {
  it("n'annonce pas « calculée » ce qui ne l'est pas", () => {
    const summary = summariseQuality(
      { blockers: [blocker("ECONOMIC_OWNERSHIP_MISSING", UUID)], flags: [] },
      false,
      context,
    );
    expect(summary.level).toBe("BLOCKED");
    expect(summary.headline).toBe("Valeur non calculable");
    expect(summary.reasons[0]).toContain("droits économiques");
  });

  it("distingue un résultat complet d'un résultat sous réserve", () => {
    expect(summariseQuality({ blockers: [], flags: [] }, true, context).level).toBe("COMPLETE");
    expect(
      summariseQuality({ blockers: [], flags: [flag("VALUATION_STALE", UUID)] }, true, context)
        .level,
    ).toBe("PARTIAL");
  });
});
