import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../supabase-client", () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }),
  DOCUMENTS_BUCKET: "documents",
}));
import { createSupabaseRepository } from "../supabase-repository";
import { MutationConflictError, MutationRejectedError } from "../mutation-errors";

const correction = {
  action: "correct_net_income" as const,
  transactionId: "22222222-2222-4222-8222-222222222222",
  reason: "Montant saisi avant retenue à la source",
  expected: { amount: "2450.350000", receivedOn: "2026-09-23", label: "Salaire septembre" },
  corrected: { amount: 2405.35 },
};
const failWith = (message: string) =>
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message, code: "P0001" } });

beforeEach(() => {
  vi.resetAllMocks();
  // La relecture qui suit une écriture réussie n'est pas l'objet de ces tests.
  mocks.from.mockImplementation(() => {
    throw new Error("relecture non simulée");
  });
});

describe("correction d'un revenu saisi (repository)", () => {
  it("envoie l'état attendu et la seule valeur corrigée en TEXTE décimal", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "c", error: null });
    await expect(createSupabaseRepository("A").mutateState(correction)).rejects.toThrow(
      "relecture non simulée",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("lfo_correct_net_income", {
      p_user_id: "A",
      p_payload: {
        transaction_id: correction.transactionId,
        reason: correction.reason,
        expected: { amount: "2450.350000", received_on: "2026-09-23", label: "Salaire septembre" },
        corrected: { amount: "2405.35" },
      },
    });
  });

  it("traduit un conflit d'état attendu en message fixe, sans reprendre les valeurs de la base", async () => {
    failWith("Conflit : montant attendu 2450.35, trouvé 2405.350000");
    const error = await createSupabaseRepository("A")
      .mutateState(correction)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MutationConflictError);
    expect((error as Error).message).not.toMatch(/2405|2450/);
  });

  it("traduit une correction sans changement et un hors périmètre en refus métier", async () => {
    failWith("Aucune valeur modifiée : ce n'est pas une correction");
    await expect(createSupabaseRepository("A").mutateState(correction)).rejects.toBeInstanceOf(
      MutationRejectedError,
    );
    failWith("Seul un revenu net saisi à la main se corrige ici");
    await expect(createSupabaseRepository("A").mutateState(correction)).rejects.toBeInstanceOf(
      MutationRejectedError,
    );
  });

  it("laisse une autre erreur de base remonter comme une panne", async () => {
    failWith("permission denied for function lfo_correct_net_income");
    const error = await createSupabaseRepository("A")
      .mutateState(correction)
      .catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(MutationConflictError);
    expect(error).not.toBeInstanceOf(MutationRejectedError);
  });
});
