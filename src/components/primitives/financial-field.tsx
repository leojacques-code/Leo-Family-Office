"use client";

import type { ReactNode } from "react";

/**
 * FAIT ≠ HYPOTHÈSE, et la section 18.3 du plan de refonte demande que la séparation soit
 * « visuelle ET structurelle ». Le champ porte donc sa nature dans son type, pas seulement
 * dans une classe CSS : un formulaire ne peut pas rendre une hypothèse comme un fait par
 * oubli de style.
 */
export type FieldNature = "FACT" | "ASSUMPTION";

export interface FinancialFieldProps {
  /** Identifiant du contrôle. Sert au `label for`, donc il est obligatoire. */
  id: string;
  label: string;
  /** Par défaut un FAIT. Une hypothèse doit être déclarée explicitement. */
  nature?: FieldNature;
  /**
   * Aide de saisie. Ce n'est PAS un exemple prérempli : la section 18.3 impose que les
   * exemples restent des placeholders et ne deviennent jamais des valeurs.
   */
  hint?: string;
  /** Unité ou devise affichée à côté du contrôle, jamais dans le contrôle. */
  unit?: string;
  /** Message de refus de lecture. `null` quand la saisie est lisible. */
  error?: string | null;
  children: ReactNode;
}

/**
 * Cadre commun des champs financiers : libellé, unité, aide, erreur, nature.
 *
 * Il n'existait aucun cadre de champ dans le produit : les 252 balises `<input>` portaient
 * chacune son propre balisage, donc sa propre accessibilité, donc ses propres oublis.
 */
export function FinancialField({
  id,
  label,
  nature = "FACT",
  hint,
  unit,
  error,
  children,
}: FinancialFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div
      className={`fin-field${nature === "ASSUMPTION" ? " fin-field-assumption" : ""}`}
      data-nature={nature}
    >
      <label className="fin-field-label" htmlFor={id}>
        {label}
        {nature === "ASSUMPTION" ? <span className="fin-field-tag">Hypothèse</span> : null}
      </label>
      <div className="fin-field-control">
        {children}
        {unit ? (
          // `aria-hidden` : l'unité est déjà annoncée par le libellé accessible du contrôle,
          // qui la porte. La répéter la ferait lire deux fois.
          <span className="fin-field-unit" aria-hidden="true">
            {unit}
          </span>
        ) : null}
      </div>
      {hint ? (
        <span className="fin-field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="fin-field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Identifiants à passer en `aria-describedby` d'un contrôle encadré. */
export function describedBy(id: string, hint?: string, error?: string | null): string | undefined {
  const parts = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}
