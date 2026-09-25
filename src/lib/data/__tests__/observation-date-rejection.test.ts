import { describe, expect, it } from "vitest";
import { mutationSchema } from "@/lib/validation/mutations";
import { operationalToday } from "@/lib/financial-date";

function tomorrow(): string {
  const date = new Date(`${operationalToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

describe("Date d'observation : un fait observé n'est pas daté après aujourd'hui", () => {
  const accountId = "11111111-1111-4111-8111-111111111111";

  it("refuse un solde de compte de demain, accepte celui d'aujourd'hui", () => {
    const base = { action: "update_account", accountId, balance: 100 };
    expect(mutationSchema.safeParse({ ...base, balanceDate: tomorrow() }).success).toBe(false);
    expect(mutationSchema.safeParse({ ...base, balanceDate: operationalToday() }).success).toBe(
      true,
    );
  });

  it("refuse l'ouverture d'un compte avec un solde daté de demain", () => {
    const base = {
      action: "add_account",
      institution: "Banque",
      name: "Compte",
      accountType: "BANK",
      balance: 10,
      currency: "EUR",
    };
    expect(mutationSchema.safeParse({ ...base, balanceDate: tomorrow() }).success).toBe(false);
    expect(mutationSchema.safeParse({ ...base, balanceDate: operationalToday() }).success).toBe(
      true,
    );
  });

  it("refuse une opération observée de demain, accepte celle d'aujourd'hui", () => {
    const base = {
      action: "add_transaction",
      accountId,
      categoryId: null,
      label: "Courses",
      amount: -20,
      updateBalance: false,
    };
    expect(mutationSchema.safeParse({ ...base, date: tomorrow() }).success).toBe(false);
    expect(mutationSchema.safeParse({ ...base, date: operationalToday() }).success).toBe(true);
  });
});
