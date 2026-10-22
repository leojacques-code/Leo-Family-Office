import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceRail, type RailSource } from "../source-rail";

const sources: RailSource[] = [
  { id: "bank", category: "BANQUE", name: "Banque", status: "ACTIVE", hint: "Au 15 oct. 2026" },
  { id: "schedule", category: "ECHEANCIER", name: "Échéancier", status: "ABSENTE" },
  {
    id: "contract",
    category: "CONTRAT",
    name: "Contrat",
    status: "A_RENOUVELER",
    hint: "Au 1 janv. 2024",
  },
];

describe("Sources compactes — D-UX-03", () => {
  it("garde les entrées et leur état disponibles sans répéter leur nom", () => {
    render(<SourceRail sources={sources} onProvide={vi.fn()} />);
    expect(screen.getAllByText("Échéancier")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Banque.*Données présentes/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Fournir Échéancier" })).toBeVisible();
    // L'ancienneté ne disparaît pas dans le panneau réduit.
    expect(screen.getByText("À actualiser")).not.toHaveClass("visually-hidden");
    expect(screen.queryByText("Au 15 oct. 2026")).toBeNull();
    expect(screen.queryByText("À jour")).toBeNull();
  });

  it("ouvre les détails au clavier sans perdre la sélection ni les actions", async () => {
    const user = userEvent.setup();
    const provide = vi.fn();
    function Fixture() {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <SourceRail
          sources={sources}
          selectedId={selected}
          onSelect={setSelected}
          onProvide={provide}
        />
      );
    }
    render(<Fixture />);
    const bank = screen.getByRole("button", { name: /Banque.*Données présentes/ });
    await user.click(bank);
    expect(bank).toHaveAttribute("aria-current", "true");
    const toggle = screen.getByRole("button", { name: "Afficher le détail des sources" });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Au 15 oct. 2026")).toBeVisible();
    expect(bank).toHaveAccessibleDescription("Au 15 oct. 2026");
    expect(screen.getAllByText("Échéancier")).toHaveLength(1);
    expect(bank).toHaveAttribute("aria-current", "true");
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Au 15 oct. 2026")).toBeNull();
    expect(bank).toHaveAttribute("aria-current", "true");
    await user.click(screen.getByRole("button", { name: "Fournir Échéancier" }));
    expect(provide).toHaveBeenCalledExactlyOnceWith("schedule");
  });
});
