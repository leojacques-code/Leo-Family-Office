import { describe, expect, it } from "vitest";

import { buildDashboardEventTimeline } from "@/lib/engine/event-adapters";
import { monthlyEventImpact } from "@/lib/engine/event-engine";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";

describe("Event Engine cross-domain fixture", () => {
  const timeline = buildDashboardEventTimeline({
    state: eventEngineCrossDomainFixture(),
    startDate: "2026-01-01",
    endDate: "2031-12-31",
  });

  it("contains Career, Debt, Portfolio, Real Estate and Business", () => {
    expect(new Set(timeline.events.map((event) => event.domain))).toEqual(
      new Set(["CAREER", "TAX", "DEBT", "PORTFOLIO", "REAL_ESTATE", "BUSINESS"]),
    );
  });

  it("exposes the contractual salary in 2027", () => {
    expect(
      monthlyEventImpact(timeline.monthlyConsequences, "2027-01", "EUR").operatingSurplus,
    ).toBe(3_000);
  });

  it("records the 2028 property acquisition as capital, not expense", () => {
    const acquisition = timeline.monthlyConsequences.find(
      (item) => item.sourceEventId === "real-estate:33333333-3333-4333-8333-333333333333",
    );
    expect(acquisition).toMatchObject({
      cashOut: 100_000,
      assetDelta: 100_000,
      expense: 0,
    });
  });

  it("reconciles observed rent while retaining contractual property costs", () => {
    const impact = monthlyEventImpact(timeline.monthlyConsequences, "2028-05", "EUR");
    expect(impact.operatingSurplus).toBe(850);
  });

  it("records the 2029 business dividend as personal income", () => {
    const impact = monthlyEventImpact(timeline.monthlyConsequences, "2029-06", "EUR");
    expect(impact.operatingSurplus).toBe(5_900);
  });

  it("consumes Debt Engine principal in 2030", () => {
    const impact = monthlyEventImpact(timeline.monthlyConsequences, "2030-02", "EUR");
    expect(impact.debt).toMatchObject({ totalCashOut: 100, principal: 100, liabilityDelta: -100 });
  });

  it("keeps debt principal out of economic cost", () => {
    expect(
      monthlyEventImpact(timeline.monthlyConsequences, "2030-02", "EUR").debt.economicCost,
    ).toBe(0);
  });

  it("records the 2031 PEA withdrawal as capital, not income", () => {
    const withdrawal = timeline.monthlyConsequences.find(
      (item) => item.sourceEventId === "portfolio:pea-withdrawal-2031",
    );
    expect(withdrawal).toMatchObject({ cashIn: 10_000, income: 0, assetDelta: -10_000 });
  });

  it("does not invent tax for rent when no rule exists", () => {
    const rent = timeline.monthlyConsequences.find(
      (item) => item.sourceEventId.startsWith("real-estate-rent:") && item.month === "2028-05",
    );
    expect(rent?.taxCash).toBe(0);
  });

  it("does not count payslip withholding twice after Career Tax consumed it", () => {
    expect(
      monthlyEventImpact(timeline.monthlyConsequences, "2027-01", "EUR").operatingSurplus,
    ).toBe(3_000);
    expect(
      timeline.monthlyConsequences.find((item) => item.sourceDomain === "TAX")?.flags,
    ).toContain("CASH_INCLUDED_IN_CAREER_TAX_MONTH");
  });

  it("is deterministic when source arrays are copied", () => {
    const second = buildDashboardEventTimeline({
      state: eventEngineCrossDomainFixture(),
      startDate: "2026-01-01",
      endDate: "2031-12-31",
    });
    expect(second.monthlyConsequences.map((item) => item.id)).toEqual(
      timeline.monthlyConsequences.map((item) => item.id),
    );
  });

  it("has no silent same-day conflict in the fixture", () => {
    expect(timeline.conflicts).toEqual([]);
  });
});
