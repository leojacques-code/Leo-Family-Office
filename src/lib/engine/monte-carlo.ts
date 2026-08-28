import {
  runMonthlyModel,
  scenarioAssumptions,
  type MonthlyFinancialState,
  type MonthlyScenarioAssumptions,
  type OpeningBalanceSheet,
} from "@/lib/engine/monthly-financial-model";
import type { CanonicalEvent } from "@/lib/engine/event-contracts";
import { prepareScenarioTimeline } from "@/lib/engine/scenario-engine";
import type { ScenarioVersionDefinition } from "@/lib/engine/scenario-contracts";
import type { Liability, ProjectionResult, Scenario } from "@/lib/types";

export interface MonteCarloInput {
  scenario: Scenario;
  /** Bilan financier d'ouverture, identique à celui de la projection déterministe. */
  opening: OpeningBalanceSheet;
  liabilities: Liability[];
  years: number;
  simulations: number;
  seed: number;
  startingAge?: number;
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number) {
  const first = Math.max(random(), Number.EPSILON);
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function studentT5(random: () => number) {
  const z = gaussian(random);
  let chiSquare = 0;
  for (let index = 0; index < 5; index += 1) chiSquare += Math.pow(gaussian(random), 2);
  return z / Math.sqrt(chiSquare / 5) / Math.sqrt(5 / 3);
}

export function percentile(sorted: number[], probability: number) {
  if (sorted.length === 0) throw new Error("Percentile impossible : série vide");
  const invalidIndex = sorted.findIndex((value) => !Number.isFinite(value));
  if (invalidIndex !== -1) {
    throw new Error(
      `Percentile impossible : valeur non finie à l'index ${invalidIndex} (${String(sorted[invalidIndex])})`,
    );
  }
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower + 1] === undefined
    ? sorted[lower]
    : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

/**
 * Tirage du rendement mensuel de marché. C'est la SEULE différence entre le mode
 * déterministe et le mode Monte-Carlo : épargne, allocation, dette, dates, principal,
 * intérêts, bilan et funding gap passent par la même transition mensuelle.
 *
 * Le choc et le stress ne frappent que les actifs exposés au marché, jamais le cash, la
 * dette ou les actifs financiers sans exposition connue : c'est la transition du modèle
 * mensuel qui l'impose, pas ce fichier.
 */
function stochasticMonthlyReturn(
  random: () => number,
  assumptions: MonthlyScenarioAssumptions,
  scenario: Scenario,
) {
  const expectedMonthly = Math.pow(1 + assumptions.annualReturn, 1 / 12) - 1;
  const volatilityMonthly = scenario.annualVolatility / Math.sqrt(12);
  return () => {
    let monthlyReturn = expectedMonthly + volatilityMonthly * studentT5(random);
    if (random() < scenario.stressProbability / 12) monthlyReturn -= 0.12 + random() * 0.15;
    return monthlyReturn;
  };
}

export function runMonteCarlo(input: MonteCarloInput): ProjectionResult {
  const { scenario, opening, liabilities, years, simulations, seed } = input;
  if (simulations < 100 || years < 1)
    throw new Error("Projection requires at least 100 simulations and one year");
  const random = mulberry32(seed);
  const assumptions = scenarioAssumptions(scenario);
  const months = years * 12;
  const baseYear = Number(opening.date.slice(0, 4));
  const byYear: number[][] = Array.from({ length: years + 1 }, () => []);

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const draw = stochasticMonthlyReturn(random, assumptions, scenario);
    const result = runMonthlyModel({
      opening,
      liabilities,
      assumptions,
      months,
      marketReturn: draw,
    });
    // Le percentile porte sur le PATRIMOINE NET, pas sur un capital brut.
    for (let year = 0; year <= years; year += 1) {
      const state: MonthlyFinancialState | undefined = result.states[year * 12];
      if (!state) {
        throw new Error(
          `Monte Carlo invalide : état absent (simulation=${simulation}, année=${baseYear + year}, mois=${year * 12})`,
        );
      }
      if (!Number.isFinite(state.netWorth)) {
        throw new Error(
          `Monte Carlo invalide : patrimoine net non fini (simulation=${simulation}, année=${baseYear + year}, mois=${year * 12}, netWorth=${String(state.netWorth)}, assets=${String(state.grossFinancialAssets)}, debt=${String(state.loanBalance)}, fundingGap=${String(state.fundingGap)})`,
        );
      }
      byYear[year].push(state.netWorth);
    }
  }

  const points = byYear.map((values, year) => {
    values.sort((a, b) => a - b);
    return {
      year: baseYear + year,
      age: (input.startingAge ?? 23) + year,
      p10: percentile(values, 0.1),
      p25: percentile(values, 0.25),
      p50: percentile(values, 0.5),
      p75: percentile(values, 0.75),
      p90: percentile(values, 0.9),
    };
  });

  return {
    scenarioId: scenario.id,
    seed,
    simulations,
    points,
    methodology:
      "Patrimoine net financier simulé par le Personal Monthly Financial Model : même transition mensuelle que la projection déterministe, seul le rendement de marché est tiré au sort (Student-t à 5 ddl, stress rares, choc daté optionnel). Le choc ne frappe que les actifs exposés au marché ; cash, dette et actifs sans exposition connue en sont exclus. Périmètre financier uniquement : ni immobilier, ni business equity, ni carrière, ni fiscalité future. Les percentiles décrivent le modèle et ses hypothèses, pas l'avenir.",
  };
}

export interface ScenarioMonteCarloInput {
  definition: ScenarioVersionDefinition;
  baselineEvents: CanonicalEvent[];
  opening: OpeningBalanceSheet;
  reportingCurrency?: string;
  simulations: number;
  seed: number;
  startingAge?: number;
}

/**
 * Monte Carlo Scenarios V2. La timeline et la transition sont identiques au parcours
 * déterministe ; seul `PORTFOLIO_RETURN`, explicitement déclaré aléatoire, est tiré.
 */
export function runScenarioMonteCarlo(input: ScenarioMonteCarloInput): ProjectionResult {
  const { definition, simulations, seed } = input;
  if (simulations < 100 || definition.horizonMonths < 1) {
    throw new Error("Projection requires at least 100 simulations and one month");
  }
  if (definition.asOfDate !== input.opening.date) {
    throw new Error("Monte Carlo impossible : baseline et cut-off ne correspondent pas");
  }
  const market = definition.market;
  if (market.annualReturn === null || market.annualVolatility === null) {
    throw new Error("Monte Carlo impossible : hypothèse de marché manquante");
  }
  const prepared = prepareScenarioTimeline({
    baselineEvents: input.baselineEvents,
    definition,
  });
  if (prepared.blockers.some((item) => item.blocking)) {
    throw new Error(
      `Monte Carlo impossible : ${prepared.blockers.map((item) => item.code).join(", ")}`,
    );
  }
  const assumptions: MonthlyScenarioAssumptions = {
    operatingSurplus: 0,
    investmentAllocationRate: definition.capitalAllocation.investmentAllocationRate,
    annualReturn: market.annualReturn,
    shockYear: market.shockYear,
    shockMagnitude: market.shockMagnitude,
  };
  const random = mulberry32(seed);
  const expectedMonthly = Math.pow(1 + market.annualReturn, 1 / 12) - 1;
  const volatilityMonthly = market.annualVolatility / Math.sqrt(12);
  const years = Math.ceil(definition.horizonMonths / 12);
  const baseYear = Number(input.opening.date.slice(0, 4));
  const byYear: number[][] = Array.from({ length: years + 1 }, () => []);

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const marketReturn = () => {
      let value = expectedMonthly + volatilityMonthly * studentT5(random);
      if (market.stressProbability !== null && random() < market.stressProbability / 12) {
        value -= 0.12 + random() * 0.15;
      }
      return value;
    };
    const result = runMonthlyModel({
      opening: input.opening,
      liabilities: [],
      assumptions,
      months: definition.horizonMonths,
      marketReturn,
      consequences: prepared.scenario.monthlyConsequences,
      reportingCurrency: input.reportingCurrency ?? "EUR",
    });
    for (let year = 0; year <= years; year += 1) {
      const monthIndex = Math.min(year * 12, definition.horizonMonths);
      const state = result.states[monthIndex];
      if (!state || !Number.isFinite(state.netWorth)) {
        throw new Error(`Monte Carlo V2 invalide au mois ${monthIndex}`);
      }
      byYear[year].push(state.netWorth);
    }
  }

  return {
    scenarioId: definition.scenarioId,
    seed,
    simulations,
    points: byYear.map((values, year) => {
      values.sort((left, right) => left - right);
      return {
        year: baseYear + year,
        age: (input.startingAge ?? 23) + year,
        p10: percentile(values, 0.1),
        p25: percentile(values, 0.25),
        p50: percentile(values, 0.5),
        p75: percentile(values, 0.75),
        p90: percentile(values, 0.9),
      };
    }),
    methodology:
      "Scenarios V2 : timeline canonique et Personal Monthly Financial Model identiques au déterministe ; seul PORTFOLIO_RETURN est tiré avec un seed reproductible.",
  };
}
