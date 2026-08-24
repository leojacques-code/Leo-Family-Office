import { describe, expect, it } from "vitest";
import { mapScenario, validateSimulationRun } from "@/lib/data/supabase-repository";
import { readLoanTerms } from "@/lib/data/shared";
import { SUPABASE_CATEGORY_SEED } from "@/lib/data/supabase-seed-data";
import { percentile } from "@/lib/engine/monte-carlo";

const scenarioRow = {
  id: "scenario-1",
  name: "Central",
  description: "Test",
  current_version: 2,
  color: "#000",
  annual_return: 0.05,
  annual_volatility: 0.15,
  annual_inflation: 0.02,
  monthly_savings: 250,
  investment_allocation_rate: 1,
  salary_growth: 0.03,
  stress_probability: 0.02,
  shock_year: null,
  shock_magnitude: null,
  data_kind: "MODEL_ASSUMPTION",
  confidence: "MEDIUM",
};

describe("mapping Supabase strict", () => {
  it("mappe un scénario complet sans fallback", () => {
    expect(mapScenario(scenarioRow).investmentAllocationRate).toBe(1);
  });

  it("refuse une colonne de scénario absente et une valeur non finie", () => {
    const incomplete = Object.fromEntries(
      Object.entries(scenarioRow).filter(([key]) => key !== "investment_allocation_rate"),
    );
    expect(() => mapScenario(incomplete)).toThrow(/investment_allocation_rate/);
    expect(() => mapScenario({ ...scenarioRow, annual_return: Number.NaN })).toThrow(
      /annual_return/,
    );
  });

  it("mappe les champs Debt V2 et V2.1 sans défaut de compatibilité", () => {
    const terms = readLoanTerms(
      {
        id: "liability-1",
        monthly_insurance: 12,
        recurring_fees: 3,
        payment_includes_insurance: false,
        deferral_kind: "TOTAL",
        deferral_months: 2,
        deferral_interest_treatment: "CAPITALISED",
        amortisation_profile: "BALLOON",
        balloon_amount: 5000,
        payment_frequency: "QUARTERLY",
        interest_convention: "ACTUAL_365",
        rate_type: "VARIABLE",
        facility_id: "facility-1",
      },
      {
        schedules: [
          {
            liability_id: "liability-1",
            data_kind: "ACTUAL",
            payment_number: 1,
            due_date: "2026-09-01",
            opening_balance: 10000,
            interest: 100,
            principal: 500,
            insurance: 12,
            fees: 3,
            closing_balance: 9500,
          },
        ],
        earlyRepayments: [],
        charges: [],
        rateChanges: [],
        paymentChanges: [],
      },
    );
    expect(terms).toMatchObject({
      monthlyInsurance: 12,
      recurringFees: 3,
      amortisationProfile: "BALLOON",
      balloonAmount: 5000,
      paymentFrequency: "QUARTERLY",
      interestConvention: "ACTUAL_365",
      rateType: "VARIABLE",
      facilityId: "facility-1",
    });
    expect(terms.providedSchedule[0]).toMatchObject({ insurance: 12, fees: 3 });
  });

  it("refuse une chaîne Debt V2.1 non migrée", () => {
    expect(() => readLoanTerms({ id: "liability-1" })).toThrow(/deferral_kind/);
  });
});

describe("frontière Monte Carlo", () => {
  const validRun = {
    scenarioId: "scenario-1",
    seed: 42,
    simulations: 100,
    years: 1,
    methodology: "test",
    points: [{ year: 2026, p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 }],
  };

  it("refuse NaN et Infinity avant persistance", () => {
    expect(() =>
      validateSimulationRun({
        ...validRun,
        points: [{ ...validRun.points[0], p50: Number.NaN }],
      }),
    ).toThrow(/p50/);
    expect(() =>
      validateSimulationRun({
        ...validRun,
        points: [{ ...validRun.points[0], p90: Number.POSITIVE_INFINITY }],
      }),
    ).toThrow(/p90/);
  });

  it("refuse les séries de percentile vides ou non finies", () => {
    expect(() => percentile([], 0.5)).toThrow(/série vide/);
    expect(() => percentile([1, Number.NEGATIVE_INFINITY], 0.5)).toThrow(/non finie/);
  });
});

describe("seed Cash Flow V2", () => {
  it("porte explicitement la taxonomie de chaque catégorie", () => {
    for (const category of SUPABASE_CATEGORY_SEED) {
      expect(category.cashFlowKind).toBeTruthy();
      expect(category.essentiality).toBeTruthy();
      expect(category.expenseBehavior).toBeTruthy();
      expect(category.archived).toBe(false);
    }
    expect(SUPABASE_CATEGORY_SEED.find(({ name }) => name === "Revenu")?.cashFlowKind).toBe(
      "INCOME",
    );
    expect(SUPABASE_CATEGORY_SEED.find(({ name }) => name === "Investissement")?.cashFlowKind).toBe(
      "INVESTMENT",
    );
    expect(SUPABASE_CATEGORY_SEED.find(({ name }) => name.startsWith("Loyer"))).toMatchObject({
      cashFlowKind: "EXPENSE",
      essentiality: "ESSENTIAL",
      expenseBehavior: "FIXED",
    });
  });
});
