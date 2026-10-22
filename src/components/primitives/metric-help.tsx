"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Aide contextuelle « ? » (registre UX D-UX-02).
 *
 * Un bouton discret près du terme. Au survol, au clic, au clavier et au toucher, il ouvre une
 * explication courte : définition, périmètre, limites. Elle complète le chiffre sans le
 * masquer et ne remplace pas l'Inspecteur, qui porte le calcul, la source et l'historique.
 *
 * Un clic ÉPINGLE l'aide : le survol seul l'ouvre et la ferme, sans quoi un utilisateur à la
 * souris la verrait disparaître au moment de la lire. Échap et un clic extérieur la ferment.
 */
export interface MetricHelpProps {
  /** Terme expliqué, lu par le lecteur d'écran : « Aide : <terme> ». */
  term: string;
  children: ReactNode;
}

export function MetricHelp({ term, children }: MetricHelpProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPinned(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <span
      className="metric-help"
      ref={root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={`Aide : ${term}`}
        className="metric-help-button"
        onClick={() => {
          const next = !(open && pinned);
          setOpen(next);
          setPinned(next);
        }}
        type="button"
      >
        ?
      </button>
      <span className="metric-help-panel" hidden={!open} id={panelId} role="note">
        {children}
      </span>
    </span>
  );
}
