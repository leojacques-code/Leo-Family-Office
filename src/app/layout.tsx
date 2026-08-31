import type { Metadata } from "next";
import "./globals.css";
import "./level2-preview.css";
import "./level2-motion.css";
import "./lfo-experience-v3.css";

export const metadata: Metadata = {
  title: "Léo Family Office — Private Wealth Cockpit",
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
