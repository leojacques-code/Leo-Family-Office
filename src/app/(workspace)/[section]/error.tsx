"use client";

import Link from "next/link";

/** Frontière du domaine : reprise serveur et retour vers Aujourd’hui sans exposer l’erreur technique. */
export default function SectionError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="not-found">
      <span>Chargement interrompu</span>
      <h1>Cette page est momentanément indisponible</h1>
      <p>Relancez le chargement pour consulter vos données.</p>
      <button type="button" className="button primary" onClick={retry}>
        Réessayer
      </button>
      <Link className="button secondary" href="/">
        Revenir à Aujourd’hui
      </Link>
    </main>
  );
}
