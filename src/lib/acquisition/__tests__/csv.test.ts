import { describe, expect, it } from "vitest";

import { detectDelimiter, formatSignature, parseDelimited } from "@/lib/acquisition/csv";
import { largeStatement, QUOTED_LABEL } from "@/lib/acquisition/__tests__/fixtures/bank-csv";

const options = { maxRows: 20_000 };

describe("détection du séparateur", () => {
  it("reconnaît le point-virgule, la virgule et la tabulation", () => {
    expect(detectDelimiter("a;b;c\n1;2;3").delimiter).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3").delimiter).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3").delimiter).toBe("\t");
  });

  it("échoue explicitement quand aucun séparateur ne donne un nombre stable de colonnes", () => {
    const detected = detectDelimiter("une seule colonne\nsans separateur du tout");
    expect(detected.issues.map((entry) => entry.code)).toContain("DELIMITER_UNDETECTED");
  });

  it("signale une ambiguïté au lieu de trancher en silence", () => {
    const detected = detectDelimiter("a;b,c\n1;2,3");
    expect(detected.issues.map((entry) => entry.code)).toContain("DELIMITER_AMBIGUOUS");
  });

  it("un fichier vide est une erreur, pas zéro ligne", () => {
    expect(detectDelimiter("").issues.map((entry) => entry.code)).toContain("FILE_EMPTY");
    expect(parseDelimited("", ";", options).issues.map((entry) => entry.code)).toContain(
      "FILE_EMPTY",
    );
  });
});

describe("découpage", () => {
  it("respecte les guillemets et les guillemets doublés", () => {
    const document = parseDelimited(QUOTED_LABEL, ";", options);
    expect(document.rows[0].cells[1]).toBe("PAIEMENT ; BOUTIQUE");
    expect(document.rows[1].cells[1]).toBe('LIBELLE "CITE" INTERNE');
  });

  it("recolle un champ contenant un retour à la ligne", () => {
    const document = parseDelimited('a;b\n1;"deux\nlignes"\n2;x', ";", options);
    expect(document.rows).toHaveLength(2);
    expect(document.rows[0].cells[1]).toBe("deux\nlignes");
    expect(document.rows[1].rowNumber).toBe(4);
  });

  it("conserve le numéro de ligne du fichier, lignes vides comprises", () => {
    const document = parseDelimited("a;b\n1;x\n\n2;y", ";", options);
    expect(document.rows.map((row) => row.rowNumber)).toEqual([2, 3, 4]);
  });

  it("signale un nombre de colonnes incohérent", () => {
    const document = parseDelimited("a;b;c\n1;2\n3;4;5", ";", options);
    expect(document.issues.map((entry) => entry.code)).toContain("COLUMN_COUNT_MISMATCH");
  });

  it("signale un en-tête dupliqué", () => {
    const document = parseDelimited("Montant;Montant\n1;2", ";", options);
    expect(document.issues.map((entry) => entry.code)).toContain("HEADER_DUPLICATE");
  });

  it("refuse un fichier au-delà du plafond au lieu de le tronquer", () => {
    const document = parseDelimited(largeStatement(30), ";", { maxRows: 10 });
    expect(document.rows).toHaveLength(0);
    expect(document.issues.map((entry) => entry.code)).toContain("FILE_TOO_MANY_ROWS");
  });
});

describe("signature de format", () => {
  it("est stable à la casse et aux espaces, sensible aux colonnes et au séparateur", () => {
    expect(formatSignature(["Date", " Montant "], ";")).toBe(
      formatSignature(["DATE", "montant"], ";"),
    );
    expect(formatSignature(["Date", "Montant"], ";")).not.toBe(
      formatSignature(["Date", "Montant"], ","),
    );
    expect(formatSignature(["Date", "Montant"], ";")).not.toBe(
      formatSignature(["Date", "Montant", "Devise"], ";"),
    );
  });
});
