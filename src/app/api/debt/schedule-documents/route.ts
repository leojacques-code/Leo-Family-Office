import { NextResponse } from "next/server";
import { API_HEADERS } from "@/lib/http";

import { requireAuthenticated } from "@/lib/auth";
import { getScheduleDocumentRepository } from "@/lib/data/schedule-document-repository";
import { routeFailure as failure } from "@/lib/route-failure";
import {
  ACCEPTED_SCHEDULE_EXTENSIONS,
  MAX_SCHEDULE_UPLOAD_BYTES,
  scheduleCommandSchema,
  scheduleUploadOptionsSchema,
} from "@/lib/validation/schedule-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Lectures d'échéancier d'une dette (`?liabilityId=`), revue complète d'une lecture
 * (`?runId=`) ou lien de la pièce conservée (`?piece=`). Lecture seule.
 */
export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const params = new URL(request.url).searchParams;
    const runId = params.get("runId");
    const liabilityId = params.get("liabilityId");
    const piece = params.get("piece");
    const repository = await getScheduleDocumentRepository();
    if (piece !== null) {
      if (!UUID.test(piece))
        return NextResponse.json({ error: "Lecture non reconnue" }, { status: 400 });
      return NextResponse.json(await repository.pieceUrl(piece), { headers: API_HEADERS });
    }
    if (runId !== null) {
      if (!UUID.test(runId))
        return NextResponse.json({ error: "Lecture non reconnue" }, { status: 400 });
      return NextResponse.json(await repository.getReview(runId), { headers: API_HEADERS });
    }
    if (liabilityId !== null && UUID.test(liabilityId)) {
      return NextResponse.json(await repository.listRuns(liabilityId), { headers: API_HEADERS });
    }
    return NextResponse.json({ error: "Dette ou lecture non précisée" }, { status: 400 });
  } catch (error) {
    return failure(error, "Lecture de l’échéancier impossible");
  }
}

/**
 * Dépôt d'un échéancier CSV ou XLSX : la pièce est conservée au coffre et lue en candidats.
 * Rien n'est écrit dans l'échéancier canonique de la dette.
 */
export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Fichier absent ou vide." }, { status: 400 });
    }
    if (file.size > MAX_SCHEDULE_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Fichier supérieur à ${MAX_SCHEDULE_UPLOAD_BYTES / (1024 * 1024)} Mo.` },
        { status: 400 },
      );
    }
    const lowerName = file.name.toLowerCase();
    if (!ACCEPTED_SCHEDULE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
      return NextResponse.json(
        { error: "Formats lus : CSV et XLSX. Le PDF n’est pas encore pris en charge." },
        { status: 400 },
      );
    }
    const rawOptions = formData.get("options");
    let options: unknown = null;
    try {
      options = typeof rawOptions === "string" ? JSON.parse(rawOptions) : null;
    } catch {
      options = null;
    }
    const parsed = scheduleUploadOptionsSchema.safeParse(options);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Paramètres de dépôt invalides" },
        { status: 400 },
      );
    }
    const repository = await getScheduleDocumentRepository();
    const result = await repository.upload({
      liabilityId: parsed.data.liabilityId,
      declaredCurrency: parsed.data.declaredCurrency,
      file: {
        name: file.name,
        contentType: file.type,
        size: file.size,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    });
    if ("refused" in result) return NextResponse.json(result, { status: 422 });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return failure(error, "Dépôt de l’échéancier impossible");
  }
}

/** Décisions sur une case, validation ou rejet de la LECTURE. */
export async function PATCH(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = scheduleCommandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Commande d’échéancier invalide" },
        { status: 400 },
      );
    }
    const repository = await getScheduleDocumentRepository();
    const command = parsed.data;
    switch (command.action) {
      case "correct":
      case "reject":
      case "review":
        return NextResponse.json(
          await repository.decide({
            fieldId: command.fieldId,
            action: command.action,
            expectedRevision: command.expectedRevision,
            userValue: command.action === "correct" ? (command.userValue ?? null) : null,
            userDate: command.action === "correct" ? (command.userDate ?? null) : null,
            reason: command.reason ?? null,
          }),
        );
      case "validate":
        return NextResponse.json(await repository.validate(command.runId));
      case "reject-run":
        return NextResponse.json(await repository.reject(command.runId, command.reason ?? null));
    }
  } catch (error) {
    return failure(error, "Commande d’échéancier impossible");
  }
}
