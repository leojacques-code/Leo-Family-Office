import { describe, expect, it } from "vitest";
import { formatCurrency } from "@/lib/presentation/currency";

const plain = (text: string) => text.replace(/\s/g, " ");

describe("formatage monétaire", () => {
  it("affiche les deux décimales dès qu'un montant porte des centimes", () => {
    expect(plain(formatCurrency(1500.5, "EUR"))).toBe("1 500,50 €");
    expect(plain(formatCurrency(2450.35, "CHF"))).toBe("2 450,35 CHF");
    expect(plain(formatCurrency(0.1, "EUR"))).toBe("0,10 €");
  });
  it("garde un montant entier sans décimales", () => {
    expect(plain(formatCurrency(1500, "EUR"))).toBe("1 500 €");
    expect(plain(formatCurrency(1500.001, "EUR"))).toBe("1 500 €");
  });
  it("n'invente pas de devise quand elle manque", () => {
    expect(formatCurrency(12.5, null)).toContain("(devise non renseignée)");
  });
});
