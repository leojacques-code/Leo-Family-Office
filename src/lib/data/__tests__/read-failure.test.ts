import { describe, expect, it, vi } from "vitest";
import { reportReadFailure } from "@/lib/data/read-failure";

describe("B05 — diagnostic de lecture", () => {
  it("classe l'erreur temporelle sans journaliser le message fournisseur", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = reportReadFailure(
        { message: "JWT issued at future secret-token-should-not-leak" },
        "lecture #25",
      );
      expect(log).toHaveBeenCalledWith(
        "lfo.read.failure",
        expect.objectContaining({
          code: "DATABASE_JWT_FUTURE",
          context: "lecture #25",
          serverTime: expect.any(String),
        }),
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
      expect(error.message).not.toContain("JWT");
    } finally {
      log.mockRestore();
    }
  });
});
