"use client";

import { STATE_CONTRACTS } from "@/lib/presentation/language/states";
import type { AnswerView } from "@/lib/presentation/today/contracts";

/**
 * Les trois primitives de chiffre du canvas d'Aujourd'hui.
 *
 * Extraites du canvas pour deux raisons, dont une seule est la taille. La mesure technique du
 * §13 recommande de tenir un composant de page sous 400 lignes, et le canvas les dépassait de
 * quatre ; mais surtout, ces trois-là décident de ce qui s'affiche à la place d'une valeur
 * absente, c'est-à-dire de l'application la plus visible de `NULL ≠ ZERO`. Elles méritent
 * d'être lisibles seules.
 */

/** Part d'un montant dans un total, bornée à [0, 1]. `null` dès qu'un opérande manque. */
export function share(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return Math.min(1, Math.max(0, part / whole));
}

export function Amount({
  value,
  currency,
  signed = false,
}: {
  value: number;
  currency: string;
  signed?: boolean;
}) {
  // La devise vient du MODÈLE, jamais d'une constante : le produit ne présume pas l'euro, et
  // un total en devise de reporting non déclarée serait un chiffre sans unité.
  const formatted = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Math.abs(value));
  return (
    <span className="today-amount">
      {value < 0 ? "−" : signed && value > 0 ? "+" : ""}
      {formatted}
    </span>
  );
}

/**
 * Ce qui remplace une valeur absente : son ÉTAT.
 *
 * L'état est l'un des huit du §6.3, traduit par le contrat de la phase 0. « Non calculable »
 * ne s'affiche plus : c'était la chaîne unique du constat 5.6, répétée pour quatre situations
 * qui ne demandent pas la même chose à l'utilisateur — une donnée jamais saisie, un domaine
 * déclaré absent, deux sources qui se contredisent et une panne de chargement.
 */
export function Unavailable({ answer }: { answer: AnswerView }) {
  return (
    <span className="today-unavailable" data-state={answer.state}>
      {STATE_CONTRACTS[answer.state].label}
    </span>
  );
}
