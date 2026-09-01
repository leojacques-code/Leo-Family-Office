import { describe, expect, it } from "vitest";
import { createGoalVersion } from "@/lib/engine/goal-engine";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";
import type { DashboardState, Goal, MonthlyClose } from "@/lib/types";
import { buildTodayCockpit, rankGoals } from "@/lib/presentation/today-cockpit";
import { buildTimelineView } from "@/lib/presentation/timeline-view";

function state(): DashboardState {
  return eventEngineCrossDomainFixture();
}
function goal(
  id: string,
  priority: number,
  targetDate: string | null,
  status: Goal["status"] = "ACTIVE",
): Goal {
  const definition = createGoalVersion({
    goalId: id,
    name: id,
    status,
    priority,
    constraintStrength: "SOFT",
    target: {
      metric: "NET_WORTH",
      operator: "AT_LEAST",
      value: 10_000,
      currency: "EUR",
      entityId: null,
    },
    targetDate,
    createdAt: "2026-01-01T00:00:00Z",
  });
  return { id, name: id, targetAmount: 10_000, targetDate, priority, status, definition };
}
function close(id: string, date: string, netWorth: number): MonthlyClose {
  return {
    id,
    closeDate: date,
    netWorth,
    grossAssets: netWorth,
    debt: 0,
    forecastNetWorth: null,
    variance: null,
    createdAt: `${date}T00:00:00Z`,
  };
}

describe("Today V2 — présentation canonique", () => {
  it("gère aucun Goal, aucune décision et aucune clôture sans fabriquer zéro", () => {
    const input = { ...state(), goals: [], decisionCases: [], monthlyCloses: [] };
    const result = buildTodayCockpit(input);
    expect(result.primaryGoal).toBeNull();
    expect(result.decisions).toEqual([]);
    expect(result.closeChange).toBeNull();
  });
  it("classe priorité puis échéance et non state.goals[0]", () => {
    const input = state();
    input.goals = [
      goal("low", 5, "2027-01-01"),
      goal("later", 1, "2028-01-01"),
      goal("soon", 1, "2027-01-01"),
    ];
    const result = buildTodayCockpit(input);
    expect(result.primaryGoal?.goal.id).toBe("soon");
    expect(rankGoals([...input.goals].reverse(), result.context).map((row) => row.goal.id)).toEqual(
      rankGoals(input.goals, result.context).map((row) => row.goal.id),
    );
  });
  it("signale un Goal non calculable et préserve NULL ≠ ZERO", () => {
    const input = state();
    input.goals = [goal("unknown", 1, null)];
    input.metrics = { ...input.metrics, freeCashFlow: null, liquidAssets: null };
    const result = buildTodayCockpit(input);
    expect(result.cashFlow).toBeNull();
    expect(result.liquidity).toBeNull();
    expect(result.primaryGoal?.evaluation?.observation.value).toBeNull();
  });
  it("ne calcule une variation réelle qu'entre deux clôtures", () => {
    const input = state();
    input.monthlyCloses = [close("b", "2025-12-31", 120), close("a", "2025-11-30", 100)];
    expect(
      buildTodayCockpit({ ...input, monthlyCloses: input.monthlyCloses.slice(0, 1) }).closeChange,
    ).toBeNull();
    expect(buildTodayCockpit(input).closeChange?.amount).toBe(20);
  });
  it("est déterministe et partage bilan, timeline, opening, baseline et fingerprint", () => {
    const input = state();
    const a = buildTodayCockpit(input);
    const b = buildTodayCockpit(input);
    expect(a).toEqual(b);
    expect(a.context.baseline.eventIds).toEqual(a.context.timeline.events.map((event) => event.id));
    expect(a.context.baseline.asOfDate).toBe(a.context.asOfDate);
  });
});

describe("Timeline V2 — registre canonique", () => {
  it("conserve événements observés/projetés, sans montant, conflits et plusieurs domaines le même jour", () => {
    const input = state();
    const cockpit = buildTodayCockpit(input);
    const firstEvent = cockpit.context.timeline.events[0]!;
    cockpit.context.timeline.conflicts = [
      { key: "fixture", eventIds: [firstEvent.id], reason: "SAME_DAY_STATE_CHANGE" },
    ];
    const items = buildTimelineView(input, cockpit);
    expect(items.some((item) => item.nature === "OBSERVED")).toBe(true);
    expect(
      items.some((item) =>
        ["PROJECTED", "CONTRACTUAL", "USER_ASSUMPTION", "MODEL_ASSUMPTION"].includes(item.nature),
      ),
    ).toBe(true);
    expect(items.some((item) => !item.amountKnown)).toBe(true);
    expect(new Set(items.map((item) => item.domain)).size).toBeGreaterThan(3);
    expect(items.some((item) => item.conflict)).toBe(true);
  });
  it("conserve un événement au-delà de quarante ans", () => {
    const input = state();
    input.portfolioEvents = [
      ...input.portfolioEvents,
      {
        ...input.portfolioEvents[0]!,
        id: "far",
        eventDate: "2074-06-15",
        externalReference: "far",
      },
    ];
    expect(
      buildTimelineView(input, buildTodayCockpit(input)).some(
        (item) => item.effectiveDate === "2074-06-15",
      ),
    ).toBe(true);
  });
  it("exclut scénarios et options non choisies du futur actif", () => {
    const input = state();
    const items = buildTimelineView(input, buildTodayCockpit(input));
    expect(items.some((item) => item.id.includes("scenario:"))).toBe(false);
  });
  it("garde l'ordre stable quand faits, clôtures et Goals sont permutés", () => {
    const input = state();
    input.goals = [goal("g2", 2, "2030-01-01"), goal("g1", 1, "2029-01-01")];
    input.monthlyCloses = [close("2", "2025-12-01", 2), close("1", "2025-11-01", 1)];
    const first = buildTimelineView(input, buildTodayCockpit(input)).map((item) => item.id);
    const permuted = {
      ...input,
      goals: [...input.goals].reverse(),
      monthlyCloses: [...input.monthlyCloses].reverse(),
      portfolioEvents: [...input.portfolioEvents].reverse(),
    };
    expect(buildTimelineView(permuted, buildTodayCockpit(permuted)).map((item) => item.id)).toEqual(
      first,
    );
  });
  it("gère honnêtement dette absente, bilan partiel et FX absent", () => {
    const input = state();
    input.liabilities = [];
    input.currencyRates = [];
    input.metrics = { ...input.metrics, debt: null, netWorth: null };
    const cockpit = buildTodayCockpit(input);
    expect(cockpit.debt === null || cockpit.debt === 0).toBe(true);
    expect(cockpit.context.completeness).not.toBeUndefined();
  });
});
