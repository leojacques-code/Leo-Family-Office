// Module partagé serveur/client. Ne doit jamais porter "use client" ni importer de composants.
// Les données restent sérialisables pour les pages serveur.

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  /** Ajoute un séparateur visuel avant l'entrée dans la barre latérale. */
  break?: boolean;
}

export const DEFAULT_SECTION = "today";

export const NAV_ITEMS: readonly NavigationItem[] = [
  { id: "today", label: "Home", href: "/today" },
  { id: "net-worth", label: "Wealth", href: "/net-worth" },
  { id: "cash-flow", label: "Cash Flow", href: "/cash-flow" },
  { id: "investments", label: "Investments", href: "/investments" },
  { id: "debt", label: "Debt", href: "/debt" },
  { id: "real-estate", label: "Real Estate", href: "/real-estate" },
  { id: "career", label: "Career", href: "/career" },
  { id: "business-equity", label: "Business Equity", href: "/business-equity" },
  { id: "tax", label: "Tax", href: "/tax" },
  { id: "scenarios", label: "Scenarios", href: "/scenarios", break: true },
  { id: "decision-lab", label: "Decisions", href: "/decision-lab" },
  { id: "goals", label: "Goals", href: "/goals" },
  { id: "imports", label: "Sources", href: "/imports", break: true },
  { id: "documents", label: "Documents", href: "/documents" },
  { id: "timeline", label: "Timeline", href: "/timeline" },
  { id: "settings", label: "Settings", href: "/settings" },
];

export const ROUTED_SECTION_IDS: readonly string[] = NAV_ITEMS.map((item) => item.id);

export function isValidSection(section: string): boolean {
  return NAV_ITEMS.some((item) => item.id === section);
}

export function isRoutedSection(section: string): boolean {
  return isValidSection(section);
}

export function sectionLabel(section: string): string {
  return NAV_ITEMS.find((item) => item.id === section)?.label ?? "Home";
}
