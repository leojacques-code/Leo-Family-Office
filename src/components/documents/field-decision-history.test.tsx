import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentFieldDecisionHistory } from "./field-decision-history";
import type { DocumentFieldDecisionView } from "@/lib/data/document-contracts";

const decision: DocumentFieldDecisionView = {
  fieldId: "case-test",
  rank: 1,
  action: "CORRECT",
  beforeStatus: "EXTRACTED",
  beforeValue: 10,
  beforeDate: null,
  afterStatus: "CORRECTED",
  afterValue: 0,
  afterDate: null,
  reason: "Relecture synthétique",
  decidedAt: "2026-10-21T23:05:00Z",
  actor: "CURRENT_USER",
};

describe("Historique documentaire commun", () => {
  it("affiche l'auteur établi et l'instant de Paris avec valeurs et motif", async () => {
    render(
      <DocumentFieldDecisionHistory
        history={[decision]}
        renderChange={(d) => (
          <span>
            {" "}
            : {d.beforeValue} → {d.afterValue} EUR
          </span>
        )}
      />,
    );
    await userEvent.click(screen.getByText("Historique (1)"));
    const history = screen.getByRole("list");
    expect(history).toHaveTextContent(
      /Corrigée par vous le 22 octobre 2026 à 01:05:00 \(Paris\).*10 → 0 EUR.*Relecture synthétique/,
    );
    expect(history.querySelector("time")).toHaveAttribute("datetime", decision.decidedAt);
  });

  it("ne suppose pas l'auteur d'un ancien contrat de transport", async () => {
    render(
      <DocumentFieldDecisionHistory
        history={[{ ...decision, actor: undefined }]}
        renderChange={() => null}
      />,
    );
    await userEvent.click(screen.getByText("Historique (1)"));
    expect(screen.getByRole("list")).toHaveTextContent("auteur non consigné");
    expect(screen.getByRole("list")).not.toHaveTextContent("par vous");
  });

  it("distingue l'historique non reçu de l'absence de décision", async () => {
    render(<DocumentFieldDecisionHistory history={undefined} renderChange={() => null} />);
    await userEvent.click(screen.getByText("Historique · indisponible"));
    expect(screen.getByText(/L’historique n’a pas été reçu/)).toBeVisible();
    expect(screen.queryByText(/aucune décision/)).toBeNull();
  });
});
