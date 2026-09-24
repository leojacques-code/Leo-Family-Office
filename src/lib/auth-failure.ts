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
  | "AUTH_KEY_REJECTED"
  | "AUTH_DATA_NOT_CONFIGURED"
  | "AUTH_SESSION_CHECK_MISSING"
  | "AUTH_SESSION_CHECK_FAILED"
  | "PROFILE_INITIALIZATION_FAILED"
  | "AUTH_PROVIDER_UNAVAILABLE";

export type AuthFailureStage = "sign-in" | "sign-up" | "sign-out" | "session" | "confirm";

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

/**
 * auth-js ne LÈVE pas sur une panne : un réseau coupé ou un 5xx devient un `result.error`
 * (AuthRetryableFetchError, statut 0 ou ≥ 500), et une clé publiable refusée par la passerelle
 * un 401 sans code auth-js. Sans ce tri, ces pannes répondaient « vérifiez vos identifiants »
 * et ne laissaient aucune trace. Retourne `null` pour une erreur qui relève de l'utilisateur
 * (identifiants, adresse non confirmée, mot de passe faible…).
 */
export function providerFailureCode(
  error: { status?: number; code?: string } | null | undefined,
): AuthFailureCode | null {
  if (!error) return null;
  if (error.status === undefined || error.status === 0 || error.status >= 500)
    return "AUTH_PROVIDER_UNAVAILABLE";
  if (error.status === 401 && !error.code) return "AUTH_KEY_REJECTED";
  return null;
}

/** Journalise une panne de fournisseur ; le code auth-js n'est repris que s'il est fermé. */
export function reportProviderFailure(
  code: AuthFailureCode,
  error: { status?: number; code?: string },
  stage: AuthFailureStage,
): void {
  const authCode =
    typeof error.code === "string" && /^[a-z_]{1,64}$/.test(error.code) ? error.code : null;
  console.error("lfo.auth.failure", {
    code,
    stage,
    status: typeof error.status === "number" ? error.status : null,
    authCode,
    serverTime: new Date().toISOString(),
  });
}
