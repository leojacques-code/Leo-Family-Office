import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), mutate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuthenticated: mocks.auth }));
vi.mock("@/lib/data/repository", () => ({
  getRepository: async () => ({ mutateState: mocks.mutate }),
}));
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/state", { method: "POST", body: JSON.stringify(body) }));
const income = {
  action: "record_net_income",
  accountId: "11111111-1111-4111-8111-111111111111",
  receivedOn: "2026-09-23",
  amount: 2450.35,
  label: "Salaire septembre",
  notes: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(undefined);
  mocks.mutate.mockResolvedValue({});
});

describe("revenu net observé par /api/state", () => {
  it("transmet la commande validée", async () => {
    expect((await post(income)).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledWith(income);
  });
  it("refuse devise, acteur, catégorie, montant nul ou date inexistante", async () => {
    for (const invalid of [
      { ...income, currency: "EUR" },
      { ...income, userId: "11111111-1111-4111-8111-111111111111" },
      { ...income, categoryId: "c" },
      { ...income, amount: 0 },
      { ...income, amount: -10 },
      { ...income, receivedOn: "2026-02-30" },
      { ...income, accountId: "pas-un-uuid" },
      { ...income, label: " " },
    ])
      expect((await post(invalid)).status).toBe(400);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
