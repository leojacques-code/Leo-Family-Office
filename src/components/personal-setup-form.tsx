"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Le départ après sauvegarde recharge le profil serveur sans masquer l’acquittement par un refresh de /setup. */
import { useState, type FormEvent } from "react";
import { DateInput } from "@/components/primitives/date-input";
import {
  FIRST_INTENTS,
  INTENT_ACTIONS,
  personalSetupSchema,
  personalSetupInputSchema,
  type PersonalSetup,
} from "@/lib/personal-setup";

export function PersonalSetupForm({
  initial,
  returnTo = "/",
  today,
}: {
  initial: PersonalSetup;
  returnTo?: string;
  today: string;
}) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const nextAction = saved.firstIntent ? INTENT_ACTIONS[saved.firstIntent] : null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/profile/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          personalSetupInputSchema.parse({
            displayName: draft.displayName,
            firstIntent: draft.firstIntent,
            residenceCountry: draft.residenceCountry,
            contextDate: draft.contextDate,
          }),
        ),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      const persisted = personalSetupSchema.parse(await response.json());
      setDraft(persisted);
      setSaved(persisted);
      setNotice("Vos choix sont enregistrés. Vous pourrez les retrouver dans Mon espace.");
    } catch {
      setError("Enregistrement non confirmé. Vos saisies sont conservées ; réessayez.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="personal-setup-card">
      <form onSubmit={submit}>
        <label className="field-label">
          Nom de votre espace
          <input
            className="text-input"
            value={draft.displayName}
            maxLength={80}
            required
            disabled={pending}
            onChange={(event) => {
              setDraft({ ...draft, displayName: event.target.value });
              setNotice("");
            }}
          />
        </label>
        <fieldset className="personal-context">
          <legend>Votre contexte</legend>
          <p className="personal-setup-hint">
            Devise de lecture actuelle :{" "}
            <strong>{saved.reportingCurrency ?? "Non renseignée"}</strong>. Le changement de devise
            n’est pas encore disponible.
          </p>
          <label className="field-label">
            Pays de résidence déclaré (facultatif)
            <input
              className="text-input"
              autoComplete="country-name"
              value={draft.residenceCountry ?? ""}
              maxLength={80}
              disabled={pending}
              onChange={(event) => {
                setDraft({ ...draft, residenceCountry: event.target.value || null });
                setNotice("");
              }}
            />
          </label>
          <DateInput
            id="personal-context-date"
            label="Date de référence du contexte (facultative)"
            value={draft.contextDate}
            max={today}
            disabled={pending}
            onChange={(date) => {
              setDraft({ ...draft, contextDate: date.value });
              setNotice("");
            }}
            hint="Date à laquelle ce contexte correspond. Elle ne modifie pas les dates de vos comptes ou de votre patrimoine."
          />
          <p className="personal-setup-hint">
            Vous pouvez compléter ces informations plus tard. Le pays déclaré ne détermine pas votre
            résidence fiscale et n’active aucune règle fiscale automatiquement.
          </p>
        </fieldset>
        <label className="field-label">
          Par quoi souhaitez-vous commencer ?
          <select
            className="text-input"
            disabled={pending}
            value={draft.firstIntent ?? ""}
            onChange={(event) => {
              setDraft({
                ...draft,
                firstIntent:
                  event.target.value === ""
                    ? null
                    : (event.target.value as PersonalSetup["firstIntent"]),
              });
              setNotice("");
            }}
          >
            <option value="">Je choisirai plus tard</option>
            {FIRST_INTENTS.map((intent) => (
              <option key={intent} value={intent}>
                {INTENT_ACTIONS[intent].label}
              </option>
            ))}
          </select>
        </label>
        <p className="personal-setup-hint">
          Ce choix propose une première page à explorer. Vous pourrez le changer à tout moment.
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        <button
          className="button primary wide"
          disabled={pending || draft.displayName.trim().length === 0}
        >
          {pending ? "Enregistrement…" : "Enregistrer mes choix"}
        </button>
      </form>
      <nav aria-label="Commencer" className="personal-setup-actions">
        {nextAction ? (
          <a className="button secondary" href={nextAction.href}>
            {nextAction.action}
          </a>
        ) : null}
        {returnTo !== "/" ? (
          <a className="button secondary" href={returnTo}>
            Continuer vers ma page
          </a>
        ) : null}
        <a className="button tertiary" href="/">
          Revenir à Aujourd’hui
        </a>
      </nav>
      <p className="personal-setup-hint">
        Enregistrez vos modifications avant de quitter cette page.
      </p>
    </div>
  );
}
