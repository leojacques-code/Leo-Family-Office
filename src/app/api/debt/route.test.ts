import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), write: vi.fn(), global: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuthenticated: mocks.auth }));
vi.mock("@/lib/data/repository", () => ({
  getRepository: async () => ({
    getDebtReadModel: mocks.read,
    executeMutation: mocks.write,
    getDashboardState: mocks.global,
  }),
}));
import { GET, POST } from "./route";
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/debt", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(undefined);
});
describe("frontière HTTP Dettes", () => {
  it("refuse une session absente avant toute lecture ou écriture", async () => {
    mocks.auth.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await GET()).status).toBe(401);
    expect((await post({})).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("refuse une mutation d'un autre domaine", async () => {
    expect(
      (
        await post({
          action: "update_account",
          accountId: "account",
          balance: 1,
          balanceDate: "2026-09-01",
        })
      ).status,
    ).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("retourne un acquittement sans faire dépendre l'écriture d'une lecture", async () => {
    const command = {
      action: "record_debt_balance",
      liabilityId: "11111111-1111-4111-8111-111111111111",
      balance: 0,
      observedAt: "2026-08-31",
      notes: null,
    };
    const response = await post(command);
    expect(await response.json()).toEqual({ saved: true });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.write).toHaveBeenCalledWith(command);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.global).not.toHaveBeenCalled();
  });
  it("retourne seulement le modèle local", async () => {
    mocks.read.mockResolvedValue({ liabilities: [], asOfDate: "2026-08-31" });
    expect(await (await GET()).json()).toEqual({ liabilities: [], asOfDate: "2026-08-31" });
    expect(mocks.global).not.toHaveBeenCalled();
  });
});
