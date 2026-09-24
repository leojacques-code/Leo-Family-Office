"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Save } from "lucide-react";
import { FinancialDrawer } from "@/components/workstation/financial-drawer";
import { MoneyInput } from "@/components/primitives/money-input";
import { DateInput } from "@/components/primitives/date-input";
import type { FinancialAccount } from "@/lib/types";

/**
 * TIROIR « PREMIER REVENU NET ».
 *
 * Document 05 §4 : « un revenu net observé peut être enregistré sans fiche de paie ni montant
 * brut. Il alimente Flux, pas une reconstruction fictive de cotisations. » Le tiroir ne demande
 * donc ni brut, ni impôt, ni employeur : un libellé, le compte crédité, le montant net et la date.
 *
 * Le COMPTE fixe la devise : un versement sur un compte en CHF est un revenu en CHF. Sans compte,
 * rien n'est enregistré et le tiroir dit où l'ajouter, au lieu d'inventer une devise ou un
 * compte fictif. Aucun solde n'est modifié : le solde observé du compte reste un autre fait.
 */

export interface NetIncomeDraft {
  accountId: string;
  receivedOn: string;
  amount: number;
  label: string;
  notes: string | null;
}

export function NetIncomeDrawer({
  open,
  accounts,
  reportingCurrency,
  maxDate,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  accounts: FinancialAccount[];
  /**
   * Devise de lecture. Le moteur Flux additionne aujourd'hui les montants SANS conversion :
   * un revenu dans une autre devise y serait sommé comme s'il était dans celle-ci. Tant que
   * les flux multidevises ne sont pas convertis (phase Flux), un tel revenu est refusé ici
   * plutôt qu'affiché avec une fausse unité.
   */
  reportingCurrency: string;
  maxDate?: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: NetIncomeDraft) => Promise<boolean>;
}) {
  const cashAccounts = accounts.filter((item) => item.type === "BANK" || item.type === "SAVINGS");
  const [accountId, setAccountId] = useState(cashAccounts.length === 1 ? cashAccounts[0]!.id : "");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [amountState, setAmountState] = useState<"EMPTY" | "INVALID" | "VALID">("EMPTY");
  const [receivedOn, setReceivedOn] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const account = cashAccounts.find((item) => item.id === accountId) ?? null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!account) {
      setError("Choisissez le compte sur lequel ce revenu a été versé.");
      return;
    }
    if (account.currency !== reportingCurrency) {
      setError(
        `Ce compte est en ${account.currency} et votre lecture en ${reportingCurrency} : les flux dans plusieurs devises ne sont pas encore convertis, ce revenu serait additionné sans conversion.`,
      );
      return;
    }
    if (label.trim().length === 0) {
      setError("Nommez ce revenu, par exemple « Salaire septembre ».");
      return;
    }
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
      setError("La date de versement est obligatoire : un revenu sans date n’est pas datable.");
      return;
    }
    if (maxDate && receivedOn > maxDate) {
      setError("La date de versement ne peut pas être future.");
      return;
    }
    setError(null);
    const saved = await onSubmit({
      accountId: account.id,
      receivedOn,
      amount,
      label: label.trim(),
      notes: notes.trim() ? notes.trim() : null,
    });
    if (saved) onClose();
  }

  return (
    <FinancialDrawer
      onClose={onClose}
      open={open}
      subtitle="Le montant net versé, sans brut ni impôt reconstitués"
      title="Ajouter un revenu net"
    >
      {cashAccounts.length === 0 ? (
        <div className="form-grid">
          <p className="full" role="status">
            Un revenu est versé sur un compte : ajoutez d’abord le compte qui le reçoit.
          </p>
          <div className="form-actions">
            <button className="button secondary" onClick={onClose} type="button">
              Fermer
            </button>
            <Link className="button primary" href="/net-worth">
              Ajouter un compte
            </Link>
          </div>
        </div>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          <label>
            Libellé
            <input
              className="text-input"
              maxLength={180}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Salaire septembre, pension, allocation…"
              required
              value={label}
            />
          </label>
          <label>
            Compte crédité
            <select
              className="text-input"
              onChange={(event) => setAccountId(event.target.value)}
              required
              value={accountId}
            >
              <option value="">Choisir un compte</option>
              {cashAccounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.currency}
                </option>
              ))}
            </select>
          </label>
          <MoneyInput
            currency={account?.currency ?? "devise du compte"}
            hint="Le montant réellement versé sur le compte"
            id="cash-flow-net-income-amount"
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
            id="cash-flow-net-income-date"
            label="Date de versement"
            max={maxDate}
            onChange={(draft) => setReceivedOn(draft.state === "VALID" ? draft.value : null)}
            required
            value={receivedOn}
          />
          <label className="full">
            Note (facultative)
            <input
              className="text-input"
              maxLength={500}
              onChange={(event) => setNotes(event.target.value)}
              value={notes}
            />
          </label>
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
              <Save size={15} /> Enregistrer le revenu
            </button>
          </div>
        </form>
      )}
    </FinancialDrawer>
  );
}
