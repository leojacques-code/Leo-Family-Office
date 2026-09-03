import { describe, expect, it } from "vitest";

import {
  boundingBoxOf,
  foldLabel,
  lineTokens,
  pageLines,
  type PdfPage,
  type PdfTextItem,
} from "@/lib/acquisition/documents/text-layer";
import {
  codeColumns,
  extractLiasseFields,
  valueColumns,
} from "@/lib/acquisition/documents/liasse/extract";
import { LETTER_CODE_PATTERN } from "@/lib/acquisition/documents/liasse/spec";

/**
 * Ces cas de mise en page n'existent dans aucun fichier d'exemple : une colonne décalée, un
 * code sans valeur, une ligne dont la ligne de base est légèrement irrégulière. C'est
 * exactement ce que la séparation entre l'adaptateur PDF et la couche texte permet de tester.
 */

function item(text: string, x: number, y: number, width = 30, fontSize = 9): PdfTextItem {
  return { text, x, y, width, height: fontSize, fontSize };
}

function page(items: PdfTextItem[], height = 842): PdfPage {
  return { pageNumber: 1, width: 595, height, items };
}

describe("regroupement en lignes", () => {
  it("lit du HAUT vers le BAS, malgré le repère PDF inversé", () => {
    const lines = pageLines(
      page([item("bas", 40, 100), item("haut", 40, 700), item("milieu", 40, 400)]),
    );
    expect(lines.map((line) => line.text)).toEqual(["haut", "milieu", "bas"]);
  });

  it("tolère une ligne de base légèrement irrégulière", () => {
    const lines = pageLines(page([item("A", 40, 500), item("B", 100, 501.8)]));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("A B");
  });

  it("sépare deux lignes réellement distinctes", () => {
    const lines = pageLines(page([item("A", 40, 500), item("B", 40, 490)]));
    expect(lines).toHaveLength(2);
  });

  it("ignore les fragments blancs", () => {
    const lines = pageLines(page([item("A", 40, 500), item("   ", 80, 500)]));
    expect(lines[0].text).toBe("A");
  });
});

describe("recomposition des jetons", () => {
  it("recompose un nombre découpé par le PDF", () => {
    // Sans recomposition, « 1 » et « 234 » seraient deux nombres, et un million deviendrait un.
    const lines = pageLines(page([item("1", 300, 500, 5), item("234", 305.5, 500, 15)]));
    const tokens = lineTokens(lines[0]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].text).toBe("1234");
  });

  it("ne recompose PAS deux jetons franchement séparés", () => {
    const lines = pageLines(page([item("AB", 250, 500, 12), item("12000", 300, 500, 25)]));
    expect(lineTokens(lines[0]).map((token) => token.text)).toEqual(["AB", "12000"]);
  });
});

describe("normalisation d'un libellé", () => {
  it("ramène accents, casse, apostrophes et espaces à une forme unique", () => {
    expect(foldLabel("TOTAL GÉNÉRAL")).toBe("TOTAL GENERAL");
    expect(foldLabel("Résultat  de   l’exercice")).toBe("RESULTAT DE L'EXERCICE");
    expect(foldLabel(" Créances – clients ")).toBe("CREANCES - CLIENTS");
  });
});

describe("cadre englobant", () => {
  it("couvre l'union des jetons", () => {
    const box = boundingBoxOf([
      { text: "A", x: 10, y: 20, width: 5, height: 9, fontSize: 9 },
      { text: "B", x: 30, y: 22, width: 5, height: 9, fontSize: 9 },
    ]);
    expect(box).toEqual({ x: 10, y: 20, width: 25, height: 11 });
  });

  it("rend null sur un ensemble vide plutôt qu'un cadre de taille nulle", () => {
    expect(boundingBoxOf([])).toBeNull();
  });
});

describe("colonnes de codes", () => {
  it("retient une colonne assez peuplée, et rejette une coïncidence", () => {
    const items = [
      // Trois codes alignés : c'est une colonne.
      item("AB", 250, 700, 12),
      item("AC", 250, 680, 12),
      item("AD", 250, 660, 12),
      // Un mot de deux capitales isolé dans un libellé : ce n'en est pas une.
      item("ET", 60, 640, 12),
    ];
    const columns = codeColumns(page(items), [LETTER_CODE_PATTERN]);
    expect(columns).toHaveLength(1);
    expect(columns[0]).toBeCloseTo(250, 3);
  });

  it("ne retient AUCUNE colonne sur une page sans codes alignés", () => {
    expect(
      codeColumns(page([item("ET", 60, 700), item("DE", 120, 680)]), [LETTER_CODE_PATTERN]),
    ).toHaveLength(0);
  });
});

describe("en-têtes de colonnes de valeurs", () => {
  it("ne les cherche que dans le tiers supérieur de la page", () => {
    const upper = valueColumns(page([item("Brut", 300, 760, 18), item("Net", 490, 760, 15)]));
    expect(upper.map((column) => column.part)).toEqual(["GROSS", "NET"]);

    // Le mot « Net » réapparaît dans le corps du tableau : le prendre pour un en-tête
    // déplacerait la colonne.
    const lower = valueColumns(page([item("Net", 100, 300, 15)]));
    expect(lower).toEqual([]);
  });
});

describe("extraction sans en-têtes de colonnes", () => {
  it("lit les cases mais n'attribue AUCUNE colonne : il n'y a pas de colonne par défaut", () => {
    const items = [
      item("Poste un", 40, 700, 50),
      item("AB", 250, 700, 12),
      item("100", 300, 700, 20),
      item("Poste deux", 40, 680, 50),
      item("AC", 250, 680, 12),
      item("200", 300, 680, 20),
      item("Poste trois", 40, 660, 50),
      item("AD", 250, 660, 12),
      item("300", 300, 660, 20),
    ];
    const result = extractLiasseFields({
      layer: { pages: [page(items)], charCount: 200 },
      formByPage: new Map([[1, "2050"]]),
      regime: "LIASSE_2050",
    });
    expect(result.fields).toHaveLength(3);
    for (const field of result.fields) {
      expect(field.formPart).toBeNull();
      // Sans colonne attribuée, la confiance ne peut pas être haute.
      expect(field.confidence).toBe("MEDIUM");
    }
    expect(result.issues.map((issue) => issue.code)).toContain("COLUMN_HEADERS_NOT_FOUND");
  });

  it("marque UNKNOWN_BOX quand le formulaire n'est pas reconnu", () => {
    const items = [
      item("Poste un", 40, 700, 50),
      item("AB", 250, 700, 12),
      item("100", 300, 700, 20),
      item("Poste deux", 40, 680, 50),
      item("AC", 250, 680, 12),
      item("200", 300, 680, 20),
      item("Poste trois", 40, 660, 50),
      item("AD", 250, 660, 12),
      item("300", 300, 660, 20),
    ];
    const result = extractLiasseFields({
      layer: { pages: [page(items)], charCount: 200 },
      // Aucun formulaire reconnu pour cette page.
      formByPage: new Map(),
      regime: null,
    });
    expect(result.fields.every((field) => field.validationStatus === "UNKNOWN_BOX")).toBe(true);
    // Les valeurs restent LUES : une case dont on ignore le formulaire n'est pas une case perdue.
    expect(result.fields.map((field) => field.normalizedValue)).toEqual([100, 200, 300]);
  });
});

describe("codes répétés", () => {
  it("conserve chaque occurrence plutôt que d'en écraser une", () => {
    const items = [
      item("Ligne A", 40, 700, 40),
      item("AB", 250, 700, 12),
      item("100", 300, 700, 20),
      item("Ligne B", 40, 680, 40),
      item("AB", 250, 680, 12),
      item("200", 300, 680, 20),
      item("Ligne C", 40, 660, 40),
      item("AB", 250, 660, 12),
      item("300", 300, 660, 20),
    ];
    const result = extractLiasseFields({
      layer: { pages: [page(items)], charCount: 200 },
      formByPage: new Map([[1, "2050"]]),
      regime: "LIASSE_2050",
    });
    expect(result.fields.map((field) => field.occurrence)).toEqual([0, 1, 2]);
    expect(result.fields.map((field) => field.normalizedValue)).toEqual([100, 200, 300]);
    expect(result.fields[1].issues.map((issue) => issue.code)).toContain("BOX_DUPLICATE_CODE");
  });
});
