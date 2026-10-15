import { describe, expect, it } from "vitest";
import { assertPreviewSupabaseConfiguration } from "../preview-supabase-config";

const stagingRef = "abcdefghijklmnopqrst";
const preview = {
  VERCEL_ENV: "preview",
  LFO_STAGING_SUPABASE_PROJECT_REF: stagingRef,
  SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_key",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic_test_key",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic_test_key",
};

describe("cible Supabase de Vercel Preview", () => {
  it("autorise Auth, données et Storage sur le même staging déclaré", () => {
    expect(() => assertPreviewSupabaseConfiguration(preview)).not.toThrow();
  });

  it("ne change pas la configuration de production ou du développement local", () => {
    for (const VERCEL_ENV of [undefined, "development", "production"]) {
      expect(() => assertPreviewSupabaseConfiguration({ VERCEL_ENV })).not.toThrow();
    }
  });

  it("refuse une preview vide et le projet de production même déclaré staging", () => {
    expect(() => assertPreviewSupabaseConfiguration({ VERCEL_ENV: "preview" })).toThrow(
      "PREVIEW_SUPABASE_CONFIGURATION_REFUSED",
    );
    const ref = "zwgrcznzymbfdiybeuvv";
    expect(() =>
      assertPreviewSupabaseConfiguration({
        ...preview,
        LFO_STAGING_SUPABASE_PROJECT_REF: ref,
        SUPABASE_URL: `https://${ref}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
      }),
    ).toThrow("PREVIEW_SUPABASE_CONFIGURATION_REFUSED");
  });

  it.each([
    ["SUPABASE_URL", "https://zwgrcznzymbfdiybeuvv.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://zwgrcznzymbfdiybeuvv.supabase.co"],
    ["SUPABASE_URL", `http://${stagingRef}.supabase.co`],
    ["SUPABASE_URL", `https://${stagingRef}.supabase.co/other`],
    ["SUPABASE_URL", `https://${stagingRef}.supabase.co/?secret=do-not-log`],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_secret_do-not-log"],
    ["SUPABASE_PUBLISHABLE_KEY", "sb_publishable_other_project"],
    ["SUPABASE_SECRET_KEY", ""],
    ["LFO_AUTH_MODE", "local-fixture"],
  ])("refuse %s mal configuré sans révéler sa valeur", (name, value) => {
    expect(() => assertPreviewSupabaseConfiguration({ ...preview, [name]: value })).toThrow(
      /^PREVIEW_SUPABASE_CONFIGURATION_REFUSED$/,
    );
  });
});
