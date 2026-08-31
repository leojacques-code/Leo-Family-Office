"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Banknote,
  BriefcaseBusiness,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Database,
  FileCheck2,
  FileText,
  Goal,
  Landmark,
  Network,
  Orbit,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SectionProps } from "@/components/pages/shared";

const euro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

const DOMAIN_NODES = [
  { id: "banking", label: "Banking", detail: "Comptes, transactions, liquidité", icon: Banknote, x: "10%", y: "19%", color: "cyan", href: "/cash-flow" },
  { id: "career", label: "Career", detail: "Salaire, contrat, capital humain", icon: BriefcaseBusiness, x: "73%", y: "11%", color: "blue", href: "/career" },
  { id: "investments", label: "Investments", detail: "PEA, CTO, allocation, risque", icon: TrendingUp, x: "82%", y: "48%", color: "violet", href: "/investments" },
  { id: "real-estate", label: "Real Estate", detail: "Biens, projets, financement", icon: Building2, x: "70%", y: "79%", color: "teal", href: "/real-estate" },
  { id: "debt", label: "Debt", detail: "Contrats, échéanciers, engagements", icon: Landmark, x: "15%", y: "74%", color: "orange", href: "/debt" },
  { id: "business", label: "Business", detail: "Participations, valeur, cash", icon: Network, x: "4%", y: "47%", color: "pink", href: "/business-equity" },
] as const;

const SOURCE_ITEMS = [
  { label: "Banque", icon: Banknote, status: "Synchronisé", tone: "good" },
  { label: "Courtier", icon: TrendingUp, status: "À rapprocher", tone: "warn" },
  { label: "Documents", icon: FileText, status: "3 sources", tone: "neutral" },
  { label: "Données publiques", icon: Database, status: "Disponible", tone: "good" },
] as const;

const JOURNEYS = [
  { icon: WalletCards, title: "Comprendre mon patrimoine", text: "Valeur, liquidité, dette et concentration dans une seule lecture.", href: "/net-worth", nodes: ["Net Worth", "Liquidity", "Debt"] },
  { icon: CircleDollarSign, title: "Améliorer ma liberté mensuelle", text: "Revenus, charges, dette, épargne et fonds de sécurité reliés entre eux.", href: "/cash-flow", nodes: ["Income", "Costs", "Savings"] },
  { icon: Building2, title: "Préparer un projet immobilier", text: "Cash, financement, coût complet, exploitation et scénarios avant décision.", href: "/real-estate", nodes: ["Cash", "Debt", "Property"] },
  { icon: WandSparkles, title: "Tester une décision", text: "Changer une hypothèse et voir immédiatement les effets sur votre trajectoire.", href: "/decision-lab", nodes: ["Facts", "Scenario", "Decision"] },
] as const;

const INBOX = [
  { icon: FileCheck2, title: "2 éléments méritent une validation", text: "LFO a détecté des données qui pourraient être rapprochées avant votre prochaine analyse.", action: "Ouvrir la revue", tone: "violet" },
  { icon: RefreshCw, title: "Vos données ont plusieurs niveaux de fraîcheur", text: "Une vue guidée distingue ce qui est observé, ancien ou encore hypothétique.", action: "Voir les sources", tone: "cyan" },
  { icon: Target, title: "Vos objectifs peuvent piloter les arbitrages", text: "Relier une décision à un objectif évite d'optimiser un KPI isolé.", action: "Voir les objectifs", tone: "pink" },
] as const;

type KpiKey = "netWorth" | "liquidity" | "freedom" | "invested" | "debt";
type KpiDefinition = { label: string; value: number | null; icon: LucideIcon; hint: string; accent: string };

export default function GuidedHome({ state }: SectionProps) {
  const [activeNode, setActiveNode] = useState<(typeof DOMAIN_NODES)[number]["id"]>("banking");
  const [activeKpi, setActiveKpi] = useState<KpiKey>("netWorth");
  const [range, setRange] = useState<"1Y" | "5Y" | "MAX">("5Y");

  const kpis = useMemo<Record<KpiKey, KpiDefinition>>(() => {
    const debt = state.liabilities.reduce((sum, liability) => sum + liability.currentBalance, 0);
    return {
      netWorth: { label: "Patrimoine net", value: state.metrics.netWorth, icon: WalletCards, hint: "Actifs − dettes", accent: "blue" },
      liquidity: { label: "Liquidité", value: state.metrics.bankCash, icon: Banknote, hint: "Cash bancaire identifié", accent: "cyan" },
      freedom: { label: "Liberté mensuelle", value: state.metrics.freeCashFlow, icon: CircleDollarSign, hint: "Cash-flow mensuel connu", accent: "green" },
      invested: { label: "Capital investi", value: state.metrics.grossAssets, icon: TrendingUp, hint: `${state.accounts.length} comptes consolidés`, accent: "violet" },
      debt: { label: "Dette exposée", value: debt, icon: Landmark, hint: `${state.liabilities.length} engagement(s)`, accent: "orange" },
    };
  }, [state]);

  const activeMetric = kpis[activeKpi];
  const activeDomain = DOMAIN_NODES.find((node) => node.id === activeNode) ?? DOMAIN_NODES[0];
  const ActiveDomainIcon = activeDomain.icon;
  const base = activeMetric.value ?? 100000;
  const trend = useMemo(() => {
    const factors = range === "1Y"
      ? [0.91, 0.925, 0.94, 0.952, 0.96, 0.971, 0.966, 0.982, 0.989, 1.003, 1.01, 1]
      : range === "5Y"
        ? [0.62, 0.66, 0.71, 0.69, 0.75, 0.79, 0.82, 0.86, 0.9, 0.94, 0.97, 1]
        : [0.28, 0.34, 0.39, 0.47, 0.52, 0.58, 0.67, 0.72, 0.81, 0.88, 0.95, 1];
    return factors.map((factor, index) => ({ period: `${index + 1}`, value: base * factor }));
  }, [base, range]);

  const explanation = activeKpi === "netWorth"
    ? "Le patrimoine mesure la solvabilité globale, mais ne dit pas ce qui est immédiatement disponible."
    : activeKpi === "liquidity"
      ? "La liquidité mesure les ressources mobilisables sans devoir céder un actif difficilement vendable."
      : activeKpi === "freedom"
        ? "La marge mensuelle relie revenus, dépenses, dette et capacité réelle à financer vos projets futurs."
        : activeKpi === "invested"
          ? "Le capital investi doit être lu avec son risque, son horizon, sa fiscalité et sa fonction dans vos objectifs."
          : "La dette est un calendrier d'engagements : montant, durée, coût et assurance modifient votre trajectoire.";

  return (
    <div className="guided-home">
      <section className="guided-hero">
        <div>
          <span className="guided-kicker"><Sparkles size={13} /> Family Office command center</span>
          <h1>Votre vie financière, <span>enfin reliée.</span></h1>
          <p>LFO rassemble les sources, relie les faits entre eux et vous guide vers ce qui mérite une décision. La complexité reste disponible, mais elle n'est jamais le point d'entrée.</p>
        </div>
        <div className="guided-hero-actions">
          <button className="button secondary"><FileText size={15} /> Ajouter une source</button>
          <Link className="button primary" href="/decision-lab"><WandSparkles size={15} /> Tester une décision</Link>
        </div>
      </section>

      <section className="guided-status-bar">
        <div><span className="status-pulse" /><strong>{Math.round(state.metrics.dataCompleteness * 100)}%</strong><span>de votre vue actuelle est structurée</span></div>
        <div><ShieldCheck size={14} /><span>Les hypothèses restent séparées des faits observés</span></div>
        <button>Voir la provenance <ChevronRight size={13} /></button>
      </section>

      <section className="guided-universe-layout">
        <article className="wealth-universe-panel">
          <div className="guided-panel-head">
            <div><span className="eyebrow">Wealth Universe</span><h2>Votre système financier vivant</h2></div>
            <span className="prototype-pill"><Orbit size={12} /> Visual prototype</span>
          </div>
          <div className="wealth-universe">
            <div className="universe-grid" />
            <div className="universe-orbit orbit-a" />
            <div className="universe-orbit orbit-b" />
            <div className="wealth-globe">
              <div className="globe-latitude lat-a" /><div className="globe-latitude lat-b" />
              <div className="globe-longitude long-a" /><div className="globe-longitude long-b" />
              <div className="globe-core"><span>YOU</span><strong>{state.metrics.netWorth === null ? "—" : compact.format(state.metrics.netWorth)}</strong><small>patrimoine net</small></div>
              <span className="globe-particle p1" /><span className="globe-particle p2" /><span className="globe-particle p3" />
            </div>
            <svg className="universe-links" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
              <defs><linearGradient id="universeLine" x1="0" x2="1"><stop offset="0" stopColor="#55dcff" stopOpacity=".08"/><stop offset=".5" stopColor="#7d9cff" stopOpacity=".72"/><stop offset="1" stopColor="#a879ff" stopOpacity=".08"/></linearGradient></defs>
              <path d="M500 300 C330 215 260 180 150 130"/><path d="M500 300 C650 205 730 150 840 115"/><path d="M500 300 C680 300 770 295 910 300"/><path d="M500 300 C650 410 700 465 820 500"/><path d="M500 300 C360 420 275 455 170 470"/><path d="M500 300 C330 300 205 300 95 300"/>
            </svg>
            {DOMAIN_NODES.map(({ id, label, icon: Icon, x, y, color }) => (
              <button key={id} className={`universe-node node-${color} ${activeNode === id ? "active" : ""}`} style={{ left: x, top: y }} onClick={() => setActiveNode(id)}>
                <span><Icon size={17}/></span><strong>{label}</strong>
              </button>
            ))}
          </div>
          <div className="universe-context-strip">
            <div className={`context-icon node-${activeDomain.color}`}><ActiveDomainIcon size={18}/></div>
            <div><span>{activeDomain.label}</span><strong>{activeDomain.detail}</strong></div>
            <div className="context-flow"><i/><span>connecté au patrimoine consolidé</span><i/></div>
            <Link href={activeDomain.href}>Explorer <ArrowRight size={13}/></Link>
          </div>
        </article>

        <aside className="financial-inbox-panel">
          <div className="guided-panel-head"><div><span className="eyebrow">Guided inbox</span><h2>Ce qui mérite votre attention</h2></div><span className="inbox-count">3</span></div>
          <div className="inbox-list">
            {INBOX.map(({ icon: Icon, title, text, action, tone }) => (
              <button key={title} className={`inbox-item inbox-${tone}`}>
                <span className="inbox-icon"><Icon size={16}/></span>
                <span><strong>{title}</strong><small>{text}</small><em>{action} <ArrowRight size={11}/></em></span>
              </button>
            ))}
          </div>
          <div className="source-health">
            <div><span>Sources actives</span><strong>{SOURCE_ITEMS.length}</strong></div>
            {SOURCE_ITEMS.map(({ label, icon: Icon, status, tone }) => <div className="source-health-row" key={label}><Icon size={13}/><span>{label}</span><small className={tone}>{status}</small></div>)}
          </div>
        </aside>
      </section>

      <section className="data-story-panel">
        <div className="guided-panel-head"><div><span className="eyebrow">How LFO thinks</span><h2>Des sources dispersées vers une décision explicable</h2></div><span className="data-story-caption">prototype de flux</span></div>
        <div className="data-story-flow">
          <div className="story-node"><span><Database size={16}/></span><strong>Sources</strong><small>Banques, documents, APIs</small></div><div className="story-edge"><i/><i/><i/></div>
          <div className="story-node"><span><FileCheck2 size={16}/></span><strong>Réconciliation</strong><small>Les faits se confirment</small></div><div className="story-edge"><i/><i/><i/></div>
          <div className="story-node"><span><Activity size={16}/></span><strong>Moteurs</strong><small>Cash, dette, fiscalité, valo</small></div><div className="story-edge"><i/><i/><i/></div>
          <div className="story-node featured"><span><WalletCards size={16}/></span><strong>Vérité financière</strong><small>Une vue consolidée</small></div><div className="story-edge"><i/><i/><i/></div>
          <div className="story-node"><span><Goal size={16}/></span><strong>Décisions</strong><small>Objectifs, risques, scénarios</small></div>
        </div>
      </section>

      <section className="kpi-story-panel">
        <div className="guided-panel-head">
          <div><span className="eyebrow">Interactive KPI story</span><h2>Un chiffre n'a de sens qu'avec son contexte</h2></div>
          <div className="chart-range-control">{(["1Y", "5Y", "MAX"] as const).map((value) => <button key={value} className={range === value ? "active" : ""} onClick={() => setRange(value)}>{value}</button>)}</div>
        </div>
        <div className="kpi-story-tabs">
          {(Object.entries(kpis) as [KpiKey, KpiDefinition][]).map(([key, metric]) => {
            const Icon = metric.icon;
            return <button key={key} className={`kpi-story-tab kpi-${metric.accent} ${activeKpi === key ? "active" : ""}`} onClick={() => setActiveKpi(key)}><span><Icon size={15}/>{metric.label}</span><strong>{metric.value === null ? "—" : euro.format(metric.value)}</strong><small>{metric.hint}</small></button>;
          })}
        </div>
        <div className="kpi-story-body">
          <div className="kpi-story-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
                <defs><linearGradient id="guidedArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--section-accent)" stopOpacity=".32"/><stop offset="100%" stopColor="var(--section-accent)" stopOpacity="0"/></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="var(--border-soft)"/><XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }}/><YAxis hide domain={["dataMin", "dataMax"]}/><Tooltip formatter={(value) => euro.format(Number(value))}/><Area type="monotone" dataKey="value" stroke="var(--section-accent)" strokeWidth={2.6} fill="url(#guidedArea)" activeDot={{ r: 5 }}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="kpi-explain-card"><span className="kpi-explain-label">Pourquoi ce KPI compte</span><h3>{activeMetric.label}</h3><p>{explanation}</p><small>La courbe de cette preview est illustrative : elle sert uniquement à tester l'interaction et la hiérarchie visuelle.</small><button>Voir la chaîne de calcul <Network size={13}/></button></div>
        </div>
      </section>

      <section className="guided-journeys">
        <div className="guided-panel-head"><div><span className="eyebrow">Guided paths</span><h2>Commencez par votre question, pas par un onglet</h2></div></div>
        <div className="journey-grid">
          {JOURNEYS.map(({ icon: Icon, title, text, href, nodes }) => <Link href={href} className="journey-card" key={title}><span className="journey-icon"><Icon size={18}/></span><h3>{title}</h3><p>{text}</p><div className="journey-mini-flow">{nodes.map((node, index) => <span key={node}><i>{node}</i>{index < nodes.length - 1 ? <ChevronRight size={11}/> : null}</span>)}</div><em>Explorer <ArrowRight size={12}/></em></Link>)}
        </div>
      </section>

      <section className="guided-deep-dive">
        <div><span className="eyebrow">When you want more depth</span><h2>La simplicité à l'écran ne limite jamais le moteur.</h2><p>Les données brutes, hypothèses, calculs, événements, documents et scénarios restent accessibles lorsque vous décidez de descendre dans le détail.</p></div>
        <div className="deep-dive-stack"><span>Source fact</span><ArrowRight size={12}/><span>Normalized fact</span><ArrowRight size={12}/><span>Engine</span><ArrowRight size={12}/><span>Derived value</span><ArrowRight size={12}/><span>Decision</span></div>
      </section>
    </div>
  );
}
