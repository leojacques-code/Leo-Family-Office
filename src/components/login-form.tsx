"use client";
import { useState } from "react";
import { setupEntryFor } from "@/lib/personal-setup-navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function LoginForm({
  localFixture = false,
  notice = null,
}: {
  localFixture?: boolean;
  /** Issue d'un lien de confirmation, fixée par le serveur depuis une liste fermée. */
  notice?: string | null;
}) {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [intent, setIntent] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState("");
  const [message, setMessage] = useState(notice ?? "");
  const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localFixture ? { code } : { email, password, intent }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Connexion impossible.");
        return;
      }
      if (body.confirmationRequired) {
        setMessage("Confirmez votre adresse avec le lien reçu par e-mail, puis connectez-vous.");
        setIntent("sign-in");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(setupEntryFor(next));
    } catch {
      setError("Connexion momentanément indisponible. Réessayez.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="login-card" onSubmit={submit}>
      <div className="icon-tile">
        <LockKeyhole size={21} />
      </div>
      <span className="eyebrow">
        {localFixture ? "Recette locale fictive" : "Session personnelle"}
      </span>
      <h2>{intent === "sign-up" ? "Créer mon espace" : "Accéder au Family Office"}</h2>
      <p>
        {localFixture
          ? "Ce mode sert uniquement aux données fictives de recette sur cet ordinateur."
          : "Votre connexion ouvre votre espace personnel. Aucun identifiant bancaire n’est demandé."}
      </p>
      {localFixture ? (
        <label className="field-label">
          Code de recette
          <input
            className="text-input"
            type="password"
            autoComplete="current-password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
      ) : (
        <>
          <label className="field-label">
            Adresse e-mail
            <input
              className="text-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field-label">
            Mot de passe
            <input
              className="text-input"
              type="password"
              autoComplete={intent === "sign-up" ? "new-password" : "current-password"}
              minLength={intent === "sign-up" ? 12 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        </>
      )}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <button className="button primary wide" disabled={pending}>
        {pending ? "Vérification…" : intent === "sign-up" ? "Créer mon espace" : "Entrer"}
        <ArrowRight size={16} />
      </button>
      {!localFixture ? (
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={() => {
            setIntent(intent === "sign-in" ? "sign-up" : "sign-in");
            setError("");
            setMessage("");
          }}
        >
          {intent === "sign-in" ? "Créer un espace personnel" : "J’ai déjà un compte"}
        </button>
      ) : null}
    </form>
  );
}
