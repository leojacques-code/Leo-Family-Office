import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/lib/auth";
import { getFecRepository } from "@/lib/data/fec-repository";
import {
  ACCEPTED_FEC_EXTENSIONS,
  fecAnalyzeSchema,
  fecCommandSchema,
  MAX_FEC_FILE_BYTES,
} from "@/lib/validation/fec-imports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown, fallback: string) {
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  if (unauthorized) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  // Le message d'une RPC d'acquisition est informatif pour l'utilisateur (« couverture de
  // l'exercice non déclarée ») : il est remonté tel quel, et journalisé pour le reste.
  console.error(fallback, error);
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Écritures d'une session comptable. */
export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const sessionId = new URL(request.url).searchParams.get("session");
    if (!sessionId) {
      return NextResponse.json({ error: "Session non précisée" }, { status: 400 });
    }
    return NextResponse.json(
      { lines: await getFecRepository().getSessionLines(sessionId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error, "Lecture des écritures impossible");
  }
}

/**
 * Dépôt d'un FEC : DRY-RUN. Les écritures sont mises en staging et le brut est conservé,
 * mais AUCUN fait Business n'est écrit — la validation est un acte distinct (PATCH).
 */
export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Fichier absent ou vide." }, { status: 400 });
    }
    if (file.size > MAX_FEC_FILE_BYTES) {
      return NextResponse.json(
        { error: `Fichier supérieur à ${MAX_FEC_FILE_BYTES / (1024 * 1024)} Mo.` },
        { status: 400 },
      );
    }
    const lowerName = file.name.toLowerCase();
    if (!ACCEPTED_FEC_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
      return NextResponse.json(
        { error: `Extension non acceptée. Formats lus : ${ACCEPTED_FEC_EXTENSIONS.join(", ")}.` },
        { status: 400 },
      );
    }

    const rawOptions = formData.get("options");
    const parsed = fecAnalyzeSchema.safeParse(
      typeof rawOptions === "string" ? JSON.parse(rawOptions) : null,
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Paramètres d'import invalides", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const preview = await getFecRepository().analyze(parsed.data, {
      name: file.name,
      contentType: "text/plain",
      size: file.size,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json(preview, { status: 201 });
  } catch (error) {
    return failure(error, "Analyse de FEC impossible");
  }
}

/**
 * Validation ou abandon d'une session comptable. Seul endroit qui écrit un fait.
 *
 * L'état écrit n'est PAS celui que le client a reçu au preview : il est reconstruit depuis
 * les écritures persistées. Une charge forgée ne peut donc pas écrire un chiffre qu'aucune
 * écriture ne porte.
 */
export async function PATCH(request: Request) {
  try {
    await requireAuthenticated();
    const contentType = request.headers.get("content-type") ?? "";
    let command: unknown;
    let file: { name: string; contentType: string; size: number; bytes: Uint8Array } | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const raw = formData.get("command");
      command = typeof raw === "string" ? JSON.parse(raw) : null;
      const upload = formData.get("file");
      if (upload instanceof File && upload.size > 0) {
        if (upload.size > MAX_FEC_FILE_BYTES) {
          return NextResponse.json({ error: "Fichier trop volumineux." }, { status: 400 });
        }
        file = {
          name: upload.name,
          contentType: "text/plain",
          size: upload.size,
          bytes: new Uint8Array(await upload.arrayBuffer()),
        };
      }
    } else {
      command = await request.json().catch(() => null);
    }

    const parsed = fecCommandSchema.safeParse(command);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Commande d'import invalide", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const repository = getFecRepository();
    if (parsed.data.action === "commit") {
      return NextResponse.json(await repository.commit(parsed.data.sessionId, file));
    }
    return NextResponse.json({ sessionId: await repository.discard(parsed.data.sessionId) });
  } catch (error) {
    return failure(error, "Commande d'import impossible");
  }
}
