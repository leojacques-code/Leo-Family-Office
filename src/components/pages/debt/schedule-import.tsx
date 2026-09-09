"use client";
import { useState } from "react";
import {
  parseDebtSchedule,
  SCHEDULE_HEADER,
  summarizeDebtSchedule,
  type SchedulePreview,
} from "@/lib/acquisition/debt-schedule";
import type { DebtContractInput } from "@/lib/data/contracts";

export function ScheduleImport({
  onConfirm,
  disabled,
}: {
  onConfirm: (rows: DebtContractInput["providedSchedule"], source: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const summary = preview && !preview.errors.length ? summarizeDebtSchedule(preview.rows) : null;
  const formatAmount = (value: number | null) =>
    value === null
      ? "Non fourni"
      : value.toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  return (
    <section className="full" aria-label="Importer un échéancier">
      <h3>Commencer par l’échéancier bancaire</h3>
      <p>
        Importez un CSV séparé par des points-virgules ou collez ses lignes. Le fichier doit
        distinguer assurance et frais : une rubrique groupée demande une précision de votre part.
        Les PDF restent à transcrire.
      </p>
      <label>
        Document de référence
        <input
          className="text-input"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Nom et date du document bancaire"
          disabled={disabled}
        />
      </label>
      <label>
        Fichier CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPreview(null);
            setFileError(null);
            if (file.size > 250_000) {
              setFileError("Le fichier dépasse 250 Ko.");
              return;
            }
            try {
              setText(await file.text());
              setSource(file.name);
            } catch {
              setFileError("Impossible de lire ce fichier.");
            }
          }}
        />
      </label>
      <p>
        Dates au format AAAA-MM-JJ. Saisissez explicitement zéro lorsque le document le confirme.
      </p>
      <label>
        Lignes de l’échéancier
        <textarea
          className="text-input"
          rows={5}
          value={text}
          placeholder={SCHEDULE_HEADER}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          disabled={disabled}
        />
      </label>
      <button
        type="button"
        className="button secondary"
        disabled={disabled || !text.trim()}
        onClick={() => setPreview(parseDebtSchedule(text))}
      >
        Vérifier les lignes
      </button>
      {fileError ? <p role="alert">{fileError}</p> : null}
      {preview?.errors.length ? (
        <ul role="alert">
          {preview.errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      ) : null}
      {preview && summary ? (
        <div>
          <h4>Synthèse des lignes fournies</h4>
          <dl>
            <div>
              <dt>Encours au début de l’extrait</dt>
              <dd>{formatAmount(summary.openingBalance)}</dd>
            </div>
            <div>
              <dt>Capital remboursé</dt>
              <dd>{formatAmount(summary.totalPrincipal)}</dd>
            </div>
            <div>
              <dt>Coût futur</dt>
              <dd>{formatAmount(summary.totalFutureCost)}</dd>
            </div>
            <div>
              <dt>Sorties de trésorerie</dt>
              <dd>{formatAmount(summary.totalCashOut)}</dd>
            </div>
            <div>
              <dt>Encours à la fin de l’extrait</dt>
              <dd>{formatAmount(summary.closingBalance)}</dd>
            </div>
          </dl>
          <p>
            {summary.debitCount} débits ; {summary.principalPaymentCount} remboursements de capital.
            Première sortie : {summary.firstCashOutDate ?? "Aucune dans les lignes fournies"}.
            Premier remboursement de capital :{" "}
            {summary.firstPrincipalDate ?? "Aucun dans les lignes fournies"}. Dernière date fournie
            : {summary.lastProvidedDate ?? "Aucune"}.
          </p>
          <p>
            Coût ventilé : {formatAmount(summary.totalInterest)} d’intérêts,{" "}
            {formatAmount(summary.totalInsurance)} d’assurance et {formatAmount(summary.totalFees)}{" "}
            de frais. Devise du contrat à confirmer.
          </p>
          <div style={{ overflowX: "auto", maxHeight: 280 }}>
            <table>
              <caption>Lignes reconnues — montants dans la devise du contrat</caption>
              <thead>
                <tr>
                  {[
                    "Date",
                    "Ouverture",
                    "Capital",
                    "Intérêts",
                    "Assurance",
                    "Frais",
                    "Clôture",
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.paymentNumber}>
                    <td>{row.dueDate}</td>
                    {[
                      row.openingBalance,
                      row.principal,
                      row.interest,
                      row.insurance,
                      row.fees,
                      row.closingBalance,
                    ].map((value, index) => (
                      <td key={index}>
                        {value.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Cette confirmation remplace les lignes du formulaire. Capital contractuel, encours
            observé et conditions restent à confirmer séparément. Rien n’est enregistré avant «
            Enregistrer la dette ».
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={disabled || !source.trim()}
            onClick={() => {
              onConfirm(preview.rows, source.trim());
              setPreview(null);
            }}
          >
            Utiliser ces lignes dans le formulaire
          </button>
        </div>
      ) : null}
    </section>
  );
}
