import { NextResponse } from "next/server";
import { serverSessionClient } from "@/lib/session-client";
import { verifySessionActor } from "@/lib/verified-session";
import { initializePersonalProfile } from "@/lib/personal-profile";
import { providerFailureCode, reportAuthFailure, reportProviderFailure } from "@/lib/auth-failure";

/**
 * Retour du lien de confirmation d'adresse (modèle d'e-mail par défaut : PKCE).
 *
 * Seule la forme `code` est acceptée : elle n'aboutit que dans le navigateur qui a créé le
 * compte, parce que le vérificateur PKCE y est posé en cookie. La forme `token_hash` n'est liée
 * à AUCUN navigateur : un lien reçu par un attaquant pour SON compte, ouvert chez une victime,
 * connecterait la victime à l'espace de l'attaquant (fixation de session), où elle saisirait
 * son patrimoine. Elle n'est donc pas servie tant qu'un modèle d'e-mail n'a pas été décidé
 * avec cette protection.
 *
 * La destination est FIXE et RELATIVE : aucune adresse reçue dans l'URL n'est suivie, et
 * l'hôte interne du serveur n'est jamais recopié dans `Location`. Un échec ne dit jamais que
 * l'adresse est confirmée : il le laisse possible et renvoie vers la connexion.
 */
function target(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Auth a déjà consommé le jeton en amont : tout code d'erreur signifie un lien inutilisable.
  if (url.searchParams.has("error") || url.searchParams.has("error_code"))
    return target("/login?confirmation=expired");
  const code = url.searchParams.get("code");
  if (!code) return target("/login?confirmation=invalid");

  try {
    const client = await serverSessionClient();
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error) {
      const outage = providerFailureCode(result.error);
      if (outage) {
        reportProviderFailure(outage, result.error, "confirm");
        return target("/login?confirmation=unavailable");
      }
      // Lien ouvert dans un autre navigateur (vérificateur absent), déjà utilisé ou expiré.
      return target("/login?confirmation=sign-in");
    }
    if (!result.data.session) return target("/login?confirmation=sign-in");
    const actor = await verifySessionActor(client);
    if (!actor) return target("/login?confirmation=sign-in");
    await initializePersonalProfile(actor.userId);
    return target("/setup?next=%2F");
  } catch (error) {
    reportAuthFailure(error, "confirm");
    return target("/login?confirmation=unavailable");
  }
}
