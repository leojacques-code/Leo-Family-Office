import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client serveur uniquement. La secret key (service role) contourne RLS ; elle ne doit
 * jamais être préfixée NEXT_PUBLIC_ ni importée depuis un composant "use client".
 * Le garde-fou d'accès est le cookie de session vérifié par proxy.ts et les route handlers.
 */

/** Coffre documentaire privé : archives durables, 8 Mio par objet, MIME en liste fermée. */
export const DOCUMENTS_BUCKET = process.env.SUPABASE_DOCUMENTS_BUCKET ?? "family-office-documents";

/**
 * Zone de STAGING d'acquisition, privée et temporaire.
 *
 *     STAGING  ≠  COFFRE DOCUMENTAIRE
 *
 * Un FEC d'exercice pèse couramment plus que ce que le coffre accepte, il est du texte à
 * plat que le coffre n'autorise pas, et il n'a de raison d'exister que le temps de
 * l'analyse. Le déposer au coffre échouerait deux fois — sur la taille et sur le type — et
 * le contournement de la limite de corps de requête ne servirait à rien.
 */
export const IMPORT_STAGING_BUCKET =
  process.env.SUPABASE_IMPORT_STAGING_BUCKET ?? "family-office-import-staging";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

let client: SupabaseClient | undefined;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = required("SUPABASE_URL");
  const key = required("SUPABASE_SECRET_KEY");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "leo-family-office" } },
  });
  return client;
}

/** UUID de l'utilisateur auth propriétaire des données (FK references auth.users(id)). */
export function ownerId(): string {
  const value = required("OWNER_USER_ID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("OWNER_USER_ID doit être l'UUID d'un utilisateur Supabase Auth.");
  }
  return value;
}
