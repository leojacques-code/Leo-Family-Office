"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Download, FileSpreadsheet, UploadCloud } from "lucide-react";

import { formatDate } from "@/components/pages/shared";
import { FinancialDrawer } from "@/components/workstation/financial-drawer";
import type { DocumentIssue } from "@/lib/acquisition/documents/types";
import type { ScheduleReview, ScheduleRunSummary } from "@/lib/data/schedule-document-contracts";
import {
  ACCEPTED_SCHEDULE_EXTENSIONS,
  MAX_SCHEDULE_UPLOAD_BYTES,
} from "@/lib/validation/schedule-documents";
import { parisDate } from "../debt-history";
import { callSchedule, openPiece, RUN_STATUS_LABELS, ScheduleCallError } from "./client";

const MAX_MEGABYTES = MAX_SCHEDULE_UPLOAD_BYTES / (1024 * 1024);

/**
 * Section « Documents » de la fiche Dette (D-UX-03) : les lectures d'échéancier déposées,
 * leur état, l'accès à la pièce et à la revue. Compacte : elle ne prend pas la place du canevas.
 */
export function DebtDocumentsSection({
  liabilityId,
  liabilityCurrency,
  onOpenReview,
  uploadOpen,
  onUploadOpenChange,
}: {
  liabilityId: string;
  liabilityCurrency: string | null;
  onOpenReview: (runId: string) => void;
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
}) {
  const [runs, setRuns] = useState<ScheduleRunSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [currency, setCurrency] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<DocumentIssue[]>([]);
  const [pieceError, setPieceError] = useState<string | null>(null);

  const fetchRuns = useCallback(
    () => callSchedule<ScheduleRunSummary[]>(`?liabilityId=${encodeURIComponent(liabilityId)}`),
    [liabilityId],
  );
  const load = useCallback(async () => {
    try {
      setRuns(await fetchRuns());
      setListError(null);
    } catch (caught) {
      setListError(caught instanceof Error ? caught.message : "Documents indisponibles.");
    }
  }, [fetchRuns]);

  useEffect(() => {
    let active = true;
    fetchRuns().then(
      (loaded) => active && setRuns(loaded),
      (caught: unknown) =>
        active &&
        setListError(caught instanceof Error ? caught.message : "Documents indisponibles."),
    );
    return () => {
      active = false;
    };
  }, [fetchRuns]);

  function closeDrawer() {
    onUploadOpenChange(false);
    setFile(null);
    setCurrency("");
    setUploadError(null);
    setRefusal([]);
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!ACCEPTED_SCHEDULE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      setUploadError("Formats lus : CSV et XLSX.");
      return;
    }
    if (file.size > MAX_SCHEDULE_UPLOAD_BYTES) {
      setUploadError(`Fichier supérieur à ${MAX_MEGABYTES} Mo.`);
      return;
    }
    setUploading(true);
    setUploadError(null);
    setRefusal([]);
    const form = new FormData();
    form.append("file", file);
    const declared = currency.trim().toUpperCase();
    form.append(
      "options",
      JSON.stringify({ liabilityId, declaredCurrency: declared === "" ? null : declared }),
    );
    try {
      const review = await callSchedule<ScheduleReview>("", { method: "POST", body: form });
      closeDrawer();
      await load();
      onOpenReview(review.run.runId);
    } catch (caught) {
      const body = caught instanceof ScheduleCallError ? caught.body : null;
      if (body && typeof body === "object" && "refused" in body && "issues" in body) {
        setRefusal((body as { issues: DocumentIssue[] }).issues);
        setUploadError("Le fichier n’a pas été lu.");
      } else {
        setUploadError(caught instanceof Error ? caught.message : "Dépôt impossible.");
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="panel debt-documents" aria-label="Documents de la dette">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Pièces et lectures</span>
          <h2>Documents</h2>
        </div>
        <button
          className="button secondary compact"
          onClick={() => onUploadOpenChange(true)}
          type="button"
        >
          <UploadCloud size={15} /> Importer un échéancier
        </button>
      </div>
      {listError ? <p className="warning-text">{listError}</p> : null}
      {pieceError ? (
        <p className="warning-text" role="alert">
          {pieceError}
        </p>
      ) : null}
      {runs === null && !listError ? <p className="panel-note">Chargement…</p> : null}
      {runs !== null && runs.length === 0 ? (
        <p className="panel-note">
          Aucun échéancier déposé. Un tableau d’amortissement CSV ou XLSX de la banque se lit ici en
          cases vérifiables, sans rien modifier au prêt.
        </p>
      ) : null}
      {runs !== null && runs.length > 0 ? (
        <ul className="debt-documents-list">
          {runs.map((run) => (
            <li key={run.runId}>
              <FileSpreadsheet size={16} aria-hidden="true" />
              <span className="debt-document-name">
                <strong>{run.fileName ?? "Échéancier sans nom"}</strong>
                <small>
                  {run.sourceFormat} · lu le {parisDate(run.extractedAt)}
                  {run.firstDueDate && run.lastDueDate
                    ? ` · ${formatDate(run.firstDueDate)} → ${formatDate(run.lastDueDate)}`
                    : ""}
                  {run.lineCount !== null ? ` · ${run.lineCount} échéances` : ""}
                  {run.completeness === "PARTIAL" ? " · extrait partiel" : ""}
                </small>
              </span>
              <span className="schedule-status">{RUN_STATUS_LABELS[run.status]}</span>
              <span className="debt-document-actions">
                <button
                  className="button secondary compact"
                  onClick={() => onOpenReview(run.runId)}
                  type="button"
                >
                  {run.status === "FAILED" ? "Voir les anomalies" : "Examiner"}
                </button>
                {run.documentId ? (
                  <button
                    aria-label={`Pièce d’origine de ${run.fileName ?? "l’échéancier"}`}
                    className="icon-button"
                    onClick={() => {
                      setPieceError(null);
                      openPiece(run.runId).catch((caught: Error) => setPieceError(caught.message));
                    }}
                    type="button"
                  >
                    <Download size={15} />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <FinancialDrawer
        open={uploadOpen}
        onClose={closeDrawer}
        title="Importer un échéancier"
        subtitle="La pièce est lue en cases à vérifier ; le prêt n’est pas modifié."
      >
        <form className="form-grid" onSubmit={upload}>
          <label className="full">
            Tableau d’amortissement
            <input
              accept={ACCEPTED_SCHEDULE_EXTENSIONS.join(",")}
              className="text-input"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
              type="file"
            />
            <small>
              CSV ou XLSX, {MAX_MEGABYTES} Mo au plus. Le PDF n’est pas encore pris en charge.
            </small>
          </label>
          <label className="full">
            Devise, si le fichier ne l’indique pas
            <input
              autoCapitalize="characters"
              className="text-input"
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value)}
              pattern="[A-Za-z]{3}"
              placeholder="ex. EUR"
              value={currency}
            />
            <small>
              Vide : aucune devise n’est supposée ; la validation l’exigera si le fichier n’en
              indique pas.
            </small>
            {liabilityCurrency && currency.trim().toUpperCase() !== liabilityCurrency ? (
              <button
                className="link-button"
                onClick={() => setCurrency(liabilityCurrency)}
                type="button"
              >
                Déclarer la devise de la dette ({liabilityCurrency})
              </button>
            ) : null}
          </label>
          {uploadError ? (
            <div className="full warning-text" role="alert">
              <p>{uploadError}</p>
              {refusal.length > 0 ? (
                <ul>
                  {refusal.map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="form-actions">
            <button className="button secondary" onClick={closeDrawer} type="button">
              Annuler
            </button>
            <button className="button primary" disabled={uploading || !file} type="submit">
              {uploading ? "Lecture…" : "Lire l’échéancier"}
            </button>
          </div>
        </form>
      </FinancialDrawer>
    </section>
  );
}
