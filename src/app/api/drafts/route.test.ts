import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuthenticated: mocks.auth }));
vi.mock("@/lib/data/repository", () => ({
  getRepository: async () => ({ saveFormDraft: mocks.save, deleteFormDraft: mocks.remove }),
}));
import { DELETE, POST } from "./route";
import { MutationConflictError } from "@/lib/data/mutation-errors";

const request = (method: string, body: unknown) =>
  new Request("http://localhost/api/drafts", { method, body: JSON.stringify(body) });
const draft = {
  draftId: null,
  expectedVersion: null,
  kind: "DEBT_CONTRACT_NEW",
  subjectId: null,
  title: "Prêt immobilier",
  content: { contract: { name: "Prêt immobilier" } },
  schemaVersion: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ id: "d", version: 1, updatedAt: "2026-09-25T08:00:00Z" });
});

describe("/api/drafts : brouillons, distincts des mutations de faits", () => {
  it("enregistre un brouillon incomplet et rend sa version", async () => {
    const response = await POST(request("POST", draft));
    expect(response.status).toBe(200);
    expect((await response.json()).saved.version).toBe(1);
    expect(mocks.save).toHaveBeenCalledWith(draft);
  });
  it("refuse clé d'acteur, version sans brouillon, dette nouvelle rattachée, contenu non objet", async () => {
    for (const invalid of [
      { ...draft, userId: "11111111-1111-4111-8111-111111111111" },
      { ...draft, expectedVersion: 2 },
      { ...draft, subjectId: "11111111-1111-4111-8111-111111111111" },
      { ...draft, kind: "DEBT_CONTRACT_EDIT" },
      { ...draft, content: [] },
      { ...draft, content: { big: "x".repeat(61_000) } },
      { ...draft, title: " " },
    ]) {
      expect((await POST(request("POST", invalid))).status).toBe(400);
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rend un conflit révisable, sans écrire", async () => {
    mocks.save.mockRejectedValue(new MutationConflictError("Ce brouillon a été modifié ailleurs."));
    const response = await POST(
      request("POST", {
        ...draft,
        draftId: "11111111-1111-4111-8111-111111111111",
        expectedVersion: 1,
      }),
    );
    expect(response.status).toBe(409);
  });
  it("supprime sous version attendue seulement", async () => {
    expect(
      (await DELETE(request("DELETE", { draftId: "11111111-1111-4111-8111-111111111111" }))).status,
    ).toBe(400);
    expect(
      (
        await DELETE(
          request("DELETE", {
            draftId: "11111111-1111-4111-8111-111111111111",
            expectedVersion: 2,
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", 2);
  });
});
