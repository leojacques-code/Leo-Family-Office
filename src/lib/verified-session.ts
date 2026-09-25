import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/data/supabase-client";

export interface SessionActor {
  readonly userId: string;
  readonly sessionId: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identité validée par Auth, puis contrôle de révocation SQL sur la session correspondante. */
export async function verifySessionActor(client: SupabaseClient): Promise<SessionActor | null> {
  const userResult = await client.auth.getUser();
  if (userResult.error || !userResult.data.user || userResult.data.user.is_anonymous) return null;
  const userId = userResult.data.user.id;
  const sessionResult = await client.auth.getSession();
  const token = sessionResult.data.session?.access_token;
  if (sessionResult.error || !token) return null;
  let claims: { sub?: string; session_id?: string };
  try {
    claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  // Le JWT n’est jamais la preuve d’identité à lui seul : getUser l’a déjà validé côté Auth.
  if (
    claims.sub !== userId ||
    !uuid.test(userId) ||
    !claims.session_id ||
    !uuid.test(claims.session_id)
  )
    return null;
  const { data, error } = await supabaseAdmin().rpc("lfo_verify_session", {
    p_user_id: userId,
    p_session_id: claims.session_id,
  });
  // PGRST202 : la fonction n'existe pas dans le schéma exposé, typiquement une base à laquelle
  // la migration 20260914191901 n'a pas été appliquée. Un code distinct, pas un refus : la
  // session n'est ni prouvée valide ni prouvée révoquée.
  if (error)
    throw new Error(
      error.code === "PGRST202" ? "AUTH_SESSION_CHECK_MISSING" : "AUTH_SESSION_CHECK_FAILED",
    );
  return data === true ? { userId, sessionId: claims.session_id } : null;
}
