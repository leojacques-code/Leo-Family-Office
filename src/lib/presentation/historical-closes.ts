import type { MonthlyClose } from "@/lib/types";

export const COMPOSITION_LABELS: Record<string, string> = {
  immediate_cash: "Trésorerie immédiate",
  market_invested_assets: "Actifs investis",
  investment_envelope_cash: "Liquidités des enveloppes",
  illiquid_assets: "Actifs illiquides",
};

/** Highest version wins; timestamps and IDs break ties, never input order. */
export function orderedCloses(closes: MonthlyClose[]): MonthlyClose[] {
  const byDate = new Map<string, MonthlyClose>();
  for (const close of [...closes].sort(
    (a, b) =>
      a.closeDate.localeCompare(b.closeDate) ||
      (b.version ?? 0) - (a.version ?? 0) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id.localeCompare(a.id),
  )) {
    if (!byDate.has(close.closeDate)) byDate.set(close.closeDate, close);
  }
  return [...byDate.values()];
}

export const historicalCurrency = (close?: MonthlyClose): string =>
  close?.reportingCurrency && /^[A-Z]{3}$/.test(close.reportingCurrency)
    ? close.reportingCurrency
    : "UNKNOWN";

/** The four persisted V2 composition fields identify the existing balance-sheet convention.
 * Empty legacy JSON does not prove that convention. Unknown fields/methodologies fail closed.
 */
export function historicalMethodology(close: MonthlyClose): string | null {
  const composition = close.composition;
  if (!composition || !Object.keys(composition).length) return null;
  const keys = Object.keys(composition)
    .filter((key) => key !== "methodologyVersion")
    .sort();
  if (keys.join() !== Object.keys(COMPOSITION_LABELS).sort().join()) return null;
  if (
    keys.some(
      (key) =>
        composition[key] !== null &&
        (typeof composition[key] !== "number" || !Number.isFinite(composition[key])),
    )
  )
    return null;
  const explicit = composition.methodologyVersion;
  return explicit === undefined
    ? "CANONICAL_BALANCE_SHEET_V2"
    : typeof explicit === "string" && explicit
      ? explicit
      : null;
}

export function historicalBlockers(selected: MonthlyClose[]): string[] {
  const blockers: string[] = [];
  if (!selected.length) return ["NO_HISTORICAL_CLOSE"];
  if (selected.length < 2) blockers.push("SINGLE_CLOSE_POINT_IN_TIME_ONLY");
  if (selected.some((x) => !Number.isInteger(x.version) || (x.version ?? 0) < 1))
    blockers.push("HISTORICAL_VERSION_UNKNOWN");
  if (selected.some((x) => historicalCurrency(x) === "UNKNOWN"))
    blockers.push("HISTORICAL_CURRENCY_UNKNOWN");
  else if (new Set(selected.map(historicalCurrency)).size > 1)
    blockers.push("HISTORICAL_CURRENCY_MISMATCH");
  if (
    selected.some(
      (x) => !["COMPLETE", "PARTIAL", "NOT_COMPUTABLE"].includes(x.completenessStatus ?? ""),
    )
  )
    blockers.push("HISTORICAL_COMPLETENESS_UNKNOWN");
  else if (selected.some((x) => x.completenessStatus !== "COMPLETE"))
    blockers.push("HISTORICAL_CLOSE_INCOMPLETE");
  if (selected.some((x) => x.netWorth === null || !Number.isFinite(x.netWorth)))
    blockers.push("HISTORICAL_NET_WORTH_MISSING");
  if (selected.some((x) => !historicalMethodology(x)))
    blockers.push("HISTORICAL_METHODOLOGY_UNKNOWN");
  else if (new Set(selected.map(historicalMethodology)).size > 1)
    blockers.push("HISTORICAL_METHODOLOGY_MISMATCH");
  return blockers;
}
