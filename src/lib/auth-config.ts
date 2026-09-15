/** Le mode fictif est explicitement local et indisponible dans un build de production. */
export function usesLocalFixtureAuth(): boolean {
  if (process.env.NODE_ENV === "production" || process.env.LFO_AUTH_MODE !== "local-fixture")
    return false;
  try {
    const url = new URL(process.env.SUPABASE_URL ?? "");
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function supabaseAuthConfiguration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("AUTH_NOT_CONFIGURED");
  return { url, key };
}
