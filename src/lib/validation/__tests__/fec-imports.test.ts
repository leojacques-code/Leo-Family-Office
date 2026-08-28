import { describe, expect, it } from "vitest";

import {
  fecAnalyzeSchema,
  fecCommandSchema,
  MAX_FEC_FILE_BYTES,
  MAX_RETAINED_FEC_FILE_BYTES,
} from "@/lib/validation/fec-imports";

/**
 * FRONTIÈRE DE CONFIANCE DE L'ACQUISITION COMPTABLE.
 *
 * Ce que le client peut dire, et rien de plus. Les montants d'un instantané financier ne
 * franchissent JAMAIS cette frontière : ils sont reconstruits côté serveur depuis les
 * écritures persistées. Un schéma permissif suffirait à écrire un chiffre d'affaires
 * qu'aucune écriture ne porte, et le fait canonique en porterait la trace comme s'il avait
 * été observé.
 */
const VALID_ANALYZE = {
  businessId: "11111111-1111-4111-8111-111111111111",
  currency: "eur",
  fiscalYearStart: "2025-01-01",
  fiscalYearEnd: "2025-12-31",
  coverageDeclared: true,
  retainFile: false,
};

describe("commande de validation · aucun montant financier n'est accepté", () => {
  it("accepte une commande minimale : une action, une session", () => {
    const parsed = fecCommandSchema.safeParse({
      action: "commit",
      sessionId: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed.success).toBe(true);
  });

  // Un par un : chaque montant du contrat Business doit être REFUSÉ, pas ignoré. Accepter
  // en silence une clé inconnue laisserait croire qu'elle a servi.
  for (const forged of [
    "financials",
    "revenue",
    "ebitda",
    "ebit",
    "netIncome",
    "cash",
    "debt",
    "grossDebt",
    "workingCapital",
    "taxExpense",
    "grossProfit",
    "periodEnd",
    "businessFinancialsId",
    "committedCount",
  ]) {
    it(`refuse une commande portant « ${forged} »`, () => {
      const parsed = fecCommandSchema.safeParse({
        action: "commit",
        sessionId: "22222222-2222-4222-8222-222222222222",
        [forged]: 999_999,
      });
      expect(parsed.success).toBe(false);
    });
  }

  it("refuse une commande d'abandon portant un montant", () => {
    const parsed = fecCommandSchema.safeParse({
      action: "discard",
      sessionId: "22222222-2222-4222-8222-222222222222",
      revenue: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("refuse une action inconnue", () => {
    const parsed = fecCommandSchema.safeParse({
      action: "write_financials",
      sessionId: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("paramètres d'analyse · déclarations, jamais de montants", () => {
  it("accepte une déclaration complète et normalise la devise", () => {
    const parsed = fecAnalyzeSchema.safeParse(VALID_ANALYZE);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.currency).toBe("EUR");
  });

  it("refuse tout montant financier glissé dans les paramètres d'analyse", () => {
    for (const forged of ["revenue", "ebitda", "cash", "financials"]) {
      const parsed = fecAnalyzeSchema.safeParse({ ...VALID_ANALYZE, [forged]: 42 });
      expect(parsed.success).toBe(false);
    }
  });

  it("refuse une couverture déclarée sans bornes d'exercice", () => {
    const parsed = fecAnalyzeSchema.safeParse({
      ...VALID_ANALYZE,
      coverageDeclared: true,
      fiscalYearStart: null,
      fiscalYearEnd: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepte une analyse sans couverture déclarée et sans exercice", () => {
    const parsed = fecAnalyzeSchema.safeParse({
      ...VALID_ANALYZE,
      coverageDeclared: false,
      fiscalYearStart: null,
      fiscalYearEnd: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuse un exercice qui se termine avant de commencer", () => {
    const parsed = fecAnalyzeSchema.safeParse({
      ...VALID_ANALYZE,
      fiscalYearStart: "2025-12-31",
      fiscalYearEnd: "2025-01-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuse une date inexistante au calendrier", () => {
    const parsed = fecAnalyzeSchema.safeParse({ ...VALID_ANALYZE, fiscalYearEnd: "2025-02-30" });
    expect(parsed.success).toBe(false);
  });
});

describe("plafonds · analyser n'est pas archiver", () => {
  it("le plafond de conservation est STRICTEMENT inférieur au plafond d'analyse", () => {
    // C'est cet écart qui rend la prévalidation nécessaire : un fichier analysable mais non
    // archivable doit être refusé AVANT que le fait canonique soit écrit.
    expect(MAX_RETAINED_FEC_FILE_BYTES).toBeLessThan(MAX_FEC_FILE_BYTES);
    expect(MAX_RETAINED_FEC_FILE_BYTES).toBe(8 * 1024 * 1024);
  });
});
