import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  upsert: vi.fn(),
  select: vi.fn(),
  read: vi.fn(),
  single: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireActor: mocks.actor }));
vi.mock("../supabase-client", () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));
import { getPersonalSetupRepository } from "../personal-setup-repository";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ userId: "A" });
  mocks.from.mockReturnValue({ select: mocks.select, upsert: mocks.upsert });
  mocks.select.mockReturnValue({ eq: mocks.eq, single: mocks.single });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.read });
  mocks.upsert.mockReturnValue({ select: mocks.select });
  mocks.read.mockResolvedValue({
    data: { display_name: "A", first_intent: "PROJECT" },
    error: null,
  });
  mocks.single.mockResolvedValue({
    data: { display_name: "A", first_intent: "PROJECT" },
    error: null,
  });
});
describe("Préférences bornées par acteur", () => {
  it("relit les préférences de chaque acteur sans cache partagé", async () => {
    await (await getPersonalSetupRepository()).read();
    mocks.actor.mockResolvedValue({ userId: "B" });
    await (await getPersonalSetupRepository()).read();
    expect(mocks.eq.mock.calls).toEqual([
      ["user_id", "A"],
      ["user_id", "B"],
    ]);
  });
  it("ne modifie que les deux préférences dans le profil courant", async () => {
    await (await getPersonalSetupRepository()).save({ displayName: "A", firstIntent: "PROJECT" });
    expect(mocks.from.mock.calls).toEqual([["profiles"]]);
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: "A", display_name: "A", first_intent: "PROJECT" },
      { onConflict: "user_id" },
    );
  });
  it("une lecture échouée ne se replie pas sur un profil neuf", async () => {
    mocks.read.mockResolvedValue({ data: null, error: { message: "private detail" } });
    await expect((await getPersonalSetupRepository()).read()).rejects.toThrow(
      "PERSONAL_SETUP_READ_FAILED",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
