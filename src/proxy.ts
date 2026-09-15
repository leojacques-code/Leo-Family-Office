import { NextResponse, type NextRequest } from "next/server";
import { usesLocalFixtureAuth } from "@/lib/auth-config";
import { createSessionClient } from "@/lib/session-client";
import { verifySessionActor } from "@/lib/verified-session";

const COOKIE_NAME = "lfo_session";

/**
 * `Cache-Control` de TOUTE réponse d'API.
 *
 * Posé ici, et non route par route : une réponse d'API de ce produit porte des faits
 * patrimoniaux nominatifs. Un cache partagé — proxy d'entreprise, CDN, cache de navigateur
 * réutilisé — qui garderait une réponse la servirait à la requête suivante, et une réponse
 * de session s'en trouverait rejouée. `private` refuse le cache partagé, `no-store` refuse
 * l'écriture sur disque, `max-age=0` refuse la réutilisation immédiate.
 *
 * Le middleware est le SEUL endroit qui le garantisse pour toutes les routes, y compris
 * celles qui n'existent pas encore. Le poser dans chaque route laisse la prochaine l'oublier,
 * et c'est précisément ce qui était constaté : les GET le portaient, les POST non.
 */
export const API_CACHE_CONTROL = "private, no-store, max-age=0";

/** Applique l'en-tête de cache à une réponse d'API. Sans effet hors `/api/`. */
export function withApiCacheControl<T extends Response>(response: T, pathname: string): T {
  if (!pathname.startsWith("/api/")) return response;
  response.headers.set("Cache-Control", API_CACHE_CONTROL);
  // Un cache partagé pourrait sinon apparier deux requêtes qui ne portent pas le même
  // cookie de session.
  response.headers.set("Vary", "Cookie");
  return response;
}

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function expectedToken(secret: string) {
  const bytes = new TextEncoder().encode(`leo-family-office:${secret}`);
  // Buffer n'est pas garanti hors runtime Node : encodage manuel pour rester portable.
  return base64url(await crypto.subtle.digest("SHA-256", bytes));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublic =
    pathname === "/login" ||
    // Espace de démonstration du §19.3, atteignable depuis l'écran de connexion et donc sans
    // session. Le SEUL élargissement de la surface publique de la refonte, et il ne repose pas
    // sur une promesse : la route ne peut pas lire de donnée réelle, parce que son module de
    // données n'importe ni le dépôt ni le client Supabase. Voir `today-demo.ts`.
    pathname === "/demo" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/robots.txt";
  // Même une route publique d'API ne doit pas être mise en cache : `/api/auth` échange un
  // code d'accès, et une réponse mise en cache serait rejouable.
  if (isPublic) return withApiCacheControl(NextResponse.next(), pathname);

  let response = NextResponse.next({ request });
  // Conserver aussi les cookies renouvelés/effacés sur une redirection ou un refus.
  function finish(target: NextResponse) {
    for (const cookie of response.cookies.getAll()) target.cookies.set(cookie);
    return withApiCacheControl(target, pathname);
  }
  let authenticated = false;
  if (usesLocalFixtureAuth()) {
    const secret = process.env.SESSION_SECRET ?? "development-only-session-secret-change-me";
    const token = request.cookies.get(COOKIE_NAME)?.value;
    authenticated = token === (await expectedToken(secret));
  } else {
    try {
      const client = createSessionClient({
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          for (const { name, value } of values) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of values) response.cookies.set(name, value, options);
        },
      });
      authenticated = (await verifySessionActor(client)) !== null;
    } catch {
      if (pathname.startsWith("/api/"))
        return finish(
          NextResponse.json(
            { error: "Vérification de session momentanément indisponible" },
            { status: 503 },
          ),
        );
    }
  }
  if (!authenticated) {
    if (pathname.startsWith("/api/")) {
      return finish(NextResponse.json({ error: "Non authentifié" }, { status: 401 }));
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return finish(NextResponse.redirect(loginUrl));
  }
  return withApiCacheControl(response, pathname);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
