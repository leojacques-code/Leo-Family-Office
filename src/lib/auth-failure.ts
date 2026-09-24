import "server-only";

/**
 * Cause d'un refus d'authentification que le serveur n'a pas pu décider.
 *
 * Le message public reste générique ; le journal porte seulement un code fermé, l'étape et
 * l'heure serveur. Jamais `error.message` : un client HTTP y cite l'URL, parfois un jeton, et
 * un message d'environnement nommerait une variable secrète. Sans ce code, un 503 d'Auth ne
 * dit pas si la clé publiable manque, si la RPC de session est absente ou si le fournisseur
 * est injoignable : trois corrections différentes pour un même symptôme.
 */
export type AuthFailureCode =
  | "AUTH_NOT_CONFIGURED"
  | "AUTH_DATA_NOT_CONFIGURED"
  | "AUTH_SESSION_CHECK_MISSING"
  | "AUTH_SESSION_CHECK_FAILED"
  | "PROFILE_INITIALIZATION_FAILED"
  | "AUTH_PROVIDER_UNAVAILABLE";

export type AuthFailureStage = "sign-in" | "sign-up" | "sign-out" | "session";

const KNOWN: readonly AuthFailureCode[] = [
  "AUTH_NOT_CONFIGURED",
  "AUTH_SESSION_CHECK_MISSING",
  "AUTH_SESSION_CHECK_FAILED",
  "PROFILE_INITIALIZATION_FAILED",
];

export function authFailureCode(error: unknown): AuthFailureCode {
  const message = error instanceof Error ? error.message : "";
  const known = KNOWN.find((code) => message === code);
  if (known) return known;
  // supabaseAdmin() refuse de démarrer sans URL ou clé serveur.
  if (message.startsWith("Variable d'environnement manquante")) return "AUTH_DATA_NOT_CONFIGURED";
  return "AUTH_PROVIDER_UNAVAILABLE";
}

export function reportAuthFailure(error: unknown, stage: AuthFailureStage): AuthFailureCode {
  const code = authFailureCode(error);
  console.error("lfo.auth.failure", { code, stage, serverTime: new Date().toISOString() });
  return code;
}
