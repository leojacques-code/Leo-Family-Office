import { describe, expect, it } from "vitest";
import type { MonthlyClose } from "@/lib/types";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";
import { buildInstitutionalReport } from "./report-builder";
import { decisionFixture } from "./decision-fixture.test-helper";

const close = (id: string, date: string, netWorth: number | null): MonthlyClose => ({
  id,
  closeDate: date,
  netWorth,
  grossAssets: netWorth,
  debt: 0,
  forecastNetWorth: null,
  variance: null,
  version: 1,
  reportingCurrency: "EUR",
  completenessStatus: "COMPLETE",
  composition: {
    immediate_cash: netWorth,
    market_invested_assets: 0,
    investment_envelope_cash: 0,
    illiquid_assets: 0,
  },
  createdAt: `${date}T00:00:00Z`,
});
function history(closes: MonthlyClose[], annual = false) {
  const state = eventEngineCrossDomainFixture();
  state.monthlyCloses = closes;
  return buildInstitutionalReport(state, {
    type: annual ? "ANNUAL_REVIEW" : "MONTHLY_REVIEW",
    year: 2026,
  });
}
const summary = (report: ReturnType<typeof history>) =>
  report.sections.find((x) => x.id === "historical-summary")!;
const delta = (report: ReturnType<typeof history>) =>
  summary(report).amounts.find((x) => x.label === "Variation absolue")!.value;

describe("clôtures historiques fidèles", () => {
  it.each([false, true])(
    "retient la dernière version de chaque date (annuel=%s), indépendamment de l'ordre",
    (annual) => {
      const rows = [
        close("a", "2026-01-31", 100),
        close("b", "2026-02-28", 110),
        { ...close("c", "2026-02-28", 130), version: 2, createdAt: "2026-02-01T00:00:00Z" },
      ];
      expect(delta(history(rows, annual))).toBe(30);
      expect(history(rows, annual)).toEqual(history(rows.reverse(), annual));
      expect(
        delta(
          history(
            rows.filter((x) => x.closeDate === "2026-02-28"),
            annual,
          ),
        ),
      ).toBeNull();
      expect(
        history(
          rows.filter((x) => x.closeDate === "2026-02-28"),
          annual,
        ).manifest.blockers,
      ).toContain("SINGLE_CLOSE_POINT_IN_TIME_ONLY");
    },
  );
  it("bloque deux devises et conserve leur libellé historique", () => {
    const report = history([
      close("a", "2026-01-31", 100),
      { ...close("b", "2026-02-28", 110), reportingCurrency: "USD" },
    ]);
    expect(delta(report)).toBeNull();
    expect(
      summary(report)
        .amounts.slice(0, 2)
        .map((x) => x.currency),
    ).toEqual(["EUR", "USD"]);
    expect(report.manifest.blockers).toContain("HISTORICAL_CURRENCY_MISMATCH");
    expect(report.manifest.currency).toBe("MULTIPLE");
  });
  it.each([
    [{ reportingCurrency: null }, "HISTORICAL_CURRENCY_UNKNOWN"],
    [{ reportingCurrency: undefined }, "HISTORICAL_CURRENCY_UNKNOWN"],
    [{ completenessStatus: null }, "HISTORICAL_COMPLETENESS_UNKNOWN"],
    [{ completenessStatus: "UNKNOWN" }, "HISTORICAL_COMPLETENESS_UNKNOWN"],
    [{ completenessStatus: "PARTIAL" }, "HISTORICAL_CLOSE_INCOMPLETE"],
    [{ composition: {} }, "HISTORICAL_METHODOLOGY_UNKNOWN"],
    [{ version: null }, "HISTORICAL_VERSION_UNKNOWN"],
  ] as const)("bloque les métadonnées inconnues ou incomplètes %j", (patch, blocker) => {
    const report = history([
      close("a", "2026-01-31", 100),
      { ...close("b", "2026-02-28", 110), ...patch },
    ]);
    expect(delta(report)).toBeNull();
    expect(report.manifest.blockers).toContain(blocker);
    if ("reportingCurrency" in patch) expect(summary(report).amounts[1].currency).toBe("UNKNOWN");
  });
  it("bloque des conventions différentes", () => {
    const b = close("b", "2026-02-28", 110);
    b.composition!.methodologyVersion = "OTHER";
    expect(history([close("a", "2026-01-31", 100), b]).manifest.blockers).toContain(
      "HISTORICAL_METHODOLOGY_MISMATCH",
    );
  });
  it("NULL reste inconnu et zéro est une vraie valeur", () => {
    const b = close("b", "2026-02-28", 110);
    expect(delta(history([close("a", "2026-01-31", null), b]))).toBeNull();
    expect(summary(history([close("a", "2026-01-31", null), b])).amounts[0].value).toBeNull();
    expect(delta(history([close("a", "2026-01-31", 0), b]))).toBe(110);
  });
});

describe("publication Decision Lab", () => {
  it("publie un résultat CURRENT correspondant exactement à son run canonique", () => {
    const { state, decision } = decisionFixture();
    const report = buildInstitutionalReport(state, {
      type: "INVESTMENT_COMMITTEE_MEMO",
      decisionCaseId: decision.id,
    });
    expect(report.sections.find((x) => x.id === "impacts")).toMatchObject({
      status: "COMPUTABLE",
      items: [decision.latestResult!.conclusion],
      blockers: [],
    });
  });
  it.each([
    "version",
    "baseline",
    "date",
    "staleStatus",
    "otherRun",
    "resultVersion",
    "missingRun",
    "horizon",
    "events",
  ] as const)("masque totalement un résultat périmé : %s", (kind) => {
    const { state, decision } = decisionFixture();
    decision.latestResult = structuredClone(decision.latestResult!);
    if (kind === "version") decision.definition!.version++;
    if (kind === "baseline") decision.latestRun!.baselineFingerprint = "obsolete";
    if (kind === "date") decision.latestRun!.asOfDate = "2020-01-01";
    if (kind === "staleStatus") decision.latestRun!.staleStatus = "STALE_REFERENCE";
    if (kind === "otherRun") decision.latestResult!.run.id = "another-run";
    if (kind === "resultVersion") decision.latestResult!.caseVersion.version++;
    if (kind === "missingRun") decision.latestRun = undefined;
    if (kind === "horizon") decision.latestRun!.horizonMonths++;
    if (kind === "events") decision.latestResult!.provenance.baseline.eventSetVersion = "changed";
    const report = buildInstitutionalReport(state, {
      type: "INVESTMENT_COMMITTEE_MEMO",
      decisionCaseId: decision.id,
    });
    expect(report.sections.find((x) => x.id === "impacts")).toMatchObject({
      status: "NOT_COMPUTABLE",
      items: [],
      amounts: [],
    });
    expect(report.manifest.blockers.length).toBeGreaterThan(0);
    expect(report.sections.find((x) => x.id === "evidence")!.items.length).toBeGreaterThan(0);
  });
});

it("le rapport courant ne récupère pas une comparaison invalide via Today/Beyonder", () => {
  const state = eventEngineCrossDomainFixture();
  const a = close("a", "2026-01-31", 100);
  const b = { ...close("b", "2026-01-31", 110), version: 2 };
  state.monthlyCloses = [a, b];
  const report = buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" });
  expect(JSON.stringify(report)).not.toContain("Variation patrimoniale observée");
  state.monthlyCloses = [a, { ...close("c", "2026-02-28", 110), reportingCurrency: "USD" }];
  expect(
    JSON.stringify(buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" })),
  ).not.toContain("Variation patrimoniale observée");
});

it("une valeur manquante ou non finie n’est jamais publiée comme calculable", () => {
  const state = eventEngineCrossDomainFixture();
  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    state.metrics.freeCashFlow = value as unknown as number;
    expect(
      buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" }).sections.find(
        (x) => x.id === "cash-flow",
      )?.amounts[0],
    ).toMatchObject({ value: null, calculability: "NOT_COMPUTABLE" });
  }
});
