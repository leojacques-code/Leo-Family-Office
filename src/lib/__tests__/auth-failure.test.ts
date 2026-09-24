import { describe, expect, it } from "vitest";
import { authFailureCode } from "@/lib/auth-failure";

describe("Codes de panne d'authentification", () => {
  it("reconnaît les causes internes nommées", () => {
    expect(authFailureCode(new Error("AUTH_NOT_CONFIGURED"))).toBe("AUTH_NOT_CONFIGURED");
    expect(authFailureCode(new Error("PROFILE_INITIALIZATION_FAILED"))).toBe(
      "PROFILE_INITIALIZATION_FAILED",
    );
    expect(
      authFailureCode(new Error("Variable d'environnement manquante : SUPABASE_SECRET_KEY")),
    ).toBe("AUTH_DATA_NOT_CONFIGURED");
  });
  it("ne déduit aucune cause précise d'un message fournisseur", () => {
    expect(authFailureCode(new Error("prefix AUTH_NOT_CONFIGURED"))).toBe(
      "AUTH_PROVIDER_UNAVAILABLE",
    );
    expect(authFailureCode("string thrown")).toBe("AUTH_PROVIDER_UNAVAILABLE");
    expect(authFailureCode(undefined)).toBe("AUTH_PROVIDER_UNAVAILABLE");
  });
});
