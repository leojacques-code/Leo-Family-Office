"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Save } from "lucide-react";

import type { PortfolioEnvelopePolicyInput, PortfolioEventInput } from "@/lib/data/contracts";
import { PORTFOLIO_FLOW_DIRECTION } from "@/lib/engine/portfolio";
import {
  LEDGER_COVERAGE_SOURCES,
  LOT_MATCHING_METHODS,
  PORTFOLIO_EVENT_TYPES,
  type FinancialAccount,
  type PortfolioEnvelopePolicy,
  type PortfolioEvent,
  type PortfolioEventType,
  type Transaction,
} from "@/lib/types";

export const EVENT_TYPE_LABELS: Record<PortfolioEventType, string> = {
  OPENING_POSITION: "Ancrage de position",
  OPENING_CASH: "Ancrage de cash",
  CONTRIBUTION: "Apport",
  WITHDRAWAL: "Retrait",
  BUY: "Achat",
  SELL: "Vente",
  DIVIDEND: "Dividende",
  INTEREST: "Coupon ou intérêt",
  FEE: "Frais",
  TAX: "Taxe",
  TRANSFER_IN: "Transfert entrant",
  TRANSFER_OUT: "Transfert sortant",
};

export const MATCHING_LABELS: Record<string, string> = {
  FIFO: "FIFO (premier entré, premier sorti)",
  LIFO: "LIFO (dernier entré, premier sorti)",
  WEIGHTED_AVERAGE: "Coût moyen pondéré",
  SPECIFIC_LOT: "Lot désigné",
};

const COVERAGE_SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Saisie manuelle",
  IMPORT: "Import de relevé",
  API: "Connecteur",
};

const INSTRUMENT_REQUIRED: PortfolioEventType[] = ["OPENING_POSITION", "BUY", "SELL"];
const CASH_ONLY: PortfolioEventType[] = ["OPENING_CASH", "CONTRIBUTION", "WITHDRAWAL"];
const EXTERNAL_TYPES: PortfolioEventType[] = [
  "CONTRIBUTION",
  "WITHDRAWAL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
];
const DISPOSAL_TYPES: PortfolioEventType[] = ["SELL", "TRANSFER_OUT"];
/** Sens du mouvement de cash imposé par la nature. Le signe ne se saisit jamais. */
const OUTFLOW_TYPES: PortfolioEventType[] = ["BUY", "WITHDRAWAL", "FEE", "TAX", "TRANSFER_OUT"];

const number = (value: string) => Number(value.replace(",", "."));
const nullableNumber = (value: string) => (value.trim() === "" ? null : number(value));
const nullableText = (value: string) => (value.trim() === "" ? null : value.trim());

interface Draft {
  type: PortfolioEventType;
  eventDate: string;
  settlementDate: string;
  securityId: string;
  securityName: string;
  ticker: string;
  isin: string;
  assetClass: string;
  quantity: string;
  unitPrice: string;
  grossAmount: string;
  feeAmount: string;
  taxAmount: string;
  /** Saisi en valeur absolue : le sens vient de la nature de l'événement. */
  cashAmount: string;
  counterpartyAccountId: string;
  transactionId: string;
  matchedAcquisitionEventId: string;
  notes: string;
}

function blankDraft(asOfDate: string): Draft {
  return {
    type: "CONTRIBUTION",
    eventDate: asOfDate,
    settlementDate: "",
    securityId: "",
    securityName: "",
    ticker: "",
    isin: "",
    assetClass: "",
    quantity: "",
    unitPrice: "",
    grossAmount: "",
    feeAmount: "",
    taxAmount: "",
    cashAmount: "",
    counterpartyAccountId: "",
    transactionId: "",
    matchedAcquisitionEventId: "",
    notes: "",
  };
}

/**
 * Saisie d'un événement de ledger.
 *
 * Un champ monétaire laissé vide reste `null` : le formulaire n'écrit jamais zéro à la
 * place d'une donnée que l'utilisateur n'a pas. C'est cette distinction qui décide
 * ensuite si un coût de revient est calculable ou non.
 */
export function PortfolioEventForm({
  envelope,
  accounts,
  events,
  transactions,
  asOfDate,
  busy,
  onSave,
  onCancel,
}: {
  envelope: FinancialAccount;
  accounts: FinancialAccount[];
  events: PortfolioEvent[];
  transactions: Transaction[];
  asOfDate: string;
  busy: boolean;
  onSave: (event: PortfolioEventInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => blankDraft(asOfDate));
  const patch = (values: Partial<Draft>) => setDraft((current) => ({ ...current, ...values }));

  const instruments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const event of events) {
      if (event.securityId && !seen.has(event.securityId)) {
        seen.set(event.securityId, event.securityName ?? event.securityId);
      }
    }
    return [...seen.entries()];
  }, [events]);

  const lots = useMemo(
    () =>
      events.filter(
        (event) =>
          event.securityId !== null &&
          event.securityId === draft.securityId &&
          ["OPENING_POSITION", "BUY", "TRANSFER_IN"].includes(event.type),
      ),
    [events, draft.securityId],
  );

  const bankTransactions = useMemo(
    () =>
      transactions
        .filter(
          (transaction) =>
            draft.counterpartyAccountId === "" ||
            transaction.accountId === draft.counterpartyAccountId,
        )
        .slice(0, 60),
    [transactions, draft.counterpartyAccountId],
  );

  const needsInstrument = INSTRUMENT_REQUIRED.includes(draft.type);
  const forbidsInstrument = CASH_ONLY.includes(draft.type);
  const isExternal = EXTERNAL_TYPES.includes(draft.type);
  const isDisposal = DISPOSAL_TYPES.includes(draft.type);
  const isOpeningCash = draft.type === "OPENING_CASH";

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    const rawCash = nullableNumber(draft.cashAmount);
    const signedCash =
      rawCash === null
        ? null
        : isOpeningCash
          ? rawCash
          : OUTFLOW_TYPES.includes(draft.type)
            ? -Math.abs(rawCash)
            : Math.abs(rawCash);
    const useExisting = draft.securityId !== "";
    const payload: PortfolioEventInput = {
      accountId: envelope.id,
      type: draft.type,
      eventDate: draft.eventDate,
      settlementDate: nullableText(draft.settlementDate),
      securityId: forbidsInstrument ? null : useExisting ? draft.securityId : null,
      security:
        forbidsInstrument || useExisting || draft.securityName.trim() === ""
          ? null
          : {
              name: draft.securityName.trim(),
              ticker: nullableText(draft.ticker),
              isin: nullableText(draft.isin),
              currency: envelope.currency,
              assetClass: nullableText(draft.assetClass),
            },
      quantity: nullableNumber(draft.quantity),
      unitPrice: nullableNumber(draft.unitPrice),
      grossAmount: nullableNumber(draft.grossAmount),
      feeAmount: nullableNumber(draft.feeAmount),
      taxAmount: nullableNumber(draft.taxAmount),
      envelopeCashAmount: signedCash,
      currency: envelope.currency,
      counterpartyAccountId: isExternal ? nullableText(draft.counterpartyAccountId) : null,
      transactionId: isExternal ? nullableText(draft.transactionId) : null,
      matchedAcquisitionEventId: isDisposal ? nullableText(draft.matchedAcquisitionEventId) : null,
      externalReference: null,
      notes: nullableText(draft.notes),
    };
    if (await onSave(payload)) onCancel();
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        Nature de l’événement
        <select
          className="text-input"
          value={draft.type}
          onChange={(event) => patch({ type: event.target.value as PortfolioEventType })}
        >
          {PORTFOLIO_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date de l’opération
        <input
          className="text-input"
          type="date"
          value={draft.eventDate}
          onChange={(event) => patch({ eventDate: event.target.value })}
          required
        />
      </label>
      <label>
        Date de règlement
        <input
          className="text-input"
          type="date"
          value={draft.settlementDate}
          onChange={(event) => patch({ settlementDate: event.target.value })}
        />
      </label>
      <label>
        {isOpeningCash ? "Cash d’enveloppe à cette date" : "Mouvement de cash d’enveloppe"}
        <input
          className="text-input"
          type="number"
          step="0.01"
          placeholder="Inconnu"
          value={draft.cashAmount}
          onChange={(event) => patch({ cashAmount: event.target.value })}
        />
      </label>

      {forbidsInstrument ? null : (
        <>
          <label>
            Instrument déjà connu
            <select
              className="text-input"
              value={draft.securityId}
              onChange={(event) => patch({ securityId: event.target.value })}
            >
              <option value="">Nouvel instrument ci-dessous</option>
              {instruments.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {draft.securityId === "" ? (
            <>
              <label>
                Nom de l’instrument
                <input
                  className="text-input"
                  value={draft.securityName}
                  onChange={(event) => patch({ securityName: event.target.value })}
                  required={needsInstrument}
                />
              </label>
              <label>
                Ticker
                <input
                  className="text-input"
                  value={draft.ticker}
                  onChange={(event) => patch({ ticker: event.target.value })}
                />
              </label>
              <label>
                ISIN
                <input
                  className="text-input"
                  maxLength={12}
                  value={draft.isin}
                  onChange={(event) => patch({ isin: event.target.value })}
                />
              </label>
              <label>
                Classe d’actif existante
                <input
                  className="text-input"
                  placeholder="Rattachée seulement si elle existe déjà"
                  value={draft.assetClass}
                  onChange={(event) => patch({ assetClass: event.target.value })}
                />
              </label>
            </>
          ) : null}
          <label>
            Quantité
            <input
              className="text-input"
              type="number"
              min="0"
              step="0.0001"
              placeholder={needsInstrument ? "Obligatoire" : "Sans objet"}
              value={draft.quantity}
              onChange={(event) => patch({ quantity: event.target.value })}
              required={needsInstrument}
            />
          </label>
          <label>
            Prix unitaire
            <input
              className="text-input"
              type="number"
              min="0"
              step="0.000001"
              placeholder="Inconnu"
              value={draft.unitPrice}
              onChange={(event) => patch({ unitPrice: event.target.value })}
            />
          </label>
        </>
      )}

      <label>
        Montant brut
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          placeholder="Inconnu"
          value={draft.grossAmount}
          onChange={(event) => patch({ grossAmount: event.target.value })}
        />
      </label>
      <label>
        Frais
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          placeholder="Inconnus"
          value={draft.feeAmount}
          onChange={(event) => patch({ feeAmount: event.target.value })}
        />
      </label>
      <label>
        Taxe
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          placeholder="Inconnue"
          value={draft.taxAmount}
          onChange={(event) => patch({ taxAmount: event.target.value })}
        />
      </label>

      {isExternal ? (
        <>
          <label>
            Compte de contrepartie
            <select
              className="text-input"
              value={draft.counterpartyAccountId}
              onChange={(event) =>
                patch({ counterpartyAccountId: event.target.value, transactionId: "" })
              }
            >
              <option value="">Non renseigné</option>
              {accounts
                .filter((account) => account.id !== envelope.id)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Jambe bancaire correspondante
            <select
              className="text-input"
              value={draft.transactionId}
              onChange={(event) => patch({ transactionId: event.target.value })}
            >
              <option value="">Non rattachée</option>
              {bankTransactions.map((transaction) => (
                <option key={transaction.id} value={transaction.id}>
                  {transaction.date} · {transaction.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      {isDisposal && lots.length > 0 ? (
        <label className="full">
          Lot désigné (convention « lot désigné » uniquement)
          <select
            className="text-input"
            value={draft.matchedAcquisitionEventId}
            onChange={(event) => patch({ matchedAcquisitionEventId: event.target.value })}
          >
            <option value="">Aucun lot désigné</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.eventDate} · {EVENT_TYPE_LABELS[lot.type]} · {lot.quantity ?? "?"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="full">
        Note
        <input
          className="text-input"
          value={draft.notes}
          onChange={(event) => patch({ notes: event.target.value })}
        />
      </label>

      <p className="panel-note full">
        Un champ monétaire laissé vide reste inconnu : il n’est jamais lu comme zéro. Le sens du
        mouvement de cash vient de la nature de l’événement, jamais du signe saisi. Cet événement
        est{" "}
        {PORTFOLIO_FLOW_DIRECTION[draft.type] === "OPENING"
          ? "un ancrage : ni apport, ni opération interne"
          : PORTFOLIO_FLOW_DIRECTION[draft.type] === "INTERNAL"
            ? "une opération interne à l’enveloppe : aucune jambe bancaire ne doit lui être rattachée"
            : "un flux externe à l’enveloppe : il déplace un actif, il ne consomme rien"}
        .
      </p>

      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Annuler
        </button>
        <button className="button primary" disabled={busy}>
          <Save size={15} />
          Enregistrer l’événement
        </button>
      </div>
    </form>
  );
}

/** Déclaration des conventions d'une enveloppe. Effacer une déclaration est une action. */
export function PortfolioPolicyForm({
  envelope,
  policy,
  busy,
  onSave,
  onCancel,
}: {
  envelope: FinancialAccount;
  policy: PortfolioEnvelopePolicy | null;
  busy: boolean;
  onSave: (policy: PortfolioEnvelopePolicyInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState(policy?.lotMatchingMethod ?? "");
  const [start, setStart] = useState(policy?.ledgerCoverageStart ?? "");
  const [source, setSource] = useState(policy?.ledgerCoverageSource ?? "");
  const [notes, setNotes] = useState(policy?.notes ?? "");

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    const declared = start.trim() !== "";
    const saved = await onSave({
      accountId: envelope.id,
      lotMatchingMethod: (nullableText(method) ??
        null) as PortfolioEnvelopePolicyInput["lotMatchingMethod"],
      ledgerCoverageStart: declared ? start : null,
      // Une profondeur sans origine n'est pas traçable : les deux se déclarent ensemble.
      ledgerCoverageSource: declared
        ? ((nullableText(source) ??
            "MANUAL") as PortfolioEnvelopePolicyInput["ledgerCoverageSource"])
        : null,
      notes: nullableText(notes),
    });
    if (saved) onCancel();
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        Convention d’appariement des lots
        <select
          className="text-input"
          value={method}
          onChange={(event) => setMethod(event.target.value as typeof method)}
        >
          <option value="">Non déclarée</option>
          {LOT_MATCHING_METHODS.map((value) => (
            <option key={value} value={value}>
              {MATCHING_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Historique exhaustif à partir du
        <input
          className="text-input"
          type="date"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
      </label>
      <label>
        Origine de la déclaration
        <select
          className="text-input"
          value={source}
          onChange={(event) => setSource(event.target.value as typeof source)}
          disabled={start.trim() === ""}
        >
          <option value="">Non déclarée</option>
          {LEDGER_COVERAGE_SOURCES.map((value) => (
            <option key={value} value={value}>
              {COVERAGE_SOURCE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note
        <input
          className="text-input"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <p className="panel-note full">
        Laisser la convention « non déclarée » n’équivaut pas à choisir FIFO : tant qu’elle n’est
        pas déclarée, le coût de revient cédé reste non calculable dès qu’il existe plusieurs lots
        ouverts. Laisser la date vide n’équivaut pas à « depuis toujours » : le ledger est alors
        traité comme un historique de profondeur inconnue.
      </p>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Annuler
        </button>
        <button className="button primary" disabled={busy}>
          <Save size={15} />
          Enregistrer les conventions
        </button>
      </div>
    </form>
  );
}
