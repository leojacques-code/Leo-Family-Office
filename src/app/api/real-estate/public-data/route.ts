import { NextResponse } from "next/server";
import { API_HEADERS } from "@/lib/http";

import { requireAuthenticated } from "@/lib/auth";
import { getPublicDataRepository } from "@/lib/data/public-data-repository";
import { publicDataCommandSchema } from "@/lib/validation/public-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DONNÉES PUBLIQUES IMMOBILIÈRES — SEULE PORTE SERVEUR
 *
 * Toute lecture de source externe passe ici, et jamais par le navigateur. Ce n'est pas une
 * question de confort :
 *
 *   * la clé ou le point d'accès d'une source ne doit pas atteindre le client, et une URL
 *     exposée finit par recevoir un jeton en paramètre ;
 *   * une lecture doit produire un instantané PERSISTÉ, même quand elle échoue. Un appel
 *     depuis le navigateur ne laisserait aucune trace de ce qui a été tenté, et l'absence de
 *     donnée serait indistinguable d'un oubli.
 *
 *   GET  ?sources=1        → adaptateurs déclarés, sans aucune URL ni secret
 *   GET  ?property=<uuid>  → état du bien : rapprochements, diagnostic accepté, estimation
 *   POST                   → lire une source, ou trancher, ou promouvoir une estimation
 *
 * Aucune VALEUR de valorisation n'est acceptée en entrée : elle est recalculée côté serveur
 * depuis les comparables persistés, puis encadrée par la base.
 */

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  // Le message d'une RPC est informatif pour l'utilisateur (« instantané périmé », « surface
  // non déclarée ») : il est remonté tel quel, et journalisé pour le reste.
  console.error(fallback, error);
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const params = new URL(request.url).searchParams;
    const repository = getPublicDataRepository();

    if (params.get("sources") === "1") {
      return NextResponse.json(
        { sources: await repository.listSources() },
        { headers: API_HEADERS },
      );
    }

    const propertyId = params.get("property");
    if (propertyId) {
      return NextResponse.json(await repository.getPropertyView(propertyId), {
        headers: API_HEADERS,
      });
    }

    return NextResponse.json({ error: "Requête non reconnue" }, { status: 400 });
  } catch (error) {
    return failure(error, "Lecture des données publiques impossible");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = publicDataCommandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Commande invalide",
          issues: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const repository = getPublicDataRepository();
    const command = parsed.data;

    switch (command.action) {
      case "fetch":
        // Le signal de la REQUÊTE ENTRANTE descend jusqu'au transport : quand le navigateur
        // abandonne, la lecture du jeu de données s'arrête au lieu de consommer un quota
        // pour une réponse que plus personne ne lira.
        return NextResponse.json(
          await repository.fetchAndStage(command, { signal: request.signal }),
          { status: 201 },
        );
      case "decide":
        return NextResponse.json({ matches: await repository.decide(command) });
      case "promote":
        return NextResponse.json(await repository.promote(command), { status: 201 });
    }
  } catch (error) {
    return failure(error, "Commande de donnée publique impossible");
  }
}
