import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listRuns: vi.fn(),
  getReview: vi.fn(),
  upload: vi.fn(),
  decide: vi.fn(),
  validate: vi.fn(),
  reject: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAuthenticated: mocks.auth }));
vi.mock("@/lib/data/schedule-document-repository", () => ({
  getScheduleDocumentRepository: async () => ({
    listRuns: mocks.listRuns,
    getReview: mocks.getReview,
    upload: mocks.upload,
    decide: mocks.decide,
    validate: mocks.validate,
    reject: mocks.reject,
  }),
}));
import { GET, PATCH, POST } from "./route";

const LIABILITY = "11111111-1111-4111-8111-111111111111";
const FIELD = "22222222-2222-4222-8222-222222222222";
const url = "http://localhost/api/debt/schedule-documents";
const patch = (body: unknown) =>
  PATCH(new Request(url, { method: "PATCH", body: JSON.stringify(body) }));
const upload = (file: File | null, options: unknown) => {
  const form = new FormData();
  if (file) form.append("file", file);
  form.append("options", JSON.stringify(options));
  return POST(new Request(url, { method: "POST", body: form }));
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(undefined);
});

describe("frontière HTTP des échéanciers déposés (B19)", () => {
  it("refuse une session absente avant toute lecture ou écriture", async () => {
    mocks.auth.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await GET(new Request(`${url}?liabilityId=${LIABILITY}`))).status).toBe(401);
    expect((await patch({ action: "validate", runId: LIABILITY })).status).toBe(401);
    expect(mocks.listRuns).not.toHaveBeenCalled();
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it("refuse un format non annoncé avant toute lecture", async () => {
    const response = await upload(new File(["%PDF"], "echeancier.pdf"), {
      liabilityId: LIABILITY,
      declaredCurrency: "EUR",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/CSV et XLSX/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("refuse une devise qui n'est pas un code ISO, jamais supposée", async () => {
    const response = await upload(new File(["date;principal"], "e.csv"), {
      liabilityId: LIABILITY,
      declaredCurrency: "euro",
    });
    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("transmet le fichier et la dette au repository", async () => {
    mocks.upload.mockResolvedValue({ run: { runId: "r" }, fields: [], checks: [], decisions: [] });
    const response = await upload(new File(["date;principal\n2026-10-05;1"], "e.csv"), {
      liabilityId: LIABILITY,
      declaredCurrency: null,
    });
    expect(response.status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({ liabilityId: LIABILITY, declaredCurrency: null }),
    );
  });

  it("exige la révision lue et UNE valeur pour corriger, en texte décimal", async () => {
    expect((await patch({ action: "correct", fieldId: FIELD, userValue: "1" })).status).toBe(400);
    expect((await patch({ action: "correct", fieldId: FIELD, expectedRevision: 0 })).status).toBe(
      400,
    );
    expect(
      (
        await patch({
          action: "correct",
          fieldId: FIELD,
          expectedRevision: 0,
          userValue: "1",
          userDate: "2026-10-05",
        })
      ).status,
    ).toBe(400);
    expect(
      (await patch({ action: "correct", fieldId: FIELD, expectedRevision: 0, userValue: "1e3" }))
        .status,
    ).toBe(400);
    expect(
      (
        await patch({
          action: "correct",
          fieldId: FIELD,
          expectedRevision: 0,
          userDate: "2026-02-30",
        })
      ).status,
    ).toBe(400);
    expect(mocks.decide).not.toHaveBeenCalled();
    mocks.decide.mockResolvedValue({ run: {}, fields: [], checks: [], decisions: [] });
    const response = await patch({
      action: "correct",
      fieldId: FIELD,
      expectedRevision: 2,
      userValue: "1 234,5".replace(" ", ""),
      reason: "Relu sur la pièce",
    });
    expect(response.status).toBe(200);
    expect(mocks.decide).toHaveBeenCalledWith({
      fieldId: FIELD,
      action: "correct",
      expectedRevision: 2,
      userValue: "1234.5",
      userDate: null,
      reason: "Relu sur la pièce",
    });
  });

  it("refuse une clé d'acteur dans une décision", async () => {
    const response = await patch({
      action: "reject",
      fieldId: FIELD,
      expectedRevision: 0,
      actorUserId: LIABILITY,
    });
    expect(response.status).toBe(400);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("remonte un conflit de révision rédigé par la base, en 409", async () => {
    const { SupabaseOperationError } = await import("@/lib/data/supabase-errors");
    mocks.decide.mockRejectedValue(
      new SupabaseOperationError("lfo_correct_document_extraction_field", {
        message: "Cette case a changé depuis votre lecture",
        code: "LF409",
      }),
    );
    const response = await patch({ action: "review", fieldId: FIELD, expectedRevision: 0 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Cette case a changé depuis votre lecture");
  });
});
