import { requireActor } from "@/lib/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/data/supabase-client", () => ({
  ownerId: () => "11111111-1111-4111-8111-111111111111",
  supabaseAdmin: () => mock,
}));
import { getRegistryRepository } from "@/lib/data/registry-repository";

describe("B06 — consulter les connexions", () => {
  beforeEach(() => vi.clearAllMocks());
  function query(rows: unknown[], error: unknown = null) {
    const q = {
      select: vi.fn(),
      eq: vi.fn(),
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error }),
    };
    q.select.mockReturnValue(q);
    q.eq.mockReturnValue(q);
    mock.from.mockReturnValue(q);
    return q;
  }
  it("rend les adaptateurs non configurés sans RPC, même sur un compte vierge", async () => {
    const q = query([]);
    const result = await (await getRegistryRepository()).describeConnections();
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every((item) => item.status === "NOT_CONFIGURED" && item.lastCheckedAt === null),
    ).toBe(true);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from).toHaveBeenCalledTimes(1);
    expect(q.eq).toHaveBeenCalledWith("user_id", "11111111-1111-4111-8111-111111111111");
    expect(q.eq).toHaveBeenCalledWith("domain", "COMPANY_REGISTRY");
  });
  it("préserve l'état d'erreur persisté au lieu de le réinitialiser", async () => {
    query([
      {
        provider: "FIXTURE",
        status: "ERROR",
        last_error: "Échec de lecture",
        last_checked_at: "2026-09-10T12:00:00Z",
      },
    ]);
    expect(
      (await (await getRegistryRepository()).describeConnections()).find(
        (item) => item.provider === "FIXTURE",
      ),
    ).toMatchObject({
      status: "ERROR",
      lastError: "Échec de lecture",
      lastCheckedAt: "2026-09-10T12:00:00Z",
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});

vi.mock("@/lib/auth", () => ({ requireActor: vi.fn() }));

vi.mocked(requireActor).mockResolvedValue({userId: "11111111-1111-4111-8111-111111111111"});
