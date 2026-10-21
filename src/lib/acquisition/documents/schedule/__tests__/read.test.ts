import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildWorkbook } from "@/lib/acquisition/xlsx/__tests__/fixtures/xlsx-builder";
import { readHeader } from "../columns";
import {
  MAX_SCHEDULE_COLUMNS,
  MAX_SCHEDULE_LINES,
  readScheduleDocument,
  type ScheduleExtraction,
} from "../read";

// Fixtures entièrement synthétiques : aucun échéancier réel, aucune donnée personnelle.
const csv = (text: string) => new TextEncoder().encode(text);
const read = (
  text: string,
  options: Partial<{ fileName: string; currency: string | null; principal: number | null }> = {},
) =>
  readScheduleDocument({
    bytes: csv(text),
    fileName: options.fileName ?? "echeancier.csv",
    declaredCurrency: options.currency === undefined ? "EUR" : options.currency,
    contractPrincipal: options.principal === undefined ? null : options.principal,
  });
const field = (result: ScheduleExtraction, code: string) =>
  result.fields.find((entry) => entry.boxCode === code);
const codes = (result: ScheduleExtraction) => result.issues.map((entry) => entry.code);

const LEGACY = [
  "date;ouverture;principal;interet;assurance;frais;cloture;total",
  "2026-10-05;12000;1000;30;5;0;11000;1035",
  "2026-11-05;11000;1000;27,5;5;0;10000;1032,5",
].join("\n");

describe("B19 — classeurs réellement déposés en recette", () => {
  it.each([
    ["echeancier-partiel", ["SCHEDULE_PARTIAL_EXTRACT"]],
    ["echeancier-dates-anormales", ["SCHEDULE_DUPLICATE_DUE_DATE", "SCHEDULE_PERIOD_GAP"]],
    ["echeancier-formules", ["SCHEDULE_FORMULA_CELL"]],
  ] as const)("lit %s et garde ses réserves", (name, expectedCodes) => {
    const bytes = readFileSync(
      new URL(
        `../../../../../../docs/consolidation/preuves/visual-b19-2026-10-21/fixtures/${name}.xlsx`,
        import.meta.url,
      ),
    );
    const result = readScheduleDocument({
      bytes,
      fileName: `${name}.xlsx`,
      declaredCurrency: "EUR",
      contractPrincipal: 2000,
    });
    expect(result.status).toBe("EXTRACTED");
    const reportedCodes = [...result.issues, ...result.fields.flatMap((entry) => entry.issues)].map(
      (entry) => entry.code,
    );
    expect(reportedCodes).toEqual(expect.arrayContaining([...expectedCodes]));
    expect(result.firstDueDate).toMatch(/^2026-/);
    if (name === "echeancier-partiel") expect(result.completeness).toBe("PARTIAL");
  });
});

describe("lecture d'un échéancier CSV en candidats localisés", () => {
  it("rend chaque cellule avec sa ligne, sa colonne, sa référence et son unité", () => {
    const result = read(LEGACY);
    expect(result.status).toBe("EXTRACTED");
    expect(result.sourceFormat).toBe("CSV");
    expect(result.lineCount).toBe(2);
    expect(result.fields).toHaveLength(16);
    expect(field(result, "L1.date")).toMatchObject({
      rowNumber: 2,
      cellRef: "A2",
      unit: "DATE",
      normalizedDate: "2026-10-05",
      rawValue: "2026-10-05",
    });
    expect(field(result, "L2.interest")).toMatchObject({
      rowNumber: 3,
      cellRef: "D3",
      columnLabel: "interet",
      unit: "MONEY",
      rawValue: "27,5",
      normalizedValue: 27.5,
      validationStatus: "EXTRACTED",
    });
    expect(result.firstDueDate).toBe("2026-10-05");
    expect(result.lastDueDate).toBe("2026-11-05");
  });

  it("définit les contrôles sur des cellules précises, sans en faire l'arithmétique", () => {
    const result = read(LEGACY);
    expect(result.checks.map((check) => check.checkCode)).toEqual([
      "ROW_BALANCE:1",
      "ROW_BALANCE:2",
      "ROW_TOTAL:1",
      "ROW_TOTAL:2",
      "CHAIN:1",
    ]);
    expect(result.checks.find((check) => check.checkCode === "CHAIN:1")).toMatchObject({
      left: ["L1.closing"],
      right: ["L2.opening"],
      severity: "BLOCKING",
    });
    // Aucun total, aucun coût n'est produit par la lecture.
    expect(Object.keys(result)).not.toContain("totalCost");
  });

  it("ne déclare complet qu'un extrait prouvé du capital initial à un solde nul", () => {
    expect(read(LEGACY).completeness).toBe("PARTIAL");
    expect(read(LEGACY, { principal: 12000 }).completeness).toBe("PARTIAL");
    const complete = read(
      [
        "date;ouverture;principal;interet;assurance;frais;cloture;total",
        "2026-10-05;2000;1000;0;0;0;1000;1000",
        "2026-11-05;1000;1000;0;0;0;0;1000",
      ].join("\n"),
      { principal: 2000 },
    );
    expect(complete.completeness).toBe("COMPLETE");
    expect(complete.completenessReasons).toEqual([]);
    const midLoan = read(LEGACY, { principal: 15000 });
    expect(midLoan.completenessReasons.join(" ")).toMatch(/en cours de prêt/);
    expect(codes(midLoan)).toContain("SCHEDULE_PARTIAL_EXTRACT");
  });

  it("une colonne absente reste absente : aucune case, contrôle non calculable nommé", () => {
    const result = read(
      ["date;ouverture;principal;interet;frais;cloture;total", "2026-10-05;100;10;1;0;90;11"].join(
        "\n",
      ),
    );
    expect(result.fields.some((entry) => entry.columnKey === "insurance")).toBe(false);
    const total = result.checks.find((check) => check.checkCode === "ROW_TOTAL");
    expect(total?.unresolved).toEqual(["insurance"]);
    expect(codes(result)).toContain("SCHEDULE_CHECK_COLUMNS_MISSING");
  });

  it("une cellule vide reste vide : ni zéro, ni blocage", () => {
    const result = read(
      [
        "date;ouverture;principal;interet;assurance;frais;cloture;total",
        "2026-10-05;100;10;1;;0;90;11",
      ].join("\n"),
    );
    expect(field(result, "L1.insurance")).toMatchObject({
      rawValue: null,
      normalizedValue: null,
      validationStatus: "EXTRACTED",
    });
  });

  it("tranche la convention décimale par colonne, et bloque une colonne indécidable", () => {
    const resolved = read(["date;principal", "05/10/2026;1 234,56", "05/11/2026;1,5"].join("\n"));
    expect(field(resolved, "L1.principal")?.normalizedValue).toBe(1234.56);
    expect(field(resolved, "L2.principal")?.normalizedValue).toBe(1.5);
    const ambiguous = read(["date;principal", "2026-10-05;1,234"].join("\n"));
    expect(field(ambiguous, "L1.principal")).toMatchObject({
      normalizedValue: null,
      validationStatus: "BLOCKED",
    });
    expect(field(ambiguous, "L1.principal")?.issues[0]?.code).toBe(
      "BOX_VALUE_AMBIGUOUS_CONVENTION",
    );
  });

  it("tranche jour/mois par colonne, et bloque une colonne de dates indécidable", () => {
    const resolved = read(["date;principal", "05/10/2026;1", "25/10/2026;1"].join("\n"));
    expect(field(resolved, "L1.date")?.normalizedDate).toBe("2026-10-05");
    const ambiguous = read(["date;principal", "05/10/2026;1", "05/11/2026;1"].join("\n"));
    expect(field(ambiguous, "L1.date")?.validationStatus).toBe("BLOCKED");
    const impossible = read(["date;principal", "2026-02-30;1"].join("\n"));
    expect(field(impossible, "L1.date")?.issues[0]?.message).toMatch(/n’existe pas/);
  });

  it("bloque un montant négatif au lieu de le lire (hors capital, voir différé capitalisé)", () => {
    const result = read(["date;principal;interet", "2026-10-05;10;-10"].join("\n"));
    expect(field(result, "L1.interest")).toMatchObject({
      normalizedValue: null,
      validationStatus: "BLOCKED",
    });
    expect(field(result, "L1.interest")?.issues[0]?.code).toBe("SCHEDULE_NEGATIVE_AMOUNT");
  });

  it("signale doublons, désordre et trous de périodicité sans rien reconstituer", () => {
    const duplicates = read(
      ["date;principal", "2026-10-05;1", "2026-10-05;1", "2026-09-05;1"].join("\n"),
    );
    expect(codes(duplicates)).toEqual(
      expect.arrayContaining(["SCHEDULE_DUPLICATE_DUE_DATE", "SCHEDULE_DATES_NOT_INCREASING"]),
    );
    const gap = read(
      ["date;principal", "2026-01-05;1", "2026-02-05;1", "2026-03-05;1", "2026-06-05;1"].join("\n"),
    );
    const notice = gap.issues.find((entry) => entry.code === "SCHEDULE_PERIOD_GAP");
    expect(notice?.message).toMatch(/2 échéance\(s\) manquent/);
    expect(gap.lineCount).toBe(4);
  });

  it("conserve une colonne inconnue sans rôle, et n'attribue ni un libellé ambigu ni un rôle disputé", () => {
    const result = read(
      ["date;principal;commentaire;capital restant dû", "2026-10-05;1;texte;99"].join("\n"),
    );
    expect(field(result, "L1.colC")).toMatchObject({
      validationStatus: "UNKNOWN_BOX",
      unit: "TEXT",
      rawValue: "texte",
    });
    expect(field(result, "L1.colD")?.validationStatus).toBe("UNKNOWN_BOX");
    expect(codes(result)).toContain("SCHEDULE_COLUMN_AMBIGUOUS");
    const disputed = read(["date;capital;principal", "2026-10-05;1;1"].join("\n"));
    expect(disputed.columns.filter((column) => column.role === "PRINCIPAL")).toEqual([]);
    expect(codes(disputed)).toContain("SCHEDULE_COLUMN_DUPLICATE_ROLE");
  });

  it("échoue, nommé, sans colonne de date", () => {
    const result = read(["montant;principal", "1;1"].join("\n"));
    expect(result.status).toBe("FAILED");
    expect(result.fields).toEqual([]);
    expect(codes(result)).toContain("SCHEDULE_DATE_COLUMN_MISSING");
  });

  it("refuse un format non annoncé ou une extension qui ment", () => {
    expect(codes(read(LEGACY, { fileName: "echeancier.pdf" }))).toContain(
      "SCHEDULE_FORMAT_REFUSED",
    );
    expect(read(LEGACY, { fileName: "echeancier.xlsx" }).status).toBe("FAILED");
  });

  it("refuse au-delà du plafond de lignes au lieu de tronquer", () => {
    const lines = ["date;principal"];
    for (let index = 0; index <= MAX_SCHEDULE_LINES; index += 1) lines.push("2026-10-05;1");
    const result = read(lines.join("\n"));
    expect(result.status).toBe("FAILED");
    expect(result.fields).toEqual([]);
  });

  it("lit la devise de l'en-tête, refuse un conflit, et n'en suppose aucune", () => {
    const header = read(["date;principal (USD)", "2026-10-05;1"].join("\n"), { currency: null });
    expect(header).toMatchObject({ currency: "USD", currencySource: "HEADER" });
    const conflict = read(["date;principal (USD)", "2026-10-05;1"].join("\n"), {
      currency: "EUR",
    });
    expect(conflict.currency).toBeNull();
    expect(codes(conflict)).toContain("SCHEDULE_CURRENCY_CONFLICT");
    const declared = read(["date;principal", "2026-10-05;1"].join("\n"), { currency: "CHF" });
    expect(declared).toMatchObject({ currency: "CHF", currencySource: "DECLARED" });
    const none = read(["date;principal", "2026-10-05;1"].join("\n"), { currency: null });
    expect(none.currency).toBeNull();
    expect(codes(none)).toContain("SCHEDULE_CURRENCY_UNDECLARED");
  });
});

describe("lecture d'un échéancier XLSX", () => {
  const header = [
    { ref: "A1", type: "inlineStr" as const, value: "Date d'échéance" },
    { ref: "B1", type: "inlineStr" as const, value: "Capital restant dû avant" },
    { ref: "C1", type: "inlineStr" as const, value: "Amortissement" },
    { ref: "D1", type: "inlineStr" as const, value: "Capital restant dû après" },
  ];

  it("garde la vraie référence de cellule quand des lignes vides manquent", () => {
    const result = readScheduleDocument({
      bytes: buildWorkbook({
        rows: [
          header,
          [
            { ref: "A3", type: "inlineStr", value: "2026-10-05" },
            { ref: "B3", value: "200" },
            { ref: "C3", value: "100", formula: "B3-D3" },
            { ref: "D3", value: "100" },
          ],
        ],
        rowNumbers: [1, 3],
      }),
      fileName: "echeancier.xlsx",
      declaredCurrency: "EUR",
      contractPrincipal: null,
    });
    expect(result.status).toBe("EXTRACTED");
    expect(field(result, "L1.principal")).toMatchObject({
      cellRef: "C3",
      rowNumber: 3,
      normalizedValue: 100,
      fromFormula: true,
    });
    expect(field(result, "L1.principal")?.issues[0]?.code).toBe("SCHEDULE_FORMULA_CELL");
  });

  it("bloque une formule sans valeur en cache : inconnue, pas vide", () => {
    const result = readScheduleDocument({
      bytes: buildWorkbook({
        rows: [
          header,
          [
            { ref: "A2", type: "inlineStr", value: "2026-10-05" },
            { ref: "B2", value: "200" },
            { ref: "C2", formula: "B2-D2" },
            { ref: "D2", value: "100" },
          ],
        ],
      }),
      fileName: "echeancier.xlsx",
      declaredCurrency: "EUR",
      contractPrincipal: null,
    });
    expect(field(result, "L1.principal")).toMatchObject({
      normalizedValue: null,
      validationStatus: "BLOCKED",
    });
  });

  it("bloque une cellule en erreur du tableur : #REF! n'est pas une cellule vide", () => {
    const result = readScheduleDocument({
      bytes: buildWorkbook({
        rows: [
          header,
          [
            { ref: "A2", type: "inlineStr", value: "2026-10-05" },
            { ref: "B2", value: "200" },
            { ref: "C2", type: "e", value: "#REF!", formula: "B2-D2" },
            { ref: "D2", value: "100" },
          ],
        ],
      }),
      fileName: "echeancier.xlsx",
      declaredCurrency: "EUR",
      contractPrincipal: null,
    });
    expect(field(result, "L1.principal")).toMatchObject({
      normalizedValue: null,
      validationStatus: "BLOCKED",
    });
    expect(field(result, "L1.principal")?.issues[0]?.message).toMatch(/erreur/);
  });

  it("refuse un classeur porteur de macros", () => {
    const result = readScheduleDocument({
      bytes: buildWorkbook({ rows: [header], withMacro: true }),
      fileName: "echeancier.xlsx",
      declaredCurrency: "EUR",
      contractPrincipal: null,
    });
    expect(result.status).toBe("FAILED");
    expect(result.issues[0]?.message).toMatch(/macros/);
  });
});

describe("registre des en-têtes", () => {
  it("reconnaît par libellé, sans accent ni casse, et lit une mention de devise", () => {
    expect(readHeader("Intérêts")).toMatchObject({ role: "INTEREST", currency: null });
    expect(readHeader("Capital amorti (€)")).toMatchObject({ role: "PRINCIPAL", currency: "EUR" });
    expect(readHeader("CRD après")).toMatchObject({ role: "CLOSING_BALANCE" });
    expect(readHeader("Capital restant dû")).toMatchObject({ role: null, ambiguous: true });
    expect(readHeader("Remarques")).toMatchObject({ role: null, ambiguous: false });
  });
});

describe("en-têtes qui ne tranchent pas seuls (relecture indépendante)", () => {
  it("lit « Échéance » comme le montant quand une autre colonne porte la date", () => {
    const result = read(["Date;Échéance;Capital;Intérêts", "2026-10-05;1030;1000;30"].join("\n"));
    expect(result.status).toBe("EXTRACTED");
    expect(field(result, "L1.date")?.normalizedDate).toBe("2026-10-05");
    expect(field(result, "L1.total")?.normalizedValue).toBe(1030);
    expect(
      result.issues.find((issue) => issue.code === "SCHEDULE_COLUMN_AMBIGUOUS")?.message,
    ).toMatch(/montant/);
  });

  it("lit « Échéance » comme la date quand aucune autre colonne ne la porte", () => {
    const result = read(["Échéance;Capital;Intérêts", "2026-10-05;1000;30"].join("\n"));
    expect(result.status).toBe("EXTRACTED");
    expect(field(result, "L1.date")?.normalizedDate).toBe("2026-10-05");
  });

  it("cherche l'en-tête d'un CSV sous une ligne de titre, avec les vrais numéros de ligne", () => {
    const result = read(
      ["Tableau d'amortissement du prêt", "date;principal;interet", "2026-10-05;1000;30"].join(
        "\n",
      ),
    );
    expect(result.status).toBe("EXTRACTED");
    expect(field(result, "L1.principal")).toMatchObject({ rowNumber: 3, cellRef: "B3" });
    expect(result.lineCount).toBe(1);
  });

  it("refuse un fichier au-delà du plafond de colonnes au lieu de tronquer la revue", () => {
    const extra = Array.from({ length: MAX_SCHEDULE_COLUMNS }, (_, index) => `note${index}`);
    const result = read(
      [["date", "principal", ...extra].join(";"), ["2026-10-05", "1000", ...extra].join(";")].join(
        "\n",
      ),
    );
    expect(result.status).toBe("FAILED");
    expect(codes(result)).toContain("SCHEDULE_TOO_MANY_COLUMNS");
  });

  it("lit un différé capitalisé sans le bloquer : capital négatif signalé, contrôle non bloquant", () => {
    const result = read(
      [
        "date;ouverture;principal;interet;cloture",
        "2026-10-05;100000;-250;0;100250",
        "2026-11-05;100250;0;250;100250",
      ].join("\n"),
    );
    expect(field(result, "L1.principal")).toMatchObject({
      normalizedValue: -250,
      validationStatus: "EXTRACTED",
    });
    expect(field(result, "L1.principal")?.issues[0]?.severity).toBe("WARNING");
    // Clôture > ouverture sans capital négatif : écart signalé, validation non bloquée.
    const flat = read(
      ["date;ouverture;principal;cloture", "2026-10-05;100000;0;100250"].join("\n"),
    );
    expect(flat.checks.find((check) => check.checkCode === "ROW_BALANCE:1")?.severity).toBe(
      "WARNING",
    );
    // Un intérêt négatif reste bloqué.
    const negativeInterest = read(["date;principal;interet", "2026-10-05;100;-3"].join("\n"));
    expect(field(negativeInterest, "L1.interest")?.validationStatus).toBe("BLOCKED");
  });
});
