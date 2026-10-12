import { describe, expect, it } from "vitest";
import { documentCommandSchema } from "@/lib/validation/documents";

const fieldId = "00000000-0000-4000-8000-0000000000aa";

describe("commande de décision sur une case (B19)", () => {
  it("exige la révision lue de la case", () => {
    expect(documentCommandSchema.safeParse({ action: "reject", fieldId }).success).toBe(false);
    expect(
      documentCommandSchema.safeParse({ action: "reject", fieldId, expectedRevision: -1 }).success,
    ).toBe(false);
    expect(
      documentCommandSchema.safeParse({ action: "reject", fieldId, expectedRevision: 1.5 }).success,
    ).toBe(false);
    expect(
      documentCommandSchema.safeParse({ action: "reject", fieldId, expectedRevision: 0 }).success,
    ).toBe(true);
  });

  it("garde la règle « corriger vers rien est un rejet »", () => {
    expect(
      documentCommandSchema.safeParse({ action: "correct", fieldId, expectedRevision: 0 }).success,
    ).toBe(false);
    expect(
      documentCommandSchema.safeParse({
        action: "correct",
        fieldId,
        expectedRevision: 0,
        userValue: 12,
      }).success,
    ).toBe(true);
  });
});
