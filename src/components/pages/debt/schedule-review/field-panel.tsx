"use client";

import { useState, type FormEvent } from "react";

import { formatDate } from "@/components/pages/shared";
import type {
  ScheduleDecisionView,
  ScheduleFieldView,
  ScheduleRunSummary,
} from "@/lib/data/schedule-document-contracts";
import { formatCurrency } from "@/lib/presentation/currency";
import { SCHEDULE_COLUMN_LABELS } from "@/lib/presentation/debt/schedule-review";
import { parisDate } from "../debt-history";
import { FIELD_STATUS_LABELS } from "./client";

export interface FieldDecision {
  action: "correct" | "reject" | "review";
  userValue?: string;
  userDate?: string;
  reason: string | null;
}

/** Valeur RETENUE d'une case, telle qu'elle entrera dans la lecture validée. */
export function retainedText(
  field: Pick<
    ScheduleFieldView,
    "unit" | "effectiveValue" | "effectiveDate" | "rawValue" | "validationStatus"
  >,
  currency: string | null,
): string {
  if (field.validationStatus === "REJECTED") return "Aucune — case écartée";
  if (field.unit === "DATE")
    return field.effectiveDate ? formatDate(field.effectiveDate) : "Aucune";
  if (field.unit === "TEXT") return field.rawValue ?? "Cellule vide";
  return field.effectiveValue === null ? "Aucune" : formatCurrency(field.effectiveValue, currency);
}

function decisionValue(
  unit: ScheduleFieldView["unit"],
  value: number | null,
  date: string | null,
  currency: string | null,
) {
  if (unit === "DATE") return date ? formatDate(date) : "aucune";
  return value === null ? "aucune" : formatCurrency(value, currency);
}

const ACTION_LABELS: Record<ScheduleDecisionView["action"], string> = {
  REVIEW: "Confirmée",
  CORRECT: "Corrigée",
  REJECT: "Écartée",
};

/**
 * Détail d'une case et décisions possibles. La valeur imprimée reste affichée à côté de la
 * valeur retenue : corriger n'efface jamais ce que la pièce portait.
 */
export function FieldPanel({
  field,
  run,
  history,
  editable,
  busy,
  onDecide,
}: {
  field: ScheduleFieldView;
  run: ScheduleRunSummary;
  history: ScheduleDecisionView[];
  editable: boolean;
  busy: boolean;
  onDecide: (decision: FieldDecision) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"correct" | "reject" | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const currency = run.currency;
  const columnName =
    SCHEDULE_COLUMN_LABELS[field.columnKey] ?? field.columnLabel ?? "Colonne non reconnue";
  const decidable = editable && field.validationStatus !== "UNKNOWN_BOX";
  const correctable = decidable && field.unit !== "TEXT";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!mode) return;
    const trimmed = reason.trim();
    const done = await onDecide(
      mode === "reject"
        ? { action: "reject", reason: trimmed }
        : field.unit === "DATE"
          ? { action: "correct", userDate: value, reason: trimmed }
          : // Le séparateur de milliers saisi à la française n'est pas une erreur de saisie.
            { action: "correct", userValue: value.replace(/[\s  ]/g, ""), reason: trimmed },
    );
    if (done) {
      setMode(null);
      setValue("");
      setReason("");
    }
  }

  return (
    <section className="schedule-field-panel" aria-label={`Case ${field.cellRef ?? field.boxCode}`}>
      <header>
        <h3>
          {columnName} · échéance {field.lineNumber}
        </h3>
        <span className={`schedule-status status-${field.validationStatus.toLowerCase()}`}>
          {FIELD_STATUS_LABELS[field.validationStatus]}
        </span>
      </header>
      <dl className="schedule-field-facts">
        <div>
          <dt>Imprimé dans la pièce</dt>
          <dd>{field.rawValue ?? <em>Cellule vide</em>}</dd>
        </div>
        <div>
          <dt>Valeur retenue</dt>
          <dd>{retainedText(field, currency)}</dd>
        </div>
        <div>
          <dt>Unité</dt>
          <dd>
            {field.unit === "MONEY"
              ? `Montant · ${currency ?? "devise non déclarée"}`
              : field.unit === "DATE"
                ? "Date"
                : "Texte, hors calcul"}
          </dd>
        </div>
        <div>
          <dt>Emplacement</dt>
          <dd>
            {field.sheetName ? `Feuille « ${field.sheetName} » · ` : ""}ligne {field.rowNumber}
            {" · "}cellule {field.cellRef ?? "inconnue"}
            {field.columnLabel ? ` · en-tête « ${field.columnLabel} »` : ""}
          </dd>
        </div>
        <div>
          <dt>Version de lecture</dt>
          <dd>
            {run.extractorVersion} · lue le {parisDate(run.extractedAt)}
          </dd>
        </div>
        {field.userReason ? (
          <div>
            <dt>Motif</dt>
            <dd>{field.userReason}</dd>
          </div>
        ) : null}
      </dl>
      {field.issues.length > 0 ? (
        <p className="schedule-field-issues-title">Signalé à la lecture</p>
      ) : null}
      {field.issues.length > 0 ? (
        <ul className="schedule-field-issues">
          {field.issues.map((issue, index) => (
            <li
              key={`${issue.code}-${index}`}
              className={issue.severity === "INFO" ? "" : "warning-text"}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {decidable ? (
        <div className="schedule-field-actions">
          <button
            className="button secondary compact"
            disabled={busy || field.validationStatus === "BLOCKED"}
            onClick={() => onDecide({ action: "review", reason: null })}
            title={
              field.validationStatus === "BLOCKED"
                ? "Une case illisible se corrige ou s’écarte : la confirmer laisserait sa valeur inconnue."
                : undefined
            }
            type="button"
          >
            Confirmer la lecture
          </button>
          {correctable ? (
            <button
              aria-pressed={mode === "correct"}
              className="button secondary compact"
              disabled={busy}
              onClick={() => setMode(mode === "correct" ? null : "correct")}
              type="button"
            >
              Corriger
            </button>
          ) : null}
          <button
            aria-pressed={mode === "reject"}
            className="button secondary compact"
            disabled={busy}
            onClick={() => setMode(mode === "reject" ? null : "reject")}
            type="button"
          >
            Écarter
          </button>
        </div>
      ) : null}

      {mode ? (
        <form className="schedule-field-form" onSubmit={submit}>
          {mode === "correct" ? (
            <label>
              {field.unit === "DATE"
                ? "Date retenue"
                : `Montant retenu (${currency ?? "devise non déclarée"})`}
              {field.unit === "DATE" ? (
                <input
                  className="text-input"
                  onChange={(event) => setValue(event.target.value)}
                  required
                  type="date"
                  value={value}
                />
              ) : (
                <input
                  className="text-input"
                  inputMode="decimal"
                  onChange={(event) => setValue(event.target.value)}
                  pattern="-?[0-9\s  ]+([.,][0-9]+)?"
                  placeholder="ex. 1234,56"
                  required
                  value={value}
                />
              )}
            </label>
          ) : null}
          <label>
            Motif
            <textarea
              className="text-input"
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                mode === "reject" ? "Pourquoi cette case est écartée" : "Ce que vous avez relu"
              }
              required
              rows={2}
              value={reason}
            />
          </label>
          <div className="form-actions">
            <button
              className="button secondary compact"
              onClick={() => setMode(null)}
              type="button"
            >
              Annuler
            </button>
            <button className="button primary compact" disabled={busy} type="submit">
              {mode === "reject" ? "Écarter cette case" : "Retenir cette valeur"}
            </button>
          </div>
        </form>
      ) : null}

      <details className="schedule-field-history">
        <summary>
          Historique {history.length > 0 ? `(${history.length})` : "· aucune décision"}
        </summary>
        {history.length > 0 ? (
          <ol>
            {history.map((decision) => (
              <li key={decision.rank}>
                <strong>{ACTION_LABELS[decision.action]}</strong> le {parisDate(decision.decidedAt)}{" "}
                : {decisionValue(field.unit, decision.beforeValue, decision.beforeDate, currency)} →{" "}
                {decisionValue(field.unit, decision.afterValue, decision.afterDate, currency)}
                {decision.reason ? <small> · {decision.reason}</small> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </details>
    </section>
  );
}
