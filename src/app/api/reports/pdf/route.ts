import { requireAuthenticated } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { buildInstitutionalReport } from "@/lib/reporting/report-builder";
import { renderReportPdf } from "@/lib/reporting/report-pdf";
import { REPORT_TYPES, type ReportType } from "@/lib/reporting/report-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAuthenticated();
  } catch {
    return Response.json(
      { error: "Non authentifié" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const query = new URL(request.url).searchParams;
  const type = query.get("type");
  if (!type || !REPORT_TYPES.includes(type as ReportType))
    return Response.json({ error: "Type de rapport invalide" }, { status: 400 });
  const yearText = query.get("year");
  const year = yearText === null ? undefined : Number(yearText);
  if (type === "ANNUAL_REVIEW" && (!Number.isInteger(year) || year! < 2000 || year! > 2100))
    return Response.json({ error: "Année invalide" }, { status: 400 });
  const decisionCaseId = query.get("decisionCaseId");
  if (decisionCaseId && !/^[a-zA-Z0-9_-]{1,128}$/.test(decisionCaseId))
    return Response.json({ error: "Decision Case invalide" }, { status: 400 });
  const state = await (await getRepository()).getDashboardState();
  const report = buildInstitutionalReport(state, {
    type: type as ReportType,
    year,
    decisionCaseId,
  });
  const pdf = renderReportPdf(report, new Date().toISOString());
  const filename = `leo-${type.toLowerCase().replaceAll("_", "-")}-${report.manifest.observationDate}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(pdf.byteLength),
    },
  });
}
