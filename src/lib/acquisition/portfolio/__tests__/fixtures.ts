/**
 * Fixtures d'import de portefeuille. Aucune ne provient d'un relevé personnel : elles sont
 * écrites ici, cas limite par cas limite, ce qui permet de décrire en trois lignes une
 * situation qu'aucun fichier d'exemple ne contiendrait.
 */

import {
  buildWorkbook,
  type CellInput,
} from "@/lib/acquisition/xlsx/__tests__/fixtures/xlsx-builder";
import type { KnownSecurity } from "@/lib/acquisition/portfolio/instruments";

export const KNOWN: KnownSecurity[] = [
  {
    securityId: "sec-air",
    name: "Air Liquide",
    isin: "FR0000120073",
    ticker: "AI",
    currency: "EUR",
  },
  {
    securityId: "sec-msft",
    name: "Microsoft",
    isin: "US5949181045",
    ticker: "MSFT",
    currency: "USD",
  },
  // Deux instruments portant le MÊME ticker : l'ambiguïté doit être refusée, pas arbitrée.
  {
    securityId: "sec-dup-a",
    name: "Alpha Fund A",
    isin: "LU0000000011",
    ticker: "ALP",
    currency: "EUR",
  },
  {
    securityId: "sec-dup-b",
    name: "Alpha Fund B",
    isin: "LU0000000029",
    ticker: "ALP",
    currency: "EUR",
  },
];

export function csvBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Ledger générique, séparateur point-virgule, décimales françaises. */
export const LEDGER_CSV_FR = [
  "Date;Type;ISIN;Libellé;Quantité;Cours;Montant brut;Frais;Devise;Référence",
  "15/03/2026;Achat;FR0000120073;Air Liquide;10;170,50;1705,00;4,90;EUR;ORD-1",
  "20/03/2026;Dividende;FR0000120073;Air Liquide;;;32,00;;EUR;DIV-1",
  "31/03/2026;Frais;;Droits de garde;;;12,00;;EUR;FEE-1",
  "01/04/2026;Versement;;Virement;;;500,00;;EUR;CTR-1",
].join("\n");

/** Le même contenu, colonnes PERMUTÉES : la lecture doit être identique. */
export const LEDGER_CSV_PERMUTED = [
  "Référence;Devise;Frais;Montant brut;Cours;Quantité;Libellé;ISIN;Type;Date",
  "ORD-1;EUR;4,90;1705,00;170,50;10;Air Liquide;FR0000120073;Achat;15/03/2026",
  "DIV-1;EUR;;32,00;;;Air Liquide;FR0000120073;Dividende;20/03/2026",
  "FEE-1;EUR;;12,00;;;Droits de garde;;Frais;31/03/2026",
  "CTR-1;EUR;;500,00;;;Virement;;Versement;01/04/2026",
].join("\n");

/** Décimales et dates internationales, virgule comme séparateur de colonnes. */
export const LEDGER_CSV_EN = [
  "Trade date,Transaction type,ISIN,Security,Quantity,Price,Gross amount,Fees,Currency",
  "2026-03-15,Buy,US5949181045,Microsoft,5,410.25,2051.25,1.00,USD",
  "2026-03-20,Dividend,US5949181045,Microsoft,,,15.00,,USD",
].join("\n");

/** Positions observées, avec un coût de revient absent sur la seconde ligne. */
export const POSITION_CSV = [
  "Date d'arrêté;ISIN;Libellé;Quantité;Valorisation;Prix de revient;Devise",
  "30/06/2026;FR0000120073;Air Liquide;10;1750,00;1709,90;EUR",
  "30/06/2026;US5949181045;Microsoft;5;2100,00;;USD",
].join("\n");

export function ledgerWorkbook(rows: CellInput[][]): Uint8Array {
  return buildWorkbook({ sheetName: "Operations", rows });
}

/** Classeur de ledger équivalent au CSV français, en chaînes en ligne. */
export function ledgerWorkbookBytes(): Uint8Array {
  const header = [
    "Date",
    "Type",
    "ISIN",
    "Libellé",
    "Quantité",
    "Cours",
    "Montant brut",
    "Frais",
    "Devise",
  ];
  const columns = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const rows: CellInput[][] = [
    header.map((value, index) => ({
      ref: `${columns[index]}1`,
      type: "inlineStr" as const,
      value,
    })),
    [
      { ref: "A2", value: "46096", style: 1 },
      { ref: "B2", type: "inlineStr", value: "Achat" },
      { ref: "C2", type: "inlineStr", value: "FR0000120073" },
      { ref: "D2", type: "inlineStr", value: "Air Liquide" },
      { ref: "E2", value: "10" },
      { ref: "F2", value: "170.5" },
      { ref: "G2", value: "1705" },
      { ref: "H2", value: "4.9" },
      { ref: "I2", type: "inlineStr", value: "EUR" },
    ],
  ];
  return buildWorkbook({ sheetName: "Operations", rows, dateStyleIndexes: [1] });
}
