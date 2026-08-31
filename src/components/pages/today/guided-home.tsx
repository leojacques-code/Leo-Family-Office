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
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
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
  { id: "banking", label: "Banking", detail: "Comptes, transactions, liquidité", icon: Banknote, x: "8%", y: "18%", color: "cyan", href: "/cash-flow", metric: "Cash & flux" },
  { id: "career", label: "Career", detail: "Salaire, contrat, capital humain", icon: BriefcaseBusiness, x: "72%", y: "9%", color: "blue", href: "/career", metric: "Revenus" },
  { id: "investments", label: "Investments", detail: "PEA, CTO, allocation, risque", icon: TrendingUp, x: "84%", y: "46%", color: "violet", href: "/investments", metric: "Capital investi" },
  { id: "real-estate", label: "Real Estate", detail: "Biens, projets, financement", icon: Building2, x: "70%", y: "82%", color: "teal", href: "/real-estate", metric: "Equity & projets" },
  { id: "debt", label: "Debt", detail: "Contrats, échéanciers, engagements", icon: Landmark, x: "14%", y: "78%", color: "orange", href: "/debt", metric: "Obligations" },
  { id: "business", label: "Business", detail: "Participations, valeur, cash", icon: Network, x: "3%", y: "48%", color: "pink", href: "/business-equity", metric: "Private equity" },
] as const;

const SOURCE_ITEMS = [
  { label: "Banque", icon: Banknote, status: "Synchronisé", tone: "good" },
  { label: "Courtier", icon: TrendingUp, status: "À rapprocher", tone: "warn" },
  { label: "Documents", icon: FileText, status: "3 sources", tone: "neutral" },
  { label: "Données publiques", icon: Database, status: "Disponible", tone: "good" },
] as const;

const JOURNEYS = [
  { icon: WalletCards, title: "Comprendre mon patrimoine", text: "Valeur, liquidité, dette et concentration dans une seule lecture.", href: "/net-worth", nodes: ["Wealth", "Liquidity", "Debt"] },
  { icon: CircleDollarSign, title: "Améliorer ma liberté mensuelle", text: "Revenus, charges, dette, épargne et fonds de sécurité reliés entre eux.", href: "/cash-flow", nodes: ["Income", "Costs", "Savings"] },
  { icon: Building2, title: "Préparer un projet immobilier", text: "Cash, financement, coût complet, exploitation et scénarios avant décision.", href: "/real-estate", nodes: ["Cash", "Debt", "Property"] },
  { icon: WandSparkles, title: "Tester une décision", text: "Changer une hypothèse et voir immédiatement les effets sur votre trajectoire.", href: "/decision-lab", nodes: ["Facts", "Scenario", "Decision"] },
] as const;

const INBOX = [
  { icon: FileCheck2, title: "2 éléments méritent une validation", text: "LFO a détecté des données qui pourraient être rapprochées avant votre prochaine analyse.", action: "Ouvrir la revue", tone: "violet" },
  { icon: RefreshCw, title: "Vos sources n'ont pas toutes la même fraîcheur", text: "La vue guidée distingue ce qui est observé, ancien ou encore hypothétique.", action: "Voir les sources", tone: "cyan" },
  { icon: Target, title: "Vos objectifs peuvent piloter les arbitrages", text: "Relier une décision à un objectif évite d'optimiser un KPI isolé.", action: "Voir les objectifs", tone: "pink" },
] as const;

type KpiKey = "netWorth" | "liquidity" | "freedom" | "invested" | "debt";
type KpiDefinition = { label: string; value: number | null; icon: LucideIcon; hint: string; accent: string; relation: string };

function safeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export default function GuidedHome({ state }: SectionProps) {
  const [activeNode, setActiveNode] = useState<(typeof DOMAIN_NODES)[number]["id"]>("banking");
  const [activeKpi, setActiveKpi] = useState<KpiKey>("netWorth");
  const [range, setRange] = useState<"1Y" | "5Y" | "MAX">("5Y");

  const totalDebt = useMemo(
    () => state.liabilities.reduce((sum, liability) => sum + safeNumber(liability.currentBalance), 0),
    [state.liabilities],
  );

  const kpis = useMemo<Record<KpiKey, KpiDefinition>>(() => ({
    netWorth: { label: "Patrimoine net", value: state.metrics.netWorth, icon: WalletCards, hint: "Actifs − dettes", accent: "blue", relation: "Solvabilité consolidée" },
    liquidity: { label: "Liquidité", value: state.metrics.bankCash, icon: Banknote, hint: "Cash bancaire identifié", accent: "cyan", relation: "Capacité à absorber les échéances" },
    freedom: { label: "Liberté mensuelle", value: state.metrics.freeCashFlow, icon: CircleDollarSign, hint: "Cash-flow mensuel connu", accent: "green", relation: "Marge disponible pour les objectifs" },
    invested: { label: "Capital investi", value: state.metrics.grossAssets, icon: TrendingUp, hint: `${state.accounts.length} comptes consolidés`, accent: "violet", relation: "Capital exposé aux marchés" },
    debt: { label: "Dette exposée", value: totalDebt, icon: Landmark, hint: `${state.liabilities.length} engagement(s)`, accent: "orange", relation: "Obligations futures contractuelles" },
  }), [state, totalDebt]);

  const activeMetric = kpis[activeKpi];
  const activeDomain = DOMAIN_NODES.find((node) => node.id === activeNode) ?? DOMAIN_NODES[0];
  const ActiveDomainIcon = activeDomain.icon;
  const base = Math.max(Math.abs(activeMetric.value ?? 100000), 1);

  const trend = useMemo(() => {
    const factors = range === "1Y"
      ? [0.91, 0.925, 0.94, 0.952, 0.96, 0.971, 0.966, 0.982, 0.989, 1.003, 1.01, 1]
      : range === "5Y"
        ? [0.62, 0.66, 0.71, 0.69, 0.75, 0.79, 0.82, 0.86, 0.9, 0.94, 0.97, 1]
        : [0.28, 0.34, 0.39, 0.47, 0.52, 0.58, 0.67, 0.72, 0.81, 0.88, 0.95, 1];
    return factors.map((factor, index) => ({ period: `${index + 1}`, value: base * factor, benchmark: base * factor * (0.93 + index * 0.004) }));
  }, [base, range]);

  const monthlyFlow = useMemo(() => {
    const income = safeNumber(state.metrics.monthlyIncome);
    const expenses = safeNumber(state.metrics.monthlyExpenses);
    const debt = safeNumber(state.metrics.monthlyDebtService);
    const free = safeNumber(state.metrics.freeCashFlow);
    return [
      { name: "Revenus", value: Math.max(income, 0), fill: "#63e6a6" },
      { name: "Dépenses", value: Math.max(expenses, 0), fill: "#ff9366" },
      { name: "Dette", value: Math.max(debt, 0), fill: "#ffbf69" },
      { name: "Libre", value: Math.max(free, 0), fill: "#55dcff" },
    ];
  }, [state.metrics.monthlyIncome, state.metrics.monthlyExpenses, state.metrics.monthlyDebtService, state.metrics.freeCashFlow]);

  const capitalMap = useMemo(() => {
    const gross = Math.max(safeNumber(state.metrics.grossAssets), 0);
    const cash = Math.max(safeNumber(state.metrics.bankCash), 0);
    return [
      { name: "Actifs financiers", value: Math.max(gross - cash, 0), fill: "#5d8cff" },
      { name: "Liquidité", value: cash, fill: "#55dcff" },
      { name: "Dette", value: totalDebt, fill: "#ff9f68" },
    ].filter((item) => item.value > 0);
  }, [state.metrics.grossAssets, state.metrics.bankCash, totalDebt]);

  const explanation = activeKpi === "netWorth"
    ? "Le patrimoine mesure la solvabilité globale, mais ne dit pas ce qui est immédiatement disponible."
    : activeKpi === "liquidity"
      ? "La liquidité mesure les ressources mobilisables sans devoir céder un actif difficilement vendable."
      : activeKpi === "freedom"
        ? "La marge mensuelle relie revenus, dépenses, dette et capacité réelle à financer vos projets futurs."
        : activeKpi === "invested"
          ? "Le capital investi doit être lu avec son risque, son horizon, sa fiscalité et sa fonction dans vos objectifs."
          : "La dette est un calendrier d'engagements : montant, durée, coût et assurance modifient votre trajectoire.";

  const formattedActiveValue = activeMetric.value === null ? "—" : euro.format(activeMetric.value);
  const completeness = Math.round(state.metrics.dataCompleteness * 100);

  return (
    <div className="guided-home guided-home-v5">
      <section className="guided-hero v5-guided-hero">
        <div className="v5-hero-copy">
          <span className="guided-kicker"><Sparkles size={13} /> Family Office command center</span>
          <h1>Votre vie financière, <span>enfin reliée.</span></h1>
          <p>LFO rassemble les sources, relie les faits entre eux et vous guide vers ce qui mérite une décision. La complexité reste disponible, mais elle n&apos;est jamais le point d&apos;entrée.</p>
          <div className="v5-hero-proof">
            <span><ShieldCheck size={12}/> {completeness}% structuré</span>
            <span><Database size={12}/> {SOURCE_ITEMS.length} familles de sources</span>
            <span><Network size={12}/> {DOMAIN_NODES.length} domaines reliés</span>
          </div>
        </div>
        <div className="guided-hero-actions">
          <button className="button secondary"><FileText size={15} /> Ajouter une source</button>
          <Link className="button primary" href="/decision-lab"><WandSparkles size={15} /> Tester une décision</Link>
        </div>
      </section>

      <section className="guided-status-bar v5-status-bar">
        <div><span className="status-pulse" /><strong>{completeness}%</strong><span>de votre vue actuelle est structurée</span></div>
        <div><ShieldCheck size={14} /><span>Faits, hypothèses et projections restent séparés</span></div>
        <div className="v5-live-chip"><Zap size={12}/> Financial truth live</div>
        <button>Voir la provenance <ChevronRight size={13} /></button>
      </section>

      <section className="guided-universe-layout v5-universe-layout">
        <article className="wealth-universe-panel v5-universe-panel">
          <div className="guided-panel-head">
            <div><span className="eyebrow">Wealth Universe</span><h2>Votre système financier vivant</h2><p>Survolez mentalement les relations : chaque domaine existe dans un même système de cash, de valeur et de décisions.</p></div>
            <span className="prototype-pill"><Orbit size={12} /> Interactive map</span>
          </div>
          <div className="wealth-universe v5-wealth-universe">
            <div className="universe-grid" />
            <div className="v5-starfield" />
            <div className="universe-orbit orbit-a" />
            <div className="universe-orbit orbit-b" />
            <div className="v5-orbit orbit-c" />
            <div className="wealth-globe v5-wealth-globe">
              <div className="globe-latitude lat-a" /><div className="globe-latitude lat-b" />
              <div className="globe-longitude long-a" /><div className="globe-longitude long-b" />
              <div className="v5-globe-continent continent-a"/><div className="v5-globe-continent continent-b"/>
              <div className="globe-core"><span>YOU</span><strong>{state.metrics.netWorth === null ? "—" : compact.format(state.metrics.netWorth)}</strong><small>patrimoine net</small></div>
              <span className="globe-particle p1" /><span className="globe-particle p2" /><span className="globe-particle p3" />
              <span className="v5-globe-ring" />
            </div>
            <svg className="universe-links v5-universe-links" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="universeLineV5" x1="0" x2="1"><stop offset="0" stopColor="#55dcff" stopOpacity=".12"/><stop offset=".48" stopColor="#5d8cff" stopOpacity=".9"/><stop offset="1" stopColor="#f27bc7" stopOpacity=".12"/></linearGradient>
              </defs>
              <path d="M500 300 C330 215 260 180 150 130"/><path d="M500 300 C650 205 730 150 840 115"/><path d="M500 300 C680 300 770 295 910 300"/><path d="M500 300 C650 410 700 465 820 500"/><path d="M500 300 C360 420 275 455 170 470"/><path d="M500 300 C330 300 205 300 95 300"/>
            </svg>
            {DOMAIN_NODES.map(({ id, label, icon: Icon, x, y, color, metric }) => (
              <button key={id} className={`universe-node node-${color} ${activeNode === id ? "active" : ""}`} style={{ left: x, top: y }} onClick={() => setActiveNode(id)}>
                <span><Icon size={17}/></span><strong>{label}</strong><small>{metric}</small>
              </button>
            ))}
            <div className="v5-orbit-tag tag-a">Sources</div><div className="v5-orbit-tag tag-b">Engines</div><div className="v5-orbit-tag tag-c">Goals</div>
          </div>
          <div className="universe-context-strip v5-context-strip">
            <div className={`context-icon node-${activeDomain.color}`}><ActiveDomainIcon size={18}/></div>
            <div><span>{activeDomain.label}</span><strong>{activeDomain.detail}</strong></div>
            <div className="context-flow"><i/><span>connecté à la vérité consolidée</span><i/></div>
            <Link href={activeDomain.href}>Explorer <ArrowRight size={13}/></Link>
          </div>
        </article>

        <aside className="financial-inbox-panel v5-inbox-panel">
          <div className="guided-panel-head"><div><span className="eyebrow">Guided inbox</span><h2>Ce qui mérite votre attention</h2><p>Une file courte, priorisée et explicable.</p></div><span className="inbox-count">3</span></div>
          <div className="inbox-list">
            {INBOX.map(({ icon: Icon, title, text, action, tone }, index) => (
              <button key={title} className={`inbox-item inbox-${tone} v5-inbox-item`}>
                <span className="inbox-icon"><Icon size={16}/></span>
                <span><small className="v5-inbox-priority">0{index + 1}</small><strong>{title}</strong><small>{text}</small><em>{action} <ArrowRight size={11}/></em></span>
              </button>
            ))}
          </div>
          <div className="source-health v5-source-health">
            <div><span>Source health</span><strong>{SOURCE_ITEMS.length}</strong></div>
            {SOURCE_ITEMS.map(({ label, icon: Icon, status, tone }) => <div className="source-health-row" key={label}><span className="v5-source-icon"><Icon size={13}/></span><span>{label}</span><small className={tone}>{status}</small></div>)}
          </div>
        </aside>
      </section>

      <section className="v5-home-analytics-grid">
        <article className="kpi-story-panel v5-kpi-story-panel">
          <div className="guided-panel-head">
            <div><span className="eyebrow">Interactive KPI story</span><h2>Un chiffre n&apos;a de sens qu&apos;avec son contexte</h2></div>
            <div className="chart-range-control">{(["1Y", "5Y", "MAX"] as const).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
          </div>
          <div className="kpi-story-tabs v5-kpi-tabs">
            {(Object.entries(kpis) as [KpiKey, KpiDefinition][]).map(([key, item]) => {
              const Icon = item.icon;
              return <button className={`kpi-story-tab kpi-${item.accent} ${key === activeKpi ? "active" : ""}`} key={key} onClick={() => setActiveKpi(key)}><span><Icon size={14}/>{item.label}</span><strong>{item.value === null ? "—" : compact.format(item.value)}</strong><small>{item.hint}</small></button>;
            })}
          </div>
          <div className="kpi-story-main v5-kpi-main">
            <div className="kpi-story-value">
              <span>{activeMetric.label}</span><strong>{formattedActiveValue}</strong><small>{activeMetric.relation}</small>
              <p>{explanation}</p>
              <div className="v5-kpi-links"><span>Observed / derived</span><button>Explain lineage <ArrowRight size={11}/></button></div>
            </div>
            <div className="kpi-story-chart v5-kpi-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="v5PrimaryArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5d8cff" stopOpacity={0.45}/><stop offset="55%" stopColor="#55dcff" stopOpacity={0.12}/><stop offset="100%" stopColor="#5d8cff" stopOpacity={0}/></linearGradient>
                    <linearGradient id="v5BenchmarkArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a879ff" stopOpacity={0.16}/><stop offset="100%" stopColor="#a879ff" stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "var(--chart-tick)", fontSize: 9 }} />
                  <YAxis tickFormatter={(value) => compact.format(Number(value))} tickLine={false} axisLine={false} width={48} tick={{ fill: "var(--chart-tick)", fontSize: 9 }} />
                  <Tooltip formatter={(value) => euro.format(Number(value))} />
                  <Area type="monotone" dataKey="benchmark" stroke="#a879ff" strokeWidth={1.3} strokeDasharray="4 5" fill="url(#v5BenchmarkArea)" dot={false}/>
                  <Area type="monotone" dataKey="value" stroke="#55dcff" strokeWidth={2.8} fill="url(#v5PrimaryArea)" activeDot={{ r: 5, fill: "#fff", stroke: "#55dcff", strokeWidth: 3 }} dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
              <span className="v5-chart-note">Trajectoire visuelle illustrative · le KPI courant reste issu de vos données.</span>
            </div>
          </div>
        </article>

        <article className="v5-analytics-side">
          <div className="v5-mini-panel v5-flow-panel">
            <div className="v5-mini-head"><div><span className="eyebrow">Monthly freedom</span><h3>Flux mensuels connus</h3></div><CircleDollarSign size={16}/></div>
            <div className="v5-mini-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyFlow} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--chart-tick)", fontSize: 8 }} />
                  <Tooltip formatter={(value) => euro.format(Number(value))} />
                  <Bar dataKey="value" radius={[7, 7, 2, 2]}>{monthlyFlow.map((item) => <Cell key={item.name} fill={item.fill}/>)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="v5-mini-panel v5-capital-panel">
            <div className="v5-mini-head"><div><span className="eyebrow">Capital map</span><h3>Valeur, liquidité, dette</h3></div><WalletCards size={16}/></div>
            <div className="v5-capital-content">
              <div className="v5-donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={capitalMap} dataKey="value" nameKey="name" innerRadius={39} outerRadius={61} paddingAngle={3} stroke="none">{capitalMap.map((item) => <Cell key={item.name} fill={item.fill}/>)}</Pie><Tooltip formatter={(value) => euro.format(Number(value))}/></PieChart></ResponsiveContainer><div><strong>{capitalMap.length}</strong><span>layers</span></div></div>
              <div className="v5-capital-legend">{capitalMap.map((item) => <div key={item.name}><i style={{ background: item.fill }}/><span>{item.name}</span><strong>{compact.format(item.value)}</strong></div>)}</div>
            </div>
          </div>
        </article>
      </section>

      <section className="data-story-panel v5-data-story-panel">
        <div className="guided-panel-head"><div><span className="eyebrow">How LFO thinks</span><h2>Des sources dispersées vers une décision explicable</h2><p>La donnée n&apos;est utile que si elle garde sa provenance, son statut et ses liens avec les autres domaines.</p></div><span className="data-story-caption">live concept</span></div>
        <div className="data-story-flow v5-story-flow">
          <div className="story-node"><span><Database size={16}/></span><strong>Sources</strong><small>Banques, documents, APIs</small></div><div className="story-edge"><i/><i/><i/></div>
          <div className="story-node"><span><FileCheck2 size={16}/></span><strong>Réconciliation</strong><small>Les faits se confirment</small></div><div className="story-edge"><i/><i/><i/></div>
          <div className="story-node"><span><Activity size={16}/></span><strong>Moteurs</strong><small>Cash, dette, fiscalité, valo</small></div><div className="story-edge"><i/><i/><i/></div>
          <div className="story-node featured"><span><WalletCards size={16}/></span><strong>Vérité financière</strong><small>Une vue consolidée</small></div><div className="story-edge"><i/><i/><i/></div>
          <div className="story-node"><span><Goal size={16}/></span><strong>Décisions</strong><small>Objectifs, risques, scénarios</small></div>
        </div>
      </section>

      <section className="guided-deep-dive v5-deep-dive">
        <div className="guided-panel-head"><div><span className="eyebrow">Guided journeys</span><h2>Entrez par votre question, pas par le nom d&apos;un moteur</h2></div></div>
        <div className="journey-grid">{JOURNEYS.map(({ icon: Icon, title, text, href, nodes }) => <Link href={href} className="journey-card" key={title}><span className="journey-icon"><Icon size={17}/></span><strong>{title}</strong><p>{text}</p><div className="journey-nodes">{nodes.map((node, index) => <span key={node}>{index > 0 ? <i/> : null}<em>{node}</em></span>)}</div><small>Commencer <ArrowRight size={11}/></small></Link>)}</div>
      </section>
    </div>
  );
}
