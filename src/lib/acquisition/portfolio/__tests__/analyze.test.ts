import { describe, expect, it } from "vitest";

import {
  analyzePortfolioFile,
  detectFormat,
  MAX_PORTFOLIO_ROWS,
  readEventType,
  type PortfolioAnalysisInput,
} from "@/lib/acquisition/portfolio/analyze";
import { buildWorkbook } from "@/lib/acquisition/xlsx/__tests__/fixtures/xlsx-builder";

import {
  csvBytes,
  KNOWN,
  LEDGER_CSV_EN,
  LEDGER_CSV_FR,
  LEDGER_CSV_PERMUTED,
  ledgerWorkbookBytes,
  POSITION_CSV,
} from "./fixtures";

const ACCOUNT = "acc-pea";

function analyze(overrides: Partial<PortfolioAnalysisInput> = {}) {
  return analyzePortfolioFile({
    bytes: csvBytes(LEDGER_CSV_FR),
    fileName: "ops.csv",
    kind: "PORTFOLIO_LEDGER",
    accountId: ACCOUNT,
    declaredCurrency: "EUR",
    known: KNOWN,
    sourceKey: "GENERIC_PORTFOLIO_FILE",
    ...overrides,
  });
}

describe("reconnaissance du format", () => {
  it("reconnaît un XLSX par son CONTENU, pas par son extension", () => {
    // Un classeur renommé en .csv reste un classeur : le lire comme du texte produirait des
    // lignes de binaire.
    const workbook = buildWorkbook({ rows: [[{ ref: "A1", value: "1" }]] });
    expect(detectFormat(workbook, "portefeuille.csv")).toBe("XLSX");
    expect(detectFormat(csvBytes("a;b\n1;2"), "portefeuille.xlsx")).toBe("CSV");
  });
});

describe("natures d'opération", () => {
  it("reconnaît les libellés français et anglais", () => {
    expect(readEventType("Achat")).toBe("BUY");
    expect(readEventType("Buy")).toBe("BUY");
    expect(readEventType("Dividende")).toBe("DIVIDEND");
    expect(readEventType("Versement")).toBe("CONTRIBUTION");
    expect(readEventType("Droits de garde")).toBe("FEE");
  });

  it("ne confond PAS « rachat » avec « achat »", () => {
    // Un préfixe partiel transformerait une vente en achat, et le patrimoine doublerait.
    expect(readEventType("Rachat")).toBe("SELL");
  });

  it("rend null sur une nature inconnue plutôt qu'une nature approchante", () => {
    expect(readEventType("OPS")).toBeNull();
    expect(readEventType("")).toBeNull();
  });
});

describe("import de ledger, CSV français", () => {
  it("lit les quatre opérations avec leurs termes", () => {
    const result = analyze();
    expect(result.format).toBe("CSV");
    expect(result.ledgerRows).toHaveLength(4);
    const buy = result.ledgerRows[0];
    expect(buy.eventType).toBe("BUY");
    expect(buy.eventDate).toBe("2026-03-15");
    expect(buy.quantity).toBe(10);
    expect(buy.unitPrice).toBeCloseTo(170.5, 6);
    expect(buy.grossAmount).toBeCloseTo(1705, 6);
    expect(buy.feeAmount).toBeCloseTo(4.9, 6);
    expect(buy.currency).toBe("EUR");
    expect(buy.status).toBe("READY");
  });

  it("laisse des frais absents à NULL, jamais à zéro", () => {
    const result = analyze();
    const dividend = result.ledgerRows[1];
    expect(dividend.eventType).toBe("DIVIDEND");
    // Des frais inconnus ne sont pas des frais nuls : le coût de revient qui en dépend
    // resterait faux tout en paraissant calculé.
    expect(dividend.feeAmount).toBeNull();
    expect(dividend.quantity).toBeNull();
  });

  it("lit à l'IDENTIQUE un fichier dont les colonnes sont permutées", () => {
    const straight = analyze();
    const permuted = analyze({ bytes: csvBytes(LEDGER_CSV_PERMUTED) });
    const shape = (rows: typeof straight.ledgerRows) =>
      rows.map((row) => [
        row.eventType,
        row.eventDate,
        row.quantity,
        row.grossAmount,
        row.currency,
      ]);
    expect(shape(permuted.ledgerRows)).toEqual(shape(straight.ledgerRows));
  });

  it("lit les décimales et dates internationales", () => {
    const result = analyze({ bytes: csvBytes(LEDGER_CSV_EN), declaredCurrency: null });
    expect(result.ledgerRows[0].eventDate).toBe("2026-03-15");
    expect(result.ledgerRows[0].unitPrice).toBeCloseTo(410.25, 6);
    expect(result.ledgerRows[0].currency).toBe("USD");
  });

  it("refuse un montant négatif : la direction vient de la nature, pas du signe", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut;Devise",
      "15/03/2026;Achat;FR0000120073;10;-1705,00;EUR",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv) });
    expect(result.ledgerRows[0].status).toBe("BLOCKED");
    expect(
      result.ledgerRows[0].issues.some((entry) => entry.message.includes("compté deux fois")),
    ).toBe(true);
  });

  it("accepte un effet cash NÉGATIF : c'est le seul terme signé du domaine", () => {
    const csv = [
      "Date;Type;Montant brut;Montant net;Devise",
      "31/03/2026;Frais;12,00;-12,00;EUR",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv) });
    expect(result.ledgerRows[0].envelopeCashAmount).toBeCloseTo(-12, 6);
    expect(result.ledgerRows[0].status).not.toBe("BLOCKED");
  });

  it("distingue un ZÉRO EXPLICITE d'une cellule vide", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut;Frais;Devise",
      "15/03/2026;Achat;FR0000120073;10;1705,00;0;EUR",
      "16/03/2026;Achat;FR0000120073;10;1705,00;;EUR",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv) });
    // Zéro déclaré est une information ; une cellule vide n'en est pas une.
    expect(result.ledgerRows[0].feeAmount).toBe(0);
    expect(result.ledgerRows[1].feeAmount).toBeNull();
  });

  it("ignore une ligne vide sans la compter comme un zéro", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut;Devise",
      "15/03/2026;Achat;FR0000120073;10;1705,00;EUR",
      ";;;;;",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv) });
    expect(result.ledgerRows[1].status).toBe("IGNORED");
    expect(result.counts.ignored).toBe(1);
  });

  it("bloque un achat sans quantité plutôt que de la déduire du montant", () => {
    // Déduire la quantité de montant / prix mêlerait les frais au prix unitaire.
    const csv = [
      "Date;Type;ISIN;Cours;Montant brut;Devise",
      "15/03/2026;Achat;FR0000120073;170,50;1709,90;EUR",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv) });
    expect(result.ledgerRows[0].status).toBe("BLOCKED");
    expect(
      result.ledgerRows[0].issues.some((entry) => entry.message.includes("les frais s'y mêlent")),
    ).toBe(true);
  });

  it("bloque un apport porteur d'un instrument", () => {
    const csv = [
      "Date;Type;ISIN;Montant brut;Devise",
      "01/04/2026;Versement;FR0000120073;500,00;EUR",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv) });
    expect(result.ledgerRows[0].status).toBe("BLOCKED");
  });

  it("bloque un achat sans instrument", () => {
    const csv = ["Date;Type;Quantité;Montant brut;Devise", "15/03/2026;Achat;10;1705,00;EUR"].join(
      "\n",
    );
    const result = analyze({ bytes: csvBytes(csv) });
    expect(result.ledgerRows[0].status).toBe("BLOCKED");
  });
});

describe("devises", () => {
  it("refuse une ligne sans devise et sans devise déclarée", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut",
      "15/03/2026;Achat;FR0000120073;10;1705,00",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv), declaredCurrency: null });
    expect(result.ledgerRows[0].status).toBe("BLOCKED");
    expect(result.ledgerRows[0].issues.some((entry) => entry.code === "CURRENCY_MISSING")).toBe(
      true,
    );
  });

  it("signale le repli sur la devise déclarée : c'est une hypothèse, pas une lecture", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut",
      "15/03/2026;Achat;FR0000120073;10;1705,00",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv), declaredCurrency: "EUR" });
    expect(result.ledgerRows[0].currency).toBe("EUR");
    expect(
      result.ledgerRows[0].issues.some(
        (entry) => entry.code === "CURRENCY_FROM_SESSION_DECLARATION",
      ),
    ).toBe(true);
  });

  it("refuse une devise non reconnue au lieu de la remplacer", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut;Devise",
      "15/03/2026;Achat;FR0000120073;10;1705,00;XYZW",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv), declaredCurrency: "EUR" });
    expect(result.ledgerRows[0].currency).toBeNull();
    expect(result.ledgerRows[0].status).toBe("BLOCKED");
  });

  it("conserve des devises MIXTES sans les additionner", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut;Devise",
      "15/03/2026;Achat;FR0000120073;10;1705,00;EUR",
      "16/03/2026;Achat;US5949181045;5;2051,25;USD",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv) });
    expect(result.ledgerRows.map((row) => row.currency)).toEqual(["EUR", "USD"]);
    // Aucune somme n'est produite par l'acquisition : elle ne calcule pas de finance.
    expect(result).not.toHaveProperty("total");
  });
});

describe("colonnes", () => {
  it("signale une colonne requise absente sans rien inventer", () => {
    const csv = ["ISIN;Quantité;Montant brut;Devise", "FR0000120073;10;1705,00;EUR"].join("\n");
    const result = analyze({ bytes: csvBytes(csv) });
    expect(result.issues.some((entry) => entry.code === "MAPPING_REQUIRED_FIELD_MISSING")).toBe(
      true,
    );
  });

  it("signale une colonne supplémentaire sans la rattacher au champ le plus proche", () => {
    const csv = [
      "Date;Type;ISIN;Quantité;Montant brut;Devise;Colonne maison",
      "15/03/2026;Achat;FR0000120073;10;1705,00;EUR;peu importe",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv) });
    expect(result.issues.some((entry) => entry.code === "MAPPING_UNKNOWN_COLUMN")).toBe(true);
    expect(result.ledgerRows[0].status).toBe("READY");
  });

  it("respecte un mapping fourni par l'utilisateur", () => {
    const csv = ["c0;c1;c2;c3;c4", "15/03/2026;Achat;FR0000120073;10;EUR"].join("\n");
    const result = analyze({
      bytes: csvBytes(csv),
      mapping: { eventDate: 0, eventType: 1, isin: 2, quantity: 3, currency: 4 },
    });
    expect(result.ledgerRows[0].eventType).toBe("BUY");
    expect(result.ledgerRows[0].eventDate).toBe("2026-03-15");
  });

  it("refuse un mapping qui affecte deux champs à la même colonne", () => {
    const csv = ["c0;c1", "15/03/2026;Achat"].join("\n");
    const result = analyze({
      bytes: csvBytes(csv),
      mapping: { eventDate: 0, eventType: 0 },
    });
    expect(result.issues.some((entry) => entry.code === "MAPPING_DUPLICATE_COLUMN")).toBe(true);
  });
});

describe("import XLSX", () => {
  it("lit un classeur et décode une date sérielle", () => {
    const result = analyze({ bytes: ledgerWorkbookBytes(), fileName: "ops.xlsx" });
    expect(result.format).toBe("XLSX");
    expect(result.sheetName).toBe("Operations");
    expect(result.ledgerRows).toHaveLength(1);
    expect(result.ledgerRows[0].eventDate).toBe("2026-03-15");
    expect(result.ledgerRows[0].quantity).toBe(10);
  });

  it("marque les cellules issues d'une FORMULE, sans l'évaluer", () => {
    const workbook = buildWorkbook({
      sheetName: "Operations",
      rows: [
        [
          { ref: "A1", type: "inlineStr", value: "Date" },
          { ref: "B1", type: "inlineStr", value: "Type" },
          { ref: "C1", type: "inlineStr", value: "ISIN" },
          { ref: "D1", type: "inlineStr", value: "Quantité" },
          { ref: "E1", type: "inlineStr", value: "Montant brut" },
          { ref: "F1", type: "inlineStr", value: "Devise" },
        ],
        [
          { ref: "A2", type: "inlineStr", value: "2026-03-15" },
          { ref: "B2", type: "inlineStr", value: "Achat" },
          { ref: "C2", type: "inlineStr", value: "FR0000120073" },
          { ref: "D2", value: "10" },
          { ref: "E2", value: "1705", formula: "D2*170.5" },
          { ref: "F2", type: "inlineStr", value: "EUR" },
        ],
      ],
    });
    const result = analyze({ bytes: workbook, fileName: "ops.xlsx" });
    expect(result.formulaCells).toContain("E2");
    expect(result.ledgerRows[0].grossAmount).toBeCloseTo(1705, 6);
  });

  it("refuse un classeur porteur de macros", () => {
    const workbook = buildWorkbook({
      rows: [[{ ref: "A1", type: "inlineStr", value: "Date" }]],
      withMacro: true,
    });
    const result = analyze({ bytes: workbook, fileName: "ops.xlsm" });
    expect(result.ledgerRows).toHaveLength(0);
    expect(result.issues.some((entry) => entry.severity === "ERROR")).toBe(true);
  });

  it("dit quelles feuilles n'ont PAS été lues", () => {
    const workbook = buildWorkbook({
      sheetName: "Operations",
      rows: [
        [{ ref: "A1", type: "inlineStr", value: "Date" }],
        [{ ref: "A2", type: "inlineStr", value: "2026-03-15" }],
      ],
      extraSheets: 2,
    });
    const result = analyze({ bytes: workbook, fileName: "ops.xlsx" });
    expect(result.otherSheets).toEqual(["Extra0", "Extra1"]);
    expect(result.issues.some((entry) => entry.message.includes("ne le sont PAS"))).toBe(true);
  });
});

describe("plafonds", () => {
  it("refuse un fichier surdimensionné plutôt que de le tronquer", () => {
    const lines = ["Date;Type;ISIN;Quantité;Montant brut;Devise"];
    for (let index = 0; index < MAX_PORTFOLIO_ROWS + 5; index += 1) {
      lines.push(`15/03/2026;Achat;FR0000120073;1;10,00;EUR`);
    }
    const result = analyze({ bytes: csvBytes(lines.join("\n")) });
    expect(result.issues.some((entry) => entry.code === "FILE_TOO_MANY_ROWS")).toBe(true);
  });
});

describe("import de positions", () => {
  it("lit les positions observées avec leur coût de revient, ou son absence", () => {
    const result = analyze({
      bytes: csvBytes(POSITION_CSV),
      kind: "PORTFOLIO_POSITION",
      declaredCurrency: null,
    });
    expect(result.positionRows).toHaveLength(2);
    expect(result.positionRows[0].asOfDate).toBe("2026-06-30");
    expect(result.positionRows[0].marketValue).toBeCloseTo(1750, 6);
    expect(result.positionRows[0].costBasis).toBeCloseTo(1709.9, 6);
    // Coût de revient absent : INCONNU, et non nul.
    expect(result.positionRows[1].costBasis).toBeNull();
    expect(result.positionRows[1].status).not.toBe("BLOCKED");
  });

  it("bloque une position sans valeur de marché", () => {
    const csv = [
      "Date d'arrêté;ISIN;Quantité;Valorisation;Devise",
      "30/06/2026;FR0000120073;10;;EUR",
    ].join("\n");
    const result = analyze({ bytes: csvBytes(csv), kind: "PORTFOLIO_POSITION" });
    expect(result.positionRows[0].status).toBe("BLOCKED");
    expect(result.positionRows[0].marketValue).toBeNull();
  });

  it("NE PRODUIT AUCUN ÉVÉNEMENT depuis un relevé de positions", () => {
    // POSITION OBSERVÉE ≠ TRANSACTION : reconstruire un achat inventerait date, prix et frais.
    const result = analyze({ bytes: csvBytes(POSITION_CSV), kind: "PORTFOLIO_POSITION" });
    expect(result.ledgerRows).toHaveLength(0);
  });

  it("ne produit aucune position depuis un fichier de ledger", () => {
    const result = analyze();
    expect(result.positionRows).toHaveLength(0);
  });
});
