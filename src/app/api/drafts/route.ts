import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { API_HEADERS } from "@/lib/http";
import {
  MutationConflictError,
  MutationNotFoundError,
  MutationRejectedError,
} from "@/lib/data/mutation-errors";
import { formDraftDeleteSchema, formDraftSaveSchema } from "@/lib/validation/drafts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Brouillons de formulaire (document 03 §8). Route distincte des mutations de faits : ENREGISTRER
 * UN BROUILLON ≠ VALIDER. Aucune écriture ici n'atteint une table canonique.
 */
function failure(error: unknown, message: string) {
  if (error instanceof MutationConflictError)
    return NextResponse.json(
      { error: error.message, code: "CONFLICT" },
      { status: 409, headers: API_HEADERS },
    );
  if (error instanceof MutationNotFoundError)
    return NextResponse.json(
      { error: error.message, code: "NOT_FOUND" },
      { status: 404, headers: API_HEADERS },
    );
  if (error instanceof MutationRejectedError)
    return NextResponse.json(
      { error: error.message, code: "REJECTED" },
      { status: 422, headers: API_HEADERS },
    );
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  // Le contenu d'un brouillon n'entre jamais dans le journal.
  if (!unauthorized) console.error("lfo.drafts.failure", { message, at: new Date().toISOString() });
  return NextResponse.json(
    { error: unauthorized ? "Non authentifié" : message },
    { status: unauthorized ? 401 : 500, headers: API_HEADERS },
  );
}

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = formDraftSaveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Brouillon invalide" },
        { status: 400, headers: API_HEADERS },
      );
    const saved = await (await getRepository()).saveFormDraft(parsed.data);
    return NextResponse.json({ saved }, { headers: API_HEADERS });
  } catch (error) {
    return failure(error, "Enregistrement du brouillon impossible");
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = formDraftDeleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Suppression invalide" },
        { status: 400, headers: API_HEADERS },
      );
    await (await getRepository()).deleteFormDraft(parsed.data.draftId, parsed.data.expectedVersion);
    return NextResponse.json({ deleted: true }, { headers: API_HEADERS });
  } catch (error) {
    return failure(error, "Suppression du brouillon impossible");
  }
}
