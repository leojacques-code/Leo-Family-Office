"use client";

import { useState } from "react";
import {
  parseDateInput,
  type DateDraft,
  type DateParseReason,
} from "@/lib/presentation/input-parse";
import { FinancialField, describedBy, type FieldNature } from "./financial-field";

function dateErrorMessage(reason: DateParseReason): string {
  switch (reason) {
    case "NOT_ISO":
      return "Date attendue au format jour, mois, année.";
    case "NOT_A_CALENDAR_DATE":
      return "Cette date n’existe pas au calendrier.";
  }
}

export interface DateInputProps {
  id: string;
  label: string;
  /**
   * Date ISO committée, ou `null`.
   *
   * `null` rend un champ VIDE. Section 18.3 : « les dates ne sont jamais forcées à la date
   * financière ». Préremplir la date d'arrêté ferait passer une date par défaut pour une
   * date économique déclarée, ce qui est le même mensonge qu'un montant prérempli à zéro.
   */
  value: string | null;
  onChange: (draft: DateDraft) => void;
  nature?: FieldNature;
  hint?: string;
  /** Borne basse acceptée, date ISO. Le navigateur la fait respecter au calendrier. */
  min?: string;
  /** Borne haute acceptée, date ISO. Sert notamment à interdire un fait futur. */
  max?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Champ de saisie d'une date.
 *
 * `type="date"` est retenu parce qu'il satisfait les DEUX exigences de la section 18.3,
 * clavier et calendrier, sans qu'aucune bibliothèque ne soit ajoutée : le navigateur fournit
 * le sélecteur, la navigation clavier, la localisation de l'affichage, et rend toujours une
 * valeur ISO. Un composant maison devrait réimplémenter les quatre, dont l'accessibilité.
 */
export function DateInput({
  id,
  label,
  value,
  onChange,
  nature = "FACT",
  hint,
  min,
  max,
  disabled,
  required,
}: DateInputProps) {
  const [reason, setReason] = useState<DateParseReason | null>(null);
  const error = reason === null ? null : dateErrorMessage(reason);

  return (
    <FinancialField id={id} label={label} nature={nature} hint={hint} error={error}>
      <input
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error !== null}
        className="fin-input fin-input-date"
        disabled={disabled}
        id={id}
        max={max}
        min={min}
        onChange={(event) => {
          // Pas de brouillon local ici : `type="date"` ne rend jamais une chaîne
          // partiellement saisie, il rend une date ISO complète ou la chaîne vide. Le
          // problème du champ contrôlé qui reformate la frappe ne s'y pose donc pas.
          const parsed = parseDateInput(event.target.value);
          setReason(parsed.state === "INVALID" ? parsed.reason : null);
          onChange(parsed);
        }}
        required={required}
        type="date"
        value={value ?? ""}
      />
    </FinancialField>
  );
}
