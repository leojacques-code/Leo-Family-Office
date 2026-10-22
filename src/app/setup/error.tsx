"use client";
export default function SetupError({ retry }: { retry: () => void }) {
  return (
    <main className="personal-setup-page">
      <h1>Votre espace est momentanément indisponible.</h1>
      <p>Vos choix n’ont pas été remplacés. Réessayez de les charger.</p>
      <button className="button primary" onClick={retry}>
        Réessayer
      </button>
    </main>
  );
}
