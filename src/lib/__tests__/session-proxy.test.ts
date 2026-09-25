import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CookieMethodsServer } from "@supabase/ssr";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), cookieValue: "renewed" }));
vi.mock("@/lib/auth-config", () => ({ usesLocalFixtureAuth: () => false }));
vi.mock("@/lib/session-client", () => ({
  createSessionClient: (cookies: CookieMethodsServer) => {
    cookies.setAll!([
      {
        name: "sb-test-auth-token",
        value: mocks.cookieValue,
        options: { httpOnly: true, path: "/", sameSite: "lax" },
      },
    ]);
    return {};
  },
}));
vi.mock("@/lib/verified-session", () => ({ verifySessionActor: mocks.verify }));
import { proxy } from "@/proxy";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookieValue = "renewed";
});
describe("Cookies de session traversant le proxy", () => {
  it("transmet le renouvellement sur la réponse et la requête serveur", async () => {
    mocks.verify.mockResolvedValue({ userId: "user" });
    const request = new NextRequest("http://localhost/api/debt");
    const response = await proxy(request);
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("renewed");
    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("renewed");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    ["/net-worth", 307],
    ["/api/debt", 401],
  ] as const)("conserve la suppression du cookie sur %s", async (path, status) => {
    mocks.cookieValue = "";
    mocks.verify.mockResolvedValue(null);
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(response.status).toBe(status);
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("");
  });
  it("refuse l'API lorsque le contrôle de révocation est indisponible", async () => {
    mocks.verify.mockRejectedValue(new Error("AUTH_SESSION_CHECK_FAILED"));
    const response = await proxy(new NextRequest("http://localhost/api/debt"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("laisse passer le seul retour de confirmation, sans élargir la surface voisine", async () => {
    const open = await proxy(new NextRequest("http://localhost/auth/confirm?code=abc"));
    expect(open.status).toBe(200);
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.verify.mockResolvedValue(null);
    const neighbour = await proxy(new NextRequest("http://localhost/auth/confirm-other"));
    expect(neighbour.status).toBe(307);
  });
  it("journalise par code la panne du contrôle de session, sans le message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.verify.mockRejectedValue(new Error("AUTH_SESSION_CHECK_MISSING"));
    await proxy(new NextRequest("http://localhost/api/debt"));
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      code: "AUTH_SESSION_CHECK_MISSING",
      stage: "session",
    });
    log.mockRestore();
  });
});
