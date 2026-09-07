"use client";

import { useState } from "react";
import {
  formatNumberForInput,
  parseNumberInput,
  type NumberDraft,
  type NumberParseReason,
} from "@/lib/presentation/input-parse";
import { FinancialField, describedBy, type FieldNature } from "./financial-field";
import { numberErrorMessage } from "./money-input";

export interface OptionalNumberInputProps {
  id: string;
  label: string;
  /** `null` rend un champ vide. Aucune valeur par défaut, et surtout pas zéro. */
  value: number | null;
  onChange: (draft: NumberDraft) => void;
  /**
   * Unité de la grandeur : « parts », « m² », « échéances », « mois ».
   *
   * Facultative, contrairement à la devise d'un montant : certaines grandeurs sont sans
   * unité (un nombre de titres, un rang de priorité). Elle n'est jamais inventée.
   */
  unit?: string;
  nature?: FieldNature;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Champ de saisie d'une grandeur numérique qui n'est ni un montant ni un taux : quantité de
 * titres, surface, nombre d'échéances, priorité.
 *
 * Même contrat que `MoneyInput` sur le fond : VIDE ≠ ILLISIBLE ≠ ZÉRO. Un nombre
 * d'échéances laissé vide est inconnu, pas égal à zéro, et un prêt à zéro échéance n'est pas
 * la même chose qu'un prêt dont on ignore la durée.
 */
export function OptionalNumberInput({
  id,
  label,
  value,
  onChange,
  unit,
  nature = "FACT",
  hint,
  placeholder,
  disabled,
  required,
}: OptionalNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [reason, setReason] = useState<NumberParseReason | null>(null);
  const text = draft ?? formatNumberForInput(value);
  const error = reason === null ? null : numberErrorMessage(reason);

  return (
    <FinancialField id={id} label={label} nature={nature} hint={hint} unit={unit} error={error}>
      <input
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error !== null}
        aria-label={unit ? `${label}, en ${unit}` : label}
        autoComplete="off"
        className="fin-input fin-input-number"
        disabled={disabled}
        id={id}
        inputMode="decimal"
        onBlur={() => {
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
