import { describe, expect, it } from "vitest";

import { analyzePortfolioFile } from "@/lib/acquisition/portfolio/analyze";
import { buildWorkbook } from "@/lib/acquisition/xlsx/__tests__/fixtures/xlsx-builder";

import { csvBytes, KNOWN } from "./fixtures";

const BASE = {
  fileName: "ops.csv",
  kind: "PORTFOLIO_LEDGER" as const,
  accountId: "acc-pea",
  declaredCurrency: "EUR",
  known: KNOWN,
  sourceKey: "GENERIC_PORTFOLIO_FILE",
};

/** Le même jeu de données, exprimé dans plusieurs formats et encodages. */
const HEADER = ["Date", "Type", "ISIN", "Libellé", "Quantité", "Montant brut", "Devise"];
const DATA = ["15/03/2026", "Achat", "FR0000120073", "Air Liquide", "10", "1705,00", "EUR"];

function delimited(delimiter: string): Uint8Array {
  return csvBytes([HEADER.join(delimiter), DATA.join(delimiter)].join("\n"));
}

describe("séparateurs", () => {
  it("lit à l'identique le point-virgule, la virgule, la tabulation et la barre verticale", () => {
    // La virgule comme séparateur de COLONNES et la virgule décimale coexistent : c'est le
    // cas où une détection naïve casse tout. Les montants sont donc écrits en points ici.
    const results = [";", "\t", "|"].map((delimiter) =>
      analyzePortfolioFile({ ...BASE, bytes: delimited(delimiter) }),
    );
    for (const result of results) {
      expect(result.ledgerRows).toHaveLength(1);
      expect(result.ledgerRows[0].eventType).toBe("BUY");
      expect(result.ledgerRows[0].grossAmount).toBeCloseTo(1705, 6);
    }
  });

  it("lit un fichier séparé par des virgules avec des décimales en point", () => {
    const bytes = csvBytes(
      [
        "Date,Type,ISIN,Quantité,Montant brut,Devise",
        "2026-03-15,Achat,FR0000120073,10,1705.00,EUR",
      ].join("\n"),
    );
    const result = analyzePortfolioFile({ ...BASE, bytes });
    expect(result.ledgerRows[0].grossAmount).toBeCloseTo(1705, 6);
  });
});

describe("encodages", () => {
  it("lit un CSV en UTF-8 avec BOM", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = delimited(";");
    const bytes = new Uint8Array(bom.length + body.length);
    bytes.set(bom, 0);
    bytes.set(body, bom.length);
    const result = analyzePortfolioFile({ ...BASE, bytes });
    // Sans retrait du BOM, le premier en-tête serait « ﻿Date » et le mapping échouerait.
    expect(result.ledgerRows).toHaveLength(1);
    expect(result.ledgerRows[0].eventDate).toBe("2026-03-15");
  });

  it("lit un CSV en Windows-1252 et le SIGNALE", () => {
    // « Libellé » en Windows-1252 : le « é » est l'octet 0xE9, invalide en UTF-8.
    const header = "Date;Type;ISIN;Libellé;Quantité;Montant brut;Devise";
    const bytes = new Uint8Array([
      ...[...header].map((char) => char.codePointAt(0)!),
      0x0a,
      ...[...DATA.join(";")].map((char) => char.codePointAt(0)!),
    ]);
    const result = analyzePortfolioFile({ ...BASE, bytes });
    expect(result.ledgerRows).toHaveLength(1);
    expect(result.issues.some((issue) => issue.code === "ENCODING_FALLBACK")).toBe(true);
  });
});

describe("équivalence CSV / XLSX", () => {
  it("rend la MÊME lecture pour le même jeu de données dans les deux formats", () => {
    const csv = analyzePortfolioFile({ ...BASE, bytes: delimited(";") });

    const columns = ["A", "B", "C", "D", "E", "F", "G"];
    const workbook = buildWorkbook({
      sheetName: "Operations",
      rows: [
        HEADER.map((value, index) => ({
          ref: `${columns[index]}1`,
          type: "inlineStr" as const,
          value,
        })),
        [
          { ref: "A2", type: "inlineStr" as const, value: "2026-03-15" },
          { ref: "B2", type: "inlineStr" as const, value: "Achat" },
          { ref: "C2", type: "inlineStr" as const, value: "FR0000120073" },
          { ref: "D2", type: "inlineStr" as const, value: "Air Liquide" },
          { ref: "E2", value: "10" },
          { ref: "F2", value: "1705" },
          { ref: "G2", type: "inlineStr" as const, value: "EUR" },
        ],
      ],
    });
    const xlsx = analyzePortfolioFile({ ...BASE, bytes: workbook, fileName: "ops.xlsx" });

    const shape = (result: typeof csv) =>
      result.ledgerRows.map((row) => ({
        eventType: row.eventType,
        eventDate: row.eventDate,
        quantity: row.quantity,
        grossAmount: row.grossAmount,
        currency: row.currency,
        status: row.status,
      }));
    expect(shape(xlsx)).toEqual(shape(csv));
  });
});

describe("fichier dégénéré", () => {
  it("refuse un fichier vide sans rien inventer", () => {
    const result = analyzePortfolioFile({ ...BASE, bytes: csvBytes("") });
    expect(result.ledgerRows).toHaveLength(0);
    expect(result.issues.some((issue) => issue.severity === "ERROR")).toBe(true);
  });

  it("refuse un fichier sans en-tête exploitable", () => {
    const result = analyzePortfolioFile({ ...BASE, bytes: csvBytes("juste du texte\n") });
    expect(result.ledgerRows).toHaveLength(0);
  });

  it("lit un fichier d'en-tête seul sans produire de ligne", () => {
    const result = analyzePortfolioFile({ ...BASE, bytes: csvBytes(HEADER.join(";")) });
    expect(result.ledgerRows).toHaveLength(0);
    expect(result.counts.total).toBe(0);
  });
});
