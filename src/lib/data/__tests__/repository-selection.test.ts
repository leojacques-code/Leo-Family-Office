import { describe, expect, it, vi } from "vitest";

const fakeRepository = { adapter: "supabase" as const };
const createSupabaseRepository = vi.fn(() => fakeRepository);

vi.mock("@/lib/data/supabase-repository", () => ({ createSupabaseRepository }));

describe("repository Supabase-only", () => {
  it("ignore toute ancienne sélection d'adapter et conserve le cache", async () => {
    const legacyAdapterVariable = ["DATA", "ADAPTER"].join("_");
    process.env[legacyAdapterVariable] = "local";
    const { getRepository } = await import("@/lib/data/repository");
    expect(await getRepository()).toBe(fakeRepository);
    process.env[legacyAdapterVariable] = "anything";
    expect(await getRepository()).toBe(fakeRepository);
    expect(createSupabaseRepository).toHaveBeenCalledTimes(1);
    delete process.env[legacyAdapterVariable];
  });
});
