import { describe, expect, it } from "vitest";
import { buildCloseChange, buildGoalTrajectory } from "../flow";
import { goalGap } from "@/lib/engine/goal-engine";
import { buildObligations } from "../obligations";
import type { MonthlyClose } from "@/lib/types";
import type { CanonicalEvent } from "@/lib/engine/event-contracts";

const close = (date: string, value: number): MonthlyClose => ({
  id: date,
  closeDate: date,
  createdAt: date,
  version: 1,
  reportingCurrency: "USD",
  completenessStatus: "COMPLETE",
  netWorth: value,
  grossAssets: value,
  debt: 0,
  forecastNetWorth: null,
  variance: null,
  composition: {
    immediate_cash: value,
    market_invested_assets: 0,
    investment_envelope_cash: 0,
    illiquid_assets: 0,
  },
});
describe("audit PR48 — vérité des valeurs affichées", () => {
  it("ne réétiquette pas une variation USD en EUR", () => {
    expect(
      buildCloseChange([close("2026-07-31", 100), close("2026-08-31", 120)], "EUR").view,
    ).toBeNull();
  });
  it("conserve 100 % quand une cible minimale est dépassée", () => {
    const target = {
      metric: "NET_WORTH",
      operator: "AT_LEAST",
      value: 100,
      currency: "EUR",
      entityId: null,
    } as const;
    const gap = goalGap(150, target);
    expect(
      buildGoalTrajectory({
        goalId: "g",
        name: "Cible",
        targetDate: null,
        relativeGap: gap.relativeGap,
        satisfiedNow: true,
        blockers: [],
      })?.progress,
    ).toBe(1);
  });
  it("ne chiffre pas une échéance dont une composante de trésorerie est inconnue", () => {
    const event = {
      id: "e",
      type: "LOAN_PAYMENT",
      domain: "DEBT",
      effectiveDate: "2026-09-10",
      sequence: 1,
      status: "PLANNED",
      dataKind: "CONTRACTUAL",
      consequences: [{ currency: "EUR", cashIn: 0, cashOut: null }],
    } as unknown as CanonicalEvent;
    expect(
      buildObligations({ events: [event], asOfDate: "2026-09-09", reportingCurrency: "EUR" })[0]
        ?.amount,
    ).toBeNull();
  });
});
