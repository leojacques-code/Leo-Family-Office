import { describe, expect, it } from "vitest";

import {
  fecAnalyzeSchema,
  fecCommandSchema,
  fecUploadTicketSchema,
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
  // Le fichier est DÉJÀ au stockage privé : la requête d'analyse n'en porte qu'une
  // référence émise par le serveur.
  uploadTicketId: "33333333-3333-4333-8333-333333333333",
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

describe("billet de dépôt · le client déclare, le serveur décide", () => {
  const VALID_TICKET = { fileName: "fec-2025.txt", byteSize: 12_000_000, retainFile: false };

  it("accepte une déclaration de dépôt bien formée", () => {
    expect(fecUploadTicketSchema.safeParse(VALID_TICKET).success).toBe(true);
  });

  it("refuse un chemin de stockage fourni par le client", () => {
    // Le chemin est CALCULÉ côté serveur. L'accepter du client laisserait lire — ou
    // écraser — le fichier d'un autre propriétaire.
    for (const forged of ["storagePath", "path", "ticketId", "uploadUrl", "userId"]) {
      const parsed = fecUploadTicketSchema.safeParse({ ...VALID_TICKET, [forged]: "x" });
      expect(parsed.success).toBe(false);
    }
  });

  it("refuse une extension hors format", () => {
    expect(fecUploadTicketSchema.safeParse({ ...VALID_TICKET, fileName: "fec.xlsx" }).success).toBe(
      false,
    );
    expect(fecUploadTicketSchema.safeParse({ ...VALID_TICKET, fileName: "fec.pdf" }).success).toBe(
      false,
    );
  });

  it("refuse un fichier au-delà du plafond d'analyse", () => {
    const parsed = fecUploadTicketSchema.safeParse({
      ...VALID_TICKET,
      byteSize: MAX_FEC_FILE_BYTES + 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("refuse la CONSERVATION d'un fichier au-delà du coffre, AVANT tout dépôt", () => {
    // C'est la prévalidation qui ferme le partial success : le refus tombe avant que le
    // moindre octet soit déposé, et avant a fortiori toute écriture canonique.
    const parsed = fecUploadTicketSchema.safeParse({
      ...VALID_TICKET,
      byteSize: MAX_RETAINED_FEC_FILE_BYTES + 1,
      retainFile: true,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain("pas conservé");
    }
  });

  it("accepte le MÊME fichier sans conservation : analysable, simplement pas archivable", () => {
    const parsed = fecUploadTicketSchema.safeParse({
      ...VALID_TICKET,
      byteSize: MAX_RETAINED_FEC_FILE_BYTES + 1,
      retainFile: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuse une taille nulle ou négative", () => {
    for (const byteSize of [0, -1]) {
      expect(fecUploadTicketSchema.safeParse({ ...VALID_TICKET, byteSize }).success).toBe(false);
    }
  });
});

describe("analyse · aucun contenu de fichier ne traverse la route", () => {
  it("exige une référence de billet, pas un fichier", () => {
    const { uploadTicketId, ...withoutTicket } = VALID_ANALYZE;
    expect(uploadTicketId).toBeTruthy();
    expect(fecAnalyzeSchema.safeParse(withoutTicket).success).toBe(false);
  });

  it("refuse tout ce qui ressemblerait à un fichier ou à un chemin", () => {
    for (const forged of ["file", "bytes", "content", "storagePath", "fileHash", "byteSize"]) {
      const parsed = fecAnalyzeSchema.safeParse({ ...VALID_ANALYZE, [forged]: "x" });
      expect(parsed.success).toBe(false);
    }
  });
});
