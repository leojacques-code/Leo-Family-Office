import type { Metadata } from "next";
import "./globals.css";
import "./level2-preview.css";
import "./level2-motion.css";
import "./lfo-experience-v3.css";
import "./lfo-guided-v4.css";
import "./lfo-visual-v5.css";
import "./lfo-rigorous-v6.css";
import "./lfo-readability-v7.css";
import "./lfo-public-v8.css";
import "./lfo-public-v8-polish.css";
import "./lfo-cockpit-v9.css";
import "./lfo-cockpit-v9-polish.css";

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
