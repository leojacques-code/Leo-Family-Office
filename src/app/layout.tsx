import type { Metadata } from "next";
import "./globals.css";
// CSS des primitives financières, séparé de `globals.css` : premier fichier du découpage
// « par primitives et workspaces » demandé par la section 10.2 du plan de refonte.
import "./primitives.css";
// CSS du poste de travail : zones, géométrie et typographie de la phase 1.
import "./workstation.css";
// Canvas d'Aujourd'hui, parcours d'installation et boîte de réception : troisième fichier du
// découpage CSS du §10.2. La phase 2 solde la dette typographique de SON périmètre, pas celle
// des treize autres pages.
import "./today.css";
// Canvas du bilan de la phase 4A : géométrie `ACTIFS − DETTES = PATRIMOINE NET`, répartition et
// zones détourées d'un montant inconnu. Quatrième fichier du découpage CSS du §10.2.
import "./net-worth.css";

export const metadata: Metadata = {
  title: "Léo Family Office",
  description: "Cockpit patrimonial privé, projections et décisions financières.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
