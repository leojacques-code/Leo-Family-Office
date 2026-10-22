const PRODUCTION_PROJECT_REF = "zwgrcznzymbfdiybeuvv";

/** Refuse une preview mal ciblée avant tout client Auth, données ou Storage. */
export function assertPreviewSupabaseConfiguration(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.VERCEL_ENV !== "preview") return;

  const refuse = (): never => {
    // Code fermé : aucune URL ni valeur de clé ne doit finir dans un journal public.
    throw new Error("PREVIEW_SUPABASE_CONFIGURATION_REFUSED");
  };
  const ref = env.LFO_STAGING_SUPABASE_PROJECT_REF;
  if (!ref || !/^[a-z]{20}$/.test(ref) || ref === PRODUCTION_PROJECT_REF) refuse();
  const expected = `https://${ref}.supabase.co/`;
  for (const name of ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    try {
      if (new URL(env[name] ?? "").href !== expected) refuse();
    } catch {
      refuse();
    }
  }
  // Les clés publiables modernes peuvent porter le nom historique ANON_KEY côté Storage.
  for (const name of ["SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    if (!env[name]?.startsWith("sb_publishable_")) refuse();
  }
  if (env.SUPABASE_PUBLISHABLE_KEY !== env.NEXT_PUBLIC_SUPABASE_ANON_KEY) refuse();
  if (!env.SUPABASE_SECRET_KEY) refuse();
  if (env.LFO_AUTH_MODE === "local-fixture") refuse();
}
