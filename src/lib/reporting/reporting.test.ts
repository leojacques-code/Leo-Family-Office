import { describe, expect, it } from "vitest";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";
import type { MonthlyClose } from "@/lib/types";
import { buildInstitutionalReport } from "./report-builder";
import { renderReportPdf } from "./report-pdf";

const close = (id: string, date: string, netWorth: number): MonthlyClose => ({
  id,
  version: 1,
  reportingCurrency: "EUR",
  completenessStatus: "COMPLETE",
  composition: {
    immediate_cash: netWorth,
    market_invested_assets: 0,
    investment_envelope_cash: 0,
    illiquid_assets: 0,
  },
  closeDate: date,
  netWorth,
  grossAssets: netWorth,
  debt: 0,
  forecastNetWorth: null,
  variance: null,
  createdAt: `${date}T00:00:00Z`,
});

describe("Institutional Reporting V1", () => {
  it("préserve NULL ≠ ZERO dans un bilan partiel", () => {
    const state = eventEngineCrossDomainFixture();
    state.metrics.freeCashFlow = null;
    const report = buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" });
    expect(report.sections.find((x) => x.id === "cash-flow")?.amounts[0]).toMatchObject({
      value: null,
      calculability: "NOT_COMPUTABLE",
    });
    state.metrics.freeCashFlow = 0;
    expect(
      buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" }).sections.find(
        (x) => x.id === "cash-flow",
      )?.amounts[0],
    ).toMatchObject({ value: 0, calculability: "COMPUTABLE" });
  });
  it("signale Goal, décision, fiscalité, immobilier et Business incomplets", () => {
    const state = eventEngineCrossDomainFixture();
    state.goals = [];
    state.decisionCases = [];
    state.taxCalculation = undefined;
    state.realEstateAssets = state.realEstateAssets.slice(0, 1);
    state.realEstateValuations = [];
    state.businesses = (state.businesses ?? []).slice(0, 1);
    state.businessValuations = [];
    const blockers = buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" }).manifest
      .blockers;
    expect(blockers).toEqual(
      expect.arrayContaining(["NO_GOAL", "NO_DECISION_CASE", "TAX_NOT_COMPUTABLE"]),
    );
  });
  it.each([
    [[], "NO_HISTORICAL_CLOSE"],
    [[close("a", "2026-01-31", 1)], "SINGLE_CLOSE_POINT_IN_TIME_ONLY"],
  ] as const)("gère zéro ou une clôture", (closes, blocker) => {
    const state = eventEngineCrossDomainFixture();
    state.monthlyCloses = [...closes];
    expect(buildInstitutionalReport(state, { type: "MONTHLY_REVIEW" }).manifest.blockers).toContain(
      blocker,
    );
  });
  it("trie plusieurs clôtures et calcule deux clôtures", () => {
    const state = eventEngineCrossDomainFixture();
    state.monthlyCloses = [
      close("c", "2026-03-31", 120),
      close("a", "2026-01-31", 100),
      close("b", "2026-02-28", 110),
    ];
    const report = buildInstitutionalReport(state, { type: "MONTHLY_REVIEW" });
    expect(report.manifest.period).toEqual({ from: "2026-02-28", to: "2026-03-31" });
    expect(
      report.sections
        .find((section) => section.id === "historical-summary")
        ?.amounts.find((x) => x.label === "Variation absolue")?.value,
    ).toBe(10);
  });
  it("n'invente pas une variation relative depuis zéro", () => {
    const state = eventEngineCrossDomainFixture();
    state.monthlyCloses = [close("a", "2026-01-31", 0), close("b", "2026-02-28", 10)];
    expect(
      buildInstitutionalReport(state, { type: "MONTHLY_REVIEW" })
        .sections.find((section) => section.id === "historical-summary")
        ?.amounts.find((x) => x.label === "Variation relative")?.value,
    ).toBeNull();
  });
  it("isole l'année et n'utilise pas l'état actuel comme historique", () => {
    const state = eventEngineCrossDomainFixture();
    state.monthlyCloses = [
      close("a", "2025-12-31", 90),
      close("b", "2026-01-31", 100),
      close("c", "2026-12-31", 130),
      close("d", "2027-01-31", 140),
    ];
    const report = buildInstitutionalReport(state, { type: "ANNUAL_REVIEW", year: 2026 });
    expect(report.manifest.period).toEqual({ from: "2026-01-31", to: "2026-12-31" });
    expect(report.sections.find((x) => x.id === "historical-composition")?.amounts).toHaveLength(8);
  });
  it("rend une année vide non calculable", () => {
    const state = eventEngineCrossDomainFixture();
    state.monthlyCloses = [];
    expect(
      buildInstitutionalReport(state, { type: "ANNUAL_REVIEW", year: 2020 }).manifest.blockers,
    ).toContain("NO_HISTORICAL_CLOSE");
  });
  it("rend un IC memo incomplet sans case et ne crée aucune option", () => {
    const state = eventEngineCrossDomainFixture();
    state.decisionCases = [];
    const report = buildInstitutionalReport(state, { type: "INVESTMENT_COMMITTEE_MEMO" });
    expect(report.manifest.blockers).toContain("DECISION_CASE_REQUIRED");
    expect(report.sections.flatMap((x) => x.items)).toHaveLength(0);
  });
  it("est invariant à la permutation des entrées", () => {
    const state = eventEngineCrossDomainFixture();
    const first = buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" });
    state.goals.reverse();
    state.accounts.reverse();
    state.monthlyCloses.reverse();
    const second = buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" });
    expect(second.manifest.financialFingerprint).toBe(first.manifest.financialFingerprint);
  });
  it("ne mute jamais l'état source", () => {
    const state = eventEngineCrossDomainFixture();
    const before = JSON.stringify(state);
    buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" });
    expect(JSON.stringify(state)).toBe(before);
  });
  it("produit un PDF déterministe lisible, paginé et hostile-safe", () => {
    const state = eventEngineCrossDomainFixture();
    state.goals.push({
      id: "hostile",
      name: "Épargne (test) \\ <script>alert(1)</script>",
      targetAmount: 1,
      targetDate: null,
      priority: 1,
      status: "ACTIVE",
    });
    const report = buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" });
    const a = Buffer.from(renderReportPdf(report, "2026-09-02T10:00:00Z"));
    const b = Buffer.from(renderReportPdf(report, "2026-09-02T10:00:00Z"));
    expect(a.subarray(0, 4).toString()).toBe("%PDF");
    expect(a.length).toBeGreaterThan(1_000);
    expect(a.equals(b)).toBe(true);
    expect(a.toString("latin1")).not.toContain("/JavaScript");
  });
});
