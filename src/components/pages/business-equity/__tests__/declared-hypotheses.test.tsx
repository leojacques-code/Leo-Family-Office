import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DcfForm,
  HoldingLinkForm,
  OwnershipForm,
  QuickStartForm,
  ValuationBasisForm,
} from "../forms";
import { formatDeclaredRate, formatMultiple } from "../display";

/**
 * Lot A du 12 octobre 2026 : aucune hypothèse financière n'est préremplie (CLAUDE.md §3 et §8,
 * D-UX-04). Les anciennes valeurs de départ (quote-part 100 %, multiple 6, WACC 10 %, impôt
 * 25 %, croissance 2 %, filiale 100 %) ne doivent plus apparaître dans aucun champ.
 */
const FORMER_DEFAULTS = new Set(["100", "6", "10", "25", "2"]);

function inputValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("input"))
    .filter((input) => input.type !== "checkbox" && input.type !== "radio")
    .map((input) => input.value);
}

const common = { asOfDate: "2026-09-30", busy: false, mutate: vi.fn(), onDone: vi.fn() };

describe("Business Equity : les hypothèses se déclarent", () => {
  it("démarrage rapide : ni quote-part ni multiple supposés, aucun aperçu sans pont déclaré", () => {
    const { container } = render(<QuickStartForm {...common} />);
    expect(inputValues(container).filter((value) => FORMER_DEFAULTS.has(value))).toEqual([]);
    expect(screen.getByRole("button", { name: "Créer et valoriser" })).toBeDisabled();
    expect(container).toHaveTextContent("l’absence d’autres éléments du pont confirmée");
  });

  it("détention, base de valorisation, DCF et filiale partent vides", () => {
    for (const form of [
      <OwnershipForm key="o" businessId="b" {...common} />,
      <ValuationBasisForm
        key="v"
        businessId="b"
        currency="EUR"
        periods={[]}
        hasDcf={false}
        {...common}
      />,
      <DcfForm key="d" businessId="b" currency="EUR" {...common} />,
      <HoldingLinkForm key="h" parentBusinessId="p" candidates={[]} {...common} />,
    ]) {
      const { container, unmount } = render(form);
      expect(inputValues(container).filter((value) => FORMER_DEFAULTS.has(value))).toEqual([]);
      unmount();
    }
  });

  it("le DCF reste bloqué tant que WACC, impôt et valeur terminale ne sont pas déclarés", () => {
    render(<DcfForm businessId="b" currency="EUR" {...common} />);
    const buttons = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("primary"));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toBeDisabled();
  });
});

describe("Business Equity : un inconnu reste inconnu à l'affichage", () => {
  it("un multiple ou un taux non déclaré n'est jamais « 0,00 × » ni « 0 % »", () => {
    expect(formatMultiple(null)).toBe("non déclaré");
    expect(formatMultiple(undefined)).toBe("non déclaré");
    expect(formatMultiple(Number.NaN)).toBe("non déclaré");
    expect(formatMultiple(6.5)).toBe("6,50 ×");
    expect(formatDeclaredRate(null)).toBe("non déclaré");
    expect(formatDeclaredRate(0.02).replace(/\s/g, " ")).toBe("2,0 %");
  });
});
