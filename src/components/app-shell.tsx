"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Banknote,
  ChevronDown,
  Download,
  FileBarChart,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Scale,
  Settings,
  ShieldCheck,
  Sun,
  Target,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type { DashboardState, ProjectionEnvelope } from "@/lib/types";
import type { Mutation } from "@/lib/data/contracts";
import {
  NAV_GROUPS,
  SECONDARY_SECTIONS,
  groupOfSection,
  secondarySection,
  sectionLabel,
} from "@/lib/navigation";
import { type Explanation } from "@/components/ui";
import { SectionContent } from "@/components/pages";
import { formatDate } from "@/components/pages/shared";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";
import type { RealityMode } from "@/lib/presentation/registry/contracts";
import { WorkspaceShell } from "@/components/workstation/workspace-shell";
import { Inspector, type InspectorFact } from "@/components/workstation/inspector";

/**
 * Icônes des six entrées, selon le mapping stable du §9 de la spécification V10 : les icônes
 * sont de l'instrumentation financière, pas de la décoration.
 */
const GROUP_ICONS: Record<string, LucideIcon> = {
  today: LayoutDashboard,
  wealth: Wallet,
  flows: Banknote,
  projects: Target,
  decisions: Scale,
  sources: ShieldCheck,
};

const SECONDARY_ICONS: Record<string, LucideIcon> = {
  advisor: FlaskConical,
  reports: FileBarChart,
  settings: Settings,
};

export function AppShell({
  initialState,
  section,
}: {
  initialState: DashboardState;
  section: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [projection, setProjection] = useState<ProjectionEnvelope | null>(null);
  /**
   * Mode d'affichage, §6.4 du plan de refonte.
   *
   * Il vit dans le SHELL et non dans une page : le plan le veut « global et persistant », de
   * sorte que passer d'un domaine à l'autre ne fasse pas oublier qu'on regardait une
   * simulation.
   */
  const [mode, setMode] = useState<RealityMode>("REAL");

  async function mutate(mutation: Mutation) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation),
      });
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
    } finally {
      setBusy(false);
    }
  }

  async function runProjection(
    scenarioId: string,
    years = 30,
    simulations = 3000,
    seed = 19082026,
  ) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/projection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId, years, simulations, seed }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Projection impossible");
      setProjection(body);
      return body as ProjectionEnvelope;
    } catch (projectionError) {
      setError(
        projectionError instanceof Error ? projectionError.message : "Projection impossible",
      );
      return null;
    } finally {
      setBusy(false);
    }
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

  const manifest = PAGE_REGISTRY[section] ?? null;
  const activeGroup = groupOfSection(section);
  const secondary = secondarySection(section);
  const asOfLabel = formatDate(state.asOfDate);

  /**
   * L'explication devient les faits de l'inspecteur.
   *
   * Le §17 du plan place cette information en zone E, et le §4.4 de V10 la borne à 4-6 faits
   * visibles. Elle s'affichait dans une modale, qui masquait le canvas : on ne pouvait donc
   * pas comparer le chiffre expliqué à ce qui l'entourait, ce qui est précisément ce que le
   * plan appelle « approfondir sans quitter son contexte ».
   */
  const inspectorFacts = useMemo<InspectorFact[]>(() => {
    if (!explanation) return [];
    return explanation.inputs.map((input) => ({
      label: input.label,
      value: input.value,
      note: input.date,
    }));
  }, [explanation]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand-lockup">
            <span className="brand-mark">LF</span>
            <span>
              <strong>Léo</strong>
              <small>Family Office</small>
            </span>
          </div>
          <button
            aria-label="Fermer le menu"
            className="icon-button mobile-close"
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/*
         * Menu de profil. Le §34 du plan sort Paramètres de la navigation principale et le
         * place ici : « Settings quitte la navigation principale et se trouve dans le menu du
         * profil ». Le bouton porte donc un vrai état déplié, il n'est plus décoratif.
         */}
        <button
          aria-expanded={profileOpen}
          className="profile-switch"
          onClick={() => setProfileOpen((open) => !open)}
          type="button"
        >
          <span className="avatar">LC</span>
          <span>
            <strong>Patrimoine personnel</strong>
            <small>EUR · France</small>
          </span>
          <ChevronDown size={14} />
        </button>
        {profileOpen ? (
          <div className="profile-menu">
            {SECONDARY_SECTIONS.filter((item) => item.reachedFrom === "PROFILE_MENU").map(
              (item) => {
                const Icon = SECONDARY_ICONS[item.id] ?? Settings;
                return (
                  <Link
                    className={section === item.id ? "active" : ""}
                    href={item.href}
                    key={item.id}
                    onClick={() => {
                      setProfileOpen(false);
                      setMobileOpen(false);
                    }}
                  >
                    <Icon size={16} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </Link>
                );
              },
            )}
          </div>
        ) : null}

        {/*
         * Navigation à SIX entrées, §7 du plan. Le constat 5.5 reprochait dix-huit
         * destinations présentées comme équivalentes, mêlant tâches, domaines, outils,
         * sources et administration : l'utilisateur devait comprendre l'architecture interne
         * du produit avant de savoir où agir.
         */}
        <nav aria-label="Navigation principale">
          {NAV_GROUPS.map((group) => {
            const Icon = GROUP_ICONS[group.id] ?? LayoutDashboard;
            const groupActive = activeGroup?.id === group.id;
            return (
              <div className="nav-group" key={group.id}>
                <Link
                  aria-current={groupActive ? "page" : undefined}
                  className={groupActive ? "active" : ""}
                  href={group.href}
                  onClick={() => setMobileOpen(false)}
                  title={group.purpose}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{group.label}</span>
                </Link>
                {/*
                 * Les sous-vues ne s'affichent que dans le groupe COURANT. Les déplier tous
                 * remettrait à l'écran les dix-huit destinations que le regroupement vient de
                 * réduire, avec une indentation en plus.
                 */}
                {groupActive && group.items.length > 1 ? (
                  <div className="nav-subviews">
                    {group.items.map((item) => (
                      <Link
                        aria-current={section === item.id ? "page" : undefined}
                        className={section === item.id ? "active" : ""}
                        href={item.href}
                        key={item.id}
                        onClick={() => setMobileOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {/*
           * « Private workspace / Read-only finance » était en ANGLAIS dans une interface que
           * le §11 exige « entièrement française ».
           */}
          <div className="privacy-status">
            <ShieldCheck size={16} />
            <span>
              <strong>Espace privé</strong>
              <small>Lecture financière</small>
            </span>
          </div>
          <button className="logout-button" onClick={logout}>
            <LogOut size={16} />
            Déconnexion
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <button
          aria-label="Fermer le menu"
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="app-main">
        {/*
         * En-tête SIMPLIFIÉ, §11 du plan. Le fil d'Ariane narratif « Léo Family Office » suivi
         * du nom de section disparaît : le §4.1 de V10 le refuse explicitement, et l'identité
         * du domaine est maintenant dans la zone A du poste de travail, avec sa question.
         */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              aria-label="Ouvrir le menu"
              className="icon-button menu-button"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={19} />
            </button>
            {activeGroup ? <span className="topbar-group">{activeGroup.label}</span> : null}
          </div>
          <div className="topbar-actions">
            {/*
             * Rapports devient une ACTION d'en-tête, §7 du plan : « Reports : action globale
             * Rapports et historique de clôtures ».
             */}
            {SECONDARY_SECTIONS.filter((item) => item.reachedFrom === "HEADER_ACTION").map(
              (item) => {
                const Icon = SECONDARY_ICONS[item.id] ?? FileBarChart;
                return (
                  <Link
                    className={`button secondary ${section === item.id ? "active" : ""}`}
                    href={item.href}
                    key={item.id}
                  >
                    <Icon size={15} />
                    {item.label}
                  </Link>
                );
              },
            )}
            <button
              aria-label="Actualiser"
              className="icon-button"
              onClick={refresh}
              title="Actualiser"
            >
              <RefreshCw className={busy ? "spin" : ""} size={17} />
            </button>
            <button
              aria-label="Changer de thème"
              className="icon-button"
              onClick={toggleTheme}
              title="Changer de thème"
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- download API route, not a page */}
            <a className="button secondary export-button" href="/api/export?format=csv">
              <Download size={15} />
              Exporter
            </a>
          </div>
        </header>

        {error ? (
          <div className="global-error" role="alert">
            <span>{error}</span>
            <button aria-label="Masquer l’erreur" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        ) : null}

        <div className="content-area">
          <WorkspaceShell
            dateLabel={
              <>
                <span className="status-dot" />
                Au {asOfLabel}
              </>
            }
            fallbackTitle={secondary?.label ?? sectionLabel(section)}
            inspector={
              <Inspector
                facts={inspectorFacts}
                onClose={() => setExplanation(null)}
                title={explanation?.title ?? null}
              >
                {explanation ? (
                  <>
                    <p className="inspector-formula">{explanation.formula}</p>
                    {explanation.note ? <p>{explanation.note}</p> : null}
                  </>
                ) : null}
              </Inspector>
            }
            manifest={manifest}
            mode={mode}
            onModeChange={setMode}
          >
            <SectionContent
              busy={busy}
              mutate={mutate}
              projection={projection}
              refresh={refresh}
              runProjection={runProjection}
              section={section}
              setExplanation={setExplanation}
              state={state}
            />
          </WorkspaceShell>
        </div>
      </div>

      {busy ? (
        <div className="busy-indicator" role="status">
          <RefreshCw className="spin" size={14} />
          Calcul en cours
        </div>
      ) : null}
    </div>
  );
}
