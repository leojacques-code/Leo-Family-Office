import { isSameOrigin } from "@/lib/same-origin";
import { API_HEADERS } from "@/lib/http";
import { personalSetupSchema } from "@/lib/personal-setup";
import { getPersonalSetupRepository } from "@/lib/data/personal-setup-repository";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function failure(error: unknown) {
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  return Response.json(
    {
      error: unauthorized
        ? "Non authentifié"
        : "Vos choix n’ont pas pu être enregistrés. Réessayez.",
    },
    { status: unauthorized ? 401 : 503, headers: API_HEADERS },
  );
}
export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return Response.json({ error: "Origine refusée" }, { status: 403, headers: API_HEADERS });
  try {
    const repository = await getPersonalSetupRepository();
    const parsed = personalSetupSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return Response.json(
        { error: "Vérifiez le nom de l’espace et votre choix." },
        { status: 400, headers: API_HEADERS },
      );
    return Response.json(await repository.save(parsed.data), { headers: API_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
