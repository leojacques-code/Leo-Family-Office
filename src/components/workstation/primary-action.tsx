"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/**
 * Zone A, action primaire : le manifeste dit QUOI, la page dit COMMENT.
 *
 * Le §17 du plan place dans l'en-tête opérationnel « une action primaire maximum », et les
 * manifestes de la phase 0 en portent déjà le libellé pour treize pages sur quatorze —
 * « Importer un échéancier », « Créer un objectif », « Ajouter une société ». Le cadre
 * ignorait ces libellés : la prop existait, elle n'était jamais passée.
 *
 * Un libellé ne suffit pourtant pas à rendre un bouton. LIBELLÉ DÉCLARÉ ≠ ACTION SERVIE :
 * « Importer un échéancier » n'a pas d'implémentation avant la phase 3, et rendre le bouton
 * quand même produirait un contrôle qui ne fait rien — exactement le mensonge que le cadre
 * évite déjà en masquant le sélecteur Réel/Simulation d'une page à mode unique.
 *
 * La page ENREGISTRE donc ce que son action déclenche, et le cadre ne rend le bouton que si
 * quelque chose est enregistré. Une page qui ne sert pas encore son action n'en affiche
 * aucune, ce qui est honnête, et la dette est mesurée par un gate plutôt que laissée à la
 * relecture.
 */

interface PrimaryActionSlot {
  /**
   * Enregistre l'action de la page, ou la retire avec `null`.
   *
   * L'action est transportée dans un OBJET et non nue : `setState` traite une fonction reçue
   * comme un calcul d'état à partir du précédent, et enregistrer une fonction nue la ferait
   * exécuter au lieu de la stocker.
   */
  readonly register: (action: { run: () => void } | null) => void;
}

const PrimaryActionContext = createContext<PrimaryActionSlot | null>(null);

export interface PrimaryActionProviderProps {
  onChange: (action: { run: () => void } | null) => void;
  children: ReactNode;
}

export function PrimaryActionProvider({ onChange, children }: PrimaryActionProviderProps) {
  const value = useMemo<PrimaryActionSlot>(() => ({ register: onChange }), [onChange]);
  return <PrimaryActionContext.Provider value={value}>{children}</PrimaryActionContext.Provider>;
}

/**
 * Branche l'action primaire de la page courante sur son en-tête.
 *
 * `handler` est relu à chaque rendu via une référence stable, de sorte qu'une page n'a pas à
 * mémoriser sa fonction pour éviter de réenregistrer en boucle : c'est le genre de contrainte
 * qu'un auteur de page oublie, et l'oubli produirait un rendu infini plutôt qu'un bug visible.
 *
 * Le retrait au démontage n'est pas cosmétique : sans lui, changer de domaine laisserait dans
 * l'en-tête le bouton de la page précédente, qui ouvrirait un formulaire démonté.
 */
export function useRegisterPrimaryAction(handler: (() => void) | null) {
  const slot = useContext(PrimaryActionContext);
  const ref = useRef<(() => void) | null>(handler);

  // La référence est mise à jour APRÈS le rendu, jamais pendant : une écriture de référence
  // en cours de rendu ne déclenche aucune mise à jour et se lit différemment selon l'ordre
  // des rendus. L'effet s'exécute avant qu'un clic soit possible, donc le bouton n'appelle
  // jamais une version périmée du gestionnaire.
  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  const run = useCallback(() => {
    ref.current?.();
  }, []);

  const available = handler !== null;

  useEffect(() => {
    if (!slot) return undefined;
    slot.register(available ? { run } : null);
    return () => slot.register(null);
  }, [slot, available, run]);
}
