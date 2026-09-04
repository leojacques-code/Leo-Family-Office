"use client";

import { useCallback, useMemo, useState } from "react";
import { FileText, Search, UploadCloud } from "lucide-react";

import { Callout, EmptyState } from "@/components/ui";
import { NOT_COMPUTABLE, formatDate } from "@/components/pages/shared";
import { uploadToSignedStoragePath } from "@/lib/data/supabase-storage-browser";
import type {
  CheckStatus,
  DocumentIssue,
  ExtractionFieldStatus,
} from "@/lib/acquisition/documents/types";
import type {
  DocumentCheckView,
  DocumentExtractionPreview,
  DocumentFieldView,
  DocumentUploadTicket,
} from "@/lib/data/document-contracts";
import {
  MAX_DOCUMENT_FILE_BYTES,
  MAX_RETAINED_DOCUMENT_FILE_BYTES,
} from "@/lib/validation/documents";

/**
 * LIASSE FISCALE — écran de lecture, de relecture et de décision.
 *
 * Cet écran ne calcule rien. Il montre ce que le document imprimait, ce que la lecture en a
 * compris, et OÙ elle l'a lu.
 *
 * Quatre choses y sont dites explicitement, parce que les taire tromperait :
 *
 *   * une case BLANCHE n'est pas une case à zéro. Elle s'affiche comme non renseignée ;
 *   * un contrôle NON CALCULABLE n'est ni réussi ni échoué : ses opérandes n'ont pas été
 *     trouvés, et c'est cela qui est écrit ;
 *   * une correction vit À CÔTÉ de la lecture. La valeur imprimée reste visible ;
 *   * valider la lecture et en tirer un fait patrimonial sont DEUX décisions.
 */

const FIELD_STATUS_LABELS: Record<ExtractionFieldStatus, string> = {
  EXTRACTED: "Lue",
  REVIEWED: "Revue",
  CORRECTED: "Corrigée",
  REJECTED: "Écartée",
  BLOCKED: "Illisible",
  UNKNOWN_BOX: "Formulaire inconnu",
};

const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  PASSED: "Vérifié",
  FAILED: "En échec",
  NOT_COMPUTABLE: "Non calculable",
};

const PDF_KIND_LABELS: Record<string, string> = {
  NATIVE_TEXT: "PDF natif : couche texte complète",
  MIXED: "PDF partiellement natif : certaines pages sont des images",
  IMAGE_ONLY: "Document scanné : aucune couche texte",
  UNREADABLE: "Fichier illisible comme PDF",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  EXTRACTED: "Lue, non revue",
  OCR_REQUIRED: "Reconnaissance de caractères nécessaire",
  FAILED: "Lecture impossible",
  REVIEWED: "Relue",
  VALIDATED: "Lecture validée",
  LINKED: "Rattachée au patrimoine",
  REJECTED: "Lecture refusée",
};

function IssueList({ issues }: { issues: DocumentIssue[] }) {
  if (issues.length === 0) return null;
  const ordered = [
    ...issues.filter((issue) => issue.severity === "ERROR"),
    ...issues.filter((issue) => issue.severity === "WARNING"),
    ...issues.filter((issue) => issue.severity === "INFO"),
  ];
  return (
    <div className="issue-list">
      {ordered.map((issue, index) => (
        <p
          key={`${issue.code}-${issue.boxCode ?? "global"}-${index}`}
          className={issue.severity === "INFO" ? undefined : "warning-text"}
        >
          <small>
            <strong>{issue.code}</strong> {issue.message}
            {issue.page === null ? "" : ` (page ${issue.page})`}
            {issue.sourceValue ? ` — lu : « ${issue.sourceValue} »` : ""}
          </small>
        </p>
      ))}
    </div>
  );
}

function amount(value: number | null) {
  if (value === null) return <span className="warning-text">{NOT_COMPUTABLE}</span>;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}

function CheckRow({ check }: { check: DocumentCheckView }) {
  const operands = [
    check.leftCodes.length > 0 ? check.leftCodes.join(" + ") : "—",
    check.rightCodes.length > 0 ? check.rightCodes.join(" + ") : "—",
  ];
  return (
    <div className="table-row">
      <span>
        <strong>{check.label ?? check.checkCode}</strong>
        <br />
        <small>
          {check.severity === "BLOCKING"
            ? "Bloquant"
            : check.severity === "WARNING"
              ? "Signalé"
              : "Information"}
        </small>
      </span>
      <span className={check.status === "FAILED" ? "warning-text" : undefined}>
        {CHECK_STATUS_LABELS[check.status]}
        {check.status === "NOT_COMPUTABLE" ? (
          <>
            <br />
            <small>
              Les cases comparées n&apos;ont pas été trouvées dans le document. Ce contrôle ne
              prouve rien, et il n&apos;est donc pas compté comme réussi.
            </small>
          </>
        ) : null}
      </span>
      <span>
        <small>
          {operands[0]} vs {operands[1]}
        </small>
        <br />
        <small>
          {check.status === "NOT_COMPUTABLE"
            ? "—"
            : `${amount(check.actualValue)} contre ${amount(check.expectedValue)}`}
        </small>
      </span>
      <span>
        <small>
          {check.status === "NOT_COMPUTABLE"
            ? ""
            : `Écart ${amount(check.difference)} · tolérance ${check.tolerance}`}
        </small>
        {check.status === "FAILED" && check.message ? (
          <>
            <br />
            <small className="warning-text">{check.message}</small>
          </>
        ) : null}
      </span>
    </div>
  );
}

interface LiasseSectionProps {
  businesses: Array<{ id: string; name: string; functionalCurrency: string | null }>;
  /** Rafraîchit le cockpit : un instantané financier écrit change le domaine Business. */
  refresh: () => Promise<void>;
}

export default function LiasseSection({ businesses, refresh }: LiasseSectionProps) {
  const [businessId, setBusinessId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [retainFile, setRetainFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentExtractionPreview | null>(null);
  const [filter, setFilter] = useState<"ALL" | "ATTENTION">("ATTENTION");
  const [correction, setCorrection] = useState<Record<string, string>>({});
  /** Saisie explicite de l'utilisateur. `null` = la devise de la société fait foi. */
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);

  const selected = useMemo(
    () => businesses.find((business) => business.id === businessId) ?? null,
    [businesses, businessId],
  );

  // La devise est DÉRIVÉE de la société sélectionnée, et non recopiée dans un état par un
  // effet : synchroniser deux états qui disent la même chose finit toujours par les faire
  // diverger le jour où l'un change sans l'autre.
  const currency = currencyOverride ?? selected?.functionalCurrency ?? "EUR";

  const call = useCallback(
    async (path: string, init: RequestInit): Promise<Record<string, unknown> | null> => {
      const response = await fetch(path, init);
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || typeof body.error === "string") {
        setError(typeof body.error === "string" ? body.error : "Requête refusée");
        return null;
      }
      return body;
    },
    [],
  );

  async function analyze(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !businessId) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      // 1. Le serveur ÉMET un billet : c'est lui qui calcule le chemin de dépôt.
      const ticket = (await call("/api/documents/extraction?ticket=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          byteSize: file.size,
          retainFile,
        }),
      })) as DocumentUploadTicket | null;
      if (!ticket) return;

      // 2. Le PDF va du NAVIGATEUR au stockage privé. Il ne traverse pas la route d'API.
      await uploadToSignedStoragePath({
        bucket: ticket.bucket,
        path: ticket.storagePath,
        token: ticket.token,
        file,
        contentType: ticket.contentType,
      });

      // 3. L'analyse ne reçoit qu'un identifiant de billet.
      const analyzed = (await call("/api/documents/extraction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.ticketId,
          businessId,
          retainFile: retainFile && ticket.retainable,
        }),
      })) as DocumentExtractionPreview | null;
      if (analyzed) setPreview(analyzed);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Dépôt impossible");
    } finally {
      setBusy(false);
    }
  }

  async function command(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const body = await call("/api/documents/extraction", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (body === null) return;
      // La liaison rend un résultat court : la lecture est alors rechargée entièrement.
      if (typeof body.runId === "string" && !("fields" in body)) {
        const reloaded = await call(
          `/api/documents/extraction?run=${encodeURIComponent(body.runId)}`,
          { cache: "no-store" },
        );
        if (reloaded) setPreview(reloaded as unknown as DocumentExtractionPreview);
        await refresh();
        return;
      }
      setPreview(body as unknown as DocumentExtractionPreview);
    } finally {
      setBusy(false);
    }
  }

  const visibleFields = useMemo(() => {
    if (preview === null) return [];
    if (filter === "ALL") return preview.fields;
    return preview.fields.filter(
      (field) =>
        field.validationStatus === "BLOCKED" ||
        field.validationStatus === "UNKNOWN_BOX" ||
        field.validationStatus === "CORRECTED" ||
        field.issues.length > 0,
    );
  }, [preview, filter]);

  const blockingFailures = preview?.checks.filter(
    (check) => check.severity === "BLOCKING" && check.status === "FAILED",
  ).length;

  return (
    <div className="page-stack">
      {error ? (
        <Callout tone="warning" title="Liasse fiscale">
          {error}
        </Callout>
      ) : null}

      <section className="panel">
        <h2>
          <FileText size={18} /> Déposer une liasse fiscale
        </h2>
        <p>
          <small>
            PDF natif, {Math.round(MAX_DOCUMENT_FILE_BYTES / (1024 * 1024))} Mo maximum. Le fichier
            va directement au stockage privé : il ne traverse pas le serveur d&apos;application. Un
            document scanné sera reconnu comme tel, et aucune valeur n&apos;en sera déduite.
          </small>
        </p>
        <form className="form-grid" onSubmit={analyze}>
          <label>
            Société
            <select
              value={businessId}
              onChange={(event) => setBusinessId(event.target.value)}
              required
            >
              <option value="">Choisir…</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fichier
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={retainFile}
              onChange={(event) => setRetainFile(event.target.checked)}
              disabled={file !== null && file.size > MAX_RETAINED_DOCUMENT_FILE_BYTES}
            />
            Conserver le PDF au coffre privé
            {file !== null && file.size > MAX_RETAINED_DOCUMENT_FILE_BYTES ? (
              <small className="warning-text">
                {" "}
                Fichier trop volumineux pour le coffre (
                {Math.round(MAX_RETAINED_DOCUMENT_FILE_BYTES / (1024 * 1024))} Mo) : il reste
                analysable.
              </small>
            ) : null}
          </label>
          <button className="button primary" type="submit" disabled={busy || !file || !businessId}>
            <UploadCloud size={16} /> Lire la liasse
          </button>
        </form>
      </section>

      {preview ? (
        <>
          <section className="panel">
            <h2>Ce que la lecture a établi</h2>
            <div className="table">
              <div className="table-row">
                <span>Formulaires reconnus</span>
                <span>
                  {preview.detectionBasis.length === 0 ? (
                    <span className="warning-text">Aucun</span>
                  ) : (
                    preview.detectionBasis
                      .map((item) => `${item.kind} (page ${item.page})`)
                      .join(", ")
                  )}
                </span>
                <span>
                  <small>
                    {preview.detectedKind === "LIASSE_2050"
                      ? "Régime normal"
                      : preview.detectedKind === "LIASSE_2033"
                        ? "Régime simplifié"
                        : preview.detectedKind === "LIASSE_MIXED"
                          ? "Les deux régimes coexistent"
                          : "Régime non reconnu"}
                  </small>
                </span>
              </div>
              <div className="table-row">
                <span>Exercice lu dans le document</span>
                <span>
                  {preview.fiscalYearEnd === null ? (
                    <span className="warning-text">{NOT_COMPUTABLE}</span>
                  ) : (
                    `${preview.fiscalYearStart ? `${formatDate(preview.fiscalYearStart)} → ` : "clos le "}${formatDate(preview.fiscalYearEnd)}`
                  )}
                </span>
                <span>
                  <small>
                    {preview.fiscalYearStart === null && preview.fiscalYearEnd !== null
                      ? "Ouverture non imprimée : elle n'est pas reconstituée en retirant un an"
                      : ""}
                  </small>
                </span>
              </div>
              <div className="table-row">
                <span>SIREN lu</span>
                <span>
                  {preview.siren ?? <span className="warning-text">{NOT_COMPUTABLE}</span>}
                </span>
                <span>
                  <small>{PDF_KIND_LABELS[preview.pdfKind] ?? preview.pdfKind}</small>
                </span>
              </div>
              <div className="table-row">
                <span>État</span>
                <span>{RUN_STATUS_LABELS[preview.status] ?? preview.status}</span>
                <span>
                  <small>
                    {preview.counts.fields} case(s) · {preview.counts.blocked} illisible(s) ·{" "}
                    {preview.counts.corrected} corrigée(s) · {preview.counts.unknownBoxes} sur
                    formulaire inconnu
                  </small>
                </span>
              </div>
            </div>

            {preview.status === "OCR_REQUIRED" ? (
              <Callout tone="warning" title="Reconnaissance de caractères nécessaire">
                Ce document ne porte aucune couche texte : c&apos;est un scan. Aucune valeur
                n&apos;en a été déduite, et aucune ne le sera sans reconnaissance de caractères.
                Déposez la liasse au format PDF natif produite par le logiciel comptable.
              </Callout>
            ) : null}

            {preview.stagingCleanupFailed ? (
              <Callout tone="warning" title="Objet temporaire non supprimé">
                La copie de travail du PDF n&apos;a pas pu être supprimée du stockage. La lecture
                est intacte : sa référence est conservée pour permettre un nettoyage ultérieur,
                plutôt qu&apos;effacée en silence.
              </Callout>
            ) : null}

            <IssueList issues={preview.issues} />
          </section>

          <section className="panel">
            <h2>Contrôles</h2>
            {preview.checks.length === 0 ? (
              <EmptyState
                title="Aucun contrôle"
                detail="Aucune ancre de contrôle n'a été résolue dans ce document."
              />
            ) : (
              <div className="table">
                {preview.checks.map((check) => (
                  <CheckRow key={check.checkCode} check={check} />
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Cases lues</h2>
            <div className="import-filters">
              {(
                [
                  ["ATTENTION", "À regarder"],
                  ["ALL", "Toutes"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`button ${filter === value ? "primary" : "secondary"}`}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {preview.fieldsTruncated ? (
              <p>
                <small className="warning-text">
                  Affichage limité à {preview.fields.length} cases. Toutes ont été persistées : la
                  troncature est un plafond d&apos;écran, pas de lecture.
                </small>
              </p>
            ) : null}

            {visibleFields.length === 0 ? (
              <EmptyState
                title="Rien à signaler"
                detail="Aucune case illisible, corrigée ou porteuse d'anomalie."
              />
            ) : (
              <div className="table">
                {visibleFields.map((field: DocumentFieldView) => (
                  <div key={field.fieldId} className="table-row">
                    <span>
                      <strong>{field.boxCode}</strong>
                      {field.occurrence > 0 ? (
                        <small> (occurrence {field.occurrence + 1})</small>
                      ) : null}
                      <br />
                      <small>
                        {field.label ?? "Libellé non lu"}
                        <br />
                        {field.formCode ?? "Formulaire inconnu"}
                        {field.formPart ? ` · ${field.formPart}` : " · colonne non attribuée"} ·
                        page {field.pageNumber}
                      </small>
                    </span>
                    <span>
                      <small>Imprimé</small>
                      <br />
                      {field.rawValue ?? (
                        <span className="warning-text">Case blanche : rien n&apos;est déclaré</span>
                      )}
                    </span>
                    <span>
                      <small>Retenu</small>
                      <br />
                      {amount(field.effectiveValue)}
                      {field.userValue !== null ? (
                        <>
                          <br />
                          <small>Corrigé{field.userReason ? ` — ${field.userReason}` : ""}</small>
                        </>
                      ) : null}
                    </span>
                    <span>
                      <small>{FIELD_STATUS_LABELS[field.validationStatus]}</small>
                      {preview.status === "LINKED" ? null : (
                        <>
                          <br />
                          <input
                            inputMode="decimal"
                            placeholder="Corriger"
                            value={correction[field.fieldId] ?? ""}
                            onChange={(event) =>
                              setCorrection((current) => ({
                                ...current,
                                [field.fieldId]: event.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="button secondary"
                            disabled={busy || (correction[field.fieldId] ?? "").trim().length === 0}
                            onClick={() =>
                              void command({
                                action: "correct",
                                fieldId: field.fieldId,
                                userValue: Number(
                                  (correction[field.fieldId] ?? "").replace(",", "."),
                                ),
                                reason: "Relecture du PDF",
                              })
                            }
                          >
                            Corriger
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={busy}
                            onClick={() =>
                              void command({ action: "reject", fieldId: field.fieldId })
                            }
                          >
                            Écarter
                          </button>
                        </>
                      )}
                      <IssueList issues={field.issues} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Décider</h2>
            <p>
              <small>
                Valider la lecture et en tirer un instantané financier sont DEUX décisions. La
                première dit « ce que j&apos;ai lu est juste » ; la seconde fait entrer un chiffre
                dans le patrimoine.
              </small>
            </p>

            {typeof blockingFailures === "number" && blockingFailures > 0 ? (
              <Callout tone="warning" title="Contrôle bloquant en échec">
                {`${blockingFailures} contrôle(s) bloquant(s) en échec. La validation est refusée : elle ferait entrer une lecture que le document lui-même contredit. Corrigez les cases concernées, ou écartez-les.`}
              </Callout>
            ) : null}

            <div className="table">
              <div className="table-row">
                <span>Chiffre d&apos;affaires</span>
                <span>
                  {preview.financials.revenue === null ? (
                    <span className="warning-text">Non retrouvé dans le document</span>
                  ) : (
                    `${amount(preview.financials.revenue.value)} (case ${preview.financials.revenue.boxCode}, page ${preview.financials.revenue.page})`
                  )}
                </span>
              </div>
              <div className="table-row">
                <span>Résultat de l&apos;exercice</span>
                <span>
                  {preview.financials.netIncome === null ? (
                    <span className="warning-text">Non retrouvé dans le document</span>
                  ) : (
                    `${amount(preview.financials.netIncome.value)} (case ${preview.financials.netIncome.boxCode}, page ${preview.financials.netIncome.page})`
                  )}
                </span>
              </div>
            </div>

            <h3>Ce qu&apos;une liasse ne contient pas</h3>
            <div className="table">
              {preview.financials.unavailableFields.map((entry) => (
                <div key={entry.field} className="table-row">
                  <span>{entry.field}</span>
                  <span>
                    <small>{entry.reason}</small>
                  </span>
                </div>
              ))}
            </div>

            <div className="form-grid">
              <label>
                Devise de l&apos;instantané
                <input
                  value={currency}
                  onChange={(event) => setCurrencyOverride(event.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder="EUR"
                />
                <small>
                  Une liasse française n&apos;imprime pas son code devise : il est déclaré.
                </small>
              </label>
              <button
                type="button"
                className="button primary"
                disabled={
                  busy ||
                  preview.status === "LINKED" ||
                  preview.status === "OCR_REQUIRED" ||
                  preview.status === "FAILED"
                }
                onClick={() => void command({ action: "validate", runId: preview.runId })}
              >
                Valider la lecture
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || preview.status !== "VALIDATED"}
                onClick={() => void command({ action: "link", runId: preview.runId, currency })}
              >
                Écrire l&apos;instantané financier
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy || preview.status === "LINKED"}
                onClick={() =>
                  void command({
                    action: "reject-run",
                    runId: preview.runId,
                    reason: "Lecture refusée par l'utilisateur",
                  })
                }
              >
                Refuser la lecture
              </button>
            </div>

            {preview.status === "LINKED" ? (
              <Callout tone="success" title="Instantané financier écrit">
                Le chiffre d&apos;affaires et le résultat de l&apos;exercice sont entrés dans
                Business Equity, rattachés à cette lecture. La lecture est désormais gelée : un fait
                écrit doit rester explicable par ce qui l&apos;a produit.
              </Callout>
            ) : null}
          </section>
        </>
      ) : (
        <section className="panel">
          <EmptyState
            title="Aucune lecture en cours"
            detail="Déposez une liasse fiscale au format PDF natif pour la lire case par case."
          />
          <p>
            <small>
              <Search size={12} /> Chaque case lue conserve sa page, son code imprimé, sa valeur
              brute et l&apos;endroit exact où elle a été trouvée.
            </small>
          </p>
        </section>
      )}
    </div>
  );
}
