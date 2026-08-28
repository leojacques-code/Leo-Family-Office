"use client";

import { useMemo, useState } from "react";
import { Ban, Building2, Check, MinusCircle } from "lucide-react";

import { Callout, EmptyState } from "@/components/ui";
import { uploadToSignedStoragePath } from "@/lib/data/supabase-storage-browser";
import { NOT_COMPUTABLE } from "@/components/pages/shared";
import type {
  FecAmount,
  FecCommitResult,
  FecPreview,
  FecPreviewLine,
  FecUploadTicket,
} from "@/lib/data/fec-contracts";
import type { ImportRowStatus } from "@/lib/data/import-contracts";

/**
 * IMPORT COMPTABLE — un FEC devient des écritures observées, puis un instantané financier.
 *
 * Cet écran ne calcule rien. Il rend ce que la couche d'acquisition a reconstruit, avec la
 * CONVENTION de chaque montant : « EBITDA » ne veut rien dire tant qu'on n'a pas dit lequel.
 * Aucun retraitement normatif n'est proposé ici, et aucun ne le sera : cela appartient au
 * ledger de Quality of Earnings de Business Equity, sur décision humaine documentée.
 */

const STATUS_LABELS: Record<ImportRowStatus, string> = {
  READY: "Lue",
  WARNING: "À confirmer",
  BLOCKED: "Bloquée",
  DUPLICATE: "Doublon",
  IGNORED: "Ignorée",
};

const STATUS_ICONS: Record<ImportRowStatus, typeof Check> = {
  READY: Check,
  WARNING: MinusCircle,
  BLOCKED: Ban,
  DUPLICATE: MinusCircle,
  IGNORED: MinusCircle,
};

const STATEMENT_LABELS: Record<FecPreview["statement"]["status"], string> = {
  CALCULABLE: "Reconstruction complète",
  PARTIAL: "Reconstruction partielle",
  NOT_COMPUTABLE: "Non reconstructible",
};

function money(value: number | null, currency: string) {
  if (value === null) return <span className="warning-text">{NOT_COMPUTABLE}</span>;
  return (
    <span className={value < 0 ? "negative-text" : undefined}>
      {new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(value)}
    </span>
  );
}

/** Un poste reconstruit : sa valeur, et la convention qui l'a produite. */
function Line({ label, amount, currency }: { label: string; amount: FecAmount; currency: string }) {
  return (
    <div className="table-row">
      <span>{label}</span>
      <span>{money(amount.value, currency)}</span>
      <span>
        <small>{amount.basis}</small>
        {amount.note ? <small className="warning-text">{amount.note}</small> : null}
      </span>
    </div>
  );
}

interface FecSectionProps {
  businesses: Array<{ id: string; name: string; functionalCurrency: string | null }>;
  /** Rafraîchit le cockpit : un instantané financier écrit change le domaine Business. */
  refresh: () => Promise<void>;
}

function FecSection({ businesses, refresh }: FecSectionProps) {
  const [chosenBusinessId, setChosenBusinessId] = useState<string | null>(null);
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);
  const [fiscalYearStart, setFiscalYearStart] = useState("");
  const [fiscalYearEnd, setFiscalYearEnd] = useState("");
  const [coverageDeclared, setCoverageDeclared] = useState(false);
  const [retainFile, setRetainFile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<FecPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showLines, setShowLines] = useState(false);
  /** Étape du dépôt. Le dire évite de laisser croire qu'un long upload est un blocage. */
  const [stage, setStage] = useState<"IDLE" | "TICKET" | "UPLOAD" | "ANALYZE">("IDLE");

  const businessId = chosenBusinessId ?? businesses[0]?.id ?? "";
  const selected = businesses.find((business) => business.id === businessId) ?? null;
  /**
   * Devise de tenue. Préremplie depuis la devise fonctionnelle de la société QUAND elle est
   * connue, vide sinon. Supposer « EUR » serait une valeur par défaut à la place d'une
   * donnée manquante, et un taux de change implicite égal à 1 sur toute la comptabilité.
   */
  const currency = chosenCurrency ?? selected?.functionalCurrency ?? "";

  const blockedLines = useMemo(
    () => (preview ? preview.lines.filter((line) => line.status === "BLOCKED") : []),
    [preview],
  );

  /**
   * Dépôt puis analyse, en TROIS temps.
   *
   * Le fichier ne passe JAMAIS par `/api/imports/fec`. Une fonction serverless plafonne le
   * corps de requête entrant bien en dessous de la taille d'un FEC d'exercice : un envoi
   * par la route serait refusé par la plateforme avant que le serveur voie quoi que ce
   * soit. Le navigateur demande donc un billet, dépose le fichier DIRECTEMENT au stockage
   * privé, puis n'envoie au serveur qu'une référence de quelques octets.
   */
  async function analyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingFile) {
      setError("Choisir un fichier.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setStage("TICKET");
    try {
      // 1. Billet : le serveur calcule le chemin et signe l'autorisation de dépôt.
      const ticketResponse = await fetch("/api/imports/fec?ticket=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: pendingFile.name,
          byteSize: pendingFile.size,
          retainFile,
        }),
      });
      const ticket = await ticketResponse.json().catch(() => ({}));
      if (!ticketResponse.ok) {
        setError(ticket.error ?? "Dépôt impossible");
        setPreview(null);
        return;
      }

      // 2. Dépôt DIRECT à la zone de staging privée. Cette requête ne traverse aucune
      //    fonction serveur : c'est ce qui rend un FEC de plusieurs dizaines de mégaoctets
      //    possible. Le client officiel est utilisé tel quel — pour un `File`, il construit
      //    le corps `multipart/form-data` que le service attend, ce qu'un PUT artisanal du
      //    fichier brut ne fait pas.
      setStage("UPLOAD");
      const issued = ticket as FecUploadTicket;
      try {
        await uploadToSignedStoragePath({
          bucket: issued.bucket,
          path: issued.storagePath,
          token: issued.token,
          file: pendingFile,
          contentType: issued.contentType,
        });
      } catch (uploadError) {
        setError(
          `${
            uploadError instanceof Error ? uploadError.message : "Le dépôt du fichier a échoué."
          } Rien n'a été analysé, rien n'a été écrit.`,
        );
        setPreview(null);
        return;
      }

      // 3. Analyse : la requête ne porte qu'un identifiant de billet.
      setStage("ANALYZE");
      const response = await fetch("/api/imports/fec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadTicketId: issued.ticketId,
          businessId,
          currency: currency.trim().toUpperCase(),
          fiscalYearStart: fiscalYearStart.length === 10 ? fiscalYearStart : null,
          fiscalYearEnd: fiscalYearEnd.length === 10 ? fiscalYearEnd : null,
          coverageDeclared,
          retainFile,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Analyse impossible");
        setPreview(null);
      } else {
        setPreview(payload as FecPreview);
        setShowLines(false);
      }
    } finally {
      setStage("IDLE");
      setBusy(false);
    }
  }

  async function command(action: "commit" | "discard") {
    if (!preview) return;
    setBusy(true);
    setError("");
    // Aucun fichier n'accompagne la commande : quand la session a demandé sa conservation,
    // le serveur reprend le contenu depuis l'objet de staging privé qu'il a lui-même écrit.
    // La copie au coffre n'a lieu qu'après l'écriture du fait, donc une analyse abandonnée
    // n'en laisse aucune.
    const response = await fetch("/api/imports/fec", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sessionId: preview.sessionId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload.error ?? "Commande impossible");
    else {
      if (action === "commit") {
        const result = payload as FecCommitResult;
        // Le fait et sa copie d'archive sont annoncés SÉPARÉMENT : un dépôt manqué ne doit
        // jamais laisser croire que l'instantané financier n'a pas été écrit.
        const archive =
          result.documentStatus === "FAILED"
            ? " La conservation du fichier a échoué : le fait est écrit, seule la copie d'archive manque."
            : result.documentStatus === "STORED"
              ? " Fichier conservé au coffre privé."
              : "";
        setNotice(
          `${result.committedCount} écriture(s) conservée(s) et instantané financier au ${result.periodEnd} écrit dans Business Equity. Aucune valorisation n'a été produite.${archive}${
            result.warnings.length ? ` ${result.warnings.join(" ")}` : ""
          }`,
        );
      } else setNotice("Analyse abandonnée. Aucun fait n'avait été écrit.");
      setPreview(null);
      setPendingFile(null);
      await refresh();
    }
    setBusy(false);
  }

  const candidate = preview?.candidate ?? null;
  const committable =
    preview !== null && candidate !== null && candidate.blockers.length === 0 && !busy;

  return (
    <>
      <section className="import-layout">
        <form className="panel upload-panel" onSubmit={analyze}>
          <span className="upload-icon">
            <Building2 size={24} />
          </span>
          <h2>Déposer un FEC</h2>
          <p>Fichier des écritures comptables · TXT, CSV ou TSV · 24 Mo analysés, 8 Mo conservés</p>
          <small className="field-hint">
            Le fichier est déposé directement au coffre privé, sans passer par le serveur
            d’application : c’est ce qui rend un exercice complet de plusieurs dizaines de
            mégaoctets réellement importable.
          </small>
          <input
            id="fec-file"
            type="file"
            name="file"
            accept=".txt,.csv,.tsv"
            onChange={(event) => setPendingFile(event.target.files?.[0] ?? null)}
          />
          <label htmlFor="fec-file" className="button primary">
            {pendingFile ? pendingFile.name : "Choisir un fichier"}
          </label>

          <label className="field-label" htmlFor="fec-business">
            Société concernée
          </label>
          <select
            id="fec-business"
            className="text-input"
            value={businessId}
            onChange={(event) => {
              setChosenBusinessId(event.target.value);
              setChosenCurrency(null);
            }}
          >
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor="fec-currency">
            Devise de tenue de la comptabilité
          </label>
          <input
            id="fec-currency"
            className="text-input"
            value={currency}
            maxLength={3}
            onChange={(event) => setChosenCurrency(event.target.value.toUpperCase())}
          />
          <small className="field-hint">
            Le FEC ne porte pas la devise de tenue : seuls des montants en devise étrangère y
            figurent, ligne à ligne. Elle est donc déclarée, et aucune conversion n’est faite ici.
            Sans devise fonctionnelle connue pour la société, aucune n’est supposée : elle est à
            saisir.
          </small>

          <label className="field-label" htmlFor="fec-year-start">
            Exercice déclaré
          </label>
          <input
            id="fec-year-start"
            className="text-input"
            type="date"
            value={fiscalYearStart}
            onChange={(event) => setFiscalYearStart(event.target.value)}
          />
          <input
            id="fec-year-end"
            className="text-input"
            type="date"
            value={fiscalYearEnd}
            onChange={(event) => setFiscalYearEnd(event.target.value)}
          />

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={coverageDeclared}
              onChange={(event) => setCoverageDeclared(event.target.checked)}
            />
            Ce fichier couvre l’exercice ENTIER
          </label>
          <small className="field-hint">
            Décoché, l’analyse reste possible et les totaux restent exacts pour les lignes fournies
            : ils ne constituent simplement pas un exercice, et rien n’est écrit dans Business
            Equity. Des dates minimale et maximale ne prouvent pas l’exhaustivité.
          </small>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={retainFile}
              onChange={(event) => setRetainFile(event.target.checked)}
            />
            Conserver le fichier au coffre privé
          </label>
          <small className="field-hint">
            Le coffre privé est limité à 8 Mo, là où l’analyse en accepte 24 : un FEC plus lourd
            s’importe très bien, il ne s’archive simplement pas ici. Le refus porte alors sur la
            conservation, jamais sur l’import.
          </small>

          <button
            className="button secondary"
            disabled={busy || !businessId || !pendingFile || currency.trim().length !== 3}
          >
            {stage === "TICKET"
              ? "Préparation du dépôt…"
              : stage === "UPLOAD"
                ? "Dépôt du fichier…"
                : stage === "ANALYZE"
                  ? "Analyse…"
                  : "Analyser sans rien écrire"}
          </button>
          {error ? <div className="form-error">{error}</div> : null}
          {notice ? <div className="form-notice">{notice}</div> : null}
        </form>

        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Ce que le FEC dit, et ce qu’il ne dit pas</span>
              <h2>Périmètre</h2>
            </div>
          </div>
          <p className="panel-note">
            Un FEC est une SOURCE COMPTABLE détaillée. Ce n’est ni une liasse, ni des comptes
            annuels, ni une due diligence : il ne porte aucune annexe et aucun retraitement de
            consolidation.
          </p>
          <p className="panel-note">
            Ce qui en est reconstruit est un CANDIDAT. La classification par numéro de compte est
            déterministe et vérifiable, mais elle reste comptable : un compte 625 est un poste «
            déplacements et missions », pas une « dépense personnelle du dirigeant ». Aucun EBITDA
            normatif n’est produit.
          </p>
          <p className="panel-note">
            La trésorerie comptable de la société n’est pas votre trésorerie personnelle, et la
            dette de la société réduit son equity value sans jamais entrer à votre passif.
          </p>
        </article>
      </section>

      {preview ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Preview · aucun fait Business écrit</span>
              <h2>
                {preview.fileName} · {preview.businessName}
              </h2>
            </div>
            <span className="nav-count">{preview.counts.lines}</span>
          </div>

          <div className="import-facts">
            <span>
              <small>Écritures</small>
              <strong>{preview.counts.entries}</strong>
            </span>
            <span>
              <small>Lignes lues</small>
              <strong>{preview.counts.ready + preview.counts.warning}</strong>
            </span>
            <span>
              <small>Lignes bloquées</small>
              <strong className={preview.counts.blocked > 0 ? "warning-text" : undefined}>
                {preview.counts.blocked}
              </strong>
            </span>
            <span>
              <small>Écritures déséquilibrées</small>
              <strong className={preview.counts.unbalancedEntries > 0 ? "warning-text" : undefined}>
                {preview.counts.unbalancedEntries}
              </strong>
            </span>
            <span>
              <small>Journaux</small>
              <strong>{preview.counts.journals}</strong>
            </span>
            <span>
              <small>Comptes</small>
              <strong>{preview.counts.accounts}</strong>
            </span>
            <span>
              <small>Période observée</small>
              <strong>
                {preview.observedPeriod
                  ? `${preview.observedPeriod.start} → ${preview.observedPeriod.end}`
                  : NOT_COMPUTABLE}
              </strong>
            </span>
            <span>
              <small>Reconstruction</small>
              <strong>{STATEMENT_LABELS[preview.statement.status]}</strong>
            </span>
          </div>

          {preview.currencies.length > 0 ? (
            <Callout tone="info" title="Montants en devise étrangère">
              Devises rencontrées : {preview.currencies.join(", ")}. Les montants restent en devise
              de tenue ; aucune conversion n’est faite ici, le FX Engine reste l’unique
              convertisseur.
            </Callout>
          ) : null}
          {preview.unknownHeaders.length > 0 ? (
            <Callout tone="info" title="Colonnes hors format">
              {preview.unknownHeaders.join(", ")} — conservées au brut, jamais lues.
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

          <h3>Compte de résultat reconstruit</h3>
          <div className="import-table">
            <div className="table-head">
              <span>Poste</span>
              <span>Montant</span>
              <span>Convention retenue</span>
            </div>
            <Line
              label="Chiffre d’affaires"
              amount={preview.statement.income.revenue}
              currency={preview.currency}
            />
            <Line
              label="Marge commerciale"
              amount={preview.statement.income.merchandiseMargin}
              currency={preview.currency}
            />
            <Line
              label="Valeur ajoutée"
              amount={preview.statement.income.addedValue}
              currency={preview.currency}
            />
            <Line
              label="Excédent brut d’exploitation"
              amount={preview.statement.income.grossOperatingSurplus}
              currency={preview.currency}
            />
            <Line
              label="Résultat d’exploitation"
              amount={preview.statement.income.operatingResult}
              currency={preview.currency}
            />
            <Line
              label="Charges d’intérêts"
              amount={preview.statement.income.interestExpense}
              currency={preview.currency}
            />
            <Line
              label="Dotations aux amortissements"
              amount={preview.statement.income.depreciationExpense}
              currency={preview.currency}
            />
            <Line
              label="Impôt sur les bénéfices"
              amount={preview.statement.income.incomeTaxExpense}
              currency={preview.currency}
            />
            <Line
              label="Résultat net"
              amount={preview.statement.income.netResult}
              currency={preview.currency}
            />
          </div>

          <h3>Postes de bilan reconstruits</h3>
          <div className="import-table">
            <div className="table-head">
              <span>Poste</span>
              <span>Montant</span>
              <span>Convention retenue</span>
            </div>
            <Line
              label="Trésorerie comptable"
              amount={preview.statement.balanceSheet.cash}
              currency={preview.currency}
            />
            <Line
              label="Concours bancaires courants"
              amount={preview.statement.balanceSheet.bankOverdraft}
              currency={preview.currency}
            />
            <Line
              label="Dette financière comptable"
              amount={preview.statement.balanceSheet.financialDebt}
              currency={preview.currency}
            />
            <Line
              label="Comptes courants d’associés"
              amount={preview.statement.balanceSheet.shareholderCurrentAccounts}
              currency={preview.currency}
            />
            <Line
              label="Stocks"
              amount={preview.statement.balanceSheet.inventory}
              currency={preview.currency}
            />
            <Line
              label="Clients"
              amount={preview.statement.balanceSheet.tradeReceivables}
              currency={preview.currency}
            />
            <Line
              label="Fournisseurs"
              amount={preview.statement.balanceSheet.suppliers}
              currency={preview.currency}
            />
            <Line
              label="Dettes fiscales et sociales"
              amount={preview.statement.balanceSheet.taxAndSocialLiabilities}
              currency={preview.currency}
            />
            <Line
              label="BFR d’exploitation"
              amount={preview.statement.balanceSheet.operatingWorkingCapital}
              currency={preview.currency}
            />
            <Line
              label="Capitaux propres"
              amount={preview.statement.balanceSheet.equity}
              currency={preview.currency}
            />
          </div>

          {preview.statement.blockers.length ? (
            <div className="import-issues">
              {preview.statement.blockers.map((issue, index) => (
                <p
                  key={`${issue.code}-${index}`}
                  className={issue.severity === "ERROR" ? "warning-text" : undefined}
                >
                  <strong>{issue.code}</strong> · {issue.message}
                </p>
              ))}
            </div>
          ) : null}

          {blockedLines.length ? (
            <>
              <h3>Lignes illisibles</h3>
              <div className="import-table">
                <div className="table-head">
                  <span>Ligne</span>
                  <span>Compte</span>
                  <span>Anomalie</span>
                </div>
                {blockedLines.map((line) => (
                  <LineRow key={line.id} line={line} />
                ))}
              </div>
            </>
          ) : null}

          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setShowLines((current) => !current)}
            >
              {showLines ? "Masquer les écritures" : `Voir les écritures (${preview.lines.length})`}
            </button>
          </div>

          {showLines ? (
            <div className="import-table">
              <div className="table-head">
                <span>Ligne</span>
                <span>Journal</span>
                <span>Date</span>
                <span>Compte</span>
                <span>Débit</span>
                <span>Crédit</span>
              </div>
              {preview.lines.map((line) => (
                <div className="table-row" key={line.id}>
                  <span>{line.rowNumber}</span>
                  <span>
                    {line.journalCode} · {line.entryNumber}
                  </span>
                  <span>{line.entryDate ?? <span className="warning-text">—</span>}</span>
                  <span>
                    {line.accountNumber}
                    {line.accountLabel ? <small>{line.accountLabel}</small> : null}
                  </span>
                  <span>{money(line.debit, preview.currency)}</span>
                  <span>{money(line.credit, preview.currency)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {preview.linesTruncated ? (
            <p className="panel-note">
              Seules les 300 premières écritures sont affichées. Toutes sont conservées : le plafond
              est un plafond d’affichage, pas de traitement.
            </p>
          ) : null}

          <div className="form-actions">
            <button
              type="button"
              className="button primary"
              disabled={!committable}
              onClick={() => void command("commit")}
            >
              {busy ? "Écriture…" : "Écrire l’instantané financier"}
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
          {candidate && candidate.blockers.length ? (
            <Callout tone="warning" title="Rien n’est intégrable en l’état">
              {candidate.blockers.map((issue) => issue.message).join(" ")}
            </Callout>
          ) : null}
          <p className="panel-note">
            La validation écrit UN instantané financier daté dans Business Equity, et gèle les
            écritures qui l’ont produit. Elle ne produit aucune valorisation, aucun multiple et
            aucun retraitement : le domaine Business Equity reste propriétaire de l’analyse.
          </p>
        </section>
      ) : businesses.length === 0 ? (
        <EmptyState
          title="Aucune société suivie"
          detail="Un FEC alimente une société. Créez-la d’abord dans Business Equity : une écriture comptable appartient toujours à une entité connue."
        />
      ) : null}
    </>
  );
}

/** Une ligne illisible, avec ce qui a empêché sa lecture. */
function LineRow({ line }: { line: FecPreviewLine }) {
  const Icon = STATUS_ICONS[line.status];
  return (
    <div className="table-row">
      <span>{line.rowNumber}</span>
      <span>
        {line.accountNumber.length ? line.accountNumber : <span className="warning-text">—</span>}
      </span>
      <span>
        <span className="status-outline">
          <Icon size={14} /> {STATUS_LABELS[line.status]}
        </span>
        {line.issues.map((issue, index) => (
          <small
            key={`${issue.code}-${index}`}
            className={issue.severity === "ERROR" ? "warning-text" : undefined}
          >
            {issue.message}
          </small>
        ))}
      </span>
    </div>
  );
}

export default FecSection;
