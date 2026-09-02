import type { ReportAmount, ReportCalculability, ReportSection } from "./report-types";

export function section(
  id: string,
  title: string,
  summary: string,
  amounts: ReportAmount[] = [],
  items: string[] = [],
  blockers: string[] = [],
  ownerHref?: string,
): ReportSection {
  const statuses = amounts.map((item) => item.calculability);
  const status: ReportCalculability =
    blockers.length || statuses.includes("NOT_COMPUTABLE")
      ? amounts.some((item) => item.value !== null) || items.length
        ? "PARTIAL"
        : "NOT_COMPUTABLE"
      : statuses.includes("PARTIAL")
        ? "PARTIAL"
        : "COMPUTABLE";
  return {
    id,
    title,
    status,
    summary,
    amounts,
    items: [...items].sort(),
    blockers: [...new Set(blockers)].sort(),
    ownerHref,
  };
}
