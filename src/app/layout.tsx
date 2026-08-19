import type { Metadata } from "next";
import "./globals.css";

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
