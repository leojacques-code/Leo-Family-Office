import type { ProjectionResult, Scenario } from "@/lib/types";

export interface MonteCarloInput {
  scenario: Scenario;
  initialAssets: number;
  years: number;
  simulations: number;
  seed: number;
  /** Première année civile de la distribution, dérivée de la date d'observation. */
  baseYear: number;
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

function percentile(sorted: number[], probability: number) {
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

export function runMonteCarlo(input: MonteCarloInput): ProjectionResult {
  const { scenario, initialAssets, years, simulations, seed } = input;
  if (simulations < 100 || years < 1) throw new Error("Projection requires at least 100 simulations and one year");
  const random = mulberry32(seed);
  const byYear: number[][] = Array.from({ length: years + 1 }, () => []);

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    let assets = initialAssets;
    byYear[0].push(assets);
    for (let year = 1; year <= years; year += 1) {
      for (let month = 0; month < 12; month += 1) {
        const tailShock = studentT5(random);
        const expectedMonthly = Math.pow(1 + scenario.annualReturn, 1 / 12) - 1;
        const volatilityMonthly = scenario.annualVolatility / Math.sqrt(12);
        let monthlyReturn = expectedMonthly + volatilityMonthly * tailShock;
        if (random() < scenario.stressProbability / 12) monthlyReturn -= 0.12 + random() * 0.15;
        assets = Math.max(0, assets * (1 + monthlyReturn) + scenario.monthlySavings);
      }
      if (scenario.shockYear === year && scenario.shockMagnitude !== null) assets = Math.max(0, assets * (1 + scenario.shockMagnitude));
      byYear[year].push(assets);
    }
  }

  const points = byYear.map((values, year) => {
    values.sort((a, b) => a - b);
    return {
      year: input.baseYear + year,
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
    methodology: "Périmètre simulé : capital financier initial et contributions mensuelles du scénario. Ni dette, ni immobilier, ni business equity, ni fiscalité n'entrent dans la trajectoire : ce n'est pas une projection du patrimoine net. Rendements mensuels à queues épaisses (Student-t, 5 ddl), stress rares et choc daté optionnel. Les percentiles décrivent uniquement le modèle et ses hypothèses.",
  };
}
