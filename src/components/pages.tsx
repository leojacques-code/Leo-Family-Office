"use client";

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
import ReportsPage from "@/components/pages/reports/page";
import type { SectionProps } from "@/components/pages/shared";

/**
 * Aiguillage des sections servies par l'ÉTAT GLOBAL.
 *
 * Aujourd'hui n'y figure plus. Depuis la phase 2, la page est servie par
 * `getTodayReadModel()` et rendue par la route racine, avec son propre modèle : le §10.2
 * demande de « remplacer `getDashboardState()` comme source de chaque page par des modèles de
 * lecture ciblés », et la garder ici l'aurait obligée à recevoir `DashboardState` en plus de
 * son modèle — c'est-à-dire à garder ouverte la porte que la phase referme.
 *
 * Les treize sections restantes gardent l'état global jusqu'à leur propre phase (§14 : « ne
 * pas refaire toutes les pages dans une seule PR »).
 */
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
    case "reports":
      return <ReportsPage {...props} />;
    default:
      // Inatteignable : `isRoutedSection` refuse « today » et toute section hors registre, et
      // la racine sert Aujourd'hui sans passer ici. Rendre `null` plutôt que lever, parce
      // qu'une route valide qui n'aurait pas encore de composant doit dégrader, pas casser.
      return null;
  }
}
