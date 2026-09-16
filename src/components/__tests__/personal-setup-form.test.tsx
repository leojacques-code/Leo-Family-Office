import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalSetupForm } from "../personal-setup-form";
const initial = { displayName: "Espace personnel", firstIntent: null };
afterEach(() => vi.unstubAllGlobals());
describe("Choix initiaux personnels", () => {
  it("ne propose aucune intention présélectionnée et conserve les saisies après panne", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        Response.json({ displayName: "Famille recette", firstIntent: "PROJECT" }),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<PersonalSetupForm initial={initial} />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "Famille recette");
    await userEvent.selectOptions(screen.getByRole("combobox"), "PROJECT");
    expect(screen.queryByRole("link", { name: "Ouvrir mes objectifs" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enregistrement non confirmé");
    expect(screen.getByRole("textbox")).toHaveValue("Famille recette");
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
        body: JSON.stringify({ displayName: "Famille recette", firstIntent: "PROJECT" }),
      }),
    );
  });
  it("reprend les choix persistés et permet de reporter l'intention", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(initial)));
    render(
      <PersonalSetupForm initial={{ displayName: "Espace existant", firstIntent: "WEALTH" }} />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("Espace existant");
    expect(screen.getByRole("combobox")).toHaveValue("WEALTH");
    await userEvent.selectOptions(screen.getByRole("combobox"), "");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    expect(screen.queryByRole("link", { name: "Ouvrir mon patrimoine" })).toBeNull();
    expect(screen.getByRole("link", { name: "Revenir à Aujourd’hui" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
