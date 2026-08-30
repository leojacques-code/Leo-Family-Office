"use client";

import { useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function LoginForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    if (response.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next && next.startsWith("/") ? next : "/today");
      return;
    }
    const body = await response.json().catch(() => ({ error: "Connexion impossible." }));
    setError(body.error ?? "Connexion impossible.");
    setPending(false);
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="icon-tile"><LockKeyhole size={21} /></div>
      <span className="eyebrow">Authentification privée</span>
      <h2>Accéder au Family Office</h2>
      <p>Entrez votre code d'accès. Aucun identifiant bancaire n'est demandé sur cet écran.</p>
      <label className="field-label" htmlFor="access-code">Code d'accès</label>
      <input id="access-code" className="text-input" type="password" autoComplete="current-password" value={code} onChange={(event) => setCode(event.target.value)} placeholder="••••••••••••" autoFocus required />
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button className="button primary wide" disabled={pending}>{pending ? "Vérification…" : "Entrer dans le cockpit"}<ArrowRight size={16} /></button>
      {process.env.NODE_ENV !== "production" ? <small className="dev-hint">Développement local : <code>leo-local-2026</code></small> : null}
    </form>
  );
}
