import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { usesLocalFixtureAuth } from "@/lib/auth-config";
import { serverSessionClient } from "@/lib/session-client";
import { verifySessionActor } from "@/lib/verified-session";

export const SESSION_COOKIE = "lfo_session";

export function sessionToken(secret: string) {
  return createHash("sha256").update(`leo-family-office:${secret}`).digest("base64url");
}

export function localAccessCode() {
  if (process.env.LOCAL_ACCESS_CODE) return process.env.LOCAL_ACCESS_CODE;
  if (process.env.NODE_ENV === "production") return null;
  return "leo-local-2026";
}

export function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") return null;
  return "development-only-session-secret-change-me";
}

function safeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

export function verifyAccessCode(code: string) {
  const expected = localAccessCode();
  return expected !== null && safeEqual(code, expected);
}

export async function isAuthenticated() {
  try {
    await requireActor();
    return true;
  } catch {
    return false;
  }
}

export async function requireAuthenticated() {
  await requireActor();
}

/** Acteur vérifié de cette requête ; aucun identifiant fourni par un formulaire n’est lu. */
export async function requireActor(): Promise<{ userId: string }> {
  if (usesLocalFixtureAuth()) {
    const secret = sessionSecret();
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!secret || !token || !safeEqual(token, sessionToken(secret)))
      throw new Error("UNAUTHORIZED");
    const userId = process.env.OWNER_USER_ID;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))
      throw new Error("AUTH_LOCAL_ACTOR_MISSING");
    return { userId };
  }
  const actor = await verifySessionActor(await serverSessionClient());
  if (!actor) throw new Error("UNAUTHORIZED");
  return actor;
}
