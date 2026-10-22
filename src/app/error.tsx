"use client";

export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="not-found">
      <span>Erreur de chargement</span>
      <h1>Le cockpit n’a pas pu se charger</h1>
      <p>Relancez le chargement pour consulter vos données.</p>
      <button type="button" className="button primary" onClick={retry}>
        Réessayer
      </button>
    </main>
  );
}
