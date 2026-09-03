"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Ban, Check, Copy, Info, MinusCircle, UploadCloud } from "lucide-react";

import { Callout, EmptyState } from "@/components/ui";
import { formatDate, NOT_COMPUTABLE } from "@/components/pages/shared";
import { uploadToSignedStoragePath } from "@/lib/data/supabase-storage-browser";
import type {
  ImportRowStatus,
  PortfolioImportKind,
  PortfolioPreview,
  PortfolioPreviewRow,
  PortfolioSessionSummary,
  PortfolioUploadTicket,
} from "@/lib/data/portfolio-import-contracts";

/**
 * IMPORTS → PORTEFEUILLE
 *
 * L'écran ne calcule rien. Il rend ce que la couche d'acquisition a compris, avec ses
 * ambiguïtés, et ne laisse valider que ce qui est réellement committable.
 *
 * Trois choses qu'il refuse d'afficher, et ce sont des décisions de conception :
 *
 *   * un doublon prêt à écrire. Un doublon est exclu par défaut et se coche à la main :
 *     un double comptage fausse le patrimoine sans laisser de trace, là où une opération
 *     manquante laisse un trou visible ;
 *   * un instrument choisi d'office. Un ISIN inconnu ou ambigu bloque ses lignes jusqu'à
 *     décision, parce que créer l'instrument répartirait les mêmes titres entre deux entrées ;
 *   * une valeur de formule présentée comme une saisie. Les cellules issues d'une formule
 *     sont nommées : leur valeur vient du cache du tableur, et elle peut être périmée.
 */

interface Props {
  accounts: Array<{ id: string; name: string; currency: string }>;
  refresh: () => void;
}

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

const KIND_LABELS: Record<PortfolioImportKind, string> = {
  PORTFOLIO_LEDGER: "Opérations (achats, ventes, dividendes, frais, apports)",
  PORTFOLIO_POSITION: "Positions observées à une date",
};

const SESSION_STATUS_LABELS: Record<PortfolioSessionSummary["status"], string> = {
  RECEIVING: "Réception en cours",
  ANALYZED: "En attente de validation",
  COMMITTED: "Validée",
  DISCARDED: "Abandonnée",
  FAILED: "Échouée",
};

function amount(value: number | null, currency: string | null): string {
  if (value === null) return NOT_COMPUTABLE;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency ?? "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function PortfolioSection({ accounts, refresh }: Props) {
  const [kind, setKind] = useState<PortfolioImportKind>("PORTFOLIO_LEDGER");
  const [chosenAccountId, setChosenAccountId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [retainFile, setRetainFile] = useState(true);
  const [rememberMapping, setRememberMapping] = useState(true);
  /**
   * Déclaration de stabilité de la référence d'opération. Décochée par défaut, et ce défaut
   * est le bon : prendre une référence de courtier pour une identité ferait disparaître des
   * opérations réelles.
   */
  const [stableReferenceDeclared, setStableReferenceDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<PortfolioPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});

  // `null` = pas encore choisi : la valeur affichée est DÉRIVÉE des enveloppes, sans effet
  // de bord ni rendu en cascade.
  const accountId = chosenAccountId ?? accounts[0]?.id ?? "";
  const account = accounts.find((entry) => entry.id === accountId) ?? null;

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/imports/portfolio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Commande impossible");
    return payload;
  }, []);

  /**
   * Dépôt puis analyse. Le fichier va du NAVIGATEUR au stockage privé : il ne traverse pas
   * la fonction serveur, qui plafonnerait sa taille bien avant qu'un export de courtier
   * réaliste passe.
   */
  const analyze = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (pendingFile === null || accountId === "") {
        setError("Choisissez une enveloppe et un fichier");
        return;
      }
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const ticket = (await post({
          action: "ticket",
          fileName: pendingFile.name,
          byteSize: pendingFile.size,
          contentType: pendingFile.type === "" ? "application/octet-stream" : pendingFile.type,
          retainFile,
        })) as unknown as PortfolioUploadTicket;

        await uploadToSignedStoragePath({
          bucket: ticket.bucket,
          path: ticket.path,
          token: ticket.token,
          file: pendingFile,
          contentType: pendingFile.type === "" ? "application/octet-stream" : pendingFile.type,
        });

        const result = (await post({
          action: "analyze",
          ticketId: ticket.ticketId,
          kind,
          accountId,
          declaredCurrency: account?.currency ?? null,
          mapping: null,
          sheetName: null,
          stableReferenceDeclared,
          rememberMapping,
        })) as unknown as PortfolioPreview;

        setPreview(result);
        // Seules les lignes PRÊTES sont pré-cochées. Un doublon ou une ligne à confirmer se
        // coche à la main : c'est le sens de « exclu par défaut ».
        setSelected(
          new Set(result.rows.filter((row) => row.status === "READY").map((row) => row.recordId)),
        );
        setNotice(
          `${result.session.counts.total} ligne(s) lue(s) : ${result.session.counts.ready} prête(s), ${result.session.counts.warning} à confirmer, ${result.session.counts.blocked} bloquée(s), ${result.session.counts.duplicate} doublon(s)`,
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Analyse impossible");
      } finally {
        setBusy(false);
      }
    },
    [
      account,
      accountId,
      kind,
      pendingFile,
      post,
      rememberMapping,
      retainFile,
      stableReferenceDeclared,
    ],
  );

  const command = useCallback(
    async (body: Record<string, unknown>, message: string) => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const payload = await post(body);
        if ("session" in payload) {
          const result = payload as unknown as {
            session: PortfolioSessionSummary;
            written?: number;
          };
          setNotice(
            result.written === undefined
              ? message
              : `${result.written} fait(s) écrit(s) dans le portefeuille`,
          );
          if (preview !== null) {
            const refreshed = await fetch(
              `/api/imports/portfolio?session=${encodeURIComponent(preview.session.sessionId)}`,
            );
            setPreview((await refreshed.json()) as PortfolioPreview);
          }
        } else {
          setPreview(payload as unknown as PortfolioPreview);
          setNotice(message);
        }
        refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Commande impossible");
      } finally {
        setBusy(false);
      }
    },
    [post, preview, refresh],
  );

  const committable = useMemo(() => {
    if (preview === null) return 0;
    return preview.rows.filter(
      (row) =>
        selected.has(row.recordId) &&
        (row.status === "READY" || row.status === "WARNING") &&
        row.commitState === "PENDING",
    ).length;
  }, [preview, selected]);

  const openInstruments = useMemo(
    () =>
      (preview?.instruments ?? []).filter(
        (entry) => entry.state === "CANDIDATE" || entry.state === "AMBIGUOUS",
      ),
    [preview],
  );

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="Aucune enveloppe"
        detail="Un import de portefeuille se loge dans une enveloppe : un événement sans enveloppe ne serait réconciliable par rien. Créez d'abord un compte-titres, un PEA ou une assurance-vie dans Patrimoine."
      />
    );
  }

  return (
    <div className="page-stack">
      <Callout tone="info" title="Ce que cet import écrit, et ce qu'il n'écrit pas">
        Une POSITION observée et une TRANSACTION du ledger sont deux natures distinctes, et elles ne
        se convertissent jamais l&apos;une dans l&apos;autre : un relevé de positions dit ce que
        vous déteniez à une date, pas quand ni à quel prix vous l&apos;avez acheté. Aucun achat
        n&apos;est reconstruit depuis une position, aucun prix ni frais n&apos;est inventé, et un
        montant absent reste inconnu plutôt que nul.
      </Callout>

      <section className="import-layout">
        <form className="panel upload-panel" onSubmit={analyze}>
          <span className="upload-icon">
            <UploadCloud size={22} />
          </span>
          <h3>Déposer un fichier</h3>

          <label>
            Nature des données
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as PortfolioImportKind)}
            >
              {(Object.keys(KIND_LABELS) as PortfolioImportKind[]).map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label>
            Enveloppe
            <select value={accountId} onChange={(event) => setChosenAccountId(event.target.value)}>
              {accounts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.currency})
                </option>
              ))}
            </select>
          </label>

          <label>
            Fichier CSV ou XLSX
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx"
              onChange={(event) => setPendingFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={retainFile}
              onChange={(event) => setRetainFile(event.target.checked)}
            />
            Conserver le fichier d&apos;origine
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rememberMapping}
              onChange={(event) => setRememberMapping(event.target.checked)}
            />
            Mémoriser le mapping pour ce format exact
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={stableReferenceDeclared}
              onChange={(event) => setStableReferenceDeclared(event.target.checked)}
            />
            La référence d&apos;opération de mon courtier est unique et stable
          </label>
          <p className="panel-note">
            Ne cochez la dernière case que si votre courtier garantit que la référence ne se répète
            pas. C&apos;est la SEULE preuve qui autorise un rejet automatique de doublon ; prise à
            tort, elle ferait disparaître des opérations réelles.
          </p>

          <div className="form-actions">
            <button
              className="button primary"
              disabled={busy || accountId === "" || pendingFile === null}
            >
              {busy ? "Lecture…" : "Analyser"}
            </button>
          </div>
          <p className="panel-note">
            Les macros ne sont jamais exécutées et un classeur qui en porte est refusé. Les formules
            ne sont pas recalculées : leur valeur en cache est lue, et signalée.
          </p>
        </form>

        <div className="panel">
          <h3>Ce qui est lu</h3>
          <ul className="plain-list">
            <li>positions, achats et ventes ;</li>
            <li>dividendes, intérêts, frais et taxes ;</li>
            <li>apports et retraits d&apos;espèces ;</li>
            <li>devise native de chaque ligne, quand la source la porte.</li>
          </ul>
          <p className="panel-note">
            L&apos;ordre des colonnes n&apos;a aucune importance : rien n&apos;est déduit d&apos;une
            position. Une colonne inconnue est signalée, jamais rattachée au champ le plus proche.
          </p>
        </div>
      </section>

      {error !== "" ? (
        <Callout tone="warning" title="Refus">
          {error}
        </Callout>
      ) : null}
      {notice !== "" ? (
        <Callout tone="success" title="Fait">
          {notice}
        </Callout>
      ) : null}

      {preview !== null ? (
        <>
          <section className="panel">
            <h3>Lecture</h3>
            <dl className="detail-grid">
              <div>
                <dt>Format reconnu</dt>
                <dd>{preview.session.format}</dd>
              </div>
              <div>
                <dt>Statut</dt>
                <dd>{SESSION_STATUS_LABELS[preview.session.status]}</dd>
              </div>
              <div>
                <dt>Convention de montant</dt>
                <dd>{preview.conventions.amount}</dd>
              </div>
              <div>
                <dt>Convention de date</dt>
                <dd>{preview.conventions.date}</dd>
              </div>
              <div>
                <dt>Feuille lue</dt>
                <dd>{preview.sheetName ?? "—"}</dd>
              </div>
              <div>
                <dt>Confiance du mapping</dt>
                <dd>{preview.mappingConfidence}</dd>
              </div>
            </dl>

            {preview.otherSheets.length > 0 ? (
              <p className="panel-note warning-text">
                Feuilles NON lues : {preview.otherSheets.join(", ")}.
              </p>
            ) : null}
            {preview.formulaCells.length > 0 ? (
              <p className="panel-note warning-text">
                {preview.formulaCells.length} cellule(s) issue(s) d&apos;une formule (
                {preview.formulaCells.slice(0, 12).join(", ")}
                {preview.formulaCells.length > 12 ? "…" : ""}). Leur valeur vient du cache du
                tableur : elle n&apos;a PAS été recalculée et peut être périmée.
              </p>
            ) : null}

            {preview.issues.length > 0 ? (
              <div className="issue-list">
                {preview.issues.slice(0, 40).map((issue, index) => (
                  <small
                    key={`${issue.code}-${index}`}
                    className={issue.severity === "ERROR" ? "warning-text" : undefined}
                  >
                    {issue.severity === "ERROR" ? <AlertTriangle size={13} /> : <Info size={13} />}{" "}
                    {issue.message}
                  </small>
                ))}
              </div>
            ) : null}
          </section>

          {openInstruments.length > 0 ? (
            <section className="panel">
              <h3>Instruments à rattacher</h3>
              <p className="panel-note">
                Un instrument non résolu n&apos;est PAS un instrument nouveau : il n&apos;est jamais
                créé d&apos;office, car les mêmes titres se répartiraient alors entre deux entrées
                du référentiel. Les lignes qui le citent restent bloquées jusqu&apos;à votre
                décision.
              </p>
              {openInstruments.map((entry) => (
                <article key={entry.id} className="decision-card">
                  <header>
                    <strong>
                      {entry.sourceIsin ??
                        entry.sourceTicker ??
                        entry.sourceName ??
                        entry.sourceKey}
                    </strong>
                    <span>
                      {entry.state === "AMBIGUOUS" ? "Plusieurs candidats" : "Aucun candidat"} ·{" "}
                      {entry.rowCount} ligne(s)
                    </span>
                  </header>
                  {entry.candidates.length > 0 ? (
                    <ul className="plain-list">
                      {entry.candidates.map((candidate) => (
                        <li key={candidate.securityId}>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={busy}
                            onClick={() =>
                              void command(
                                {
                                  action: "resolve-instrument",
                                  resolutionId: entry.id,
                                  decision: "RESOLVE",
                                  securityId: candidate.securityId,
                                  reason: reasons[entry.id] ?? null,
                                },
                                "Instrument rattaché",
                              )
                            }
                          >
                            Rattacher à {candidate.name}
                            {candidate.isin === null ? "" : ` (${candidate.isin})`}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="panel-note">
                      Aucun instrument du référentiel ne correspond. Créez-le dans Patrimoine, puis
                      relancez l&apos;analyse : cet écran ne crée aucun instrument.
                    </p>
                  )}
                  <label>
                    Motif
                    <input
                      className="text-input"
                      value={reasons[entry.id] ?? ""}
                      placeholder="Pourquoi ce rattachement, ou pourquoi l'écarter ?"
                      onChange={(event) =>
                        setReasons((current) => ({ ...current, [entry.id]: event.target.value }))
                      }
                    />
                  </label>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy || (reasons[entry.id] ?? "").trim() === ""}
                      onClick={() =>
                        void command(
                          {
                            action: "resolve-instrument",
                            resolutionId: entry.id,
                            decision: "REJECT",
                            securityId: null,
                            reason: reasons[entry.id],
                          },
                          "Instrument écarté : ses lignes ne seront pas écrites",
                        )
                      }
                    >
                      <Ban size={15} /> Écarter
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          <section className="panel">
            <h3>Lignes</h3>
            <div className="table-scroll">
              <table className="flat-table">
                <thead>
                  <tr>
                    <th>Retenir</th>
                    <th>Ligne</th>
                    <th>État</th>
                    <th>Date</th>
                    {kind === "PORTFOLIO_LEDGER" ? <th>Nature</th> : null}
                    <th>Instrument</th>
                    <th>Quantité</th>
                    {kind === "PORTFOLIO_LEDGER" ? (
                      <>
                        <th>Brut</th>
                        <th>Frais</th>
                      </>
                    ) : (
                      <>
                        <th>Valorisation</th>
                        <th>Coût de revient</th>
                      </>
                    )}
                    <th>Anomalies</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <PortfolioRow
                      key={row.recordId}
                      row={row}
                      kind={kind}
                      checked={selected.has(row.recordId)}
                      onToggle={(next) =>
                        setSelected((current) => {
                          const copy = new Set(current);
                          if (next) copy.add(row.recordId);
                          else copy.delete(row.recordId);
                          return copy;
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rowsTruncated ? (
              <p className="panel-note">
                Seules les 300 premières lignes sont affichées. Toutes sont conservées au staging :
                le plafond est un plafond d&apos;affichage, pas de traitement.
              </p>
            ) : null}

            <div className="form-actions">
              <button
                type="button"
                className="button primary"
                disabled={busy || committable === 0 || preview.session.status !== "ANALYZED"}
                onClick={() =>
                  void command(
                    {
                      action: "commit",
                      sessionId: preview.session.sessionId,
                      recordIds: preview.rows
                        .filter(
                          (row) =>
                            selected.has(row.recordId) &&
                            (row.status === "READY" || row.status === "WARNING"),
                        )
                        .map((row) => row.recordId),
                    },
                    "Faits écrits",
                  )
                }
              >
                {busy ? "Écriture…" : `Écrire ${committable} fait(s)`}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy || preview.session.status === "COMMITTED"}
                onClick={() =>
                  void command(
                    { action: "discard", sessionId: preview.session.sessionId },
                    "Session abandonnée",
                  )
                }
              >
                Abandonner
              </button>
            </div>
            <p className="panel-note">
              Les lignes bloquées, les doublons et les lignes ignorées ne sont jamais écrits.
              Rejouer le même fichier n&apos;écrit rien de plus : la base refuse un fichier déjà
              validé, et un import incrémental ajoute sans supprimer l&apos;historique.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function PortfolioRow({
  row,
  kind,
  checked,
  onToggle,
}: {
  row: PortfolioPreviewRow;
  kind: PortfolioImportKind;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  const Icon = STATUS_ICONS[row.status];
  const selectable =
    (row.status === "READY" || row.status === "WARNING") && row.commitState === "PENDING";
  return (
    <tr className={row.status === "BLOCKED" ? "row-blocked" : undefined}>
      <td>
        <input
          type="checkbox"
          checked={checked}
          disabled={!selectable}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </td>
      <td>{row.rowNumber}</td>
      <td>
        <Icon size={14} /> {STATUS_LABELS[row.status]}
        {row.commitState === "COMMITTED" ? " · écrite" : ""}
      </td>
      <td>{row.factDate === null ? NOT_COMPUTABLE : formatDate(row.factDate)}</td>
      {kind === "PORTFOLIO_LEDGER" ? <td>{row.eventType ?? NOT_COMPUTABLE}</td> : null}
      <td>
        {row.securityName ?? row.sourceIsin ?? row.sourceTicker ?? row.sourceInstrumentName ?? "—"}
      </td>
      <td>{row.quantity === null ? NOT_COMPUTABLE : row.quantity}</td>
      {kind === "PORTFOLIO_LEDGER" ? (
        <>
          <td>{amount(row.grossAmount, row.currency)}</td>
          <td>{amount(row.feeAmount, row.currency)}</td>
        </>
      ) : (
        <>
          <td>{amount(row.marketValue, row.currency)}</td>
          <td>{amount(row.costBasis, row.currency)}</td>
        </>
      )}
      <td>
        {row.issues.length === 0 ? (
          <small>—</small>
        ) : (
          row.issues.map((issue, index) => (
            <small
              key={`${issue.code}-${index}`}
              className={issue.severity === "ERROR" ? "warning-text" : undefined}
            >
              {issue.message}
            </small>
          ))
        )}
      </td>
    </tr>
  );
}

export default PortfolioSection;
