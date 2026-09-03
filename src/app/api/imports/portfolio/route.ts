import { NextResponse } from "next/server";
import { API_HEADERS } from "@/lib/http";

import { requireAuthenticated } from "@/lib/auth";
import { getPortfolioImportRepository } from "@/lib/data/portfolio-import-repository";
import { portfolioImportCommandSchema } from "@/lib/validation/portfolio-imports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * IMPORT DE PORTEFEUILLE — SEULE PORTE SERVEUR
 *
 * Le fichier ne traverse JAMAIS cette route, et ce n'est pas une optimisation :
 *
 *   * une fonction serverless plafonne le corps de requête entrant. Un classeur envoyé ici
 *     serait refusé par la plateforme AVANT que ce code s'exécute, et l'import d'un export
 *     de courtier de plusieurs mégaoctets n'existerait pas en production ;
 *   * la lecture doit produire un acte PERSISTÉ, même quand elle échoue.
 *
 *   POST { action: "ticket" }             → le serveur ÉMET un billet et une autorisation
 *   (navigateur)                          → PUT du fichier DIRECTEMENT au stockage privé
 *   POST { action: "analyze" }            → analyse, ne recevant qu'un identifiant de billet
 *   POST { action: "resolve-instrument" } → trancher un rattachement d'instrument
 *   POST { action: "correct" }            → corriger une ligne LUE, jamais le brut
 *   POST { action: "commit" }             → écrire les faits retenus, atomiquement
 *   POST { action: "discard" }            → abandonner une session sans fait écrit
 *   GET  ?session=…                       → preview : lignes, instruments, anomalies
 *   GET  ?sessions=1                      → historique des imports
 *
 * Aucun corps de requête de cette route ne dépasse quelques kilooctets.
 */

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  // Le message d'une RPC d'acquisition est informatif pour l'utilisateur (« ce fichier a
  // déjà été validé », « lignes non committables désignées ») : il est remonté tel quel.
  console.error(fallback, error);
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const params = new URL(request.url).searchParams;
    const repository = getPortfolioImportRepository();

    const sessionId = params.get("session");
    if (sessionId) {
      return NextResponse.json(await repository.getPreview(sessionId), {
        headers: API_HEADERS,
      });
    }

    if (params.get("sessions") === "1") {
      const accountId = params.get("account") ?? undefined;
      return NextResponse.json(
        { sessions: await repository.listSessions(accountId) },
        { headers: API_HEADERS },
      );
    }

    return NextResponse.json({ error: "Requête non reconnue" }, { status: 400 });
  } catch (error) {
    return failure(error, "Lecture de l'import de portefeuille impossible");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = portfolioImportCommandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Commande d'import invalide",
          issues: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const repository = getPortfolioImportRepository();
    const command = parsed.data;

    switch (command.action) {
      case "ticket":
        return NextResponse.json(await repository.issueUploadTicket(command), { status: 201 });
      case "analyze":
        return NextResponse.json(await repository.analyze(command), { status: 201 });
      case "resolve-instrument":
        return NextResponse.json(await repository.resolveInstrument(command));
      case "correct":
        return NextResponse.json(await repository.correct(command));
      case "commit":
        return NextResponse.json(await repository.commit(command), { status: 201 });
      case "discard":
        await repository.discard(command.sessionId);
        return NextResponse.json({ discarded: command.sessionId });
    }
  } catch (error) {
    return failure(error, "Commande d'import de portefeuille impossible");
  }
}
