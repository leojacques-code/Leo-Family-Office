"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, BriefcaseBusiness, Building2, CalendarRange, Check, ChevronDown, CircleDollarSign,
  Command, Download, FlaskConical, FolderLock, Globe2, Landmark, Laptop, LayoutDashboard, LogOut,
  Menu, Moon, MoreHorizontal, Network, ReceiptText, RefreshCw, Search, Settings2, ShieldCheck,
  Sparkles, Sun, Target, TrendingUp, WalletCards, X, type LucideIcon,
} from "lucide-react";
import type { DashboardState, ProjectionEnvelope } from "@/lib/types";
import type { Mutation } from "@/lib/data/contracts";
import { NAV_ITEMS, sectionLabel } from "@/lib/navigation";
import { Modal, ExplanationPanel, type Explanation } from "@/components/ui";
import { SectionContent } from "@/components/pages";
import { formatDate } from "@/components/pages/shared";

const ICONS: Record<string, LucideIcon> = {
  today: LayoutDashboard,
  "net-worth": WalletCards,
  "cash-flow": CircleDollarSign,
  investments: TrendingUp,
  debt: Landmark,
  "real-estate": Building2,
  career: BriefcaseBusiness,
  "business-equity": Network,
  tax: ReceiptText,
  scenarios: AreaChart,
  "decision-lab": FlaskConical,
  goals: Target,
  documents: FolderLock,
  timeline: CalendarRange,
  settings: Settings2,
};

const PRIMARY_NAV_IDS = new Set([
  "today", "net-worth", "cash-flow", "investments", "real-estate", "decision-lab", "goals",
]);
const QUICK_SECTION_IDS = new Set(["today", "net-worth", "investments", "scenarios", "goals"]);

const SECTION_CONTEXT: Record<string, string> = {
  today: "Executive overview",
  "net-worth": "Consolidated balance sheet",
  "cash-flow": "Liquidity & recurring flows",
  investments: "Portfolio intelligence",
  debt: "Liabilities & maturities",
  "real-estate": "Property portfolio",
  career: "Human capital trajectory",
  "business-equity": "Private ownership",
  tax: "Tax position & obligations",
  scenarios: "Projection studio",
  "decision-lab": "Decision simulation workspace",
  goals: "Life objectives & feasibility",
  imports: "Data acquisition",
  documents: "Private records",
  timeline: "Financial chronology",
  settings: "Workspace configuration",
};

type ThemePreference = "system" | "light" | "dark";

const WORKSPACES = [
  { id: "personal", label: "Patrimoine personnel", detail: "Consolidé · EUR", icon: "LC" },
  { id: "financial", label: "Actifs financiers", detail: "Comptes & marchés", icon: "€" },
  { id: "projects", label: "Projets & décisions", detail: "Scénarios privés", icon: "◇" },
] as const;

function resolveTheme(preference: ThemePreference) {
  if (preference !== "system") return preference;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function AppShell({ initialState, section }: { initialState: DashboardState; section: string }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [projection, setProjection] = useState<ProjectionEnvelope | null>(null);

  const [workspaceId, setWorkspaceId] = useState<(typeof WORKSPACES)[number]["id"]>("personal");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [globeOpen, setGlobeOpen] = useState(false);
  const [networkMode, setNetworkMode] = useState<"map" | "flow" | "pulse">("map");
  const [networkRange, setNetworkRange] = useState<"1Y" | "5Y" | "MAX">("5Y");
  const commandInputRef = useRef<HTMLInputElement>(null);

  async function mutate(mutation: Mutation) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Modification impossible");
      setState(body);
      return true;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Modification impossible");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("Actualisation impossible");
      setState(await response.json());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Actualisation impossible");
    } finally { setBusy(false); }
  }

  async function runProjection(scenarioId: string, years = 30, simulations = 3000, seed = 19082026) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/projection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId, years, simulations, seed }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Projection impossible");
      setProjection(body);
      return body as ProjectionEnvelope;
    } catch (projectionError) {
      setError(projectionError instanceof Error ? projectionError.message : "Projection impossible");
      return null;
    } finally { setBusy(false); }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("lfo-theme") as ThemePreference | null;
    const preference: ThemePreference = saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    setThemePreference(preference);
    document.documentElement.dataset.theme = resolveTheme(preference);

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystem = () => {
      const current = (window.localStorage.getItem("lfo-theme") as ThemePreference | null) ?? "system";
      if (current === "system") document.documentElement.dataset.theme = resolveTheme("system");
    };
    media.addEventListener?.("change", syncSystem);
    return () => media.removeEventListener?.("change", syncSystem);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setWorkspaceOpen(false);
        setMoreOpen(false);
        setThemeOpen(false);
        setGlobeOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!commandOpen) return;
    const frame = window.requestAnimationFrame(() => commandInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [commandOpen]);

  function chooseTheme(preference: ThemePreference) {
    setThemePreference(preference);
    window.localStorage.setItem("lfo-theme", preference);
    document.documentElement.dataset.theme = resolveTheme(preference);
    setThemeOpen(false);
  }

  const label = sectionLabel(section);
  const asOfLabel = formatDate(state.asOfDate);
  const SectionIcon = ICONS[section] ?? LayoutDashboard;
  const sectionContext = SECTION_CONTEXT[section] ?? "Private wealth workspace";
  const quickItems = NAV_ITEMS.filter((item) => QUICK_SECTION_IDS.has(item.id));
  const primaryItems = NAV_ITEMS.filter((item) => PRIMARY_NAV_IDS.has(item.id));
  const secondaryItems = NAV_ITEMS.filter((item) => !PRIMARY_NAV_IDS.has(item.id));
  const selectedWorkspace = WORKSPACES.find((item) => item.id === workspaceId) ?? WORKSPACES[0];
  const resolvedTheme = resolveTheme(themePreference);

  const commandItems = useMemo(() => {
    const q = commandQuery.trim().toLocaleLowerCase("fr-FR");
    const nav = NAV_ITEMS.map((item) => ({
      id: item.id,
      label: item.label,
      detail: SECTION_CONTEXT[item.id] ?? "Ouvrir cet espace",
      href: item.href,
      icon: ICONS[item.id] ?? LayoutDashboard,
    }));
    if (!q) return nav;
    return nav.filter((item) => `${item.label} ${item.detail}`.toLocaleLowerCase("fr-FR").includes(q));
  }, [commandQuery]);

  return (
    <div className="app-shell" data-section={section}>
      <div className="workspace-ambient" aria-hidden="true" />
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand-lockup"><span className="brand-mark">LF</span><span><strong>Léo</strong><small>Family Office</small></span></div>
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu"><X size={18} /></button>
        </div>

        <div className="workspace-switcher-wrap">
          <button className={`profile-switch profile-switch-button ${workspaceOpen ? "open" : ""}`} onClick={() => setWorkspaceOpen((value) => !value)} aria-expanded={workspaceOpen}>
            <span className="avatar">{selectedWorkspace.icon}</span>
            <span><strong>{selectedWorkspace.label}</strong><small>{selectedWorkspace.detail}</small></span>
            <ChevronDown size={14} />
          </button>
          {workspaceOpen ? (
            <div className="rich-menu workspace-menu" role="menu">
              <span className="menu-caption">Contexte</span>
              {WORKSPACES.map((workspace) => (
                <button key={workspace.id} className={workspace.id === workspaceId ? "selected" : ""} onClick={() => { setWorkspaceId(workspace.id); setWorkspaceOpen(false); }} role="menuitem">
                  <span className="menu-icon-tile">{workspace.icon}</span>
                  <span><strong>{workspace.label}</strong><small>{workspace.detail}</small></span>
                  {workspace.id === workspaceId ? <Check size={14} /> : null}
                </button>
              ))}
              <div className="menu-separator" />
              <button role="menuitem"><Settings2 size={15} /><span><strong>Gérer les espaces</strong><small>Personnalisation conceptuelle</small></span></button>
            </div>
          ) : null}
        </div>

        <nav aria-label="Navigation principale" className="primary-navigation">
          <span className="nav-group-label">Cockpit</span>
          {primaryItems.map((item) => {
            const Icon = ICONS[item.id] ?? LayoutDashboard;
            const active = section === item.id;
            return <Link key={item.id} href={item.href} className={active ? "active" : ""} onClick={() => setMobileOpen(false)}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span></Link>;
          })}
          <div className="nav-more-wrap">
            <button className={`nav-more-button ${secondaryItems.some((item) => item.id === section) ? "active" : ""}`} onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen}>
              <MoreHorizontal size={17} /><span>Plus</span><ChevronDown size={13} />
            </button>
            {moreOpen ? (
              <div className="rich-menu nav-more-menu">
                <span className="menu-caption">Espaces avancés</span>
                {secondaryItems.map((item) => {
                  const Icon = ICONS[item.id] ?? LayoutDashboard;
                  return <Link key={item.id} href={item.href} className={section === item.id ? "selected" : ""} onClick={() => { setMoreOpen(false); setMobileOpen(false); }}><span className="menu-icon-tile"><Icon size={15} /></span><span><strong>{item.label}</strong><small>{SECTION_CONTEXT[item.id] ?? "Ouvrir"}</small></span>{section === item.id ? <Check size={14} /> : null}</Link>;
                })}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="sidebar-footer">
          <button className="privacy-status privacy-button" onClick={() => setGlobeOpen(true)}><ShieldCheck size={16} /><span><strong>Private workspace</strong><small>Explore wealth network</small></span><Globe2 size={13} /></button>
          <button className="logout-button" onClick={logout}><LogOut size={16} />Déconnexion</button>
        </div>
      </aside>

      {mobileOpen ? <button className="mobile-overlay" aria-label="Fermer le menu" onClick={() => setMobileOpen(false)} /> : null}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"><Menu size={19} /></button>
            <span className="section-signal" aria-hidden="true"><SectionIcon size={17} strokeWidth={1.8} /></span>
            <button className="topbar-context context-title-button" onClick={() => setWorkspaceOpen((value) => !value)} aria-label="Changer de contexte">
              <span className="breadcrumb">Léo Family Office</span>
              <span className="context-title-line"><strong>{label}</strong><ChevronDown size={12} /></span>
              <small>{sectionContext}</small>
            </button>
          </div>
          <div className="topbar-actions">
            <button className="command-hint command-button" onClick={() => setCommandOpen(true)}><Command size={13} /> Rechercher <kbd>⌘K</kbd></button>
            <span className="as-of"><span className="status-dot" />Au {asOfLabel}</span>
            <button className="icon-button" onClick={refresh} aria-label="Actualiser" title="Actualiser"><RefreshCw className={busy ? "spin" : ""} size={17} /></button>
            <div className="theme-menu-wrap">
              <button className="icon-button" onClick={() => setThemeOpen((value) => !value)} aria-label="Choisir le thème" title="Thème">{resolvedTheme === "dark" ? <Moon size={17} /> : <Sun size={17} />}</button>
              {themeOpen ? (
                <div className="rich-menu theme-menu" role="menu">
                  {([ ["system", Laptop, "Système"], ["light", Sun, "Clair"], ["dark", Moon, "Sombre"] ] as const).map(([value, Icon, text]) => (
                    <button key={value} onClick={() => chooseTheme(value)} className={themePreference === value ? "selected" : ""} role="menuitem"><span className="menu-icon-tile"><Icon size={15} /></span><span><strong>{text}</strong><small>{value === "system" ? "Suit votre appareil" : value === "light" ? "Porcelaine & glacier" : "Abyss & signal"}</small></span>{themePreference === value ? <Check size={14} /> : null}</button>
                  ))}
                </div>
              ) : null}
            </div>
            <button className="icon-button globe-toolbar-button" onClick={() => setGlobeOpen((value) => !value)} aria-label="Ouvrir la carte d'exposition" title="Wealth network"><Globe2 size={17} /></button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- download API route, not a page */}
            <a className="button secondary export-button" href="/api/export?format=csv"><Download size={15} />Exporter</a>
          </div>
        </header>

        <nav className="section-rail" aria-label="Accès rapide aux espaces clés">
          <span className="section-rail-label">Quick access</span>
          {quickItems.map((item) => {
            const QuickIcon = ICONS[item.id] ?? LayoutDashboard;
            return <Link key={item.id} href={item.href} className={section === item.id ? "active" : ""}><QuickIcon size={13} strokeWidth={1.8} />{item.label}</Link>;
          })}
        </nav>

        {error ? <div className="global-error"><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div> : null}
        <main className="content-area">
          <SectionContent section={section} state={state} mutate={mutate} busy={busy} setExplanation={setExplanation} projection={projection} runProjection={runProjection} refresh={refresh} />
        </main>
      </div>

      {commandOpen ? (
        <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setCommandOpen(false); }}>
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="Palette de commandes">
            <div className="command-search"><Search size={18} /><input ref={commandInputRef} value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="Rechercher un onglet, un compte, une action…" /><kbd>ESC</kbd></div>
            <div className="command-body">
              <span className="menu-caption">Navigation</span>
              {commandItems.slice(0, 9).map((item) => {
                const Icon = item.icon;
                return <button key={item.id} onClick={() => { setCommandOpen(false); setCommandQuery(""); router.push(item.href); }}><span className="menu-icon-tile"><Icon size={16} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><span className="command-enter">↵</span></button>;
              })}
              {commandItems.length === 0 ? <div className="command-empty"><Sparkles size={17} /><span>Aucun résultat. Essayez « investissement », « dette » ou « goals ».</span></div> : null}
            </div>
            <footer className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span><span><kbd>↵</kbd> ouvrir</span><span><kbd>esc</kbd> fermer</span></footer>
          </section>
        </div>
      ) : null}

      {globeOpen ? (
        <aside className="wealth-network-panel" aria-label="Global wealth network">
          <div className="wealth-network-head"><div><span className="eyebrow">Global exposure</span><h3>Wealth network</h3><p>Une vue conceptuelle des juridictions, devises et flux reliés au patrimoine.</p></div><button className="icon-button" onClick={() => setGlobeOpen(false)} aria-label="Fermer"><X size={16} /></button></div>
          <div className="network-segmented" role="tablist" aria-label="Vue wealth network">
            {([ ["map", "Map"], ["flow", "Flow"], ["pulse", "Pulse"] ] as const).map(([value, text]) => (
              <button key={value} className={networkMode === value ? "active" : ""} onClick={() => setNetworkMode(value)} role="tab" aria-selected={networkMode === value}>{text}</button>
            ))}
          </div>

          {networkMode === "map" ? (
            <div className="wealth-globe-stage" tabIndex={0}>
              <div className="wealth-globe">
                <i className="globe-lat one" /><i className="globe-lat two" /><i className="globe-lat three" />
                <i className="globe-long one" /><i className="globe-long two" /><i className="globe-long three" />
                <button className="geo-node paris"><b />Paris<small>EUR · Core</small></button>
                <button className="geo-node world"><b />World ETF<small>Global equity</small></button>
                <button className="geo-node property"><b />Property<small>Real estate</small></button>
                <span className="orbit-dot" />
              </div>
              <svg className="globe-arcs" viewBox="0 0 420 300" aria-hidden="true"><path d="M76 195 C160 55 270 56 356 152" /><path d="M110 228 C204 290 300 245 342 154" /></svg>
            </div>
          ) : null}

          {networkMode === "flow" ? (
            <div className="wealth-flow-canvas">
              <div className="flow-card source"><span className="flow-card-icon"><BriefcaseBusiness size={16} /></span><span><small>Source</small><strong>Active income</strong><em>€ / month</em></span></div>
              <div className="flow-card cash"><span className="flow-card-icon"><CircleDollarSign size={16} /></span><span><small>Liquidity</small><strong>Bank cash</strong><em>Buffer & transfers</em></span></div>
              <div className="flow-card invest"><span className="flow-card-icon"><TrendingUp size={16} /></span><span><small>Investment</small><strong>PEA</strong><em>Recurring allocation</em></span></div>
              <div className="flow-card market"><span className="flow-card-icon"><Globe2 size={16} /></span><span><small>Exposure</small><strong>World ETF</strong><em>Global equities</em></span></div>
              <svg viewBox="0 0 360 270" className="flow-connectors" aria-hidden="true"><path d="M104 59 C158 59 168 112 218 112"/><path d="M218 130 C175 148 167 205 104 205"/><path d="M122 205 C190 205 220 210 273 210"/></svg>
              <span className="flow-particle a"/><span className="flow-particle b"/><span className="flow-particle c"/>
            </div>
          ) : null}

          {networkMode === "pulse" ? (
            <div className="network-pulse-card">
              <div className="pulse-toolbar"><span><small>Illustrative wealth trajectory</small><strong>Momentum</strong></span><div>{(["1Y","5Y","MAX"] as const).map((range) => <button key={range} className={networkRange === range ? "active" : ""} onClick={() => setNetworkRange(range)}>{range}</button>)}</div></div>
              <div className="pulse-kpi"><strong>{networkRange === "1Y" ? "+8.4%" : networkRange === "5Y" ? "+46.7%" : "+132%"}</strong><span>illustrative performance · visual prototype</span></div>
              <svg viewBox="0 0 340 170" className="pulse-chart" preserveAspectRatio="none" aria-label="Graphique interactif conceptuel">
                <defs><linearGradient id="networkPulseFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--section-accent)" stopOpacity=".28"/><stop offset="100%" stopColor="var(--section-accent)" stopOpacity="0"/></linearGradient></defs>
                <path className="pulse-grid" d="M0 34 H340 M0 68 H340 M0 102 H340 M0 136 H340"/>
                <path className="pulse-area" d={networkRange === "1Y" ? "M0,133 C38,128 55,112 88,118 C120,124 151,96 181,99 C220,102 247,66 277,72 C306,77 322,48 340,42 L340,170 L0,170 Z" : networkRange === "5Y" ? "M0,145 C42,132 63,141 91,116 C119,91 145,112 174,84 C204,55 226,78 254,53 C282,28 305,49 340,22 L340,170 L0,170 Z" : "M0,153 C34,149 58,126 88,132 C122,139 146,103 178,106 C210,109 236,69 265,73 C296,77 316,31 340,18 L340,170 L0,170 Z"} fill="url(#networkPulseFill)"/>
                <path className="pulse-line" d={networkRange === "1Y" ? "M0,133 C38,128 55,112 88,118 C120,124 151,96 181,99 C220,102 247,66 277,72 C306,77 322,48 340,42" : networkRange === "5Y" ? "M0,145 C42,132 63,141 91,116 C119,91 145,112 174,84 C204,55 226,78 254,53 C282,28 305,49 340,22" : "M0,153 C34,149 58,126 88,132 C122,139 146,103 178,106 C210,109 236,69 265,73 C296,77 316,31 340,18"}/>
                <circle className="pulse-point" cx="340" cy={networkRange === "1Y" ? "42" : networkRange === "5Y" ? "22" : "18"} r="4"/>
              </svg>
              <div className="pulse-legend"><span><i/>Net worth</span><span><i/>Target zone</span><button>Compare</button></div>
            </div>
          ) : null}

          {networkMode !== "flow" ? (
            <div className="wealth-flow-mini">
              <div><span className="flow-node bank"><CircleDollarSign size={15} /></span><small>Bank cash</small></div><i /><div><span className="flow-node invest"><TrendingUp size={15} /></span><small>PEA</small></div><i /><div><span className="flow-node market"><Globe2 size={15} /></span><small>World ETF</small></div>
            </div>
          ) : null}
          <div className="network-stats"><div><span>Reporting</span><strong>EUR</strong></div><div><span>Exposure</span><strong>Global</strong></div><div><span>Mode</span><strong>{networkMode === "map" ? "Map" : networkMode === "flow" ? "Flow" : "Pulse"}</strong></div></div>
        </aside>
      ) : null}

      <Modal open={Boolean(explanation)} onClose={() => setExplanation(null)} title={explanation?.title ?? "Explain calculation"} subtitle="Formule, inputs, provenance et niveau d’incertitude" wide>
        {explanation ? <ExplanationPanel explanation={explanation} /> : null}
      </Modal>
      {busy ? <div className="busy-indicator"><RefreshCw className="spin" size={14} />Calcul en cours</div> : null}
    </div>
  );
}
