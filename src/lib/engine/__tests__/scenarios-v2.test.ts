import { describe, expect, it } from "vitest";
import type { Scenario } from "@/lib/types";
import type { PersistedScenarioEventOverride } from "@/lib/engine/scenario-contracts";
import {
  buildBaselineReference,
  createScenarioVersion,
  legacyScenarioDefinition,
  prepareScenarioTimeline,
  runScenarioComparison,
  scenarioFingerprint,
} from "@/lib/engine/scenario-engine";
import { buildCanonicalTimeline } from "@/lib/engine/event-engine";
import {
  SCENARIO_AS_OF,
  scenarioEvent,
  scenarioOpening,
} from "@/lib/engine/__tests__/fixtures/scenarios-v2";

const add = (
  id: string,
  event: ReturnType<typeof scenarioEvent> | null,
): PersistedScenarioEventOverride => ({
  id,
  operation: "ADD",
  baselineEventId: null,
  event,
  reason: "test",
  createdAt: "2026-08-28T08:00:00.000Z",
});

const replace = (
  id: string,
  baselineEventId: string,
  event: ReturnType<typeof scenarioEvent> | null,
): PersistedScenarioEventOverride => ({
  id,
  operation: "REPLACE",
  baselineEventId,
  event,
  reason: "test",
  createdAt: "2026-08-28T08:00:00.000Z",
});

const cancel = (id: string, baselineEventId: string): PersistedScenarioEventOverride => ({
  id,
  operation: "CANCEL",
  baselineEventId,
  event: null,
  reason: "test",
  createdAt: "2026-08-28T08:00:00.000Z",
});

function definition(
  overrides: PersistedScenarioEventOverride[] = [],
  options: { horizonMonths?: number; annualReturn?: number | null; allocation?: number } = {},
) {
  return createScenarioVersion({
    scenarioId: "scenario-v2",
    asOfDate: SCENARIO_AS_OF,
    horizonMonths: options.horizonMonths ?? 24,
    overrides,
    market: { annualReturn: options.annualReturn ?? 0, annualVolatility: 0 },
    investmentAllocationRate: options.allocation ?? 0,
  });
}

function compare(
  baselineEvents: ReturnType<typeof scenarioEvent>[] = [],
  overrides: PersistedScenarioEventOverride[] = [],
  options: { horizonMonths?: number; annualReturn?: number | null; allocation?: number } = {},
) {
  return runScenarioComparison({
    baselineEvents,
    opening: scenarioOpening,
    definition: definition(overrides, options),
    baselineMarket: {
      annualReturn: 0,
      annualVolatility: 0,
      annualInflation: 0,
      stressProbability: 0,
      shockYear: null,
      shockMagnitude: null,
      randomVariables: ["PORTFOLIO_RETURN"],
    },
  });
}

describe("Scenarios V2 — golden contract", () => {
  it("1. baseline sans override conserve exactement la trajectoire", () => {
    const result = compare();
    expect(result.points.every((point) => point.delta.netWorth === 0)).toBe(true);
    expect(result.completeness).toBe("READY");
  });

  it("2. ADD ajoute un événement à la timeline alternative", () => {
    const event = scenarioEvent({ id: "gift", date: "2026-09-10", cashIn: 10_000 });
    const result = compare([], [add("add-gift", event)]);
    expect(result.scenario.timeline.events.map((item) => item.id)).toContain("gift");
    expect(result.points[1].delta.cash).toBe(10_000);
  });

  it("3. REPLACE supersède la cible baseline", () => {
    const oldSalary = scenarioEvent({
      id: "salary-old",
      date: "2026-09-01",
      domain: "CAREER",
      type: "COMPENSATION_CHANGE",
      cashIn: 3_000,
      income: 3_000,
    });
    const newSalary = scenarioEvent({
      id: "salary-new",
      date: "2026-09-01",
      domain: "CAREER",
      type: "COMPENSATION_CHANGE",
      cashIn: 5_000,
      income: 5_000,
    });
    const result = compare([oldSalary], [replace("replace-salary", oldSalary.id, newSalary)]);
    expect(result.scenario.timeline.events.find((item) => item.id === oldSalary.id)?.status).toBe(
      "SUPERSEDED",
    );
    expect(result.points[1].delta.cash).toBe(2_000);
  });

  it("4. CANCEL neutralise les conséquences futures ciblées", () => {
    const purchase = scenarioEvent({ id: "purchase", date: "2026-09-05", cashOut: 4_000 });
    const result = compare([purchase], [cancel("cancel-purchase", purchase.id)]);
    expect(result.scenario.timeline.events[0]?.status).toBe("CANCELLED");
    expect(result.points[1].delta.cash).toBe(4_000);
  });

  it("5. l'application des overrides ne mute ni baseline ni définition", () => {
    const baseline = [scenarioEvent({ id: "future", date: "2026-10-01", cashIn: 1_000 })];
    const version = definition([cancel("cancel-future", "future")]);
    const before = JSON.stringify({ baseline, version });
    prepareScenarioTimeline({ baselineEvents: baseline, definition: version });
    expect(JSON.stringify({ baseline, version })).toBe(before);
  });

  it("6. deux calculs déterministes sont byte-for-byte identiques", () => {
    const event = scenarioEvent({ id: "deterministic", date: "2027-01-01", cashIn: 900 });
    expect(compare([], [add("add", event)])).toEqual(compare([], [add("add", event)]));
  });

  it("7. même scénario et mêmes inputs produisent le même fingerprint", () => {
    const version = definition();
    expect(scenarioFingerprint(version)).toBe(scenarioFingerprint(structuredClone(version)));
  });

  it("8. l'historique antérieur au cut-off est protégé", () => {
    const historical = scenarioEvent({
      id: "historical",
      date: "2026-08-20",
      dataKind: "OBSERVED",
      recognition: "ACTUAL",
      cashIn: 500,
    });
    const result = compare([], [add("rewrite-history", historical)]);
    expect(result.completeness).toBe("NOT_COMPUTABLE");
    expect(result.blockers.map((item) => item.code)).toContain("HISTORY_PROTECTED");
  });

  it("9. un événement contractuel futur reste dans la baseline", () => {
    const contractual = scenarioEvent({
      id: "contractual",
      date: "2027-01-01",
      dataKind: "CONTRACTUAL",
      cashOut: 800,
    });
    expect(compare([contractual]).baseline.timeline.events.map((item) => item.id)).toContain(
      contractual.id,
    );
  });

  it("10. un changement de salaire Career modifie revenu et cash", () => {
    const salary = scenarioEvent({
      id: "salary",
      date: "2026-09-01",
      domain: "CAREER",
      type: "COMPENSATION_CHANGE",
      cashIn: 4_500,
      income: 4_500,
    });
    const result = compare([], [add("salary-change", salary)]);
    expect(result.points[1].scenario.income).toBe(4_500);
    expect(result.points[1].delta.cash).toBe(4_500);
  });

  it("11. un début d'emploi Career est ordonné comme state change", () => {
    const start = scenarioEvent({
      id: "job-start",
      date: "2027-01-01",
      domain: "CAREER",
      type: "EMPLOYMENT_START",
      shape: "STATE_CHANGE",
    });
    const result = compare([], [add("job-start-overlay", start)]);
    expect(result.scenario.timeline.events[0]?.type).toBe("EMPLOYMENT_START");
  });

  it("12. une fin d'emploi peut exister sans inventer de conséquence", () => {
    const end = scenarioEvent({
      id: "job-end",
      date: "2027-06-01",
      domain: "CAREER",
      type: "EMPLOYMENT_END",
      shape: "STATE_CHANGE",
    });
    const result = compare([], [add("job-end-overlay", end)]);
    expect(result.scenario.timeline.events[0]?.type).toBe("EMPLOYMENT_END");
  });

  it("13. une période de chômage remplace le revenu sans règle de salaire locale", () => {
    const salary = scenarioEvent({
      id: "salary",
      date: "2026-09-01",
      cashIn: 3_000,
      income: 3_000,
    });
    const unemployment = scenarioEvent({
      id: "unemployment",
      date: "2026-09-01",
      domain: "CAREER",
      type: "EMPLOYMENT_END",
      cashIn: 0,
      income: 0,
    });
    const result = compare([salary], [replace("unemployment-period", salary.id, unemployment)]);
    expect(result.points[1].delta.income).toBe(-3_000);
  });

  it("14. une conséquence Tax diminue la liquidité", () => {
    const tax = scenarioEvent({
      id: "tax",
      date: "2026-09-15",
      domain: "TAX",
      type: "TAX_PAYMENT",
      effectKind: "TAX",
      cashOut: 1_200,
      taxCash: 1_200,
    });
    const result = compare([], [add("tax-overlay", tax)]);
    expect(result.points[1].delta.cash).toBe(-1_200);
    expect(result.points[1].scenario.taxes).toBe(1_200);
  });

  it("15. un nouveau prêt augmente cash et passif sans créer de net worth", () => {
    const loan = scenarioEvent({
      id: "loan-start",
      date: "2026-09-01",
      domain: "DEBT",
      type: "LOAN_START",
      effectKind: "CAPITAL_MOVEMENT",
      cashIn: 20_000,
      liabilityDelta: 20_000,
    });
    const result = compare([], [add("loan", loan)]);
    expect(result.points[1].delta.netWorth).toBe(0);
    expect(result.points[1].delta.debt).toBe(20_000);
  });

  it("16. le remboursement de principal est neutre en net worth", () => {
    const payment = scenarioEvent({
      id: "loan-payment",
      date: "2026-09-05",
      domain: "DEBT",
      type: "LOAN_PAYMENT",
      effectKind: "DEBT_SERVICE",
      cashOut: 10_000,
      debtPrincipal: 10_000,
      liabilityDelta: -10_000,
    });
    const result = compare([], [add("payment", payment)]);
    expect(result.points[1].delta.cash).toBe(-10_000);
    expect(result.points[1].delta.debt).toBe(-10_000);
    expect(result.points[1].delta.netWorth).toBe(0);
  });

  it("17. un remboursement anticipé utilise la même conséquence Debt", () => {
    const repayment = scenarioEvent({
      id: "early-repayment",
      date: "2027-01-01",
      domain: "DEBT",
      type: "EARLY_REPAYMENT",
      effectKind: "DEBT_SERVICE",
      cashOut: 5_000,
      debtPrincipal: 5_000,
      liabilityDelta: -5_000,
    });
    const result = compare([], [add("early", repayment)]);
    expect(result.scenario.timeline.events[0]?.type).toBe("EARLY_REPAYMENT");
    expect(result.points[5].delta.netWorth).toBe(0);
  });

  it("18. un refinance est représenté comme événement Debt explicite", () => {
    const refinance = scenarioEvent({
      id: "refinance",
      date: "2027-02-01",
      domain: "DEBT",
      type: "REFINANCE",
      shape: "STATE_CHANGE",
    });
    expect(compare([], [add("refi", refinance)]).humanDiff[0]).toContain("REFINANCE");
  });

  it("19. une contribution portefeuille est un transfert patrimonial neutre", () => {
    const contribution = scenarioEvent({
      id: "contribution",
      date: "2026-09-01",
      domain: "PORTFOLIO",
      type: "CONTRIBUTION",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 10_000,
      assetDelta: 10_000,
    });
    const result = compare([], [add("contribution", contribution)]);
    expect(result.points[1].delta.netWorth).toBe(0);
    expect(result.points[1].delta.investmentAssets).toBe(10_000);
  });

  it("20. un retrait portefeuille est un transfert inverse neutre", () => {
    const withdrawal = scenarioEvent({
      id: "withdrawal",
      date: "2026-09-01",
      domain: "PORTFOLIO",
      type: "WITHDRAWAL",
      effectKind: "CAPITAL_MOVEMENT",
      cashIn: 10_000,
      assetDelta: -10_000,
    });
    const result = compare([], [add("withdrawal", withdrawal)]);
    expect(result.points[1].delta.netWorth).toBe(0);
    expect(result.points[1].delta.cash).toBe(10_000);
  });

  it("21. le rendement ne s'applique qu'au capital exposé", () => {
    const result = compare([], [], { annualReturn: 0.12, horizonMonths: 12 });
    expect(result.points.at(-1)?.delta.investmentAssets).toBeGreaterThan(0);
    expect(result.points.at(-1)?.delta.cash).toBe(0);
  });

  it("22. une acquisition immobilière préserve la neutralité du transfert", () => {
    const acquisition = scenarioEvent({
      id: "property",
      date: "2026-09-01",
      domain: "REAL_ESTATE",
      type: "ACQUISITION",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 80_000,
      assetDelta: 80_000,
    });
    const result = compare([], [add("property", acquisition)]);
    expect(result.points[1].delta.netWorth).toBe(0);
    expect(result.points[1].delta.realEstateAndBusinessAssets).toBe(80_000);
  });

  it("23. une vente immobilière réduit l'actif et libère le cash", () => {
    const sale = scenarioEvent({
      id: "property-sale",
      date: "2026-09-01",
      domain: "REAL_ESTATE",
      type: "DISPOSAL",
      effectKind: "CAPITAL_MOVEMENT",
      cashIn: 50_000,
      assetDelta: -50_000,
    });
    const result = compare([], [add("sale", sale)]);
    expect(result.points[1].delta.netWorth).toBe(0);
    expect(result.points[1].delta.cash).toBe(50_000);
  });

  it("24. des travaux non financés peuvent créer un funding gap", () => {
    const works = scenarioEvent({
      id: "works",
      date: "2026-09-01",
      domain: "REAL_ESTATE",
      type: "WORKS_PAYMENT",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 150_000,
      assetDelta: 150_000,
    });
    const result = compare([], [add("works", works)]);
    expect(result.scenario.monthly[1].fundingGap).toBe(50_000);
    expect(result.completeness).toBe("PARTIAL");
  });

  it("25. un changement de loyer reste une conséquence Real Estate", () => {
    const rent = scenarioEvent({
      id: "rent-change",
      date: "2026-09-01",
      domain: "REAL_ESTATE",
      type: "RENT_CHANGE",
      cashIn: 900,
      income: 900,
    });
    const result = compare([], [add("rent", rent)]);
    expect(result.points[1].scenario.income).toBe(900);
  });

  it("26. un dividende Business produit du cash sans valuation implicite", () => {
    const dividend = scenarioEvent({
      id: "business-dividend",
      date: "2026-09-01",
      domain: "BUSINESS",
      type: "DIVIDEND",
      cashIn: 30_000,
      income: 30_000,
    });
    const result = compare([], [add("dividend", dividend)]);
    expect(result.points[1].delta.cash).toBe(30_000);
    expect(result.points[1].delta.realEstateAndBusinessAssets).toBe(0);
  });

  it("27. une cession Business échange equity contre cash", () => {
    const sale = scenarioEvent({
      id: "business-sale",
      date: "2026-09-01",
      domain: "BUSINESS",
      type: "DISPOSAL",
      effectKind: "CAPITAL_MOVEMENT",
      cashIn: 40_000,
      assetDelta: -40_000,
    });
    const result = compare([], [add("business-sale", sale)]);
    expect(result.points[1].delta.netWorth).toBe(0);
  });

  it("28. une observation de valorisation ne produit aucun cash", () => {
    const valuation = scenarioEvent({
      id: "valuation",
      date: "2026-09-01",
      domain: "BUSINESS",
      type: "VALUATION_OBSERVATION",
      effectKind: "VALUATION",
      assetDelta: 20_000,
    });
    const result = compare([], [add("valuation", valuation)]);
    expect(result.points[1].delta.cash).toBe(0);
    expect(result.points[1].delta.netWorth).toBe(20_000);
  });

  it("29. un besoin supérieur au cash devient FUNDING_GAP", () => {
    const purchase = scenarioEvent({
      id: "large-purchase",
      date: "2026-09-01",
      type: "LARGE_PURCHASE",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 120_000,
    });
    const result = compare([], [add("purchase", purchase)]);
    expect(result.scenario.monthly[1].fundingGap).toBe(20_000);
    expect(result.blockers.map((item) => item.code)).toContain("FUNDING_GAP");
  });

  it("30. la trésorerie ne devient jamais négative", () => {
    const purchase = scenarioEvent({
      id: "huge-purchase",
      date: "2026-09-01",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 500_000,
    });
    const result = compare([], [add("huge", purchase)]);
    expect(result.scenario.monthly.every((point) => point.cash >= 0)).toBe(true);
  });

  it("31. salaire attendu et observation bancaire ne doublent pas le cash", () => {
    const expected = scenarioEvent({
      id: "salary-expected",
      date: "2026-09-25",
      domain: "CAREER",
      cashIn: 5_000,
      income: 5_000,
      reconciliationKey: "salary:role-1:2026-09",
    });
    const actual = scenarioEvent({
      id: "salary-actual",
      date: "2026-09-25",
      domain: "CASH_FLOW",
      cashIn: 4_800,
      income: 4_800,
      recognition: "ACTUAL",
      dataKind: "OBSERVED",
      reconciliationKey: "salary:role-1:2026-09",
    });
    const result = compare([expected, actual]);
    expect(result.baseline.monthly[1].cash - scenarioOpening.bankCash).toBe(4_800);
  });

  it("32. débit bancaire de dette et schedule ne doublent pas le cash", () => {
    const schedule = scenarioEvent({
      id: "debt-schedule",
      date: "2026-09-10",
      domain: "DEBT",
      type: "LOAN_PAYMENT",
      effectKind: "DEBT_SERVICE",
      cashOut: 1_000,
      debtPrincipal: 800,
      debtInterest: 200,
      liabilityDelta: -800,
      economicCost: 200,
      reconciliationKey: "debt:loan-1:2026-09",
    });
    const actual = scenarioEvent({
      id: "debt-actual",
      date: "2026-09-10",
      domain: "CASH_FLOW",
      type: "OBSERVED_TRANSACTION",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 1_000,
      recognition: "ACTUAL",
      dataKind: "OBSERVED",
      reconciliationKey: "debt:loan-1:2026-09",
    });
    const result = compare([schedule, actual]);
    expect(result.baseline.monthly[1].cash).toBe(99_000);
    expect(result.baseline.monthly[1].debt).toBe(34_200);
  });

  it("33. loyer attendu et reçu bancaire ne doublent pas", () => {
    const expected = scenarioEvent({
      id: "rent-expected",
      date: "2026-09-05",
      domain: "REAL_ESTATE",
      type: "RENT_RECEIPT",
      cashIn: 900,
      income: 900,
      reconciliationKey: "rent:property-1:2026-09",
    });
    const actual = scenarioEvent({
      id: "rent-actual",
      date: "2026-09-05",
      domain: "CASH_FLOW",
      type: "OBSERVED_TRANSACTION",
      cashIn: 880,
      income: 880,
      recognition: "ACTUAL",
      dataKind: "OBSERVED",
      reconciliationKey: "rent:property-1:2026-09",
    });
    expect(compare([expected, actual]).baseline.monthly[1].cash).toBe(100_880);
  });

  it("34. contribution portefeuille et transfert bancaire ne doublent pas", () => {
    const expected = scenarioEvent({
      id: "portfolio-expected",
      date: "2026-09-05",
      domain: "PORTFOLIO",
      type: "CONTRIBUTION",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 5_000,
      assetDelta: 5_000,
      reconciliationKey: "portfolio:account-1:event-1",
    });
    const actual = scenarioEvent({
      id: "portfolio-actual",
      date: "2026-09-05",
      domain: "CASH_FLOW",
      type: "OBSERVED_TRANSACTION",
      effectKind: "CAPITAL_MOVEMENT",
      cashOut: 5_000,
      recognition: "ACTUAL",
      dataKind: "OBSERVED",
      reconciliationKey: "portfolio:account-1:event-1",
    });
    const result = compare([expected, actual]);
    expect(result.baseline.monthly[1].cash).toBe(95_000);
    expect(result.baseline.monthly[1].investmentAssets).toBe(65_000);
  });

  it("35. dividende Business et reçu bancaire ne doublent pas", () => {
    const expected = scenarioEvent({
      id: "business-expected",
      date: "2026-09-05",
      domain: "BUSINESS",
      type: "DIVIDEND",
      cashIn: 2_000,
      income: 2_000,
      reconciliationKey: "business:company-1:dividend-1",
    });
    const actual = scenarioEvent({
      id: "business-actual",
      date: "2026-09-05",
      domain: "CASH_FLOW",
      type: "OBSERVED_TRANSACTION",
      cashIn: 1_900,
      income: 1_900,
      recognition: "ACTUAL",
      dataKind: "OBSERVED",
      reconciliationKey: "business:company-1:dividend-1",
    });
    expect(compare([expected, actual]).baseline.monthly[1].cash).toBe(101_900);
  });

  it("36. une devise native étrangère est conservée", () => {
    const usd = scenarioEvent({ id: "usd", date: "2026-09-01", currency: "USD", cashIn: 1_000 });
    const result = compare([], [add("usd", usd)]);
    expect(result.scenario.timeline.monthlyConsequences[0]?.currency).toBe("USD");
  });

  it("37. un FX manquant devient blocker sans conversion implicite", () => {
    const usd = scenarioEvent({ id: "usd", date: "2026-09-01", currency: "USD", cashIn: 1_000 });
    const result = compare([], [add("usd", usd)]);
    expect(result.scenario.monthly[1].cash).toBe(scenarioOpening.bankCash);
    expect(result.scenario.blockers.some((item) => item.code === "FX_RATE_REQUIRED")).toBe(true);
  });

  it("38. une taxe non calculable rend le scénario partiel", () => {
    const tax = scenarioEvent({
      id: "tax-missing",
      date: "2026-09-01",
      domain: "TAX",
      type: "TAX_ASSESSMENT",
      blockers: ["MISSING_TAX_RULES"],
      status: "NOT_COMPUTABLE",
      cashOut: null,
    });
    const result = compare([], [add("tax", tax)]);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.blockers.map((item) => item.code)).toContain("MISSING_TAX_RULES");
  });

  it("39. un overlay incomplet existe mais ne disparaît pas silencieusement", () => {
    const result = compare([], [add("incomplete", null)]);
    expect(result.blockers.map((item) => item.code)).toContain("PARTIAL_CONSEQUENCE");
  });

  it("40. baseline et scénario partagent une grille mensuelle identique", () => {
    const result = compare([], [], { horizonMonths: 30 });
    expect(result.points).toHaveLength(31);
    expect(result.points.every((point) => point.baseline.date === point.scenario.date)).toBe(true);
  });

  it("41. le delta est exactement scenario moins baseline", () => {
    const gift = scenarioEvent({ id: "gift", date: "2026-09-01", cashIn: 7_000 });
    const point = compare([], [add("gift", gift)]).points[1];
    expect(point.delta.netWorth).toBe(point.scenario.netWorth - point.baseline.netWorth);
  });

  it("42. les événements du même jour ont un ordre canonique stable", () => {
    const events = [
      scenarioEvent({ id: "tax", date: "2027-01-01", domain: "TAX", type: "TAX_PAYMENT" }),
      scenarioEvent({
        id: "career",
        date: "2027-01-01",
        domain: "CAREER",
        type: "EMPLOYMENT_START",
        shape: "STATE_CHANGE",
      }),
      scenarioEvent({
        id: "debt",
        date: "2027-01-01",
        domain: "DEBT",
        type: "LOAN_PAYMENT",
        effectKind: "DEBT_SERVICE",
      }),
    ];
    const ids = compare(events).baseline.timeline.events.map((event) => event.id);
    expect(ids).toEqual(["career", "tax", "debt"]);
  });

  it("43. la convention de frontière mensuelle est respectée", () => {
    const september = scenarioEvent({ id: "sep", date: "2026-09-30", cashIn: 100 });
    const october = scenarioEvent({ id: "oct", date: "2026-10-01", cashIn: 200 });
    const result = compare([], [add("sep", september), add("oct", october)]);
    expect(result.scenario.monthly[1].cash).toBe(100_100);
    expect(result.scenario.monthly[2].cash).toBe(100_300);
  });

  it("44. une version donnée reste reproductible après création d'une version suivante", () => {
    const v1 = definition([], { horizonMonths: 12 });
    const before = runScenarioComparison({
      baselineEvents: [],
      opening: scenarioOpening,
      definition: v1,
    });
    const v2 = { ...v1, version: 2, market: { ...v1.market, annualReturn: 0.08 } };
    runScenarioComparison({ baselineEvents: [], opening: scenarioOpening, definition: v2 });
    const after = runScenarioComparison({
      baselineEvents: [],
      opening: scenarioOpening,
      definition: v1,
    });
    expect(after).toEqual(before);
  });

  it("45. un horizon de 40 ans produit 481 états mensuels", () => {
    const result = compare([], [], { horizonMonths: 40 * 12 });
    expect(result.scenario.monthly).toHaveLength(481);
    expect(result.scenario.annual).toHaveLength(41);
  });

  it("46. l'inventaire d'hypothèses est exposé sans recomposition", () => {
    const version = definition();
    version.assumptions = [
      {
        key: "salary.future",
        label: "Salaire futur",
        value: 85_000,
        unit: "EUR/year",
        currency: "EUR",
        effectiveDate: "2027-01-01",
        kind: "USER_ASSUMPTION",
        source: "Utilisateur",
      },
    ];
    const result = runScenarioComparison({
      baselineEvents: [],
      opening: scenarioOpening,
      definition: version,
    });
    expect(result.assumptions).toEqual(version.assumptions);
  });

  it("47. le diff humain résume les opérations et événements", () => {
    const event = scenarioEvent({
      id: "job",
      date: "2027-07-01",
      domain: "CAREER",
      type: "EMPLOYMENT_START",
    });
    const result = compare([], [add("job", event)]);
    expect(result.humanDiff).toEqual(["+ 2027-07-01 EMPLOYMENT_START"]);
  });

  it("48. la référence baseline contient opening et event set fingerprints", () => {
    const timeline = buildCanonicalTimeline({
      events: [],
      startDate: SCENARIO_AS_OF,
      endDate: "2027-08-31",
    });
    const reference = buildBaselineReference({ opening: scenarioOpening, timeline });
    expect(reference.openingFingerprint).toMatch(/^fnv1a32:/);
    expect(reference.eventSetVersion).toMatch(/^fnv1a32:/);
  });

  it("49. un changement réel rend le fingerprint baseline différent", () => {
    expect(scenarioFingerprint(scenarioOpening)).not.toBe(
      scenarioFingerprint({ ...scenarioOpening, bankCash: scenarioOpening.bankCash + 1 }),
    );
  });

  it("50. une cible REPLACE absente bloque explicitement", () => {
    const event = scenarioEvent({ id: "replacement", date: "2027-01-01" });
    const result = compare([], [replace("missing", "not-found", event)]);
    expect(result.blockers.map((item) => item.code)).toContain("OVERRIDE_TARGET_MISSING");
    expect(result.completeness).toBe("NOT_COMPUTABLE");
  });

  it("51. deux overlays de même identité sont refusés", () => {
    const event = scenarioEvent({ id: "event", date: "2027-01-01" });
    const result = compare([], [add("duplicate", event), add("duplicate", event)]);
    expect(result.blockers.map((item) => item.code)).toContain("OVERRIDE_CONFLICT");
  });

  it("52. un cut-off sans bilan correspondant est NOT_COMPUTABLE", () => {
    const version = { ...definition(), asOfDate: "2026-09-01" };
    const result = runScenarioComparison({
      baselineEvents: [],
      opening: scenarioOpening,
      definition: version,
    });
    expect(result.completeness).toBe("NOT_COMPUTABLE");
    expect(result.blockers[0]?.code).toBe("BASELINE_UNAVAILABLE");
  });

  it("53. la compatibilité legacy produit une définition V2 explicite", () => {
    const legacy: Scenario = {
      id: "legacy",
      name: "Central",
      description: "Legacy",
      version: 1,
      color: "#000",
      annualReturn: 0.05,
      annualVolatility: 0.15,
      annualInflation: 0.02,
      monthlySavings: 1_000,
      investmentAllocationRate: 0.8,
      salaryGrowth: 0.03,
      stressProbability: 0.01,
      shockYear: null,
      shockMagnitude: null,
      provenance: { kind: "USER_ASSUMPTION", confidence: "HIGH", source: "legacy" },
    };
    const converted = legacyScenarioDefinition(legacy, SCENARIO_AS_OF, 360);
    expect(converted.schemaVersion).toBe(2);
    expect(converted.legacyCompatibility?.monthlySavings).toBe(1_000);
    expect(converted.assumptions).toHaveLength(4);
  });

  it("54. le Month 0 reste strictement le bilan canonique", () => {
    const event = scenarioEvent({ id: "future", date: "2026-09-01", cashIn: 20_000 });
    const result = compare([], [add("future", event)], { annualReturn: 0.12 });
    expect(result.scenario.monthly[0].netWorth).toBe(scenarioOpening.netWorth);
    expect(result.scenario.monthly[0].cash).toBe(scenarioOpening.bankCash);
  });
});
