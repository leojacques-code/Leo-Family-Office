import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock("@/lib/data/supabase-client", () => ({
  DOCUMENTS_BUCKET: "family-office-documents",
  ownerId: () => "11111111-1111-4111-8111-111111111111",
  supabaseAdmin: () => ({
    rpc: mocks.rpc,
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  }),
}));

import { createSupabaseRepository } from "@/lib/data/supabase-repository";

const run = {
  scenarioId: "22222222-2222-4222-8222-222222222222",
  seed: 42,
  simulations: 100,
  years: 1,
  methodology: "test",
  points: [{ year: 2026, p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 }],
};

describe("écritures critiques Supabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persiste une simulation par un unique RPC transactionnel", async () => {
    mocks.rpc.mockResolvedValue({ data: "run-id", error: null });
    const repository = createSupabaseRepository();
    await expect(repository.saveSimulation(run)).resolves.toBe("run-id");
    expect(mocks.rpc).toHaveBeenCalledWith("lfo_save_simulation", expect.any(Object));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("ne tente aucune écriture séparée si le RPC de simulation échoue", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "results rejected" } });
    const repository = createSupabaseRepository();
    await expect(repository.saveSimulation(run)).rejects.toThrow(/results rejected/);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("supprime l'objet Storage si l'enregistrement documents échoue", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: "object" }, error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    mocks.storageFrom.mockReturnValue({ upload, remove });
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "insert failed" } });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    mocks.from.mockReturnValue({ insert });

    const repository = createSupabaseRepository();
    await expect(
      repository.storeDocument({
        name: "preuve.pdf",
        category: "Contrat",
        contentType: "application/pdf",
        size: 3,
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/insert failed/);
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/\.pdf$/)]);
  });
});
