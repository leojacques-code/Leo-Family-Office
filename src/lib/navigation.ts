// Module partagé serveur/client. Ne doit jamais porter "use client" ni importer de composants.
// Le bug de production venait de l'export d'un Set depuis un module client vers une page serveur :
// la sérialisation ne préserve pas les Set. On n'exporte donc que des données sérialisables
// et des fonctions pures.

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  /** Ajoute un séparateur visuel avant l'entrée dans la barre latérale. */
  break?: boolean;
}

export const DEFAULT_SECTION = "today";

export const NAV_ITEMS: readonly NavigationItem[] = [
  { id: "today", label: "Today", href: "/" },
  { id: "advisor", label: "Beyonder", href: "/advisor" },
  { id: "net-worth", label: "Net Worth", href: "/net-worth" },
  { id: "cash-flow", label: "Cash Flow", href: "/cash-flow" },
  { id: "investments", label: "Investments", href: "/investments" },
  { id: "debt", label: "Debt", href: "/debt" },
  { id: "real-estate", label: "Real Estate", href: "/real-estate" },
  { id: "career", label: "Career", href: "/career" },
  { id: "business-equity", label: "Business Equity", href: "/business-equity" },
  { id: "tax", label: "Tax", href: "/tax" },
  { id: "scenarios", label: "Scenarios", href: "/scenarios", break: true },
  { id: "decision-lab", label: "Decision Lab", href: "/decision-lab" },
  { id: "goals", label: "Goals", href: "/goals" },
  { id: "imports", label: "Imports", href: "/imports", break: true },
  { id: "documents", label: "Documents", href: "/documents" },
  { id: "timeline", label: "Timeline", href: "/timeline" },
  { id: "settings", label: "Settings", href: "/settings" },
];

/** Sections adressables par /[section]. La racine "today" est servie par /. */
export const ROUTED_SECTION_IDS: readonly string[] = NAV_ITEMS
  .filter((item) => item.id !== DEFAULT_SECTION)
  .map((item) => item.id);

export function isValidSection(section: string): boolean {
  return NAV_ITEMS.some((item) => item.id === section);
}

export function isRoutedSection(section: string): boolean {
  return isValidSection(section) && section !== DEFAULT_SECTION;
}

export function sectionLabel(section: string): string {
  return NAV_ITEMS.find((item) => item.id === section)?.label ?? "Today";
}
