import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { MetricHelp } from "@/components/primitives/metric-help";
import type {
  ScheduleFieldView,
  ScheduleReview,
  ScheduleRunSummary,
} from "@/lib/data/schedule-document-contracts";
import { DebtDocumentsSection } from "../schedule-review/documents-section";
import { ScheduleReviewWorkspace } from "../schedule-review/review-workspace";
import { revealScheduleField } from "../schedule-review/reveal-field";

function DocumentsFixture() {
  const [open, setOpen] = useState(false);
  return (
    <DebtDocumentsSection
      liabilityCurrency="CHF"
      liabilityId={LOAN}
      onOpenReview={vi.fn()}
      uploadOpen={open}
      onUploadOpenChange={setOpen}
    />
  );
}

// Fixtures synthétiques : aucun échéancier réel.
const RUN = "33333333-3333-4333-8333-333333333333";
const LOAN = "44444444-4444-4444-8444-444444444444";

const run: ScheduleRunSummary = {
  runId: RUN,
  liabilityId: LOAN,
  status: "EXTRACTED",
  fileName: "echeancier.csv",
  sourceFormat: "CSV",
  sheetName: null,
  extractedAt: "2026-10-15T08:00:00Z",
  extractorVersion: "1.0.0",
  schemaVersion: "schedule-columns-v1",
  lineCount: 2,
  firstDueDate: "2026-10-05",
  lastDueDate: "2026-11-05",
  completeness: "PARTIAL",
  completenessReasons: ["Capital initial du contrat non déclaré."],
  currency: "EUR",
  currencySource: "DECLARED",
  failedCheckCount: 0,
  notComputableCheckCount: 0,
  blockedFieldCount: 1,
  correctedFieldCount: 0,
  supersedesRunId: null,
  documentId: "doc",
  issues: [],
};

function cell(
  line: number,
  columnKey: string,
  letter: string,
  raw: string | null,
  extra: Partial<ScheduleFieldView> = {},
): ScheduleFieldView {
  const isDate = columnKey === "date";
  const value = !isDate && raw !== null ? Number(raw) : null;
  return {
    fieldId: `${columnKey}-${line}`,
    boxCode: `L${line}.${columnKey}`,
    lineNumber: line,
    rowNumber: line + 1,
    sheetName: null,
    columnKey,
    columnLabel: columnKey,
    cellRef: `${letter}${line + 1}`,
    rawValue: raw,
    normalizedValue: value,
    normalizedDate: isDate ? raw : null,
    userValue: null,
    userDate: null,
    effectiveValue: value,
    effectiveDate: isDate ? raw : null,
    unit: isDate ? "DATE" : "MONEY",
    validationStatus: "EXTRACTED",
    decisionRevision: 0,
    userReason: null,
    issues: [],
    ...extra,
  };
}

const review: ScheduleReview = {
  run,
  fields: [
    cell(1, "date", "A", "2026-10-05"),
    cell(1, "interest", "B", "30"),
    cell(2, "date", "A", "2026-11-05"),
    cell(2, "interest", "B", "abc", {
      normalizedValue: null,
      effectiveValue: null,
      validationStatus: "BLOCKED",
      issues: [
        {
          code: "BOX_VALUE_UNREADABLE",
          severity: "ERROR",
          page: null,
          boxCode: "L2.interest",
          sourceValue: "abc",
          message: "Montant illisible.",
        },
      ],
    }),
  ],
  checks: [],
  decisions: [],
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 0;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aide « ? » partagée (D-UX-02)", () => {
  it("s'ouvre au clic avec aria-expanded et se ferme par Échap", () => {
    render(<MetricHelp term="extrait partiel">Définition</MetricHelp>);
    const button = screen.getByRole("button", { name: "Aide : extrait partiel" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("note")).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

describe("revue côte à côte d'un échéancier déposé (B19)", () => {
  const mount = () =>
    render(
      <ScheduleReviewWorkspace existingDueDates={["2026-11-05"]} onClose={vi.fn()} runId={RUN} />,
    );

  it("montre la pièce telle que lue et synchronise la sélection des deux côtés", async () => {
    fetchMock.mockReturnValueOnce(json(review));
    mount();
    const piece = await screen.findByLabelText("Pièce telle que lue");
    // La cellule illisible garde ce que le fichier imprimait, jamais un zéro.
    const blockedCell = within(piece).getByRole("button", { name: /B3 abc, Illisible/ });
    fireEvent.click(blockedCell);
    expect(blockedCell).toHaveAttribute("aria-pressed", "true");
    const candidates = document.getElementById("schedule-candidate-interest-2")!;
    expect(candidates).toHaveAttribute("aria-pressed", "true");
    const panel = screen.getByRole("region", { name: "Case B3" });
    expect(within(panel).getByText("abc")).toBeInTheDocument();
    expect(within(panel).getByText("Aucune")).toBeInTheDocument();
    // Une case illisible se corrige ou s'écarte : la confirmer n'est pas proposé.
    expect(within(panel).getByRole("button", { name: "Confirmer la lecture" })).toBeDisabled();
  });

  it("signale l'extrait partiel et la date déjà présente sur la dette", async () => {
    fetchMock.mockReturnValueOnce(json(review));
    mount();
    const conflicts = await screen.findByRole("region", { name: "Points à examiner" });
    expect(conflicts).toHaveTextContent("Extrait partiel");
    expect(conflicts).toHaveTextContent("déjà présente");
    expect(conflicts).toHaveTextContent("1 case illisible");
  });

  it("ne présente pas la valeur imprimée d'une case écartée comme encore retenue", async () => {
    fetchMock.mockReturnValueOnce(
      json({
        ...review,
        fields: review.fields.map((field) =>
          field.fieldId === "interest-1" ? { ...field, validationStatus: "REJECTED" } : field,
        ),
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /B2 30, Écartée/ }));
    const panel = screen.getByRole("region", { name: "Case B2" });
    expect(within(panel).getByText("30")).toBeInTheDocument();
    expect(within(panel).getByText("Aucune — case écartée")).toBeInTheDocument();
  });

  it("montre les candidats d'une lecture sans anomalie dès l'ouverture", async () => {
    fetchMock.mockReturnValueOnce(
      json({
        ...review,
        run: { ...run, blockedFieldCount: 0 },
        fields: review.fields.map((field) =>
          field.fieldId === "interest-2" ? cell(2, "interest", "B", "0") : field,
        ),
      }),
    );
    mount();
    expect(await screen.findByRole("button", { name: "Toutes (2)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.getElementById("schedule-candidate-interest-1")).toBeInTheDocument();
  });

  it("révèle le candidat sélectionné même hors des lignes à examiner", async () => {
    fetchMock.mockReturnValueOnce(json(review));
    mount();
    const source = await screen.findByRole("button", { name: /B2 30, Lue/ });
    expect(document.getElementById("schedule-candidate-interest-1")).not.toBeInTheDocument();
    fireEvent.click(source);
    expect(source).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Toutes (2)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.getElementById("schedule-candidate-interest-1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("corrige avec la révision lue et un montant décimal sans séparateur de milliers", async () => {
    fetchMock.mockReturnValueOnce(json(review)).mockReturnValueOnce(json(review));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /B3 abc, Illisible/ }));
    fireEvent.click(screen.getByRole("button", { name: "Corriger" }));
    fireEvent.change(screen.getByLabelText(/Montant retenu/), { target: { value: "1 234,5" } });
    fireEvent.change(screen.getByLabelText("Motif"), { target: { value: "Relu sur la pièce" } });
    fireEvent.click(screen.getByRole("button", { name: "Retenir cette valeur" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(init.body as string)).toEqual({
      action: "correct",
      fieldId: "interest-2",
      expectedRevision: 0,
      userValue: "1234,5",
      reason: "Relu sur la pièce",
    });
  });

  it("relit la revue sur un conflit de révision au lieu d'écraser", async () => {
    fetchMock
      .mockReturnValueOnce(json(review))
      .mockReturnValueOnce(json({ error: "Cette case a changé depuis votre lecture." }, 409))
      .mockReturnValueOnce(json(review));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /B2 30, Lue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la lecture" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cette case a changé depuis votre lecture. La revue a été rechargée.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("présente la validation par son effet, sans total inventé ni effet sur le prêt", async () => {
    fetchMock.mockReturnValueOnce(json(review));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Valider cette lecture" }));
    const dialog = screen.getByRole("dialog", { name: "Valider cette lecture" });
    expect(dialog).toHaveTextContent("non calculable : 1 case sans valeur");
    expect(dialog).toHaveTextContent("colonne absente du fichier");
    expect(dialog).toHaveTextContent("ces sommes ne disent pas le coût du prêt");
    expect(dialog).toHaveTextContent("Rien n’est encore appliqué au prêt");
    expect(dialog).toHaveTextContent("1 case(s) illisible(s)");
  });

  it("alterne pièce et candidats sur mobile en gardant la sélection", async () => {
    fetchMock.mockReturnValueOnce(json(review));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /B2 30, Lue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Candidats · B2" }));
    expect(document.querySelector(".schedule-review-layout")).toHaveAttribute(
      "data-view",
      "candidates",
    );
    expect(screen.getByRole("region", { name: "Case B2" })).toBeInTheDocument();
  });
});

describe("défilement de la sélection documentaire", () => {
  it("révèle la case dans son panneau sans déplacer la page", () => {
    const pane = document.createElement("div");
    pane.className = "schedule-lines";
    const field = document.createElement("button");
    field.id = "offscreen-field";
    pane.append(field);
    document.body.append(pane);
    Object.defineProperties(pane, {
      clientHeight: { value: 200 },
      clientWidth: { value: 200 },
    });
    pane.getBoundingClientRect = () => ({ top: 100, left: 20 }) as DOMRect;
    field.getBoundingClientRect = () =>
      ({ top: 400, bottom: 440, left: 240, right: 300 }) as DOMRect;
    pane.scrollBy = vi.fn();
    field.scrollIntoView = vi.fn();
    revealScheduleField(field.id, ".schedule-lines");
    expect(pane.scrollBy).toHaveBeenCalledWith({ top: 144, left: 84, behavior: "auto" });
    expect(field.scrollIntoView).not.toHaveBeenCalled();
    pane.remove();
  });
});

describe("section « Documents » de la dette", () => {
  it("liste les lectures et n'envoie une devise que si elle est déclarée", async () => {
    fetchMock.mockReturnValueOnce(json([run]));
    render(<DocumentsFixture />);
    expect(await screen.findByText("echeancier.csv")).toBeInTheDocument();
    expect(screen.getByText("À examiner")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Importer un échéancier/ }));
    const drawer = screen.getByRole("dialog", { name: "Importer un échéancier" });
    expect(drawer).toHaveTextContent("Le PDF n’est pas encore pris en charge");
    const input = within(drawer).getByLabelText(/Tableau d’amortissement/);
    fireEvent.change(input, {
      target: { files: [new File(["date;interet"], "e.csv", { type: "text/csv" })] },
    });
    fetchMock.mockReturnValueOnce(json({ ...review, run: { ...run } }, 201));
    fetchMock.mockReturnValueOnce(json([run]));
    // jsdom ne tient pas un fichier posé par `change` pour une saisie valide : on soumet.
    fireEvent.submit(drawer.querySelector("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const form = fetchMock.mock.calls[1]![1].body as FormData;
    // Le défaut de schéma de la dette n'est pas une déclaration : rien n'est supposé.
    expect(JSON.parse(form.get("options") as string)).toEqual({
      liabilityId: LOAN,
      declaredCurrency: null,
    });
  });

  it("déclare la devise de la dette seulement sur un geste explicite", async () => {
    fetchMock.mockReturnValueOnce(json([]));
    render(<DocumentsFixture />);
    await screen.findByText(/Aucun échéancier déposé/);
    fireEvent.click(screen.getByRole("button", { name: /Importer un échéancier/ }));
    fireEvent.click(screen.getByRole("button", { name: "Déclarer la devise de la dette (CHF)" }));
    expect(screen.getByLabelText(/Devise, si le fichier/)).toHaveValue("CHF");
  });
});
