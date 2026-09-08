"use client";

import { useState } from "react";
import {
  formatNumberForInput,
  parseNumberInput,
  type NumberDraft,
  type NumberParseReason,
} from "@/lib/presentation/input-parse";
import { FinancialField, describedBy, type FieldNature } from "./financial-field";

/** Explication française d'un refus de lecture. Aucun code technique n'atteint la surface. */
export function numberErrorMessage(reason: NumberParseReason): string {
  switch (reason) {
    case "NO_DIGIT":
      return "Indiquez un montant.";
    case "MULTIPLE_DECIMAL_SEPARATORS":
      return "Un seul séparateur décimal.";
    case "MISPLACED_SIGN":
      return "Le signe moins se place devant le montant.";
    case "EXPONENT_NOTATION":
      return "Écrivez le montant en chiffres, sans notation scientifique.";
    case "UNEXPECTED_CHARACTER":
      return "Chiffres, séparateur de milliers et virgule décimale uniquement.";
    case "NOT_FINITE":
      return "Montant illisible.";
  }
}

export interface MoneyInputProps {
  id: string;
  label: string;
  /**
   * Valeur COMMITTÉE. `null` signifie « non déclaré » et rend un champ VIDE : il n'y a
   * aucune valeur par défaut, et surtout pas zéro.
   */
  value: number | null;
  /**
   * Devise du montant, obligatoire.
   *
   * Section 18.3 : « chaque montant porte sa devise ». Un champ sans devise laisse le
   * lecteur supposer l'euro, et une somme de devises différentes se ferait sans le dire.
   */
  currency: string;
  /**
   * Reçoit le RÉSULTAT DISCRIMINÉ de la lecture, pas un nombre.
   *
   * L'appelant est obligé de regarder `draft.state`, donc de distinguer « vide » de
   * « saisie illisible » de « zéro déclaré ». C'est la raison d'être de cette primitive :
   * l'ancien `inputNumber` rendait `0` pour les trois.
   */
  onChange: (draft: NumberDraft) => void;
  nature?: FieldNature;
  hint?: string;
  /** Exemple de format. Il reste un placeholder et ne devient jamais une valeur. */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Champ de saisie d'un montant.
 *
 * Trois états sont distingués, ce que ni `<input type="number">` ni l'ancien helper ne
 * savaient faire : la valeur committée, la chaîne EN COURS D'ÉDITION, et le résultat de
 * lecture. Sans cette distinction, un champ contrôlé reformate la frappe et produit le
 * `015000` décrit au constat 5.2 du plan.
 *
 * `type="text"` et non `type="number"`, volontairement : un champ numéro refuse la virgule
 * selon la locale du navigateur, se modifie à la molette de souris au survol, et rend une
 * chaîne vide indistinguable d'une saisie invalide. Aucun de ces trois comportements n'est
 * acceptable pour un montant.
 */
export function MoneyInput({
  id,
  label,
  value,
  currency,
  onChange,
  nature = "FACT",
  hint,
  placeholder,
  disabled,
  required,
}: MoneyInputProps) {
  // `null` signifie « pas d'édition en cours » : le champ affiche alors la valeur committée.
  // Tant qu'une édition est en cours, la frappe est rendue TELLE QUELLE. La reformater à
  // chaque touche est précisément ce qui produisait « 015000 ».
  const [draft, setDraft] = useState<string | null>(null);
  const [reason, setReason] = useState<NumberParseReason | null>(null);
  const text = draft ?? formatNumberForInput(value);
  const error = reason === null ? null : numberErrorMessage(reason);

  return (
    <FinancialField id={id} label={label} nature={nature} hint={hint} unit={currency} error={error}>
      <input
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error !== null}
        // Le libellé accessible porte la devise : un lecteur d'écran annonce donc
        // « Capital restant dû, en EUR » et non un nombre sans unité.
        aria-label={`${label}, en ${currency}`}
        autoComplete="off"
        className="fin-input fin-input-money"
        disabled={disabled}
        id={id}
        // Clavier décimal sur mobile, sans les défauts de `type="number"`.
        inputMode="decimal"
        onBlur={() => {
          // Une saisie ILLISIBLE reste affichée : l'effacer ferait disparaître le travail de
          // l'utilisateur sans qu'il sache pourquoi. Une saisie lisible ou vide laisse au
          // contraire la valeur committée reprendre la main, avec son formatage canonique.
          if (reason === null) setDraft(null);
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const parsed = parseNumberInput(raw);
          setReason(parsed.state === "INVALID" ? parsed.reason : null);
          onChange(parsed);
        }}
        placeholder={placeholder}
        required={required}
        type="text"
        value={text}
      />
    </FinancialField>
  );
}
