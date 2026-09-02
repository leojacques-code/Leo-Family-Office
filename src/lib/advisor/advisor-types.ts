import type { GlobalFinancialContext } from "@/lib/engine/global-financial-model";
import type { DashboardState } from "@/lib/types";
import type { TodayCockpit } from "@/lib/presentation/today-cockpit";
import type { TimelineItem } from "@/lib/presentation/timeline-view";

export type AdvisorStatus = "ACTIONABLE" | "INFORMATIONAL" | "BLOCKED" | "NOT_COMPUTABLE";
export type AdvisorDomain =
  "GLOBAL" | "TIMELINE" | "NET_WORTH" | "CASH_FLOW" | "GOALS" | "DECISION_LAB" | "SCENARIOS";
export type AdvisorIntent = "NOW" | "CHANGED" | "GOALS" | "DECISIONS" | "WHY_NOT_COMPUTABLE";

export interface AdvisorEvidence {
  id: string;
  date: string;
  nature: string;
  provenance: string;
  calculability: "KNOWN" | "PARTIAL" | "NOT_COMPUTABLE";
  amount: number | null;
  currency: string | null;
  href: string;
}

export interface AdvisorInsight {
  id: string;
  observedAt: string;
  type: string;
  domain: AdvisorDomain;
  priority: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  status: AdvisorStatus;
  title: string;
  summary: string;
  priorityReason: string;
  evidence: AdvisorEvidence[];
  provenance: string[];
  calculability: "COMPUTABLE" | "PARTIAL" | "NOT_COMPUTABLE";
  amount: number | null;
  currency: string | null;
  baselineFingerprint: string;
  cta: { label: string; href: string; domain: AdvisorDomain };
  blockers: string[];
  dedupeKey: string;
}

export interface AdvisorInput {
  state: DashboardState;
  context?: GlobalFinancialContext;
  cockpit?: TodayCockpit;
  timeline?: TimelineItem[];
  /** Références déclarées par un consommateur : toute divergence bloque le conseil. */
  expected?: { asOfDate?: string; openingFingerprint?: string; eventSetVersion?: string };
}

export interface AdvisorPacket {
  version: "BEYONDER_ADVISOR_V1";
  observedAt: string;
  completeness: GlobalFinancialContext["completeness"];
  contextFingerprint: string;
  insights: AdvisorInsight[];
  counts: { actionable: number; blocked: number; notComputable: number };
}

export interface AdvisorAnswer {
  intent: AdvisorIntent;
  title: string;
  insightIds: string[];
  message: string;
}
