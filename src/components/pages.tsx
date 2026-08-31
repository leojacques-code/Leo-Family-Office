"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeEuro,
  Banknote,
  BriefcaseBusiness,
  Building2,
  CalendarRange,
  CircleDollarSign,
  Database,
  FileText,
  FlaskConical,
  FolderLock,
  Landmark,
  Network,
  Orbit,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Target,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import GuidedHome from "@/components/pages/today/guided-home";
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

type DomainMeta = {
  icon: LucideIcon;
  eyebrow: string;
  thesis: string;
  source: string;
  engine: string;
  outcome: string;
  tasks: readonly string[];
  links: readonly { label: string; href: string }[];
};

const DOMAIN_META: Record<string, DomainMeta> = {
  "net-worth": {
    icon: WalletCards,
    eyebrow: "Consolidated wealth",
    thesis: "Comprendre ce que vous possédez, ce que vous devez et surtout ce qui est réellement mobilisable.",
    source: "Comptes · actifs · valorisations",
    engine: "Balance Sheet",
    outcome: "Solvabilité · liquidité · concentration",
    tasks: ["Vue consolidée", "Liquidité", "Concentration", "Provenance"],
    links: [{ label: "Cash Flow", href: "/cash-flow" }, { label: "Debt", href: "/debt" }],
  },
  "cash-flow": {
    icon: CircleDollarSign,
    eyebrow: "Observed liquidity",
    thesis: "Transformer les transactions et récurrents en une lecture claire de votre liberté financière mensuelle.",
    source: "Banque · salaire · récurrents",
    engine: "Cash Flow Ledger",
    outcome: "Runway · épargne · alertes",
    tasks: ["Flux", "Récurrents", "Flexibilité", "Automations"],
    links: [{ label: "Career", href: "/career" }, { label: "Goals", href: "/goals" }],
  },
  investments: {
    icon: TrendingUp,
    eyebrow: "Portfolio intelligence",
    thesis: "Lire performance, risque, liquidité, enveloppes et horizon comme un seul portefeuille économique.",
    source: "Courtier · PEA · CTO · relevés",
    engine: "Portfolio Ledger",
    outcome: "Performance · risque · fiscalité",
    tasks: ["Performance", "Allocation", "Risque", "Enveloppes"],
    links: [{ label: "Tax", href: "/tax" }, { label: "Scenarios", href: "/scenarios" }],
  },
  debt: {
    icon: Landmark,
    eyebrow: "Contractual obligations",
    thesis: "Partir du contrat réel pour expliquer capital, coût, assurance, échéances et arbitrages de remboursement.",
    source: "Offre · échéancier · prélèvements",
    engine: "Debt Engine",
    outcome: "Maturité · coût · capacité",
    tasks: ["Contrats", "Échéancier", "Coût", "Arbitrages"],
    links: [{ label: "Cash Flow", href: "/cash-flow" }, { label: "Decisions", href: "/decision-lab" }],
  },
  "real-estate": {
    icon: Building2,
    eyebrow: "Property dossier",
    thesis: "Analyser l’immobilier comme un dossier d’investissement : coût complet, financement, exploitation, valeur et scénarios.",
    source: "Acte · prêt · bail · devis",
    engine: "Real Estate",
    outcome: "NOI · equity · TRI · risque",
    tasks: ["Actif", "Financement", "Exploitation", "Scénarios"],
    links: [{ label: "Debt", href: "/debt" }, { label: "Tax", href: "/tax" }],
  },
  career: {
    icon: BriefcaseBusiness,
    eyebrow: "Human capital",
    thesis: "Relier contrat, paie, revenu bancaire et trajectoire professionnelle à votre capacité financière future.",
    source: "Contrat · bulletins · banque",
    engine: "Career Model",
    outcome: "Net · progression · capacité",
    tasks: ["Rémunération", "Contrat", "Trajectoire", "Scénarios"],
    links: [{ label: "Cash Flow", href: "/cash-flow" }, { label: "Tax", href: "/tax" }],
  },
  "business-equity": {
    icon: Network,
    eyebrow: "Private ownership",
    thesis: "Passer des comptes et de la détention juridique à une valeur économique explicable et à sa conversion en cash.",
    source: "Comptes · FEC · cap table",
    engine: "Business Equity",
    outcome: "EBITDA · cash · equity value",
    tasks: ["Ownership", "QoE", "Cash bridge", "Valuation"],
    links: [{ label: "Tax", href: "/tax" }, { label: "Decisions", href: "/decision-lab" }],
  },
  tax: {
    icon: ReceiptText,
    eyebrow: "After-tax reality",
    thesis: "Séparer résultat économique, base taxable, règle applicable et résultat réellement disponible après impôt.",
    source: "IFU · avis · règles vérifiées",
    engine: "Tax Layer",
    outcome: "Avant / après impôt",
    tasks: ["Position", "Enveloppes", "Calendrier", "Hypothèses"],
    links: [{ label: "Investments", href: "/investments" }, { label: "Real Estate", href: "/real-estate" }],
  },
  scenarios: {
    icon: Orbit,
    eyebrow: "Projection studio",
    thesis: "Modifier des hypothèses sans altérer l’historique réel, puis observer la dispersion des trajectoires.",
    source: "Facts · hypothèses · objectifs",
    engine: "Scenario Model",
    outcome: "Trajectoires · sensibilités",
    tasks: ["Central", "Stress", "Upside", "Comparaison"],
    links: [{ label: "Decisions", href: "/decision-lab" }, { label: "Goals", href: "/goals" }],
  },
  "decision-lab": {
    icon: FlaskConical,
    eyebrow: "Decision simulation",
    thesis: "Comparer un choix sur ses effets patrimoine, liquidité, risque, fiscalité et objectifs — pas sur un KPI isolé.",
    source: "Situation · options · contraintes",
    engine: "Decision Lab",
    outcome: "Trade-offs · conséquences",
    tasks: ["Question", "Hypothèses", "Trajectoires", "Verdict"],
    links: [{ label: "Scenarios", href: "/scenarios" }, { label: "Goals", href: "/goals" }],
  },
  goals: {
    icon: Target,
    eyebrow: "Life objectives",
    thesis: "Transformer un objectif de vie en besoin de capital, horizon, contraintes et chemin de financement.",
    source: "Objectif · date · priorité",
    engine: "Goal Engine",
    outcome: "Gap · runway · faisabilité",
    tasks: ["Objectifs", "Funding", "Contraintes", "Progression"],
    links: [{ label: "Cash Flow", href: "/cash-flow" }, { label: "Decisions", href: "/decision-lab" }],
  },
  imports: {
    icon: Database,
    eyebrow: "Source acquisition",
    thesis: "Faire entrer une source sans mutation silencieuse : détecter, normaliser, rapprocher, prévisualiser puis confirmer.",
    source: "CSV · PDF · API · documents",
    engine: "Ingestion",
    outcome: "Facts traçables",
    tasks: ["Connecter", "Importer", "Mapper", "Réconcilier"],
    links: [{ label: "Documents", href: "/documents" }, { label: "Timeline", href: "/timeline" }],
  },
  documents: {
    icon: FolderLock,
    eyebrow: "Private records",
    thesis: "Chaque document doit devenir une source exploitable, reliée à des faits et à un domaine financier.",
    source: "Documents privés",
    engine: "Extraction & provenance",
    outcome: "Facts · preuves · audit",
    tasks: ["Bibliothèque", "Extraction", "Revue", "Provenance"],
    links: [{ label: "Sources", href: "/imports" }, { label: "Timeline", href: "/timeline" }],
  },
  timeline: {
    icon: CalendarRange,
    eyebrow: "Financial chronology",
    thesis: "Lire la vie financière comme une chronologie d’événements observés, contractuels et projetés.",
    source: "Événements multi-domaines",
    engine: "Canonical timeline",
    outcome: "Contexte · causalité · mémoire",
    tasks: ["Historique", "Contrats", "Événements", "Projections"],
    links: [{ label: "Wealth", href: "/net-worth" }, { label: "Sources", href: "/imports" }],
  },
  settings: {
    icon: Settings2,
    eyebrow: "Workspace control",
    thesis: "Personnaliser l’expérience, la densité et les vues sans jamais modifier la vérité financière sous-jacente.",
    source: "Préférences utilisateur",
    engine: "Presentation layer",
    outcome: "Workspace personnalisé",
    tasks: ["Appearance", "Navigation", "Defaults", "Privacy"],
    links: [{ label: "Sources", href: "/imports" }, { label: "Home", href: "/today" }],
  },
};

function DomainCompass({ section }: { section: string }) {
  const meta = DOMAIN_META[section];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <section className="v6-domain-compass" aria-label="Architecture du domaine">
      <div className="v6-domain-compass-copy">
        <span className="v6-domain-eyebrow"><Icon size={13} /> {meta.eyebrow}</span>
        <p>{meta.thesis}</p>
      </div>
      <div className="v6-domain-pipeline" aria-label="Flux de données du domaine">
        <div><span>01</span><small>Source</small><strong>{meta.source}</strong></div>
        <i><ArrowRight size={12} /></i>
        <div className="active"><span>02</span><small>Engine</small><strong>{meta.engine}</strong></div>
        <i><ArrowRight size={12} /></i>
        <div><span>03</span><small>Outcome</small><strong>{meta.outcome}</strong></div>
      </div>
      <div className="v6-domain-task-rail">
        {meta.tasks.map((task, index) => <span className={index === 0 ? "active" : ""} key={task}>{task}</span>)}
        <div className="v6-domain-links">
          {meta.links.map((link) => <Link key={link.href} href={link.href}>{link.label} <ArrowRight size={10} /></Link>)}
        </div>
      </div>
      <div className="v6-domain-trust"><ShieldCheck size={12} /> UI = consommateur de vérité · aucune seconde finance locale</div>
    </section>
  );
}

function renderSection(props: SectionProps) {
  switch (props.section) {
    case "net-worth": return <NetWorthPage {...props} />;
    case "cash-flow": return <CashFlowPage {...props} />;
    case "investments": return <InvestmentsPage {...props} />;
    case "debt": return <DebtPage {...props} />;
    case "real-estate": return <RealEstatePage {...props} />;
    case "career": return <CareerPage {...props} />;
    case "business-equity": return <BusinessPage {...props} />;
    case "tax": return <TaxPage {...props} />;
    case "scenarios": return <ScenariosPage {...props} />;
    case "decision-lab": return <DecisionLabPage {...props} />;
    case "goals": return <GoalsPage {...props} />;
    case "imports": return <ImportsPage {...props} />;
    case "documents": return <DocumentsPage {...props} />;
    case "timeline": return <TimelinePage {...props} />;
    case "settings": return <SettingsPage {...props} />;
    default: return <GuidedHome {...props} />;
  }
}

export function SectionContent(props: SectionProps) {
  if (props.section === "today") return <GuidedHome {...props} />;
  return (
    <div className="v6-domain-experience" data-domain={props.section}>
      <DomainCompass section={props.section} />
      {renderSection(props)}
    </div>
  );
}
