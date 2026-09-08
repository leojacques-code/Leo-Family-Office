"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";

/**
 * Zone E : inspecteur.
 *
 * Section 17 du plan de refonte : il explique un chiffre, montre sa formule, affiche ses
 * sources, corrige un rattachement, édite le fait sélectionné, donne accès à l'historique et
 * à la provenance, et n'affiche les identifiants techniques que dans un volet explicitement
 * technique.
 *
 * Le §4.4 de V10 liste les faits qu'il répond et pose la contrainte de densité : « only the
 * most relevant 4-6 facts are visible by default ». Le §3 la répète : 4 à 6 lignes avant
 * défilement, libellé plus valeur, l'explication apparaît à l'interaction et non en
 * permanence.
 *
 * L'inspecteur remplace la modale d'explication. Ce n'est pas un déplacement cosmétique : une
 * modale masque le canvas, donc elle interdit de comparer le chiffre expliqué à ce qui
 * l'entoure. Un panneau latéral persistant permet ce que le plan appelle « approfondir sans
 * quitter son contexte ».
 */

export interface InspectorFact {
  label: string;
  /** Valeur déjà formatée. L'inspecteur ne calcule rien et ne formate rien. */
  value: ReactNode;
  /** Précision courte, montrée sous la valeur. Jamais un paragraphe. */
  note?: string;
}

/** Nombre de faits visibles avant défilement, §3 et §4.4 de V10. */
export const INSPECTOR_VISIBLE_FACTS = 6;

export interface InspectorProps {
  /** `null` ferme l'inspecteur : rien n'est sélectionné. */
  title: string | null;
  facts: readonly InspectorFact[];
  onClose: () => void;
  /**
   * Contenu additionnel : formule, provenance, volet technique, actions d'édition. Il vient
   * APRÈS les faits, parce que le §3 de V10 veut l'explication à l'interaction.
   */
  children?: ReactNode;
  /**
   * `true` sur les fenêtres étroites, où l'inspecteur devient un dialogue par-dessus le
   * canvas au lieu d'une troisième colonne. Le piège de focus ne s'active que dans ce cas :
   * une colonne persistante n'est pas un dialogue, et y enfermer le focus empêcherait de
   * revenir au canvas.
   */
  asDialog?: boolean;
}

export function Inspector({ title, facts, onClose, children, asDialog = false }: InspectorProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const open = title !== null;
  useDialogFocus(containerRef, open && asDialog, onClose);
  if (!open) return null;

  const overflowing = facts.length > INSPECTOR_VISIBLE_FACTS;
  return (
    <aside
      aria-label={`Inspecteur : ${title}`}
      aria-modal={asDialog ? "true" : undefined}
      className="inspector"
      data-dialog={asDialog ? "true" : undefined}
      ref={containerRef}
      role={asDialog ? "dialog" : "complementary"}
      tabIndex={-1}
    >
      <header className="inspector-header">
        <h2>{title}</h2>
        <button
          aria-label="Fermer l’inspecteur"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          <X size={16} />
        </button>
      </header>
      <dl
        className="inspector-facts"
        // Le défilement n'est pas décidé par une hauteur en pixels mais par le NOMBRE de
        // faits : c'est la contrainte du §4.4, et une hauteur fixe la trahirait dès qu'un
        // libellé passe sur deux lignes.
        data-overflowing={overflowing ? "true" : undefined}
      >
        {facts.map((fact) => (
          <div className="inspector-fact" key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.value}
              {fact.note ? <small>{fact.note}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
      {children ? <div className="inspector-extra">{children}</div> : null}
    </aside>
  );
}
