import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  create: vi.fn((userId: string) => ({ adapter: "supabase" as const, userId })),
}));
vi.mock("@/lib/auth", () => ({ requireActor: mocks.actor }));
vi.mock("@/lib/data/supabase-repository", () => ({ createSupabaseRepository: mocks.create }));
import { getRepository } from "../repository";
afterEach(() => vi.clearAllMocks());
describe("repository Supabase de l’acteur courant", () => {
  it("ne conserve pas le repository d’un utilisateur pour la requête suivante", async () => {
    mocks.actor.mockResolvedValueOnce({ userId: "a" }).mockResolvedValueOnce({ userId: "b" });
    expect(await getRepository()).toEqual({ adapter: "supabase", userId: "a" });
    expect(await getRepository()).toEqual({ adapter: "supabase", userId: "b" });
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("ne construit pas de repository si la session est absente", async () => {
    mocks.actor.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(getRepository()).rejects.toThrow("UNAUTHORIZED");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
