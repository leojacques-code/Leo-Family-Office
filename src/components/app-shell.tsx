"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AreaChart, BriefcaseBusiness, Building2, CalendarRange, ChevronDown, CircleDollarSign, Command,
  Download, FlaskConical, FolderLock, Landmark, LayoutDashboard, LogOut, Menu, Moon, Network,
  ReceiptText, RefreshCw, Settings2, ShieldCheck, Sun, Target, TrendingUp, WalletCards, X,
  type LucideIcon,
} from "lucide-react";
import type { DashboardState, ProjectionEnvelope } from "@/lib/types";
import type { Mutation } from "@/lib/data/contracts";
import { NAV_ITEMS, sectionLabel } from "@/lib/navigation";
import { Modal, ExplanationPanel, type Explanation } from "@/components/ui";
import { SectionContent } from "@/components/pages";
import { formatDate } from "@/components/pages/shared";

const ICONS: Record<string, LucideIcon> = {
  "today": LayoutDashboard,
  "net-worth": WalletCards,
  "cash-flow": CircleDollarSign,
  "investments": TrendingUp,
  "debt": Landmark,
  "real-estate": Building2,
  "career": BriefcaseBusiness,
  "business-equity": Network,
  "tax": ReceiptText,
  "scenarios": AreaChart,
  "decision-lab": FlaskConical,
  "goals": Target,
  "documents": FolderLock,
  "timeline": CalendarRange,
  "settings": Settings2,
};

const QUICK_SECTION_IDS = new Set(["today", "net-worth", "investments", "scenarios", "goals"]);

const SECTION_CONTEXT: Record<string, string> = {
  "today": "Executive overview",
  "net-worth": "Consolidated balance sheet",
  "cash-flow": "Liquidity & recurring flows",
  "investments": "Portfolio intelligence",
  "debt": "Liabilities & maturities",
  "real-estate": "Property portfolio",
  "career": "Human capital trajectory",
  "business-equity": "Private ownership",
  "tax": "Tax position & obligations",
  "scenarios": "Projection studio",
  "decision-lab": "Decision simulation workspace",
  "goals": "Life objectives & feasibility",
  "imports": "Data acquisition",
  "documents": "Private records",
  "timeline": "Financial chronology",
  "settings": "Workspace configuration",
};

export function AppShell({ initialState, section }: { initialState: DashboardState; section: string }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [projection, setProjection] = useState<ProjectionEnvelope | null>(null);

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

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  const label = sectionLabel(section);
  const asOfLabel = formatDate(state.asOfDate);
  const SectionIcon = ICONS[section] ?? LayoutDashboard;
  const sectionContext = SECTION_CONTEXT[section] ?? "Private wealth workspace";
  const quickItems = NAV_ITEMS.filter((item) => QUICK_SECTION_IDS.has(item.id));

  return (
    <div className="app-shell" data-section={section}>
      <div className="workspace-ambient" aria-hidden="true" />
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand-lockup"><span className="brand-mark">LF</span><span><strong>Léo</strong><small>Family Office</small></span></div>
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu"><X size={18} /></button>
        </div>
        <div className="profile-switch"><span className="avatar">LC</span><span><strong>Patrimoine personnel</strong><small>EUR · France</small></span><ChevronDown size={14} /></div>
        <nav aria-label="Navigation principale">
          {NAV_ITEMS.map((item) => {
            const Icon = ICONS[item.id] ?? LayoutDashboard;
            const active = section === item.id;
            const className = `${active ? "active" : ""} ${item.break ? "nav-break" : ""}`.trim();
            return <Link key={item.id} href={item.href} className={className} onClick={() => setMobileOpen(false)}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "scenarios" ? <span className="nav-count">{state.scenarios.length}</span> : null}</Link>;
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="privacy-status"><ShieldCheck size={16} /><span><strong>Private workspace</strong><small>Read-only finance</small></span></div>
          <button className="logout-button" onClick={logout}><LogOut size={16} />Déconnexion</button>
        </div>
      </aside>
      {mobileOpen ? <button className="mobile-overlay" aria-label="Fermer le menu" onClick={() => setMobileOpen(false)} /> : null}
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"><Menu size={19} /></button>
            <span className="section-signal" aria-hidden="true"><SectionIcon size={17} strokeWidth={1.8} /></span>
            <div className="topbar-context">
              <span className="breadcrumb">Léo Family Office</span>
              <strong>{label}</strong>
              <small>{sectionContext}</small>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="command-hint" title="Aperçu conceptuel d'une future palette de commandes"><Command size={13} /> Navigation <kbd>⌘K</kbd></span>
            <span className="as-of"><span className="status-dot" />Au {asOfLabel}</span>
            <button className="icon-button" onClick={refresh} aria-label="Actualiser" title="Actualiser"><RefreshCw className={busy ? "spin" : ""} size={17} /></button>
            <button className="icon-button" onClick={toggleTheme} aria-label="Changer de thème" title="Changer de thème">{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- download API route, not a page */}
            <a className="button secondary export-button" href="/api/export?format=csv"><Download size={15} />Exporter</a>
          </div>
        </header>
        <nav className="section-rail" aria-label="Accès rapide aux espaces clés">
          <span className="section-rail-label">Quick access</span>
          {quickItems.map((item) => {
            const QuickIcon = ICONS[item.id] ?? LayoutDashboard;
            return (
              <Link key={item.id} href={item.href} className={section === item.id ? "active" : ""}>
                <QuickIcon size={13} strokeWidth={1.8} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {error ? <div className="global-error"><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div> : null}
        <main className="content-area">
          <SectionContent section={section} state={state} mutate={mutate} busy={busy} setExplanation={setExplanation} projection={projection} runProjection={runProjection} refresh={refresh} />
        </main>
      </div>
      <Modal open={Boolean(explanation)} onClose={() => setExplanation(null)} title={explanation?.title ?? "Explain calculation"} subtitle="Formule, inputs, provenance et niveau d’incertitude" wide>
        {explanation ? <ExplanationPanel explanation={explanation} /> : null}
      </Modal>
      {busy ? <div className="busy-indicator"><RefreshCw className="spin" size={14} />Calcul en cours</div> : null}
    </div>
  );
}
