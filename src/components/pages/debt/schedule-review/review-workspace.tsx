"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";

import { Callout, Modal } from "@/components/ui";
import { formatDate } from "@/components/pages/shared";
import type { ScheduleCheckView, ScheduleReview } from "@/lib/data/schedule-document-contracts";
import { formatCurrency } from "@/lib/presentation/currency";
import {
  buildScheduleGrid,
  buildScheduleLines,
  checkFields,
  fieldHistory,
  overlappingDueDates,
  summarizeScheduleReview,
} from "@/lib/presentation/debt/schedule-review";
import { CandidateList, needsAttention } from "./candidate-list";
import { callSchedule, openPiece, runIsOpen, ScheduleCallError } from "./client";
import { FieldPanel, type FieldDecision } from "./field-panel";
import { ConflictList, PartialHelp, ReadingBanner } from "./reading-banner";
import { SourceGrid } from "./source-grid";

function reveal(id: string) {
  document.getElementById(id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/**
 * Revue d'un échéancier déposé (B19, D-UX-11) : la pièce à gauche, les candidats et la case
 * sélectionnée à droite. Rien de ce qui se décide ici ne modifie le prêt : la lecture validée
 * attend son rattachement.
 */
export function ScheduleReviewWorkspace({
  runId,
  existingDueDates,
  onClose,
}: {
  runId: string;
  /** Dates de l'échéancier déjà enregistré sur la dette, pour signaler un chevauchement. */
  existingDueDates: readonly string[];
  onClose: () => void;
}) {
  const [review, setReview] = useState<ScheduleReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"piece" | "candidates">("piece");
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [validating, setValidating] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [refusal, setRefusal] = useState("");

  const fetchReview = useCallback(
    () => callSchedule<ScheduleReview>(`?runId=${encodeURIComponent(runId)}`),
    [runId],
  );
  const load = useCallback(async () => {
    try {
      setReview(await fetchReview());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lecture indisponible.");
    }
  }, [fetchReview]);

  useEffect(() => {
    let active = true;
    fetchReview().then(
      (loaded) => active && setReview(loaded),
      (caught: unknown) =>
        active && setError(caught instanceof Error ? caught.message : "Lecture indisponible."),
    );
    return () => {
      active = false;
    };
  }, [fetchReview]);

  const derived = useMemo(() => {
    if (!review) return null;
    const failedChecks = review.checks.filter((check) => check.status === "FAILED");
    const flagged = new Set(failedChecks.flatMap((check) => [...check.left, ...check.right]));
    const lines = buildScheduleLines(review.fields);
    return {
      grid: buildScheduleGrid(review.fields),
      lines,
      attentionLines: lines.filter((line) =>
        line.fields.some((field) => needsAttention(field, flagged)),
      ),
      synthesis: summarizeScheduleReview(review),
      failedChecks,
      overlapping: overlappingDueDates(review.fields, existingDueDates),
    };
  }, [review, existingDueDates]);

  const select = useCallback((fieldId: string) => {
    setSelectedId(fieldId);
    // La sélection est partagée : l'autre côté se place sur la même case.
    requestAnimationFrame(() => {
      reveal(`schedule-cell-${fieldId}`);
      reveal(`schedule-candidate-${fieldId}`);
    });
  }, []);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      setReview(
        await callSchedule<ScheduleReview>("", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      return true;
    } catch (caught) {
      if (caught instanceof ScheduleCallError && caught.status === 409) {
        // Révision périmée : la case a été décidée ailleurs. On relit au lieu d'écraser.
        await load();
        setNotice(`${caught.message} La revue a été rechargée.`);
      } else {
        setNotice(caught instanceof Error ? caught.message : "Décision non enregistrée.");
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <section className="panel schedule-review">
        <Callout title="Lecture indisponible" tone="warning">
          {error}
        </Callout>
        <button className="button secondary" onClick={onClose} type="button">
          <ArrowLeft size={15} /> Retour à la dette
        </button>
      </section>
    );
  }
  if (!review || !derived) {
    return (
      <section className="panel schedule-review" aria-busy="true">
        <p>Chargement de la lecture…</p>
      </section>
    );
  }

  const { run } = review;
  const { synthesis } = derived;
  const decidable = runIsOpen(run.status) || run.status === "VALIDATED";
  const selected = review.fields.find((field) => field.fieldId === selectedId) ?? null;
  const shownLines = filter === "attention" ? derived.attentionLines : derived.lines;

  function showCheck(check: ScheduleCheckView) {
    const first = checkFields(review!.fields, [...check.left, ...check.right])[0];
    if (first) select(first.fieldId);
  }

  return (
    <section className="panel schedule-review" aria-label="Revue de l’échéancier">
      <header className="schedule-review-header">
        <button className="button secondary compact" onClick={onClose} type="button">
          <ArrowLeft size={15} /> Retour à la dette
        </button>
        <h2>Revue de l’échéancier</h2>
        <div className="schedule-review-actions">
          {run.documentId ? (
            <button
              className="button secondary compact"
              onClick={() =>
                openPiece(run.runId).catch((caught: Error) => setNotice(caught.message))
              }
              type="button"
            >
              <Download size={15} /> Pièce d’origine
            </button>
          ) : null}
          {runIsOpen(run.status) ? (
            <>
              <button
                className="button secondary compact"
                disabled={busy}
                onClick={() => setRefusing(true)}
                type="button"
              >
                Refuser cette lecture
              </button>
              <button
                className="button primary compact"
                disabled={busy}
                onClick={() => setValidating(true)}
                type="button"
              >
                Valider cette lecture
              </button>
            </>
          ) : null}
        </div>
      </header>

      <ReadingBanner run={run} synthesis={synthesis} />
      {run.status === "VALIDATED" ? (
        <Callout title="Lecture validée">
          Rien n’est encore appliqué au prêt : la lecture attend son rattachement. Une nouvelle
          décision sur une case la renvoie en revue.
        </Callout>
      ) : null}
      {notice ? (
        <p className="warning-text" role="alert">
          {notice}
        </p>
      ) : null}
      <ConflictList
        run={run}
        synthesis={synthesis}
        failedChecks={derived.failedChecks}
        overlapping={derived.overlapping}
        onShowCheck={showCheck}
      />

      {review.fields.length === 0 ? (
        <Callout title="Aucune case lue" tone="warning">
          Le fichier n’a produit aucune cellule exploitable. Les anomalies ci-dessus disent
          pourquoi.
        </Callout>
      ) : (
        <>
          <div className="schedule-view-switch" role="group" aria-label="Affichage">
            <button aria-pressed={view === "piece"} onClick={() => setView("piece")} type="button">
              Pièce
            </button>
            <button
              aria-pressed={view === "candidates"}
              onClick={() => setView("candidates")}
              type="button"
            >
              Candidats{selected?.cellRef ? ` · ${selected.cellRef}` : ""}
            </button>
          </div>
          <div className="schedule-review-layout" data-view={view}>
            <div className="schedule-piece">
              <SourceGrid grid={derived.grid} selectedId={selectedId} onSelect={select} />
            </div>
            <div className="schedule-side">
              {selected ? (
                <FieldPanel
                  key={`${selected.fieldId}-${selected.decisionRevision}`}
                  busy={busy}
                  editable={decidable}
                  field={selected}
                  history={fieldHistory(review.decisions, selected.fieldId)}
                  onDecide={(decision: FieldDecision) =>
                    patch({
                      action: decision.action,
                      fieldId: selected.fieldId,
                      expectedRevision: selected.decisionRevision,
                      ...(decision.userValue !== undefined
                        ? { userValue: decision.userValue }
                        : {}),
                      ...(decision.userDate !== undefined ? { userDate: decision.userDate } : {}),
                      reason: decision.reason,
                    })
                  }
                  run={run}
                />
              ) : (
                <p className="schedule-empty">
                  Sélectionnez une cellule de la pièce ou un candidat pour voir sa lecture.
                </p>
              )}
              <div className="schedule-filter" role="group" aria-label="Lignes affichées">
                <button
                  aria-pressed={filter === "attention"}
                  onClick={() => setFilter("attention")}
                  type="button"
                >
                  À examiner ({derived.attentionLines.length})
                </button>
                <button
                  aria-pressed={filter === "all"}
                  onClick={() => setFilter("all")}
                  type="button"
                >
                  Toutes ({derived.lines.length})
                </button>
              </div>
              <CandidateList
                currency={run.currency}
                lines={shownLines}
                onSelect={select}
                selectedId={selectedId}
              />
            </div>
          </div>
        </>
      )}

      <Modal
        open={validating}
        onClose={() => setValidating(false)}
        title="Valider cette lecture"
        subtitle="Synthèse de ce qui sera validé"
      >
        <dl className="schedule-synthesis">
          <div>
            <dt>Période</dt>
            <dd>
              {synthesis.firstDueDate && synthesis.lastDueDate
                ? `${formatDate(synthesis.firstDueDate)} → ${formatDate(synthesis.lastDueDate)}`
                : "non lue"}
            </dd>
          </div>
          <div>
            <dt>Échéances</dt>
            <dd>{synthesis.lineCount}</dd>
          </div>
          {synthesis.sums.map((sum) => (
            <div key={sum.key}>
              <dt>
                {sum.label}, somme {synthesis.partial ? "sur l’extrait" : "des lignes"}
              </dt>
              <dd>
                {sum.sum !== null
                  ? formatCurrency(sum.sum, run.currency)
                  : sum.reason === "ABSENT"
                    ? "colonne absente du fichier"
                    : `non calculable : ${sum.missingCount} case${sum.missingCount > 1 ? "s" : ""} sans valeur`}
              </dd>
            </div>
          ))}
        </dl>
        {synthesis.partial ? (
          <p className="warning-text">
            Extrait partiel <PartialHelp /> : ces sommes ne disent pas le coût du prêt.
          </p>
        ) : null}
        {synthesis.failedBlockingChecks > 0 || synthesis.blockedFieldCount > 0 || !run.currency ? (
          <Callout title="La validation sera refusée en l’état" tone="warning">
            {[
              synthesis.failedBlockingChecks > 0
                ? `${synthesis.failedBlockingChecks} contrôle(s) bloquant(s) en échec`
                : null,
              synthesis.blockedFieldCount > 0
                ? `${synthesis.blockedFieldCount} case(s) illisible(s)`
                : null,
              !run.currency ? "devise non déclarée" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Callout>
        ) : null}
        <p>
          Valider confirme que cette lecture reflète la pièce. Rien n’est encore appliqué au prêt :
          son échéancier, son encours et ses paiements restent inchangés tant que la lecture n’est
          pas rattachée.
        </p>
        <div className="form-actions">
          <button className="button secondary" onClick={() => setValidating(false)} type="button">
            Annuler
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              if (await patch({ action: "validate", runId: run.runId })) setValidating(false);
            }}
            type="button"
          >
            Valider cette lecture
          </button>
        </div>
        {notice && validating ? (
          <p className="warning-text" role="alert">
            {notice}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={refusing}
        onClose={() => setRefusing(false)}
        title="Refuser cette lecture"
        subtitle="La pièce reste conservée ; la lecture ne pourra plus être validée."
      >
        <label className="full">
          Motif (facultatif)
          <textarea
            className="text-input"
            maxLength={500}
            onChange={(event) => setRefusal(event.target.value)}
            rows={3}
            value={refusal}
          />
        </label>
        <div className="form-actions">
          <button className="button secondary" onClick={() => setRefusing(false)} type="button">
            Annuler
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              const reason = refusal.trim();
              if (await patch({ action: "reject-run", runId: run.runId, reason: reason || null }))
                setRefusing(false);
            }}
            type="button"
          >
            Refuser cette lecture
          </button>
        </div>
      </Modal>
    </section>
  );
}
