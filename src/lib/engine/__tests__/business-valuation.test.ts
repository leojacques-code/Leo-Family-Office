import { describe, expect, it } from "vitest";

import {
  adjustedMetric,
  computeDcf,
  dcfSensitivity,
  multipleSensitivity,
} from "@/lib/engine/business-valuation";
import { known, unknown, blocker, subtract, sumAll } from "@/lib/engine/business-equity-facts";
import {
  adjustment,
  bridgeDeclaration,
  bridgeItem,
  blockerCodes,
  business,
  dcf,
  dcfPeriod,
  financials,
  flagCodes,
  ownership,
  portfolio,
  positionOf,
  valuation,
} from "@/lib/engine/__tests__/fixtures/business";

/**
 * Les attendus de ce fichier sont recalculés à la main, terme à terme, dans le test
 * lui-même. Comparer la sortie du moteur à une seconde implémentation écrite indépendamment
 * est la seule façon de tester un DCF : un attendu recopié depuis une exécution ne
 * prouverait que la stabilité du bug.
 */

const YEAR = { ebit: 1_000_000, da: 200_000, capex: 250_000, wcChange: 50_000 };
const WACC = 0.1;
const TAX = 0.25;

function handComputedFreeCashFlow(): number {
  const nopat = YEAR.ebit * (1 - TAX);
  return nopat + YEAR.da - YEAR.capex - YEAR.wcChange;
}

const threeYearDcf = (overrides: Partial<Parameters<typeof dcf>[0]> = {}) =>
  dcf({
    id: "dcf",
    businessId: "d",
    valuationDate: "2026-06-30",
    wacc: WACC,
    taxRate: TAX,
    terminalMethod: "PERPETUAL_GROWTH",
    terminalGrowth: 0.02,
    periods: [1, 2, 3].map((yearIndex) =>
      dcfPeriod({
        yearIndex,
        ebit: YEAR.ebit,
        ebitda: YEAR.ebit + YEAR.da,
        depreciationAmortisation: YEAR.da,
        capex: YEAR.capex,
        workingCapitalChange: YEAR.wcChange,
      }),
    ),
    ...overrides,
  });

describe("DCF — mécanique vérifiée contre un calcul indépendant", () => {
  const target = business({ id: "d", name: "DcfCo" });

  it("dérive le free cash flow de l'EBIT, de l'impôt, du capex et du BFR", () => {
    const result = computeDcf(target, threeYearDcf(), "EUR", []);
    expect(result.periods).toHaveLength(3);
    for (const period of result.periods) {
      expect(period.freeCashFlow.value).toBeCloseTo(handComputedFreeCashFlow(), 6);
    }
    expect(handComputedFreeCashFlow()).toBe(650_000);
  });

  it("actualise chaque année au WACC en convention de fin d'année", () => {
    const result = computeDcf(target, threeYearDcf(), "EUR", []);
    const expected = [1, 2, 3].reduce(
      (sum, year) => sum + handComputedFreeCashFlow() / (1 + WACC) ** year,
      0,
    );
    expect(result.discountedExplicitValue.value).toBeCloseTo(expected, 6);
  });

  it("applique la formule de Gordon à la valeur terminale et l'actualise à l'année N", () => {
    const result = computeDcf(target, threeYearDcf(), "EUR", []);
    const terminal = (handComputedFreeCashFlow() * 1.02) / (WACC - 0.02);
    expect(result.terminalValue.value).toBeCloseTo(terminal, 6);
    expect(result.discountedTerminalValue.value).toBeCloseTo(terminal / (1 + WACC) ** 3, 6);
    expect(result.enterpriseValue.value).toBeCloseTo(
      [1, 2, 3].reduce((sum, year) => sum + handComputedFreeCashFlow() / (1 + WACC) ** year, 0) +
        terminal / (1 + WACC) ** 3,
      6,
    );
  });

  it("mesure la part de valeur portée par la valeur terminale", () => {
    const result = computeDcf(target, threeYearDcf(), "EUR", []);
    expect(result.terminalValueShare.value).toBeGreaterThan(0.7);
    expect(result.terminalValueShare.value).toBeLessThan(0.85);
  });

  it("décale l'actualisation d'un demi-exercice en convention mi-année, valeur terminale exclue", () => {
    const result = computeDcf(target, threeYearDcf({ discountConvention: "MID_YEAR" }), "EUR", []);
    const expected = [0.5, 1.5, 2.5].reduce(
      (sum, exponent) => sum + handComputedFreeCashFlow() / (1 + WACC) ** exponent,
      0,
    );
    expect(result.discountedExplicitValue.value).toBeCloseTo(expected, 6);
    const terminal = (handComputedFreeCashFlow() * 1.02) / (WACC - 0.02);
    expect(result.discountedTerminalValue.value).toBeCloseTo(terminal / (1 + WACC) ** 3, 6);
  });

  it("valorise par multiple de sortie quand c'est la convention retenue", () => {
    const result = computeDcf(
      target,
      threeYearDcf({
        terminalMethod: "EXIT_MULTIPLE",
        terminalGrowth: null,
        terminalExitMultiple: 8,
        terminalExitMetric: "EBITDA",
      }),
      "EUR",
      [],
    );
    const terminal = (YEAR.ebit + YEAR.da) * 8;
    expect(result.terminalValue.value).toBeCloseTo(terminal, 6);
    expect(result.discountedTerminalValue.value).toBeCloseTo(terminal / (1 + WACC) ** 3, 6);
  });

  it("refuse une croissance perpétuelle supérieure ou égale au WACC", () => {
    const result = computeDcf(target, threeYearDcf({ terminalGrowth: 0.12 }), "EUR", []);
    expect(result.terminalValue.value).toBeNull();
    expect(blockerCodes(result.terminalValue)).toContain("DCF_TERMINAL_INVALID");
    expect(result.enterpriseValue.value).toBeNull();
  });

  it("ne dérive pas l'EBIT d'un EBITDA privé d'amortissements", () => {
    const result = computeDcf(
      target,
      threeYearDcf({
        periods: [
          dcfPeriod({ yearIndex: 1, ebitda: 1_200_000, capex: 100_000, workingCapitalChange: 0 }),
        ],
      }),
      "EUR",
      [],
    );
    expect(result.periods[0].ebit.value).toBeNull();
    expect(result.enterpriseValue.value).toBeNull();
    expect(blockerCodes(result.enterpriseValue)).toContain("DCF_PERIOD_INPUTS_MISSING");
  });

  it("ne valorise rien sans hypothèses ni déroulé annuel", () => {
    expect(blockerCodes(computeDcf(target, null, "EUR", []).enterpriseValue)).toContain(
      "DCF_ASSUMPTIONS_MISSING",
    );
    expect(
      blockerCodes(computeDcf(target, threeYearDcf({ periods: [] }), "EUR", []).enterpriseValue),
    ).toContain("DCF_PERIODS_MISSING");
  });

  it("s'intègre au portefeuille en passant par le pont EV → Equity", () => {
    const result = portfolio({
      businesses: [business({ id: "d", name: "DcfCo" })],
      ownership: [
        ownership({ id: "o", businessId: "d", effectiveDate: "2020-01-01", legalRate: 0.5 }),
      ],
      financials: [
        financials({
          id: "f",
          businessId: "d",
          periodEnd: "2025-12-31",
          cash: 400_000,
          grossDebt: 1_000_000,
        }),
      ],
      valuations: [
        valuation({ id: "v", businessId: "d", valuationDate: "2026-06-30", method: "DCF" }),
      ],
      dcfAssumptions: [threeYearDcf()],
    });
    const position = positionOf(result, "d");
    const enterprise = computeDcf(business({ id: "d", name: "DcfCo" }), threeYearDcf(), "EUR", [])
      .enterpriseValue.value!;
    expect(position.enterpriseValue.central.value).toBeCloseTo(enterprise, 6);
    expect(position.equityValue.central.value).toBeCloseTo(enterprise - 1_000_000 + 400_000, 6);
    expect(position.attributableValue.central.value).toBeCloseTo(
      (enterprise - 1_000_000 + 400_000) * 0.5,
      6,
    );
    expect(position.valuation.bridge.map((step) => step.key)).toEqual([
      "DCF_EXPLICIT_PV",
      "DCF_TERMINAL_PV",
      "ENTERPRISE_VALUE",
      "GROSS_DEBT",
      "CASH",
      "EQUITY_VALUE",
      "ECONOMIC_OWNERSHIP",
      "ATTRIBUTABLE_VALUE",
    ]);
  });
});

describe("Sensibilités", () => {
  it("croise multiple et choc d'agrégat sans jamais remplir une case de zéro", () => {
    const matrix = multipleSensitivity({
      adjustedMetric: known(400_000),
      multiples: [5, 6, 7],
      metricShocks: [-0.1, 0, 0.1],
      toEquity: (enterprise) => sumAll([enterprise, known(50_000)]),
    });
    expect(matrix.cells).toHaveLength(3);
    expect(matrix.cells[0]).toHaveLength(3);
    expect(matrix.cells[1][1].amount.value).toBeCloseTo(400_000 * 6 + 50_000, 6);
    expect(matrix.cells[0][0].amount.value).toBeCloseTo(400_000 * 0.9 * 5 + 50_000, 6);
    expect(matrix.cells[2][2].amount.value).toBeCloseTo(400_000 * 1.1 * 7 + 50_000, 6);
  });

  it("propage l'inconnu au lieu de le combler", () => {
    const matrix = multipleSensitivity({
      adjustedMetric: unknown([blocker("EBITDA_MISSING", "b")]),
      multiples: [6],
      metricShocks: [0],
      toEquity: (enterprise) => subtract(enterprise, known(100)),
    });
    expect(matrix.cells[0][0].amount.value).toBeNull();
    expect(blockerCodes(matrix.cells[0][0].amount)).toContain("EBITDA_MISSING");
  });

  it("croise WACC et croissance terminale, et laisse vide toute combinaison impossible", () => {
    const matrix = dcfSensitivity({
      business: business({ id: "d", name: "DcfCo" }),
      assumptions: threeYearDcf(),
      waccValues: [0.08, 0.1, 0.12],
      terminalValues: [0.01, 0.02, 0.12],
      reportingCurrency: "EUR",
      currencyRates: [],
    });
    expect(matrix.rowKey).toBe("WACC");
    expect(matrix.columnKey).toBe("TERMINAL_GROWTH");
    expect(matrix.cells[0][0].amount.value).toBeGreaterThan(0);
    // Croissance terminale 12 % contre un WACC de 8 % : la formule de Gordon n'a pas de sens.
    expect(matrix.cells[0][2].amount.value).toBeNull();
    // À croissance égale, un WACC plus élevé produit une valeur plus faible.
    expect(matrix.cells[2][1].amount.value!).toBeLessThan(matrix.cells[0][1].amount.value!);
  });
});

describe("EBITDA ajusté", () => {
  const target = business({ id: "a", name: "AdjCo" });
  const period = financials({
    id: "f",
    businessId: "a",
    periodEnd: "2025-12-31",
    revenue: 2_000_000,
    ebitda: 300_000,
  });

  it("n'ajoute aucun retraitement que l'utilisateur n'a pas déclaré", () => {
    const result = adjustedMetric(
      target,
      valuation({
        id: "v",
        businessId: "a",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
      }),
      [period],
      [],
      "EUR",
      [],
    );
    expect(result.observed.value).toBe(300_000);
    expect(result.adjusted.value).toBe(300_000);
    expect(result.steps).toHaveLength(1);
  });

  it("signale un pro forma pour ce qu'il est : un résultat qui n'a pas été constaté", () => {
    const result = adjustedMetric(
      target,
      valuation({
        id: "v",
        businessId: "a",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
      }),
      [period],
      [
        adjustment({
          id: "a1",
          businessId: "a",
          periodEnd: "2025-12-31",
          label: "Économies annoncées",
          amount: 120_000,
          category: "PRO_FORMA",
        }),
      ],
      "EUR",
      [],
    );
    expect(result.adjusted.value).toBe(420_000);
    expect(flagCodes(result.adjusted)).toEqual(
      expect.arrayContaining(["EBITDA_ADJUSTED", "PRO_FORMA_ADJUSTMENT_INCLUDED"]),
    );
  });

  it("ne retraite jamais un chiffre d'affaires", () => {
    const result = adjustedMetric(
      target,
      valuation({
        id: "v",
        businessId: "a",
        valuationDate: "2026-06-30",
        method: "REVENUE_MULTIPLE",
        multiple: 1.5,
        metricBasis: "REVENUE",
      }),
      [period],
      [
        adjustment({
          id: "a1",
          businessId: "a",
          periodEnd: "2025-12-31",
          label: "Retraitement",
          amount: 500_000,
        }),
      ],
      "EUR",
      [],
    );
    expect(result.adjusted.value).toBe(2_000_000);
  });

  it("refuse toute base quand aucune période n'a été saisie", () => {
    const result = adjustedMetric(
      target,
      valuation({
        id: "v",
        businessId: "a",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
      }),
      [],
      [],
      "EUR",
      [],
    );
    expect(result.adjusted.value).toBeNull();
    expect(blockerCodes(result.adjusted)).toContain("VALUATION_FINANCIAL_PERIOD_MISSING");
  });
});

describe("Éléments de bridge EV → Equity", () => {
  it("ne transforme pas l’absence de déclaration du bridge en zéro", () => {
    const result = portfolio({
      businesses: [business({ id: "unknown-bridge", name: "UnknownBridgeCo" })],
      ownership: [
        ownership({
          id: "o",
          businessId: "unknown-bridge",
          effectiveDate: "2020-01-01",
          legalRate: 1,
        }),
      ],
      financials: [
        financials({
          id: "f",
          businessId: "unknown-bridge",
          periodEnd: "2025-12-31",
          ebitda: 100_000,
          cash: 0,
          grossDebt: 0,
        }),
      ],
      valuations: [
        valuation({
          id: "v",
          businessId: "unknown-bridge",
          valuationDate: "2026-06-30",
          method: "EBITDA_MULTIPLE",
          multiple: 5,
        }),
      ],
      bridgeDeclarations: [],
    });
    const equity = positionOf(result, "unknown-bridge").equityValue.central;
    expect(equity.value).toBeNull();
    expect(blockerCodes(equity)).toContain("EV_TO_EQUITY_BRIDGE_STATUS_MISSING");
  });

  it("lit une déclaration explicite sans autre ajustement comme un vrai zéro", () => {
    const result = portfolio({
      businesses: [business({ id: "none-bridge", name: "NoBridgeCo" })],
      ownership: [
        ownership({
          id: "o",
          businessId: "none-bridge",
          effectiveDate: "2020-01-01",
          legalRate: 1,
        }),
      ],
      financials: [
        financials({
          id: "f",
          businessId: "none-bridge",
          periodEnd: "2025-12-31",
          ebitda: 100_000,
          cash: 0,
          grossDebt: 0,
        }),
      ],
      valuations: [
        valuation({
          id: "v",
          businessId: "none-bridge",
          valuationDate: "2026-06-30",
          method: "EBITDA_MULTIPLE",
          multiple: 5,
        }),
      ],
      bridgeDeclarations: [
        bridgeDeclaration({
          id: "bd",
          businessId: "none-bridge",
          effectiveDate: "2026-06-30",
          status: "DECLARED_NONE",
        }),
      ],
    });
    const position = positionOf(result, "none-bridge");
    expect(position.valuation.bridgeItemsTotal.value).toBe(0);
    expect(position.equityValue.central.value).toBe(500_000);
  });

  it("retranche des minoritaires et ajoute un actif hors exploitation, chacun tracé", () => {
    const result = portfolio({
      businesses: [business({ id: "br", name: "BridgeCo" })],
      ownership: [
        ownership({ id: "o", businessId: "br", effectiveDate: "2020-01-01", legalRate: 1 }),
      ],
      financials: [
        financials({
          id: "f",
          businessId: "br",
          periodEnd: "2025-12-31",
          ebitda: 1_000_000,
          cash: 200_000,
          grossDebt: 500_000,
        }),
      ],
      valuations: [
        valuation({
          id: "v",
          businessId: "br",
          valuationDate: "2026-06-30",
          method: "EBITDA_MULTIPLE",
          multiple: 7,
        }),
      ],
      bridgeItems: [
        {
          id: "i1",
          businessId: "br",
          effectiveDate: "2025-12-31",
          category: "MINORITY_INTERESTS" as const,
          label: "Minoritaires filiale",
          amount: -300_000,
          currency: "EUR",
          notes: null,
          provenance: { kind: "USER_ASSUMPTION" as const, confidence: "MEDIUM" as const },
        },
        {
          id: "i2",
          businessId: "br",
          effectiveDate: "2025-12-31",
          category: "SURPLUS_ASSET" as const,
          label: "Immeuble hors exploitation",
          amount: 450_000,
          currency: "EUR",
          notes: null,
          provenance: { kind: "USER_ASSUMPTION" as const, confidence: "MEDIUM" as const },
        },
      ],
      bridgeDeclarations: [
        bridgeDeclaration({
          id: "bd",
          businessId: "br",
          effectiveDate: "2026-06-30",
          status: "COMPLETE",
        }),
      ],
    });
    const position = positionOf(result, "br");
    // 7 000 000 − 500 000 + 200 000 − 300 000 + 450 000
    expect(position.equityValue.central.value).toBe(6_850_000);
    const labels = position.valuation.bridge
      .filter((step) => step.key.startsWith("BRIDGE_ITEM"))
      .map((step) => step.label);
    expect(labels).toEqual(["Minoritaires filiale", "Immeuble hors exploitation"]);
  });

  it("calcule minoritaires, compte courant d’associé et earn-out quand la liste est complète", () => {
    const result = portfolio({
      businesses: [business({ id: "full-bridge", name: "FullBridgeCo" })],
      ownership: [
        ownership({
          id: "o",
          businessId: "full-bridge",
          effectiveDate: "2020-01-01",
          legalRate: 1,
        }),
      ],
      financials: [
        financials({
          id: "f",
          businessId: "full-bridge",
          periodEnd: "2025-12-31",
          ebitda: 1_000_000,
          cash: 200_000,
          grossDebt: 500_000,
        }),
      ],
      valuations: [
        valuation({
          id: "v",
          businessId: "full-bridge",
          valuationDate: "2026-06-30",
          method: "EBITDA_MULTIPLE",
          multiple: 7,
        }),
      ],
      bridgeItems: [
        bridgeItem({
          id: "minority",
          businessId: "full-bridge",
          effectiveDate: "2026-06-30",
          label: "Minoritaires",
          category: "MINORITY_INTERESTS",
          amount: -300_000,
        }),
        bridgeItem({
          id: "shareholder-loan",
          businessId: "full-bridge",
          effectiveDate: "2026-06-30",
          label: "Compte courant",
          category: "SHAREHOLDER_LOAN",
          amount: -120_000,
        }),
        bridgeItem({
          id: "earn-out",
          businessId: "full-bridge",
          effectiveDate: "2026-06-30",
          label: "Earn-out",
          category: "EARN_OUT",
          amount: -80_000,
        }),
      ],
      bridgeDeclarations: [
        bridgeDeclaration({
          id: "bd",
          businessId: "full-bridge",
          effectiveDate: "2026-06-30",
          status: "COMPLETE",
        }),
      ],
    });
    // 7 000 000 - 500 000 + 200 000 - 300 000 - 120 000 - 80 000
    expect(positionOf(result, "full-bridge").equityValue.central.value).toBe(6_200_000);
  });
});
