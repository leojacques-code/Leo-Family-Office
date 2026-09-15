import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, sessionSecret, sessionToken, verifyAccessCode } from "@/lib/auth";
import { usesLocalFixtureAuth } from "@/lib/auth-config";
import { serverSessionClient } from "@/lib/session-client";
import { verifySessionActor } from "@/lib/verified-session";
import { supabaseAdmin } from "@/lib/data/supabase-client";

const loginSchema = z
  .object({
    email: z.email().max(320),
    password: z.string().min(1).max(1024),
    intent: z.enum(["sign-in", "sign-up"]).default("sign-in"),
  })
  .strict();
function originAllowed(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!originAllowed(request))
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
  try {
    const client = await serverSessionClient();
    const { email, password, intent } = parsed.data;
    if (intent === "sign-up" && password.length < 12)
      return NextResponse.json(
        { error: "Choisissez un mot de passe d’au moins 12 caractères." },
        { status: 400 },
      );
    const result =
      intent === "sign-up"
        ? await client.auth.signUp({ email, password })
        : await client.auth.signInWithPassword({ email, password });
    if (result.error)
      return NextResponse.json(
        {
          error:
            "Connexion ou création impossible. Vérifiez vos identifiants et la confirmation de votre adresse.",
        },
        { status: 401 },
      );
    if (!result.data.session) return NextResponse.json({ ok: true, confirmationRequired: true });
    const actor = await verifySessionActor(client);
    if (!actor) return NextResponse.json({ error: "Session non valide." }, { status: 401 });
    // Un seul profil vide. Aucune donnée du compte de démonstration ni seed financier.
    const { error } = await supabaseAdmin()
      .from("profiles")
      .upsert(
        { user_id: actor.userId, display_name: "Espace personnel", reporting_currency: "EUR" },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
    if (error) throw new Error("PROFILE_INITIALIZATION_FAILED");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Connexion momentanément indisponible. Réessayez." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!originAllowed(request))
    return NextResponse.json({ error: "Origine refusée" }, { status: 403 });
  if (!usesLocalFixtureAuth()) {
    try {
      const { error } = await (await serverSessionClient()).auth.signOut({ scope: "local" });
      if (error) throw error;
    } catch {
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
