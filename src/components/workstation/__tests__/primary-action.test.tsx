import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PrimaryActionProvider, useRegisterPrimaryAction } from "../primary-action";

/**
 * Zone A, action primaire.
 *
 * Deux conditions, et pas une : le §17 veut UN libellé venu du manifeste et UNE action venue
 * de la page. Un libellé sans action rendrait un bouton inerte, une action sans libellé un
 * bouton sans nom. Ces tests exercent le mécanisme ; le gate de dette compte les pages qui
 * n'en profitent pas encore.
 */

function Host({ children }: { children: React.ReactNode }) {
  const [action, setAction] = useState<{ run: () => void } | null>(null);
  return (
    <div>
      {action ? (
        <button onClick={action.run} type="button">
          Action déclarée
        </button>
      ) : (
        <span>Aucune action</span>
      )}
      <PrimaryActionProvider onChange={setAction}>{children}</PrimaryActionProvider>
    </div>
  );
}

function Page({ onRun, enabled = true }: { onRun: () => void; enabled?: boolean }) {
  useRegisterPrimaryAction(enabled ? onRun : null);
  return <p>Canvas</p>;
}

describe("enregistrement de l'action primaire", () => {
  it("expose l'action de la page à l'en-tête", async () => {
    const run = vi.fn();
    const user = userEvent.setup();
    render(
      <Host>
        <Page onRun={run} />
      </Host>,
    );
    await user.click(screen.getByRole("button", { name: "Action déclarée" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("n'expose rien quand la page n'a pas d'action à servir", () => {
    render(
      <Host>
        <Page enabled={false} onRun={() => {}} />
      </Host>,
    );
    expect(screen.getByText("Aucune action")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Action déclarée" })).toBeNull();
  });

  it("retire l'action au démontage de la page", () => {
    // Sans ce retrait, changer de domaine laisserait dans l'en-tête le bouton de la page
    // précédente, qui ouvrirait un formulaire démonté.
    const { rerender } = render(
      <Host>
        <Page onRun={() => {}} />
      </Host>,
    );
    expect(screen.getByRole("button", { name: "Action déclarée" })).toBeTruthy();
    rerender(<Host>{null}</Host>);
    expect(screen.queryByRole("button", { name: "Action déclarée" })).toBeNull();
  });

  it("appelle la DERNIÈRE version du gestionnaire, jamais une version périmée", async () => {
    // Une page recrée sa fonction à chaque rendu. Si le cadre gardait la première, le bouton
    // agirait sur un état figé au premier rendu : un formulaire s'ouvrirait avec des valeurs
    // périmées, ce qui est pire qu'un bouton mort parce que ça ne se voit pas.
    const calls: number[] = [];
    function Counting() {
      const [count, setCount] = useState(0);
      useRegisterPrimaryAction(() => calls.push(count));
      return (
        <button onClick={() => setCount((c) => c + 1)} type="button">
          Incrémenter
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <Host>
        <Counting />
      </Host>,
    );
    await user.click(screen.getByRole("button", { name: "Incrémenter" }));
    await user.click(screen.getByRole("button", { name: "Incrémenter" }));
    await user.click(screen.getByRole("button", { name: "Action déclarée" }));
    expect(calls).toEqual([2]);
  });

  it("ne lève pas hors de tout fournisseur", () => {
    // Une page montée seule dans un test de domaine n'a pas de cadre autour d'elle. Le hook
    // doit y être silencieux, sans quoi chaque test de page devrait monter le shell.
    expect(() => render(<Page onRun={() => {}} />)).not.toThrow();
  });
});
