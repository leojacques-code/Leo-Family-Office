import { describe, expect, it, vi } from "vitest";
import { routeFailure } from "@/lib/route-failure";
import { MutationConflictError, MutationRejectedError } from "@/lib/data/mutation-errors";
import { SupabaseOperationError } from "@/lib/data/supabase-errors";

async function body(response: Response) {
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe("routeFailure : aucun texte technique n'atteint le navigateur", () => {
  it("masque le texte renvoyé par la base ou le stockage", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await body(
      routeFailure(
        new Error(
          'Supabase lfo_validate_import_session : duplicate key value violates unique constraint "imports_hash_key"',
        ),
        "Validation impossible",
      ),
    );
    expect(result).toEqual({ status: 500, json: { error: "Validation impossible" } });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("masque une erreur d'exécution et un message qui cite une URL", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const error of [
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new Error("fetch failed: https://provider.example/accounts?token=secret"),
      "chaîne brute",
    ]) {
      const result = await body(routeFailure(error, "Lecture impossible"));
      expect(result).toEqual({ status: 500, json: { error: "Lecture impossible" } });
    }
    log.mockRestore();
  });

  it("garde les refus rédigés par le produit, typés ou littéraux", async () => {
    expect(await body(routeFailure(new Error("UNAUTHORIZED"), "x"))).toEqual({
      status: 401,
      json: { error: "Non authentifié" },
    });
    expect(await body(routeFailure(new MutationConflictError("État périmé."), "x"))).toEqual({
      status: 409,
      json: { error: "État périmé.", code: "CONFLICT" },
    });
    expect(await body(routeFailure(new MutationRejectedError("Refusé."), "x"))).toEqual({
      status: 422,
      json: { error: "Refusé.", code: "REJECTED" },
    });
    expect(await body(routeFailure(new Error("Compte cible inactif"), "x"))).toEqual({
      status: 400,
      json: { error: "Compte cible inactif" },
    });
  });

  it("remonte un refus rédigé dans une RPC, masque une erreur technique de la base", async () => {
    const authored = await body(
      routeFailure(
        new SupabaseOperationError("lfo_start_bank_sync", {
          message: "Consentement expiré : renouvelez-le avant de synchroniser",
          code: "P0001",
        }),
        "Synchronisation impossible",
      ),
    );
    expect(authored).toEqual({
      status: 400,
      json: { error: "Consentement expiré : renouvelez-le avant de synchroniser" },
    });
    const conflict = await body(
      routeFailure(
        new SupabaseOperationError("lfo_decide", { message: "État périmé", code: "LF409" }),
        "x",
      ),
    );
    expect(conflict.status).toBe(409);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const technical = await body(
      routeFailure(
        new SupabaseOperationError("lfo_validate", {
          message: 'new row violates check constraint "fec_entry_lines_period_ck"',
          code: "23514",
        }),
        "Validation impossible",
      ),
    );
    expect(technical).toEqual({ status: 500, json: { error: "Validation impossible" } });
    log.mockRestore();
  });
});
