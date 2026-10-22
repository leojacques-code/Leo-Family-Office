import { isSameOrigin } from "@/lib/same-origin";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, sessionSecret, sessionToken, verifyAccessCode } from "@/lib/auth";
import { usesLocalFixtureAuth } from "@/lib/auth-config";
import { serverSessionClient } from "@/lib/session-client";
import { verifySessionActor } from "@/lib/verified-session";
import { initializePersonalProfile } from "@/lib/personal-profile";
import { providerFailureCode, reportAuthFailure, reportProviderFailure } from "@/lib/auth-failure";

const loginSchema = z
  .object({
    email: z.email().max(320),
    password: z.string().min(1).max(1024),
    intent: z.enum(["sign-in", "sign-up"]).default("sign-in"),
  })
  .strict();

/**
 * Le lien de confirmation revient sur CE site, à la route qui échange le code. L'origine n'est
 * reprise que lorsque le navigateur l'a déclarée et qu'isSameOrigin l'a déjà comparée au Host ;
 * sans elle, Auth retombe sur la Site URL du projet. Auth n'honore de toute façon que les
 * adresses de sa liste d'autorisation : ce n'est pas une redirection ouverte.
 */
function confirmationOptions(request: Request): { emailRedirectTo?: string } {
  const origin = request.headers.get("origin");
  return origin ? { emailRedirectTo: new URL("/auth/confirm", origin).toString() } : {};
}

export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return NextResponse.json({ error: "Origine refusée" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (usesLocalFixtureAuth()) {
    const parsed = z
      .object({ code: z.string().min(1).max(256) })
      .strict()
      .safeParse(body);
    const secret = sessionSecret();
    if (!secret || !parsed.success || !verifyAccessCode(parsed.data.code))
      return NextResponse.json({ error: "Code de recette incorrect." }, { status: 401 });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, sessionToken(secret), {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 43200,
    });
    return response;
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Renseignez votre adresse e-mail et votre mot de passe." },
      { status: 400 },
    );
  const { email, password, intent } = parsed.data;
  try {
    const client = await serverSessionClient();
    if (intent === "sign-up" && password.length < 12)
      return NextResponse.json(
        { error: "Choisissez un mot de passe d’au moins 12 caractères." },
        { status: 400 },
      );
    const result =
      intent === "sign-up"
        ? await client.auth.signUp({ email, password, options: confirmationOptions(request) })
        : await client.auth.signInWithPassword({ email, password });
    if (result.error) {
      const outage = providerFailureCode(result.error);
      if (outage) {
        reportProviderFailure(outage, result.error, intent);
        return NextResponse.json(
          { error: "Connexion momentanément indisponible. Réessayez." },
          { status: 503 },
        );
      }
      return NextResponse.json(
        {
          error:
            "Connexion ou création impossible. Vérifiez vos identifiants et la confirmation de votre adresse.",
        },
        { status: 401 },
      );
    }
    if (!result.data.session) return NextResponse.json({ ok: true, confirmationRequired: true });
    const actor = await verifySessionActor(client);
    if (!actor) return NextResponse.json({ error: "Session non valide." }, { status: 401 });
    await initializePersonalProfile(actor.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    reportAuthFailure(error, intent);
    return NextResponse.json(
      { error: "Connexion momentanément indisponible. Réessayez." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request))
    return NextResponse.json({ error: "Origine refusée" }, { status: 403 });
  if (!usesLocalFixtureAuth()) {
    try {
      const { error } = await (await serverSessionClient()).auth.signOut({ scope: "local" });
      if (error) throw error;
    } catch (error) {
      reportAuthFailure(error, "sign-out");
      return NextResponse.json({ error: "Déconnexion non confirmée. Réessayez." }, { status: 503 });
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
