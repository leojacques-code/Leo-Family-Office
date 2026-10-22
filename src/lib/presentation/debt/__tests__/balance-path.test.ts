import { describe, expect, it } from "vitest";
import { balancePath } from "../balance-path";

describe("balancePath : trajectoire de l'encours sans fausse courbe", () => {
  it("garde le palier d'un in fine : aucun point intermédiaire n'est sauté", () => {
    const path = balancePath(
      [
        { dueDate: "2027-09-01", entryKind: "PAYMENT", closingBalance: 10000 },
        { dueDate: "2028-09-01", entryKind: "PAYMENT", closingBalance: 10000 },
        { dueDate: "2029-09-01", entryKind: "PAYMENT", closingBalance: 0 },
      ],
      { date: "2026-09-01", balance: 10000 },
    );
    expect(path).toEqual([
      { date: "2026-09-01", balance: 10000 },
      { date: "2027-09-01", balance: 10000 },
      { date: "2028-09-01", balance: 10000 },
      { date: "2029-09-01", balance: 0 },
    ]);
  });

  it("ignore l'assurance séparée et retient le dernier solde d'une même date", () => {
    const path = balancePath(
      [
        { dueDate: "2026-10-05", entryKind: "PAYMENT", closingBalance: 1100 },
        { dueDate: "2026-10-05", entryKind: "CHARGE", closingBalance: 1120 },
        { dueDate: "2026-10-05", entryKind: "INSURANCE", closingBalance: 999 },
      ],
      null,
    );
    expect(path).toEqual([{ date: "2026-10-05", balance: 1120 }]);
  });

  it("ne produit aucun point sans échéance ni observation", () => {
    expect(balancePath([], null)).toEqual([]);
  });

  it("n'échantillonne pas un long échéancier", () => {
    const entries = Array.from({ length: 240 }, (_, index) => ({
      dueDate: `${2027 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-05`,
      entryKind: "PAYMENT" as const,
      closingBalance: 240 - index - 1,
    }));
    expect(balancePath(entries, null)).toHaveLength(240);
  });
});
