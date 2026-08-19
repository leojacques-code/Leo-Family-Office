import { describe, expect, it } from "vitest";
import { amortizeLoan, applyScenarioOverrides, calculateNetWorth, compoundReturn, fxConvert, irr, moic, npv, realValue } from "@/lib/engine/financial";

describe("financial primitives", () => {
  it("compounds returns with configurable periods", () => {
    expect(compoundReturn(1000, 0.1, 2)).toBeCloseTo(1210, 8);
    expect(compoundReturn(1000, 0.12, 1, 12)).toBeCloseTo(1126.825, 3);
  });

  it("discounts nominal value for inflation", () => {
    expect(realValue(110, 0.1, 1)).toBeCloseTo(100, 8);
  });

  it("amortizes a zero-interest loan without inventing interest", () => {
    const schedule = amortizeLoan(1200, 0, 12);
    expect(schedule).toHaveLength(12);
    expect(schedule[0].interest).toBe(0);
    expect(schedule[0].principal).toBeCloseTo(100, 8);
    expect(schedule.at(-1)?.closingBalance).toBeCloseTo(0, 8);
  });

  it("caps the final contractual payment at the remaining balance", () => {
    const schedule = amortizeLoan(16745, 0, 60, 284.72);
    expect(schedule.reduce((sum, row) => sum + row.principal, 0)).toBeCloseTo(16745, 6);
    expect(schedule.every((row) => row.closingBalance >= 0)).toBe(true);
  });

  it("calculates NPV, IRR and MOIC", () => {
    expect(npv(0.1, [-100, 110])).toBeCloseTo(0, 8);
    expect(irr([-100, 0, 121])).toBeCloseTo(0.1, 6);
    expect(moic(250, 100)).toBe(2.5);
  });

  it("converts FX and rejects invalid rates", () => {
    expect(fxConvert(100, 0.92)).toBe(92);
    expect(() => fxConvert(100, 0)).toThrow();
  });

  it("calculates net worth from accounts rather than positions", () => {
    expect(calculateNetWorth([{ balance: 15571.49 }], [{ currentBalance: 16745 }])).toEqual({ grossAssets: 15571.49, debt: 16745, netWorth: -1173.51 });
  });

  it("applies scenario overrides without mutating the base", () => {
    const base = { annualReturn: 0.05, inflation: 0.02 };
    const result = applyScenarioOverrides(base, { annualReturn: 0.03 });
    expect(result).toEqual({ annualReturn: 0.03, inflation: 0.02 });
    expect(base.annualReturn).toBe(0.05);
  });
});
