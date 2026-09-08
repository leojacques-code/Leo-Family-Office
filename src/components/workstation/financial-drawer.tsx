"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";

/**
 * Tiroir d'édition.
 *
 * Section 6.2 du plan de refonte : « les formulaires importants s'ouvrent dans un drawer ou
 * une étape dédiée ; ils ne remplissent pas le premier écran. » Le §7 de V10 est catégorique :
 * « Forms do not occupy the main canvas », et son test de validation du §29 fait échouer un
 * domaine dont « forms occupy the main first view ».
 *
 * C'est aussi le critère de la section 11 pour cette phase : « aucun formulaire massif
 * au-dessus de la ligne de flottaison ».
 *
 * Le tiroir est un DIALOGUE, contrairement à l'inspecteur qui est une colonne persistante :
 * on y saisit, donc le focus doit y rester tant qu'on n'a pas terminé, et revenir à son point
 * de départ à la fermeture.
 */

export interface FinancialDrawerProps {
  open: boolean;
  title: string;
  /** Une ligne de contexte au plus. Le §3 de V10 interdit le paragraphe d'introduction. */
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * Sections du tiroir, quand le formulaire en a besoin.
   *
   * Le §7 de V10 : « the editor is organised in sections only when required », avec pour
   * exemple un tiroir Dette en Contrat, Paiement, Assurance, Options avancées. Les noms
   * viennent du domaine, pas de ce composant.
   */
  sections?: readonly string[];
  activeSection?: string;
  onSectionChange?: (section: string) => void;
}

export function FinancialDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  sections,
  activeSection,
  onSectionChange,
}: FinancialDrawerProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  useDialogFocus(containerRef, open, onClose);
  if (!open) return null;

  return (
    <div
      className="drawer-backdrop"
      // `presentation` et non `button` : le fond n'est pas une action annoncée au lecteur
      // d'écran, la fermeture au clavier passe par Échap et par le bouton de fermeture.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        aria-label={title}
        aria-modal="true"
        className="financial-drawer"
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="drawer-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button aria-label="Fermer" className="icon-button" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>
        {sections && sections.length > 1 ? (
          <nav aria-label="Sections du formulaire" className="drawer-sections">
            {sections.map((section) => (
              <button
                aria-current={section === activeSection ? "true" : undefined}
                className="drawer-section-tab"
                key={section}
                onClick={() => onSectionChange?.(section)}
                type="button"
              >
                {section}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="drawer-body">{children}</div>
      </section>
    </div>
  );
}
