import { describe, expect, it } from "vitest";

import { buildBusinessFinancialHistory } from "@/lib/engine/business-financials";
import {
  AS_OF,
  blockerCodes,
  business,
  financials,
  flagCodes,
} from "@/lib/engine/__tests__/fixtures/business";

/**
 * L'historique financier est une SÉRIE, pas un couple de chiffres. Ces tests vérifient que
 * les grandeurs de comparaison ne se calculent qu'entre périodes comparables, et qu'aucune
 * d'elles ne se rabat sur zéro quand un terme manque.
 */

const target = business({ id: "h", name: "HistoCo" });

const annual = (year: number, values: Partial<ReturnType<typeof financials>>) =>
  financials({
    id: `f${year}`,
    businessId: "h",
    periodEnd: `${year}-12-31`,
    periodStart: `${year}-01-01`,
    periodLabel: `FY${year}`,
    ...values,
  });

describe("Historique financier multi-périodes", () => {
  const history = buildBusinessFinancialHistory(
    target,
    [
      annual(2023, {
        revenue: 3_000_000,
        ebitda: 450_000,
        cash: 100_000,
        grossDebt: 900_000,
        workingCapital: 400_000,
      }),
      annual(2024, {
        revenue: 3_600_000,
        ebitda: 540_000,
        cash: 180_000,
        grossDebt: 800_000,
        workingCapital: 460_000,
      }),
      annual(2025, {
        revenue: 4_320_000,
        ebitda: 600_000,
        ebit: 480_000,
        netIncome: 300_000,
        grossProfit: 2_160_000,
        cash: 250_000,
        grossDebt: 700_000,
        workingCapital: 520_000,
        capex: 150_000,
        taxExpense: 120_000,
      }),
    ],
    AS_OF,
  );
  const last = history.periods.at(-1)!;

  it("ordonne les périodes et retient la plus récente comme base de valorisation", () => {
    expect(history.periods.map((period) => period.snapshot.periodEnd)).toEqual([
      "2023-12-31",
      "2024-12-31",
      "2025-12-31",
    ]);
    expect(history.latestValuationBase?.snapshot.periodEnd).toBe("2025-12-31");
  });

  it("dérive croissance, marges et levier de la période", () => {
    expect(last.revenueGrowth.value).toBeCloseTo(4_320_000 / 3_600_000 - 1, 12);
    expect(last.ebitdaMargin.value).toBeCloseTo(600_000 / 4_320_000, 12);
    expect(last.ebitMargin.value).toBeCloseTo(480_000 / 4_320_000, 12);
    expect(last.netMargin.value).toBeCloseTo(300_000 / 4_320_000, 12);
    expect(last.grossMarginRate.value).toBeCloseTo(0.5, 12);
    expect(last.netDebt.value).toBe(450_000);
    expect(last.leverage.value).toBeCloseTo(450_000 / 600_000, 12);
  });

  it("calcule un CAGR sur la fenêtre annuelle réellement couverte", () => {
    expect(history.revenueCagr.value).toBeCloseTo(0.2, 2);
    expect(history.cagrYears).toBeGreaterThan(1.9);
  });

  it("dérive le free cash flow quand tous ses termes existent, et le signale", () => {
    // 600 000 − 120 000 d'impôt − 150 000 de capex − 60 000 de variation de BFR
    expect(last.freeCashFlow.value).toBe(270_000);
    expect(last.freeCashFlowIsDerived).toBe(true);
    expect(flagCodes(last.freeCashFlow)).toContain("FREE_CASH_FLOW_DERIVED");
    expect(last.ebitdaToFcfConversion.value).toBeCloseTo(270_000 / 600_000, 12);
  });

  it("préfère un free cash flow déclaré à sa dérivation", () => {
    const declared = buildBusinessFinancialHistory(
      target,
      [
        annual(2025, {
          ebitda: 600_000,
          capex: 150_000,
          taxExpense: 120_000,
          freeCashFlow: 310_000,
        }),
      ],
      AS_OF,
    );
    expect(declared.periods[0].freeCashFlow.value).toBe(310_000);
    expect(declared.periods[0].freeCashFlowIsDerived).toBe(false);
  });

  it("ne dérive aucun free cash flow si un seul terme manque", () => {
    const partial = buildBusinessFinancialHistory(
      target,
      [annual(2025, { ebitda: 600_000, taxExpense: 120_000 })],
      AS_OF,
    );
    expect(partial.periods[0].freeCashFlow.value).toBeNull();
  });
});

describe("Comparabilité des périodes", () => {
  it("ne compare jamais un exercice à un cumul glissant", () => {
    const history = buildBusinessFinancialHistory(
      target,
      [
        annual(2025, { revenue: 4_000_000, ebitda: 500_000 }),
        financials({
          id: "ltm",
          businessId: "h",
          periodEnd: "2026-06-30",
          periodKind: "LTM",
          periodLabel: "LTM juin 2026",
          revenue: 4_400_000,
          ebitda: 560_000,
        }),
      ],
      AS_OF,
    );
    const ltm = history.periods.at(-1)!;
    expect(ltm.revenueGrowth.value).toBeNull();
    expect(blockerCodes(ltm.revenueGrowth)).toContain("PRIOR_PERIOD_MISSING");
    expect(flagCodes(history)).toContain("PERIOD_KIND_MIXED");
  });

  it("refuse une croissance sur une base nulle ou négative", () => {
    const history = buildBusinessFinancialHistory(
      target,
      [annual(2024, { revenue: 0 }), annual(2025, { revenue: 500_000 })],
      AS_OF,
    );
    expect(history.periods.at(-1)!.revenueGrowth.value).toBeNull();
  });

  it("refuse un levier sur un EBITDA négatif", () => {
    const history = buildBusinessFinancialHistory(
      target,
      [annual(2025, { ebitda: -100_000, cash: 50_000, grossDebt: 400_000 })],
      AS_OF,
    );
    const period = history.periods[0];
    expect(period.netDebt.value).toBe(350_000);
    expect(period.leverage.value).toBeNull();
    expect(blockerCodes(period.leverage)).toContain("EBITDA_NOT_POSITIVE");
  });

  it("ignore les périodes postérieures à la date de lecture", () => {
    const history = buildBusinessFinancialHistory(
      target,
      [annual(2025, { revenue: 4_000_000 }), annual(2027, { revenue: 9_000_000 })],
      AS_OF,
    );
    expect(history.periods).toHaveLength(1);
  });

  it("ne dit rien plutôt que de deviner quand aucune période n'existe", () => {
    const history = buildBusinessFinancialHistory(target, [], AS_OF);
    expect(history.periods).toEqual([]);
    expect(history.latest).toBeNull();
    expect(history.revenueCagr.value).toBeNull();
  });
});
