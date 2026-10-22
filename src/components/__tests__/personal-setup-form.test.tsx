import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalSetupForm } from "../personal-setup-form";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const context = { residenceCountry: null, contextDate: null };
const initial = {
  displayName: "Espace personnel",
  firstIntent: null,
  reportingCurrency: "EUR",
  ...context,
};
afterEach(() => vi.unstubAllGlobals());
describe("Choix initiaux personnels", () => {
  it("ne propose aucune intention présélectionnée et conserve les saisies après panne", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        Response.json({ ...initial, displayName: "Famille recette", firstIntent: "PROJECT" }),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<PersonalSetupForm today="2026-09-21" initial={initial} />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    await userEvent.clear(screen.getByRole("textbox", { name: "Nom de votre espace" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Nom de votre espace" }),
      "Famille recette",
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "PROJECT");
    expect(screen.queryByRole("link", { name: "Ouvrir mes objectifs" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enregistrement non confirmé");
    expect(screen.getByRole("textbox", { name: "Nom de votre espace" })).toHaveValue(
      "Famille recette",
    );
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    expect(screen.getByRole("status")).toHaveTextContent("enregistrés");
    expect(screen.getByRole("link", { name: "Ouvrir mes objectifs" })).toHaveAttribute(
      "href",
      "/goals",
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/profile/setup",
      expect.objectContaining({
        body: JSON.stringify({
          displayName: "Famille recette",
          firstIntent: "PROJECT",
          ...context,
        }),
      }),
    );
  });
  it("reprend les choix persistés et permet de reporter l'intention", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(initial)));
    render(
      <PersonalSetupForm
        today="2026-09-21"
        initial={{ ...initial, displayName: "Espace existant", firstIntent: "WEALTH" }}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Nom de votre espace" })).toHaveValue(
      "Espace existant",
    );
    expect(screen.getByRole("combobox")).toHaveValue("WEALTH");
    await userEvent.selectOptions(screen.getByRole("combobox"), "");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    expect(screen.queryByRole("link", { name: "Ouvrir mon patrimoine" })).toBeNull();
    expect(screen.getByRole("link", { name: "Revenir à Aujourd’hui" })).toHaveAttribute(
      "href",
      "/",
    );
  });
  it("préserve le contexte daté après panne puis le retrouve à la réouverture", async () => {
    const persisted = { ...initial, residenceCountry: "Suisse", contextDate: "2026-09-01" };
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json(persisted));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<PersonalSetupForm today="2026-09-21" initial={initial} />);
    const country = screen.getByRole("textbox", { name: /Pays de résidence/ });
    const date = screen.getByLabelText(/Date de référence du contexte/);
    expect(country).toHaveValue("");
    expect(date).toHaveValue("");
    await userEvent.type(country, "Suisse");
    fireEvent.change(date, { target: { value: "2026-09-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(country).toHaveValue("Suisse");
    expect(date).toHaveValue("2026-09-01");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body).toEqual({
      displayName: initial.displayName,
      firstIntent: null,
      residenceCountry: "Suisse",
      contextDate: "2026-09-01",
    });
    expect(body).not.toHaveProperty("reportingCurrency");
    view.unmount();
    render(<PersonalSetupForm today="2026-09-21" initial={persisted} />);
    expect(screen.getByRole("textbox", { name: /Pays de résidence/ })).toHaveValue("Suisse");
    expect(screen.getByLabelText(/Date de référence du contexte/)).toHaveValue("2026-09-01");
  });
});
