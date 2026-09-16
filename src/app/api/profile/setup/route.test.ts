import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ repository: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/data/personal-setup-repository", () => ({
  getPersonalSetupRepository: mocks.repository,
}));
import { POST } from "./route";
const post = (body: unknown, origin = "http://localhost") =>
  POST(
    new Request("http://localhost/api/profile/setup", {
      method: "POST",
      headers: { origin },
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.repository.mockResolvedValue({ save: mocks.save });
  mocks.save.mockImplementation(async (value) => value);
});
describe("Frontière du profil initial", () => {
  it("refuse un acteur ou une hypothèse financière ajoutée au formulaire", async () => {
    for (const extra of [{ userId: "B" }, { annualReturn: 0.1 }])
      expect((await post({ displayName: "A", firstIntent: null, ...extra })).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("exige une session vérifiée avant l'écriture", async () => {
    mocks.repository.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await post({ displayName: "A", firstIntent: null })).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("acquitte les seuls choix normalisés avec une réponse privée", async () => {
    const response = await post({ displayName: "  Espace A  ", firstIntent: "BUDGET" });
    expect(await response.json()).toEqual({ displayName: "Espace A", firstIntent: "BUDGET" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("refuse les origines étrangères avant tout accès au dépôt", async () => {
    expect((await post({}, "https://foreign.invalid")).status).toBe(403);
    expect(mocks.repository).not.toHaveBeenCalled();
  });
});
