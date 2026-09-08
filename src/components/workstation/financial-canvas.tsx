"use client";

import type { ReactNode } from "react";

/**
 * Zone C : le canvas financier.
 *
 * Le §10.2 du plan nomme ce fichier dans la structure cible, aux côtés de `workspace-shell`,
 * `source-rail` et `inspector`. Il n'existait pas : la zone était un `<main>` écrit en ligne
 * dans le cadre. La différence n'est pas cosmétique — tant que la zone n'a pas de module, elle
 * n'a pas d'endroit où porter son contrat, et chaque phase de domaine réinvente sa balise, son
 * étiquette d'accessibilité et son nom de classe.
 *
 * `main` et non `div` : c'est le contenu principal de la page, et un lecteur d'écran doit
 * pouvoir y sauter directement depuis le rail ou l'en-tête.
 *
 * CE COMPOSANT NE COMPOSE RIEN. Le §1 de V10 exige « one dominant analytical composition » par
 * domaine, et le §37 donne à chaque domaine sa phase : le canvas de Dette appartient à la
 * phase 3, celui du Patrimoine à la phase 4. La zone reçoit donc le contenu tel qu'il existe.
 * Y placer une grille par défaut installerait précisément la grammaire générique que le
 * constat 5.7 reproche au produit.
 */

export interface FinancialCanvasProps {
  /**
   * Étiquette d'accessibilité de la zone.
   *
   * C'est la question dominante du domaine quand le manifeste en porte une, son titre sinon.
   * Une région principale sans nom oblige un utilisateur de lecteur d'écran à la parcourir
   * pour savoir où il est.
   */
  label: string;
  children: ReactNode;
}

export function FinancialCanvas({ label, children }: FinancialCanvasProps) {
  return (
    <main aria-label={label} className="financial-canvas">
      {children}
    </main>
  );
}
