import { describe, expect, it } from "vitest";
import { parseDebtSchedule, SCHEDULE_HEADER, summarizeDebtSchedule } from "../debt-schedule";
const row = "2026-12-05;16745;273,70;0;11,02;0;16471,30;284,72";
describe("échéancier bancaire — lecture sans invention", () => {
  it("sépare la mensualité CIC entre principal et assurance sur la ligne documentée", () => {
    const result = parseDebtSchedule(`${SCHEDULE_HEADER}\n${row}`);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      principal: 273.7,
      insurance: 11.02,
      openingBalance: 16745,
      closingBalance: 16471.3,
    });
  });
  it("préserve les trois débits sans principal avant décembre", () => {
    const earlier = ["09", "10", "11"].map(
      (month) => `2026-${month}-05;16745;0;0;11,02;0;16745;11,02`,
    );
    const result = parseDebtSchedule([SCHEDULE_HEADER, ...earlier, row].join("\n"));
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.filter((entry) => entry.principal > 0)).toHaveLength(1);
    expect(summarizeDebtSchedule(result.rows)).toEqual({
      debitCount: 4,
      principalPaymentCount: 1,
      firstCashOutDate: "2026-09-05",
      firstPrincipalDate: "2026-12-05",
      lastProvidedDate: "2026-12-05",
      openingBalance: 16745,
      closingBalance: 16471.3,
      totalPrincipal: 273.7,
      totalInterest: 0,
      totalInsurance: 44.08,
      totalFees: 0,
      totalFutureCost: 44.08,
      totalCashOut: 317.78,
    });
  });
  it("retourne une synthèse vide explicite sans échéancier", () => {
    expect(summarizeDebtSchedule([])).toMatchObject({
      debitCount: 0,
      firstCashOutDate: null,
      openingBalance: null,
      closingBalance: null,
      totalFutureCost: 0,
      totalCashOut: 0,
    });
  });
  it.each([
    row.replace(";11,02;", ";;"),
    row.replace("284,72", "273,70"),
    row.replace("16471,30", "16400"),
    row.replace("2026-12-05", "2026-02-30"),
    row.replace(";16745;", ";1e6;"),
    row.replace(";11,02;", ";11,021;"),
  ])("refuse une ligne manquante, incohérente ou mal formée", (invalid) => {
    const result = parseDebtSchedule(`${SCHEDULE_HEADER}\n${invalid}`);
    expect(result.rows).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it("refuse un doublon et les colonnes en ordre différent", () => {
    expect(parseDebtSchedule(`${SCHEDULE_HEADER}\n${row}\n${row}`).rows).toEqual([]);
    expect(
      parseDebtSchedule(
        `${SCHEDULE_HEADER.replace("principal;interet", "interet;principal")}\n${row}`,
      ).rows,
    ).toEqual([]);
  });
});
