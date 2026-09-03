import type { DataKind } from "@/lib/types";

export const REPORT_TYPES = [
  "CURRENT_SNAPSHOT",
  "MONTHLY_REVIEW",
  "ANNUAL_REVIEW",
  "INVESTMENT_COMMITTEE_MEMO",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportCalculability = "COMPUTABLE" | "PARTIAL" | "NOT_COMPUTABLE";
export type ReportNature = DataKind | "OBSERVED" | "CONTRACTUAL" | "PROJECTED";

export interface ReportAmount {
  label: string;
  value: number | null;
  currency: string;
  date: string;
  nature: ReportNature;
  calculability: ReportCalculability;
  source: string;
}
export interface ReportSection {
  id: string;
  title: string;
  status: ReportCalculability;
  summary: string;
  amounts: ReportAmount[];
  items: string[];
  blockers: string[];
  ownerHref?: string;
}
export interface ReportManifest {
  formatVersion: "INSTITUTIONAL_REPORTING_1";
  type: ReportType;
  observationDate: string;
  period: { from: string; to: string };
  currency: string;
  contextFingerprint: string;
  openingFingerprint: string;
  eventSetVersion: string;
  methodologyVersions: string[];
  computableSections: string[];
  partialSections: string[];
  nonComputableSections: string[];
  blockers: string[];
  provenance: string[];
  parameters: Readonly<Record<string, string | number | null>>;
  financialFingerprint: string;
}
export interface InstitutionalReport {
  title: string;
  manifest: ReportManifest;
  sections: ReportSection[];
}
export interface ReportParameters {
  type: ReportType;
  year?: number;
  decisionCaseId?: string | null;
}
