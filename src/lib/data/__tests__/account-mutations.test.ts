import { describe, expect, it } from "vitest";
import { mutationSchema } from "@/lib/validation/mutations";
const creation = {
  action: "add_account",
  institution: "Banque",
  name: "Compte",
  accountType: "BANK",
  balance: 0,
  currency: "EUR",
  balanceDate: "2026-08-31",
};
describe("date d'observation des comptes", () => {
  it("accepte zéro explicite et conserve la date fournie", () => {
    expect(mutationSchema.parse(creation)).toEqual(creation);
  });
  it.each([undefined, "", "2026-02-30", "2026-13-01"])(
    "refuse la date absente ou impossible %s à la création et à la correction",
    (balanceDate) => {
      expect(mutationSchema.safeParse({ ...creation, balanceDate }).success).toBe(false);
      expect(
        mutationSchema.safeParse({
          action: "update_account",
          accountId: "account",
          balance: 0,
          balanceDate,
        }).success,
      ).toBe(false);
    },
  );
});
