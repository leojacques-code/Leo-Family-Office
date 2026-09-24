import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverSessionClient } from "@/lib/session-client";
import { verifySessionActor } from "@/lib/verified-session";
import { initializePersonalProfile } from "@/lib/personal-profile";
import { reportAuthFailure } from "@/lib/auth-failure";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "email", "invite", "email_change"];

/**
 * Retour du lien de confirmation d'adresse.
 *
 * Deux formes existent selon le modèle d'e-mail du projet Auth : `code` (PKCE, modèle par
 * défaut, vérificateur posé en cookie lors de la création) et `token_hash` + `type` (modèle
 * recommandé pour un rendu serveur). La destination est FIXE : aucune adresse reçue dans l'URL
 * n'est suivie. Un échec ne dit jamais que l'adresse est confirmée : il le laisse possible et
 * renvoie vers la connexion, où seul Auth tranche.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const target = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (url.searchParams.get("error_code") === "otp_expired")
    return target("/login?confirmation=expired");
  if (!code && !(tokenHash && type && OTP_TYPES.includes(type)))
    return target("/login?confirmation=invalid");

  try {
    const client = await serverSessionClient();
    const result = code
      ? await client.auth.exchangeCodeForSession(code)
      : await client.auth.verifyOtp({ token_hash: tokenHash!, type: type! });
    // Lien ouvert dans un autre navigateur (vérificateur absent), déjà utilisé ou expiré.
    if (result.error || !result.data.session) return target("/login?confirmation=sign-in");
    const actor = await verifySessionActor(client);
    if (!actor) return target("/login?confirmation=sign-in");
    await initializePersonalProfile(actor.userId);
    return target("/setup?next=%2F");
  } catch (error) {
    reportAuthFailure(error, "sign-up");
    return target("/login?confirmation=unavailable");
  }
}
