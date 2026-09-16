import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/data/supabase-client", () => ({ supabaseAdmin: () => mocks }));
import { verifySessionActor } from "../verified-session";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  S = "33333333-3333-4333-8333-333333333333";
function client(userId = A, claims: unknown = { sub: userId, session_id: S }) {
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: { id: userId, is_anonymous: false } }, error: null });
  const getSession = vi
    .fn()
    .mockResolvedValue({
      data: {
        session: {
          access_token: `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`,
        },
      },
      error: null,
    });
  return { auth: { getUser, getSession } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});
describe("acteur personnel vérifié", () => {
  it("dérive chaque acteur de la réponse Auth vérifiée et contrôle sa propre session", async () => {
    expect(await verifySessionActor(client(A) as unknown as SupabaseClient)).toEqual({
      userId: A,
      sessionId: S,
    });
    expect(await verifySessionActor(client(B) as unknown as SupabaseClient)).toEqual({
      userId: B,
      sessionId: S,
    });
    expect(mocks.rpc.mock.calls.map((x) => x[1].p_user_id)).toEqual([A, B]);
  });
  it("ne fait confiance ni au JWT seul ni à son utilisateur embarqué", async () => {
    const c = client();
    c.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid signature" },
    });
    expect(await verifySessionActor(c as unknown as SupabaseClient)).toBeNull();
    expect(c.auth.getSession).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ sub: B, session_id: S }, { sub: A }, { sub: A, session_id: "not-a-session" }])(
    "refuse les claims incohérents %o",
    async (claims) => {
      expect(await verifySessionActor(client(A, claims) as unknown as SupabaseClient)).toBeNull();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("refuse immédiatement une session révoquée malgré un getUser réussi", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await verifySessionActor(client() as unknown as SupabaseClient)).toBeNull();
  });
  it("ne transforme pas une panne de contrôle de révocation en accès autorisé", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "provider detail" } });
    await expect(verifySessionActor(client() as unknown as SupabaseClient)).rejects.toThrow(
      "AUTH_SESSION_CHECK_FAILED",
    );
  });
});
