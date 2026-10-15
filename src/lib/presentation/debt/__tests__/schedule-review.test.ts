import { describe, expect, it } from "vitest";

import type {
  ScheduleFieldView,
  ScheduleReview,
  ScheduleRunSummary,
} from "@/lib/data/schedule-document-contracts";
import {
  buildScheduleGrid,
  buildScheduleLines,
  fieldHistory,
  overlappingDueDates,
  summarizeScheduleReview,
} from "../schedule-review";

const LETTERS: Record<string, string> = {
  date: "A",
  principal: "B",
  interest: "C",
  closing: "D",
  col_E: "E",
};

function field(
  line: number,
  columnKey: string,
  value: number | string | null,
  overrides: Partial<ScheduleFieldView> = {},
): ScheduleFieldView {
  const isDate = columnKey === "date";
  const rowNumber = line + 1;
  return {
    fieldId: `f-${line}-${columnKey}`,
    boxCode: `L${line}.${columnKey}`,
    lineNumber: line,
    rowNumber,
    sheetName: "Echeancier",
    columnKey,
    columnLabel: columnKey.toUpperCase(),
    cellRef: `${LETTERS[columnKey]}${rowNumber}`,
    rawValue: value === null ? null : String(value),
    normalizedValue: isDate || typeof value !== "number" ? null : value,
    normalizedDate: isDate && typeof value === "string" ? value : null,
    userValue: null,
    userDate: null,
    effectiveValue: isDate || typeof value !== "number" ? null : value,
    effectiveDate: isDate && typeof value === "string" ? value : null,
    unit: isDate ? "DATE" : columnKey === "col_E" ? "TEXT" : "MONEY",
    validationStatus: columnKey === "col_E" ? "UNKNOWN_BOX" : "EXTRACTED",
    decisionRevision: 0,
    userReason: null,
    issues: [],
    ...overrides,
  };
}

const run: ScheduleRunSummary = {
  runId: "run",
  liabilityId: "loan",
  status: "EXTRACTED",
  fileName: "echeancier.xlsx",
  sourceFormat: "XLSX",
  sheetName: "Echeancier",
  extractedAt: "2026-10-15T08:00:00Z",
  extractorVersion: "1.0.0",
  schemaVersion: "schedule-columns-v1",
  lineCount: 2,
  firstDueDate: "2026-01-05",
  lastDueDate: "2026-02-05",
  completeness: "COMPLETE",
  completenessReasons: [],
  currency: "EUR",
  currencySource: "DECLARED",
  failedCheckCount: 0,
  notComputableCheckCount: 0,
  blockedFieldCount: 0,
  correctedFieldCount: 0,
  supersedesRunId: null,
  documentId: "doc",
  issues: [],
};

const fields = [
  field(1, "date", "2026-01-05"),
  field(1, "principal", 800.1),
  field(1, "interest", 200.2),
  field(1, "closing", 9199.9),
  field(1, "col_E", "note"),
  field(2, "date", "2026-02-05"),
  field(2, "principal", 801.25),
  field(2, "interest", 198.75),
  field(2, "closing", 8398.65),
  field(2, "col_E", null),
];

const review = (overrides: Partial<ScheduleReview> = {}): ScheduleReview => ({
  run,
  fields,
  checks: [],
  decisions: [],
  ...overrides,
});

describe("grille de la pièce telle que lue", () => {
  it("garde toutes les colonnes lues, reconnues ou non, dans l'ordre des lettres du fichier", () => {
    const grid = buildScheduleGrid([...fields].reverse());
    expect(grid.columns.map((column) => column.letter)).toEqual(["A", "B", "C", "D", "E"]);
    expect(grid.columns.find((column) => column.key === "col_E")?.recognized).toBe(false);
    expect(grid.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
    // Une cellule vide reste une case sans valeur, jamais un zéro.
    expect(grid.rows[1]!.cells.col_E!.rawValue).toBeNull();
  });

  it("range AA après Z", () => {
    const wide = [
      field(1, "date", "2026-01-05", { cellRef: "AA2", columnKey: "x" }),
      field(1, "principal", 1, { cellRef: "Z2" }),
    ];
    expect(buildScheduleGrid(wide).columns.map((column) => column.letter)).toEqual(["Z", "AA"]);
  });
});

describe("candidats par ligne d'échéance", () => {
  it("écarte les colonnes non reconnues et ordonne comme un tableau d'amortissement", () => {
    const lines = buildScheduleLines([...fields].reverse());
    expect(lines).toHaveLength(2);
    expect(lines[0]!.fields.map((item) => item.columnKey)).toEqual([
      "date",
      "principal",
      "interest",
      "closing",
    ]);
    expect(lines[0]!.date?.effectiveDate).toBe("2026-01-05");
  });
});

describe("synthèse avant validation", () => {
  it("additionne les valeurs retenues, correction comprise", () => {
    const corrected = fields.map((item) =>
      item.fieldId === "f-2-interest"
        ? { ...item, userValue: 199, effectiveValue: 199, validationStatus: "CORRECTED" as const }
        : item,
    );
    const synthesis = summarizeScheduleReview(review({ fields: corrected }));
    const interest = synthesis.sums.find((sum) => sum.key === "interest")!;
    expect(interest.sum).toBeCloseTo(399.2, 10);
    expect(synthesis.partial).toBe(false);
  });

  it("rend la somme non calculable dès qu'une case est vide, illisible ou écartée", () => {
    for (const status of ["BLOCKED", "REJECTED"] as const) {
      const damaged = fields.map((item) =>
        item.fieldId === "f-1-principal"
          ? {
              ...item,
              validationStatus: status,
              effectiveValue: status === "BLOCKED" ? null : item.effectiveValue,
            }
          : item,
      );
      const principal = summarizeScheduleReview(review({ fields: damaged })).sums.find(
        (sum) => sum.key === "principal",
      )!;
      expect(principal).toMatchObject({ sum: null, reason: "INCOMPLETE", missingCount: 1 });
    }
  });

  it("compte une ligne sans case dans la colonne comme manquante", () => {
    const missing = fields.filter((item) => item.fieldId !== "f-2-interest");
    const interest = summarizeScheduleReview(review({ fields: missing })).sums.find(
      (sum) => sum.key === "interest",
    )!;
    expect(interest).toMatchObject({ sum: null, missingCount: 1 });
  });

  it("dit absente une colonne que le fichier ne porte pas, sans l'inventer à zéro", () => {
    const insurance = summarizeScheduleReview(review()).sums.find(
      (sum) => sum.key === "insurance",
    )!;
    expect(insurance).toMatchObject({ sum: null, reason: "ABSENT" });
  });

  it("présente comme partiel tout extrait dont la complétude n'est pas prouvée", () => {
    expect(
      summarizeScheduleReview(review({ run: { ...run, completeness: "PARTIAL" } })).partial,
    ).toBe(true);
    expect(summarizeScheduleReview(review({ run: { ...run, completeness: null } })).partial).toBe(
      true,
    );
  });

  it("compte les contrôles bloquants en échec et les non calculables séparément", () => {
    const base = {
      label: null,
      expectedValue: null,
      actualValue: null,
      difference: null,
      left: [],
      right: [],
      message: null,
    };
    const synthesis = summarizeScheduleReview(
      review({
        checks: [
          { ...base, checkCode: "ROW_BALANCE:1", severity: "BLOCKING", status: "FAILED" },
          { ...base, checkCode: "ROW_TOTAL:1", severity: "WARNING", status: "FAILED" },
          { ...base, checkCode: "ABSENT.total", severity: "INFO", status: "NOT_COMPUTABLE" },
        ],
      }),
    );
    expect(synthesis).toMatchObject({
      failedBlockingChecks: 1,
      failedChecks: 2,
      notComputableChecks: 1,
    });
  });
});

describe("conflits et historique", () => {
  it("signale les dates déjà portées par l'échéancier enregistré, sauf case écartée", () => {
    expect(overlappingDueDates(fields, ["2026-02-05", "2026-03-05"])).toEqual(["2026-02-05"]);
    const rejected = fields.map((item) =>
      item.fieldId === "f-2-date" ? { ...item, validationStatus: "REJECTED" as const } : item,
    );
    expect(overlappingDueDates(rejected, ["2026-02-05"])).toEqual([]);
  });

  it("restitue l'historique d'une case dans l'ordre des rangs", () => {
    const decision = {
      fieldId: "f-1-interest",
      action: "CORRECT" as const,
      beforeStatus: "EXTRACTED" as const,
      beforeValue: 200.2,
      beforeDate: null,
      afterStatus: "CORRECTED" as const,
      afterValue: 200,
      afterDate: null,
      reason: "Relu",
      decidedAt: "2026-10-15T08:00:00Z",
    };
    const history = fieldHistory(
      [
        { ...decision, rank: 2 },
        { ...decision, fieldId: "autre", rank: 1 },
        { ...decision, rank: 1 },
      ],
      "f-1-interest",
    );
    expect(history.map((item) => item.rank)).toEqual([1, 2]);
  });
});
