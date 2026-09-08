"use client";

import { useState } from "react";
import {
  formatPercentForInput,
  parsePercentInput,
  type NumberDraft,
  type NumberParseReason,
} from "@/lib/presentation/input-parse";
import { FinancialField, describedBy, type FieldNature } from "./financial-field";
import { numberErrorMessage } from "./money-input";

/**
 * Nature d'un taux.
 *
 * Section 18.3 : « les taux précisent leur nature : nominal, TAEG, rendement, croissance,
 * inflation, fiscalité ou actualisation ». Ce n'est pas une étiquette de confort : un taux
 * nominal et un TAEG ne se comparent pas, et un rendement n'est pas un taux d'actualisation.
 * La liste est donc CLOSE et reprise du plan, sans ajout.
 */
export type RateNature =
  "NOMINAL" | "APR" | "YIELD" | "GROWTH" | "INFLATION" | "TAX" | "DISCOUNT" | "SHARE";

const RATE_NATURE_LABELS: Record<RateNature, string> = {
  NOMINAL: "taux nominal",
  APR: "TAEG",
  YIELD: "rendement",
  GROWTH: "croissance",
  INFLATION: "inflation",
  TAX: "taux d’imposition",
  DISCOUNT: "taux d’actualisation",
  SHARE: "quote-part",
};

export interface PercentInputProps {
  id: string;
  label: string;
  /**
   * TAUX DÉCIMAL committé, pas un pourcentage : `0.035` s'affiche « 3,5 ».
   *
   * POURCENTAGE AFFICHÉ ≠ TAUX STOCKÉ. La base persiste des décimales, l'utilisateur écrit
   * des pourcentages. Confondre les deux multiplie ou divise un taux par cent en silence,
   * et aucun contrôle de forme ne le rattrape : 0,035 et 3,5 sont deux nombres valides.
   */
  value: number | null;
  /** Nature du taux, obligatoire. Un taux sans nature n'est pas comparable. */
  rateNature: RateNature;
  /** Reçoit le résultat discriminé, dont la valeur est un taux DÉCIMAL. */
  onChange: (draft: NumberDraft) => void;
  nature?: FieldNature;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

/** Champ de saisie d'un taux, écrit en pourcentage et rendu en décimal. */
export function PercentInput({
  id,
  label,
  value,
  rateNature,
  onChange,
  nature = "FACT",
  hint,
  placeholder,
  disabled,
  required,
}: PercentInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [reason, setReason] = useState<NumberParseReason | null>(null);
  const text = draft ?? formatPercentForInput(value);
  const error = reason === null ? null : numberErrorMessage(reason);

  return (
    <FinancialField id={id} label={label} nature={nature} hint={hint} unit="%" error={error}>
      <input
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error !== null}
        // La nature du taux est dans le libellé accessible : un lecteur d'écran annonce
        // « Coût du crédit, TAEG, en pourcentage » et pas seulement un nombre.
        aria-label={`${label}, ${RATE_NATURE_LABELS[rateNature]}, en pourcentage`}
        autoComplete="off"
        className="fin-input fin-input-percent"
        data-rate-nature={rateNature}
        disabled={disabled}
        id={id}
        inputMode="decimal"
        onBlur={() => {
          if (reason === null) setDraft(null);
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const parsed = parsePercentInput(raw);
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
