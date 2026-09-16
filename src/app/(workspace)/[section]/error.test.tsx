import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectionError from "./error";

describe("B05 — reprise d'une page", () => {
  it("relance le chargement serveur et conserve un chemin vers Aujourd'hui", async () => {
    const retry = vi.fn();
    render(<SectionError error={new Error("private backend details")} retry={retry} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Revenir à Aujourd’hui" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByText("private backend details")).toBeNull();
  });
});
