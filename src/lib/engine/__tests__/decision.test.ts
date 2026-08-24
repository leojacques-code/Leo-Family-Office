import { describe, expect, it } from "vitest";
import { compareDebtVsInvest } from "@/lib/engine/decision";

const base = {
  availableCash: 5000,
  debtBalance: 16745,
  debtRate: 0,
  investmentReturn: 0.055,
  volatility: 0.15,
  inflation: 0.02,
  years: 5,
};

describe("compareDebtVsInvest", () => {
  it("borne le capital arbitré au cash réellement disponible", () => {
    const result = compareDebtVsInvest({ ...base, availableCash: 354.08 });
    expect(result.capital).toBeCloseTo(354.08, 2);
    expect(result.cappedByCash).toBe(true);
    expect(result.repay.remainingDebt).toBeCloseTo(16745 - 354.08, 2);
  });

  it("utilise le taux de la dette et n’en suppose jamais l’absence", () => {
    const free = compareDebtVsInvest({ ...base, debtRate: 0 });
    const costly = compareDebtVsInvest({ ...base, debtRate: 0.03 });
    expect(free.repay.interestAvoided).toBeCloseTo(0, 6);
    expect(costly.repay.interestAvoided).toBeCloseTo(5000 * (Math.pow(1.03, 5) - 1), 4);
    expect(costly.nominalSpread).toBeLessThan(free.nominalSpread);
  });

  it("applique l’inflation fournie aux positions réelles", () => {
    const low = compareDebtVsInvest({ ...base, inflation: 0.02 });
    const high = compareDebtVsInvest({ ...base, inflation: 0.035 });
    expect(Math.abs(high.invest.realPosition)).not.toBeCloseTo(
      Math.abs(low.invest.realPosition),
      2,
    );
  });

  it("n’émet aucune conclusion et isole les heuristiques", () => {
    const result = compareDebtVsInvest(base);
    expect("conclusion" in result).toBe(false);
    expect(result.experimental.riskHaircut).toBeGreaterThan(0);
    // Sans poids de liquidité explicite, l'heuristique ne crée aucune valeur.
    expect(compareDebtVsInvest(base).experimental.liquidityValue).toBe(0);
    expect(
      compareDebtVsInvest({ ...base, liquidityWeight: 0.03 }).experimental.liquidityValue,
    ).toBeCloseTo(5000 * 0.03, 6);
  });

  it("expose la liquidité restante de chaque option", () => {
    // Cash 8 000 pour une dette de 5 000 : 3 000 restent disponibles après remboursement.
    const result = compareDebtVsInvest({ ...base, availableCash: 8000, debtBalance: 5000 });
    expect(result.capital).toBeCloseTo(5000, 2);
    expect(result.cappedByCash).toBe(false);
    expect(result.repay.endingLiquidity).toBeCloseTo(3000, 2);
    expect(result.invest.endingLiquidity).toBeGreaterThan(result.repay.endingLiquidity);
  });

  it("supporte une dette nulle sans planter", () => {
    const result = compareDebtVsInvest({ ...base, debtBalance: 0 });
    expect(result.capital).toBe(0);
    expect(result.repay.interestAvoided).toBe(0);
  });
});
