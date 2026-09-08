"use client";

import type { ReactNode } from "react";
import type { PageManifest, RealityMode } from "@/lib/presentation/registry/contracts";
import { RealityModeSwitch, SimulationWatermark } from "./reality-mode";

/**
 * Cadre du poste de travail : les trois zones spatiales persistantes.
 *
 * Le §0 de V10 rejette la composition `question → paragraphe → cartes de sources → cartes de
 * KPI → cartes de déblocage → page détaillée` et exige à la place un poste de travail
 * financier à trois zones : rail de sources, canvas financier, inspecteur. Le §6.2 du plan de
 * refonte dit la même chose en français, et le §17 en donne le contrat complet à six zones.
 *
 * La géométrie vient du §2 de V10 : grille conceptuelle de 16 colonnes, rail de 2,5 à 3
 * colonnes, canvas de 9 à 10,5, inspecteur de 2,5 à 3. Elle est portée par le CSS, parce
 * qu'une proportion doit s'adapter à la largeur réelle et qu'un calcul en JavaScript ne
 * survivrait pas à un redimensionnement.
 *
 * LA PHASE 1 INSTALLE LE CADRE, PAS LES COMPOSITIONS. Le canvas de chaque domaine est
 * l'affaire de sa propre phase : le §37 de la séquence donne à la phase 1 « Shell,
 * navigation, canvas, inspecteur », et le §14 interdit de « refaire toutes les pages dans une
 * seule PR ». Ce composant reçoit donc le contenu de domaine tel qu'il existe et l'installe
 * dans la zone C, sans le réécrire.
 */

export interface WorkspaceShellProps {
  /**
   * Manifeste de la page, tel que le registre de la phase 0 le porte.
   *
   * Il n'est pas décoratif : il donne la question dominante, les modes supportés et la
   * stratégie d'affichage. `null` pour une section sans manifeste, c'est-à-dire une des trois
   * sections que le §7 sort de la navigation principale.
   */
  manifest: PageManifest | null;
  /** Libellé de repli quand la section n'a pas de manifeste. */
  fallbackTitle: string;
  /** Date financière et sa fraîcheur, déjà formatées. Zone A, §17. */
  dateLabel: ReactNode;
  mode: RealityMode;
  onModeChange: (mode: RealityMode) => void;
  /** Zone B. Rendue seulement si le manifeste déclare la zone et que le rail a des sources. */
  sourceRail?: ReactNode;
  /** Zone C : le contenu du domaine. */
  children: ReactNode;
  /** Zone E. Rendue seulement quand quelque chose est sélectionné. */
  inspector?: ReactNode;
  /** Zone A, action primaire. Au plus une, imposée par le type du manifeste. */
  primaryAction?: ReactNode;
  /** Zone A, actions utilitaires : personnalisation de vue, analyse détaillée. */
  headerTools?: ReactNode;
}

export function WorkspaceShell({
  manifest,
  fallbackTitle,
  dateLabel,
  mode,
  onModeChange,
  sourceRail,
  children,
  inspector,
  primaryAction,
  headerTools,
}: WorkspaceShellProps) {
  const title = manifest?.title ?? fallbackTitle;
  const question = manifest?.question ?? null;
  // Une section sans manifeste ne simule pas : les trois sections secondaires du §7 sont
  // Beyonder, Rapports et Paramètres, et aucune ne porte d'hypothèse.
  const supportedModes = manifest?.realityModes ?? (["REAL"] as const);
  const showRail = manifest?.zones.includes("SOURCE_RAIL") !== false && Boolean(sourceRail);

  return (
    <div
      className="workstation"
      // `data-reality-mode` est ce qui transforme la surface. Le §5 de V10 veut que basculer
      // le mode « visually transform the same financial canvas », donc le CSS descend depuis
      // cette racine plutôt que chaque composant ne se colore lui-même.
      data-reality-mode={mode}
      data-viewport={manifest?.viewport ?? "ALL_VIEWPORTS"}
      data-with-inspector={inspector ? "true" : undefined}
      data-with-rail={showRail ? "true" : undefined}
    >
      {/* Zone A : en-tête opérationnel. Le §4.1 de V10 : à gauche le domaine et sa question,
          à droite le contrôle Réel/Simulation et les outils. Pas de fil d'Ariane narratif. */}
      <header className="workstation-header">
        <div className="workstation-identity">
          <p className="workstation-domain">{title}</p>
          {/* Le §3 de V10 limite la question à 14-16 mots et INTERDIT le paragraphe
              explicatif en dessous. Il n'y a donc rien d'autre ici. */}
          {question ? <h1 className="workstation-question">{question}</h1> : null}
        </div>
        <div className="workstation-controls">
          <span className="workstation-date">{dateLabel}</span>
          <RealityModeSwitch onChange={onModeChange} supported={supportedModes} value={mode} />
          {headerTools}
          {primaryAction}
        </div>
      </header>

      <SimulationWatermark mode={mode} />

      <div className="workstation-body">
        {showRail ? sourceRail : null}
        {/* Zone C : le canvas. `main` et non `div` : c'est le contenu principal de la page, et
            un lecteur d'écran doit pouvoir y sauter directement. */}
        <main aria-label={question ?? title} className="financial-canvas">
          {children}
        </main>
        {inspector}
      </div>
    </div>
  );
}
