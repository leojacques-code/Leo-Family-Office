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
      { ...income, receivedOn: "2099-01-01" },
    ])
      expect((await post(invalid)).status).toBe(400);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

describe("correction d'un revenu saisi par /api/state", () => {
  const correction = {
    action: "correct_net_income",
    transactionId: "22222222-2222-4222-8222-222222222222",
    reason: "Montant saisi avant retenue à la source",
    expected: { amount: 2450.35, receivedOn: "2026-09-23", label: "Salaire septembre" },
    corrected: { amount: 2405.35 },
  };
  it("transmet la commande validée", async () => {
    expect((await post(correction)).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledWith(correction);
  });
  it("refuse acteur, compte, devise, état attendu incomplet, correction vide ou future", async () => {
    for (const invalid of [
      { ...correction, actorUserId: "11111111-1111-4111-8111-111111111111" },
      { ...correction, corrected: { accountId: "11111111-1111-4111-8111-111111111111" } },
      { ...correction, corrected: { currency: "CHF" } },
      { ...correction, corrected: {} },
      { ...correction, corrected: { amount: 0 } },
      { ...correction, corrected: { receivedOn: "2099-01-01" } },
      { ...correction, corrected: { label: "  " } },
      { ...correction, expected: { amount: 2450.35, receivedOn: "2026-09-23" } },
      { ...correction, reason: " " },
      { ...correction, transactionId: "pas-un-uuid" },
    ])
      expect((await post(invalid)).status).toBe(400);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("rend un conflit 409 et un refus 422 avec le message du repository, pas celui de la base", async () => {
    const { MutationConflictError, MutationRejectedError } =
      await import("@/lib/data/mutation-errors");
    mocks.mutate.mockRejectedValueOnce(new MutationConflictError("Ce revenu a changé"));
    const conflict = await post(correction);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Ce revenu a changé", code: "CONFLICT" });
    mocks.mutate.mockRejectedValueOnce(new MutationRejectedError("Aucune valeur n’a changé"));
    expect((await post(correction)).status).toBe(422);
    mocks.mutate.mockRejectedValueOnce(new Error("Supabase correction : Conflit : montant 12"));
    const failure = await post(correction);
    expect(failure.status).toBe(500);
    expect(JSON.stringify(await failure.json())).not.toContain("12");
  });
});

describe("opération saisie par /api/state", () => {
  const operation = {
    action: "add_transaction",
    accountId: "11111111-1111-4111-8111-111111111111",
    categoryId: null,
    date: "2026-09-20",
    label: "Courses",
    amount: -45.2,
    updateBalance: false,
  };
  it("accepte une opération NON CLASSÉE, sans devise reçue", async () => {
    expect((await post(operation)).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledWith(operation);
  });
  it("refuse une date future, une devise envoyée, un montant nul ou un libellé vide", async () => {
    for (const invalid of [
      { ...operation, date: "2099-01-01" },
      { ...operation, amount: 0 },
      { ...operation, label: "  " },
      { ...operation, categoryId: "" },
      { ...operation, date: "2026-02-30" },
    ])
      expect((await post(invalid)).status).toBe(400);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
