import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Modal } from "@/components/ui";

function Harness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  return (
    <>
      <button onClick={() => setOpen(true)}>Ouvrir</button>
      {/* onClose recréée à chaque rendu, comme dans les pages. */}
      <Modal open={open} title="Formulaire" onClose={() => setOpen(false)}>
        <input aria-label="Nom" value={value} onChange={(event) => setValue(event.target.value)} />
        <input aria-label="Montant" />
      </Modal>
    </>
  );
}

describe("Modal : focus d'un dialogue modal", () => {
  it("entre dans le dialogue, y reste pendant la saisie, et revient au déclencheur", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Ouvrir" });
    trigger.focus();
    fireEvent.click(trigger);
    const name = screen.getByLabelText("Nom");
    expect(document.activeElement).toBe(name);
    const amount = screen.getByLabelText("Montant");
    amount.focus();
    fireEvent.change(name, { target: { value: "Prêt" } });
    // Un nouveau rendu ne vole pas le focus du champ en cours.
    expect(document.activeElement).toBe(amount);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("appelle la dernière fonction de fermeture reçue", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Modal open title="T" onClose={first}>
        <input aria-label="Champ" />
      </Modal>,
    );
    rerender(
      <Modal open title="T" onClose={second}>
        <input aria-label="Champ" />
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });
});
