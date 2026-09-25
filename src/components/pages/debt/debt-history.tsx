"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/presentation/currency";
import { formatDate } from "@/components/pages/shared";
import type { DebtEvent, Liability } from "@/lib/types";

/**
 * B18 : historique d'une dette. Les événements restent lisibles, annulés compris, avec leur
 * date d'effet, leur nature (constaté, contractuel, prévu), leur source et, s'il y a lieu, le
 * motif de leur annulation. Les versions du contrat sont en détail à la demande. Rien ne
 * s'efface : annuler ajoute une trace motivée.
 */
const NATURE_LABELS: Record<DebtEvent["nature"], string> = {
  OBSERVED: "Constaté",
  CONTRACTUAL: "Contractuel",
  PLANNED: "Prévu",
};
const VERSION_LABELS = {
  INITIAL: "Création",
  PROMOTION: "Contrat d’un encours",
  CORRECTION: "Correction de saisie",
} as const;

/** Date civile de Paris d'un instant : un horodatage UTC près de minuit changerait de jour. */
function parisDate(iso: string): string {
  const value = new Date(iso);
  return Number.isNaN(value.getTime())
    ? "date inconnue"
    : value.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Paris",
      });
}

function percent(value: number): string {
  return `${(value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 4 })} %`;
}

function describe(event: DebtEvent, currency: string | null): string {
  const money = (value: number) => formatCurrency(value, currency);
  const content = event.content;
  switch (content.kind) {
    case "RATE_CHANGE":
      return `Taux révisé à ${percent(content.annualRate)}`;
    case "PAYMENT_CHANGE":
      return `Mensualité portée à ${money(content.paymentAmount)}`;
    case "AMENDMENT":
      return [
        "Avenant",
        content.annualRate !== null ? `taux ${percent(content.annualRate)}` : null,
        content.paymentAmount !== null ? `mensualité ${money(content.paymentAmount)}` : null,
        content.maturityDate !== null
          ? `dernière échéance ${formatDate(content.maturityDate)}`
          : null,
        content.note,
      ]
        .filter(Boolean)
        .join(" · ");
    case "DEFERRAL":
      return `Report de ${content.months} échéance${content.months > 1 ? "s" : ""} (${
        content.deferralKind === "TOTAL" ? "total" : "capital seulement"
      }, ${
        content.termEffect === "EXTEND_TERM"
          ? "durée allongée"
          : content.termEffect === "RECALCULATE_PAYMENT"
            ? "mensualité recalculée"
            : "effet sur la durée inconnu"
      })`;
    case "EARLY_REPAYMENT":
      return `Remboursement anticipé de ${money(content.amount)}${
        content.penalty === null ? ", indemnité inconnue" : `, indemnité ${money(content.penalty)}`
      }${content.balanceAfter !== null ? ` · encours constaté ${money(content.balanceAfter)}` : ""}`;
    case "FULL_REPAYMENT":
      return `Solde total de ${money(content.amount)}${
        content.penalty === null ? ", indemnité inconnue" : `, indemnité ${money(content.penalty)}`
      }`;
  }
}

export function DebtHistory({
  loan,
  busy,
  onCancelEvent,
}: {
  loan: Liability;
  busy: boolean;
  onCancelEvent: (eventId: string, reason: string) => Promise<boolean>;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const events = loan.events ?? [];
  const versions = loan.contractVersions ?? [];
  const currency = loan.currency ?? null;
  if (events.length === 0 && versions.length === 0) return null;

  async function confirm(eventId: string) {
    if (!reason.trim()) {
      setError("Indiquez le motif de l’annulation.");
      return;
    }
    setError(null);
    if (await onCancelEvent(eventId, reason.trim())) {
      setCancelling(null);
      setReason("");
    }
  }

  return (
    <section className="panel debt-history" aria-label="Historique du contrat">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Historique</span>
          <h2>Événements et versions du contrat</h2>
        </div>
      </div>
      {events.length ? (
        <ol className="debt-history-list">
          {events.map((event) => (
            <li key={event.id} className={event.cancellation ? "cancelled" : undefined}>
              <div>
                <span className="debt-history-date">{formatDate(event.effectiveDate)}</span>
                <strong>{describe(event, currency)}</strong>
                <span className="muted-copy">
                  {NATURE_LABELS[event.nature]} · source : {event.source}
                </span>
                {event.cancellation ? (
                  <span className="debt-history-cancelled">
                    Annulé le {parisDate(event.cancellation.cancelledAt)} :{" "}
                    {event.cancellation.reason}
                  </span>
                ) : null}
              </div>
              {!event.cancellation && cancelling !== event.id ? (
                <button
                  aria-label={`Annuler l’événement du ${formatDate(event.effectiveDate)}`}
                  className="button secondary compact"
                  disabled={busy}
                  onClick={() => {
                    setCancelling(event.id);
                    setReason("");
                    setError(null);
                  }}
                  type="button"
                >
                  Annuler l’événement
                </button>
              ) : null}
              {cancelling === event.id ? (
                <div className="debt-history-cancel">
                  <label>
                    Motif de l’annulation
                    <input
                      className="text-input"
                      maxLength={500}
                      value={reason}
                      onChange={(change) => setReason(change.target.value)}
                    />
                  </label>
                  {event.observationId ? (
                    <p className="muted-copy">
                      L’encours constaté écrit avec cet événement reste une observation datée :
                      l’annulation ne le modifie pas. S’il était faux, enregistrez l’encours
                      exact par « Nouvel encours ».
                    </p>
                  ) : null}
                  {error ? (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <div className="debt-draft-confirm">
                    <button
                      className="button secondary compact"
                      disabled={busy}
                      onClick={() => confirm(event.id)}
                      type="button"
                    >
                      Confirmer l’annulation
                    </button>
                    <button
                      className="button secondary compact"
                      onClick={() => setCancelling(null)}
                      type="button"
                    >
                      Garder
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted-copy">Aucun événement enregistré depuis la signature.</p>
      )}
      {versions.length ? (
        <details className="debt-history-versions">
          <summary>Versions du contrat ({versions.length})</summary>
          <ol>
            {versions.map((version) => (
              <li key={version.id}>
                Version {version.versionNo} · {VERSION_LABELS[version.changeKind]} ·{" "}
                {parisDate(version.recordedAt)}
                {version.changeReason ? ` · motif : ${version.changeReason}` : ""}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
