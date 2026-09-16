import { afterEach, expect, it, vi } from "vitest";
import { usesLocalFixtureAuth } from "../auth-config";
afterEach(() => vi.unstubAllEnvs());
it("le propriétaire fixe n’est disponible que dans une recette explicitement locale", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("LFO_AUTH_MODE", "local-fixture");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:55441");
  expect(usesLocalFixtureAuth()).toBe(true);
  vi.stubEnv("NODE_ENV", "production");
  expect(usesLocalFixtureAuth()).toBe(false);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SUPABASE_URL", "https://production.supabase.co");
  expect(usesLocalFixtureAuth()).toBe(false);
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:55441");
  vi.stubEnv("LFO_AUTH_MODE", "");
  expect(usesLocalFixtureAuth()).toBe(false);
});
