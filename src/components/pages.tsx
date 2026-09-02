"use client";

import TodayPage from "@/components/pages/today/page";
import AdvisorPage from "@/components/pages/advisor/page";
import NetWorthPage from "@/components/pages/net-worth/page";
import CashFlowPage from "@/components/pages/cash-flow/page";
import InvestmentsPage from "@/components/pages/investments/page";
import DebtPage from "@/components/pages/debt/page";
import RealEstatePage from "@/components/pages/real-estate/page";
import CareerPage from "@/components/pages/career/page";
import BusinessPage from "@/components/pages/business-equity/page";
import TaxPage from "@/components/pages/tax/page";
import ScenariosPage from "@/components/pages/scenarios/page";
import DecisionLabPage from "@/components/pages/decision-lab/page";
import GoalsPage from "@/components/pages/goals/page";
import ImportsPage from "@/components/pages/imports/page";
import DocumentsPage from "@/components/pages/documents/page";
import TimelinePage from "@/components/pages/timeline/page";
import SettingsPage from "@/components/pages/settings/page";
import type { SectionProps } from "@/components/pages/shared";

export function SectionContent(props: SectionProps) {
  switch (props.section) {
    case "advisor":
      return <AdvisorPage {...props} />;
    case "net-worth":
      return <NetWorthPage {...props} />;
    case "cash-flow":
      return <CashFlowPage {...props} />;
    case "investments":
      return <InvestmentsPage {...props} />;
    case "debt":
      return <DebtPage {...props} />;
    case "real-estate":
      return <RealEstatePage {...props} />;
    case "career":
      return <CareerPage {...props} />;
    case "business-equity":
      return <BusinessPage {...props} />;
    case "tax":
      return <TaxPage {...props} />;
    case "scenarios":
      return <ScenariosPage {...props} />;
    case "decision-lab":
      return <DecisionLabPage {...props} />;
    case "goals":
      return <GoalsPage {...props} />;
    case "imports":
      return <ImportsPage {...props} />;
    case "documents":
      return <DocumentsPage {...props} />;
    case "timeline":
      return <TimelinePage {...props} />;
    case "settings":
      return <SettingsPage {...props} />;
    default:
      return <TodayPage {...props} />;
  }
}
