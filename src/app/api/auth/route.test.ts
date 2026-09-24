import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  fixture: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  actor: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@/lib/auth-config", () => ({ usesLocalFixtureAuth: mocks.fixture }));
vi.mock("@/lib/session-client", () => ({
  serverSessionClient: () => mocks.client(),
}));
vi.mock("@/lib/verified-session", () => ({ verifySessionActor: mocks.actor }));
vi.mock("@/lib/data/supabase-client", () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));
import { POST, DELETE } from "./route";
const body = { email: "recipe@example.invalid", password: "only-for-unit-tests" };
const post = (data: unknown, origin = "http://localhost") =>
  POST(
    new Request("http://localhost/api/auth", {
      method: "POST",
      headers: { origin },
      body: JSON.stringify(data),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.fixture.mockReturnValue(false);
  mocks.client.mockResolvedValue({
    auth: { signInWithPassword: mocks.signIn, signUp: mocks.signUp, signOut: mocks.signOut },
  });
  mocks.signIn.mockResolvedValue({ data: { session: {} }, error: null });
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.actor.mockResolvedValue({ userId: "00000000-0000-4000-8000-000000000002" });
  mocks.from.mockReturnValue({ upsert: mocks.upsert });
  mocks.upsert.mockResolvedValue({ error: null });
});
describe("Authentification personnelle HTTP", () => {
  it("initialise uniquement le profil de l'acteur vérifié sans seed financier", async () => {
    expect((await post(body)).status).toBe(200);
    expect(mocks.from.mock.calls).toEqual([["profiles"]]);
    expect(mocks.upsert).toHaveBeenCalledWith(
      {
        user_id: "00000000-0000-4000-8000-000000000002",
        display_name: "Espace personnel",
        reporting_currency: "EUR",
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  });
  it("refuse un acteur ou un code local injecté dans le formulaire personnel", async () => {
    expect((await post({ ...body, userId: "other" })).status).toBe(400);
    expect((await post({ code: "legacy-code" })).status).toBe(400);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("attend la confirmation d'adresse sans écrire de profil ni ouvrir une session", async () => {
    const response = await post({ ...body, intent: "sign-up" });
    expect(await response.json()).toEqual({ ok: true, confirmationRequired: true });
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("refuse un mot de passe de création trop court", async () => {
    expect((await post({ ...body, intent: "sign-up", password: "short" })).status).toBe(400);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
  it("une session révoquée ne peut initialiser de profil", async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await post(body)).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("signale une panne sans publier les détails du fournisseur", async () => {
    mocks.upsert.mockResolvedValue({ error: { message: "private database details" } });
    const response = await post(body);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database details");
  });
  it("rejette les appels provenant d'un autre site", async () => {
    expect((await post(body, "https://foreign.invalid")).status).toBe(403);
    expect(
      (
        await DELETE(
          new Request("http://localhost/api/auth", {
            method: "DELETE",
            headers: { origin: "https://foreign.invalid" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("ne confirme pas une révocation échouée et permet de réessayer", async () => {
    mocks.signOut.mockResolvedValueOnce({ error: new Error("Auth unavailable") });
    const request = () => new Request("http://localhost/api/auth", { method: "DELETE" });
    expect((await DELETE(request())).status).toBe(503);
    expect((await DELETE(request())).status).toBe(200);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("journalise la cause d'un 503 sans jamais publier ni journaliser le message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Cause observée sur la preview du 23 septembre : clé publiable absente de l'environnement.
    mocks.client.mockRejectedValueOnce(new Error("AUTH_NOT_CONFIGURED"));
    const missingKey = await post(body);
    expect(missingKey.status).toBe(503);
    expect(mocks.signIn).not.toHaveBeenCalled();
    mocks.actor.mockRejectedValueOnce(new Error("AUTH_SESSION_CHECK_MISSING"));
    expect((await post(body)).status).toBe(503);
    mocks.signIn.mockRejectedValueOnce(new Error("fetch failed https://secret.invalid?token=abc"));
    const unreachable = await post(body);
    expect(await unreachable.text()).not.toContain("secret.invalid");
    expect(log.mock.calls.map(([, detail]) => (detail as { code: string }).code)).toEqual([
      "AUTH_NOT_CONFIGURED",
      "AUTH_SESSION_CHECK_MISSING",
      "AUTH_PROVIDER_UNAVAILABLE",
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret.invalid");
    expect(JSON.stringify(log.mock.calls)).not.toContain("recipe@example.invalid");
    log.mockRestore();
  });
  it("fait revenir le lien de confirmation sur ce site, et seulement si l'origine est déclarée", async () => {
    await post({ ...body, intent: "sign-up" });
    expect(mocks.signUp).toHaveBeenCalledWith({
      ...body,
      options: { emailRedirectTo: "http://localhost/auth/confirm" },
    });
    mocks.signUp.mockClear();
    await POST(
      new Request("http://localhost/api/auth", {
        method: "POST",
        body: JSON.stringify({ ...body, intent: "sign-up" }),
      }),
    );
    expect(mocks.signUp).toHaveBeenCalledWith({ ...body, options: {} });
  });
});
