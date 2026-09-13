import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NetWorthPage from "../page";
import { buildDemoState } from "@/lib/data/read-models/today-demo";
import type { SectionProps } from "@/components/pages/shared";

function setup() {
  const state = buildDemoState("2026-09-13");
  state.accounts[0]!.balanceDate = "2026-08-31";
  const mutate = vi.fn().mockResolvedValue(true);
  render(
    <NetWorthPage
      {...({ state, mutate, busy: false, setExplanation: vi.fn() } as unknown as SectionProps)}
    />,
  );
  return { mutate, state, user: userEvent.setup() };
}

async function openCreation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Ajouter un compte" }));
  await user.type(screen.getByLabelText("Institution"), "Banque recette");
  await user.type(screen.getByLabelText("Nom du compte"), "Compte recette");
}

function submit() {
  fireEvent.submit(screen.getByRole("button", { name: "Enregistrer" }).closest("form")!);
}

describe("premier compte : montant et date explicitement déclarés", () => {
  it("garde montant et date vides ; refuse vide, invalide et date absente", async () => {
    const { user, mutate } = setup();
    await openCreation(user);
    const balance = screen.getByRole("textbox", { name: "Solde, en EUR" });
    expect(balance).toHaveValue("");
    expect(screen.getByLabelText("Date du solde")).toHaveValue("");
    submit();
    expect(mutate).not.toHaveBeenCalled();
    await user.type(balance, "1,2,3");
    submit();
    expect(mutate).not.toHaveBeenCalled();
    await user.clear(balance);
    await user.type(balance, "0");
    submit();
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Indiquez la date du solde");
    fireEvent.change(screen.getByLabelText("Date du solde"), { target: { value: "2026-08-31" } });
    submit();
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ balance: 0, balanceDate: "2026-08-31" }),
    );
  });

  it("transmet une virgule et une date historique sans les remplacer par la date d'arrêté", async () => {
    const { user, mutate } = setup();
    await openCreation(user);
    await user.type(screen.getByRole("textbox", { name: "Solde, en EUR" }), "1 794,41");
    fireEvent.change(screen.getByLabelText("Date du solde"), { target: { value: "2026-08-31" } });
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mutate).toHaveBeenCalledWith({
      action: "add_account",
      institution: "Banque recette",
      name: "Compte recette",
      accountType: "BANK",
      balance: 1794.41,
      balanceDate: "2026-08-31",
      currency: "EUR",
    });
  });

  it("reprend la date conservée lors d'une correction", async () => {
    const { user, state } = setup();
    await user.click(screen.getByRole("button", { name: new RegExp(state.accounts[0]!.name) }));
    expect(screen.getByLabelText("Date du solde")).toHaveValue("2026-08-31");
  });
});
