import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticated } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { runMonteCarlo } from "@/lib/engine/monte-carlo";
import {
  buildOpeningBalanceSheet,
  runDeterministicModel,
  scenarioAssumptions,
  toAnnualPoints,
} from "@/lib/engine/monthly-financial-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectionSchema = z.object({
  scenarioId: z.string().min(1),
  years: z.number().int().min(1).max(80).default(30),
  simulations: z.number().int().min(100).max(20000).default(3000),
  seed: z.number().int().min(0).max(2147483647).default(19082026),
});

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = projectionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Paramètres de projection invalides" }, { status: 400 });
    const repository = await getRepository();
    const state = await repository.getDashboardState();
    const scenario = state.scenarios.find((item) => item.id === parsed.data.scenarioId);
    if (!scenario) return NextResponse.json({ error: "Scénario introuvable" }, { status: 404 });
    // Une seule source temporelle : le Personal Monthly Financial Model. Le déterministe
    // et le Monte-Carlo partagent le bilan d'ouverture, l'échéancier et la transition.
    const opening = buildOpeningBalanceSheet(state);
    const assumptions = scenarioAssumptions(scenario);
    const deterministic = toAnnualPoints(
      runDeterministicModel(opening, state.liabilities, assumptions, parsed.data.years * 12),
    );
    const result = runMonteCarlo({
      scenario,
      opening,
      liabilities: state.liabilities,
      years: parsed.data.years,
      simulations: parsed.data.simulations,
      seed: parsed.data.seed,
    });
    const runId = await repository.saveSimulation({
      ...parsed.data,
      methodology: result.methodology,
      points: result.points,
    });
    return NextResponse.json({
      ...result,
      runId,
      deterministic,
      openingNetWorth: opening.netWorth,
      assumptions: {
        operatingSurplusBeforeDebt: assumptions.operatingSurplus,
        investmentAllocationRate: assumptions.investmentAllocationRate,
        annualReturn: assumptions.annualReturn,
      },
    });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
    if (!unauthorized) console.error("Projection impossible", error);
    return NextResponse.json(
      { error: unauthorized ? "Non authentifié" : "Projection impossible" },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
