"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Accessibilité clavier d'un dialogue : piège de focus, Échap, et restitution du focus.
 *
 * Critère de la section 11 du plan de refonte pour cette phase : « états focus et dialogs
 * accessibles ». La modale existante gérait déjà Échap, mais ni le piège de focus ni la
 * restitution : au clavier, la tabulation sortait derrière le dialogue et continuait dans la
 * page masquée, puis le focus se perdait à la fermeture. Un utilisateur au clavier se
 * retrouvait donc à parcourir une page qu'il ne voyait plus.
 *
 * `aria-modal` ne piège PAS le focus : il informe le lecteur d'écran que le reste est inerte,
 * il ne l'empêche pas d'être atteint à la tabulation. Les deux sont nécessaires.
 */

/**
 * Sélecteur des éléments réellement focusables.
 *
 * `[tabindex="-1"]` est exclu : il est focusable par script mais pas par tabulation, et
 * l'inclure ferait boucler le piège sur un conteneur au lieu du premier contrôle.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Un élément masqué reste dans le DOM : le laisser dans le cycle enverrait le focus sur
 * quelque chose d'invisible, et l'utilisateur croirait l'avoir perdu.
 *
 * Le critère est DÉCLARATIF — attribut `hidden`, `aria-hidden`, `display: none`,
 * `visibility: hidden` — et non mesuré. `offsetParent` et `getClientRects()` répondent à
 * partir de la MISE EN PAGE : ils sont vides dans un environnement de test sans moteur de
 * rendu, donc un filtre bâti dessus y rejette la totalité des contrôles et le piège de focus
 * n'est plus vérifiable du tout. Un garde-fou qu'aucun test ne peut exercer ne garde rien.
 */
function isRendered(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    // `display` n'est pas héritée : elle se vérifie sur chaque ancêtre, faute de quoi un
    // panneau replié laisserait ses boutons dans le cycle.
    if (getComputedStyle(node).display === "none") return false;
  }
  // `visibility` EST héritée, donc la valeur calculée sur l'élément porte déjà celle de ses
  // ancêtres — et un descendant qui la remet à `visible` est réellement visible.
  return getComputedStyle(element).visibility !== "hidden";
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isRendered);
}

export function useDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  // L'élément qui avait le focus AVANT l'ouverture. Le rendre à la fermeture est ce qui
  // permet de rouvrir le même panneau en tabulant, au lieu de repartir du haut de la page.
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;
    restoreTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const first = focusableWithin(container)[0];
    // Sans contrôle focusable, le conteneur lui-même reçoit le focus : un dialogue dont rien
    // n'est focusable laisserait sinon le focus dans la page masquée.
    (first ?? container).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Le cycle se referme aux deux bords, et pas seulement au dernier : sans le bord
      // arrière, Maj+Tab depuis le premier contrôle sortirait du dialogue.
      if (!event.shiftKey && active === lastElement) {
        event.preventDefault();
        firstElement.focus();
      } else if (event.shiftKey && (active === firstElement || active === container)) {
        event.preventDefault();
        lastElement.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // `isConnected` : à la fermeture, l'élément d'origine peut avoir été démonté (une ligne
      // de tableau supprimée depuis le dialogue). Lui rendre le focus lèverait sans rien
      // faire de visible.
      if (restoreTo.current?.isConnected) restoreTo.current.focus();
    };
  }, [containerRef, open, onClose]);
}
