import { NextResponse } from "next/server";
import { MutationConflictError, MutationRejectedError } from "@/lib/data/mutation-errors";
import { SupabaseOperationError } from "@/lib/data/supabase-errors";

/**
 * Réponse d'échec PARTAGÉE des routes d'API (lot A du 12 octobre 2026).
 *
 * Avant ce module, sept routes renvoyaient `error.message` tel quel au navigateur : texte de
 * PostgreSQL ou de Supabase compris (noms de contraintes, de tables, valeurs persistées), ce
 * que la route `state` refusait déjà. CLAUDE.md §3 : un diagnostic d'échec ne reprend jamais
 * un message technique.
 *
 * Ce qui atteint le navigateur :
 *   * 401 pour une session absente ;
 *   * 409 et 422 pour un refus MÉTIER typé (message fixe rédigé par le repository) ;
 *   * 400 (409 pour `LF409`) pour un refus RÉDIGÉ dans une RPC `lfo_*` (`P0001`, `LF4xx`) :
 *     « consentement expiré », « couverture de l'exercice non déclarée » informent
 *     l'utilisateur, et les routes d'acquisition les remontaient délibérément ;
 *   * 400 pour un refus rédigé par le repository en `new Error("…")` littéral ;
 *   * 500 et le message de repli pour tout le reste, journalisé côté serveur seulement.
 *
 * Est traité comme technique, donc masqué : un échec Supabase d'un autre code (contrainte,
 * droit, réseau), une erreur d'une autre classe qu'`Error`
 * (`TypeError`, `RangeError`…), un message enveloppé « Supabase … » (texte renvoyé par la base
 * ou le stockage) et tout message qui cite une URL.
 */
export function routeFailure(error: unknown, fallback: string): NextResponse {
  if (error instanceof Error && error.message === "UNAUTHORIZED")
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (error instanceof MutationConflictError)
    return NextResponse.json({ error: error.message, code: "CONFLICT" }, { status: 409 });
  if (error instanceof MutationRejectedError)
    return NextResponse.json({ error: error.message, code: "REJECTED" }, { status: 422 });
  if (error instanceof SupabaseOperationError && error.authoredRefusal)
    return NextResponse.json(
      { error: error.databaseMessage },
      { status: error.code === "LF409" ? 409 : 400 },
    );
  if (isAuthoredRefusal(error)) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function isAuthoredRefusal(error: unknown): error is Error {
  if (!(error instanceof Error) || error.constructor !== Error) return false;
  const message = error.message.trim();
  return (
    message.length > 0 &&
    message.length <= 300 &&
    !message.startsWith("Supabase ") &&
    !/https?:\/\//i.test(message)
  );
}
