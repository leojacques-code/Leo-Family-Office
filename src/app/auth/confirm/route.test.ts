import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  verifyOtp: vi.fn(),
  actor: vi.fn(),
  profile: vi.fn(),
}));
vi.mock("@/lib/session-client", () => ({
  serverSessionClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verifyOtp },
  }),
}));
vi.mock("@/lib/verified-session", () => ({ verifySessionActor: mocks.actor }));
vi.mock("@/lib/personal-profile", () => ({ initializePersonalProfile: mocks.profile }));
import { GET } from "./route";

const USER = "00000000-0000-4000-8000-000000000003";
const call = async (query: string) => {
  const response = await GET(new Request(`http://internal-host:3000/auth/confirm${query}`));
  expect(response.status).toBe(303);
  return response.headers.get("location");
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.exchange.mockResolvedValue({ data: { session: {} }, error: null });
  mocks.actor.mockResolvedValue({ userId: USER, sessionId: USER });
  mocks.profile.mockResolvedValue(undefined);
});

describe("Retour du lien de confirmation", () => {
  it("échange le code, initialise le seul profil de l'acteur vérifié et ouvre l'accueil", async () => {
    expect(await call("?code=abc")).toBe("/setup?next=%2F");
    expect(mocks.exchange).toHaveBeenCalledWith("abc");
    expect(mocks.profile).toHaveBeenCalledWith(USER);
  });
  it("ne recopie jamais l'hôte interne du serveur dans la redirection", async () => {
    expect(await call("?code=abc")).not.toContain("internal-host");
  });
  it("refuse la forme token_hash, qui n'est liée à aucun navigateur (fixation de session)", async () => {
    expect(await call("?token_hash=h&type=email")).toBe("/login?confirmation=invalid");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("ne suit aucune destination fournie dans l'URL", async () => {
    expect(await call("?code=abc&next=https://evil.invalid&redirect_to=https://evil.invalid")).toBe(
      "/setup?next=%2F",
    );
  });
  it("renvoie vers la connexion sans prétendre l'adresse confirmée quand le code échoue", async () => {
    mocks.exchange.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error("verifier"), { status: 400, code: "bad_code_verifier" }),
    });
    expect(await call("?code=abc")).toBe("/login?confirmation=sign-in");
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("nomme une panne du fournisseur renvoyée dans result.error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.exchange.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError("fetch failed https://secret.invalid", 0),
    });
    expect(await call("?code=abc")).toBe("/login?confirmation=unavailable");
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      code: "AUTH_PROVIDER_UNAVAILABLE",
      stage: "confirm",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret.invalid");
    log.mockRestore();
  });
  it("n'initialise aucun profil pour une session non vérifiée", async () => {
    mocks.actor.mockResolvedValue(null);
    expect(await call("?code=abc")).toBe("/login?confirmation=sign-in");
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("traite tout code d'erreur d'Auth comme un lien inutilisable, et nomme un lien incomplet", async () => {
    expect(await call("?error=access_denied&error_code=otp_expired")).toBe(
      "/login?confirmation=expired",
    );
    expect(await call("?error=server_error")).toBe("/login?confirmation=expired");
    expect(await call("")).toBe("/login?confirmation=invalid");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("journalise une panne interne par code et renvoie un message générique", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.profile.mockRejectedValue(new Error("PROFILE_INITIALIZATION_FAILED"));
    expect(await call("?code=abc")).toBe("/login?confirmation=unavailable");
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      code: "PROFILE_INITIALIZATION_FAILED",
      stage: "confirm",
    });
    log.mockRestore();
  });
});
