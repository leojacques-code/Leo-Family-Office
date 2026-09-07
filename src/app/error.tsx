"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="not-found"><span>Erreur</span><h1>Le cockpit n’a pas pu se charger</h1><p>Vos données n’ont pas été modifiées. Réessayez ou consultez les logs du serveur.</p><button className="button primary" onClick={reset}>Réessayer</button></main>;
}
