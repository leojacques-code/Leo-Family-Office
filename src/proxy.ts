import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "lfo_session";

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function expectedToken(secret: string) {
  const bytes = new TextEncoder().encode(`leo-family-office:${secret}`);
  return base64url(await crypto.subtle.digest("SHA-256", bytes));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublic = pathname === "/"
    || pathname === "/login"
    || pathname.startsWith("/api/auth")
    || pathname.startsWith("/_next")
    || pathname === "/favicon.ico"
    || pathname === "/icon.svg"
    || pathname === "/robots.txt";
  if (isPublic) return NextResponse.next();

  const secret = process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? null : "development-only-session-secret-change-me");
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const authenticated = secret ? token === await expectedToken(secret) : false;
  if (!authenticated) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
