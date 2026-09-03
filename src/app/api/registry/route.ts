import { NextResponse } from "next/server";
import { API_HEADERS } from "@/lib/http";

import { requireAuthenticated } from "@/lib/auth";
import { getRegistryRepository } from "@/lib/data/registry-repository";
import {
  registryCommandSchema,
  registryLookupSchema,
  registrySearchSchema,
  registryStateSchema,
} from "@/lib/validation/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ACQUISITION DU REGISTRE D'ENTREPRISES — SEULE PORTE SERVEUR
 *
 * Le navigateur n'appelle JAMAIS un registre directement, et ce n'est pas une question de
 * confort :
 *
 *   * le jeton du RNE est un secret serveur. Un appel depuis le navigateur l'exposerait à
 *     quiconque ouvre les outils de développement ;
 *   * le quota du fournisseur se compte par connexion, pas par onglet. Un appel client
 *     rendrait le quota incontrôlable ;
 *   * un instantané doit être PERSISTÉ à chaque appel, succès comme échec. Un appel client
 *     produirait une observation dont il ne reste aucune trace.
 *
 *   GET  ?connections=1        état des connexions déclarées, sans aucun secret
 *   GET  ?business=<uuid>      identité légale d'une société : liens, propositions, historique
 *   POST { search }            recherche ouverte, instantané persisté
 *   POST { lookup }            fiche d'entité, instantané réutilisé s'il est encore frais
 *   PATCH                      rattacher, détacher, proposer, décider
 *
 * Aucun corps de requête ne dépasse quelques centaines d'octets : rien de volumineux ne
 * traverse cette route.
 */

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  console.error(fallback, error);
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const params = new URL(request.url).searchParams;
    const repository = getRegistryRepository();

    if (params.get("connections") === "1") {
      return NextResponse.json(
        { connections: await repository.describeConnections() },
        { headers: API_HEADERS },
      );
    }

    const business = params.get("business");
    if (business) {
      const parsed = registryStateSchema.safeParse({ businessId: business });
      if (!parsed.success) {
        return NextResponse.json({ error: "Société non précisée" }, { status: 400 });
      }
      return NextResponse.json(await repository.getBusinessRegistryState(parsed.data.businessId), {
        headers: API_HEADERS,
      });
    }

    return NextResponse.json({ error: "Requête non reconnue" }, { status: 400 });
  } catch (error) {
    return failure(error, "Lecture du registre impossible");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const repository = getRegistryRepository();

    if (body && "lookup" in body) {
      const parsed = registryLookupSchema.safeParse(body.lookup);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Fiche demandée invalide" },
          { status: 400 },
        );
      }
      return NextResponse.json(await repository.lookupEntity(parsed.data), { status: 201 });
    }

    const parsed = registrySearchSchema.safeParse(body && "search" in body ? body.search : body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Recherche invalide" },
        { status: 400 },
      );
    }
    return NextResponse.json(await repository.search(parsed.data), { status: 201 });
  } catch (error) {
    return failure(error, "Interrogation du registre impossible");
  }
}

/**
 * Écritures. `decide` est la seule action qui touche `businesses`, et elle passe par une RPC
 * atomique qui refuse un vide, un champ hors liste blanche, et une valeur canonique modifiée
 * depuis la proposition.
 */
export async function PATCH(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = registryCommandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Commande de registre invalide", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const repository = getRegistryRepository();

    switch (parsed.data.action) {
      case "link":
        return NextResponse.json(await repository.linkBusiness(parsed.data));
      case "unlink":
        return NextResponse.json({
          businessId: await repository.unlinkBusiness(parsed.data.businessId, parsed.data.provider),
        });
      case "propose":
        return NextResponse.json(await repository.proposeEnrichment(parsed.data));
      case "decide":
        return NextResponse.json(await repository.decide(parsed.data));
    }
  } catch (error) {
    return failure(error, "Commande de registre impossible");
  }
}
