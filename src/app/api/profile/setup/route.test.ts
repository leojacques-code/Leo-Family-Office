import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.resetAllMocks();
  mocks.repository.mockResolvedValue({ save: mocks.save });
  mocks.save.mockImplementation(async (value) => value);
});
describe("Frontière du profil initial", () => {
  it("refuse un acteur ou une hypothèse financière ajoutée au formulaire", async () => {
    for (const extra of [{ userId: "B" }, { annualReturn: 0.1 }, { reportingCurrency: "USD" }])
      expect(
        (
          await post({
            displayName: "A",
            firstIntent: null,
            residenceCountry: null,
            contextDate: null,
            ...extra,
          })
        ).status,
      ).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("exige une session vérifiée avant l'écriture", async () => {
    mocks.repository.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect(
      (
        await post({
          displayName: "A",
          firstIntent: null,
          residenceCountry: null,
          contextDate: null,
        })
      ).status,
    ).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("acquitte les seuls choix normalisés avec une réponse privée", async () => {
    const response = await post({
      displayName: "  Espace A  ",
      firstIntent: "BUDGET",
      residenceCountry: null,
      contextDate: null,
    });
    expect(await response.json()).toEqual({
      displayName: "Espace A",
      firstIntent: "BUDGET",
      residenceCountry: null,
      contextDate: null,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["2026-02-30", "0000-01-01", "9999-01-01", "infinity"])(
    "refuse une date invalide ou future : %s",
    async (contextDate) => {
      expect(
        (
          await post({
            displayName: "A",
            firstIntent: null,
            residenceCountry: "Suisse",
            contextDate,
          })
        ).status,
      ).toBe(400);
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );
  it("enregistre un contexte partiel sans fabriquer de date", async () => {
    const response = await post({
      displayName: "A",
      firstIntent: null,
      residenceCountry: " Suisse ",
      contextDate: null,
    });
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({
      displayName: "A",
      firstIntent: null,
      residenceCountry: "Suisse",
      contextDate: null,
    });
  });
  it("refuse les origines étrangères avant tout accès au dépôt", async () => {
    expect((await post({}, "https://foreign.invalid")).status).toBe(403);
    expect(mocks.repository).not.toHaveBeenCalled();
  });
  it("accepte le jour courant en Europe/Paris autour de minuit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T22:30:00Z"));
    const response = await post({
      displayName: "A",
      firstIntent: null,
      residenceCountry: "Suisse",
      contextDate: "2026-09-21",
    });
    expect(response.status).toBe(200);
    expect(
      (
        await post({
          displayName: "A",
          firstIntent: null,
          residenceCountry: "Suisse",
          contextDate: "2026-09-22",
        })
      ).status,
    ).toBe(400);
  });
});
