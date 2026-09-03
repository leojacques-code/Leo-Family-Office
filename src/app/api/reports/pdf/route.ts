import { requireAuthenticated } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { buildInstitutionalReport } from "@/lib/reporting/report-builder";
import { renderReportPdf } from "@/lib/reporting/report-pdf";
import { REPORT_TYPES, type ReportType } from "@/lib/reporting/report-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

const privateJson = (body: unknown, status: number) =>
  Response.json(body, { status, headers: PRIVATE_NO_STORE });

export async function GET(request: Request) {
  try {
    await requireAuthenticated();
  } catch {
    return privateJson({ error: "Non authentifié" }, 401);
  }
  const query = new URL(request.url).searchParams;
  const type = query.get("type");
  if (!type || !REPORT_TYPES.includes(type as ReportType))
    return privateJson({ error: "Type de rapport invalide" }, 400);
  const yearText = query.get("year");
  const year = yearText === null ? undefined : Number(yearText);
  if (type === "ANNUAL_REVIEW" && (!Number.isInteger(year) || year! < 2000 || year! > 2100))
    return privateJson({ error: "Année invalide" }, 400);
  const decisionCaseId = query.get("decisionCaseId");
  if (decisionCaseId && !/^[a-zA-Z0-9_-]{1,128}$/.test(decisionCaseId))
    return privateJson({ error: "Decision Case invalide" }, 400);
  const expectedFingerprint = query.get("expectedFingerprint");
  if (!expectedFingerprint || !/^report-[a-f0-9]{8}$/.test(expectedFingerprint))
    return privateJson({ error: "Fingerprint de l’aperçu absent ou invalide" }, 400);
  const state = await (await getRepository()).getDashboardState();
  const report = buildInstitutionalReport(state, {
    type: type as ReportType,
    year,
    decisionCaseId,
  });
  if (report.manifest.financialFingerprint !== expectedFingerprint)
    return privateJson(
      {
        error:
          "L’état financier ou les paramètres du rapport ont changé depuis l’aperçu. Rechargez l’aperçu avant de télécharger le PDF.",
      },
      409,
    );
  const pdf = renderReportPdf(report, new Date().toISOString());
  const filename = `leo-${type.toLowerCase().replaceAll("_", "-")}-${report.manifest.observationDate}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...PRIVATE_NO_STORE,
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(pdf.byteLength),
    },
  });
}
