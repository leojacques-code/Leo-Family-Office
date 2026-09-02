import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";
import { buildInstitutionalReport } from "./report-builder";
import { renderReportPdf, winAnsiLiteral } from "./report-pdf";

describe("PDF WinAnsi", () => {
  it("encode explicitement les caractères français et remplace les scalaires non représentables", () => {
    expect(winAnsiLiteral("é è à ç œ ’ — • €")).toBe(
      "\\351 \\350 \\340 \\347 \\234 \\222 \\227 \\225 \\200",
    );
    expect(winAnsiLiteral("漢🙂\u0081\u009f\u007f")).toBe("?????");
    expect(winAnsiLiteral("e\u0301")).toBe("\\351");
    expect(winAnsiLiteral("(\\)")).toBe("\\(\\\\\\)");
  });
  it("extrait réellement le texte et vérifie les offsets et longueurs de streams", async () => {
    const report = buildInstitutionalReport(eventEngineCrossDomainFixture(), {
      type: "CURRENT_SNAPSHOT",
    });
    report.title = "é è à ç œ ’ — • € 漢🙂";
    const bytes = renderReportPdf(report, "2026-09-02T12:00:00Z");
    const raw = Buffer.from(bytes).toString("latin1");
    const xref = Number(/startxref\n(\d+)/.exec(raw)![1]);
    expect(raw.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...raw.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((x) => Number(x[1]));
    offsets.forEach((offset, index) =>
      expect(raw.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj\\n`)),
    );
    for (const match of raw.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g))
      expect(Buffer.byteLength(match[2], "latin1")).toBe(Number(match[1]));
    const loading = getDocument({ data: bytes, useSystemFonts: true });
    const pdf = await loading.promise;
    try {
      const text = (await (await pdf.getPage(1)).getTextContent()).items
        .map((x) => ("str" in x ? x.str : ""))
        .join(" ");
      expect(text).toContain("é è à ç œ ’ — • € ??");
      expect(text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(pdf.numPages).toBeGreaterThan(1);
    } finally {
      await loading.destroy();
    }
  });
});
