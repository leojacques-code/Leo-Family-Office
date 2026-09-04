/**
 * En-têtes HTTP partagés par toutes les routes d'API.
 *
 * Une réponse d'API de ce produit porte des faits patrimoniaux nominatifs. Un cache
 * partagé — proxy d'entreprise, CDN, cache de navigateur réutilisé — qui garderait une
 * réponse la servirait à la requête suivante : `private` refuse le cache partagé,
 * `no-store` refuse l'écriture sur disque, `max-age=0` refuse la réutilisation immédiate.
 *
 * La valeur est DÉCLARÉE ici et nulle part ailleurs. Le middleware la pose sur toutes les
 * réponses `/api/`, y compris celles des routes qui n'existent pas encore ; les routes qui
 * posent leurs propres en-têtes reprennent cette même constante, pour qu'il n'existe pas
 * deux vérités sur ce que le cache est autorisé à faire.
 */
export const API_CACHE_CONTROL = "private, no-store, max-age=0";

/** En-têtes d'une réponse d'API, prêts à être passés à `NextResponse.json`. */
export const API_HEADERS = {
  "Cache-Control": API_CACHE_CONTROL,
  // Sans `Vary: Cookie`, un cache partagé pourrait apparier deux requêtes qui ne portent
  // pas le même cookie de session.
  Vary: "Cookie",
} as const;
