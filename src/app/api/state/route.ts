import { NextResponse } from "next/server";
import { API_HEADERS } from "@/lib/http";
import { requireAuthenticated } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { mutationSchema } from "@/lib/validation/mutations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown, fallback: string) {
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  if (!unauthorized) console.error(fallback, error);
  return NextResponse.json(
    { error: unauthorized ? "Non authentifié" : fallback },
    { status: unauthorized ? 401 : 500 },
  );
}

export async function GET() {
  try {
    await requireAuthenticated();
    const repository = await getRepository();
    return NextResponse.json(await repository.getDashboardState(), { headers: API_HEADERS });
  } catch (error) {
    return failure(error, "Lecture impossible");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Données invalides", issues: parsed.error.flatten() },
        { status: 400 },
      );
    const repository = await getRepository();
    return NextResponse.json(await repository.mutateState(parsed.data));
  } catch (error) {
    return failure(error, "Modification impossible");
  }
}
