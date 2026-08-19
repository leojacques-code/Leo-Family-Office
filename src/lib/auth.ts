import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

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
  const secret = sessionSecret();
  if (!secret) return false;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return Boolean(token && safeEqual(token, sessionToken(secret)));
}

export async function requireAuthenticated() {
  if (!(await isAuthenticated())) throw new Error("UNAUTHORIZED");
}
