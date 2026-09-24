"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { FinancialDrawer } from "@/components/workstation/financial-drawer";
import { MoneyInput } from "@/components/primitives/money-input";
import { DateInput } from "@/components/primitives/date-input";
import type { OutstandingDebt } from "@/lib/types";

/**
 * TIROIR « JE CONNAIS SEULEMENT L'ENCOURS ».
 *
 * Document 04 §2 : « Enregistrer une somme que je dois » demande un nom, un créancier s'il est
 * connu, un encours, une devise et une date d'observation, et produit un passif daté SANS
 * calendrier inventé. Aucun taux, aucune mensualité, aucune durée n'est demandé : les demander
 * obligerait à inventer un contrat pour déclarer une observation valable (document 00, règle 3).
 *
 * Mêmes garanties que le tiroir de compte : un champ vide reste vide, une saisie illisible
 * n'est jamais lue comme zéro, un zéro DÉCLARÉ est accepté, la date est explicite et jamais
 * future. Une correction AJOUTE une observation datée : l'historique n'est pas réécrit.
 */

export interface OutstandingDebtDraft {
  name: string;
  lender: string | null;
  currency: string;
  balance: number;
  observedAt: string;
  notes: string | null;
}

export function OutstandingDebtDrawer({
  open,
  debt,
  defaultCurrency,
  maxDate,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Dette existante dont on corrige l'encours, ou `null` pour une création. */
  debt: OutstandingDebt | null;
  /** Devise proposée à la création, affichée et modifiable : jamais supposée en silence. */
  defaultCurrency: string;
  maxDate?: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: OutstandingDebtDraft) => Promise<boolean>;
}) {
  const [name, setName] = useState(debt?.name ?? "");
  const [lender, setLender] = useState(debt?.lender ?? "");
  const [currency, setCurrency] = useState(debt?.currency ?? defaultCurrency);
  const [balance, setBalance] = useState<number | null>(debt?.currentBalance ?? null);
  const [balanceState, setBalanceState] = useState<"EMPTY" | "INVALID" | "VALID">(
    debt ? "VALID" : "EMPTY",
  );
  const [observedAt, setObservedAt] = useState<string | null>(debt?.balanceDate ?? null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!debt && name.trim().length === 0) {
      setError("Donnez un nom à cette dette pour la retrouver.");
      return;
    }
    if (balance === null) {
      setError(
        balanceState === "INVALID"
          ? "L’encours saisi n’est pas lisible : il n’est pas interprété comme zéro."
          : "L’encours est obligatoire. Un champ vide n’est pas une dette nulle.",
      );
      return;
    }
    if (balance < 0) {
      setError("Un encours dû ne peut pas être négatif. Une somme prêtée n’est pas une dette.");
      return;
    }
    if (observedAt === null) {
      setError(
        "La date de l’encours est obligatoire : une observation sans date n’est pas datable.",
      );
      return;
    }
    if (maxDate && observedAt > maxDate) {
      setError("La date d’observation ne peut pas être future.");
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(currency)) {
      setError("La devise s’écrit en trois lettres, par exemple EUR.");
      return;
    }
    setError(null);
    const saved = await onSubmit({
      name: name.trim(),
      lender: lender.trim() ? lender.trim() : null,
      currency: currency.toUpperCase(),
      balance,
      observedAt,
      notes: notes.trim() ? notes.trim() : null,
    });
    if (saved) onClose();
  }

  return (
    <FinancialDrawer
      onClose={onClose}
      open={open}
      subtitle={
        debt
          ? "Le nouvel encours s’ajoute à l’historique, il ne remplace pas le précédent"
          : "Taux, mensualité et durée restent inconnus : aucun échéancier n’est calculé"
      }
      title={debt ? `Corriger l’encours de ${debt.name}` : "Enregistrer une somme due"}
    >
      <form className="form-grid" onSubmit={submit}>
        {debt ? null : (
          <>
            <label>
              Nom de la dette
              <input
                className="text-input"
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                placeholder="Prêt familial, crédit étudiant…"
                required
                value={name}
              />
            </label>
            <label>
              Créancier (facultatif)
              <input
                className="text-input"
                maxLength={160}
                onChange={(event) => setLender(event.target.value)}
                value={lender}
              />
            </label>
            <label>
              Devise
              <input
                className="text-input"
                maxLength={3}
                onChange={(event) => setCurrency(event.target.value)}
                required
                value={currency}
              />
            </label>
          </>
        )}
        <MoneyInput
          currency={debt?.currency ?? currency.toUpperCase()}
          hint="Le capital restant dû à cette date, tel que vous le connaissez"
          id="debt-outstanding-balance"
          label="Encours restant dû"
          onChange={(draft) => {
            setBalanceState(draft.state);
            setBalance(draft.state === "VALID" ? draft.value : null);
          }}
          required
          value={balance}
        />
        <DateInput
          hint="Date à laquelle cet encours a été constaté"
          id="debt-outstanding-date"
          label="Date de l’encours"
          max={maxDate}
          onChange={(draft) => setObservedAt(draft.state === "VALID" ? draft.value : null)}
          required
          value={observedAt}
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
            <Save size={15} />
            {debt ? "Enregistrer le nouvel encours" : "Enregistrer la dette"}
          </button>
        </div>
      </form>
    </FinancialDrawer>
  );
}
