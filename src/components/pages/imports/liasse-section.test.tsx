import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiasseSection from "./liasse-section";
import type { DocumentExtractionPreview } from "@/lib/data/document-contracts";

vi.mock("@/lib/data/supabase-storage-browser", () => ({
  uploadToSignedStoragePath: vi.fn().mockResolvedValue(undefined),
}));

function preview(): DocumentExtractionPreview {
  return {
    runId: "lecture-synthetique",
    businessId: "societe-synthetique",
    businessName: "Société synthétique",
    status: "EXTRACTED",
    pdfKind: "NATIVE_TEXT",
    pageCount: 1,
    detectedKind: null,
    detectedVariant: null,
    detectionBasis: [],
    siren: null,
    fiscalYearStart: null,
    fiscalYearEnd: null,
    fileName: "liasse-test.pdf",
    fileHash: null,
    extractedAt: "2026-10-22T08:00:00Z",
    counts: {
      fields: 1,
      unknownBoxes: 0,
      blocked: 0,
      corrected: 1,
      failedChecks: 0,
      notComputableChecks: 0,
    },
    fields: [
      {
        fieldId: "case-synthetique",
        pageNumber: 1,
        formCode: "2050",
        formPart: null,
        boxCode: "AA",
        occurrence: 0,
        label: "Case synthétique",
        bbox: null,
        rawValue: "10",
        normalizedValue: 10,
        userValue: 12,
        userReason: "Relecture synthétique",
        effectiveValue: 12,
        unit: "EUR",
        extractionMethod: "NATIVE_TEXT_LAYOUT",
        confidence: "HIGH",
        validationStatus: "CORRECTED",
        decisionRevision: 1,
        issues: [],
      },
    ],
    fieldsTruncated: false,
    checks: [],
    financials: {
      periodEnd: null,
      currency: "EUR",
      revenue: null,
      netIncome: null,
      unavailableFields: [],
    },
    issues: [],
    documentId: null,
    stagingCleanupFailed: false,
    supersedesRunId: null,
    decisions: [
      {
        fieldId: "case-synthetique",
        rank: 1,
        action: "CORRECT",
        beforeStatus: "EXTRACTED",
        beforeValue: 10,
        beforeDate: null,
        afterStatus: "CORRECTED",
        afterValue: 12,
        afterDate: null,
        reason: "Relecture synthétique",
        decidedAt: "2026-10-21T23:05:00Z",
        actor: "CURRENT_USER",
      },
    ],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Liasse — même historique que la dette", () => {
  it.each([true, false])(
    "affiche les décisions reçues et distingue leur indisponibilité (%s)",
    async (received) => {
      const result = preview();
      if (!received) delete result.decisions;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ticketId: "billet-test",
              bucket: "test",
              storagePath: "test",
              token: "jeton-synthetique",
              contentType: "application/pdf",
              retainable: true,
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(result)));
      vi.stubGlobal("fetch", fetchMock);
      render(
        <LiasseSection
          businesses={[
            { id: "societe-synthetique", name: "Société synthétique", functionalCurrency: "EUR" },
          ]}
          refresh={vi.fn()}
        />,
      );
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Société"), "societe-synthetique");
      await user.upload(
        screen.getByLabelText("Fichier"),
        new File(["%PDF-1.7"], "liasse-test.pdf", { type: "application/pdf" }),
      );
      expect((screen.getByLabelText("Fichier") as HTMLInputElement).files).toHaveLength(1);
      // JSDOM laisse valueMissing=true malgré le FileList de user.upload.
      // La soumission teste ici la relecture ; la validation native du fichier n'est pas simulée.
      fireEvent.submit(screen.getByRole("button", { name: "Lire la liasse" }).closest("form")!);
      const summary = await screen.findByText(
        received ? "Historique (1)" : "Historique · indisponible",
      );
      await userEvent.click(summary);
      if (received) {
        expect(screen.getByRole("list")).toHaveTextContent(
          /Corrigée par vous.*22 octobre 2026.*10 → 12 EUR.*Relecture synthétique/,
        );
      } else {
        expect(screen.getByText(/L’historique n’a pas été reçu/)).toBeVisible();
      }
    },
  );
});
