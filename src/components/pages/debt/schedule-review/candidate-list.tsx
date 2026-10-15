"use client";

import { memo } from "react";

import { formatDate } from "@/components/pages/shared";
import type { ScheduleFieldView } from "@/lib/data/schedule-document-contracts";
import { SCHEDULE_COLUMN_LABELS, type ScheduleLine } from "@/lib/presentation/debt/schedule-review";
import { FIELD_STATUS_LABELS } from "./client";
import { retainedText } from "./field-panel";

/** Une case demande l'attention si une décision la concerne ou si la lecture la signale. */
export function needsAttention(field: ScheduleFieldView, flagged: ReadonlySet<string>): boolean {
  return (
    field.validationStatus === "BLOCKED" ||
    field.validationStatus === "CORRECTED" ||
    field.validationStatus === "REJECTED" ||
    field.issues.some((issue) => issue.severity !== "INFO") ||
    flagged.has(field.boxCode)
  );
}

/**
 * Candidats par ligne d'échéance : la valeur retenue, et la valeur imprimée quand elles
 * diffèrent. Sélectionner un candidat sélectionne sa cellule dans la pièce.
 */
export const CandidateList = memo(function CandidateList({
  lines,
  currency,
  selectedId,
  onSelect,
}: {
  lines: ScheduleLine[];
  currency: string | null;
  selectedId: string | null;
  onSelect: (fieldId: string) => void;
}) {
  if (lines.length === 0) {
    return <p className="schedule-empty">Aucune ligne ne correspond à ce filtre.</p>;
  }
  return (
    <ol className="schedule-lines">
      {lines.map((line) => (
        <li key={line.lineNumber}>
          <h4>
            Échéance {line.lineNumber}
            {" · "}
            {line.date?.effectiveDate ? formatDate(line.date.effectiveDate) : "date non lue"}
            <small> · ligne {line.rowNumber} du fichier</small>
          </h4>
          <ul>
            {line.fields.map((field) => {
              const printedDiffers =
                field.validationStatus === "CORRECTED" || field.validationStatus === "REJECTED";
              return (
                <li key={field.fieldId}>
                  <button
                    aria-pressed={field.fieldId === selectedId}
                    data-status={field.validationStatus.toLowerCase()}
                    id={`schedule-candidate-${field.fieldId}`}
                    onClick={() => onSelect(field.fieldId)}
                    type="button"
                  >
                    <span className="schedule-candidate-label">
                      {SCHEDULE_COLUMN_LABELS[field.columnKey] ?? field.columnLabel}
                    </span>
                    <span className="schedule-candidate-value">
                      {field.validationStatus === "REJECTED"
                        ? "Écartée"
                        : retainedText(field, currency)}
                      {printedDiffers ? (
                        <small>imprimé : {field.rawValue ?? "cellule vide"}</small>
                      ) : null}
                    </span>
                    <span className="schedule-candidate-status">
                      {FIELD_STATUS_LABELS[field.validationStatus]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
});
