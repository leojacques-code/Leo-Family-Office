"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  FileSpreadsheet,
  MinusCircle,
  UploadCloud,
} from "lucide-react";

import { Callout, EmptyState, SectionHeader } from "@/components/ui";
import FecSection from "@/components/pages/imports/fec-section";
import LiasseSection from "@/components/pages/imports/liasse-section";
import RegistrySection from "@/components/pages/imports/registry-section";
import { formatDate, NOT_COMPUTABLE } from "@/components/pages/shared";
import type { SectionProps } from "@/components/pages/shared";
import type {
  BankColumnMapping,
  BankTargetField,
  ImportCommitResult,
  ImportPreview,
  ImportPreviewRow,
  ImportRowStatus,
  ImportSessionSummary,
} from "@/lib/data/import-contracts";

/**
 * IMPORTS — un seul chemin, quatre temps : déposer, relire, corriger, valider.
 *
 * Cet écran ne calcule rien. Il rend ce que la couche d'acquisition a compris, avec ses
 * ambiguïtés, et ne laisse valider que ce qui est réellement committable. L'utilisateur
 * n'a à s'occuper que des lignes qui posent une question.
 */

const STATUS_LABELS: Record<ImportRowStatus, string> = {
  READY: "Prête",
  WARNING: "À confirmer",
  BLOCKED: "Bloquée",
  DUPLICATE: "Doublon",
  IGNORED: "Ignorée",
};

const STATUS_ICONS: Record<ImportRowStatus, typeof Check> = {
  READY: Check,
  WARNING: AlertTriangle,
  BLOCKED: Ban,
  DUPLICATE: Copy,
  IGNORED: MinusCircle,
};

const SESSION_STATUS_LABELS: Record<ImportSessionSummary["status"], string> = {
  RECEIVING: "Réception en cours",
  ANALYZED: "En attente de validation",
  COMMITTED: "Validée",
  DISCARDED: "Abandonnée",
  FAILED: "Échouée",
};

/**
 * Champs cibles proposés à la correction. `debit` et `credit` sont l'alternative à
 * `amount` : le parseur refuse les deux formes à la fois, et l'écran le laisse voir.
 */
const MAPPABLE_FIELDS: Array<{ field: BankTargetField; label: string; required: boolean }> = [
  { field: "transactionDate", label: "Date d’opération", required: true },
  { field: "label", label: "Libellé", required: true },
  { field: "amount", label: "Montant signé", required: false },
  { field: "debit", label: "Débit", required: false },
  { field: "credit", label: "Crédit", required: false },
  { field: "currency", label: "Devise", required: false },
  { field: "valueDate", label: "Date de valeur", required: false },
  { field: "externalTransactionId", label: "Identifiant de transaction", required: false },
  { field: "reference", label: "Référence descriptive", required: false },
  { field: "counterparty", label: "Contrepartie", required: false },
  { field: "balanceAfter", label: "Solde après opération", required: false },
];

const CONVENTION_LABELS: Record<string, string> = {
  DECIMAL_COMMA: "virgule décimale",
  DECIMAL_POINT: "point décimal",
  INTEGER: "montants entiers",
  AMBIGUOUS: "indécidable",
  ISO: "ISO (AAAA-MM-JJ)",
  DAY_FIRST: "jour/mois",
  MONTH_FIRST: "mois/jour",
};

const ENCODING_LABELS: Record<string, string> = {
  UTF_8: "UTF-8",
  UTF_8_BOM: "UTF-8 avec BOM",
  WINDOWS_1252: "Windows-1252",
};

function delimiterLabel(delimiter: string): string {
  if (delimiter === "\t") return "tabulation";
  if (delimiter === ";") return "point-virgule";
  if (delimiter === ",") return "virgule";
  return delimiter;
}

const amountFormatter = (currency: string) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 });

function RowAmount({ row }: { row: ImportPreviewRow }) {
  if (row.amount === null || row.currency === null) {
    return <span className="warning-text">{NOT_COMPUTABLE}</span>;
  }
  return (
    <span className={row.amount < 0 ? "negative-text" : "positive-text"}>
      {amountFormatter(row.currency).format(row.amount)}
    </span>
  );
}

type StatusFilter = "ALL" | ImportRowStatus;

/**
 * ONGLETS D'ACQUISITION, DÉCLARÉS UNE FOIS
 *
 * Le type de l'état en DÉRIVE : ajouter une verticale est une seule ligne, et il devient
 * impossible qu'un onglet existe dans le rendu sans exister dans le type, ou l'inverse.
 * C'est exactement ce qui dérivait quand chaque verticale maintenait sa propre union de
 * littéraux à côté de sa propre entrée de rendu.
 */
const IMPORT_DOMAIN_TABS = [
  ["BANK", "Relevé bancaire"],
  ["FEC", "Comptabilité (FEC)"],
  ["LIASSE", "Liasse fiscale (PDF)"],
  ["REGISTRY", "Registre d'entreprises"],
] as const;

type ImportDomainTab = (typeof IMPORT_DOMAIN_TABS)[number][0];

function ImportsPage({ state, refresh }: SectionProps) {
  // Choix explicites de l'utilisateur. `null` = « pas encore choisi » : la valeur affichée
  // est alors DÉRIVÉE des comptes, sans effet de bord ni rendu en cascade.
  /** Domaine d'acquisition affiché. Un seul écran, deux sources : la fondation est commune. */
  const [domain, setDomain] = useState<ImportDomainTab>("BANK");
  const [chosenAccountId, setChosenAccountId] = useState<string | null>(null);
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);
  const [retainFile, setRetainFile] = useState(true);
  const [rememberMapping, setRememberMapping] = useState(true);
  /**
   * Déclaration de stabilité de l'identifiant. Décochée par défaut, et ce défaut est le
   * bon : prendre une référence bancaire pour une identité ferait disparaître des
   * opérations réelles.
   */
  const [stableIdDeclared, setStableIdDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  /**
   * Fichier retenu côté client. Le conserver est ce qui permet de RÉANALYSER après avoir
   * corrigé un mapping : sans lui, l'utilisateur devrait redéposer son relevé à chaque
   * tentative, et un format non reconnu deviendrait un cul-de-sac.
   */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  /** Mapping en cours de correction. `null` = celui que le parseur a proposé. */
  const [mappingDraft, setMappingDraft] = useState<BankColumnMapping | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [sessions, setSessions] = useState<ImportSessionSummary[]>([]);

  // Les comptes viennent de l'état du cockpit déjà chargé : cette page ne lit aucune
  // donnée financière par elle-même et n'en recalcule aucune.
  const accounts = useMemo(
    () =>
      state.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        currency: account.currency,
      })),
    [state.accounts],
  );

  const loadSessions = useCallback(async () => {
    const response = await fetch("/api/imports", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setSessions(payload.sessions ?? []);
  }, []);

  // L'historique n'est pas dans l'état du cockpit : le charger à chaque lecture du
  // tableau de bord ferait payer à tous les écrans une donnée que seul celui-ci consomme.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/imports", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (cancelled || !response.ok) return;
      setSessions(payload.sessions ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accountId = chosenAccountId ?? accounts[0]?.id ?? "";
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const declaredCurrency = chosenCurrency ?? selectedAccount?.currency ?? "EUR";

  const visibleRows = useMemo(() => {
    if (!preview) return [];
    if (filter === "ALL") return preview.rows;
    return preview.rows.filter((row) => row.status === filter);
  }, [preview, filter]);

  async function runAnalysis(file: File, mapping: BankColumnMapping | null) {
    setBusy(true);
    setError("");
    setNotice("");
    const body = new FormData();
    body.set("file", file);
    body.set(
      "options",
      JSON.stringify({
        accountId,
        declaredCurrency: declaredCurrency.trim().length === 3 ? declaredCurrency.trim() : null,
        declaredPeriodStart: null,
        declaredPeriodEnd: null,
        mapping,
        stableTransactionIdDeclared: stableIdDeclared,
        rememberMapping,
        retainFile,
      }),
    );
    const response = await fetch("/api/imports", { method: "POST", body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error ?? "Analyse impossible");
      setPreview(null);
    } else {
      const next = payload as ImportPreview;
      setPreview(next);
      // Le brouillon repart de ce que le parseur a réellement appliqué : l'utilisateur
      // corrige une proposition, il ne repart pas d'une grille vide.
      setMappingDraft(next.mapping);
      setIncluded(new Set());
      setFilter("ALL");
      await loadSessions();
    }
    setBusy(false);
  }

  async function analyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingFile) {
      setError("Choisir un fichier.");
      return;
    }
    await runAnalysis(pendingFile, null);
  }

  async function command(action: "commit" | "discard") {
    if (!preview) return;
    setBusy(true);
    setError("");
    const request =
      action === "commit"
        ? { action, sessionId: preview.sessionId, includeRecordIds: [...included] }
        : { action, sessionId: preview.sessionId };

    // Le fichier accompagne la VALIDATION, pas l'analyse : sa copie au coffre n'a lieu
    // qu'après l'écriture des faits, donc une analyse abandonnée n'en laisse aucune.
    const sendsFile = action === "commit" && retainFile && pendingFile !== null;
    const body = sendsFile ? new FormData() : JSON.stringify(request);
    if (body instanceof FormData) {
      body.set("command", JSON.stringify(request));
      body.set("file", pendingFile!);
    }
    const response = await fetch("/api/imports", {
      method: "PATCH",
      ...(body instanceof FormData
        ? { body }
        : { headers: { "Content-Type": "application/json" }, body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload.error ?? "Commande impossible");
    else {
      if (action === "commit") {
        const result = payload as ImportCommitResult;
        setNotice(
          `${result.committedCount} opération(s) écrite(s), sans catégorie de flux : elles apparaissent comme non classées dans Cash Flow.`,
        );
      } else setNotice("Analyse abandonnée. Aucun fait n'avait été écrit.");
      setPreview(null);
      setPendingFile(null);
      setMappingDraft(null);
      setIncluded(new Set());
      await Promise.all([loadSessions(), refresh()]);
    }
    setBusy(false);
  }

  function toggle(row: ImportPreviewRow) {
    if (row.status !== "WARNING") return;
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  const committable = preview ? preview.counts.ready + included.size : 0;

  // Les sociétés viennent de l'état du cockpit déjà chargé, comme les comptes : cette page
  // ne lit aucune donnée de domaine par elle-même.
  const businesses = useMemo(
    () =>
      (state.businesses ?? [])
        .filter((business) => !business.archived)
        .map((business) => ({
          id: business.id,
          name: business.name,
          functionalCurrency: business.functionalCurrency,
        })),
    [state.businesses],
  );

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Acquisition"
        title="Imports"
        description="Une source devient des faits observés. Rien n'est écrit avant votre validation, et rien n'est inventé : ni catégorie de flux, ni valorisation."
      />

      <div className="import-filters">
        {IMPORT_DOMAIN_TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`button ${domain === value ? "primary" : "secondary"}`}
            onClick={() => setDomain(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {domain === "FEC" ? <FecSection businesses={businesses} refresh={refresh} /> : null}

      {domain === "LIASSE" ? <LiasseSection businesses={businesses} refresh={refresh} /> : null}

      {domain === "REGISTRY" ? <RegistrySection businesses={businesses} refresh={refresh} /> : null}

      {domain === "BANK" ? (
        <>
          <section className="import-layout">
            <form className="panel upload-panel" onSubmit={analyze}>
              <span className="upload-icon">
                <UploadCloud size={24} />
              </span>
              <h2>Déposer un relevé</h2>
              <p>CSV, TSV ou TXT délimité · 8 Mo maximum</p>
              <input
                id="import-file"
                type="file"
                name="file"
                accept=".csv,.tsv,.txt"
                onChange={(event) => {
                  setPendingFile(event.target.files?.[0] ?? null);
                  setMappingDraft(null);
                }}
              />
              <label htmlFor="import-file" className="button primary">
                {pendingFile ? pendingFile.name : "Choisir un fichier"}
              </label>
              <label className="field-label" htmlFor="import-account">
                Compte alimenté
              </label>
              <select
                id="import-account"
                className="text-input"
                value={accountId}
                onChange={(event) => {
                  setChosenAccountId(event.target.value);
                  // Changer de compte reprend la devise de ce compte, sauf déclaration explicite.
                  setChosenCurrency(null);
                }}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              <label className="field-label" htmlFor="import-currency">
                Devise déclarée si le fichier n’en porte pas
              </label>
              <input
                id="import-currency"
                className="text-input"
                value={declaredCurrency}
                maxLength={3}
                onChange={(event) => setChosenCurrency(event.target.value.toUpperCase())}
              />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={retainFile}
                  onChange={(event) => setRetainFile(event.target.checked)}
                />
                Conserver le fichier au coffre privé
              </label>
              <small className="field-hint">
                La copie n’est déposée qu’à la validation : une analyse abandonnée ou relancée après
                correction du mapping ne laisse aucun fichier derrière elle.
              </small>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rememberMapping}
                  onChange={(event) => setRememberMapping(event.target.checked)}
                />
                Mémoriser le mapping pour ce format
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={stableIdDeclared}
                  onChange={(event) => setStableIdDeclared(event.target.checked)}
                />
                La colonne d’identifiant porte un identifiant unique et stable
              </label>
              <small className="field-hint">
                À ne cocher que si votre banque garantit un identifiant propre à chaque opération.
                Sans cette déclaration, une opération identique à une opération connue est signalée
                pour confirmation au lieu d’être écartée : une référence répétée chaque mois ferait
                disparaître de vraies dépenses.
              </small>
              <button className="button secondary" disabled={busy || !accountId || !pendingFile}>
                {busy ? "Analyse…" : "Analyser sans rien écrire"}
              </button>
              {error ? <div className="form-error">{error}</div> : null}
              {notice ? <div className="form-notice">{notice}</div> : null}
            </form>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Historique</span>
                  <h2>Imports passés</h2>
                </div>
                <span className="nav-count">{sessions.length}</span>
              </div>
              {sessions.length ? (
                <div className="import-history">
                  {sessions.map((session) => (
                    <div key={session.id}>
                      <span className="document-icon">
                        <FileSpreadsheet size={17} />
                      </span>
                      <span>
                        <strong>{session.fileName ?? session.sourceLabel}</strong>
                        <small>
                          {session.accountName} · {formatDate(session.analyzedAt.slice(0, 10))} ·{" "}
                          {session.counts.total} ligne(s) · {session.committedCount} écrite(s)
                          {session.observedPeriodStart && session.observedPeriodEnd
                            ? ` · observé du ${session.observedPeriodStart} au ${session.observedPeriodEnd}`
                            : ""}
                        </small>
                      </span>
                      <span className="status-outline">
                        {SESSION_STATUS_LABELS[session.status]}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Aucun import"
                  detail="Le premier relevé analysé apparaîtra ici, avec ce qui a été écrit et ce qui a été écarté."
                />
              )}
            </article>
          </section>

          {preview ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Preview · aucune écriture</span>
                  <h2>{preview.fileName}</h2>
                </div>
                <span className="nav-count">{preview.counts.total}</span>
              </div>

              <div className="import-facts">
                <span>
                  <small>Encodage</small>
                  <strong>{ENCODING_LABELS[preview.encoding] ?? preview.encoding}</strong>
                </span>
                <span>
                  <small>Séparateur</small>
                  <strong>{delimiterLabel(preview.delimiter)}</strong>
                </span>
                <span>
                  <small>Montants</small>
                  <strong>
                    {CONVENTION_LABELS[preview.conventions.amount] ?? preview.conventions.amount}
                  </strong>
                </span>
                <span>
                  <small>Dates</small>
                  <strong>
                    {CONVENTION_LABELS[preview.conventions.date] ?? preview.conventions.date}
                  </strong>
                </span>
                <span>
                  <small>Déjà présentes (probable)</small>
                  <strong>{preview.verdicts.probableDuplicate}</strong>
                </span>
                <span>
                  <small>Identité démontrée</small>
                  <strong>{preview.verdicts.exactDuplicate}</strong>
                </span>
                <span>
                  <small>Période observée</small>
                  <strong>
                    {preview.observedPeriod
                      ? `${preview.observedPeriod.start} → ${preview.observedPeriod.end}`
                      : NOT_COMPUTABLE}
                  </strong>
                </span>
              </div>

              {mappingDraft &&
              (preview.mappingConfidence !== "CERTAIN" || preview.counts.blocked > 0) ? (
                <div className="import-mapping">
                  <p className="panel-note">
                    Associer chaque champ à sa colonne, puis relire le fichier. Une colonne laissée
                    sur « — » n’alimente rien : aucune valeur n’est déduite d’une autre.
                  </p>
                  <div className="import-mapping-grid">
                    {MAPPABLE_FIELDS.map((entry) => (
                      <label key={entry.field}>
                        <span className="field-label">
                          {entry.label}
                          {entry.required ? " *" : ""}
                        </span>
                        <select
                          className="text-input"
                          value={mappingDraft[entry.field] ?? ""}
                          onChange={(event) => {
                            const raw = event.target.value;
                            setMappingDraft((current) => {
                              const next = { ...(current ?? {}) };
                              if (raw === "") delete next[entry.field];
                              else next[entry.field] = Number(raw);
                              return next;
                            });
                          }}
                        >
                          <option value="">—</option>
                          {preview.headers.map((header, index) => (
                            <option key={`${header}-${index}`} value={index}>
                              {header.length ? header : `Colonne ${index + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy || !pendingFile}
                      onClick={() => {
                        if (pendingFile) void runAnalysis(pendingFile, mappingDraft);
                      }}
                    >
                      {busy ? "Relecture…" : "Relire avec ce mapping"}
                    </button>
                  </div>
                </div>
              ) : null}

              {preview.mappingRestored ? (
                <Callout tone="info" title="Mapping mémorisé appliqué">
                  Ce format avait déjà été confirmé : la même association de colonnes a été
                  réutilisée, parce que la signature du fichier est identique.
                </Callout>
              ) : null}
              {preview.mappingConfidence === "INCOMPLETE" ? (
                <Callout tone="warning" title="Colonnes non résolues">
                  Aucune ligne n’a été lue : le fichier ne permet pas d’identifier avec certitude la
                  date, le libellé ou le montant. Rien n’a été deviné.
                </Callout>
              ) : null}
              {preview.issues.length ? (
                <div className="import-issues">
                  {preview.issues.map((issue, index) => (
                    <p
                      key={`${issue.code}-${index}`}
                      className={issue.severity === "ERROR" ? "warning-text" : undefined}
                    >
                      <strong>{issue.code}</strong> · {issue.message}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="import-filters">
                {(
                  ["ALL", "READY", "WARNING", "BLOCKED", "DUPLICATE", "IGNORED"] as StatusFilter[]
                ).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`button ${filter === value ? "primary" : "secondary"}`}
                    onClick={() => setFilter(value)}
                  >
                    {value === "ALL"
                      ? `Toutes ${preview.counts.total}`
                      : `${STATUS_LABELS[value]} ${
                          value === "READY"
                            ? preview.counts.ready
                            : value === "WARNING"
                              ? preview.counts.warning
                              : value === "BLOCKED"
                                ? preview.counts.blocked
                                : value === "DUPLICATE"
                                  ? preview.counts.duplicate
                                  : preview.counts.ignored
                        }`}
                  </button>
                ))}
              </div>

              <div className="import-table">
                <div className="table-head">
                  <span>Ligne</span>
                  <span>Statut</span>
                  <span>Date</span>
                  <span>Libellé</span>
                  <span>Montant</span>
                  <span>Anomalie</span>
                </div>
                {visibleRows.map((row) => {
                  const Icon = STATUS_ICONS[row.status];
                  const includable = row.status === "WARNING";
                  return (
                    <div className="table-row" key={`${row.rowNumber}-${row.id}`}>
                      <span>{row.rowNumber}</span>
                      <span>
                        {includable ? (
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={included.has(row.id)}
                              onChange={() => toggle(row)}
                            />
                            <Icon size={14} /> {STATUS_LABELS[row.status]}
                          </label>
                        ) : (
                          <span className="status-outline">
                            <Icon size={14} /> {STATUS_LABELS[row.status]}
                          </span>
                        )}
                      </span>
                      <span>{row.transactionDate ?? <span className="warning-text">—</span>}</span>
                      <span>{row.label ?? <span className="warning-text">—</span>}</span>
                      <span>
                        <RowAmount row={row} />
                      </span>
                      <span>
                        {row.issues.length ? (
                          row.issues.map((issue, index) => (
                            <small
                              key={`${issue.code}-${index}`}
                              className={issue.severity === "ERROR" ? "warning-text" : undefined}
                            >
                              {issue.message}
                            </small>
                          ))
                        ) : (
                          <small>—</small>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              {preview.readyRowsTruncated ? (
                <p className="panel-note">
                  Seules les 200 premières lignes prêtes sont affichées. Toutes seront écrites à la
                  validation : le plafond est un plafond d’affichage, pas de traitement.
                </p>
              ) : null}

              <div className="form-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || committable === 0}
                  onClick={() => void command("commit")}
                >
                  {busy ? "Écriture…" : `Écrire ${committable} opération(s)`}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void command("discard")}
                >
                  Abandonner
                </button>
              </div>
              <p className="panel-note">
                Les lignes prêtes sont écrites. Les lignes à confirmer ne le sont que si vous les
                cochez. Les lignes bloquées, les doublons et les lignes ignorées ne sont jamais
                écrits, et aucun solde de compte n’est modifié.
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default ImportsPage;
