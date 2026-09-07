import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MoneyInput } from "@/components/primitives/money-input";
import type { NumberDraft } from "@/lib/presentation/input-parse";

/**
 * Hôte contrôlé, comme le sera un vrai formulaire : il ne garde la valeur que si la lecture
 * est VALIDE, et remet `null` sur un champ vide. C'est le comportement qu'un appelant doit
 * pouvoir écrire sans jamais fabriquer de zéro.
 */
function Host({
  onDraft,
  initial = null,
}: {
  onDraft?: (draft: NumberDraft) => void;
  initial?: number | null;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <MoneyInput
        currency="EUR"
        id="capital"
        label="Capital restant dû"
        onChange={(draft) => {
          onDraft?.(draft);
          if (draft.state === "VALID") setValue(draft.value);
          if (draft.state === "EMPTY") setValue(null);
          // Une saisie ILLISIBLE ne change pas la valeur committée : elle n'est pas une
          // déclaration.
        }}
        value={value}
      />
      <output data-testid="committed">{value === null ? "null" : String(value)}</output>
    </>
  );
}

const field = () => screen.getByRole("textbox", { name: /Capital restant dû/ });
const committed = () => screen.getByTestId("committed").textContent;

describe("MoneyInput : aucun zéro fabriqué", () => {
  it("part d’un champ VIDE quand la valeur est null, et pas de « 0 »", () => {
    render(<Host />);
    expect(field()).toHaveValue("");
  });

  it("EFFACER un montant rend null, jamais zéro", async () => {
    // C'est le critère d'acceptation de la phase 0. L'ancien helper faisait
    // `Number("")`, donc `0` : effacer un capital le déclarait à zéro, ce qui
    // rendait le patrimoine faux sans laisser aucune trace.
    const user = userEvent.setup();
    const drafts: NumberDraft[] = [];
    render(<Host initial={16745} onDraft={(draft) => drafts.push(draft)} />);
    expect(committed()).toBe("16745");

    await user.clear(field());

    expect(field()).toHaveValue("");
    expect(committed()).toBe("null");
    expect(drafts.at(-1)).toEqual({ state: "EMPTY", value: null });
    // Aucune lecture de la séquence n'a produit un zéro.
    expect(drafts.some((draft) => draft.value === 0)).toBe(false);
  });

  it("distingue un zéro DÉCLARÉ d’un champ vide", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), "0");
    expect(committed()).toBe("0");
    await user.clear(field());
    expect(committed()).toBe("null");
  });
});

describe("MoneyInput : la frappe n’est jamais reformatée", () => {
  it("ne produit pas « 015000 » quand on saisit 15000 dans un champ vide", async () => {
    // Constat 5.2 du plan : un champ initialisé à « 0 » et contrôlé produisait « 015000 ».
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), "15000");
    expect(field()).toHaveValue("15000");
    expect(committed()).toBe("15000");
  });

  it("laisse taper une virgule sans clignoter en erreur", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), "1234,");
    // La frappe est rendue telle quelle : la reformater ici renverrait le curseur au début.
    expect(field()).toHaveValue("1234,");
    expect(field()).toHaveAttribute("aria-invalid", "false");
    // 1234 est déjà déclaré ; la décimale n'est pas encore tapée et rien n'est inventé.
    expect(committed()).toBe("1234");

    await user.type(field(), "56");
    expect(field()).toHaveValue("1234,56");
    expect(committed()).toBe("1234.56");
  });

  it("accepte un montant collé avec ses séparateurs de milliers", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    await user.paste("16 745,25");
    expect(committed()).toBe("16745.25");
  });
});

describe("MoneyInput : une saisie illisible est signalée, pas convertie", () => {
  it("signale l’erreur, ne committe rien et garde le texte de l’utilisateur", async () => {
    const user = userEvent.setup();
    render(<Host initial={100} />);
    await user.clear(field());
    await user.type(field(), "1,5,3");

    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Un seul séparateur décimal.");
    // La valeur committée est la DERNIÈRE déclaration valide de l'utilisateur, ici 1,5 :
    // la frappe est passée par « 1 », « 1, », « 1,5 », puis « 1,5, » et « 1,5,3 » qui sont
    // illisibles. Ce n'est ni un zéro de repli, ni la valeur initiale de 100, ni un
    // écrasement silencieux : c'est ce qui a réellement été saisi de lisible.
    //
    // Le champ porte `aria-invalid`, ce qui donne au formulaire hôte de quoi bloquer sa
    // soumission. Le composant ne décide pas à sa place : sa responsabilité est de dire
    // l'état de la lecture, pas d'arbitrer une politique de formulaire.
    expect(committed()).toBe("1.5");

    // Le texte survit à la perte de focus : l'effacer ferait disparaître la saisie sans
    // que l'utilisateur sache pourquoi.
    await user.tab();
    expect(field()).toHaveValue("1,5,3");
  });

  it("n’affiche AUCUN code technique dans le message", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), "1e5");
    const message = screen.getByRole("alert").textContent ?? "";
    expect(message).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    expect(message).toBe("Écrivez le montant en chiffres, sans notation scientifique.");
  });

  it("reprend le formatage canonique à la perte de focus quand la saisie est lisible", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), "1234.5");
    await user.tab();
    // Le point tapé devient la virgule française, une fois l'édition terminée.
    expect(field()).toHaveValue("1234,5");
  });
});

describe("MoneyInput : contrat d’accessibilité et de devise", () => {
  it("porte sa devise dans le libellé accessible ET à l’écran", () => {
    render(<Host />);
    // Section 18.3 : « chaque montant porte sa devise ».
    expect(screen.getByRole("textbox", { name: "Capital restant dû, en EUR" })).toBeInTheDocument();
    expect(screen.getByText("EUR")).toBeInTheDocument();
  });

  it("relie son libellé au contrôle", () => {
    render(<Host />);
    expect(screen.getByLabelText(/Capital restant dû/)).toBe(field());
  });

  it("n’est PAS un champ type=number", () => {
    // Un champ numéro refuse la virgule selon la locale, se modifie à la molette au survol,
    // et rend une chaîne vide indistinguable d'une saisie invalide.
    render(<Host />);
    expect(field()).toHaveAttribute("type", "text");
    expect(field()).toHaveAttribute("inputmode", "decimal");
  });

  it("relie l’aide au contrôle sans en faire une valeur", () => {
    const noop = vi.fn();
    render(
      <MoneyInput
        currency="EUR"
        hint="Exemple : 16 745,25"
        id="montant"
        label="Montant"
        onChange={noop}
        placeholder="0,00"
        value={null}
      />,
    );
    const input = screen.getByRole("textbox", { name: /Montant/ });
    // L'exemple est un placeholder et une aide, jamais une valeur.
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "0,00");
    expect(input).toHaveAccessibleDescription("Exemple : 16 745,25");
  });

  it("marque structurellement une HYPOTHÈSE, pas seulement par la couleur", () => {
    const noop = vi.fn();
    render(
      <MoneyInput
        currency="EUR"
        id="valeur-cible"
        label="Valeur de sortie envisagée"
        nature="ASSUMPTION"
        onChange={noop}
        value={null}
      />,
    );
    // Section 18.3 : les hypothèses sont séparées « visuellement ET structurellement ».
    expect(screen.getByText("Hypothèse")).toBeInTheDocument();
    expect(document.querySelector('[data-nature="ASSUMPTION"]')).not.toBeNull();
  });
});
