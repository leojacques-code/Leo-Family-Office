import { NextResponse } from "next/server";
import { API_HEADERS } from "@/lib/http";

import { requireAuthenticated } from "@/lib/auth";
import { getOpenBankingRepository } from "@/lib/data/open-banking-repository";
import { sandboxScenario, type SandboxScenarioName } from "@/lib/data/open-banking-scenarios";
import { openBankingCommandSchema } from "@/lib/validation/open-banking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ROUTE OPEN BANKING (AIS) — LECTURE SEULE
 *
 * Elle expose exactement neuf actions, toutes de lecture ou de décision. Il n'existe AUCUNE
 * action d'initiation de paiement, et ce n'est pas une omission : le périmètre est
 * l'agrégation.
 *
 * Aucun secret ne traverse cette route, dans aucun sens. Le schéma de validation n'a pas de
 * champ où un jeton pourrait entrer, et les objets rendus au navigateur ne portent qu'un nom
 * de coffre, jamais une clé ni une valeur.
 */
function failure(error: unknown, fallback: string) {
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  if (unauthorized) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  // Le message d'une RPC est informatif pour l'utilisateur (« consentement expiré ») : il
  // est remonté tel quel, et journalisé pour le reste.
  console.error(fallback, error);
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Vue complète, ou preview d'une exécution donnée. */
export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const runId = new URL(request.url).searchParams.get("run");
    const repository = getOpenBankingRepository();
    if (runId) {
      return NextResponse.json(
        { preview: await repository.preview(runId) },
        { headers: API_HEADERS },
      );
    }
    return NextResponse.json(await repository.overview(), {
      headers: API_HEADERS,
    });
  } catch (error) {
    return failure(error, "Lecture Open Banking impossible");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = openBankingCommandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Commande Open Banking invalide", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const repository = getOpenBankingRepository();
    const command = parsed.data;

    switch (command.action) {
      case "register-sandbox":
        return NextResponse.json({ providerId: await repository.registerSandbox() });

      case "open-consent":
        return NextResponse.json({
          consentId: await repository.openConsent({
            providerId: command.providerId,
            consentReference: command.consentReference,
            scopes: command.scopes,
            expiresAt: command.expiresAt,
          }),
        });

      case "revoke-consent":
        return NextResponse.json({
          consentId: await repository.revokeConsent(command.consentId, command.reason),
        });

      case "discover-accounts":
        return NextResponse.json({
          accounts: await repository.discoverAccounts(
            command.consentId,
            sandboxScenario(command.scenario as SandboxScenarioName),
          ),
        });

      case "map-account":
        return NextResponse.json({
          providerAccountId: await repository.mapAccount({
            providerAccountId: command.providerAccountId,
            accountId: command.accountId,
            reason: command.reason,
          }),
        });

      case "synchronize":
        // AUCUN fait canonique n'est écrit ici : la synchronisation rend un PREVIEW.
        return NextResponse.json({
          preview: await repository.synchronize({
            providerAccountId: command.providerAccountId,
            trigger: command.trigger,
            scenario: sandboxScenario(command.scenario as SandboxScenarioName),
          }),
        });

      case "decide":
        return NextResponse.json({
          touched: await repository.decide({
            observationId: command.observationId,
            decision: command.decision,
            linkedTransactionId: command.linkedTransactionId,
            reason: command.reason,
            sessionId: command.sessionId,
          }),
        });

      case "commit":
        // Seul endroit de cette route qui écrit des faits canoniques.
        return NextResponse.json(
          await repository.commit(command.sessionId, command.includeRecordIds),
        );

      case "record-event":
        return NextResponse.json({
          eventId: await repository.recordEvent({
            providerId: command.providerId,
            consentId: command.consentId,
            providerEventId: command.providerEventId,
            eventType: command.eventType,
            payload: command.payload,
            signatureVerified: command.signatureVerified,
          }),
        });
    }
  } catch (error) {
    return failure(error, "Commande Open Banking impossible");
  }
}
