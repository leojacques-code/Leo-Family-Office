import Link from "next/link";

export default function NotFound() {
  return <main className="not-found"><span>404</span><h1>Page introuvable</h1><p>Ce module n’existe pas dans Léo Family Office.</p><Link className="button primary" href="/">Retour au cockpit</Link></main>;
}
