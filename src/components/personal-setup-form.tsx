"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  FIRST_INTENTS,
  INTENT_ACTIONS,
  personalSetupSchema,
  type PersonalSetup,
} from "@/lib/personal-setup";

export function PersonalSetupForm({
  initial,
  returnTo = "/",
}: {
  initial: PersonalSetup;
  returnTo?: string;
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
        body: JSON.stringify(draft),
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
          <Link className="button secondary" href={nextAction.href}>
            {nextAction.action}
          </Link>
        ) : null}
        {returnTo !== "/" ? (
          <Link className="button secondary" href={returnTo}>
            Continuer vers ma page
          </Link>
        ) : null}
        <Link className="button tertiary" href="/">
          Revenir à Aujourd’hui
        </Link>
      </nav>
      <p className="personal-setup-hint">
        Enregistrez vos modifications avant de quitter cette page.
      </p>
    </div>
  );
}
