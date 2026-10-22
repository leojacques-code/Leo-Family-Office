import type { ReactNode } from "react";
import type { DocumentFieldDecisionView } from "@/lib/data/document-contracts";

const ACTION_LABELS = { REVIEW: "Confirmée", CORRECT: "Corrigée", REJECT: "Écartée" } as const;
const timestamp = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "medium",
  timeZone: "Europe/Paris",
});

/** Même piste de décisions pour liasse et échéancier ; les valeurs gardent leur unité métier. */
export function DocumentFieldDecisionHistory({
  history,
  renderChange,
}: {
  history: readonly DocumentFieldDecisionView[] | undefined;
  renderChange: (decision: DocumentFieldDecisionView) => ReactNode;
}) {
  return (
    <details className="schedule-field-history">
      <summary>
        Historique{" "}
        {history === undefined
          ? "· indisponible"
          : history.length > 0
            ? `(${history.length})`
            : "· aucune décision"}
      </summary>
      {history === undefined ? (
        <p>L’historique n’a pas été reçu. Rechargez la lecture pour le consulter.</p>
      ) : history.length > 0 ? (
        <ol>
          {[...history]
            .sort((a, b) => a.rank - b.rank)
            .map((decision) => {
              const date = new Date(decision.decidedAt);
              return (
                <li key={decision.rank}>
                  <strong>{ACTION_LABELS[decision.action]}</strong>{" "}
                  {decision.actor === "CURRENT_USER"
                    ? "par vous"
                    : decision.actor === "OTHER"
                      ? "par un autre auteur"
                      : "· auteur non consigné"}{" "}
                  le{" "}
                  {Number.isNaN(date.getTime()) ? (
                    "date inconnue"
                  ) : (
                    <time dateTime={decision.decidedAt}>{timestamp.format(date)} (Paris)</time>
                  )}
                  {renderChange(decision)}
                  {decision.reason ? <small> · {decision.reason}</small> : null}
                </li>
              );
            })}
        </ol>
      ) : null}
    </details>
  );
}
