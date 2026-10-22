import { NextResponse } from "next/server";
import { API_HEADERS } from "@/lib/http";

import { requireAuthenticated } from "@/lib/auth";
import { getDocumentRepository } from "@/lib/data/document-repository";
import {
  documentAnalyzeSchema,
  documentCommandSchema,
  documentTicketSchema,
} from "@/lib/validation/documents";
import { routeFailure as failure } from "@/lib/route-failure";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DOCUMENT INTELLIGENCE — SEULE PORTE SERVEUR
 *
 * Le PDF ne traverse JAMAIS cette route, et ce n'est pas une optimisation :
 *
 *   * une fonction serverless plafonne le corps de requête entrant. Un PDF envoyé ici serait
 *     refusé par la plateforme AVANT que ce code s'exécute, et la lecture d'une liasse
 *     scannée de dix mégaoctets n'existerait pas en production ;
 *   * la lecture doit produire un acte PERSISTÉ, même quand elle échoue. Un traitement côté
 *     navigateur ne laisserait aucune trace de ce qui a été tenté.
 *
 *   POST ?ticket=1   → le serveur ÉMET un billet et une autorisation de dépôt
 *   (navigateur)     → PUT du PDF DIRECTEMENT au stockage privé
 *   POST             → analyse, ne recevant qu'un identifiant de billet
 *   GET  ?run=…      → état d'une lecture : cases, contrôles, proposition financière
 *   GET  ?runs=1     → liste des lectures
 *   PATCH            → corriger une case, valider la lecture, écrire le fait, rejeter
 *
 * Aucun corps de requête de cette route ne dépasse quelques centaines d'octets.
 */

export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const params = new URL(request.url).searchParams;
    const repository = await getDocumentRepository();

    const runId = params.get("run");
    if (runId) {
      return NextResponse.json(await repository.getPreview(runId), {
        headers: API_HEADERS,
      });
    }

    if (params.get("runs") === "1") {
      const business = params.get("business") ?? undefined;
      return NextResponse.json(
        { runs: await repository.listRuns(business) },
        { headers: API_HEADERS },
      );
    }

    return NextResponse.json({ error: "Requête non reconnue" }, { status: 400 });
  } catch (error) {
    return failure(error, "Lecture documentaire illisible");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const wantsTicket = new URL(request.url).searchParams.get("ticket") === "1";
    const body = await request.json().catch(() => null);
    const repository = await getDocumentRepository();

    if (wantsTicket) {
      const parsed = documentTicketSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Demande de dépôt invalide" },
          { status: 400 },
        );
      }
      return NextResponse.json(await repository.issueUploadTicket(parsed.data), { status: 201 });
    }

    const parsed = documentAnalyzeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Paramètres d'analyse invalides", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json(await repository.analyze(parsed.data), { status: 201 });
  } catch (error) {
    return failure(error, "Analyse documentaire impossible");
  }
}

/**
 * Écritures. `link` est la seule action qui écrit un fait canonique, et elle reconstruit
 * l'instantané financier depuis les cases PERSISTÉES : le contenu du preview reçu par le
 * client n'entre pas dans la décision.
 */
export async function PATCH(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = documentCommandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Commande documentaire invalide", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const repository = await getDocumentRepository();
    const command = parsed.data;

    switch (command.action) {
      case "correct":
      case "reject":
      case "review":
        return NextResponse.json(
          await repository.correct({
            fieldId: command.fieldId,
            action: command.action,
            expectedRevision: command.expectedRevision,
            userValue: command.userValue ?? null,
            reason: command.reason ?? null,
          }),
        );
      case "validate":
        return NextResponse.json(await repository.validate(command.runId));
      case "link":
        return NextResponse.json(await repository.link(command));
      case "reject-run":
        return NextResponse.json(await repository.reject(command.runId, command.reason ?? null));
    }
  } catch (error) {
    return failure(error, "Commande documentaire impossible");
  }
}
