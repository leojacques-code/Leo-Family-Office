import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Currency } from "../ui";
import { OptionalCurrency } from "../pages/shared";

describe("montants affichés, sans conversion", () => {
  it.each(["EUR", "USD", "CHF", "JPY"])("garde le montant dans %s", (currency) => {
    const { container } = render(<Currency value={1234.56} currency={currency} />);
    expect(container.textContent).toBe(
      new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(1234.56),
    );
  });
  it("conserve le défaut historique EUR et le signe négatif", () => {
    const { container } = render(<Currency value={-42} />);
    expect(container.textContent).toMatch(/^−42\s*€/);
  });
  it("transmet la devise et le signe du montant facultatif", () => {
    const { container } = render(<OptionalCurrency value={42} currency="USD" sign />);
    expect(container.textContent).toMatch(/^\+42\s*\$US/);
  });
  it("distingue montant inconnu, zéro et devise absente", () => {
    const { container, rerender } = render(
      <OptionalCurrency value={null} currency="USD" fallback="Non fourni" />,
    );
    expect(container.textContent).toBe("Non fourni");
    rerender(<Currency value={0} currency="USD" />);
    expect(container.textContent).toMatch(/^0\s*\$US/);
    rerender(<Currency value={12} currency={null} />);
    expect(container.textContent).toBe("12 (devise non renseignée)");
  });
  it("supporte le format compact et une ancienne devise invalide sans inventer EUR", () => {
    const { container, rerender } = render(<Currency value={12000} currency="USD" compact />);
    expect(container.textContent).toMatch(/12.*k.*\$US/);
    rerender(<Currency value={12} currency="invalide" />);
    expect(container.textContent).toBe("12 invalide");
  });
});
