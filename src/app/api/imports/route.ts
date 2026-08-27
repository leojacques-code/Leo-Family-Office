import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/lib/auth";
import { getImportRepository } from "@/lib/data/import-repository";
import {
  ACCEPTED_IMPORT_EXTENSIONS,
  importAnalyzeSchema,
  importCommandSchema,
  MAX_IMPORT_FILE_BYTES,
} from "@/lib/validation/imports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown, fallback: string) {
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  if (unauthorized) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  // Le message d'une RPC d'acquisition est informatif pour l'utilisateur (« ce fichier a
  // déjà été importé ») : il est remonté tel quel, et journalisé pour le reste.
  console.error(fallback, error);
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Historique des imports, ou lignes d'une session donnée. */
export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const sessionId = new URL(request.url).searchParams.get("session");
    const repository = getImportRepository();
    if (sessionId) {
      return NextResponse.json(
        { rows: await repository.getSessionRows(sessionId) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { sessions: await repository.listSessions() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error, "Lecture des imports impossible");
  }
}

/**
 * Dépôt d'un fichier : DRY-RUN. Cette route n'écrit AUCUN fait canonique — elle produit
 * une session en attente et son preview. La validation est un acte distinct (PATCH).
 */
export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Fichier absent ou vide." }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: `Fichier supérieur à ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} Mo.` },
        { status: 400 },
      );
    }
    const lowerName = file.name.toLowerCase();
    if (!ACCEPTED_IMPORT_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
      return NextResponse.json(
        {
          error: `Extension non acceptée. Formats lus : ${ACCEPTED_IMPORT_EXTENSIONS.join(", ")}.`,
        },
        { status: 400 },
      );
    }

    const rawOptions = formData.get("options");
    const parsed = importAnalyzeSchema.safeParse(
      typeof rawOptions === "string" ? JSON.parse(rawOptions) : null,
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Paramètres d'import invalides", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const repository = getImportRepository();
    const preview = await repository.analyze(parsed.data, {
      name: file.name,
      // Les navigateurs annoncent un CSV sous plusieurs types. Le contenu a été découpé
      // comme du texte délimité : c'est ce type qui est conservé, y compris au coffre.
      contentType: "text/csv",
      size: file.size,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json(preview, { status: 201 });
  } catch (error) {
    return failure(error, "Analyse d'import impossible");
  }
}

/**
 * Validation ou abandon d'une session analysée. Seul endroit qui écrit des faits.
 *
 * La validation accepte le fichier en multipart lorsque la session a demandé sa
 * conservation : la copie au coffre n'a lieu qu'après l'écriture des faits, de sorte qu'une
 * analyse abandonnée ou refusée ne laisse jamais de copie derrière elle.
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
        if (upload.size > MAX_IMPORT_FILE_BYTES) {
          return NextResponse.json({ error: "Fichier trop volumineux." }, { status: 400 });
        }
        file = {
          name: upload.name,
          contentType: "text/csv",
          size: upload.size,
          bytes: new Uint8Array(await upload.arrayBuffer()),
        };
      }
    } else {
      command = await request.json().catch(() => null);
    }

    const parsed = importCommandSchema.safeParse(command);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Commande d'import invalide", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const repository = getImportRepository();
    if (parsed.data.action === "commit") {
      return NextResponse.json(
        await repository.commit(parsed.data.sessionId, parsed.data.includeRecordIds, file),
      );
    }
    return NextResponse.json({ sessionId: await repository.discard(parsed.data.sessionId) });
  } catch (error) {
    return failure(error, "Commande d'import impossible");
  }
}
