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

  it("rend exactement zéro d’intérêts évités sur une dette à 0 %", () => {
    const free = compareDebtVsInvest({ ...base, debtRate: 0 });
    expect(free.repay.interestAvoided).toBe(0);
    expect(free.interestAvoidedBlocker).toBeNull();
    expect(free.nominalSpread).toBeCloseTo(free.invest.expectedGain, 6);
  });

  it("n’invente aucun montant d’intérêts évités sur une dette amortissable", () => {
    const costly = compareDebtVsInvest({ ...base, debtRate: 0.03 });
    // Capitaliser le capital au taux du prêt supposerait une dette qui ne s'amortit
    // jamais. Sans convention de remboursement anticipé, la grandeur est NOT_COMPUTABLE.
    expect(costly.repay.interestAvoided).toBeNull();
    expect(costly.invest.interestStillDue).toBeNull();
    expect(costly.nominalSpread).toBeNull();
    expect(costly.experimental.opportunityAdvantage).toBeNull();
    expect(costly.interestAvoidedBlocker).toContain("remboursement anticipé");
  });

  it("garde comparables les grandeurs indépendantes de cette convention", () => {
    const costly = compareDebtVsInvest({ ...base, debtRate: 0.03 });
    expect(costly.capital).toBeCloseTo(5000, 2);
    expect(costly.invest.expectedEndingValue).toBeGreaterThan(5000);
    expect(costly.invest.endingLiquidity).toBeGreaterThan(costly.repay.endingLiquidity);
    expect(costly.repay.remainingDebt).toBeCloseTo(base.debtBalance - 5000, 2);
  });

  it("applique l’inflation fournie aux positions réelles calculables", () => {
    const low = compareDebtVsInvest({ ...base, inflation: 0.02 });
    const high = compareDebtVsInvest({ ...base, inflation: 0.035 });
    expect(low.invest.realPosition).not.toBeNull();
    expect(Math.abs(high.invest.realPosition as number)).not.toBeCloseTo(
      Math.abs(low.invest.realPosition as number),
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
