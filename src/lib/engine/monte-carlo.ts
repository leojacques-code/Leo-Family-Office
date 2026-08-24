import {
  runMonthlyModel,
  scenarioAssumptions,
  type MonthlyFinancialState,
  type MonthlyScenarioAssumptions,
  type OpeningBalanceSheet,
} from "@/lib/engine/monthly-financial-model";
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
