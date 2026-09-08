"use client";

import type { RealityMode } from "@/lib/presentation/registry/contracts";

/**
 * Sélecteur Réel / Simulation.
 *
 * Section 6.4 du plan de refonte : « le changement doit modifier la géométrie ou le fond de
 * la surface, pas seulement un badge minuscule. Une hypothèse ne doit jamais être confondue
 * avec une donnée actuelle. » Le §5 de la spécification V10 le nomme « a global interaction
 * primitive, not a paragraph » et décrit ce que chaque mode fait à la surface : géométrie
 * pleine et couleurs d'observation en réel, accent violet, tracés en pointillés translucides
 * et filigrane « Simulation isolée » en simulation.
 *
 * Le sélecteur ne porte donc PAS seulement un libellé : il pose `data-reality-mode` sur la
 * racine du poste de travail, et c'est le CSS qui transforme la surface. Un composant qui se
 * contenterait d'écrire « Simulation » à côté d'un chiffre laisserait une hypothèse
 * ressembler à un fait.
 *
 * UNE PAGE QUI NE SIMULE PAS N'A PAS DE SÉLECTEUR. Les modes supportés viennent du
 * `PageManifest` de la page : afficher un sélecteur inerte sur Patrimoine ou sur Sources
 * ferait croire qu'il existe une simulation qui n'existe pas.
 */

export const REALITY_MODE_LABELS: Readonly<Record<RealityMode, string>> = {
  REAL: "Situation réelle",
  SIMULATION: "Simulation",
};

/** Libellé court, pour un contrôle segmenté où la place manque. */
const SHORT_LABELS: Readonly<Record<RealityMode, string>> = {
  REAL: "Réel",
  SIMULATION: "Simulation",
};

export interface RealityModeSwitchProps {
  /** Modes que la page sait rendre, tels que son manifeste les déclare. */
  supported: readonly RealityMode[];
  value: RealityMode;
  onChange: (mode: RealityMode) => void;
}

/**
 * Contrôle segmenté. `null` quand la page ne déclare qu'un seul mode : il n'y a alors rien à
 * choisir, et un contrôle à une seule option est un contrôle qui ment.
 */
export function RealityModeSwitch({ supported, value, onChange }: RealityModeSwitchProps) {
  if (supported.length < 2) return null;
  return (
    <div
      aria-label="Mode d’affichage"
      className="reality-switch"
      // `radiogroup` et non `tablist` : il ne s'agit pas de deux vues du même contenu mais de
      // deux natures de contenu, le constaté et l'hypothétique, et un lecteur d'écran doit
      // annoncer un choix exclusif.
      role="radiogroup"
    >
      {supported.map((mode) => (
        <button
          aria-checked={mode === value}
          className="reality-switch-option"
          data-mode={mode}
          key={mode}
          onClick={() => onChange(mode)}
          role="radio"
          // Le libellé accessible est le libellé LONG : « Réel » seul ne dit pas de quoi il
          // est le mode, et c'est précisément l'ambiguïté que la section 6.4 veut éliminer.
          title={REALITY_MODE_LABELS[mode]}
          type="button"
        >
          {SHORT_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}

/**
 * Filigrane du mode simulation.
 *
 * Exigé mot pour mot par le §5 de V10 : `Simulation isolée`. « Isolée » n'est pas un
 * ornement : il dit que rien de ce qui est affiché n'écrit dans l'état réel, ce que la même
 * section formule par « never writes into actual state without explicit promotion ».
 */
export function SimulationWatermark({ mode }: { mode: RealityMode }) {
  if (mode !== "SIMULATION") return null;
  return (
    <p className="simulation-watermark" role="status">
      Simulation isolée
    </p>
  );
}
