import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OutstandingDebt, Scenario } from "@/lib/types";
import DebtPage from "../page";

const debt: OutstandingDebt = {
  id: "family-loan",
  name: "Prêt familial",
  lender: null,
  currentBalance: 1000,
  currency: "CHF",
  balanceDate: "2026-09-20",
  notes: null,
  provenance: { kind: "ACTUAL", confidence: "HIGH", source: "Saisie encours seul" },
};
const base = {
  asOfDate: "2026-09-24",
  liabilities: [],
  scenarios: [] as Scenario[],
  metrics: { bankCash: null },
  reportingCurrency: "EUR",
};

describe("Dettes : somme due connue par son seul encours", () => {
  it("propose l'encours seul avant le contrat quand rien n'est saisi", () => {
    render(<DebtPage state={base} busy={false} mutate={vi.fn()} setExplanation={vi.fn()} />);
    expect(screen.getByText("Aucune dette enregistrée")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Je connais l’encours/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Décrire le contrat/ })).toBeInTheDocument();
  });

  it("affiche l'encours dans sa devise et à sa date, sans échéancier ni coût", () => {
    const { container } = render(
      <DebtPage
        state={{ ...base, outstandingDebts: [debt] }}
        busy={false}
        mutate={vi.fn()}
        setExplanation={vi.fn()}
      />,
    );
    const panel = screen.getByRole("region", { name: "Encours déclarés sans contrat" });
    expect(within(panel).getByText("Prêt familial")).toBeInTheDocument();
    expect(within(panel).getByText("Créancier non renseigné")).toBeInTheDocument();
    expect(panel).toHaveTextContent(/1.000.*CHF/);
    expect(panel).toHaveTextContent("Au 20 septembre 2026");
    expect(container.textContent).not.toContain("€");
    expect(container.textContent).not.toMatch(/Mensualité|Taux|Coût total|Non calculable/);
    expect(screen.queryByText("Aucune dette enregistrée")).not.toBeInTheDocument();
  });

  it("corrige l'encours par une NOUVELLE observation, sans réécrire la dette", async () => {
    const mutate = vi.fn().mockResolvedValue(true);
    render(
      <DebtPage
        state={{ ...base, outstandingDebts: [debt] }}
        busy={false}
        mutate={mutate}
        setExplanation={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Corriger l’encours/ }));
    const dialog = screen.getByRole("dialog");
    // La correction reprend l'encours et la date enregistrés : aucune valeur vide ni inventée.
    expect(within(dialog).getByLabelText(/Encours restant dû/)).toHaveValue("1000");
    // Un montant ET une date modifiés : la correction est une observation nouvelle et datée.
    fireEvent.change(within(dialog).getByLabelText(/Encours restant dû/), {
      target: { value: "950,25" },
    });
    fireEvent.blur(within(dialog).getByLabelText(/Encours restant dû/));
    fireEvent.change(within(dialog).getByLabelText(/Date de l’encours/), {
      target: { value: "2026-09-24" },
    });
    fireEvent.submit(dialog.querySelector("form")!);
    await vi.waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith({
      action: "record_debt_balance",
      liabilityId: "family-loan",
      observedAt: "2026-09-24",
      balance: 950.25,
      notes: null,
    });
  });

  it("refuse d'enregistrer un encours vide comme une dette nulle", async () => {
    const mutate = vi.fn();
    render(<DebtPage state={base} busy={false} mutate={mutate} setExplanation={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Je connais l’encours/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Nom de la dette/), {
      target: { value: "Prêt familial" },
    });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Un champ vide n’est pas une dette nulle",
    );
    expect(mutate).not.toHaveBeenCalled();
  });
});
