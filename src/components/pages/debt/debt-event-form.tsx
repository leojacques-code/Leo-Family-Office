"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { MoneyInput } from "@/components/primitives/money-input";
import { PercentInput } from "@/components/primitives/percent-input";
import { buildLoanTimeline } from "@/lib/engine/debt";
import { withDebtEvents } from "@/lib/engine/debt-events";
import { operationalToday } from "@/lib/financial-date";
import { formatCurrency } from "@/lib/presentation/currency";
import { formatDate } from "@/components/pages/shared";
import type { DebtEvent, DebtEventContent, DebtEventNature, Liability } from "@/lib/types";

/**
 * B18 : enregistrer un événement de la vie d'un prêt (document 04 §6) sans écraser
 * l'historique contractuel. Le formulaire commence par une question d'usage, révèle les
 * seuls champs de l'événement choisi, ne préremplit aucun fait, puis montre les conséquences
 * calculées par le Debt Engine AVANT l'enregistrement. L'aperçu est une simulation : il
 * n'est jamais écrit.
 */
type Choice =
  | ""
  | "EARLY_REPAYMENT_OBSERVED"
  | "EARLY_REPAYMENT_PLANNED"
  | "FULL_REPAYMENT"
  | "RATE_CHANGE"
  | "PAYMENT_CHANGE"
  | "DEFERRAL"
  | "AMENDMENT";

const CHOICES: Array<{ value: Exclude<Choice, "">; label: string; hint: string }> = [
  {
    value: "EARLY_REPAYMENT_OBSERVED",
    label: "J’ai remboursé une partie du capital",
    hint: "Remboursement anticipé effectué : un fait, daté au plus tard aujourd’hui.",
  },
  {
    value: "EARLY_REPAYMENT_PLANNED",
    label: "Je vais rembourser une partie du capital",
    hint: "Remboursement annoncé au prêteur, daté dans le futur : une intention, pas un fait.",
  },
  {
    value: "FULL_REPAYMENT",
    label: "J’ai soldé le prêt",
    hint: "Solde total effectué : l’encours constaté devient nul à cette date.",
  },
  {
    value: "RATE_CHANGE",
    label: "Le taux a été révisé",
    hint: "Révision notifiée par le prêteur, à partir d’une date d’effet.",
  },
  {
    value: "PAYMENT_CHANGE",
    label: "La mensualité change",
    hint: "Nouveau palier de paiement à partir d’une date d’effet.",
  },
  {
    value: "DEFERRAL",
    label: "Des échéances sont reportées",
    hint: "Report ou pause d’échéances accordé par le prêteur.",
  },
  {
    value: "AMENDMENT",
    label: "J’ai signé un avenant",
    hint: "Avenant qui change le taux, la mensualité ou la durée.",
  },
];

type Draft = {
  date: string;
  source: string;
  amount: number | null;
  penalty: number | null;
  penaltyKnown: "" | "KNOWN" | "UNKNOWN";
  outcome: "" | "SHORTEN_TERM" | "REDUCE_PAYMENT" | "UNKNOWN";
  balanceAfter: number | null;
  annualRate: number | null;
  paymentAmount: number | null;
  maturityDate: string;
  months: number | null;
  deferralKind: "" | "PRINCIPAL_ONLY" | "TOTAL";
  interestTreatment: "" | "PAID" | "CAPITALISED" | "UNKNOWN";
  termEffect: "" | "EXTEND_TERM" | "RECALCULATE_PAYMENT" | "UNKNOWN";
  note: string;
};

const EMPTY: Draft = {
  date: "",
  source: "",
  amount: null,
  penalty: null,
  penaltyKnown: "",
  outcome: "",
  balanceAfter: null,
  annualRate: null,
  paymentAmount: null,
  maturityDate: "",
  months: null,
  deferralKind: "",
  interestTreatment: "",
  termEffect: "",
  note: "",
};

export interface DebtEventSubmission {
  nature: DebtEventNature;
  effectiveDate: string;
  source: string;
  content: DebtEventContent;
}

/** Contenu déclaré, ou le motif précis pour lequel il ne l'est pas encore. */
function contentOf(choice: Choice, draft: Draft): DebtEventContent | string {
  switch (choice) {
    case "":
      return "Choisissez ce qui s’est passé.";
    case "EARLY_REPAYMENT_OBSERVED":
    case "EARLY_REPAYMENT_PLANNED":
      if (draft.amount === null || draft.amount <= 0) return "Indiquez le capital remboursé.";
      if (draft.penaltyKnown === "") return "Indiquez si l’indemnité est connue.";
      if (draft.penaltyKnown === "KNOWN" && draft.penalty === null) return "Indiquez l’indemnité.";
      if (draft.outcome === "") return "Indiquez l’effet du remboursement sur le prêt.";
      return {
        kind: "EARLY_REPAYMENT",
        amount: draft.amount,
        penalty: draft.penaltyKnown === "KNOWN" ? draft.penalty : null,
        outcome: draft.outcome,
        balanceAfter: choice === "EARLY_REPAYMENT_OBSERVED" ? draft.balanceAfter : null,
      };
    case "FULL_REPAYMENT":
      if (draft.amount === null || draft.amount <= 0) return "Indiquez le montant remboursé.";
      if (draft.penaltyKnown === "") return "Indiquez si l’indemnité est connue.";
      if (draft.penaltyKnown === "KNOWN" && draft.penalty === null) return "Indiquez l’indemnité.";
      return {
        kind: "FULL_REPAYMENT",
        amount: draft.amount,
        penalty: draft.penaltyKnown === "KNOWN" ? draft.penalty : null,
      };
    case "RATE_CHANGE":
      if (draft.annualRate === null) return "Indiquez le nouveau taux.";
      return { kind: "RATE_CHANGE", annualRate: draft.annualRate };
    case "PAYMENT_CHANGE":
      if (draft.paymentAmount === null || draft.paymentAmount <= 0)
        return "Indiquez la nouvelle mensualité.";
      return { kind: "PAYMENT_CHANGE", paymentAmount: draft.paymentAmount };
    case "DEFERRAL":
      if (draft.months === null || draft.months < 1)
        return "Indiquez le nombre d’échéances reportées.";
      if (draft.deferralKind === "") return "Indiquez la nature du report.";
      if (draft.interestTreatment === "") return "Indiquez le sort des intérêts pendant le report.";
      if (draft.termEffect === "") return "Indiquez l’effet du report sur la durée.";
      return {
        kind: "DEFERRAL",
        months: draft.months,
        deferralKind: draft.deferralKind,
        interestTreatment: draft.interestTreatment,
        termEffect: draft.termEffect,
      };
    case "AMENDMENT":
      if (draft.annualRate === null && draft.paymentAmount === null && !draft.maturityDate)
        return "Un avenant change au moins le taux, la mensualité ou la durée.";
      if (draft.maturityDate && draft.date && draft.maturityDate <= draft.date)
        return "La nouvelle dernière échéance suit la date d’effet.";
      return {
        kind: "AMENDMENT",
        annualRate: draft.annualRate,
        paymentAmount: draft.paymentAmount,
        maturityDate: draft.maturityDate || null,
        note: draft.note.trim() || null,
      };
  }
}

function natureOf(choice: Choice): DebtEventNature {
  if (choice === "EARLY_REPAYMENT_OBSERVED" || choice === "FULL_REPAYMENT") return "OBSERVED";
  if (choice === "EARLY_REPAYMENT_PLANNED") return "PLANNED";
  return "CONTRACTUAL";
}

export function DebtEventForm({
  loan,
  asOfDate,
  busy,
  onSubmit,
  onCancel,
}: {
  loan: Liability;
  asOfDate: string;
  busy: boolean;
  onSubmit: (event: DebtEventSubmission) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<Choice>("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const currency = loan.currency ?? null;
  const currencyLabel = currency ?? "devise non renseignée";
  const today = operationalToday();
  // Lendemain civil : borne basse d'un remboursement PRÉVU, qui ne peut pas être aujourd'hui.
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const nature = natureOf(choice);
  const content = contentOf(choice, draft);
  const dateProblem = !draft.date
    ? "Indiquez la date d’effet."
    : nature === "OBSERVED" && draft.date > today
      ? "Un fait constaté n’est pas daté après aujourd’hui."
      : nature === "PLANNED" && draft.date <= today
        ? "Un remboursement prévu est daté après aujourd’hui ; effectué, choisissez « J’ai remboursé »."
        : null;
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  // Conséquences calculées par le Debt Engine sur l'état actuel ET sur l'état avec
  // l'événement. Aucune formule ici : deux lectures du moteur, comparées champ par champ.
  const preview = useMemo(() => {
    if (typeof content === "string" || dateProblem) return null;
    const event: DebtEvent = {
      id: "apercu",
      liabilityId: loan.id,
      nature,
      effectiveDate: draft.date,
      source: draft.source || "Aperçu",
      content,
      observationId: null,
      recordedAt: new Date().toISOString(),
      cancellation: null,
    };
    // L'encours constaté ne remplace l'encours courant que s'il n'est pas antérieur à la
    // dernière observation : c'est la règle de la base, et l'aperçu ne doit pas promettre
    // un bilan que l'enregistrement ne produira pas.
    const observedAfter =
      ((content.kind === "EARLY_REPAYMENT" && content.balanceAfter !== null) ||
        content.kind === "FULL_REPAYMENT") &&
      (!loan.balanceDate || loan.balanceDate <= draft.date);
    const base = observedAfter
      ? {
          ...loan,
          currentBalance: content.kind === "FULL_REPAYMENT" ? 0 : (content.balanceAfter ?? 0),
          balanceDate: draft.date,
        }
      : loan;
    const before = buildLoanTimeline(loan, asOfDate);
    const after = buildLoanTimeline(withDebtEvents(base, [event]), asOfDate);
    const next = (timeline: typeof before) =>
      timeline.forward.entries.find((entry) => entry.entryKind === "PAYMENT") ?? null;
    const known = new Set(before.flags.map((flag) => `${flag.code}|${flag.detail}`));
    return {
      before: {
        balance: loan.currentBalance,
        next: next(before),
        last: before.forward.lastDueDate,
        interest: before.forward.totalInterest,
      },
      after: {
        balance: base.currentBalance,
        next: next(after),
        last: after.forward.lastDueDate,
        interest: after.forward.totalInterest,
      },
      reserves: after.flags.filter((flag) => !known.has(`${flag.code}|${flag.detail}`)),
    };
  }, [content, dateProblem, draft.date, draft.source, loan, nature, asOfDate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (typeof content === "string") return setError(content);
    if (dateProblem) return setError(dateProblem);
    if (!draft.source.trim()) return setError("Indiquez la source : courrier, avenant, relevé…");
    setError(null);
    const saved = await onSubmit({
      nature,
      effectiveDate: draft.date,
      source: draft.source.trim(),
      content,
    });
    // Un refus garde la saisie : le message vient de la page.
    if (saved) onCancel();
  }

  const repayment =
    choice === "EARLY_REPAYMENT_OBSERVED" ||
    choice === "EARLY_REPAYMENT_PLANNED" ||
    choice === "FULL_REPAYMENT";
  const amountRow = (row: {
    balance: number;
    next: { dueDate: string; totalCashOut: number } | null;
    last: string | null;
    interest: number;
  }) => (
    <>
      <dd role="cell">{formatCurrency(row.balance, currency)}</dd>
      <dd role="cell">
        {row.next
          ? `${formatCurrency(row.next.totalCashOut, currency)} le ${formatDate(row.next.dueDate)}`
          : "Aucune"}
      </dd>
      <dd role="cell">{row.last ? formatDate(row.last) : "Non calculable"}</dd>
      <dd role="cell">{formatCurrency(row.interest, currency)}</dd>
    </>
  );

  return (
    <form className="form-grid debt-event-form" onSubmit={submit}>
      <fieldset className="full debt-terms">
        <legend>Que s’est-il passé ?</legend>
        <div className="radio-row full" role="radiogroup" aria-label="Nature de l’événement">
          {CHOICES.map((item) => (
            <div className="debt-event-choice" key={item.value}>
              <label className="checkbox-row">
                <input
                  aria-describedby={`debt-event-hint-${item.value}`}
                  checked={choice === item.value}
                  name="debt-event-choice"
                  onChange={() => {
                    setChoice(item.value);
                    setError(null);
                  }}
                  type="radio"
                />
                {item.label}
              </label>
              <small id={`debt-event-hint-${item.value}`}>{item.hint}</small>
            </div>
          ))}
        </div>
      </fieldset>

      {choice ? (
        <>
          <label>
            {nature === "CONTRACTUAL" ? "Date d’effet" : "Date du remboursement"}
            <input
              className="text-input"
              type="date"
              value={draft.date}
              {...(nature === "OBSERVED" ? { max: today } : {})}
              {...(nature === "PLANNED" ? { min: tomorrow } : {})}
              onChange={(event) => set({ date: event.target.value })}
              required
            />
          </label>
          <label>
            Source
            <input
              className="text-input"
              maxLength={200}
              placeholder="Ex. courrier de la banque du 3 octobre"
              value={draft.source}
              onChange={(event) => set({ source: event.target.value })}
              required
            />
          </label>
        </>
      ) : null}

      {repayment ? (
        <>
          <MoneyInput
            id="debt-event-amount"
            label={
              choice === "FULL_REPAYMENT" ? "Montant remboursé pour solder" : "Capital remboursé"
            }
            currency={currencyLabel}
            value={draft.amount}
            onChange={(value) => set({ amount: value.state === "VALID" ? value.value : null })}
            required
          />
          <label>
            Indemnité de remboursement anticipé
            <select
              className="text-input"
              value={draft.penaltyKnown}
              onChange={(event) =>
                set({ penaltyKnown: event.target.value as Draft["penaltyKnown"], penalty: null })
              }
              required
            >
              <option value="">Choisir</option>
              <option value="KNOWN">Connue</option>
              <option value="UNKNOWN">Inconnue (coût incomplet)</option>
            </select>
          </label>
          {draft.penaltyKnown === "KNOWN" ? (
            <MoneyInput
              id="debt-event-penalty"
              label="Montant de l’indemnité"
              currency={currencyLabel}
              value={draft.penalty}
              onChange={(value) => set({ penalty: value.state === "VALID" ? value.value : null })}
              required
            />
          ) : null}
          {choice !== "FULL_REPAYMENT" ? (
            <label>
              Effet sur le prêt
              <select
                className="text-input"
                value={draft.outcome}
                onChange={(event) => set({ outcome: event.target.value as Draft["outcome"] })}
                required
              >
                <option value="">Choisir</option>
                <option value="SHORTEN_TERM">Durée réduite, mensualité inchangée</option>
                <option value="REDUCE_PAYMENT">Mensualité réduite, durée inchangée</option>
                <option value="UNKNOWN">Inconnu</option>
              </select>
            </label>
          ) : null}
          {choice === "EARLY_REPAYMENT_OBSERVED" ? (
            <MoneyInput
              id="debt-event-balance-after"
              label="Capital restant dû indiqué par le prêteur (facultatif)"
              currency={currencyLabel}
              value={draft.balanceAfter}
              onChange={(value) =>
                set({ balanceAfter: value.state === "VALID" ? value.value : null })
              }
            />
          ) : null}
        </>
      ) : null}

      {choice === "RATE_CHANGE" || choice === "AMENDMENT" ? (
        <PercentInput
          id="debt-event-rate"
          label={choice === "AMENDMENT" ? "Nouveau taux (facultatif)" : "Nouveau taux annuel"}
          rateNature="NOMINAL"
          value={draft.annualRate}
          onChange={(value) => set({ annualRate: value.state === "VALID" ? value.value : null })}
          required={choice === "RATE_CHANGE"}
        />
      ) : null}
      {choice === "PAYMENT_CHANGE" || choice === "AMENDMENT" ? (
        <MoneyInput
          id="debt-event-payment"
          label={
            choice === "AMENDMENT" ? "Nouvelle mensualité (facultative)" : "Nouvelle mensualité"
          }
          currency={currencyLabel}
          value={draft.paymentAmount}
          onChange={(value) => set({ paymentAmount: value.state === "VALID" ? value.value : null })}
          required={choice === "PAYMENT_CHANGE"}
        />
      ) : null}
      {choice === "AMENDMENT" ? (
        <label>
          Nouvelle dernière échéance (facultative)
          <input
            className="text-input"
            type="date"
            value={draft.maturityDate}
            onChange={(event) => set({ maturityDate: event.target.value })}
          />
        </label>
      ) : null}
      {choice === "AMENDMENT" ? (
        <label className="full">
          Objet de l’avenant (facultatif)
          <input
            className="text-input"
            maxLength={500}
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
          />
        </label>
      ) : null}

      {choice === "DEFERRAL" ? (
        <>
          <label>
            Échéances reportées
            <input
              className="text-input"
              inputMode="numeric"
              value={draft.months ?? ""}
              onChange={(event) => {
                const value = event.target.value.trim();
                set({ months: /^[0-9]{1,3}$/.test(value) ? Number(value) : null });
              }}
              required
            />
          </label>
          <label>
            Nature du report
            <select
              className="text-input"
              value={draft.deferralKind}
              onChange={(event) =>
                set({ deferralKind: event.target.value as Draft["deferralKind"] })
              }
              required
            >
              <option value="">Choisir</option>
              <option value="PRINCIPAL_ONLY">Capital seulement (intérêts payés)</option>
              <option value="TOTAL">Total (aucun paiement)</option>
            </select>
          </label>
          <label>
            Intérêts pendant le report
            <select
              className="text-input"
              value={draft.interestTreatment}
              onChange={(event) =>
                set({ interestTreatment: event.target.value as Draft["interestTreatment"] })
              }
              required
            >
              <option value="">Choisir</option>
              <option value="PAID">Payés</option>
              <option value="CAPITALISED">Ajoutés au capital</option>
              <option value="UNKNOWN">Inconnu</option>
            </select>
          </label>
          <label>
            Effet sur la durée
            <select
              className="text-input"
              value={draft.termEffect}
              onChange={(event) => set({ termEffect: event.target.value as Draft["termEffect"] })}
              required
            >
              <option value="">Choisir</option>
              <option value="EXTEND_TERM">Durée allongée d’autant</option>
              <option value="RECALCULATE_PAYMENT">Mensualité recalculée, durée inchangée</option>
              <option value="UNKNOWN">Inconnu</option>
            </select>
          </label>
        </>
      ) : null}

      {preview ? (
        <section aria-label="Conséquences" className="full debt-synthesis debt-event-consequences">
          <strong>Conséquences avant enregistrement</strong>
          <div
            className="debt-consequence-table"
            role="table"
            aria-label="Avant et après l’événement"
          >
            <div role="row" className="debt-consequence-head">
              <span role="columnheader" />
              <span role="columnheader">Encours retenu</span>
              <span role="columnheader">Prochaine échéance</span>
              <span role="columnheader">Dernière échéance</span>
              <span role="columnheader">Intérêts restant à payer</span>
            </div>
            <dl role="row">
              <dt role="rowheader">Aujourd’hui</dt>
              {amountRow(preview.before)}
            </dl>
            <dl role="row">
              <dt role="rowheader">Avec l’événement</dt>
              {amountRow(preview.after)}
            </dl>
          </div>
          {preview.reserves.length ? (
            <ul className="muted-copy">
              {preview.reserves.map((flag, index) => (
                <li key={`${flag.code}-${index}`}>{flag.detail}</li>
              ))}
            </ul>
          ) : null}
          <small>
            Aperçu calculé, non enregistré. L’historique garde le contrat et les événements
            antérieurs.
          </small>
        </section>
      ) : null}

      {error ? (
        <p className="full form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Annuler
        </button>
        <button className="button primary" disabled={busy || !choice}>
          <Save size={15} /> Enregistrer l’événement
        </button>
      </div>
    </form>
  );
}
