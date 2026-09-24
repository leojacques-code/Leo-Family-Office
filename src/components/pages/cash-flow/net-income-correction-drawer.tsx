"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { FinancialDrawer } from "@/components/workstation/financial-drawer";
import { MoneyInput } from "@/components/primitives/money-input";
import { DateInput } from "@/components/primitives/date-input";
import { Currency } from "@/components/ui";
import { formatDate } from "@/components/pages/shared";
import type { Transaction, TransactionCorrection } from "@/lib/types";

/**
 * TIROIR « CORRIGER UN REVENU SAISI ».
 *
 * Une saisie erronée n'est pas un flux économique : la corriger ne crée AUCUNE opération de
 * régularisation. La valeur est corrigée en place par `lfo_correct_net_income`, et la piste
 * immuable garde l'avant, l'après, le motif et la date de la décision. Le tiroir envoie l'état
 * qu'il AFFICHE : si le revenu a changé entre-temps, la base refuse au lieu d'écraser.
 *
 * Le compte, donc la devise, ne se corrige pas ici : changer de compte serait une autre
 * observation. Le motif est obligatoire : une correction sans raison n'explique rien.
 */

export interface NetIncomeCorrectionDraft {
  transactionId: string;
  reason: string;
  expected: { amount: string; receivedOn: string; label: string };
  corrected: { amount?: number; receivedOn?: string; label?: string };
}

const FIELD_LABELS: Record<TransactionCorrection["changedFields"][number], string> = {
  amount: "montant",
  transaction_date: "date",
  label: "libellé",
};

export function NetIncomeCorrectionDrawer({
  open,
  transaction,
  closedMonthVersion,
  closedVersionOf,
  maxDate,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  transaction: Transaction;
  /**
   * Version de la clôture du mois de ce revenu, s'il est clôturé. Une clôture est une
   * photographie décidée : la correction ne la réécrit pas, une nouvelle version le fera.
   */
  closedMonthVersion: number | null;
  /** Version de clôture d'un mois donné (`AAAA-MM`), `null` s'il n'est pas clôturé. */
  closedVersionOf?: (month: string) => number | null;
  maxDate?: string;
  busy: boolean;
  onClose: () => void;
  /** `onError` affiche dans le tiroir la raison du refus rédigée par le serveur. */
  onSubmit: (
    draft: NetIncomeCorrectionDraft,
    onError: (message: string) => void,
  ) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(transaction.label);
  const [amount, setAmount] = useState<number | null>(transaction.amount);
  const [amountState, setAmountState] = useState<"EMPTY" | "INVALID" | "VALID">("VALID");
  const [receivedOn, setReceivedOn] = useState<string | null>(transaction.date);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const history = transaction.corrections ?? [];
  // Déplacer la date VERS un mois clôturé fait diverger sa clôture du ledger : on le dit.
  const targetMonth = receivedOn?.slice(0, 7) ?? null;
  const targetClosedVersion =
    targetMonth && targetMonth !== transaction.date.slice(0, 7)
      ? (closedVersionOf?.(targetMonth) ?? null)
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null) {
      setError(
        amountState === "INVALID"
          ? "Le montant saisi n’est pas lisible : il n’est pas interprété comme zéro."
          : "Le montant net est obligatoire. Un champ vide n’est pas un revenu nul.",
      );
      return;
    }
    if (amount <= 0) {
      setError("Un revenu versé est un montant strictement positif.");
      return;
    }
    if (receivedOn === null) {
      setError("La date de versement est obligatoire.");
      return;
    }
    if (maxDate && receivedOn > maxDate) {
      setError("La date de versement ne peut pas être future.");
      return;
    }
    if (label.trim().length === 0) {
      setError("Le libellé ne peut pas être vide.");
      return;
    }
    const corrected: NetIncomeCorrectionDraft["corrected"] = {};
    if (amount !== transaction.amount) corrected.amount = amount;
    if (receivedOn !== transaction.date) corrected.receivedOn = receivedOn;
    if (label.trim() !== transaction.label) corrected.label = label.trim();
    if (Object.keys(corrected).length === 0) {
      setError("Aucune valeur n’a changé : ce n’est pas une correction.");
      return;
    }
    if (reason.trim().length === 0) {
      setError("Indiquez le motif de la correction : il est conservé avec l’ancienne valeur.");
      return;
    }
    setError(null);
    let refusal: string | null = null;
    const saved = await onSubmit(
      {
        transactionId: transaction.id,
        reason: reason.trim(),
        expected: {
          // Le texte lu en base ; à défaut, le nombre en notation simple à six décimales.
          amount: transaction.amountText ?? transaction.amount.toFixed(6),
          receivedOn: transaction.date,
          label: transaction.label,
        },
        corrected,
      },
      (message) => {
        refusal = message;
      },
    );
    if (saved) onClose();
    else
      setError(`La correction n’a pas été enregistrée : ${refusal ?? "modification impossible"}`);
  }

  return (
    <FinancialDrawer
      onClose={onClose}
      open={open}
      subtitle="La valeur est corrigée, l’ancienne reste dans l’historique avec son motif"
      title={`Corriger « ${transaction.label} »`}
    >
      <form className="form-grid" onSubmit={submit}>
        <label>
          Libellé
          <input
            className="text-input"
            maxLength={180}
            onChange={(event) => setLabel(event.target.value)}
            required
            value={label}
          />
        </label>
        <label>
          Compte crédité
          <input
            className="text-input"
            disabled
            value={`${transaction.accountName} · ${transaction.currency}`}
          />
        </label>
        <MoneyInput
          currency={transaction.currency}
          hint="Le montant réellement versé sur le compte"
          id="cash-flow-net-income-correction-amount"
          label="Montant net versé"
          onChange={(draft) => {
            setAmountState(draft.state);
            setAmount(draft.state === "VALID" ? draft.value : null);
          }}
          required
          value={amount}
        />
        <DateInput
          hint="Date à laquelle le versement a été reçu"
          id="cash-flow-net-income-correction-date"
          label="Date de versement"
          max={maxDate}
          onChange={(draft) => setReceivedOn(draft.state === "VALID" ? draft.value : null)}
          required
          value={receivedOn}
        />
        <label className="full">
          Motif de la correction
          <input
            className="text-input"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Montant saisi avant retenue à la source, erreur de date…"
            required
            value={reason}
          />
        </label>
        <p className="full outstanding-debt-note">
          Aucune opération de régularisation n’est créée : une erreur de saisie n’est pas un flux.
          Le compte et la devise ne se corrigent pas ici.
          {closedMonthVersion !== null
            ? ` Ce mois est clôturé (v${closedMonthVersion}) : la clôture reste la photographie décidée, créez une nouvelle version pour y intégrer la correction.`
            : ""}
          {targetClosedVersion !== null
            ? ` Le mois de la nouvelle date est clôturé (v${targetClosedVersion}) : sa clôture ne portera pas ce revenu tant qu’une nouvelle version n’est pas créée.`
            : ""}
        </p>
        {history.length ? (
          <div className="full">
            <strong>Corrections précédentes</strong>
            <ul className="muted-copy">
              {history.map((entry) => (
                <li key={entry.id}>
                  {formatDate(entry.decidedAt.slice(0, 10))} ·{" "}
                  {entry.changedFields.map((field) => FIELD_LABELS[field]).join(", ")} :{" "}
                  {entry.changedFields.includes("amount") ? (
                    <>
                      <Currency
                        value={Number(entry.before.amount)}
                        currency={transaction.currency}
                      />{" "}
                      →{" "}
                      <Currency
                        value={Number(entry.after.amount)}
                        currency={transaction.currency}
                      />
                    </>
                  ) : null}
                  {entry.changedFields.includes("transaction_date")
                    ? ` ${formatDate(entry.before.date)} → ${formatDate(entry.after.date)}`
                    : ""}
                  {entry.changedFields.includes("label")
                    ? ` « ${entry.before.label} » → « ${entry.after.label} »`
                    : ""}{" "}
                  ({entry.reason})
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <p className="form-error full" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <button className="button secondary" onClick={onClose} type="button">
            Annuler
          </button>
          <button className="button primary" disabled={busy}>
            <Save size={15} /> Enregistrer la correction
          </button>
        </div>
      </form>
    </FinancialDrawer>
  );
}
