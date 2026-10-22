import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Amount } from "@/components/pages/today/figures";

/**
 * Un montant d'Aujourd'hui se lit comme sur Patrimoine : la recette « premier utilisateur » du
 * 25 septembre 2026 a vu « 1 000 € » sur Aujourd'hui et « 999,50 € » sur Patrimoine pour le
 * même bilan. Les centimes présents s'affichent, un montant entier reste sans décimales.
 */
describe("Aujourd'hui : format des montants", () => {
  const text = (node: React.ReactElement) =>
    render(node).container.textContent?.replace(/\s/g, " ") ?? "";

  it("affiche les centimes d'un montant qui en porte", () => {
    expect(text(<Amount currency="EUR" value={999.5} />)).toBe("999,50 €");
  });

  it("laisse un montant entier sans décimales, signe compris", () => {
    expect(text(<Amount currency="EUR" value={2500} />)).toBe("2 500 €");
    expect(text(<Amount currency="EUR" signed value={3100} />)).toBe("+3 100 €");
    expect(text(<Amount currency="EUR" value={-12.3} />)).toBe("−12,30 €");
  });
});
