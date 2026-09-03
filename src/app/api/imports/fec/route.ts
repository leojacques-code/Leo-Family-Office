import { NextResponse } from "next/server";
import { API_HEADERS } from "@/lib/http";

import { requireAuthenticated } from "@/lib/auth";
import { getFecRepository } from "@/lib/data/fec-repository";
import {
  fecAnalyzeSchema,
  fecCommandSchema,
  fecUploadTicketSchema,
} from "@/lib/validation/fec-imports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ACQUISITION COMPTABLE — le fichier ne traverse JAMAIS cette route.
 *
 * Un FEC d'exercice pèse couramment plusieurs mégaoctets, et une fonction serverless
 * plafonne le corps de requête entrant bien en dessous. Un fichier envoyé ici serait refusé
 * par la plateforme AVANT que ce code s'exécute : la lecture à 150 000 lignes n'existerait
 * pas en production, quelle que soit la qualité du parseur.
 *
 *   POST ?ticket=1   → le serveur ÉMET un billet et une URL de dépôt signée
 *   (navigateur)     → PUT du fichier DIRECTEMENT au stockage privé
 *   POST             → analyse, ne recevant qu'un identifiant de billet (quelques octets)
 *   PATCH            → validation ou abandon, sans fichier : le serveur reprend le staging
 *
 * Aucun corps de requête de cette route ne porte donc de contenu de fichier, et aucun ne
 * dépasse quelques centaines d'octets.
 */

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
      { headers: API_HEADERS },
    );
  } catch (error) {
    return failure(error, "Lecture des écritures impossible");
  }
}

/**
 * `?ticket=1` : émission d'un billet de dépôt.
 * Sinon : DRY-RUN comptable sur le fichier déjà déposé.
 *
 * Les deux corps sont du JSON de quelques octets. Le contenu du fichier n'apparaît dans
 * aucun des deux.
 */
export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const wantsTicket = new URL(request.url).searchParams.get("ticket") === "1";
    const body = await request.json().catch(() => null);

    if (wantsTicket) {
      const parsed = fecUploadTicketSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Demande de dépôt invalide" },
          { status: 400 },
        );
      }
      const ticket = await getFecRepository().issueUploadTicket(parsed.data);
      return NextResponse.json(ticket, { status: 201 });
    }

    const parsed = fecAnalyzeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Paramètres d'import invalides", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const preview = await getFecRepository().analyze(parsed.data);
    return NextResponse.json(preview, { status: 201 });
  } catch (error) {
    return failure(error, "Analyse de FEC impossible");
  }
}

/**
 * Validation ou abandon d'une session comptable. Seul endroit qui écrit un fait.
 *
 * Aucun fichier n'accompagne la commande : quand la session a demandé sa conservation, le
 * serveur reprend le contenu depuis l'objet de staging privé qu'il a lui-même écrit.
 *
 * L'état écrit n'est PAS celui que le client a reçu au preview : il est reconstruit depuis
 * les écritures persistées. Une charge forgée ne peut donc pas écrire un chiffre qu'aucune
 * écriture ne porte.
 */
export async function PATCH(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = fecCommandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Commande d'import invalide", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const repository = getFecRepository();
    if (parsed.data.action === "commit") {
      return NextResponse.json(await repository.commit(parsed.data.sessionId));
    }
    return NextResponse.json({ sessionId: await repository.discard(parsed.data.sessionId) });
  } catch (error) {
    return failure(error, "Commande d'import impossible");
  }
}
