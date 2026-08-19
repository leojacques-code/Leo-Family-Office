import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, sessionSecret, sessionToken, verifyAccessCode } from "@/lib/auth";

const loginSchema = z.object({ code: z.string().min(1).max(256) });

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  const secret = sessionSecret();
  if (!secret) return NextResponse.json({ error: "SESSION_SECRET doit être configuré en production." }, { status: 503 });
  if (!parsed.success || !verifyAccessCode(parsed.data.code)) {
    return NextResponse.json({ error: "Code d’accès incorrect." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
