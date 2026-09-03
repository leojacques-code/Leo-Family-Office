import { describe, expect, it } from "vitest";

import { openZip } from "@/lib/acquisition/xlsx/zip";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  readWorkbook,
  serialToIsoDate,
} from "@/lib/acquisition/xlsx/workbook";
import { buildWorkbook, buildZip } from "./fixtures/xlsx-builder";

describe("archive ZIP", () => {
  it("ouvre une entrée compressée et une entrée stockée", () => {
    const archive = openZip(
      buildZip([
        { name: "a.txt", content: "compressé" },
        { name: "b.txt", content: "stocké", deflate: false },
      ]),
    );
    expect(archive.ok).toBe(true);
    if (archive.ok) {
      expect(new TextDecoder().decode(archive.entries.get("a.txt")!.bytes)).toBe("compressé");
      expect(new TextDecoder().decode(archive.entries.get("b.txt")!.bytes)).toBe("stocké");
    }
  });

  it("refuse ce qui n'est pas une archive", () => {
    const archive = openZip(new TextEncoder().encode("libellé;montant\nCafé;-3,50\n"));
    expect(archive.ok).toBe(false);
    if (!archive.ok) expect(archive.code).toBe("NOT_A_ZIP");
  });
});

describe("lecture d'un classeur", () => {
  it("lit des chaînes partagées, du texte en ligne et des nombres", () => {
    const result = readWorkbook(
      buildWorkbook({
        sharedStrings: ["ISIN", "Quantité"],
        rows: [
          [
            { ref: "A1", type: "s", value: "0" },
            { ref: "B1", type: "s", value: "1" },
          ],
          [
            { ref: "A2", type: "inlineStr", value: "FR0000120271" },
            { ref: "B2", value: "12.5" },
          ],
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheets[0].rows[0]).toEqual(["ISIN", "Quantité"]);
      expect(result.sheets[0].rows[1]).toEqual(["FR0000120271", "12.5"]);
    }
  });

  it("N'ÉVALUE PAS une formule : elle lit la valeur en cache et le SIGNALE", () => {
    const result = readWorkbook(
      buildWorkbook({
        rows: [[{ ref: "A1", value: "300", formula: "SUM(B1:B3)" }]],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheets[0].rows[0][0]).toBe("300");
      // La cellule est marquée comme dérivée : une valeur en cache n'est pas une saisie.
      expect(result.sheets[0].formulaCells).toContain("A1");
      expect(result.issues.map((issue) => issue.code)).toContain("FORMULA_CACHED_VALUE");
    }
  });

  it("ne produit RIEN pour une formule sans valeur en cache", () => {
    // L'évaluer reviendrait à écrire un moteur de tableur, donc à inventer un chiffre.
    const result = readWorkbook(buildWorkbook({ rows: [[{ ref: "A1", formula: "SUM(B1:B3)" }]] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheets[0].rows[0][0]).toBe("");
      const issue = result.issues.find((entry) => entry.code === "FORMULA_WITHOUT_VALUE");
      expect(issue?.severity).toBe("ERROR");
    }
  });

  it("REFUSE un classeur porteur de macros au lieu de le lire à moitié", () => {
    const result = readWorkbook(
      buildWorkbook({ rows: [[{ ref: "A1", value: "1" }]], withMacro: true }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MACRO_ENABLED");
      expect(result.message).toContain("aucune macro n'est exécutée");
    }
  });

  it("refuse un classeur chiffré", () => {
    const result = readWorkbook(
      buildWorkbook({ rows: [[{ ref: "A1", value: "1" }]], encrypted: true }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ENCRYPTED");
  });

  it("signale un lien externe sans le suivre", () => {
    const result = readWorkbook(
      buildWorkbook({ rows: [[{ ref: "A1", value: "1" }]], withExternalLink: true }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issue = result.issues.find((entry) => entry.code === "EXTERNAL_LINK");
      expect(issue?.message).toContain("Aucun lien externe n'est suivi");
    }
  });

  it("ne tire aucune valeur d'une cellule en erreur", () => {
    const result = readWorkbook(
      buildWorkbook({ rows: [[{ ref: "A1", type: "e", value: "#REF!" }]] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheets[0].rows[0][0]).toBe("");
      expect(result.issues.map((issue) => issue.code)).toContain("ERROR_CELL");
    }
  });

  it("laisse une cellule vide quand l'index de chaîne partagée est hors bornes", () => {
    const result = readWorkbook(
      buildWorkbook({ sharedStrings: ["seule"], rows: [[{ ref: "A1", type: "s", value: "7" }]] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheets[0].rows[0][0]).toBe("");
      expect(result.issues.map((issue) => issue.code)).toContain("SHARED_STRING_MISSING");
    }
  });

  it("comble les colonnes manquantes par des cellules VIDES, jamais par des zéros", () => {
    const result = readWorkbook(
      buildWorkbook({
        rows: [
          [
            { ref: "A1", value: "1" },
            // Pas de B1 : le trou doit rester un trou.
            { ref: "C1", value: "3" },
          ],
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sheets[0].rows[0]).toEqual(["1", "", "3"]);
  });

  it("refuse un classeur au-delà du plafond de lignes, sans le tronquer", () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, index) => [
      { ref: `A${index + 1}`, value: String(index) },
    ]);
    const result = readWorkbook(buildWorkbook({ rows }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TOO_MANY_ROWS");
      expect(result.message).toContain("jamais tronqué");
    }
  });

  it("refuse une colonne au-delà du plafond", () => {
    // Colonne au-delà de MAX_COLUMNS : « ZZ » vaut 701, bien au-delà de 256.
    const result = readWorkbook(buildWorkbook({ rows: [[{ ref: "ZZ1", value: "1" }]] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TOO_MANY_COLUMNS");
    expect(MAX_COLUMNS).toBeLessThan(701);
  });

  it("refuse une archive qui n'est pas un classeur", () => {
    const result = readWorkbook(buildZip([{ name: "hello.txt", content: "coucou" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_A_WORKBOOK");
  });
});

describe("décodage des dates de tableur", () => {
  it("décode un numéro de série en époque 1900, bug du 29 février compris", () => {
    // 1 → 1900-01-01 ; 60 est le faux 29 février 1900 ; 61 → 1900-03-01.
    expect(serialToIsoDate(1, false)).toBe("1900-01-01");
    expect(serialToIsoDate(61, false)).toBe("1900-03-01");
    // Sans la correction, cette date serait décalée d'un jour.
    expect(serialToIsoDate(45_000, false)).toBe("2023-03-15");
  });

  it("décode en époque 1904 quand le classeur la déclare", () => {
    expect(serialToIsoDate(0, true)).toBe("1903-12-31");
    expect(serialToIsoDate(1, true)).toBe("1904-01-01");
  });

  it("rend null hors des bornes plausibles plutôt qu'une date absurde", () => {
    expect(serialToIsoDate(-5, false)).toBeNull();
    expect(serialToIsoDate(0, false)).toBeNull();
    expect(serialToIsoDate(5_000_000, false)).toBeNull();
    expect(serialToIsoDate(Number.NaN, false)).toBeNull();
  });

  it("décode une cellule datée du classeur et le signale", () => {
    const result = readWorkbook(
      buildWorkbook({
        dateStyleIndexes: [1],
        rows: [[{ ref: "A1", value: "45000", style: 1 }]],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheets[0].rows[0][0]).toBe("2023-03-15");
      expect(result.issues.map((issue) => issue.code)).toContain("DATE_SERIAL_DECODED");
    }
  });

  it("laisse un nombre non daté tel quel", () => {
    const result = readWorkbook(buildWorkbook({ rows: [[{ ref: "A1", value: "45000" }]] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sheets[0].rows[0][0]).toBe("45000");
  });
});

describe("budget global de décompression", () => {
  it("REFUSE une archive dont le total décompressé dépasse le budget, plutôt que de la lire à moitié", () => {
    // Le plafond PAR ENTRÉE ne voyait pas passer ce cas : avec 4 096 entrées à 64 Mio, une
    // archive de quelques kilo-octets pouvait réclamer 256 Gio. Le budget est global, et il
    // refuse — une lecture partielle tairait des feuilles.
    const filler = "x".repeat(2 * 1024 * 1024);
    const entries = Array.from({ length: 40 }, (_unused, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: filler,
    }));
    const result = readWorkbook(buildZip(entries));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TOTAL_TOO_LARGE");
      expect(result.message).toContain("Budget global");
    }
  });

  it("laisse passer un classeur normal : le budget borne, il n'interdit pas", () => {
    const result = readWorkbook(
      buildWorkbook({
        rows: [[{ ref: "A1", value: "A" }], [{ ref: "A2", value: "1" }]],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("relations du classeur", () => {
  it("ne suit PAS une relation externe", () => {
    const bytes = buildWorkbook({
      rows: [[{ ref: "A1", value: "A" }], [{ ref: "A2", value: "1" }]],
      externalRelationships: [
        '<Relationship Id="rIdX" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="https://exemple.test/feuille.xml" TargetMode="External"/>',
      ],
    });
    const result = readWorkbook(bytes);
    expect(result.ok).toBe(true);
    // La feuille légitime est lue, et la relation externe n'a produit aucune feuille de plus.
    if (result.ok) expect(result.sheets).toHaveLength(1);
  });

  it("ne suit PAS une relation qui sort de `xl/worksheets/`", () => {
    const bytes = buildWorkbook({
      rows: [[{ ref: "A1", value: "A" }], [{ ref: "A2", value: "1" }]],
      externalRelationships: [
        '<Relationship Id="rIdY" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../../../etc/passwd"/>',
        '<Relationship Id="rIdZ" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/externalLinks/externalLink1.xml"/>',
      ],
    });
    const result = readWorkbook(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sheets).toHaveLength(1);
  });

  it("ne suit PAS une relation d'un AUTRE type, même vers `worksheets/`", () => {
    const bytes = buildWorkbook({
      rows: [[{ ref: "A1", value: "A" }], [{ ref: "A2", value: "1" }]],
      externalRelationships: [
        '<Relationship Id="rIdW" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="worksheets/sheet9.xml"/>',
      ],
    });
    const result = readWorkbook(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sheets).toHaveLength(1);
  });
});
