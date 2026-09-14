import { buildFinancialDateContext } from "@/lib/financial-date";
import { useState } from "react";
import { PrimaryActionProvider } from "@/components/workstation/primary-action";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NetWorthPage from "../page";
import { buildDemoState } from "@/lib/data/read-models/today-demo";
import type { SectionProps } from "@/components/pages/shared";

function Harness({ state, mutate }: Pick<SectionProps, "state" | "mutate">) {
  const [action, setAction] = useState<{ run: () => void } | null>(null);
  return (
    <PrimaryActionProvider onChange={setAction}>
      {action ? <button onClick={action.run}>Ajouter un compte</button> : null}
      <NetWorthPage state={state} mutate={mutate} busy={false} setExplanation={vi.fn()} />
    </PrimaryActionProvider>
  );
}

function setup() {
  const state = buildDemoState("2026-09-13");
  state.dates = buildFinancialDateContext({
    now: new Date("2026-09-14T10:00:00Z"),
    closeDates: ["2026-08-31"],
  });
  state.asOfDate = state.dates.asOfDate;
  state.accounts[0]!.balanceDate = "2026-08-31";
  const mutate = vi.fn().mockResolvedValue(true);
  render(<Harness state={state} mutate={mutate} />);
  return { mutate, state, user: userEvent.setup() };
}

async function openCreation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Ajouter un compte" }));
  await user.type(screen.getByLabelText("Établissement"), "Banque recette");
  await user.type(screen.getByLabelText("Nom du compte"), "Compte recette");
}

function submit() {
  fireEvent.submit(screen.getByRole("button", { name: "Enregistrer le compte" }).closest("form")!);
}

describe("premier compte : montant et date explicitement déclarés", () => {
  it("garde montant et date vides ; refuse vide, invalide et date absente", async () => {
    const { user, mutate } = setup();
    await openCreation(user);
    const balance = screen.getByRole("textbox", { name: "Solde observé, en EUR" });
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
    expect(screen.getByRole("alert")).toHaveTextContent("La date du solde est obligatoire");
    fireEvent.change(screen.getByLabelText("Date du solde"), { target: { value: "2026-08-31" } });
    submit();
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ balance: 0, balanceDate: "2026-08-31" }),
    );
  });

  it("transmet une virgule et une date historique sans les remplacer par la date d'arrêté", async () => {
    const { user, mutate } = setup();
    await openCreation(user);
    await user.type(screen.getByRole("textbox", { name: "Solde observé, en EUR" }), "1 794,41");
    fireEvent.change(screen.getByLabelText("Date du solde"), { target: { value: "2026-08-31" } });
    await user.click(screen.getByRole("button", { name: "Enregistrer le compte" }));
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
    await user.click(screen.getByText("Analyse détaillée"));
    await user.click(screen.getByRole("button", { name: new RegExp(state.accounts[0]!.name) }));
    expect(screen.getByLabelText("Date du solde")).toHaveValue("2026-08-31");
  });
});

it("accepte une observation présente après une clôture passée", async () => {
  const { user, mutate } = setup();
  await openCreation(user);
  await user.type(screen.getByRole("textbox", { name: "Solde observé, en EUR" }), "100");
  const date = screen.getByLabelText("Date du solde");
  expect(date).toHaveAttribute("max", "2026-09-14");
  fireEvent.change(date, { target: { value: "2026-09-14" } });
  await user.click(screen.getByRole("button", { name: "Enregistrer le compte" }));
  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ balanceDate: "2026-09-14" }));
});

it("arrête au jour opérationnel même si le bilan affiché porte une clôture antérieure", async () => {
  const { user, mutate } = setup();
  await user.click(screen.getByRole("button", { name: "Arrêter le patrimoine au 2026-09-14" }));
  expect(mutate).toHaveBeenCalledWith({ action: "create_monthly_close", closeDate: "2026-09-14" });
});
