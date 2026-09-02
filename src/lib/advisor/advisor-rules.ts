import type { AdvisorDomain, AdvisorEvidence, AdvisorInsight } from "@/lib/advisor/advisor-types";

export const ADVISOR_PRIORITY_RULES = [
  "FIDELITY_OR_DATA_BLOCKER",
  "CONTRACTUAL_DEADLINE",
  "LIQUIDITY_DEBT_CASH_FLOW",
  "GOAL_RISK",
  "OPEN_DECISION",
  "STALE_SCENARIO",
  "OBSERVED_NET_WORTH_CHANGE",
  "MONITORING_INFORMATION",
] as const;

export const OWNER_CTA: Record<AdvisorDomain, { label: string; href: string }> = {
  GLOBAL: { label: "Voir le bilan", href: "/net-worth" },
  TIMELINE: { label: "Ouvrir Timeline", href: "/timeline" },
  NET_WORTH: { label: "Ouvrir Net Worth", href: "/net-worth" },
  GOALS: { label: "Ouvrir Goals", href: "/goals" },
  DECISION_LAB: { label: "Ouvrir Decision Lab", href: "/decision-lab" },
  SCENARIOS: { label: "Ouvrir Scenarios", href: "/scenarios" },
};

export function evidence(input: AdvisorEvidence): AdvisorEvidence {
  return input;
}

export function insight(
  value: Omit<AdvisorInsight, "cta" | "provenance"> & { provenance?: string[] },
): AdvisorInsight {
  const owner = OWNER_CTA[value.domain];
  if (!value.evidence.length) throw new Error("Advisor : une affirmation exige une preuve");
  return {
    ...value,
    cta: { ...owner, domain: value.domain },
    provenance: value.provenance ?? [...new Set(value.evidence.map((item) => item.provenance))],
  };
}

export function stableInsightOrder(left: AdvisorInsight, right: AdvisorInsight): number {
  return (
    left.priority - right.priority ||
    left.observedAt.localeCompare(right.observedAt) ||
    left.id.localeCompare(right.id)
  );
}
