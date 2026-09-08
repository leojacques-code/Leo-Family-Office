import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DateInput } from "@/components/primitives/date-input";
import { OptionalNumberInput } from "@/components/primitives/optional-number-input";
import { PercentInput } from "@/components/primitives/percent-input";
import type { DateDraft, NumberDraft } from "@/lib/presentation/input-parse";

describe("PercentInput", () => {
  function Host({ onDraft }: { onDraft?: (draft: NumberDraft) => void }) {
    const [rate, setRate] = useState<number | null>(null);
    return (
      <>
        <PercentInput
          id="taeg"
          label="Coût du crédit"
          onChange={(draft) => {
            onDraft?.(draft);
            if (draft.state === "VALID") setRate(draft.value);
            if (draft.state === "EMPTY") setRate(null);
          }}
          rateNature="APR"
          value={rate}
        />
        <output data-testid="rate">{rate === null ? "null" : String(rate)}</output>
      </>
    );
  }
  const field = () => screen.getByRole("textbox", { name: /Coût du crédit/ });

  it("saisit un POURCENTAGE et committe un TAUX décimal", async () => {
    // POURCENTAGE AFFICHÉ ≠ TAUX STOCKÉ. La base persiste 0,035, l'utilisateur écrit 3,5.
    // Confondre les deux multiplie ou divise un taux par cent en silence, et rien ne le
    // rattrape : 0,035 et 3,5 sont deux nombres parfaitement valides.
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), "3,5");
    expect(field()).toHaveValue("3,5");
    expect(screen.getByTestId("rate").textContent).toBe("0.035");
  });

  it("distingue un taux nul DÉCLARÉ d’un taux inconnu", async () => {
    // Un prêt à taux zéro existe : le cas CIC du plan de refonte en est un.
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByTestId("rate").textContent).toBe("null");
    await user.type(field(), "0");
    expect(screen.getByTestId("rate").textContent).toBe("0");
    await user.clear(field());
    expect(screen.getByTestId("rate").textContent).toBe("null");
  });

  it("rend un taux existant sous sa forme de pourcentage, sans artefact binaire", () => {
    const noop = vi.fn();
    render(
      <PercentInput
        id="rendement"
        label="Rendement"
        onChange={noop}
        rateNature="YIELD"
        value={0.07}
      />,
    );
    // 0,07 × 100 vaut 7,000000000000001 en flottant double : sans arrondi, l'utilisateur
    // lirait ce nombre dans son champ.
    expect(screen.getByRole("textbox", { name: /Rendement/ })).toHaveValue("7");
  });

  it("annonce la NATURE du taux, un TAEG n’étant pas un taux nominal", () => {
    const noop = vi.fn();
    render(
      <PercentInput id="nominal" label="Taux" onChange={noop} rateNature="NOMINAL" value={null} />,
    );
    expect(
      screen.getByRole("textbox", { name: "Taux, taux nominal, en pourcentage" }),
    ).toBeInTheDocument();
  });

  it("porte l’unité pour cent à l’écran", () => {
    const noop = vi.fn();
    render(<PercentInput id="t" label="Taux" onChange={noop} rateNature="APR" value={null} />);
    expect(screen.getByText("%")).toBeInTheDocument();
  });
});

describe("DateInput", () => {
  function Host({ onDraft }: { onDraft?: (draft: DateDraft) => void }) {
    const [date, setDate] = useState<string | null>(null);
    return (
      <>
        <DateInput
          id="premiere-sortie"
          label="Première sortie de trésorerie"
          onChange={(draft) => {
            onDraft?.(draft);
            if (draft.state === "VALID") setDate(draft.value);
            if (draft.state === "EMPTY") setDate(null);
          }}
          value={date}
        />
        <output data-testid="date">{date ?? "null"}</output>
      </>
    );
  }
  const field = () => screen.getByLabelText(/Première sortie de trésorerie/);

  it("part d’un champ VIDE, sans jamais préremplir une date", () => {
    // Section 18.3 : « les dates ne sont jamais forcées à la date financière ». Préremplir
    // la date d'arrêté ferait passer un défaut pour une date économique déclarée.
    render(<Host />);
    expect(field()).toHaveValue("");
    expect(screen.getByTestId("date").textContent).toBe("null");
  });

  it("accepte une date saisie au clavier", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), "2026-09-05");
    expect(screen.getByTestId("date").textContent).toBe("2026-09-05");
  });

  it("effacer une date rend null", async () => {
    const user = userEvent.setup();
    const drafts: DateDraft[] = [];
    render(<Host onDraft={(draft) => drafts.push(draft)} />);
    await user.type(field(), "2026-09-05");
    await user.clear(field());
    expect(screen.getByTestId("date").textContent).toBe("null");
    expect(drafts.at(-1)).toEqual({ state: "EMPTY", value: null });
  });

  it("offre le clavier ET le calendrier, comme l’exige la section 18.3", () => {
    render(<Host />);
    // `type="date"` porte les deux nativement, avec la navigation clavier et la
    // localisation d'affichage du navigateur. Un composant maison devrait les
    // réimplémenter, accessibilité comprise.
    expect(field()).toHaveAttribute("type", "date");
  });

  it("transmet les bornes de calendrier au navigateur", () => {
    const noop = vi.fn();
    render(
      <DateInput
        id="fait"
        label="Date du fait"
        max="2026-09-07"
        min="2000-01-01"
        onChange={noop}
        value={null}
      />,
    );
    const input = screen.getByLabelText(/Date du fait/);
    expect(input).toHaveAttribute("max", "2026-09-07");
    expect(input).toHaveAttribute("min", "2000-01-01");
  });
});

describe("OptionalNumberInput", () => {
  function Host() {
    const [count, setCount] = useState<number | null>(null);
    return (
      <>
        <OptionalNumberInput
          id="echeances"
          label="Nombre d’échéances"
          onChange={(draft) => {
            if (draft.state === "VALID") setCount(draft.value);
            if (draft.state === "EMPTY") setCount(null);
          }}
          unit="échéances"
          value={count}
        />
        <output data-testid="count">{count === null ? "null" : String(count)}</output>
      </>
    );
  }
  const field = () => screen.getByRole("textbox", { name: /Nombre d’échéances/ });

  it("distingue « durée inconnue » de « zéro échéance »", async () => {
    // Un prêt dont on ignore la durée n'est pas un prêt à zéro échéance : le premier est un
    // trou dans les données, le second serait un contrat absurde.
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByTestId("count").textContent).toBe("null");
    await user.type(field(), "60");
    expect(screen.getByTestId("count").textContent).toBe("60");
    await user.clear(field());
    expect(screen.getByTestId("count").textContent).toBe("null");
  });

  it("porte son unité quand elle existe", () => {
    render(<Host />);
    expect(screen.getByText("échéances")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Nombre d’échéances, en échéances" }),
    ).toBeInTheDocument();
  });

  it("accepte une grandeur SANS unité, qui n’est donc pas inventée", () => {
    const noop = vi.fn();
    render(<OptionalNumberInput id="priorite" label="Priorité" onChange={noop} value={null} />);
    expect(screen.getByRole("textbox", { name: "Priorité" })).toBeInTheDocument();
  });
});
