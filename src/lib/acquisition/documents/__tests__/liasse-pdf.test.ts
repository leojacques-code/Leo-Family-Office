import { describe, expect, it } from "vitest";

import { extractPdfTextLayer } from "@/lib/acquisition/documents/pdf-extract";
import { readLiasse } from "@/lib/acquisition/documents/liasse";
import {
  buildAmbiguousConventionLiassePdf,
  buildCoherentLiassePdf,
  buildUnbalancedLiassePdf,
  FIXTURE_SIREN,
} from "./fixtures/liasse";
import { buildImageOnlyPdf, buildPdf } from "./fixtures/pdf-builder";

/**
 * Ces tests parcourent la chaîne COMPLÈTE : octets d'un PDF réel → couche texte → détection →
 * cases → contrôles. C'est le seul niveau où l'on peut affirmer que l'extraction fonctionne :
 * une couche texte synthétique éprouve la logique, elle ne prouve rien sur le décodage.
 */

async function read(bytes: Uint8Array) {
  const extraction = await extractPdfTextLayer(bytes);
  return readLiasse({
    layer: extraction.layer,
    pdfKind: extraction.pdfKind,
    pageCount: extraction.pageCount,
    issues: extraction.issues,
  });
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("lecture d'une liasse cohérente", () => {
  it("reconnaît chaque formulaire par son CONTENU, et conserve la preuve", async () => {
    const reading = await read(buildCoherentLiassePdf());
    expect(reading.pdfKind).toBe("NATIVE_TEXT");
    expect(reading.status).toBe("EXTRACTED");
    expect(reading.detectedKind).toBe("LIASSE_2050");
    expect(reading.detectionBasis.map((item) => item.kind)).toEqual([
      "2050",
      "2051",
      "2052",
      "2053",
    ]);
    // La preuve est la chaîne réellement trouvée, page par page.
    expect(reading.detectionBasis[0]).toMatchObject({ page: 1, matched: "2050" });
  });

  it("lit le SIREN et les DEUX bornes de l'exercice", async () => {
    const reading = await read(buildCoherentLiassePdf());
    expect(reading.siren).toBe(FIXTURE_SIREN);
    expect(reading.fiscalYearStart).toBe("2025-01-01");
    expect(reading.fiscalYearEnd).toBe("2025-12-31");
    expect(reading.detectedVariant).toBe("2025");
  });

  it("attribue chaque case à sa colonne, d'après les en-têtes imprimés", async () => {
    const reading = await read(buildCoherentLiassePdf());
    const total = reading.fields.filter(
      (field) => field.formCode === "2050" && ["CO", "CP", "CQ"].includes(field.boxCode),
    );
    expect(total).toHaveLength(3);
    expect(total.find((field) => field.boxCode === "CO")).toMatchObject({
      formPart: "GROSS",
      normalizedValue: 470_000,
    });
    expect(total.find((field) => field.boxCode === "CP")).toMatchObject({
      formPart: "DEPRECIATION",
      normalizedValue: 120_000,
    });
    expect(total.find((field) => field.boxCode === "CQ")).toMatchObject({
      formPart: "NET",
      normalizedValue: 350_000,
    });
  });

  it("conserve la valeur BRUTE telle qu'imprimée, séparateurs compris", async () => {
    const reading = await read(buildCoherentLiassePdf());
    const gross = reading.fields.find((field) => field.boxCode === "CO");
    expect(gross?.rawValue).toBe("470 000");
    expect(gross?.normalizedValue).toBe(470_000);
  });

  it("localise chaque case : un cadre complet, jamais partiel", async () => {
    const reading = await read(buildCoherentLiassePdf());
    for (const field of reading.fields) {
      expect(field.bbox).not.toBeNull();
      expect(field.bbox?.width).toBeGreaterThan(0);
      expect(field.bbox?.height).toBeGreaterThan(0);
    }
  });

  it("lit une case BLANCHE comme une absence, jamais comme un zéro", async () => {
    const reading = await read(buildCoherentLiassePdf());
    const empty = reading.fields.find((field) => field.boxCode === "BY");
    expect(empty).toBeDefined();
    expect(empty?.rawValue).toBeNull();
    expect(empty?.normalizedValue).toBeNull();
    expect(codes(empty?.issues ?? [])).toContain("BOX_WITHOUT_VALUE");
  });

  it("restitue les accents d'un libellé", async () => {
    const reading = await read(buildCoherentLiassePdf());
    const labels = reading.fields.map((field) => field.label ?? "");
    expect(labels).toContain("Clients et comptes rattachés");
    expect(labels).toContain("TOTAL GÉNÉRAL");
  });

  it("ne lit AUCUN mot de libellé comme un code de case", async () => {
    const reading = await read(buildCoherentLiassePdf());
    const read2050 = reading.fields.filter((field) => field.formCode === "2050");
    expect(read2050.map((field) => field.boxCode).sort()).toEqual(
      ["AB", "AC", "AD", "AN", "AO", "AP", "BX", "BY", "BZ", "CO", "CP", "CQ"].sort(),
    );
  });

  it("résout les contrôles sur des codes RÉELLEMENT lus", async () => {
    const reading = await read(buildCoherentLiassePdf());
    const balance = reading.checks.find((check) => check.checkCode === "BALANCE_SHEET_EQUALITY");
    expect(balance).toBeDefined();
    expect(balance?.unresolved).toEqual([]);
    expect(balance?.left).toEqual(["CQ"]);
    expect(balance?.right).toEqual(["EE"]);
    expect(balance?.severity).toBe("BLOCKING");

    const columns = reading.checks.find((check) => check.checkCode === "ACTIF_COLUMNS_CONSISTENCY");
    expect(columns?.left).toEqual(["CO"]);
    expect(columns?.right).toEqual(["CQ", "CP"]);

    const result = reading.checks.find((check) => check.checkCode === "RESULT_CONSISTENCY");
    expect(result?.left).toEqual(["HN"]);
    expect(result?.right).toEqual(["DL"]);
  });

  it("propose UNIQUEMENT les postes que le document imprime en clair", async () => {
    const reading = await read(buildCoherentLiassePdf());
    expect(reading.financials.revenue).toMatchObject({ value: 900_000, boxCode: "FL" });
    expect(reading.financials.netIncome).toMatchObject({ value: 20_000, boxCode: "HN" });
    // Aucun EBITDA, aucun EBIT : ce sont des conventions, pas des lignes de liasse.
    expect(Object.keys(reading.financials)).toEqual(["revenue", "netIncome", "issues"]);
  });
});

describe("liasse déséquilibrée", () => {
  it("résout le contrôle bloquant, dont le verdict sera rendu en base", async () => {
    const reading = await read(buildUnbalancedLiassePdf());
    const balance = reading.checks.find((check) => check.checkCode === "BALANCE_SHEET_EQUALITY");
    // La lecture ne juge pas : elle désigne les cases. L'arithmétique est faite sur les cases
    // PERSISTÉES, pour qu'une charge forgée ne puisse pas déclarer un bilan équilibré.
    expect(balance?.unresolved).toEqual([]);
    const passifTotal = reading.fields.find(
      (field) => field.formCode === "2051" && field.boxCode === "EE",
    );
    const actifNet = reading.fields.find(
      (field) => field.formCode === "2050" && field.boxCode === "CQ",
    );
    expect(passifTotal?.normalizedValue).toBe(360_000);
    expect(actifNet?.normalizedValue).toBe(350_000);
  });
});

describe("convention décimale contradictoire", () => {
  it("bloque les montants réellement ambigus et lit les autres", async () => {
    const reading = await read(buildAmbiguousConventionLiassePdf());
    expect(codes(reading.issues)).toContain("NUMBER_CONVENTION_CONFLICT");

    const ambiguous = reading.fields.find((field) => field.boxCode === "FC");
    expect(ambiguous?.normalizedValue).toBeNull();
    expect(ambiguous?.validationStatus).toBe("BLOCKED");
    expect(codes(ambiguous?.issues ?? [])).toContain("BOX_VALUE_AMBIGUOUS_CONVENTION");
    // La valeur imprimée reste conservée : c'est elle que l'utilisateur relira.
    expect(ambiguous?.rawValue).toBe("3,456");

    const unambiguous = reading.fields.find((field) => field.boxCode === "FD");
    expect(unambiguous?.normalizedValue).toBe(5_000);
    expect(unambiguous?.validationStatus).toBe("EXTRACTED");
  });
});

describe("document scanné", () => {
  it("rend OCR_REQUIRED sans déduire une seule valeur", async () => {
    const reading = await read(buildImageOnlyPdf(3));
    expect(reading.pdfKind).toBe("IMAGE_ONLY");
    expect(reading.status).toBe("OCR_REQUIRED");
    expect(reading.fields).toEqual([]);
    expect(reading.checks).toEqual([]);
    expect(reading.siren).toBeNull();
    expect(reading.fiscalYearEnd).toBeNull();
    expect(codes(reading.issues)).toContain("PDF_NO_TEXT_LAYER");
  });
});

describe("document illisible", () => {
  it("rend FAILED sur des octets qui ne sont pas un PDF", async () => {
    const reading = await read(new Uint8Array(Buffer.from("ceci n'est pas un PDF", "utf8")));
    expect(reading.pdfKind).toBe("UNREADABLE");
    expect(reading.status).toBe("FAILED");
    expect(reading.fields).toEqual([]);
  });

  it("rend UNREADABLE sur un fichier vide, sans lever", async () => {
    const reading = await read(new Uint8Array());
    expect(reading.pdfKind).toBe("UNREADABLE");
    expect(codes(reading.issues)).toContain("PDF_EMPTY");
  });
});

describe("document sans colonne de codes", () => {
  it("dit qu'aucune case n'a été lue, plutôt que de rendre une liasse vide", async () => {
    // Une plaquette : du texte, des chiffres, aucune colonne de codes de liasse.
    const bytes = buildPdf([
      {
        lines: [
          { x: 40, y: 800, text: "Rapport de gestion" },
          { x: 40, y: 780, text: "Le chiffre d'affaires s'établit à 900 000 euros." },
          { x: 40, y: 760, text: "Le résultat net ressort à 20 000 euros." },
        ],
      },
    ]);
    const reading = await read(bytes);
    expect(reading.fields).toEqual([]);
    expect(codes(reading.issues)).toContain("FORM_NOT_RECOGNISED");
  });
});
